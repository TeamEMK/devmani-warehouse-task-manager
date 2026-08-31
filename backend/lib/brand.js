// ══════════════════════════════════════════════════════
// BRANDING
// ══════════════════════════════════════════════════════
// Client ka naam, logo aur rang poore code me sirf yahin se aate hain.
// "New Client Copy" naya client banate waqt sirf brand.json aur public/<logo>
// ko badalta hai — koi aur file haath nahi lagti.
//
//   full  → browser title      ("ABC Enterprises — Task Manager")
//   short → sidebar / emails   ("ABC Enterprises")
//
// company khaali ho (base repo ka default) to dono sirf product naam ban jaate
// hain, yaani UI bilkul waisa hi rehta hai jaisa branding se pehle tha.
//
// Ye alag module isliye hai ki server.js ke alawa lib/whatsapp.js jaisi files
// ko bhi BRAND.short chahiye. `require` cache karta hai, isliye sabko wahi ek
// object milta hai — derive kiye hue full/short/palette samet.

const BRAND = require('../../brand.json');

BRAND.full  = BRAND.company ? `${BRAND.company} — ${BRAND.product}` : BRAND.product;
BRAND.short = BRAND.company || BRAND.product;

// Emails aur MIS report ke rang bhi logo se hi aate hain. Shades contrast se
// chune jaate hain (details lib/brand-palette.js me), isliye kisi bhi client ke
// logo par white text padha jaata rahega.
BRAND.palette = require('./brand-palette')(BRAND.color || '#4f46e5');

module.exports = BRAND;
