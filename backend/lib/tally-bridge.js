// ══════════════════════════════════════════════════════
// TALLY BRIDGE — Busy "List of Supply Outward Vouchers" -> Michelin InvoiceTally .xlsx
// ══════════════════════════════════════════════════════
// Apps Script "Tally Bridge" ka Node roop (matching logic waisi ki waisi).
// Busy ki export file me har voucher ki lines hoti hain; har item ka naam
// Michelin ke CA (item code) se milaya jaata hai — size + F/R + TL/TT + pattern
// ke shabdon ke overlap se. Jo match nahi hota (car tyre, tube, naya SKU)
// wo "skipped" me dikhta hai.
//
// Settings (distributor code, CA table) app_settings table me: sab users ke liye ek.

const { readXlsx, excelSerialToDate, writeXlsx } = require('./xlsx');

const TEMPLATE_HEADERS = ['DistributorCode', 'DealerShipName', 'InvoiceNumber', 'InvoiceDate', 'CAI', 'ItemPricePerUnit', 'Quantity', 'TotalAmount', 'GSTIN', 'SalesReturnNumber'];
const STOP_WORDS = ['M/C', 'IND', 'REINF', 'TL', 'TT', 'TL/TT', 'RADIAL', 'NHS', '2'];

function tokenize(s) {
  const stop = new Set(STOP_WORDS);
  const up = String(s || '').toUpperCase().replace(/[()]/g, ' ');
  const out = [];
  up.split(/\s+/).forEach(t => { if (!t || stop.has(t)) return; if (/^\(?\d+[A-Z]\)?$/.test(t)) return; out.push(t); });
  return out;
}
function getSize(s) { const m = /^([\d.]+(?:\/[\d.]+)?)\s*-?\s*R?\s*(\d+)/.exec(String(s || '').toUpperCase()); return m ? m[1] + '-' + m[2] : null; }
function getPos(s) { const up = String(s || '').toUpperCase(); if (/\bFRONT\b/.test(up)) return 'F'; if (/\bREAR\b/.test(up)) return 'R'; if (/\bF\b/.test(up)) return 'F'; if (/\bR\b/.test(up)) return 'R'; return null; }
function getSuffix(s) { const up = String(s || '').toUpperCase(); if (up.includes('TL/TT')) return 'TL/TT'; if (/\bTL\b/.test(up)) return 'TL'; if (/\bTT\b/.test(up)) return 'TT'; return null; }
function buildCaIndex(caTable) {
  return caTable.map(r => { const toks = {}; tokenize(r.size).forEach(t => { toks[t] = true; }); return { ca: r.ca, sz: getSize(r.size), pos: getPos(r.size), suf: getSuffix(r.size), toks }; });
}
function matchCa(itemText, caIndex) {
  const sz = getSize(itemText); if (!sz) return null;
  const pos = getPos(itemText), suf = getSuffix(itemText);
  const toksArr = tokenize(itemText), toksSet = {}; toksArr.forEach(t => { toksSet[t] = true; });
  let best = null, bestScore = -Infinity;
  caIndex.forEach(d => {
    if (d.sz !== sz) return;
    if (pos && d.pos && pos !== d.pos) return;
    const sufPenalty = d.suf === suf ? 0 : (d.suf === 'TL/TT' ? 1 : 3);
    let overlap = 0; toksArr.forEach(t => { if (t !== '-' && d.toks[t]) overlap++; });
    let extra = 0; Object.keys(d.toks).forEach(t => { if (t !== '-' && t !== 'R' && t !== 'F' && !toksSet[t]) extra++; });
    const score = overlap * 2 - extra - sufPenalty;
    if (score > bestScore) { bestScore = score; best = d.ca; }
  });
  return best;
}

// CA/Size file: pehla column CA (number), doosra Size (text)
function buildCaTableFromRows(rows) {
  const out = [];
  rows.forEach(row => {
    if (!row) return;
    let ca = row[0]; const size = row[1];
    if (ca === '' || ca == null || size === '' || size == null) return;
    if (typeof ca !== 'number') { const n = parseInt(String(ca).replace(/\D/g, ''), 10); if (!isFinite(n) || String(ca).trim() !== String(n)) return; ca = n; }
    out.push({ ca, size: String(size) });
  });
  return out;
}

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r]; if (!row) continue;
    const joined = row.filter(v => v !== '' && v != null).join(' ');
    if (joined.includes('Vch') && joined.includes('Date')) return r;
  }
  return 4;
}
// Busy date cell: Excel serial (number), Date, ya "dd-mm-yyyy" / "dd/mm/yyyy" text -> Date (UTC midnight)
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return excelSerialToDate(v);
  const m = String(v || '').match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(Date.UTC(y, +m[2] - 1, +m[1])); }
  const iso = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  return null;
}
const isoOf = d => d ? d.toISOString().slice(0, 10) : '';
const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : v; };

function runPipeline(listRows, headerRowIdx, caIndex, distributorCode) {
  let curDate = null, curVch = null, curParty = null, curGstin = null;
  const outRows = [], dropped = [];
  for (let r = headerRowIdx + 1; r < listRows.length; r++) {
    const row = listRows[r]; if (!row) continue;
    const [date, vch, party, gstin, item, qty, , price, amount] = row;
    if (date !== '' && date != null) curDate = toDate(date) || curDate;
    if (vch !== '' && vch != null) curVch = vch;
    if (party !== '' && party != null) curParty = party;
    if (gstin !== '' && gstin != null) curGstin = gstin;
    if (item === '' || item == null) continue;
    const itemText = String(item).trim();
    if (!itemText || itemText.toLowerCase() === 'total') continue;
    const qtyEmpty = qty === '' || qty == null, amtEmpty = amount === '' || amount == null;
    if (qtyEmpty && amtEmpty) continue;
    const ca = matchCa(itemText, caIndex);
    if (ca == null) { dropped.push({ vch: curVch, item: itemText }); continue; }
    outRows.push({ DistributorCode: distributorCode, DealerShipName: curParty, InvoiceNumber: curVch, InvoiceDate: curDate, CAI: ca, ItemPricePerUnit: num(price), Quantity: num(qty), TotalAmount: num(amount), GSTIN: curGstin, SalesReturnNumber: '' });
  }
  return { outRows, dropped };
}

// Poora kaam: list xlsx buffer + settings -> { xlsx buffer, preview, dropped, totals }
function processListOfSupply(buf, caTable, distributorCode) {
  const sheets = readXlsx(buf);
  const sh = sheets.find(s => s.rows.length > 2) || sheets[0];
  const rows = (sh && sh.rows) || [];
  const caIndex = buildCaIndex(caTable);
  const res = runPipeline(rows, findHeaderRow(rows), caIndex, distributorCode);
  const totals = { qty: 0, amount: 0 };
  res.outRows.forEach(r => { if (typeof r.Quantity === 'number') totals.qty += r.Quantity; if (typeof r.TotalAmount === 'number') totals.amount += r.TotalAmount; });
  let xlsx = null;
  if (res.outRows.length) {
    xlsx = writeXlsx([TEMPLATE_HEADERS].concat(res.outRows.map(r => TEMPLATE_HEADERS.map(h => r[h] === undefined ? '' : r[h]))), 'Sheet1');
  }
  const preview = res.outRows.slice(0, 8).map(r => { const o = {}; TEMPLATE_HEADERS.forEach(h => { o[h] = r[h] instanceof Date ? isoOf(r[h]) : r[h]; }); return o; });
  return { xlsx, matchedCount: res.outRows.length, droppedCount: res.dropped.length, dropped: res.dropped, preview, totals };
}

/* Bundled default CA table (Aug 2026 export) — pehli baar settings me seed hoti hai */
const DEFAULT_DISTRIBUTOR = '2818298';
const DEFAULT_CA_TABLE = [{"ca": 79756, "size": "100/80 - 17 M/C 52P PILOT STREET 2 IND F TL"}, {"ca": 19487, "size": "100/80-12 56L CITY EXTRA F TL"}, {"ca": 598815, "size": "100/80-17 M/C 52P CITY EXTRA F TL"}, {"ca": 92018, "size": "100/90 - 17 M/C 55P CITY EXTRA R TL"}, {"ca": 755356, "size": "100/90 - 17 M/C 55P PILOT STREET 2 IND R TL"}, {"ca": 594317, "size": "100/90 - 17 M/C 55P SIRAC STREET IND R TL"}, {"ca": 628461, "size": "100/90 - 18 56P CITY PRO IND REAR TL"}, {"ca": 493860, "size": "100/90 - 18 M/C 56P CITY EXTRA R TL"}, {"ca": 992753, "size": "100/90 - 18 M/C 56P PILOT STREET 2 IND R TL"}, {"ca": 760109, "size": "100/90 - 18 M/C 56P SIRAC STREET IND R TT"}, {"ca": 584234, "size": "110/70 - 17 M/C 54P PILOT STREET 2 IND F TL"}, {"ca": 401784, "size": "110/70 R 17 M/C 54H PILOT STREET RADIAL F TL/TT"}, {"ca": 86409, "size": "110/80 - 17 M/C 57P CITY PRO IND R TL"}, {"ca": 358534, "size": "110/80 - 17 M/C 57P PILOT STREET 2 IND R TL"}, {"ca": 984534, "size": "110/80-12 61L CITY EXTRA R TL"}, {"ca": 812278, "size": "110/90 - 18 M/C 61P ANAKEE CROSS R TT"}, {"ca": 207363, "size": "110/90 - 18 M/C 61P SIRAC STREET IND R TL"}, {"ca": 34759, "size": "120/80 - 17 M/C 61P PILOT STREET 2 IND R TL"}, {"ca": 521030, "size": "120/80 - 17 M/C 67P REINF CITY EXTRA R TL"}, {"ca": 953454, "size": "120/80 - 18 62P M/C CITY PRO IND R TT"}, {"ca": 26872, "size": "130/70 - 17 M/C 62P PILOT STREET 2 IND R TL"}, {"ca": 640927, "size": "140/60 - 17 M/C 63P PILOT STREET 2 IND R TL"}, {"ca": 417144, "size": "140/70 - 17 M/C 66P CITY EXTRA R TL"}, {"ca": 250337, "size": "140/70 - 17 M/C 66P CITY PRO IND R TL"}, {"ca": 849542, "size": "150/60 - 17 M/C 66P PILOT STREET 2 IND R TL"}, {"ca": 720861, "size": "150/60 R 17 M/C 66H PILOT STREET RADIAL R TL/TT"}, {"ca": 563738, "size": "190/55 ZR17 M/C (75W) POWER SLICK EVO R TL NHS"}, {"ca": 197244, "size": "2.75 - 17 M/C 41P SIRAC STREET IND F TT"}, {"ca": 994855, "size": "2.75 - 18 42P ANAKEE CROSS F TT"}, {"ca": 827496, "size": "2.75 - 18 42P CITY EXTRA F TL"}, {"ca": 278390, "size": "2.75 - 18 48P REINF ANAKEE CROSS R TT"}, {"ca": 414038, "size": "2.75 - 18 48P REINF CITY EXTRA R TL"}, {"ca": 583123, "size": "2.75 - 18 48P REINF CITY PRO IND R TT"}, {"ca": 178722, "size": "2.75 - 18 M/C 42P CITY PRO IND F TL"}, {"ca": 792872, "size": "2.75 - 18 M/C 48P REINF SIRAC STREET IND R TT"}, {"ca": 43762, "size": "200/55 ZR 17 M/C (78W) POWER SLICK EVO NHS R TL"}, {"ca": 818669, "size": "3.00 - 17 50P REINF SIRAC STREET IND R TL"}, {"ca": 132327, "size": "3.00 - 18 52P REINF ANAKEE CR. R TT"}, {"ca": 784629, "size": "3.00 - 18 52P REINF CITY EXTRA R TL"}, {"ca": 401136, "size": "3.25 - 19 54P ANAKEE CROSS F TT"}, {"ca": 517156, "size": "3.25 - 19 M/C 54P SIRAC STREET IND FRONT TT"}, {"ca": 864872, "size": "3.50 - 10 51J CITY EXTRA TT"}, {"ca": 319704, "size": "3.50 - 19 63P REINF ANAKEE CROSS R TT"}, {"ca": 893248, "size": "3.50 - 19 M/C 63P SIRAC STREET IND REAR TT"}, {"ca": 558659, "size": "80/100 - 17 M/C 46P PILOT STREET 2 IND F TL"}, {"ca": 166921, "size": "80/100 - 18 M/C 47P ANAKEE CROSS F TL"}, {"ca": 419882, "size": "80/100 - 18 M/C 47P PILOT STREET 2 IND F TL"}, {"ca": 309283, "size": "80/100 - 18 M/C 54P REINF ANAKEE CROSS R TL"}, {"ca": 325457, "size": "80/100 - 18 M/C 54P REINF PILOT STREET 2 IND R TL"}, {"ca": 69309, "size": "80/100-17 M/C 46P CITY EXTRA F TL"}, {"ca": 718583, "size": "80/100-18 M/C 47P CITY EXTRA F TL"}, {"ca": 389518, "size": "80/100-18 M/C 54P REINF CITY EXTRA R TL"}, {"ca": 973385, "size": "90/100 - 10 53J ANAKEE CROSS TL"}, {"ca": 65778, "size": "90/100 - 10 53J CITY EXTRA IND TL"}, {"ca": 887518, "size": "90/100 - 10 53J PILOT STREET 2 IND TL"}, {"ca": 565578, "size": "90/90 - 12 54J ANAKEE CROSS TL"}, {"ca": 572699, "size": "90/90 - 12 54J CITY EXTRA IND TL"}, {"ca": 310067, "size": "90/90 - 12 54J PILOT STREET 2 IND TL"}, {"ca": 495882, "size": "90/90 - 17 M/C 49P CITY EXTRA F TL"}, {"ca": 488742, "size": "90/90 - 17 M/C 49P PILOT STREET 2 IND F TL"}, {"ca": 946977, "size": "90/90 - 19 M/C 52P ANAKEE CROSS F TT"}];

module.exports = { TEMPLATE_HEADERS, DEFAULT_DISTRIBUTOR, DEFAULT_CA_TABLE, tokenize, getSize, getPos, getSuffix, buildCaIndex, matchCa, buildCaTableFromRows, findHeaderRow, runPipeline, processListOfSupply };
