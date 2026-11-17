/**
 * wh-trace.js — MySQL side of "ติดตามใบจากคลัง" (warehouse shipment timeline)
 * in the สถานะการส่งของ menu.
 *
 * The browser reads the warehouse manifest (Supabase `manifest`: Order / Pack /
 * Manifest date, Final No) and Yusen's report (Supabase `yusen_deliveries`,
 * joined on Final No: pickup / hub / delivered). This module adds the last
 * step — when the branch recorded receipt in MySQL `receiving`, and what
 * Articles/sizes were in the box.
 *
 * Link between the systems: manifest invoice "73054" = receiving invoice
 * "73054_202609_68000" (text before the first "_"), sender = warehouse.
 *
 *   POST /api/wh-trace/summary  { picks: ["73054", ...], dateFrom, article? }
 *        → one row per invoice that the branch has received: receiver,
 *          receivedDate, pair/accessories received (and the article's qty
 *          when `article` is given — then only invoices containing it).
 *   GET  /api/wh-trace/lines?pick=73054&dateFrom=YYYY-MM-DD
 *        → Article / size lines received for one invoice.
 *
 * Read-only. Every query is bounded by documentDate (receiving has millions
 * of rows): from the earliest manifest date to +RECEIVE_LAG_DAYS.
 */
const express = require('express');

const RECEIVE_LAG_DAYS = 60;
const MAX_PICKS = 20000;
const IN_CHUNK = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z0-9-]{1,20}$/;
const WAREHOUSE_CODES = String(process.env.WAREHOUSE_CODES || '68000')
  .split(',').map(s => s.trim()).filter(Boolean);

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayBangkok() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}
function docWindow(dateFrom) {
  const to = [addDays(dateFrom, RECEIVE_LAG_DAYS), todayBangkok()].sort()[0];
  return [addDays(dateFrom, -1), to < dateFrom ? dateFrom : to];
}
function senderSql(params) {
  if (!WAREHOUSE_CODES.length) return '';
  params.push(...WAREHOUSE_CODES);
  return ` AND sender IN (${WAREHOUSE_CODES.map(() => '?').join(',')})`;
}

function registerWhTrace(app, getPool, opts = {}) {
  const excludeReceiver = opts.excludeReceiver;

  app.post('/api/wh-trace/summary', express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const dateFrom = String(b.dateFrom || '').trim();
    const article = b.article ? String(b.article).trim() : '';
    const picks = [...new Set((Array.isArray(b.picks) ? b.picks : [])
      .map(p => String(p || '').trim()).filter(p => CODE_RE.test(p)))];

    if (!DATE_RE.test(dateFrom)) return res.status(400).json({ error: 'dateFrom ไม่ถูกต้อง' });
    if (article && !CODE_RE.test(article)) return res.status(400).json({ error: 'Article ไม่ถูกต้อง' });
    if (picks.length > MAX_PICKS) return res.status(400).json({ error: `ใบมากเกินไป (${picks.length}) ลองย่อช่วงวันที่` });
    if (!picks.length) return res.json({ rows: [] });

    const [d0, d1] = docWindow(dateFrom);
    try {
      const conn = getPool();
      const rows = [];
      for (let i = 0; i < picks.length; i += IN_CHUNK) {
        const chunk = picks.slice(i, i + IN_CHUNK);
        const params = [d0, d1];
        let extra = senderSql(params);
        if (excludeReceiver) { extra += ' AND receiver <> ?'; params.push(excludeReceiver); }
        params.push(...chunk);
        const artCols = article
          ? `, SUM(CASE WHEN article = ? THEN items ELSE 0 END) AS articleQty`
          : '';
        if (article) params.splice(0, 0, article);           // first placeholder is in SELECT
        const having = article ? 'HAVING articleQty > 0' : '';
        const [r] = await conn.execute(`
          SELECT
            SUBSTRING_INDEX(invoice, '_', 1) AS pick${artCols},
            MIN(invoice)  AS invoiceFull,
            MIN(receiver) AS receiver,
            DATE_FORMAT(MIN(documentDate), '%Y-%m-%d') AS receivedDate,
            DATE_FORMAT(MIN(bookedDate), '%Y-%m-%d')   AS bookedDate,
            SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
            SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
            SUM(amount) AS totalAmount,
            COUNT(DISTINCT article) AS articleCount
          FROM \`receiving\`
          WHERE documentDate >= ? AND documentDate <= ?${extra}
            AND SUBSTRING_INDEX(invoice, '_', 1) IN (${chunk.map(() => '?').join(',')})
          GROUP BY SUBSTRING_INDEX(invoice, '_', 1)
          ${having}`, params);
        rows.push(...r);
      }
      res.json({ rows, receivedUpTo: d1 });
    } catch (err) {
      console.error('[POST /api/wh-trace/summary] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });

  app.get('/api/wh-trace/lines', async (req, res) => {
    const pick = String(req.query.pick || '').trim();
    const dateFrom = String(req.query.dateFrom || '').trim();
    if (!CODE_RE.test(pick)) return res.status(400).json({ error: 'เลขใบไม่ถูกต้อง' });
    if (!DATE_RE.test(dateFrom)) return res.status(400).json({ error: 'dateFrom ไม่ถูกต้อง' });

    const [d0, d1] = docWindow(dateFrom);
    const params = [d0, d1];
    let extra = senderSql(params);
    if (excludeReceiver) { extra += ' AND receiver <> ?'; params.push(excludeReceiver); }
    params.push(pick);
    try {
      const [rows] = await getPool().execute(`
        SELECT
          article,
          IFNULL(size, '-') AS size,
          MAX(isFootware) AS isFootware,
          SUM(items)  AS qty,
          SUM(amount) AS amount
        FROM \`receiving\`
        WHERE documentDate >= ? AND documentDate <= ?${extra}
          AND SUBSTRING_INDEX(invoice, '_', 1) = ?
        GROUP BY article, IFNULL(size, '-')
        ORDER BY article, size`, params);
      res.json({ pick, rows });
    } catch (err) {
      console.error('[GET /api/wh-trace/lines] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });
}

module.exports = registerWhTrace;
