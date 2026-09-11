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
// Chalta hai: har 30 min (in-process), /api/ops/cron par, aur UI ke "Abhi sync karo" se.

const busy = require('./ops-busy');

const KEYS = { url: 'busyDrive.scriptUrl', secret: 'busyDrive.secret', enabled: 'busyDrive.enabled', state: 'busyDrive.state' };
const SYNC_EVERY_MIN = 30;
// File ke naam se kind — auto-detect par bharosa kam rahe
const kindFromName = name => (/stock/i.test(name) ? 'STOCK' : /receiv|outstand|debtor|balance/i.test(name) ? 'OUT' : '');

async function callScript(url, secret, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90 * 1000);
  let resp, text;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ secret }, body)), redirect: 'follow', signal: ctl.signal });
    text = await resp.text();
  } catch (e) { throw new Error('Script tak pahunch nahi paye: ' + (e.name === 'AbortError' ? 'timeout' : e.message)); }
  finally { clearTimeout(t); }
  let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Script ne JSON nahi diya — Apps Script me authorize() chalao aur "Anyone" access ke saath deploy karo'); }
  if (!data.ok) throw new Error(data.error || 'script error');
  return data;
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
  async function sync({ force, by } = {}) {
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
        const g = await callScript(s.url, s.secret, { action: 'get', id: f.id });
        const r = await busy.importBusyBuffer(db, Buffer.from(g.b64, 'base64'), 'Drive: ' + (g.name || f.name), nowIST().dmy, kindFromName(f.name));
        state.files[f.id] = { name: f.name, modified: f.modified, importedAt: nowIST().dmyhm, result: String(r.result).slice(0, 160) };
        imported.push({ name: f.name, result: r.result, notes: r.notes });
      }
      // Jo files folder se hat gayin unka state bhi hatao
      const live = new Set(files.map(f => f.id));
      Object.keys(state.files).forEach(id => { if (!live.has(id)) delete state.files[id]; });
      state.lastRun = nowIST().dmyhm; state.lastBy = by || 'auto'; state.lastError = '';
      state.lastSummary = files.length ? `${imported.length} file import, ${skipped} unchanged (folder me ${files.length})` : 'Folder me koi spreadsheet file nahi';
      await saveState(state);
      if (imported.length && afterImport) { try { await afterImport(); } catch (_) {} }
      return { ok: true, imported, skipped, total: files.length, lastRun: state.lastRun };
    } catch (e) {
      state.lastRun = nowIST().dmyhm; state.lastBy = by || 'auto'; state.lastError = String(e.message || e).slice(0, 300);
      await saveState(state).catch(() => {});
      return { ok: false, error: state.lastError };
    } finally { running = false; }
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
