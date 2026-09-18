// Purane Apps Script/Sheets Claim system ka poora historical data naye MySQL
// claims system me laana — ek-baar wali migration (ongoing seed NAHI, isliye
// ensure-schema.js ke boot-hook me nahi hai).
//
//   node data/scripts/import-legacy-claims.js [--dry-run] [--no-sql]
//
// Google Sheets (link-shared, public CSV export — koi credential nahi chahiye):
//   DATA_SHEET     "Data" tab       — asli Claim Entry submissions (NewClaim/WithoutOnline/ReturnDealer)
//   AREA_SHEET     12 AREA tabs     — har claim ka aaj ka status (jis tab me baitha hai)
//                  + NOTIFICATIONS  — status-change audit log (claim_status_log seed)
//                  + Form Responses 1 — receiving upload log (chhota)
//   RECEIVING_SHEET "CLAIMRECEIVING" — receiving upload log (mukhya source, 1056 rows)
//   ACK_SHEET      ACK Tracking sheet (claim_ack seed)
//
// Merge strategy: Data tab base record (entry_type/dealer/material/stencil/mould),
// har AREA tab overlay se current status (workflow order me — baad wala tab jeetta
// hai agar kahin duplicate mile). Jo claim_no AREA tab me hai par Data tab me nahi
// (WithoutOnline/NoDataTyre jaise jo seedha AREA me likhe gaye), unhe standalone
// row banaya jaata hai us tab ke apne columns se.
//
// Dobara chalana safe hai: claims.claim_no par UNIQUE hai, INSERT IGNORE karta hai.
// WithoutOnline rows ka claim_no hamesha NULL hota hai (online claim number kabhi
// mila hi nahi) — MySQL unique key me kai NULL allowed hain, to wo sab alag row
// bante hain (jaisa sheet me the).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const db = require('../db');

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const DRY = flag('--dry-run');
const WRITE_SQL = !flag('--no-sql');
// Pehli baar --full se poora history (Without Online jaisi bina-claim-no rows
// samet) ek-baar daalte hain. Uske baad plain resync: sirf claim_no wali rows
// upsert hoti hain (status/remark/receiving refresh), bina-claim-no rows dobara
// nahi jodi jaatin (unka koi stable identity nahi — dobara jodna duplicate kar
// deta). Status-log sirf DB me jo pehle se hai uske baad ka hi jodta hai.
const FULL = flag('--full');

const MIGR = path.join(__dirname, '..', 'migrations', 'mysql');
const SEED_FILE = path.join(MIGR, FULL ? 'seed-claims-legacy.sql' : `seed-claims-resync-${new Date().toISOString().slice(0, 10)}.sql`);

const DATA_SHEET = '1KWIKthVwl8CTc1xGeLSdlOWvPbFIO86Ee1nC3hEg_Hw';
const AREA_SHEET = '1sO_yB_XKJjsz1WJjZyGyl3ww8lwZ8Z08TFNuXK2Shys';
const RECEIVING_SHEET = '1HYROFUhnToBITrWf_uxovOfmX5VVMmmZ1wR8xA7R40k';
const ACK_SHEET = '1cnQdWgAvOpFOsZIZX0kWhwnB7IAHHocJezptRmhnBnI';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}
const gvizUrl = (id, tab) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
const exportUrl = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;

// same robust CSV parser as data/scripts/import-checklist-sheet.js
function parseRows(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(f => (f || '').trim()));
}

// Do tarah ke timestamp is data me hain: "11/27/2025 12:19:40" (M/D/YYYY, Google
// Form ka auto-column) aur "27/11/2025   10:41:22  " (D/M/YYYY, Apps Script ne
// Utilities.formatDate se likha, extra padding spaces ke saath). Padding hi
// bharosemand signal hai ki kaunsa format hai.
function parseDT(v) {
  v = (v || '').trim();
  if (!v) return null;
  const padded = /\d{4}\s{2,}\d{1,2}:/.test(v);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, a, b, y, hh, mm, ss] = m;
    let [dd, mo] = padded ? [a, b] : [b, a];
    // Ek tarafa heuristic kabhi-kabhi galat padta hai (mixed formatting, saal
    // bhar ki manual entry) — agar mahina 12 se zyada nikle to dd/mo palat do,
    // varna invalid date MySQL me insert hote hi fail ho jaati.
    if (+mo > 12 && +dd <= 12) [dd, mo] = [mo, dd];
    const date = `${y}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    return { date, ts: `${date} ${hh.padStart(2, '0')}:${mm}:${ss || '00'}` };
  }
  const d = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (d) {
    // date-only cells (ACK sheet) — is dataset me hamesha DD/MM/YYYY
    const [, dd, mo, y] = d;
    return { date: `${y}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`, ts: null };
  }
  return null;
}

const sq = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
const sqlv = v => (v === null || v === undefined || v === '') ? 'NULL' : `'${sq(v)}'`;
const sqlvS = v => `'${sq(v || '')}'`;

// header row se column index nikalna, header-naam ke variants ke saath
function headerMap(rows) {
  const header = rows[0].map(h => (h || '').trim().toUpperCase());
  return (...names) => { for (const n of names) { const i = header.indexOf(n.toUpperCase()); if (i !== -1) return i; } return -1; };
}

// claim number jo asal me placeholder hai ("NA"/"NO"/khaali) — WithoutOnline
// entries ka kabhi online claim number milta hi nahi.
function realClaimNo(v) {
  const s = (v || '').trim().toUpperCase();
  if (!s || s === 'NA' || s === 'NO' || s === 'N/A') return null;
  return v.trim();
}

const STATUS_TEXT_MAP = {
  accepted: 'ACCEPTED', rejected: 'REJECTED', hold: 'HOLD', resubmitted: 'RESUBMITTED',
  'send back to dealer': 'SEND_BACK_TO_DEALER', 'rejected dispatched': 'REJECTED_DISPATCHED',
  done: 'DONE', inspection: 'INSPECTION',
};
function mapStatusText(v) { return STATUS_TEXT_MAP[(v || '').trim().toLowerCase()] || null; }

// REJECTED DISPATCHED tab ke RECEIVING column me sirf Drive link matlab "receive ho
// gaya"; kuch rows me wahan literal text "Pending" likha hota hai (abhi tak nahi
// aayi) — usko truthy maan lena galat "already received" bana deta tha.
function isRealLink(v) { return /^https?:\/\//i.test((v || '').trim()); }

(async () => {
  console.log(DRY ? '[DRY RUN — DB me kuch nahi likhega]' : '[LIVE — local DB me likhega]');

  // ── 1) Data tab: base claim entries ──────────────────────────────────
  console.log('fetching Data tab...');
  const dataRows = parseRows(await fetchUrl(gvizUrl(DATA_SHEET, 'Data')));
  const dCol = headerMap(dataRows);
  const D = {
    ts: dCol('TIMESTAMP'), type: dCol('TYRE STATUS'), claimNo: dCol('CLAIM NO.'),
    dealer: dCol('DEALER NAME'), material: dCol('MATERIAL'), stencil: dCol('STENCIAL NO.'), mould: dCol('MOULD NO.'),
  };
  const ENTRY_TYPE_MAP = { newclaim: 'NEW_CLAIM', returndealer: 'RETURN_DEALER', withoutonline: 'WITHOUT_ONLINE' };
  const ENTRY_INITIAL_STATUS = { NEW_CLAIM: 'INSPECTION', WITHOUT_ONLINE: 'WITHOUT_ONLINE', RETURN_DEALER: 'RETURN_BY_DEALER', NO_DATA_TYRE: 'NO_DATA_TYRE' };

  const claims = new Map(); // claim_no -> claim record
  const noNumberClaims = []; // WithoutOnline rows jinka claim_no kabhi nahi tha
  let dataSkippedWithoutOnline = 0;
  for (let i = 1; i < dataRows.length; i++) {
    const r = dataRows[i]; const g = idx => (idx === -1 ? '' : (r[idx] || '').trim());
    const entryType = ENTRY_TYPE_MAP[g(D.type).toLowerCase()];
    if (!entryType) continue;
    if (entryType === 'WITHOUT_ONLINE') { dataSkippedWithoutOnline++; continue; } // WITHOUT ONLINE AREA tab se aayenge (remark ke saath)
    const claimNo = realClaimNo(g(D.claimNo));
    if (!claimNo) continue;
    const t = parseDT(g(D.ts));
    claims.set(claimNo, {
      claim_no: claimNo, entry_type: entryType, dealer_name: g(D.dealer), material: g(D.material),
      stencil_no: g(D.stencil), mould_no: g(D.mould), status: ENTRY_INITIAL_STATUS[entryType],
      remark: '', receiving: null, received_at: null, created_at: t ? (t.ts || `${t.date} 00:00:00`) : null,
      swept: false, // AREA tab me kabhi dikha hi nahi — "Data" tab me hi atki hai, purana dashboard bhi ise kabhi ginta nahi
    });
  }
  console.log(`  Data tab: ${claims.size} claims (NewClaim+ReturnDealer), ${dataSkippedWithoutOnline} WithoutOnline chhode (AREA tab se aayenge)`);

  // ── 2) AREA tabs: overlay current status (workflow order — baad wala jeetega) ──
  const AREA_TABS = [
    { tab: 'INSPECTION AREA', status: 'INSPECTION' },
    { tab: 'ACCEPTED AREA', status: 'ACCEPTED' },
    { tab: 'REJECTED AREA', status: 'REJECTED' },
    { tab: 'HOLD AREA', status: 'HOLD' },
    { tab: 'RESUBMITTED AREA', status: 'RESUBMITTED' },
    { tab: 'Return By Dealer', status: 'RETURN_BY_DEALER' },
    { tab: 'SEND BACK TO DEALER', status: 'SEND_BACK_TO_DEALER' },
    { tab: 'PLANT', status: 'PLANT', doneAware: true },
    // FG-KUNDLI ka header row corrupt hai (kisi ne ek cell me bahut saare claim
    // number paste kar diye the) — header-name lookup fail karta hai, isliye
    // yahan fixed column position use karte hain (data rows khud saaf hain).
    { tab: 'FG-KUNDLI', status: 'FG_KUNDLI', doneAware: true, positional: [0, 1, 2, 3, 4, 5] },
    { tab: 'REJECTED DISPATCHED', status: 'REJECTED_DISPATCHED', receivingCol: 'RECEIVING' },
  ];
  const orphansAdded = { count: 0 };
  for (const spec of AREA_TABS) {
    console.log(`fetching AREA tab "${spec.tab}"...`);
    const rows = parseRows(await fetchUrl(gvizUrl(AREA_SHEET, spec.tab)));
    if (rows.length < 2) { console.log(`  (khaali)`); continue; }
    const col = headerMap(rows);
    const C = spec.positional
      ? { ts: spec.positional[0], claimNo: spec.positional[1], dealer: spec.positional[2], material: spec.positional[3], stencil: spec.positional[4], status: spec.positional[5], receiving: -1 }
      : {
          ts: col('TIMESTAMP', 'TIMESTAMP '), claimNo: col('CLAIM NO.'), dealer: col('DEALER NAME'),
          material: col('MATERIAL'), stencil: col('STENCIAL NO.'), status: col('STATUS'),
          receiving: spec.receivingCol ? col(spec.receivingCol) : -1,
        };
    let matched = 0, added = 0, receivingSetInline = 0;
    // FG-KUNDLI ka row 1 me ek corrupt pasted cell hai — sirf header line 0 skip, baaki normal
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; const g = idx => (idx === -1 ? '' : (r[idx] || '').trim());
      const claimNo = realClaimNo(g(C.claimNo));
      if (!claimNo) continue;
      const t = parseDT(g(C.ts));
      let status = spec.status;
      if (spec.doneAware) { const s = mapStatusText(g(C.status)); if (s === 'DONE') status = 'DONE'; }
      let existing = claims.get(claimNo);
      if (!existing) {
        existing = {
          claim_no: claimNo, entry_type: 'NEW_CLAIM', dealer_name: g(C.dealer), material: g(C.material),
          stencil_no: g(C.stencil), mould_no: '', status, remark: '', receiving: null, received_at: null,
          created_at: t ? (t.ts || `${t.date} 00:00:00`) : null, swept: true,
        };
        claims.set(claimNo, existing);
        added++; orphansAdded.count++;
      } else {
        existing.status = status;
        existing.swept = true;
        matched++;
      }
      if (spec.receivingCol) {
        const link = g(C.receiving);
        if (isRealLink(link)) { existing.receiving = link; existing.received_at = existing.received_at || (t ? (t.ts || `${t.date} 00:00:00`) : null); receivingSetInline++; }
      }
    }
    console.log(`  ${rows.length - 1} rows: ${matched} overlaid onto Data-tab claims, ${added} naye (orphan) claims` + (spec.receivingCol ? `, ${receivingSetInline} receiving inline se mila` : ''));
  }

  // NO DATA TYRE AREA: header-based columns theek hain, bas dealer-required filter
  // dheela karte hain — is tab ke baad ke rows me dealer/claim_no khaali chhoda gaya
  // hai par material/stencil bhare hain (asli history, girana theek nahi).
  {
    const spec = { tab: 'NO DATA TYRE AREA', status: 'NO_DATA_TYRE', entryType: 'NO_DATA_TYRE' };
    console.log(`fetching AREA tab "${spec.tab}"...`);
    const rows = parseRows(await fetchUrl(gvizUrl(AREA_SHEET, spec.tab)));
    const col = headerMap(rows);
    const C = {
      ts: col('TIMESTAMP', 'TIMESTAMP '), claimNo: col('CLAIM NO.'), dealer: col('DEALER NAME', 'DELAER NAME'),
      material: col('MATERIAL', 'TYRE SIZE'), stencil: col('STENCIAL NO.'), status: col('STATUS'),
    };
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; const g = idx => (idx === -1 ? '' : (r[idx] || '').trim());
      const dealer = g(C.dealer), material = g(C.material), stencil = g(C.stencil);
      if (!dealer && !material && !stencil) continue;
      const t = parseDT(g(C.ts));
      const claimNo = realClaimNo(g(C.claimNo));
      const rec = {
        claim_no: claimNo, entry_type: spec.entryType, dealer_name: dealer, material, stencil_no: stencil,
        mould_no: '', status: spec.status, remark: g(C.status),
        receiving: null, received_at: null, created_at: t ? (t.ts || `${t.date} 00:00:00`) : null, swept: true,
      };
      if (claimNo && claims.has(claimNo)) { Object.assign(claims.get(claimNo), rec); }
      else if (claimNo) { claims.set(claimNo, rec); }
      else { noNumberClaims.push(rec); }
      n++;
    }
    console.log(`  ${n} rows`);
  }

  // WITHOUT ONLINE AREA: is tab ki column-shape sheet ki history me drift hui hai
  // (kabhi ek placeholder column "NA"/"NO"/"ND" tha claim-no ki jagah, kabhi do
  // khaali columns, kabhi koi nahi) — header-based fixed index bharosemand nahi.
  // Har row me se leading blank/placeholder cells khud hi chhodte hain, phir jo
  // pehla asli cell mile wahi DEALER maana jaata hai.
  {
    console.log('fetching AREA tab "WITHOUT ONLINE AREA"...');
    const rows = parseRows(await fetchUrl(gvizUrl(AREA_SHEET, 'WITHOUT ONLINE AREA')));
    const isPlaceholder = v => { const s = (v || '').trim().toUpperCase(); return s === '' || s === 'NA' || s === 'NO' || s === 'ND' || s === 'N/A'; };
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const ts = (r[0] || '').trim();
      let j = 1;
      while (j < r.length && isPlaceholder(r[j])) j++;
      const dealer = (r[j] || '').trim(); if (!dealer) continue;
      const material = (r[j + 1] || '').trim(), stencil = (r[j + 2] || '').trim(), remark = (r[j + 3] || '').trim();
      const t = parseDT(ts);
      const rec = {
        claim_no: null, entry_type: 'WITHOUT_ONLINE', dealer_name: dealer, material, stencil_no: stencil,
        mould_no: '', status: 'WITHOUT_ONLINE', remark,
        receiving: null, received_at: null, created_at: t ? (t.ts || `${t.date} 00:00:00`) : null,
      };
      noNumberClaims.push(rec);
      n++;
    }
    console.log(`  ${n} rows`);
  }
  console.log(`AREA overlay done: ${claims.size} claims with claim_no, ${noNumberClaims.length} bina claim_no (Without Online), ${orphansAdded.count} orphan (sirf AREA tab me the)`);

  // ── 3) Receiving: CLAIMRECEIVING (mukhya) + Form Responses 1 (chhota) ──────
  async function loadReceivingMap() {
    const map = new Map();
    console.log('fetching CLAIMRECEIVING...');
    const r1 = parseRows(await fetchUrl(gvizUrl(RECEIVING_SHEET, 'CLAIMRECEIVING')));
    const c1 = headerMap(r1);
    const ts1 = c1('TIMESTAMP'), cn1 = c1('CLAIM NUMBER'), link1 = c1('PDF LINK');
    for (let i = 1; i < r1.length; i++) {
      const row = r1[i]; const cn = realClaimNo(row[cn1]); const link = (row[link1] || '').trim();
      if (!cn || !isRealLink(link)) continue;
      const t = parseDT((row[ts1] || '').trim());
      if (!map.has(cn)) map.set(cn, { link, at: t ? (t.ts || `${t.date} 00:00:00`) : null });
    }
    console.log(`  ${map.size} claim receiving records (CLAIMRECEIVING)`);
    console.log('fetching Form Responses 1...');
    const r2 = parseRows(await fetchUrl(gvizUrl(AREA_SHEET, 'Form Responses 1')));
    const c2 = headerMap(r2);
    const ts2 = c2('TIMESTAMP'), cn2 = c2('CLAIM NO.'), link2 = c2('RECEIVING UPLOAD');
    let added = 0;
    for (let i = 1; i < r2.length; i++) {
      const row = r2[i]; const cn = realClaimNo(row[cn2]); const link = (row[link2] || '').trim();
      if (!cn || !isRealLink(link) || map.has(cn)) continue;
      const t = parseDT((row[ts2] || '').trim());
      map.set(cn, { link, at: t ? (t.ts || `${t.date} 00:00:00`) : null }); added++;
    }
    console.log(`  +${added} extra (Form Responses 1)`);
    return map;
  }
  const receivingMap = await loadReceivingMap();
  let receivingApplied = 0;
  for (const c of claims.values()) {
    if (c.status !== 'REJECTED_DISPATCHED') continue;
    const rec = receivingMap.get(c.claim_no);
    if (rec && !c.receiving) { c.receiving = rec.link; c.received_at = rec.at; receivingApplied++; }
  }
  console.log(`receiving attached: ${receivingApplied} Rejected-Dispatched claims`);

  // ── 4) NOTIFICATIONS: status-change audit log ──────────────────────────
  console.log('fetching NOTIFICATIONS (bada tab, thoda time lagega)...');
  const notifRows = parseRows(await fetchUrl(gvizUrl(AREA_SHEET, 'NOTIFICATIONS')));
  const nCol = headerMap(notifRows);
  const N = { ts: nCol('TIMESTAMP', 'TIMESTAMP '), area: nCol('AREA'), status: nCol('STATUS'), claimNo: nCol('CLAIMNUMBER') };
  const statusLogs = []; // { claim_no, to_status, note, changed_at }
  let notifSkippedNoMatch = 0, notifSkippedNoStatus = 0;
  for (let i = 1; i < notifRows.length; i++) {
    const r = notifRows[i]; const g = idx => (idx === -1 ? '' : (r[idx] || '').trim());
    const claimNo = realClaimNo(g(N.claimNo));
    if (!claimNo || !claims.has(claimNo)) { notifSkippedNoMatch++; continue; }
    const to = mapStatusText(g(N.status));
    if (!to) { notifSkippedNoStatus++; continue; }
    const t = parseDT(g(N.ts));
    statusLogs.push({ claim_no: claimNo, to_status: to, note: `Area: ${g(N.area)}`, changed_at: t ? (t.ts || `${t.date} 00:00:00`) : null });
  }
  console.log(`  ${statusLogs.length} status-log entries usable (${notifSkippedNoMatch} claim not found, ${notifSkippedNoStatus} unrecognized status text)`);

  // ── 5) ACK Tracking ─────────────────────────────────────────────────────
  console.log('fetching ACK Tracking...');
  const ackRows = parseRows(await fetchUrl(exportUrl(ACK_SHEET, '0')));
  const aCol = headerMap(ackRows);
  const A = { claimNo: aCol('CLAIM NUMBER'), dealer: aCol('DEALER NAME'), item: aCol('ITEM DESC'), stencil: aCol('STENCIL NUMBER'), date: aCol('CLAIM DATE'), status: aCol('STATUS') };
  const ackOut = [];
  for (let i = 1; i < ackRows.length; i++) {
    const r = ackRows[i]; const g = idx => (idx === -1 ? '' : (r[idx] || '').trim());
    const claimNo = g(A.claimNo); if (!claimNo) continue;
    const t = parseDT(g(A.date));
    ackOut.push({ claim_no: claimNo, dealer_name: g(A.dealer), item_desc: g(A.item), stencil_no: g(A.stencil), claim_date: t ? t.date : null, status: g(A.status) });
  }
  console.log(`  ${ackOut.length} ACK rows`);

  // Jo claim kabhi kisi AREA tab me dikhi hi nahi (sirf Data tab me atki reh gayi) —
  // purana dashboard bhi inhe kabhi ginta nahi tha (wo bhi sirf AREA tabs ginta
  // hai). Remark me internal marker daal dete hain taaki dashboard/list unhe
  // chhod de, par data delete nahi hota — claim number se search karke mil jaati hain.
  let unsweptCount = 0;
  for (const c of claims.values()) {
    if (!c.swept) { c.remark = '__UNSWEPT__'; unsweptCount++; }
  }
  if (unsweptCount) console.log(`  ${unsweptCount} claims kabhi AREA tab me nahi dikhi (Data tab me hi atki) — dashboard se hidden rahengi`);

  // ── dealers seen (for claim_dealers) ────────────────────────────────────
  const dealerSet = new Set();
  for (const c of claims.values()) if (c.dealer_name) dealerSet.add(c.dealer_name);
  for (const c of noNumberClaims) if (c.dealer_name) dealerSet.add(c.dealer_name);

  // ═══════════════════════════════════════════════════════════════════════
  // Resync me (default) sirf claim_no wali rows jaati hain — Without Online jaisi
  // bina-number rows sirf --full wale pehle-baar-import me shaamil hoti hain.
  const allClaims = FULL ? [...claims.values(), ...noNumberClaims] : [...claims.values()];
  console.log('\n── SUMMARY (DB me abhi kuch nahi likha) ──' + (FULL ? '' : '  [RESYNC — sirf claim_no wali rows upsert]'));
  console.log(`total claims to insert : ${allClaims.length}`);
  const byStatus = {};
  for (const c of allClaims) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(20)} ${v}`);
  console.log(`status-log rows        : ${statusLogs.length}`);
  console.log(`ack rows               : ${ackOut.length}`);
  console.log(`distinct dealers       : ${dealerSet.size}`);

  if (DRY) { await db.end(); return; }

  // ── DB likhna ─────────────────────────────────────────────────────────
  console.log('\nDB me likh rahe hain...');
  const UPSERT_SQL = FULL
    ? 'INSERT IGNORE INTO claims (claim_no,entry_type,dealer_name,material,stencil_no,mould_no,status,remark,receiving,received_at,created_at) VALUES ?'
    : 'INSERT INTO claims (claim_no,entry_type,dealer_name,material,stencil_no,mould_no,status,remark,receiving,received_at,created_at) VALUES ? ' +
      'ON DUPLICATE KEY UPDATE status=VALUES(status), remark=VALUES(remark), receiving=VALUES(receiving), received_at=VALUES(received_at)';
  for (let i = 0; i < allClaims.length; i += 500) {
    const chunk = allClaims.slice(i, i + 500).map(c => [
      c.claim_no, c.entry_type, c.dealer_name || '', c.material || '', c.stencil_no || '', c.mould_no || '',
      c.status, c.remark || '', c.receiving, c.received_at, c.created_at,
    ]);
    await db.query(UPSERT_SQL, [chunk]);
  }
  console.log(`  ✓ claims ${FULL ? 'inserted (INSERT IGNORE)' : 'upserted (naye insert, purane status/remark/receiving refresh)'}: ${allClaims.length} rows`);

  // Resync me sirf watermark (jo already DB me hai usse aage) ke baad ka status-log
  // jodte hain — poora NOTIFICATIONS dobara daalne se history duplicate ho jaati.
  const [[wm]] = await db.query('SELECT MAX(changed_at) w FROM claim_status_log');
  const watermark = FULL ? null : wm.w;
  if (watermark) console.log(`  status-log watermark: ${watermark.toISOString ? watermark.toISOString() : watermark} se aage ka hi jodenge`);
  const [dbClaims] = await db.query('SELECT id, claim_no FROM claims WHERE claim_no IS NOT NULL');
  const idByClaimNo = new Map(dbClaims.map(r => [r.claim_no, r.id]));
  const logsToInsert = watermark ? statusLogs.filter(l => l.changed_at && new Date(l.changed_at) > new Date(watermark)) : statusLogs;
  let logInserted = 0, logSkipped = 0;
  for (let i = 0; i < logsToInsert.length; i += 500) {
    const chunk = logsToInsert.slice(i, i + 500)
      .map(l => { const cid = idByClaimNo.get(l.claim_no); return cid ? [cid, '', l.to_status, l.note, l.changed_at || new Date()] : null; })
      .filter(Boolean);
    logSkipped += logsToInsert.slice(i, i + 500).length - chunk.length;
    if (chunk.length) { await db.query('INSERT INTO claim_status_log (claim_id,from_status,to_status,note,changed_at) VALUES ?', [chunk]); logInserted += chunk.length; }
  }
  console.log(`  ✓ status log inserted: ${logInserted} (${logSkipped} skipped, claim id not resolved${watermark ? `; ${statusLogs.length - logsToInsert.length} pehle se DB me the (watermark se pehle)` : ''})`);

  if (ackOut.length) {
    // ACK Tracking hamesha poora replace hota hai (jaisa admin-upload feature bhi karta hai).
    await db.query('DELETE FROM claim_ack');
    for (let i = 0; i < ackOut.length; i += 500) {
      const chunk = ackOut.slice(i, i + 500).map(a => [a.claim_no, a.dealer_name, a.item_desc, a.stencil_no, a.claim_date, a.status]);
      await db.query('INSERT INTO claim_ack (claim_no,dealer_name,item_desc,stencil_no,claim_date,status) VALUES ?', [chunk]);
    }
    console.log(`  ✓ claim_ack replaced: ${ackOut.length}`);
  }

  if (dealerSet.size) {
    const chunk = [...dealerSet].map(d => [d]);
    await db.query('INSERT IGNORE INTO claim_dealers (name) VALUES ?', [chunk]);
    console.log(`  ✓ claim_dealers: ${dealerSet.size} attempted (INSERT IGNORE)`);
  }

  // ── production ke liye seed .sql (phpMyAdmin se apply — jaisa checklist import me hua) ──
  if (WRITE_SQL) {
    const lines = [
      FULL
        ? '-- Legacy Claims migration (Google Sheets se, data/scripts/import-legacy-claims.js ne banaya).'
        : '-- Legacy Claims RESYNC (Google Sheets se, data/scripts/import-legacy-claims.js --resync ne banaya).',
      FULL
        ? '-- EK BAAR chalayen (phpMyAdmin me poora paste karke Go). Dobara chalana bhi safe hai:'
        : '-- Naye/badle hue claims hi upsert karta hai (status/remark/receiving refresh); Without Online jaisi',
      FULL
        ? '-- claims.claim_no UNIQUE hai (INSERT IGNORE), status-log/ack me dedupe nahi hai isliye dobara mat chalana.'
        : '-- bina-claim-no rows dobara nahi jodta. Status-log khud watermark se aage ka hi jodta hai (safe re-run).',
      `-- Generated: ${new Date().toISOString().slice(0, 10)}  |  claims: ${allClaims.length}  status-log candidates: ${statusLogs.length}  ack: ${ackOut.length}  dealers: ${dealerSet.size}`,
      '',
    ];
    for (let i = 0; i < allClaims.length; i += 200) {
      const vals = allClaims.slice(i, i + 200).map(c =>
        `(${sqlv(c.claim_no)}, ${sqlvS(c.entry_type)}, ${sqlvS(c.dealer_name)}, ${sqlvS(c.material)}, ${sqlvS(c.stencil_no)}, ${sqlvS(c.mould_no)}, ${sqlvS(c.status)}, ${sqlvS(c.remark)}, ${sqlv(c.receiving)}, ${sqlv(c.received_at)}, ${sqlv(c.created_at) === 'NULL' ? 'CURRENT_TIMESTAMP' : sqlv(c.created_at)})`);
      const insertHead = FULL
        ? 'INSERT IGNORE INTO claims (claim_no,entry_type,dealer_name,material,stencil_no,mould_no,status,remark,receiving,received_at,created_at) VALUES\n'
        : 'INSERT INTO claims (claim_no,entry_type,dealer_name,material,stencil_no,mould_no,status,remark,receiving,received_at,created_at) VALUES\n';
      const insertTail = FULL ? ';' : '\nON DUPLICATE KEY UPDATE status=VALUES(status), remark=VALUES(remark), receiving=VALUES(receiving), received_at=VALUES(received_at);';
      lines.push(insertHead + vals.join(',\n') + insertTail);
    }
    for (let i = 0; i < statusLogs.length; i += 500) {
      const branches = statusLogs.slice(i, i + 500).map(l =>
        `SELECT ${sqlv(l.claim_no)} claim_no, '' from_status, ${sqlvS(l.to_status)} to_status, ${sqlvS(l.note)} note, ${sqlv(l.changed_at) === 'NULL' ? 'CURRENT_TIMESTAMP' : sqlv(l.changed_at)} changed_at`);
      const watermarkFilter = FULL ? '' : '\nAND t.changed_at > (SELECT MAX(w.changed_at) FROM claim_status_log w)';
      lines.push(
        'INSERT INTO claim_status_log (claim_id, from_status, to_status, note, changed_at)\n' +
        'SELECT c.id, t.from_status, t.to_status, t.note, t.changed_at FROM (\n' +
        branches.join('\nUNION ALL\n') + '\n' +
        ') t JOIN claims c ON c.claim_no = t.claim_no' + watermarkFilter + ';'
      );
    }
    if (ackOut.length) {
      lines.push('DELETE FROM claim_ack;');
      for (let i = 0; i < ackOut.length; i += 200) {
        const vals = ackOut.slice(i, i + 200).map(a =>
          `(${sqlvS(a.claim_no)}, ${sqlvS(a.dealer_name)}, ${sqlvS(a.item_desc)}, ${sqlvS(a.stencil_no)}, ${sqlv(a.claim_date)}, ${sqlvS(a.status)})`);
        lines.push('INSERT INTO claim_ack (claim_no,dealer_name,item_desc,stencil_no,claim_date,status) VALUES\n' + vals.join(',\n') + ';');
      }
    }
    if (dealerSet.size) {
      lines.push('INSERT IGNORE INTO claim_dealers (name) VALUES\n' + [...dealerSet].map(d => `(${sqlvS(d)})`).join(',\n') + ';');
    }
    fs.writeFileSync(SEED_FILE, lines.join('\n\n') + '\n');
    console.log(`  📝 ${SEED_FILE} likhi`);
  }

  await db.end();
})().catch(e => { console.error('import failed:', e); process.exit(1); });
