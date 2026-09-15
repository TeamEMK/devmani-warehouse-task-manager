// ══════════════════════════════════════════════════════
// SCHEME CATALOG — Michelin/VK scheme .xlsx (Busy Drive folder se) -> date + category wise archive
// ══════════════════════════════════════════════════════
// File me ek "Category" column hota hai (scheme ka apna naam/type, jaise "Volume Discount",
// "Cashback", "Slab"). Baaki columns jo bhi hon (item, validity, discount...) — sab as-is
// JSON me save ho jaate hain, taaki file ka format kabhi badle to bhi kuch tootey nahi.
// Har import ek "as on" date ka poora snapshot deta hai (file me "As On : DD-MM-YYYY" na mile
// to import ki date); purani dates history me rehti hain (usi date ka dobara import ho to
// sirf wahi din replace hota hai).

const { readXlsx } = require('./xlsx');

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r]; if (!row) continue;
    if (row.some(v => /^category$/i.test(String(v == null ? '' : v).trim()))) return r;
  }
  return -1;
}
// "As On : 15-09-2026" jaisi line kahin bhi pehli 15 rows me -> 'YYYY-MM-DD'
function findAsOn(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r]; if (!row) continue;
    const joined = row.filter(v => v !== '' && v != null).join(' ');
    const m = /as\s*on\D{0,5}(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/i.exec(joined);
    if (!m) continue;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  return null;
}

// buf -> { asOn: 'YYYY-MM-DD'|null, rows: [{ category, label, data:{col:val,...} }], noHeader: bool }
function parseSchemeXlsx(buf) {
  const sheets = readXlsx(buf);
  const sh = sheets.find(s => s.rows.length > 1) || sheets[0];
  const rows = (sh && sh.rows) || [];
  const asOn = findAsOn(rows);
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return { asOn, rows: [], noHeader: true };
  const headers = rows[headerIdx].map(h => String(h == null ? '' : h).trim());
  const catIdx = headers.findIndex(h => /^category$/i.test(h));
  const out = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row || !row.some(v => v !== '' && v != null)) continue;
    const data = {};
    headers.forEach((h, i) => { if (h) data[h] = row[i] === undefined ? '' : row[i]; });
    const category = String((catIdx >= 0 ? row[catIdx] : '') || '').trim() || 'General';
    const label = headers.filter((h, i) => i !== catIdx && h).slice(0, 3).map(h => data[h]).filter(v => v !== '' && v != null).join(' · ');
    out.push({ category, label, data });
  }
  return { asOn, rows: out };
}

// parseSchemeXlsx() ka result -> ops_scheme_catalog me (us as_on date ka poora replace)
async function importSchemeCatalog(db, parsed, asOnFallbackIso) {
  const asOn = parsed.asOn || asOnFallbackIso;
  await db.query('DELETE FROM ops_scheme_catalog WHERE as_on=?', [asOn]);
  const CH = 500;
  for (let i = 0; i < parsed.rows.length; i += CH) {
    const part = parsed.rows.slice(i, i + CH);
    await db.query('INSERT INTO ops_scheme_catalog (as_on, category, row_label, data) VALUES ?',
      [part.map(r => [asOn, r.category.slice(0, 120), r.label.slice(0, 300), JSON.stringify(r.data)])]);
  }
  return { asOn, count: parsed.rows.length, categories: [...new Set(parsed.rows.map(r => r.category))] };
}

module.exports = { findHeaderRow, findAsOn, parseSchemeXlsx, importSchemeCatalog };
