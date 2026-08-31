// ══════════════════════════════════════════════════════
// DATES — IST
// ══════════════════════════════════════════════════════
// Poora app IST me sochta hai: reminders, WhatsApp schedule, MIS ke hafte,
// due dates — sab. Server kis timezone me chal raha hai isse koi farak nahi
// padna chahiye (Vercel UTC par hota hai, laptop IST par).
//
// Isi liye ye alag file me hai: date ka hisaab bina database aur bina Express
// ke test ho sakta hai, aur ek hi jagah rehne se drift nahi hoti.

// Abhi IST me kaunsi tareekh, kaunsa din aur kitna baja — server ke apne
// timezone se bilkul bepravah. Intl se karte hain, manual +5:30 jodkar nahi:
// DST-free zone hone ke bawajood manual offset galat din de deta hai jab UTC
// aur IST alag tareekhon par hote hain.
function istParts() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl kabhi-kabhi aadhi raat ko "24" deta hai — use 0 maano, warna hour
  // check (jaise `hour === 9`) chup-chaap fail hote hain.
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  return {
    dateStr: `${p.year}-${p.month}-${p.day}`,
    day: dayMap[p.weekday],
    hour,
    minute: parseInt(p.minute, 10),
  };
}

// DD/MM/YYYY — jo format WhatsApp messages aur MIS reports me dikhta hai.
function fmtDMY(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const p = n => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

// Pichla poora hafta: Monday se Saturday (IST ke hisaab se)
function lastWeekMonSat() {
  const ist = istParts();
  const base = new Date(`${ist.dateStr}T00:00:00Z`);
  const daysSinceMon = (ist.day === 0 ? 6 : ist.day - 1);
  const lastMon = new Date(base); lastMon.setUTCDate(base.getUTCDate() - daysSinceMon - 7);
  const lastSat = new Date(lastMon); lastSat.setUTCDate(lastMon.getUTCDate() + 5);
  const iso = d => d.toISOString().slice(0, 10);
  return { start: iso(lastMon), end: iso(lastSat) };
}


module.exports = { istParts, fmtDMY, lastWeekMonSat };

