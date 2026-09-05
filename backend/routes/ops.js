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
  async function newOrderId() {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour12: false, year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = {}; for (const x of fmt.formatToParts(new Date())) p[x.type] = x.value;
    if (p.hour === '24') p.hour = '00';
    const base = `MO-${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
    let oid = base;
    for (let i = 2; i < 20; i++) {
      const [r] = await db.query('SELECT 1 FROM ops_orders WHERE oid=?', [oid]);
      if (!r.length) return oid;
      oid = `${base}-${i}`;
    }
    return oid;
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
  async function dealersList() {
    const [rows] = await db.query('SELECT * FROM ops_dealers WHERE active=1 ORDER BY id');
    const [docs] = await db.query('SELECT dealer_id, doc_key FROM ops_dealer_docs');
    const docMap = {};
    for (const d of docs) (docMap[d.dealer_id] = docMap[d.dealer_id] || []).push(d.doc_key);
    const out = await outstandingMap();
    return rows.map(r => {
      const mob = clean(r.mobile);
      return {
        did: r.did, name: r.name, mob, city: r.city || '', address: r.address || '', dsr: r.added_by || '',
        busy: r.busy_name || '', gstNo: r.gst_no || '', pan: r.pan || '', kyc: r.kyc_status || '',
        folder: r.kyc_folder || '', docs: docMap[r.id] || [], lat: r.lat || '', lng: r.lng || '',
        outstanding: out[mob] || out[nb(r.busy_name)] || out[nb(r.name)] || null,
      };
    });
  }
  router.post('/getDealers', requireOps, rpc(async () => dealersList()));

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
    await db.query('INSERT INTO ops_dealers (did,name,mobile,city,address,added_by,active,lat,lng) VALUES (?,?,?,?,?,?,1,?,?)',
      [did, name, mob, String(d.city || '').trim(), String(d.address || '').trim(), u.name, d.lat == null ? '' : String(d.lat), d.lng == null ? '' : String(d.lng)]);
    return J({ ok: true, did });
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
    const oid = await newOrderId();
    const now = nowIST();
    const hist = [{ s: 'PENDING', t: now.dmyhm, by: u.name }];
    await db.query(
      `INSERT INTO ops_orders (oid,order_date,dsr_name,dsr_mobile,did,dealer_name,dealer_mobile,city,items_json,total_qty,amount,status,note,history_json,created_at,updated_at)
       VALUES (?,CURRENT_DATE,?,?,?,?,?,?,?,?,?,'PENDING',?,?,NOW(),NOW())`,
      [oid, u.name, u.mob, dl.did, dl.name, clean(dl.mobile), dl.city || '', J(b.lines), b.qty, b.amt, String(d.note || ''), J(hist)]);
    // Office ko WhatsApp — turant; fail ho to 5-min scanner dobara try karega
    notifyNewOrder({ oid, dname: dl.name, city: dl.city || '', dsr: u.name, qty: b.qty, amount: b.amt }).catch(e => console.error('ops wa', e.message));
    return J({ ok: true, oid, qty: b.qty, amount: b.amt });
  }));

  function mapOrder(r) {
    let lines = [], hist = [];
    try { lines = JSON.parse(r.items_json || '[]'); } catch (_) {}
    try { hist = JSON.parse(r.history_json || '[]'); } catch (_) {}
    return {
      oid: r.oid, date: dmyOf(r.order_date), dsr: r.dsr_name, did: r.did, dname: r.dealer_name, dmob: clean(r.dealer_mobile),
      city: r.city || '', items: lines, qty: r.total_qty | 0, amount: Number(r.amount) || 0, status: r.status,
      inv: r.invoice_no || '', vehicle: r.vehicle || '', note: r.note || '', created: r.created, updated: r.updated,
      history: hist, terms: r.payment_terms || '',
    };
  }
  async function ordersFor(u) {
    const where = isAdmin(u) ? '' : ' WHERE dsr_mobile=?';
    const [rows] = await db.query(`SELECT *, ${FMT('created_at')} AS created, ${FMT('updated_at')} AS updated FROM ops_orders${where} ORDER BY id DESC LIMIT 300`, isAdmin(u) ? [] : [u.mob]);
    return rows.map(mapOrder);
  }
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
      if (cur === st) { await conn.rollback(); return err('Already ' + st); }
      if (cur === 'DELIVERED' || cur === 'CANCELLED') { await conn.rollback(); return err(`Closed order (${cur}) change nahi ho sakta`); }
      lines = JSON.parse(row.items_json || '[]');
      const wasDispatched = cur === 'DISPATCHED';
      if (st === 'DISPATCHED' && !wasDispatched) { const e1 = await adjustStock(conn, lines, -1, row.oid, u.name); if (e1) { await conn.rollback(); return err(e1); } }
      if (st === 'CANCELLED' && wasDispatched) await adjustStock(conn, lines, +1, row.oid + ' (cancel wapas)', u.name);
      if ((st === 'BILLED' || st === 'PENDING' || st === 'CONFIRMED') && wasDispatched) await adjustStock(conn, lines, +1, row.oid + ' (undo dispatch)', u.name);
      let hist = []; try { hist = JSON.parse(row.history_json || '[]'); } catch (_) {}
      hist.push({ s: st, t: nowIST().dmyhm, by: u.name });
      const inv = (d.inv !== undefined && d.inv !== '') ? String(d.inv) : row.invoice_no;
      const veh = (d.vehicle !== undefined && d.vehicle !== '') ? String(d.vehicle) : row.vehicle;
      await conn.query('UPDATE ops_orders SET status=?, invoice_no=?, vehicle=?, history_json=?, updated_at=NOW() WHERE id=?', [st, inv, veh, J(hist), row.id]);
      await conn.commit();
      order = { ...row, status: st, invoice_no: inv, vehicle: veh };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

    // WhatsApp — dealer / DSR / driver
    (async () => {
      if (st === 'DISPATCHED' || st === 'DELIVERED') await notifyOrderStatus(order);
      if (st === 'DISPATCHED' && d.driverMob) await notifyDriver(order, lines, clean(d.driverMob));
    })().catch(e => console.error('ops wa', e.message));
    return J({ ok: true, status: st });
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
      if (o.status === 'PENDING') s.pending++; if (o.status === 'BILLED') s.billed++; if (o.status === 'DISPATCHED') s.dispatched++;
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

  router.post('/sendRMReport', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    const [[rm]] = await db.query('SELECT * FROM ops_rm_list WHERE mobile=?', [clean(d.rmMob)]);
    if (!rm) return err('RM nahi mila');
    const type = String(d.type || '').toUpperCase(), today = nowIST().dmy;
    if (type === 'REORDER') {
      const [items] = await db.query('SELECT * FROM ops_items WHERE UPPER(brand)=? AND stock<=? ORDER BY stock, id LIMIT 30', [String(rm.company).toUpperCase(), LOW_STOCK]);
      if (!items.length) return err(`Koi item low/out of stock nahi hai ${rm.company} mein abhi`);
      const lines = items.map(it => `${it.size}${it.position ? ' ' + it.position : ''} ${it.pattern} ${it.tltt}`.trim() + `: ${it.stock} bacha`);
      const summary = `${lines.length} items low/out of stock: ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? ` aur ${lines.length - 5} aur` : ''}`;
      const res = await wati.send(rm.mobile, wati.T.RM_REPORT, ['Reorder', rm.company, summary, today]);
      if (res !== 'SENT') return err('Message send nahi hua: ' + res);
      return J({ ok: true, sentTo: rm.name, count: lines.length });
    }
    if (type === 'SALE') {
      const [orders] = await db.query(`SELECT items_json FROM ops_orders WHERE order_date=CURRENT_DATE AND status<>'CANCELLED'`);
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
      if (!count) return err(`Aaj koi ${rm.company} sale nahi hui abhi tak`);
      const itemLines = Object.keys(byItem).map(k => `${k}: ${byItem[k]} pcs`);
      const summary = `${count} orders, ${qty} pcs, ${wati.fmtR(amt)}. Items: ${itemLines.slice(0, 4).join(', ')}${itemLines.length > 4 ? ` aur ${itemLines.length - 4} aur` : ''}`;
      const res = await wati.send(rm.mobile, wati.T.RM_REPORT, ['Sale', rm.company, summary, today]);
      if (res !== 'SENT') return err('Message send nahi hua: ' + res);
      return J({ ok: true, sentTo: rm.name, count });
    }
    return err('Type galat — SALE ya REORDER hona chahiye');
  }));

  // ══════════ BUSY IMPORT (admin) ══════════
  // body: { name: 'StockStatus.xlsx', b64: '<xlsx base64>' }
  router.post('/importBusy', requireOps, adminOnly, rpc(async (u, j) => {
    const d = typeof j === 'string' ? JSON.parse(j) : (j || {});
    if (!d.b64) return err('File nahi mili');
    const r = await busy.importBusyBuffer(db, Buffer.from(d.b64, 'base64'), String(d.name || 'upload.xlsx'), nowIST().dmy);
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

  async function notifyNewOrder(o) {
    for (const num of wati.NOTIFY_NUMBERS) {
      await logged(`NEW|${o.oid}|${num}`, 'NEW_ORDER', o.oid, num, wati.T.NEW_ORDER, [o.dname, o.city, o.dsr, o.qty, o.amount, o.oid]);
    }
  }
  // DISPATCHED: dealer + DSR. DELIVERED: (dispatch wale agar chhoot gaye ho) + dealer + DSR.
  async function notifyOrderStatus(r) {
    const status = String(r.status).toUpperCase();
    const dmob = wati.watiMob(r.dealer_mobile), dsrMob = wati.watiMob(r.dsr_mobile);
    const oid = r.oid, qty = r.total_qty | 0, veh = r.vehicle || '';
    if (status === 'DISPATCHED' || status === 'DELIVERED') {
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
    await logged(`DRIVER|${r.oid}|${wati.watiMob(driverMob)}`, 'DRIVER', r.oid, driverMob, wati.T.DRIVER,
      [r.dealer_name, r.city || '', clean(r.dealer_mobile) || '-', items, gps || 'GPS nahi hai']);
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
  router.get('/cron', async (req, res) => {
    if (process.env.CRON_SECRET && req.query.key !== process.env.CRON_SECRET && req.headers['x-cron-secret'] !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Forbidden' });
    await scanOrders(); await scanPayments().catch(e => console.error('ops scanPayments', e.message)); await dailySummary().catch(e => console.error('ops summary', e.message));
    res.json({ ok: true });
  });
  if (!IS_SERVERLESS && wati.ENABLED) {
    setInterval(() => { scanOrders(); scanPayments().catch(e => console.error('ops scanPayments', e.message)); dailySummary().catch(e => console.error('ops summary', e.message)); }, 5 * 60 * 1000);
    console.log(`  ✅ Michelin Ops WhatsApp scanner started (har 5 min; office numbers: ${wati.NOTIFY_NUMBERS.length})`);
  } else if (!wati.ENABLED) {
    console.log('  ℹ️  Michelin Ops: WATI_BASE/WATI_TOKEN nahi — WhatsApp band, baaki app chalegi');
  }

  app.use('/api/ops', router);
};
