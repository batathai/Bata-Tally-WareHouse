/*
 * wh-trace-ui.js — "ติดตามใบจากคลัง" panel, attached to the top of the
 * สถานะการส่งของ view (#view-shipment). Loaded by Index/index.html via
 * <script src="wh-trace-ui.js"> (added by apply-wh-trace.js).
 *
 * One timeline per warehouse invoice, stitched from three sources:
 *   1. Supabase manifest (IS_Warehouse, sync_manifest.py)  Order → Pack → ออกจากคลัง
 *   2. Supabase yusen_deliveries (import-yusen.js, on Final No)  Yusen รับ → Hub → ถึงสาขา
 *   3. MySQL receiving via /api/wh-trace/* (api-server.js)  สาขากดรับ + Article/ไซส์
 *
 * Uses the page's globals: sb (Supabase client), liveFmtNum (optional).
 */
(function () {
  'use strict';
  const host = document.getElementById('view-shipment');
  if (!host) { console.warn('[wh-trace] #view-shipment not found — panel not added'); return; }
  if (document.getElementById('wtPanel')) return;

  // ─── styles ─────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  .wt-panel{ background:var(--panel); border:1px solid var(--line); border-radius:var(--radius,4px); padding:16px 18px; margin-bottom:22px; }
  .wt-form{ display:grid; grid-template-columns:minmax(220px,2fr) repeat(2,minmax(130px,1fr)) auto auto; gap:8px; align-items:center; margin-bottom:10px; }
  .wt-quick{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .wt-quick .live-btn{ padding:4px 10px; font-size:12px; }
  .wt-msg{ font-size:12.5px; color:var(--ink-soft); margin:4px 0 12px; }
  .wt-chips{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
  .wt-chip{ border:1px solid var(--line); border-radius:3px; padding:8px 12px; background:var(--panel); cursor:pointer; text-align:left; font-family:inherit; color:var(--ink); min-width:112px; }
  .wt-chip .l{ font-size:11.5px; color:var(--ink-soft); display:flex; align-items:center; gap:6px; }
  .wt-chip .v{ font-size:19px; font-weight:600; font-family:'Space Grotesk',sans-serif; margin-top:2px; }
  .wt-chip.on{ border-color:var(--ink); box-shadow:inset 0 0 0 1px var(--ink); }
  .wt-dot{ width:8px; height:8px; border-radius:50%; display:inline-block; flex:0 0 8px; }
  .wt-scroll{ overflow-x:auto; }
  .wt-scroll th{ white-space:nowrap; }
  .wt-scroll td{ white-space:nowrap; }
  #wtBody tr{ cursor:pointer; }
  #wtBody tr:hover td{ background:var(--panel-2); }
  .wt-tag{ display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:2px; }
  .wt-muted{ color:var(--ink-soft); }
  .wt-neg{ color:var(--brand); font-weight:600; }
  .wt-pos{ color:var(--amber, #B4650A); font-weight:600; }
  th[data-wt-sort]{ cursor:pointer; user-select:none; }
  th[data-wt-sort].sorted{ color:var(--brand); }
  .wt-modal{ position:fixed; inset:0; z-index:1000; background:rgba(20,12,11,.45); display:flex; align-items:flex-start; justify-content:center;
    padding:calc(24px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px)); overflow-y:auto; }
  .wt-modal[hidden]{ display:none; }
  .wt-box{ background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:6px; width:100%; max-width:1080px; box-shadow:0 18px 50px rgba(0,0,0,.25); padding:20px 22px 22px; }
  .wt-head{ display:flex; gap:12px; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; margin-bottom:16px; }
  .wt-head h3{ margin:0; font-size:18px; font-weight:600; }
  .wt-head .sub{ font-size:12.5px; color:var(--ink-soft); margin-top:4px; }
  .wt-steps{ display:grid; grid-template-columns:repeat(7,minmax(118px,1fr)); gap:0; margin-bottom:18px; overflow-x:auto; }
  .wt-step{ position:relative; padding:0 8px 0 0; }
  .wt-step .bar{ height:4px; background:var(--line); margin:9px 0 10px 20px; }
  .wt-step .ball{ position:absolute; top:0; left:0; width:22px; height:22px; border-radius:50%; background:var(--panel); border:2px solid var(--line);
    display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:var(--ink-soft); }
  .wt-step.done .ball{ background:var(--green,#2E6B4F); border-color:var(--green,#2E6B4F); color:#fff; }
  .wt-step.done .bar{ background:var(--green,#2E6B4F); }
  .wt-step.warn .ball{ background:var(--brand); border-color:var(--brand); color:#fff; }
  .wt-step:last-child .bar{ background:transparent; }
  .wt-step .t{ font-size:12px; font-weight:600; }
  .wt-step .d{ font-size:12.5px; font-family:'Space Grotesk',sans-serif; margin-top:2px; }
  .wt-step .g{ font-size:11px; color:var(--ink-soft); margin-top:2px; }
  .wt-cards{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:16px; }
  .wt-cards > div{ border:1px solid var(--line); border-radius:3px; padding:10px 12px; }
  .wt-cards .l{ font-size:11.5px; color:var(--ink-soft); }
  .wt-cards .v{ font-size:18px; font-weight:600; font-family:'Space Grotesk',sans-serif; margin-top:2px; }
  .wt-cards .s{ font-size:11.5px; color:var(--ink-soft); margin-top:2px; }
  .wt-art-hit td{ background:color-mix(in srgb, var(--brand) 9%, transparent); font-weight:600; }
  body.wt-open{ overflow:hidden; }
  @media (max-width:720px){ .wt-form{ grid-template-columns:1fr 1fr; } .wt-form input:first-child{ grid-column:1 / -1; } }
  `;
  document.head.appendChild(css);

  // ─── helpers ────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fn = v => (typeof liveFmtNum === 'function') ? liveFmtNum(v) : (Number.isFinite(Number(v)) ? Number(v).toLocaleString('th-TH') : '—');
  const bkk = v => { if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + 7 * 3600000) : null; };
  const ymdOf = v => { if (!v) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v); const d = bkk(v); return d ? d.toISOString().slice(0, 10) : null; };
  const fd = v => { const y = ymdOf(v); if (!y) return '—'; const [a, b, c] = y.split('-'); return `${c}/${b}/${a}`; };
  const fdt = v => { if (!v || /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fd(v); const d = bkk(v); return d ? fd(v) + ' ' + d.toISOString().slice(11, 16) : '—'; };
  const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayGap = (a, b) => { const x = ymdOf(a), y = ymdOf(b); if (!x || !y) return null; return Math.round((Date.parse(y) - Date.parse(x)) / 86400000); };
  const num = v => Number(v || 0);

  // Search box → list of ids. "87134-87172" (spaces around the dash are fine)
  // expands to every invoice number in between; only for invoice numbers
  // (4–6 digits), so Final No (10 digits) and Article (7 digits) are untouched.
  const RANGE_MAX = 2000;
  function parseQuery(text) {
    const norm = String(text || '').replace(/(\d)\s*[-–—]\s*(?=\d)/g, '$1-');
    const out = []; let tooBig = null;
    norm.trim().split(/[\s,;]+/).filter(Boolean).forEach(t => {
      const m = /^(\d{4,6})-(\d{4,6})$/.exec(t);
      if (!m) { out.push(t.split('_')[0]); return; }
      let a = Number(m[1]), b = Number(m[2]); if (a > b) [a, b] = [b, a];
      if (b - a + 1 > RANGE_MAX) { tooBig = t; return; }
      for (let n = a; n <= b; n++) out.push(String(n));
    });
    return { tokens: [...new Set(out)], tooBig };
  }
  const idList = a => a.length > 20 ? a.slice(0, 20).join(', ') + ' และอีก ' + (a.length - 20) + ' ใบ' : a.join(', ');

  const STAGES = {
    wait:      { label: 'รอ Yusen รับ',        color: '#9A8F89' },   // relabelled when no Yusen data
    transit:   { label: 'Yusen รับแล้ว',        color: '#3B6FB6' },
    hub:       { label: 'ถึง Hub',             color: '#7A55B0' },
    delivered: { label: 'ถึงสาขา · รอกดรับ',   color: '#B4650A' },
    done:      { label: 'สาขารับแล้ว',          color: '#2E6B4F' },
    short:     { label: 'รับไม่ครบ',            color: '#C8102E' },
    over:      { label: 'รับเกิน',              color: '#C8102E' },
  };
  const STAGE_ORDER = ['wait', 'transit', 'hub', 'delivered', 'done', 'short', 'over'];
  const tag = st => `<span class="wt-tag" style="background:color-mix(in srgb, ${STAGES[st].color} 14%, transparent); color:${STAGES[st].color}"><span class="wt-dot" style="background:${STAGES[st].color}"></span>${STAGES[st].label}</span>`;

  // ─── panel ──────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'wt-panel'; panel.id = 'wtPanel';
  panel.innerHTML = `
    <div class="section-head" style="margin-bottom:10px;">
      <h3>ติดตามใบจากคลัง — คลัง → Yusen → สาขา</h3>
      <div class="hint">รายงานคลัง (manifest) · Yusen · การรับของสาขา (MySQL)</div>
    </div>
    <div class="wt-form">
      <input type="text" class="live-input" id="wtQuery" autocomplete="off" placeholder="Final No / เลขใบ / ช่วงเลขใบ 87134-87172 / Article — เว้นว่าง = ดูทุกใบตามวันที่">
      <input type="date" class="live-input" id="wtFrom" title="วันที่ออกจากคลัง (Manifest Date) ตั้งแต่">
      <input type="date" class="live-input" id="wtTo" title="วันที่ออกจากคลัง (Manifest Date) ถึง">
      <button class="live-btn primary" type="button" id="wtGo">ค้นหา</button>
      <button class="live-btn" type="button" id="wtCsv" disabled>Export CSV</button>
    </div>
    <div class="wt-quick">
      <button class="live-btn" type="button" data-wt-range="0">วันนี้</button>
      <button class="live-btn" type="button" data-wt-range="1">เมื่อวาน</button>
      <button class="live-btn" type="button" data-wt-range="7">7 วัน</button>
      <button class="live-btn" type="button" data-wt-range="14">14 วัน</button>
    </div>
    <div class="wt-msg" id="wtHint">ใส่ Final No หรือเลขใบ (หลายใบคั่นด้วยเว้นวรรค หรือใส่เป็นช่วง เช่น 87134-87172) เพื่อดูไทม์ไลน์ · ใส่ Article เพื่อหาใบที่มี Article นั้นในช่วงวันที่ · เว้นว่างเพื่อดูทุกใบที่ออกจากคลังในช่วงวันที่</div>
    <div id="wtResult"></div>`;
  host.prepend(panel);

  const modal = document.createElement('div');
  modal.className = 'wt-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  const st = { rows: [], filter: 'all', sort: { key: 'manifestDate', dir: 'desc' }, mode: 'list', article: null, loadedOnce: false, dateFrom: null };

  const setRange = back => { const t = today(); $('wtFrom').value = addDays(t, -back); $('wtTo').value = back === 1 ? addDays(t, -1) : t; };
  setRange(0);
  document.querySelectorAll('[data-wt-range]').forEach(b => b.addEventListener('click', () => { setRange(Number(b.getAttribute('data-wt-range'))); run(); }));
  $('wtGo').addEventListener('click', run);
  $('wtQuery').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  $('wtCsv').addEventListener('click', exportCsv);
  $('wtResult').addEventListener('click', onResultClick);

  // First time the menu is opened, show today's list automatically.
  document.addEventListener('click', e => {
    if (!st.loadedOnce && e.target.closest('[data-view="shipment"]')) setTimeout(() => { if (!st.loadedOnce) run(); }, 0);
  });

  function msg(t) { $('wtResult').innerHTML = '<p class="wt-msg">' + t + '</p>'; }

  // ─── Supabase reads ─────────────────────────────────────────────────
  const M_COLS = 'invoice,store,store_name,type,order_date,pack_date,final_no,gate_no,manifest_date,final_prs,final_acc,total_final,tot_cartons';
  async function manifestByDate(from, to) {
    const out = [];
    for (let off = 0; off < 30000; off += 1000) {
      const { data, error } = await sb.from('manifest').select(M_COLS)
        .gte('manifest_date', from + 'T00:00:00+07:00').lte('manifest_date', to + 'T23:59:59.999+07:00')
        .order('invoice').range(off, off + 999);
      if (error) throw new Error('อ่านรายงานคลังไม่ได้: ' + error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function inChunks(table, cols, key, values, size = 100) {
    const out = [];
    for (let i = 0; i < values.length; i += size) {
      const { data, error } = await sb.from(table).select(cols).in(key, values.slice(i, i + size));
      if (error) throw new Error('อ่าน ' + table + ' ไม่ได้: ' + error.message);
      out.push(...(data || []));
    }
    return out;
  }
  const Y_COLS = 'final_invoice,ref_no,bill_no,bill_date,store_code,pickup_date,arrival_hub_date,target_delivery_date,actual_delivery_date,delivery_status,remark,box_small,box_big';

  // ─── main search ────────────────────────────────────────────────────
  async function run() {
    st.loadedOnce = true;
    if (typeof sb === 'undefined') { msg('ยังไม่ได้เชื่อม Supabase'); return; }
    const { tokens, tooBig } = parseQuery($('wtQuery').value);
    if (tooBig) { msg('ช่วงเลขใบ ' + esc(tooBig) + ' กว้างเกินไป — ค้นได้ครั้งละไม่เกิน ' + fn(RANGE_MAX) + ' ใบ'); return; }
    const articles = tokens.filter(t => /^\d{7}$/.test(t));
    const finals = tokens.filter(t => t.length >= 9);
    const picks = tokens.filter(t => !/^\d{7}$/.test(t) && t.length < 9);
    const from = $('wtFrom').value, to = $('wtTo').value;
    $('wtCsv').disabled = true;
    st.filter = 'all';

    try {
      let man = [];
      if (articles.length) {
        if (!from || !to) { msg('กรุณาเลือกช่วงวันที่'); return; }
        if (dayGap(from, to) < 0 || dayGap(from, to) > 31) { msg('ค้นหาตาม Article ได้ครั้งละไม่เกิน 31 วัน'); return; }
        st.mode = 'article'; st.article = articles[0];
        msg('กำลังอ่านรายงานคลัง…');
        man = await manifestByDate(from, to);
      } else if (finals.length || picks.length) {
        st.mode = 'ids'; st.article = null;
        msg('กำลังค้นหา…');
        const a = finals.length ? await inChunks('manifest', M_COLS, 'final_no', finals) : [];
        const b = picks.length ? await inChunks('manifest', M_COLS, 'invoice', picks) : [];
        const seen = new Set(); man = [...a, ...b].filter(m => !seen.has(m.invoice) && seen.add(m.invoice));
        const foundF = new Set(man.map(m => String(m.final_no))), foundP = new Set(man.map(m => String(m.invoice)));
        st.notFound = [...finals.filter(f => !foundF.has(f)), ...picks.filter(p => !foundP.has(p))];
      } else {
        if (!from || !to) { msg('กรุณาเลือกช่วงวันที่'); return; }
        if (dayGap(from, to) < 0 || dayGap(from, to) > 31) { msg('ช่วงวันที่ยาวได้ไม่เกิน 31 วัน'); return; }
        st.mode = 'list'; st.article = null;
        msg('กำลังอ่านรายงานคลัง…');
        man = await manifestByDate(from, to);
      }
      if (st.mode !== 'ids') st.notFound = [];
      if (!man.length) {
        msg(st.mode === 'ids' ? 'ไม่พบเลขนี้ในรายงานคลัง: ' + esc(idList(st.notFound)) + ' — ถ้าเพิ่งออกจากคลัง ลองรัน sync_manifest.py ก่อน'
          : 'ไม่พบใบที่ออกจากคลังในช่วง ' + fd(from) + ' – ' + fd(to) + ' (ถ้าเป็นวันนี้ ลองรัน sync_manifest.py ก่อน)');
        return;
      }

      msg('พบ ' + fn(man.length) + ' ใบจากรายงานคลัง — กำลังดึงสถานะ Yusen และการรับของสาขา…');
      const finalsAll = [...new Set(man.map(m => m.final_no).filter(Boolean).map(String))];
      // Yusen data is optional: if yusen_deliveries doesn't exist yet (yusen-schema.sql
      // not run) or can't be read, keep going without the Yusen steps.
      let yus = [];
      st.yusenNote = '';
      try {
        yus = finalsAll.length ? await inChunks('yusen_deliveries', Y_COLS, 'final_invoice', finalsAll) : [];
      } catch (err) {
        st.yusenNote = /could not find the table|does not exist|PGRST205|42P01/i.test(err.message)
          ? 'ยังไม่มีตาราง yusen_deliveries ใน Supabase — ขั้น Yusen รับของ / ถึง Hub / ถึงหน้าสาขา จะยังว่าง (รัน yusen-schema.sql และ import-yusen.js เพื่อเปิดใช้)'
          : 'อ่านข้อมูล Yusen ไม่ได้ (' + err.message + ') — แสดงเฉพาะข้อมูลคลังและการรับของสาขา';
      }
      const yMap = new Map(yus.map(y => [String(y.final_invoice), y]));

      const dateFrom = man.map(m => ymdOf(m.manifest_date) || ymdOf(m.pack_date) || ymdOf(m.order_date)).filter(Boolean).sort()[0] || today();
      st.dateFrom = dateFrom;
      const res = await fetch('/api/wh-trace/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: man.map(m => String(m.invoice)), dateFrom, article: st.article || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.error || 'HTTP ' + res.status) + ' (ข้อมูลการรับของสาขาใช้ได้เฉพาะเมื่อเปิดจากในวง LAN)');
      const rMap = new Map((body.rows || []).map(r => [String(r.pick), r]));

      let rows = man.map(m => buildRow(m, yMap.get(String(m.final_no)), rMap.get(String(m.invoice))));
      if (st.mode === 'article') rows = rows.filter(r => r.r);
      st.rows = rows;
      render();
      if (st.mode === 'ids' && rows.length === 1) openModal(rows[0].pick);
    } catch (err) {
      msg('ค้นหาไม่สำเร็จ — ' + esc(err.message));
    }
  }

  function buildRow(m, y, r) {
    const shipPrs = num(m.final_prs), shipAcc = num(m.final_acc);
    const shipQty = m.total_final != null ? num(m.total_final) : shipPrs + shipAcc;
    const recQty = r ? num(r.pair) + num(r.accessories) : null;
    const diff = r ? recQty - shipQty : null;
    let stage = 'wait';
    if (r) stage = diff < 0 ? 'short' : diff > 0 ? 'over' : 'done';
    else if (y && y.actual_delivery_date) stage = 'delivered';
    else if (y && y.arrival_hub_date) stage = 'hub';
    else if (y && y.pickup_date) stage = 'transit';
    return {
      pick: String(m.invoice), finalNo: m.final_no ? String(m.final_no) : '', store: m.store ? String(m.store) : '', storeName: m.store_name || '',
      type: m.type || '', gate: m.gate_no || '', cartons: m.tot_cartons,
      orderDate: m.order_date, packDate: m.pack_date, manifestDate: m.manifest_date,
      shipPrs, shipAcc, shipQty, y: y || null, r: r || null, recQty, diff, stage,
      pickup: y ? y.pickup_date : null, hub: y ? y.arrival_hub_date : null, delivered: y ? y.actual_delivery_date : null,
      receivedDate: r ? r.receivedDate : null, articleQty: r ? r.articleQty : null,
      ageDays: r ? null : dayGap(m.manifest_date, today()),
    };
  }

  // ─── list rendering ─────────────────────────────────────────────────
  const COLS = [
    ['pick', 'เลขใบ'], ['finalNo', 'Final No'], ['store', 'สาขา'], ['gate', 'Gate'],
    ['shipQty', 'ส่ง (ชิ้น)', 'num'], ['manifestDate', 'ออกจากคลัง'], ['pickup', 'Yusen รับ'], ['hub', 'ถึง Hub'],
    ['delivered', 'ถึงสาขา'], ['receivedDate', 'สาขากดรับ'], ['recQty', 'รับ (ชิ้น)', 'num'], ['diff', 'ต่าง', 'num'], ['stage', 'สถานะ'],
  ];
  const NUMK = new Set(['shipQty', 'recQty', 'diff', 'articleQty', 'ageDays']);
  function sortVal(r, k) {
    if (k === 'stage') return STAGE_ORDER.indexOf(r.stage);
    const v = r[k];
    if (NUMK.has(k)) return v == null ? null : Number(v);
    if (['manifestDate', 'pickup', 'hub', 'delivered', 'receivedDate'].includes(k)) return v ? (bkk(v) || new Date(v)).getTime() : null;
    return v == null || v === '' ? null : String(v);
  }
  function sorted(rows) {
    const { key, dir } = st.sort, s = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = sortVal(a, key), y = sortVal(b, key);
      if (x == null && y != null) return 1; if (y == null && x != null) return -1; if (x == null) return 0;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * s;
    });
  }

  function render() {
    STAGES.wait.label = st.yusenNote ? 'ออกจากคลังแล้ว · รอสาขารับ' : 'รอ Yusen รับ';
    const all = st.rows;
    const counts = {}; STAGE_ORDER.forEach(k => counts[k] = 0); all.forEach(r => counts[r.stage]++);
    const rows = sorted(st.filter === 'all' ? all : all.filter(r => r.stage === st.filter));
    const shipT = all.reduce((t, r) => t + r.shipQty, 0), recT = all.reduce((t, r) => t + (r.recQty || 0), 0);
    const cols = st.mode === 'article' ? COLS.slice(0, 11).concat([['articleQty', 'Article ' + st.article, 'num'], ['stage', 'สถานะ']]) : COLS;

    $('wtResult').innerHTML = `
      <p class="wt-msg">${st.mode === 'article'
        ? 'ใบที่ออกจากคลังช่วง ' + fd($('wtFrom').value) + ' – ' + fd($('wtTo').value) + ' และมี Article <b>' + esc(st.article) + '</b> · พบได้เฉพาะใบที่สาขากดรับแล้ว (ก่อนรับ ระบบยังไม่รู้ว่ามี Article อะไรในกล่อง)'
        : st.mode === 'ids' ? 'ผลค้นหา ' + fn(all.length) + ' ใบ' + (st.notFound.length ? ' · ไม่พบในรายงานคลัง: ' + esc(idList(st.notFound)) : '')
        : 'ใบที่ออกจากคลัง (Manifest Date) ' + fd($('wtFrom').value) + ' – ' + fd($('wtTo').value)}
        · ส่ง ${fn(shipT)} ชิ้น · สาขารับแล้ว ${fn(recT)} ชิ้น · คลิกแถวเพื่อดูไทม์ไลน์</p>
      ${st.yusenNote ? '<p class="wt-msg" style="color:var(--amber,#B4650A)">⚠ ' + esc(st.yusenNote) + '</p>' : ''}
      <div class="wt-chips">
        <button class="wt-chip${st.filter === 'all' ? ' on' : ''}" data-wt-filter="all"><div class="l">ทั้งหมด</div><div class="v">${fn(all.length)}</div></button>
        ${STAGE_ORDER.filter(k => counts[k] || ['wait', 'transit', 'delivered', 'done'].includes(k)).map(k => `
          <button class="wt-chip${st.filter === k ? ' on' : ''}" data-wt-filter="${k}"><div class="l"><span class="wt-dot" style="background:${STAGES[k].color}"></span>${STAGES[k].label}</div><div class="v">${fn(counts[k])}</div></button>`).join('')}
      </div>
      <div class="panel wt-scroll">
        <table>
          <thead><tr>${cols.map(([k, l, c]) => `<th data-wt-sort="${k}" class="${c || ''}${st.sort.key === k ? ' sorted' : ''}" title="คลิกเพื่อเรียง">${l}${st.sort.key === k ? (st.sort.dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
          <tbody id="wtBody">${rows.length ? rows.map(r => `<tr data-wt-pick="${esc(r.pick)}">
            <td class="mono">${esc(r.pick)}</td>
            <td class="mono">${esc(r.finalNo) || '—'}</td>
            <td class="mono" title="${esc(r.storeName)}">${esc(r.store)}</td>
            <td>${esc(r.gate) || '—'}</td>
            <td class="num">${fn(r.shipQty)}</td>
            <td>${fdt(r.manifestDate)}</td>
            <td>${fd(r.pickup)}</td>
            <td>${fd(r.hub)}</td>
            <td>${fd(r.delivered)}</td>
            <td>${r.receivedDate ? fd(r.receivedDate) : (r.ageDays != null ? '<span class="wt-muted">ยังไม่รับ · ' + r.ageDays + ' วัน</span>' : '—')}</td>
            <td class="num">${r.recQty == null ? '—' : fn(r.recQty)}</td>
            ${st.mode === 'article' ? `<td class="num">${fn(r.articleQty)}</td>` : `<td class="num ${r.diff < 0 ? 'wt-neg' : r.diff > 0 ? 'wt-pos' : ''}">${r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + fn(r.diff)}</td>`}
            <td>${tag(r.stage)}</td>
          </tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty-note">ไม่มีใบในสถานะนี้</td></tr>`}</tbody>
        </table>
      </div>`;
    $('wtCsv').disabled = !rows.length;
  }

  function onResultClick(e) {
    const chip = e.target.closest('[data-wt-filter]');
    if (chip) { st.filter = chip.getAttribute('data-wt-filter'); render(); return; }
    const th = e.target.closest('th[data-wt-sort]');
    if (th) {
      const k = th.getAttribute('data-wt-sort');
      st.sort = st.sort.key === k ? { key: k, dir: st.sort.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' };
      render(); return;
    }
    const tr = e.target.closest('tr[data-wt-pick]');
    if (tr) openModal(tr.getAttribute('data-wt-pick'));
  }

  // ─── timeline popup ─────────────────────────────────────────────────
  async function openModal(pick) {
    const r = st.rows.find(x => x.pick === pick); if (!r) return;
    const y = r.y || {};
    const steps = [
      ['สั่ง Order', r.orderDate, true],
      ['แพ็กเสร็จ', r.packDate, true],
      ['ออกจากคลัง', r.manifestDate, true],
      ['Yusen รับของ', y.pickup_date, false],
      ['ถึง Hub', y.arrival_hub_date, false],
      ['ถึงหน้าสาขา', y.actual_delivery_date, false],
      ['สาขากดรับเข้า', r.receivedDate, false],
    ];
    let prev = null;
    const stepHtml = steps.map(([t, v, hasTime], i) => {
      const done = !!v;
      const gap = done && prev ? dayGap(prev, v) : null;
      if (done) prev = v;
      const warn = i === 6 && r.r && r.diff !== 0;
      return `<div class="wt-step${done ? ' done' : ''}${warn ? ' warn' : ''}">
        <div class="ball">${done ? (warn ? '!' : '✓') : i + 1}</div><div class="bar"></div>
        <div class="t">${t}</div>
        <div class="d">${done ? (hasTime ? fdt(v) : fd(v)) : '<span class="wt-muted">ยังไม่มีข้อมูล</span>'}</div>
        <div class="g">${gap != null && i > 0 ? '+' + gap + ' วัน' : ''}${i === 5 && y.target_delivery_date ? (gap != null ? ' · ' : '') + 'เป้า ' + fd(y.target_delivery_date) : ''}</div>
      </div>`;
    }).join('');

    const total = dayGap(r.manifestDate, r.receivedDate || y.actual_delivery_date);
    modal.innerHTML = `
      <div class="wt-box">
        <div class="wt-head">
          <div>
            <h3>ใบ ${esc(r.pick)} · Final No ${esc(r.finalNo) || '—'}</h3>
            <div class="sub">สาขา ${esc(r.store)} ${esc(r.storeName)} · ${esc(r.type)} · Gate ${esc(r.gate) || '—'}${y.ref_no ? ' · Yusen RefNo ' + esc(y.ref_no) : ''}${y.bill_no ? ' · บิล ' + esc(y.bill_no) : ''}</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">${tag(r.stage)}<button class="live-btn primary" type="button" data-wt-close>ปิด</button></div>
        </div>
        <div class="wt-steps">${stepHtml}</div>
        <div class="wt-cards">
          <div><div class="l">คลังส่ง (Final)</div><div class="v">${fn(r.shipQty)}</div><div class="s">คู่ ${fn(r.shipPrs)} · อุปกรณ์ ${fn(r.shipAcc)}${r.cartons != null ? ' · ' + fn(r.cartons) + ' กล่อง' : ''}</div></div>
          <div><div class="l">สาขารับ</div><div class="v">${r.r ? fn(r.recQty) : '—'}</div><div class="s">${r.r ? 'คู่ ' + fn(r.r.pair) + ' · อุปกรณ์ ' + fn(r.r.accessories) : 'ยังไม่กดรับ'}</div></div>
          <div><div class="l">ส่วนต่าง</div><div class="v ${r.diff < 0 ? 'wt-neg' : r.diff > 0 ? 'wt-pos' : ''}">${r.diff == null ? '—' : (r.diff > 0 ? '+' : '') + fn(r.diff)}</div><div class="s">${r.diff == null ? 'รอสาขารับ' : r.diff === 0 ? 'ตรงกัน' : r.diff < 0 ? 'รับน้อยกว่าที่ส่ง' : 'รับมากกว่าที่ส่ง'}</div></div>
          <div><div class="l">Yusen</div><div class="v" style="font-size:15px;">${esc(y.delivery_status) || '—'}</div><div class="s">${esc(y.remark) || (r.y ? '' : st.yusenNote ? 'ยังไม่ได้เชื่อมข้อมูล Yusen' : 'ยังไม่มีในรายงาน Yusen')}</div></div>
          <div><div class="l">ออกคลัง → ${r.receivedDate ? 'สาขารับ' : 'ถึงสาขา'}</div><div class="v">${total != null ? total + ' วัน' : '—'}</div><div class="s">${r.ageDays != null ? 'ออกจากคลังมาแล้ว ' + r.ageDays + ' วัน' : ''}</div></div>
        </div>
        <div class="section-head"><h3>Article ในใบนี้</h3><div class="hint">${r.r ? 'จากการรับของสาขา (MySQL)' : ''}</div></div>
        <div class="panel wt-scroll" id="wtLines">${r.r ? '<div class="empty-note">กำลังโหลด…</div>' : '<div class="empty-note">สาขายังไม่กดรับ จึงยังไม่มีรายการ Article (ระบบคลังยังไม่ได้ส่งข้อมูลราย Article มาให้)</div>'}</div>
      </div>`;
    modal.hidden = false; document.body.classList.add('wt-open'); modal.scrollTop = 0;
    modal.querySelector('[data-wt-close]').addEventListener('click', closeModal);
    modal.querySelector('[data-wt-close]').focus();
    if (!r.r) return;

    try {
      const res = await fetch('/api/wh-trace/lines?' + new URLSearchParams({ pick: r.pick, dateFrom: st.dateFrom || ymdOf(r.manifestDate) || today() }));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      const byArt = new Map();
      (body.rows || []).forEach(l => {
        const a = byArt.get(l.article) || { article: l.article, foot: Number(l.isFootware) === 1, qty: 0, amount: 0, sizes: [] };
        a.qty += num(l.qty); a.amount += num(l.amount); a.sizes.push(l.size + '×' + num(l.qty)); byArt.set(l.article, a);
      });
      const arts = [...byArt.values()].sort((a, b) => b.qty - a.qty);
      const el = $('wtLines'); if (!el || modal.hidden) return;
      el.innerHTML = arts.length ? `<table>
        <thead><tr><th>Article</th><th>ประเภท</th><th>Size × จำนวน</th><th class="num">จำนวน</th><th class="num">ยอดรวม</th></tr></thead>
        <tbody>${arts.map(a => `<tr${st.article === a.article ? ' class="wt-art-hit"' : ''}>
          <td class="mono">${esc(a.article)}</td><td>${a.foot ? 'รองเท้า' : 'อุปกรณ์เสริม'}</td>
          <td style="white-space:normal; font-size:12px;" class="wt-muted">${esc(a.sizes.join(', '))}</td>
          <td class="num">${fn(a.qty)}</td><td class="num">${fn(a.amount)}</td></tr>`).join('')}
          <tr><td colspan="3" style="font-weight:600;">รวม ${fn(arts.length)} Article</td><td class="num" style="font-weight:600;">${fn(arts.reduce((t, a) => t + a.qty, 0))}</td><td class="num" style="font-weight:600;">${fn(arts.reduce((t, a) => t + a.amount, 0))}</td></tr>
        </tbody></table>` : '<div class="empty-note">ไม่พบรายการ</div>';
    } catch (err) {
      const el = $('wtLines'); if (el) el.innerHTML = '<div class="empty-note">โหลดรายการ Article ไม่สำเร็จ — ' + esc(err.message) + '</div>';
    }
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; document.body.classList.remove('wt-open'); }

  function exportCsv() {
    const rows = sorted(st.filter === 'all' ? st.rows : st.rows.filter(r => r.stage === st.filter));
    const head = ['Invoice', 'FinalNo', 'Store', 'StoreName', 'Gate', 'OrderDate', 'PackDate', 'ManifestDate', 'ShipQty',
      'YusenPickup', 'ArrivalHub', 'TargetDelivery', 'Delivered', 'YusenStatus', 'BranchReceived', 'ReceivedQty', 'Diff', 'Status']
      .concat(st.mode === 'article' ? ['Article ' + st.article] : []);
    const lines = [head.join(',')].concat(rows.map(r => [r.pick, r.finalNo, r.store, r.storeName, r.gate, fdt(r.orderDate), fdt(r.packDate), fdt(r.manifestDate), r.shipQty,
      fd(r.pickup), fd(r.hub), fd(r.y && r.y.target_delivery_date), fd(r.delivered), r.y ? r.y.delivery_status || '' : '', fd(r.receivedDate),
      r.recQty ?? '', r.diff ?? '', STAGES[r.stage].label].concat(st.mode === 'article' ? [r.articleQty ?? ''] : [])
      .map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'warehouse-shipments-' + ($('wtFrom').value || today()) + '_' + ($('wtTo').value || today()) + (st.mode === 'article' ? '-' + st.article : '') + '.csv';
    a.click(); URL.revokeObjectURL(a.href);
  }
})();
