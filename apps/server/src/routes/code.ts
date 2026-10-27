import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DefinitionRequest, DefinitionResponse } from '@remotepad/shared';
import { PathError, resolveSafe } from '../paths.ts';
import { findTsDefinition } from '../code/tsdef.ts';
import { findPyDefinition } from '../code/pydef.ts';

const TS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Resolve the symbol under the cursor to a file:line.
 *
 * Body: { path, line, column, text? }. `text` is the unsaved editor buffer so a
 * jump works on code the user has not saved yet; without it the disk wins.
 */
export async function registerCodeRoutes(app: FastifyInstance) {
  app.post<{ Body: DefinitionRequest }>('/api/code/definition', async (req) => {
    const body = req.body || ({} as DefinitionRequest);
    const target = resolveSafe(body.path || '');
    const line = Math.max(1, Math.floor(Number(body.line) || 1));
    const column = Math.max(1, Math.floor(Number(body.column) || 1));
    const text = typeof body.text === 'string' ? body.text : undefined;
    const ext = path.extname(target).toLowerCase();

    let result: DefinitionResponse;
    if (TS.has(ext)) {
      const found = findTsDefinition(target, line, column, text);
      result = { language: 'typescript', locations: found.locations, note: found.note };
    } else if (ext === '.py' || ext === '.pyw') {
      const found = findPyDefinition(target, line, column, text);
      result = { language: 'python', locations: found.locations, note: found.note };
    } else {
      throw new PathError(`Definition lookup supports JavaScript/TypeScript and Python, not ${ext || 'this file'}`, 400);
    }
    return result;
  });
}
