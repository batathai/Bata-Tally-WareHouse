# Responsive audit reference

## Actual breakpoints in this codebase (don't invent generic ones)

`Index/index.html` page-level CSS:
- `@media (max-width: 720px)`
- `@media (max-width: 980px)`
- `@media (min-width: 721px)`
- `@media (prefers-color-scheme: dark)`
- `@media (prefers-reduced-motion: reduce)`

3D bundle-injected CSS (both `bata-warehouse-3d.bundle.js` and
`bata-menus-3d.bundle.js` share the same `.bw3d` style block):
- `@media (max-width: 900px)`
- `@media (max-width: 560px)`

These two sets **don't line up** (720/980 vs. 900/560). Always test the
viewport widths around *both* sets of breakpoints — a device between
720px and 900px, for example, can land in a state where the page chrome
has already switched to its narrow layout but the 3D HUD hasn't (or vice
versa). Screenshot anything that looks mismatched between the page layout
and the 3D overlay at the same width.

## Required test matrix

At minimum, test at:
- 1920×1080 and 1366×768 (typical desktop — most actual warehouse-staff
  usage per the office-LAN deployment model)
- ~1024×768 (tablet landscape, around the 980px breakpoint)
- ~768×1024 (tablet portrait, around the 900px 3D breakpoint)
- ~390×844 (phone portrait, below the 560px 3D breakpoint and the 720px
  page breakpoint)
- Same phone width in landscape (~844×390) — the 3D canvas and HUD are
  especially prone to running out of vertical space here (stats/info
  panels are positioned with fixed `top`/`bottom` offsets, not flex)

For each: sidebar/nav behavior (icon rail vs. full labels vs. collapsed/
hamburger if present), table overflow (horizontal scroll vs. unreadable
squeeze), date-picker and filter control usability (touch target size),
and the 3D view specifically:
- Does `.stats` actually reflow to the 2-column grid at ≤900px as coded?
- Does `.info` panel go full-width and reposition (`bottom:206px` at
  ≤900px, `bottom:76px` at ≤560px) without overlapping `.controls` or
  getting clipped off-screen?
- Do `.controls` lose their text labels (`.t`/`.hint` hidden) at ≤560px
  without losing button function (icon-only buttons still need an
  `aria-label`, cross-check `ui-ux-audit.md`)?
- Touch interaction: `#bw3d-scene` sets `touch-action:none` so
  `OrbitControls` can own single-finger drag-to-orbit / pinch-to-zoom —
  confirm this doesn't also block the page itself from scrolling when the
  3D view is `data-full="1"` (full-bleed) and content exists below the
  fold, and confirm pinch-zoom on the canvas doesn't trigger the browser's
  own page-zoom instead.

## Resize/orientation-change behavior (not just initial load)

Load a view, then actually resize the window or rotate the device
emulation — don't only test by loading fresh at each width. Check:
- The three.js renderer and camera aspect ratio update on resize (look for
  a `resize` handler in `docs/3d/src/*.js` — if there isn't one, or it's
  throttled oddly, the canvas can end up stretched or letterboxed after a
  resize, which only shows up by actually resizing).
- Switching from portrait to landscape mid-session doesn't leave stale
  `.labels` positioning (the floating tag elements are positioned in
  screen space from 3D world coordinates — a missed re-projection after
  resize will leave labels pointing at the wrong object).

## Dark mode

`@media (prefers-color-scheme: dark)` exists at the page level, but the 3D
scene's CSS custom properties (`--bg:#FFFFFF`, `color-scheme:light`) are
hardcoded light with a comment noting it's "a single light look by
design (it is an illustration)". Confirm this is still an intentional,
accepted inconsistency (a white 3D panel embedded in a dark page) rather
than an oversight — if the rest of the app now fully supports dark mode
and the 3D panel doesn't, that's worth a Low/Medium finding for visual
inconsistency even though it may be "by design" per the source comment;
let the user confirm whether the design intent still holds.

## Evidence to capture

A screenshot per breakpoint in the matrix above, per affected view,
labeled with the exact viewport size used. For resize/orientation checks,
a before/after pair of screenshots (not just a description of what should
happen).
