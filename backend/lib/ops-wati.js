// ══════════════════════════════════════════════════════
// MICHELIN OPS — WhatsApp via Wati (template messages)
// ══════════════════════════════════════════════════════
// Apps Script ki Wati.gs ka Node roop. Yahan sirf: number normalize, Wati ko
// HTTP call, template params banana. "Kis event par kisko bhejna" wala kaam
// routes/ops.js me hai (use DB chahiye).
//
// Env:
//   WATI_BASE           https://live-mt-server.wati.io/<tenant>
//   WATI_TOKEN          Wati API token (Bearer)
//   OPS_NOTIFY_NUMBERS  office/Arun ke numbers, comma se (91 + 10 digit)
//
// Templates Wati dashboard me pehle se bane hone chahiye (API se nahi bante).
// Naam bilkul wahi jo sheet wale system me the — taaki approved templates
// waise hi chalte rahein.

const WATI_BASE = (process.env.WATI_BASE || '').replace(/\/+$/, '');
const WATI_TOKEN = process.env.WATI_TOKEN || '';
const ENABLED = !!(WATI_BASE && WATI_TOKEN);

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
};
const MAX_RETRY = 10;

// 10 digit -> 91xxxxxxxxxx; pehle se 91 laga ho to waise hi; warna ''.
function watiMob(m) {
  const d = String(m || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 12 && d.startsWith('91')) return d;
  return '';
}

// Template ke {{1}},{{2}}... ke liye params. Khali value '-' ban jaati hai —
// Wati khali param par message reject kar deta hai.
function params(vals) {
  return vals.map((v, i) => ({ name: String(i + 1), value: String(v == null || v === '' ? '-' : v) }));
}

// Wati ko template message. Return: 'SENT' | 'BAD_NUMBER' | 'FAIL:...' —
// throw nahi karta, taaki caller status ko log me likh sake (retry ke liye).
async function send(number, template, vals) {
  const to = watiMob(number);
  if (!to) return 'BAD_NUMBER';
  if (!ENABLED) return 'FAIL:WATI_NOT_CONFIGURED';
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(6, 14);
  const payload = {
    template_name: template,
    broadcast_name: `${template}_${stamp}`,
    receivers: [{ whatsappNumber: to, customParams: params(vals) }],
  };
  try {
    const res = await fetch(`${WATI_BASE}/api/v1/sendTemplateMessages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WATI_TOKEN}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.status !== 200) return `FAIL:HTTP${res.status}`;
    let body = {};
    try { body = JSON.parse(text || '{}'); } catch (_) {}
    return (body.result === true || body.result === 'success') ? 'SENT' : 'FAIL:' + text.slice(0, 80);
  } catch (e) {
    return 'FAIL:' + String(e.message || e).slice(0, 80);
  }
}

// "FAIL:xyz #3" -> 3
function retryCount(status) {
  const m = String(status || '').match(/#(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function fmtR(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

module.exports = { ENABLED, NOTIFY_NUMBERS, T, MAX_RETRY, watiMob, params, send, retryCount, fmtR };
