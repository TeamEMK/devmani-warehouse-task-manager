// ══════════════════════════════════════════════════════
// WHATSAPP  (Waumfy)
// ══════════════════════════════════════════════════════
// Do cheezein yahan hain aur do jaanbujhkar nahi:
//
//   yahan  → number normalize karna, Waumfy ko HTTP call, aur message ka text
//            banana. In sab ka database se koi lena-dena nahi.
//   yahan nahi → "kis-kis ko bhejna hai" wali passes (daily checklist,
//            weekly MIS). Wo DB query karti hain, isliye server.js me hain.
//
// Is batwaare ka faayda: message ka text bina DB aur bina Waumfy key ke test
// ho jaata hai — bas function bulao aur string padho.
//
// Waumfy ke teen alag trigger URL hote hain (text / image / document) aur
// teenon ka response ek jaisa hai: HTTP 200 ke bawajood body me
// `success: false` aa sakta hai, isliye dono cheezein check karni padti hain.

const BRAND = require('./brand');
const { fmtDMY } = require('./dates');

// Dono env var chahiye — key ke bina call authenticate nahi hogi, trigger URL
// ke bina bhejne ki jagah hi nahi. Boot par ek baar tay ho jaata hai.
const WA_ENABLED = !!(process.env.WAUMFY_API_KEY && process.env.WAUMFY_TRIGGER_URL);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Number ko WhatsApp format me laata hai (sirf digits, 10-digit Indian pe 91 lagta hai)
function normalizeWhatsAppPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = '91' + d;            // bare Indian mobile
  if (d.length < 11 || d.length > 15) return null; // clearly invalid
  return d;
}

// Teenon senders ka response handling bilkul same hai — ek hi jagah rakha,
// taaki koi naya trigger jodte waqt `success: false` check chhut na jaye.
async function postToWaumfy(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': process.env.WAUMFY_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Ek WhatsApp message bhejta hai. Success pe API response return karta hai,
// warna throw karta hai (caller count/log karega).
async function sendWhatsApp(phone, message) {
  if (!WA_ENABLED) throw new Error('WhatsApp not configured (WAUMFY_* env missing)');
  return postToWaumfy(process.env.WAUMFY_TRIGGER_URL, { phone, message });
}

// PDF/document bhejne ke liye alag Waumfy trigger chahiye (image trigger
// document ko bhi imageMessage bana deta hai, jo WhatsApp par toota dikhta hai).
async function sendWhatsAppDocument(phone, caption, dataUri, fileName) {
  const url = process.env.WAUMFY_DOC_TRIGGER_URL;
  if (!url) throw new Error('WAUMFY_DOC_TRIGGER_URL missing — create a document trigger in Waumfy');
  return postToWaumfy(url, { phone, message: caption, mediaUrl: dataUri, fileName });
}

async function sendWhatsAppImage(phone, caption, imageUrl) {
  const url = process.env.WAUMFY_IMAGE_TRIGGER_URL;
  if (!url) throw new Error('WAUMFY_IMAGE_TRIGGER_URL missing');
  return postToWaumfy(url, { phone, message: caption, imageUrl });
}

// ── Message text ──────────────────────────────────────
// Waumfy plain text bhejta hai; *stars* WhatsApp me bold ban jaate hain.

const _WA_MAX_TASKS = 30; // ek message me itne se zyada tasks ho to baaki "+N more"

// DB me frequency full word me hoti hai (daily/weekly/...), message me single
// letter chahiye — D/W/F/M/Q/Y. Purane rows me NULL ho sakti hai.
const _FREQ_CODE = { daily: 'D', weekly: 'W', alternative_week: 'F', fortnightly: 'F', monthly: 'M', quarterly: 'Q', yearly: 'Y' };
function _freqCode(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return _FREQ_CODE[s] || (s.length === 1 ? s.toUpperCase() : s.charAt(0).toUpperCase());
}

// Ek user ke tasks se WhatsApp message text banata hai.
// tasks me aaj ke bhi hain aur aaj se pehle ke pending bhi — oldest pehle.
function buildPendingWhatsAppMessage(userName, tasks, todayDMY, todayISO) {
  const overdue = tasks.filter(t => t.due_iso && t.due_iso < todayISO).length;
  const today = tasks.length - overdue;
  const lines = [];
  lines.push(`*${userName} — Checklist Pending Task Summary*`);
  lines.push(todayDMY);
  lines.push('');
  lines.push(`You have ${tasks.length} pending checklist task(s) — ${today} due today, ${overdue} overdue from before. Please complete them today.`);
  lines.push('');
  const shown = tasks.slice(0, _WA_MAX_TASKS);
  for (const t of shown) {
    lines.push(`Task ID - ${t.id}`);
    lines.push(`Task - ${t.description}`);
    lines.push(`Target Date - ${t.due_fmt}`);
    const fc = _freqCode(t.frequency);
    if (fc) lines.push(`Frequency - ${fc}`);
    lines.push('');
  }
  if (tasks.length > shown.length) {
    lines.push(`...and ${tasks.length - shown.length} more pending. Please check the app.`);
    lines.push('');
  }
  lines.push(`Total Pending: ${tasks.length}`);
  lines.push('');
  lines.push(`— ${BRAND.short}`);
  return lines.join('\n');
}

const _LEAVE_TYPE_LABEL = { full_day: 'Full Day', half_day: 'Half Day', work_from_home: 'Work From Home' };

// Leave approve/reject hone par applicant ko jaane wala WhatsApp message.
function buildLeaveDecisionMessage({ name, action, leaveType, fromISO, toISO, approver, note }) {
  const approved = action === 'approved';
  const d = iso => fmtDMY(new Date(`${iso}T12:00:00`)); // T12 se timezone shift na ho
  const dates = fromISO === toISO ? d(fromISO) : `${d(fromISO)} to ${d(toISO)}`;
  const lines = [];
  lines.push(approved ? '✅ *Leave Approved*' : '❌ *Leave Rejected*');
  lines.push('');
  lines.push(`Hi ${name},`);
  lines.push(approved ? 'Your leave request has been approved.' : 'Your leave request has been rejected.');
  lines.push('');
  lines.push(`Type - ${_LEAVE_TYPE_LABEL[leaveType] || leaveType}`);
  lines.push(`Dates - ${dates}`);
  lines.push(`${approved ? 'Approved' : 'Rejected'} by - ${approver || 'Admin'}`);
  // note ko string me coerce — non-string aaye to bhi .trim() na phate
  const reason = String(note == null ? '' : note).trim();
  if (!approved && reason) lines.push(`Reason - ${reason}`);
  lines.push('');
  lines.push(`— ${BRAND.short}`);
  return lines.join('\n');
}

module.exports = {
  WA_ENABLED,
  sleep,
  normalizeWhatsAppPhone,
  sendWhatsApp,
  sendWhatsAppDocument,
  sendWhatsAppImage,
  buildPendingWhatsAppMessage,
  buildLeaveDecisionMessage,
};
