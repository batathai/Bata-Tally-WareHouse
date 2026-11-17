/**
 * Bata WMS — "สถานะการส่งของ" (Goods on Way + Goods Received), LAN-only.
 *
 * Joins the MySQL `dispatch` table (sender side: what was shipped) with the
 * MySQL `receiving` table (receiver side: what arrived) and gives each
 * shipped invoice a status:
 *   onway    กำลังส่ง     — no matching receiving rows yet
 *   complete รับครบ       — received Pair and Accessories equal what was sent
 *   partial  รับบางส่วน   — received less than sent (and nothing over)
 *   over     รับเกิน      — received more than sent in Pair or Accessories
 *
 * Deliberately independent of LIVE_TABLE in Index/index.html: that map only
 * decides which table a *menu* displays (a confirmed business choice — do
 * not "fix" it). The loop direction here is fixed by what the tables mean,
 * dispatch = shipped → receiving = received, so it can't be inverted by the
 * menu mapping.
 *
 * Join key: invoice + receiver (confirmed with the user 2026-09-23).
 * SHIP_MATCH_KEY=invoice in .env switches to invoice-only matching if
 * /api/shipment-status/diagnose shows the receiver codes don't line up.
 *
 * DiffTotalAmount is intentionally NOT computed: the legacy value is
 * price-based and non-zero even when qty diffs are zero, formula unknown.
 * Only qty diffs (Pair / Accessories) are returned.
 *
 * Usage in api-server.js — register BEFORE the generic `/api/:view` routes,
 * otherwise `/api/shipment-status` is swallowed as an unknown view:
 *   const registerShipmentStatus = require('./shipment-status');
 *   registerShipmentStatus(app, getPool);
 */

const MATCH_BY_RECEIVER = (process.env.SHIP_MATCH_KEY || 'invoice_receiver') !== 'invoice';
const MAX_RANGE_DAYS = 62;      // dispatch window cap — keeps the join bounded
const ROW_CAP = 20000;          // max invoices pulled per request before paging in JS
const RECEIVE_LOOKBACK_DAYS = 7; // receiving rows may carry a slightly earlier date
const QUERY_TIMEOUT_MS = 60000;

const STATUS_LABEL = { onway: 'กำลังส่ง', complete: 'รับครบ', partial: 'รับบางส่วน', over: 'รับเกิน' };

function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

// WHERE for the dispatch side. sender/receiver/invoice come from the client
// as LIKE filters, same behaviour as the other live views.
function buildDispatchWhere(q) {
  const where = ['documentDate >= ?', 'documentDate <= ?'];
  const params = [q.dateFrom, q.dateTo];
  if (q.sender) { where.push('sender LIKE ?'); params.push(`%${q.sender}%`); }
  if (q.receiver) { where.push('receiver LIKE ?'); params.push(`%${q.receiver}%`); }
  if (q.invoice) { where.push('invoice LIKE ?'); params.push(`%${q.invoice}%`); }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function buildStatusQuery(q) {
  const d = buildDispatchWhere(q);
  const rKeys = MATCH_BY_RECEIVER ? 'invoice, receiver' : 'invoice';
  const joinOn = MATCH_BY_RECEIVER
    ? 'r.invoice = d.invoice AND r.receiver = d.receiver'
    : 'r.invoice = d.invoice';

  const sql = `
    SELECT
      d.invoice, d.sender, d.receiver, d.bookedDate, d.documentDate,
      d.pair, d.accessories, d.totalAmount,
      r.pair         AS rcvPair,
      r.accessories  AS rcvAccessories,
      r.totalAmount  AS rcvAmount,
      r.receiveCount AS receiveCount,
      r.firstReceived AS firstReceived,
      r.lastReceived  AS lastReceived
    FROM (
      SELECT
        invoice, receiver,
        MIN(sender)       AS sender,
        MIN(bookedDate)   AS bookedDate,
        MIN(documentDate) AS documentDate,
        SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
        SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
        SUM(amount) AS totalAmount
      FROM \`dispatch\`
      ${d.whereSql}
      GROUP BY invoice, receiver
    ) d
    LEFT JOIN (
      SELECT
        ${rKeys},
        SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
        SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
        SUM(amount) AS totalAmount,
        COUNT(DISTINCT bookedDate) AS receiveCount,
        MIN(documentDate) AS firstReceived,
        MAX(documentDate) AS lastReceived
      FROM \`receiving\`
      WHERE documentDate >= DATE_SUB(?, INTERVAL ${RECEIVE_LOOKBACK_DAYS} DAY)
        AND invoice IN (SELECT DISTINCT invoice FROM \`dispatch\` ${d.whereSql})
      GROUP BY ${rKeys}
    ) r ON ${joinOn}
    ORDER BY d.documentDate DESC, d.invoice DESC
    LIMIT ${ROW_CAP + 1}
  `;
  return { sql, params: [...d.params, q.dateFrom, ...d.params] };
}

// Pure function (unit-testable): raw joined row → row with status + diffs.
function classify(row, today) {
  const sentPair = Number(row.pair) || 0;
  const sentAcc = Number(row.accessories) || 0;
  const received = row.rcvPair !== null && row.rcvPair !== undefined;
  const rcvPair = received ? Number(row.rcvPair) || 0 : 0;
  const rcvAcc = received ? Number(row.rcvAccessories) || 0 : 0;

  let status;
  if (!received) status = 'onway';
  else if (rcvPair > sentPair || rcvAcc > sentAcc) status = 'over';
  else if (rcvPair === sentPair && rcvAcc === sentAcc) status = 'complete';
  else status = 'partial';

  const docDate = String(row.documentDate || '').slice(0, 10);
  return {
    ...row,
    status,
    statusLabel: STATUS_LABEL[status],
    rcvPair: received ? rcvPair : null,
    rcvAccessories: received ? rcvAcc : null,
    diffPair: received ? rcvPair - sentPair : null,
    diffAccessories: received ? rcvAcc - sentAcc : null,
    receiveCount: received ? Number(row.receiveCount) || 0 : 0,
    daysOpen: status === 'onway' && docDate ? daysBetween(docDate, today) : null,
  };
}

function summarize(rows) {
  const s = {};
  for (const k of Object.keys(STATUS_LABEL)) s[k] = { count: 0, pair: 0, accessories: 0, totalAmount: 0 };
  for (const r of rows) {
    const b = s[r.status];
    b.count++;
    b.pair += Number(r.pair) || 0;
    b.accessories += Number(r.accessories) || 0;
    b.totalAmount += Number(r.totalAmount) || 0;
  }
  return s;
}

function toDateStr(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v;
}
function normalizeDates(row) {
  for (const k of ['bookedDate', 'documentDate', 'firstReceived', 'lastReceived']) row[k] = toDateStr(row[k]);
  return row;
}

function registerShipmentStatus(app, getPool) {
  // ── List: one row per shipped invoice(+receiver) with status ──────────
  app.get('/api/shipment-status', async (req, res) => {
    const q = req.query;
    if (!isIsoDate(q.dateFrom) || !isIsoDate(q.dateTo)) {
      return res.status(400).json({ error: 'ต้องระบุ dateFrom และ dateTo (YYYY-MM-DD)' });
    }
    if (q.dateFrom > q.dateTo) return res.status(400).json({ error: 'dateFrom ต้องไม่เกิน dateTo' });
    if (daysBetween(q.dateFrom, q.dateTo) > MAX_RANGE_DAYS) {
      return res.status(400).json({ error: `เลือกช่วงวันที่ได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` });
    }

    try {
      const { sql, params } = buildStatusQuery(q);
      const [raw] = await getPool().query({ sql, timeout: QUERY_TIMEOUT_MS }, params);
      const truncated = raw.length > ROW_CAP;
      const today = toDateStr(new Date());
      const all = raw.slice(0, ROW_CAP).map(normalizeDates).map(r => classify(r, today));

      const summary = summarize(all);
      const wanted = q.status && STATUS_LABEL[q.status] ? q.status : null;
      const filtered = wanted ? all.filter(r => r.status === wanted) : all;

      const page = Math.max(1, parseInt(q.page, 10) || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize, 10) || 100));
      const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        rows, total: filtered.length, summary, truncated,
        matchKey: MATCH_BY_RECEIVER ? 'invoice+receiver' : 'invoice',
      });
    } catch (err) {
      console.error('[GET /api/shipment-status] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });

  // ── Diagnose: is the data fit for this join? (read-only checks) ───────
  // 1) indexes on invoice/documentDate  2) top senders per table
  // 3) match rate for shipments 30–44 days old (should be mostly received)
  app.get('/api/shipment-status/diagnose', async (req, res) => {
    const pool = getPool();
    const run = (sql, params = []) => pool.query({ sql, timeout: QUERY_TIMEOUT_MS }, params).then(([r]) => r);
    try {
      const indexCols = async (t) => [...new Set((await run(`SHOW INDEX FROM \`${t}\``)).map(i => i.Column_name))];
      const topSenders = (t) => run(`
        SELECT sender, COUNT(DISTINCT invoice) AS invoices
        FROM \`${t}\`
        WHERE documentDate >= CURDATE() - INTERVAL 30 DAY
        GROUP BY sender ORDER BY invoices DESC LIMIT 10`);

      const [dIdx, rIdx, dTop, rTop] = await Promise.all([
        indexCols('dispatch'), indexCols('receiving'), topSenders('dispatch'), topSenders('receiving'),
      ]);

      const [match] = await run(`
        SELECT
          COUNT(*) AS total,
          SUM(ri.invoice IS NOT NULL) AS matchInvoice,
          SUM(rr.invoice IS NOT NULL) AS matchInvoiceReceiver
        FROM (
          SELECT invoice, MIN(receiver) AS receiver
          FROM \`dispatch\`
          WHERE documentDate BETWEEN CURDATE() - INTERVAL 44 DAY AND CURDATE() - INTERVAL 30 DAY
          GROUP BY invoice
        ) d
        LEFT JOIN (
          SELECT DISTINCT invoice FROM \`receiving\`
          WHERE documentDate >= CURDATE() - INTERVAL 60 DAY
        ) ri ON ri.invoice = d.invoice
        LEFT JOIN (
          SELECT DISTINCT invoice, receiver FROM \`receiving\`
          WHERE documentDate >= CURDATE() - INTERVAL 60 DAY
        ) rr ON rr.invoice = d.invoice AND rr.receiver = d.receiver`);

      const total = Number(match.total) || 0;
      const pct = (n) => (total ? Math.round((Number(n) / total) * 1000) / 10 : null);
      res.json({
        indexes: { dispatch: dIdx, receiving: rIdx },
        topSenders: { dispatch: dTop, receiving: rTop },
        matchRate: {
          window: 'ใบส่งอายุ 30–44 วัน',
          total,
          invoicePct: pct(match.matchInvoice),
          invoiceReceiverPct: pct(match.matchInvoiceReceiver),
        },
        matchKey: MATCH_BY_RECEIVER ? 'invoice+receiver' : 'invoice',
      });
    } catch (err) {
      console.error('[GET /api/shipment-status/diagnose] failed:', err);
      res.status(500).json({ error: 'Diagnose failed — see server log' });
    }
  });
}

module.exports = registerShipmentStatus;
module.exports.classify = classify;
module.exports.summarize = summarize;
