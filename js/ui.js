/* ============================================================
   CONVOY MODE — UI CONTROLLER
   ============================================================
   Screen management, bottom sheet interaction, dialogs,
   snackbars, and all user interaction handling.
   ============================================================ */

const ConvoyUI = (() => {
  const bus = ConvoyEngine.bus;
  
  /* ── DOM References ────────────────────────────────── */
  let bottomSheet, sheetContent, sheetOverlay;
  let navHeader, navBottomBar;
  let navBar;
  let searchBar;
  let announcementBanner;
  let snackbarContainer;
  let dialogOverlay;
  let speedIndicator;
  let mapFabGroup;

  /* ── Sheet State ───────────────────────────────────── */
  let currentScreen = 'home';
  let sheetState = 'collapsed'; /* collapsed, half, expanded, hidden */
  let isDragging = false;
  let dragStartY = 0;
  let sheetStartTranslate = 0;
  let cameraFollow = true;      /* auto-pan to leader; pauses when user drags the map */

  /* ── Initialize ────────────────────────────────────── */
  function init() {
    cacheDOM();
    setupSheetDrag();
    setupNavBar();
    setupEventListeners();
    setupCameraFollow();
    showScreen('home');
  }

  /* Pause auto-follow the moment the user grabs the map; the recenter
     FAB (or ConvoyUI.recenter) resumes it. */
  function setupCameraFollow() {
    const map = ConvoyMap.getMap();
    if (!map) return;
    map.on('dragstart', () => {
      cameraFollow = false;
      document.getElementById('btn-recenter')?.classList.add('needs-recenter');
    });
  }

  function recenter() {
    cameraFollow = true;
    document.getElementById('btn-recenter')?.classList.remove('needs-recenter');
    ConvoyMap.followLeader();
  }

  function cacheDOM() {
    bottomSheet = document.getElementById('bottom-sheet');
    sheetContent = document.getElementById('sheet-content');
    sheetOverlay = document.getElementById('sheet-overlay');
    navHeader = document.getElementById('nav-header');
    navBottomBar = document.getElementById('nav-bottom-bar');
    navBar = document.getElementById('nav-bar');
    searchBar = document.getElementById('search-bar');
    announcementBanner = document.getElementById('announcement-banner');
    snackbarContainer = document.getElementById('snackbar-container');
    dialogOverlay = document.getElementById('dialog-overlay');
    speedIndicator = document.getElementById('speed-indicator');
    mapFabGroup = document.getElementById('map-fab-group-bottom');
  }

  /* ── Screen Management ─────────────────────────────── */
  function showScreen(screen) {
    currentScreen = screen;
    
    switch (screen) {
      case 'home':
        showHome();
        break;
      case 'convoy-hub':
        showConvoyHub();
        break;
      case 'create-convoy':
        showCreateConvoy();
        break;
      case 'join-convoy':
        showJoinConvoy();
        break;
      case 'lobby':
        showLobby();
        break;
      case 'active-leader':
        showActiveLeader();
        break;
      case 'active-follower':
        showActiveFollower();
        break;
      case 'ended':
        showConvoyEnded();
        break;
    }
  }

  /* ── Home Screen ───────────────────────────────────── */
  function showHome() {
    setNavBarVisible(true);
    setSearchBarVisible(true);
    setNavHeaderActive(false);
    setNavBottomBarActive(false);
    setSheetState('hidden');
    if (speedIndicator) speedIndicator.style.display = 'none';
    setActiveNavItem('explore');
    
    /* Reset map view */
    ConvoyMap.panTo(19.0760, 72.8777, 13);
  }

  /* ── Convoy Hub ────────────────────────────────────── */
  function showConvoyHub() {
    setSearchBarVisible(false);
    setActiveNavItem('convoy');
    setSheetState('half');
    
    sheetContent.innerHTML = `
      <div class="sheet-content-transition">
        <div class="sheet-header" style="padding: 0 0 16px;">
          <div class="sheet-title">Convoy Mode</div>
          <div class="sheet-subtitle">Travel together, arrive together</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div class="convoy-menu-item ripple-container" id="menu-create-convoy" role="button" tabindex="0" aria-label="Create a new convoy">
            <div class="menu-icon-circle" style="background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);">
              <span class="material-symbols-rounded">add_circle</span>
            </div>
            <div class="menu-text">
              <div class="menu-title">Create Convoy</div>
              <div class="menu-desc">Lead a group to a destination</div>
            </div>
            <span class="material-symbols-rounded menu-arrow">chevron_right</span>
          </div>

          <div class="convoy-menu-item ripple-container" id="menu-join-convoy" role="button" tabindex="0" aria-label="Join an existing convoy">
            <div class="menu-icon-circle" style="background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container);">
              <span class="material-symbols-rounded">group_add</span>
            </div>
            <div class="menu-text">
              <div class="menu-title">Join Convoy</div>
              <div class="menu-desc">Follow a convoy leader</div>
            </div>
            <span class="material-symbols-rounded menu-arrow">chevron_right</span>
          </div>

          <div class="divider" style="margin: 4px 0;"></div>

          <div class="convoy-menu-item ripple-container" role="button" tabindex="0" aria-label="View recent convoys">
            <div class="menu-icon-circle" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant);">
              <span class="material-symbols-rounded">history</span>
            </div>
            <div class="menu-text">
              <div class="menu-title">Recent Convoys</div>
              <div class="menu-desc">No recent convoys</div>
            </div>
            <span class="material-symbols-rounded menu-arrow">chevron_right</span>
          </div>

          <div class="convoy-menu-item ripple-container" role="button" tabindex="0" aria-label="View scheduled convoys">
            <div class="menu-icon-circle" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface-variant);">
              <span class="material-symbols-rounded">event</span>
            </div>
            <div class="menu-text">
              <div class="menu-title">Scheduled Convoys</div>
              <div class="menu-desc">Plan a group trip</div>
            </div>
            <span class="material-symbols-rounded menu-arrow">chevron_right</span>
          </div>
        </div>
      </div>
    `;

    /* Bind actions */
    document.getElementById('menu-create-convoy')?.addEventListener('click', () => showScreen('create-convoy'));
    document.getElementById('menu-join-convoy')?.addEventListener('click', () => showScreen('join-convoy'));
  }

  /* ── Create Convoy ─────────────────────────────────── */
  function showCreateConvoy() {
    setSheetState('expanded');
    
    sheetContent.innerHTML = `
      <div class="sheet-content-transition">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <button class="btn-icon" id="btn-back-create" aria-label="Go back">
            <span class="material-symbols-rounded">arrow_back</span>
          </button>
          <div class="sheet-title" style="flex: 1;">Create Convoy</div>
        </div>

        <!-- Destination -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">Destination (Optional)</div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-medium); margin-bottom: 20px; cursor: pointer;" id="destination-select">
          <span class="material-symbols-rounded" style="color: var(--md-sys-color-error); font-size: 24px;">place</span>
          <div style="flex: 1;">
            <div class="type-body-large" style="color: var(--md-sys-color-on-surface);">Pune</div>
            <div class="type-body-small" style="color: var(--md-sys-color-on-surface-variant);">Mumbai-Pune Expressway · 150 km</div>
          </div>
          <span class="material-symbols-rounded" style="color: var(--md-sys-color-on-surface-variant);">edit</span>
        </div>

        <!-- Privacy -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">Privacy</div>
        <div class="segmented-button-group" style="margin-bottom: 20px;">
          <button class="segmented-btn" data-privacy="public">
            <span class="material-symbols-rounded" style="font-size: 18px;">public</span>
            Public
          </button>
          <button class="segmented-btn selected" data-privacy="invite_only">
            <span class="material-symbols-rounded" style="font-size: 18px;">lock</span>
            Invite Only
          </button>
          <button class="segmented-btn" data-privacy="link_only">
            <span class="material-symbols-rounded" style="font-size: 18px;">link</span>
            Link Only
          </button>
        </div>

        <!-- Convoy Name -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">Convoy Name</div>
        <div class="text-field" style="margin-bottom: 24px;">
          <input type="text" placeholder=" " value="Mumbai-Pune Road Trip" id="convoy-name-input" aria-label="Convoy name" />
          <label>Give your convoy a name</label>
        </div>

        <!-- Create Button -->
        <button class="btn btn-filled btn-large btn-full-width" id="btn-create-now" style="margin-bottom: 16px;">
          <span class="material-symbols-rounded" style="font-size: 20px;">add_circle</span>
          Create Convoy
        </button>
      </div>
    `;

    /* Privacy toggle */
    const privacyBtns = sheetContent.querySelectorAll('.segmented-btn');
    privacyBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        privacyBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    /* Back button */
    document.getElementById('btn-back-create')?.addEventListener('click', () => showScreen('convoy-hub'));

    /* Create */
    document.getElementById('btn-create-now')?.addEventListener('click', () => {
      const selectedPrivacy = sheetContent.querySelector('.segmented-btn.selected')?.dataset.privacy || 'invite_only';
      ConvoyEngine.createConvoy({
        destination: { lat: 18.5204, lng: 73.8567 },
        destinationName: 'Pune',
        privacy: selectedPrivacy
      });
      showScreen('lobby');
    });
  }

  /* ── Join Convoy ───────────────────────────────────── */
  function showJoinConvoy() {
    setSheetState('expanded');
    
    sheetContent.innerHTML = `
      <div class="sheet-content-transition">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <button class="btn-icon" id="btn-back-join" aria-label="Go back">
            <span class="material-symbols-rounded">arrow_back</span>
          </button>
          <div class="sheet-title" style="flex: 1;">Join Convoy</div>
        </div>

        <!-- Link Entry -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">Enter Convoy Code</div>
        <div style="display: flex; gap: 8px; margin-bottom: 24px;">
          <div class="text-field" style="flex: 1; margin: 0;">
            <input type="text" placeholder=" " id="join-code-input" aria-label="Convoy code" style="text-transform: uppercase; letter-spacing: 2px; font-weight: 600;" />
            <label>CVY-XXXXXX</label>
          </div>
          <button class="btn btn-filled" id="btn-join-code" style="height: 56px;">Join</button>
        </div>

        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
          <div class="divider" style="flex: 1;"></div>
          <span class="type-label-medium" style="color: var(--md-sys-color-on-surface-variant);">or</span>
          <div class="divider" style="flex: 1;"></div>
        </div>

        <!-- QR Scanner -->
        <div class="convoy-menu-item" style="background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-medium); margin-bottom: 8px;" role="button" tabindex="0">
          <div class="menu-icon-circle" style="background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container);">
            <span class="material-symbols-rounded">qr_code_scanner</span>
          </div>
          <div class="menu-text">
            <div class="menu-title">Scan QR Code</div>
            <div class="menu-desc">Point your camera at a convoy QR code</div>
          </div>
        </div>

        <!-- Nearby Discovery -->
        <div class="convoy-menu-item" style="background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-medium); margin-bottom: 8px;" role="button" tabindex="0">
          <div class="menu-icon-circle" style="background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container);">
            <span class="material-symbols-rounded">near_me</span>
          </div>
          <div class="menu-text">
            <div class="menu-title">Nearby Convoys</div>
            <div class="menu-desc">Discover convoys near your location</div>
          </div>
        </div>

        <!-- From Contacts -->
        <div class="convoy-menu-item" style="background: var(--md-sys-color-surface-container); border-radius: var(--md-sys-shape-medium);" role="button" tabindex="0">
          <div class="menu-icon-circle" style="background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container);">
            <span class="material-symbols-rounded">contacts</span>
          </div>
          <div class="menu-text">
            <div class="menu-title">From Contacts</div>
            <div class="menu-desc">Join a convoy shared by a contact</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-back-join')?.addEventListener('click', () => showScreen('convoy-hub'));
    
    /* Simulate joining */
    document.getElementById('btn-join-code')?.addEventListener('click', () => {
      showSnackbar('Joining convoy...', 'hourglass_top');
      setTimeout(() => {
        ConvoyEngine.createConvoy({ destination: { lat: 18.5204, lng: 73.8567 }, destinationName: 'Pune' });
        showScreen('lobby');
      }, 1500);
    });
  }

  /* ── Lobby (Waiting for Members) ───────────────────── */
  function showLobby() {
    setSearchBarVisible(false);
    setSheetState('expanded');
    
    const convoy = ConvoyEngine.getConvoy();
    const inviteLink = ConvoyEngine.getInviteLink();

    sheetContent.innerHTML = `
      <div class="sheet-content-transition">
        <div style="text-align: center; margin-bottom: 20px;">
          <div class="animate-convoy-created" style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: var(--md-sys-color-primary-container); margin-bottom: 12px;">
            <span class="material-symbols-rounded" style="font-size: 32px; color: var(--md-sys-color-on-primary-container);">groups</span>
          </div>
          <div class="type-headline-small" style="color: var(--md-sys-color-on-surface);">Convoy Created!</div>
          <div class="type-body-medium" style="color: var(--md-sys-color-on-surface-variant); margin-top: 4px;">
            Code: <strong style="letter-spacing: 1px;">${convoy.id}</strong>
          </div>
        </div>

        <!-- QR Code -->
        <div class="qr-container" style="margin-bottom: 16px;">
          <div class="qr-code" id="lobby-qr-code"></div>
          <div class="qr-label">Scan to join convoy</div>
        </div>

        <!-- Share Link -->
        <div class="invite-link-box" id="copy-invite-link" style="margin-bottom: 16px;">
          <span class="material-symbols-rounded" style="color: var(--md-sys-color-primary); font-size: 20px;">link</span>
          <span class="invite-url">${inviteLink}</span>
          <span class="material-symbols-rounded" style="color: var(--md-sys-color-on-surface-variant); font-size: 20px;">content_copy</span>
        </div>

        <!-- Share Buttons -->
        <div style="display: flex; gap: 8px; margin-bottom: 20px;">
          <button class="btn btn-filled-tonal btn-full-width" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">share</span>
            Share
          </button>
          <button class="btn btn-outlined btn-full-width" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">near_me</span>
            Nearby
          </button>
        </div>

        <div class="divider" style="margin-bottom: 12px;"></div>

        <!-- Members -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <span class="type-title-small" style="color: var(--md-sys-color-on-surface);">Members</span>
          <span class="type-label-medium" style="color: var(--md-sys-color-on-surface-variant);" id="lobby-member-count">1 joined</span>
        </div>
        <div id="lobby-members-list" class="card-stagger" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 20px;">
          ${ConvoyDashboard.renderMemberCard(ConvoyEngine.getLeader())}
        </div>

        <!-- Activity Feed -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">Activity</div>
        <div class="activity-feed" id="lobby-activity-feed" style="margin-bottom: 20px;"></div>

        <!-- Start Navigation -->
        <button class="btn btn-filled btn-large btn-full-width" id="btn-start-navigation" style="gap: 8px;">
          <span class="material-symbols-rounded" style="font-size: 22px;">navigation</span>
          Start Navigation
        </button>
      </div>
    `;

    /* Generate QR */
    const qrContainer = document.getElementById('lobby-qr-code');
    if (qrContainer) {
      ConvoyUtils.generateQRCode(inviteLink, qrContainer, 180);
    }

    /* Copy link */
    document.getElementById('copy-invite-link')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(inviteLink).catch(() => {});
      showSnackbar('Invite link copied!', 'content_copy');
    });

    /* Initialize activity feed */
    const feedContainer = document.getElementById('lobby-activity-feed');
    ConvoyActivity.init(feedContainer);
    ConvoyActivity.renderFeed(feedContainer);

    /* Listen for member joins */
    const memberJoinHandler = (member) => {
      const membersList = document.getElementById('lobby-members-list');
      const countEl = document.getElementById('lobby-member-count');
      if (membersList) {
        membersList.innerHTML = ConvoyEngine.getMembers().map(m => ConvoyDashboard.renderMemberCard(m)).join('');
      }
      if (countEl) {
        countEl.textContent = `${ConvoyEngine.getMembers().length} joined`;
      }
    };
    bus.on('member:joined', memberJoinHandler);

    /* Add simulated members */
    ConvoyEngine.addSimulatedMembers(5);

    /* Start navigation */
    document.getElementById('btn-start-navigation')?.addEventListener('click', async () => {
      bus.off('member:joined', memberJoinHandler);
      showSnackbar('Initializing navigation...', 'navigation');
      
      /* Initialize route */
      await ConvoyNavigation.initNavigation();

      /* Draw route on map */
      const coords = ConvoyNavigation.getRouteCoordinates();
      if (coords.length > 0) {
        ConvoyMap.drawRoute(coords);
        ConvoyMap.setDestination(coords[coords.length - 1][0], coords[coords.length - 1][1]);
        ConvoyMap.addLeaderMarker(coords[0][0], coords[0][1]);

        /* Place followers clustered at the start line; the sim fans them
           into their single-file formation over the first couple of seconds. */
        ConvoyEngine.getMembers().forEach(m => {
          if (!m.isLeader && coords[0]) {
            const start = ConvoyUtils.addGPSJitter(coords[0][0], coords[0][1], 10);
            ConvoyMap.addFollowerMarker(m, start.lat, start.lng);
            ConvoyEngine.updateMemberPosition(m.id, start, 0, 0);
          }
        });
      }

      ConvoyEngine.beginNavigation();
      ConvoyNavigation.startSimulation();
      ConvoyEngine.startRandomEvents();
      showScreen('active-leader');
    });
  }

  /* ── Active Navigation (Leader) ────────────────────── */
  function showActiveLeader() {
    setSearchBarVisible(false);
    setNavBarVisible(false);
    setNavHeaderActive(true);
    setNavBottomBarActive(true);
    setSheetState('collapsed');
    if (speedIndicator) speedIndicator.style.display = 'flex';

    /* Start nav header updates */
    startNavUpdates();

    /* Render dashboard in sheet */
    ConvoyDashboard.renderLeaderDashboard(sheetContent);

    /* Initialize activity feed in sheet */
    const feedEl = sheetContent.querySelector('.activity-feed');
    if (feedEl) ConvoyActivity.init(feedEl);

    /* Follow leader on map */
    ConvoyMap.followLeader();

    /* Update dashboard periodically */
    ConvoyDashboard.startUpdates(sheetContent, true);
  }

  /* ── Active Navigation (Follower) ──────────────────── */
  function showActiveFollower() {
    setSearchBarVisible(false);
    setNavBarVisible(false);
    setNavHeaderActive(true);
    setNavBottomBarActive(true);
    setSheetState('collapsed');

    startNavUpdates();
    ConvoyDashboard.renderFollowerDashboard(sheetContent);
    ConvoyMap.followLeader();
  }

  /* ── Convoy Ended ──────────────────────────────────── */
  function showConvoyEnded() {
    setNavHeaderActive(false);
    setNavBottomBarActive(false);
    setNavBarVisible(false);
    setSheetState('expanded');
    if (speedIndicator) speedIndicator.style.display = 'none';

    ConvoyNavigation.stopSimulation();
    ConvoyEngine.stopRandomEvents();
    ConvoyDashboard.stopUpdates();
    stopNavUpdates();

    ConvoyDashboard.renderTripSummary(sheetContent);
  }

  /* ── Navigation Header/Bottom Bar Updates ──────────── */
  let navUpdateInterval = null;

  function startNavUpdates() {
    if (navUpdateInterval) clearInterval(navUpdateInterval);
    navUpdateInterval = setInterval(updateNavUI, 500);
    updateNavUI();
  }

  function stopNavUpdates() {
    if (navUpdateInterval) {
      clearInterval(navUpdateInterval);
      navUpdateInterval = null;
    }
  }

  function updateNavUI() {
    const instruction = ConvoyNavigation.getCurrentInstruction();
    const stats = ConvoyNavigation.getNavStats();
    const convoy = ConvoyEngine.getConvoy();

    /* Navigation header */
    if (navHeader && instruction) {
      const turnIcon = document.getElementById('nav-turn-icon');
      const navDirection = document.getElementById('nav-direction');
      const navRoad = document.getElementById('nav-road');
      
      if (turnIcon) turnIcon.textContent = instruction.icon;
      if (navDirection) navDirection.textContent = `${instruction.distanceFormatted}`;
      if (navRoad) navRoad.textContent = `${instruction.label} ${instruction.road}`;
    }

    /* Navigation bottom bar */
    if (navBottomBar) {
      const etaTime = document.getElementById('nav-eta-time');
      const etaLabel = document.getElementById('nav-eta-label');
      const navDist = document.getElementById('nav-distance');
      const memberCountEl = document.getElementById('nav-member-count');
      
      if (etaTime) etaTime.textContent = stats.eta;
      if (etaLabel) etaLabel.textContent = `${stats.distance} · ${stats.speed}`;
      if (navDist) navDist.textContent = stats.distance;
      if (memberCountEl && convoy) memberCountEl.textContent = `${convoy.members.length} members`;

      updateMiniAvatars();
      updateCohesion();
    }

    /* Speed indicator */
    if (speedIndicator) {
      const speedVal = speedIndicator.querySelector('.speed-value');
      if (speedVal) speedVal.textContent = stats.speedKmh || 0;
    }

    /* Follow leader on map (route progress is rendered by the sim tick) */
    const leaderPos = ConvoyNavigation.getLeaderPosition();
    if (leaderPos && cameraFollow) {
      ConvoyMap.panTo(leaderPos.lat, leaderPos.lng);
    }
  }

  /* ── Nav Bar: Mini Avatars + Cohesion ──────────────── */
  let lastAvatarSig = '';
  function updateMiniAvatars() {
    const el = document.getElementById('nav-member-avatars');
    if (!el) return;
    const members = ConvoyEngine.getMembers();
    const shown = members.slice(0, 5);
    const extra = members.length - shown.length;
    /* Rebuild only when membership/status actually changes */
    const sig = shown.map(m => m.id + m.status).join('|') + '+' + extra;
    if (sig === lastAvatarSig) return;
    lastAvatarSig = sig;

    el.innerHTML = shown.map(m => `
      <span class="mini-avatar ${m.status === 'off-route' ? 'off' : ''}"
            style="background: ${m.color};" title="${m.name}">${m.initials}</span>
    `).join('') + (extra > 0 ? `<span class="mini-avatar more">+${extra}</span>` : '');
  }

  function updateCohesion() {
    const el = document.getElementById('convoy-cohesion');
    if (!el) return;
    const c = ConvoyEngine.getCohesion();
    const dot = el.querySelector('.cohesion-dot');
    const label = el.querySelector('.cohesion-label');
    if (dot) dot.style.background = c.color;
    if (label) label.textContent = c.label;
    el.style.color = c.color;
    el.classList.toggle('alert', c.level === 'regroup');
  }

  /* ── Bottom Sheet Drag ─────────────────────────────── */
  function setupSheetDrag() {
    if (!bottomSheet) return;
    
    const dragHandle = bottomSheet.querySelector('.sheet-drag-handle');
    if (!dragHandle) return;

    dragHandle.addEventListener('pointerdown', onDragStart);
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
  }

  function onDragStart(e) {
    isDragging = true;
    dragStartY = e.clientY;
    bottomSheet.style.transition = 'none';
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const deltaY = e.clientY - dragStartY;
    const currentTransform = getComputedStyle(bottomSheet).transform;
    
    /* Apply drag offset */
    bottomSheet.style.transform = `translateY(${Math.max(0, deltaY)}px)`;
  }

  function onDragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    
    const deltaY = e.clientY - dragStartY;
    bottomSheet.style.transition = '';
    bottomSheet.style.transform = '';
    
    if (deltaY > 100) {
      /* Dragged down — collapse or hide */
      if (sheetState === 'expanded') setSheetState('half');
      else if (sheetState === 'half') setSheetState('collapsed');
      else setSheetState('hidden');
    } else if (deltaY < -100) {
      /* Dragged up — expand */
      if (sheetState === 'collapsed') setSheetState('half');
      else if (sheetState === 'half') setSheetState('expanded');
    } else {
      /* Snap back */
      setSheetState(sheetState);
    }
  }

  function setSheetState(state) {
    if (!bottomSheet) return;
    sheetState = state;
    bottomSheet.className = `bottom-sheet ${state}`;
    
    /* Overlay */
    if (sheetOverlay) {
      if (state === 'expanded') {
        sheetOverlay.classList.add('visible');
      } else {
        sheetOverlay.classList.remove('visible');
      }
    }
  }

  /* ── Navigation Bar ────────────────────────────────── */
  function setupNavBar() {
    if (!navBar) return;
    
    const items = navBar.querySelectorAll('.nav-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        const target = item.dataset.target;
        setActiveNavItem(target);
        
        switch (target) {
          case 'explore':
            showScreen('home');
            break;
          case 'convoy':
            showScreen('convoy-hub');
            break;
        }
      });
    });
  }

  function setActiveNavItem(target) {
    if (!navBar) return;
    navBar.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.target === target);
    });
  }

  function setNavBarVisible(visible) {
    if (!navBar) return;
    navBar.classList.toggle('hidden', !visible);
  }

  function setSearchBarVisible(visible) {
    if (!searchBar) return;
    searchBar.style.display = visible ? 'flex' : 'none';
  }

  function setNavHeaderActive(active) {
    if (!navHeader) return;
    navHeader.classList.toggle('active', active);
  }

  function setNavBottomBarActive(active) {
    if (!navBottomBar) return;
    navBottomBar.classList.toggle('active', active);
  }

  /* ── Snackbar ──────────────────────────────────────── */
  function showSnackbar(message, icon = 'info', duration = 3000) {
    if (!snackbarContainer) return;
    
    const snack = document.createElement('div');
    snack.className = 'snackbar';
    snack.innerHTML = `
      <span class="material-symbols-rounded snackbar-icon">${icon}</span>
      <span class="snackbar-text">${message}</span>
    `;
    snackbarContainer.appendChild(snack);

    setTimeout(() => {
      snack.classList.add('dismissing');
      setTimeout(() => snack.remove(), 300);
    }, duration);
  }

  /* ── Announcement Banner ───────────────────────────── */
  function showAnnouncement(message) {
    if (!announcementBanner) return;
    
    const textEl = announcementBanner.querySelector('.announcement-text');
    if (textEl) textEl.textContent = message;
    
    announcementBanner.classList.add('visible');
    
    setTimeout(() => {
      announcementBanner.classList.remove('visible');
    }, 5000);
  }

  /* ── Dialog ────────────────────────────────────────── */
  function showDialog(options) {
    if (!dialogOverlay) return;
    
    const dialog = dialogOverlay.querySelector('.dialog');
    if (!dialog) return;

    dialog.innerHTML = `
      ${options.icon ? `<div class="dialog-icon"><span class="material-symbols-rounded" style="font-size: 28px;">${options.icon}</span></div>` : ''}
      <div class="dialog-title">${options.title}</div>
      <div class="dialog-body">${options.body}</div>
      <div class="dialog-actions">
        ${options.cancelText ? `<button class="btn btn-text dialog-cancel">${options.cancelText}</button>` : ''}
        <button class="btn btn-filled dialog-confirm">${options.confirmText || 'OK'}</button>
      </div>
    `;

    dialogOverlay.classList.add('visible');

    dialog.querySelector('.dialog-cancel')?.addEventListener('click', () => {
      dialogOverlay.classList.remove('visible');
      options.onCancel?.();
    });

    dialog.querySelector('.dialog-confirm')?.addEventListener('click', () => {
      dialogOverlay.classList.remove('visible');
      options.onConfirm?.();
    });
  }

  function hideDialog() {
    if (dialogOverlay) dialogOverlay.classList.remove('visible');
  }

  /* ── Event Listeners ───────────────────────────────── */
  function setupEventListeners() {
    /* Convoy events */
    bus.on('announcement:broadcast', (ann) => {
      showAnnouncement(ann.message);
    });

    bus.on('hazard:reported', (hazard) => {
      if (hazard.position) {
        ConvoyMap.addHazardMarker(hazard.id, hazard.position.lat, hazard.position.lng, hazard.typeInfo);
      }
      showSnackbar(`⚠️ ${hazard.typeInfo.label} reported by ${hazard.reportedBy}`, 'warning', 4000);
    });

    bus.on('navigation:arrived', () => {
      showAnnouncement('🎉 Convoy arrived at the destination');
      showSnackbar('You have arrived — convoy complete', 'flag', 3000);
      setTimeout(() => {
        if (currentScreen === 'active-leader' || currentScreen === 'active-follower') {
          ConvoyEngine.endConvoy();
          showScreen('ended');
        }
      }, 2600);
    });

    bus.on('reroute:started', () => {
      showSnackbar('Hazard ahead — finding a new route...', 'alt_route', 3000);
    });

    bus.on('route:updated', (data) => {
      const addedMin = Math.round((data.addedSeconds || 0) / 60);
      const suffix = addedMin >= 1 ? ` (+${addedMin} min)` : '';
      showSnackbar(`New route — avoiding ${data.hazard.typeInfo.label.toLowerCase()}${suffix}`, 'alt_route', 4000);
    });

    bus.on('regroup:alert', (data) => {
      if (data.count > 0 && data.maxDistance > 600) {
        showSnackbar(`${data.count} member${data.count > 1 ? 's' : ''} falling behind (${ConvoyUtils.formatDistance(data.maxDistance)})`, 'group', 4000);
      }
    });

    bus.on('ui:showAnnouncement', () => {
      showDialog({
        icon: 'campaign',
        title: 'Broadcast Message',
        body: `
          <div style="text-align: left;">
            <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
              ${ConvoyUtils.ANNOUNCEMENT_PRESETS.slice(0, 4).map(p => 
                `<div class="chip" style="cursor: pointer; justify-content: flex-start;" data-preset="${p}">
                  ${p}
                </div>`
              ).join('')}
            </div>
          </div>
        `,
        confirmText: 'Send',
        cancelText: 'Cancel',
        onConfirm: () => {
          ConvoyEngine.broadcast('Fuel stop ahead in 5 km');
        }
      });
    });

    bus.on('ui:showHazardReport', () => {
      showHazardReportSheet();
    });

    bus.on('ui:showEndConfirm', () => {
      showDialog({
        icon: 'warning',
        title: 'End Convoy?',
        body: 'This will end navigation for all convoy members. This action cannot be undone.',
        confirmText: 'End Convoy',
        cancelText: 'Cancel',
        onConfirm: () => {
          ConvoyEngine.endConvoy();
          showScreen('ended');
        }
      });
    });

    bus.on('ui:returnHome', () => {
      ConvoyMap.clearAll();
      showScreen('home');
    });

    /* Sheet overlay click to collapse */
    sheetOverlay?.addEventListener('click', () => {
      if (currentScreen === 'active-leader' || currentScreen === 'active-follower') {
        setSheetState('collapsed');
      } else {
        setSheetState('half');
      }
    });
  }

  /* ── Hazard Report Sheet ───────────────────────────── */
  function showHazardReportSheet() {
    showDialog({
      icon: 'warning',
      title: 'Report Hazard',
      body: `
        <div class="hazard-grid" style="text-align: center;">
          ${ConvoyUtils.HAZARD_TYPES.map(h => `
            <div class="hazard-btn" data-hazard="${h.id}" tabindex="0" role="button" aria-label="Report ${h.label}">
              <span class="material-symbols-rounded hazard-icon" style="color: ${h.color};">${h.icon}</span>
              <span class="hazard-label">${h.label}</span>
            </div>
          `).join('')}
        </div>
      `,
      confirmText: 'Report',
      cancelText: 'Cancel',
      onConfirm: () => {
        const leaderPos = ConvoyNavigation.getLeaderPosition();
        if (leaderPos) {
          ConvoyEngine.reportHazard('construction', leaderPos, 'Aryaman');
        }
      }
    });
  }

  /* ── Ripple Effect ─────────────────────────────────── */
  function addRipple(container, e) {
    if (!container || !container.getBoundingClientRect) return;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = container.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    container.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  /* Apply ripple to all ripple-containers */
  document.addEventListener('click', (e) => {
    const container = e.target.closest('.ripple-container');
    if (container) addRipple(container, e);
  });

  /* ── Public API ────────────────────────────────────── */
  return {
    init, showScreen, recenter,
    showSnackbar, showAnnouncement, showDialog, hideDialog,
    setSheetState, setNavBarVisible,
    currentScreen: () => currentScreen
  };
})();
