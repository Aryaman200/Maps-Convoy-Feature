/* ============================================================
   CONVOY MODE — UTILITIES
   ============================================================
   Helpers: math, geo, formatting, QR, simulation data.
   ============================================================ */

const ConvoyUtils = (() => {
  const EARTH_RADIUS_KM = 6371;
  const EARTH_RADIUS_M = 6371000;

  /* ── Geo Math ──────────────────────────────────────── */
  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }

  /** Haversine distance in meters */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Bearing from point 1 to point 2 in degrees */
  function bearing(lat1, lon1, lat2, lon2) {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /** Move a point by distance (meters) and bearing (degrees) */
  function destinationPoint(lat, lon, distanceM, bearingDeg) {
    const d = distanceM / EARTH_RADIUS_M;
    const brng = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lon1 = toRad(lon);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: toDeg(lat2), lng: toDeg(lon2) };
  }

  /** Interpolate between two lat/lng points */
  function interpolatePosition(p1, p2, t) {
    t = Math.max(0, Math.min(1, t));
    return {
      lat: p1.lat + (p2.lat - p1.lat) * t,
      lng: p1.lng + (p2.lng - p1.lng) * t
    };
  }

  /** Calculate total distance of a route (array of {lat, lng}) in meters */
  function routeDistance(points) {
    let dist = 0;
    for (let i = 1; i < points.length; i++) {
      dist += haversineDistance(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
    }
    return dist;
  }

  /** Find the closest point on a route to a given position */
  function closestPointOnRoute(route, pos) {
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < route.length; i++) {
      const d = haversineDistance(pos.lat, pos.lng, route[i].lat, route[i].lng);
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }
    return { index: closestIdx, distance: minDist, point: route[closestIdx] };
  }

  /** Add GPS jitter to simulate real GPS noise */
  function addGPSJitter(lat, lng, maxMeters = 5) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxMeters;
    return destinationPoint(lat, lng, dist, toDeg(angle));
  }

  /* ── Formatting ────────────────────────────────────── */
  function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h} hr ${m} min`;
  }

  function formatSpeed(metersPerSec) {
    const kmh = metersPerSec * 3.6;
    return `${Math.round(kmh)} km/h`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatETA(seconds) {
    const eta = new Date(Date.now() + seconds * 1000);
    return formatTime(eta);
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  /* ── Unique ID ─────────────────────────────────────── */
  function generateId(prefix = '') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return prefix ? `${prefix}-${id}` : id;
  }

  function generateConvoyCode() {
    return generateId('CVY');
  }

  /* ── QR Code ───────────────────────────────────────── */
  function generateQRCode(text, container, size = 200) {
    if (typeof QRCode !== 'undefined') {
      container.innerHTML = '';
      new QRCode(container, {
        text: text,
        width: size,
        height: size,
        colorDark: '#1f1f1f',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      /* Fallback: visual placeholder */
      container.innerHTML = `<div style="width:${size}px;height:${size}px;background:#f1f3f4;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#5f6368;">QR Code</div>`;
    }
  }

  /* ── Debounce / Throttle ───────────────────────────── */
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn(...args);
      }
    };
  }

  /* ── Event Bus ─────────────────────────────────────── */
  class EventBus {
    constructor() { this._listeners = {}; }
    on(event, fn) {
      (this._listeners[event] = this._listeners[event] || []).push(fn);
      return () => this.off(event, fn);
    }
    off(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
    emit(event, data) {
      (this._listeners[event] || []).forEach(fn => fn(data));
    }
  }

  /* ── Simulated Member Data ─────────────────────────── */
  const MEMBER_NAMES = [
    { first: 'Aryaman', last: 'S', color: '#4285f4' },
    { first: 'Rahul', last: 'K', color: '#ea4335' },
    { first: 'Priya', last: 'M', color: '#34a853' },
    { first: 'Ananya', last: 'R', color: '#fbbc04' },
    { first: 'Vikram', last: 'P', color: '#ff6d01' },
    { first: 'Sneha', last: 'D', color: '#46bdc6' },
    { first: 'Arjun', last: 'T', color: '#7b1fa2' },
    { first: 'Meera', last: 'V', color: '#e91e63' }
  ];

  const VEHICLE_TYPES = ['car', 'motorcycle', 'suv', 'van'];

  function getRandomMember(index) {
    const m = MEMBER_NAMES[index % MEMBER_NAMES.length];
    return {
      id: generateId('MBR'),
      name: `${m.first} ${m.last}`,
      firstName: m.first,
      initials: m.first[0] + m.last[0],
      color: m.color,
      vehicle: VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)],
      battery: 60 + Math.floor(Math.random() * 40),
      connectionQuality: 0.7 + Math.random() * 0.3,
    };
  }

  /* ── Road Names ────────────────────────────────────── */
  const ROAD_NAMES = [
    'Mumbai-Pune Expressway', 'NH 48', 'Katraj Tunnel',
    'Khandala Ghat', 'Lonavala Bypass', 'Khopoli Exit',
    'Panvel Toll Plaza', 'Sion-Panvel Expressway'
  ];

  function getRandomRoad() {
    return ROAD_NAMES[Math.floor(Math.random() * ROAD_NAMES.length)];
  }

  /* ── Hazard Types ──────────────────────────────────── */
  const HAZARD_TYPES = [
    { id: 'accident', label: 'Accident', icon: 'car_crash', color: '#ea4335' },
    { id: 'police', label: 'Police', icon: 'local_police', color: '#4285f4' },
    { id: 'closure', label: 'Road Closure', icon: 'block', color: '#ea4335' },
    { id: 'construction', label: 'Construction', icon: 'construction', color: '#fbbc04' },
    { id: 'flooding', label: 'Flooding', icon: 'water', color: '#1a73e8' },
    { id: 'pothole', label: 'Pothole', icon: 'warning', color: '#f9ab00' },
  ];

  /* ── Announcement Presets ──────────────────────────── */
  const ANNOUNCEMENT_PRESETS = [
    'Take the next exit',
    'Fuel stop ahead in 5 km',
    'Regroup at next rest area',
    'Slow down — speed trap ahead',
    'Stay in the left lane',
    'We\'ll stop for 10 minutes',
    'Follow my route exactly',
    'Toll booth ahead — have FASTag ready',
  ];

  /* ── Local Storage Helpers ─────────────────────────── */
  function saveToStorage(key, data) {
    try { localStorage.setItem(`convoy_${key}`, JSON.stringify(data)); }
    catch (e) { /* ignore */ }
  }

  function loadFromStorage(key) {
    try { return JSON.parse(localStorage.getItem(`convoy_${key}`)); }
    catch (e) { return null; }
  }

  /* ── Clamp / Lerp ──────────────────────────────────── */
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  /* ── Public API ────────────────────────────────────── */
  return {
    haversineDistance, bearing, destinationPoint, interpolatePosition,
    routeDistance, closestPointOnRoute, addGPSJitter,
    formatDistance, formatDuration, formatSpeed, formatTime, formatETA, timeAgo,
    generateId, generateConvoyCode, generateQRCode,
    debounce, throttle, EventBus,
    getRandomMember, getRandomRoad, MEMBER_NAMES, VEHICLE_TYPES,
    HAZARD_TYPES, ANNOUNCEMENT_PRESETS, ROAD_NAMES,
    saveToStorage, loadFromStorage,
    clamp, lerp, toRad, toDeg
  };
})();
