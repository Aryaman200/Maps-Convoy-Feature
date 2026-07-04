/* ============================================================
   CONVOY MODE — NAVIGATION SYSTEM
   ============================================================
   Distance-parameterized navigation. The leader and every
   follower are points at different distances along ONE
   road-snapped polyline (ConvoyRoute), so everyone stays glued
   to real roads. Followers hold an elastic single-file formation
   behind the leader.

   Responsibilities: route acquisition (live OSRM → embedded
   fallback), 10 Hz movement sim, turn-by-turn, predictive
   projection, dynamic hazard re-routing, and arrival.
   ============================================================ */

const ConvoyNavigation = (() => {
  const bus = ConvoyEngine.bus;

  /* ── Route ─────────────────────────────────────────── */
  let route = makeConvoyRoute();

  /* ── Leader Sim State ──────────────────────────────── */
  let leaderDist = 0;             /* meters along route */
  let leaderSpeed = 16.67;        /* m/s (~60 km/h) */
  let leaderHeading = 0;
  let leaderPosition = null;
  let arrived = false;

  /* ── Simulation Loop ───────────────────────────────── */
  let simulationRunning = false;
  let simInterval = null;
  let lastUpdateTime = 0;
  const TICK_MS = 100;            /* 10 Hz */

  /* ── Follower Sim State ────────────────────────────── */
  /* sim[memberId] = { slot, dist, targetGap, speed, lateral, laneOffset, seedPhase } */
  let sim = {};
  const BASE_GAP = 42;            /* meters between consecutive cars */
  const GAP_JITTER = 14;          /* per-car spacing variance */
  const CATCH_TAU = 2.6;          /* seconds — formation easing time constant */
  const OFF_ROUTE_LATERAL = 85;   /* meters off the centerline when off-route */

  /* Speed model (m/s) */
  const CRUISE = 16.67;           /* ~60 km/h */
  const CORNER_SLOWDOWN_DIST = 180; /* start easing off this far from a turn */

  const DEMO_ROUTE = {
    start: ConvoyRouteData.START,
    end: ConvoyRouteData.END,
  };

  /* ── Route Acquisition ─────────────────────────────── */
  /** Live OSRM point-to-point fetch with a hard timeout. */
  async function fetchRoute(start, end) {
    const live = await fetchRouteVia([start, end]);
    if (live && live.coordinates.length > 1) {
      route.build(live.coordinates, live.steps);
      bus.emit('route:fetched', { source: 'osrm', distance: route.total() });
      return { coordinates: route.getCoordinates(), distance: route.total(), steps: live.steps };
    }
    return useEmbeddedRoute();
  }

  /** Fetch a route through N waypoints. Returns null on any failure. */
  async function fetchRouteVia(points) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const coordStr = points.map(p => `${p.lng},${p.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (data.code === 'Ok' && data.routes.length > 0) {
        const r = data.routes[0];
        return {
          coordinates: r.geometry.coordinates.map(c => [c[1], c[0]]),
          distance: r.distance,
          duration: r.duration,
          steps: (r.legs || []).flatMap(leg => (leg.steps || []).map(step => ({
            instruction: step.maneuver.type,
            modifier: step.maneuver.modifier || '',
            name: step.name || 'the road',
            distance: step.distance,
            duration: step.duration,
          }))),
        };
      }
    } catch (e) {
      console.warn('OSRM fetch failed:', e.name === 'AbortError' ? 'timed out' : e);
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  /** Guaranteed road-snapped fallback (embedded Mumbai→Pune). */
  function useEmbeddedRoute() {
    route.build(ConvoyRouteData.COORDINATES, ConvoyRouteData.STEPS);
    bus.emit('route:fetched', { source: 'embedded', distance: route.total() });
    return { coordinates: route.getCoordinates(), distance: route.total(), steps: ConvoyRouteData.STEPS };
  }
  /* Back-compat alias */
  const useGeneratedRoute = useEmbeddedRoute;

  /* ── Initialize Navigation ─────────────────────────── */
  async function initNavigation() {
    const result = await fetchRoute(DEMO_ROUTE.start, DEMO_ROUTE.end);

    leaderDist = 0;
    arrived = false;
    leaderSpeed = CRUISE;
    const p0 = route.positionAt(0);
    leaderPosition = { lat: p0.lat, lng: p0.lng };
    leaderHeading = p0.heading;

    /* Assign each follower a formation slot + individual driving character */
    sim = {};
    let slot = 0;
    ConvoyEngine.getMembers().forEach(member => {
      if (member.isLeader) return;
      slot += 1;
      const spacing = BASE_GAP + (Math.random() - 0.5) * 2 * GAP_JITTER;
      sim[member.id] = {
        slot,
        dist: Math.max(0, -slot * spacing),  /* start slightly behind the line */
        targetGap: slot * spacing,
        speed: 0,
        lastDist: 0,
        lateral: 0,
        laneOffset: (slot % 2 === 0 ? 1 : -1) * (3 + Math.random() * 2), /* stagger L/R */
        seedPhase: Math.random() * Math.PI * 2,
      };
    });

    return result;
  }

  /* ── Simulation Control ────────────────────────────── */
  function startSimulation() {
    if (simulationRunning) return;
    simulationRunning = true;
    lastUpdateTime = performance.now();
    simInterval = setInterval(tick, TICK_MS);
  }

  function stopSimulation() {
    simulationRunning = false;
    if (simInterval) { clearInterval(simInterval); simInterval = null; }
  }

  function tick() {
    if (!simulationRunning) return;
    const now = performance.now();
    let dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;
    /* Guard against tab-throttling producing huge dt jumps */
    dt = ConvoyUtils.clamp(dt, 0, 0.5);

    updateLeader(dt);
    updateFollowers(dt);
    ConvoyEngine.checkRegroup();
    renderRouteProgress();

    bus.emit('simulation:tick', { dt, leaderPosition, leaderSpeed, leaderHeading });
  }

  /* ── Leader Movement ───────────────────────────────── */
  function updateLeader(dt) {
    if (route.total() === 0) return;

    /* Target speed: cruise with gentle variation, easing off before turns */
    const step = route.stepAt(leaderDist);
    let target = CRUISE + Math.sin((Date.now() / 6000) + 1) * 2.2;
    if (step && step.distanceToNext < CORNER_SLOWDOWN_DIST) {
      const sharp = /left|right/.test(step.upcoming.modifier || '');
      const floor = sharp ? 0.45 : 0.75;
      const k = ConvoyUtils.clamp(step.distanceToNext / CORNER_SLOWDOWN_DIST, floor, 1);
      target *= k;
    }
    /* Smooth acceleration toward target */
    leaderSpeed += (target - leaderSpeed) * Math.min(1, dt / 1.2);

    leaderDist += leaderSpeed * dt;

    if (leaderDist >= route.total() - 1) {
      leaderDist = route.total();
      handleArrival();
    }

    const p = route.positionAt(leaderDist);
    leaderPosition = { lat: p.lat, lng: p.lng };
    leaderHeading = p.heading;

    ConvoyEngine.updateMemberPosition('leader', leaderPosition, leaderSpeed, leaderHeading);
    ConvoyMap.updateLeaderPosition(leaderPosition.lat, leaderPosition.lng, leaderHeading);
  }

  /* ── Follower Movement (elastic single-file formation) ── */
  function updateFollowers(dt) {
    if (route.total() === 0) return;
    const members = ConvoyEngine.getMembers();

    members.forEach(member => {
      if (member.isLeader) return;
      const s = sim[member.id];
      if (!s) return;

      const offRoute = member.status === ConvoyEngine.MEMBER_STATUS.OFF_ROUTE;
      const rejoining = member.status === ConvoyEngine.MEMBER_STATUS.REJOINING;
      const stopped = member.status === ConvoyEngine.MEMBER_STATUS.STOPPED;

      /* Breathing gap so the convoy feels alive, not rigid */
      const breathe = Math.sin(Date.now() / 3500 + s.seedPhase) * 6;
      const desiredGap = s.targetGap + breathe;
      const desiredDist = leaderDist - desiredGap;

      /* Ease toward the slot position (critically-damped-ish) */
      const ease = 1 - Math.exp(-dt / CATCH_TAU);

      if (stopped) {
        /* Frozen in place — leader pulls away */
      } else if (offRoute) {
        /* Keep rolling forward slowly but drift off the carriageway */
        s.dist += leaderSpeed * 0.55 * dt;
        s.lateral += (OFF_ROUTE_LATERAL - s.lateral) * (1 - Math.exp(-dt / 2.2));
      } else {
        /* Ease back into the formation slot; rejoiners settle laterally slower */
        s.dist += (desiredDist - s.dist) * ease;
        s.lateral += (s.laneOffset - s.lateral) * (1 - Math.exp(-dt / (rejoining ? 3.5 : 2.0)));
      }
      s.dist = ConvoyUtils.clamp(s.dist, 0, route.total());

      /* Measured speed (EMA) for the dashboard */
      const inst = dt > 0 ? Math.max(0, (s.dist - s.lastDist) / dt) : 0;
      s.speed = s.speed * 0.8 + inst * 0.2;
      s.lastDist = s.dist;

      /* Position: point on route at this distance, nudged laterally */
      const bp = route.positionAt(s.dist);
      const base = route.lateralOffset(s.dist, s.lateral) || bp;
      const followerPos = { lat: base.lat, lng: base.lng };
      const fHeading = bp ? bp.heading : leaderHeading;

      ConvoyEngine.updateMemberPosition(member.id, followerPos, s.speed, fHeading);
      /* Accurate along-route gap (haversine underestimates on curves) */
      member.distanceBehind = Math.max(0, leaderDist - s.dist);
      ConvoyMap.updateFollowerPosition(member.id, followerPos.lat, followerPos.lng, member);
    });
  }

  /* Report the true along-route gap so dashboards/regroup are accurate */
  function gapBehindLeader(memberId) {
    const s = sim[memberId];
    if (!s) return 0;
    return Math.max(0, leaderDist - s.dist);
  }

  /* ── Route Progress Rendering (throttled) ──────────── */
  let lastProgressRender = 0;
  function renderRouteProgress() {
    const now = performance.now();
    if (now - lastProgressRender < 400) return;
    lastProgressRender = now;
    ConvoyMap.setRouteProgress(route.sliceTo(leaderDist), route.sliceFrom(leaderDist));
  }

  /* ── Arrival ───────────────────────────────────────── */
  function handleArrival() {
    if (arrived) return;
    arrived = true;
    leaderSpeed = 0;
    ConvoyEngine.addActivity('navigation_started', '<strong>Convoy arrived</strong> at the destination', '#34a853');
    bus.emit('navigation:arrived', ConvoyEngine.getStats());
  }

  /* ── Predictive Projection ─────────────────────────── */
  function getPredictedLeaderPosition(secondsAhead = 15) {
    if (route.total() === 0) return leaderPosition;
    return route.positionAt(leaderDist + Math.max(0, leaderSpeed) * secondsAhead);
  }

  /* ── Turn-by-Turn ──────────────────────────────────── */
  function getCurrentInstruction() {
    if (route.total() === 0) return null;
    const s = route.stepAt(leaderDist);
    if (!s) return null;

    const m = s.upcoming;
    const modifier = m.modifier || '';
    const turnIcons = {
      'depart': 'navigation',
      'turn': modifier.includes('left') ? 'turn_left' : modifier.includes('right') ? 'turn_right' : 'straight',
      'continue': 'straight',
      'new name': 'straight',
      'arrive': 'flag',
      'merge': modifier.includes('left') ? 'merge' : 'merge',
      'on ramp': 'ramp_right',
      'off ramp': 'ramp_left',
      'fork': modifier.includes('left') ? 'fork_left' : 'fork_right',
      'end of road': modifier.includes('left') ? 'turn_left' : 'turn_right',
      'roundabout': 'roundabout_right',
    };
    const turnLabels = {
      'depart': 'Head onto',
      'turn': modifier.includes('left') ? 'Turn left onto' : modifier.includes('right') ? 'Turn right onto' : 'Continue onto',
      'continue': 'Continue on',
      'new name': 'Continue onto',
      'arrive': 'Arrive at',
      'merge': 'Merge onto',
      'on ramp': 'Take the ramp onto',
      'off ramp': 'Take the exit onto',
      'fork': modifier.includes('left') ? 'Keep left onto' : 'Keep right onto',
      'end of road': modifier.includes('left') ? 'Turn left onto' : 'Turn right onto',
      'roundabout': 'At the roundabout, take',
    };

    return {
      icon: turnIcons[m.instruction] || 'straight',
      label: turnLabels[m.instruction] || 'Continue on',
      road: m.name,
      distance: s.distanceToNext,
      distanceFormatted: ConvoyUtils.formatDistance(s.distanceToNext),
      step: m,
    };
  }

  /* ── Navigation Stats ──────────────────────────────── */
  function getNavStats() {
    if (route.total() === 0) return { eta: '--', distance: '--', speed: '0', progress: 0 };
    const remaining = Math.max(0, route.total() - leaderDist);
    const remainingTime = leaderSpeed > 1 ? remaining / leaderSpeed : remaining / CRUISE;
    return {
      eta: arrived ? 'Arrived' : ConvoyUtils.formatETA(remainingTime),
      etaSeconds: remainingTime,
      distance: ConvoyUtils.formatDistance(remaining),
      distanceMeters: remaining,
      speed: ConvoyUtils.formatSpeed(leaderSpeed),
      speedMs: leaderSpeed,
      speedKmh: Math.round(leaderSpeed * 3.6),
      progress: leaderDist / route.total(),
      heading: leaderHeading,
      arrived,
    };
  }

  /* ── Dynamic Re-routing ────────────────────────────── */
  let rerouting = false;
  let lastRerouteAt = 0;
  const REROUTE_COOLDOWN = 30000;
  const HAZARD_ROUTE_THRESHOLD = 300;   /* hazard must sit within this of the road */

  async function maybeReroute(hazard) {
    if (!simulationRunning || rerouting || arrived) return;
    if (ConvoyEngine.getState() !== ConvoyEngine.STATES.ACTIVE) return;
    if (Date.now() - lastRerouteAt < REROUTE_COOLDOWN) return;
    if (!hazard.position || route.total() === 0 || !leaderPosition) return;

    /* Only reroute for a hazard that is on the road AND ahead of the leader */
    const hazardDist = route.nearestDistance(hazard.position);
    const p = route.positionAt(hazardDist);
    const lateralToRoad = ConvoyUtils.haversineDistance(hazard.position.lat, hazard.position.lng, p.lat, p.lng);
    if (lateralToRoad > HAZARD_ROUTE_THRESHOLD) return;
    if (hazardDist <= leaderDist + 250) return;   /* already passing it — too late to matter */

    rerouting = true;
    lastRerouteAt = Date.now();
    bus.emit('reroute:started', hazard);

    /* Detour waypoint: perpendicular offset away from the hazard */
    const approach = ConvoyUtils.bearing(leaderPosition.lat, leaderPosition.lng, hazard.position.lat, hazard.position.lng);
    const detourPoint = ConvoyUtils.destinationPoint(hazard.position.lat, hazard.position.lng, 1200, (approach + 90) % 360);
    const destPos = route.positionAt(route.total());

    const oldRemaining = route.total() - leaderDist;
    let detour = await fetchRouteVia([leaderPosition, detourPoint, { lat: destPos.lat, lng: destPos.lng }]);
    if (!detour || detour.coordinates.length < 2) {
      detour = geometricDetour(hazardDist);
    }

    applyDetour(detour, hazard, oldRemaining);
    rerouting = false;
  }

  /** Offline fallback: bend the remaining route around the hazard. */
  function geometricDetour(hazardDist) {
    const remaining = route.sliceFrom(leaderDist);          /* [[lat,lng]...] */
    const startDist = leaderDist;
    const coords = remaining.map(c => [c[0], c[1]]);
    const window = 2200;   /* meters of road affected */
    const maxOffset = 900;
    /* distance along `remaining` for each vertex ≈ cumulative */
    let acc = 0;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) acc += ConvoyUtils.haversineDistance(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      const distFromHazard = Math.abs((startDist + acc) - hazardDist);
      if (distFromHazard >= window) continue;
      const falloff = Math.cos((distFromHazard / window) * Math.PI / 2) ** 2;
      const nxt = coords[Math.min(i + 1, coords.length - 1)];
      const hdg = ConvoyUtils.bearing(coords[i][0], coords[i][1], nxt[0], nxt[1]);
      const off = ConvoyUtils.destinationPoint(coords[i][0], coords[i][1], maxOffset * falloff, (hdg + 90) % 360);
      coords[i] = [off.lat, off.lng];
    }
    const dist = ConvoyUtils.routeDistance(coords.map(c => ({ lat: c[0], lng: c[1] })));
    return { coordinates: coords, distance: dist, duration: dist / CRUISE, steps: null };
  }

  /** Splice a detour in at the leader's position, preserving the driven prefix. */
  function applyDetour(detour, hazard, oldRemaining) {
    const traveled = route.sliceTo(leaderDist);             /* keeps followers' distances valid */
    const combined = traveled.concat(detour.coordinates.slice(1));

    /* Rebuild steps: synthetic "continue" covering the driven part, then detour steps */
    let steps = null;
    if (detour.steps && detour.steps.length) {
      const drivenDist = leaderDist;
      steps = [
        { instruction: 'continue', modifier: 'straight', name: 'current route', distance: drivenDist, duration: drivenDist / CRUISE },
        ...detour.steps,
      ];
    }

    const prevLeaderDist = leaderDist;
    route.build(combined, steps);
    /* leaderDist unchanged: prefix geometry is identical up to the leader */
    leaderDist = Math.min(prevLeaderDist, route.total());

    const last = combined[combined.length - 1];
    ConvoyMap.drawRoute(combined);
    ConvoyMap.setDestination(last[0], last[1]);
    ConvoyMap.setRouteProgress(route.sliceTo(leaderDist), route.sliceFrom(leaderDist));

    const newRemaining = route.total() - leaderDist;
    const addedSeconds = Math.max(0, (newRemaining - oldRemaining) / CRUISE);
    ConvoyEngine.addActivity(
      'reroute',
      `<strong>Route updated</strong> to avoid ${hazard.typeInfo.label.toLowerCase()}` +
        (addedSeconds >= 60 ? ` (+${Math.round(addedSeconds / 60)} min)` : ''),
      '#34a853'
    );
    bus.emit('route:updated', { hazard, addedSeconds, distance: newRemaining });
  }

  bus.on('hazard:reported', maybeReroute);

  /* ── Accessors ─────────────────────────────────────── */
  function getLeaderPosition() { return leaderPosition; }
  function getRouteCoordinates() { return route.getCoordinates(); }
  function getRouteSteps() { return ConvoyRouteData.STEPS; }
  function isRunning() { return simulationRunning; }
  function isRerouting() { return rerouting; }
  function hasArrived() { return arrived; }
  function getProgress() { return route.total() ? leaderDist / route.total() : 0; }

  /* ── Public API ────────────────────────────────────── */
  return {
    initNavigation, startSimulation, stopSimulation,
    fetchRoute, fetchRouteVia, useGeneratedRoute, useEmbeddedRoute, maybeReroute,
    getPredictedLeaderPosition, getCurrentInstruction, getNavStats,
    getLeaderPosition, getRouteCoordinates, getRouteSteps,
    isRunning, isRerouting, hasArrived, getProgress, gapBehindLeader,
    DEMO_ROUTE,
  };
})();
