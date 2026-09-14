// ══════════════════════════════════════════════════════
// MICHELIN OPS v4 (14-Sep-2026) — IMS, Access/permissions, Busy outstanding report,
// account statement (PDF + WhatsApp)
// ══════════════════════════════════════════════════════
// Same router/helpers jaise ops-extra. Register: ops-extra ke andar se.
//
//   IMS        : item ka min/max level, din-wise stock (ops_stock_daily), avg daily sale, days cover
//   Access     : users ka username/password + page permissions (perms JSON array)
//   Outstanding: ops_outstanding + ops_busy_party (Michelin/VK split, due-from) + WhatsApp
//   Statement  : ops_busy_ledger se dealer ka ledger -> PDF (pdfkit) -> public token link + Wati

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { buildStatementPdf } = require('../lib/statement-pdf');
const busyDb = require('../lib/busy-db');

// Pages jo Access page me tick ho sakte hain (key = frontend page id)
const ALL_PAGES = ['home', 'order', 'orders', 'crm', 'stock', 'ims', 'dealers', 'reports', 'track', 'day', 'route', 'exp', 'tally', 'masters', 'access'];
const ROLE_DEFAULT = {
  DSR: ['home', 'order', 'orders', 'stock', 'day', 'route', 'exp'],
  ADMIN: ALL_PAGES,
  OTHER: ['home', 'order', 'orders', 'crm', 'stock', 'ims', 'dealers', 'reports', 'track', 'route', 'exp', 'tally', 'masters'],
};
function defaultPerms(role) { const r = String(role || '').toUpperCase(); return ROLE_DEFAULT[r] || (r === 'DSR' ? ROLE_DEFAULT.DSR : ROLE_DEFAULT.OTHER); }
function parsePerms(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.filter(x => ALL_PAGES.includes(x)) : []; } catch (_) { return []; } }

module.exports = function registerOpsV4(S) {
  const { router, db, requireOps, adminOnly, rpc, J, err, clean, nowIST, dmyOf, isAdmin, wati, busyDrive, JWT_SECRET, APP_URL, IS_SERVERLESS } = S;
  const parse = j => (typeof j === 'string' ? JSON.parse(j) : (j || {}));
  const isoDate = v => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };

  // ══════════ WHATSAPP PROVIDER (Waumfy / Wati) — settings app_settings me, boot par load ══════════
  const WA_KEYS = { provider: 'wa.provider', key: 'wa.waumfyKey' };
  async function getSetting(k) { const [[r]] = await db.query('SELECT value FROM app_settings WHERE key_name=?', [k]); return r ? r.value : null; }
  async function setSetting(k, v) { await db.query('INSERT INTO app_settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [k, v]); }
  async function loadWaSettings() { const p = await getSetting(WA_KEYS.provider), k = await getSetting(WA_KEYS.key); wati.configure({ provider: p || undefined, waumfyKey: k || undefined }); return { provider: p || '', key: k || '' }; }
  loadWaSettings().then(() => console.log(`  📲 Michelin Ops WhatsApp provider: ${wati.provider()} (${wati.isEnabled() ? 'chalu' : 'config nahi'})`)).catch(e => console.error('wa settings', e.message));
  router.post('/waGetSettings', requireOps, adminOnly, rpc(async () => { const s = await loadWaSettings(); return J({ ok: true, provider: wati.provider(), savedProvider: s.provider, keySet: !!s.key || !!process.env.WAUMFY_API_KEY, keyEnd: (s.key || process.env.WAUMFY_API_KEY || '').slice(-4), enabled: wati.isEnabled(), notify: wati.NOTIFY_NUMBERS }); }));
  router.post('/waSaveSettings', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    if (d.provider !== undefined) { const p = String(d.provider || '').toLowerCase(); if (p && p !== 'waumfy' && p !== 'wati') return err('Provider waumfy ya wati'); await setSetting(WA_KEYS.provider, p); }
    if (d.waumfyKey) await setSetting(WA_KEYS.key, String(d.waumfyKey).trim());
    await loadWaSettings();
    return J({ ok: true, provider: wati.provider(), enabled: wati.isEnabled() });
  }));
  // Test: office number (ya diya hua) par ek chhota message
  router.post('/waTest', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j); const to = clean(d.mobile) || (wati.NOTIFY_NUMBERS[0] || '').slice(-10);
    if (!to) return err('Number nahi');
    const chk = await wati.check();
    const res = wati.provider() === 'waumfy' ? await wati.sendText(to, `Michelin Ops test (${nowIST().dmyhm}) — WhatsApp ${wati.provider()} se chal raha hai.`) : 'SKIP (Wati par template ke bina test nahi)';
    return J({ ok: true, provider: wati.provider(), status: chk.status, error: chk.error || chk.raw || '', sentTo: to, result: res });
  }));

  // ══════════ IMS ══════════
  // items + levels + pichle N din ka snapshot + avg daily sale (snapshot ke girne se) + days cover + status
  router.post('/getIMS', requireOps, rpc(async (u, j) => {
    const d = parse(j); const days = Math.min(60, Math.max(7, parseInt(d.days, 10) || 14));
    const [items] = await db.query('SELECT code, brand, segment, size, position, pattern, tltt, stock, min_level, max_level FROM ops_items ORDER BY brand, segment, id');
    const [snap] = await db.query(`SELECT item_code, DATE_FORMAT(day,'%Y-%m-%d') AS day, stock FROM ops_stock_daily WHERE day >= DATE_SUB(CURRENT_DATE, INTERVAL ? DAY) ORDER BY day`, [days + 30]);
    const [sold] = await db.query(`SELECT code, SUM(qty) AS q FROM ops_stock_log WHERE type='OUT' AND log_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY code`);
    const soldMap = {}; for (const r of sold) soldMap[r.code] = Number(r.q) || 0;
    const byItem = {}; for (const r of snap) (byItem[r.item_code] = byItem[r.item_code] || []).push({ day: r.day, stock: r.stock | 0 });
    const dayList = []; for (let i = days - 1; i >= 0; i--) { const dt = new Date(Date.now() + 330 * 60000 - i * 86400000); dayList.push(dt.toISOString().slice(0, 10)); }
    const out = items.map(it => {
      const hist = byItem[it.code] || [];
      // avg daily sale: snapshot me jitna gira (stock IN ko chhod kar) pichle 30 din me; snapshot na ho to app ke OUT log se
      let drop = 0, span = 0;
      for (let i = 1; i < hist.length; i++) { const dlt = hist[i - 1].stock - hist[i].stock; if (dlt > 0) drop += dlt; span = (new Date(hist[i].day) - new Date(hist[0].day)) / 86400000; }
      const avg = span >= 3 ? drop / span : (soldMap[it.code] || 0) / 30;
      const cover = avg > 0 ? Math.round(it.stock / avg) : null;
      const min = it.min_level | 0, max = it.max_level | 0;
      const status = it.stock <= 0 ? 'OUT' : (min && it.stock < min) ? 'LOW' : (max && it.stock > max) ? 'OVER' : (!min && it.stock <= 10) ? 'LOW' : 'OK';
      const dayMap = {}; hist.forEach(h => { dayMap[h.day] = h.stock; });
      return { code: it.code, brand: it.brand, seg: it.segment, name: `${it.size}${it.position ? ' ' + it.position : ''} ${it.pattern} ${it.tltt}`.replace(/\s+/g, ' ').trim(), stock: it.stock | 0, min, max, avg: Math.round(avg * 10) / 10, cover, status, days: dayList.map(dy => dayMap[dy] === undefined ? null : dayMap[dy]) };
    });
    const counts = { out: 0, low: 0, over: 0, ok: 0 }; out.forEach(o => { counts[o.status.toLowerCase()]++; });
    return J({ ok: true, days: dayList, items: out, counts });
  }));
  router.post('/saveItemLevels', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j); const rows = Array.isArray(d.rows) ? d.rows : [d];
    for (const r of rows) { if (!r.code) continue; await db.query('UPDATE ops_items SET min_level=?, max_level=? WHERE code=?', [Math.max(0, parseInt(r.min, 10) || 0), Math.max(0, parseInt(r.max, 10) || 0), String(r.code)]); }
    return J({ ok: true, n: rows.length });
  }));
  // Raat ko snapshot (Busy import na hua ho us din bhi) — in-process
  if (!IS_SERVERLESS && busyDrive) setInterval(() => { const n = nowIST(); if (n.hour === 23 && n.minute >= 45) busyDrive.snapshotStock(n.iso).catch(() => {}); }, 10 * 60 * 1000);

  // ══════════ ACCESS (users: username/password/perms) ══════════
  router.post('/getAccess', requireOps, adminOnly, rpc(async () => {
    const [rows] = await db.query('SELECT id, name, mobile, role, active, username, password_hash, perms FROM ops_users ORDER BY role=\'DSR\', name');
    return J({ ok: true, pages: ALL_PAGES, users: rows.map(r => ({ id: r.id, name: r.name, mob: r.mobile, role: String(r.role).toUpperCase(), active: !!r.active, username: r.username || r.mobile, hasPassword: !!r.password_hash, perms: parsePerms(r.perms), defaultPerms: defaultPerms(r.role) })) });
  }));
  router.post('/saveAccess', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j);
    const mob = clean(d.mob); if (mob.length !== 10) return err('10-digit mobile daalo');
    const name = String(d.name || '').trim(); if (name.length < 2) return err('Naam daalo');
    const role = ['DSR', 'CRM', 'ADMIN', 'ACCOUNTS', 'BILLING', 'RM'].includes(String(d.role || '').toUpperCase()) ? String(d.role).toUpperCase() : 'DSR';
    const active = d.active === undefined ? 1 : (d.active ? 1 : 0);
    if (mob === u.mob && !active) return err('Khud ko band nahi kar sakte');
    let username = String(d.username || '').trim().toLowerCase().replace(/\s+/g, '');
    if (username) { const [[dup]] = await db.query('SELECT mobile FROM ops_users WHERE username=? AND mobile<>?', [username, mob]); if (dup) return err('Ye username kisi aur ka hai'); }
    const perms = Array.isArray(d.perms) ? d.perms.filter(x => ALL_PAGES.includes(x)) : null;
    await db.query('INSERT INTO ops_users (mobile,name,role,active,username,perms) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), active=VALUES(active), username=VALUES(username), perms=VALUES(perms)',
      [mob, name, role, active, username, perms ? JSON.stringify(perms) : '']);
    if (d.password) { if (String(d.password).length < 4) return err('Password kam se kam 4 akshar'); await db.query('UPDATE ops_users SET password_hash=? WHERE mobile=?', [await bcrypt.hash(String(d.password), 10), mob]); }
    return J({ ok: true });
  }));
  // Apna password badlo (koi bhi user)
  router.post('/changePassword', requireOps, rpc(async (u, j) => {
    const d = parse(j);
    if (!d.password || String(d.password).length < 4) return err('Password kam se kam 4 akshar');
    await db.query('UPDATE ops_users SET password_hash=? WHERE mobile=?', [await bcrypt.hash(String(d.password), 10), u.mob]);
    return J({ ok: true });
  }));

  // ══════════ OUTSTANDING REPORT (Busy) ══════════
  async function outstandingRows() {
    const [rows] = await db.query(`SELECT o.dealer_name, o.mobile, o.amount, o.as_on, p.michelin_amt, p.vk_amt, p.other_amt, DATE_FORMAT(p.due_from,'%Y-%m-%d') AS due_from, DATE_FORMAT(p.last_sale,'%Y-%m-%d') AS last_sale, DATE_FORMAT(p.last_receipt,'%Y-%m-%d') AS last_receipt
      FROM ops_outstanding o LEFT JOIN ops_busy_party p ON p.party_name=o.dealer_name ORDER BY o.amount DESC`);
    const [dealers] = await db.query('SELECT name, mobile, busy_name, added_by FROM ops_dealers WHERE active=1');
    const byName = {}; for (const dl of dealers) { byName[busyDb.nb(dl.busy_name || '')] = dl; byName[busyDb.nb(dl.name)] = byName[busyDb.nb(dl.name)] || dl; }
    const [sent] = await db.query(`SELECT oid AS party, MAX(log_time) AS t FROM ops_notif_log WHERE event='OUTSTANDING' AND status='SENT' GROUP BY oid`);
    const sentMap = {}; for (const r of sent) sentMap[r.party] = r.t; // oid = party ke pehle 24 akshar
    return rows.map(r => {
      const dl = byName[busyDb.nb(r.dealer_name)] || byName[busyDb.nb(r.dealer_name).replace(/\s*\(.*\)$/, '')] || null;
      const amount = Number(r.amount) || 0, mich = Number(r.michelin_amt) || 0, vk = Number(r.vk_amt) || 0, other = Number(r.other_amt) || 0;
      const days = r.due_from ? Math.round((Date.now() - new Date(r.due_from).getTime()) / 86400000) : null;
      return { name: r.dealer_name, mobile: r.mobile || (dl ? clean(dl.mobile) : ''), dsr: dl ? dl.added_by : '', amount, michelin: mich, vk: vk + other, other, dueFrom: r.due_from ? dmyOf(r.due_from) : '', dueDays: days, lastSale: r.last_sale ? dmyOf(r.last_sale) : '', lastReceipt: r.last_receipt ? dmyOf(r.last_receipt) : '', asOn: r.as_on, lastSent: sentMap[String(r.dealer_name).slice(0, 24)] ? dmyOf(new Date(sentMap[String(r.dealer_name).slice(0, 24)]).toISOString()) : '' };
    });
  }
  router.post('/getOutstandingReport', requireOps, adminOnly, rpc(async () => {
    const rows = await outstandingRows();
    const [[meta]] = await db.query('SELECT MAX(fy) AS fy, COUNT(*) AS n FROM ops_busy_ledger');
    return J({ ok: true, rows, ledgerRows: meta.n | 0, fy: meta.fy | 0, templateOk: wati.ENABLED });
  }));

  // ══════════ STATEMENT ══════════
  // FY start (Busy ka saal 1 April se): fy=2026 -> 2026-04-01 (bd.fy = db1YYYY ka YYYY)
  async function fyStart() { const [[m]] = await db.query('SELECT MAX(fy) AS fy FROM ops_busy_ledger'); const y = m && m.fy ? m.fy : new Date().getFullYear(); return `${y}-04-01`; }
  async function statementData(party, from, to) {
    const f = isoDate(from) || await fyStart(), t = isoDate(to) || nowIST().iso;
    const [[p]] = await db.query('SELECT opening FROM ops_busy_party WHERE party_name=?', [party]);
    const [[pre]] = await db.query('SELECT COALESCE(SUM(dr),0) AS dr, COALESCE(SUM(cr),0) AS cr FROM ops_busy_ledger WHERE party_name=? AND vch_date<?', [party, f]);
    const opening = (p ? Number(p.opening) : 0) + Number(pre.dr) - Number(pre.cr);
    const [rows] = await db.query(`SELECT DATE_FORMAT(vch_date,'%Y-%m-%d') AS vch_date, vch_type, vch_no, series, narration, dr, cr FROM ops_busy_ledger WHERE party_name=? AND vch_date BETWEEN ? AND ? ORDER BY vch_date, id`, [party, f, t]);
    const [[o]] = await db.query('SELECT mobile, as_on FROM ops_outstanding WHERE dealer_name=? LIMIT 1', [party]);
    let bal = opening; const lines = rows.map(r => { bal += Number(r.dr) - Number(r.cr); return { date: dmyOf(r.vch_date), type: busyDb.vchName(r.vch_type), no: r.vch_no, series: String(r.series || '').replace(/^\d+/, ''), narration: r.narration, dr: Number(r.dr), cr: Number(r.cr), bal: Math.round(bal * 100) / 100 }; });
    return { party, from: f, to: t, opening: Math.round(opening * 100) / 100, closing: Math.round(bal * 100) / 100, lines, rows, mobile: o ? o.mobile : '', asOn: o ? o.as_on : '' };
  }
  router.post('/getStatement', requireOps, adminOnly, rpc(async (u, j) => { const d = parse(j); if (!d.party) return err('Party naam chahiye'); const s = await statementData(String(d.party), d.from, d.to); return J(Object.assign({ ok: true }, s, { rows: undefined })); }));
  async function statementPdfBuf(party, from, to) {
    const s = await statementData(party, from, to);
    const buf = await buildStatementPdf({ party: s.party, mobile: s.mobile, from: s.from, to: s.to, opening: s.opening, rows: s.rows, asOn: s.asOn });
    return { buf, s };
  }
  // Public link (token me party + period, 45 din valid) — WhatsApp me yahi jaata hai
  function statementToken(party, from, to) { return jwt.sign({ st: 1, p: party, f: from, t: to }, JWT_SECRET, { expiresIn: '45d' }); }
  const fileName = (party, to) => `Statement_${String(party).replace(/[^\w]+/g, '_').slice(0, 40)}_${String(to).replace(/-/g, '')}.pdf`;
  router.get('/statement/:token.pdf', async (req, res) => {
    try {
      const d = jwt.verify(req.params.token, JWT_SECRET); if (!d.st) throw new Error('bad');
      const { buf, s } = await statementPdfBuf(d.p, d.f, d.t);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${fileName(s.party, s.to)}"`); res.send(buf);
    } catch (e) { res.status(404).send('Link galat ya expire ho gaya'); }
  });
  // Admin preview (login ke saath)
  router.get('/statement-preview', requireOps, async (req, res) => {
    try { if (!isAdmin(req.opsUser)) return res.status(403).send('Permission nahi'); const { buf, s } = await statementPdfBuf(String(req.query.party || ''), req.query.from, req.query.to); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${fileName(s.party, s.to)}"`); res.send(buf); }
    catch (e) { res.status(500).send('PDF nahi bana: ' + e.message); }
  });
  router.post('/statementLink', requireOps, adminOnly, rpc(async (u, j) => { const d = parse(j); if (!d.party) return err('Party naam chahiye'); const s = await statementData(String(d.party), d.from, d.to); const url = `${APP_URL}/api/ops/statement/${statementToken(s.party, s.from, s.to)}.pdf`; return J({ ok: true, url, from: s.from, to: s.to, lines: s.lines.length, closing: s.closing }); }));

  // ══════════ WHATSAPP: outstanding (+ statement) ══════════
  // body: { party, mobile?, withStatement, from, to }
  router.post('/sendOutstandingWa', requireOps, adminOnly, rpc(async (u, j) => {
    const d = parse(j); const party = String(d.party || '').trim(); if (!party) return err('Party naam chahiye');
    const rows = await outstandingRows(); const r = rows.find(x => x.name === party);
    if (!r) return err('Outstanding list me ye party nahi');
    if (r.amount <= 0) return err('Is party ka bakaya 0 / advance hai — message nahi bhejte');
    const mob = clean(d.mobile || r.mobile); if (mob.length !== 10) return err('Dealer ka mobile nahi mila — Dealers me mobile set karo ya yahan daalo');
    let statementLine = 'Statement ke liye office se sampark karein', url = '', pdfStatus = '';
    let s = null;
    if (d.withStatement) {
      s = await statementData(party, d.from, d.to);
      url = `${APP_URL}/api/ops/statement/${statementToken(s.party, s.from, s.to)}.pdf`;
      statementLine = `Account statement (${dmyOf(s.from)} - ${dmyOf(s.to)}): ${url}`;
    }
    const res = await wati.send(mob, wati.T.OUTSTANDING, [party, wati.fmtR(r.amount), r.dueFrom || '-', statementLine]);
    await db.query('INSERT INTO ops_notif_log (notif_key, event, oid, to_number, status) VALUES (?,?,?,?,?)', [`OUTS|${party.slice(0, 60)}|${mob}|${Date.now()}`, 'OUTSTANDING', party.slice(0, 24), wati.watiMob(mob), res === 'SENT' ? 'SENT' : res.slice(0, 120)]).catch(() => {});
    if (res !== 'SENT') return err('Message send nahi hua: ' + res + (/(does not exist|not found|template)/i.test(res) ? ' — Wati me template "michelin_outstanding" banana/approve karana hoga' : ''));
    if (s) { try { const { buf } = await statementPdfBuf(party, s.from, s.to); pdfStatus = await wati.sendFile(mob, buf, fileName(party, s.to), `Account statement ${dmyOf(s.from)} - ${dmyOf(s.to)}`); } catch (e) { pdfStatus = 'FAIL:' + e.message.slice(0, 60); } }
    return J({ ok: true, sentTo: mob, url, pdf: pdfStatus, note: pdfStatus && pdfStatus !== 'SENT' ? 'PDF file seedha nahi gaya (WhatsApp 24-ghante session nahi tha) — link message me chala gaya hai' : '' });
  }));
};
module.exports.ALL_PAGES = ALL_PAGES;
module.exports.defaultPerms = defaultPerms;
module.exports.parsePerms = parsePerms;
