// ══════════════════════════════════════════════════════
// MICHELIN OPS v2 — Reports, Payment reminders, DSR Attendance,
// Route plan + tracking, Expenses
// ══════════════════════════════════════════════════════
// routes/ops.js ke router aur helpers par hi chalta hai (wahi auth, wahi RPC
// shakl). Yahan wo sab hai jo sheet wale system me tha hi nahi.
//
// DSR ka din: dayStart (GPS + aaj ka plan) -> route plan ke stops visit
// (GPS ke saath) -> orders -> expenses -> dayEnd. Admin ko Reports me sab
// dikhta hai: delivery pending, payment pending, DSR performance, tracking.

module.exports = function registerOpsExtra(S) {
  const { router, db, requireOps, adminOnly, rpc, J, err, clean, nowIST, dmyOf, FMT, isAdmin, logged, wati, pushToDrive, IS_SERVERLESS, scanPayments } = S;
  const parse = j => (typeof j === 'string' ? JSON.parse(j) : (j || {}));
  const isoDate = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

  // Admin kisi bhi DSR ke naam se dekh sakta hai (mob de kar); DSR sirf apna
  async function targetUser(u, mob) {
    if (isAdmin(u) && mob) {
      const [[r]] = await db.query('SELECT id, mobile, name, role FROM ops_users WHERE mobile=?', [clean(mob)]);
      if (!r) throw new Error('User nahi mila');
      return { id: r.id, mob: r.mobile, name: r.name, role: String(r.role).toUpperCase() };
    }
    return u;
  }

  // ══════════ REPORTS (admin) ══════════
  router.post('/getReports', requireOps, adminOnly, rpc(async () => {
    const [deliv] = await db.query(
      `SELECT oid, order_date, dealer_name, city, dsr_name, total_qty, amount, status, invoice_no, vehicle, DATEDIFF(CURRENT_DATE, order_date) AS days
       FROM ops_orders WHERE status IN ('PENDING','CONFIRMED','BILLED','DISPATCHED') ORDER BY order_date, id`);
    const [pay] = await db.query(
      `SELECT oid, order_date, dealer_name, dealer_mobile, dsr_name, amount, payment_terms, payment_due, invoice_no,
              ${FMT('delivered_at')} AS delivered, DATEDIFF(CURRENT_DATE, payment_due) AS overdue,
              DATEDIFF(CURRENT_DATE, delivered_at) AS sinceDelivery
       FROM ops_orders WHERE status='DELIVERED' AND payment_status<>'PAID' ORDER BY payment_due IS NULL, payment_due, id`);
    const [rem] = await db.query(`SELECT oid, MAX(log_time) AS t FROM ops_notif_log WHERE event='PAY_REMINDER' AND status='SENT' GROUP BY oid`);
    const remMap = {}; for (const r of rem) remMap[r.oid] = r.t;
    const [outs] = await db.query('SELECT dealer_name, mobile, amount, as_on FROM ops_outstanding ORDER BY amount DESC');
    // DSR performance — is mahine
    const [users] = await db.query(`SELECT id, mobile, name, role FROM ops_users WHERE active=1 ORDER BY role='DSR' DESC, name`);
    const [ord] = await db.query(
      `SELECT dsr_mobile, COUNT(*) AS n, COALESCE(SUM(total_qty),0) AS q, COALESCE(SUM(amount),0) AS a, SUM(status='DELIVERED') AS d
       FROM ops_orders WHERE status<>'CANCELLED' AND DATE_FORMAT(order_date,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m') GROUP BY dsr_mobile`);
    const [dl] = await db.query(`SELECT added_by, COUNT(*) AS n FROM ops_dealers WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m') GROUP BY added_by`);
    const [att] = await db.query(`SELECT user_id, COUNT(*) AS n FROM ops_attendance WHERE DATE_FORMAT(att_date,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m') AND start_at IS NOT NULL GROUP BY user_id`);
    const [rp] = await db.query(`SELECT user_id, stops_json FROM ops_route_plans WHERE DATE_FORMAT(plan_date,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m')`);
    const [ex] = await db.query(`SELECT user_id, SUM(status='APPROVED') AS ok, SUM(amount*(status='APPROVED')) AS amt, SUM(status='PENDING') AS pend FROM ops_expenses WHERE DATE_FORMAT(exp_date,'%Y-%m')=DATE_FORMAT(CURRENT_DATE,'%Y-%m') GROUP BY user_id`);
    const om = {}; for (const r of ord) om[r.dsr_mobile] = r;
    const dm = {}; for (const r of dl) dm[String(r.added_by).toUpperCase()] = r.n;
    const am = {}; for (const r of att) am[r.user_id] = r.n;
    const em = {}; for (const r of ex) em[r.user_id] = r;
    const vm = {};
    for (const r of rp) { let st = []; try { st = JSON.parse(r.stops_json || '[]'); } catch (_) {} const v = vm[r.user_id] = vm[r.user_id] || { planned: 0, visited: 0 }; v.planned += st.length; v.visited += st.filter(s => s.status === 'VISITED').length; }
    const performance = users.filter(x => String(x.role).toUpperCase() === 'DSR').map(x => ({
      name: x.name, mob: x.mobile,
      orders: (om[x.mobile] || {}).n | 0, qty: Number((om[x.mobile] || {}).q) || 0, amount: Number((om[x.mobile] || {}).a) || 0, delivered: (om[x.mobile] || {}).d | 0,
      dealers: dm[String(x.name).toUpperCase()] | 0, attendDays: am[x.id] | 0,
      planned: (vm[x.id] || {}).planned | 0, visited: (vm[x.id] || {}).visited | 0,
      expApproved: Number((em[x.id] || {}).amt) || 0, expPending: (em[x.id] || {}).pend | 0,
    }));
    const [[expPend]] = await db.query(`SELECT COUNT(*) AS n FROM ops_expenses WHERE status='PENDING'`);
    return J({
      ok: true, today: nowIST().dmy,
      deliveryPending: deliv.map(r => ({ oid: r.oid, date: dmyOf(r.order_date), dname: r.dealer_name, city: r.city, dsr: r.dsr_name, qty: r.total_qty | 0, amount: Number(r.amount) || 0, status: r.status, inv: r.invoice_no || '', vehicle: r.vehicle || '', days: r.days | 0 })),
      paymentPending: pay.map(r => ({ oid: r.oid, date: dmyOf(r.order_date), dname: r.dealer_name, dmob: r.dealer_mobile, dsr: r.dsr_name, amount: Number(r.amount) || 0, terms: r.payment_terms || '', due: dmyOf(r.payment_due), overdue: r.payment_due ? r.overdue | 0 : null, delivered: r.delivered || '', sinceDelivery: r.sinceDelivery | 0, inv: r.invoice_no || '', lastReminder: remMap[r.oid] ? dmyOf(new Date(remMap[r.oid]).toISOString()) : '' })),
      outstanding: outs.map(r => ({ name: r.dealer_name, mobile: r.mobile, amount: Number(r.amount) || 0, asOn: r.as_on })),
      performance, expensesPending: expPend.n | 0,
    });
  }));

  // ══════════ PAYMENT REMINDER ══════════
  // Dealer + DSR ko template; ek order par din me ek hi baar (key me date).
  async function sendReminder(r, by) {
    const dmob = wati.watiMob(r.dealer_mobile), dsrMob = wati.watiMob(r.dsr_mobile);
    const vals = [r.dealer_name, r.oid, Math.round(Number(r.amount)), dmyOf(r.payment_due) || 'due'];
    const day = nowIST().iso;
    const out = [];
    if (dmob) out.push(await logged(`PAYREM|${r.oid}|${dmob}|${day}`, 'PAY_REMINDER', r.oid, dmob, wati.T.PAY_REMINDER, vals));
    if (dsrMob) out.push(await logged(`PAYREM|${r.oid}|${dsrMob}|${day}`, 'PAY_REMINDER', r.oid, dsrMob, wati.T.PAY_REMINDER, vals));
    return out;
  }
  router.post('/sendPaymentReminder', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    const [[r]] = await db.query(`SELECT * FROM ops_orders WHERE oid=? AND status='DELIVERED' AND payment_status<>'PAID'`, [String(d.oid)]);
    if (!r) return err('Ye order delivered + payment pending nahi hai');
    const res = await sendReminder(r, u.name);
    if (!res.length) return err('Dealer/DSR ka number nahi hai');
    if (!res.some(x => x === 'SENT')) return err('Bheja nahi gaya: ' + res.join(', '));
    return J({ ok: true, sent: res });
  }));
  // Roz 10:00 IST ke baad: due nikal chuka ho to reminder; phir har 3 din
  async function autoReminders() {
    if (!wati.ENABLED) return;
    const now = nowIST();
    if (now.hour < 10) return;
    const [[st]] = await db.query(`SELECT v FROM app_state WHERE k='ops_payrem_last'`).catch(() => [[null]]);
    if (st && st.v === now.iso) return;
    await db.query(`INSERT INTO app_state (k,v) VALUES ('ops_payrem_last',?) ON DUPLICATE KEY UPDATE v=VALUES(v)`, [now.iso]);
    const [rows] = await db.query(
      `SELECT o.* FROM ops_orders o WHERE o.status='DELIVERED' AND o.payment_status<>'PAID' AND o.payment_due IS NOT NULL AND o.payment_due<=CURRENT_DATE
         AND NOT EXISTS (SELECT 1 FROM ops_notif_log n WHERE n.oid=o.oid AND n.event='PAY_REMINDER' AND n.status='SENT' AND n.log_time>DATE_SUB(NOW(), INTERVAL 3 DAY))`);
    for (const r of rows) { try { await sendReminder(r, 'auto'); } catch (e) { console.error('ops payrem', e.message); } }
    if (rows.length) console.log(`  💰 Ops payment reminders: ${rows.length} order(s)`);
  }
  router.get('/cron-reminders', async (req, res) => {
    if (process.env.CRON_SECRET && req.query.key !== process.env.CRON_SECRET) return res.status(403).json({ error: 'Forbidden' });
    await autoReminders(); res.json({ ok: true });
  });
  if (!IS_SERVERLESS && wati.ENABLED) setInterval(() => autoReminders().catch(e => console.error('ops payrem', e.message)), 15 * 60 * 1000);

  // ══════════ LOCATION (live trail) ══════════
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  async function addPoint(userId, lat, lng, kind, note, acc) {
    const la = num(lat), ln = num(lng);
    if (la === null || ln === null || (la === 0 && ln === 0)) return false;
    await db.query('INSERT INTO ops_locations (user_id, lat, lng, accuracy, kind, note) VALUES (?,?,?,?,?,?)', [userId, la, ln, parseInt(acc, 10) || 0, kind, String(note || '').slice(0, 120)]);
    return true;
  }
  // Phone se har ~2 min (sirf jab din chal raha ho). Aakhri point 60 sec ke andar ho to skip.
  router.post('/pingLocation', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const [[att]] = await db.query('SELECT start_at, end_at FROM ops_attendance WHERE user_id=? AND att_date=CURRENT_DATE', [u.id]);
    if (!att || !att.start_at || att.end_at) return J({ ok: true, skipped: 'day-off' });
    const [[last]] = await db.query('SELECT at_time FROM ops_locations WHERE user_id=? AND at_time>DATE_SUB(NOW(), INTERVAL 60 SECOND) ORDER BY id DESC LIMIT 1', [u.id]);
    if (last) return J({ ok: true, skipped: 'too-soon' });
    const ok = await addPoint(u.id, d.lat, d.lng, 'ping', '', d.acc);
    return J({ ok: true, saved: ok });
  }));
  // Ek DSR ka ek din ka trail + stops (admin koi bhi, DSR apna)
  router.post('/getTrail', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const t = await targetUser(u, d.mob);
    const day = isoDate(d.date) || nowIST().iso;
    const [pts] = await db.query(`SELECT ${FMT('at_time')} AS t, lat, lng, accuracy AS acc, kind, note FROM ops_locations WHERE user_id=? AND DATE(at_time)=? ORDER BY id`, [t.id, day]);
    const [[rp]] = await db.query('SELECT stops_json FROM ops_route_plans WHERE user_id=? AND plan_date=?', [t.id, day]);
    const stops = stopsOf(rp);
    // Stops ke liye dealer ki location (plan me sirf did hota hai)
    const dids = stops.map(s => s.did).filter(Boolean);
    const dm = {};
    if (dids.length) { const [dl] = await db.query(`SELECT did, lat, lng, address FROM ops_dealers WHERE did IN (${dids.map(() => '?').join(',')})`, dids); for (const x of dl) dm[x.did] = x; }
    const stopsOut = stops.map((s, i) => ({ i, name: s.name, city: s.city || '', status: s.status, visited_at: s.visited_at || '', lat: s.lat || (dm[s.did] && dm[s.did].lat) || '', lng: s.lng || (dm[s.did] && dm[s.did].lng) || '', address: (dm[s.did] && dm[s.did].address) || '' }));
    return J({ ok: true, date: day, dmy: dmyOf(day), user: { name: t.name, mob: t.mob }, points: pts.map(p => ({ t: p.t, lat: Number(p.lat), lng: Number(p.lng), acc: p.acc, kind: p.kind, note: p.note })), stops: stopsOut });
  }));
  // Dealer ki location set — Google Maps pin link se (link:) ya GPS se (lat/lng).
  // Koi bhi logged-in user; already ho to force=true chahiye.
  router.post('/setDealerLocation', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    let la = num(d.lat), ln = num(d.lng);
    if (d.link) {
      const c = await require('../lib/maps-link').coordsFromLink(d.link);
      if (!c) return err('Is link se location nahi nikli — Google Maps ka pin link ya "lat, lng" daalo');
      la = c.lat; ln = c.lng;
    }
    if (la === null || ln === null) return err('Location nahi mili');
    const [[dl]] = await db.query('SELECT id, lat, lng FROM ops_dealers WHERE did=?', [String(d.did)]);
    if (!dl) return err('Dealer nahi mila');
    if (dl.lat && dl.lng && !d.force) return J({ ok: true, unchanged: true });
    await db.query('UPDATE ops_dealers SET lat=?, lng=? WHERE id=?', [String(la), String(ln), dl.id]);
    return J({ ok: true, lat: la, lng: ln });
  }));

  // ══════════ ATTENDANCE ══════════
  const ATT_SELECT = `SELECT a.*, u.name, u.mobile, ${FMT('a.start_at')} AS start_s, ${FMT('a.end_at')} AS end_s FROM ops_attendance a JOIN ops_users u ON u.id=a.user_id`;
  const mapAtt = r => ({ date: dmyOf(r.att_date), iso: String(r.att_date).slice(0, 10), name: r.name, mob: r.mobile, start: r.start_s || '', end: r.end_s || '', startLat: r.start_lat, startLng: r.start_lng, endLat: r.end_lat, endLng: r.end_lng, plan: r.plan || '', remark: r.remark || '' });
  // DSR: is mahine ke apne din (+ aaj). Admin: ek din ke sab DSR (date do), ya kisi ek user ka mahina (mob do)
  router.post('/getAttendance', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    if (isAdmin(u) && !d.mob) {
      const day = isoDate(d.date) || nowIST().iso;
      const [rows] = await db.query(`${ATT_SELECT} WHERE a.att_date=? ORDER BY u.name`, [day]);
      const [dsrs] = await db.query(`SELECT name, mobile FROM ops_users WHERE active=1 AND UPPER(role)='DSR' ORDER BY name`);
      const have = new Set(rows.map(r => r.mobile));
      const list = rows.map(mapAtt).concat(dsrs.filter(x => !have.has(x.mobile)).map(x => ({ date: dmyOf(day), iso: day, name: x.name, mob: x.mobile, start: '', end: '', plan: '', remark: '', absent: true })));
      return J({ ok: true, date: day, list });
    }
    const t = await targetUser(u, d.mob);
    const month = (String(d.month || '').match(/^\d{4}-\d{2}$/) || [nowIST().iso.slice(0, 7)])[0];
    const [rows] = await db.query(`${ATT_SELECT} WHERE a.user_id=? AND DATE_FORMAT(a.att_date,'%Y-%m')=? ORDER BY a.att_date DESC`, [t.id, month]);
    const today = rows.find(r => String(r.att_date).slice(0, 10) === nowIST().iso);
    return J({ ok: true, month, list: rows.map(mapAtt), today: today ? mapAtt(today) : null });
  }));
  router.post('/dayStart', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const plan = String(d.plan || '').trim();
    await db.query(
      `INSERT INTO ops_attendance (user_id, att_date, start_at, start_lat, start_lng, plan) VALUES (?, CURRENT_DATE, NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_at=COALESCE(start_at, NOW()), start_lat=IF(start_lat='',VALUES(start_lat),start_lat), start_lng=IF(start_lng='',VALUES(start_lng),start_lng), plan=IF(VALUES(plan)='', plan, VALUES(plan))`,
      [u.id, d.lat == null ? '' : String(d.lat), d.lng == null ? '' : String(d.lng), plan]);
    await addPoint(u.id, d.lat, d.lng, 'start', 'Day start', d.acc);
    const [[r]] = await db.query(`${ATT_SELECT} WHERE a.user_id=? AND a.att_date=CURRENT_DATE`, [u.id]);
    return J({ ok: true, today: mapAtt(r) });
  }));
  router.post('/dayEnd', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const [[r0]] = await db.query('SELECT id, start_at FROM ops_attendance WHERE user_id=? AND att_date=CURRENT_DATE', [u.id]);
    if (!r0 || !r0.start_at) return err('Pehle Day Start karo');
    await db.query('UPDATE ops_attendance SET end_at=NOW(), end_lat=?, end_lng=?, remark=? WHERE id=?', [d.lat == null ? '' : String(d.lat), d.lng == null ? '' : String(d.lng), String(d.remark || '').trim().slice(0, 500), r0.id]);
    await addPoint(u.id, d.lat, d.lng, 'end', 'Day end', d.acc);
    const [[r]] = await db.query(`${ATT_SELECT} WHERE a.id=?`, [r0.id]);
    return J({ ok: true, today: mapAtt(r) });
  }));

  // ══════════ ROUTE PLAN ══════════
  function stopsOf(row) { let s = []; try { s = JSON.parse((row && row.stops_json) || '[]'); } catch (_) {} return Array.isArray(s) ? s : []; }
  router.post('/getRoutePlan', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const t = await targetUser(u, d.mob);
    const day = isoDate(d.date) || nowIST().iso;
    const [[row]] = await db.query('SELECT * FROM ops_route_plans WHERE user_id=? AND plan_date=?', [t.id, day]);
    // Aage ke plans bhi (agle 7 din) — DSR ko dikhane ke liye
    const [upcoming] = await db.query(`SELECT plan_date, stops_json FROM ops_route_plans WHERE user_id=? AND plan_date>=CURRENT_DATE ORDER BY plan_date LIMIT 10`, [t.id]);
    return J({ ok: true, date: day, dmy: dmyOf(day), stops: stopsOf(row), user: { name: t.name, mob: t.mob },
      upcoming: upcoming.map(r => ({ date: String(r.plan_date).slice(0, 10), dmy: dmyOf(r.plan_date), n: stopsOf(r).length, visited: stopsOf(r).filter(s => s.status === 'VISITED').length })) });
  }));
  // Plan banao/edit: stops = [{did}] ya [{name, city}] (bina dealer ke area bhi). Visited stops
  // waise hi rehte hain, sirf PLANNED wale replace hote hain. Admin kisi DSR ka bhi bana sakta hai.
  router.post('/saveRoutePlan', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const t = await targetUser(u, d.mob);
    const day = isoDate(d.date) || nowIST().iso;
    if (day < nowIST().iso && !isAdmin(u)) return err('Purani date ka plan nahi badal sakte');
    const [[row]] = await db.query('SELECT * FROM ops_route_plans WHERE user_id=? AND plan_date=?', [t.id, day]);
    const old = stopsOf(row);
    const keep = old.filter(s => s.status === 'VISITED' || s.status === 'SKIPPED');
    const dids = (d.stops || []).map(s => String(s.did || '')).filter(Boolean);
    const dm = {};
    if (dids.length) { const [dl] = await db.query(`SELECT did, name, city, mobile FROM ops_dealers WHERE did IN (${dids.map(() => '?').join(',')})`, dids); for (const x of dl) dm[x.did] = x; }
    const fresh = [];
    for (const s of (d.stops || [])) {
      if (s.did && dm[s.did]) { if (keep.some(k => k.did === s.did)) continue; fresh.push({ did: s.did, name: dm[s.did].name, city: dm[s.did].city || '', mob: clean(dm[s.did].mobile), status: 'PLANNED', note: String(s.note || '').slice(0, 200) }); }
      else if (String(s.name || '').trim()) fresh.push({ did: '', name: String(s.name).trim().slice(0, 100), city: String(s.city || '').trim().slice(0, 60), mob: '', status: 'PLANNED', note: String(s.note || '').slice(0, 200) });
    }
    const stops = keep.concat(fresh);
    await db.query(
      `INSERT INTO ops_route_plans (user_id, plan_date, stops_json) VALUES (?,?,?) ON DUPLICATE KEY UPDATE stops_json=VALUES(stops_json), updated_at=NOW()`,
      [t.id, day, J(stops)]);
    return J({ ok: true, date: day, stops });
  }));
  // Stop visit/skip — GPS ke saath (tracking isi se banta hai)
  router.post('/visitStop', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const day = isoDate(d.date) || nowIST().iso;
    const [[row]] = await db.query('SELECT * FROM ops_route_plans WHERE user_id=? AND plan_date=?', [u.id, day]);
    const stops = stopsOf(row);
    const i = parseInt(d.idx, 10);
    if (!stops[i]) return err('Stop nahi mila');
    const status = String(d.status || 'VISITED').toUpperCase();
    if (!['VISITED', 'SKIPPED', 'PLANNED'].includes(status)) return err('Status galat');
    stops[i] = { ...stops[i], status, visited_at: status === 'PLANNED' ? '' : nowIST().dmyhm, lat: d.lat == null ? '' : String(d.lat), lng: d.lng == null ? '' : String(d.lng), note: String(d.note || stops[i].note || '').slice(0, 200) };
    await db.query('UPDATE ops_route_plans SET stops_json=?, updated_at=NOW() WHERE id=?', [J(stops), row.id]);
    if (status === 'VISITED') {
      await addPoint(u.id, d.lat, d.lng, 'visit', stops[i].name, d.acc);
      // Dealer ki location abhi tak nahi thi to visit wali jagah se set (DSR shop par hi hai)
      if (stops[i].did && d.setDealerLoc !== false && num(d.lat) !== null) {
        await db.query(`UPDATE ops_dealers SET lat=?, lng=? WHERE did=? AND (lat='' OR lng='')`, [String(num(d.lat)), String(num(d.lng)), stops[i].did]);
      }
    }
    return J({ ok: true, stops });
  }));
  // Admin tracking: ek din ke sab DSR — plan, visits, attendance, orders
  router.post('/getRouteTracking', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    const day = isoDate(d.date) || nowIST().iso;
    const [dsrs] = await db.query(`SELECT id, name, mobile FROM ops_users WHERE active=1 AND UPPER(role)='DSR' ORDER BY name`);
    const [plans] = await db.query('SELECT user_id, stops_json FROM ops_route_plans WHERE plan_date=?', [day]);
    const [att] = await db.query(`SELECT user_id, ${FMT('start_at')} AS s, ${FMT('end_at')} AS e, start_lat, start_lng, end_lat, end_lng, plan FROM ops_attendance WHERE att_date=?`, [day]);
    const [ord] = await db.query(`SELECT dsr_mobile, COUNT(*) AS n, COALESCE(SUM(amount),0) AS a FROM ops_orders WHERE order_date=? AND status<>'CANCELLED' GROUP BY dsr_mobile`, [day]);
    const [loc] = await db.query(`SELECT l.user_id, COUNT(*) AS n, MAX(l.id) AS lastId FROM ops_locations l WHERE DATE(l.at_time)=? GROUP BY l.user_id`, [day]);
    const lastIds = loc.map(l => l.lastId);
    const lm = {};
    if (lastIds.length) { const [ls] = await db.query(`SELECT id, user_id, ${FMT('at_time')} AS t, lat, lng FROM ops_locations WHERE id IN (${lastIds.map(() => '?').join(',')})`, lastIds); for (const l of ls) lm[l.user_id] = { t: l.t, lat: Number(l.lat), lng: Number(l.lng) }; }
    const cm = {}; for (const l of loc) cm[l.user_id] = l.n;
    const pm = {}; for (const p of plans) pm[p.user_id] = stopsOf(p);
    const am = {}; for (const a of att) am[a.user_id] = a;
    const om = {}; for (const o of ord) om[o.dsr_mobile] = o;
    return J({ ok: true, date: day, dmy: dmyOf(day), list: dsrs.map(x => {
      const stops = pm[x.id] || [], a = am[x.id] || {};
      return { name: x.name, mob: x.mobile, stops, planned: stops.length, visited: stops.filter(s => s.status === 'VISITED').length, skipped: stops.filter(s => s.status === 'SKIPPED').length,
        start: a.s || '', end: a.e || '', startLat: a.start_lat || '', startLng: a.start_lng || '', endLat: a.end_lat || '', endLng: a.end_lng || '', plan: a.plan || '',
        orders: (om[x.mobile] || {}).n | 0, amount: Number((om[x.mobile] || {}).a) || 0,
        points: cm[x.id] | 0, last: lm[x.id] || null };
    }) });
  }));

  // ══════════ EXPENSES ══════════
  const EXP_TYPES = ['fuel', 'food', 'travel', 'stay', 'other'];
  const EXP_SELECT = `SELECT e.id, e.exp_date, e.type, e.amount, e.note, e.status, e.decided_by, e.decision_note, e.receipt_name<>'' AS hasReceipt, e.receipt_drive_url, ${FMT('e.created_at')} AS created, ${FMT('e.decided_at')} AS decided, u.name, u.mobile FROM ops_expenses e JOIN ops_users u ON u.id=e.user_id`;
  const mapExp = r => ({ id: r.id, date: dmyOf(r.exp_date), type: r.type, amount: Number(r.amount) || 0, note: r.note || '', status: r.status, decidedBy: r.decided_by || '', decisionNote: r.decision_note || '', receipt: !!r.hasReceipt, drive: r.receipt_drive_url || '', created: r.created, decided: r.decided || '', name: r.name, mob: r.mobile });
  router.post('/getExpenses', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const month = (String(d.month || '').match(/^\d{4}-\d{2}$/) || [nowIST().iso.slice(0, 7)])[0];
    let where = `DATE_FORMAT(e.exp_date,'%Y-%m')=?`, params = [month];
    if (!isAdmin(u)) { where += ' AND e.user_id=?'; params.push(u.id); }
    else if (d.mob) { where += ' AND u.mobile=?'; params.push(clean(d.mob)); }
    if (d.status) { where += ' AND e.status=?'; params.push(String(d.status).toUpperCase()); }
    const [rows] = await db.query(`${EXP_SELECT} WHERE ${where} ORDER BY e.exp_date DESC, e.id DESC LIMIT 300`, params);
    const list = rows.map(mapExp);
    const tot = { total: 0, approved: 0, pending: 0 };
    for (const x of list) { tot.total += x.amount; if (x.status === 'APPROVED') tot.approved += x.amount; if (x.status === 'PENDING') tot.pending += x.amount; }
    return J({ ok: true, month, list, totals: tot });
  }));
  router.post('/addExpense', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const day = isoDate(d.date) || nowIST().iso;
    const type = EXP_TYPES.includes(String(d.type)) ? String(d.type) : 'other';
    const amount = parseFloat(d.amount);
    if (!(amount > 0)) return err('Amount daalo');
    let rName = '', rMime = '', rBuf = null, rDrive = '';
    if (d.receipt && d.receipt.b64) {
      rMime = d.receipt.mime === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
      rName = `EXP_${u.mob}_${day.replace(/-/g, '')}_${Date.now()}.${rMime === 'application/pdf' ? 'pdf' : 'jpg'}`;
      rBuf = Buffer.from(d.receipt.b64, 'base64');
      rDrive = await pushToDrive(rName, rMime, d.receipt.b64, 'expense');
    }
    const [r] = await db.query('INSERT INTO ops_expenses (user_id, exp_date, type, amount, note, receipt_name, receipt_mime, receipt, receipt_drive_url) VALUES (?,?,?,?,?,?,?,?,?)',
      [u.id, day, type, amount, String(d.note || '').trim().slice(0, 300), rName, rMime, rBuf, rDrive]);
    return J({ ok: true, id: r.insertId });
  }));
  router.post('/decideExpense', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    const status = String(d.status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) return err('Status galat');
    const [r] = await db.query('UPDATE ops_expenses SET status=?, decided_by=?, decided_at=NOW(), decision_note=? WHERE id=?', [status, u.name, String(d.note || '').slice(0, 300), parseInt(d.id, 10)]);
    if (!r.affectedRows) return err('Expense nahi mila');
    return J({ ok: true, status });
  }));
  router.post('/deleteExpense', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    const [[e]] = await db.query('SELECT id, user_id, status FROM ops_expenses WHERE id=?', [parseInt(d.id, 10)]);
    if (!e) return err('Expense nahi mila');
    if (!isAdmin(u) && (e.user_id !== u.id || e.status !== 'PENDING')) return err('Sirf apna pending expense hata sakte ho');
    await db.query('DELETE FROM ops_expenses WHERE id=?', [e.id]);
    return J({ ok: true });
  }));
  router.get('/expense-file/:id', requireOps, async (req, res) => {
    try {
      const [[r]] = await db.query('SELECT user_id, receipt_name, receipt_mime, receipt, receipt_drive_url FROM ops_expenses WHERE id=?', [parseInt(req.params.id, 10)]);
      if (!r) return res.status(404).send('Nahi mila');
      if (!isAdmin(req.opsUser) && r.user_id !== req.opsUser.id) return res.status(403).send('Permission nahi');
      if (!r.receipt && r.receipt_drive_url) return res.redirect(r.receipt_drive_url);
      if (!r.receipt) return res.status(404).send('Receipt nahi hai');
      res.setHeader('Content-Type', r.receipt_mime || 'image/jpeg');
      res.setHeader('Content-Disposition', `inline; filename="${r.receipt_name}"`);
      res.send(r.receipt);
    } catch (e) { res.status(500).send('Server error'); }
  });

  // ══════════ TALLY BRIDGE ══════════
  // Busy "List of Supply Outward Vouchers" -> Michelin InvoiceTally .xlsx. Settings app_settings me (sabke liye ek).
  // Do kind: 2W (Scooter/Motorcycle/Royal Enfield — keys tally.*) aur 4W (Car/PCR — keys tally.*4w).
  const tally = require('../lib/tally-bridge');
  async function getSetting(k) { const [[r]] = await db.query('SELECT value FROM app_settings WHERE key_name=?', [k]); return r ? r.value : null; }
  async function setSetting(k, v) { await db.query('INSERT INTO app_settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [k, v]); }
  const KIND_KEYS = { '2W': { code: 'tally.distributorCode', ca: 'tally.caTable', label: 'tally.caSourceLabel', at: 'tally.caUpdatedAt', defCode: tally.DEFAULT_DISTRIBUTOR, defCa: tally.DEFAULT_CA_TABLE, defLabel: 'bundled default (Aug 2026 export)', defAt: '2026-08-24' },
                     '4W': { code: 'tally.distributorCode4w', ca: 'tally.caTable4w', label: 'tally.caSourceLabel4w', at: 'tally.caUpdatedAt4w', defCode: tally.DEFAULT_DISTRIBUTOR_4W, defCa: tally.DEFAULT_CA_TABLE_4W, defLabel: 'bundled default (Michelin CAI - PCR details, Sep 2026)', defAt: '2026-09-10' } };
  async function kindSettings(kind) {
    const K = KIND_KEYS[kind];
    let code = await getSetting(K.code), ca = await getSetting(K.ca);
    if (code === null) { code = K.defCode; await setSetting(K.code, code); }
    let caTable = [];
    if (ca) { try { caTable = JSON.parse(ca); } catch (_) { caTable = []; } }
    if (!caTable.length) { caTable = K.defCa; await setSetting(K.ca, J(caTable)); await setSetting(K.label, K.defLabel); await setSetting(K.at, K.defAt); }
    return { kind, code, caTable, caSourceLabel: (await getSetting(K.label)) || 'default', caUpdatedAt: (await getSetting(K.at)) || '' };
  }
  async function tallySettings() { return { '2W': await kindSettings('2W'), '4W': await kindSettings('4W') }; }
  const settingsOut = s => ({ ok: true, kinds: tally.KINDS.map(k => { const x = s[k.kind]; return { kind: k.kind, label: k.label, sub: k.sub, distributorCode: x.code, caCount: x.caTable.length, caSourceLabel: x.caSourceLabel, caUpdatedAt: x.caUpdatedAt }; }) });
  router.post('/tallyGetSettings', requireOps, adminOnly, rpc(async () => J(settingsOut(await tallySettings()))));
  // body: { kinds: { '2W': { distributorCode, caFile:{name,b64}|null }, '4W': {...} } }
  router.post('/tallySaveSettings', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j); const kinds = d.kinds || {};
    for (const k of tally.KINDS) {
      const K = KIND_KEYS[k.kind], x = kinds[k.kind]; if (!x) continue;
      if (x.distributorCode !== undefined) await setSetting(K.code, String(x.distributorCode || '').trim());
      if (x.caFile && x.caFile.b64) {
        const sheets = require('../lib/xlsx').readXlsx(Buffer.from(x.caFile.b64, 'base64'));
        const rows = ((sheets.find(s => s.rows.length > 1) || sheets[0]) || { rows: [] }).rows;
        const caTable = tally.buildCaTableFromRows(rows);
        if (!caTable.length) return err(`${k.label} file mein CA / Size column nahi mile — ek column CA number, doosra Size hona chahiye.`);
        await setSetting(K.ca, J(caTable));
        await setSetting(K.label, String(x.caFile.name || 'uploaded file').slice(0, 120));
        await setSetting(K.at, nowIST().iso);
      }
    }
    return J(settingsOut(await tallySettings()));
  }));
  router.post('/tallyProcess', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    if (!d.b64) return err('File nahi mili');
    const s = await tallySettings(), kinds = {}, over = d.codes || {};
    for (const k of tally.KINDS) { const code = String(over[k.kind] || s[k.kind].code || '').trim(); kinds[k.kind] = { caTable: s[k.kind].caTable, code }; }
    if (!kinds['2W'].code && !kinds['4W'].code) return err('Distributor code set nahi hai — pehle Settings mein save karein.');
    const r = tally.processListOfSupply(Buffer.from(d.b64, 'base64'), kinds);
    const outputs = r.outputs.map(o => ({ kind: o.kind, label: o.label, sub: o.sub, code: o.code, matchedCount: o.matchedCount, preview: o.preview, totals: o.totals, base64: o.xlsx ? o.xlsx.toString('base64') : null, filename: o.xlsx ? `InvoiceTally_${o.kind}_${o.code || 'nocode'}.xlsx` : null, warn: o.matchedCount && !o.code ? 'Distributor code set nahi — file me code khali jayega' : '' }));
    return J({ ok: true, outputs, matchedCount: r.matchedCount, droppedCount: r.droppedCount, dropped: r.dropped });
  }));

  // ══════════ BUSY DRIVE AUTO-IMPORT ══════════
  // Devmaniwarehouses Drive folder (Apps Script web app, docs/apps-script-busy-drive) se
  // Busy exports har 30 min khud import. Settings app_settings me (busyDrive.*).
  const busyDrive = require('../lib/busy-drive').makeBusyDrive({ db, nowIST, afterImport: () => (scanPayments ? scanPayments() : null) });
  router.post('/busyDriveGet', requireOps, adminOnly, rpc(async () => J(Object.assign({ ok: true }, busyDrive.publicView(await busyDrive.settings())))));
  router.post('/busyDriveSave', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    const url = d.url === undefined ? undefined : String(d.url || '').trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return err('URL script.google.com wala hona chahiye (Deploy → Web app → URL)');
    const s = await busyDrive.saveSettings({ url, secret: d.secret, enabled: d.enabled });
    return J(Object.assign({ ok: true }, busyDrive.publicView(s)));
  }));
  router.post('/busyDriveTest', requireOps, adminOnly, rpc(async () => { try { return J(Object.assign({ ok: true }, await busyDrive.test())); } catch (e) { return err(e.message); } }));
  // Sync 1-3 min leta hai (backup download + parse) — hosting proxy 60s par kaat deta hai, isliye
  // background me shuru karke turant jawab; UI busyDriveGet se poll karta hai (running / lastRun).
  router.post('/busyDriveSync', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    if (busyDrive.isRunning()) return J(Object.assign({ ok: true, started: false }, busyDrive.publicView(await busyDrive.settings())));
    const s0 = await busyDrive.settings();
    if (!s0.url || !s0.secret) return err('Drive script URL / secret set nahi (Settings)');
    busyDrive.sync({ force: !!d.force, silent: !!d.silent, by: u.name || 'admin' }).catch(e => console.error('busy drive sync', e.message));
    await new Promise(r => setTimeout(r, 300));
    return J(Object.assign({ ok: true, started: true }, busyDrive.publicView(await busyDrive.settings())));
  }));
  if (!IS_SERVERLESS) {
    const tick = () => busyDrive.syncIfEnabled('auto').then(r => { if (r && !r.skipped) console.log('  Busy Drive sync:', r.ok ? `${r.imported.length} import, ${r.skipped} unchanged` : r.error); }).catch(e => console.error('busy drive', e.message));
    setTimeout(tick, 2 * 60 * 1000); // boot ke 2 min baad pehli baar
    setInterval(tick, busyDrive.SYNC_EVERY_MIN * 60 * 1000);
  }

  // Chhota helper: ops users list (admin ko filters ke liye)
  router.post('/getUsers', requireOps, adminOnly, rpc(async () => {
    const [rows] = await db.query('SELECT name, mobile, role, active FROM ops_users ORDER BY role=\'DSR\' DESC, name');
    return rows.map(r => ({ name: r.name, mob: r.mobile, role: String(r.role).toUpperCase(), active: !!r.active }));
  }));
  return { busyDriveSync: by => busyDrive.syncIfEnabled(by) };
};
