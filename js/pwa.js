/* ============================================================
   CONVOY MODE — PWA
   ============================================================
   Registers the service worker, watches for updates, and manages
   the install prompt. Everything is wrapped defensively so a PWA
   hiccup can never break the app — this module never throws.

   Public API (ConvoyPWA):
     • canInstall()   → boolean  — is a native install prompt ready?
     • promptInstall() → Promise<'accepted'|'dismissed'|'unavailable'>
     • update()       → tell a waiting SW to activate + reload
     • isStandalone() → boolean  — running as an installed app?

   Emits on ConvoyEngine.bus (when present):
     • 'pwa:installable' — a native install prompt became available
     • 'pwa:updated'     — a new service worker is waiting to activate
   ============================================================ */

const ConvoyPWA = (() => {
  'use strict';

  let deferredPrompt = null;   // captured beforeinstallprompt event
  let waitingWorker = null;    // an updated SW waiting to take over
  let reloading = false;       // guard against reload loops

  /* ── Safe bus emit ─────────────────────────────────── */
  function emit(event, data) {
    try {
      if (typeof ConvoyEngine !== 'undefined' && ConvoyEngine.bus) {
        ConvoyEngine.bus.emit(event, data);
      }
    } catch (_) { /* bus not ready — non-fatal */ }
  }

  /* ── Install state ─────────────────────────────────── */
  function isStandalone() {
    try {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true
      );
    } catch (_) {
      return false;
    }
  }

  function canInstall() {
    return deferredPrompt !== null;
  }

  async function promptInstall() {
    if (!deferredPrompt) return 'unavailable';
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null; // a prompt can only be used once
      const outcome = (choice && choice.outcome) || 'dismissed';
      emit('pwa:installed', { outcome });
      return outcome;
    } catch (_) {
      deferredPrompt = null;
      return 'unavailable';
    }
  }

  /* ── Update flow ───────────────────────────────────── */
  function update() {
    try {
      if (waitingWorker) {
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
    } catch (_) { /* non-fatal */ }
  }

  function trackWaiting(registration) {
    try {
      /* Already waiting when we registered. */
      if (registration.waiting && navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting;
        emit('pwa:updated', { registration });
      }

      /* A new worker started installing — watch it reach 'installed'. */
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = registration.waiting || installing;
            emit('pwa:updated', { registration });
          }
        });
      });
    } catch (_) { /* non-fatal */ }
  }

  /* ── Registration ──────────────────────────────────── */
  function register() {
    if (!('serviceWorker' in navigator)) return;

    try {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        trackWaiting(registration);

        /* Poll for updates when the tab regains focus. */
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });
      }).catch(() => { /* registration failed — app still works online */ });

      /* When the active worker changes (after SKIP_WAITING), reload once
         so the freshly-cached shell takes effect. */
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        try { window.location.reload(); } catch (_) { /* ignore */ }
      });
    } catch (_) { /* never throw from a PWA setup path */ }
  }

  /* ── Wire up install prompt events ─────────────────── */
  function bindInstallEvents() {
    try {
      window.addEventListener('beforeinstallprompt', (e) => {
        /* Stop the mini-infobar so we can trigger the prompt ourselves. */
        e.preventDefault();
        deferredPrompt = e;
        emit('pwa:installable', { canInstall: true });
      });

      window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        emit('pwa:installed', { outcome: 'accepted' });
      });
    } catch (_) { /* non-fatal */ }
  }

  /* ── Init ──────────────────────────────────────────── */
  function init() {
    bindInstallEvents();
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }

  try {
    init();
  } catch (_) { /* absolutely never throw at module load */ }

  /* ── Public API ────────────────────────────────────── */
  return {
    canInstall,
    promptInstall,
    update,
    isStandalone
  };
})();
