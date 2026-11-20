# 3D visualization audit reference

## What the 3D actually is (confirmed from source, don't re-guess the tech)

- **Library: three.js, pinned to `0.128.0`** (`docs/3d/README.md`: "ต้องใช้
  three.js เวอร์ชัน 0.128.0 เท่านั้น เวอร์ชันใหม่กว่าแสงและสีจะเพี้ยน" —
  a newer version is known to shift lighting/color). If an audit or fix
  ever touches the 3D source, **do not bump the three.js version** without
  flagging that this is a deliberate, previously-tested constraint, not an
  oversight.
- **Controls**: `OrbitControls` from `three/examples/jsm/controls/
  OrbitControls.js`.
- **Two separate bundles, two separate source trees**, built with esbuild
  (IIFE, global name set, minified) per the exact commands in
  `docs/3d/README.md`:
  - `Index/bata-warehouse-3d.bundle.js` ← `docs/3d/src/bata-warehouse-3d.js`
    — the Home/dashboard full-height 3D scene, mounted via
    `BataWarehouse3D.mountWarehouse3D(el, { data })`, exposing
    `.setData(newData)` / `.destroy()` / (`.suspend()`, used at
    `Index/index.html` navigation).
  - `Index/bata-menus-3d.bundle.js` ← `docs/3d/src/bata-menus-3d.engine.js`
    + `bata-menus-3d.entry.js` — one shared scene reused across menu pages
    via `BataMenus3D.show(sceneName, hostEl, cards)` /
    `BataMenus3D.hide()`.
- **Mount points in `Index/index.html`**: elements with class
  `wh3m-host` and a `data-scene` attribute, one per menu — as of this
  writing: `in` (รับสินค้าเข้า), `out` (จ่ายสินค้าออก), `trf`
  (โอนสินค้าระหว่างคลัง), `ret` (สินค้าคืนคลัง), `ship` (used by both
  "สถานะการส่งของ" and "ขนส่ง"), `count`, `audit`, `loc`, `stock`. The
  router code (`if (window.BataMenus3D) { ... BataMenus3D.show(scene,
  host, wh3mCards(scene)) }`) swaps the single shared engine between
  hosts on navigation — **re-verify this mapping against the live
  `data-scene` attributes and router switch each audit**, since menu→scene
  names can be added/changed independently of this doc.
- **Home view is a different, standalone scene** (`window.wh3d`, from the
  warehouse bundle) that gets `.suspend(name !== 'home')` on every
  navigation — confirm it actually suspends (stops its render loop) when
  the user leaves "home"/"dashboard" rather than continuing to render
  off-screen.

## Real data vs. simulated — a frequent mislabeling risk

Per `docs/3d/README.md`: **only the dashboard home view, รับสินค้าเข้า,
and จ่ายสินค้าออก show numbers derived from real data; vehicle/forklift/
conveyor motion is always a simulated illustration**, everywhere,
including on those three. Audit must check:

- The on-screen numeric cards (`#bw3d-sScan`, `#bw3d-sRack`,
  `#bw3d-sLoaded`, `#bw3d-sDock` on the dashboard; `wh3mCards(scene)`
  values elsewhere) actually come from the same API calls as the
  equivalent data tables, not hardcoded demo numbers left over from
  `docs/3d/warehouse-dashboard-design.html` / `menus-3d-design.html`.
- No label anywhere implies the moving trucks/forklifts/conveyor are a
  live feed — the `.sub` caption text ("ภาพจำลองการทำงาน · ข้อมูลตัวอย่าง"
  style strings) should make clear what's illustrative. If a menu whose
  numbers *are* real (`in`/`out`) doesn't distinguish "these numbers are
  real, this animation is not" from a menu where *nothing* is real
  (`count`/`audit`/`loc`/`stock` — all still placeholder UI per
  `empty-note`), that's a UX/trust finding worth flagging even if Low
  severity.

## Camera, scale, position, lighting — what to actually check

- **Camera type**: `THREE.OrthographicCamera`, not perspective — verify any
  "zoom"/"scale" complaint is understood against ortho projection (objects
  don't get smaller with distance), and that `controls.minZoom`/`maxZoom`
  (`.6`–`4`) still produce a readable scene at both extremes.
- **Home target / offset**: `HOME_T` (orbit target) and `HOME_OFF` (camera
  offset from target) are fixed vectors in the source. After any content
  change (new racks, more trucks, bigger scene), re-check that `HOME_T`
  still centers the interesting part of the scene and nothing clips
  outside the ortho frustum (`-1,1,1,-1,-500,900` before aspect scaling).
- **Polar angle lock**: `maxPolarAngle: Math.PI/2.3`, `minPolarAngle: .3` —
  confirm the user can't orbit under the floor or to a degenerate
  top-down angle that breaks label readability.
- **Lighting**: `HemisphereLight(0xffffff, 0xc9c0bb, .6)` +
  `DirectionalLight` (`sun`) with `castShadow`, `shadow.mapSize 2048x2048`,
  shadow camera frustum `±75`, `shadow.bias -.0005`. Check for:
  - Shadow acne / peter-panning (visual defects from bias/mapSize
    mismatch) — capture a screenshot at a few orbit angles.
  - Color accuracy regression if three.js, the renderer's color
    management, or the light values were ever touched — compare against
    `docs/3d/warehouse-dashboard-design.html`'s original design reference
    if present.
- **WebGL availability fallback**: renderer creation is wrapped in
  `try/catch`; on failure `#bw3d-fallback` (plain "เบราว์เซอร์นี้แสดงภาพ
  3 มิติไม่ได้" text) is shown instead and `setData`/`destroy` become
  no-ops. Actually test this (disable WebGL in devtools, or use a browser
  tool flag) rather than assuming the catch block works — report whether
  the fallback text is reachable and whether the rest of the page (data
  table, KPIs) still functions normally when 3D fails.

## Responsive/performance behavior specific to the 3D layer

- CSS breakpoints inside the bundle's injected styles: `@media
  (max-width:900px)` (stats become a 2-col grid, info panel goes
  full-width) and `@media (max-width:560px)` (stats move up, controls lose
  text labels). Test at both breakpoints and in between — the bundle's own
  breakpoints don't necessarily match `Index/index.html`'s page-level ones
  (`720px`/`980px`); a device near 720–900px can hit an awkward in-between
  state worth screenshotting.
- `renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2))` — confirm this
  cap is still appropriate on very high-DPI tablets/phones (check actual
  frame rate, not just that it renders).
- `prefers-reduced-motion` currently only suppresses the CSS pulse
  animation (`reduceMotion` is read but check what it actually gates in
  the render loop — e.g. does `autoRotate`/truck movement still animate
  with reduced-motion on? If so, that's a real accessibility gap to
  report, not an assumption).
- **Load cost**: both bundles (`bata-warehouse-3d.bundle.js` ~660KB,
  `bata-menus-3d.bundle.js` ~580KB minified, per current file sizes) are
  loaded unconditionally via `<script>` tags at the bottom of
  `Index/index.html` on every page load, regardless of which menu the
  user opens or whether they ever interact with any 3D view. Measure
  actual load/parse time (devtools Network + Performance tabs) and report
  this as a Medium/High performance finding with the measured numbers —
  don't just restate the file size as the finding.
- **Lifecycle/memory**: navigating between menus repeatedly calls
  `BataMenus3D.show()`/`hide()` and toggles `wh3d.suspend()`. Watch
  devtools Memory/Performance while switching menus rapidly (10+ times)
  for growing heap size (undisposed geometries/materials/textures/canvas
  contexts) — a leak here is a real production risk since warehouse staff
  may leave the app open all shift.

## What "evidence" means for this section

A finding here needs at least one of: a screenshot, a devtools
Performance/Memory trace summary (numbers, not vibes), a console error/
warning line, or an exact code excerpt with file:line from
`docs/3d/src/*.js` or the relevant bundle. "Looks a bit laggy" without a
captured frame-rate or heap number is not sufficient evidence — report it
as a suspicion needing further instrumentation instead of a scored
finding.
