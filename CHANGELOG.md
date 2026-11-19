# Changelog

All notable changes to this project are documented here. Format is
loosely based on [Keep a Changelog](https://keepachangelog.com/), grouped
by date.

## 2026-11-19

### Added
- เมนู "ตรวจนับสต็อก" (`stockcount`): Dashboard สรุปการนับ (KPI, สถานะ Location,
  แผนผัง Rack A–V, ตารางภาพรวมแบบชีต CS ตำแหน่งไซส์ 1–13, กราฟ, รายการล่าสุด)
  ไฟล์ใหม่ `Index/stockcount-dashboard.js` แทนภาพ 3D จำลองเดิมของเมนูนี้
  **ใช้ข้อมูลตัวอย่างที่สร้างในโค้ด ไม่ใช่ข้อมูลจริง** (repo เป็น public จึงไม่ใส่
  ข้อมูลสต็อกจริง) ยังไม่มีตารางใน Supabase และยังไม่ต่อกับแอปนับบนมือถือ
  ปุ่ม ส่งออก Excel / สั่งนับซ้ำ ยังปิดอยู่
- `stockcount-schema.sql`: ตารางตรวจนับใน Supabase (`sc_cycles`, `sc_locations`,
  `sc_articles`, `sc_counts`, `sc_location_rounds`, `sc_recounts`) + view สรุป
  (`sc_item_status`, `sc_location_status`, `sc_rack_summary`, `sc_daily`,
  `sc_operator_daily`) และ RLS (ทุกคนที่ล็อกอินอ่านได้, admin/warehouse_staff เขียน)
  กติกา: รอบ 1 = รอบ 2 ต้องเท่ากันเป๊ะ ไม่ตรง → สั่งนับซ้ำรายรายการ รอบ 3 แล้วรอบ 4 (สูงสุด 4)
  ข้อมูลหลัก (Article/Location) นำเข้าเองแบบส่วนตัว **ห้ามใส่ใน repo**
- Dashboard ตรวจนับ: ถ้ามีรอบนับสถานะ open และมี Location ใน `sc_locations`
  จะอ่านข้อมูลจริงจาก Supabase (ผ่าน view ไม่ติดเพดาน 1000 แถว) ไม่เช่นนั้น
  แสดงข้อมูลตัวอย่างพร้อมแถบแจ้ง

## 2026-09-26

### Added
- "เช็คตามใบ Regroup": `regroup-check.js` (`POST /api/regroup-check`,
  `GET /api/regroup-check/columns`) and `Index/regroup-check.html`.
  Parses sheet Memo of the monthly Regroup workbook in the browser and
  compares the plan (store → store, Article + Size, QTY) against
  `dispatch` (shipped) and `receiving` (received, matched on invoice +
  receiver). Views: by receiving store, by sending store, by store pair
  (down to Article/Size and invoices), pending invoices; CSV export;
  district filter. Tested against the Sep 2026 memo (27,515 lines,
  1,599 store pairs) and validated on real data for store 51426.
- `DEPLOYMENT.md` — runbook for the machine A / machine B setup.

### Changed
- **Production moved to machine B** (`192.1.36.59`,
  `D:\Project\Bata-WMS`) as two NSSM Windows services that start at boot
  without login: `BataWMS` (`api-server.js`, port 3001) and `BataSync`
  (`sync.js`). Windows Firewall rule "Bata WMS 3001" added. Machine A
  (`danai.m`) is now development only; sync on machine A (including the
  Task Scheduler job running `sync-all.bat` / `node sync.js --once`) was
  disabled and `sync-state.json` moved to machine B. First run on B
  resumed from the existing watermark and finished with verify
  "ตรงกันหมด" on both tables.
- Users now access the app at `http://192.1.36.59:3001` from the office
  LAN or via the company VPN ("To Vigor").
- `sync.js` `SCHEDULE` changed from 12:00/18:00/22:00 to **08:00 +
  12:00**, to run right after the daily Talend load.
- `api-server.js`: `regroup-check` module required at the top and
  registered right after `registerShipmentStatus(app, getPool)` (an
  earlier placement before `const app` crashed the server on start).
- `CLAUDE.md` updated: current deployment, data freshness, Regroup check,
  MySQL credential caveat, deploy/sync rules.

### Findings
- MySQL `reporting.dispatch`/`receiving` are loaded by a **Talend job once
  a day (07:00–07:45)** — confirmed from a 3-day `updatedAt` histogram.
  "Live" views are only as fresh as that load; today's documents appear
  the next morning. Requested IT to run the job more often.
- The only MySQL Event, `aggregate_stockmovement...` (daily 08:25),
  belongs to another system and is not the loader.
- `bata_core` contains master data only (stores, districts, estimates) —
  no dispatch/receiving tables.
- The inter-store transfers are recorded in `dispatch`/`receiving` the
  same way as warehouse ↔ store movements (verified for store 51426).

### Security
- The MySQL user in use (`talend`) has `ALL PRIVILEGES` on `reporting`.
  Requested a read-only user from IT; to be swapped into `.env` on
  machine B when available.

### Note
- Work done 2026-09-23 to 2026-09-25 (`shipment-status.js`,
  `article-trace.js`, `wh-trace.js`, `/api/:view/detail`, and the
  `sync.js` date fix, reconcile, verify and `--once` changes) is not yet
  written up in this changelog, and none of it is on GitHub yet.

## 2026-09-22

### Added
- Added `reconcile-schema.sql` (Supabase schema: `reconcile_batches`/
  `reconcile_items`/`reconcile_scans`, RLS gated to admin/warehouse_staff)
  for the planned "กระทบยอด" (barcode reconcile) feature. **Correction**:
  this entry originally (and incorrectly) claimed the feature's UI/JS —
  Excel upload, barcode scanning, live stats, CSV report, close/History —
  was built out too. It was not; only this schema file was added, and
  `view-reconcile` in `Index/index.html` remained the generic
  "ยังไม่ได้สร้าง UI ส่วนนี้" placeholder. The actual UI + matching logic
  was built later the same day once real data from the legacy system was
  available — see the entry below.
- Built out the "กระทบยอด" (barcode reconcile) UI in `Index/index.html`
  for real this time (`view-reconcile`), plus matching logic
  reverse-engineered from real `T_Reconcile_Base`/`T_Reconcile_Scan`/
  `T_Reconcile_Report` data from the legacy Google Sheets system:
  โหลด/สร้างรอบงาน, ผูกไฟล์ตั้งต้นกับรอบนี้ (SheetJS, replaces existing
  items), ยิงบาร์โค้ด (parses 13-digit barcodes into Article+Size,
  matches against the ไฟล์ตั้งต้น with an over-scan cap so scans past a
  line's qty are rejected instead of over-counted), live stats
  (ยอดตั้งต้น/ยอดยิงสำเร็จ/ผลต่าง, ตรง/ยังไม่ครบ/ยังไม่ได้ยิง line
  counts), ดูรายการค้าง, สร้างรายงานลูกค้า (CSV), ล้างผลการยิง,
  ลบรายการตาม Article, and ปิดงาน/บันทึก History (closes the batch
  read-only and writes a `reconcile_history` row). Added
  `reconcile_history` table and a `remark` column on `reconcile_items` to
  `reconcile-schema.sql` (re-run it in Supabase to pick up both). See
  CLAUDE.md for the full write-up, including which parts (the
  error/rejected-scan split) are inferred rather than confirmed against
  the legacy system.
- Dates formatted as dd/mm/yyyy instead of yyyy-mm-dd in live tables,
  the Home page's recent-documents table, and CSV exports.
- Built out "สินค้าคืนคลัง" (Return) as a full live view (filters, daily
  summary, pagination, CSV export) showing `receiving` rows where
  `receiver = 57702` — these are warehouse returns, previously mixed into
  "จ่ายสินค้าออก".

### Changed
- `api-server.js` now splits the `receiving` table into two API views:
  `receiving` (used by "จ่ายสินค้าออก") always excludes `receiver = 57702`;
  a new `receiving-return` view (used by "สินค้าคืนคลัง") always locks to
  `receiver = 57702` only. Neither condition can be overridden by query
  params.

### Removed
- Stopped using the public GitHub Pages deployment at `tms.batathai.com`
  — removed the `CNAME` file. `http://<lan-ip>:3001` (served by
  `api-server.js`) is now the only way the app is accessed. Updated
  `CLAUDE.md`, `README.md`, and `Index/README.md` to reflect this.

## 2026-09-21

### Added
- 9 new sidebar menu items (placeholders, no UI built yet — Admin/
  Warehouse Staff) matching an updated WMS menu spec: วางแผนจ่ายสินค้า
  (Outbound Planning), การขนส่ง (Transport), OCR รับคืนสินค้า (Goods
  Return OCR), ตรวจสอบสต็อก (Stock Audit), ยิงรีเช็ค (Recheck Scan),
  ตำแหน่งจัดเก็บ (Bulk Location), สต็อกคงเหลือ (Stock On-Hand), OCR
  ตรวจเอกสาร, and ความเคลื่อนไหวสต็อก (Stock Movement).
- `CLAUDE.md` and `CHANGELOG.md` added to document the project's
  architecture and history for future contributors (human or AI).

### Note
- The spec's menu list included a few items that already exist under a
  different name (Transfer → โอนสินค้าระหว่างคลัง, Return →
  สินค้าคืนคลัง, Reconcile Scan → กระทบยอด). Per user confirmation, the
  existing menus were left as-is rather than duplicated or renamed.

## 2026-09-18

### Fixed
- Numeric column headers (จำนวนใบ, คู่, อุปกรณ์เสริม, ยอดรวม) in the daily
  summary and main live tables were left-aligned while the numbers below
  them were right-aligned — added `th.num` alongside `td.num` so headers
  and data line up.
- `sync.js` was silently failing to map MySQL's `Id` column (capital I) to
  Postgres's `id`, causing `null value in column "id"` errors. Added it to
  `COLUMN_MAP`.
- Home page KPI totals were undercounted on high-volume days because
  Supabase/PostgREST caps query results at 1000 rows by default. Added an
  explicit `.limit(20000)` to the dispatch/receiving queries in
  `loadHomeData()`.
- Upgraded `@supabase/supabase-js` to the latest version — the old version
  couldn't authenticate with Supabase's newer `sb_secret_...` key format.
- Switched from Supabase's legacy `service_role` JWT key to the new
  `sb_secret_.../sb_publishable_...` key format project-wide.

### Changed
- **Live view data remap** (per warehouse manager feedback on what each
  menu should actually display): the "จ่ายสินค้าออก" (Dispatch) menu now
  shows the MySQL `receiving` table's data, and a newly built-out
  "โอนสินค้าระหว่างคลัง" (Transfer) menu shows the MySQL `dispatch` table's
  data. "รับสินค้าเข้า" (Receive) is now an empty placeholder pending a
  real data source.
- Gave "โอนสินค้าระหว่างคลัง" the full live-view UI (filters, daily
  summary, pagination, CSV export) matching the existing Dispatch view.
  All English column headers/filter placeholders in the live views were
  translated to Thai.
- Renamed sidebar/home-shortcut menu labels: "ย้ายโลเคชั่น" →
  "โอนสินค้าระหว่างคลัง", "รับคืนสินค้า" → "สินค้าคืนคลัง".
- `sync.js` now loops internally through pages (5000 rows/page) until
  fully caught up in a single run, persisting the watermark after every
  page, instead of syncing only one page per invocation. A large backfill
  (millions of rows) now finishes in one run and safely resumes from the
  last saved page if interrupted (Ctrl+C or crash).
- Truncated the Supabase `dispatch`/`receiving` tables and reset the sync
  watermark to start the backfill from the beginning of the current year
  instead of full history, per request.

### Security
- **Incident**: a real MySQL password and a real (later found non-working
  legacy) Supabase `service_role` JWT were accidentally committed to
  `.env.example` on the public repo. Fixed by restoring the placeholder
  version of `.env.example`; the MySQL password and the Supabase legacy
  JWT secret should be rotated (the exposure remains permanently in git
  history regardless).
- Used a temporary `ngrok http 3001` tunnel to demo the LAN-only API to a
  warehouse manager across network segments — explicitly temporary, closed
  after the demo, since `api-server.js` has no auth layer of its own and
  talks directly to production MySQL.

## 2026-09-17

### Added
- Live Dispatch/Receiving views backed directly by MySQL via a new
  LAN-only `api-server.js` (Express), so warehouse staff on-site see data
  with no sync delay. Serves both the `/api/:table` live API and the
  static `Index/index.html` app from one process.
- Daily summary ("สรุปยอดรายวัน") panel above the main invoice table in
  the live Dispatch/Receiving views, grouped by document date.
- Date picker on the Home page so KPIs can be viewed for any day, not just
  today.
- Reset Filter button that clears both the field filters and the
  All/Warehouse scope toggle back to defaults.
- Initial WMS project scaffold: `schema.sql` (Supabase schema mirroring
  MySQL `dispatch`/`receiving`), `sync.js` (MySQL → Supabase incremental
  sync), and setup docs.

### Changed
- Merged the separate live-data page into the main `Index/index.html` app
  (removed redundant `public/index.html` and `public/live.html`).
- Dispatch/Receiving date filters default to today instead of showing an
  unfiltered (and therefore extremely slow) query across millions of rows.
- Pointed `Index/index.html` at the new Supabase project (new URL/key).

## 2026-06-08 to 2026-06-11

- Early iteration on `index.html` and removal of an unused `logistic.html`
  page. Added `CNAME` for the GitHub Pages custom domain.

## 2026-05-29

- Initial upload of the project.
