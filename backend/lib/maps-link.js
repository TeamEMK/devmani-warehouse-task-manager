// ══════════════════════════════════════════════════════
// GOOGLE MAPS LINK -> lat/lng
// ══════════════════════════════════════════════════════
// Dealer ki location aksar WhatsApp par "pin" ke roop me hoti hai — Google
// Maps ka link. Usi se coordinates nikaal lete hain, DSR ko shop par jaakar
// GPS lene ki zaroorat nahi.
//
// Samjhe jaane wale roop:
//   https://maps.app.goo.gl/xxxx, https://goo.gl/maps/xxxx   (short — pehle redirect follow)
//   .../@28.4595,77.0266,17z            .../place/Name/@lat,lng
//   ...?q=28.4595,77.0266   ...?ll=lat,lng   ...?destination=lat,lng   ...?daddr=lat,lng
//   ...!3d28.4595!4d77.0266             (embed/data wale)
//   "28.4595, 77.0266"                  (seedha numbers bhi chalte hain)

const NUM = '(-?\\d{1,3}\\.\\d+)';
const PATTERNS = [
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`[?&](?:q|ll|destination|daddr|saddr|center)=${NUM}(?:,|%2C)${NUM}`, 'i'),
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`[?&]q=loc:${NUM}(?:,|%2C)${NUM}`, 'i'),
  new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`),
];

function parseCoords(text) {
  const s = decodeURIComponent(String(text || ''));
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}

// Short link ko redirect follow karke asli URL tak le jaao (5 hop tak). Redirect
// ke Location header me hi coordinates hote hain — page download nahi karna.
async function resolveShort(url) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    let res;
    try { res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } }); }
    catch (e) { return cur; }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur).toString(); if (parseCoords(cur)) return cur; continue; }
    // Kabhi Google 200 deta hai aur coordinates HTML me hote hain
    if (res.status === 200 && /google\.com\/maps/.test(cur) === false) {
      try { const html = await res.text(); const m = html.match(/https:\/\/www\.google\.com\/maps[^"'\s<]+/); if (m) return decodeURIComponent(m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&')); } catch (e) {}
    }
    return cur;
  }
  return cur;
}

// Main: link ya "lat, lng" text -> {lat,lng} ya null
async function coordsFromLink(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let c = parseCoords(s);
  if (c) return c;
  const urlMatch = s.match(/https?:\/\/\S+/);
  if (!urlMatch) return null;
  const resolved = await resolveShort(urlMatch[0]);
  return parseCoords(resolved);
}

module.exports = { parseCoords, resolveShort, coordsFromLink };
