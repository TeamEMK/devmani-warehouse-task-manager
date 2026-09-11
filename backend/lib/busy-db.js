// ══════════════════════════════════════════════════════
// BUSY DB — Busy ke backup (DATA.ZIP -> db1YYYY.bds, Access format) se seedha stock + outstanding
// ══════════════════════════════════════════════════════
// Busy (Access mode) ka auto-backup Drive me company-wise folder me aata hai:
//   <date time>/COMPBOD/DATA.ZIP  = db.bds (common masters) + db1<FY>.bds (us saal ke masters + vouchers)
// Is file ko mdb-reader se padh kar wahi numbers nikalte hain jo Busy ke
// "Stock Status" aur "Amount Receivable" report dete hain — bina kisi export ke.
//
// Schema (11-Sep-2026 ko Bansal Oil ke data par verify kiya, trial balance 0):
//   Master1  : Code, MasterType, Name, ParentGrp.  MasterType 1 = account group, 2 = account,
//              5 = item group, 6 = item, 11 = material centre.
//   Folio1   : MasterCode, MasterType, D1 = opening balance (account: Dr negative; item: opening qty)
//   Tran2    : voucher lines. RecType 1 = account line (Value1 = amount, Dr negative),
//              RecType 2 = item line (Value1 = qty, sale negative), RecType 3 = tax line (ignore)
//   DailySum : item ka running balance (D1) — sirf cross-check ke liye
//   => closing stock(item)      = Folio1.D1 + Σ Tran2[RecType 2].Value1
//   => outstanding(party) (Dr+) = -(Folio1.D1 + Σ Tran2[RecType 1].Value1)
//
// Output xlsx-jaisi rows me diya jaata hai taaki ops-busy.importStock / importOutstanding
// (wahi matching, payment detection, log) bina badle chal jayein.

const zlib = require('zlib');

// ── ZIP: sirf zaroori entry nikaalo (backup me 4-5 saal ki files hoti hain, sab inflate nahi karni)
function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP nahi lag raha (EOCD nahi mila)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP central directory toota hua hai');
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), localOff: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function zipExtract(buf, e) {
  const lNameLen = buf.readUInt16LE(e.localOff + 26), lExtraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + lNameLen + lExtraLen;
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 8) return zlib.inflateRawSync(raw);
  if (e.method === 0) return Buffer.from(raw);
  throw new Error(`ZIP method ${e.method} support nahi (${e.name})`);
}
// db12026.bds -> FY 2026; sabse naya saal chuno
function pickYearFile(entries) {
  let best = null;
  for (const e of entries) { const m = /(^|\/)db1(\d{4})\.bds$/i.exec(e.name); if (m && (!best || +m[2] > best.year)) best = Object.assign({ year: +m[2] }, e); }
  return best;
}

const nb = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const dmy = d => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;

// dbBuf = db1YYYY.bds ka buffer. opts.itemGroup = item group ka naam regex (default /tyre/i), null = sab items
function readBusyDb(dbBuf, opts = {}) {
  const mod = require('mdb-reader'); const MDBReader = mod.default || mod;
  const db = new MDBReader(dbBuf);
  const T = n => db.getTable(n).getData();
  const m1 = T('Master1');
  const name = {}, type = {}, grp = {};
  for (const r of m1) { name[r.Code] = String(r.Name || '').trim(); type[r.Code] = r.MasterType; grp[r.Code] = r.ParentGrp; }
  const under = (code, root) => { let g = grp[code], n = 0; while (g && n++ < 30) { if (g === root) return true; g = grp[g]; } return false; };
  const findGroup = (mt, re) => { const g = m1.find(r => r.MasterType === mt && re.test(String(r.Name || ''))); return g ? g.Code : null; };
  const opening = {};
  for (const r of T('Folio1')) opening[r.MasterCode] = Number(r.D1) || 0;
  const qty = {}, bal = {};
  for (const r of T('Tran2')) {
    if (r.RecType === 2) qty[r.MasterCode1] = (qty[r.MasterCode1] || 0) + (Number(r.Value1) || 0);
    else if (r.RecType === 1) bal[r.MasterCode1] = (bal[r.MasterCode1] || 0) + (Number(r.Value1) || 0);
  }
  let lastVch = null;
  for (const r of T('Tran1')) if (r.Date instanceof Date && (!lastVch || r.Date > lastVch)) lastVch = r.Date;

  const itemRe = opts.itemGroup === null ? null : (opts.itemGroup || /tyre/i);
  const itemRoot = itemRe ? findGroup(5, itemRe) : null;
  const debtorRoot = findGroup(1, /SUNDRY\s*DEBTOR/i);
  if (!debtorRoot) throw new Error('Busy data me "Sundry Debtors" group nahi mila');

  const items = m1.filter(r => r.MasterType === 6 && (!itemRoot || under(r.Code, itemRoot)))
    .map(r => ({ code: r.Code, name: name[r.Code], stock: Math.round(((opening[r.Code] || 0) + (qty[r.Code] || 0)) * 1000) / 1000 }));
  const debtors = m1.filter(r => r.MasterType === 2 && under(r.Code, debtorRoot))
    .map(r => ({ code: r.Code, name: name[r.Code], balance: Math.round(-((opening[r.Code] || 0) + (bal[r.Code] || 0)) * 100) / 100 }))
    .filter(r => Math.abs(r.balance) >= 0.5)
    .sort((a, b) => b.balance - a.balance);
  return {
    fy: opts.fy || null, lastVoucherDate: lastVch ? dmy(lastVch) : '', itemGroup: itemRoot ? name[itemRoot] : '(all)',
    items, debtors, counts: { masters: m1.length, items: items.length, debtors: debtors.length },
  };
}

// DATA.ZIP buffer -> readBusyDb ka result (+ fy)
function readBusyBackup(zipBuf, opts = {}) {
  const e = pickYearFile(zipEntries(zipBuf));
  if (!e) throw new Error('Backup ZIP me db1YYYY.bds nahi mila — ye Busy company data (DATA.ZIP) nahi lagta');
  return readBusyDb(zipExtract(zipBuf, e), Object.assign({ fy: e.year }, opts));
}

// importStock / importOutstanding ke liye xlsx-jaisi rows
// keep = Set of nb(item name) jo app me hain: stock 0 wale sirf tab jab app me item ho (warna notes bhar jaate)
function stockRows(bd, asOn, keep) {
  const rows = [['Stock Status (Busy backup)'], [`As On : ${asOn}`], [], ['Item Details', 'Qty.']];
  for (const it of bd.items) if (it.stock !== 0 || (keep && keep.has(nb(it.name)))) rows.push([it.name, it.stock]);
  return rows;
}
function outstandingRows(bd, asOn) {
  const rows = [['Amount Receivable (Busy backup)'], [`As On : ${asOn}`], [], ['Account', 'Balance']];
  for (const d of bd.debtors) rows.push([d.name, d.balance]);
  return rows;
}

module.exports = { zipEntries, zipExtract, pickYearFile, readBusyDb, readBusyBackup, stockRows, outstandingRows, nb };
