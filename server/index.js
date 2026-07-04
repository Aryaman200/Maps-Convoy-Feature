/* ============================================================
   CONVOY SERVER — ENTRY POINT
   ============================================================
   Boots an http server + Socket.io, wires the in-memory store
   to the protocol handlers, and exposes GET /health.
   CORS is wide open ('*') — this is a demo backend.
   ============================================================ */

import { createServer } from 'node:http';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import cors from 'cors';

import { ConvoyStore } from './ConvoyStore.js';
import { registerHandlers } from './socketHandlers.js';

/* ── Store (module-level so /health can read it) ───── */
const store = new ConvoyStore();

/* ── HTTP Server + Health Endpoint ─────────────────── */
const corsMiddleware = cors({ origin: '*' });

const httpServer = createServer((req, res) => {
  /* Run the same permissive CORS on plain HTTP requests too. */
  corsMiddleware(req, res, () => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, convoys: store.size() }));
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Convoy realtime server — connect via Socket.io. See /health.\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
});

/* ── Socket.io ─────────────────────────────────────── */
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

registerHandlers(io, store);

/* ── Listen ────────────────────────────────────────── */
const PORT = process.env.PORT || 3001;

/* Export a start() so tests can boot on an ephemeral port without
   this module auto-listening. When run directly, we start on PORT. */
export function start(port = PORT) {
  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const actual = httpServer.address().port;
      resolve({ httpServer, io, store, port: actual });
    });
  });
}

export { httpServer, io, store };

/* Auto-start only when executed directly (node index.js), not on import. */
const invokedDirectly = argv[1] && fileURLToPath(import.meta.url) === argv[1];
if (invokedDirectly) {
  httpServer.listen(PORT, () => {
    console.log(`🚗 Convoy realtime server listening on http://localhost:${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/health`);
    console.log(`   Socket:  ws://localhost:${PORT}  (CORS: *)`);
  });
}
