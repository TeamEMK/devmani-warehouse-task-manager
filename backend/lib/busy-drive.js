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

const KEYS = { url: 'busyDrive.scriptUrl', secret: 'busyDrive.secret', enabled: 'busyDrive.enabled', state: 'busyDrive.state' };
const SYNC_EVERY_MIN = 30;
// File ke naam se kind — auto-detect par bharosa kam rahe
const kindFromName = name => (/stock/i.test(name) ? 'STOCK' : /receiv|outstand|debtor|balance/i.test(name) ? 'OUT' : '');

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
  let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Script ne JSON nahi diya — Apps Script me authorize() chalao aur "Anyone" access ke saath deploy karo'); }
  if (data.service && attempt < 1) return callScript(url, secret, body, attempt + 1); // doGet default jawab = request kho gayi
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

function makeBusyDrive({ db, nowIST, afterImport }) {
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
    return { url: s.url, secret: s.secret, enabled: s.enabled, everyMin: SYNC_EVERY_MIN, lastRun: s.state.lastRun, lastBy: s.state.lastBy, lastError: s.state.lastError, lastSummary: s.state.lastSummary, files };
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
        else {
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
  async function importBackup(s, f, silent) {
    const stamp = backupStamp(f.backup) || { dmy: nowIST().dmy, label: nowIST().dmyhm };
    const label = `Drive backup ${stamp.label} (${String(f.name).split('/')[1] || 'COMP'})`;
    let result = '', notes = '';
    try {
      const zip = await downloadRaw(s.url, s.secret, f.id, f.size);
      const bd = busyDb.readBusyBackup(zip);
      const [appItems] = await db.query('SELECT busy_name FROM ops_items WHERE busy_name<>\'\'');
      const keep = new Set(appItems.map(r => busyDb.nb(r.busy_name)));
      const r1 = await busy.importStock(db, busyDb.stockRows(bd, stamp.dmy, keep), stamp.dmy);
      const r2 = await busy.importOutstanding(db, busyDb.outstandingRows(bd, stamp.dmy), stamp.dmy);
      if (silent && r2.payments) await muteNewPayments();
      result = `STOCK: ${r1.updated} items updated | OUTSTANDING: ${r2.count} accounts, as on ${stamp.dmy}` + (r2.payments ? `, ${r2.payments} payment(s) detected${silent ? ' (WhatsApp nahi bheja)' : ''}` : '') + ` (FY ${bd.fy}, ${bd.itemGroup} items ${bd.items.length}, last voucher ${bd.lastVoucherDate})`;
      notes = [r1.unmatched.length ? 'Busy tyre items jo app me nahi: ' + r1.unmatched.join(' | ') : '', r2.unmatched.join(' | ')].filter(Boolean).join(' || ');
    } catch (e) { result = 'ERROR: ' + String(e.message || e).slice(0, 250); }
    await db.query('INSERT INTO ops_import_log (file_name,result,notes) VALUES (?,?,?)', [label.slice(0, 200), result, notes.slice(0, 60000)]);
    return { result, notes };
  }
  // Scheduler ke liye: enabled ho tabhi
  async function syncIfEnabled(by) {
    const s = await settings();
    if (!s.enabled || !s.url || !s.secret) return { ok: true, skipped: true };
    return sync({ by });
  }
  return { settings, saveSettings, publicView, test, sync, syncIfEnabled, SYNC_EVERY_MIN, kindFromName };
}

module.exports = { makeBusyDrive, callScript, kindFromName, KEYS, SYNC_EVERY_MIN };
