/* ============================================================
   CONVOY MODE — CONVOY ENGINE
   ============================================================
   State machine, member management, events, regroup detection,
   hazard system, announcements, and convoy lifecycle.
   ============================================================ */

const ConvoyEngine = (() => {
  const bus = new ConvoyUtils.EventBus();

  /* ── Convoy States ─────────────────────────────────── */
  const STATES = {
    IDLE: 'idle',
    CREATING: 'creating',
    LOBBY: 'lobby',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ENDED: 'ended'
  };

  const MEMBER_STATUS = {
    FOLLOWING: 'following',
    STOPPED: 'stopped',
    OFF_ROUTE: 'off-route',
    DISCONNECTED: 'disconnected',
    REJOINING: 'rejoining',
    WAITING: 'waiting'
  };

  const PRIVACY = {
    PUBLIC: 'public',
    INVITE_ONLY: 'invite_only',
    LINK_ONLY: 'link_only'
  };

  /* ── Convoy State ──────────────────────────────────── */
  let convoy = null;

  function createDefaultConvoy() {
    return {
      id: ConvoyUtils.generateConvoyCode(),
      state: STATES.IDLE,
      privacy: PRIVACY.INVITE_ONLY,
      leader: null,
      members: [],
      destination: null,
      destinationName: '',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      settings: {
        regroupDistance: 500,       /* meters */
        regroupTime: 120,           /* seconds */
        updateInterval: 1000,       /* ms */
        maxMembers: 100,
        autoWait: true,
        announcements: true,
        hazardAlerts: true
      },
      stats: {
        totalDistance: 0,
        elapsedTime: 0,
        avgSpeed: 0,
        maxSpeed: 0
      },
      hazards: [],
      announcements: [],
      activityLog: []
    };
  }

  /* ── Initialize Convoy ─────────────────────────────── */
  function createConvoy(options = {}) {
    convoy = createDefaultConvoy();
    convoy.state = STATES.CREATING;
    
    if (options.destination) {
      convoy.destination = options.destination;
      convoy.destinationName = options.destinationName || 'Destination';
    }
    if (options.privacy) {
      convoy.privacy = options.privacy;
    }

    /* Leader is always "Aryaman" (the user) */
    const leader = {
      id: 'leader',
      name: 'Aryaman S',
      firstName: 'Aryaman',
      initials: 'AS',
      color: '#4285f4',
      isLeader: true,
      status: MEMBER_STATUS.FOLLOWING,
      position: null,
      speed: 0,
      heading: 0,
      currentRoad: '',
      distanceBehind: 0,
      eta: 0,
      battery: 85,
      connectionQuality: 1.0,
      joinedAt: Date.now(),
      vehicle: 'car',
      lastUpdate: Date.now()
    };

    convoy.leader = leader;
    convoy.members = [leader];

    addActivity('convoy_created', `Convoy ${convoy.id} created`);
    bus.emit('convoy:created', convoy);
    bus.emit('state:changed', convoy.state);

    return convoy;
  }

  /* ── Add Simulated Members ─────────────────────────── */
  function addSimulatedMembers(count = 5) {
    const staggerDelay = 800;
    
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const memberData = ConvoyUtils.getRandomMember(i + 1);
        const member = {
          ...memberData,
          isLeader: false,
          status: MEMBER_STATUS.FOLLOWING,
          position: null,
          speed: 0,
          heading: 0,
          currentRoad: '',
          distanceBehind: 100 + (i * 150),
          eta: 0,
          lastUpdate: Date.now(),
          joinedAt: Date.now(),
          routeIndex: 0,
          /* Simulation params */
          speedVariance: 0.85 + Math.random() * 0.3,
          followDelay: 3 + Math.random() * 8,    /* seconds behind leader */
          driftAmount: Math.random() * 0.15       /* GPS drift amount */
        };

        convoy.members.push(member);
        addActivity('member_joined', `<strong>${member.firstName}</strong> joined the convoy`, member.color);
        bus.emit('member:joined', member);
      }, i * staggerDelay);
    }
  }

  /* ── State Transitions ─────────────────────────────── */
  function setConvoyState(newState) {
    if (!convoy) return;
    const oldState = convoy.state;
    convoy.state = newState;
    
    if (newState === STATES.ACTIVE && !convoy.startedAt) {
      convoy.startedAt = Date.now();
    }
    if (newState === STATES.ENDED) {
      convoy.endedAt = Date.now();
    }

    bus.emit('state:changed', { from: oldState, to: newState });
  }

  function startConvoy() {
    if (!convoy) return;
    convoy.state = STATES.LOBBY;
    bus.emit('state:changed', { to: STATES.LOBBY });
    addActivity('convoy_lobby', 'Waiting for members to join...');
  }

  function beginNavigation() {
    if (!convoy) return;
    setConvoyState(STATES.ACTIVE);
    addActivity('navigation_started', '<strong>Navigation started</strong> — convoy is moving');
    bus.emit('navigation:started');
  }

  function pauseConvoy() {
    if (!convoy) return;
    setConvoyState(STATES.PAUSED);
    addActivity('convoy_paused', '<strong>Leader</strong> paused the convoy');
    bus.emit('convoy:paused');
  }

  function resumeConvoy() {
    if (!convoy) return;
    setConvoyState(STATES.ACTIVE);
    addActivity('convoy_resumed', '<strong>Leader</strong> resumed the convoy');
    bus.emit('convoy:resumed');
  }

  function endConvoy() {
    if (!convoy) return;
    setConvoyState(STATES.ENDED);
    addActivity('convoy_ended', '<strong>Convoy ended</strong>');
    bus.emit('convoy:ended', getStats());
  }

  /* ── Member Management ─────────────────────────────── */
  function removeMember(memberId) {
    if (!convoy) return;
    const idx = convoy.members.findIndex(m => m.id === memberId);
    if (idx > 0) { /* Don't remove leader */
      const member = convoy.members[idx];
      convoy.members.splice(idx, 1);
      addActivity('member_left', `<strong>${member.firstName}</strong> left the convoy`, member.color);
      bus.emit('member:left', member);
    }
  }

  function promoteMember(memberId) {
    if (!convoy) return;
    const member = convoy.members.find(m => m.id === memberId);
    if (member) {
      /* Demote current leader */
      convoy.leader.isLeader = false;
      /* Promote new leader */
      member.isLeader = true;
      convoy.leader = member;
      addActivity('leader_changed', `<strong>${member.firstName}</strong> is now the leader`, member.color);
      bus.emit('leader:changed', member);
    }
  }

  /* ── Member State Updates ──────────────────────────── */
  function updateMemberPosition(memberId, position, speed, heading) {
    const member = convoy.members.find(m => m.id === memberId);
    if (!member) return;
    
    member.position = position;
    member.speed = speed;
    member.heading = heading;
    member.lastUpdate = Date.now();

    if (member.isLeader && convoy.leader) {
      /* Update leader-specific tracking */
      convoy.stats.maxSpeed = Math.max(convoy.stats.maxSpeed, speed);
    } else {
      /* Calculate distance behind leader */
      if (convoy.leader && convoy.leader.position) {
        member.distanceBehind = ConvoyUtils.haversineDistance(
          position.lat, position.lng,
          convoy.leader.position.lat, convoy.leader.position.lng
        );
      }
    }
  }

  function updateMemberStatus(memberId, status) {
    const member = convoy.members.find(m => m.id === memberId);
    if (!member || member.status === status) return;
    
    const oldStatus = member.status;
    member.status = status;

    if (status === MEMBER_STATUS.OFF_ROUTE) {
      addActivity('off_route', `<strong>${member.firstName}</strong> went off route`, '#ea4335');
    } else if (status === MEMBER_STATUS.REJOINING && oldStatus === MEMBER_STATUS.OFF_ROUTE) {
      addActivity('rejoining', `<strong>${member.firstName}</strong> is rejoining the route`, '#4285f4');
    } else if (status === MEMBER_STATUS.STOPPED) {
      addActivity('member_stopped', `<strong>${member.firstName}</strong> has stopped`, '#f9ab00');
    }

    bus.emit('member:statusChanged', { member, from: oldStatus, to: status });
  }

  /* ── Regroup Detection ─────────────────────────────── */
  function checkRegroup() {
    if (!convoy || convoy.state !== STATES.ACTIVE) return;
    
    const settings = convoy.settings;
    const straggling = [];

    convoy.members.forEach(member => {
      if (member.isLeader) return;
      if (!member.position || !convoy.leader.position) return;

      const dist = member.distanceBehind;
      
      if (dist > settings.regroupDistance) {
        straggling.push(member);
        if (member.status === MEMBER_STATUS.FOLLOWING) {
          /* Don't change to off-route, just flag as needing regroup */
          bus.emit('regroup:needed', { member, distance: dist });
        }
      }
    });

    if (straggling.length > 0) {
      bus.emit('regroup:alert', { 
        count: straggling.length, 
        members: straggling,
        maxDistance: Math.max(...straggling.map(m => m.distanceBehind))
      });
    }

    return straggling;
  }

  /* ── Hazard System ─────────────────────────────────── */
  function reportHazard(type, position, reporterName) {
    if (!convoy) return;
    
    const hazardType = ConvoyUtils.HAZARD_TYPES.find(h => h.id === type);
    if (!hazardType) return;

    const hazard = {
      id: ConvoyUtils.generateId('HZD'),
      type: type,
      typeInfo: hazardType,
      position: position,
      reportedBy: reporterName || 'Unknown',
      timestamp: Date.now(),
      active: true
    };

    convoy.hazards.push(hazard);
    addActivity('hazard', `<strong>${hazard.reportedBy}</strong> reported: ${hazardType.label}`, hazardType.color);
    bus.emit('hazard:reported', hazard);

    return hazard;
  }

  function dismissHazard(hazardId) {
    const hazard = convoy.hazards.find(h => h.id === hazardId);
    if (hazard) {
      hazard.active = false;
      bus.emit('hazard:dismissed', hazard);
    }
  }

  /* ── Announcements ─────────────────────────────────── */
  function broadcast(message, type = 'info') {
    if (!convoy) return;
    
    const announcement = {
      id: ConvoyUtils.generateId('ANN'),
      message: message,
      type: type,
      timestamp: Date.now(),
      from: convoy.leader.firstName
    };

    convoy.announcements.push(announcement);
    addActivity('announcement', `<strong>Leader:</strong> "${message}"`, '#1a73e8');
    bus.emit('announcement:broadcast', announcement);

    return announcement;
  }

  /* ── Activity Log ──────────────────────────────────── */
  function addActivity(type, message, color = '#5f6368') {
    if (!convoy) return;
    
    const icons = {
      convoy_created: 'add_circle',
      convoy_lobby: 'hourglass_top',
      member_joined: 'person_add',
      member_left: 'person_remove',
      navigation_started: 'navigation',
      convoy_paused: 'pause_circle',
      convoy_resumed: 'play_circle',
      convoy_ended: 'stop_circle',
      hazard: 'warning',
      announcement: 'campaign',
      off_route: 'wrong_location',
      rejoining: 'route',
      member_stopped: 'pause',
      leader_changed: 'star',
      regroup: 'group',
      reroute: 'alt_route',
      destination_changed: 'edit_location',
      fuel_stop: 'local_gas_station',
      distance_warning: 'social_distance'
    };

    const entry = {
      id: ConvoyUtils.generateId('ACT'),
      type: type,
      message: message,
      icon: icons[type] || 'info',
      color: color,
      timestamp: Date.now()
    };

    convoy.activityLog.unshift(entry);
    
    /* Keep log manageable */
    if (convoy.activityLog.length > 100) {
      convoy.activityLog = convoy.activityLog.slice(0, 100);
    }

    bus.emit('activity:new', entry);
    return entry;
  }

  /* ── Stats ─────────────────────────────────────────── */
  function getStats() {
    if (!convoy) return null;
    
    const now = Date.now();
    const elapsed = convoy.startedAt ? (now - convoy.startedAt) / 1000 : 0;
    const activeMembers = convoy.members.filter(m => 
      m.status === MEMBER_STATUS.FOLLOWING || m.status === MEMBER_STATUS.WAITING
    );
    const avgDistance = convoy.members.length > 1
      ? convoy.members.filter(m => !m.isLeader).reduce((sum, m) => sum + m.distanceBehind, 0) / (convoy.members.length - 1)
      : 0;

    return {
      ...convoy.stats,
      elapsedTime: elapsed,
      memberCount: convoy.members.length,
      activeMembers: activeMembers.length,
      avgDistanceBehind: avgDistance,
      hazardCount: convoy.hazards.filter(h => h.active).length
    };
  }

  /* ── Convoy Cohesion ───────────────────────────────── */
  /* How tightly the convoy is holding together, from the spread of
     followers behind the leader. Drives the live cohesion indicator. */
  function getCohesion() {
    if (!convoy) return { level: 'tight', label: 'Tight', maxGap: 0, spread: 0, color: '#34a853' };

    const followers = convoy.members.filter(m => !m.isLeader);
    if (followers.length === 0) {
      return { level: 'solo', label: 'Solo', maxGap: 0, spread: 0, color: '#34a853' };
    }

    const gaps = followers.map(m => m.distanceBehind || 0);
    const maxGap = Math.max(...gaps);
    const anyOffRoute = followers.some(m => m.status === MEMBER_STATUS.OFF_ROUTE || m.status === MEMBER_STATUS.DISCONNECTED);
    const regroup = convoy.settings.regroupDistance;

    let level, label, color;
    if (anyOffRoute || maxGap > regroup) {
      level = 'regroup'; label = 'Regroup'; color = '#ea4335';
    } else if (maxGap > regroup * 0.6) {
      level = 'spread'; label = 'Spread out'; color = '#f9ab00';
    } else if (maxGap > regroup * 0.3) {
      level = 'loose'; label = 'Holding'; color = '#4285f4';
    } else {
      level = 'tight'; label = 'Tight'; color = '#34a853';
    }

    /* 0 (perfectly together) → 1 (at/over regroup distance) */
    const spread = Math.min(1, maxGap / regroup);
    return { level, label, maxGap, spread, color };
  }

  function getConvoy() { return convoy; }
  function getMembers() { return convoy ? convoy.members : []; }
  function getLeader() { return convoy ? convoy.leader : null; }
  function getState() { return convoy ? convoy.state : STATES.IDLE; }
  function getInviteLink() { return convoy ? `maps.google.com/convoy/${convoy.id}` : ''; }

  /* ── Simulation Random Events ──────────────────────── */
  let eventTimer = null;

  function startRandomEvents() {
    if (eventTimer) clearInterval(eventTimer);

    let eventIndex = 0;
    const scheduledEvents = [
      /* Event sequence for demo */
      { delay: 8000, fn: () => {
        const m = convoy.members.find(m => !m.isLeader && m.status === MEMBER_STATUS.FOLLOWING);
        if (m) {
          addActivity('distance_warning', `<strong>${m.firstName}</strong> is ${ConvoyUtils.formatDistance(m.distanceBehind)} behind`, '#f9ab00');
        }
      }},
      { delay: 15000, fn: () => {
        const m = convoy.members[3]; /* Priya or whoever is index 3 */
        if (m) {
          updateMemberStatus(m.id, MEMBER_STATUS.OFF_ROUTE);
          setTimeout(() => {
            updateMemberStatus(m.id, MEMBER_STATUS.REJOINING);
            setTimeout(() => updateMemberStatus(m.id, MEMBER_STATUS.FOLLOWING), 5000);
          }, 6000);
        }
      }},
      { delay: 25000, fn: () => {
        if (convoy.leader && convoy.leader.position) {
          /* Place the hazard on the route ahead so dynamic rerouting kicks in */
          const pos = ConvoyNavigation.getPredictedLeaderPosition(60);
          if (pos) reportHazard('construction', pos, 'Vikram');
        }
      }},
      { delay: 35000, fn: () => {
        broadcast('Fuel stop ahead in 5 km');
      }},
      { delay: 45000, fn: () => {
        addActivity('fuel_stop', 'Fuel stop added to the route', '#34a853');
      }},
      { delay: 55000, fn: () => {
        const m = convoy.members[2];
        if (m) {
          m.connectionQuality = 0.3;
          addActivity('distance_warning', `<strong>${m.firstName}</strong>'s connection is weak`, '#f9ab00');
          setTimeout(() => { m.connectionQuality = 0.9; }, 10000);
        }
      }},
    ];

    function runNextEvent() {
      if (eventIndex >= scheduledEvents.length || !convoy || convoy.state !== STATES.ACTIVE) return;
      
      const event = scheduledEvents[eventIndex];
      eventTimer = setTimeout(() => {
        if (convoy && convoy.state === STATES.ACTIVE) {
          event.fn();
        }
        eventIndex++;
        runNextEvent();
      }, event.delay);
    }

    runNextEvent();
  }

  function stopRandomEvents() {
    if (eventTimer) {
      clearTimeout(eventTimer);
      eventTimer = null;
    }
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    STATES, MEMBER_STATUS, PRIVACY,
    bus,
    createConvoy, startConvoy, beginNavigation,
    pauseConvoy, resumeConvoy, endConvoy,
    addSimulatedMembers, removeMember, promoteMember,
    updateMemberPosition, updateMemberStatus,
    checkRegroup,
    reportHazard, dismissHazard,
    broadcast, addActivity,
    getStats, getCohesion, getConvoy, getMembers, getLeader, getState, getInviteLink,
    startRandomEvents, stopRandomEvents
  };
})();
