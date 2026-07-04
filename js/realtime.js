/* ============================================================
   CONVOY MODE — REAL-TIME CLIENT
   ============================================================
   Thin wrapper around the Socket.io v4 client that speaks the
   Convoy wire protocol. Bridges every server→client event onto
   the existing ConvoyEngine.bus as 'realtime:<event>'.

   Degrades gracefully: if window.io is missing or the server
   can't be reached within ~4s, the module goes into a disabled
   state where every method is a safe no-op and the app can fall
   back to offline Demo mode.
   ============================================================ */

const ConvoyRealtime = (() => {
  /* ── Configuration ─────────────────────────────────── */
  const CONNECT_TIMEOUT_MS = 4000;   /* server must answer within this window */
  const POSITION_THROTTLE_MS = 500;  /* ~2 Hz position publish cap */
  const DEFAULT_PORT = 3001;

  /* ── Internal State ────────────────────────────────── */
  let socket = null;
  let available = false;   /* true once we know a live socket exists */
  let disabled = false;    /* true once we've given up (unavailable) */
  let connectTimer = null;
  let lastPositionSent = 0;
  let pendingPosition = null;
  let positionFlushTimer = null;

  /* ── Bus Bridge ────────────────────────────────────── */
  /* Safely reach the shared event bus. It should exist globally, but
     never throw if the load order is off. */
  function bus() {
    return (typeof ConvoyEngine !== 'undefined' && ConvoyEngine.bus) ? ConvoyEngine.bus : null;
  }

  function emitBus(event, payload) {
    const b = bus();
    if (b) b.emit(event, payload);
  }

  /* ── Server URL ────────────────────────────────────── */
  function getServerUrl() {
    return `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`;
  }

  /* ── Disabled / Unavailable State ──────────────────── */
  /* Flip the module into the permanently-offline state. Idempotent. */
  function goUnavailable() {
    if (disabled) return;
    disabled = true;
    available = false;
    clearConnectTimer();
    emitBus('realtime:unavailable');
  }

  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  /* ── Connect ───────────────────────────────────────── */
  /* Resolves with { ok, available }. Never rejects — callers can
     always await it and then decide whether to run online or offline. */
  function connect(serverUrl) {
    const url = serverUrl || getServerUrl();

    return new Promise((resolve) => {
      /* No Socket.io client on the page → go straight to offline. */
      if (typeof window === 'undefined' || typeof window.io === 'undefined') {
        goUnavailable();
        resolve({ ok: false, available: false });
        return;
      }

      /* Reuse an existing live connection. */
      if (socket && socket.connected) {
        available = true;
        disabled = false;
        resolve({ ok: true, available: true });
        return;
      }

      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearConnectTimer();
        resolve(result);
      };

      try {
        socket = window.io(url, {
          transports: ['websocket', 'polling'],
          timeout: CONNECT_TIMEOUT_MS,
          reconnection: true
        });
      } catch (err) {
        goUnavailable();
        settle({ ok: false, available: false });
        return;
      }

      /* Hard deadline: if nothing connects in ~4s, fall back offline. */
      connectTimer = setTimeout(() => {
        if (!available) {
          try { if (socket) socket.close(); } catch (e) { /* ignore */ }
          goUnavailable();
          settle({ ok: false, available: false });
        }
      }, CONNECT_TIMEOUT_MS);

      wireLifecycle(settle);
      wireServerEvents();
    });
  }

  /* ── Connection Lifecycle Wiring ───────────────────── */
  function wireLifecycle(settle) {
    socket.on('connect', () => {
      available = true;
      disabled = false;
      clearConnectTimer();
      emitBus('realtime:connected', { id: socket.id });
      if (settle) settle({ ok: true, available: true });
    });

    socket.on('disconnect', (reason) => {
      available = false;
      emitBus('realtime:disconnected', { reason });
    });

    /* First-attempt connection failure — let the deadline decide the
       final verdict, but if reconnection is exhausted, go offline. */
    socket.on('connect_error', () => {
      if (!available && settle) {
        /* Keep waiting until the deadline; Socket.io may still recover
           via polling. Nothing to do here beyond noting the attempt. */
      }
    });

    socket.on('reconnect_failed', () => {
      if (!available) goUnavailable();
    });
  }

  /* ── Server → Bus Event Bridge ─────────────────────── */
  /* Every server→client message is mirrored 1:1 onto the bus under a
     'realtime:' namespace so app modules can subscribe without knowing
     anything about Socket.io. */
  const SERVER_EVENTS = [
    'convoy:state',
    'member:joined',
    'member:left',
    'member:position',
    'member:promoted',
    'convoy:started',
    'convoy:paused',
    'convoy:resumed',
    'convoy:ended',
    'hazard:reported',
    'route:updated',
    'eta:updated',
    'chat:message',
    'error'
  ];

  function wireServerEvents() {
    SERVER_EVENTS.forEach((evt) => {
      socket.on(evt, (payload) => {
        emitBus(`realtime:${evt}`, payload);
      });
    });
  }

  /* ── Emit Helpers ──────────────────────────────────── */
  /* Fire-and-forget emit; returns false when offline. */
  function safeEmit(event, payload) {
    if (disabled || !socket || !socket.connected) return false;
    try {
      socket.emit(event, payload);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Emit that expects an ack; resolves to the ack payload, or to a
     synthetic failure ack when offline / on timeout so callers never hang. */
  function emitWithAck(event, payload, ackTimeoutMs = 5000) {
    return new Promise((resolve) => {
      if (disabled || !socket || !socket.connected) {
        resolve({ ok: false, error: 'offline' });
        return;
      }

      let done = false;
      const finish = (ack) => {
        if (done) return;
        done = true;
        resolve(ack || { ok: false, error: 'no_ack' });
      };

      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), ackTimeoutMs);

      try {
        socket.emit(event, payload, (ack) => {
          clearTimeout(timer);
          finish(ack);
        });
      } catch (e) {
        clearTimeout(timer);
        finish({ ok: false, error: 'emit_failed' });
      }
    });
  }

  /* ── Protocol Methods: Client → Server ─────────────── */

  /* createConvoy(opts) → Promise(ack)
     opts: { leader:{id,name,firstName,initials,color,vehicle},
             destination:{lat,lng,name}, privacy } */
  function createConvoy(opts) {
    return emitWithAck('convoy:create', opts || {});
  }

  /* joinConvoy(code, member) → Promise(ack)
     member: {id,name,firstName,initials,color,vehicle} */
  function joinConvoy(code, member) {
    return emitWithAck('convoy:join', { code, member });
  }

  /* leaveConvoy() — no ack needed */
  function leaveConvoy() {
    return safeEmit('convoy:leave', {});
  }

  /* publishPosition(pos) — throttled to ~2 Hz internally.
     pos: { lat, lng, heading, speed, battery, status } */
  function publishPosition(pos) {
    if (disabled || !socket || !socket.connected) return false;
    if (!pos) return false;

    const now = Date.now();
    const elapsed = now - lastPositionSent;

    if (elapsed >= POSITION_THROTTLE_MS) {
      /* Enough time has passed — send immediately. */
      lastPositionSent = now;
      pendingPosition = null;
      if (positionFlushTimer) {
        clearTimeout(positionFlushTimer);
        positionFlushTimer = null;
      }
      return safeEmit('position:update', pos);
    }

    /* Too soon — remember the newest position and schedule a trailing
       flush so the final position in a burst is never dropped. */
    pendingPosition = pos;
    if (!positionFlushTimer) {
      positionFlushTimer = setTimeout(() => {
        positionFlushTimer = null;
        const p = pendingPosition;
        pendingPosition = null;
        if (p) {
          lastPositionSent = Date.now();
          safeEmit('position:update', p);
        }
      }, POSITION_THROTTLE_MS - elapsed);
    }
    return true;
  }

  /* start(route) — leader only. route?:{coordinates,distance,steps} */
  function start(route) {
    return safeEmit('convoy:start', route ? { route } : {});
  }

  /* pause() — leader only */
  function pause() {
    return safeEmit('convoy:pause', {});
  }

  /* resume() — leader only */
  function resume() {
    return safeEmit('convoy:resume', {});
  }

  /* end() — leader only */
  function end() {
    return safeEmit('convoy:end', {});
  }

  /* promote(memberId) — leader only */
  function promote(memberId) {
    return safeEmit('member:promote', { memberId });
  }

  /* reportHazard(type, lat, lng) */
  function reportHazard(type, lat, lng) {
    return safeEmit('hazard:report', { type, lat, lng });
  }

  /* updateRoute(coordinates, reason) — leader only.
     coordinates: [[lat,lng]...] */
  function updateRoute(coordinates, reason) {
    return safeEmit('route:update', { coordinates, reason });
  }

  /* updateEta(etaSeconds, distanceMeters) — leader only */
  function updateEta(etaSeconds, distanceMeters) {
    return safeEmit('eta:update', { etaSeconds, distanceMeters });
  }

  /* sendChat(text) */
  function sendChat(text) {
    return safeEmit('chat:message', { text });
  }

  /* ── Introspection ─────────────────────────────────── */
  function isConnected() {
    return !!(socket && socket.connected);
  }

  function isAvailable() {
    return available && !disabled;
  }

  function getSocketId() {
    return socket ? (socket.id || null) : null;
  }

  /* ── Teardown ──────────────────────────────────────── */
  /* Cleanly drop the connection (e.g. leaving the app). Not part of the
     required surface but handy and safe to call any time. */
  function disconnect() {
    clearConnectTimer();
    if (positionFlushTimer) {
      clearTimeout(positionFlushTimer);
      positionFlushTimer = null;
    }
    pendingPosition = null;
    if (socket) {
      try { socket.close(); } catch (e) { /* ignore */ }
    }
    available = false;
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    connect,
    createConvoy, joinConvoy, leaveConvoy,
    publishPosition,
    start, pause, resume, end,
    promote, reportHazard,
    updateRoute, updateEta, sendChat,
    isConnected, isAvailable, getSocketId, getServerUrl,
    disconnect
  };
})();
