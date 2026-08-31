// ══════════════════════════════════════════════════════
// BRAND PALETTE
// ══════════════════════════════════════════════════════
// brand.json ke ek rang (logo ka rang) se poori UI palette nikalta hai.
//
// Sabse badi baat: shades fix nahi hain, contrast se chune jaate hain. Logo ka
// raw rang seedha use nahi ho sakta — jaise humara amber #e69306 white par sirf
// 2.46:1 deta hai, jabki text ke liye WCAG AA 4.5:1 maangta hai. Isliye hue aur
// saturation logo ke rakhe jaate hain, aur lightness tab tak ghumai jaati hai
// jab tak contrast target pura na ho. Kisi bhi client ka logo aaye — neela,
// peela, gehra — UI padhne layak hi rahegi.
//
// Ye file client copies me BHI jaati hai (server.js emails aur MIS report ke
// liye isi ka istemal karti hai), lib/brand-copy.js ke ulat.

// ── colour math ───────────────────────────────────────
function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function relLuminance(hex) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// WCAG contrast ratio — 1 (same) se 21 (black vs white) tak.
function contrast(a, b) {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  if (!d) return { h: 0, s: 0, l };                       // grey logo
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

// Hue/saturation wahi rakho, lightness ghumate jao jab tak `against` ke saamne
// `target` contrast na mil jaye. dir = -1 (gehra karo) ya +1 (halka karo).
function shadeFor(h, s, { target, against, from, dir }) {
  let last = hslToHex(h, s, from);
  for (let i = 0; i <= 100; i++) {
    const l = from + dir * i * 0.01;
    if (l <= 0.02 || l >= 0.98) break;
    last = hslToHex(h, s, l);
    if (contrast(last, against) >= target) return last;
  }
  return last;                                            // target tak na pahunche to sabse door shade
}

// Surfaces jinke saamne contrast chahiye (HTML ke tokens se mel khate hain).
const LIGHT_SURFACE = '#ffffff';
const DARK_CARD     = '#131416';   // dark mode ka sabse halka surface
const SIDEBAR       = '#0e0f12';

function palette(baseHex) {
  const { h, s: rawS } = hexToHsl(baseHex);
  const s = Math.max(rawS, 0.35);   // bilkul phika logo bhi thoda brand-jaisa lage

  // Light mode: yahi rang text (33 jagah) aur button fill (7 jagah) dono banta
  // hai, isliye 4.7 target — 4.5 se thoda upar, taaki #fafafa foreground bhi
  // aaram se AA pass kare.
  const primary = shadeFor(h, s, { target: 4.7, against: LIGHT_SURFACE, from: 0.46, dir: -1 });

  // Dark mode: card sabse halka dark surface hai, usi ke saamne check karo.
  const primaryDark = shadeFor(h, s, { target: 4.5, against: DARK_CARD, from: 0.46, dir: +1 });

  // Sidebar hamesha dark rehta hai (light theme me bhi), isliye alag shade —
  // thoda aur bright, kyunki yahin logo ka asli rang sabse saaf dikhta hai.
  const sidebarPrimary = shadeFor(h, s, { target: 7, against: SIDEBAR, from: 0.50, dir: +1 });

  const [br, bg, bb] = hexToRgb(baseHex);

  return {
    base: '#' + [br, bg, bb].map(v => v.toString(16).padStart(2, '0')).join(''),
    // light
    primary,
    accent:         hslToHex(h, Math.min(s, 0.85), 0.93),
    accentFg:       shadeFor(h, s, { target: 7, against: LIGHT_SURFACE, from: 0.40, dir: -1 }),
    // dark
    primaryDark,
    accentDark:     hslToHex(h, Math.min(s, 0.55), 0.12),
    accentFgDark:   shadeFor(h, s, { target: 7, against: DARK_CARD, from: 0.55, dir: +1 }),
    // sidebar (dono themes me)
    sidebarPrimary,
    sidebarPrimaryBg: `rgba(${br},${bg},${bb},.20)`,
  };
}

module.exports = palette;
module.exports.contrast = contrast;
module.exports.hexToHsl = hexToHsl;
module.exports.hexToRgb = hexToRgb;
