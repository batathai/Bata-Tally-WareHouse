/**
 * Bata WMS — "เช็คตามใบ Regroup" (inter-store transfer plan check), LAN-only.
 *
 * The monthly Regroup workbook (sheet "Memo") lists planned store → store
 * transfers per Article + Size, but carries no invoice numbers. The browser
 * parses that sheet (SheetJS, nothing uploaded to disk) and POSTs the plan
 * lines here. This module then:
 *
 *   1. pulls MySQL `dispatch` rows (what was shipped) in the date window for
 *      the planned sender/receiver pairs,
 *   2. pulls MySQL `receiving` rows for exactly those invoices, matched on
 *      invoice + receiver (same join key as "สถานะการส่งของ"),
 *   3. compares both against the plan, per line, per store pair.
 *
 * Status per pair (and per line):
 *   notsent  ยังไม่ส่ง   — nothing from the plan was shipped
 *   pending  ค้างรับ     — shipped, but at least one invoice not fully received
 *   short    ส่งไม่ครบ   — everything shipped was received, but less than planned
 *   done     ครบ        — shipped ≥ plan and fully received
 *
 * Matching depth is picked automatically from the real table columns:
 *   "article" — dispatch/receiving both have an article and a size column:
 *               compares Article + Size (the accurate mode)
 *   "pair"    — fallback: compares footwear vs accessories totals per store
 *               pair (memo size "000" = accessories, isFootware = 0 in MySQL)
 * Override detection with REGROUP_ARTICLE_COL / REGROUP_SIZE_COL in .env.
 *
 * Read-only: never writes to MySQL. Deliberately independent of LIVE_TABLE
 * in Index/index.html — dispatch = shipped, receiving = received, fixed.
 *
 * Usage in api-server.js (before app.listen, anywhere before or after
 * /api/:view — this route is POST, /api/:view is GET):
 *   const registerRegroupCheck = require('./regroup-check');
 *   registerRegroupCheck(app, getPool);
 */

const express = require('express');

const MAX_LINES = 80000;          // Sep 2026 memo has 27,515 lines
const MAX_RANGE_DAYS = 62;
const RECEIVE_LOOKBACK_DAYS = 7;  // receiving rows may carry a slightly earlier date
const INVOICE_CHUNK = 1000;
const QUERY_TIMEOUT_MS = 120000;

const STATUS_LABEL = { notsent: 'ยังไม่ส่ง', pending: 'ค้างรับ', short: 'ส่งไม่ครบ', done: 'ครบ' };

// ─── normalisers (memo cells and MySQL values must meet in the middle) ───
function normStore(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10)).padStart(5, '0');
  return s.toUpperCase();
}
function normArticle(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10)).padStart(7, '0');
  return s;
}
function normSize(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (/^\d+(\.0+)?$/.test(s)) return String(parseInt(s, 10)).padStart(3, '0');
  return s;
}
const isAccSize = (size) => size === '000';

function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s)); }
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function toIso(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return d == null ? null : String(d).slice(0, 10);
}

// ─── column detection (cached per process) ───────────────────────────
let columnCache = null;
async function detectColumns(pool) {
  if (columnCache) return columnCache;
  const result = {};
  for (const table of ['dispatch', 'receiving']) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    const names = cols.map((c) => c.Field);
    const exact = (want) => names.find((n) => n.toLowerCase() === want.toLowerCase()) || null;
    const pick = (envName, candidates) => {
      if (process.env[envName]) return exact(process.env[envName]); // must really exist
      for (const c of candidates) { const hit = exact(c); if (hit) return hit; }
      return null;
    };
    result[table] = {
      article: pick('REGROUP_ARTICLE_COL', ['article', 'articleNo', 'articleCode', 'article_no', 'article_code', 'itemCode']),
      size: pick('REGROUP_SIZE_COL', ['size', 'sizeCode', 'size_code', 'sizeNo']),
      columns: names,
    };
  }
  const detailed = ['dispatch', 'receiving'].every((t) => result[t].article && result[t].size);
  columnCache = { ...result, mode: detailed ? 'article' : 'pair' };
  return columnCache;
}

// SELECT fragment giving each row its comparison key parts.
function keySelect(cols, mode) {
  if (mode === 'article') return `\`${cols.article}\` AS article, \`${cols.size}\` AS size`;
  return `CASE WHEN isFootware = 1 THEN 'FW' ELSE 'ACC' END AS article, '' AS size`;
}
function keyGroup(mode) { return mode === 'article' ? 'article, size' : 'article'; }

function rowKey(mode, article, size) {
  return mode === 'article' ? `${normArticle(article)}|${normSize(size)}` : String(article);
}

// ─── core ────────────────────────────────────────────────────────────
async function runCheck(pool, body) {
  const { dateFrom, dateTo, lines } = body || {};
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) throw httpErr(400, 'ต้องระบุวันที่เริ่มและวันที่สิ้นสุด (YYYY-MM-DD)');
  if (dateTo < dateFrom) throw httpErr(400, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  const span = Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000);
  if (span > MAX_RANGE_DAYS) throw httpErr(400, `ช่วงวันที่ยาวเกิน ${MAX_RANGE_DAYS} วัน`);
  if (!Array.isArray(lines) || !lines.length) throw httpErr(400, 'ไม่มีรายการจากใบ Regroup');
  if (lines.length > MAX_LINES) throw httpErr(400, `รายการเกิน ${MAX_LINES} บรรทัด`);

  const cols = await detectColumns(pool);
  const mode = cols.mode;

  // 1) plan: pairKey -> { from, to, lines: Map(key -> line) }
  const plan = new Map();
  let badLines = 0;
  for (const l of lines) {
    const from = normStore(l.from);
    const to = normStore(l.to);
    const qty = Number(l.qty);
    if (!/^\d{5}$/.test(from) || !/^\d{5}$/.test(to) || !(qty > 0)) { badLines++; continue; }
    const article = normArticle(l.article);
    const size = normSize(l.size);
    const key = mode === 'article' ? `${article}|${size}` : (isAccSize(size) ? 'ACC' : 'FW');
    const pk = `${from}>${to}`;
    let p = plan.get(pk);
    if (!p) { p = { from, to, lines: new Map(), invoices: new Map(), offPlanSent: 0, offPlanRecv: 0 }; plan.set(pk, p); }
    let line = p.lines.get(key);
    if (!line) {
      line = mode === 'article'
        ? { article, size, qty: 0, sent: 0, recv: 0 }
        : { article: key === 'ACC' ? 'Accessories' : 'รองเท้า', size: '', qty: 0, sent: 0, recv: 0 };
      p.lines.set(key, line);
    }
    line.qty += qty;
  }
  if (!plan.size) throw httpErr(400, 'อ่านรายการในใบ Regroup ไม่ได้เลย (รหัสร้านหรือจำนวนไม่ถูกต้อง)');

  const senders = [...new Set([...plan.values()].map((p) => p.from))];
  const receivers = [...new Set([...plan.values()].map((p) => p.to))];

  // 2) dispatch rows for planned pairs in the window
  const dc = cols.dispatch;
  const [dRows] = await pool.query({
    sql: `
      SELECT sender, receiver, invoice, MIN(documentDate) AS documentDate,
             ${keySelect(dc, mode)}, SUM(items) AS qty
      FROM dispatch
      WHERE documentDate >= ? AND documentDate <= ?
        AND sender IN (?) AND receiver IN (?)
      GROUP BY sender, receiver, invoice, ${keyGroup(mode)}`,
    timeout: QUERY_TIMEOUT_MS,
  }, [dateFrom, dateTo, senders, receivers]);

  const invoiceOwner = new Map(); // `${invoice}|${receiver}` -> pair
  let dispatchRowsUsed = 0;
  const dbSamples = new Set();
  for (const r of dRows) {
    const p = plan.get(`${normStore(r.sender)}>${normStore(r.receiver)}`);
    if (!p) continue; // same stores, but not a planned pair
    dispatchRowsUsed++;
    const qty = Number(r.qty) || 0;
    const inv = String(r.invoice);
    let iv = p.invoices.get(inv);
    if (!iv) { iv = { invoice: inv, date: toIso(r.documentDate), sent: 0, recv: 0, recvDate: null, sentInPlan: 0 }; p.invoices.set(inv, iv); }
    iv.sent += qty;
    if (iv.date == null || toIso(r.documentDate) < iv.date) iv.date = toIso(r.documentDate);
    invoiceOwner.set(`${inv}|${p.to}`, p);
    const key = rowKey(mode, r.article, r.size);
    if (dbSamples.size < 8) dbSamples.add(mode === 'article' ? `${r.article} / ${r.size}` : key);
    const line = p.lines.get(key);
    if (line) { line.sent += qty; iv.sentInPlan += qty; } else p.offPlanSent += qty;
  }

  // 3) receiving rows for exactly those invoices (invoice + receiver)
  const rc = cols.receiving;
  const invoices = [...new Set([...invoiceOwner.keys()].map((k) => k.split('|')[0]))];
  let receivingRowsUsed = 0;
  for (let i = 0; i < invoices.length; i += INVOICE_CHUNK) {
    const chunk = invoices.slice(i, i + INVOICE_CHUNK);
    const [rRows] = await pool.query({
      sql: `
        SELECT invoice, receiver, MIN(documentDate) AS documentDate,
               ${keySelect(rc, mode)}, SUM(items) AS qty
        FROM receiving
        WHERE documentDate >= ? AND invoice IN (?)
        GROUP BY invoice, receiver, ${keyGroup(mode)}`,
      timeout: QUERY_TIMEOUT_MS,
    }, [addDays(dateFrom, -RECEIVE_LOOKBACK_DAYS), chunk]);

    for (const r of rRows) {
      const inv = String(r.invoice);
      const p = invoiceOwner.get(`${inv}|${normStore(r.receiver)}`);
      if (!p) continue;
      receivingRowsUsed++;
      const qty = Number(r.qty) || 0;
      const iv = p.invoices.get(inv);
      iv.recv += qty;
      const d = toIso(r.documentDate);
      if (!iv.recvDate || d > iv.recvDate) iv.recvDate = d;
      const line = p.lines.get(rowKey(mode, r.article, r.size));
      if (line) line.recv += qty; else p.offPlanRecv += qty;
    }
  }

  // 4) roll up
  const pairs = [];
  const totals = { plan: 0, sent: 0, recv: 0, pairs: 0, byStatus: { notsent: 0, pending: 0, short: 0, done: 0 } };
  let planLines = 0; let matchedLines = 0;
  for (const p of plan.values()) {
    let planQty = 0; let sent = 0; let recv = 0; let short = 0;
    const outLines = [];
    for (const l of p.lines.values()) {
      planLines++;
      if (l.sent > 0) matchedLines++;
      planQty += l.qty; sent += l.sent; recv += l.recv;
      short += Math.max(0, l.qty - l.sent);
      let ls;
      if (l.sent === 0) ls = 'notsent';
      else if (l.recv < l.sent) ls = 'pending';
      else if (l.sent < l.qty) ls = 'short';
      else ls = 'done';
      outLines.push([l.article, l.size, l.qty, l.sent, l.recv, ls]);
    }
    const invList = [...p.invoices.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const pendingInv = invList.filter((iv) => iv.sentInPlan > 0 && iv.recv < iv.sent);
    const pendingQty = pendingInv.reduce((s, iv) => s + (iv.sent - iv.recv), 0);

    let status;
    if (sent === 0) status = 'notsent';
    else if (pendingInv.length) status = 'pending';
    else if (short > 0) status = 'short';
    else status = 'done';

    totals.plan += planQty; totals.sent += sent; totals.recv += recv;
    totals.pairs++; totals.byStatus[status]++;

    pairs.push({
      from: p.from, to: p.to, status,
      plan: planQty, sent, recv, short, pendingQty,
      pendingInvoices: pendingInv.length,
      offPlanSent: p.offPlanSent, offPlanRecv: p.offPlanRecv,
      invoices: invList.map((iv) => ({ invoice: iv.invoice, date: iv.date, sent: iv.sent, recv: iv.recv, recvDate: iv.recvDate, inPlan: iv.sentInPlan > 0 })),
      lines: outLines,
    });
  }

  return {
    mode,
    window: { dateFrom, dateTo, receiveFrom: addDays(dateFrom, -RECEIVE_LOOKBACK_DAYS) },
    statusLabel: STATUS_LABEL,
    totals,
    pairs,
    diag: {
      columns: { dispatch: { article: dc.article, size: dc.size }, receiving: { article: rc.article, size: rc.size } },
      planLines, matchedLines, badLines,
      dispatchRowsUsed, receivingRowsUsed, invoices: invoices.length,
      dbSamples: [...dbSamples],
    },
  };
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = function registerRegroupCheck(app, getPool) {
  app.post('/api/regroup-check', express.json({ limit: '20mb' }), async (req, res) => {
    const t0 = Date.now();
    try {
      const out = await runCheck(getPool(), req.body);
      out.diag.ms = Date.now() - t0;
      res.json(out);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('[POST /api/regroup-check] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });

  // Which columns will be used, without running the check.
  app.get('/api/regroup-check/columns', async (req, res) => {
    try {
      columnCache = null; // re-detect on demand (e.g. after changing .env)
      const c = await detectColumns(getPool());
      res.json({ mode: c.mode, dispatch: c.dispatch, receiving: c.receiving });
    } catch (err) {
      console.error('[GET /api/regroup-check/columns] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });
};

module.exports.runCheck = runCheck; // for tests
module.exports._normalise = { normStore, normArticle, normSize };
