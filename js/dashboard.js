/* ============================================================
   CONVOY MODE — DASHBOARD
   ============================================================
   Leader and follower dashboard rendering, member cards,
   convoy health, quick actions, and statistics.
   ============================================================ */

const ConvoyDashboard = (() => {
  const bus = ConvoyEngine.bus;
  let dashboardInterval = null;

  /* ── Render Member Card ────────────────────────────── */
  function renderMemberCard(member) {
    const statusClass = member.status.replace(' ', '-');
    const statusLabel = {
      'following': 'Following',
      'stopped': 'Stopped',
      'off-route': 'Off Route',
      'disconnected': 'Disconnected',
      'rejoining': 'Rejoining',
      'waiting': 'Waiting'
    }[member.status] || member.status;

    const connBars = Math.ceil(member.connectionQuality * 4);
    const distText = member.isLeader ? 'Leader' : ConvoyUtils.formatDistance(member.distanceBehind);
    const speedText = member.speed ? ConvoyUtils.formatSpeed(member.speed) : '--';

    return `
      <div class="member-card" data-member-id="${member.id}" role="button" tabindex="0" aria-label="${member.name}, ${statusLabel}">
        <div class="member-avatar" style="background: ${member.color};">
          ${member.initials}
          ${member.isLeader ? '<span class="leader-crown">👑</span>' : ''}
        </div>
        <div class="member-info">
          <div class="member-name">${member.name}${member.isLeader ? ' (You)' : ''}</div>
          <div class="member-meta">
            <span>${distText}</span>
            <span>·</span>
            <span>${speedText}</span>
            ${!member.isLeader ? `<span>·</span><span>${member.battery}%</span>` : ''}
          </div>
        </div>
        <div class="member-status-right">
          <span class="status-badge ${statusClass}">
            <span class="status-dot ${member.status === 'following' ? 'animated' : ''}"></span>
            ${statusLabel}
          </span>
          ${!member.isLeader ? `
            <div class="connection-bars" title="Connection: ${Math.round(member.connectionQuality * 100)}%">
              ${[1,2,3,4].map(i => `<div class="connection-bar ${i <= connBars ? 'active' : ''}"></div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /* ── Render Leader Dashboard ───────────────────────── */
  function renderLeaderDashboard(container) {
    const convoy = ConvoyEngine.getConvoy();
    if (!convoy) return;

    const members = ConvoyEngine.getMembers();
    const stats = ConvoyEngine.getStats();
    const navStats = ConvoyNavigation.getNavStats();

    container.innerHTML = `
      <div class="sheet-content-transition">
        <!-- Convoy Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <div>
            <div class="type-title-large" style="color: var(--md-sys-color-on-surface);">Convoy ${convoy.id}</div>
            <div class="type-body-small" style="color: var(--md-sys-color-on-surface-variant); margin-top: 2px;">
              ${members.length} member${members.length !== 1 ? 's' : ''} · ${ConvoyUtils.formatDuration(stats.elapsedTime)}
            </div>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn-icon" id="btn-dashboard-overview" title="Overview" aria-label="Convoy overview">
              <span class="material-symbols-rounded">map</span>
            </button>
            <button class="btn-icon" id="btn-dashboard-settings" title="Settings" aria-label="Convoy settings">
              <span class="material-symbols-rounded">settings</span>
            </button>
          </div>
        </div>

        <!-- Quick Stats -->
        <div style="display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto;" class="chip-row">
          <div class="chip selected">
            <span class="chip-icon material-symbols-rounded">speed</span>
            ${navStats.speed}
          </div>
          <div class="chip selected">
            <span class="chip-icon material-symbols-rounded">route</span>
            ${navStats.distance}
          </div>
          <div class="chip selected">
            <span class="chip-icon material-symbols-rounded">schedule</span>
            ETA ${navStats.eta}
          </div>
        </div>

        <!-- Quick Actions -->
        <div style="display: flex; gap: 8px; margin-bottom: 20px;">
          <button class="btn btn-filled-tonal" id="btn-broadcast" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">campaign</span>
            Announce
          </button>
          <button class="btn btn-outlined" id="btn-regroup" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">group</span>
            Regroup
          </button>
          <button class="btn btn-outlined" id="btn-hazard-report" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">warning</span>
            Hazard
          </button>
        </div>

        <div class="divider" style="margin-bottom: 12px;"></div>

        <!-- Members Section -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <span class="type-title-small" style="color: var(--md-sys-color-on-surface);">Members</span>
          <span class="type-label-small" style="color: var(--md-sys-color-on-surface-variant);">
            ${members.filter(m => m.status === 'following').length}/${members.length} following
          </span>
        </div>
        
        <div class="card-stagger" id="members-list" style="display: flex; flex-direction: column; gap: 4px;">
          ${members.map(m => renderMemberCard(m)).join('')}
        </div>

        <!-- Convoy Actions -->
        <div class="divider" style="margin: 16px 0 12px;"></div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outlined btn-full-width" id="btn-pause-convoy" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">pause</span>
            Pause
          </button>
          <button class="btn btn-danger btn-full-width" id="btn-end-convoy" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">stop</span>
            End Convoy
          </button>
        </div>
      </div>
    `;

    /* Bind actions */
    bindDashboardActions(container);
  }

  /* ── Render Follower Dashboard ─────────────────────── */
  function renderFollowerDashboard(container) {
    const convoy = ConvoyEngine.getConvoy();
    if (!convoy) return;

    const leader = ConvoyEngine.getLeader();
    const navStats = ConvoyNavigation.getNavStats();

    container.innerHTML = `
      <div class="sheet-content-transition">
        <!-- Following Banner -->
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--md-sys-color-primary-container); border-radius: var(--md-sys-shape-medium); margin-bottom: 16px;">
          <div class="member-avatar" style="background: ${leader.color}; width: 36px; height: 36px; font-size: 13px;">
            ${leader.initials}
          </div>
          <div style="flex: 1;">
            <div class="type-label-large" style="color: var(--md-sys-color-on-primary-container);">
              Following ${leader.firstName}
            </div>
            <div class="type-body-small" style="color: var(--md-sys-color-on-primary-container); opacity: 0.8;">
              ${navStats.distance} · ETA ${navStats.eta}
            </div>
          </div>
          <span class="material-symbols-rounded" style="color: var(--md-sys-color-on-primary-container); font-size: 24px;">navigation</span>
        </div>

        <!-- Your Status -->
        <div class="type-title-small" style="color: var(--md-sys-color-on-surface); margin-bottom: 12px;">Your Status</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
          <div class="trip-stat">
            <div class="stat-value">${navStats.speedKmh || 0}</div>
            <div class="stat-label">km/h</div>
          </div>
          <div class="trip-stat">
            <div class="stat-value">${convoy.members.length}</div>
            <div class="stat-label">members</div>
          </div>
        </div>

        <!-- Actions -->
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outlined btn-full-width" id="btn-report-hazard-follower" style="flex: 1;">
            <span class="material-symbols-rounded" style="font-size: 18px;">warning</span>
            Report Hazard
          </button>
          <button class="btn btn-text btn-full-width" id="btn-leave-convoy" style="flex: 1; color: var(--md-sys-color-error);">
            <span class="material-symbols-rounded" style="font-size: 18px;">logout</span>
            Leave
          </button>
        </div>
      </div>
    `;
  }

  /* ── Update Dashboard (called on interval) ─────────── */
  function updateDashboard() {
    const membersList = document.getElementById('members-list');
    if (!membersList) return;

    const members = ConvoyEngine.getMembers();
    membersList.innerHTML = members.map(m => renderMemberCard(m)).join('');
  }

  function startUpdates(container, isLeader = true) {
    if (dashboardInterval) clearInterval(dashboardInterval);
    dashboardInterval = setInterval(() => {
      if (isLeader) {
        renderLeaderDashboard(container);
      } else {
        updateDashboard();
      }
    }, 2000);
  }

  function stopUpdates() {
    if (dashboardInterval) {
      clearInterval(dashboardInterval);
      dashboardInterval = null;
    }
  }

  /* ── Bind Dashboard Actions ────────────────────────── */
  function bindDashboardActions(container) {
    const broadcastBtn = container.querySelector('#btn-broadcast');
    if (broadcastBtn) {
      broadcastBtn.addEventListener('click', () => {
        bus.emit('ui:showAnnouncement');
      });
    }

    const regroupBtn = container.querySelector('#btn-regroup');
    if (regroupBtn) {
      regroupBtn.addEventListener('click', () => {
        ConvoyEngine.broadcast('Everyone regroup — stay together');
        ConvoyEngine.addActivity('regroup', '<strong>Leader</strong> requested regroup', '#4285f4');
      });
    }

    const hazardBtn = container.querySelector('#btn-hazard-report');
    if (hazardBtn) {
      hazardBtn.addEventListener('click', () => {
        bus.emit('ui:showHazardReport');
      });
    }

    const pauseBtn = container.querySelector('#btn-pause-convoy');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        const state = ConvoyEngine.getState();
        if (state === ConvoyEngine.STATES.ACTIVE) {
          ConvoyEngine.pauseConvoy();
          ConvoyNavigation.stopSimulation();
        } else if (state === ConvoyEngine.STATES.PAUSED) {
          ConvoyEngine.resumeConvoy();
          ConvoyNavigation.startSimulation();
        }
      });
    }

    const endBtn = container.querySelector('#btn-end-convoy');
    if (endBtn) {
      endBtn.addEventListener('click', () => {
        bus.emit('ui:showEndConfirm');
      });
    }

    const overviewBtn = container.querySelector('#btn-dashboard-overview');
    if (overviewBtn) {
      overviewBtn.addEventListener('click', () => {
        /* Fit all members in view */
        const members = ConvoyEngine.getMembers().filter(m => m.position);
        if (members.length > 0) {
          ConvoyMap.fitMembers(members.map(m => m.position));
        }
      });
    }
  }

  /* ── Render Trip Summary (End Screen) ──────────────── */
  function renderTripSummary(container) {
    const stats = ConvoyEngine.getStats();
    const convoy = ConvoyEngine.getConvoy();

    container.innerHTML = `
      <div class="sheet-content-transition" style="text-align: center;">
        <div style="margin-bottom: 24px;">
          <span class="material-symbols-rounded animate-convoy-created" style="font-size: 64px; color: var(--md-sys-color-primary);">check_circle</span>
        </div>
        <div class="type-headline-medium" style="color: var(--md-sys-color-on-surface); margin-bottom: 8px;">
          Convoy Complete
        </div>
        <div class="type-body-medium" style="color: var(--md-sys-color-on-surface-variant); margin-bottom: 24px;">
          ${convoy.id} · ${convoy.members.length} members
        </div>
        
        <div class="trip-stat-grid" style="margin-bottom: 24px;">
          <div class="trip-stat">
            <div class="stat-value">${ConvoyUtils.formatDuration(stats.elapsedTime)}</div>
            <div class="stat-label">Duration</div>
          </div>
          <div class="trip-stat">
            <div class="stat-value">${ConvoyUtils.formatDistance(stats.totalDistance || stats.elapsedTime * 16)}</div>
            <div class="stat-label">Distance</div>
          </div>
          <div class="trip-stat">
            <div class="stat-value">${Math.round((stats.maxSpeed || 16.67) * 3.6)}</div>
            <div class="stat-label">Max Speed (km/h)</div>
          </div>
          <div class="trip-stat">
            <div class="stat-value">${stats.memberCount}</div>
            <div class="stat-label">Members</div>
          </div>
        </div>

        <button class="btn btn-filled btn-large btn-full-width" id="btn-done-summary">
          Done
        </button>
      </div>
    `;

    const doneBtn = container.querySelector('#btn-done-summary');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => bus.emit('ui:returnHome'));
    }
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    renderLeaderDashboard, renderFollowerDashboard,
    renderTripSummary, updateDashboard,
    startUpdates, stopUpdates, renderMemberCard
  };
})();
