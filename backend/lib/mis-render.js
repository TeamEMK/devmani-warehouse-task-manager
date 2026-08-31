// ══════════════════════════════════════════════════════
// MIS CARD RENDERING
// ══════════════════════════════════════════════════════
// Ek employee ka hafte-bhar ka checklist record ek performance card me chhapta
// hai — PNG (WhatsApp image) ya PDF (jab rows zyada hon). Card base64 data URI
// banta hai aur seedha WhatsApp par jaata hai: kahin file save nahi hoti,
// isliye employee ka data kisi public URL par nahi aata.
//
// Is file me database ka naam tak nahi hai — sirf "ye numbers diye, card bana
// do". Isi wajah se card ka layout bina DB ke test ho jaata hai: numbers haath
// se do aur PNG dekh lo.
//
// Score ka hisaab bhi yahin hai (calcMisScore) kyunki card usi ko chhapta hai,
// aur poore app me score ka sirf ek hi formula hona chahiye.

const fs = require('fs');
const path = require('path');
const BRAND = require('./brand');

// node_modules repo ki jad me hai — ye file backend/lib/ me hai, yaani do level neeche.
const ROOT = path.join(__dirname, '..', '..');
// Canvas lazy-load — agar Hostinger par native binary load na ho to
// sirf image band hoti hai, text reminder chalta rehta hai.
let _canvasLib;
function _getCanvas() {
  if (_canvasLib === undefined) {
    try {
      _canvasLib = require('@napi-rs/canvas');
      // Font bundle karo — warna server apne system fonts uthata hai
      // (Windows par 'Agency FB' aa jaata tha, Linux par shayad kuch bhi nahi).
      // Dono @fontsource packages dependency hain, isliye har jagah milenge.
      //
      // Devanagari alag font se aati hai: Inter me Hindi ke glyphs hain hi
      // nahi, aur unke bina har akshar khaali box (tofu) ban kar chhapta hai.
      // Font stack me dono naam hain, to canvas har akshar ke liye jo family
      // usse jaanti hai wahi use kar leta hai.
      const reg = (dir, file, family) => {
        const f = path.join(ROOT, 'node_modules', '@fontsource', dir, 'files', file);
        try { if (fs.existsSync(f)) { _canvasLib.GlobalFonts.registerFromPath(f, family); return 1; } } catch (_) {}
        return 0;
      };
      let latin = 0, deva = 0;
      for (const w of [400, 600, 700, 800]) {
        latin += reg('inter', `inter-latin-${w}-normal.woff2`, 'Inter');
      }
      for (const w of [400, 600, 700]) {
        deva += reg('noto-sans-devanagari', `noto-sans-devanagari-devanagari-${w}-normal.woff2`, 'Noto Sans Devanagari');
      }
      console.log(`  🖼️  MIS image fonts: Inter ${latin}, Devanagari ${deva}`);
      if (!deva) console.warn('  ⚠️  Devanagari font nahi mila — MIS image me Hindi boxes bankar aayegi');
    } catch (e) {
      console.error('  ⚠️  @napi-rs/canvas load failed — MIS images disabled:', e.message);
      _canvasLib = null;
    }
  }
  return _canvasLib;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// MIS / performance score — SAARI jagah yehi (drift na ho). 0% = perfect.
// Penalty per total: pending −100, delayed(overdue) −50, not-on-time −25, revised −25.
// Floor −100%. total=0 → 0.
// NEGATIVE scale: 0% = perfect, galtiyon se neeche −100% tak.
// Penalties per total: pending −100, delayed −50, not-on-time −25, revised −25. Floor −100%.
function calcMisScore({ total = 0, pending = 0, overdue = 0, notOnTime = 0, revised = 0 }) {
  total = Number(total) || 0;
  if (!total) return 0;
  const raw = 0
    - (Number(pending) || 0) / total * 100
    - (Number(overdue) || 0) / total * 50
    - (Number(notOnTime) || 0) / total * 25
    - (Number(revised) || 0) / total * 25;
  return Math.max(-100, Math.round(raw * 10) / 10);
}

// Sirf not-on-time (late complete) tasks ka score par asar (penalty). Negative ya 0.
function notOnTimeScoreOf(total, notOnTime) {
  total = Number(total) || 0;
  if (!total) return 0;
  return -Math.round((Number(notOnTime) || 0) / total * 25 * 10) / 10;
}

// Company logo (frontend/<brand.logo>) — ek baar ASYNC decode karke cache (sync `img.src`
// se sirf dimensions milte, pixels nahi → blank aata). MIS image header me draw hota hai.
// Fail ho to null (tab text fallback dikhta hai).
let _misLogo; // undefined = try nahi kiya, null = fail, Image = loaded
async function _ensureMisLogo() {
  if (_misLogo !== undefined) return _misLogo;
  try {
    const lib = _getCanvas();
    _misLogo = await lib.loadImage(fs.readFileSync(path.join(ROOT, 'frontend', BRAND.logo)));
  } catch (e) { console.error('  ⚠️  MIS logo load failed:', e.message); _misLogo = null; }
  return _misLogo;
}
function _getMisLogo() { return _misLogo || null; }

// Text ko maxWidth me wrap karta hai; maxLines se zyada ho to aakhir me ellipsis.
function _wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '', truncated = false;
  for (let i = 0; i < words.length; i++) {
    const test = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width <= maxWidth) { cur = test; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length >= maxLines) { truncated = true; cur = ''; break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  else if (cur) truncated = true;
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines.length ? lines : ['—'];
}

// 5 ya usse kam tasks -> ek single IMAGE jaati hai.
// Isse zyada -> saare tasks ek PDF me (har PDF page par 12 rows).
const MIS_IMAGE_MAX_TASKS = 5;
const MIS_PDF_ROWS_PER_PAGE = 12;

// Ek page render karta hai — app ke MIS detail modal jaisa:
// header + score/reason + stats + "ALL TASKS IN DATE RANGE" table.
function renderMISPage(emp, s, period, tasks, pageNo, totalPages, todayISO) {
  const lib = _getCanvas(); if (!lib) return null;

  const W = 1320, M = 28, PAD = 30; // Remark column ke liye thodi extra chaudai
  const headH = 96, scoreH = 158, secH = 40, thH = 40, rowH = 56, footH = 44;
  const H = M + headH + 20 + scoreH + secH + thH + tasks.length * rowH + 12 + footH + M;

  const canvas = lib.createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // Devanagari family bhi stack me — task descriptions Hindi me hain, aur
  // Inter unke liye khaali box deta hai. Canvas har akshar par pehle Inter
  // dekhta hai, na mile to Noto Sans Devanagari se le leta hai.
  const F = (size, weight = '400') => `${weight} ${size}px Inter, "Noto Sans Devanagari", sans-serif`;

  ctx.fillStyle = '#eef2f7'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; _roundRect(ctx, M, M, W - 2 * M, H - 2 * M, 16); ctx.fill();

  const cx0 = M + PAD, cw0 = W - 2 * M - 2 * PAD;

  // ── Header band ──
  ctx.save(); _roundRect(ctx, M, M, W - 2 * M, headH, 16); ctx.clip();
  ctx.fillStyle = BRAND.palette.primary; ctx.fillRect(M, M, W - 2 * M, headH); ctx.restore();
  ctx.fillStyle = '#ffffff'; ctx.font = F(26, '700');
  ctx.fillText(`${emp.name} — ${emp.sectionLabel || 'Checklist Tasks'}`, cx0, M + 42);
  ctx.font = F(14); ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${period.startDMY}  to  ${period.endDMY}${emp.department ? '   ·   ' + emp.department : ''}`, cx0, M + 70);
  // Top-right: company logo (white chip me, brand-rang ke band par saaf). Fail ho to text fallback.
  const logo = _getMisLogo();
  if (logo) {
    const lh = 60, lw = Math.round(lh * (logo.width / logo.height));
    const pad = 9, chipW = lw + pad * 2, chipH = lh + pad * 2;
    const chipX = W - M - PAD - chipW, chipY = M + Math.round((headH - chipH) / 2);
    ctx.fillStyle = '#ffffff'; _roundRect(ctx, chipX, chipY, chipW, chipH, 8); ctx.fill();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; // downscale sharp rahe
    // Logo apne solid background ke saath aa sakta hai (bina transparency ke) —
    // tab wo white chip ko poora dhak leta hai aur uske square corners purple
    // header par ubhar aate hain. Isliye image ko bhi rounded rect me clip karo.
    ctx.save();
    _roundRect(ctx, chipX + pad, chipY + pad, lw, lh, 5); ctx.clip();
    ctx.drawImage(logo, chipX + pad, chipY + pad, lw, lh);
    ctx.restore();
  } else {
    ctx.textAlign = 'right';
    ctx.font = F(13, '600'); ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(BRAND.short, W - M - PAD, M + 42);
    ctx.textAlign = 'left';
  }
  if (totalPages > 1) {
    ctx.textAlign = 'right';
    ctx.font = F(13, '400'); ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`Page ${pageNo} of ${totalPages}`, W - M - PAD, M + headH - 14);
    ctx.textAlign = 'left';
  }

  // ── Score + reason + stats ──
  const sy = M + headH + 20;
  ctx.fillStyle = '#f8fafc'; _roundRect(ctx, cx0, sy, cw0, scoreH, 12); ctx.fill();
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1; ctx.stroke();

  const score = s.score;
  const notScore = notOnTimeScoreOf(s.total, s.notOnTime); // negative ya 0
  // NEGATIVE: 0 = perfect (green), neeche = red
  const scoreCol = score === 0 ? '#16a34a' : '#dc2626';
  const notCol = notScore === 0 ? '#16a34a' : '#dc2626';
  const NOT_X = cx0 + 22 + 280; // "NOT ON TIME" column ka x

  // Do labelled scores — app ke MIS pop-up jaisa: MIS SCORE + NOT ON TIME
  ctx.font = F(12, '700'); ctx.fillStyle = '#64748b';
  ctx.fillText('MIS SCORE', cx0 + 22, sy + 28);
  ctx.fillText('NOT ON TIME', NOT_X, sy + 28);
  ctx.font = F(30, '800');
  ctx.fillStyle = scoreCol; ctx.fillText(`${score.toFixed(1)}%`, cx0 + 22, sy + 62);
  ctx.fillStyle = notCol;   ctx.fillText(`${notScore.toFixed(1)}%`, NOT_X, sy + 62);

  let reason;
  if (score === 0) reason = 'All tasks completed on time — perfect score!';
  else {
    const parts = [];
    if (s.pending > 0) parts.push(`${s.pending} task(s) still pending`);
    if (s.overdue > 0) parts.push(`${s.overdue} task(s) past due date`);
    if (s.notOnTime > 0) parts.push(`${s.notOnTime} task(s) completed late`);
    reason = 'Score reduced because: ' + parts.join(', ');
  }
  ctx.fillStyle = '#64748b'; ctx.font = F(14);
  ctx.fillText(reason, cx0 + 22, sy + 94);

  // Stats line (Not-on-time score ab upar prominent hai, isliye yahan sirf count)
  const stats = [
    { label: 'Total',       value: s.total,     color: '#0f172a' },
    { label: 'Done',        value: s.completed, color: '#10b981' },
    { label: 'Pending',     value: s.pending,   color: '#ef4444' },
    { label: 'Delayed',     value: s.overdue,   color: '#dc2626' },
    { label: 'Not on time', value: s.notOnTime, color: '#f97316' }
  ];
  // Delegation me 'revised' status hota hai (checklist me nahi) — tabhi dikhao jab ho
  if (s.revised) stats.push({ label: 'Revised', value: s.revised, color: '#d97706' });
  let sx = cx0 + 22;
  const statY = sy + 128;
  for (const st of stats) {
    ctx.font = F(14); ctx.fillStyle = st.color;
    const lbl = `${st.label}: `;
    ctx.fillText(lbl, sx, statY);
    sx += ctx.measureText(lbl).width;
    ctx.font = F(14, '700');
    ctx.fillText(String(st.value), sx, statY);
    sx += ctx.measureText(String(st.value)).width + 26;
  }

  // ── Section title ──
  const secY = sy + scoreH + 26;
  ctx.fillStyle = '#64748b'; ctx.font = F(12, '700');
  ctx.fillText('ALL TASKS IN DATE RANGE', cx0, secY);

  // ── Table ──
  const cols = [
    { label: 'DESCRIPTION',    w: 0.29 },
    { label: 'ASSIGNED BY',    w: 0.11 },
    { label: 'DUE DATE',       w: 0.11 },
    { label: 'STATUS',         w: 0.12 },
    { label: 'COMPLETED DATE', w: 0.16 },
    { label: 'REMARK',         w: 0.21 }
  ];
  let acc = cx0;
  for (const c of cols) { c.x = acc; c.width = cw0 * c.w; acc += c.width; }

  const thY = sy + scoreH + secH;
  ctx.fillStyle = '#f8fafc'; _roundRect(ctx, cx0, thY, cw0, thH, 8); ctx.fill();
  ctx.fillStyle = '#64748b'; ctx.font = F(11, '700');
  for (const c of cols) ctx.fillText(c.label, c.x + 12, thY + 25);

  let ry = thY + thH;
  for (const t of tasks) {
    ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, ry + rowH); ctx.lineTo(cx0 + cw0, ry + rowH); ctx.stroke();

    // Description (max 2 lines)
    ctx.fillStyle = '#0f172a'; ctx.font = F(14);
    const dLines = _wrapLines(ctx, t.description, cols[0].width - 24, 2);
    dLines.forEach((ln, i) => ctx.fillText(ln, cols[0].x + 12, ry + (dLines.length === 1 ? 34 : 26 + i * 19)));

    // Assigned by
    ctx.fillStyle = '#64748b'; ctx.font = F(12);
    ctx.fillText(_wrapLines(ctx, t.assigned_by_name || '—', cols[1].width - 24, 1)[0], cols[1].x + 12, ry + 34);

    // Due date
    ctx.fillStyle = '#334155'; ctx.font = F(12);
    ctx.fillText(t.due_fmt || '—', cols[2].x + 12, ry + 34);

    // Status badge — completed / revised (delegation) / pending
    const isDone = t.status === 'completed';
    const isRevised = t.status === 'revised';
    const bLabel = isDone ? 'Completed' : isRevised ? 'Revised' : 'Pending';
    ctx.font = F(12, '600');
    const bw2 = ctx.measureText(bLabel).width + 22;
    ctx.fillStyle = isDone ? '#dcfce7' : isRevised ? '#fef9c3' : '#fee2e2';
    _roundRect(ctx, cols[3].x + 12, ry + 16, bw2, 24, 12); ctx.fill();
    ctx.fillStyle = isDone ? '#16a34a' : isRevised ? '#854d0e' : '#dc2626';
    ctx.fillText(bLabel, cols[3].x + 23, ry + 33);

    // Completed date / Overdue / —
    ctx.font = F(12, '600');
    if (isDone && t.completed_fmt) {
      const late = t.completed_iso && t.due_iso && t.completed_iso > t.due_iso;
      ctx.fillStyle = late ? '#dc2626' : '#16a34a';
      ctx.fillText(t.completed_fmt, cols[4].x + 12, ry + 34);
    } else if (!isDone && t.due_iso && t.due_iso < todayISO) {
      ctx.fillStyle = '#dc2626';
      ctx.fillText('Overdue', cols[4].x + 12, ry + 34);
    } else {
      ctx.fillStyle = '#94a3b8'; ctx.font = F(12);
      ctx.fillText('—', cols[4].x + 12, ry + 34);
    }

    // Doer ka remark — "kyun nahi hua" (max 2 line, lamba ho to ellipsis)
    if (t.doer_remark && String(t.doer_remark).trim()) {
      ctx.fillStyle = BRAND.palette.primary; ctx.font = F(12);
      const rLines = _wrapLines(ctx, t.doer_remark, cols[5].width - 24, 2);
      rLines.forEach((ln, i) => ctx.fillText(ln, cols[5].x + 12, ry + (rLines.length === 1 ? 34 : 26 + i * 18)));
    } else {
      ctx.fillStyle = '#cbd5e1'; ctx.font = F(12);
      ctx.fillText('—', cols[5].x + 12, ry + 34);
    }

    ry += rowH;
  }

  // ── Footer ──
  ctx.fillStyle = '#94a3b8'; ctx.font = F(12);
  ctx.fillText('Score: 0% = all tasks completed on time. Pending & delayed tasks reduce the score.', cx0, H - M - 18);
  if (totalPages > 1) {
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${pageNo} of ${totalPages}`, W - M - PAD, H - M - 18);
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}

// Tasks ko pages me tod kar har page ka PNG buffer banata hai.
function renderMISPageBuffers(emp, s, period, tasks, todayISO, rowsPerPage) {
  const totalPages = Math.max(1, Math.ceil(tasks.length / rowsPerPage));
  const bufs = [];
  for (let p = 0; p < totalPages; p++) {
    const slice = tasks.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    const buf = renderMISPage(emp, s, period, slice, p + 1, totalPages, todayISO);
    if (!buf) return null;
    bufs.push(buf);
  }
  return bufs;
}

// Single image (base64 data URI). Data URI isliye — kahin file save nahi hoti,
// employee ka data kisi public URL par expose nahi hota.
function generateMISImage(emp, s, period, tasks, todayISO) {
  const bufs = renderMISPageBuffers(emp, s, period, tasks, todayISO, MIS_IMAGE_MAX_TASKS);
  if (!bufs || !bufs.length) return null;
  const buf = bufs[0];
  return { kind: 'image', dataUri: `data:image/png;base64,${buf.toString('base64')}`, bytes: buf.length };
}

// Saare tasks ek PDF me — har page par rendered table image embed hoti hai,
// isliye PDF bilkul image jaisa hi dikhta hai (ek hi layout code).
function generateMISPdf(emp, s, period, tasks, todayISO) {
  const bufs = renderMISPageBuffers(emp, s, period, tasks, todayISO, MIS_PDF_ROWS_PER_PAGE);
  if (!bufs || !bufs.length) return null;
  return new Promise((resolve, reject) => {
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => {
        const out = Buffer.concat(chunks);
        resolve({
          kind: 'pdf',
          dataUri: `data:application/pdf;base64,${out.toString('base64')}`,
          bytes: out.length,
          pages: bufs.length
        });
      });
      for (const b of bufs) {
        const img = doc.openImage(b);
        doc.addPage({ size: [img.width, img.height], margin: 0 });
        doc.image(img, 0, 0);
      }
      doc.end();
    } catch (e) { reject(e); }
  });
}

module.exports = {
  calcMisScore, notOnTimeScoreOf,
  ensureLogo: _ensureMisLogo,
  renderPage: renderMISPage,
  renderPageBuffers: renderMISPageBuffers,
  generateImage: generateMISImage,
  generatePdf: generateMISPdf,
  // Combined-PDF wala route bhi seedha renderPageBuffers bulata hai, isliye ise
  // export karna zaroori hai — warna wahan aur yahan do alag numbers ho jaate
  // hain aur ek hi report ke pages alag-alag bharte hain.
  PDF_ROWS_PER_PAGE: MIS_PDF_ROWS_PER_PAGE,
};
