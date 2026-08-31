// ══════════════════════════════════════════════════════
// MYSQL 8 DRIVER  (Postgres SQL -> MySQL translation)
// ══════════════════════════════════════════════════════
// server.js ke 247 DB calls mysql2 ke andaz me likhe hain — `[rows] = await
// db.query('… ?', [x])`, `insertId`, `getConnection` — isliye is taraf API
// lagbhag passthrough hai. Asli kaam SQL ka dialect hai: queries Postgres me
// likhi gayi hain, aur unhe MySQL ke liye badalna padta hai.
//
// Kya-kya badalta hai (poori list — koi chupa hua case nahi):
//   TO_CHAR(x,'YYYY-MM-DD')          -> DATE_FORMAT(x,'%Y-%m-%d')      (34 jagah)
//   ON CONFLICT DO NOTHING           -> INSERT IGNORE                   (1)
//   ON CONFLICT (…) DO UPDATE SET    -> ON DUPLICATE KEY UPDATE         (4)
//   EXCLUDED.col                     -> VALUES(col)
//   RETURNING (xmax = 0) AS inserted -> affectedRows se banaya gaya     (1)
//   date_trunc(month) + interval     -> LAST_DAY(CURRENT_DATE)          (1)
//   make_interval(days => ?::int)    -> DATE_ADD(…, INTERVAL ? DAY)     (1)
//   serial                           -> INT AUTO_INCREMENT   (inline DDL, 6)
//   ADD COLUMN IF NOT EXISTS         -> IF NOT EXISTS hataya  (MySQL support nahi)
//   CREATE INDEX IF NOT EXISTS       -> IF NOT EXISTS hataya + duplicate swallow
//
// Aur error codes Postgres ke SQLSTATE me badle jaate hain, kyunki server.js
// unhi ko dekhta hai (`e.code === '42701'` jaisi 5 jagah).

const mysql = require('mysql2/promise');

// ── TO_CHAR format -> DATE_FORMAT ────────────────────
// Lambe token pehle, warna HH12 me se HH match ho jayega.
const FMT_TOKENS = [
  ['YYYY', '%Y'], ['HH24', '%H'], ['HH12', '%h'],
  ['MM', '%m'], ['DD', '%d'], ['MI', '%i'], ['SS', '%s'],
  ['AM', '%p'], ['PM', '%p'], ['HH', '%h'], ['YY', '%y'],
];

function convertDateFormat(fmt) {
  let out = '', i = 0;
  outer: while (i < fmt.length) {
    for (const [pg, my] of FMT_TOKENS) {
      if (fmt.startsWith(pg, i)) { out += my; i += pg.length; continue outer; }
    }
    out += fmt[i++];
  }
  return out;
}

// ── SQL translation ──────────────────────────────────
// Har query par chalta hai, isliye pehle sasta test (regex .test) aur tabhi
// replace. Zyadatar queries me in me se kuch bhi nahi hota.
function translate(sql) {
  let out = sql;

  if (/TO_CHAR\s*\(/i.test(out)) {
    out = out.replace(/TO_CHAR\s*\(\s*([^,]+?)\s*,\s*'([^']*)'\s*\)/gi,
      (m, expr, fmt) => `DATE_FORMAT(${expr},'${convertDateFormat(fmt)}')`);
  }

  // Postgres ka "is row naya tha?" — MySQL me ye affectedRows batata hai
  // (1 = insert, 2 = update), isliye clause hata kar neeche flag banate hain.
  const wantsInserted = /\bRETURNING\s*\(\s*xmax\s*=\s*0\s*\)\s*AS\s+"?inserted"?/i.test(out);
  if (wantsInserted) {
    out = out.replace(/\bRETURNING\s*\(\s*xmax\s*=\s*0\s*\)\s*AS\s+"?inserted"?/i, '');
  }

  if (/\bON\s+CONFLICT\b/i.test(out)) {
    if (/\bON\s+CONFLICT\s+DO\s+NOTHING\b/i.test(out)) {
      out = out.replace(/\bON\s+CONFLICT\s+DO\s+NOTHING\b/gi, '')
               .replace(/^(\s*)INSERT\s+INTO\b/i, '$1INSERT IGNORE INTO');
    }
    out = out.replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
    out = out.replace(/\bEXCLUDED\.(\w+)/gi, 'VALUES($1)');
  }

  // "is mahine ka aakhri din"
  if (/date_trunc/i.test(out)) {
    out = out.replace(
      /\(\s*date_trunc\s*\(\s*'month'\s*,\s*CURRENT_DATE\s*\)\s*\+\s*interval\s*'1 month - 1 day'\s*\)\s*::\s*date/gi,
      'LAST_DAY(CURRENT_DATE)');
  }

  // due_date ko N din aage khiskana
  if (/make_interval/i.test(out)) {
    out = out.replace(/([\w.]+)\s*\+\s*make_interval\s*\(\s*days\s*=>\s*\?\s*::\s*int\s*\)/gi,
      'DATE_ADD($1, INTERVAL ? DAY)');
  }

  // ── Inline DDL (server.js khud kuch tables/columns banati hai) ──
  if (/\b(CREATE|ALTER)\b/i.test(out)) {
    out = out.replace(/\bserial\b/gi, 'INT AUTO_INCREMENT');
    // MySQL me TEXT column par na DEFAULT lag sakta hai, na bina prefix ke
    // index. Postgres me dono chalte hain, aur inline DDL wahin ke hisaab se
    // likhi hai — isliye aisi columns ko varchar bana dete hain.
    out = out.replace(/^(\s*\w+\s+)TEXT\b([^,\n]*)/gim,
      (m, head, rest) => (/\bDEFAULT\b|\bCHECK\b/i.test(rest) ? `${head}varchar(255)${rest}` : m));
    // MySQL me in dono par IF NOT EXISTS nahi chalta (MariaDB me chalta hai).
    // Duplicate hone par jo error aata hai use neeche handle karte hain.
    out = out.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, 'ADD COLUMN');
    out = out.replace(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE INDEX');
  }

  return { sql: out, wantsInserted };
}

// ── Error codes -> Postgres SQLSTATE ─────────────────
// server.js Postgres ke codes dekhti hai. Yahan map kar dene se wo saari
// jagah bina badle chalti rehti hain.
const ERRNO_TO_SQLSTATE = {
  1050: '42P07',   // ER_TABLE_EXISTS_ERROR   -> duplicate_table
  1054: '42703',   // ER_BAD_FIELD_ERROR      -> undefined_column
  1060: '42701',   // ER_DUP_FIELDNAME        -> duplicate_column
  1061: '42P07',   // ER_DUP_KEYNAME          -> (index pehle se hai)
  1062: '23505',   // ER_DUP_ENTRY            -> unique_violation
  1146: '42P01',   // ER_NO_SUCH_TABLE        -> undefined_table
  1452: '23503',   // ER_NO_REFERENCED_ROW_2  -> foreign_key_violation
};

function normaliseError(err) {
  const mapped = ERRNO_TO_SQLSTATE[err && err.errno];
  if (mapped) {
    err.mysqlCode = err.code;      // asli code debugging ke liye rakh lo
    err.code = mapped;
  }
  return err;
}

// mysql2 pehle se [rows, fields] aur [ResultSetHeader, fields] deta hai —
// yaani wahi shakl jo server.js chahti hai. Sirf do cheezein karni hain:
// xmax wala flag banana, aur CREATE INDEX ka duplicate chupchap chhodna.
async function run(runner, rawSql, params = []) {
  const { sql, wantsInserted } = translate(rawSql);
  try {
    const [result, fields] = await runner(sql, params === undefined ? [] : params);
    if (wantsInserted) {
      // MySQL: 1 = naya row bana, 2 = maujooda update hua.
      return [[{ inserted: result.affectedRows === 1 }], fields];
    }
    return [result, fields];
  } catch (e) {
    // `CREATE INDEX IF NOT EXISTS` ka MySQL me koi jod nahi — index pehle se ho
    // to yahi error aata hai. Postgres wahan chup rehta hai, isliye hum bhi.
    if (e.errno === 1061 && /^\s*CREATE\s+INDEX\b/i.test(sql)) {
      return [{ affectedRows: 0, insertId: undefined, rows: [] }, []];
    }
    throw normaliseError(e);
  }
}

module.exports = function createMysql() {
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  if (rawUrl && !/^mysql:\/\//i.test(rawUrl)) {
    throw new Error(
      `DATABASE_URL theek nahi lag raha: "${rawUrl.slice(0, 24)}…"\n` +
      '  MySQL par ye mysql://user:pass@host:port/dbname jaisa hona chahiye.\n' +
      '  (Local MySQL use kar rahe ho to DATABASE_URL hata do aur DB_* vars bharo.)'
    );
  }

  const base = {
    // DATE ko string hi rehne do — JS Date banane par timezone shift se
    // due_date ek din peeche dikh sakti hai. DATETIME/TIMESTAMP Date hi
    // rahenge, bilkul Postgres driver ki tarah.
    dateStrings: ['DATE'],
    // DECIMAL default me string aata hai; poora code use number maanta hai
    // (`a + b` warna jud kar "51" ban jaata).
    decimalNumbers: true,
    charset: 'utf8mb4_general_ci',   // Hindi aur emoji ke liye
    connectionLimit: parseInt(process.env.DB_POOL_MAX || (process.env.VERCEL ? '1' : '10'), 10),
    idleTimeout: 10000,
    connectTimeout: 10000,
    waitForConnections: true,
  };

  const connConfig = rawUrl
    ? { uri: rawUrl, ...base }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'task_manager',
        ...base,
      };

  const g = globalThis;
  const pool = g.__smMyPool || (g.__smMyPool = mysql.createPool(connConfig));

  if (!g.__smMyPoolInit) {
    g.__smMyPoolInit = true;
    // Har naye connection par do cheezein:
    //   ANSI_QUOTES — server.js me 33 aliases `AS "userId"` ki tarah quoted hain
    //                 (Postgres ke liye). Iske bina MySQL unhe string samajhta.
    //   time_zone   — poora code NOW()/CURRENT_DATE ko IST maan kar chalta hai.
    pool.on('connection', (conn) => {
      conn.query("SET sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES'), time_zone = '+05:30'");
    });
  }

  return {
    kind: 'mysql',
    query: (sql, params) => run((t, p) => pool.query(t, p), sql, params),
    execute: (sql, params) => run((t, p) => pool.query(t, p), sql, params),

    async getConnection() {
      const conn = await pool.getConnection();
      return {
        query: (sql, params) => run((t, p) => conn.query(t, p), sql, params),
        execute: (sql, params) => run((t, p) => conn.query(t, p), sql, params),
        beginTransaction: () => conn.beginTransaction(),
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        release: () => conn.release(),
      };
    },

    end: () => pool.end(),
    pool,
    _translate: translate, // tests ke liye
  };
};
