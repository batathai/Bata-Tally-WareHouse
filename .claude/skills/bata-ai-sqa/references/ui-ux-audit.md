# UI/UX audit reference

Scope: `Index/index.html` (the entire public app — login, sidebar, Home/
dashboard, every `data-view` section) and `Index/regroup-check.html`
(standalone, no login).

## Repo conventions to check against (not generic best practice)

- **All user-facing text must be Thai**, short, plain, "warehouse
  operational" in tone (CLAUDE.md, Working conventions). Flag any English
  leftover string, placeholder text (`Lorem ipsum`, `TODO`), or
  inconsistent tone (over-formal vs. the rest of the app) in a user-facing
  label, button, empty state, or error message.
- **Numeric table columns need `class="num"` on both the `<td>` and its
  matching `<th>`.** Grep for `<td class="num"` vs sibling `<th>` without
  it (and vice versa) per table. A mismatch means the column loses the
  right-aligned, Space Grotesk tabular-numeral styling — report as a
  concrete UI bug with file:line, not just "inconsistent styling".
- **Brand tokens**: `--brand:#C8102E` (Bata red), `--ink`, `--ink-soft`,
  `--line`, fonts `IBM Plex Sans Thai` (UI) / `Space Grotesk` (numbers).
  Check new or recently-touched UI doesn't hardcode a different red/ink
  color instead of the token, and doesn't use a different font stack.
- **Role-gated nav** (`data-roles="admin,warehouse_staff,viewer"` etc. on
  `.nav-item`): for each role, confirm the sidebar only shows items that
  role should see, and that a directly-navigated hidden view still enforces
  the gate server/client-side rather than only hiding the nav link.
- **Known placeholder/stub views** — these currently render an
  `empty-note` panel ("ยังไม่ได้สร้าง UI ส่วนนี้"): `receive`,
  `stockcount`, `stockaudit`, `bulklocation` (and `stockonhand` has no
  live source). Do not report these as "broken" — report them as
  **intentional placeholders**, but do check:
  - The empty-note message itself is accurate/current (matches
    `CLAUDE.md`'s open items — don't let the UI claim "ยังไม่ได้สร้าง" for
    something that was since built, or vice versa).
  - The 3D scene behind the placeholder (`.wh3m-host[data-scene]`) doesn't
    look "done" in a way that misleads staff into thinking the feature
    works (cross-reference `references/3d-visualization-audit.md`).
- **Empty/loading/error states** for every live-backed view (dispatch,
  transfer, return, shipment, transport, regroup-check): confirm each has
  a distinct, Thai-language state for "no data for this date range", "still
  loading", and "request failed" — not just a silently empty table. Many of
  these query MySQL live (`api-server.js`), so a slow LAN/VPN link or a
  down `BataWMS` service should degrade visibly, not silently.
- **Accessibility basics**: focus-visible outlines (the 3D HUD already
  sets `outline:2px solid var(--brand)` — check the rest of the app
  matches), `aria-label`/`aria-pressed` on icon-only buttons (sidebar icon
  rail, 3D controls), color contrast of `--ink-soft` text on `--panel`/
  `--bg`, and that `prefers-reduced-motion` is honored everywhere an
  animation exists (not just the 3D pulse dot).
- **Consistency across the ~23 menu sections**: date-range pickers, filter
  inputs, table headers, pagination/"load more" controls, and export
  buttons should look and behave the same way in every live view unless
  there's a documented reason (e.g. "สินค้าคืนคลัง" intentionally has no
  ผู้รับ filter because it's locked to `receiver=57702` — don't flag that
  one as an inconsistency, it's by design per CLAUDE.md).

## Evidence to capture

- Screenshot each distinct view state (empty/loaded/error) per menu, at
  the standard desktop size used for development.
- Note exact file:line for any markup/CSS issue found by reading
  `Index/index.html`, not just a description.
- If a view requires a role/login you don't have in this session, mark
  it **Inaccessible** rather than skipping it silently.
