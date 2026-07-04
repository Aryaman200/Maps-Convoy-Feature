/* ============================================================
   CONVOY MODE — APP CONTROLLER
   ============================================================
   Main entry point, theme management, initialization,
   and global coordination.
   ============================================================ */

const ConvoyApp = (() => {
  let isDarkMode = false;

  /* ── Initialize Application ────────────────────────── */
  function init() {
    /* Detect system preference */
    isDarkMode = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
    applyTheme(isDarkMode);

    /* Initialize map */
    ConvoyMap.init('map');

    /* Initialize UI */
    ConvoyUI.init();

    /* Initialize voice guidance */
    ConvoyVoice.init();

    /* Setup theme toggle */
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        isDarkMode = !isDarkMode;
        applyTheme(isDarkMode);
      });
      updateThemeIcon();
    }

    /* Listen for system theme changes */
    window.matchMedia?.('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (!document.documentElement.hasAttribute('data-theme')) {
          isDarkMode = e.matches;
          applyTheme(isDarkMode);
        }
      });

    /* Handle resize */
    window.addEventListener('resize', ConvoyUtils.debounce(() => {
      ConvoyMap.invalidateSize();
    }, 200));

    /* Keyboard shortcuts (for desktop testing) */
    document.addEventListener('keydown', handleKeyboard);

    console.log('%c🚗 Convoy Mode for Google Maps — Prototype Loaded', 
      'color: #4285f4; font-size: 16px; font-weight: bold;');
    console.log('%cPress H for Home, C for Convoy Hub, D for Dark Mode, V for Voice toggle',
      'color: #5f6368; font-size: 12px;');
  }

  /* ── Theme Management ──────────────────────────────── */
  function applyTheme(dark) {
    document.documentElement.classList.add('theme-transitioning');
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    ConvoyMap.setTheme(dark);
    updateThemeIcon();
    
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transitioning');
    }, 350);
  }

  function updateThemeIcon() {
    const themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;
    const icon = themeBtn.querySelector('.material-symbols-rounded');
    if (icon) {
      icon.textContent = isDarkMode ? 'light_mode' : 'dark_mode';
    }
  }

  function toggleTheme() {
    isDarkMode = !isDarkMode;
    applyTheme(isDarkMode);
  }

  /* ── Keyboard Shortcuts ────────────────────────────── */
  function handleKeyboard(e) {
    /* Don't handle if user is typing in an input */
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'h':
        ConvoyUI.showScreen('home');
        break;
      case 'c':
        ConvoyUI.showScreen('convoy-hub');
        break;
      case 'd':
        toggleTheme();
        break;
      case 'v':
        ConvoyVoice.toggle();
        break;
      case 'escape':
        ConvoyUI.setSheetState('collapsed');
        break;
    }
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    init, toggleTheme, applyTheme,
    isDarkMode: () => isDarkMode
  };
})();

/* ── Boot ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  ConvoyApp.init();
});
