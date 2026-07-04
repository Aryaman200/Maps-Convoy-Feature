/* ============================================================
   CONVOY MODE — ACTIVITY FEED
   ============================================================
   Live scrolling activity feed with timestamps, icons,
   and auto-update for convoy events.
   ============================================================ */

const ConvoyActivity = (() => {
  const bus = ConvoyEngine.bus;
  let feedContainer = null;
  let maxItems = 50;

  /* ── Initialize Feed ───────────────────────────────── */
  function init(container) {
    feedContainer = container;
    
    /* Listen for new activities */
    bus.on('activity:new', (entry) => {
      addFeedItem(entry);
    });
  }

  /* ── Add Feed Item ─────────────────────────────────── */
  function addFeedItem(entry) {
    if (!feedContainer) return;

    const item = document.createElement('div');
    item.className = 'activity-item animate-float-up';
    item.setAttribute('role', 'log');
    item.setAttribute('aria-label', entry.message.replace(/<[^>]*>/g, ''));

    const iconBg = entry.color + '20'; /* 12% opacity */

    item.innerHTML = `
      <div class="activity-icon" style="background: ${iconBg};">
        <span class="material-symbols-rounded" style="color: ${entry.color};">${entry.icon}</span>
      </div>
      <div class="activity-content">
        <div class="activity-text">${entry.message}</div>
        <div class="activity-time">${ConvoyUtils.timeAgo(entry.timestamp)}</div>
      </div>
    `;

    /* Insert at top */
    if (feedContainer.firstChild) {
      feedContainer.insertBefore(item, feedContainer.firstChild);
    } else {
      feedContainer.appendChild(item);
    }

    /* Limit items */
    while (feedContainer.children.length > maxItems) {
      feedContainer.removeChild(feedContainer.lastChild);
    }
  }

  /* ── Render Full Feed ──────────────────────────────── */
  function renderFeed(container) {
    feedContainer = container;
    const convoy = ConvoyEngine.getConvoy();
    if (!convoy) return;

    container.innerHTML = '';
    
    if (convoy.activityLog.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">feed</span>
          <div class="empty-title">No activity yet</div>
          <div class="empty-desc">Events will appear here as the convoy progresses</div>
        </div>
      `;
      return;
    }

    convoy.activityLog.forEach(entry => {
      const iconBg = entry.color + '20';
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML = `
        <div class="activity-icon" style="background: ${iconBg};">
          <span class="material-symbols-rounded" style="color: ${entry.color};">${entry.icon}</span>
        </div>
        <div class="activity-content">
          <div class="activity-text">${entry.message}</div>
          <div class="activity-time">${ConvoyUtils.timeAgo(entry.timestamp)}</div>
        </div>
      `;
      container.appendChild(item);
    });
  }

  /* ── Update Timestamps ─────────────────────────────── */
  function updateTimestamps() {
    if (!feedContainer) return;
    const times = feedContainer.querySelectorAll('.activity-time');
    const convoy = ConvoyEngine.getConvoy();
    if (!convoy) return;

    times.forEach((el, idx) => {
      if (convoy.activityLog[idx]) {
        el.textContent = ConvoyUtils.timeAgo(convoy.activityLog[idx].timestamp);
      }
    });
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    init, addFeedItem, renderFeed, updateTimestamps
  };
})();
