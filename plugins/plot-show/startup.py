# RemotePad plot-show PYTHONSTARTUP snippet.
# Chains any previous PYTHONSTARTUP, then hooks Plotly show() when available.
import os
import runpy

_prev=os.environ.pop('REMOTEPAD_PREV_PYTHONSTARTUP',None) or os.environ.pop('REMOTEPAD_USER_PYTHONSTARTUP',None)
if _prev and os.path.isfile(_prev):
  try:
    runpy.run_path(_prev,run_name='__main__')
  except Exception:
    pass

try:
  import rpshow
  rpshow.install()
except Exception:
  pass
