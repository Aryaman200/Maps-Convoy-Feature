/* ============================================================
   CONVOY MODE — VOICE GUIDANCE
   ============================================================
   Web Speech API integration: spoken turn-by-turn instructions,
   convoy event announcements (members, hazards, reroutes),
   and a mute toggle persisted to localStorage.
   ============================================================ */

const ConvoyVoice = (() => {
  const bus = ConvoyEngine.bus;
  const synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;

  let enabled = true;
  let preferredVoice = null;
  let navTimer = null;

  /* Turn-by-turn announcement thresholds (meters) */
  const THRESHOLDS = [2000, 1000, 500, 200];
  let spokenThresholds = {};      /* stepKey → Set of thresholds already spoken */
  let lastRegroupSpokenAt = 0;
  const REGROUP_COOLDOWN = 45000; /* ms between "falling behind" callouts */

  /* ── Initialize ────────────────────────────────────── */
  function init() {
    const saved = ConvoyUtils.loadFromStorage('voice_enabled');
    if (saved !== null && saved !== undefined) enabled = !!saved;

    if (synth) {
      pickVoice();
      /* Voices load asynchronously in most browsers */
      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', pickVoice);
      }
    }

    bindEvents();
    bindToggleButton();
    updateToggleButton();
  }

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    if (!voices.length) return;
    preferredVoice =
      voices.find(v => v.lang === 'en-IN') ||
      voices.find(v => v.lang.startsWith('en') && /Google/i.test(v.name)) ||
      voices.find(v => v.lang.startsWith('en')) ||
      null;
  }

  /* ── Core Speak ────────────────────────────────────── */
  function speak(text, { interrupt = false } = {}) {
    if (!enabled || !synth || !text) return;
    if (interrupt) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    synth.speak(utterance);
  }

  /* ── Turn-by-Turn Loop ─────────────────────────────── */
  function startNavLoop() {
    stopNavLoop();
    spokenThresholds = {};
    navTimer = setInterval(checkInstruction, 1000);
  }

  function stopNavLoop() {
    if (navTimer) {
      clearInterval(navTimer);
      navTimer = null;
    }
  }

  function checkInstruction() {
    if (!enabled) return;
    const instruction = ConvoyNavigation.getCurrentInstruction();
    if (!instruction || !instruction.road) return;

    const key = `${instruction.label}|${instruction.road}`;
    if (!spokenThresholds[key]) spokenThresholds[key] = new Set();
    const spoken = spokenThresholds[key];
    const dist = instruction.distance;

    /* Find the tightest threshold we've crossed but not yet announced */
    for (const t of THRESHOLDS) {
      if (dist <= t && !spoken.has(t)) {
        /* Mark this and all looser thresholds as done */
        THRESHOLDS.filter(x => x >= t).forEach(x => spoken.add(x));
        speak(phraseInstruction(instruction, t));
        break;
      }
    }
  }

  function phraseInstruction(instruction, threshold) {
    const action = instruction.label.charAt(0).toLowerCase() + instruction.label.slice(1);
    if (threshold <= 200) {
      return `${instruction.label} ${instruction.road}.`;
    }
    const distPhrase = threshold >= 1000
      ? `${threshold / 1000} kilometer${threshold > 1000 ? 's' : ''}`
      : `${threshold} meters`;
    return `In ${distPhrase}, ${action} ${instruction.road}.`;
  }

  /* ── Convoy Event Announcements ────────────────────── */
  function bindEvents() {
    bus.on('navigation:started', () => {
      startNavLoop();
      const convoy = ConvoyEngine.getConvoy();
      if (convoy) {
        const dest = convoy.destinationName || 'your destination';
        speak(`Navigation started. Leading a convoy of ${convoy.members.length} to ${dest}.`, { interrupt: true });
      }
    });

    bus.on('convoy:paused', () => {
      stopNavLoop();
      speak('Convoy paused.', { interrupt: true });
    });

    bus.on('convoy:resumed', () => {
      startNavLoop();
      speak('Convoy resumed.');
    });

    bus.on('convoy:ended', () => {
      stopNavLoop();
      speak('Convoy ended. Great driving, everyone.', { interrupt: true });
    });

    bus.on('member:joined', (member) => {
      /* Only chatty in the lobby — during navigation this would be noise */
      if (ConvoyEngine.getState() === ConvoyEngine.STATES.LOBBY ||
          ConvoyEngine.getState() === ConvoyEngine.STATES.CREATING) {
        speak(`${member.firstName} joined the convoy.`);
      }
    });

    bus.on('member:statusChanged', ({ member, from, to }) => {
      if (to === ConvoyEngine.MEMBER_STATUS.OFF_ROUTE) {
        speak(`${member.firstName} has gone off route.`);
      } else if (to === ConvoyEngine.MEMBER_STATUS.STOPPED) {
        speak(`${member.firstName} has stopped.`);
      } else if (to === ConvoyEngine.MEMBER_STATUS.FOLLOWING &&
                 (from === ConvoyEngine.MEMBER_STATUS.REJOINING || from === ConvoyEngine.MEMBER_STATUS.OFF_ROUTE)) {
        speak(`${member.firstName} is back on route.`);
      }
    });

    bus.on('regroup:alert', (data) => {
      const now = Date.now();
      if (now - lastRegroupSpokenAt < REGROUP_COOLDOWN) return;
      if (data.maxDistance < 600) return;
      lastRegroupSpokenAt = now;
      const who = data.count === 1
        ? `${data.members[0].firstName} is`
        : `${data.count} members are`;
      speak(`${who} falling behind.`);
    });

    bus.on('hazard:reported', (hazard) => {
      speak(`${hazard.reportedBy} reported ${hazard.typeInfo.label.toLowerCase()} ahead.`);
    });

    bus.on('announcement:broadcast', (announcement) => {
      speak(`Announcement from ${announcement.from}: ${announcement.message}`, { interrupt: true });
    });

    bus.on('reroute:started', () => {
      speak('Hazard on your route. Finding a way around.', { interrupt: true });
    });

    bus.on('route:updated', (data) => {
      /* New steps → forget what we've already announced */
      spokenThresholds = {};
      const addedMin = Math.round((data.addedSeconds || 0) / 60);
      const suffix = addedMin >= 1 ? ` This adds about ${addedMin} minute${addedMin > 1 ? 's' : ''}.` : '';
      speak(`New route found to avoid the ${data.hazard.typeInfo.label.toLowerCase()}.${suffix}`, { interrupt: true });
    });
  }

  /* ── Mute Toggle ───────────────────────────────────── */
  function bindToggleButton() {
    const btn = document.getElementById('voice-toggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  function toggle() {
    enabled = !enabled;
    ConvoyUtils.saveToStorage('voice_enabled', enabled);
    if (!enabled && synth) synth.cancel();
    updateToggleButton();
    if (typeof ConvoyUI !== 'undefined') {
      ConvoyUI.showSnackbar(
        enabled ? 'Voice guidance on' : 'Voice guidance muted',
        enabled ? 'volume_up' : 'volume_off',
        2000
      );
    }
    if (enabled) speak('Voice guidance on.');
  }

  function updateToggleButton() {
    const btn = document.getElementById('voice-toggle');
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = enabled ? 'volume_up' : 'volume_off';
    btn.setAttribute('aria-pressed', String(enabled));
    btn.title = enabled ? 'Mute voice guidance' : 'Unmute voice guidance';
  }

  function isSupported() { return !!synth; }
  function isEnabled() { return enabled; }

  /* ── Public API ────────────────────────────────────── */
  return {
    init, speak, toggle, isSupported, isEnabled
  };
})();
