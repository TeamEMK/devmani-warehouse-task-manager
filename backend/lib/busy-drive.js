// ══════════════════════════════════════════════════════
// BUSY DRIVE — Google Drive folder se Busy export apne aap import
// ══════════════════════════════════════════════════════
// Busy PC se exports (Stock Status / Amount Receivable) Devmaniwarehouses@gmail.com
// ke Drive folder me aate hain, din me ~3 baar overwrite hote hain. Us account me
// ek chhota Apps Script web app hai (docs/apps-script-busy-drive) jo folder ki
// file list + file bytes deta hai. Ye module:
//   - settings (script URL, secret, on/off) app_settings me rakhta hai
//   - sync(): list -> jo file pichli baar ke baad badli, use utha kar
//     ops-busy.importBusyBuffer se import (wahi log, wahi payment detection)
//   - har file ka { modified, result } state me — same file dobara import nahi hoti
// Do tarah ki file: (a) seedhi xlsx export, (b) Busy ka auto-backup "<date time>/COMPBOD/DATA.ZIP"
// (kind 'backup') — use tukdon me download karke busy-db se seedha stock + outstanding nikalte hain.
// Chalta hai: har 30 min (in-process), /api/ops/cron par, aur UI ke "Abhi sync karo" se.

const busy = require('./ops-busy');
const busyDb = require('./busy-db');
const tally = require('./tally-bridge');
const schemeCatalog = require('./scheme-catalog');

const KEYS = { url: 'busyDrive.scriptUrl', secret: 'busyDrive.secret', enabled: 'busyDrive.enabled', state: 'busyDrive.state' };
const SYNC_EVERY_MIN = 30;
// File ke naam se kind — auto-detect par bharosa kam rahe
// SUPPLY = Busy ki "List of Supply Outward Vouchers" (Tally Bridge ke liye), SCHEME = Michelin/VK
// scheme catalog (Scheme Report ke liye) — dono isi folder me daal do to daily upload nahi karna padega
const kindFromName = name => (/stock/i.test(name) ? 'STOCK' : /receiv|outstand|debtor|balance/i.test(name) ? 'OUT' : /supply|outward/i.test(name) ? 'SUPPLY' : /scheme/i.test(name) ? 'SCHEME' : '');

// GET + query params (POST par Google 302 redirect me body kho kar doGet chal jaata tha — kabhi-kabhi).
// Jawab me `service` aaye (doGet ka default) ya ok na ho to ek baar aur try.
async function callScript(url, secret, body, attempt = 0) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 120 * 1000);
  let text;
  try {
    const qs = new URLSearchParams(Object.assign({ secret }, body)).toString();
    const resp = await fetch(url + (url.includes('?') ? '&' : '?') + qs, { method: 'GET', redirect: 'follow', signal: ctl.signal });
    text = await resp.text();
  } catch (e) {
    if (attempt < 1) return callScript(url, secret, body, attempt + 1);
    throw new Error('Script tak pahunch nahi paye: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
  } finally { clearTimeout(t); }
  let data; try { data = JSON.parse(text); } catch (_) {
    // Google kabhi-kabhi HTML error page deta hai (busy / transient) — 3 baar tak dobara
    if (attempt < 3) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); return callScript(url, secret, body, attempt + 1); }
    const hint = /<title>([^<]{0,80})/i.exec(text); throw new Error('Script ne JSON nahi diya' + (hint ? ' (' + hint[1].trim() + ')' : '') + ' — 3 retry ke baad bhi; agli baar phir try hoga');
  }
  if (data.service && attempt < 3) return callScript(url, secret, body, attempt + 1); // doGet default jawab = request kho gayi
  if (!data.ok) throw new Error(data.error || 'script error');
  return data;
}

// Bada file tukdon me (Apps Script ek response me ~50MB se zyada nahi de sakta)
async function downloadRaw(url, secret, id, expectedSize) {
  const parts = []; let off = 0, size = expectedSize || 0;
  do {
    const r = await callScript(url, secret, { action: 'raw', id, offset: off, length: 12 * 1024 * 1024 });
    const buf = Buffer.from(r.b64 || '', 'base64');
    if (!buf.length) throw new Error(`Download me khali tukda aaya (offset ${off}, size ${r.size})`);
    parts.push(buf); size = r.size; off += buf.length;
  } while (off < size);
  return Buffer.concat(parts);
}
// "2026-09-11 (02 00 PM)" -> { dmy: '11-09-2026', label: '11-09-2026 02:00 PM' }
function backupStamp(folderName) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) \((\d{1,2}) (\d{2}) (AM|PM)\)/i.exec(String(folderName || ''));
  if (!m) return null;
  return { dmy: `${m[3]}-${m[2]}-${m[1]}`, label: `${m[3]}-${m[2]}-${m[1]} ${m[4].padStart(2, '0')}:${m[5]} ${m[6].toUpperCase()}` };
}

function makeBusyDrive({ db, nowIST, afterImport, tallySettings, buildTallyKinds, tallyOutputsOf }) {
  async function getSetting(k) { const [[r]] = await db.query('SELECT value FROM app_settings WHERE key_name=?', [k]); return r ? r.value : null; }
  async function setSetting(k, v) { await db.query('INSERT INTO app_settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)', [k, v]); }
  function emptyState() { return { files: {}, lastRun: '', lastBy: '', lastError: '', lastSummary: '' }; }
  async function settings() {
    let state = emptyState();
    const raw = await getSetting(KEYS.state);
    if (raw) { try { state = Object.assign(emptyState(), JSON.parse(raw)); } catch (_) {} }
    return { url: (await getSetting(KEYS.url)) || '', secret: (await getSetting(KEYS.secret)) || '', enabled: (await getSetting(KEYS.enabled)) === '1', state };
  }
  async function saveSettings(d) {
    if (d.url !== undefined) await setSetting(KEYS.url, String(d.url || '').trim());
    if (d.secret !== undefined) await setSetting(KEYS.secret, String(d.secret || '').trim());
    if (d.enabled !== undefined) await setSetting(KEYS.enabled, d.enabled ? '1' : '0');
    return settings();
  }
  async function saveState(state) { await setSetting(KEYS.state, JSON.stringify(state)); }
  // UI ke liye: settings + files ki list (state se), nayi pehle
  function publicView(s) {
    const files = Object.keys(s.state.files).map(id => Object.assign({ id }, s.state.files[id])).sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return { url: s.url, secret: s.secret, enabled: s.enabled, everyMin: SYNC_EVERY_MIN, running, lastRun: s.state.lastRun, lastBy: s.state.lastBy, lastError: s.state.lastError, lastSummary: s.state.lastSummary, files };
  }
  async function test() {
    const s = await settings();
    if (!s.url || !s.secret) throw new Error('Script URL aur secret pehle save karo');
    const p = await callScript(s.url, s.secret, { action: 'ping' });
    const l = await callScript(s.url, s.secret, { action: 'list' });
    return { folder: p.folder, folderUrl: p.url, count: p.count, files: (l.files || []).slice(0, 20) };
  }

  let running = false;
  // by = 'auto' | 'cron' | admin ka naam. force = sab files dobara import
  // silent = is sync me payment detect ho to WhatsApp mat bhejo (pehli baar / lambe gap ke baad)
  async function sync({ force, by, silent } = {}) {
    if (running) return { ok: false, error: 'Sync pehle se chal raha hai — thodi der me dekho' };
    running = true;
    const s = await settings(); const state = s.state;
    try {
      if (!s.url || !s.secret) return { ok: false, error: 'Drive script URL / secret set nahi (Busy Import → Drive settings)' };
      const list = await callScript(s.url, s.secret, { action: 'list' });
      const files = (list.files || []).slice().sort((a, b) => (a.modified < b.modified ? -1 : 1)); // purani pehle, taaki latest snapshot aakhir me jeete
      const imported = []; let skipped = 0;
      for (const f of files) {
        const prev = state.files[f.id];
        if (!force && prev && prev.modified === f.modified) { skipped++; continue; }
        let r;
        if (f.kind === 'backup') r = await importBackup(s, f, silent);
        else if (kindFromName(f.name) === 'SUPPLY') {
          const g = await callScript(s.url, s.secret, { action: 'get', id: f.id });
          r = await processSupplyFile(Buffer.from(g.b64, 'base64'), g.name || f.name);
        } else if (kindFromName(f.name) === 'SCHEME') {
          const g = await callScript(s.url, s.secret, { action: 'get', id: f.id });
          r = await processSchemeFile(Buffer.from(g.b64, 'base64'), g.name || f.name);
        } else {
          const g = await callScript(s.url, s.secret, { action: 'get', id: f.id });
          r = await busy.importBusyBuffer(db, Buffer.from(g.b64, 'base64'), 'Drive: ' + (g.name || f.name), nowIST().dmy, kindFromName(f.name));
          if (silent) await muteNewPayments();
        }
        // ERROR (download/parse fail) ho to state me mat likho — agli baar dobara try hoga
        if (!/^ERROR/.test(String(r.result))) state.files[f.id] = { name: f.name, modified: f.modified, importedAt: nowIST().dmyhm, result: String(r.result).slice(0, 200) };
        imported.push({ name: f.name, result: r.result, notes: r.notes });
      }
      // Jo files folder se hat gayin unka state bhi hatao
      const live = new Set(files.map(f => f.id));
      Object.keys(state.files).forEach(id => { if (!live.has(id)) delete state.files[id]; });
      state.lastRun = nowIST().dmyhm; state.lastBy = by || 'auto'; state.lastError = '';
      state.lastSummary = files.length ? `${imported.length} file import, ${skipped} unchanged (folder me ${files.length})` : 'Folder me koi spreadsheet file nahi';
      await saveState(state);
      if (imported.length && afterImport && !silent) { try { await afterImport(); } catch (_) {} }
      return { ok: true, imported, skipped, total: files.length, lastRun: state.lastRun };
    } catch (e) {
      state.lastRun = nowIST().dmyhm; state.lastBy = by || 'auto'; state.lastError = String(e.message || e).slice(0, 300);
      await saveState(state).catch(() => {});
      return { ok: false, error: state.lastError };
    } finally { running = false; }
  }
  // Busy backup (DATA.ZIP): download -> db1YYYY.bds -> stock + outstanding -> wahi importStock/importOutstanding
  // Abhi-abhi detect hui payments ko 'notified' maan lo — WhatsApp nahi jayega
  async function muteNewPayments() { await db.query(`UPDATE ops_payment_log SET notified='Y' WHERE notified='N'`); }
  // Busy "List of Supply Outward Vouchers" .xlsx (Drive me) -> Tally Bridge processing khud, jaisa admin manually
  // Tally Bridge page se karta tha. Result ops_tally_output me (aaj ki date, kind ke hisaab se
  // upsert) — Tally Bridge page se koi bhi din date select karke dekh/download kar sakta hai.
  async function processSupplyFile(buf, name) {
    let result = '', notes = '';
    try {
      if (!tallySettings || !buildTallyKinds || !tallyOutputsOf) throw new Error('Tally settings wire nahi hue');
      const s = await tallySettings(), kinds = buildTallyKinds(s);
      if (!kinds['2W'].code && !kinds['4W'].code) throw new Error('Distributor code set nahi — Tally Bridge Settings mein save karein');
      const r = tally.processListOfSupply(buf, kinds);
      const outputs = tallyOutputsOf(r);
      const asOn = nowIST().iso;
      for (const o of outputs) {
        await db.query(`INSERT INTO ops_tally_output (as_on, kind, label, file_name, code, matched_count, dropped_count, totals_json, preview_json, dropped_json, xlsx_base64)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE label=VALUES(label), file_name=VALUES(file_name), code=VALUES(code), matched_count=VALUES(matched_count),
            dropped_count=VALUES(dropped_count), totals_json=VALUES(totals_json), preview_json=VALUES(preview_json), dropped_json=VALUES(dropped_json), xlsx_base64=VALUES(xlsx_base64)`,
          [asOn, o.kind, o.label, name.slice(0, 200), o.code || '', o.matchedCount, r.droppedCount, JSON.stringify(o.totals), JSON.stringify(o.preview), JSON.stringify(r.dropped.slice(0, 200)), o.base64]);
      }
      const parts = outputs.filter(o => o.matchedCount).map(o => `${o.label} ${o.matchedCount}`);
      result = `TALLY: ${parts.join(', ') || 'kuch match nahi'} (${r.droppedCount} skipped), as on ${asOn}`;
      notes = r.dropped.length ? 'Skipped items: ' + r.dropped.map(d => d.item).slice(0, 50).join(' | ') : '';
    } catch (e) { result = 'ERROR: ' + String(e.message || e).slice(0, 250); }
    await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [('Drive: ' + name).slice(0, 200), result, notes.slice(0, 60000)]);
    return { result, notes };
  }
  // Michelin/VK scheme catalog .xlsx (Drive me) -> ops_scheme_catalog, date+category wise (Scheme Report page).
  async function processSchemeFile(buf, name) {
    let result = '', notes = '';
    try {
      const parsed = schemeCatalog.parseSchemeXlsx(buf);
      if (parsed.noHeader) throw new Error('File me "Category" column nahi mila');
      if (!parsed.rows.length) throw new Error('Koi row nahi mili');
      const r = await schemeCatalog.importSchemeCatalog(db, parsed, nowIST().iso);
      await schemeCatalog.saveSchemeFile(db, r.asOn, name, buf);
      result = `SCHEME: ${r.count} rows, ${r.categories.length} categories, as on ${r.asOn}`;
      notes = 'Categories: ' + r.categories.join(', ');
    } catch (e) { result = 'ERROR: ' + String(e.message || e).slice(0, 250); }
    await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [('Drive: ' + name).slice(0, 200), result, notes.slice(0, 60000)]);
    return { result, notes };
  }
  async function importBackup(s, f, silent) {
    const stamp = backupStamp(f.backup) || { dmy: nowIST().dmy, label: nowIST().dmyhm };
    const label = `Drive backup ${stamp.label} (${String(f.name).split('/')[1] || 'COMP'})`;
    let bd;
    try { const zip = await downloadRaw(s.url, s.secret, f.id, f.size); bd = busyDb.readBusyBackup(zip); }
    catch (e) { const result = 'ERROR: ' + String(e.message || e).slice(0, 250); await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [label.slice(0, 200), result, '']); return { result, notes: '' }; }
    return applyBackup(bd, stamp, silent, label);
  }
  // Padha hua Busy data -> app (stock, outstanding, ledger, snapshot, invoice) + import log. Test me seedha bhi call hota hai.
  async function applyBackup(bd, stamp, silent, label) {
    let result = '', notes = '';
    try {
      const [appItems] = await db.query('SELECT busy_name FROM ops_items WHERE busy_name<>\'\'');
      const keep = new Set(appItems.map(r => busyDb.nb(r.busy_name)));
      const r1 = await busy.importStock(db, busyDb.stockRows(bd, stamp.dmy, keep), stamp.dmy);
      const r2 = await busy.importOutstanding(db, busyDb.outstandingRows(bd, stamp.dmy), stamp.dmy);
      if (silent) await muteNewPayments(); // silent = is waqt jo bhi payment message pending hai, sab mute
      // v4: party ledger + analysis (statement, Michelin/VK split, due-from), IMS snapshot, Busy invoice no. -> orders
      const extra = [];
      try { await storeLedger(bd); extra.push(`ledger ${bd.ledger.length} lines`); } catch (e) { extra.push('ledger ERR ' + e.message.slice(0, 80)); }
      try { await snapshotStock(stamp.dmy.split('-').reverse().join('-')); } catch (e) { extra.push('snapshot ERR ' + e.message.slice(0, 80)); }
      try { const n = await autoInvoice(bd); if (n) extra.push(`${n} order(s) ko Busy invoice no. mila`); } catch (e) { extra.push('invoice ERR ' + e.message.slice(0, 80)); }
      result = `STOCK: ${r1.updated} items updated | OUTSTANDING: ${r2.count} accounts, as on ${stamp.dmy}` + (r2.payments ? `, ${r2.payments} payment(s) detected${silent ? ' (WhatsApp nahi bheja)' : ''}` : '') + ` (FY ${bd.fy}, ${bd.itemGroup} items ${bd.items.length}, last voucher ${bd.lastVoucherDate}${extra.length ? '; ' + extra.join(', ') : ''})`;
      notes = [r1.unmatched.length ? 'Busy tyre items jo app me nahi: ' + r1.unmatched.join(' | ') : '', r2.unmatched.join(' | ')].filter(Boolean).join(' || ');
    } catch (e) { result = 'ERROR: ' + String(e.message || e).slice(0, 250); }
    await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [label.slice(0, 200), result, notes.slice(0, 60000)]);
    return { result, notes };
  }
  // Busy ledger (Sundry Debtors) + party analysis — poora replace (ek hi FY)
  async function storeLedger(bd) {
    await db.query('DELETE FROM ops_busy_ledger');
    const CH = 500;
    for (let i = 0; i < bd.ledger.length; i += CH) {
      const part = bd.ledger.slice(i, i + CH);
      await db.query('INSERT INTO ops_busy_ledger (party_name, vch_date, vch_type, vch_no, series, narration, dr, cr, fy) VALUES ?',
        [part.map(l => [String(l.party || '').slice(0, 200), l.date.toISOString().slice(0, 10), l.vchType | 0, String(l.vchNo || '').slice(0, 60), String(l.series || '').slice(0, 60), String(l.narration || '').slice(0, 200), l.dr, l.cr, bd.fy | 0])]);
    }
    await db.query('DELETE FROM ops_busy_party');
    for (let i = 0; i < bd.analysis.length; i += CH) {
      const part = bd.analysis.slice(i, i + CH);
      await db.query('INSERT INTO ops_busy_party (party_name, opening, balance, michelin_amt, vk_amt, other_amt, due_from, last_sale, last_receipt, fy) VALUES ?',
        [part.map(a => [String(a.name || '').slice(0, 200), a.opening, a.balance, a.michelin, a.vk, a.other, a.dueFrom, a.lastSale, a.lastReceipt, bd.fy | 0])]);
    }
  }
  // IMS: aaj (backup ki date) ka stock snapshot har item ka
  async function snapshotStock(isoDay) {
    await db.query('INSERT INTO ops_stock_daily (item_code, day, stock) SELECT code, ?, stock FROM ops_items ON DUPLICATE KEY UPDATE stock=VALUES(stock)', [isoDay]);
  }
  // Busy sale voucher -> app order ka invoice no. (party same, bill date billed/order date ke -3..+10 din me, sabse paas wali)
  async function autoInvoice(bd) {
    const [orders] = await db.query(`SELECT o.oid, o.dealer_name, o.amount, DATE(COALESCE(o.billed_at, o.order_date)) AS d, dl.busy_name FROM ops_orders o LEFT JOIN ops_dealers dl ON dl.did=o.did WHERE o.status IN ('BILLED','DISPATCHED','DELIVERED') AND (o.invoice_no='' OR o.invoice_no IS NULL)`);
    if (!orders.length) return 0;
    const [usedRows] = await db.query(`SELECT invoice_no FROM ops_orders WHERE invoice_no<>''`);
    const used = new Set(usedRows.map(r => busyDb.nb(r.invoice_no)));
    const byParty = {};
    for (const sv of bd.sales) { if (!sv.no || used.has(busyDb.nb(sv.no))) continue; (byParty[busyDb.nb(sv.party)] = byParty[busyDb.nb(sv.party)] || []).push(sv); }
    let n = 0;
    for (const o of orders) {
      const keys = [busyDb.nb(o.busy_name), busyDb.nb(o.dealer_name), busyDb.nb(o.dealer_name).replace(/\s*\(.*\)$/, '')].filter(Boolean);
      let cands = []; for (const k of keys) if (byParty[k]) { cands = byParty[k]; break; }
      if (!cands.length || !o.d) continue;
      const od = new Date(o.d).getTime();
      let best = null, bestDiff = Infinity;
      for (const sv of cands) { const diff = (new Date(sv.date).getTime() - od) / 86400000; if (diff < -3 || diff > 10) continue; const score = Math.abs(diff) + (Math.abs(sv.amount - Number(o.amount)) / Math.max(1, Number(o.amount)) > 0.15 ? 5 : 0); if (score < bestDiff) { bestDiff = score; best = sv; } }
      if (!best) continue;
      await db.query(`UPDATE ops_orders SET invoice_no=?, invoice_auto=1 WHERE oid=? AND (invoice_no='' OR invoice_no IS NULL)`, [best.no.slice(0, 50), o.oid]);
      used.add(busyDb.nb(best.no)); cands.splice(cands.indexOf(best), 1); n++;
    }
    return n;
  }
  // Scheduler ke liye: enabled ho tabhi
  async function syncIfEnabled(by) {
    const s = await settings();
    if (!s.enabled || !s.url || !s.secret) return { ok: true, skipped: true };
    return sync({ by });
  }
  // Diagnostic (temporary): sabse naya backup utha kar raw Tran1/Tran2/Master1 column names + ek
  // sample Sale voucher dikhata hai — DB me kuch likhta nahi. "List of Supply Outward Vouchers" ko
  // seedha backup se nikalne ka rasta banane se pehle asli field names (rate/amount/GSTIN) verify karne ke liye.
  // Poora backup (~25MB) download + parse 1-3 min leta hai — hosting proxy 60s par request kaat deta hai
  // (jaise sync()), isliye background me chalta hai; UI probeStatus() se poll karta hai.
  let probeState = { running: false, result: null, error: '' };
  async function probeSchema() {
    const s = await settings();
    if (!s.url || !s.secret) throw new Error('Drive script URL / secret set nahi');
    const list = await callScript(s.url, s.secret, { action: 'list' });
    const backups = (list.files || []).filter(f => f.kind === 'backup').sort((a, b) => (a.modified < b.modified ? 1 : -1));
    if (!backups.length) throw new Error('Drive folder me koi backup (DATA.ZIP) nahi mila');
    const f = backups[0];
    const zip = await downloadRaw(s.url, s.secret, f.id, f.size);
    return Object.assign({ backupFile: f.name, backupModified: f.modified }, busyDb.inspectBackup(zip));
  }
  function startProbe() {
    if (probeState.running) return;
    probeState = { running: true, result: null, error: '' };
    probeSchema()
      .then(r => { probeState = { running: false, result: r, error: '' }; })
      .catch(e => { probeState = { running: false, result: null, error: String(e.message || e).slice(0, 500) }; });
  }
  const probeStatus = () => probeState;
  return { settings, saveSettings, publicView, test, sync, syncIfEnabled, snapshotStock, applyBackup, probeSchema, startProbe, probeStatus, isRunning: () => running, SYNC_EVERY_MIN, kindFromName };
}

module.exports = { makeBusyDrive, callScript, kindFromName, KEYS, SYNC_EVERY_MIN };
