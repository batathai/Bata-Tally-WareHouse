/**
 * article-trace.js — "Article นี้ไปสาขาไหนบ้าง" for the จ่ายสินค้าออก menu.
 *
 * GET /api/article-trace?article=1234567&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD[&scope=warehouse]
 *   scope=warehouse → only rows sent by the warehouse (sender in WAREHOUSE_CODES),
 *   otherwise store-to-store transfers (_TF) are included too.
 *
 * Reads the same MySQL table as จ่ายสินค้าออก (`receiving`, excluding the
 * warehouse-return receiver 57702 — passed in from api-server.js's
 * RETURN_RECEIVER so there's still a single source of truth). Read-only.
 *
 * A date range is mandatory and capped, because `receiving` has millions of
 * rows: the query is bounded by documentDate first, then filtered by article.
 *
 * Dates are formatted as YYYY-MM-DD strings in SQL, so they can't shift a
 * day through the JS Date / UTC+7 conversion (see apply-sync-date-fix.js).
 *
 * Two modes: GET (by receiving documentDate = วันที่สาขารับ) and
 * POST /by-invoice (by warehouse Order Date, see below).
 *
 * Returns:
 *   summary  — totals for the article in the range
 *   branches — one row per receiver (สาขา), biggest first
 *   history  — one row per invoice+receiver, newest first, with sizes listed
 *   sizes    — one row per receiver+size (for the size breakdown table)
 */

const express = require('express');

const MAX_RANGE_DAYS = 366;
// Order-date mode: how long after the order date a branch may still record
// receipt (documentDate) — bounds the MySQL scan by documentDate.
const RECEIVE_LAG_DAYS = 60;
const MAX_INVOICES = 20000;
const IN_CHUNK = 2000;
// Same warehouse code(s) as the "Warehouse" toggle in api-server.js
// (apply-warehouse-scope.js) — both read WAREHOUSE_CODES from .env.
const WAREHOUSE_CODES = String(process.env.WAREHOUSE_CODES || '68000')
  .split(',').map(s => s.trim()).filter(Boolean);
const HISTORY_LIMIT = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARTICLE_RE = /^[A-Za-z0-9-]{1,20}$/;

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayBangkok() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function registerArticleTrace(app, getPool, opts = {}) {
  const excludeReceiver = opts.excludeReceiver;

  app.get('/api/article-trace', async (req, res) => {
    const article = String(req.query.article || '').trim();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    const scope = req.query.scope === 'warehouse' ? 'warehouse' : 'all';

    if (!ARTICLE_RE.test(article)) {
      return res.status(400).json({ error: 'กรุณาใส่ Article ให้ถูกต้อง' });
    }
    if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
      return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ครบ' });
    }
    const span = daysBetween(dateFrom, dateTo);
    if (!Number.isFinite(span) || span < 0) {
      return res.status(400).json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' });
    }
    if (span > MAX_RANGE_DAYS) {
      return res.status(400).json({ error: `ช่วงวันที่ยาวได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` });
    }

    const where = ['documentDate >= ?', 'documentDate <= ?', 'article = ?'];
    const params = [dateFrom, dateTo, article];
    if (excludeReceiver) { where.push('receiver <> ?'); params.push(excludeReceiver); }
    if (scope === 'warehouse' && WAREHOUSE_CODES.length) {
      where.push(`sender IN (${WAREHOUSE_CODES.map(() => '?').join(',')})`);
      params.push(...WAREHOUSE_CODES);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const branchSql = `
      SELECT
        receiver,
        COUNT(DISTINCT invoice) AS invoiceCount,
        SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
        SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
        SUM(amount)       AS totalAmount,
        DATE_FORMAT(MIN(documentDate), '%Y-%m-%d') AS firstDate,
        DATE_FORMAT(MAX(documentDate), '%Y-%m-%d') AS lastDate
      FROM \`receiving\`
      ${whereSql}
      GROUP BY receiver
      ORDER BY SUM(items) DESC, receiver`;

    const historySql = `
      SELECT
        DATE_FORMAT(MIN(documentDate), '%Y-%m-%d') AS documentDate,
        DATE_FORMAT(MIN(bookedDate), '%Y-%m-%d')   AS bookedDate,
        MIN(sender)       AS sender,
        receiver,
        invoice,
        SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
        SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
        SUM(amount) AS totalAmount,
        GROUP_CONCAT(CONCAT(IFNULL(size, '-'), '×', items) ORDER BY size SEPARATOR ', ') AS sizes
      FROM \`receiving\`
      ${whereSql}
      GROUP BY invoice, receiver
      ORDER BY MIN(documentDate) DESC, invoice DESC
      LIMIT ${HISTORY_LIMIT + 1}`;

    const sizeSql = `
      SELECT
        receiver,
        IFNULL(size, '-') AS size,
        SUM(CASE WHEN isFootware = 1 THEN items ELSE 0 END) AS pair,
        SUM(CASE WHEN isFootware = 0 THEN items ELSE 0 END) AS accessories,
        SUM(items) AS qty
      FROM \`receiving\`
      ${whereSql}
      GROUP BY receiver, IFNULL(size, '-')
      ORDER BY receiver, size`;

    try {
      const conn = getPool();
      const [branches] = await conn.execute(branchSql, params);
      const [historyRaw] = await conn.execute(historySql, params);
      const [sizes] = await conn.execute(sizeSql, params);
      const truncated = historyRaw.length > HISTORY_LIMIT;
      const history = truncated ? historyRaw.slice(0, HISTORY_LIMIT) : historyRaw;

      const summary = branches.reduce((s, b) => ({
        branchCount: s.branchCount + 1,
        invoiceCount: s.invoiceCount + Number(b.invoiceCount || 0),
        pair: s.pair + Number(b.pair || 0),
        accessories: s.accessories + Number(b.accessories || 0),
        totalAmount: s.totalAmount + Number(b.totalAmount || 0),
      }), { branchCount: 0, invoiceCount: 0, pair: 0, accessories: 0, totalAmount: 0 });

      res.json({ article, dateFrom, dateTo, scope, warehouseCodes: WAREHOUSE_CODES, summary, branches, sizes, history, truncated, historyLimit: HISTORY_LIMIT });
    } catch (err) {
      console.error('[GET /api/article-trace] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });

  // ─── Order-date mode (ยึดวันที่ Order ตามรายงานคลัง) ─────────────────
  // POST /api/article-trace/by-invoice
  //   { article, dateFrom, dateTo, invoices: [{ invoice, store, orderDate, manifestDate }] }
  // The browser first reads the warehouse manifest (Supabase `manifest`,
  // synced from IS_Warehouse) for invoices whose order_date is in range,
  // then sends them here. A `receiving` invoice like "73054_202609_68000"
  // belongs to manifest invoice "73054" (text before the first "_") and must
  // also have receiver = that manifest row's store.
  app.post('/api/article-trace/by-invoice', express.json({ limit: '2mb' }), async (req, res) => {
    const b = req.body || {};
    const article = String(b.article || '').trim();
    const dateFrom = String(b.dateFrom || '').trim();
    const dateTo = String(b.dateTo || '').trim();
    const list = Array.isArray(b.invoices) ? b.invoices : [];

    if (!ARTICLE_RE.test(article)) return res.status(400).json({ error: 'กรุณาใส่ Article ให้ถูกต้อง' });
    if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) return res.status(400).json({ error: 'กรุณาเลือกช่วงวันที่ให้ครบ' });
    const span = daysBetween(dateFrom, dateTo);
    if (!Number.isFinite(span) || span < 0) return res.status(400).json({ error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' });
    if (span > MAX_RANGE_DAYS) return res.status(400).json({ error: `ช่วงวันที่ยาวได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` });
    if (list.length > MAX_INVOICES) return res.status(400).json({ error: `ใบในช่วงนี้มากเกินไป (${list.length}) ลองย่อช่วงวันที่` });

    const manifest = new Map();
    for (const m of list) {
      const inv = String(m && m.invoice || '').trim();
      if (!ARTICLE_RE.test(inv)) continue;
      manifest.set(inv, {
        store: m.store != null ? String(m.store).trim() : '',
        orderDate: DATE_RE.test(String(m.orderDate || '').slice(0, 10)) ? String(m.orderDate).slice(0, 10) : null,
        manifestDate: DATE_RE.test(String(m.manifestDate || '').slice(0, 10)) ? String(m.manifestDate).slice(0, 10) : null,
      });
    }
    const empty = { article, dateFrom, dateTo, basis: 'order', manifestCount: manifest.size,
      summary: { branchCount: 0, invoiceCount: 0, pair: 0, accessories: 0, totalAmount: 0 },
      branches: [], sizes: [], history: [], truncated: false, historyLimit: HISTORY_LIMIT };
    if (!manifest.size) return res.json(empty);

    const today = todayBangkok();
    const docTo = [addDays(dateTo, RECEIVE_LAG_DAYS), today].sort()[0];
    const picks = [...manifest.keys()];

    try {
      const conn = getPool();
      const lines = [];
      for (let i = 0; i < picks.length; i += IN_CHUNK) {
        const chunk = picks.slice(i, i + IN_CHUNK);
        const params = [dateFrom, docTo, article];
        let extra = '';
        if (excludeReceiver) { extra = 'AND receiver <> ?'; params.push(excludeReceiver); }
        params.push(...chunk);
        const [rows] = await conn.execute(`
          SELECT
            SUBSTRING_INDEX(invoice, '_', 1) AS pick,
            invoice, sender, receiver,
            DATE_FORMAT(documentDate, '%Y-%m-%d') AS documentDate,
            DATE_FORMAT(bookedDate, '%Y-%m-%d')   AS bookedDate,
            IFNULL(size, '-') AS size,
            items, amount, isFootware
          FROM \`receiving\`
          WHERE documentDate >= ? AND documentDate <= ? AND article = ? ${extra}
            AND SUBSTRING_INDEX(invoice, '_', 1) IN (${chunk.map(() => '?').join(',')})`, params);
        lines.push(...rows);
      }

      const branchMap = new Map(), sizeMap = new Map(), histMap = new Map();
      for (const r of lines) {
        const m = manifest.get(String(r.pick));
        if (!m || (m.store && m.store !== String(r.receiver))) continue;
        const items = Number(r.items || 0), amount = Number(r.amount || 0);
        const pair = Number(r.isFootware) === 1 ? items : 0, acc = pair ? 0 : items;

        const bk = String(r.receiver);
        const br = branchMap.get(bk) || { receiver: bk, inv: new Set(), pair: 0, accessories: 0, totalAmount: 0, firstDate: null, lastDate: null };
        br.inv.add(r.pick); br.pair += pair; br.accessories += acc; br.totalAmount += amount;
        if (m.orderDate && (!br.firstDate || m.orderDate < br.firstDate)) br.firstDate = m.orderDate;
        if (m.orderDate && (!br.lastDate || m.orderDate > br.lastDate)) br.lastDate = m.orderDate;
        branchMap.set(bk, br);

        const sk = bk + '|' + r.size;
        const sz = sizeMap.get(sk) || { receiver: bk, size: String(r.size), pair: 0, accessories: 0, qty: 0 };
        sz.pair += pair; sz.accessories += acc; sz.qty += items;
        sizeMap.set(sk, sz);

        const hk = r.pick + '|' + bk;
        const h = histMap.get(hk) || { orderDate: m.orderDate, manifestDate: m.manifestDate, documentDate: r.documentDate,
          bookedDate: r.bookedDate, sender: r.sender, receiver: bk, invoice: String(r.pick), invoiceFull: r.invoice,
          pair: 0, accessories: 0, totalAmount: 0, sizeQty: new Map() };
        if (r.documentDate && r.documentDate < h.documentDate) h.documentDate = r.documentDate;
        h.pair += pair; h.accessories += acc; h.totalAmount += amount;
        h.sizeQty.set(String(r.size), (h.sizeQty.get(String(r.size)) || 0) + items);
        histMap.set(hk, h);
      }

      const byNum = (a, b) => a.localeCompare(b, 'en', { numeric: true });
      const branches = [...branchMap.values()]
        .map(x => ({ receiver: x.receiver, invoiceCount: x.inv.size, pair: x.pair, accessories: x.accessories,
          totalAmount: x.totalAmount, firstDate: x.firstDate, lastDate: x.lastDate }))
        .sort((a, b) => (b.pair + b.accessories) - (a.pair + a.accessories) || byNum(a.receiver, b.receiver));
      const sizes = [...sizeMap.values()].sort((a, b) => byNum(a.receiver, b.receiver) || byNum(a.size, b.size));
      let history = [...histMap.values()].map(h => {
        const { sizeQty, ...rest } = h;
        return { ...rest, sizes: [...sizeQty.entries()].sort((a, b) => byNum(a[0], b[0])).map(([z, q]) => `${z}×${q}`).join(', ') };
      }).sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || '')) || byNum(b.invoice, a.invoice));
      const truncated = history.length > HISTORY_LIMIT;
      if (truncated) history = history.slice(0, HISTORY_LIMIT);

      const summary = branches.reduce((s, x) => ({
        branchCount: s.branchCount + 1, invoiceCount: s.invoiceCount + x.invoiceCount,
        pair: s.pair + x.pair, accessories: s.accessories + x.accessories, totalAmount: s.totalAmount + x.totalAmount,
      }), { branchCount: 0, invoiceCount: 0, pair: 0, accessories: 0, totalAmount: 0 });

      res.json({ ...empty, summary, branches, sizes, history, truncated, receivedUpTo: docTo });
    } catch (err) {
      console.error('[POST /api/article-trace/by-invoice] failed:', err);
      res.status(500).json({ error: 'Query failed — see server log' });
    }
  });
}

module.exports = registerArticleTrace;
