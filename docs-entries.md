# ข้อความสำหรับเพิ่มใน CHANGELOG.md และ CLAUDE.md

วางต่อจากของเดิมตามหัวข้อด้านล่าง ตรวจรายละเอียดของหน้า "การขนส่ง" กับโค้ดจริงอีกรอบก่อน commit
(ส่วนนั้นเขียนจากประวัติแชทวันที่ 23 ก.ย. ไม่ได้อ่านจาก index.html ตัวล่าสุดโดยตรง)

---

## CHANGELOG.md

### ส่วนที่ 1 — วางไว้บนสุด (entry ใหม่)

```markdown
## 2026-09-24

### Fixed
- **`sync_manifest.py` watermark skipped the rest of "today"**: after syncing
  the current day the watermark moved to tomorrow, so manifests added later
  the same day were never picked up, and re-running the same day printed
  "Nothing to do -- already synced up to <tomorrow>". The watermark now never
  moves past today, and every run re-syncs today plus the previous
  `MANIFEST_LOOKBACK_DAYS` days (default 2) — safe because rows are upserted on
  `invoice`. The first run after this fix automatically repairs a possibly
  incomplete 2026-09-23. Still not handled: an invoice deleted/voided in
  IS_Warehouse stays in Supabase (upsert never deletes).

### Added
- **"สถานะการส่งของ" view** (Goods on Way + Goods Received in one page):
  new `shipment-status.js` module registered in `api-server.js` before the
  generic `/api/:view` routes. `GET /api/shipment-status` joins MySQL
  `dispatch` (shipped) → `receiving` (received) on invoice + receiver and
  classifies each shipped invoice as กำลังส่ง / รับบางส่วน / รับเกิน / รับครบ,
  with Pair/Accessories diffs, days-in-transit for open shipments and a
  received-more-than-once hint. Dispatch window capped at 62 days, 20,000
  invoices per request. Independent of `LIVE_TABLE` (menu mapping untouched).
  `SHIP_MATCH_KEY=invoice` in `.env` switches to invoice-only matching.
- `GET /api/shipment-status/diagnose` + "ตรวจความพร้อมข้อมูล" button: read-only
  checks (invoice indexes, top senders per table, match rate for 30–44-day-old
  shipments) to confirm the join is valid on real data.
- DiffTotalAmount still deferred (legacy formula unknown).

### Known issue (not fixed)
- The "Warehouse" scope toggle on จ่ายสินค้าออก/โอน/คืน filters with
  `LIKE '%Warehouse%'`, but `sender`/`receiver` are 5-character codes, so it
  can never match. Needs the real warehouse code(s).
```

### ส่วนที่ 2 — เพิ่มในหัวข้อ `## 2026-09-23` เดิม ใต้ `### Added`

```markdown
- **"การขนส่ง" (Transport) view** in `Index/index.html`, backed by the Supabase
  `manifest` table (fed by `sync_manifest.py` from SQL Server `IS_Warehouse`,
  `Qry_GetManifestByDate`): filters (date range, store, Gate No., region,
  invoice), daily summary, flat table, pagination, CSV export, plus a home-page
  shortcut tile. Not live — only as fresh as the last `sync_manifest.py` run —
  but works from anywhere, not just the LAN. Verified against source data for
  2026-09-22.
- `manifest-schema.sql`: Supabase schema for `manifest` (unique on `invoice`).
```

---

## CLAUDE.md

### แก้ตาราง Repo layout — เพิ่ม 2 แถว

```markdown
| `shipment-status.js` | "สถานะการส่งของ" API module: `/api/shipment-status` (dispatch → receiving join, status per invoice) and `/api/shipment-status/diagnose`. Registered in `api-server.js` **before** `/api/:view`. |
| `manifest-schema.sql` | Supabase schema for the `manifest` table behind "การขนส่ง". Run once before the first `sync_manifest.py`. |
```

และแก้คำอธิบายแถว `sync_manifest.py` เป็น:

```markdown
| `sync_manifest.py` | Manifest sync: SQL Server `IS_Warehouse` → Supabase `manifest` (via `pyodbc`, plain HTTP upserts on `invoice`). Run by hand. Watermark in `sync-manifest-state.json` never passes today; each run re-syncs today + `MANIFEST_LOOKBACK_DAYS` (default 2) previous days. |
```

### เพิ่มหัวข้อใหม่ (วางก่อน `## Planned / in progress`)

```markdown
## การขนส่ง (Transport) — Supabase `manifest`, not live

Reads the Supabase `manifest` table directly from the browser (not
`api-server.js`), so it works off-LAN but is only as fresh as the last
`python sync_manifest.py` run (no cron yet). One row per invoice shipped out
of the warehouse (`manifest_date`, `store`, `gate_no`, `region`, carton and
pair/acc counts from the SP). `sync_manifest.py` never deletes rows — an
invoice voided at the source stays in Supabase.

## สถานะการส่งของ (dispatch → receiving loop)

`shipment-status.js` joins MySQL `dispatch` (what was shipped) with
`receiving` (what arrived). It deliberately does **not** go through
`LIVE_TABLE`: the loop direction comes from what the tables mean, so the
menu remap can't invert it. Join key is invoice + receiver (confirmed with
the user); `SHIP_MATCH_KEY=invoice` switches to invoice-only. Status is
computed in Node (`classify()`), qty only — no amount diff until the legacy
DiffTotalAmount formula is known. The front end uses its own `data-ship-*`
attributes, **not** `data-live`, because the generic live handlers would call
`loadLive()` with a view that has no `LIVE_TABLE` entry.

Open question: whether warehouse → store shipments appear in `dispatch` at
all (the warehouse manager had "จ่ายสินค้าออก" show `receiving`). If the
diagnose check shows the warehouse code only on the receiving side, the
sender side for warehouse shipments has to come from `manifest` instead.
```

แล้วลบบรรทัดเรื่อง Dispatch→receiving loop ในหัวข้อ `## Planned / in progress` ออก (ทำแล้ว)
