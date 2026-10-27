"""RemotePad's Python debugger.

Runs the target as __main__ with sys.settrace and talks JSON lines over a
loopback socket owned by the RemotePad server. No debugpy, no venv changes:
the only cost is that tracing slows execution down (fine for reading code).

Protocol (one JSON object per line, both directions):

  <- {"type": "ready"}
  <- {"type": "paused", "reason", "file", "line", "frames": [...], "locals": [...]}
  <- {"type": "resumed"}
  <- {"type": "exit", "code"}
  -> {"type": "breakpoints", "breakpoints": [{"path", "line"}]}
  -> {"type": "resume" | "stepOver" | "stepInto" | "stepOut" | "pause" | "stop"}
  -> {"type": "variables", "frameId"}
  -> {"type": "evaluate", "frameId", "expression"}
"""

import json
import os
import runpy
import socket
import sys
import threading
import time
import traceback


def safe_repr(value, limit=200):
    try:
        text = repr(value)
    except Exception as exc:  # noqa: BLE001 - user objects can raise anything
        return f"<unrepresentable: {exc}>"
    if len(text) > limit:
        return text[:limit] + "…"
    return text


class Conn:
    def __init__(self, sock):
        self.sock = sock
        self.reader = sock.makefile("rb")
        self.writer = sock.makefile("wb")
        self.lock = threading.Lock()

    def send(self, message):
        data = (json.dumps(message) + "\n").encode()
        with self.lock:
            self.writer.write(data)
            self.writer.flush()

    def recv(self):
        line = self.reader.readline()
        if not line:
            return None
        try:
            return json.loads(line)
        except ValueError:
            return {}


class Tracer:
    def __init__(self, conn, root):
        self.conn = conn
        self.root = os.path.realpath(root)
        self.me = os.path.realpath(__file__)
        self.breaks = set()
        self.mode = "run"  # run | into | over | out
        self.stop_depth = 0
        self.pause_requested = False
        self.paused = False
        self.current_frame = None
        self.frames = []
        self.resume_event = threading.Event()
        self.pending = None
        self.lock = threading.Lock()

    # ---- protocol -------------------------------------------------------
    def reader(self):
        while True:
            message = self.conn.recv()
            if message is None:
                os._exit(0)
            kind = message.get("type")
            if kind == "breakpoints":
                breaks = set()
                for bp in message.get("breakpoints", []):
                    breaks.add((os.path.realpath(bp["path"]), int(bp["line"])))
                with self.lock:
                    self.breaks = breaks
            elif kind == "pause":
                self.pause_requested = True
            elif kind in ("variables", "evaluate"):
                self.answer(message)
            elif kind in ("resume", "stepOver", "stepInto", "stepOut"):
                with self.lock:
                    self.pending = message
                self.resume_event.set()
            elif kind == "stop":
                os._exit(0)

    def answer(self, message):
        frame = self.current_frame
        if frame is None:
            self.conn.send({"type": "error", "message": "Program is not paused"})
            return
        kind = message.get("type")
        if kind == "variables":
            frame = self.frame_by_id(int(message.get("frameId", 0)))
            variables = []
            if frame is not None:
                for name, value in list(frame.f_locals.items())[:100]:
                    variables.append({
                        "name": name,
                        "value": safe_repr(value),
                        "type": type(value).__name__,
                    })
            self.conn.send({"type": "variables", "frameId": int(message.get("frameId", 0)), "variables": variables})
        elif kind == "evaluate":
            expression = str(message.get("expression", ""))[:2000]
            try:
                value = eval(expression, frame.f_globals, frame.f_locals)  # noqa: S307 - debugger input
                self.conn.send({
                    "type": "evaluated",
                    "frameId": int(message.get("frameId", 0)),
                    "expression": expression,
                    "value": safe_repr(value, 2000),
                })
            except Exception as exc:  # noqa: BLE001 - surface to the panel
                self.conn.send({
                    "type": "evaluated",
                    "frameId": int(message.get("frameId", 0)),
                    "expression": expression,
                    "value": "",
                    "error": f"{type(exc).__name__}: {exc}",
                })

    # ---- tracing --------------------------------------------------------
    def in_root(self, filename):
        return os.path.realpath(filename).startswith(self.root + os.sep)

    def depth_of(self, frame):
        depth = 0
        while frame is not None:
            depth += 1
            frame = frame.f_back
        return depth

    def frame_by_id(self, frame_id):
        for index, frame in enumerate(self.frames):
            if index == frame_id:
                return frame
        return None

    def should_stop(self, frame, filename):
        if (filename, frame.f_lineno) in self.breaks:
            return "breakpoint"
        if not self.in_root(filename):
            return None
        depth = self.depth_of(frame)
        if self.pause_requested:
            return "pause"
        if self.mode == "into" and depth >= self.stop_depth:
            return "step"
        if self.mode == "over" and depth <= self.stop_depth:
            return "step"
        if self.mode == "out" and depth < self.stop_depth:
            return "step"
        return None

    def trace(self, frame, event, arg):
        filename = os.path.realpath(frame.f_code.co_filename)
        if filename == self.me:
            return self.trace
        if event == "call":
            return self.trace
        if event != "line":
            return self.trace
        reason = self.should_stop(frame, filename)
        if reason:
            self.stop(frame, filename, reason)
        return self.trace

    def stop(self, frame, filename, reason):
        self.mode = "run"
        self.pause_requested = False
        self.paused = True
        self.current_frame = frame
        chain = []
        walker = frame
        while walker is not None:
            chain.append(walker)
            walker = walker.f_back
        self.frames = chain
        frames = []
        for index, item in enumerate(chain):
            frames.append({
                "id": index,
                "name": item.f_code.co_name,
                "path": os.path.realpath(item.f_code.co_filename),
                "line": item.f_lineno,
                "column": 0,
            })
        locals_list = []
        for name, value in list(frame.f_locals.items())[:100]:
            locals_list.append({"name": name, "value": safe_repr(value), "type": type(value).__name__})
        self.conn.send({
            "type": "paused",
            "reason": reason,
            "file": filename,
            "line": frame.f_lineno,
            "frames": frames,
            "locals": locals_list,
        })

        self.resume_event.clear()
        while True:
            self.resume_event.wait()
            with self.lock:
                message = self.pending
                self.pending = None
            if message is None:
                continue
            kind = message.get("type")
            self.paused = False
            self.current_frame = None
            if kind == "resume":
                self.mode = "run"
            elif kind == "stepOver":
                self.mode = "over"
                self.stop_depth = self.depth_of(frame)
            elif kind == "stepInto":
                self.mode = "into"
                self.stop_depth = self.depth_of(frame)
            elif kind == "stepOut":
                self.mode = "out"
                self.stop_depth = self.depth_of(frame)
            self.conn.send({"type": "resumed"})
            return

    def install(self):
        sys.settrace(self.trace)
        threading.settrace(self.trace)


def connect(port, token, attempts=40):
    for _ in range(attempts):
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=2)
            sock.sendall((token + "\n").encode())
            return sock
        except OSError:
            time.sleep(0.1)
    raise SystemExit("RemotePad debugger: cannot reach the server")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: py-runner.py <script.py>")
    port = int(os.environ["RP_DEBUG_PORT"])
    token = os.environ["RP_DEBUG_TOKEN"]
    root = os.environ["RP_DEBUG_ROOT"]
    target = os.path.realpath(sys.argv[1])

    sock = connect(port, token)
    conn = Conn(sock)
    tracer = Tracer(conn, root)
    threading.Thread(target=tracer.reader, daemon=True).start()
    conn.send({"type": "ready"})
    tracer.install()

    sys.argv = [target]
    sys.path.insert(0, os.path.dirname(target))
    code = 0
    try:
        runpy.run_path(target, run_name="__main__")
    except SystemExit as exc:
        if isinstance(exc.code, int):
            code = exc.code
        elif exc.code:
            sys.stderr.write(str(exc.code) + "\n")
            code = 1
    except BaseException:  # noqa: BLE001 - the user's program failed
        traceback.print_exc()
        code = 1
    finally:
        sys.settrace(None)
    try:
        conn.send({"type": "exit", "code": code})
    except Exception:  # noqa: BLE001 - server may be gone
        pass


if __name__ == "__main__":
    main()
