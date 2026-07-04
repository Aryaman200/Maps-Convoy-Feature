/* ============================================================
   CONVOY MODE — GEOLOCATION ADAPTER
   ============================================================
   Bridges the device's real GPS (navigator.geolocation) into the
   convoy engine so a physical device can act as a live member.
   Watches position, derives heading + speed from consecutive fixes
   when the browser doesn't supply them, and degrades gracefully to
   the simulated leader when GPS is unavailable or denied.

   Never throws — all failures surface through onError and, when
   present, the ConvoyEngine bus event 'geo:unavailable'.
   ============================================================ */

const ConvoyGeo = (() => {
  const EARTH_RADIUS_M = 6371000;

  /* ── Watch State ───────────────────────────────────── */
  let watchId = null;
  let lastFix = null;          /* last emitted fix { lat, lng, heading, speed, accuracy } */
  let prevRaw = null;          /* previous raw sample { lat, lng, ts } for derivation */
  let lastHeading = null;      /* carried heading when we can't derive a fresh one */

  const WATCH_OPTIONS = {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 8000
  };

  /* Minimum movement (meters) before we trust a derived heading.
     GPS jitter below this produces meaningless bearings. */
  const MIN_MOVE_FOR_HEADING = 2;

  /* ── Local Geo Math ────────────────────────────────── */
  /* Prefer shared ConvoyUtils when it's loaded, otherwise fall back
     to the local implementations so this module has no hard deps. */
  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }

  function localHaversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function localBearing(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function haversineDistance(lat1, lon1, lat2, lon2) {
    if (window.ConvoyUtils && typeof window.ConvoyUtils.haversineDistance === 'function') {
      return window.ConvoyUtils.haversineDistance(lat1, lon1, lat2, lon2);
    }
    return localHaversine(lat1, lon1, lat2, lon2);
  }

  function bearing(lat1, lon1, lat2, lon2) {
    if (window.ConvoyUtils && typeof window.ConvoyUtils.bearing === 'function') {
      return window.ConvoyUtils.bearing(lat1, lon1, lat2, lon2);
    }
    return localBearing(lat1, lon1, lat2, lon2);
  }

  /* ── Failure Reporting ─────────────────────────────── */
  function emitUnavailable(reason) {
    /* Fire the engine bus event when the engine (and its bus) exist,
       without creating a hard dependency on load order. */
    try {
      if (typeof ConvoyEngine !== 'undefined' &&
          ConvoyEngine.bus &&
          typeof ConvoyEngine.bus.emit === 'function') {
        ConvoyEngine.bus.emit('geo:unavailable', reason);
      }
    } catch (e) { /* never let reporting throw */ }
  }

  function fail(onError, reason) {
    if (typeof onError === 'function') {
      try { onError(reason); } catch (e) { /* swallow user errors */ }
    }
    emitUnavailable(reason);
  }

  /* ── Support / Permissions ─────────────────────────── */
  function isSupported() {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  /**
   * Resolve the current geolocation permission using the Permissions
   * API when available. Resolves to 'granted' | 'denied' | 'prompt' |
   * 'unknown' and never rejects.
   */
  function getPermissionState() {
    return new Promise((resolve) => {
      try {
        if (typeof navigator !== 'undefined' &&
            navigator.permissions &&
            typeof navigator.permissions.query === 'function') {
          navigator.permissions.query({ name: 'geolocation' })
            .then((status) => resolve(status && status.state ? status.state : 'unknown'))
            .catch(() => resolve('unknown'));
        } else {
          resolve('unknown');
        }
      } catch (e) {
        resolve('unknown');
      }
    });
  }

  /* ── Fix Derivation ────────────────────────────────── */
  /* Build the normalized fix, filling in heading and speed from the
     API when present, or deriving them from the previous sample. */
  function buildFix(coords, ts) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const accuracy = (coords.accuracy != null) ? coords.accuracy : null;

    let heading = (coords.heading != null && !Number.isNaN(coords.heading))
      ? coords.heading
      : null;
    let speed = (coords.speed != null && !Number.isNaN(coords.speed) && coords.speed >= 0)
      ? coords.speed
      : null;

    if (prevRaw) {
      const dtSec = (ts - prevRaw.ts) / 1000;
      const dist = haversineDistance(prevRaw.lat, prevRaw.lng, lat, lng);

      /* Derive heading from the bearing between fixes, but only if
         we've actually moved enough for it to be meaningful. */
      if (heading == null && dist >= MIN_MOVE_FOR_HEADING) {
        heading = bearing(prevRaw.lat, prevRaw.lng, lat, lng);
      }

      /* Derive speed from distance over time (m/s). */
      if (speed == null && dtSec > 0) {
        speed = dist / dtSec;
      }
    }

    /* Carry the last known heading when standing still / early fixes,
       so consumers always get a usable orientation. */
    if (heading == null && lastHeading != null) {
      heading = lastHeading;
    }
    if (heading != null) {
      lastHeading = heading;
    }

    if (speed == null) speed = 0;

    prevRaw = { lat, lng, ts };
    return { lat, lng, heading, speed, accuracy };
  }

  /* ── Start / Stop ──────────────────────────────────── */
  /**
   * Begin watching the device position. Calls onUpdate(fix) on each
   * successful fix and onError(reason) on failure. Safe to call even
   * when geolocation is unsupported (fails softly).
   */
  function start(onUpdate, onError) {
    if (!isSupported()) {
      fail(onError, 'unsupported');
      return false;
    }

    /* Reset derivation state for a clean session. */
    if (watchId !== null) stop();
    prevRaw = null;
    lastHeading = null;

    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          try {
            const ts = (position.timestamp != null) ? position.timestamp : Date.now();
            const fix = buildFix(position.coords, ts);
            lastFix = fix;
            if (typeof onUpdate === 'function') onUpdate(fix);
          } catch (e) {
            /* A bad fix shouldn't tear down the whole watch. */
            fail(onError, 'fix-error');
          }
        },
        (error) => {
          fail(onError, mapGeoError(error));
        },
        WATCH_OPTIONS
      );
    } catch (e) {
      watchId = null;
      fail(onError, 'watch-failed');
      return false;
    }

    return true;
  }

  function stop() {
    if (watchId !== null && isSupported()) {
      try { navigator.geolocation.clearWatch(watchId); }
      catch (e) { /* ignore */ }
    }
    watchId = null;
  }

  /* Map a PositionError into a stable, human-friendly reason string. */
  function mapGeoError(error) {
    if (!error) return 'unknown';
    switch (error.code) {
      case 1: return 'denied';        /* PERMISSION_DENIED */
      case 2: return 'unavailable';   /* POSITION_UNAVAILABLE */
      case 3: return 'timeout';       /* TIMEOUT */
      default: return 'unknown';
    }
  }

  /* ── Accessors ─────────────────────────────────────── */
  function getLast() { return lastFix; }
  function isWatching() { return watchId !== null; }

  /* ── Public API ────────────────────────────────────── */
  return {
    start,
    stop,
    isSupported,
    getPermissionState,
    getLast,
    isWatching
  };
})();

/* Expose as a global for the vanilla (no-bundler) app. */
window.ConvoyGeo = ConvoyGeo;
