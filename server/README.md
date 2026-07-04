# Convoy Realtime Server

Real-time backend for the Google Maps **Convoy Mode** web app. A small, self-contained
Node + [Socket.io](https://socket.io) v4 server that is authoritative for convoy room
membership and lifecycle state.

- **Runtime:** Node 20+ (ESM, `"type": "module"`)
- **Transport:** Socket.io 4.x, CORS `*` (demo)
- **State:** in-memory only (no database) — restart wipes all convoys
- **Default port:** `3001` (override with `PORT`)

---

## Quick start

```bash
cd server
npm install
npm start
```

You should see:

```
🚗 Convoy realtime server listening on http://localhost:3001
   Health:  http://localhost:3001/health
   Socket:  ws://localhost:3001  (CORS: *)
```

Check health:

```bash
curl http://localhost:3001/health
# {"ok":true,"convoys":0}
```

---

## Tests

```bash
npm test
```

Boots the server on an ephemeral port with `socket.io-client` and asserts the core
protocol: `create → join` relays `member:joined`, `position:update` relays
`member:position`, the leader-only guard rejects a non-leader `convoy:end`, and a
leader disconnect auto-promotes the earliest-joined connected member.

---

## Files

| File                | Responsibility                                                        |
| ------------------- | --------------------------------------------------------------------- |
| `index.js`          | HTTP server, `/health`, Socket.io setup, listen / exported `start()`. |
| `ConvoyStore.js`    | In-memory `Map<code, convoy>`; membership + lifecycle operations.     |
| `socketHandlers.js` | Registers all protocol events; validation, rate limits, guards.       |
| `validate.js`       | Pure, non-throwing validators (coords, code, strings, member).        |
| `test/convoy.test.mjs` | `node:test` integration tests over the real server.               |

---

## Wire protocol (summary)

A convoy lives in a Socket.io **room** named by its `CODE` (format `/^CVY-[A-Z0-9]{6}$/`).

### Client → Server

| Event              | Payload                                                        | Ack                                     |
| ------------------ | ------------------------------------------------------------- | --------------------------------------- |
| `convoy:create`    | `{ leader, destination, privacy }`                            | `{ ok, code, convoy }` \| `{ ok, error }` |
| `convoy:join`      | `{ code, member }`                                            | `{ ok, convoy }` \| `{ ok, error }`     |
| `convoy:leave`     | `{}`                                                          | —                                       |
| `position:update`  | `{ lat, lng, heading, speed, battery, status }`              | — (rate-limited ~5/s)                   |
| `convoy:start`     | `{ route? }` *(leader)*                                       | `{ ok }`                                |
| `convoy:pause`     | `{}` *(leader)*                                               | `{ ok }`                                |
| `convoy:resume`    | `{}` *(leader)*                                               | `{ ok }`                                |
| `convoy:end`       | `{}` *(leader)*                                               | `{ ok }`                                |
| `member:promote`   | `{ memberId }` *(leader)*                                     | `{ ok }`                                |
| `hazard:report`    | `{ type, lat, lng }`                                          | —                                       |
| `route:update`     | `{ coordinates, reason }` *(leader)*                          | —                                       |
| `eta:update`       | `{ etaSeconds, distanceMeters }` *(leader)*                   | —                                       |
| `chat:message`     | `{ text }`                                                   | — (rate-limited ~3/s)                   |

### Server → Client (broadcast to room)

`convoy:state`, `member:joined`, `member:left`, `member:position`, `member:promoted`,
`convoy:started`, `convoy:paused`, `convoy:resumed`, `convoy:ended`, `hazard:reported`,
`route:updated`, `eta:updated`, `chat:message`, `error`.

### Server rules

- Server is authoritative for membership + lifecycle.
- Leader-only actions are rejected (`ack {ok:false}` / `error` event) for non-leaders.
- On disconnect: member is marked `disconnected` and broadcast; if the **leader** drops,
  the earliest-joined connected member is auto-promoted (`member:promoted`).
- Convoys with zero connected members are pruned after a ~60s grace period.
- All inbound payloads are validated; bad input is dropped, never fatal.
- `position:update` (~5/s) and `chat:message` (~3/s) are rate-limited per socket.

---

## Configuration

| Variable | Default | Description                          |
| -------- | ------- | ------------------------------------ |
| `PORT`   | `3001`  | HTTP + Socket.io listen port.        |

Copy `.env.example` to `.env` for local overrides (values can also come from the host env).

---

## Docker

```bash
cd server
docker build -t convoy-server .
docker run --rm -p 3001:3001 -e PORT=3001 convoy-server
```

The image runs the built-in `/health` HEALTHCHECK.

---

## Deployment notes

- **Stateless-ish:** all state is in memory. For a single instance this is fine for the
  demo. To scale horizontally you must either pin a convoy to one instance (sticky
  sessions) or add a Socket.io adapter (e.g. `@socket.io/redis-adapter`).
- **WebSockets:** ensure your proxy/load balancer allows WS upgrades and sticky sessions.
- **CORS:** currently `*` for the demo — lock this down to your frontend origin for
  production in `index.js` (both the HTTP `cors()` call and the `Server` `cors` option).
- **Health:** point your platform's health probe at `GET /health`.
