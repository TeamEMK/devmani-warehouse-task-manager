// MICHELIN OPS Google Sheet -> ops_* tables.
//
//   node data/scripts/import-ops-sheet.js                 (sheet se seedha download, xlsx export)
//   node data/scripts/import-ops-sheet.js file.xlsx       (pehle se download ki hui file)
//   flags: --dry-run  --no-sql  --sheet <spreadsheetId>
//
// Sheet ke tabs: USERS, ITEM_MASTER, DEALERS, ORDERS, STOCK_LOG, OUTSTANDING,
// NOTIF_LOG, IMPORT_LOG, RM_LIST (PAYMENT_LOG ho to wo bhi). Har tab -> ek table.
// Sab upsert hai (unique keys par), isliye dobara chalana safe hai — sheet me
// naya data ho to wo aa jaata hai, purana dobara nahi banta.
//
// Sheet ki ek khaas gadbad: Apps Script dates "dd/MM/yyyy" string likhta tha,
// aur Google Sheets (US locale) ne unme se jo parse ho sakti thin unhe MM/dd
// maan kar date bana diya — yaani "01/09/2026" = 9 January ban gaya. Jo parse
// nahi ho saki ("31/08/2026") wo string hi rahi. Isliye: number aaye to
// date banao aur din/mahina SWAP karo; string aaye to seedha dd/MM/yyyy padho.
//
// --no-sql na do to data/migrations/mysql/seed-ops.sql bhi likhta hai —
// ensure-schema.js ise tab chalata hai jab ops_items khali ho (production par
// pehli deploy ke saath data pahunchane ke liye; DB tak seedha raasta nahi).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { readXlsx, excelSerialToDate } = require('../../backend/lib/xlsx');
const db = require('../db');

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sheet');
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = flag('--dry-run');
const WRITE_SQL = !flag('--no-sql');
const SHEET_ID = opt('--sheet', '1xJUhBYDqqhjoXBf19HjC3mSRBj00RiGrUf81nViav4Q');
const SEED_OPS = path.join(__dirname, '..', 'migrations', 'mysql', 'seed-ops.sql');

// ── cell helpers ─────────────────────────────────────
const S = v => (v == null ? '' : String(v)).trim();
const N = v => { const n = parseFloat(String(v).replace(/[^\d.\-eE]/g, '')); return isNaN(n) ? 0 : n; };
// Mobile: "9.19896677494E11" jaise number bhi aa sakte hain -> last 10 digit
const MOB = v => { let s = typeof v === 'number' ? v.toLocaleString('fullwide', { useGrouping: false }) : S(v); return s.replace(/\D/g, '').slice(-10); };
const pad = n => String(n).padStart(2, '0');

// Cell -> { iso: 'YYYY-MM-DD', dt: 'YYYY-MM-DD HH:MM:SS' } ya null
function cellDate(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') {
    const d = excelSerialToDate(v); if (!d) return null;
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    // Sheets ne dd/MM ko MM/dd padha tha — wapas palto (sirf jab dono <= 12 ho, warna parse hi na hota)
    if (day <= 12) [m, day] = [day, m];
    const hh = d.getUTCHours(), mm = d.getUTCMinutes(), ss = d.getUTCSeconds();
    const iso = `${y}-${pad(m)}-${pad(day)}`;
    return { iso, dt: `${iso} ${pad(hh)}:${pad(mm)}:${pad(ss)}` };
  }
  const m = S(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return { iso, dt: `${iso} ${pad(m[4] || 0)}:${pad(m[5] || 0)}:${pad(m[6] || 0)}` };
}

// ── SQL seed writer ──────────────────────────────────
const sqlLines = [];
const q = v => v == null ? 'NULL' : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
function seedInsert(table, cols, rows, updateCols) {
  if (!rows.length) return;
  const upd = updateCols && updateCols.length ? ` ON DUPLICATE KEY UPDATE ${updateCols.map(c => `${c}=VALUES(${c})`).join(', ')}` : '';
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map(r => `(${r.map(q).join(',')})`).join(',\n');
    sqlLines.push(`INSERT ${upd ? '' : 'IGNORE '}INTO ${table} (${cols.join(',')}) VALUES\n${chunk}${upd};`);
  }
}
async function upsert(table, cols, rows, updateCols) {
  seedInsert(table, cols, rows, updateCols);
  if (DRY || !rows.length) return;
  const upd = updateCols && updateCols.length ? ` ON DUPLICATE KEY UPDATE ${updateCols.map(c => `${c}=VALUES(${c})`).join(', ')}` : '';
  for (const r of rows) {
    await db.query(`INSERT ${upd ? '' : 'IGNORE '}INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${upd}`, r);
  }
}

// Header naam se column index — sheet me column aage-peeche ho to bhi chale
function colsOf(rows) {
  const h = (rows[0] || []).map(x => S(x).toLowerCase());
  return name => { const i = h.findIndex(x => x === name.toLowerCase()); return i; };
}
const dataRows = rows => rows.slice(1).filter(r => r.some(c => S(c) !== ''));

async function main() {
  let buf;
  if (file) buf = fs.readFileSync(file);
  else {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
    console.log('Sheet download:', url);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download fail HTTP ${res.status} — sheet "anyone with link" hai?`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const sheets = readXlsx(buf);
  const tab = name => { const s = sheets.find(x => x.name === name); return s ? s.rows : []; };
  const counts = {};

  // USERS: Mobile, Name, Role, Active, Created
  {
    const rows = tab('USERS'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const mob = MOB(r[c('Mobile')]); if (mob.length !== 10) continue;
      const cr = cellDate(r[c('Created')]);
      out.push([mob, S(r[c('Name')]), S(r[c('Role')]).toUpperCase() === 'ADMIN' ? 'ADMIN' : (S(r[c('Role')]) || 'DSR'), S(r[c('Active')]).toUpperCase() === 'N' ? 0 : 1, cr ? cr.dt : new Date().toISOString().slice(0, 19).replace('T', ' ')]);
    }
    await upsert('ops_users', ['mobile', 'name', 'role', 'active', 'created_at'], out, ['name', 'role', 'active']);
    counts.users = out.length;
  }
  // ITEM_MASTER
  {
    const rows = tab('ITEM_MASTER'), c = colsOf(rows), out = [], seen = {};
    let dups = 0;
    for (const r of dataRows(rows)) {
      const code = S(r[c('Item Code')]); if (!code) continue;
      // Sheet me seed scripts do baar chale the — VK-108..162 aur ACC/MET/NEU
      // duplicate hain. Apps Script code pehli row par kaam karta tha (stock
      // update `break` par), isliye pehli hi rakhte hain.
      if (seen[code]) { dups++; continue; }
      seen[code] = 1;
      const up = cellDate(r[c('Last Updated')]);
      out.push([code, S(r[c('Brand')]), S(r[c('Segment')]), S(r[c('Category')]), S(r[c('Size')]), S(r[c('Position')]), S(r[c('Pattern')]), S(r[c('TL/TT')]), S(r[c('LI/SI')]),
        N(r[c('Basic Price')]), N(r[c('Price (App Rate)')]), N(r[c('Tube Price')]), Math.round(N(r[c('Current Stock')])), up ? up.dt : '2026-08-27 05:47:00', S(r[c('Busy Name')])]);
    }
    await upsert('ops_items', ['code', 'brand', 'segment', 'category', 'size', 'position', 'pattern', 'tltt', 'li', 'basic_price', 'price', 'tube_price', 'stock', 'updated_at', 'busy_name'], out,
      ['brand', 'segment', 'category', 'size', 'position', 'pattern', 'tltt', 'li', 'basic_price', 'price', 'tube_price', 'stock', 'updated_at', 'busy_name']);
    counts.items = out.length;
    if (dups) console.log(`  ITEM_MASTER: ${dups} duplicate code rows chhode (pehli row rakhi)`);
  }
  // DEALERS (+ purane Drive KYC links)
  {
    const rows = tab('DEALERS'), c = colsOf(rows), out = [], docs = [];
    for (const r of dataRows(rows)) {
      const did = S(r[c('Dealer ID')]); if (!did) continue;
      const cr = cellDate(r[c('Created')]);
      out.push([did, S(r[c('Dealer Name')]), MOB(r[c('Mobile')]), S(r[c('City')]), S(r[c('Address')]), S(r[c('Added By DSR')]), S(r[c('Active')]).toUpperCase() === 'N' ? 0 : 1,
        cr ? cr.dt : '2026-08-27 05:43:00', S(r[c('Busy Name')]), S(r[c('GST No')]).toUpperCase(), S(r[c('PAN')]).toUpperCase(), S(r[c('KYC Folder')]), S(r[c('KYC Status')]), S(r[c('Lat')]), S(r[c('Lng')])]);
      for (const [key, col] of [['gst', 'GST Doc'], ['pan', 'PAN Doc'], ['aadhaar', 'Aadhaar Doc'], ['cheque', 'Cheque Doc']]) {
        const u = S(r[c(col)]); if (u) docs.push([did, key, u]);
      }
    }
    await upsert('ops_dealers', ['did', 'name', 'mobile', 'city', 'address', 'added_by', 'active', 'created_at', 'busy_name', 'gst_no', 'pan', 'kyc_folder', 'kyc_status', 'lat', 'lng'], out,
      ['name', 'mobile', 'city', 'address', 'added_by', 'active', 'busy_name', 'gst_no', 'pan', 'kyc_folder', 'kyc_status', 'lat', 'lng']);
    counts.dealers = out.length;
    // Drive links -> ops_dealer_docs (blob nahi, sirf link) — dealer_id subquery se
    for (const [did, key, u] of docs) {
      const sql = `INSERT INTO ops_dealer_docs (dealer_id,doc_key,file_name,mime,drive_url) SELECT id,${q(key)},${q(key + ' (Drive)')},'application/octet-stream',${q(u)} FROM ops_dealers WHERE did=${q(did)} ON DUPLICATE KEY UPDATE drive_url=VALUES(drive_url);`;
      sqlLines.push(sql);
      if (!DRY) await db.query(sql.replace(/;$/, ''));
    }
    counts.dealerDocs = docs.length;
  }
  // ORDERS
  {
    const rows = tab('ORDERS'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const oid = S(r[c('Order ID')]); if (!oid) continue;
      const od = cellDate(r[c('Date')]), cr = cellDate(r[c('Created At')]), up = cellDate(r[c('Updated At')]);
      const day = od ? od.iso : (cr ? cr.iso : null); if (!day) { console.log('  skip order (date nahi):', oid); continue; }
      out.push([oid, day, S(r[c('DSR')]), MOB(r[c('DSR Mobile')]), S(r[c('Dealer ID')]), S(r[c('Dealer Name')]), MOB(r[c('Dealer Mobile')]), S(r[c('City')]),
        S(r[c('Items JSON')]) || '[]', Math.round(N(r[c('Total Qty')])), N(r[c('Amount')]), S(r[c('Status')]).toUpperCase() || 'PENDING',
        typeof r[c('Invoice No')] === 'number' ? String(Math.round(r[c('Invoice No')])) : S(r[c('Invoice No')]), S(r[c('Vehicle/Transport')]), S(r[c('Note')]),
        S(r[c('Payment Terms')]), S(r[c('History')]) || '[]', cr ? cr.dt : `${day} 00:00:00`, up ? up.dt : (cr ? cr.dt : `${day} 00:00:00`)]);
    }
    await upsert('ops_orders', ['oid', 'order_date', 'dsr_name', 'dsr_mobile', 'did', 'dealer_name', 'dealer_mobile', 'city', 'items_json', 'total_qty', 'amount', 'status', 'invoice_no', 'vehicle', 'note', 'payment_terms', 'history_json', 'created_at', 'updated_at'], out,
      ['status', 'invoice_no', 'vehicle', 'note', 'payment_terms', 'history_json', 'items_json', 'total_qty', 'amount', 'updated_at']);
    counts.orders = out.length;
  }
  // STOCK_LOG — koi unique key nahi; sirf tab daalo jab table khali ho (dobara run par duplicate na bane)
  {
    const rows = tab('STOCK_LOG'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const t = cellDate(r[c('Time')]); const code = S(r[c('Item Code')]); if (!code) continue;
      out.push([t ? t.dt : '2026-08-27 05:47:00', S(r[c('Type')]), code, S(r[c('Item Name')]), Math.round(N(r[c('Qty')])), Math.round(N(r[c('Prev')])), Math.round(N(r[c('After')])), S(r[c('Ref/Note')]), S(r[c('By')])]);
    }
    const cols = ['log_time', 'type', 'code', 'item_name', 'qty', 'prev_stock', 'after_stock', 'note', 'by_name'];
    seedInsert('ops_stock_log', cols, out); // seed file fresh DB par hi chalti hai
    if (!DRY) {
      const [[n]] = await db.query('SELECT COUNT(*) AS n FROM ops_stock_log');
      if (n.n === 0) for (const r of out) await db.query(`INSERT INTO ops_stock_log (${cols.join(',')}) VALUES (?,?,?,?,?,?,?,?,?)`, r);
      else console.log(`  stock_log pehle se ${n.n} rows — skip (duplicate na banein)`);
    }
    counts.stockLog = out.length;
  }
  // OUTSTANDING (snapshot; placeholder row chhod do)
  {
    const rows = tab('OUTSTANDING'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const name = S(r[c('Dealer Name')]); const amt = r[c('Outstanding (Rs)')];
      if (!name || amt === '' || isNaN(parseFloat(amt))) continue;
      const d = cellDate(r[c('As On')]);
      out.push([name, MOB(r[c('Mobile')]), N(amt), d ? d.iso.split('-').reverse().join('/') : S(r[c('As On')]), S(r[c('Source')]) || 'Busy']);
    }
    if (out.length) {
      sqlLines.push('DELETE FROM ops_outstanding;');
      if (!DRY) await db.query('DELETE FROM ops_outstanding');
      await upsert('ops_outstanding', ['dealer_name', 'mobile', 'amount', 'as_on', 'source'], out);
    }
    counts.outstanding = out.length;
  }
  // PAYMENT_LOG (ho to)
  {
    const rows = tab('PAYMENT_LOG'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const name = S(r[c('Dealer Name')]); if (!name) continue;
      const t = cellDate(r[c('Time')]);
      out.push([t ? t.dt : '2026-08-27 05:47:00', name, MOB(r[c('Dealer Mobile')]), N(r[c('Amount Paid')]), N(r[c('Old Outstanding')]), N(r[c('New Outstanding')]), S(r[c('As On')]), S(r[c('Notified')]).toUpperCase() === 'Y' ? 'Y' : 'N']);
    }
    const cols = ['log_time', 'dealer_name', 'dealer_mobile', 'amount_paid', 'old_outstanding', 'new_outstanding', 'as_on', 'notified'];
    seedInsert('ops_payment_log', cols, out);
    if (!DRY && out.length) {
      const [[n]] = await db.query('SELECT COUNT(*) AS n FROM ops_payment_log');
      if (n.n === 0) for (const r of out) await db.query(`INSERT INTO ops_payment_log (${cols.join(',')}) VALUES (?,?,?,?,?,?,?,?)`, r);
    }
    counts.paymentLog = out.length;
  }
  // NOTIF_LOG: Key unique
  {
    const rows = tab('NOTIF_LOG'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const key = S(r[c('Key')]); if (!key) continue;
      const t = cellDate(r[c('Time')]);
      out.push([key, S(r[c('Event')]), S(r[c('Order ID')]), MOB(r[c('To')]) ? '91' + MOB(r[c('To')]) : S(r[c('To')]), S(r[c('Status')]), t ? t.dt : '2026-08-31 14:59:00']);
    }
    await upsert('ops_notif_log', ['notif_key', 'event', 'oid', 'to_number', 'status', 'log_time'], out, ['status', 'log_time']);
    counts.notifLog = out.length;
  }
  // IMPORT_LOG — sirf khali table par
  {
    const rows = tab('IMPORT_LOG'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const t = cellDate(r[c('Time')]); const f = S(r[c('File')]); if (!f) continue;
      out.push([t ? t.dt : '2026-08-29 17:34:00', f, S(r[c('Result')]), S(r[c('Unmatched / Notes')])]);
    }
    const cols = ['log_time', 'file_name', 'result', 'notes'];
    seedInsert('ops_import_log', cols, out);
    if (!DRY && out.length) {
      const [[n]] = await db.query('SELECT COUNT(*) AS n FROM ops_import_log');
      if (n.n === 0) for (const r of out) await db.query(`INSERT INTO ops_import_log (${cols.join(',')}) VALUES (?,?,?,?)`, r);
    }
    counts.importLog = out.length;
  }
  // RM_LIST
  {
    const rows = tab('RM_LIST'), c = colsOf(rows), out = [];
    for (const r of dataRows(rows)) {
      const mob = MOB(r[c('Mobile')]); if (mob.length !== 10) continue;
      out.push([S(r[c('Name')]), mob, S(r[c('Company')]), S(r[c('Role')])]);
    }
    await upsert('ops_rm_list', ['name', 'mobile', 'company', 'role'], out, ['name', 'company', 'role']);
    counts.rm = out.length;
  }

  console.log(DRY ? 'DRY RUN — DB me kuch nahi likha.' : 'DB update ho gaya.');
  console.table(counts);

  if (WRITE_SQL) {
    const head = [
      '-- MICHELIN OPS sheet ka data (auto-generated: data/scripts/import-ops-sheet.js).',
      '-- ensure-schema.js ise tab chalata hai jab ops_items khali ho — production par',
      '-- pehli deploy ke saath data pahunchane ke liye. Dobara chalane par unique keys',
      '-- (mobile / code / did / oid / notif key) wale rows update hote hain, baaki IGNORE.',
      `-- Generated: ${new Date().toISOString()}`, '',
    ];
    fs.writeFileSync(SEED_OPS, head.concat(sqlLines).join('\n') + '\n');
    console.log('seed likha:', path.relative(process.cwd(), SEED_OPS), `(${(fs.statSync(SEED_OPS).size / 1024).toFixed(0)} KB)`);
  }
}

main().then(() => db.end()).catch(e => { console.error('import failed:', e.message); process.exit(1); });
