// ══════════════════════════════════════════════════════
// XLSX READER  (chhota, bina kisi npm package ke)
// ══════════════════════════════════════════════════════
// Busy accounting se export hui StockStatus.xlsx / Amount Receivable .xlsx
// padhne ke liye, aur Google Sheet ke xlsx export ke liye. Sirf padhna hai,
// likhna nahi — isliye poora library lagane ki zarurat nahi: .xlsx ek ZIP
// hai jisme XML files hain; zlib se inflate karke regex se cells nikaal lete
// hain.
//
//   const { readXlsx } = require('./xlsx');
//   const sheets = readXlsx(buffer);   // [{ name, rows: [[cell, cell, ...], ...] }]
//
// Cell values: string ya number (formula ka cached result). Excel me dates
// number hote hain (serial) — excelSerialToDate() se Date banao jab pata ho
// ki wo column date hai.

const zlib = require('zlib');

// ── ZIP ──────────────────────────────────────────────
// Central directory se har file ka offset/size, phir local header ke baad ka
// data inflate. Sirf store (0) aur deflate (8) — xlsx me yahi do aate hain.
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP nahi lag raha (EOCD nahi mila)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP central directory toota hua hai');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ── XML helpers ──────────────────────────────────────
function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}
function textOf(xml) {
  // <t> ke andar ka text — rich text me kai <r><t>..</t></r> hote hain, sab jodo
  return decodeXml([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
}
function colIndex(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// ── Workbook ─────────────────────────────────────────
function readXlsx(buf) {
  const files = unzip(buf);
  const wb = files['xl/workbook.xml'];
  if (!wb) throw new Error('xl/workbook.xml nahi mila — ye xlsx nahi hai');
  const rels = (files['xl/_rels/workbook.xml.rels'] || Buffer.alloc(0)).toString('utf8');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (m[0].match(/\bId="([^"]+)"/) || [])[1];
    const target = (m[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) relMap[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
  }
  const shared = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const sheets = [];
  for (const m of wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
    const rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    const path = relMap[rid];
    const xml = path && files[path] ? files[path].toString('utf8') : '';
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      let v = '';
      if (t === 's') v = shared[+((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] ?? '';
      else if (t === 'inlineStr') v = textOf(inner);
      else if (t === 'str') v = decodeXml((inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '');
      else {
        const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (raw === undefined) v = '';
        else if (t === 'b') v = raw === '1';
        else v = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw) ? Number(raw) : decodeXml(raw);
      }
      cells[colIndex(ref)] = v;
    }
    // Khali cells undefined rehti hain — '' bana do taaki callers ko fark na pade
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// Excel serial (din, 1900 se) -> JS Date. Fraction = din ka hissa (time).
// Sheet ke export me date cells number ban kar aate hain (46031.52 = 01/09/2026 12:38).
function excelSerialToDate(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms); // UTC me wahi wall-clock jo sheet me tha
}

// ── WRITER (chhota): rows -> .xlsx buffer ─────────────
// Cell: string -> text, number -> number, Date -> Excel date (yyyy-mm-dd format), null/'' -> khali.
// Tally Bridge ka InvoiceTally template isi se banta hai (Michelin portal par seedha upload).
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const parts = [], cd = []; let off = 0, n = 0;
  for (const [name, data] of Object.entries(files)) {
    const d = Buffer.from(data), nm = Buffer.from(name), comp = zlib.deflateRawSync(d), crc = crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    cd.push(ch, nm); off += lh.length + nm.length + comp.length; n++;
  }
  const cdb = Buffer.concat(cd), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, e]);
}
function colRef(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dateToSerial(d) { return Math.round((d.getTime() / 86400000 + 25569) * 1e6) / 1e6; }
function writeXlsx(rows, sheetName) {
  let x = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((r, ri) => {
    x += `<row r="${ri + 1}">`;
    (r || []).forEach((c, ci) => {
      if (c === null || c === undefined || c === '') return;
      const ref = colRef(ci) + (ri + 1);
      if (c instanceof Date) x += `<c r="${ref}" s="1"><v>${dateToSerial(c)}</v></c>`;
      else if (typeof c === 'number' && isFinite(c)) x += `<c r="${ref}"><v>${c}</v></c>`;
      else x += `<c r="${ref}" t="inlineStr"><is><t>${escXml(c)}</t></is></c>`;
    });
    x += '</row>';
  });
  x += '</sheetData></worksheet>';
  const name = escXml(sheetName || 'Sheet1');
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" xfId="0"/><xf numFmtId="164" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + x,
  });
}

module.exports = { readXlsx, excelSerialToDate, unzip, writeXlsx };
