# CLAUDE.md

Guidance for Claude Code (or any future AI/dev) working in this repository.

## What this project is

**Bata WMS** — a warehouse management web app for Bata Thailand. It is
mostly a thin, read-oriented front end over data that already lives (and is
still actively written to by other systems) in a legacy on-prem MySQL
database.

## Current deployment (as of 2026-09-26) — read DEPLOYMENT.md first

The app **no longer runs from the developer PC**. Two machines:

- **Machine A** (Windows user `danai.m`) — development only. Edits code,
  tests, holds backups/patch scripts/docs. Does **not** run the app or
  `sync.js` in production (its old Task Scheduler / `sync-all.bat` sync
  was disabled).
- **Machine B** (`192.1.36.59`, project at `D:\Project\Bata-WMS`) — the
  server, always on. Runs two NSSM Windows services that start at boot
  without anyone logging in: **`BataWMS`** (`node api-server.js`, port
  3001) and **`BataSync`** (`node sync.js`, schedule 08:00 + 12:00).
  Logs in `D:\Project\Bata-WMS\logs\`.

Users open **`http://192.1.36.59:3001`** from the office LAN, or from
outside via the company VPN ("To Vigor", clients get `192.1.1.x`), and log
in with a Supabase account. Nothing is installed on user machines.

Deploying a change = copy the changed files from A to B, then
`C:\nssm\nssm.exe restart BataWMS` (server/modules/`.env`) or
`restart BataSync` (`sync.js`); files under `Index/` need no restart. Full
runbook (service commands, reinstall steps, troubleshooting, open items):
**`DEPLOYMENT.md`**.

**GitHub is behind the local copy on machine A** (as of 2026-09-26 it
lacks `shipment-status.js`, `article-trace.js`, `wh-trace.js`,
`regroup-check.js` and later edits to `api-server.js`/`sync.js`). Never
replace local files from GitHub (`git clone`, `git reset --hard
origin/...`) until machine A's work has been pushed.

### History of how the app was run

As of 2026-09-22 the app was run with `npm run start:api` on the
developer PC and opened at `http://<lan-ip>:3001` — superseded by the
machine-B setup above. The app was previously also deployed
publicly via GitHub Pages at a custom domain (`tms.batathai.com`,
configured via a `CNAME` file); that domain is no longer used and the
`CNAME` file was removed. `Index/index.html` still talks to Supabase for
everything except the live Dispatch/Transfer views (which need
`api-server.js`), so it would still work if redeployed publicly, but doing
so is not the current setup — check with the user before re-adding a
`CNAME`/public deployment.

1. `Index/index.html` — login, roles, Home KPIs, and most menus, all
   backed by **Supabase** (Postgres + Auth + RLS). Served as a static file
   by `api-server.js`.
2. **LAN-only live API** (`api-server.js`) — run from inside the office
   network (or VPN), queries the source MySQL database **directly, on
   every request**, so live views never wait for the next Supabase sync.
   They are still only as fresh as MySQL itself, which is loaded once a
   day — see "Data freshness" below.

A separate script (`sync.js`) incrementally copies `dispatch` and
`receiving` from MySQL into Supabase so the app's non-live views (Home
KPIs, etc.) have data to show without querying MySQL on every page load.

## Data freshness (checked 2026-09-26 — important)

- MySQL `reporting.dispatch` / `receiving` are loaded by a **Talend job
  once a day, 07:00–07:45** (connects as MySQL user `talend`). A 3-day
  `updatedAt` histogram showed writes only in hour 7. Documents dated
  today arrive tomorrow morning; a store that scans a receipt today shows
  as received tomorrow after ~07:45. Nothing on our side can make this
  faster — only IT changing the Talend schedule (requested, pending).
- The only MySQL Event is `aggregate_stockmovement...` (daily 08:25) —
  another system's aggregation, **not** the loader. Don't touch it.
- `bata_core` (also readable by `talend`) is master data only (stores,
  districts/managers, sales estimates, last-year sales) — no
  dispatch/receiving data, so it is not a fresher source.
- Because of this, `sync.js`'s `SCHEDULE` is `['0 8 * * *', '0 12 * * *']`
  (08:00 right after Talend, 12:00 as a safety net). If Talend ever runs
  hourly, change to e.g. `['15 * * * *']`. Quick freshness check:
  `SELECT MAX(documentDate), MAX(updatedAt) FROM receiving;`

## Why the architecture is split this way

- The source MySQL server (`192.1.1.38`, db `reporting`) is **LAN-only** —
  not reachable from the internet, and other internal systems write to it
  directly, so we must not modify its schema or write to it from this app.
- Supabase gives us hosting, authentication, and row-level-security-based
  role access for everything that isn't the live Dispatch/Transfer data,
  without exposing MySQL itself.
- The LAN-only API (`api-server.js`) exists because warehouse staff who are
  physically on-site want live data (no sync lag); it deliberately has
  **no auth of its own** and must never be port-forwarded to the internet.

## Repo layout

| Path | Purpose |
|---|---|
| `Index/index.html` | The entire public app: login, sidebar nav, Home KPIs, all views. Single-file (HTML+CSS+JS), talks to Supabase via `@supabase/supabase-js` (CDN) and, for the live views, to `api-server.js` over `/api/:view`. |
| `api-server.js` | Express server. Serves `Index/` as static files **and** a `/api/:view` route (`dispatch`, `receiving`, or `receiving-return`) that queries MySQL directly, plus `/api/:view/detail`. Registers the modules below **before** `/api/:view`. LAN/VPN-only, no auth. Runs on machine B as the `BataWMS` service. |
| `shipment-status.js`, `article-trace.js`, `wh-trace.js`, `regroup-check.js` | API modules registered by `api-server.js` (สถานะการส่งของ, Article trace, warehouse trace, เช็คตามใบ Regroup). Must be deployed to machine B together with `api-server.js` — a missing one stops the server from starting. |
| `Index/regroup-check.html` | Standalone "เช็คตามใบ Regroup" page (not yet a menu inside `index.html`, **no login**). See section below. |
| `sync.js` | MySQL → Supabase sync, per table: incremental (by `updatedAt` watermark) → reconcile (re-upsert last `RECONCILE_DAYS`=14 days, delete Supabase rows whose Id no longer exists in MySQL) → verify (daily counts/sums vs Supabase RPCs `dispatch_daily_check`/`receiving_daily_check`, last `VERIFY_DAYS`=7). Runs once at start, then on `SCHEDULE`; `node sync.js --once` = one run then exit. Runs on machine B as the `BataSync` service. |
| `DEPLOYMENT.md` | Where the app runs (machine A/B), NSSM services, deploy workflow, data-freshness findings, troubleshooting, open items. Takes precedence over README if they disagree. |
| `schema.sql` | Supabase/Postgres schema mirroring the MySQL `dispatch`/`receiving` tables. Run once in the Supabase SQL Editor before the first sync. |
| `reconcile-schema.sql` | Supabase schema for the "กระทบยอด" (barcode reconcile) feature — `reconcile_batches`/`reconcile_items`/`reconcile_scans`/`reconcile_history`, all Supabase-only (no MySQL involved). Run once before using that menu. |
| `.env.example` | Template for local secrets (MySQL creds, Supabase URL/keys, API port). **Never commit a real `.env`.** |
| `sync-state.json` | Auto-created by `sync.js`; stores the per-table sync watermark. Git-ignored. Lives on machine B now. Deleting it forces a full multi-million-row re-sync — don't, unless that's really intended. |
| `README.md` | Original setup instructions for running `sync.js`/`api-server.js` on a Windows PC (manual/terminal style — production now uses services, see `DEPLOYMENT.md`). |

## Data model quirks (important, easy to get wrong)

- MySQL's primary key column is **`Id`** (capital I), not `id`. `sync.js`'s
  `COLUMN_MAP` handles this — if you ever query MySQL directly, remember
  the column is case-sensitive on the MySQL side.
- MySQL uses camelCase (`bookedDate`, `documentDate`, `isFootware`, …);
  Supabase/Postgres uses snake_case (`booked_date`, `document_date`,
  `is_footware`, …). The mapping lives in `sync.js`'s `COLUMN_MAP` /
  `PASSTHROUGH_COLUMNS` — keep both in sync if the source schema changes.
- `dispatch` has ~1.5M rows, `receiving` has ~4.9M rows, both growing daily.
  Any query against them (in `api-server.js` or ad-hoc) should filter by
  `documentDate`/`document_date` — never scan the full table.
- Supabase/PostgREST caps query results at **1000 rows by default**. Any
  client query that needs an accurate count/sum over a day (or more) must
  pass an explicit `.limit(N)` well above realistic daily volume, or use
  `{ count: 'exact' }` for the true count separately from the row array.
- `Pair` = `SUM(items) WHERE isFootware = 1`; `Accessories` =
  `SUM(items) WHERE isFootware = 0` — both grouped by invoice or by day.
  This math is duplicated in `api-server.js`'s `buildQuery`/`buildDailyQuery`
  — keep them consistent if you change one.

## Live-view menu → MySQL table mapping (non-obvious, changed once already)

As of the September 2026 remap (see CHANGELOG), the sidebar labels do
**not** map 1:1 to MySQL table names. In `Index/index.html`:

```js
const LIVE_TABLE = { dispatch: 'receiving', transfer: 'dispatch', return: 'receiving-return' };
```

- Menu **"จ่ายสินค้าออก"** (`data-view="dispatch"`) shows the MySQL
  **`receiving`** table's data, **excluding** rows where `receiver = '57702'`.
- Menu **"โอนสินค้าระหว่างคลัง"** (`data-view="transfer"`) shows the MySQL
  **`dispatch`** table's data.
- Menu **"สินค้าคืนคลัง"** (`data-view="return"`) shows the MySQL
  **`receiving`** table's data, **locked to only** `receiver = '57702'`.
- Menu **"รับสินค้าเข้า"** (`data-view="receive"`) is currently an empty
  placeholder — no live source wired up.

This was an explicit, confirmed business decision from the warehouse
manager, not a bug. Do not "fix" it back to the literal name-matching
without checking with the user first.

### The receiver=57702 split (dispatch vs return)

`receiver` code `57702` marks a `receiving` row as a warehouse return
rather than a normal dispatch. `api-server.js` enforces this server-side,
not in the front end — see its `VIEWS`/`RETURN_RECEIVER` constant and
`buildWhere`'s `opts.lockReceiver`/`opts.excludeReceiver`. The API exposes
two views over the same `receiving` table:
- `/api/receiving` — always adds `receiver <> '57702'` (used by "จ่ายสินค้าออก").
- `/api/receiving-return` — always adds `receiver = '57702'` (used by
  "สินค้าคืนคลัง"; that page has no ผู้รับ filter input since it's fixed).

Both conditions are baked into `VIEWS` server-side and can't be overridden
by query params — if the return-receiver code ever changes, update
`RETURN_RECEIVER` in `api-server.js` (single source of truth).

## เช็คตามใบ Regroup (inter-store transfer plan check)

Added 2026-09-26. `regroup-check.js` + `Index/regroup-check.html`.

- The monthly Regroup workbook (`.xlsb`) is parsed **in the browser**
  (SheetJS). Only sheet **Memo** is read; the header row is found by the
  cells "Code ร้านโอน" and "Code ร้านรับ" (row 17 in Sep 2026). Compared
  columns: Code ร้านโอน, Code ร้านรับ, Article, Size, QTY. StoreName /
  เขต / Hub are display-only. Doc number, date (→ default "from" date)
  and deadline come from the block above the table. Sheets `Recap DM.`
  and the per-district sheets (511–560) are not used.
- Normalisation (client and server): store codes → 5-digit text (Excel
  stores one as `52037.0`), Article → 7 digits, Size → 3 digits.
- `POST /api/regroup-check` `{ dateFrom, dateTo, lines[] }`: pulls
  `dispatch` rows in the window for the planned sender/receiver pairs,
  then `receiving` rows for exactly those invoices matched on
  **invoice + receiver** (same key as สถานะการส่งของ). Independent of
  `LIVE_TABLE` — here `dispatch` = shipped, `receiving` = received.
  Read-only.
- Per pair/line status: `notsent` ยังไม่ส่ง, `pending` ค้างรับ (an in-plan
  invoice not fully received), `short` ส่งไม่ครบ, `done` ครบ. Per store
  (receiving side): รับครบแล้ว / รับแล้วบางส่วน / มีของค้างรับ / ยังไม่ได้รับ.
- Match depth is auto-detected from real columns (`SHOW COLUMNS`):
  `article` mode (Article+Size) if both tables have `article`+`size`,
  else `pair` mode (footwear vs accessories totals; memo size `000` =
  accessories). Override with `REGROUP_ARTICLE_COL`/`REGROUP_SIZE_COL`;
  `GET /api/regroup-check/columns` shows what was detected.
- Validated against real data for store 51426 (Sep 2026 memo) before
  building. Receipts reach MySQL next morning (see Data freshness), so a
  store that received today still shows ค้างรับ until then.
- Open item: page has no login — move it into `index.html` as a menu.

## กระทบยอด (barcode reconcile) — Supabase-only, no MySQL involved

> **Correction (2026-09-22, later the same day):** an earlier version of
> this section described a UI/JS implementation that did **not** actually
> exist — the first 2026-09-22 commit only added `reconcile-schema.sql`
> (plus docs) and never touched `Index/index.html`. The description below
> reflects the actual build that followed, once real field data from the
> legacy Google Sheets system (`T_Reconcile_Base/Scan/Report`) was
> available to reverse-engineer the matching/scan logic from — this is a
> from-scratch Supabase implementation, not a port of that system's code.

Unlike Dispatch/Transfer/Return, this feature doesn't touch MySQL or
`api-server.js` at all — it's a standalone Excel-upload + barcode-scan
workflow backed entirely by Supabase (`reconcile-schema.sql`):
`reconcile_batches` (one row per "Batch ID / รอบงาน", `batch_code` is a
free-text code like `W37-38`, not auto-numbered), `reconcile_items`
(rows parsed client-side from the uploaded "ไฟล์ตั้งต้น" — the expected
stock, keyed by `article`+`size`, plus a warehouse zone/rack code `cat`
and a condition `remark` e.g. "Good"), `reconcile_scans` (one row per
barcode scan), `reconcile_history` (append-only log written on close).
All state (`rcState` in `Index/index.html`) is per-view-session, reloaded
from Supabase on "โหลด/สร้างรอบงาน".

- **Matching is by Article+Size, not literal barcode.** `rcParseBarcode`
  decodes each scanned 13-digit barcode as
  `[prefix 1][Article 7][pad "0"][Size 3][check digit 1]` (confirmed
  against real scan data — the prefix and check digit vary and are
  ignored). The decoded article+size is looked up in `rcState.items`.
- **Three rejection reasons**, each producing a `reconcile_scans` row with
  `result='ไม่ตรง'`, `qty=0`, and a specific `reason` string (see
  `rcHandleScan`):
  - Article not in the batch's ไฟล์ตั้งต้น at all →
    `ไม่พบ Article {article} ในไฟล์ตั้งต้น`
  - Article exists but scanned size doesn't match any of its sizes →
    `Size ไม่ตรง: ยิง {size} / ตั้งต้นมี {sizes...}`
  - Article+size exists but already scanned up to its `qty_expected` →
    `รายการนี้ยิงครบจำนวนตามไฟล์ตั้งต้นแล้ว {n}/{qty_expected} ไม่รับชิ้นเกิน`
    (over-scan cap — excess scans are rejected, never counted past the
    expected quantity for that line)
- **Per-scan result is binary** (`ตรง`/`ไม่ตรง`, matches the `reconcile_scans.result`
  check constraint) but **the report (`rcBuildReportRows`) is 3-way per
  Article+Size line**: `ตรง` (fully scanned), `ยังไม่ครบ` (partially
  scanned), `ยังไม่ได้ยิง` (not scanned at all) — this only shows up when
  aggregating scans against each item's `qty_expected`.
- Batch stats (`rcComputeStats`) split rejected scans into "ไม่พบ
  Article" (`errorRows`, genuinely unknown articles — a data problem)
  vs. other rejections (`rejectedScans`, mostly over-scan cap hits) —
  this split is inferred/designed, not confirmed against the legacy
  system (its `T_Reconcile_History`/`Error Rows` tab was inaccessible
  when this was built).
- Excel parsing (`rcParseExcelFile`) runs entirely in the browser via
  SheetJS (`xlsx` CDN script in `<head>`) — nothing is uploaded to a
  server. Column matching in `rcParsePick` is best-effort/flexible
  (looks for header names like `cat`/`โซน`, `article`, `size`, `qty`,
  `remark`/`หมายเหตุ`, case- and whitespace-insensitive); adjust the
  `keys` arrays there if a real source file uses different headers.
- "ผูกไฟล์ตั้งต้นกับรอบนี้" **replaces** all `reconcile_items` for that
  batch (delete then insert) — re-uploading is destructive by design,
  not additive.
- "ปิดงาน / บันทึก History" freezes the batch's summary numbers plus who
  closed it into a new `reconcile_history` row (append-only — a batch
  could in principle be reopened directly in Supabase and closed again,
  producing a second history row for the same batch), then sets
  `reconcile_batches.status = 'closed'`. A closed batch is read-only in
  the UI (scan input and write buttons disabled, guarded on
  `rcState.batch.status` both client-side and by re-checking before each
  write) — there's no "reopen" button in the UI.
- UI reference only, not a spec to match pixel-for-pixel: the layout was
  adapted from a screenshot of a separate, already-existing barcode
  reconcile tool the warehouse already uses day-to-day — the button/stat
  labels were kept close to that tool for familiarity.

## Secrets / credentials

- `.env` (git-ignored) holds `MYSQL_HOST/USER/PASSWORD/DATABASE`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_PORT`.
- `Index/index.html` embeds `SUPABASE_URL` and a **publishable** key
  (`sb_publishable_...`) directly in client-side JS — this is intentional
  and safe as long as it's the new-format publishable key (or legacy
  `anon` key) and RLS policies are correctly scoped. **Never** put the
  `service_role` / `sb_secret_...` key in `Index/index.html`.
- The MySQL user in `.env` (`talend`, the Talend ETL account) has
  **`ALL PRIVILEGES` on `reporting`** and `SELECT` on `bata_core`. Our
  code only reads, but the credential can write/delete — be careful in
  Navicat. A read-only user has been requested from IT; when it arrives,
  change `MYSQL_USER`/`MYSQL_PASSWORD` in `.env` on machine B and restart
  both services.
- This repo is **public**. `.env.example` must only ever contain
  placeholders. A real MySQL password and a real Supabase service_role JWT
  were accidentally committed to `.env.example` once (see CHANGELOG,
  2026-09-17/18) — both were rotated/replaced, but the exposure is
  permanent in git history. Always double check `.env.example` (and any
  other file about to be committed) for real secrets before pushing.
- Supabase has two key systems: legacy JWT keys (`anon`/`service_role`,
  HS256, under "Legacy API keys") and the newer
  `sb_publishable_.../sb_secret_...` keys (under "Publishable and secret
  API keys"). This project uses the newer system — `sync.js` requires
  `@supabase/supabase-js@2.4x+` to support it (older versions fail with
  "Invalid API key" against `sb_secret_...` keys).

## Common gotchas hit during development

- **Windows environment variables persisted in the registry**
  (`HKCU\Environment`) silently override `.env` file values, since
  `dotenv` does not overwrite existing `process.env` entries. If a secret
  seems to be "wrong" even after fixing `.env`, check for a stale env var
  with `reg query "HKCU\Environment"` and remove it, then reopen the
  terminal.
- `git push` from a sandboxed/remote Claude session typically cannot reach
  GitHub directly (403) — pushes here were done via the GitHub MCP
  (`push_files`), then the local clone fast-forwarded with `git fetch` +
  `git reset --hard origin/<branch>`. **Only do that reset when GitHub
  already contains everything in the local copy** — as of 2026-09-26 it
  does not (see "Current deployment"), and a reset would delete local
  work.
- `app` must exist before a module is registered: calling
  `registerX(app, getPool)` near the top-level `require`s in
  `api-server.js` throws `Cannot access 'app' before initialization`.
  Register modules after `const app = express();` and before
  `app.get('/api/:view', ...)`.
- Viewing Thai text in NSSM log files from CMD: run `chcp 65001` first,
  or open the file in Notepad.
- `api-server.js`'s `VIEWS` map (view name → MySQL table + fixed WHERE
  conditions) is the single place that defines what each `/api/:view`
  route actually queries — adding a live-backed menu usually means adding
  an entry there plus a matching one in `LIVE_TABLE` in `Index/index.html`.

## Working conventions for this repo

- All user-facing text in `Index/index.html` is Thai. Keep new UI strings
  Thai, matching the existing tone (short, plain, warehouse-operational).
- Numeric table columns use `class="num"` on **both** the `<td>` and its
  matching `<th>` (right-aligned, Space Grotesk font) — always add both
  when adding a new numeric column, not just the data cell.
- Don't widen `sync.js`/`api-server.js` beyond `dispatch`/`receiving`
  without confirming with the user — the `reporting` MySQL database has
  many unrelated tables from other systems that are explicitly out of
  scope.
- Treat `sync-state.json` as precious operational state, not a scratch
  file — deleting it forces a full multi-million-row re-sync.
- Never run `sync.js` on two machines at once. If sync moves to another
  machine: stop it on the old one (service **and** any Task Scheduler
  job), copy the latest `sync-state.json`, then start it on the new one.
- Production changes happen on machine B only by copying files from A and
  restarting the relevant NSSM service — don't edit code directly on B.
