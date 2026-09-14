// ══════════════════════════════════════════════════════
// OPS ACCESS — main app (users) <-> Michelin Ops (ops_users) ka rishta
// ══════════════════════════════════════════════════════
// 14-Sep-2026 se Michelin Ops ka access main app ke Users page se milta hai:
//   users (email login)  --main_user_id-->  ops_users (role DSR/CRM/.../ADMIN, perms, mobile)
// Main app me logged-in user /ops iframe me bina doosre login ke aata hai (/api/ops/sso).
// DSR jo seedha phone par /ops kholte hain, unke liye username/password login waise hi hai.
//
// ops_users.mobile unique + NOT NULL hai — main user ka phone na ho to synthetic
// '0' + id (10 digit) rakhte hain; watiMob() '0' se shuru number ko reject karta hai,
// isliye us par WhatsApp kabhi nahi jaata.

const bcrypt = require('bcryptjs');
const OPS_ROLES = ['DSR', 'CRM', 'ADMIN', 'ACCOUNTS', 'BILLING', 'RM'];
const OPS_PAGES = ['home', 'order', 'orders', 'crm', 'stock', 'ims', 'dealers', 'reports', 'track', 'day', 'route', 'exp', 'tally', 'masters'];
const digits10 = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const syntheticMobile = id => '0' + String(id).padStart(9, '0');

// Main users ki list ke saath ops info: { [mainUserId]: { role, perms, active, hasPassword, mobile, username } }
async function opsInfoMap(db, mainUsers) {
  if (!mainUsers.length) return {};
  const ids = mainUsers.map(u => u.id);
  const phones = mainUsers.map(u => digits10(u.phone)).filter(Boolean);
  const [rows] = await db.query(`SELECT id, main_user_id, mobile, username, role, active, perms, password_hash FROM ops_users WHERE main_user_id IN (?)${phones.length ? ' OR (main_user_id IS NULL AND mobile IN (?))' : ''}`, phones.length ? [ids, phones] : [ids]);
  const byMain = {}, byMob = {};
  for (const r of rows) { if (r.main_user_id) byMain[r.main_user_id] = r; else byMob[r.mobile] = r; }
  const out = {};
  for (const u of mainUsers) {
    const r = byMain[u.id] || byMob[digits10(u.phone)];
    if (!r) continue;
    let perms = []; try { perms = JSON.parse(r.perms || '[]'); } catch (_) {}
    out[u.id] = { role: String(r.role).toUpperCase(), perms: Array.isArray(perms) ? perms : [], active: !!r.active, hasPassword: !!r.password_hash, mobile: r.mobile, username: r.username || '', linked: !!r.main_user_id };
  }
  return out;
}

// Main user ke liye ops_users row dhoondo (main_user_id, phir phone se) — mile to link kar do
async function opsUserForMain(db, mainUser) {
  let [rows] = await db.query('SELECT * FROM ops_users WHERE main_user_id=? LIMIT 1', [mainUser.id]);
  if (rows[0]) return rows[0];
  const mob = digits10(mainUser.phone);
  if (mob) {
    [rows] = await db.query('SELECT * FROM ops_users WHERE mobile=? AND main_user_id IS NULL LIMIT 1', [mob]);
    if (rows[0]) { await db.query('UPDATE ops_users SET main_user_id=? WHERE id=?', [mainUser.id, rows[0].id]); rows[0].main_user_id = mainUser.id; return rows[0]; }
  }
  return null;
}

// Users page se: ops role '' = access band (active=0). perms array, password optional.
async function upsertOpsForMain(db, mainUser, { opsRole, perms, password }) {
  const role = OPS_ROLES.includes(String(opsRole || '').toUpperCase()) ? String(opsRole).toUpperCase() : '';
  const existing = await opsUserForMain(db, mainUser);
  const permsJson = Array.isArray(perms) ? JSON.stringify(perms.filter(p => OPS_PAGES.includes(p))) : (existing ? existing.perms : '');
  const username = String(mainUser.email || '').trim().toLowerCase() || (existing ? existing.username : '');
  const mob = digits10(mainUser.phone) || (existing ? existing.mobile : syntheticMobile(mainUser.id));
  if (!role) {
    if (existing) await db.query('UPDATE ops_users SET active=0 WHERE id=?', [existing.id]);
    return { active: false };
  }
  if (existing) {
    // Mobile badla ho (aur naya number kisi aur ka na ho) to update
    const [[clash]] = await db.query('SELECT id FROM ops_users WHERE mobile=? AND id<>?', [mob, existing.id]);
    await db.query('UPDATE ops_users SET name=?, role=?, active=1, perms=?, username=?, main_user_id=?, mobile=? WHERE id=?', [mainUser.name, role, permsJson, username, mainUser.id, clash ? existing.mobile : mob, existing.id]);
    if (password) await db.query('UPDATE ops_users SET password_hash=? WHERE id=?', [await bcrypt.hash(String(password), 10), existing.id]);
    return { active: true, id: existing.id };
  }
  const [[clash]] = await db.query('SELECT id FROM ops_users WHERE mobile=?', [mob]);
  const finalMob = clash ? syntheticMobile(mainUser.id) : mob;
  const hash = password ? await bcrypt.hash(String(password), 10) : '';
  const [r] = await db.query('INSERT INTO ops_users (mobile, name, role, active, username, perms, password_hash, main_user_id) VALUES (?,?,?,?,?,?,?,?)', [finalMob, mainUser.name, role, 1, username, permsJson, hash, mainUser.id]);
  return { active: true, id: r.insertId };
}

module.exports = { OPS_ROLES, OPS_PAGES, digits10, syntheticMobile, opsInfoMap, opsUserForMain, upsertOpsForMain };
