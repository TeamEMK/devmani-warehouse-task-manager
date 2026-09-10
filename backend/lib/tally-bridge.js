// ══════════════════════════════════════════════════════
// TALLY BRIDGE — Busy "List of Supply Outward Vouchers" -> Michelin InvoiceTally .xlsx
// ══════════════════════════════════════════════════════
// Apps Script "Tally Bridge" ka Node roop (matching logic waisi ki waisi).
// Busy ki export file me har voucher ki lines hoti hain; har item ka naam
// Michelin ke CA (item code) se milaya jaata hai — size + F/R + TL/TT + pattern
// ke shabdon ke overlap se. Jo match nahi hota (tube, naya SKU) wo "skipped" me dikhta hai.
//
// Michelin me do alag portal/distributor code hain:
//   2W = Scooter / Motorcycle / Royal Enfield (SC/MC/RE)  -> apna CA table, apna code
//   4W = Car / PCR (PC)                                    -> apna CAI table, apna code
// Ek hi Busy file se dono ki alag-alag InvoiceTally file banti hai — item jis
// table me match hua, us kind me chala jaata hai (size se hi alag ho jaate hain).
//
// Settings (distributor codes, CA tables) app_settings table me: sab users ke liye ek.

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
// "90/90-12", "2.75 - 18", "215/60 R16", "205/45 ZR17", "LT265/65R17", "37X12.50R17LT" -> "width-rim"
function getSize(s) { const m = /^(?:LT)?([\d.]+(?:[\/X][\d.]+)?)\s*-?\s*(?:ZR|R)?\s*(\d+)/.exec(String(s || '').toUpperCase().trim()); return m ? m[1] + '-' + m[2] : null; }
function getPos(s) { const up = String(s || '').toUpperCase(); if (/\bFRONT\b/.test(up)) return 'F'; if (/\bREAR\b/.test(up)) return 'R'; if (/\bF\b/.test(up)) return 'F'; if (/\bR\b/.test(up)) return 'R'; return null; }
function getSuffix(s) { const up = String(s || '').toUpperCase(); if (up.includes('TL/TT')) return 'TL/TT'; if (/\bTL\b/.test(up)) return 'TL'; if (/\bTT\b/.test(up)) return 'TT'; return null; }
// kind = '2W' | '4W' — index ki har entry par yaad rahta hai ki wo kis table se aayi
function buildCaIndex(caTable, kind) {
  return caTable.map(r => { const toks = {}; tokenize(r.size).forEach(t => { toks[t] = true; }); return { ca: r.ca, kind: kind || '2W', sz: getSize(r.size), pos: getPos(r.size), suf: getSuffix(r.size), toks }; });
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
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best ? { ca: best.ca, kind: best.kind } : null;
}

// CA/Size file: do column — ek CA number, ek Size text. Order koi bhi chalega
// (2W file me CA pehle, Michelin ki PCR "CAI details" file me Size pehle, CAI doosra).
const asCa = v => { if (typeof v === 'number') return isFinite(v) ? v : null; const t = String(v == null ? '' : v).trim(); return /^\d+$/.test(t) ? parseInt(t, 10) : null; };
function buildCaTableFromRows(rows) {
  const out = [];
  rows.forEach(row => {
    if (!row) return;
    const a = row[0], b = row[1];
    if (a === '' || a == null || b === '' || b == null) return;
    let ca = asCa(a), size = b;
    if (ca == null) { ca = asCa(b); size = a; }
    if (ca == null || !getSize(size)) return;
    out.push({ ca, size: String(size).trim() });
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
    const m = matchCa(itemText, caIndex);
    if (!m) { dropped.push({ vch: curVch, item: itemText }); continue; }
    // distributorCode: string (sab ke liye ek) ya { '2W': code, '4W': code }
    const code = distributorCode && typeof distributorCode === 'object' ? distributorCode[m.kind] : distributorCode;
    outRows.push({ kind: m.kind, DistributorCode: code, DealerShipName: curParty, InvoiceNumber: curVch, InvoiceDate: curDate, CAI: m.ca, ItemPricePerUnit: num(price), Quantity: num(qty), TotalAmount: num(amount), GSTIN: curGstin, SalesReturnNumber: '' });
  }
  return { outRows, dropped };
}

// Poora kaam: list xlsx buffer + settings -> har kind (2W/4W) ki { xlsx buffer, preview, totals } + dropped
// kinds = { '2W': { caTable, code }, '4W': { caTable, code } } — jis kind ki table khali ho wo skip
const KINDS = [{ kind: '2W', label: '2 Wheeler', sub: 'Scooter / Motorcycle / Royal Enfield' }, { kind: '4W', label: '4 Wheeler', sub: 'Car (PCR)' }];
function processListOfSupply(buf, kinds) {
  const sheets = readXlsx(buf);
  const sh = sheets.find(s => s.rows.length > 2) || sheets[0];
  const rows = (sh && sh.rows) || [];
  let caIndex = []; const codes = {};
  KINDS.forEach(k => { const c = (kinds || {})[k.kind]; if (!c || !c.caTable || !c.caTable.length) return; caIndex = caIndex.concat(buildCaIndex(c.caTable, k.kind)); codes[k.kind] = c.code; });
  const res = runPipeline(rows, findHeaderRow(rows), caIndex, codes);
  const outputs = KINDS.map(k => {
    const mine = res.outRows.filter(r => r.kind === k.kind);
    const totals = { qty: 0, amount: 0 };
    mine.forEach(r => { if (typeof r.Quantity === 'number') totals.qty += r.Quantity; if (typeof r.TotalAmount === 'number') totals.amount += r.TotalAmount; });
    const xlsx = mine.length ? writeXlsx([TEMPLATE_HEADERS].concat(mine.map(r => TEMPLATE_HEADERS.map(h => r[h] === undefined ? '' : r[h]))), 'Sheet1') : null;
    const preview = mine.slice(0, 8).map(r => { const o = {}; TEMPLATE_HEADERS.forEach(h => { o[h] = r[h] instanceof Date ? isoOf(r[h]) : r[h]; }); return o; });
    return { kind: k.kind, label: k.label, sub: k.sub, code: codes[k.kind] || '', enabled: k.kind in codes, xlsx, matchedCount: mine.length, preview, totals };
  });
  return { outputs, matchedCount: res.outRows.length, droppedCount: res.dropped.length, dropped: res.dropped };
}

/* Bundled default CA tables — pehli baar settings me seed hoti hain.
   2W: Aug 2026 export (distributor 2818298). 4W: Michelin "CAI - PCR details" Sep 2026 (distributor 2834373). */
const DEFAULT_DISTRIBUTOR = '2818298';
const DEFAULT_DISTRIBUTOR_4W = '2834373';
const DEFAULT_CA_TABLE = [{"ca": 79756, "size": "100/80 - 17 M/C 52P PILOT STREET 2 IND F TL"}, {"ca": 19487, "size": "100/80-12 56L CITY EXTRA F TL"}, {"ca": 598815, "size": "100/80-17 M/C 52P CITY EXTRA F TL"}, {"ca": 92018, "size": "100/90 - 17 M/C 55P CITY EXTRA R TL"}, {"ca": 755356, "size": "100/90 - 17 M/C 55P PILOT STREET 2 IND R TL"}, {"ca": 594317, "size": "100/90 - 17 M/C 55P SIRAC STREET IND R TL"}, {"ca": 628461, "size": "100/90 - 18 56P CITY PRO IND REAR TL"}, {"ca": 493860, "size": "100/90 - 18 M/C 56P CITY EXTRA R TL"}, {"ca": 992753, "size": "100/90 - 18 M/C 56P PILOT STREET 2 IND R TL"}, {"ca": 760109, "size": "100/90 - 18 M/C 56P SIRAC STREET IND R TT"}, {"ca": 584234, "size": "110/70 - 17 M/C 54P PILOT STREET 2 IND F TL"}, {"ca": 401784, "size": "110/70 R 17 M/C 54H PILOT STREET RADIAL F TL/TT"}, {"ca": 86409, "size": "110/80 - 17 M/C 57P CITY PRO IND R TL"}, {"ca": 358534, "size": "110/80 - 17 M/C 57P PILOT STREET 2 IND R TL"}, {"ca": 984534, "size": "110/80-12 61L CITY EXTRA R TL"}, {"ca": 812278, "size": "110/90 - 18 M/C 61P ANAKEE CROSS R TT"}, {"ca": 207363, "size": "110/90 - 18 M/C 61P SIRAC STREET IND R TL"}, {"ca": 34759, "size": "120/80 - 17 M/C 61P PILOT STREET 2 IND R TL"}, {"ca": 521030, "size": "120/80 - 17 M/C 67P REINF CITY EXTRA R TL"}, {"ca": 953454, "size": "120/80 - 18 62P M/C CITY PRO IND R TT"}, {"ca": 26872, "size": "130/70 - 17 M/C 62P PILOT STREET 2 IND R TL"}, {"ca": 640927, "size": "140/60 - 17 M/C 63P PILOT STREET 2 IND R TL"}, {"ca": 417144, "size": "140/70 - 17 M/C 66P CITY EXTRA R TL"}, {"ca": 250337, "size": "140/70 - 17 M/C 66P CITY PRO IND R TL"}, {"ca": 849542, "size": "150/60 - 17 M/C 66P PILOT STREET 2 IND R TL"}, {"ca": 720861, "size": "150/60 R 17 M/C 66H PILOT STREET RADIAL R TL/TT"}, {"ca": 563738, "size": "190/55 ZR17 M/C (75W) POWER SLICK EVO R TL NHS"}, {"ca": 197244, "size": "2.75 - 17 M/C 41P SIRAC STREET IND F TT"}, {"ca": 994855, "size": "2.75 - 18 42P ANAKEE CROSS F TT"}, {"ca": 827496, "size": "2.75 - 18 42P CITY EXTRA F TL"}, {"ca": 278390, "size": "2.75 - 18 48P REINF ANAKEE CROSS R TT"}, {"ca": 414038, "size": "2.75 - 18 48P REINF CITY EXTRA R TL"}, {"ca": 583123, "size": "2.75 - 18 48P REINF CITY PRO IND R TT"}, {"ca": 178722, "size": "2.75 - 18 M/C 42P CITY PRO IND F TL"}, {"ca": 792872, "size": "2.75 - 18 M/C 48P REINF SIRAC STREET IND R TT"}, {"ca": 43762, "size": "200/55 ZR 17 M/C (78W) POWER SLICK EVO NHS R TL"}, {"ca": 818669, "size": "3.00 - 17 50P REINF SIRAC STREET IND R TL"}, {"ca": 132327, "size": "3.00 - 18 52P REINF ANAKEE CR. R TT"}, {"ca": 784629, "size": "3.00 - 18 52P REINF CITY EXTRA R TL"}, {"ca": 401136, "size": "3.25 - 19 54P ANAKEE CROSS F TT"}, {"ca": 517156, "size": "3.25 - 19 M/C 54P SIRAC STREET IND FRONT TT"}, {"ca": 864872, "size": "3.50 - 10 51J CITY EXTRA TT"}, {"ca": 319704, "size": "3.50 - 19 63P REINF ANAKEE CROSS R TT"}, {"ca": 893248, "size": "3.50 - 19 M/C 63P SIRAC STREET IND REAR TT"}, {"ca": 558659, "size": "80/100 - 17 M/C 46P PILOT STREET 2 IND F TL"}, {"ca": 166921, "size": "80/100 - 18 M/C 47P ANAKEE CROSS F TL"}, {"ca": 419882, "size": "80/100 - 18 M/C 47P PILOT STREET 2 IND F TL"}, {"ca": 309283, "size": "80/100 - 18 M/C 54P REINF ANAKEE CROSS R TL"}, {"ca": 325457, "size": "80/100 - 18 M/C 54P REINF PILOT STREET 2 IND R TL"}, {"ca": 69309, "size": "80/100-17 M/C 46P CITY EXTRA F TL"}, {"ca": 718583, "size": "80/100-18 M/C 47P CITY EXTRA F TL"}, {"ca": 389518, "size": "80/100-18 M/C 54P REINF CITY EXTRA R TL"}, {"ca": 973385, "size": "90/100 - 10 53J ANAKEE CROSS TL"}, {"ca": 65778, "size": "90/100 - 10 53J CITY EXTRA IND TL"}, {"ca": 887518, "size": "90/100 - 10 53J PILOT STREET 2 IND TL"}, {"ca": 565578, "size": "90/90 - 12 54J ANAKEE CROSS TL"}, {"ca": 572699, "size": "90/90 - 12 54J CITY EXTRA IND TL"}, {"ca": 310067, "size": "90/90 - 12 54J PILOT STREET 2 IND TL"}, {"ca": 495882, "size": "90/90 - 17 M/C 49P CITY EXTRA F TL"}, {"ca": 488742, "size": "90/90 - 17 M/C 49P PILOT STREET 2 IND F TL"}, {"ca": 946977, "size": "90/90 - 19 M/C 52P ANAKEE CROSS F TT"}];

const DEFAULT_CA_TABLE_4W = [{"ca": 993333, "size": "195/55 R16 91V EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 773169, "size": "195/60 R16 93V EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 51232, "size": "205/45 ZR17 (88Y) XL TL PILOT SPORT 5 MI"}, {"ca": 479149, "size": "205/55 R16 91W TL PRIMACY 4 ST MI"}, {"ca": 206398, "size": "205/55 R17 95W XL TL PRIMACY 4 * MI"}, {"ca": 992347, "size": "205/60 R16 92V TL PRIMACY 4 ST MI"}, {"ca": 41035, "size": "205/65 R16 95H TL ENERGY XM2 + MI"}, {"ca": 283772, "size": "205/65 R16 95V TL PRIMACY 4 ST MI"}, {"ca": 985376, "size": "215/50 R17 95W EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 296526, "size": "215/55 R16 97W EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 461525, "size": "215/55 R17 94V TL PRIMACY 4 ST MI"}, {"ca": 134563, "size": "215/55 R18 99V XL TL PRIMACY 4 VOL MI"}, {"ca": 784049, "size": "215/60 R16 99V EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 189046, "size": "215/60 R17 96V TL PRIMACY 4 ST MI"}, {"ca": 393352, "size": "225/45 R18 95Y EXTRA LOAD TL PRIMACY 3 ZP MOE GRNX MI"}, {"ca": 504069, "size": "225/45 R18 95Y XL TL PILOT SPORT 4 ZP *  MI"}, {"ca": 371721, "size": "225/45 ZR17 (94Y) XL TL PILOT SPORT 5 MI"}, {"ca": 334382, "size": "225/45 ZR18 (95Y) XL TL PILOT SPORT 5 MI"}, {"ca": 319647, "size": "225/50 ZR17 (98Y) XL TL PILOT SPORT 5 MI"}, {"ca": 389173, "size": "225/55 R17 101W EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 206074, "size": "225/60 R17 99V TL PRIMACY SUV+ MI"}, {"ca": 834872, "size": "235/45 ZR18 (98Y) XL TL PILOT SPORT 5 MI"}, {"ca": 981051, "size": "235/50 ZR18 (101Y) XL TL PILOT SPORT 5 MI"}, {"ca": 559663, "size": "235/55 R17 103W EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 691101, "size": "235/55 R18 104V XL TL LATITUDE SPORT 3 VOL GRNX MI"}, {"ca": 227379, "size": "235/60 R18 103V TL PRIMACY SUV+ MI"}, {"ca": 844150, "size": "235/65 R17 108T XL TL LTX TRAIL ST  MI"}, {"ca": 352797, "size": "235/65 R17 108V EXTRA LOAD TL PRIMACY SUV+ MI"}, {"ca": 698035, "size": "245/35 ZR20 (95Y) EXTRALOAD TL PILOT SPORT CUP 2 N1 MI"}, {"ca": 262100, "size": "245/40 R18 97Y EXTRA LOAD TL PRIMACY 3 ZP MOE GRNX MI"}, {"ca": 238305, "size": "245/40 ZR20 99Y XL TL PILOT SPORT 4 ZP MI"}, {"ca": 979298, "size": "245/45 R18 100W EXTRA LOAD TL PRIMACY 4 ST MI"}, {"ca": 831899, "size": "245/45 R18 100Y XL TL PRIMACY 3 ZP*MOE GRNX MI"}, {"ca": 241279, "size": "245/45 R19 98Y TL PRIMACY 3 ZP * S1 GRNX MI"}, {"ca": 948389, "size": "245/50 R18 100Y TL PRIMACY 3 ZP * GRNX MI"}, {"ca": 414419, "size": "245/50 R19 105W XL TL LATITUDE SPORT 3 ZP* GRNX MI"}, {"ca": 356061, "size": "245/50 R19 105W XL TL PILOT SPORT 4 SUV * MI"}, {"ca": 352314, "size": "245/50 ZR18 (104Y) XL TL PILOT SPORT 5 MI"}, {"ca": 291028, "size": "245/65 R17 107H TL PRIMACY SUV+ MI"}, {"ca": 170132, "size": "255/35 ZR20 (97Y) XL PILOT SPORT CUP 2 R CONNECT N0 MI"}, {"ca": 379499, "size": "255/40 R18 99Y XL TL PILOT SPORT 4 ZP * MI"}, {"ca": 551571, "size": "255/40 ZR18 (99Y) XL TL PILOT SPORT 5 MI"}, {"ca": 924612, "size": "255/45 R20 105W XL PILOT SPORT EV ACOUSTIC GOE  MI"}, {"ca": 710080, "size": "255/50 R19 103Y TL LATITUDE SPORT 3 MO1 GRNX MI"}, {"ca": 919695, "size": "255/50 R19 107W XL TL LATITUDE SPORT 3 ZP GRNX MI"}, {"ca": 579370, "size": "255/50 R20 109Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 760575, "size": "255/55 R18 109V XL TL LATITUDE SPORT 3 ZP* GRNX MI"}, {"ca": 661828, "size": "255/55 R18 109Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 770932, "size": "255/55 R20 110Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 711702, "size": "265/35 ZR20 (99Y) XL TL PILOT SPORT CUP 2 N2 MI"}, {"ca": 627698, "size": "265/40 ZR20 (104Y) XL TL PILOT SPORT 4 S MO1 A  MI"}, {"ca": 882370, "size": "265/50 R19 110Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 544440, "size": "265/60 R18 110H TL PRIMACY SUV+ MI"}, {"ca": 17662, "size": "265/60 R18 110T TL LTX TRAIL ST MI"}, {"ca": 292920, "size": "265/65 R17 112H TL PRIMACY SUV+ MI"}, {"ca": 12419, "size": "265/65 R17 112T TL LTX TRAIL ST MI"}, {"ca": 200803, "size": "275/35 ZR20 102Y XL TL PILOT SPORT 4 ZP MI"}, {"ca": 432853, "size": "275/40 R18 99Y TL PRIMACY 3 ZP *MOE GRNX MI"}, {"ca": 167883, "size": "275/40 R19 101Y TL PRIMACY 3 ZP * S1 GRNX MI"}, {"ca": 633855, "size": "275/45 R21 107Y TL LATITUDE SPORT 3 MO GRNX MI"}, {"ca": 386376, "size": "275/50 R21 113V XL TL PILOT SPORT 4 SUV MI"}, {"ca": 681104, "size": "275/50 ZR20 113Y XL TL PILOT SPORT 4 SUV MO1 MI"}, {"ca": 631950, "size": "285/35 ZR22 (106Y) XL TL PILOT SPORT 4 S N0 MI"}, {"ca": 780219, "size": "285/45 R21 113Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 705963, "size": "285/45 R22 114Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 983867, "size": "285/50 R20 116W XL TL PILOT SPORT 4 SUV MI"}, {"ca": 26584, "size": "285/60 R18 116T TL LTX TRAIL ST MI"}, {"ca": 234050, "size": "285/60 R18 116V TL PRIMACY SUV+ MI"}, {"ca": 824985, "size": "295/40 R20 110Y XL TL PILOT SPORT 4 SUV MI"}, {"ca": 993883, "size": "305/30 ZR20 (103Y) XL TL PILOT SPORT CUP 2 N1 MI"}, {"ca": 139704, "size": "315/30 ZR21 (105Y)XL PILOT SPORT CUP 2 R CONNECT N0 MI"}, {"ca": 648064, "size": "315/40 R21 111Y TL LATITUDE SPORT 3 MO GRNX MI"}, {"ca": 416664, "size": "315/40 ZR21 (115Y) XL TL PILOT SPORT 4 SUV NC0 MI"}, {"ca": 17163, "size": "325/30 ZR21 (108Y) XL TL PILOT SPORT CUP 2 N2 MI"}, {"ca": 185941, "size": "37X12.50R17LT 124R TL ALL-TERRAIN T/A KO2 LRD RWLGO"}, {"ca": 546862, "size": "LT265/65R17 120/117S TL ALL-TERRAIN T/A KO2 LRE RWL GO"}];

module.exports = { TEMPLATE_HEADERS, KINDS, DEFAULT_DISTRIBUTOR, DEFAULT_DISTRIBUTOR_4W, DEFAULT_CA_TABLE, DEFAULT_CA_TABLE_4W, tokenize, getSize, getPos, getSuffix, buildCaIndex, matchCa, buildCaTableFromRows, findHeaderRow, runPipeline, processListOfSupply };
