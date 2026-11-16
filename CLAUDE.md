# CLAUDE.md

Guidance for Claude Code (or any future AI/dev) working in this repository.

## What this project is

**Bata WMS** — a warehouse management web app for Bata Thailand. It is
mostly a thin, read-oriented front end over data that already lives (and is
still actively written to by other systems) in a legacy on-prem MySQL
database.

**As of 2026-09-22, the primary (and only actively used) way to run the
app is `api-server.js` on the office LAN** — `npm run start:api`, then
open `http://localhost:3001` (or `http://<lan-ip>:3001` from another
machine on the same network). The app was previously also deployed
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
   network, queries the source MySQL database **directly, on every
   request**, so Dispatch/Transfer views are always up to the second
   instead of waiting for the next sync.

A separate script (`sync.js`) incrementally copies `dispatch` and
`receiving` from MySQL into Supabase so the app's non-live views (Home
KPIs, etc.) have data to show without querying MySQL on every page load.

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
| `api-server.js` | Express server. Serves `Index/` as static files **and** a `/api/:view` route (`dispatch`, `receiving`, or `receiving-return`) that queries MySQL directly. LAN-only, no auth. |
| `sync.js` | One-shot + cron-scheduled script: MySQL → Supabase incremental sync, watermarked by each row's `updatedAt`. Run with `npm start`. |
| `schema.sql` | Supabase/Postgres schema mirroring the MySQL `dispatch`/`receiving` tables. Run once in the Supabase SQL Editor before the first sync. |
| `reconcile-schema.sql` | Supabase schema for the "กระทบยอด" (barcode reconcile) feature — `reconcile_batches`/`reconcile_items`/`reconcile_scans`, all Supabase-only (no MySQL involved). Run once before using that menu. |
| `.env.example` | Template for local secrets (MySQL creds, Supabase URL/keys, API port). **Never commit a real `.env`.** |
| `sync-state.json` | Auto-created by `sync.js`; stores the per-table sync watermark. Git-ignored. Delete it to force a full re-sync. |
| `README.md` | Setup instructions for a human running `sync.js`/`api-server.js` on a Windows PC. |

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

## กระทบยอด (barcode reconcile) — Supabase-only, no MySQL involved

Unlike Dispatch/Transfer/Return, this feature doesn't touch MySQL or
`api-server.js` at all — it's a standalone Excel-upload + barcode-scan
workflow backed entirely by Supabase (`reconcile-schema.sql`):
`reconcile_batches` (one row per "Batch ID / รอบงาน"), `reconcile_items`
(rows parsed client-side from the uploaded "ไฟล์ตั้งต้น" — the expected
stock), `reconcile_scans` (one row per barcode scan, matched against
`reconcile_items` to decide ตรง/ไม่ตรง). All state (`rcState` in
`Index/index.html`) is per-view-session, reloaded from Supabase on
"โหลดรอบงาน"/"รีเฟรช".

- Excel parsing (`rcParseExcelFile`) runs entirely in the browser via
  SheetJS (`xlsx` CDN script in `<head>`) — nothing is uploaded to a
  server. Column matching in `rcParsePick` is best-effort/flexible
  (looks for header names like `barcode`/`บาร์โค้ด`, `article`, `size`,
  `qty`, case- and whitespace-insensitive); adjust the `keys` arrays
  there if a real source file uses different headers.
- "ผูกไฟล์ตั้งต้นกับรอบนี้" **replaces** all `reconcile_items` for that
  batch (delete then insert) — re-uploading is destructive by design,
  not additive.
- A closed batch (`status = 'closed'`, set by "ปิดงาน / บันทึก History")
  is read-only in the UI (scan input disabled, write buttons guard on
  `rcState.batch.status`) — closing is how this feature's "History" is
  kept, there's no separate history table.
- UI reference only, not a spec to match pixel-for-pixel: the layout was
  adapted from a screenshot of a separate, already-existing barcode
  reconcile tool the warehouse already uses day-to-day — the button/stat
  labels were kept close to that tool for familiarity, but this
  implementation is a fresh build against Supabase, not a port of that
  tool's actual code.

## Transfer analysis findings (2025 – 4 Nov 2026, recorded 2026-11-05)

Read-only analysis of `dispatch`/`receiving` for a "store → store" and
"store → warehouse" transfer report (Excel, by year). Things learned that
are easy to get wrong:

- **There is no carton/box column** in `dispatch` or `receiving` (nor in
  `dispatchWarehouse`/`receivingWarehouse`, whose `A`–`M` columns are
  per-size pair counts, nor in `dispatchVinculum`/`stockmovement`). `items`
  is **pairs (คู่)**. Never label report numbers as "boxes".
- **`dispatch` and `receiving` are the same transfers seen from each side**
  (per-sender totals nearly identical). Never add them together. Use
  `dispatch` for store → store and treat `receiving` as a cross-check.
  Totals 2025 = 5,352,376 pairs / 54,688 invoices; 2026 (to 4 Nov) =
  720,194 pairs / 45,886 invoices. Store → warehouse (receiver `57702`) is
  a subset of those: 343,708 pairs (2025) and 77,397 pairs (2026).
- **2025 is inflated by one-off mass moves and round trips** (Feb–Apr 2025,
  some recurring into 2026): e.g. 51524→24047 (~1.46M pairs, 3 invoices),
  51435→51431 (~702K), and out-and-back pairs 51428↔51944, 51506↔57702,
  51404↔24037, 75014↔51506 (~285–291K pairs each way). Report them in a
  separate "special items" sheet (flows ≥ 50,000 pairs) instead of mixing
  them into normal volume; normal 2025 store → store ≈ 0.83M pairs.
- **Store names come from the MySQL `store` table** (`code`, `name`,
  `profile`, `reportingGroup`, …). It does **not** contain every code seen
  in transfers — 93 of 314 codes are missing (24036+ i.e. most 24xxx fair
  codes incl. 24037/24047, 29999, 30xxx, 51406, 51501, 52013, 52021,
  52027, 53001, 54095–54098, 55049, 57703, 57707, 66610). Leave those
  names blank and flag them; don't guess. The warehouse manifest (below)
  carries names for some of them (e.g. 24098, 54095, 52021).
- Code meanings confirmed from `store`: `24000`–`24030` = Fair /
  clearance stores; `57702` = **RETURN D.C.** (return warehouse);
  `57701` = SUPPLY DISCREPENCY, `57705` = DAMAGE D.C.; `68000` =
  Warehouse; `66609` = Online sales Dummy; `59992/59994/59998` = B2B
  wholesale. `66610` is not in `store` (meaning unconfirmed).
- **Carton counts live in a different system**: SQL Server database
  `IS_Warehouse` on the office LAN, via stored procedure
  `Qry_GetManifestByDate(@dateFrom, @dateTo)` (the same source as the
  warehouse's `Warehouse_Manifest_Report.xlsm`). One row per invoice to a
  destination store, with Big/Small/Total Carton and ordered/final pairs
  and accessories. It covers **warehouse → store only** (no origin column,
  origin is always the warehouse), so it cannot give boxes for
  store → store transfers. Navicat's ODBC Driver 18 failed against that
  server (old SQL Server); SSMS or the Excel macro's legacy driver works.
  Credentials are in the team's own notes — **never write them in this
  public repo.** Its invoice number (`pickno`) is the text before the first
  `_` of `receiving.invoice` for sender `68000` (verified 2026-11-16, see
  the next section).

## Warehouse → Yusen → store tracking (recorded 2026-11-16)

The "ติดตามใบจากคลัง" panel at the top of the สถานะการส่งของ menu follows one
warehouse invoice through three sources. **Most of the code for it is not in
this repo yet** — it lives only on the dev PC ("machine A") and the office
server ("machine B", serves the app on port 3001 and runs the sync
services). GitHub still holds the 2026-09-22 code. Push the missing files
(after checking for secrets) before relying on this repo as the source of
truth.

Files that exist on the machines but not here: `sync_manifest.py`,
`wh-trace.js`, `wh-trace-ui.js`, `apply-wh-trace.js`, `import-yusen.js`,
`yusen-schema.sql`, `yusen-upload.html`, `regroup-check.js`,
`Index/regroup-check.html`, plus later versions of `sync.js`,
`api-server.js` and `Index/index.html`.

### The three sources and how they join

| Step shown | Source | Key |
|---|---|---|
| สั่ง Order / แพ็กเสร็จ / ออกจากคลัง | Supabase `manifest`, filled by `sync_manifest.py` from SQL Server `IS_Warehouse` (`Qry_GetManifestByDate`) | `invoice` = warehouse pick number, e.g. `87162` |
| Yusen รับของ / ถึง Hub / ถึงหน้าสาขา | Supabase `yusen_deliveries`, filled by `import-yusen.js` from Yusen's daily Excel report | `final_invoice` = `manifest.final_no` (10 digits, `26000…`) |
| สาขากดรับเข้า + Article/size lines | MySQL `receiving`, read live through `/api/wh-trace/*` | `SUBSTRING_INDEX(invoice,'_',1)` = pick number, `sender = '68000'` (full form `87162_202611_68000`) |

- In `receiving`, `sendDate` is the day the warehouse shipped and
  `documentDate`/`bookedDate` are the day the store booked the receipt.
  Checked on one store (55030, ~90 invoices since late Aug 2026): the gap
  was always 1–8 days, never 0, and receipts arrive in same-day batches —
  consistent with a real store-side booking, not a row created at dispatch.
  It still only proves the store's system booked it, not that the goods
  are physically there.
- Store receipts reach MySQL the next morning (Talend load, about
  07:00–07:45). A store that receives today shows as "not received" until
  tomorrow.
- The search box takes Final No, pick numbers, a pick range such as
  `87134-87172` (4–6 digit numbers only, max 2,000 per range) or a 7-digit
  Article.

### Time zone bug in the manifest sync (fixed 2026-11-16)

SQL Server stores Bangkok wall-clock time with no zone. `sync_manifest.py`
sent it as-is, Supabase (`timestamptz`) read it as UTC, and the browser
added 7 hours: 15:02 showed as 22:02 and evening times rolled into the
next day (wrong date as well as time). The UI was correct; only the stored
data was wrong.

- Fix: `iso_or_none` now sends datetimes with an explicit `+07:00`.
- `sync_manifest.py` gained `--from YYYY-MM-DD [--to YYYY-MM-DD]` (re-sync a
  fixed range, never reads or moves the watermark) and `--dry-run`.
- A full re-sync `--from 2026-01-01` was started on 2026-11-16 to correct
  the rows already stored. **Confirm it finished**: pick `87137` must show
  ออกจากคลัง 14/11/2026 15:02, matching `t_deliveries.deliverydate`.
- Any new code that writes a SQL Server datetime to Supabase must attach
  `+07:00` the same way. Dates from MySQL `receiving` are date-only and are
  not affected.

### Manifest sync is still manual

`sync_manifest.py` is run by hand on machine A; moving it to machine B as a
scheduled job is unfinished. Before 2026-11-16 it had not run since
2026-10-05, so the การขนส่ง menu and this panel showed no newer invoices.
Until it is scheduled, run it before checking recent invoices.

### Yusen daily report

- First real import done 2026-11-16 (report dated 16-Nov-2026, 2,216 rows).
- The report arrives by email every day as an `.xlsx` attachment named
  like `Bata - Daily Report ( 16-Nov-2026).xlsx` (note the space after the
  bracket). A second mail the same day, titled with a month range such as
  `(01-31-Oct-2026)`, updates the previous month's open invoices.
- Sheet used: `1-Daily report (Normal)`. Header cells carry a second line
  (a type hint) that the importer strips. Rows without a `Final Invoice`
  are skipped (819 of 3,035 in that file; their bill numbers look like
  `11-140`, meaning unknown). For rows that have one, `เลขที่บิล` is
  `<store>-<pick>`, e.g. `55030-87162`.
- `node import-yusen.js "<file>.xlsx" [--dry-run]` imports one local file;
  with no argument it processes files uploaded through `yusen-upload.html`
  (token links, Storage bucket `yusen-uploads`, log table
  `yusen_uploads_log`). The upload page and automatic pickup from the
  mailbox are **not set up yet** — imports are manual for now.
- Dates are read from the Excel serial number, never through
  `Date.toISOString()`, for the same time zone reason as above.
- Not every store is in Yusen's report. For picks 87134–87172, 19 of 39
  were present (upcountry stores); the 20 missing were 514xx/519xx, 51506,
  54098 and 54023. Presumably those are delivered by another carrier —
  **unconfirmed**. For those stores the Yusen steps stay blank.

## Secrets / credentials

- `.env` (git-ignored) holds `MYSQL_HOST/USER/PASSWORD/DATABASE`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `API_PORT`.
- `Index/index.html` embeds `SUPABASE_URL` and a **publishable** key
  (`sb_publishable_...`) directly in client-side JS — this is intentional
  and safe as long as it's the new-format publishable key (or legacy
  `anon` key) and RLS policies are correctly scoped. **Never** put the
  `service_role` / `sb_secret_...` key in `Index/index.html`.
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
  GitHub directly (403) — pushes here are done via the GitHub MCP
  (`push_files`), then the local clone is fast-forwarded with
  `git fetch` + `git reset --hard origin/<branch>`.
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
