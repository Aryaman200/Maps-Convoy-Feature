/* ============================================================
   CONVOY MODE — MAP MODULE
   ============================================================
   Leaflet setup, tile layers, custom markers, route rendering,
   convoy visualization, and map controls.
   ============================================================ */

const ConvoyMap = (() => {
  let map = null;
  let tileLayer = null;
  let darkTileLayer = null;
  let routeLayer = null;
  let markersLayer = null;
  let convoyPathLayer = null;
  
  /* Marker references */
  const markers = {};
  let leaderMarker = null;
  let destinationMarker = null;
  let routePolyline = null;
  let routeOutline = null;
  let traveledPolyline = null;   /* dimmed, already-driven portion */
  let followerRoutes = {};

  /* Tile URLs */
  const TILES = {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  };

  const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

  /* Default center: Mumbai area */
  const DEFAULT_CENTER = [19.0760, 72.8777];
  const DEFAULT_ZOOM = 13;

  /* ── Initialize Map ────────────────────────────────── */
  function init(containerId = 'map') {
    if (map) return map;

    map = L.map(containerId, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      maxZoom: 18,
      minZoom: 5,
    });

    /* Tile layer */
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches &&
       document.documentElement.getAttribute('data-theme') !== 'light');

    tileLayer = L.tileLayer(isDark ? TILES.dark : TILES.light, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 18,
      subdomains: 'abcd'
    }).addTo(map);

    /* Layers */
    routeLayer = L.layerGroup().addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    convoyPathLayer = L.layerGroup().addTo(map);

    /* Fix for initial sizing */
    setTimeout(() => map.invalidateSize(), 100);

    return map;
  }

  /* ── Theme Switching ───────────────────────────────── */
  function setTheme(isDark) {
    if (!map || !tileLayer) return;
    tileLayer.setUrl(isDark ? TILES.dark : TILES.light);
  }

  /* ── Create Custom Marker Icons ────────────────────── */
  function createLeaderIcon() {
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-leader-container">
          <div class="marker-leader-ring-1"></div>
          <div class="marker-leader-ring-2"></div>
          <div class="marker-leader-dot"></div>
          <div class="marker-leader-heading" id="leader-heading-arrow"></div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });
  }

  function createFollowerIcon(member) {
    const isOffRoute = member.status === 'off-route';
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-follower-container">
          <div class="marker-follower-dot ${isOffRoute ? 'off-route' : ''}" 
               style="background: ${member.color};">
            ${member.initials}
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function createHazardIcon(hazardType) {
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-hazard animate-marker-bounce">
          <span class="material-symbols-rounded">${hazardType.icon}</span>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  function createDestinationIcon() {
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-destination">
          <div class="marker-destination-pin">
            <span class="material-symbols-rounded">flag</span>
          </div>
          <div class="marker-destination-shadow"></div>
        </div>
      `,
      iconSize: [28, 36],
      iconAnchor: [14, 36]
    });
  }

  function createPOIIcon(type) {
    const icons = { fuel: 'local_gas_station', rest: 'restaurant', charging: 'ev_station' };
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-poi ${type}">
          <span class="material-symbols-rounded">${icons[type] || 'place'}</span>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function createMeetingIcon() {
    return L.divIcon({
      className: 'convoy-marker',
      html: `
        <div class="marker-meeting">
          <span class="material-symbols-rounded">group</span>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  /* ── Add / Update Markers ──────────────────────────── */
  function addLeaderMarker(lat, lng) {
    if (leaderMarker) {
      leaderMarker.setLatLng([lat, lng]);
    } else {
      leaderMarker = L.marker([lat, lng], { icon: createLeaderIcon(), zIndexOffset: 1000 });
      leaderMarker.addTo(markersLayer);
    }
    return leaderMarker;
  }

  function updateLeaderPosition(lat, lng, heading) {
    if (!leaderMarker) return addLeaderMarker(lat, lng);

    /* Smooth move — short ease bridges the 10 Hz sim frames without lag */
    const current = leaderMarker.getLatLng();
    animateMarker(leaderMarker, current, { lat, lng }, 220);
    
    /* Update heading arrow */
    const arrow = document.getElementById('leader-heading-arrow');
    if (arrow && heading !== undefined) {
      arrow.style.setProperty('--heading', `${heading}deg`);
      arrow.style.transform = `translateX(-50%) rotate(${heading}deg)`;
    }
  }

  function addFollowerMarker(member, lat, lng) {
    if (markers[member.id]) {
      markers[member.id].setLatLng([lat, lng]);
      markers[member.id].setIcon(createFollowerIcon(member));
    } else {
      markers[member.id] = L.marker([lat, lng], { 
        icon: createFollowerIcon(member),
        zIndexOffset: 500 
      });
      markers[member.id].addTo(markersLayer);
      
      /* Tooltip */
      markers[member.id].bindTooltip(member.firstName, {
        permanent: false,
        direction: 'top',
        offset: [0, -20],
        className: 'marker-tooltip-leaflet'
      });
    }
    return markers[member.id];
  }

  function updateFollowerPosition(memberId, lat, lng, member) {
    if (!markers[memberId]) return;
    const current = markers[memberId].getLatLng();
    animateMarker(markers[memberId], current, { lat, lng }, 220);
    /* Only rebuild the icon when the off-route flag actually changes */
    if (member) {
      const wasOff = markers[memberId]._offRoute;
      const isOff = member.status === 'off-route';
      if (wasOff !== isOff) {
        markers[memberId].setIcon(createFollowerIcon(member));
        markers[memberId]._offRoute = isOff;
      }
    }
  }

  function removeMarker(id) {
    if (markers[id]) {
      markersLayer.removeLayer(markers[id]);
      delete markers[id];
    }
  }

  /* ── Animate Marker Movement ───────────────────────── */
  function animateMarker(marker, from, to, duration) {
    const start = performance.now();
    
    function step(timestamp) {
      const elapsed = timestamp - start;
      const t = Math.min(elapsed / duration, 1);
      /* Ease out cubic */
      const eased = 1 - Math.pow(1 - t, 3);
      
      const lat = from.lat + (to.lat - from.lat) * eased;
      const lng = (from.lng || from.lon) + ((to.lng || to.lon) - (from.lng || from.lon)) * eased;
      
      marker.setLatLng([lat, lng]);
      
      if (t < 1) {
        requestAnimationFrame(step);
      }
    }
    
    requestAnimationFrame(step);
  }

  /* ── Route Drawing ────────────────────────────────── */
  function drawRoute(coordinates, options = {}) {
    clearRoute();
    
    const {
      color = '#4285f4',
      weight = 6,
      opacity = 1,
      dashArray = null,
      isOutline = false
    } = options;

    /* Route outline */
    if (!isOutline) {
      routeOutline = L.polyline(coordinates, {
        color: color,
        weight: weight + 4,
        opacity: 0.3,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(routeLayer);
    }

    /* Main route */
    routePolyline = L.polyline(coordinates, {
      color: color,
      weight: weight,
      opacity: opacity,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: dashArray
    }).addTo(routeLayer);

    return routePolyline;
  }

  function drawFollowerRoute(memberId, coordinates) {
    if (followerRoutes[memberId]) {
      routeLayer.removeLayer(followerRoutes[memberId]);
    }
    
    followerRoutes[memberId] = L.polyline(coordinates, {
      color: '#4285f4',
      weight: 4,
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '8 8'
    }).addTo(routeLayer);
  }

  function clearRoute() {
    if (routePolyline) { routeLayer.removeLayer(routePolyline); routePolyline = null; }
    if (routeOutline) { routeLayer.removeLayer(routeOutline); routeOutline = null; }
    if (traveledPolyline) { routeLayer.removeLayer(traveledPolyline); traveledPolyline = null; }
    Object.keys(followerRoutes).forEach(id => {
      routeLayer.removeLayer(followerRoutes[id]);
    });
    followerRoutes = {};
  }

  /* Google-Maps-style progress: dim the traveled portion, keep the
     remaining portion vivid blue. Driven by the navigation sim with
     pre-sliced polylines (distance-accurate, no re-projection here). */
  function setRouteProgress(traveledCoords, remainingCoords) {
    if (remainingCoords && remainingCoords.length > 1) {
      if (routePolyline) routePolyline.setLatLngs(remainingCoords);
      if (routeOutline) routeOutline.setLatLngs(remainingCoords);
    }
    if (traveledCoords && traveledCoords.length > 1) {
      if (!traveledPolyline) {
        traveledPolyline = L.polyline(traveledCoords, {
          color: '#9aa0a6',
          weight: 6,
          opacity: 0.55,
          lineCap: 'round',
          lineJoin: 'round',
        });
        traveledPolyline.addTo(routeLayer);
        if (routeOutline) routeOutline.bringToFront();
        if (routePolyline) routePolyline.bringToFront();
      } else {
        traveledPolyline.setLatLngs(traveledCoords);
      }
    }
  }

  /* ── Hazard Markers ────────────────────────────────── */
  function addHazardMarker(id, lat, lng, hazardType) {
    const marker = L.marker([lat, lng], {
      icon: createHazardIcon(hazardType),
      zIndexOffset: 800
    });
    marker.addTo(markersLayer);
    markers[`hazard_${id}`] = marker;
    return marker;
  }

  /* ── Destination Marker ────────────────────────────── */
  function setDestination(lat, lng) {
    if (destinationMarker) {
      destinationMarker.setLatLng([lat, lng]);
    } else {
      destinationMarker = L.marker([lat, lng], { 
        icon: createDestinationIcon(),
        zIndexOffset: 900 
      });
      destinationMarker.addTo(markersLayer);
    }
    return destinationMarker;
  }

  /* ── POI Markers ───────────────────────────────────── */
  function addPOI(id, lat, lng, type) {
    const marker = L.marker([lat, lng], {
      icon: createPOIIcon(type),
      zIndexOffset: 200
    });
    marker.addTo(markersLayer);
    markers[`poi_${id}`] = marker;
    return marker;
  }

  /* ── Map View Controls ─────────────────────────────── */
  function panTo(lat, lng, zoom) {
    if (!map) return;
    map.setView([lat, lng], zoom || map.getZoom(), { animate: true, duration: 0.8 });
  }

  function fitMembers(memberPositions) {
    if (!map || memberPositions.length === 0) return;
    const bounds = L.latLngBounds(memberPositions.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true });
  }

  function followLeader() {
    if (leaderMarker) {
      map.setView(leaderMarker.getLatLng(), map.getZoom(), { animate: true, duration: 0.5 });
    }
  }

  function getCenter() {
    return map ? map.getCenter() : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
  }

  function getZoom() {
    return map ? map.getZoom() : DEFAULT_ZOOM;
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 50);
  }

  /* ── Clear All ─────────────────────────────────────── */
  function clearAll() {
    markersLayer.clearLayers();
    routeLayer.clearLayers();
    convoyPathLayer.clearLayers();
    leaderMarker = null;
    destinationMarker = null;
    routePolyline = null;
    routeOutline = null;
    followerRoutes = {};
    Object.keys(markers).forEach(k => delete markers[k]);
  }

  /* ── Public API ────────────────────────────────────── */
  return {
    init, setTheme, getMap: () => map,
    addLeaderMarker, updateLeaderPosition,
    addFollowerMarker, updateFollowerPosition, removeMarker,
    drawRoute, drawFollowerRoute, clearRoute, setRouteProgress,
    addHazardMarker, setDestination, addPOI,
    panTo, fitMembers, followLeader, getCenter, getZoom, invalidateSize,
    clearAll,
    DEFAULT_CENTER, DEFAULT_ZOOM,
    animateMarker
  };
})();
