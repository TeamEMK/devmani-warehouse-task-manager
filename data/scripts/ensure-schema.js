// Fresh database ko boot par poora karna.
//
// Hosting panels par database kabhi bhi udd sakta hai (website delete hote hi
// juda database bhi chala jaata hai) — aur wahan shell nahi milta jisse
// db:migrate chalayen. Isliye start.js pehle ye chalata hai: agar users table
// nahi mili to data/migrations/mysql/bootstrap.sql statement-by-statement
// chala do. Har statement apne try/catch me hai — jo cheez pehle se bani hai
// (ya is server par support nahi, jaise MariaDB me functional index) wo bas
// skip ho jaati hai. Isliye aadha-adhoora import bhi theek ho jaata hai.
//
// Uske baad HAR boot par seed-users.sql chalta hai — staff ki list wahan
// INSERT IGNORE se hai, to jo pehle se hain wo chhoot jaate hain aur naye ban
// jaate hain. Production DB tak seedha pahunch nahi hai, isliye naye users
// deploy ke saath hi pahunchte hain.
// Aur seed-checklist.sql (Google Sheet ka checklist ledger) sirf tab chalti hai
// jab checklist_tasks khali ho — pehli deploy par tasks pahunchane ke liye.
const fs = require('fs');
const path = require('path');
// Seedha CLI se chalane par .env yahin se aata hai (server me start.js/server.js
// pehle hi load kar chuka hota hai).
if (require.main === module) require('dotenv').config();
const db = require('../db');

const MIGR = path.join(__dirname, '..', 'migrations', 'mysql');
const BOOTSTRAP = path.join(MIGR, 'bootstrap.sql');
const SEED_USERS = path.join(MIGR, 'seed-users.sql');
// Checklist ledger (Google Sheet se) — sirf tab jab table bilkul khali ho.
const SEED_CHECKLIST = path.join(MIGR, 'seed-checklist.sql');
// Michelin Ops (DSR order app) — tables har boot par (CREATE TABLE IF NOT
// EXISTS), aur sheet ka data sirf tab jab ops_items khali ho.
const OPS_SCHEMA = path.join(MIGR, '005_ops.sql');
const SEED_OPS = path.join(MIGR, 'seed-ops.sql');

function splitStatements(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function runFile(file, label) {
  let ok = 0, skipped = 0;
  for (const st of splitStatements(file)) {
    try { await db.query(st); ok++; }
    catch (err) { skipped++; console.log('   skip:', err.message.slice(0, 120)); }
  }
  console.log(`✅ ${label} done — ${ok} chale, ${skipped} skip hue`);
}

async function ensureSchema() {
  let created = false;
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
  } catch (e) {
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(e.message)) throw e;
    console.log('⚠️  users table nahi mili — database bootstrap chala rahe hain…');
    await runFile(BOOTSTRAP, 'bootstrap');
    created = true;
  }

  // Staff seed — idempotent, har boot par. Kitne naye bane wo count se dikhta hai.
  if (fs.existsSync(SEED_USERS)) {
    const [[before]] = await db.query('SELECT COUNT(*) AS n FROM users');
    await runFile(SEED_USERS, 'seed-users');
    const [[after]] = await db.query('SELECT COUNT(*) AS n FROM users');
    if (after.n > before.n) console.log(`   ${after.n - before.n} naye user bane`);
  }

  // Checklist seed — ek baar, sirf khali table par. INSERT IGNORE se idempotent
  // nahi ban sakta (koi unique key nahi), isliye count se guard hai.
  if (fs.existsSync(SEED_CHECKLIST)) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM checklist_tasks');
    if (c.n === 0) {
      console.log('⚠️  checklist_tasks khali hai — seed-checklist.sql chala rahe hain…');
      await runFile(SEED_CHECKLIST, 'seed-checklist');
      const [[after]] = await db.query('SELECT COUNT(*) AS n FROM checklist_tasks');
      console.log(`   ${after.n} checklist tasks bane`);
    }
  }

  // Michelin Ops tables — purane database par bhi. Sab IF NOT EXISTS hain,
  // isliye har boot par chalana sasta aur safe hai.
  if (fs.existsSync(OPS_SCHEMA)) {
    let ran = 0;
    for (const st of splitStatements(OPS_SCHEMA)) {
      try { await db.query(st); ran++; } catch (err) { console.log('   ops schema skip:', err.message.slice(0, 120)); }
    }
    if (fs.existsSync(SEED_OPS)) {
      const [[c]] = await db.query('SELECT COUNT(*) AS n FROM ops_items');
      if (c.n === 0) {
        console.log('⚠️  ops_items khali hai — seed-ops.sql (MICHELIN OPS sheet ka data) chala rahe hain…');
        await runFile(SEED_OPS, 'seed-ops');
        const [[after]] = await db.query('SELECT COUNT(*) AS n FROM ops_items');
        console.log(`   ${after.n} ops items bane`);
      }
    }
  }
  return created;
}

module.exports = ensureSchema;

if (require.main === module) {
  ensureSchema()
    .then(ran => { console.log(ran ? 'schema banaya gaya' : 'schema pehle se tha'); return db.end(); })
    .catch(e => { console.error('bootstrap failed:', e.message); process.exit(1); });
}
