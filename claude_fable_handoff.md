# Google Maps — Convoy Mode: Project Handoff

This document contains an in-depth summary of the work completed so far on the Google Maps "Convoy Mode" feature prototype, as well as a detailed implementation plan of the architecture, components, and logic. This can be used to onboard another developer or AI (like Claude Fable) onto the project.

---

## 1. Project Summary So Far

**Objective:** Design and implement a new first-party Google Maps feature called **Convoy Mode**, allowing one user (the leader) to guide multiple participants in real-time. The goal is to transform navigation into a synchronized group experience without manual coordination.

### What Has Been Built
We have successfully built a fully interactive, production-quality web prototype that faithfully recreates the Google Maps UI and adds the complete Convoy Mode experience.

1. **Material Design 3 (M3) Foundation:**
   - Created a complete M3 token system (`design-system.css`) supporting both Light and Dark modes.
   - Built a robust component library (`components.css`) including bottom sheets, FABs, cards, chips, navigation bars, and search bars styled exactly like Google Maps.
   - Added micro-interactions and transition animations (`animations.css`) for sheet dragging, ripples, and marker pulsing.

2. **Map Engine & UI Controller:**
   - Integrated **Leaflet.js** (`map.js`) using custom Google Maps-like tile layers (OpenStreetMap/CartoDB).
   - Created custom DOM-based markers for the Leader (blue beacon with heading) and Followers (colored avatar dots), as well as Hazard markers.
   - Built a UI Controller (`ui.js`) to manage screen transitions, bottom sheet swipe physics, dialogs, snackbars, and dynamic state changes.

3. **Convoy Engine (State Machine):**
   - Implemented a state machine (`convoy.js`) that handles the full lifecycle: `IDLE` → `CREATING` → `LOBBY` → `ACTIVE` → `PAUSED` → `ENDED`.
   - Built member management to handle roles (Leader, Follower), statuses (Following, Stopped, Off Route, Disconnected), and activity logs.

4. **Navigation & Simulation Engine:**
   - Built a navigation module (`navigation.js`) that fetches real road-snapped routes using the OSRM API (falling back to a generated Mumbai-Pune Expressway route).
   - Created a **10Hz Simulation Loop** that moves the Leader smoothly along the polyline.
   - Programmed Followers to intelligently trail the leader based on follow delays, speed variances, and GPS jitter, simulating real-world driving conditions.
   - Added predictive routing to generate dynamic ETA, distance, and turn-by-turn instruction updates.

5. **Dashboards & Activity:**
   - Created a Leader Dashboard and Follower Dashboard (`dashboard.js`) that display member cards with distance behind, speed, battery, and connection quality.
   - Built a live scrolling Activity Feed (`activity.js`) to log events like members joining, dropping off-route, or hazard reports.

6. **Testing & Verification:**
   - The UI runs flawlessly in both Light and Dark mode.
   - Tested full UX flows: Convoy Hub → Create Convoy → Lobby (QR Code Generation) → Active Navigation → Convoy Summary.
   - Demonstrated simulated events (e.g., a member falling behind, a hazard being reported on the route).

---

## 2. In-Depth Implementation Plan & Architecture Architecture

If you are continuing work on this codebase, expanding its features, or integrating it into a larger system, refer to the following architectural breakdown.

### Tech Stack
- **Frontend:** Vanilla HTML5, CSS3 (variables/tokens), JavaScript (ES6 Modules/IIFE pattern). No build tools (Webpack/Vite) to maintain rapid iteration.
- **Mapping:** Leaflet.js (via CDN).
- **Icons & Fonts:** Google Material Symbols, Google Fonts (Inter/Google Sans).
- **Routing Data:** OSRM (Open Source Routing Machine) Demo API.
- **Utilities:** `qrcode.js` for invite generation.

### File Structure & Modules

```text
project-root/
├── index.html              # Main entry point containing all DOM structures (hidden/shown via UI controller)
├── css/
│   ├── design-system.css   # M3 design tokens (colors, typography, elevation, spacing)
│   ├── components.css      # Reusable UI components (bottom sheets, FABs, cards, dialogs)
│   ├── animations.css      # CSS Keyframes, transitions, and ripple effects
│   └── map.css             # Leaflet overrides, custom marker styling
└── js/
    ├── app.js              # Bootstraps the app, handles theme toggling and keyboard shortcuts
    ├── utils.js            # Math (Haversine), formatting, geo-jitter, ID generators
    ├── map.js              # Leaflet integration, polyline drawing, map viewport control
    ├── convoy.js           # Core state machine, member CRUD, event bus, random simulation events
    ├── navigation.js       # Route fetching, GPS simulation loop (10Hz), predictive routing
    ├── ui.js               # Screen routing, bottom sheet physics, snackbars, event listeners
    ├── dashboard.js        # Renders the UI for leader/follower views and stats updates
    └── activity.js         # Manages the scrolling event feed in the lobby and dashboard
```

### Core Logic Flows

#### 1. State Management & Event Bus
The application uses a custom lightweight event bus (`ConvoyUtils.EventBus`) initialized in `convoy.js`.
- Modules emit events (e.g., `bus.emit('member:joined', member)`) instead of tightly coupling to UI elements.
- `ui.js` and `activity.js` listen to these events to update the DOM reactively.

#### 2. GPS Simulation & Movement (`navigation.js`)
Since there is no actual backend or real GPS hardware, the movement is mathematically simulated:
- **Leader Movement:** The leader progresses along the coordinate array (`routeCoordinates`) based on a calculated `distanceThisTick` using `leaderSpeed * deltaTime`. Position is linearly interpolated between polyline vertices.
- **Follower Movement:** Followers track a "target progress" index that is intentionally delayed behind the leader (`leaderProgress - followDelay`). They apply an easing function to smoothly catch up to their target, with added Perlin-like noise (`ConvoyUtils.addGPSJitter`) for realism.

#### 3. Bottom Sheet Physics (`ui.js`)
The core Google Maps interaction paradigm is the Bottom Sheet.
- Touch/pointer events (`pointerdown`, `pointermove`, `pointerup`) are captured on the `.sheet-drag-handle`.
- Depending on the Y-delta, the sheet snaps to three distinct CSS states: `.collapsed` (header only), `.half` (50vh), or `.expanded` (92vh).

### Next Steps & Expansion Possibilities

If Claude Fable is taking over, here are the logical next features to implement or expand upon:

1. **WebSockets Integration (Backend Sync):**
   - Replace the simulation loop in `navigation.js` with a Socket.io or WebRTC connection.
   - Broadcast actual `Geolocation API` coordinates to a central Node.js/Redis server, and broadcast to all convoy members.
2. ~~**Audio Turn-by-Turn & Voice Chat:**~~ ✅ **Voice guidance implemented** (see update below). WebRTC push-to-talk remains open.
3. ~~**Dynamic Re-routing:**~~ ✅ **Implemented** (see update below).
4. **Android/iOS Wrap:**
   - Package the Vanilla JS application into Capacitor/Ionic to access native GPS background permissions and battery optimizations.

---

## 3. Update — July 2026 (Claude Fable)

Two of the four expansion items were implemented on top of the original prototype:

### Voice Guidance (`js/voice.js`, new module `ConvoyVoice`)
- Web Speech API (`speechSynthesis`) wrapper preferring an `en-IN` / Google English voice.
- **Spoken turn-by-turn:** polls `ConvoyNavigation.getCurrentInstruction()` once per second while navigation is active and announces each maneuver at 2 km / 1 km / 500 m / 200 m thresholds (each threshold spoken once per step).
- **Spoken convoy events** via the event bus: navigation started/paused/resumed/ended, member joins (lobby only), off-route / stopped / back-on-route status changes, falling-behind alerts (45 s cooldown), hazard reports, leader announcements, and reroutes.
- **Mute toggle:** new `#voice-toggle` FAB under the theme toggle (also keyboard shortcut `V`), state persisted via `ConvoyUtils.saveToStorage('voice_enabled')`.

### Dynamic Re-routing (`js/navigation.js`)
- Listens for `hazard:reported`. A reroute triggers only when the hazard is within 300 m of the remaining polyline and ahead of the leader (30 s cooldown between reroutes).
- Fetches a detour from OSRM via `fetchRouteVia([leaderPos, detourPoint, destination])`, where the detour point is a 1.2 km perpendicular offset from the hazard. Falls back to `generateGeometricDetour()` (bell-curve lateral bend of the remaining route) when OSRM is unreachable.
- `applyNewRoute()` splices the new geometry in at the leader's position while **keeping the already-traveled prefix**, so follower progress indices stay valid and nobody teleports. Route stats, turn steps (with a synthetic prefix step), map polyline, and destination marker are all updated.
- New bus events: `reroute:started` and `route:updated { hazard, addedSeconds }` — consumed by `ui.js` (snackbars), `voice.js` (spoken alerts), and the activity log (`reroute` / `alt_route` icon).
- The scripted demo hazard (25 s into navigation, `convoy.js`) now uses `getPredictedLeaderPosition(60)` so it lands **on** the route and reliably demos an automatic reroute.

**Verified end-to-end** in the browser: create → lobby → active navigation → hazard on route → OSRM detour drawn around the closure marker → ETA/instructions continue correctly; no console errors; mute toggle persists.

---

## 4. Update — July 2026 (part 2): Road-Snapping Rewrite + Polish

The movement engine was rebuilt so the **leader and every follower stay glued to real roads**, plus several "make it feel like real Google Maps" polish systems. This was a substantial refactor of `navigation.js` and its neighbors.

### Root cause of the "not following roads" bug
- The old fallback route (`generateDetailedRoute`) drew **straight diagonal lines** between 9 waypoints — whenever the flaky OSRM demo server failed, the whole convoy cut across the map.
- Followers moved by a **fractional array index** with arbitrary `/50` scaling factors plus GPS jitter — physically meaningless and prone to drifting off the line.

### New architecture — everything is parameterized by *distance along the route*
- **`js/route-data.js` (new, `ConvoyRouteData`):** a real 379-point road-snapped Mumbai→Pune polyline (Atal Setu + old Mumbai-Pune highway) captured from OSRM and Douglas-Peucker-simplified to 12 m tolerance, plus 37 genuine OSRM turn steps. This is the **guaranteed** fallback, so the convoy follows real roads even fully offline.
- **`js/route-model.js` (new, `makeConvoyRoute()` → `ConvoyRoute`):** a polyline with a cumulative-distance table. Key methods: `positionAt(meters)` → `{lat,lng,heading}`, `nearestDistance(pos)` (segment-projection, accurate), `sliceTo/sliceFrom(meters)` for rendering, `stepAt(meters)` for turn-by-turn, `lateralOffset(meters, offset)` for lane staggering.
- **`js/navigation.js` (rewritten):** leader advances `leaderDist += speed·dt`; each follower holds an **elastic single-file formation** — a target gap of `slot × ~42 m` that it eases toward (time-constant 2.6 s) with a gentle "breathing" oscillation and a ±3–5 m L/R lane stagger so markers never perfectly stack. Everyone's on-road position comes straight from `ConvoyRoute.positionAt`, so **perpendicular distance to the road is ~0 m for the leader and 3–4 m (the intentional stagger) for followers** (measured). Off-route members drift ~85 m off the carriageway and rejoin smoothly.
- **Robust routing:** live OSRM fetches now use an `AbortController` 6 s timeout and fall back to the embedded route on any failure. Rerouting rebuilt on the distance model: `applyDetour()` splices `sliceTo(leaderDist)` + the detour so the driven prefix is untouched and followers keep their positions.
- **Speed model:** cruise ~60 km/h with mild variation, easing off approaching turns (sharper easing for hard turns).

### Polish / new systems
- **Google-style route progress:** `ConvoyMap.setRouteProgress(traveled, remaining)` dims the already-driven portion (gray) and keeps the road ahead vivid blue, updated from the sim (`sliceTo`/`sliceFrom`) — replaces the old index-based `updateRouteProgress`.
- **Convoy cohesion system:** `ConvoyEngine.getCohesion()` grades how tight the convoy is (Tight / Holding / Spread out / Regroup) from the max along-route gap. Rendered as a live colored pill in the nav bar, next to newly-populated mini member avatars.
- **Arrival handling:** reaching the destination stops the sim, emits `navigation:arrived`, shows a banner, and transitions to the trip summary (previously it just clamped at the end forever).
- **Camera auto-follow that yields:** panning the map pauses auto-follow and pulses the recenter FAB (`.needs-recenter`); `ConvoyUI.recenter()` resumes it.
- **Perf:** marker eases shortened 1000 ms → 220 ms (was lagging at 10 Hz); follower divIcons only rebuild when the off-route flag flips, not every tick.

### Load order (index.html)
`utils → route-data → route-model → map → convoy → navigation → voice → activity → dashboard → ui → app`

**Verified end-to-end:** live 147 km OSRM route follows real streets; leader 0 m / followers 3–4 m off the road; traveled portion dims; cohesion pill + mini avatars update; hazard reroute keeps everyone on the new road; forced-offline short route arrives and shows the summary; no console errors.

**Remaining open items:** WebSockets backend sync, WebRTC push-to-talk, Capacitor/Ionic mobile wrap.
