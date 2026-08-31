// ══════════════════════════════════════════════════════
// GOOGLE  —  Sheets client, credentials, proof-video upload
// ══════════════════════════════════════════════════════
// Teen cheezein: service account credentials kahan se aayein, Sheets ka client,
// aur proof video Drive par bhejne wala Apps Script call.
//
// Teenon ek saath isliye ki teenon ek hi service account par tikke hain — aur
// pehle jab ye alag-alag jagah credentials padhte the, to production par ek
// chalta tha aur doosra fail hota tha.
let _sheetsReadClient = null;
let _sheetsWriteClient = null;

// Service account credentials teen tarah se aa sakti hain, isi kram me:
//
//   1. GOOGLE_CREDENTIALS_B64 — wahi JSON, base64 me. Ye sabse bharosemand hai:
//      base64 me sirf A-Z a-z 0-9 + / = hote hain, na quote na backslash na
//      newline — yaani hosting panel usme kuch tod-mod nahi kar sakta.
//   2. GOOGLE_CREDENTIALS — seedha JSON. Kaam karta hai, par kuch panels paste
//      karte waqt ise escape ya truncate kar dete hain (aur phir "not valid JSON"
//      milta hai jiski wajah samajhna mushkil hota hai).
//   3. credentials.json file — local development ke liye.
//
// Ek hi jagah rakha hai taaki Sheets client aur /api/fms/service-account dono
// bilkul ek jaisa vyavhaar karein; pehle ye alag-alag the aur isi se production
// par ek chal raha tha aur doosra fail ho raha tha.
function loadGoogleCredentials() {
  if (process.env.GOOGLE_CREDENTIALS_B64) {
    return JSON.parse(Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  return require('../../credentials.json');
}

async function getSheetsClient(scopes) {
  const { google } = require('googleapis');
  const creds = loadGoogleCredentials();
  const isWrite = scopes.some(s => !s.includes('readonly'));
  if (isWrite) {
    if (_sheetsWriteClient) return _sheetsWriteClient;
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    _sheetsWriteClient = google.sheets({ version: 'v4', auth: await auth.getClient() });
    return _sheetsWriteClient;
  } else {
    if (_sheetsReadClient) return _sheetsReadClient;
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    _sheetsReadClient = google.sheets({ version: 'v4', auth: await auth.getClient() });
    return _sheetsReadClient;
  }
}

// Google auth banane me pehli baar ~1s lagta hai. Boot par ek baar bana lein to
// pehli asli request us intezaar se bach jaati hai. Fail ho to sirf log —
// Sheets ke bina bhi baaki app poori tarah chalti hai.
//
// Jaan-bujhkar function hai, import-time IIFE nahi: require karne bhar se
// network call chalu ho jaana test me bhi dikkat deta hai.
async function prewarmGoogleAuth() {
  try {
    await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    console.log('  ✅ Google Auth pre-warmed');
  } catch(e) { console.log('  ⚠️ Google Auth pre-warm failed:', e.message); }
}

// ══════════════════════════════════════════════════════
// PROOF VIDEO STORAGE — Google Apps Script web app
// ══════════════════════════════════════════════════════
// Photo ke ulat video DB me nahi jaati. 30 second ki ek clip bhi 5-10MB ki hoti
// hai; base64 karke MySQL me rakhne se table kuch hi hafton me phat jaayega.
// Isliye video client ke diye hue Drive folder me jaati hai, DB me sirf file id.
//
// Drive API (service account) yahan JAAN-BUJHKAR nahi use ki: service account ka
// apna storage quota 0 hota hai, isliye kisi ki normal "My Drive" ke folder me
// upload `storageQuotaExceeded` se fail hota hai — yahi commit ab0b666 me pakda
// gaya tha aur tab photos Drive se DB me shift karni padi thi. Apps Script web app
// apne OWNER ke naam par chalti hai, to owner ka quota lagta hai aur client ka aam
// shared folder bina kisi Google Cloud setup ke chal jaata hai.
//
// Script ka code repo me hai: apps_script_proof_upload.gs (deploy steps usi me).
// Setup theek hai ya nahi — admin GET /api/admin/drive-check se check kare.
async function callProofScript(payload) {
  const url = process.env.APPS_SCRIPT_UPLOAD_URL;
  if (!url) throw new Error('APPS_SCRIPT_UPLOAD_URL is not set in .env');
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.APPS_SCRIPT_SECRET || '', ...payload }),
  });
  const text = await resp.text();
  let data;
  // Galat deploy hone par Apps Script JSON ki jagah Google ka HTML login page bhejti
  // hai. Us case me JSON.parse phatta hai — bina is check ke error bilkul samajh
  // nahi aata ki asli problem deployment settings hain.
  try { data = JSON.parse(text); }
  catch { throw new Error('Apps Script did not return JSON — redeploy the web app with "Who has access: Anyone"'); }
  if (!data.ok) throw new Error(data.error || 'Apps Script returned an error');
  return data;
}

// Drive link ya raw id — dono se folder id nikal lo (client aksar pura URL bhejta hai)
function extractDriveFolderId(raw) {
  const s = (raw || '').trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

function extractSpreadsheetId(raw) {
  const s = (raw || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

module.exports = {
  loadGoogleCredentials, getSheetsClient, prewarmGoogleAuth,
  callProofScript, extractDriveFolderId, extractSpreadsheetId,
};
