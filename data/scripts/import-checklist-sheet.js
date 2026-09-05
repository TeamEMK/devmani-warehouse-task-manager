// Google Sheet ka "checklist ledger" (har row = ek occurrence) DB me daalna.
//
//   node data/scripts/import-checklist-sheet.js <file.csv> [--dry-run] [--from YYYY-MM-DD] [--assigned-by email] [--no-sql]
//
// --from do to sirf us date se (inclusive) wali planned rows aati hain — purana
// history chhod kar sirf aage ke tasks chahiye ho to.
//
// Ye import-checklist.js se alag hai: wahan template rows hoti hain jo
// frequency se expand hoti hain; yahan sheet me pehle se har date ki row hai,
// to seedha row-by-row daalte hain. Sheet ke columns (naam se pehchaane jaate hain):
//
//   Doer Name, Email, Department, Task ID, Frequency (D/W/F/M/Q/Y), Task Name,
//   Planned Date (DD/MM/YYYY), Actual Date (DD/MM/YYYY [HH:MM:SS]), Status
//   (Drive proof link), Photo (Drive link), Transfer Status (Deferred/Transferred),
//   Transferred To (→ nayi date), MOBILE NUMBER
//
// Mapping:
//   description  = Task Name          assigned_to = Email se user (na mile to bana do)
//   due_date     = Planned Date       frequency   = D→daily W→weekly F→alternative_week M→monthly Q→quarterly Y→yearly
//   status       = Actual Date hai to 'completed' (completed_at = Actual Date), warna 'pending'
//   remarks      = "Proof: <link>" / "Deferred → dd/mm/yyyy" / "Transferred → dd/mm/yyyy" (jo ho)
//
// Dobara chalana safe hai: (user, task, due_date) jo DB me pehle se hai skip.
// Sheet ke andar bhi same (user, task, date) ki duplicate row skip hoti hai.
//
// --no-sql na do to data/migrations/mysql/seed-checklist.sql bhi likhta hai —
// ensure-schema.js ise tab chalata hai jab checklist_tasks khali ho (production
// par pehli deploy ke saath tasks pahunchane ke liye; DB tak seedha raasta nahi hai).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');

const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
if (!file) { console.error('usage: node data/scripts/import-checklist-sheet.js <file.csv> [--dry-run] [--from YYYY-MM-DD] [--assigned-by email] [--no-sql]'); process.exit(1); }
const DRY = flag('--dry-run');
const WRITE_SQL = !flag('--no-sql');
const ASSIGNED_BY = opt('--assigned-by', null);
const FROM = opt('--from', null);
const DEFAULT_PASSWORD = 'pass123';
const MIGR = path.join(__dirname, '..', 'migrations', 'mysql');
const SEED_USERS = path.join(MIGR, 'seed-users.sql');
const SEED_CHECKLIST = path.join(MIGR, 'seed-checklist.sql');

function parseRows(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(f => (f || '').trim()));
}
const FREQ = { d: 'daily', w: 'weekly', f: 'alternative_week', m: 'monthly', q: 'quarterly', y: 'yearly',
  daily: 'daily', weekly: 'weekly', fortnightly: 'alternative_week', monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' };
// "DD/MM/YYYY" ya "DD/MM/YYYY HH:MM:SS" -> { date:'YYYY-MM-DD', ts:'YYYY-MM-DD HH:MM:SS'|null }
function parseDT(v) {
  v = (v || '').trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const date = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const ts = m[4] ? `${date} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}` : null;
    return { date, ts };
  }
  const n = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
  if (n) return { date: n[1], ts: n[2] ? `${n[1]} ${n[2].length === 5 ? n[2] + ':00' : n[2]}` : null };
  return null;
}
const sq = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
const sqlv = v => (v === null || v === undefined) ? 'NULL' : `'${sq(v)}'`;

(async () => {
  const rows = parseRows(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map(h => (h || '').trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
  const C = {
    name: col('doer_name', 'name', 'employee'), email: col('email', 'user_email'), dept: col('department'),
    freq: col('frequency'), task: col('task_name', 'task', 'description'), planned: col('planned_date', 'due_date'),
    actual: col('actual_date', 'completed_date'), status: col('status'), photo: col('photo'),
    transfer: col('transfer_status'), transferTo: col('transferred_to'), phone: col('mobile_number', 'phone', 'mobile'),
  };
  console.log('header:', header.join(' | '));
  for (const k of ['email', 'task', 'planned']) if (C[k] === -1) throw new Error(`column "${k}" nahi mila`);

  const [adm] = ASSIGNED_BY
    ? await db.query('SELECT id,name FROM users WHERE LOWER(email)=LOWER(?)', [ASSIGNED_BY])
    : await db.query("SELECT id,name FROM users WHERE role='admin' ORDER BY id LIMIT 1");
  if (!adm.length) throw new Error('admin user nahi mila (--assigned-by do)');
  const adminId = adm[0].id;
  console.log(`assigned_by: ${adm[0].name} (id ${adminId})${DRY ? '   [DRY RUN]' : ''}`);

  const [users] = await db.query('SELECT id,name,email FROM users');
  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  const createdUsers = [];
  async function resolveUser(email, name, dept, phone) {
    let u = byEmail.get(email.toLowerCase());
    if (u) return u;
    const rec = { name: name || email.split('@')[0], email, phone: phone || '', department: dept || '' };
    if (DRY) rec.id = -(createdUsers.length + 1);
    else {
      rec.hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
      const [r] = await db.query('INSERT INTO users (name,email,password,role,phone,department,week_off,staff_type) VALUES (?,?,?,?,?,?,?,?)',
        [rec.name, email, rec.hash, 'user', rec.phone, rec.department, '0', 'office']);
      rec.id = r.insertId;
    }
    byEmail.set(email.toLowerCase(), rec); createdUsers.push(rec);
    console.log(`  👤 naya user: ${rec.name} <${email}>`);
    return rec;
  }

  // DB me jo (user, task, date) pehle se hain
  const existing = new Set();
  const [ex] = await db.query("SELECT assigned_to a, description d, DATE_FORMAT(due_date,'%Y-%m-%d') dt FROM checklist_tasks");
  for (const x of ex) existing.add(`${x.a}|${x.d}|${x.dt}`);

  const out = []; // rows to insert
  const sqlRows = []; // for seed-checklist.sql (poora sheet, DB-dedupe se alag)
  const seenInFile = new Set();
  let skipped = 0, dupFile = 0, dupDb = 0, completed = 0, sundays = 0, beforeFrom = 0;
  if (FROM) console.log(`sirf ${FROM} se aage ki planned dates li jayengi`);
  const stats = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; const g = i => (i === -1 ? '' : (row[i] || '').trim());
    const task = g(C.task), email = g(C.email);
    const planned = parseDT(g(C.planned));
    if (!task || !email || !planned) { console.log(`  ✗ row ${r + 1}: task/email/planned date adhoora — skip`); skipped++; continue; }
    if (FROM && planned.date < FROM) { beforeFrom++; continue; }
    const freq = FREQ[g(C.freq).toLowerCase()] || null;
    if (g(C.freq) && !freq) console.log(`  ⚠ row ${r + 1}: frequency "${g(C.freq)}" unknown — NULL rakhi`);
    const user = await resolveUser(email, g(C.name), g(C.dept), g(C.phone));
    const actual = parseDT(g(C.actual));
    let status = 'pending', completedAt = null;
    if (actual) {
      status = 'completed';
      // 1970 jaisi kachri date = sheet ka bug; planned date hi maan lo
      completedAt = actual.date < '2000-01-01' ? `${planned.date} 00:00:00` : (actual.ts || `${actual.date} 00:00:00`);
      completed++;
    }
    const remarks = [];
    const proof = [g(C.status), g(C.photo)].find(v => /^https?:\/\//i.test(v));
    if (proof) remarks.push(`Proof: ${proof}`);
    else if (/PHOTO_SAVE_FAILED/i.test(g(C.status) + g(C.photo))) remarks.push('Proof: photo save failed (sheet)');
    const tr = g(C.transfer), trTo = g(C.transferTo).replace(/^→\s*/, '');
    if (tr) remarks.push(trTo ? `${tr} → ${trTo}` : tr);
    if (new Date(planned.date + 'T00:00:00Z').getUTCDay() === 0) sundays++;

    const key = `${user.id}|${task}|${planned.date}`;
    if (seenInFile.has(key)) { dupFile++; continue; }
    seenInFile.add(key);
    const rec = { task, userId: user.id, email, due: planned.date, status, completedAt, remarks: remarks.join(' | '), freq };
    sqlRows.push(rec);
    if (existing.has(key)) { dupDb++; continue; }
    out.push(rec);
    stats[user.name] = (stats[user.name] || 0) + 1;
  }

  if (!DRY && out.length) {
    for (let i = 0; i < out.length; i += 500) {
      const chunk = out.slice(i, i + 500).map(o => [o.task, o.userId, adminId, o.due, o.status, 'low', o.remarks, o.freq, o.completedAt]);
      await db.query('INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,remarks,frequency,completed_at) VALUES ?', [chunk]);
    }
  }

  if (!DRY && createdUsers.length) {
    const lines = createdUsers.map(u =>
      `INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)\n` +
      `VALUES ('${sq(u.name)}', '${sq(u.email)}', '${u.hash}', 'user', '${sq(u.phone)}', '${sq(u.department)}', '0', 'office');`);
    fs.appendFileSync(SEED_USERS, '\n' + lines.join('\n') + '\n');
    console.log(`  📝 ${createdUsers.length} naye users seed-users.sql me append kiye`);
  }

  if (!DRY && WRITE_SQL) {
    // Production ke liye: users email se JOIN hote hain (id alag ho sakte hain),
    // assigned_by = pehla admin. ensure-schema.js ise sirf khali table par chalata hai.
    const head = [
      '-- Checklist ledger seed (Google Sheet se, data/scripts/import-checklist-sheet.js ne banaya).',
      '-- ensure-schema.js ise SIRF tab chalata hai jab checklist_tasks khali ho — dobara nahi.',
      `-- Rows: ${sqlRows.length}${FROM ? ` (planned date >= ${FROM})` : ''}. Generated: ${new Date().toISOString().slice(0, 10)}.`,
      'SET @admin_id = (SELECT id FROM users WHERE role=\'admin\' ORDER BY id LIMIT 1);',
    ];
    const stmts = [];
    for (let i = 0; i < sqlRows.length; i += 200) {
      const vals = sqlRows.slice(i, i + 200).map(o =>
        `(${sqlv(o.task)}, (SELECT id FROM users WHERE LOWER(email)=${sqlv(o.email.toLowerCase())} LIMIT 1), @admin_id, ${sqlv(o.due)}, ${sqlv(o.status)}, 'low', ${sqlv(o.remarks)}, ${sqlv(o.freq)}, ${sqlv(o.completedAt)})`);
      stmts.push('INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,remarks,frequency,completed_at) VALUES\n' + vals.join(',\n') + ';');
    }
    fs.writeFileSync(SEED_CHECKLIST, head.join('\n') + '\n' + stmts.join('\n') + '\n');
    console.log(`  📝 seed-checklist.sql likhi (${sqlRows.length} rows, ${stmts.length} statements)`);
  }

  console.log('\n── summary ──');
  console.log(`sheet rows        : ${rows.length - 1}`);
  console.log(`inserted          : ${out.length}${DRY ? ' (dry run)' : ''}   (completed ${out.filter(o => o.status === 'completed').length}, pending ${out.filter(o => o.status === 'pending').length})`);
  console.log(`already in DB     : ${dupDb}`);
  console.log(`dup in sheet      : ${dupFile}`);
  console.log(`skipped (bad row) : ${skipped}`);
  if (FROM) console.log(`before ${FROM}  : ${beforeFrom} (chhode)`);
  console.log(`sunday due dates  : ${sundays} (rakhe gaye — sheet ka record hai)`);
  console.log(`users created     : ${createdUsers.length}`);
  for (const [n, c] of Object.entries(stats)) console.log(`   ${n.padEnd(20)} ${c}`);
  await db.end();
})().catch(e => { console.error('import failed:', e.message); process.exit(1); });
