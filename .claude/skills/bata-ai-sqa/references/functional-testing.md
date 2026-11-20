# Functional testing reference

## Safe-testing rule (read before testing anything)

Every check in this file is **read-only**: navigate, filter, view detail,
export/print if available, inspect network requests. Never submit a write
action against MySQL (there is no legitimate write path from this app
into `reporting` — if one is ever found, that's itself a Critical finding,
not a thing to test by using it) and never submit a write action against
Supabase tables backing a real feature (`reconcile_*`, `dispatch`,
`receiving`, auth/roles tables) with anything but an action you're
prepared to never undo. Default to not writing at all; see SKILL.md's
Hard Rules for the narrow, approval-gated exception.

## Live-view menu → MySQL mapping (verify the mapping still holds, don't "fix" it)

This is a confirmed, intentional business decision (CLAUDE.md), easy to
mistake for a bug:

```js
const LIVE_TABLE = { dispatch: 'receiving', transfer: 'dispatch', return: 'receiving-return' };
```

- **"จ่ายสินค้าออก"** (`dispatch`) → MySQL `receiving` table, **excluding**
  `receiver = '57702'`.
- **"โอนสินค้าระหว่างคลัง"** (`transfer`) → MySQL `dispatch` table.
- **"สินค้าคืนคลัง"** (`return`) → MySQL `receiving` table, **locked to
  only** `receiver = '57702'`.
- **"รับสินค้าเข้า"** (`receive`) → no live source; placeholder.

Test: for each of the three live menus, confirm the on-screen data
actually matches querying the mapped table (not the literally-named one),
and that "สินค้าคืนคลัง" has no ผู้รับ filter input (expected — it's fixed
server-side). If any of these three ever match the *literal* name instead
of the mapped one, that is a **regression**, report it as such — do not
silently treat the literal mapping as "more correct".

Also confirm server-side enforcement, not just the UI: hit
`/api/receiving` and `/api/receiving-return` directly (e.g. via the
network tab or a manual GET while the app is open) and confirm the
`receiver` condition can't be overridden by a query param — both
conditions are supposed to be baked into `VIEWS` in `api-server.js`, not
client-controllable.

## Per-menu checklist

For every `data-view` found in `Index/index.html` (see SKILL.md's
enumeration step), at minimum:

1. Does it load without a console error?
2. Does changing the date range / filters actually change the result set
   (not just the UI state)?
3. Does the row count/sum shown match a manual spot-check against the
   underlying data for a small, specific date (don't trust a 1000-row
   default limit — see below)?
4. Pair/Accessories math: `Pair = SUM(items) WHERE isFootware = 1`,
   `Accessories = SUM(items) WHERE isFootware = 0`. This is duplicated in
   `api-server.js`'s `buildQuery`/`buildDailyQuery` — spot check that a
   known invoice's pair/accessory split matches between the two code paths
   and the UI.
5. Does role-gating actually block the view for a role that shouldn't see
   it (not just hide the nav link)?

## Feature-specific checks

- **สถานะการส่งของ / Article trace / wh-trace / เช็คตามใบ Regroup**
  (`shipment-status.js`, `article-trace.js`, `wh-trace.js`,
  `regroup-check.js`): each is registered as its own Express module before
  the generic `/api/:view` route — confirm the server actually started
  with all four present (a missing module stops the whole server, per
  CLAUDE.md gotchas) and that each module's route responds for a known-good
  input.
- **เช็คตามใบ Regroup specifically**:
  - `Index/regroup-check.html` has **no login** — confirm this is still
    true and flag it (it's a known, already-tracked open item in
    `CLAUDE.md`, so report it as a tracked finding with reference to that
    open item, not as a brand-new discovery, and don't "fix" it by adding
    auth without explicit approval — that's an architecture decision for
    the user).
  - The `.xlsb` Regroup workbook is parsed client-side (SheetJS) from
    sheet **Memo** only, header row detected by cells "Code ร้านโอน"/"Code
    ร้านรับ". Confirm parsing still works against a current-month real
    workbook layout (row position can shift month to month — it was row 17
    in the Sep 2026 file per CLAUDE.md, don't assume it's still 17).
  - Store codes, Article, Size must normalize to 5/7/3 digit text
    (Excel float artifacts like `52037.0`) both client- and server-side —
    test a code known to have this float issue.
  - Status logic (`notsent`/`pending`/`short`/`done` per line; per-store
    รับครบแล้ว/รับแล้วบางส่วน/มีของค้างรับ/ยังไม่ได้รับ) — spot check
    against a store/invoice combination with a known real outcome.
  - Match depth auto-detects `article` vs `pair` mode from
    `SHOW COLUMNS` — call `GET /api/regroup-check/columns` and confirm the
    detected mode matches the current real schema, not a stale assumption.
- **กระทบยอด (reconcile)**: Supabase-only, no MySQL. Exercise the
  **read/report paths** safely (load an existing batch, view its report,
  computed stats) but do not touch "ผูกไฟล์ตั้งต้นกับรอบนี้" (destructive
  replace) or "ปิดงาน / บันทึก History" (one-way close) against a real
  batch. If write-path testing is wanted, it requires Audit & Fix approval
  and a batch created specifically for this audit (e.g.
  `batch_code = 'SQA-TEST-<date>'`), with the user told it will leave a
  `reconcile_history` row and asked whether that's acceptable — default to
  not doing it and reporting the write paths as untested by design.
  Confirm a closed batch is actually read-only in the UI (scan input and
  write buttons disabled) — this is both a functional and a data-integrity
  check.

## Data-quirk checks worth a dedicated pass

- **Supabase/PostgREST's 1000-row default cap**: any query over a day (or
  more) of `dispatch`/`receiving` needs an explicit `.limit(N)` well above
  realistic daily volume, or `{ count: 'exact' }` used separately from the
  row array. Grep client-side Supabase calls in `Index/index.html` for
  queries that could silently under-count on a high-volume day, and report
  any missing explicit limit/count as a data-integrity finding (these are
  easy to miss because they only show wrong numbers on unusually busy
  days).
- **Data freshness**: MySQL `dispatch`/`receiving` are loaded once daily by
  Talend, 07:00–07:45. A document dated today will correctly *not* appear
  until tomorrow morning. Don't mistake this expected lag for a bug — but
  do verify the UI actually communicates "data as of" rather than implying
  real-time freshness it doesn't have (this is a UX/functional overlap —
  cross-reference `ui-ux-audit.md`).
- **Case-sensitive MySQL `Id` column**: if any direct MySQL query is added
  or changed, confirm it uses `Id` (capital I), not `id`.

## Inaccessible / untested — report explicitly, don't skip silently

Typical reasons something can't be tested in this session: needs a real
Supabase login with a specific role, needs LAN/VPN access to
`192.1.36.59` or the source MySQL server (`192.1.1.38`), needs
`IS_Warehouse`/SQL Server access (carton counts — out of scope for this
app anyway per CLAUDE.md), needs a real `.xlsb` Regroup workbook for the
current month, or needs a browser tool not available in this session. List
each such item by name in the report's "Inaccessible / Untested" section
with the specific reason — never mark it passed, and never silently omit
it from the report.
