/* ============================================================
   CONVOY SERVER — VALIDATORS
   ============================================================
   Small, pure, defensive validators used by the socket handlers.
   Rule: NEVER throw. Always return a safe value / boolean so a
   malformed inbound payload can never crash a connection.
   ============================================================ */

/* ── Convoy Code Format ────────────────────────────── */
const CODE_RE = /^CVY-[A-Z0-9]{6}$/;

export function isValidCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/* ── Numbers ───────────────────────────────────────── */
export function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Valid geographic latitude (finite, -90..90). */
export function isFiniteLat(lat) {
  return isFiniteNumber(lat) && lat >= -90 && lat <= 90;
}

/** Valid geographic longitude (finite, -180..180). */
export function isFiniteLng(lng) {
  return isFiniteNumber(lng) && lng >= -180 && lng <= 180;
}

/** A single {lat,lng} coordinate is a real point on Earth. */
export function isFiniteCoord(lat, lng) {
  return isFiniteLat(lat) && isFiniteLng(lng);
}

/** Coerce to a finite number within [min,max], falling back to a default. */
export function clampNumber(n, min, max, fallback = 0) {
  if (!isFiniteNumber(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ── Strings ───────────────────────────────────────── */
/** Coerce to a trimmed string no longer than `max` chars. Non-strings → ''. */
export function clampString(value, max = 120) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** True when `value` is a non-empty string once clamped. */
export function isNonEmptyString(value, max = 120) {
  return clampString(value, max).length > 0;
}

/* ── Route Coordinates ─────────────────────────────── */
/**
 * Sanitize an inbound route coordinate list ([[lat,lng], ...]).
 * Drops any malformed points; caps the length to protect memory.
 * Always returns an array (possibly empty).
 */
export function sanitizeCoordinates(coordinates, maxPoints = 5000) {
  if (!Array.isArray(coordinates)) return [];
  const out = [];
  for (const pair of coordinates) {
    if (out.length >= maxPoints) break;
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lat, lng] = pair;
    if (isFiniteCoord(lat, lng)) out.push([lat, lng]);
  }
  return out;
}

/* ── Member Descriptor ─────────────────────────────── */
/**
 * Normalize a client-supplied member descriptor into a safe shape.
 * Returns { ok, value } — never throws, never trusts input.
 */
export function sanitizeMember(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false };

  const id = clampString(raw.id, 64);
  const name = clampString(raw.name, 60);
  if (!id || !name) return { ok: false };

  const firstName = clampString(raw.firstName, 40) || name.split(' ')[0] || name;
  const initials = (clampString(raw.initials, 4) || firstName.slice(0, 2)).toUpperCase();
  const color = /^#[0-9a-fA-F]{3,8}$/.test(raw.color) ? raw.color : '#4285f4';
  const vehicle = clampString(raw.vehicle, 20) || 'car';

  return { ok: true, value: { id, name, firstName, initials, color, vehicle } };
}

/* ── Destination Descriptor ────────────────────────── */
export function sanitizeDestination(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isFiniteCoord(raw.lat, raw.lng)) return null;
  return {
    lat: raw.lat,
    lng: raw.lng,
    name: clampString(raw.name, 120) || 'Destination'
  };
}
