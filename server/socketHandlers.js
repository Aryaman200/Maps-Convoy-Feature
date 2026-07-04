/* ============================================================
   CONVOY SERVER — SOCKET HANDLERS
   ============================================================
   Registers every Convoy wire-protocol event on each connection.
   Responsibilities:
     - validate all inbound payloads (never trust, never throw)
     - enforce leader-only guards
     - rate-limit position:update and chat:message
     - manage disconnect / auto-promotion / prune
   The store is authoritative; handlers only translate socket
   events ↔ store operations and broadcast to the room.
   ============================================================ */

import { CONVOY_STATE } from './ConvoyStore.js';
import {
  isValidCode,
  isFiniteCoord,
  clampString,
  clampNumber,
  sanitizeMember,
  sanitizeDestination,
  sanitizeCoordinates
} from './validate.js';

/* ── Tunables ──────────────────────────────────────── */
const PRUNE_GRACE_MS = 60_000;      /* delete empty convoys after 60s */
const POS_RATE_MAX = 5;             /* position:update — max per window */
const POS_RATE_WINDOW = 1_000;      /* 1 second window (~5/s) */
const CHAT_RATE_MAX = 3;            /* chat:message — max per window */
const CHAT_RATE_WINDOW = 1_000;     /* 1 second window (~3/s) */
const CHAT_MAX_LEN = 500;

/* ── Simple Sliding-Window Rate Limiter ────────────── */
function makeLimiter(max, windowMs) {
  let hits = [];
  return () => {
    const now = Date.now();
    hits = hits.filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

/* ── Wire Projection ───────────────────────────────── */
/** Project the internal convoy into the client-facing snapshot shape. */
function toWireConvoy(convoy) {
  return {
    code: convoy.code,
    state: convoy.state,
    privacy: convoy.privacy,
    destination: convoy.destination,
    route: convoy.route,
    eta: convoy.eta,
    hazards: convoy.hazards,
    startedAt: convoy.startedAt,
    members: convoy.members.map(toWireMember)
  };
}

function toWireMember(m) {
  return {
    id: m.id,
    name: m.name,
    firstName: m.firstName,
    initials: m.initials,
    color: m.color,
    vehicle: m.vehicle,
    isLeader: m.isLeader,
    status: m.status,
    battery: m.battery,
    lat: m.lat,
    lng: m.lng,
    heading: m.heading,
    speed: m.speed
  };
}

/* ── Registration ──────────────────────────────────── */
export function registerHandlers(io, store) {
  io.on('connection', (socket) => {
    /* Per-socket state kept in closures. */
    const posLimiter = makeLimiter(POS_RATE_MAX, POS_RATE_WINDOW);
    const chatLimiter = makeLimiter(CHAT_RATE_MAX, CHAT_RATE_WINDOW);

    /** Resolve the convoy+member this socket belongs to, or null. */
    function ctx() {
      return store.getBySocket(socket.id);
    }

    /** Reject an action with an error event (and optional ack). */
    function reject(message, ack) {
      const payload = { message };
      if (typeof ack === 'function') { ack({ ok: false, error: message }); }
      else { socket.emit('error', payload); }
    }

    /** Leader-only guard: returns the ctx if this socket is the leader. */
    function requireLeader(ack) {
      const c = ctx();
      if (!c || !c.member) { reject('not_in_convoy', ack); return null; }
      if (!c.member.isLeader) { reject('not_leader', ack); return null; }
      return c;
    }

    /* ── convoy:create ─────────────────────────────── */
    socket.on('convoy:create', (payload, ack) => {
      try {
        const data = payload || {};
        const member = sanitizeMember(data.leader);
        if (!member.ok) return typeof ack === 'function' && ack({ ok: false, error: 'invalid_leader' });

        const destination = sanitizeDestination(data.destination);
        const privacy = clampString(data.privacy, 20) || 'invite_only';

        const { code, convoy } = store.createConvoy({
          leader: member.value,
          destination,
          privacy,
          socketId: socket.id
        });

        socket.join(code);
        if (typeof ack === 'function') ack({ ok: true, code, convoy: toWireConvoy(convoy) });
        /* Snapshot to the creator (parity with join). */
        socket.emit('convoy:state', { convoy: toWireConvoy(convoy) });
      } catch {
        if (typeof ack === 'function') ack({ ok: false, error: 'server_error' });
      }
    });

    /* ── convoy:join ───────────────────────────────── */
    socket.on('convoy:join', (payload, ack) => {
      try {
        const data = payload || {};
        const code = clampString(data.code, 12).toUpperCase();
        if (!isValidCode(code)) return typeof ack === 'function' && ack({ ok: false, error: 'invalid_code' });

        const member = sanitizeMember(data.member);
        if (!member.ok) return typeof ack === 'function' && ack({ ok: false, error: 'invalid_member' });

        const result = store.joinConvoy({ code, member: member.value, socketId: socket.id });
        if (!result.ok) return typeof ack === 'function' && ack({ ok: false, error: result.error });

        socket.join(code);
        const wire = toWireConvoy(result.convoy);

        if (typeof ack === 'function') ack({ ok: true, convoy: wire });
        /* Full snapshot to the joiner. */
        socket.emit('convoy:state', { convoy: wire });
        /* Tell everyone else (skip on silent reconnect of same member). */
        if (!result.rejoined) {
          socket.to(code).emit('member:joined', { member: toWireMember(result.member) });
        } else {
          socket.to(code).emit('member:position', wirePosition(result.member));
        }
      } catch {
        if (typeof ack === 'function') ack({ ok: false, error: 'server_error' });
      }
    });

    /* ── convoy:leave ──────────────────────────────── */
    socket.on('convoy:leave', () => {
      const c = ctx();
      if (!c) return;
      const { code } = c.ref;
      const wasLeader = c.member && c.member.isLeader;

      store.removeMember(code, c.ref.memberId);
      store.sockets.delete(socket.id);
      socket.leave(code);
      io.to(code).emit('member:left', { memberId: c.ref.memberId });

      /* If the leader walked out, hand the crown to the next in line. */
      if (wasLeader) autoPromote(code);
      schedulePruneIfEmpty(code);
    });

    /* ── position:update ───────────────────────────── */
    socket.on('position:update', (payload) => {
      if (!posLimiter()) return;                       /* silently drop over-rate */
      const c = ctx();
      if (!c || !c.member) return;
      const data = payload || {};
      if (!isFiniteCoord(data.lat, data.lng)) return;  /* require a real point */

      const member = store.updatePosition(c.ref.code, c.ref.memberId, {
        lat: data.lat,
        lng: data.lng,
        heading: clampNumber(data.heading, 0, 360, c.member.heading || 0),
        speed: clampNumber(data.speed, 0, 120, 0),
        battery: clampNumber(data.battery, 0, 100, c.member.battery),
        status: clampString(data.status, 20) || c.member.status
      });
      if (!member) return;

      socket.to(c.ref.code).emit('member:position', wirePosition(member));
    });

    /* ── convoy:start (leader) ─────────────────────── */
    socket.on('convoy:start', (payload, ack) => {
      const c = requireLeader(ack);
      if (!c) return;
      const { code } = c.ref;

      let route = null;
      const raw = payload && payload.route;
      if (raw && typeof raw === 'object') {
        const coordinates = sanitizeCoordinates(raw.coordinates);
        route = {
          coordinates,
          distance: clampNumber(raw.distance, 0, 5_000_000, 0),
          steps: Array.isArray(raw.steps) ? raw.steps.slice(0, 500) : []
        };
        store.setRoute(code, route);
      }

      store.setState(code, CONVOY_STATE.ACTIVE);
      io.to(code).emit('convoy:started', route ? { route } : {});
      if (typeof ack === 'function') ack({ ok: true });
    });

    /* ── convoy:pause (leader) ─────────────────────── */
    socket.on('convoy:pause', (_payload, ack) => {
      const c = requireLeader(ack);
      if (!c) return;
      store.setState(c.ref.code, CONVOY_STATE.PAUSED);
      io.to(c.ref.code).emit('convoy:paused', {});
      if (typeof ack === 'function') ack({ ok: true });
    });

    /* ── convoy:resume (leader) ────────────────────── */
    socket.on('convoy:resume', (_payload, ack) => {
      const c = requireLeader(ack);
      if (!c) return;
      store.setState(c.ref.code, CONVOY_STATE.ACTIVE);
      io.to(c.ref.code).emit('convoy:resumed', {});
      if (typeof ack === 'function') ack({ ok: true });
    });

    /* ── convoy:end (leader) ───────────────────────── */
    socket.on('convoy:end', (_payload, ack) => {
      const c = requireLeader(ack);
      if (!c) return;
      const { code } = c.ref;
      const convoy = store.setState(code, CONVOY_STATE.ENDED);

      const stats = convoy ? {
        memberCount: convoy.members.length,
        durationMs: convoy.startedAt ? (convoy.endedAt - convoy.startedAt) : 0,
        hazardCount: convoy.hazards.length
      } : {};

      io.to(code).emit('convoy:ended', { stats });
      if (typeof ack === 'function') ack({ ok: true });

      /* An ended convoy is done — prune shortly after. */
      scheduleForcePrune(code);
    });

    /* ── member:promote (leader) ───────────────────── */
    socket.on('member:promote', (payload, ack) => {
      const c = requireLeader(ack);
      if (!c) return;
      const memberId = clampString(payload && payload.memberId, 64);
      if (!memberId) return reject('invalid_member', ack);

      const promoted = store.promoteLeader(c.ref.code, memberId);
      if (!promoted) return reject('member_not_found', ack);

      io.to(c.ref.code).emit('member:promoted', { memberId: promoted.id });
      io.to(c.ref.code).emit('convoy:state', { convoy: toWireConvoy(store.getConvoy(c.ref.code)) });
      if (typeof ack === 'function') ack({ ok: true });
    });

    /* ── hazard:report (any member) ────────────────── */
    socket.on('hazard:report', (payload) => {
      const c = ctx();
      if (!c || !c.member) return;
      const data = payload || {};
      if (!isFiniteCoord(data.lat, data.lng)) return;
      const type = clampString(data.type, 30);
      if (!type) return;

      const hazard = store.addHazard(c.ref.code, {
        type,
        lat: data.lat,
        lng: data.lng,
        reportedBy: c.member.firstName
      });
      if (hazard) io.to(c.ref.code).emit('hazard:reported', { hazard });
    });

    /* ── route:update (leader) ─────────────────────── */
    socket.on('route:update', (payload) => {
      const c = requireLeader();
      if (!c) return;
      const data = payload || {};
      const coordinates = sanitizeCoordinates(data.coordinates);
      if (coordinates.length === 0) return;
      const reason = clampString(data.reason, 80) || 'reroute';

      store.setRoute(c.ref.code, { ...(store.getConvoy(c.ref.code).route || {}), coordinates });
      io.to(c.ref.code).emit('route:updated', {
        coordinates,
        reason,
        by: c.member.firstName
      });
    });

    /* ── eta:update (leader) ───────────────────────── */
    socket.on('eta:update', (payload) => {
      const c = requireLeader();
      if (!c) return;
      const data = payload || {};
      const etaSeconds = clampNumber(data.etaSeconds, 0, 1_000_000, 0);
      const distanceMeters = clampNumber(data.distanceMeters, 0, 5_000_000, 0);
      store.setEta(c.ref.code, { etaSeconds, distanceMeters });
      io.to(c.ref.code).emit('eta:updated', { etaSeconds, distanceMeters });
    });

    /* ── chat:message (any member) ─────────────────── */
    socket.on('chat:message', (payload) => {
      if (!chatLimiter()) return;
      const c = ctx();
      if (!c || !c.member) return;
      const text = clampString(payload && payload.text, CHAT_MAX_LEN);
      if (!text) return;

      io.to(c.ref.code).emit('chat:message', {
        from: c.member.id,
        fromName: c.member.firstName,
        text,
        ts: Date.now()
      });
    });

    /* ── disconnect ────────────────────────────────── */
    socket.on('disconnect', () => {
      const info = store.removeMemberBySocket(socket.id);
      if (!info) return;
      const { code } = info.ref;

      /* Broadcast the member's new disconnected status. */
      if (info.member) {
        io.to(code).emit('member:position', wirePosition(info.member));
      }

      /* Leader dropped → auto-promote earliest connected member. */
      if (info.member && info.member.isLeader) autoPromote(code, info.member.id);

      schedulePruneIfEmpty(code);
    });

    /* ── Helpers bound to this connection's io/store ─ */
    function autoPromote(code, excludeId = null) {
      const next = store.earliestConnectedMember(code, excludeId);
      if (!next) return;
      store.promoteLeader(code, next.id);
      io.to(code).emit('member:promoted', { memberId: next.id });
      const convoy = store.getConvoy(code);
      if (convoy) io.to(code).emit('convoy:state', { convoy: toWireConvoy(convoy) });
    }

    function schedulePruneIfEmpty(code) {
      const convoy = store.getConvoy(code);
      if (!convoy) return;
      if (store.connectedCount(code) > 0) return;
      if (convoy.pruneTimer) return; /* already scheduled */
      convoy.pruneTimer = setTimeout(() => {
        store.pruneEmpty(code);
      }, PRUNE_GRACE_MS);
      /* Don't keep the process alive purely for a prune timer. */
      if (typeof convoy.pruneTimer.unref === 'function') convoy.pruneTimer.unref();
    }

    function scheduleForcePrune(code) {
      const convoy = store.getConvoy(code);
      if (!convoy || convoy.pruneTimer) return;
      convoy.pruneTimer = setTimeout(() => {
        store.deleteConvoy(code);
      }, PRUNE_GRACE_MS);
      if (typeof convoy.pruneTimer.unref === 'function') convoy.pruneTimer.unref();
    }
  });
}

/* ── Shared Projection Helper ──────────────────────── */
function wirePosition(member) {
  return {
    memberId: member.id,
    lat: member.lat,
    lng: member.lng,
    heading: member.heading,
    speed: member.speed,
    battery: member.battery,
    status: member.status,
    ts: member.lastUpdate
  };
}
