/* ============================================================
   CONVOY MODE — ROUTE MODEL
   ============================================================
   A route parameterized by distance-along-path (meters) rather
   than array index. This is how real turn-by-turn navigation
   works and it is what keeps every convoy member glued to the
   actual road: the leader and each follower are simply points at
   different distances along the same polyline.

   Public surface:
     build(coordinates, steps)     — ingest a route
     total()                       — total length (m)
     positionAt(distanceM)         — {lat, lng, heading, index, distance}
     nearestDistance({lat,lng})    — project a point onto the route → distance
     sliceFrom(distanceM)          — remaining polyline (for drawing)
     sliceTo(distanceM)            — traveled polyline (for dimming)
     stepAt(distanceM)             — { current, upcoming, distanceToNext }
     lateralOffset(distanceM, m)   — a point m meters to the side of the route
   ============================================================ */

function makeConvoyRoute() {
  let coords = [];      /* [[lat, lng], ...] */
  let cum = [];         /* cum[i] = meters from start to coords[i] */
  let totalDist = 0;
  let steps = [];       /* [{ instruction, modifier, name, distance, atDistance }] */

  const H = ConvoyUtils.haversineDistance;
  const B = ConvoyUtils.bearing;

  function build(coordinates, stepList) {
    coords = coordinates.map(c => [c[0], c[1]]);
    cum = new Array(coords.length);
    cum[0] = 0;
    for (let i = 1; i < coords.length; i++) {
      cum[i] = cum[i - 1] + H(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    }
    totalDist = cum[coords.length - 1] || 0;

    /* Attach cumulative "distance from start where this maneuver occurs".
       OSRM step distance is the length of the step, so maneuver i sits at
       the sum of all prior step distances. */
    steps = [];
    let acc = 0;
    (stepList || []).forEach(s => {
      steps.push({ ...s, atDistance: acc });
      acc += s.distance || 0;
    });
    /* Rescale step distances to match the actual polyline length so the last
       maneuver lands at the destination even after simplification. */
    if (acc > 0 && steps.length > 0) {
      const scale = totalDist / acc;
      steps.forEach(s => { s.atDistance *= scale; });
    }
    return totalDist;
  }

  /* Binary search: largest index with cum[index] <= d */
  function segmentIndex(d) {
    let lo = 0, hi = coords.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function positionAt(d) {
    if (coords.length === 0) return null;
    d = ConvoyUtils.clamp(d, 0, totalDist);
    const i = segmentIndex(d);
    const j = Math.min(i + 1, coords.length - 1);
    const segLen = cum[j] - cum[i];
    const t = segLen > 0 ? (d - cum[i]) / segLen : 0;
    const a = coords[i], b = coords[j];
    return {
      lat: a[0] + (b[0] - a[0]) * t,
      lng: a[1] + (b[1] - a[1]) * t,
      heading: B(a[0], a[1], b[0], b[1]),
      index: i,
      distance: d,
    };
  }

  /* Project an arbitrary point onto the polyline; returns distance-along.
     Coarse (per-vertex) nearest then refine on the two adjacent segments. */
  function nearestDistance(pos) {
    if (coords.length === 0) return 0;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const dd = H(pos.lat, pos.lng, coords[i][0], coords[i][1]);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    /* Refine using the closer of the two neighboring segments */
    let dist = cum[best];
    for (const [i0, i1] of [[best - 1, best], [best, best + 1]]) {
      if (i0 < 0 || i1 >= coords.length) continue;
      const proj = projectOnSegment(pos, coords[i0], coords[i1]);
      if (proj.dist < bestD) {
        bestD = proj.dist;
        dist = cum[i0] + (cum[i1] - cum[i0]) * proj.t;
      }
    }
    return dist;
  }

  /* Distance from pos to segment a-b, plus fractional position t along it */
  function projectOnSegment(pos, a, b) {
    const latRad = a[0] * Math.PI / 180;
    const mx = 111320 * Math.cos(latRad), my = 110540;
    const px = pos.lng * mx, py = pos.lat * my;
    const ax = a[1] * mx, ay = a[0] * my;
    const bx = b[1] * mx, by = b[0] * my;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = ConvoyUtils.clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return { dist: Math.hypot(px - cx, py - cy), t };
  }

  function sliceFrom(d) {
    if (coords.length === 0) return [];
    d = ConvoyUtils.clamp(d, 0, totalDist);
    const i = segmentIndex(d);
    const p = positionAt(d);
    const rest = coords.slice(i + 1);
    return [[p.lat, p.lng], ...rest];
  }

  function sliceTo(d) {
    if (coords.length === 0) return [];
    d = ConvoyUtils.clamp(d, 0, totalDist);
    const i = segmentIndex(d);
    const p = positionAt(d);
    return [...coords.slice(0, i + 1), [p.lat, p.lng]];
  }

  /* Which maneuver is coming up at distance d */
  function stepAt(d) {
    if (steps.length === 0) return null;
    let currentIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].atDistance <= d + 1) currentIdx = i; else break;
    }
    const upcomingIdx = Math.min(currentIdx + 1, steps.length - 1);
    const upcoming = steps[upcomingIdx];
    const distanceToNext = Math.max(0, upcoming.atDistance - d);
    return { current: steps[currentIdx], upcoming, distanceToNext, index: currentIdx };
  }

  /* A point offsetM meters perpendicular to the route at distance d
     (positive = right of travel direction) */
  function lateralOffset(d, offsetM) {
    const p = positionAt(d);
    if (!p) return null;
    if (!offsetM) return { lat: p.lat, lng: p.lng };
    const side = (p.heading + 90) % 360;
    return ConvoyUtils.destinationPoint(p.lat, p.lng, Math.abs(offsetM), offsetM < 0 ? (side + 180) % 360 : side);
  }

  function getCoordinates() { return coords; }

  return {
    build, total: () => totalDist,
    positionAt, nearestDistance, sliceFrom, sliceTo, stepAt, lateralOffset,
    getCoordinates,
  };
}
