import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { findTsDefinition } from '../../apps/server/src/code/tsdef.ts';
import { findPyDefinition } from '../../apps/server/src/code/pydef.ts';

/**
 * "Go to definition" is the first half of reading a repo: the cursor is on a
 * symbol, the answer is a file:line — same file or not.
 *
 * TypeScript goes through the language service (real project view), Python
 * through the resolver (self/annotations/imports/workspace scan). These are the
 * contracts the editor menu depends on.
 */

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-code-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', noEmit: true },
    include: ['src'],
  }));
  fs.writeFileSync(path.join(root, 'src', 'util.ts'), [
    'export interface Options { retries: number }',
    '',
    'export function helper(name: string) {',
    '  return name.repeat(2);',
    '}',
    '',
    'export class Engine {',
    '  start() {',
    "    return helper('x');",
    '  }',
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), [
    "import { helper, Engine } from './util';",
    '',
    'const engine = new Engine();',
    'console.log(engine.start());',
    "console.log(helper('a'));",
  ].join('\n'));

  fs.writeFileSync(path.join(root, 'pkg', '__init__.py'), '');
  fs.writeFileSync(path.join(root, 'pkg', 'core.py'), [
    'class Repo:',
    '    def __init__(self, path):',
    '        self.path = path',
    '',
    '    def status(self):',
    "        return 'clean'",
    '',
    '',
    'def load(path):',
    '    return open(path)',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'pkg', 'app.py'), [
    'from .core import Repo, load',
    'from . import core',
    '',
    '',
    'def run(repo: Repo):',
    "    return repo.status() + core.load('x') + load('y')",
  ].join('\n'));
  return root;
}

test.describe('code intelligence', () => {
  test('TypeScript: an imported function resolves to its declaration file', () => {
    const root = workspace();
    const found = findTsDefinition(path.join(root, 'src', 'main.ts'), 5, 15);
    expect(found.locations).toHaveLength(1);
    expect(found.locations[0].path).toBe(path.join(root, 'src', 'util.ts'));
    expect(found.locations[0].line).toBe(3);
    expect(found.locations[0].kind).toBe('function');
  });

  test('TypeScript: a method call resolves to the class body', () => {
    const root = workspace();
    const found = findTsDefinition(path.join(root, 'src', 'main.ts'), 4, 25);
    expect(found.locations[0].path).toBe(path.join(root, 'src', 'util.ts'));
    expect(found.locations[0].line).toBe(8);
    expect(found.locations[0].name).toBe('start');
  });

  test('TypeScript: a local declaration stays in the same file', () => {
    const root = workspace();
    const found = findTsDefinition(path.join(root, 'src', 'main.ts'), 3, 7);
    expect(found.locations[0].path).toBe(path.join(root, 'src', 'main.ts'));
    expect(found.locations[0].line).toBe(3);
  });

  test('TypeScript: the unsaved buffer wins over the file on disk', () => {
    const root = workspace();
    const file = path.join(root, 'src', 'main.ts');
    const edited = [
      "import { helper, Engine } from './util';",
      '',
      'const engine = new Engine();',
      'console.log(engine.start());',
      "console.log(helper('a'));",
      'const extra = helper;',
    ].join('\n');
    // Line 6 exists only in the buffer.
    const found = findTsDefinition(file, 6, 17, edited);
    expect(found.locations[0].path).toBe(path.join(root, 'src', 'util.ts'));
    expect(found.locations[0].line).toBe(3);
  });

  test('Python: self.method resolves inside the enclosing class', () => {
    const root = workspace();
    const found = findPyDefinition(path.join(root, 'pkg', 'app.py'), 6, 17);
    expect(found.locations[0].path).toBe(path.join(root, 'pkg', 'core.py'));
    expect(found.locations[0].line).toBe(5);
    expect(found.locations[0].name).toBe('status');
  });

  test('Python: an imported name and a module attribute both resolve', () => {
    const root = workspace();
    const file = path.join(root, 'pkg', 'app.py');
    const imported = findPyDefinition(file, 6, 46);
    const attribute = findPyDefinition(file, 6, 34);
    for (const found of [imported, attribute]) {
      expect(found.locations[0].path).toBe(path.join(root, 'pkg', 'core.py'));
      expect(found.locations[0].line).toBe(9);
    }
  });

  test('Python: a parameter annotation resolves to the class', () => {
    const root = workspace();
    const found = findPyDefinition(path.join(root, 'pkg', 'app.py'), 5, 15);
    expect(found.locations[0].path).toBe(path.join(root, 'pkg', 'core.py'));
    expect(found.locations[0].line).toBe(1);
  });

  test('Python: instance attributes resolve from self, an instance and a parameter', () => {
    const root = workspace();
    const file = path.join(root, 'pkg', 'shape.py');
    fs.writeFileSync(file, [
      'class Box:',
      '    def __init__(self):',
      '        self.value = 1',
      '',
      '    def bump(self):',
      '        self.value += 1',
      '',
      '',
      'def touch(box):',
      '    return box.value',
      '',
      '',
      'b = Box()',
      'b.bump()',
      'b.value = 2',
    ].join('\n'));

    // `self.value` inside the class, `b.value` from a constructor assignment,
    // and `box.value` on an untyped parameter: all land on the declaration.
    for (const [line, column] of [[6, 14], [15, 3], [10, 17]]) {
      const found = findPyDefinition(file, line, column);
      expect(found.locations[0]).toMatchObject({ path: file, line: 3 });
    }
  });

  test('Python: a name with no declaration answers a note, not a crash', () => {
    const root = workspace();
    const file = path.join(root, 'pkg', 'app.py');
    fs.appendFileSync(file, '\nprint(missing_name)\n');
    const found = findPyDefinition(file, 8, 8);
    expect(found.locations).toEqual([]);
    expect(found.note).toBeTruthy();
  });
});
