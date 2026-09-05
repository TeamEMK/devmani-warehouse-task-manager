// Checklist sheet (CSV/TSV) se users + checklist tasks DB me daalne ka script.
//
//   node data/scripts/import-checklist.js <file.csv> [--dry-run] [--start YYYY-MM-DD]
//                                         [--assigned-by admin@x.com] [--no-seed]
//
// Ye wahi karta hai jo app ka "Upload CSV" (Checklist modal) karta hai, bas
// server par — aur upar se jo user sheet me hai par DB me nahi, use bana bhi
// deta hai (password pass123, role user, Sunday off).
//
// Columns naam se pehchaane jaate hain, order se nahi. Pehchaane jaane wale:
//   user      : user_email / email / doer_email  (ya) name / employee / employee_name / doer / assigned_to
//   frequency : frequency / freq                  (D/W/M/F/Y/Q ya daily/weekly/...)
//   task      : description / task / task_name / checklist / activity
//   date      : due_date / start_date / date / next_due_date   (DD/MM/YYYY ya YYYY-MM-DD; khali ho to --start, warna aaj)
//   optional  : remarks, department, phone, priority
//
// Date expansion frontend ke generateDates jaisa hi hai: daily=365, weekly=52,
// alt-week=26, monthly=12, quarterly=4, yearly=1 occurrences. Daily me Sunday/
// week-off/extra-off ke din agle din khisak jaate hain; baaki cadence me Sunday
// ka occurrence ban-ta nahi par ginti me kharch ho jaata hai.
//
// Dobara chalana safe hai: (user, task, due_date) jo pehle se hai wo skip hota hai.
// Naye users seed-users.sql me bhi append hote hain (--no-seed se band) taaki
// production par deploy ke saath ban jayein.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const file = argv.find(a => !a.startsWith('--'));
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
if (!file) { console.error('usage: node data/scripts/import-checklist.js <file.csv> [--dry-run] [--start YYYY-MM-DD] [--assigned-by email] [--no-seed]'); process.exit(1); }
const DRY = flag('--dry-run');
const START_DEFAULT = opt('--start', todayISO());
const ASSIGNED_BY = opt('--assigned-by', null);
const WRITE_SEED = !flag('--no-seed');
const DEFAULT_PASSWORD = 'pass123';
const SEED_FILE = path.join(__dirname, '..', 'migrations', 'mysql', 'seed-users.sql');

// ── CSV parsing (quotes, commas, tabs, BOM, CRLF) ───────────────────────
function parseRows(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(f => (f || '').trim()));
}

const FREQ_MAP = {
  d: 'daily', w: 'weekly', m: 'monthly', f: 'alternative_week', y: 'yearly', q: 'quarterly',
  daily: 'daily', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', quarterly: 'quarterly', annual: 'yearly', annually: 'yearly',
  alternative_week: 'alternative_week', fortnightly: 'alternative_week', alternate_week: 'alternative_week', biweekly: 'alternative_week', 'bi-weekly': 'alternative_week',
  'half-yearly': 'quarterly', half_yearly: 'quarterly',
};
function toISO(v) {
  v = (v || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const p = v.split(/[\/\-.]/).map(x => x.trim());
  if (p.length === 3 && p[0].length <= 2) {
    const y = p[2].length === 2 ? '20' + p[2] : p[2];
    return `${y}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  }
  return null;
}
function todayISO() { const d = new Date(); return iso(d); }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// ── frontend/js/app.js generateDates ka server copy ─────────────────────
function generateDates(startDate, freq, weekOffStr, extraOffStr) {
  const dates = [];
  const d = new Date(startDate + 'T00:00:00');
  const counts = { daily: 365, weekly: 52, alternative_week: 26, monthly: 12, quarterly: 4, yearly: 1 };
  const count = counts[freq];
  const weekOff = (weekOffStr || '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  let extraOff = [];
  try { extraOff = extraOffStr ? JSON.parse(extraOffStr) : []; } catch (e) { }
  const isExtraOff = date => { const nth = Math.ceil(date.getDate() / 7); return extraOff.some(e => e.day === date.getDay() && e.weeks.includes(nth)); };
  let added = 0, safety = count * 14;
  while (added < count && safety-- > 0) {
    const day = d.getDay();
    if (freq === 'daily') {
      if (day === 0 || weekOff.includes(day) || isExtraOff(d)) { d.setDate(d.getDate() + 1); continue; }
      dates.push(iso(d)); added++; d.setDate(d.getDate() + 1); continue;
    }
    if (day !== 0) dates.push(iso(d));
    added++;
    if (freq === 'weekly') d.setDate(d.getDate() + 7);
    else if (freq === 'alternative_week') d.setDate(d.getDate() + 14);
    else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else break;
  }
  return dates;
}

const slugEmail = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') + '@devmani.net';
const sq = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");

(async () => {
  const rows = parseRows(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) throw new Error('file me header ke alawa kuch nahi');
  const header = rows[0].map(h => (h || '').trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
  const iEmail = col('user_email', 'email', 'doer_email', 'email_id');
  const iName = col('name', 'employee', 'employee_name', 'doer', 'assigned_to', 'user', 'user_name', 'person', 'staff');
  const iFreq = col('frequency', 'freq');
  const iDesc = col('description', 'task', 'task_name', 'checklist', 'activity', 'task_description', 'work');
  const iDate = col('due_date', 'start_date', 'next_due_date', 'new_date', 'date');
  const iRem = col('remarks', 'remark');
  const iDept = col('department', 'dept');
  const iPhone = col('phone', 'mobile', 'contact');
  const iPrio = col('priority');
  console.log('header:', header.join(' | '));
  if (iDesc === -1 || (iEmail === -1 && iName === -1)) throw new Error('task/description aur user_email ya name column zaroori hai');
  if (iFreq === -1) console.log('⚠️  frequency column nahi mila — sab rows daily maani jayengi');
  if (iDate === -1) console.log(`⚠️  due_date column nahi mila — start date ${START_DEFAULT} li jayegi`);

  // admin jo assigned_by banega
  const [adm] = ASSIGNED_BY
    ? await db.query('SELECT id,name FROM users WHERE LOWER(email)=LOWER(?)', [ASSIGNED_BY])
    : await db.query("SELECT id,name FROM users WHERE role='admin' ORDER BY id LIMIT 1");
  if (!adm.length) throw new Error('koi admin user nahi mila (--assigned-by do)');
  const adminId = adm[0].id;
  console.log(`assigned_by: ${adm[0].name} (id ${adminId})${DRY ? '   [DRY RUN — DB me kuch nahi likha jayega]' : ''}`);

  const [users] = await db.query('SELECT id,name,email,week_off,extra_off FROM users');
  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  const byName = new Map(users.map(u => [u.name.trim().toLowerCase(), u]));
  const createdUsers = [];
  let nextFakeId = -1;

  async function resolveUser(email, name, dept, phone) {
    let u = email ? byEmail.get(email.toLowerCase()) : null;
    if (!u && name) u = byName.get(name.trim().toLowerCase());
    if (u) return u;
    if (!email && !name) return null;
    const em = email || slugEmail(name);
    const nm = (name || email.split('@')[0]).trim();
    const rec = { name: nm, email: em, phone: phone || '', department: dept || '', week_off: '0', extra_off: null };
    if (DRY) { rec.id = nextFakeId--; }
    else {
      const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
      const [r] = await db.query(
        'INSERT INTO users (name,email,password,role,phone,department,week_off,staff_type) VALUES (?,?,?,?,?,?,?,?)',
        [nm, em, hash, 'user', rec.phone, rec.department, '0', 'office']);
      rec.id = r.insertId; rec.hash = hash;
    }
    byEmail.set(em.toLowerCase(), rec); byName.set(nm.toLowerCase(), rec);
    createdUsers.push(rec);
    console.log(`  👤 naya user: ${nm} <${em}>${email ? '' : '   (email sheet me nahi tha — banaya gaya)'}`);
    return rec;
  }

  let inserted = 0, dup = 0, skipped = 0;
  const perUser = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const g = i => (i === -1 ? '' : (row[i] || '').trim());
    const desc = g(iDesc);
    if (!desc) { skipped++; continue; }
    const freqRaw = g(iFreq).toLowerCase();
    const freq = iFreq === -1 ? 'daily' : FREQ_MAP[freqRaw];
    if (!freq) { console.log(`  ✗ row ${r + 1}: frequency "${g(iFreq)}" samajh nahi aayi — skip`); skipped++; continue; }
    const start = iDate === -1 || !g(iDate) ? START_DEFAULT : toISO(g(iDate));
    if (!start) { console.log(`  ✗ row ${r + 1}: date "${g(iDate)}" samajh nahi aayi — skip`); skipped++; continue; }
    const user = await resolveUser(g(iEmail), g(iName), g(iDept), g(iPhone));
    if (!user) { console.log(`  ✗ row ${r + 1}: na email na name — skip`); skipped++; continue; }
    const prio = ['low', 'medium', 'high'].includes(g(iPrio).toLowerCase()) ? g(iPrio).toLowerCase() : 'low';

    const dates = generateDates(start, freq, user.week_off || '', user.extra_off || '');
    if (!dates.length) { console.log(`  ✗ row ${r + 1}: koi date nahi bani (Sunday start?) — skip`); skipped++; continue; }

    let existing = new Set();
    if (!DRY && user.id > 0) {
      const [ex] = await db.query(
        "SELECT DATE_FORMAT(due_date,'%Y-%m-%d') AS d FROM checklist_tasks WHERE assigned_to=? AND description=?", [user.id, desc]);
      existing = new Set(ex.map(x => x.d));
    }
    const fresh = dates.filter(d => !existing.has(d));
    dup += dates.length - fresh.length;
    if (fresh.length && !DRY) {
      const values = fresh.map(d => [desc, user.id, adminId, d, 'pending', prio, g(iRem), freq]);
      await db.query('INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,remarks,frequency) VALUES ?', [values]);
    }
    inserted += fresh.length;
    perUser[user.name] = (perUser[user.name] || 0) + fresh.length;
    console.log(`  ✔ ${user.name.padEnd(18)} ${freq.padEnd(16)} ${start}  ×${fresh.length}${dates.length - fresh.length ? ` (${dates.length - fresh.length} pehle se)` : ''}  ${desc}`);
  }

  if (createdUsers.length && WRITE_SEED && !DRY) {
    const lines = createdUsers.map(u =>
      `INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)\n` +
      `VALUES ('${sq(u.name)}', '${sq(u.email)}', '${u.hash}', 'user', '${sq(u.phone)}', '${sq(u.department)}', '0', 'office');`);
    fs.appendFileSync(SEED_FILE, '\n' + lines.join('\n') + '\n');
    console.log(`  📝 ${createdUsers.length} naye users seed-users.sql me append kiye (prod deploy par ban jayenge)`);
  }

  console.log('\n── summary ──');
  console.log(`tasks inserted : ${inserted}${DRY ? ' (dry run)' : ''}`);
  console.log(`already there  : ${dup}`);
  console.log(`rows skipped   : ${skipped}`);
  console.log(`users created  : ${createdUsers.length}`);
  for (const [n, c] of Object.entries(perUser)) console.log(`   ${n.padEnd(20)} ${c}`);
  if (createdUsers.length) console.log(`\nnaye users ka password: ${DEFAULT_PASSWORD}`);
  await db.end();
})().catch(e => { console.error('import failed:', e.message); process.exit(1); });
