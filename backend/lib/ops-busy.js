// ══════════════════════════════════════════════════════
// MICHELIN OPS — Busy accounting exports ka import
// ══════════════════════════════════════════════════════
// Busy se do report xlsx me nikalti hain:
//   1) "Stock Status"       -> items ka current stock (Busy Name se match)
//   2) "Amount Receivable"  -> dealer-wise outstanding (Busy Name / dealer name se match)
//
// Sheet wale system me ye files Drive folder me daali jaati thin aur har 15
// min Apps Script unhe padhta tha. Yahan admin app se file upload karta hai
// (POST /api/ops/importBusy) — parse + DB update yahin hota hai. Logic bilkul
// Code.gs ke _importStock / _importOutstanding jaisa, taaki result same aaye.

const { readXlsx } = require('./xlsx');

const LOW_STOCK = 10;

// Busy ke naam me spacing alag-alag hoti hai ("90/90-12  CITY EXTRA  TL") —
// compare hamesha upper-case + single space me.
function nb(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function clean(m) { return String(m || '').replace(/\D/g, '').slice(-10); }

function itemName(r) {
  return `${r.brand} ${r.size}${r.position ? ' ' + r.position : ''} ${r.pattern} ${r.tltt}`.replace(/\s+/g, ' ').trim();
}

// Pehli 8 rows ke column A me report ka naam hota hai.
function detectKind(rows) {
  const head = rows.slice(0, 8).map(r => String(r[0] || '')).join(' ').toUpperCase();
  if (head.includes('STOCK STATUS')) return 'STOCK';
  if (head.includes('AMOUNT RECEIVABLE') || head.includes('OUTSTANDING')) return 'OUT';
  return '';
}
function asOnOf(rows, fallback) {
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const m = String(rows[i][0] || '').match(/As On\s*:\s*([\d\-\/]+)/i);
    if (m) return m[1];
  }
  return fallback;
}

// ── Stock Status ─────────────────────────────────────
// "Item Details" header ke baad har row: [naam, qty]. Tube rows skip.
// Jo item DB me Busy Name se match kare aur qty badli ho — stock set + log.
async function importStock(db, rows, todayDMY) {
  const asOn = asOnOf(rows, todayDMY);
  const [items] = await db.query('SELECT * FROM ops_items WHERE busy_name<>\'\'');
  const map = {};
  for (const it of items) map[nb(it.busy_name)] = it;
  let on = false, updated = 0;
  const unmatched = [];
  for (const r of rows) {
    const a = String(r[0] || '').trim();
    if (a === 'Item Details') { on = true; continue; }
    if (!on || !a || a === 'Total') continue;
    const q = parseInt(r[1], 10);
    if (isNaN(q)) continue;
    if (/^TUBE/i.test(a)) continue;
    const it = map[nb(a)];
    if (!it) { unmatched.push(`${a} (${q})`); continue; }
    const prev = it.stock | 0;
    if (prev === q) continue;
    await db.query('UPDATE ops_items SET stock=?, updated_at=NOW() WHERE id=?', [q, it.id]);
    await db.query(
      'INSERT INTO ops_stock_log (type,code,item_name,qty,prev_stock,after_stock,note,by_name) VALUES (?,?,?,?,?,?,?,?)',
      ['BUSY', it.code, itemName(it), Math.abs(q - prev), prev, q, `Busy Stock Status as on ${asOn}`, 'Busy Import']);
    updated++;
  }
  return { updated, unmatched, asOn };
}

// ── Amount Receivable ────────────────────────────────
// "Account" header ke baad har row: [account naam, balance]. Poora snapshot
// replace hota hai. Purane vs naye balance ka fark neeche gaya = payment aayi
// -> ops_payment_log me entry (WhatsApp scanner use uthata hai).
async function importOutstanding(db, rows, todayDMY) {
  const asOn = asOnOf(rows, todayDMY);
  const list = [];
  let on = false;
  for (const r of rows) {
    const a = String(r[0] || '').trim();
    if (a === 'Account') { on = true; continue; }
    if (!on || !a || a === 'Total') continue;
    const bal = parseFloat(r[1]);
    if (isNaN(bal)) continue;
    list.push({ name: a, mobile: '', amount: bal });
  }
  const [dealers] = await db.query('SELECT name, mobile, busy_name FROM ops_dealers WHERE active=1');
  const byBusy = {}, byName = {};
  for (const d of dealers) {
    if (d.busy_name) byBusy[nb(d.busy_name)] = clean(d.mobile);
    byName[nb(d.name)] = clean(d.mobile);
  }
  for (const l of list) {
    const k = nb(l.name);
    l.mobile = byBusy[k] || byName[k] || byName[k.replace(/\s*\(.*\)$/, '')] || '';
  }
  const unmatched = [];
  for (const d of dealers) {
    const want = nb(d.busy_name || d.name);
    if (!list.some(l => nb(l.name) === want)) unmatched.push(d.name);
  }

  // Payment detection — purana snapshot padho, phir replace karo
  const [old] = await db.query('SELECT dealer_name, amount FROM ops_outstanding');
  const oldMap = {};
  for (const o of old) oldMap[nb(o.dealer_name)] = Number(o.amount);
  let payments = 0;
  for (const l of list) {
    const k = nb(l.name);
    if (!(k in oldMap)) continue;
    const oldBal = oldMap[k];
    if (l.amount < oldBal - 1) { // 1 rupaye ki rounding chhoot
      await db.query(
        'INSERT INTO ops_payment_log (dealer_name,dealer_mobile,amount_paid,old_outstanding,new_outstanding,as_on,notified) VALUES (?,?,?,?,?,?,\'N\')',
        [l.name, l.mobile, oldBal - l.amount, oldBal, l.amount, asOn]);
      payments++;
    }
  }
  await db.query('DELETE FROM ops_outstanding');
  for (const l of list) {
    await db.query('INSERT INTO ops_outstanding (dealer_name,mobile,amount,as_on,source) VALUES (?,?,?,?,\'Busy\')',
      [l.name, l.mobile, l.amount, asOn]);
  }
  return {
    count: list.length, asOn, payments,
    unmatched: unmatched.length ? [`Dealers jinka Busy naam match nahi hua: ${unmatched.join(', ')}`] : [],
  };
}

// Ek xlsx buffer -> kind pehchano -> import -> ops_import_log me likho.
async function importBusyBuffer(db, buf, fileName, todayDMY) {
  let result = '', notes = '';
  try {
    const sheets = readXlsx(buf);
    const rows = (sheets[0] && sheets[0].rows) || [];
    const kind = detectKind(rows);
    if (kind === 'STOCK') {
      const r = await importStock(db, rows, todayDMY);
      result = `STOCK: ${r.updated} items updated`; notes = r.unmatched.join(' | ');
    } else if (kind === 'OUT') {
      const r = await importOutstanding(db, rows, todayDMY);
      result = `OUTSTANDING: ${r.count} accounts, as on ${r.asOn}` + (r.payments ? `, ${r.payments} payment(s) detected` : '');
      notes = r.unmatched.join(' | ');
    } else {
      result = 'SKIP: file pehchani nahi (Stock Status ya Amount Receivable hona chahiye)';
    }
  } catch (e) {
    result = 'ERROR: ' + String(e.message || e).slice(0, 250);
  }
  await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [fileName.slice(0, 200), result, notes]);
  return { result, notes };
}

module.exports = { LOW_STOCK, nb, clean, itemName, detectKind, importStock, importOutstanding, importBusyBuffer };
