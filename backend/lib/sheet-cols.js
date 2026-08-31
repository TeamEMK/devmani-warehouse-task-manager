// ══════════════════════════════════════════════════════
// FMS SHEET COLUMNS
// ══════════════════════════════════════════════════════
// FMS ka har step ek Google Sheet ke column se juda hota hai. Dikkat ye hai ki
// sheet client ki hoti hai — wo beech me column jod ya hata deta hai, aur tab
// "column D" wali saari settings ek jagah khisak jaati hain.
//
// Isi liye letter ke saath header ka NAAM bhi save karte hain, aur har baar
// naam se dhoondh kar letter ko theek kar lete hain (heal). Duplicate naam
// (har stage me "Planned"/"Actual") ke liye purane letter ke sabse nazdeek
// wala match chunte hain.
//
// Ye poora hisaab sirf arrays aur strings par chalta hai — ek do jagah
// (headers laana, cell ka format badalna) chhodkar Sheets API ki bhi zaroorat
// nahi. Isliye heal ka logic bina kisi sheet ke test ho jaata hai.

const { getSheetsClient } = require('./google');
function colToIdx(col) {
  if (!col) return -1;
  col = col.toUpperCase().trim();
  let idx = 0;
  for (let i = 0; i < col.length; i++) idx = idx * 26 + (col.charCodeAt(i) - 64);
  return idx - 1;
}

function idxToCol(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { const r = (n-1) % 26; s = String.fromCharCode(65+r) + s; n = Math.floor((n-1)/26); }
  return s;
}

// Date string ko Date (midnight) me — DD/MM/YYYY, DD-MM-YYYY, ya YYYY-MM-DD. Warna null.
// FMS delay (Actual − Planned) count karne ke liye.
function _parseDMY(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

// DD/MM/YYYY date me din add/subtract karke wapas DD/MM/YYYY. Parse fail → null.
// Derived plan dates ke liye (jaise Transport planned = Material Ready planned − 1 din).
function _addDaysDMY(dmy, days) {
  const d = _parseDMY(dmy);
  if (!d) return null;
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
// Derived rule ka offset — agar condition ho (jaise Location=Delhi) to row ki value dekh
// kar daysMatch/daysElse; warna fixed offsetDays. getCell(colLetter) row ki cell value deta hai.
function _derivedOffset(d, getCell) {
  if (d && d.cond && d.cond.col) {
    const v = String(getCell(d.cond.col) || '').trim().toLowerCase();
    const match = v === String(d.cond.value || '').trim().toLowerCase();
    return match ? (parseInt(d.cond.daysMatch, 10) || 0) : (parseInt(d.cond.daysElse, 10) || 0);
  }
  return parseInt(d.offsetDays, 10) || 0;
}

// ── Column NAAM se resolve (sheet me column add/delete ho jaye tab bhi) ──

// Ek FMS sheet ki header row (naam) laao.
async function _fetchSheetHeaders(sheet) {
  try {
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tab = sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;
    const hRow = sheet.header_row || 1;
    const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${hRow}:${hRow}` });
    return (resp.data.values || [[]])[0] || [];
  } catch (e) { return []; }
}
// Naam ka column dhoondo, par DUPLICATE naam ho (jaise har stage me "Planned"/"Actual")
// to stored letter (near) ke SABSE NAZDEEK wala match chuno. -1 agar na mile.
function _findColByNameNear(headers, name, near) {
  if (!name) return -1;
  const t = String(name).trim().toLowerCase();
  const matches = [];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] == null ? '' : headers[i]).trim().toLowerCase() === t) matches.push(i);
  }
  if (!matches.length) return -1;
  if (near == null || near < 0) return matches[0];
  let best = matches[0], bestDist = Math.abs(best - near);
  for (const m of matches) { const d = Math.abs(m - near); if (d < bestDist) { best = m; bestDist = d; } }
  return best;
}
// Step ke plan/actual/show/delay-reason/doer columns ko STORE kiye naam se current
// position par heal karo. Duplicate headers (har stage "Planned"/"Actual") disambiguate
// karne ke liye stored letter ke nazdeek wala match chunte hain.
function _healStepCols(step, headers) {
  if (!step || !headers || !headers.length) return;
  const set = (nameKey, letterKey) => {
    if (!step[nameKey]) return;
    const near = colToIdx(step[letterKey] || '');
    const i = _findColByNameNear(headers, step[nameKey], near);
    if (i >= 0) step[letterKey] = idxToCol(i);
  };
  set('plan_col_name', 'plan_col');
  set('actual_col_name', 'actual_col');
  set('delay_reason_col_name', 'delay_reason_col');
  set('doer_name_col_name', 'doer_name_col');
  if (step.show_col_names) {
    let names = []; try { names = JSON.parse(step.show_col_names); } catch (e) {}
    let orig = []; try { orig = JSON.parse(step.show_cols || '[]'); } catch (e) {}
    if (Array.isArray(names) && names.length) {
      const idxs = names.map((n, k) => _findColByNameNear(headers, n, Array.isArray(orig) ? orig[k] : -1)).filter(x => x >= 0);
      step.show_cols = JSON.stringify(idxs);
    }
  }
}
// Save karte waqt step ke letters se header-NAAM capture karo (baad me heal ke liye).
function _capStepNames(s, headers) {
  const nameOf = (letter) => {
    const i = colToIdx(letter || '');
    return (i >= 0 && headers[i] != null && String(headers[i]).trim()) ? String(headers[i]).trim() : null;
  };
  const showNames = (Array.isArray(s.showCols) ? s.showCols : [])
    .map(i => (headers[i] != null && String(headers[i]).trim()) ? String(headers[i]).trim() : null)
    .filter(Boolean);
  return {
    planName: nameOf(s.planCol),
    actualName: nameOf(s.actualCol),
    showNames: showNames.length ? JSON.stringify(showNames) : null,
    delayReasonName: nameOf(s.delayReasonCol),
    doerNameName: nameOf(s.doerNameCol),
  };
}

// ── Intake config: column letters ko NAAM se resilient banao (jaise steps) ──
// Save par har column ref ke saath uska header-NAAM store hota hai (_capIntakeNames),
// aur read par letters ko current headers ke against naam se re-resolve kar lete hain
// (_healIntakeConfig). Isse column add/delete pe intake config khud adjust ho jaata hai.
function _intakeNameAt(headers, letter) {
  const i = colToIdx(letter || '');
  return (i >= 0 && headers[i] != null && String(headers[i]).trim()) ? String(headers[i]).trim() : '';
}
function _capIntakeNames(config, headers) {
  if (!config || !Array.isArray(headers) || !headers.length) return config;
  if (Array.isArray(config.fields)) for (const f of config.fields) { if (f && f.col) f.colName = _intakeNameAt(headers, f.col); }
  if (config.nextStep && config.nextStep.planCol) config.nextStep.planColName = _intakeNameAt(headers, config.nextStep.planCol);
  if (Array.isArray(config.derivedSteps)) for (const d of config.derivedSteps) {
    if (d && d.planCol) d.planColName = _intakeNameAt(headers, d.planCol);
    if (d && d.cond && d.cond.col) d.cond.colName = _intakeNameAt(headers, d.cond.col);
  }
  return config;
}
function _healIntakeConfig(config, headers) {
  if (!config || !Array.isArray(headers) || !headers.length) return config;
  const heal = (letter, name) => {
    if (!name) return letter;                             // purana config (naam nahi) -> letter waisa hi
    const near = colToIdx(letter || '');
    const idx = _findColByNameNear(headers, name, near >= 0 ? near : 0);
    return idx >= 0 ? idxToCol(idx) : letter;             // na mile -> letter waisa hi
  };
  if (Array.isArray(config.fields)) for (const f of config.fields) { if (f && f.col) f.col = heal(f.col, f.colName); }
  if (config.nextStep && config.nextStep.planCol) config.nextStep.planCol = heal(config.nextStep.planCol, config.nextStep.planColName);
  if (Array.isArray(config.derivedSteps)) for (const d of config.derivedSteps) {
    if (d && d.planCol) d.planCol = heal(d.planCol, d.planColName);
    if (d && d.cond && d.cond.col) d.cond.col = heal(d.cond.col, d.cond.colName);
  }
  return config;
}

// Tab ka numeric gid (sheetId) — cell-format API ke liye. Cache.
const _sheetGidCache = new Map();
async function _getSheetGid(sheetsApi, spreadsheetId, tabName) {
  const key = `${spreadsheetId}|${tabName}`;
  if (_sheetGidCache.has(key)) return _sheetGidCache.get(key);
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  let gid = null;
  for (const s of (meta.data.sheets || [])) {
    if (String(s.properties.title) === String(tabName)) { gid = s.properties.sheetId; break; }
  }
  if (gid != null) _sheetGidCache.set(key, gid);
  return gid;
}
// Ek cell ka number-format PLAIN NUMBER karo — Delay column agar date-format me ho to
// number (jaise 1) "12/1899" jaisa dikhta hai; ye us bug se bachata hai.
async function _forceCellNumber(sheetsApi, spreadsheetId, tabName, colIdx, rowNumber) {
  const gid = await _getSheetGid(sheetsApi, spreadsheetId, tabName);
  if (gid == null) return;
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ repeatCell: {
      range: { sheetId: gid, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } },
      fields: 'userEnteredFormat.numberFormat'
    } }] }
  });
}

module.exports = {
  colToIdx, idxToCol,
  parseDMY: _parseDMY, addDaysDMY: _addDaysDMY, derivedOffset: _derivedOffset,
  findColByNameNear: _findColByNameNear, fetchSheetHeaders: _fetchSheetHeaders,
  healStepCols: _healStepCols, capStepNames: _capStepNames,
  intakeNameAt: _intakeNameAt, capIntakeNames: _capIntakeNames,
  healIntakeConfig: _healIntakeConfig,
  getSheetGid: _getSheetGid, forceCellNumber: _forceCellNumber,
};
