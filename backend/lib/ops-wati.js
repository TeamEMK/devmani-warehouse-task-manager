// ══════════════════════════════════════════════════════
// MICHELIN OPS — WhatsApp: Waumfy (default) ya Wati (template messages)
// ══════════════════════════════════════════════════════
// Yahan sirf: number normalize, provider ko HTTP call, message ka text banana.
// "Kis event par kisko bhejna" wala kaam routes/ops.js me hai (use DB chahiye).
//
// Do provider:
//   waumfy : plain text + PDF seedha (base64). Message ka text yahin TEXTS me banta hai
//            (Wati template ke params usi order me aate hain, isliye dono ek hi send() se chalte hain).
//            API: POST https://waumfy.com/api/v1/send-message, header x-api-key.
//   wati   : approved template messages (naam T me), PDF sirf 24-ghante session me.
//
// Config (pehle DB settings, phir env):
//   app_settings wa.provider ('waumfy'|'wati'), wa.waumfyKey  — Masters page se admin set karta hai (configure())
//   env WAUMFY_API_KEY, OPS_WA_PROVIDER, WATI_BASE, WATI_TOKEN, OPS_NOTIFY_NUMBERS (office numbers, comma se)

const cleanTok = s => String(s || '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
const WATI_BASE = cleanTok(process.env.WATI_BASE).replace(/\/+$/, '').replace(/\/api\/v1.*$/, '');
const WATI_TOKEN = cleanTok(process.env.WATI_TOKEN);
const WATI_ENABLED = !!(WATI_BASE && WATI_TOKEN);
const WAUMFY_BASE = 'https://waumfy.com/api/v1';

// Runtime config — configure() se badalta hai (DB settings boot par load hoti hain)
const cfg = { provider: '', waumfyKey: cleanTok(process.env.WAUMFY_API_KEY) };
function provider() {
  if (cfg.provider === 'wati' || cfg.provider === 'waumfy') return cfg.provider;
  const env = String(process.env.OPS_WA_PROVIDER || '').toLowerCase();
  if (env === 'wati' || env === 'waumfy') return env;
  return cfg.waumfyKey ? 'waumfy' : 'wati';
}
function isEnabled() { return provider() === 'waumfy' ? !!cfg.waumfyKey : WATI_ENABLED; }
function configure(o) {
  if (!o) return;
  if (o.provider !== undefined) cfg.provider = String(o.provider || '').toLowerCase();
  if (o.waumfyKey !== undefined) cfg.waumfyKey = cleanTok(o.waumfyKey);
}

const NOTIFY_NUMBERS = String(process.env.OPS_NOTIFY_NUMBERS || '')
  .split(',').map(s => s.replace(/\D/g, '')).filter(s => s.length === 12);

const T = {
  NEW_ORDER: 'michelin_new_order',            // office ko: dealer, city, dsr, qty, amount, oid
  DISPATCH: 'michelin_dispatch',              // dealer ko: dealer, oid, qty, vehicle
  DISPATCH_DSR: 'michelin_dispatch_dsr',      // DSR ko: dealer, oid, qty, vehicle
  DELIVERED_DSR: 'michelin_delivered_dsr',    // DSR ko: dealer, oid, qty
  DELIVERED_DLR: 'michelin_delivered_dealer', // dealer ko: dealer, oid, qty
  SUMMARY: 'michelin_daily_summary',          // office ko: date, newCount, newQty, dispToday, pending
  PAYMENT: 'michelin_payment_received',       // dealer + DSR: dealer, paid, baaki, asOn
  CONFIRMED: 'order_confirmed_dealer',        // dealer ko: dealer, oid, "X pcs, ₹Y", terms
  DRIVER: 'driver_dispatch',                  // driver ko: dealer, address, dealerMob, items, gps
  RM_REPORT: 'rm_report',                     // RM ko: "Sale"/"Reorder", company, text, date
  PAY_REMINDER: 'michelin_payment_reminder',  // dealer + DSR: dealer, oid, amount, due date
  OUTSTANDING: 'michelin_outstanding',        // dealer ko: dealer, total bakaya, due-from date, statement line/link
};
const MAX_RETRY = 10;
const SIGN = '- Bansal Oil Distributors, Hisar';

function fmtR(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
const money = v => (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) ? fmtR(v) : String(v);

// Waumfy ke liye har template ka text — params wahi order jo Wati template me hai
const TEXTS = {
  [T.NEW_ORDER]: ([dealer, city, dsr, qty, amount, oid]) => `*Naya order ${oid}*\nDealer: ${dealer} (${city})\nDSR: ${dsr}\n${qty} pcs · ${money(amount)}\n${SIGN}`,
  [T.DISPATCH]: ([dealer, oid, qty, veh]) => `Namaste ${dealer} ji,\nAapka order *${oid}* (${qty} pcs) dispatch ho gaya hai.\nVehicle / transport: ${veh}\n${SIGN}`,
  [T.DISPATCH_DSR]: ([dealer, oid, qty, veh]) => `Order *${oid}* dispatch ho gaya: ${dealer}, ${qty} pcs.\nVehicle / transport: ${veh}`,
  [T.DELIVERED_DSR]: ([dealer, oid, qty]) => `Order *${oid}* deliver ho gaya: ${dealer}, ${qty} pcs. Payment follow-up karein.`,
  [T.DELIVERED_DLR]: ([dealer, oid, qty]) => `Namaste ${dealer} ji,\nAapka order *${oid}* (${qty} pcs) deliver ho gaya. Dhanyavaad!\n${SIGN}`,
  [T.SUMMARY]: ([date, n, q, disp, pend]) => `*Michelin Ops — ${date}*\nNaye orders: ${n} (${q} pcs)\nAaj dispatch: ${disp}\nPending (billing/dispatch): ${pend}`,
  [T.PAYMENT]: ([dealer, paid, baaki, asOn]) => `Namaste ${dealer} ji,\nAapki payment *${money(paid)}* mil gayi (as on ${asOn}). Dhanyavaad!\nBaaki bakaya: ${money(baaki)}\n${SIGN}`,
  [T.CONFIRMED]: ([dealer, oid, qtyAmt, terms]) => `Namaste ${dealer} ji,\nAapka order *${oid}* confirm ho gaya: ${qtyAmt}.\nPayment terms: ${terms}\nJaldi dispatch hoga.\n${SIGN}`,
  [T.DRIVER]: ([dealer, addr, mob, items, gps]) => `*Delivery*\nParty: ${dealer}\nAddress: ${addr}\nPhone: ${mob}\nItems: ${items}\nLocation: ${gps}`,
  [T.RM_REPORT]: ([label, company, text, date]) => `*${label} Report — ${company}*\n\n${text}\n\nAs on ${date} ${SIGN}`,
  [T.PAY_REMINDER]: ([dealer, oid, amount, due]) => `Namaste ${dealer} ji,\nOrder *${oid}* ka ${money(amount)} payment *${due}* tak due hai. Kripya samay par payment karein.\n${SIGN}`,
  [T.OUTSTANDING]: ([dealer, amount, dueFrom, statement]) => `Namaste ${dealer} ji,\n\nBansal Oil Distributors (Hisar) me aapka bakaya *${amount}* hai, jo ${dueFrom} ke bill se pending hai.\n\n${statement}\n\nKripya payment jaldi karein. Koi farak lage to office se sampark karein.\n\n${SIGN}`,
};
function renderText(template, vals) {
  const f = TEXTS[template];
  const v = (vals || []).map(x => (x == null || x === '' ? '-' : x));
  return f ? f(v) : `${template}: ${v.join(' | ')}`;
}

// 10 digit -> 91xxxxxxxxxx; pehle se 91 laga ho to waise hi; warna ''.
function watiMob(m) {
  const d = String(m || '').replace(/\D/g, '');
  if (d.startsWith('0')) return ''; // synthetic (main app user bina phone) — WhatsApp nahi
  if (d.length === 10) return '91' + d;
  if (d.length === 12 && d.startsWith('91')) return d;
  return '';
}

// Template ke {{1}},{{2}}... ke liye params. Khali value '-' ban jaati hai —
// Wati khali param par message reject kar deta hai.
function params(vals) {
  return vals.map((v, i) => ({ name: String(i + 1), value: String(v == null || v === '' ? '-' : v) }));
}

async function waumfyPost(path, body) {
  const res = await fetch(`${WAUMFY_BASE}/${path}`, { method: 'POST', headers: { 'x-api-key': cfg.waumfyKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text || '{}'); } catch (_) {}
  if (!res.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${res.status} ${text.slice(0, 80)}`);
  return data;
}

// Message bhejo. Return: 'SENT' | 'BAD_NUMBER' | 'FAIL:...' — throw nahi karta (caller log/retry karta hai).
async function send(number, template, vals) {
  const to = watiMob(number);
  if (!to) return 'BAD_NUMBER';
  if (provider() === 'waumfy') {
    if (!cfg.waumfyKey) return 'FAIL:WAUMFY_NOT_CONFIGURED';
    try { await waumfyPost('send-message', { phone: to, message: renderText(template, vals).slice(0, 4000) }); return 'SENT'; }
    catch (e) { return 'FAIL:' + String(e.message || e).slice(0, 80); }
  }
  if (!WATI_ENABLED) return 'FAIL:WATI_NOT_CONFIGURED';
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(6, 14);
  const payload = { template_name: template, broadcast_name: `${template}_${stamp}`, receivers: [{ whatsappNumber: to, customParams: params(vals) }] };
  try {
    const res = await fetch(`${WATI_BASE}/api/v1/sendTemplateMessages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WATI_TOKEN}` }, body: JSON.stringify(payload) });
    const text = await res.text();
    if (res.status !== 200) return `FAIL:HTTP${res.status}`;
    let body = {}; try { body = JSON.parse(text || '{}'); } catch (_) {}
    return (body.result === true || body.result === 'success') ? 'SENT' : 'FAIL:' + text.slice(0, 80);
  } catch (e) { return 'FAIL:' + String(e.message || e).slice(0, 80); }
}
// Seedha text (bina template) — sirf Waumfy par; Wati par template zaroori hai
async function sendText(number, text) {
  const to = watiMob(number); if (!to) return 'BAD_NUMBER';
  if (provider() !== 'waumfy') return 'FAIL:TEXT_NEEDS_WAUMFY';
  if (!cfg.waumfyKey) return 'FAIL:WAUMFY_NOT_CONFIGURED';
  try { await waumfyPost('send-message', { phone: to, message: String(text).slice(0, 4000) }); return 'SENT'; } catch (e) { return 'FAIL:' + String(e.message || e).slice(0, 80); }
}
// PDF file: Waumfy par base64 se seedha; Wati par sirf 24-ghante session me (sendSessionFile)
async function sendFile(number, buf, filename, caption) {
  const to = watiMob(number);
  if (!to) return 'BAD_NUMBER';
  if (provider() === 'waumfy') {
    if (!cfg.waumfyKey) return 'FAIL:WAUMFY_NOT_CONFIGURED';
    try { await waumfyPost('send-message', { phone: to, type: 'pdf', media_base64: buf.toString('base64'), filename, caption: caption || '' }); return 'SENT'; }
    catch (e) { return 'FAIL:' + String(e.message || e).slice(0, 80); }
  }
  if (!WATI_ENABLED) return 'FAIL:WATI_NOT_CONFIGURED';
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'application/pdf' }), filename);
    const res = await fetch(`${WATI_BASE}/api/v1/sendSessionFile/${to}?caption=${encodeURIComponent(caption || '')}`, { method: 'POST', headers: { Authorization: `Bearer ${WATI_TOKEN}` }, body: fd });
    const text = await res.text();
    if (res.status !== 200) return `FAIL:HTTP${res.status}`;
    let body = {}; try { body = JSON.parse(text || '{}'); } catch (_) {}
    return body.result === true || body.result === 'success' ? 'SENT' : 'FAIL:' + String(body.info || text).slice(0, 80);
  } catch (e) { return 'FAIL:' + String(e.message || e).slice(0, 80); }
}

// "FAIL:xyz #3" -> 3
function retryCount(status) {
  const m = String(status || '').match(/#(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Setup check (admin): provider, key/token (masked), aur provider se ek halki call
async function check() {
  const p = provider();
  const info = { provider: p, enabled: isEnabled(), notify: NOTIFY_NUMBERS, waumfyKeySet: !!cfg.waumfyKey, waumfyKeyEnd: cfg.waumfyKey.slice(-4), watiConfigured: WATI_ENABLED, base: WATI_BASE, tokenLen: WATI_TOKEN.length, tokenStart: WATI_TOKEN.slice(0, 9), tokenEnd: WATI_TOKEN.slice(-4) };
  if (!isEnabled()) return { ...info, status: 'NOT_CONFIGURED' };
  if (p === 'waumfy') {
    try { const r = await waumfyPost('check-whatsapp', { phones: NOTIFY_NUMBERS.length ? NOTIFY_NUMBERS.slice(0, 1) : ['919896677494'] }); return { ...info, status: 200, sample: r.results, templates: Object.values(T).map(t => `${t} (app text)`), need: Object.values(T) }; }
    catch (e) { return { ...info, status: 'ERR', error: e.message }; }
  }
  try {
    const res = await fetch(`${WATI_BASE}/api/v1/getMessageTemplates?pageSize=100`, { headers: { Authorization: `Bearer ${WATI_TOKEN}` } });
    const text = await res.text();
    let names = [];
    try { names = (JSON.parse(text).messageTemplates || []).map(t => `${t.elementName} (${t.status || t.category || ''})`); } catch (_) {}
    return { ...info, status: res.status, templates: names, need: Object.values(T), raw: res.status === 200 ? '' : text.slice(0, 200) };
  } catch (e) { return { ...info, status: 'ERR', error: e.message }; }
}

module.exports = { NOTIFY_NUMBERS, T, MAX_RETRY, watiMob, params, send, sendText, sendFile, retryCount, fmtR, check, configure, provider, isEnabled, renderText, TEXTS };
// ENABLED purane code ke liye — ab dynamic (provider/key badalne par turant)
Object.defineProperty(module.exports, 'ENABLED', { get: isEnabled, enumerable: true });
