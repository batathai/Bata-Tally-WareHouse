/* Dashboard ตรวจนับสต็อก (เมนู "ตรวจนับสต็อก")
 * - ไฟล์เดียว ไม่พึ่งไลบรารี ใช้ตัวแปรสีของ index.html (รองรับโหมดมืด)
 * - ตอนนี้ใช้ "ข้อมูลตัวอย่าง" ที่สร้างในโค้ด (ไม่ใช่ข้อมูลจริง) เพื่อดูหน้าตา
 *   ขั้นถัดไป: แทน buildSample() ด้วยข้อมูลจริงจาก Supabase (ตารางผลนับสต็อก)
 * - เรียกใช้: StockCountDash.mount(element)
 */
(function () {
  'use strict';

  // ตำแหน่งไซส์ 1–13 → ไซส์ UK ของแต่ละกลุ่ม (ชีต Group size)
  var GL = {
    A: ['1','2','3','4','5','5.5','6','6.5','7','7.5','8','8.5','9'],
    B: ['8.5','9','9.5','10','10.5','11','11.5','12','12.5','13','13.5','1','2'],
    C: ['1.5','2','2.5','3','3.5','4','4.5','5','5.5','6','6.5','7','8'],
    D: ['5','5.5','6','6.5','7','8','9','9.5','10','10.5','11','11.5','12'],
    E: ['00'],
    F: ['1.5','2','3','3.5','4','4.5','5','5.5','6','6.5','7','8','9']
  };
  var C = { g: '#2E6B4F', b: '#2563A6', a: '#B4650A', r: '#C8102E', n: '#8A817B' };
  var T = { g: '#2E6B4F', b: '#1F5290', a: '#8A4A04', r: '#A80D26', n: '#6F6560' };
  var TAGBG = { g: '#E6F0EB', b: '#E4EDF7', a: '#F8EBDD', r: '#FBE6E9', n: '#EEEAE7' };
  var TAGTXT = { g: 'เสร็จสิ้น', b: 'กำลังนับ', a: 'รอนับซ้ำ', r: 'พบส่วนต่าง', n: 'ยังไม่เริ่ม' };

  var state = { sel: null, grp: 'all' };
  var DATA = null, root = null;

  function rng(seed) { var a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function pct(x, y) { return y ? (x / y * 100).toFixed(1) : '0.0'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ───────── ข้อมูลตัวอย่าง (สร้างในโค้ด ไม่ใช่ข้อมูลจริง) ─────────
  function buildSample() {
    var R = rng(20261119), ids = 'ABCDEFGHIJKLMNOPQRSTUV'.split(''), racks = [];
    ids.forEach(function (id, ri) {
      var total = 40 + Math.floor(R() * 120), o = { id: id, total: total, g: 0, b: 0, a: 0, r: 0, n: 0 };
      if (ri < 5) { o.g = total; }
      else if (ri < 17) { o.r = R() < 0.7 ? 1 + Math.floor(R() * 5) : 0; o.a = Math.floor(R() * 4); o.b = Math.floor(total * 0.1); o.g = total - o.r - o.a - o.b; }
      else if (ri < 20) { o.b = Math.floor(total * 0.5); o.g = Math.floor(total * 0.3); o.n = total - o.b - o.g; }
      else { o.n = total; }
      o.pairs = o.total * (40 + Math.floor(R() * 220));
      racks.push(o);
    });
    var rowsFor = {};
    racks.forEach(function (rk) {
      var RR = rng(rk.id.charCodeAt(0) * 7919), rows = [], vrows = [], gs = ['D', 'D', 'D', 'C', 'C', 'F', 'A', 'B', 'E'];
      for (var i = 0; i < 14; i++) {
        var grp = gs[Math.floor(RR() * gs.length)], n = grp === 'E' ? 1 : 13, cells = new Array(13).fill(null), k = grp === 'E' ? 1 : 3 + Math.floor(RR() * 4), tot = 0;
        for (var j = 0; j < k; j++) { var p = grp === 'E' ? 0 : Math.floor(RR() * n); var q = 1 + Math.floor(RR() * (RR() < 0.2 ? 90 : 30)); cells[p] = (cells[p] || 0) + q; }
        cells.forEach(function (c) { tot += c || 0; });
        var st = rk.n === rk.total ? 'n' : (i < rk.r ? 'r' : (i < rk.r + rk.a ? 'a' : (i < rk.r + rk.a + rk.b ? 'b' : 'g')));
        var vpos = cells.findIndex(function (c) { return c; });
        var row = { loc: rk.id + '-' + String(i + 1).padStart(2, '0') + '-01-1', grp: grp, art: '9' + String(100000 + Math.floor(RR() * 899999)), name: 'สินค้าตัวอย่าง ' + (i + 1), price: (80 + Math.floor(RR() * 220)).toFixed(2), cells: cells, total: tot, st: st, vpos: vpos, v1: cells[vpos], v2: (cells[vpos] || 1) + (RR() < 0.5 ? -1 : 2) };
        if (row.v2 < 0) row.v2 = 1;
        row.cst = []; row.d = []; if (vpos >= 0 && (st === 'r' || st === 'a')) { row.cst[vpos] = st; row.d[vpos] = [row.v1, row.v2]; }
        rows.push(row);
        if (st === 'r') vrows.push({ loc: row.loc, art: row.art, uk: GL[grp][vpos] || '-', r1: row.v1, r2: row.v2 });
      }
      rk.rows = rows; rk.vrows = vrows; rk.rowsAll = rk.total * 2;
    });
    var ops = ['สมชาย ใจดี', 'วิภา รัตนกุล', 'ดนัย มากมี', 'ธนากร แสงทอง', 'กมลชนก ศรีสุวรรณ'];
    var feed = [], fr = rng(77);
    for (var f = 0; f < 8; f++) { var rk = racks[5 + Math.floor(fr() * 12)]; feed.push({ t: '15:' + String(59 - f * 2).padStart(2, '0') + ':' + String(10 + Math.floor(fr() * 49)), op: ops[f % 5], loc: rk.id + '-' + String(1 + Math.floor(fr() * 14)).padStart(2, '0') + '-01-1', art: '9' + String(100000 + Math.floor(fr() * 899999)), uk: ['5', '6', '7', '8'][Math.floor(fr() * 4)], qty: 1 + Math.floor(fr() * 60), st: fr() < 0.8 ? 'g' : 'r', rnd: 2 }); }
    return { racks: racks, ops: ops, feed: feed };
  }

  function kindOf(v) { return v.r > 0 ? 'r' : v.a > 0 ? 'a' : (v.g + v.b === 0) ? 'n' : v.g === v.total ? 'g' : 'b'; }
  function textOf(v, k) { return k === 'r' ? 'ส่วนต่าง ' + v.r : k === 'a' ? 'รอนับซ้ำ ' + v.a : k === 'n' ? 'ยังไม่เริ่ม' : k === 'g' ? 'เสร็จสิ้น' : 'กำลังนับ'; }
  function tag(k, text) { return '<span class="scd-tag" style="background:' + TAGBG[k] + ';color:' + T[k] + '">' + esc(text || TAGTXT[k]) + '</span>'; }
  function heat(n) { return n <= 2 ? '#F3EEEA' : n <= 10 ? '#E9E0DA' : n <= 50 ? '#DCCFC7' : '#CDBEB4'; }

  // ───────── วาดหน้า ─────────
  function render() {
    var RK = DATA.racks, sum = function (k) { return RK.reduce(function (s, r) { return s + r[k]; }, 0); };
    var TT = sum('total'), G = sum('g'), B = sum('b'), A = sum('a'), RV = sum('r'), N = sum('n');
    var r1 = DATA.real ? sum('l1') : TT - N, r2 = DATA.real ? sum('l2') : G + A + RV + Math.round(B * 0.3);
    if (!state.sel) state.sel = (RK.find(function (x) { return x.r > 0; }) || RK[0]).id;
    var v = RK.find(function (x) { return x.id === state.sel; }), vk = kindOf(v);
    if (DATA.real && !v.rows) { v.rows = []; v.vrows = []; if (!v.loading) loadRack(v); }
    var h = [];

    if (!DATA.real) h.push('<div class="scd-note" role="note"><b>ข้อมูลตัวอย่าง</b> · ตัวเลข Location Article และจำนวนในหน้านี้สร้างขึ้นเพื่อดูหน้าตา ยังไม่มีข้อมูลนับจริงในระบบ (ยังไม่ได้รัน stockcount-schema.sql / ยังไม่ได้เปิดรอบนับ / ยังไม่ได้นำเข้า Location)</div>');

    h.push('<div class="scd-head"><div><h2>ตรวจนับสต็อก</h2><div class="scd-sub">' + (DATA.real ? esc(DATA.cycle.name) + ' · วันที่ ' + DATA.dayNo + ' จาก ' + DATA.cycle.total_days + ' · มือถือส่งข้อมูลทุก 10 นาที · ล่าสุด ' + (DATA.feed[0] ? DATA.feed[0].t : '—') + ' · <a href="#" data-reload="1">รีเฟรช</a>' : 'รอบนับประจำปี · วันที่ 3 จาก 4 · ซิงก์จากมือถือทุก 10 นาที · ล่าสุด 16:00 · รอบถัดไป 16:10') + '</div></div>'
      + '<div class="scd-actions"><button type="button" class="scd-btn" disabled aria-disabled="true" title="เปิดใช้ในขั้นถัดไป">ส่งออก Excel</button><button type="button" class="scd-btn scd-btn-red" disabled aria-disabled="true" title="เปิดใช้ในขั้นถัดไป">สั่งนับซ้ำ (รอบ 3)</button></div></div>');

    var kp = [
      ['Location ทั้งหมด', fmt(TT), 'ใน ' + RK.length + ' Rack', '#E7DFDA'],
      ['เสร็จสิ้น', fmt(G), pct(G, TT) + '% ของทั้งหมด', C.g],
      ['ยังไม่เสร็จ', fmt(TT - G), 'ไม่เริ่ม ' + fmt(N) + ' · กำลังนับ ' + fmt(B) + ' · ต้องนับซ้ำ ' + fmt(A + RV), C.b],
      ['ความคืบหน้านับรอบ 1', pct(r1, TT) + '%', fmt(r1) + ' / ' + fmt(TT) + ' Location', '#3A3330'],
      ['ความคืบหน้านับรอบ 2', pct(r2, TT) + '%', fmt(r2) + ' / ' + fmt(TT) + ' Location', '#BDB1AA'],
      ['พบส่วนต่าง', fmt(RV), pct(RV, TT) + '% ของ Location ทั้งหมด', C.r],
      ['ต้องนับซ้ำ', fmt(A + RV), 'ส่วนต่าง ' + RV + ' + รอนับซ้ำ ' + A, C.a]
    ];
    h.push('<div class="scd-kpis">' + kp.map(function (k) { return '<div class="scd-panel" style="border-top:3px solid ' + k[3] + ';padding:14px 16px"><div class="scd-lbl">' + k[0] + '</div><div class="num scd-kv">' + k[1] + '</div><div class="scd-lbl2">' + k[2] + '</div></div>'; }).join('') + '</div>');

    var sts = [['n', 'ยังไม่เริ่มนับ', N], ['b', 'กำลังนับ', B], ['g', 'เสร็จสิ้น', G], ['a', 'รอนับซ้ำ', A], ['r', 'พบส่วนต่าง', RV]];
    h.push('<section class="scd-panel scd-pad"><div class="scd-ph"><h3>สถานะ Location ทั้งหมด</h3><span class="scd-hint">' + fmt(TT) + ' Location</span></div>'
      + '<div style="display:flex;gap:2px;height:22px">' + sts.map(function (s) { return '<div style="flex:' + s[2] + ' 1 0;background:' + C[s[0]] + ';min-width:' + (s[2] ? 2 : 0) + 'px" title="' + s[1] + ' ' + fmt(s[2]) + '"></div>'; }).join('') + '</div>'
      + '<div class="scd-legend">' + sts.map(function (s) { return '<span><i style="background:' + C[s[0]] + '"></i>' + s[1] + ' <b class="num">' + fmt(s[2]) + '</b> <span class="scd-hint num">' + pct(s[2], TT) + '%</span></span>'; }).join('') + '</div></section>');

    // Rack map + detail
    var rackBtns = RK.map(function (x) { var k = kindOf(x), on = x.id === state.sel; return '<button type="button" class="scd-rack' + (on ? ' on' : '') + '" data-rack="' + x.id + '" aria-pressed="' + on + '" aria-label="Rack ' + x.id + ' ' + textOf(x, k) + '" style="border-top:4px solid ' + C[k] + '"><span class="num" style="font-size:22px;font-weight:700;line-height:1.1">' + x.id + '</span><span class="num scd-hint">' + x.g + '/' + x.total + '</span><span style="font-size:11.5px;font-weight:600;color:' + T[k] + ';margin-top:4px">' + textOf(x, k) + '</span></button>'; }).join('');
    var parts = [['g', v.g], ['b', v.b], ['a', v.a], ['r', v.r], ['n', v.n]].filter(function (p) { return p[1] > 0; });
    var stats = [['เสร็จสิ้น', v.g, C.g], ['กำลังนับ', v.b, C.b], ['รอนับซ้ำ', v.a, C.a], ['พบส่วนต่าง', v.r, C.r], ['ยังไม่เริ่ม', v.n, C.n], ['Location ทั้งหมด', v.total, '#E7DFDA']];
    var vrows = v.vrows.map(function (r) { var d = r.r2 - r.r1; return '<tr><td class="num">' + r.loc + '</td><td class="num">' + r.art + '</td><td class="num">' + r.uk + '</td><td class="num r">' + r.r1 + '</td><td class="num r">' + r.r2 + '</td><td class="num r" style="font-weight:700;color:#A80D26">' + (d > 0 ? '+' : '−') + Math.abs(d) + '</td></tr>'; }).join('');
    var recount = v.a + v.r;
    h.push('<div class="scd-row"><section class="scd-panel scd-pad" style="flex:1.7 1 520px"><div class="scd-ph"><h3>แผนผัง Rack ในคลัง</h3><span class="scd-hint">คลิก Rack เพื่อดูรายละเอียดและตาราง</span></div><div class="scd-racks">' + rackBtns + '</div></section>'
      + '<section class="scd-panel scd-pad" style="flex:1 1 340px"><div class="scd-ph"><h3>Rack ' + v.id + '</h3>' + tag(vk, textOf(v, vk)) + '</div>'
      + '<div style="display:flex;height:8px;gap:2px;margin-bottom:12px">' + parts.map(function (p) { return '<div style="flex:' + p[1] + ' 1 0;background:' + C[p[0]] + '"></div>'; }).join('') + '</div>'
      + '<div class="scd-stats">' + stats.map(function (s) { return '<div><span><i style="background:' + s[2] + '"></i>' + s[0] + '</span><b class="num">' + s[1] + '</b></div>'; }).join('') + '</div>'
      + '<div style="margin-top:16px">' + (vrows ? '<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">Location ที่พบส่วนต่าง (รอบ 1 เทียบ รอบ 2)</div><div class="scd-scroll"><table class="scd-t scd-small"><thead><tr><th>Location</th><th>Article</th><th>ไซส์</th><th class="r">รอบ 1</th><th class="r">รอบ 2</th><th class="r">ต่าง</th></tr></thead><tbody>' + vrows + '</tbody></table></div>' : '<div class="scd-empty">' + (v.a > 0 ? v.a + ' Location รอสั่งนับรอบ 3' : vk === 'g' ? 'นับครบและตรงกันทุก Location' : vk === 'n' ? 'Rack นี้ยังไม่มีการสแกนจากมือถือ' : 'ยังไม่พบส่วนต่าง รอผู้นับสแกนต่อ') + '</div>') + '</div>'
      + (recount > 0 ? '<button type="button" class="scd-btn scd-btn-red" disabled aria-disabled="true" style="margin-top:16px;width:100%;justify-content:center" title="เปิดใช้ในขั้นถัดไป">สั่งนับซ้ำ ' + recount + ' Location ใน Rack ' + v.id + '</button>' : '')
      + '</section></div>');

    // CS-style matrix
    var grp = state.grp, labels = grp === 'all' ? new Array(13).fill('') : GL[grp];
    var chips = ['all', 'A', 'B', 'C', 'D', 'E', 'F'].map(function (g) { return '<button type="button" class="scd-chip' + (grp === g ? ' on' : '') + '" data-grp="' + g + '" aria-pressed="' + (grp === g) + '">' + (g === 'all' ? 'ทั้งหมด' : 'กลุ่ม ' + g) + '</button>'; }).join('');
    var rows = v.rows.filter(function (r) { return grp === 'all' || r.grp === grp; });
    var totalRows = rows.length; rows = rows.slice(0, 300);
    var body = rows.map(function (r) {
      var cells = r.cells.map(function (c, p) {
        if (r.st === 'n' || c == null) return '<td class="scd-cell"></td>';
        var cs = r.cst ? r.cst[p] : null, dd = r.d ? r.d[p] : null;
        if (cs === 'r') { var shown = dd && dd[1] != null ? dd[1] : c; return '<td class="scd-cell num" title="รอบ 1: ' + (dd ? dd[0] : '') + ' · รอบ 2: ' + (dd ? dd[1] : '') + '" style="background:' + C.r + ';color:#fff;font-weight:700">' + shown + '</td>'; }
        if (cs === 'a') return '<td class="scd-cell num" title="รอสั่งนับซ้ำ" style="background:' + C.a + ';color:#fff;font-weight:700">' + c + '</td>';
        return '<td class="scd-cell num" style="background:' + heat(c) + ';color:#241F1D">' + c + '</td>';
      }).join('');
      return '<tr><td class="num" style="white-space:nowrap">' + r.loc + '</td><td><span class="scd-tag" style="background:' + TAGBG.n + ';color:' + T.n + '">' + r.grp + '</span></td><td class="num">' + r.art + '</td><td class="scd-name">' + esc(r.name) + '</td><td class="num r">' + r.price + '</td>' + cells + '<td class="num r" style="font-weight:700">' + (r.st === 'n' ? '—' : r.total) + '</td><td>' + tag(r.st) + '</td></tr>';
    }).join('');
    h.push('<section class="scd-panel" style="overflow:hidden"><div class="scd-ph" style="padding:16px 20px 0;flex-wrap:wrap"><h3>ภาพรวมแบบชีต CS · Rack ' + v.id + '</h3><span class="scd-hint">1 แถว = Location × Article · คอลัมน์ 1–13 = ตำแหน่งไซส์</span></div>'
      + '<div class="scd-chips"><span class="scd-hint" style="margin-right:4px">กลุ่มไซส์</span>' + chips + '<span class="scd-key"><span><i style="background:#DCCFC7"></i>จำนวนนับ</span><span><i style="background:' + C.r + '"></i>ช่องที่พบส่วนต่าง</span><span><i style="background:' + C.a + '"></i>ช่องรอนับซ้ำ</span></span></div>'
      + '<div class="scd-scroll"><table class="scd-t" style="min-width:1160px"><thead><tr><th>Location</th><th>กลุ่ม</th><th>Article</th><th>ชื่อสินค้า</th><th class="r">ราคา</th>' + labels.map(function (u, i) { return '<th class="scd-cell">' + (i + 1) + '</th>'; }).join('') + '<th class="r">รวม</th><th>สถานะ</th></tr>'
      + '<tr><th colspan="5" style="font-weight:500">' + (grp === 'all' ? 'เลือกกลุ่มไซส์เพื่อดูไซส์ UK ของแต่ละคอลัมน์' : 'ไซส์ UK ของกลุ่ม ' + grp) + '</th>' + labels.map(function (u) { return '<th class="scd-cell num" style="color:var(--ink,#241F1D)">' + u + '</th>'; }).join('') + '<th colspan="2"></th></tr></thead><tbody>' + body + '</tbody></table></div>'
      + '<div class="scd-foot">' + (v.loading ? 'กำลังโหลดข้อมูล Rack ' + v.id + '…' : 'แสดง ' + rows.length + ' จาก ' + totalRows + (DATA.real ? ' แถวของ Rack ' : ' แถวตัวอย่างของ Rack ') + v.id + (totalRows > 300 ? ' (เลือกกลุ่มไซส์เพื่อกรอง)' : '')) + '</div></section>');

    // charts
    var days, mx;
    if (DATA.real) { days = DATA.days; mx = Math.max.apply(null, [1].concat(days.map(function (d) { return Math.max(d[2], d[3]); }))); }
    else {
      var a1 = Math.round(r1 * 0.389), a2 = Math.round(r1 * 0.375), a3 = r1 - a1 - a2, b2 = Math.round(r2 * 0.503), b3 = r2 - b2;
      mx = Math.max(a1, a2, a3, b2, b3);
      days = [['16 พ.ย.', 'วันที่ 1', a1, 0], ['17 พ.ย.', 'วันที่ 2', a2, b2], ['18 พ.ย.', 'วันนี้', a3, b3]];
    }
    var dayHtml = days.map(function (d) { return '<div class="scd-day"><div style="display:flex;gap:4px;align-items:flex-end;height:150px"><div class="scd-bar"><span class="num">' + fmt(d[2]) + '</span><div style="height:' + Math.max(1, Math.round(d[2] / mx * 128)) + 'px;background:#3A3330"></div></div><div class="scd-bar"><span class="num">' + (d[3] ? fmt(d[3]) : '–') + '</span><div style="height:' + Math.max(1, Math.round(d[3] / mx * 128)) + 'px;background:#BDB1AA"></div></div></div><div class="scd-dl">' + d[0] + '<div class="scd-hint">' + d[1] + '</div></div></div>'; }).join('')
      + (DATA.real ? '' : '<div class="scd-day"><div class="scd-future">นับซ้ำ<br>และตรวจสอบ</div><div class="scd-dl">19 พ.ย.<div class="scd-hint">วันที่ 4</div></div></div>');
    var rounds = [['รอบ 1', r1], ['รอบ 2', r2], ['รอบ 3', DATA.real ? sum('l3') : 0], ['รอบ 4', DATA.real ? sum('l4') : 0]].map(function (r) { return '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><b>' + r[0] + '</b><span class="num scd-hint">' + fmt(r[1]) + ' / ' + fmt(TT) + ' · ' + pct(r[1], TT) + '%</span></div><div class="scd-track"><div style="width:' + pct(r[1], TT) + '%;background:#3A3330"></div></div></div>'; }).join('');
    var top = RK.filter(function (x) { return x.r > 0; }).sort(function (x, y) { return y.r - x.r; }).slice(0, 5);
    var vr = top.map(function (x) { return '<div style="display:flex;align-items:center;gap:12px;font-size:13px"><span style="flex:0 0 54px">Rack <b class="num">' + x.id + '</b></span><div class="scd-track" style="height:14px;flex:1"><div style="width:' + Math.round(x.r / top[0].r * 100) + '%;background:' + C.r + '"></div></div><b class="num" style="flex:0 0 28px;text-align:right">' + x.r + '</b></div>'; }).join('');
    var opList;
    if (DATA.real) opList = DATA.opsToday;
    else {
      var today = a3 + b3, shares = [0.28, 0.24, 0.21, 0.165, 0.105], left = today;
      opList = DATA.ops.map(function (nm, i) { var c = i === 4 ? left : Math.round(today * shares[i]); left -= c; return { name: nm, n: c }; });
    }
    var opMax = Math.max.apply(null, [1].concat(opList.map(function (o) { return o.n; })));
    var ops = opList.length ? opList.map(function (o) { return '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px"><span>' + esc(o.name) + '</span><span class="num"><b>' + fmt(o.n) + '</b></span></div><div class="scd-track" style="height:8px"><div style="width:' + Math.round(o.n / opMax * 100) + '%;background:#3A3330"></div></div></div>'; }).join('') : '<div class="scd-empty">วันนี้ยังไม่มีผู้นับส่งข้อมูล</div>';
    h.push('<div class="scd-grid4"><section class="scd-panel scd-pad"><div class="scd-ph"><h3>จำนวน Location ที่นับต่อวัน</h3><span class="scd-hint">■ รอบ 1 &nbsp;<span style="color:#BDB1AA">■</span> รอบ 2</span></div><div style="display:flex;gap:10px;align-items:flex-end">' + dayHtml + '</div></section>'
      + '<section class="scd-panel scd-pad"><div class="scd-ph"><h3>เปรียบเทียบความคืบหน้าแต่ละรอบ</h3></div><div style="display:flex;flex-direction:column;gap:18px">' + rounds + '</div></section>'
      + '<section class="scd-panel scd-pad"><div class="scd-ph"><h3>ส่วนต่างตาม Rack</h3><span class="scd-hint">รวม ' + RV + ' Location</span></div><div style="display:flex;flex-direction:column;gap:12px">' + vr + '</div></section>'
      + '<section class="scd-panel scd-pad"><div class="scd-ph"><h3>ผลงานผู้นับวันนี้</h3><span class="scd-hint">Location ที่นับ</span></div><div style="display:flex;flex-direction:column;gap:13px">' + ops + '</div></section></div>');

    var feed = DATA.feed.map(function (f) { return '<tr><td class="num">' + f.t + '</td><td>' + f.op + '</td><td class="num">' + f.loc + '</td><td class="num">' + f.art + '</td><td class="num">' + f.uk + '</td><td class="num r">' + f.qty + '</td><td>รอบ ' + f.rnd + '</td><td>' + tag(f.st) + '</td></tr>'; }).join('');
    h.push('<section class="scd-panel" style="overflow:hidden"><div class="scd-ph" style="padding:16px 20px 0"><h3>รายการล่าสุดที่ส่งเข้ามาจากมือถือ</h3><span class="scd-hint">อัปเดตทุก 10 นาที</span></div><div class="scd-scroll"><table class="scd-t" style="min-width:720px"><thead><tr><th>เวลา</th><th>ผู้นับ</th><th>Location</th><th>Article</th><th>ไซส์</th><th class="r">จำนวน</th><th>รอบ</th><th>สถานะ</th></tr></thead><tbody>' + feed + '</tbody></table></div></section>');

    root.innerHTML = h.join('');
  }

  var CSS = '.scd{display:flex;flex-direction:column;gap:20px;color:var(--ink,#241F1D);font-family:inherit}'
    + '.scd .num{font-family:"Space Grotesk","IBM Plex Sans Thai",sans-serif}'
    + '.scd-note{background:var(--panel,#fff);border:1px solid var(--line,#E7DFDA);border-left:3px solid #B4650A;border-radius:4px;padding:10px 14px;font-size:13px;line-height:1.6}'
    + '.scd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}.scd-head h2{margin:0;font-size:22px;font-weight:600}'
    + '.scd-sub{font-size:12.5px;color:var(--ink-soft,#6F6560);margin-top:4px}.scd-actions{display:flex;gap:10px;flex-wrap:wrap}'
    + '.scd-btn{height:38px;padding:0 16px;border-radius:4px;border:1px solid var(--ink,#241F1D);background:var(--panel,#fff);color:var(--ink,#241F1D);font:600 13.5px inherit;font-family:inherit;display:inline-flex;align-items:center;gap:8px;cursor:pointer}'
    + '.scd-btn-red{background:#C8102E;border-color:#C8102E;color:#fff}.scd-btn:disabled{opacity:.55;cursor:not-allowed}'
    + '.scd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}'
    + '.scd-panel{background:var(--panel,#fff);border:1px solid var(--line,#E7DFDA);border-radius:4px}.scd-pad{padding:18px 20px}'
    + '.scd-lbl{font-size:12.5px;color:var(--ink-soft,#6F6560);margin-bottom:8px}.scd-kv{font-size:27px;font-weight:600;line-height:1.1}.scd-lbl2{font-size:11.5px;color:var(--ink-soft,#6F6560);margin-top:6px}'
    + '.scd-ph{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px}.scd-ph h3{margin:0;font-size:15px;font-weight:600}.scd-hint{font-size:12px;color:var(--ink-soft,#6F6560)}'
    + '.scd-legend{display:flex;flex-wrap:wrap;gap:10px 28px;margin-top:14px;font-size:13px}.scd-legend i,.scd-stats i,.scd-key i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:7px;vertical-align:-1px}'
    + '.scd-row{display:flex;flex-wrap:wrap;gap:16px;align-items:stretch}.scd-row>section{min-width:0}'
    + '.scd-racks{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}'
    + '.scd-rack{border:1px solid var(--line,#E7DFDA);border-radius:4px;padding:10px;text-align:left;color:var(--ink,#241F1D);background:var(--panel,#fff);display:flex;flex-direction:column;gap:2px;min-height:96px;cursor:pointer;font-family:inherit}.scd-rack.on{outline:2px solid var(--ink,#241F1D);outline-offset:1px}'
    + '.scd-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;font-size:13px}.scd-stats>div{display:flex;justify-content:space-between;border-bottom:1px solid var(--line,#E7DFDA);padding-bottom:6px}'
    + '.scd-empty{font-size:12.5px;color:var(--ink-soft,#6F6560);line-height:1.6;background:var(--bg,#FBF8F6);border:1px solid var(--line,#EFE8E3);border-radius:4px;padding:12px 14px}'
    + '.scd-tag{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:2px;font-weight:600;white-space:nowrap}'
    + '.scd-scroll{overflow-x:auto}.scd-t{width:100%;border-collapse:collapse;font-size:13px}.scd-t th{text-align:left;font-weight:600;font-size:11.5px;color:var(--ink-soft,#6F6560);padding:10px 14px;border-bottom:1px solid var(--line,#E7DFDA);white-space:nowrap}'
    + '.scd-t td{padding:8px 14px;border-bottom:1px solid var(--line,#EFE8E3)}.scd-t .num{text-align:left}.scd-t .r{text-align:right}.scd-small{font-size:12px}.scd-small th,.scd-small td{padding:6px 8px}'
    + '.scd-t th.scd-cell,.scd-t td.scd-cell{text-align:center;padding:8px 0;width:46px;font-size:12.5px;border-left:1px solid var(--panel,#fff)}.scd-name{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.scd-chips{padding:0 20px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.scd-chip{height:34px;padding:0 14px;border:1px solid var(--line,#E7DFDA);border-radius:4px;background:var(--panel,#fff);font:600 12.5px inherit;font-family:inherit;color:var(--ink,#241F1D);cursor:pointer}.scd-chip.on{background:var(--ink,#241F1D);border-color:var(--ink,#241F1D);color:var(--panel,#fff)}'
    + '.scd-key{margin-left:auto;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--ink-soft,#6F6560)}.scd-foot{padding:12px 20px 14px;font-size:12px;color:var(--ink-soft,#6F6560);border-top:1px solid var(--line,#EFE8E3)}'
    + '.scd-grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}'
    + '.scd-day{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end}.scd-bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}.scd-bar span{font-size:11px;margin-bottom:3px}.scd-bar div{width:100%}'
    + '.scd-dl{font-size:12px;margin-top:8px;text-align:center;line-height:1.3}.scd-future{height:150px;border:1px dashed var(--line,#CFC4BD);border-radius:2px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11.5px;color:var(--ink-soft,#6F6560);padding:6px;line-height:1.4}'
    + '.scd-track{height:10px;background:var(--line,#EEE6E1);border-radius:2px;overflow:hidden}.scd-track>div{height:100%}'
    + '.scd button:focus-visible{outline:2px solid #C8102E;outline-offset:2px}'
    + '@media (max-width:900px){.scd-racks{grid-template-columns:repeat(4,minmax(0,1fr))}}';

  // ───────── โหลดข้อมูลจริงจาก Supabase (ถ้าไม่มี → ใช้ข้อมูลตัวอย่าง) ─────────
  var N = function (x) { return Number(x) || 0; };
  var MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function bkk(ms) { return new Date(ms + 7 * 3600e3); }
  function dayLabel(iso) { var d = new Date(iso + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }
  function hms(iso) { return bkk(new Date(iso).getTime()).toISOString().slice(11, 19); }

  async function loadReal() {
    if (typeof sb === 'undefined') return null;
    var cy = await sb.from('sc_cycles').select('*').eq('status', 'open').order('started_on', { ascending: false }).limit(1);
    if (cy.error || !cy.data || !cy.data.length) return null;
    var cycle = cy.data[0], todayIso = bkk(Date.now()).toISOString().slice(0, 10);
    var q = await Promise.all([
      sb.from('sc_rack_summary').select('*').eq('cycle_id', cycle.id).order('rack'),
      sb.from('sc_daily').select('*').eq('cycle_id', cycle.id).order('day'),
      sb.from('sc_operator_daily').select('*').eq('cycle_id', cycle.id).eq('day', todayIso).order('locations', { ascending: false }),
      sb.from('sc_counts').select('received_at,operator_name,location_code,article7,pos,qty,round').eq('cycle_id', cycle.id).order('received_at', { ascending: false }).limit(8)
    ]);
    for (var i = 0; i < q.length; i++) if (q[i].error) return null;
    if (!q[0].data.length) return null;   // ยังไม่ได้นำเข้า Location
    var racks = q[0].data.map(function (x) { return { id: x.rack, total: N(x.total), g: N(x.g), b: N(x.b), a: N(x.a), r: N(x.r), n: N(x.n), pairs: N(x.pairs), l1: N(x.l1), l2: N(x.l2), l3: N(x.l3), l4: N(x.l4) }; });
    var byDay = {};
    q[1].data.forEach(function (x) { var d = byDay[x.day] || (byDay[x.day] = [0, 0]); if (x.round === 1) d[0] += N(x.locations); if (x.round === 2) d[1] += N(x.locations); });
    var start = new Date(cycle.started_on + 'T00:00:00Z'), now = new Date(todayIso + 'T00:00:00Z');
    var dayNo = Math.max(1, Math.round((now - start) / 864e5) + 1), days = [];
    for (var k = 0; k < Math.min(dayNo, 7); k++) { var dd = new Date(start.getTime() + k * 864e5), iso = dd.toISOString().slice(0, 10), v = byDay[iso] || [0, 0]; days.push([dayLabel(iso), iso === todayIso ? 'วันนี้' : 'วันที่ ' + (k + 1), v[0], v[1]]); }
    var feed = [], rows = q[3].data;
    if (rows.length) {
      var arts = rows.map(function (x) { return x.article7; }), locs = rows.map(function (x) { return x.location_code; });
      var meta = await sb.from('sc_item_status').select('location_code,article7,pos,st,size_group').eq('cycle_id', cycle.id).in('article7', arts).in('location_code', locs);
      var mm = {}; (meta.data || []).forEach(function (m) { mm[m.location_code + '|' + m.article7 + '|' + m.pos] = m; });
      feed = rows.map(function (x) { var m = mm[x.location_code + '|' + x.article7 + '|' + x.pos] || {}; return { t: hms(x.received_at), op: x.operator_name || 'ไม่ระบุ', loc: x.location_code, art: x.article7, uk: (GL[m.size_group] || [])[x.pos - 1] || String(x.pos), qty: x.qty, st: m.st === 'r' ? 'r' : m.st === 'a' ? 'a' : 'g', rnd: x.round }; });
    }
    return { real: true, cycle: cycle, dayNo: dayNo, racks: racks, days: days, feed: feed, ops: [], opsToday: q[2].data.map(function (x) { return { name: x.operator_name, n: N(x.locations) }; }) };
  }

  var RANK = { r: 4, a: 3, b: 2, g: 1 };
  async function loadRack(rk) {
    rk.loading = true; render();
    var items = [], from = 0, res;
    try {
      for (var pg = 0; pg < 40; pg++) {
        res = await sb.from('sc_item_status').select('*').eq('cycle_id', DATA.cycle.id).eq('rack', rk.id).order('location_code').order('article7').order('pos').range(from, from + 999);
        if (res.error) throw res.error;
        items = items.concat(res.data);
        if (res.data.length < 1000) break;
        from += 1000;
      }
    } catch (e) { rk.loading = false; rk.rows = []; rk.vrows = []; render(); return; }
    var map = {}, rows = [], vrows = [];
    items.forEach(function (it) {
      var key = it.location_code + '|' + it.article7, r = map[key];
      if (!r) { r = map[key] = { loc: it.location_code, grp: it.size_group || '?', art: it.article7, name: it.name || '', price: it.price != null ? Number(it.price).toFixed(2) : '-', cells: new Array(13).fill(null), cst: [], d: [], total: 0, st: 'g' }; rows.push(r); }
      var p = it.pos - 1;
      r.cells[p] = N(it.final_qty); r.cst[p] = it.st; r.d[p] = [it.r1, it.r2]; r.total += N(it.final_qty);
      if (RANK[it.st] > RANK[r.st]) r.st = it.st;
      if (it.st === 'r') vrows.push({ loc: it.location_code, art: it.article7, uk: (GL[it.size_group] || [])[p] || String(it.pos), r1: it.r1, r2: it.r2 != null ? it.r2 : it.r1 });
    });
    rk.rows = rows; rk.vrows = vrows; rk.loading = false; render();
  }

  async function init() {
    var real = null;
    try { real = await loadReal(); } catch (e) { real = null; }
    DATA = real || buildSample(); state.sel = null; render();
  }

  function mount(el) {
    if (!el) return;
    if (!document.getElementById('scd-style')) { var st = document.createElement('style'); st.id = 'scd-style'; st.textContent = CSS; document.head.appendChild(st); }
    root = el; el.classList.add('scd');
    var first = !DATA; if (first) { DATA = buildSample(); }
    if (!el.dataset.scdBound) {
      el.dataset.scdBound = '1';
      el.addEventListener('click', function (e) {
        var r = e.target.closest('[data-rack]'), g = e.target.closest('[data-grp]'), rl = e.target.closest('[data-reload]');
        if (rl) { e.preventDefault(); init(); }
        else if (r) { state.sel = r.getAttribute('data-rack'); render(); }
        else if (g) { state.grp = g.getAttribute('data-grp'); render(); }
      });
    }
    render();
    init();   // ดึงข้อมูลจริง ถ้ามี จะแทนที่ข้อมูลตัวอย่าง
  }

  window.StockCountDash = { mount: mount };
})();
