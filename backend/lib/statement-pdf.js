// ══════════════════════════════════════════════════════
// ACCOUNT STATEMENT PDF — dealer ka ledger (Busy backup se) A4 PDF me
// ══════════════════════════════════════════════════════
// rows = ops_busy_ledger ki lines (date asc), opening = period se pehle ka balance (Dr+).
// Layout: header (company, party, period), table Date | Particulars | Debit | Credit | Balance, closing.

const { vchName } = require('./busy-db');

const fmt = n => { const v = Math.round(Number(n) || 0); return v.toLocaleString('en-IN'); };
const dmy = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

function buildStatementPdf({ company, address, party, mobile, from, to, opening, rows, asOn }) {
  return new Promise((resolve, reject) => {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);

    const W = doc.page.width - 72, X = 36;
    const col = { date: X, part: X + 62, dr: X + W - 210, cr: X + W - 140, bal: X + W - 70, w: 70 };
    let y;
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(15).text(company || 'BANSAL OIL DISTRIBUTORS', X, 36, { width: W, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(address || 'Near Petrol Depot, Double Phatak, Hisar-125001', X, 54, { width: W, align: 'center' });
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(12).text('Account Statement', X, 74, { width: W, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(10).text(party, X, 96);
      doc.font('Helvetica').fontSize(9).fillColor('#333').text((mobile ? 'Mobile: ' + mobile + '   ' : '') + 'Period: ' + dmy(from) + ' to ' + dmy(to) + (asOn ? '   (Busy data as on ' + asOn + ')' : ''), X, 110);
      doc.fillColor('#000');
      y = 130;
      doc.rect(X, y, W, 18).fill('#1f2a44');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
      doc.text('Date', col.date + 4, y + 5); doc.text('Particulars', col.part + 4, y + 5);
      doc.text('Debit', col.dr, y + 5, { width: col.w - 4, align: 'right' }); doc.text('Credit', col.cr, y + 5, { width: col.w - 4, align: 'right' }); doc.text('Balance', col.bal, y + 5, { width: col.w - 4, align: 'right' });
      doc.fillColor('#000').font('Helvetica');
      y += 20;
    };
    const balTxt = b => fmt(Math.abs(b)) + (b >= 0 ? ' Dr' : ' Cr');
    const line = (date, part, dr, cr, bal, bold) => {
      if (y > doc.page.height - 70) { doc.addPage(); header(); }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.text(date, col.date + 4, y, { width: 58 });
      doc.text(part, col.part + 4, y, { width: col.dr - col.part - 8, ellipsis: true, height: 12 });
      doc.text(dr ? fmt(dr) : '', col.dr, y, { width: col.w - 4, align: 'right' });
      doc.text(cr ? fmt(cr) : '', col.cr, y, { width: col.w - 4, align: 'right' });
      doc.text(balTxt(bal), col.bal, y, { width: col.w - 4, align: 'right' });
      y += 14;
      doc.moveTo(X, y - 2).lineTo(X + W, y - 2).lineWidth(0.3).strokeColor('#ddd').stroke();
    };
    header();
    let bal = Number(opening) || 0, tdr = 0, tcr = 0;
    line('', 'Opening balance', 0, 0, bal, true);
    for (const r of rows) {
      const dr = Number(r.dr) || 0, cr = Number(r.cr) || 0;
      bal += dr - cr; tdr += dr; tcr += cr;
      const part = vchName(r.vch_type) + (r.vch_no ? ' ' + r.vch_no : '') + (r.series ? ' (' + String(r.series).replace(/^\d+/, '') + ')' : '') + (r.narration ? ' — ' + r.narration : '');
      line(dmy(r.vch_date), part, dr, cr, bal, false);
    }
    line('', 'Total / Closing balance', tdr, tcr, bal, true);
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor('#555').text('Dr = aapki taraf bakaya, Cr = advance. Koi farak lage to office se sampark karein. Ye statement Busy accounting data se apne aap bana hai.', X, y, { width: W });
    doc.end();
  });
}

module.exports = { buildStatementPdf };
