// ══════════════════════════════════════════════════════
// MICHELIN OPS — DSR Order App + Live Stock + Delivery Tracking
// ══════════════════════════════════════════════════════
// Google Sheet "MICHELIN OPS" ke Apps Script (Code.gs + Wati.gs + RM.gs) ka
// Express roop. Frontend (frontend/ops.html) wahi hai jo sheet wale system me
// tha — bas `google.script.run.fn(arg)` ki jagah `POST /api/ops/<fn>` hai aur
// har function pehle jaisa JSON string lautata hai. Isliye function ke naam,
// input/outputs sab Apps Script jaise hi rakhe hain: login, getItems,
// stockMove, getDealers, addDealer, placeOrder, getOrders, updateOrderStatus,
// confirmOrderCRM, getDashboard, uploadKyc, getRMs, sendRMReport ...
//
// Farak jo jaan-bujhkar hain:
//   • Login par cookie (ops_token, JWT) milti hai. Sheet wala system har call
//     me `by: mobile` client se maanta tha — yahan `by` cookie se aata hai.
//   • Stock minus/plus transaction me hota hai (LockService ki jagah).
//   • KYC files Drive ki jagah DB (ops_dealer_docs) me hain.
//   • WhatsApp event par turant jaata hai; upar se har 5 min ek scanner
//     (Wati.gs ka watiScanOrders) jo chhoote/fail hue dobara try karta hai.
//   • Busy xlsx Drive folder ki jagah app se upload hota hai (importBusy).
//
// Roles: 'DSR' sirf apne orders dekhta hai aur status nahi badal sakta; baaki
// sab (ADMIN / Accounts / Billing / RM) "admin" hain — bilkul sheet jaise.

const express = require('express');
const jwt = require('jsonwebtoken');
const wati = require('../lib/ops-wati');
const busy = require('../lib/ops-busy');
const { istParts } = require('../lib/dates');

const STATUSES = ['PENDING', 'CONFIRMED', 'BILLED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
// In statuses me maal godown se nikal chuka hai (stock minus). BILLED = bill + dispatch ek saath.
const STOCK_OUT = new Set(['BILLED', 'DISPATCHED']);
const LOW_STOCK = busy.LOW_STOCK;
// Michelin 2W monthly slab: [is mahine kam se kam itne tyre, credit note Rs/tyre]
const SLAB_TABLE = [[6, 20], [10, 40], [20, 55], [50, 70], [75, 85], [100, 100]];
const COOKIE = 'ops_token';

module.exports = function registerOpsRoutes(app, ctx) {
  const { db, JWT_SECRET, IS_SERVERLESS } = ctx;
  const router = express.Router();
  // KYC photos/PDF base64 me aati hain (8MB tak PDF) — default limit kam padti
  router.use(express.json({ limit: '40mb' }));

  // ── helpers ────────────────────────────────────────
  const J = o => JSON.stringify(o);
  const err = m => J({ ok: false, error: m });
  const clean = busy.clean;
  const nb = busy.nb;
  const pad = n => String(n).padStart(2, '0');

  // Abhi IST me: 'dd/MM/yyyy HH:mm' aur 'dd/MM/yyyy' — sheet wale format
  function nowIST() {
    const p = istParts();
    const [y, m, d] = p.dateStr.split('-');
    return { dmy: `${d}/${m}/${y}`, dmyhm: `${d}/${m}/${y} ${pad(p.hour)}:${pad(p.minute)}`, iso: p.dateStr, hour: p.hour, minute: p.minute };
  }
  // DATE column (YYYY-MM-DD string) -> dd/MM/yyyy
  const dmyOf = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
  // DATETIME ko SQL me hi format karte hain — Node ka timezone beech me na aaye
  const FMT = col => `DATE_FORMAT(${col},'%d/%m/%Y %H:%i')`;

  function itemName(r) { return busy.itemName(r); }
  const isAdmin = u => u && u.role !== 'DSR';

  // Order ID: MO-yyMMdd-HHmmss (IST). Same second me do orders aayein to -2, -3.
  // Order ID: simple running number — MO-1001, MO-1002 ... (purane sheet wale
  // MO-yyMMdd-HHmmss waise hi rahenge). Race me duplicate na bane, isliye insert
  // fail hone par caller retry karta hai (unique key oid).
  async function newOrderId() {
    const [[r]] = await db.query(`SELECT MAX(CAST(SUBSTRING(oid, 4) AS UNSIGNED)) AS n FROM ops_orders WHERE oid REGEXP '^MO-[0-9]+$'`);
    const next = Math.max(1000, r && r.n ? Number(r.n) : 1000) + 1;
    return `MO-${next}`;
  }

  // ── auth ───────────────────────────────────────────
  async function userByMobile(mob) {
    const [r] = await db.query('SELECT id, mobile, name, role FROM ops_users WHERE mobile=? AND active=1', [mob]);
    return r[0] ? { id: r[0].id, mob: r[0].mobile, name: r[0].name, role: String(r[0].role).toUpperCase() } : null;
  }
  async function requireOps(req, res, next) {
    const token = req.cookies?.[COOKIE] || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.type('json').send(err('Login nahi hai'));
    try {
      const d = jwt.verify(token, JWT_SECRET);
      const u = await userByMobile(d.mob);
      if (!u) return res.type('json').send(err('Login nahi hai'));
      req.opsUser = u;
      next();
    } catch (_) { res.type('json').send(err('Login nahi hai')); }
  }
  const adminOnly = (req, res, next) => isAdmin(req.opsUser) ? next() : res.type('json').send(err('Permission nahi hai'));

  // Har RPC ek hi shakl: body = { arg } (ya args: [...]) -> JSON string
  const rpc = (fn) => async (req, res) => {
    try {
      const body = req.body || {};
      const args = Array.isArray(body.args) ? body.args : [body.arg];
      const out = await fn(req.opsUser, ...args);
      res.type('json').send(typeof out === 'string' ? out : J(out));
    } catch (e) {
      console.error('ops', req.path, e.message);
      res.type('json').send(err(e.message));
    }
  };

  // ══════════ LOGIN ══════════
  router.post('/login', async (req, res) => {
    try {
      const mob = clean(req.body && (req.body.arg ?? req.body.mob));
      if (mob.length !== 10) return res.type('json').send(err('10-digit mobile daalo'));
      const u = await userByMobile(mob);
      if (!u) return res.type('json').send(err('Ye number registered nahi hai. Arun ji se baat karo.'));
      const token = jwt.sign({ mob: u.mob, ops: 1 }, JWT_SECRET, { expiresIn: '90d' });
      res.cookie(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 90 * 86400 * 1000, path: '/' });
      res.type('json').send(J({ ok: true, user: { mob: u.mob, name: u.name, role: u.role } }));
    } catch (e) { res.type('json').send(err(e.message)); }
  });
  router.post('/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
  router.get('/me', requireOps, (req, res) => res.json({ ok: true, user: { mob: req.opsUser.mob, name: req.opsUser.name, role: req.opsUser.role } }));

  // ══════════ ITEMS / STOCK ══════════
  async function itemsList() {
    const [rows] = await db.query(`SELECT *, ${FMT('updated_at')} AS updated FROM ops_items ORDER BY id`);
    return rows.map(r => ({
      code: r.code, brand: r.brand || '', seg: r.segment, cat: r.category, size: r.size, pos: r.position || '',
      pattern: r.pattern || '', tltt: r.tltt || '', li: r.li || '', price: Number(r.price) || 0,
      tube: Number(r.tube_price) || 0, stock: r.stock | 0, updated: r.updated || '',
      basic: Number(r.basic_price) || 0, busy: r.busy_name || '',
    }));
  }
  router.post('/getItems', requireOps, rpc(async () => itemsList()));

  async function log(conn, type, code, name, qty, prev, after, note, by) {
    await conn.query('INSERT INTO ops_stock_log (type,code,item_name,qty,prev_stock,after_stock,note,by_name) VALUES (?,?,?,?,?,?,?,?)',
      [type, code, name, qty, prev, after, note || '', by || '']);
  }

  // Stock IN / exact count — admin only
  router.post('/stockMove', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query('SELECT * FROM ops_items WHERE code=? FOR UPDATE', [String(d.code)]);
      if (!row) { await conn.rollback(); return err('Item nahi mila'); }
      const prev = row.stock | 0; let qty = parseInt(d.qty, 10), after;
      if (isNaN(qty)) { await conn.rollback(); return err('Qty galat hai'); }
      if (d.type === 'IN') { if (qty < 1) { await conn.rollback(); return err('Qty 1 se zyada ho'); } after = prev + qty; }
      else if (d.type === 'SET') { if (qty < 0) { await conn.rollback(); return err('Qty 0 se kam nahi'); } after = qty; qty = Math.abs(after - prev); }
      else { await conn.rollback(); return err('Type galat'); }
      await conn.query('UPDATE ops_items SET stock=?, updated_at=NOW() WHERE id=?', [after, row.id]);
      await log(conn, d.type === 'IN' ? 'IN' : 'EDIT', row.code, itemName(row), qty, prev, after, d.note || (d.type === 'IN' ? 'Stock IN' : 'Physical count'), u.name);
      await conn.commit();
      return J({ ok: true, after });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }));

  // Item master edit (admin): brand/segment/category/size/pattern/TL-TT/price/Busy naam.
  // Stock yahan se nahi badalta (uske liye stockMove).
  router.post('/editItem', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[it]] = await db.query('SELECT * FROM ops_items WHERE code=?', [String(d.code)]);
    if (!it) return err('Item nahi mila');
    const s = (v, old) => (v === undefined ? old : String(v).trim());
    const n = (v, old) => (v === undefined || v === '' ? Number(old) : (parseFloat(v) || 0));
    const seg = s(d.seg, it.segment).toUpperCase();
    await db.query('UPDATE ops_items SET brand=?, segment=?, category=?, size=?, position=?, pattern=?, tltt=?, li=?, basic_price=?, price=?, tube_price=?, busy_name=?, updated_at=NOW() WHERE id=?',
      [s(d.brand, it.brand), seg, s(d.cat, it.category), s(d.size, it.size), s(d.pos, it.position), s(d.pattern, it.pattern), s(d.tltt, it.tltt).toUpperCase(), s(d.li, it.li), n(d.basic, it.basic_price), n(d.price, it.price), n(d.tube, it.tube_price), s(d.busy, it.busy_name), it.id]);
    return J({ ok: true });
  }));

  router.post('/getStockLog', requireOps, rpc(async () => {
    const [rows] = await db.query(`SELECT ${FMT('log_time')} AS time, type, code, item_name AS name, qty, prev_stock AS prev, after_stock AS after, note, by_name AS by_ FROM ops_stock_log ORDER BY id DESC LIMIT 150`);
    return rows.map(r => ({ time: r.time, type: r.type, code: r.code, name: r.name, qty: r.qty, prev: r.prev, after: r.after, note: r.note, by: r.by_ }));
  }));

  // ══════════ DEALERS ══════════
  async function outstandingMap() {
    const m = {};
    const [rows] = await db.query('SELECT dealer_name, mobile, amount, as_on FROM ops_outstanding');
    for (const r of rows) {
      const o = { amount: Number(r.amount), asOn: r.as_on || '' };
      if (clean(r.mobile).length === 10) m[clean(r.mobile)] = o;
      m[nb(r.dealer_name)] = o;
    }
    return m;
  }
  // Dealer ka payment rating + exposure (credit limit ke liye) — ops_orders se
  //   exposure = max(Busy outstanding, app ke delivered-unpaid) + khule orders (confirmed/billed)
  //   rating   = paid orders me kitne late the (terms ke hisaab se), abhi overdue hai ya nahi
  async function dealerStats() {
    const [rows] = await db.query(
      `SELECT did,
              COALESCE(SUM(CASE WHEN status='DELIVERED' AND payment_status<>'PAID' THEN amount END),0) AS unpaid,
              COALESCE(SUM(CASE WHEN status IN ('PENDING','CONFIRMED','BILLED','DISPATCHED') THEN amount END),0) AS open_amt,
              SUM(status='DELIVERED' AND payment_status='PAID') AS paidN,
              SUM(status='DELIVERED' AND payment_status='PAID' AND payment_due IS NOT NULL AND DATE(paid_at)>payment_due) AS lateN,
              AVG(CASE WHEN status='DELIVERED' AND payment_status='PAID' AND delivered_at IS NOT NULL THEN DATEDIFF(paid_at, delivered_at) END) AS avgDays,
              SUM(status='DELIVERED' AND payment_status<>'PAID' AND payment_due IS NOT NULL AND payment_due<CURRENT_DATE) AS overdueN,
              MAX(CASE WHEN status='DELIVERED' AND payment_status='PAID' THEN paid_at END) AS lastPaid,
              SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN payment_terms<>'' THEN payment_terms END ORDER BY id DESC SEPARATOR '||'),'||',1) AS lastTerms
       FROM ops_orders WHERE status<>'CANCELLED' GROUP BY did`);
    const m = {}; for (const r of rows) m[r.did] = r; return m;
  }
  function ratingOf(s) {
    if (!s) return { stars: 0, label: 'NEW', paidN: 0, lateN: 0, overdueN: 0, avgDays: null, lastTerms: '' };
    const paidN = s.paidN | 0, lateN = s.lateN | 0, overdueN = s.overdueN | 0;
    let stars = 0, label = 'NEW';
    if (paidN > 0) {
      const latePct = lateN / paidN;
      stars = latePct <= 0.1 ? 5 : latePct <= 0.3 ? 4 : latePct <= 0.5 ? 3 : latePct <= 0.75 ? 2 : 1;
      if (overdueN > 0) stars = Math.max(1, stars - 1);
      label = stars >= 4 ? 'GOOD' : stars === 3 ? 'OK' : 'RISK';
    } else if (overdueN > 0) { stars = 1; label = 'RISK'; }
    return { stars, label, paidN, lateN, overdueN, avgDays: s.avgDays == null ? null : Math.round(Number(s.avgDays)), lastTerms: s.lastTerms || '', lastPaid: s.lastPaid ? dmyOf(new Date(s.lastPaid).toISOString()) : '' };
  }
  async function dealersList() {
    const [rows] = await db.query('SELECT * FROM ops_dealers WHERE active=1 ORDER BY id');
    const [docs] = await db.query('SELECT dealer_id, doc_key FROM ops_dealer_docs');
    const docMap = {};
    for (const d of docs) (docMap[d.dealer_id] = docMap[d.dealer_id] || []).push(d.doc_key);
    const out = await outstandingMap();
    const stats = await dealerStats();
    return rows.map(r => {
      const mob = clean(r.mobile);
      const o = out[mob] || out[nb(r.busy_name)] || out[nb(r.name)] || null;
      const s = stats[r.did];
      const unpaid = s ? Number(s.unpaid) : 0, open = s ? Number(s.open_amt) : 0;
      const exposure = Math.max(o ? Number(o.amount) : 0, unpaid) + open;
      return {
        did: r.did, name: r.name, mob, city: r.city || '', address: r.address || '', dsr: r.added_by || '',
        busy: r.busy_name || '', gstNo: r.gst_no || '', pan: r.pan || '', kyc: r.kyc_status || '',
        folder: r.kyc_folder || '', docs: docMap[r.id] || [], lat: r.lat || '', lng: r.lng || '',
        outstanding: o, creditLimit: Number(r.credit_limit) || 0, exposure, unpaid, open,
        overLimit: Number(r.credit_limit) > 0 && exposure > Number(r.credit_limit),
        rating: ratingOf(s),
      };
    });
  }
  router.post('/getDealers', requireOps, rpc(async () => dealersList()));

  // Dealer edit (admin): naam, mobile, city, address, Busy naam, GST, PAN, credit limit, active
  router.post('/editDealer', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[dl]] = await db.query('SELECT * FROM ops_dealers WHERE did=?', [String(d.did)]);
    if (!dl) return err('Dealer nahi mila');
    const name = String(d.name ?? dl.name).trim(); if (name.length < 2) return err('Naam daalo');
    const mob = d.mob !== undefined ? clean(d.mob) : dl.mobile; if (mob.length !== 10) return err('10-digit mobile daalo');
    const [dup] = await db.query('SELECT did FROM ops_dealers WHERE mobile=? AND id<>?', [mob, dl.id]);
    if (dup[0]) return err(`Ye number dealer ${dup[0].did} ka hai`);
    const cl = d.creditLimit !== undefined ? (parseFloat(d.creditLimit) || 0) : Number(dl.credit_limit);
    await db.query('UPDATE ops_dealers SET name=?, mobile=?, city=?, address=?, busy_name=?, gst_no=?, pan=?, credit_limit=?, active=? WHERE id=?',
      [name, mob, String(d.city ?? dl.city).trim(), String(d.address ?? dl.address).trim(), String(d.busy ?? dl.busy_name).trim(), String(d.gstNo ?? dl.gst_no).toUpperCase().trim(), String(d.pan ?? dl.pan).toUpperCase().trim(), cl, d.active === undefined ? dl.active : (d.active ? 1 : 0), dl.id]);
    // Orders me dealer ka naam/mobile copy hota hai — khule orders me update
    await db.query(`UPDATE ops_orders SET dealer_name=?, dealer_mobile=? WHERE did=? AND status IN ('PENDING','CONFIRMED','BILLED','DISPATCHED')`, [name, mob, dl.did]);
    return J({ ok: true });
  }));

  // ── Users (admin): DSR / CRM / ADMIN / ACCOUNTS / BILLING / RM
  const ROLES = ['DSR', 'CRM', 'ADMIN', 'ACCOUNTS', 'BILLING', 'RM'];
  router.post('/saveUser', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const mob = clean(d.mob); if (mob.length !== 10) return err('10-digit mobile daalo');
    const name = String(d.name || '').trim(); if (name.length < 2) return err('Naam daalo');
    const role = ROLES.includes(String(d.role || '').toUpperCase()) ? String(d.role).toUpperCase() : 'DSR';
    const active = d.active === undefined ? 1 : (d.active ? 1 : 0);
    if (mob === u.mob && !active) return err('Khud ko band nahi kar sakte');
    await db.query('INSERT INTO ops_users (mobile,name,role,active) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), active=VALUES(active)', [mob, name, role, active]);
    return J({ ok: true });
  }));

  // ── Transporter master (admin edit, sab padh sakte hain)
  router.post('/getTransporters', requireOps, rpc(async () => {
    const [rows] = await db.query('SELECT * FROM ops_transporters WHERE active=1 ORDER BY name');
    return rows.map(r => ({ id: r.id, name: r.name, mob: r.mobile, vehicle: r.vehicle, driverName: r.driver_name, driverMob: r.driver_mobile, city: r.city, note: r.note }));
  }));
  router.post('/saveTransporter', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const name = String(d.name || '').trim(); if (name.length < 2) return err('Transporter ka naam daalo');
    const vals = [name, clean(d.mob), String(d.vehicle || '').trim().toUpperCase(), String(d.driverName || '').trim(), clean(d.driverMob), String(d.city || '').trim(), String(d.note || '').trim()];
    if (d.id) { await db.query('UPDATE ops_transporters SET name=?, mobile=?, vehicle=?, driver_name=?, driver_mobile=?, city=?, note=? WHERE id=?', vals.concat([parseInt(d.id, 10)])); return J({ ok: true, id: parseInt(d.id, 10) }); }
    const [r] = await db.query('INSERT INTO ops_transporters (name,mobile,vehicle,driver_name,driver_mobile,city,note) VALUES (?,?,?,?,?,?,?)', vals);
    return J({ ok: true, id: r.insertId });
  }));
  router.post('/deleteTransporter', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    await db.query('UPDATE ops_transporters SET active=0 WHERE id=?', [parseInt(d.id, 10)]);
    return J({ ok: true });
  }));

  router.post('/addDealer', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const name = String(d.name || '').trim(), mob = clean(d.mob);
    if (name.length < 2) return err('Dealer ka naam daalo');
    if (mob.length !== 10) return err('10-digit mobile daalo');
    const [dup] = await db.query('SELECT name FROM ops_dealers WHERE mobile=?', [mob]);
    if (dup[0]) return err(`Ye number already dealer "${dup[0].name}" ka hai`);
    const [rows] = await db.query('SELECT did FROM ops_dealers');
    let maxN = 0;
    for (const r of rows) { const m = String(r.did).match(/^D-(\d+)$/); if (m) maxN = Math.max(maxN, parseInt(m[1], 10)); }
    const did = 'D-' + String(maxN + 1).padStart(3, '0');
    // Location: Google Maps pin link diya ho to usse (WhatsApp wala pin), warna phone ka GPS
    let lat = d.lat == null ? '' : String(d.lat), lng = d.lng == null ? '' : String(d.lng), locFrom = lat ? 'gps' : '';
    if (d.mapLink) {
      const c = await require('../lib/maps-link').coordsFromLink(d.mapLink);
      if (c) { lat = String(c.lat); lng = String(c.lng); locFrom = 'link'; }
      else locFrom = 'link-fail';
    }
    await db.query('INSERT INTO ops_dealers (did,name,mobile,city,address,added_by,active,lat,lng,credit_limit) VALUES (?,?,?,?,?,?,1,?,?,?)',
      [did, name, mob, String(d.city || '').trim(), String(d.address || '').trim(), u.name, lat, lng, parseFloat(d.creditLimit) || 0]);
    return J({ ok: true, did, locFrom });
  }));

  // ── Michelin 2W monthly slab ──
  function computeSlab(qty) {
    let cur = null, next = null;
    for (const s of SLAB_TABLE) { if (qty >= s[0]) cur = s; else { next = s; break; } }
    return {
      slabIndex: cur ? SLAB_TABLE.indexOf(cur) + 1 : 0, cn: cur ? cur[1] : 0, minForCurrent: cur ? cur[0] : 0,
      nextMin: next ? next[0] : null, nextCn: next ? next[1] : null, moreForNext: next ? next[0] - qty : null,
    };
  }
  // Dealer ke is mahine ke Michelin SC+MC tyre (cancelled chhod kar) + cart wale
  router.post('/getDealerMichelinSlab', requireOps, rpc(async (u, did, extraQty) => {
    if (!did) return J({ ok: true, monthQty: 0, extraQty: 0, projected: 0, slab: computeSlab(0) });
    const [rows] = await db.query(
      `SELECT items_json FROM ops_orders WHERE did=? AND status<>'CANCELLED' AND DATE_FORMAT(order_date,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m')`, [String(did)]);
    let monthQty = 0;
    for (const r of rows) {
      let lines = []; try { lines = JSON.parse(r.items_json || '[]'); } catch (_) {}
      for (const l of lines) { const seg = String(l.code || '').slice(0, 2); if (seg === 'SC' || seg === 'MC') monthQty += parseInt(l.qty, 10) || 0; }
    }
    const extra = parseInt(extraQty, 10) || 0;
    return J({ ok: true, monthQty, extraQty: extra, projected: monthQty + extra, slab: computeSlab(monthQty + extra) });
  }));

  // ── Dealer history: last order + last payment ──
  router.post('/getDealerHistory', requireOps, rpc(async (u, did) => {
    if (!did) return J({ ok: true, lastOrder: null, lastPayment: null });
    const [o] = await db.query(`SELECT oid, order_date, total_qty, amount, items_json FROM ops_orders WHERE did=? AND status<>'CANCELLED' ORDER BY id DESC LIMIT 1`, [String(did)]);
    let lastOrder = null;
    if (o[0]) {
      let lines = []; try { lines = JSON.parse(o[0].items_json || '[]'); } catch (_) {}
      lastOrder = { date: dmyOf(o[0].order_date), oid: o[0].oid, qty: o[0].total_qty | 0, amount: Number(o[0].amount) || 0, items: lines.map(l => `${l.name} x${l.qty} @${l.rate}`) };
    }
    const [[dl]] = await db.query('SELECT name FROM ops_dealers WHERE did=?', [String(did)]);
    let lastPayment = null;
    if (dl) {
      const [p] = await db.query(`SELECT amount_paid, as_on, ${FMT('log_time')} AS t FROM ops_payment_log WHERE UPPER(TRIM(dealer_name))=? ORDER BY id DESC LIMIT 1`, [String(dl.name).trim().toUpperCase()]);
      if (p[0]) lastPayment = { date: p[0].as_on || p[0].t, amount: Number(p[0].amount_paid) || 0 };
    }
    return J({ ok: true, lastOrder, lastPayment });
  }));

  // ══════════ ORDERS ══════════
  // Cart lines ko item master se validate karke lines/qty/amount banata hai.
  // rate: list price, ya manual (negotiated brands: Accelon/Metro/Neumex, price 0).
  function buildLines(items, inv) {
    const lines = []; let qty = 0, amt = 0;
    for (const it of items) {
      const row = inv[String(it.code)]; if (!row) return { error: 'Item nahi mila: ' + it.code };
      const q = parseInt(it.qty, 10) || 0; if (q < 1) return { error: 'Qty galat: ' + it.code };
      const rate = (it.rate !== undefined && it.rate !== null && it.rate !== '') ? parseFloat(it.rate) : (Number(row.price) || 0);
      lines.push({ code: row.code, name: itemName(row), qty: q, rate, amount: Math.round(rate * q), stockAt: row.stock | 0 });
      qty += q; amt += Math.round(rate * q);
    }
    return { lines, qty, amt };
  }
  async function itemInv() {
    const [rows] = await db.query('SELECT * FROM ops_items');
    const inv = {}; for (const r of rows) inv[r.code] = r; return inv;
  }

  router.post('/placeOrder', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const items = d.items || []; if (!items.length) return err('Kam se kam 1 item daalo');
    if (!d.did) return err('Dealer select karo');
    const [[dl]] = await db.query('SELECT * FROM ops_dealers WHERE did=?', [String(d.did)]);
    if (!dl) return err('Dealer nahi mila');
    const b = buildLines(items, await itemInv()); if (b.error) return err(b.error);
    const now = nowIST();
    const hist = [{ s: 'PENDING', t: now.dmyhm, by: u.name }];
    let oid = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      oid = await newOrderId();
      try {
        await db.query(
          `INSERT INTO ops_orders (oid,order_date,dsr_name,dsr_mobile,did,dealer_name,dealer_mobile,city,items_json,total_qty,amount,status,note,history_json,created_at,updated_at)
           VALUES (?,CURRENT_DATE,?,?,?,?,?,?,?,?,?,'PENDING',?,?,NOW(),NOW())`,
          [oid, u.name, u.mob, dl.did, dl.name, clean(dl.mobile), dl.city || '', J(b.lines), b.qty, b.amt, String(d.note || ''), J(hist)]);
        break;
      } catch (e) { if (e.code === '23505' && attempt < 4) continue; throw e; }
    }
    // Office ko WhatsApp — turant; fail ho to 5-min scanner dobara try karega
    notifyNewOrder({ oid, dname: dl.name, city: dl.city || '', dsr: u.name, qty: b.qty, amount: b.amt }).catch(e => console.error('ops wa', e.message));
    return J({ ok: true, oid, qty: b.qty, amount: b.amt });
  }));

  function mapOrder(r, files) {
    let lines = [], hist = [];
    try { lines = JSON.parse(r.items_json || '[]'); } catch (_) {}
    try { hist = JSON.parse(r.history_json || '[]'); } catch (_) {}
    return {
      oid: r.oid, date: dmyOf(r.order_date), dsr: r.dsr_name, dsrMob: r.dsr_mobile || '', did: r.did, dname: r.dealer_name, dmob: clean(r.dealer_mobile),
      city: r.city || '', items: lines, qty: r.total_qty | 0, amount: Number(r.amount) || 0, status: r.status,
      inv: r.invoice_no || '', vehicle: r.vehicle || '', note: r.note || '', created: r.created, updated: r.updated,
      history: hist, terms: r.payment_terms || '',
      driver: r.driver_mobile || '', driverName: r.driver_name || '', transporter: r.transporter || '', lr: r.lr_no || '',
      billed: r.billed || '', payStatus: r.payment_status || 'PENDING', paidAt: r.paid || '',
      due: dmyOf(r.payment_due), delivered: r.delivered || '', cancelReason: r.cancel_reason || '',
      files: (files && files[r.oid]) || [],
    };
  }
  // Har order par kaunsi files lagi hain (invoice / pod) — ek query, oid se map
  async function filesMap(oids) {
    if (!oids.length) return {};
    const [rows] = await db.query(`SELECT oid, kind FROM ops_order_files WHERE oid IN (${oids.map(() => '?').join(',')})`, oids);
    const m = {}; for (const f of rows) (m[f.oid] = m[f.oid] || []).push(f.kind); return m;
  }
  const ORDER_SELECT = `SELECT *, ${FMT('created_at')} AS created, ${FMT('updated_at')} AS updated, ${FMT('paid_at')} AS paid, ${FMT('delivered_at')} AS delivered, ${FMT('billed_at')} AS billed FROM ops_orders`;
  async function ordersFor(u) {
    const where = isAdmin(u) ? '' : ' WHERE dsr_mobile=?';
    const [rows] = await db.query(`${ORDER_SELECT}${where} ORDER BY id DESC LIMIT 300`, isAdmin(u) ? [] : [u.mob]);
    const fm = await filesMap(rows.map(r => r.oid));
    return rows.map(r => mapOrder(r, fm));
  }
  async function orderByOid(oid) {
    const [[r]] = await db.query(`${ORDER_SELECT} WHERE oid=?`, [String(oid)]);
    if (!r) return null;
    return mapOrder(r, await filesMap([r.oid]));
  }

  // "15 din credit" / "30 days" -> 15 / 30; "advance" / "cash" -> 0; kuch samajh na aaye to null
  function termsDays(terms) {
    const t = String(terms || '').toLowerCase();
    if (!t.trim()) return null;
    const m = t.match(/(\d+)\s*(din|day|days|d)\b/);
    if (m) return parseInt(m[1], 10);
    if (/advance|cash|spot|immediate/.test(t)) return 0;
    const n = t.match(/^\s*(\d+)\s*$/); if (n) return parseInt(n[1], 10);
    return null;
  }

  // ── Order EDIT (items/qty/rate/note) — PENDING ya CONFIRMED tak, BILLED ke baad nahi.
  // DSR sirf apna order, admin koi bhi. History me 'EDITED' entry.
  router.post('/editOrder', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[row]] = await db.query('SELECT * FROM ops_orders WHERE oid=?', [String(d.oid)]);
    if (!row) return err('Order nahi mila');
    if (!isAdmin(u) && row.dsr_mobile !== u.mob) return err('Ye aapka order nahi hai');
    if (!['PENDING', 'CONFIRMED'].includes(row.status)) return err(`${row.status} order edit nahi ho sakta (sirf Pending/Confirmed)`);
    const items = d.items || []; if (!items.length) return err('Kam se kam 1 item hona chahiye');
    const b = buildLines(items, await itemInv()); if (b.error) return err(b.error);
    let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
    hist.push({ s: 'EDITED', t: nowIST().dmyhm, by: u.name });
    await db.query('UPDATE ops_orders SET items_json=?, total_qty=?, amount=?, note=?, history_json=?, updated_at=NOW() WHERE id=?',
      [J(b.lines), b.qty, b.amt, d.note !== undefined ? String(d.note) : row.note, J(hist), row.id]);
    return J({ ok: true, oid: row.oid, qty: b.qty, amount: b.amt });
  }));

  // ── Order CANCEL — DSR apna PENDING order, admin koi bhi khula order (dispatch hua ho to stock wapas)
  router.post('/cancelOrder', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const reason = String(d.reason || '').trim();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query('SELECT * FROM ops_orders WHERE oid=? FOR UPDATE', [String(d.oid)]);
      if (!row) { await conn.rollback(); return err('Order nahi mila'); }
      if (row.status === 'DELIVERED' || row.status === 'CANCELLED') { await conn.rollback(); return err(`Closed order (${row.status}) cancel nahi ho sakta`); }
      if (!isAdmin(u)) {
        if (row.dsr_mobile !== u.mob) { await conn.rollback(); return err('Ye aapka order nahi hai'); }
        if (row.status !== 'PENDING') { await conn.rollback(); return err('Confirm hone ke baad cancel ke liye office se baat karo'); }
      }
      const lines = JSON.parse(row.items_json || '[]');
      if (STOCK_OUT.has(row.status)) await adjustStock(conn, lines, +1, row.oid + ' (cancel wapas)', u.name);
      let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
      hist.push({ s: 'CANCELLED', t: nowIST().dmyhm, by: u.name, note: reason });
      await conn.query('UPDATE ops_orders SET status=\'CANCELLED\', cancel_reason=?, history_json=?, updated_at=NOW() WHERE id=?', [reason, J(hist), row.id]);
      await conn.commit();
      return J({ ok: true, status: 'CANCELLED' });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }));
  router.post('/getOrders', requireOps, rpc(async (u) => ordersFor(u)));

  // sign -1 = minus (dispatch), +1 = wapas. Error string ya null.
  async function adjustStock(conn, lines, sign, ref, by) {
    if (sign < 0) {
      const short = [];
      for (const l of lines) {
        const [[it]] = await conn.query('SELECT stock FROM ops_items WHERE code=? FOR UPDATE', [l.code]);
        if (!it) return 'Item nahi mila: ' + l.code;
        if ((it.stock | 0) < l.qty) short.push(`${l.name} (hai ${it.stock | 0}, chahiye ${l.qty})`);
      }
      if (short.length) return 'Stock kam hai: ' + short.join('; ');
    }
    for (const l of lines) {
      const [[it]] = await conn.query('SELECT * FROM ops_items WHERE code=? FOR UPDATE', [l.code]);
      if (!it) continue;
      const prev = it.stock | 0, after = prev + sign * l.qty;
      await conn.query('UPDATE ops_items SET stock=?, updated_at=NOW() WHERE id=?', [after, it.id]);
      await log(conn, sign < 0 ? 'OUT' : 'IN', l.code, l.name, l.qty, prev, after, (sign < 0 ? 'Dispatch ' : 'Return ') + ref, by);
    }
    return null;
  }

  // Status update — admin. DISPATCHED par stock minus; dispatch ke baad cancel/undo par wapas.
  router.post('/updateOrderStatus', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const st = String(d.status || '').toUpperCase();
    if (!STATUSES.includes(st)) return err('Status galat');
    const conn = await db.getConnection();
    let order, lines;
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.query('SELECT * FROM ops_orders WHERE oid=? FOR UPDATE', [String(d.oid)]);
      if (!row) { await conn.rollback(); return err('Order nahi mila'); }
      const cur = row.status;
      if (cur === st) {
        // Same status = sirf details save (invoice no, vehicle, driver, terms) — history nahi, WhatsApp nahi
        const inv0 = (d.inv !== undefined && d.inv !== '') ? String(d.inv) : row.invoice_no;
        const veh0 = (d.vehicle !== undefined && d.vehicle !== '') ? String(d.vehicle) : row.vehicle;
        const drv0 = clean(d.driverMob).length === 10 ? clean(d.driverMob) : (row.driver_mobile || '');
        const terms0 = (d.paymentTerms !== undefined && d.paymentTerms !== '') ? String(d.paymentTerms).trim() : row.payment_terms;
        const days0 = termsDays(terms0);
        const dueSql0 = (cur === 'DELIVERED' && days0 !== null) ? `DATE_ADD(DATE(COALESCE(delivered_at, NOW())), INTERVAL ${days0} DAY)` : 'payment_due';
        await conn.query(`UPDATE ops_orders SET invoice_no=?, vehicle=?, driver_mobile=?, payment_terms=?, payment_due=${dueSql0}, updated_at=NOW() WHERE id=?`, [inv0, veh0, drv0, terms0, row.id]);
        await conn.commit();
        if (d.pod && d.pod.b64) { try { await saveOrderFile(row.oid, 'pod', d.pod, u.name); } catch (e) { console.error('ops pod', e.message); } }
        return J({ ok: true, status: cur, saved: true });
      }
      if (cur === 'DELIVERED' || cur === 'CANCELLED') { await conn.rollback(); return err(`Closed order (${cur}) change nahi ho sakta`); }
      lines = JSON.parse(row.items_json || '[]');
      // Flow: PENDING -> CONFIRMED (CRM) -> BILLED (bill + maal nikla: stock minus, party/driver ko msg)
      //       -> DELIVERED -> payment. DISPATCHED purana status hai (BILLED jaisa hi maana jaata hai).
      const stockOut = STOCK_OUT.has(cur);
      if (STOCK_OUT.has(st) && !stockOut) { const e1 = await adjustStock(conn, lines, -1, row.oid, u.name); if (e1) { await conn.rollback(); return err(e1); } }
      if (st === 'CANCELLED' && stockOut) await adjustStock(conn, lines, +1, row.oid + ' (cancel wapas)', u.name);
      if ((st === 'PENDING' || st === 'CONFIRMED') && stockOut) await adjustStock(conn, lines, +1, row.oid + ' (undo billing)', u.name);
      let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
      hist.push({ s: st, t: nowIST().dmyhm, by: u.name });
      const f = pickTransportFields(d, row);
      // Payment terms billing/delivery form se bhi aa sakte hain
      const terms = (d.paymentTerms !== undefined && d.paymentTerms !== '') ? String(d.paymentTerms).trim() : row.payment_terms;
      // DELIVERED par delivered_at + payment due (terms ke din jod kar)
      const days = termsDays(terms);
      const dueSql = st === 'DELIVERED' && days !== null ? `DATE_ADD(CURRENT_DATE, INTERVAL ${days} DAY)` : (st === 'DELIVERED' ? 'NULL' : 'payment_due');
      const delSql = st === 'DELIVERED' ? 'NOW()' : 'delivered_at';
      const billSql = (STOCK_OUT.has(st) && !stockOut) ? 'NOW()' : 'billed_at';
      await conn.query(`UPDATE ops_orders SET status=?, invoice_no=?, vehicle=?, driver_mobile=?, driver_name=?, transporter=?, lr_no=?, payment_terms=?, history_json=?, payment_due=${dueSql}, delivered_at=${delSql}, billed_at=${billSql}, updated_at=NOW() WHERE id=?`,
        [st, f.inv, f.veh, f.drv, f.drvName, f.transporter, f.lr, terms, J(hist), row.id]);
      await conn.commit();
      order = { ...row, status: st, invoice_no: f.inv, vehicle: f.veh, driver_mobile: f.drv, driver_name: f.drvName, transporter: f.transporter, lr_no: f.lr, payment_terms: terms };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

    // POD (delivery proof photo) DELIVERED ke saath aaye to file me rakho
    if (st === 'DELIVERED' && d.pod && d.pod.b64) {
      try { await saveOrderFile(order.oid, 'pod', d.pod, u.name); } catch (e) { console.error('ops pod', e.message); }
    }
    // WhatsApp — BILLED: party ko driver/vehicle detail, driver ko party detail + location, DSR ko.
    // DELIVERED: party + DSR. (driver ko ek hi baar — DRIVER key se dedupe)
    (async () => {
      if (STOCK_OUT.has(st) || st === 'DELIVERED') await notifyOrderStatus(order);
      if (STOCK_OUT.has(st) && order.driver_mobile) await notifyDriver(order, lines, order.driver_mobile);
    })().catch(e => console.error('ops wa', e.message));
    return J({ ok: true, status: st });
  }));
  // Billing/transport fields: form se aaye to wahi, warna order ka purana
  function pickTransportFields(d, row) {
    const s = (v, old) => (v !== undefined && v !== '' && v !== null) ? String(v).trim() : (old || '');
    return {
      inv: s(d.inv, row.invoice_no), veh: s(d.vehicle, row.vehicle),
      drv: clean(d.driverMob).length === 10 ? clean(d.driverMob) : (row.driver_mobile || ''),
      drvName: s(d.driverName, row.driver_name), transporter: s(d.transporter, row.transporter), lr: s(d.lrNo, row.lr_no),
    };
  }
  // Party ko jaane wala "kaise aa raha hai" text — template ke vehicle param me
  function transportText(r) {
    const p = [];
    if (r.vehicle) p.push(r.vehicle);
    if (r.transporter) p.push('Transport: ' + r.transporter);
    if (r.driver_name || r.driver_mobile) p.push('Driver: ' + [r.driver_name, r.driver_mobile].filter(Boolean).join(' '));
    if (r.lr_no) p.push('LR ' + r.lr_no);
    return p.join(' · ');
  }

  // ── Delivery/transport info EDIT (BILLED / DELIVERED par): LR no, vehicle, driver, transporter, invoice.
  // Badalne par party ko naya detail WhatsApp; naya driver ho to use bhi.
  router.post('/editDeliveryInfo', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[row]] = await db.query('SELECT * FROM ops_orders WHERE oid=?', [String(d.oid)]);
    if (!row) return err('Order nahi mila');
    if (!STOCK_OUT.has(row.status) && row.status !== 'DELIVERED') return err('Billing ke baad hi delivery info edit hoti hai');
    const f = pickTransportFields(d, row);
    const changed = f.inv !== row.invoice_no || f.veh !== row.vehicle || f.drv !== row.driver_mobile || f.drvName !== row.driver_name || f.transporter !== row.transporter || f.lr !== row.lr_no;
    let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
    if (changed) hist.push({ s: 'INFO', t: nowIST().dmyhm, by: u.name, note: transportText({ vehicle: f.veh, transporter: f.transporter, driver_name: f.drvName, driver_mobile: f.drv, lr_no: f.lr }) });
    await db.query('UPDATE ops_orders SET invoice_no=?, vehicle=?, driver_mobile=?, driver_name=?, transporter=?, lr_no=?, history_json=?, updated_at=NOW() WHERE id=?',
      [f.inv, f.veh, f.drv, f.drvName, f.transporter, f.lr, J(hist), row.id]);
    const order = { ...row, invoice_no: f.inv, vehicle: f.veh, driver_mobile: f.drv, driver_name: f.drvName, transporter: f.transporter, lr_no: f.lr };
    if (changed && d.notify !== false) {
      (async () => {
        const dmob = wati.watiMob(order.dealer_mobile);
        const stamp = Date.now();
        if (dmob) await logged(`DISPU|${order.oid}|${dmob}|${stamp}`, 'DISPATCH_UPDATE', order.oid, dmob, wati.T.DISPATCH, [order.dealer_name, order.oid, order.total_qty | 0, transportText(order) || 'update']);
        if (order.driver_mobile && order.driver_mobile !== row.driver_mobile) await notifyDriver(order, JSON.parse(row.items_json || '[]'), order.driver_mobile);
      })().catch(e => console.error('ops wa', e.message));
    }
    return J({ ok: true, changed });
  }));

  // ── Order files: Busy invoice (PDF/photo) aur POD. Ek order par har kind ki ek file.
  // Drive par bhi bhejne ki koshish (agar APPS_SCRIPT_UPLOAD_URL + OPS_DRIVE_FOLDER_ID set hon).
  async function saveOrderFile(oid, kind, f, by) {
    const mime = f.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
    const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
    const name = `${oid}_${kind.toUpperCase()}_${nowIST().iso.replace(/-/g, '')}.${ext}`;
    const buf = Buffer.from(f.b64, 'base64');
    const driveUrl = await pushToDrive(name, mime, f.b64, kind);
    await db.query(
      `INSERT INTO ops_order_files (oid,kind,file_name,mime,data,drive_url,uploaded_by) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE file_name=VALUES(file_name), mime=VALUES(mime), data=VALUES(data), drive_url=VALUES(drive_url), uploaded_by=VALUES(uploaded_by), uploaded_at=NOW()`,
      [oid, kind, name, mime, buf, driveUrl, by]);
    return { name, driveUrl };
  }
  // Drive: apni Apps Script web app (docs/apps-script-drive) — owner ke Drive me
  // "Michelin Ops - Files/<sub>" me file. Env: OPS_DRIVE_SCRIPT_URL + OPS_DRIVE_SECRET.
  // Config na ho to chup-chaap '' (file DB me to hai hi).
  async function pushToDrive(fileName, mime, b64, sub) {
    const url = process.env.OPS_DRIVE_SCRIPT_URL, secret = process.env.OPS_DRIVE_SECRET;
    if (!url || !secret) return '';
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, action: 'upload', sub, fileName, mimeType: mime, dataBase64: b64 }), redirect: 'follow' });
      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch (_) { throw new Error('script ne JSON nahi diya — editor me authorize() ek baar chalao'); }
      if (!data.ok) throw new Error(data.error || 'upload fail');
      return data.url || (data.fileId ? `https://drive.google.com/file/d/${data.fileId}/view` : '');
    } catch (e) { console.error('ops drive', e.message); return ''; }
  }
  // Admin check: WhatsApp (Wati) setup — token sahi hai? kaunse templates approved hain?
  router.post('/watiCheck', requireOps, adminOnly, rpc(async () => J({ ok: true, ...(await wati.check()) })));
  // Admin check: Drive setup chal raha hai ya nahi
  router.post('/driveCheck', requireOps, adminOnly, rpc(async () => {
    const url = process.env.OPS_DRIVE_SCRIPT_URL, secret = process.env.OPS_DRIVE_SECRET;
    if (!url || !secret) return J({ ok: false, error: 'OPS_DRIVE_SCRIPT_URL / OPS_DRIVE_SECRET env set nahi' });
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, action: 'ping' }), redirect: 'follow' });
      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch (_) { return J({ ok: false, error: 'Script authorize nahi hua — Apps Script editor me authorize() chalao' }); }
      return J(data);
    } catch (e) { return err(e.message); }
  }));
  router.post('/uploadOrderFile', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    if (!['invoice', 'pod'].includes(d.kind)) return err('Kind galat (invoice / pod)');
    if (!d.b64) return err('File nahi mili');
    const [[row]] = await db.query('SELECT oid, dsr_mobile FROM ops_orders WHERE oid=?', [String(d.oid)]);
    if (!row) return err('Order nahi mila');
    if (d.kind === 'invoice' && !isAdmin(u)) return err('Invoice sirf office upload karta hai');
    if (!isAdmin(u) && row.dsr_mobile !== u.mob) return err('Ye aapka order nahi hai');
    const r = await saveOrderFile(row.oid, d.kind, d, u.name);
    return J({ ok: true, file: r.name, drive: r.driveUrl });
  }));
  router.get('/order-file/:oid/:kind', requireOps, async (req, res) => {
    try {
      const [[r]] = await db.query('SELECT file_name, mime, data, drive_url FROM ops_order_files WHERE oid=? AND kind=?', [req.params.oid, req.params.kind]);
      if (!r) return res.status(404).send('File nahi mili');
      if (!r.data && r.drive_url) return res.redirect(r.drive_url);
      res.setHeader('Content-Type', r.mime);
      res.setHeader('Content-Disposition', `inline; filename="${r.file_name}"`);
      res.send(r.data);
    } catch (e) { res.status(500).send('Server error'); }
  });
  // Payment mila / nahi mila — admin
  router.post('/markPaid', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[row]] = await db.query('SELECT id, history_json FROM ops_orders WHERE oid=?', [String(d.oid)]);
    if (!row) return err('Order nahi mila');
    const paid = d.paid !== false;
    let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
    hist.push({ s: paid ? 'PAID' : 'UNPAID', t: nowIST().dmyhm, by: u.name });
    await db.query(`UPDATE ops_orders SET payment_status=?, paid_at=${paid ? 'NOW()' : 'NULL'}, history_json=?, updated_at=NOW() WHERE id=?`, [paid ? 'PAID' : 'PENDING', J(hist), row.id]);
    // Payment aayi -> party + DSR ko "payment mil gayi" WhatsApp (baaki = us dealer ke bache unpaid orders)
    if (paid) {
      (async () => {
        const [[o]] = await db.query('SELECT * FROM ops_orders WHERE id=?', [row.id]);
        const [[rest]] = await db.query(`SELECT COALESCE(SUM(amount),0) AS a FROM ops_orders WHERE did=? AND status='DELIVERED' AND payment_status<>'PAID'`, [o.did]);
        const vals = [o.dealer_name, Math.round(Number(o.amount)), Math.round(Number(rest.a)), nowIST().dmy];
        const dmob = wati.watiMob(o.dealer_mobile), dsrMob = wati.watiMob(o.dsr_mobile);
        if (dmob) await logged(`PAID|${o.oid}|${dmob}`, 'PAYMENT', o.oid, dmob, wati.T.PAYMENT, vals);
        if (dsrMob) await logged(`PAID|${o.oid}|${dsrMob}`, 'PAYMENT', o.oid, dsrMob, wati.T.PAYMENT, vals);
      })().catch(e => console.error('ops wa', e.message));
    }
    return J({ ok: true, payStatus: paid ? 'PAID' : 'PENDING' });
  }));
  // Pichle drivers/vehicles — status form me dropdown ke liye (baar-baar type na karna pade)
  router.post('/getDrivers', requireOps, rpc(async () => {
    const [rows] = await db.query(`SELECT driver_mobile AS mob, MAX(vehicle) AS vehicle, COUNT(*) AS n, MAX(updated_at) AS last FROM ops_orders WHERE driver_mobile<>'' GROUP BY driver_mobile ORDER BY last DESC LIMIT 20`);
    return rows.map(r => ({ mob: r.mob, vehicle: r.vehicle || '', n: r.n }));
  }));

  // CRM confirm: PENDING -> CONFIRMED, qty/rate/terms edit ke saath; dealer ko WhatsApp
  router.post('/confirmOrderCRM', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[row]] = await db.query('SELECT * FROM ops_orders WHERE oid=?', [String(d.oid)]);
    if (!row) return err('Order nahi mila');
    if (row.status !== 'PENDING') return err(`Sirf PENDING order confirm ho sakta hai (abhi: ${row.status})`);
    const itemsIn = d.items || []; if (!itemsIn.length) return err('Kam se kam 1 item hona chahiye');
    const b = buildLines(itemsIn, await itemInv()); if (b.error) return err(b.error);
    const terms = String(d.paymentTerms || '').trim();
    let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
    hist.push({ s: 'CONFIRMED', t: nowIST().dmyhm, by: u.name });
    await db.query('UPDATE ops_orders SET items_json=?, total_qty=?, amount=?, status=\'CONFIRMED\', payment_terms=?, history_json=?, updated_at=NOW() WHERE id=?',
      [J(b.lines), b.qty, b.amt, terms, J(hist), row.id]);
    const dmob = clean(row.dealer_mobile);
    if (dmob) logged(`CONF|${row.oid}|${wati.watiMob(dmob)}`, 'CONFIRMED', row.oid, dmob, wati.T.CONFIRMED, [row.dealer_name, row.oid, `${b.qty} pcs, ${wati.fmtR(b.amt)}`, terms || 'Standard']).catch(() => {});
    return J({ ok: true, oid: row.oid, qty: b.qty, amount: b.amt });
  }));

  // ══════════ DASHBOARD ══════════
  router.post('/getDashboard', requireOps, rpc(async (u) => {
    const items = await itemsList(), orders = await ordersFor(u);
    const s = { totalStock: 0, items: items.length, outOfStock: 0, lowStock: 0, pending: 0, billed: 0, dispatched: 0, todayOrders: 0, todayQty: 0, monthQty: 0, monthAmt: 0, low: [] };
    const today = nowIST().dmy, mk = today.slice(3);
    for (const it of items) {
      s.totalStock += it.stock; if (it.stock === 0) s.outOfStock++; else if (it.stock <= LOW_STOCK) s.lowStock++;
      if (it.stock <= LOW_STOCK && it.seg !== 'OT') s.low.push(it);
    }
    s.low.sort((a, b) => a.stock - b.stock); s.low = s.low.slice(0, 15);
    for (const o of orders) {
      if (o.status === 'PENDING') s.pending++; if (o.status === 'BILLED') s.billed++; if (o.status === 'DISPATCHED' || o.status === 'BILLED') s.dispatched++;
      if (o.status === 'CANCELLED') continue;
      if (o.date === today) { s.todayOrders++; s.todayQty += o.qty; }
      if (o.date.slice(3) === mk) { s.monthQty += o.qty; s.monthAmt += o.amount; }
    }
    return J({ ok: true, user: { mob: u.mob, name: u.name, role: u.role }, s });
  }));

  // ══════════ KYC ══════════
  const DOC_KEYS = ['gst', 'pan', 'aadhaar', 'cheque'];
  router.post('/uploadKyc', requireOps, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[dl]] = await db.query('SELECT * FROM ops_dealers WHERE did=?', [String(d.did)]);
    if (!dl) return err('Dealer nahi mila');
    const saved = [];
    for (const f of (d.files || [])) {
      if (!DOC_KEYS.includes(f.key) || !f.b64) continue;
      const mime = f.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
      const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
      const stamp = nowIST().iso.replace(/-/g, '') + '_' + pad(nowIST().hour) + pad(nowIST().minute);
      const name = `${dl.did}_${f.key.toUpperCase()}_${stamp}.${ext}`;
      const buf = Buffer.from(f.b64, 'base64');
      await db.query(
        `INSERT INTO ops_dealer_docs (dealer_id,doc_key,file_name,mime,data,drive_url) VALUES (?,?,?,?,?,'')
         ON DUPLICATE KEY UPDATE file_name=VALUES(file_name), mime=VALUES(mime), data=VALUES(data), drive_url='', uploaded_at=NOW()`,
        [dl.id, f.key, name, mime, buf]);
      saved.push(f.key);
    }
    const sets = [], vals = [];
    if (d.gstNo !== undefined) { sets.push('gst_no=?'); vals.push(String(d.gstNo).toUpperCase()); }
    if (d.pan !== undefined) { sets.push('pan=?'); vals.push(String(d.pan).toUpperCase()); }
    const [[cnt]] = await db.query('SELECT COUNT(*) AS n FROM ops_dealer_docs WHERE dealer_id=?', [dl.id]);
    const kyc = cnt.n === 4 ? 'COMPLETE' : `${cnt.n}/4`;
    sets.push('kyc_status=?'); vals.push(kyc); vals.push(dl.id);
    await db.query(`UPDATE ops_dealers SET ${sets.join(', ')} WHERE id=?`, vals);
    return J({ ok: true, saved, kyc });
  }));
  // Document dekhna: /api/ops/kyc/D-002/gst
  router.get('/kyc/:did/:key', requireOps, async (req, res) => {
    try {
      const [[r]] = await db.query(
        'SELECT d.file_name, d.mime, d.data, d.drive_url FROM ops_dealer_docs d JOIN ops_dealers x ON x.id=d.dealer_id WHERE x.did=? AND d.doc_key=?',
        [req.params.did, req.params.key]);
      if (!r) return res.status(404).send('Document nahi mila');
      if (!r.data && r.drive_url) return res.redirect(r.drive_url);
      res.setHeader('Content-Type', r.mime);
      res.setHeader('Content-Disposition', `inline; filename="${r.file_name}"`);
      res.send(r.data);
    } catch (e) { res.status(500).send('Server error'); }
  });

  // ══════════ RM REPORTS ══════════
  router.post('/getRMs', requireOps, rpc(async () => {
    const [rows] = await db.query('SELECT name, mobile, company, role FROM ops_rm_list ORDER BY id');
    return rows.map(r => ({ name: r.name, mob: clean(r.mobile), company: r.company || '', role: r.role || '' }));
  }));

  // Report ka text banao (preview + send dono isi se). Admin bhejne se pehle
  // text dekh aur badal sakta hai — sendRMReport me `text` aaye to wahi jaata hai.
  // YYYY-MM-DD hi maano, warna null
  const isoD = v => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
  // Michelin ke chaar segment (Scooter / Motorcycle / Royal Enfield / Car) — stock/reorder
  // report me isi order me heading ke saath. VK waghera me segment nahi, seedhi list.
  const SEG_ORDER = ['SC', 'MC', 'RE', 'PC'], SEG_NAME = { SC: 'Scooter', MC: 'Motorcycle', RE: 'Royal Enfield', PC: 'Car' };
  const itemLabel = it => `${it.size}${it.position ? ' ' + it.position : ''} ${it.pattern} ${it.tltt}`.replace(/\s+/g, ' ').trim();
  function segLines(items, lineOf) {
    const bySeg = {}; items.forEach(it => { const sg = SEG_NAME[it.segment] ? it.segment : '_'; (bySeg[sg] = bySeg[sg] || []).push(lineOf(it)); });
    const segs = SEG_ORDER.filter(sg => bySeg[sg]).concat(bySeg._ ? ['_'] : []);
    if (segs.length <= 1) return items.map(lineOf); // ek hi segment (ya VK) — heading ki zaroorat nahi
    const out = []; segs.forEach(sg => { out.push(`[${SEG_NAME[sg] || 'Other'}]`); bySeg[sg].forEach(l => out.push(l)); });
    return out;
  }
  async function buildRMReport(rm, type, from, to) {
    if (type === 'STOCK') {
      // Current stock — us company ke sab items jinka stock > 0, segment-wise, zyada se kam
      const [items] = await db.query('SELECT * FROM ops_items WHERE UPPER(brand)=? AND stock>0 ORDER BY stock DESC, id', [String(rm.company).toUpperCase()]);
      if (!items.length) return { error: `${rm.company} ka koi stock nahi hai abhi` };
      let total = 0; items.forEach(it => { total += it.stock | 0; });
      const lines = segLines(items, it => `${itemLabel(it)}: ${it.stock}`);
      const shown = lines.slice(0, 48);
      return { count: items.length, text: `Current stock: ${items.length} items, ${total} pcs\n${shown.join('\n')}${lines.length > shown.length ? `\n...aur ${lines.length - shown.length} items` : ''}` };
    }
    if (type === 'REORDER') {
      const [items] = await db.query('SELECT * FROM ops_items WHERE UPPER(brand)=? AND stock<=? ORDER BY stock, id LIMIT 30', [String(rm.company).toUpperCase(), LOW_STOCK]);
      if (!items.length) return { error: `Koi item low/out of stock nahi hai ${rm.company} mein abhi` };
      const lines = segLines(items, it => `${itemLabel(it)}: ${it.stock} bacha`);
      return { count: items.length, text: `${items.length} items low/out of stock:\n${lines.join('\n')}` };
    }
    if (type === 'OUTSTANDING') {
      // Busy "Amount Receivable" import se — sab dealers ka bakaya, zyada se kam (brand-wise alag nahi hota)
      const [rows] = await db.query('SELECT dealer_name, amount, as_on FROM ops_outstanding WHERE amount>0 ORDER BY amount DESC');
      if (!rows.length) return { error: 'Outstanding data nahi hai — pehle Busy "Amount Receivable" import karo (Stock/Reports → Busy Import)' };
      let total = 0; rows.forEach(r => { total += Number(r.amount) || 0; });
      const asOn = rows[0].as_on || nowIST().dmy;
      const lines = rows.map(r => `${r.dealer_name}: ${wati.fmtR(r.amount)}`);
      const shown = lines.slice(0, 30);
      return { count: rows.length, range: asOn, text: `Outstanding (as on ${asOn}): ${rows.length} accounts, total ${wati.fmtR(total)}\n${shown.join('\n')}${lines.length > shown.length ? `\n...aur ${lines.length - shown.length} accounts` : ''}` };
    }
    if (type === 'SALE') {
      // Date range (default aaj). from/to YYYY-MM-DD
      const f = isoD(from) || nowIST().iso, t = isoD(to) || f;
      const [orders] = await db.query(`SELECT items_json FROM ops_orders WHERE order_date BETWEEN ? AND ? AND status<>'CANCELLED'`, [f, t]);
      const rangeTxt = f === t ? dmyOf(f) : `${dmyOf(f)} - ${dmyOf(t)}`;
      let qty = 0, amt = 0, count = 0; const byItem = {};
      for (const o of orders) {
        let lines = []; try { lines = JSON.parse(o.items_json || '[]'); } catch (_) {}
        let has = false;
        for (const l of lines) {
          const code = String(l.code || '');
          const isVK = code.startsWith('VK-'), isMich = /^(SC|MC|RE|PC)-/.test(code);
          if ((rm.company === 'VK' && isVK) || (rm.company === 'Michelin' && isMich)) {
            has = true; qty += parseInt(l.qty, 10) || 0; amt += parseFloat(l.amount) || 0;
            byItem[l.name] = (byItem[l.name] || 0) + (parseInt(l.qty, 10) || 0);
          }
        }
        if (has) count++;
      }
      // Zero sale bhi ek report hai — khali box ki jagah saaf message
      if (!count) return { count: 0, range: rangeTxt, text: `Sales ${rangeTxt}: koi ${rm.company} order nahi hua. 0 orders, 0 pcs, ₹0.` };
      const itemLines = Object.keys(byItem).map(k => `${k}: ${byItem[k]} pcs`);
      return { count, range: rangeTxt, text: `Sales ${rangeTxt}: ${count} orders, ${qty} pcs, ${wati.fmtR(amt)}.\nItems:\n${itemLines.join('\n')}` };
    }
    return { error: 'Type galat — SALE, REORDER, STOCK ya OUTSTANDING hona chahiye' };
  }
  // WhatsApp template params me newline / tab / 4+ space allowed NAHI hain (Meta reject
  // karta hai) aur poora message ~1024 akshar. Isliye bhejne se pehle ek line banao.
  function waParam(text, max) {
    return String(text || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join(' | ').replace(/\s{2,}/g, ' ').slice(0, max || 900);
  }
  router.post('/previewRMReport', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[rm]] = await db.query('SELECT * FROM ops_rm_list WHERE mobile=?', [clean(d.rmMob)]);
    if (!rm) return err('RM nahi mila');
    const r = await buildRMReport(rm, String(d.type || '').toUpperCase(), d.from, d.to);
    if (r.error) return err(r.error);
    return J({ ok: true, text: r.text, count: r.count, rm: rm.name, company: rm.company, date: r.range || nowIST().dmy, waLen: waParam(r.text, 100000).length });
  }));
  router.post('/sendRMReport', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[rm]] = await db.query('SELECT * FROM ops_rm_list WHERE mobile=?', [clean(d.rmMob)]);
    if (!rm) return err('RM nahi mila');
    const type = String(d.type || '').toUpperCase();
    if (!['SALE', 'REORDER', 'STOCK', 'OUTSTANDING'].includes(type)) return err('Type galat — SALE, REORDER, STOCK ya OUTSTANDING hona chahiye');
    let text = String(d.text || '').trim(), count = 0, dateTxt = nowIST().dmy;
    if (!text) { const r = await buildRMReport(rm, type, d.from, d.to); if (r.error) return err(r.error); text = r.text; count = r.count; if (r.range) dateTxt = r.range; }
    else if (type === 'SALE') { const f = isoD(d.from), t = isoD(d.to) || f; if (f) dateTxt = f === t ? dmyOf(f) : `${dmyOf(f)} - ${dmyOf(t)}`; }
    const label = { SALE: 'Sales', REORDER: 'Reorder', STOCK: 'Stock', OUTSTANDING: 'Outstanding' }[type];
    const res = await wati.send(rm.mobile, wati.T.RM_REPORT, [label, rm.company, waParam(text), dateTxt]);
    if (res !== 'SENT') return err('Message send nahi hua: ' + res);
    return J({ ok: true, sentTo: rm.name, count });
  }));

  // ══════════ BUSY IMPORT (admin) ══════════
  // body: { name: 'StockStatus.xlsx', b64: '<xlsx base64>' }
  router.post('/importBusy', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    if (!d.b64) return err('File nahi mili');
    const r = await busy.importBusyBuffer(db, Buffer.from(d.b64, 'base64'), String(d.name || 'upload.xlsx'), nowIST().dmy, String(d.kind || '').toUpperCase());
    // Payment aayi ho to dealer/DSR ko turant bata do
    scanPayments().catch(() => {});
    return J({ ok: true, result: r.result, notes: r.notes });
  }));
  router.post('/getImportLog', requireOps, adminOnly, rpc(async () => {
    const [rows] = await db.query(`SELECT ${FMT('log_time')} AS time, file_name AS file, result, notes FROM ops_import_log ORDER BY id DESC LIMIT 50`);
    return rows;
  }));
  router.post('/getPaymentLog', requireOps, adminOnly, rpc(async () => {
    const [rows] = await db.query(`SELECT ${FMT('log_time')} AS time, dealer_name AS dealer, amount_paid AS paid, old_outstanding AS oldBal, new_outstanding AS newBal, as_on AS asOn, notified FROM ops_payment_log ORDER BY id DESC LIMIT 100`);
    return rows;
  }));

  // ══════════ WHATSAPP (Wati.gs) ══════════
  // ops_notif_log dedupe: key = event|oid|number. SENT ho to dobara nahi;
  // fail ho to "FAIL:.. #n" — MAX_RETRY tak scanner phir try karta hai.
  async function notifStatus(key) {
    const [r] = await db.query('SELECT status FROM ops_notif_log WHERE notif_key=?', [key]);
    return r[0] ? String(r[0].status) : '';
  }
  async function mark(key, event, oid, to, status) {
    await db.query(
      `INSERT INTO ops_notif_log (notif_key,event,oid,to_number,status,log_time) VALUES (?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE status=VALUES(status), log_time=NOW()`, [key, event, oid, to, status.slice(0, 120)]);
  }
  // Ek logged send: pehle status dekho, bhejo, result likho.
  async function logged(key, event, oid, to, template, vals) {
    const st = await notifStatus(key);
    if (st === 'SENT' || wati.retryCount(st) >= wati.MAX_RETRY) return st;
    const res = await wati.send(to, template, vals);
    const status = res === 'SENT' ? 'SENT' : `${res} #${wati.retryCount(st) + 1}`;
    await mark(key, event, oid, wati.watiMob(to) || to, status);
    return status;
  }

  // Naya order: office numbers (env) + CRM role wale users (Masters > Users me role CRM)
  async function newOrderNumbers() {
    const nums = new Set(wati.NOTIFY_NUMBERS);
    try {
      const [rows] = await db.query(`SELECT mobile FROM ops_users WHERE active=1 AND UPPER(role) IN ('CRM','ADMIN')`);
      for (const r of rows) { const m = wati.watiMob(r.mobile); if (m) nums.add(m); }
    } catch (_) {}
    return [...nums];
  }
  async function notifyNewOrder(o) {
    for (const num of await newOrderNumbers()) {
      await logged(`NEW|${o.oid}|${num}`, 'NEW_ORDER', o.oid, num, wati.T.NEW_ORDER, [o.dname, o.city, o.dsr, o.qty, o.amount, o.oid]);
    }
  }
  // BILLED/DISPATCHED: party ko (vehicle/driver/LR detail ke saath) + DSR. DELIVERED: party + DSR.
  async function notifyOrderStatus(r) {
    const status = String(r.status).toUpperCase();
    const dmob = wati.watiMob(r.dealer_mobile), dsrMob = wati.watiMob(r.dsr_mobile);
    const oid = r.oid, qty = r.total_qty | 0, veh = transportText(r);
    if (STOCK_OUT.has(status) || status === 'DELIVERED') {
      if (dmob) await logged(`DISP|${oid}|${dmob}`, 'DISPATCH', oid, dmob, wati.T.DISPATCH, [r.dealer_name, oid, qty, veh || 'jaldi update hoga']);
      if (dsrMob) await logged(`DISP_DSR|${oid}|${dsrMob}`, 'DISPATCH_DSR', oid, dsrMob, wati.T.DISPATCH_DSR, [r.dealer_name, oid, qty, veh || '-']);
    }
    if (status === 'DELIVERED') {
      if (dsrMob) await logged(`DELV_DSR|${oid}|${dsrMob}`, 'DELIVERED_DSR', oid, dsrMob, wati.T.DELIVERED_DSR, [r.dealer_name, oid, qty]);
      if (dmob) await logged(`DELV_DLR|${oid}|${dmob}`, 'DELIVERED_DLR', oid, dmob, wati.T.DELIVERED_DLR, [r.dealer_name, oid, qty]);
    }
  }
  async function notifyDriver(r, lines, driverMob) {
    if (driverMob.length !== 10) return;
    const [[dl]] = await db.query('SELECT lat, lng FROM ops_dealers WHERE did=?', [r.did]);
    const gps = dl && dl.lat && dl.lng ? `https://maps.google.com/?q=${dl.lat},${dl.lng}` : '';
    const items = lines.map(l => `${l.name} x${l.qty}`).join(', ');
    const [[dl2]] = await db.query('SELECT address, city FROM ops_dealers WHERE did=?', [r.did]);
    const addr = [dl2 && dl2.address, dl2 && dl2.city || r.city].filter(Boolean).join(', ');
    await logged(`DRIVER|${r.oid}|${wati.watiMob(driverMob)}`, 'DRIVER', r.oid, driverMob, wati.T.DRIVER,
      [r.dealer_name, addr || r.city || '-', clean(r.dealer_mobile) || '-', items, gps || 'GPS nahi hai']);
  }

  // Har 5 min: pichle 30 din ke orders par NEW / DISP / DELV jo SENT nahi hue
  let _scanning = false;
  async function scanOrders() {
    if (_scanning || !wati.ENABLED) return; _scanning = true;
    try {
      const [rows] = await db.query(`SELECT * FROM ops_orders WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY id`);
      for (const r of rows) {
        if (r.status !== 'CANCELLED') await notifyNewOrder({ oid: r.oid, dname: r.dealer_name, city: r.city || '', dsr: r.dsr_name, qty: r.total_qty | 0, amount: Number(r.amount) || 0 });
        await notifyOrderStatus(r);
      }
    } catch (e) { console.error('ops scanOrders', e.message); } finally { _scanning = false; }
  }
  // Har 5 min: PAYMENT_LOG me jo notified='N' — dealer + DSR ko
  async function scanPayments() {
    if (!wati.ENABLED) return;
    const [rows] = await db.query(`SELECT * FROM ops_payment_log WHERE notified='N' ORDER BY id`);
    for (const p of rows) {
      let dmob = wati.watiMob(p.dealer_mobile), dsrMob = '';
      const [[dl]] = await db.query('SELECT mobile, added_by FROM ops_dealers WHERE UPPER(TRIM(name))=? LIMIT 1', [String(p.dealer_name).trim().toUpperCase()]);
      if (dl) {
        if (!dmob) dmob = wati.watiMob(dl.mobile);
        if (dl.added_by) {
          const [[us]] = await db.query('SELECT mobile FROM ops_users WHERE UPPER(TRIM(name))=? LIMIT 1', [String(dl.added_by).trim().toUpperCase()]);
          if (us) dsrMob = wati.watiMob(us.mobile);
        }
      }
      const vals = [p.dealer_name, Math.round(Number(p.amount_paid)), Math.round(Number(p.new_outstanding)), p.as_on || ''];
      let sentAny = false;
      if (dmob && await wati.send(dmob, wati.T.PAYMENT, vals) === 'SENT') sentAny = true;
      if (dsrMob && await wati.send(dsrMob, wati.T.PAYMENT, vals) === 'SENT') sentAny = true;
      if (sentAny) await db.query(`UPDATE ops_payment_log SET notified='Y' WHERE id=?`, [p.id]);
    }
  }
  // Roz 7pm IST: office ko din ka summary (ek hi baar — app_state me din likha jaata hai)
  async function dailySummary() {
    const now = nowIST();
    if (now.hour < 19 || !wati.ENABLED || !wati.NOTIFY_NUMBERS.length) return;
    const [[st]] = await db.query(`SELECT v FROM app_state WHERE k='ops_summary_last'`).catch(() => [[null]]);
    if (st && st.v === now.iso) return;
    await db.query(`INSERT INTO app_state (k,v) VALUES ('ops_summary_last',?) ON DUPLICATE KEY UPDATE v=VALUES(v)`, [now.iso]);
    const [[t]] = await db.query(`SELECT COUNT(*) AS n, COALESCE(SUM(total_qty),0) AS q FROM ops_orders WHERE order_date=CURRENT_DATE AND status<>'CANCELLED'`);
    const [[pend]] = await db.query(`SELECT COUNT(*) AS n FROM ops_orders WHERE status IN ('PENDING','BILLED')`);
    const [[disp]] = await db.query(`SELECT COUNT(*) AS n FROM ops_notif_log WHERE event='DISPATCH' AND status='SENT' AND DATE(log_time)=CURRENT_DATE`);
    for (const num of wati.NOTIFY_NUMBERS) await wati.send(num, wati.T.SUMMARY, [now.dmy, t.n, t.q, disp.n, pend.n]);
  }

  // Cron endpoint (serverless ke liye) + in-process scheduler
  let opsExtra = null; // neeche ops-extra se milta hai (Busy Drive sync)
  router.get('/cron', async (req, res) => {
    if (process.env.CRON_SECRET && req.query.key !== process.env.CRON_SECRET && req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Forbidden' });
    await scanOrders(); await scanPayments().catch(e => console.error('ops scanPayments', e.message)); await dailySummary().catch(e => console.error('ops summary', e.message));
    let drive = null;
    if (opsExtra && opsExtra.busyDriveSync) drive = await opsExtra.busyDriveSync('cron').catch(e => ({ ok: false, error: e.message }));
    res.json({ ok: true, drive });
  });
  if (!IS_SERVERLESS && wati.ENABLED) {
    setInterval(() => { scanOrders(); scanPayments().catch(e => console.error('ops scanPayments', e.message)); dailySummary().catch(e => console.error('ops summary', e.message)); }, 5 * 60 * 1000);
    console.log(`  ✅ Michelin Ops WhatsApp scanner started (har 5 min; office numbers: ${wati.NOTIFY_NUMBERS.length})`);
  } else if (!wati.ENABLED) {
    console.log('  ℹ️  Michelin Ops: WATI_BASE/WATI_TOKEN nahi — WhatsApp band, baaki app chalegi');
  }

  // v2 features (reports, attendance, route plan, expenses, payment reminders) —
  // alag file me, par same router aur same helpers par.
  opsExtra = require('./ops-extra')({
    router, db, requireOps, adminOnly, rpc, J, err, clean, nb, nowIST, dmyOf, FMT, isAdmin,
    ordersFor, orderByOid, logged, wati, pushToDrive, IS_SERVERLESS, scanPayments,
  }) || null;

  app.use('/api/ops', router);
};
