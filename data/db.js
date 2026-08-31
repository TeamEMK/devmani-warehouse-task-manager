// ══════════════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════════════
// App PostgreSQL aur MySQL 8 dono par chalti hai. Dono drivers ek hi shakl
// dete hain — wahi mysql2 wali, jisme server.js ke 247 calls likhe hain:
//
//   const [rows] = await db.query('SELECT ... WHERE id=?', [id]);
//   const [r]    = await db.query('INSERT ...');  r.insertId
//
// Kaunsa chalega, ye .env tay karta hai:
//
//   DB_KIND=postgres   ya   DB_KIND=mysql
//
// DB_KIND na ho to DATABASE_URL ke scheme se pehchan lete hain
// (postgresql://… ya mysql://…), warna postgres.
//
// NOTE: "New Client Copy" se banne wali ZIP me sirf chuna hua driver jaata
// hai — neeche ke dialect: markers wahi kaam karte hain.

function pickDialect() {
  const explicit = (process.env.DB_KIND || '').trim().toLowerCase();
  if (explicit) {
    if (explicit === 'mysql' || explicit === 'postgres' || explicit === 'postgresql') {
      return explicit === 'postgresql' ? 'postgres' : explicit;
    }
    throw new Error(`DB_KIND "${explicit}" samajh nahi aaya — 'postgres' ya 'mysql' likho.`);
  }
  const url = (process.env.DATABASE_URL || '').trim();
  if (/^mysql:\/\//i.test(url)) return 'mysql';
  return 'postgres';
}

const DIALECT = pickDialect();

let create = null;
if (DIALECT === 'mysql') create = require('./db-mysql');

if (!create) {
  throw new Error(
    `DB_KIND=${DIALECT} maanga gaya, par is copy me uska driver nahi hai.\n` +
    '  Har client copy sirf ek database ke saath aati hai — .env me DB_KIND wahi\n' +
    '  rakho jo download karte waqt chuna tha.'
  );
}

module.exports = create();
