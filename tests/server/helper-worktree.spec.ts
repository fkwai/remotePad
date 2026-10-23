import { expect, test } from '@playwright/test';
import { detectWorkId, previewPortsFor, workIdFor } from '../../apps/server/src/agent/worktree-id.ts';

/**
 * A repository's branch namespace is shared by every worktree, so two running
 * checkouts of RemotePad must not both demand `helper/work` — git answers
 * "branch already used by worktree". The primary install keeps the historical
 * id; linked worktrees get a stable suffix.
 */
test.describe('helper worktree ids', () => {
  test('the primary install keeps the historical id and ports', () => {
    expect(workIdFor(true, '/workspace/git/remotePad')).toBe('work');
    expect(previewPortsFor('work')).toEqual({ port: 2028, uiPort: 2027 });
  });

  test('a linked worktree gets its own branch id, stable across calls', () => {
    const a = workIdFor(false, '/workspace/git/remotePad');
    const b = workIdFor(false, '/home/kuai/worktrees/agent-refs');

    expect(a).toMatch(/^work-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
    expect(workIdFor(false, '/workspace/git/remotePad')).toBe(a);
  });

  test('git detection keeps the main install on the historical id', () => {
    expect(detectWorkId(process.cwd())).toMatch(/^work(-[0-9a-f]{6})?$/);
  });

  test('extra checkouts get a port pair of their own', () => {
    const id = workIdFor(false, '/home/kuai/worktrees/agent-refs');
    const ports = previewPortsFor(id);

    expect(ports.uiPort).toBeGreaterThanOrEqual(2100);
    expect(ports.port).toBe(ports.uiPort + 1);
    expect(ports.uiPort).not.toBe(previewPortsFor('work').uiPort);
  });
});
