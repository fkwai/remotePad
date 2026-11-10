/**
 * Monaco, served by this app.
 *
 * `@monaco-editor/react` fetches the editor from a CDN by default, which made the
 * editor depend on the public internet: offline it sat on "Loading…", the version
 * was whatever the CDN served that day, and no test could assert anything about the
 * editor's own behaviour. Handing the loader a bundled instance fixes all three and
 * costs no extra bytes at runtime — the CDN was already shipping the same files.
 *
 * Workers are bundled by Vite (`?worker`) so language services (JSON validation,
 * TS diagnostics, CSS/HTML) run here too, not in a CDN iframe-less blob.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });
