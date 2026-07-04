/* ============================================================
   CONVOY SERVER — INTEGRATION TESTS
   ============================================================
   node:test + socket.io-client. Boots the real server on an
   ephemeral port and exercises the wire protocol end to end.
   Kept deterministic and fast; all sockets/server closed in
   teardown so the process exits cleanly.
   ============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';

import { start } from '../index.js';

let server;
let baseURL;

/* Track every client we open so teardown can close them all. */
const clients = [];

function connect() {
  const socket = ioClient(baseURL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  clients.push(socket);
  return socket;
}

/** Promise that resolves with the payload of the next `event`. */
function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

/** Promise-wrapped ack emit. */
function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for "${event}"`)), 3000);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
  });
}

const LEADER = { id: 'u-leader', name: 'Aryaman S', firstName: 'Aryaman', initials: 'AS', color: '#4285f4', vehicle: 'car' };
const FOLLOWER = { id: 'u-follow', name: 'Rahul K', firstName: 'Rahul', initials: 'RK', color: '#ea4335', vehicle: 'suv' };

/* ── Lifecycle ─────────────────────────────────────── */
before(async () => {
  const booted = await start(0);              /* 0 → ephemeral port */
  server = booted;
  baseURL = `http://localhost:${booted.port}`;
});

after(async () => {
  for (const c of clients) { try { c.close(); } catch { /* ignore */ } }
  await new Promise((resolve) => server.io.close(() => resolve()));
  await new Promise((resolve) => server.httpServer.close(() => resolve()));
});

/* ── create → join relays member:joined ────────────── */
test('create then join relays member:joined to the leader', async () => {
  const leader = connect();
  await once(leader, 'connect');

  const created = await emitAck(leader, 'convoy:create', {
    leader: LEADER,
    destination: { lat: 18.52, lng: 73.85, name: 'Pune' },
    privacy: 'invite_only'
  });
  assert.equal(created.ok, true);
  assert.match(created.code, /^CVY-[A-Z0-9]{6}$/);

  const follower = connect();
  await once(follower, 'connect');

  const joinedEventP = once(leader, 'member:joined');
  const joined = await emitAck(follower, 'convoy:join', { code: created.code, member: FOLLOWER });
  assert.equal(joined.ok, true);

  const relay = await joinedEventP;
  assert.equal(relay.member.id, FOLLOWER.id);
  assert.equal(relay.member.firstName, 'Rahul');
});

/* ── position:update relays member:position ─────────── */
test('position:update relays member:position to peers', async () => {
  const leader = connect();
  await once(leader, 'connect');
  const created = await emitAck(leader, 'convoy:create', { leader: LEADER });
  assert.equal(created.ok, true);

  const follower = connect();
  await once(follower, 'connect');
  await emitAck(follower, 'convoy:join', { code: created.code, member: FOLLOWER });

  const posP = once(leader, 'member:position');
  follower.emit('position:update', { lat: 18.6, lng: 73.9, heading: 90, speed: 22, battery: 77, status: 'following' });

  const pos = await posP;
  assert.equal(pos.memberId, FOLLOWER.id);
  assert.equal(pos.lat, 18.6);
  assert.equal(pos.lng, 73.9);
  assert.equal(pos.speed, 22);
});

/* ── leader-only guard rejects non-leader convoy:end ── */
test('non-leader convoy:end is rejected', async () => {
  const leader = connect();
  await once(leader, 'connect');
  const created = await emitAck(leader, 'convoy:create', { leader: LEADER });

  const follower = connect();
  await once(follower, 'connect');
  await emitAck(follower, 'convoy:join', { code: created.code, member: FOLLOWER });

  const res = await emitAck(follower, 'convoy:end', {});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not_leader');
});

/* ── leader disconnect auto-promotes earliest member ── */
test('leader disconnect auto-promotes the earliest connected member', async () => {
  const leader = connect();
  await once(leader, 'connect');
  const created = await emitAck(leader, 'convoy:create', { leader: LEADER });

  const follower = connect();
  await once(follower, 'connect');
  await emitAck(follower, 'convoy:join', { code: created.code, member: FOLLOWER });

  const promotedP = once(follower, 'member:promoted');
  leader.disconnect();

  const promoted = await promotedP;
  assert.equal(promoted.memberId, FOLLOWER.id);
});
