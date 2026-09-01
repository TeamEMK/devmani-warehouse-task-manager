// Fresh database ko boot par poora karna.
//
// Hosting panels par database kabhi bhi udd sakta hai (website delete hote hi
// juda database bhi chala jaata hai) — aur wahan shell nahi milta jisse
// db:migrate chalayen. Isliye start.js pehle ye chalata hai: agar users table
// nahi mili to data/migrations/mysql/bootstrap.sql statement-by-statement
// chala do. Har statement apne try/catch me hai — jo cheez pehle se bani hai
// (ya is server par support nahi, jaise MariaDB me functional index) wo bas
// skip ho jaati hai. Isliye aadha-adhoora import bhi theek ho jaata hai.
const fs = require('fs');
const path = require('path');
const db = require('../db');

const BOOTSTRAP = path.join(__dirname, '..', 'migrations', 'mysql', 'bootstrap.sql');

async function ensureSchema() {
  try {
    await db.query('SELECT 1 FROM users LIMIT 1');
    return false; // schema maujood hai
  } catch (e) {
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(e.message)) throw e;
  }

  console.log('⚠️  users table nahi mili — database bootstrap chala rahe hain…');
  const sql = fs.readFileSync(BOOTSTRAP, 'utf8');
  const statements = sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);

  let ok = 0, skipped = 0;
  for (const st of statements) {
    try { await db.query(st); ok++; }
    catch (err) { skipped++; console.log('   skip:', err.message.slice(0, 120)); }
  }
  console.log(`✅ bootstrap done — ${ok} chale, ${skipped} skip hue`);
  return true;
}

module.exports = ensureSchema;

if (require.main === module) {
  ensureSchema()
    .then(ran => { console.log(ran ? 'schema banaya gaya' : 'schema pehle se tha'); return db.end(); })
    .catch(e => { console.error('bootstrap failed:', e.message); process.exit(1); });
}
