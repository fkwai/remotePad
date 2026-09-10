import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { uniqueRoots } from '../paths.ts';

export async function registerMachineRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/machine', async () => ({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    homedir: os.homedir(),
    cwd: process.cwd(),
    user: os.userInfo().username,
    roots: uniqueRoots(),
  }));
}
