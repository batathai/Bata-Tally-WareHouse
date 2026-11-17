/**
 * Bata Kore Stock Movement — MySQL → Supabase sync
 *
 * Source : MySQL, host 192.1.1.38, database `reporting`, tables `dispatch` & `receiving`
 * Target : Supabase (Postgres) — run schema.sql there first
 *
 * Strategy: incremental sync using each row's `updatedAt` column as a
 * watermark. Every run, we pull only rows changed since the last successful
 * sync and upsert them into Supabase by `id` (same id as the MySQL source).
 * The watermark is stored locally in sync-state.json next to this script.
 *
 * Runs once immediately, then on a daily schedule (see SCHEDULE below).
 * Keep the terminal window open, same pattern as auto-sync.js.
 */

const mysql = require('mysql2/promise');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── Config ─────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'sync-state.json');
const TABLES = ['dispatch', 'receiving'];

// Cron schedule(s) to run the sync automatically each day.
// Default: 3 times a day. Edit these to fit when your source data actually changes.
const SCHEDULE = ['0 12 * * *', '0 18 * * *', '0 22 * * *']; // 12:00, 18:00, 22:00

// Column name mapping: MySQL camelCase -> Postgres snake_case
const COLUMN_MAP = {
  Id: 'id',
  bookedDate: 'booked_date',
  sendDate: 'send_date',
  documentDate: 'document_date',
  subCategory: 'sub_category',
  isFootware: 'is_footware',
  isFA2A: 'is_fa2a',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const PASSTHROUGH_COLUMNS = [
  'sender', 'receiver', 'invoice', 'article', 'size',
  'items', 'category', 'price', 'amount',
];

// ─── Clients ────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service_role key — this script runs server-side only
);

async function getMysqlConnection() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    // SYNC-DATE-FIX: keep MySQL DATE as 'YYYY-MM-DD' text — as a JS Date it was
    // serialized to UTC and shifted one day early (UTC+7).
    dateStrings: ['DATE'],
  });
}

// ─── State (last-synced watermark per table) ───────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Row transform: MySQL row -> Supabase row ──────────────────
function transformRow(row) {
  const out = {};
  for (const col of PASSTHROUGH_COLUMNS) {
    if (col in row) out[col] = row[col];
  }
  for (const [mysqlCol, pgCol] of Object.entries(COLUMN_MAP)) {
    if (mysqlCol in row) out[pgCol] = row[mysqlCol];
  }
  // MySQL tinyint(1) -> JS 0/1 -> Postgres boolean
  if ('is_footware' in out) out.is_footware = !!out.is_footware;
  if ('is_fa2a' in out) out.is_fa2a = !!out.is_fa2a;
  out.synced_at = new Date().toISOString();
  return out;
}

// ─── Sync one table ─────────────────────────────────────────────
// Loops in pages of 5000 until caught up to "now" (or a page comes back
// short), persisting the watermark after every page — a large first-time
// backfill (millions of rows) finishes in one run instead of one page per
// scheduled run, and a crash partway through resumes from the last saved
// page instead of redoing the whole table.
async function syncTable(conn, table, state) {
  // SYNC-DATE-FIX: the saved watermark is UTC ISO text; turn it back into a Date so
  // mysql2 converts it to local time (as a raw string MySQL read it 7h early).
  let since = state[table] ? new Date(state[table]) : new Date(0);
  let totalSynced = 0;

  for (;;) {
    const [rows] = await conn.execute(
      `SELECT * FROM \`${table}\` WHERE updatedAt > ? ORDER BY updatedAt ASC LIMIT 5000`,
      [since]
    );

    if (rows.length === 0) {
      if (totalSynced === 0) console.log(`[${table}] no changes since ${since}`);
      break;
    }

    const payload = rows.map(transformRow);

    // Upsert in batches of 500 to stay well under request size limits
    const BATCH = 500;
    for (let i = 0; i < payload.length; i += BATCH) {
      const chunk = payload.slice(i, i + BATCH);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
      if (error) throw new Error(`[${table}] upsert failed: ${error.message}`);
    }

    since = rows[rows.length - 1].updatedAt;
    totalSynced += rows.length;
    state[table] = since;
    saveState(state);
    console.log(`[${table}] synced ${rows.length} row(s) (total ${totalSynced}), watermark -> ${since}`);

    if (rows.length < 5000) break; // caught up to "now"
  }
}

// ─── Main run ────────────────────────────────────────────────────
// ─── SYNC-RECONCILE: delete Supabase rows whose Id is gone from MySQL ─────────
// The source re-loads recent days with NEW Ids, so upsert-by-Id alone leaves
// the old copies behind. Compares the last RECONCILE_DAYS days only.
const RECONCILE_DAYS = 14;

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function reconcileTable(conn, table) {
  const start = new Date();
  start.setDate(start.getDate() - RECONCILE_DAYS);
  const since = localDateStr(start);

  // SYNC-RECONCILE-FIX: SELECT * (not just Id) so every row in the window can be
  // re-upserted below — this is what makes the window self-healing
  // regardless of updatedAt/watermark quirks in the source.
  const [srcRows] = await conn.execute(
    `SELECT * FROM \`${table}\` WHERE documentDate >= ?`, [since]
  );
  if (srcRows.length === 0) {
    console.log(`[${table}] reconcile skipped — MySQL returned no rows since ${since}`);
    return;
  }
  const srcIds = new Set(srcRows.map((r) => Number(r.Id)));

  // Re-upsert every MySQL row in the window, every run — fixes rows that
  // are simply missing from Supabase, which the old Id-diff-and-delete
  // logic could never do.
  const payload = srcRows.map(transformRow);
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const { error } = await supabase.from(table).upsert(payload.slice(i, i + BATCH), { onConflict: 'id' });
    if (error) throw new Error(`[${table}] reconcile upsert failed: ${error.message}`);
  }

  const stale = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table).select('id').gte('document_date', since)
      .order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`[${table}] reconcile read failed: ${error.message}`);
    for (const r of data) if (!srcIds.has(Number(r.id))) stale.push(r.id);
    if (data.length < PAGE) break;
  }

  for (let i = 0; i < stale.length; i += 500) {
    const chunk = stale.slice(i, i + 500);
    const { error } = await supabase.from(table).delete().in('id', chunk);
    if (error) throw new Error(`[${table}] reconcile delete failed: ${error.message}`);
  }
  console.log(`[${table}] reconcile since ${since}: MySQL ${srcIds.size} row(s), refreshed ${payload.length}, removed ${stale.length} stale row(s) from Supabase`);
}

// ─── SYNC-VERIFY: MySQL vs Supabase match check, every run ─────────────────
// Reports only — never writes. A mismatch here means reconcileTable's
// delete-by-Id pass didn't fully clean up (e.g. a row was EDITED in place in
// MySQL, not re-Id'd, so upsert should have caught it — investigate if this
// fires) or dateStrings ordering slipped. Widen VERIFY_DAYS if the source
// re-loads further back than a week.
const VERIFY_DAYS = 7;
const VERIFY_FN = { dispatch: 'dispatch_daily_check', receiving: 'receiving_daily_check' };

async function verifyTable(conn, table) {
  const start = new Date();
  start.setDate(start.getDate() - VERIFY_DAYS);
  const since = localDateStr(start);

  const [mysqlRows] = await conn.execute(
    `SELECT documentDate AS day, COUNT(DISTINCT invoice) AS invoices, COUNT(*) AS \`lines\`,
            SUM(items) AS items, SUM(amount) AS amount
     FROM \`${table}\` WHERE documentDate >= ? GROUP BY documentDate ORDER BY documentDate`,
    [since]
  );

  const { data: pgRows, error } = await supabase.rpc(VERIFY_FN[table], { p_since: since });
  if (error) {
    console.error(`[${table}] verify SKIPPED — ${error.message}`);
    console.error(`  (ได้รัน sync-verify-functions.sql ใน Supabase SQL Editor แล้วหรือยัง?)`);
    return;
  }

  const byDay = new Map((pgRows || []).map((r) => [String(r.day).slice(0, 10), r]));
  let allOk = true;
  const detail = [];
  for (const m of mysqlRows) {
    const day = String(m.day).slice(0, 10);
    const p = byDay.get(day) || { invoices: 0, lines: 0, items: 0, amount: 0 };
    const ok =
      Number(m.invoices) === Number(p.invoices) &&
      Number(m.lines) === Number(p.lines) &&
      Number(m.items) === Number(p.items) &&
      Math.abs(Number(m.amount) - Number(p.amount)) < 0.01;
    if (!ok) allOk = false;
    detail.push(
      `  ${ok ? '✅' : '❌'} ${day}  MySQL[ใบ ${m.invoices} บรรทัด ${m.lines} ยอด ${m.amount}]  Supabase[ใบ ${p.invoices} บรรทัด ${p.lines} ยอด ${p.amount}]`
    );
  }

  console.log(`[${table}] verify (${since} ถึงวันนี้): ${allOk ? 'ตรงกันหมด ✅' : '*** พบข้อมูลไม่ตรงกัน ❌ ดูรายละเอียดด้านล่าง ***'}`);
  if (!allOk) detail.forEach((l) => console.log(l));
}

async function runSync() {
  const startedAt = new Date().toISOString();
  console.log(`\n=== Sync started ${startedAt} ===`);

  const state = loadState();
  const conn = await getMysqlConnection();

  try {
    for (const table of TABLES) {
      await syncTable(conn, table, state);
      await reconcileTable(conn, table); // SYNC-RECONCILE
      await verifyTable(conn, table); // SYNC-VERIFY
    }
    console.log('=== Sync finished OK ===\n');
  } catch (err) {
    console.error('=== Sync FAILED — state saved up to the last successful page, will resume from there next run ===');
    console.error(err);
  } finally {
    await conn.end();
  }
}

// ─── Entry point ─────────────────────────────────────────────────
(async () => {
  await runSync(); // run once immediately on start
  // SYNC-ONCE: "node sync.js --once" = one run, then exit (used by sync-all.bat /
  // Task Scheduler). Without --once the daily schedule below still applies.
  if (process.argv.includes('--once')) {
    console.log('--once: finished, exiting without scheduling.');
    process.exit(0);
  }

  for (const expr of SCHEDULE) {
    cron.schedule(expr, runSync);
  }
  console.log(`Scheduled sync at: ${SCHEDULE.join(', ')} (server local time). Leave this window open.`);
})();
