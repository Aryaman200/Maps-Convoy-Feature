/* ============================================================
   CONVOY SERVER — IN-MEMORY STORE
   ============================================================
   The single source of truth for room membership and convoy
   lifecycle state. Everything lives in a Map<code, convoy>.
   Pure data operations only — no socket / IO concerns here.
   ============================================================ */

/* ── Constants ─────────────────────────────────────── */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* no ambiguous 0/O/1/I */
const CODE_LEN = 6;
const MAX_MEMBERS = 100;

/* Lifecycle states mirror the client ConvoyEngine.STATES. */
export const CONVOY_STATE = {
  LOBBY: 'lobby',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ENDED: 'ended'
};

export class ConvoyStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.convoys = new Map();
    /** socket.id → { code, memberId } */
    this.sockets = new Map();
  }

  /* ── Code Generation ─────────────────────────────── */
  _randomCode() {
    let body = '';
    for (let i = 0; i < CODE_LEN; i++) {
      body += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return `CVY-${body}`;
  }

  /** Generate a code guaranteed not to collide with a live convoy. */
  generateUniqueCode() {
    let code = this._randomCode();
    let guard = 0;
    while (this.convoys.has(code) && guard < 1000) {
      code = this._randomCode();
      guard++;
    }
    return code;
  }

  /* ── Member Factory ──────────────────────────────── */
  _makeMember(descriptor, { isLeader = false, socketId = null } = {}) {
    return {
      id: descriptor.id,
      name: descriptor.name,
      firstName: descriptor.firstName,
      initials: descriptor.initials,
      color: descriptor.color,
      vehicle: descriptor.vehicle,
      isLeader,
      status: 'following',
      battery: 100,
      /* Live telemetry (null until first position:update). */
      lat: null,
      lng: null,
      heading: 0,
      speed: 0,
      /* Server bookkeeping (not part of the wire member shape but harmless). */
      socketId,
      connected: true,
      joinedAt: Date.now(),
      lastUpdate: Date.now()
    };
  }

  /* ── Create ──────────────────────────────────────── */
  /**
   * Create a new convoy owned by `leaderDescriptor`.
   * Returns { code, convoy }.
   */
  createConvoy({ leader, destination = null, privacy = 'invite_only', socketId = null }) {
    const code = this.generateUniqueCode();
    const leaderMember = this._makeMember(leader, { isLeader: true, socketId });

    const convoy = {
      code,
      state: CONVOY_STATE.LOBBY,
      privacy,
      destination,
      route: null,
      eta: null,               /* { etaSeconds, distanceMeters } */
      members: [leaderMember],
      hazards: [],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      pruneTimer: null         /* set when the room goes empty */
    };

    this.convoys.set(code, convoy);
    if (socketId) this.sockets.set(socketId, { code, memberId: leaderMember.id });
    return { code, convoy };
  }

  /* ── Lookup ──────────────────────────────────────── */
  getConvoy(code) {
    return this.convoys.get(code) || null;
  }

  getMember(code, memberId) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    return convoy.members.find(m => m.id === memberId) || null;
  }

  getBySocket(socketId) {
    const ref = this.sockets.get(socketId);
    if (!ref) return null;
    const convoy = this.convoys.get(ref.code);
    if (!convoy) return null;
    const member = convoy.members.find(m => m.id === ref.memberId) || null;
    return { convoy, member, ref };
  }

  /* ── Join ────────────────────────────────────────── */
  /**
   * Add (or reconnect) a member to an existing convoy.
   * Returns { ok, convoy?, member?, rejoined?, error? }.
   */
  joinConvoy({ code, member, socketId = null }) {
    const convoy = this.convoys.get(code);
    if (!convoy) return { ok: false, error: 'not_found' };
    if (convoy.state === CONVOY_STATE.ENDED) return { ok: false, error: 'ended' };

    /* Cancel any pending prune — the room is alive again. */
    if (convoy.pruneTimer) {
      clearTimeout(convoy.pruneTimer);
      convoy.pruneTimer = null;
    }

    /* Reconnect path: same member id rejoining. */
    const existing = convoy.members.find(m => m.id === member.id);
    if (existing) {
      existing.connected = true;
      existing.status = 'following';
      existing.socketId = socketId;
      existing.lastUpdate = Date.now();
      if (socketId) this.sockets.set(socketId, { code, memberId: existing.id });
      return { ok: true, convoy, member: existing, rejoined: true };
    }

    if (convoy.members.length >= MAX_MEMBERS) return { ok: false, error: 'full' };

    const newMember = this._makeMember(member, { isLeader: false, socketId });
    convoy.members.push(newMember);
    if (socketId) this.sockets.set(socketId, { code, memberId: newMember.id });
    return { ok: true, convoy, member: newMember, rejoined: false };
  }

  /* ── Position / Status ───────────────────────────── */
  updatePosition(code, memberId, { lat, lng, heading, speed, battery, status }) {
    const member = this.getMember(code, memberId);
    if (!member) return null;

    if (typeof lat === 'number') member.lat = lat;
    if (typeof lng === 'number') member.lng = lng;
    if (typeof heading === 'number') member.heading = heading;
    if (typeof speed === 'number') member.speed = speed;
    if (typeof battery === 'number') member.battery = battery;
    if (typeof status === 'string') member.status = status;
    member.lastUpdate = Date.now();
    return member;
  }

  /* ── Leadership ──────────────────────────────────── */
  isLeader(code, memberId) {
    const convoy = this.convoys.get(code);
    if (!convoy) return false;
    const member = convoy.members.find(m => m.id === memberId);
    return !!(member && member.isLeader);
  }

  /**
   * Promote `memberId` to leader, demoting the current one.
   * Returns the new leader member, or null on failure.
   */
  promoteLeader(code, memberId) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    const next = convoy.members.find(m => m.id === memberId);
    if (!next) return null;

    convoy.members.forEach(m => { m.isLeader = false; });
    next.isLeader = true;
    return next;
  }

  /**
   * Pick the earliest-joined still-connected member (used to auto-promote
   * when the leader disconnects). Returns a member or null.
   */
  earliestConnectedMember(code, excludeId = null) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    return convoy.members
      .filter(m => m.connected && m.id !== excludeId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0] || null;
  }

  /* ── Lifecycle State ─────────────────────────────── */
  setState(code, state) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    convoy.state = state;
    if (state === CONVOY_STATE.ACTIVE && !convoy.startedAt) convoy.startedAt = Date.now();
    if (state === CONVOY_STATE.ENDED) convoy.endedAt = Date.now();
    return convoy;
  }

  setRoute(code, route) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    convoy.route = route;
    return convoy;
  }

  setEta(code, eta) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    convoy.eta = eta;
    return convoy;
  }

  /* ── Hazards ─────────────────────────────────────── */
  addHazard(code, { type, lat, lng, reportedBy }) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    const hazard = {
      id: `HZD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      type,
      lat,
      lng,
      reportedBy,
      ts: Date.now()
    };
    convoy.hazards.push(hazard);
    if (convoy.hazards.length > 200) convoy.hazards.shift();
    return hazard;
  }

  /* ── Removal / Disconnect ────────────────────────── */
  /**
   * Handle a socket dropping. We do NOT delete the member (they may
   * reconnect); we mark them disconnected and free the socket ref.
   * Returns { convoy, member, ref } or null.
   */
  removeMemberBySocket(socketId) {
    const info = this.getBySocket(socketId);
    this.sockets.delete(socketId);
    if (!info) return null;
    if (info.member) {
      info.member.connected = false;
      info.member.socketId = null;
      info.member.status = 'disconnected';
      info.member.lastUpdate = Date.now();
    }
    return info;
  }

  /** Hard-remove a member (explicit leave). Returns the removed member. */
  removeMember(code, memberId) {
    const convoy = this.convoys.get(code);
    if (!convoy) return null;
    const idx = convoy.members.findIndex(m => m.id === memberId);
    if (idx === -1) return null;
    const [removed] = convoy.members.splice(idx, 1);
    return removed;
  }

  /** How many members currently hold a live socket. */
  connectedCount(code) {
    const convoy = this.convoys.get(code);
    if (!convoy) return 0;
    return convoy.members.filter(m => m.connected).length;
  }

  /* ── Pruning ─────────────────────────────────────── */
  deleteConvoy(code) {
    const convoy = this.convoys.get(code);
    if (convoy && convoy.pruneTimer) clearTimeout(convoy.pruneTimer);
    return this.convoys.delete(code);
  }

  /**
   * Delete any convoy that has been empty (zero connected members). Used by
   * scheduled prune callbacks. Returns true if the convoy was removed.
   */
  pruneEmpty(code) {
    const convoy = this.convoys.get(code);
    if (!convoy) return false;
    if (this.connectedCount(code) === 0) {
      this.convoys.delete(code);
      return true;
    }
    return false;
  }

  size() {
    return this.convoys.size;
  }
}
