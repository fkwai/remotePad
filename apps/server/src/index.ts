import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.ts';
import { PathError } from './paths.ts';
import { registerFsRoutes } from './routes/fs.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerGitRoutes } from './routes/git.ts';
import { registerMachineRoutes } from './routes/machine.ts';
import { registerFavoriteRoutes } from './routes/favorites.ts';
import { registerTermSocket } from './terminal/ws.ts';
import { registerWatchSocket } from './watch.ts';

const app = Fastify({ logger: true });

await app.register(websocket);

app.setErrorHandler((err, _req, reply) => {
  const status = err instanceof PathError ? err.statusCode : (err as { statusCode?: number }).statusCode || 500;
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: message });
});

await registerMachineRoutes(app);
await registerFsRoutes(app);
await registerFavoriteRoutes(app);
await registerSearchRoutes(app);
await registerGitRoutes(app);
await registerTermSocket(app);
await registerWatchSocket(app);

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/ws')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    reply.sendFile('index.html');
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`RemotePad listening on http://${config.host}:${config.port}`);
