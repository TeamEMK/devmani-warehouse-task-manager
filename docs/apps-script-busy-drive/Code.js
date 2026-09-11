/* ═══════════════════════════════════════════════════════════════
   MICHELIN OPS — Busy Drive Bridge (web app)

   Busy ke exports (Stock Status / Amount Receivable .xlsx) is Google account
   (Devmaniwarehouses@gmail.com) ke Drive me ek folder me aate hain — din me
   ~3 baar update hote hain. devmanierp.com/ops har 30 min is script se poochta
   hai ki folder me kaunsi file kab badli (list), badli hui file utha leta hai
   (get) aur khud import kar leta hai (stock / outstanding / payment WhatsApp).

   Setup (ek baar, Devmaniwarehouses@gmail.com se login karke):
     1. script.google.com -> New project -> ye poori file paste karo (Code.gs).
        Project settings me "Show appsscript.json" on karke appsscript.json bhi
        paste karo (Drive + UrlFetch permission ke liye).
     2. Neeche FOLDER me Busy wale folder ka naam (ya uska link/ID) likho.
     3. SECRET me wahi text daalo jo app me Busy Import -> "Drive se auto-import"
        -> Settings me hai (app me "Naya" dabao to ban jaata hai).
     4. Editor me function `authorize` chuno -> Run -> permission Allow.
        Log me folder ka naam aur file count dikhna chahiye.
     5. Deploy -> New deployment -> type "Web app" -> Execute as: Me,
        Who has access: Anyone -> Deploy -> URL copy karke app ki settings me
        "Apps Script web app URL" me paste -> Save -> "Test connection".
     Code badlo to Deploy -> Manage deployments -> Edit -> New version, warna
     purana code hi chalta rahega.

   API (POST JSON, sab me { secret } zaroori):
     { action:'ping' }            -> { ok, folder, url, count }
     { action:'list' }            -> { ok, files:[{ id, name, mime, size, modified }] }  (nayi pehle)
     { action:'get', id }         -> { ok, name, b64 }   (hamesha .xlsx — .xls / Google Sheet convert ho jaati hai)
     { action:'raw', id, offset, length } -> { ok, name, size, offset, length, b64 }  (Busy backup DATA.ZIP tukdon me)
   list me Busy auto-backup ka sabse naya "<date time>/COMPBOD/DATA.ZIP" bhi aata hai (kind 'backup').
   ═══════════════════════════════════════════════════════════════ */
var FOLDER = 'Busy';           // folder ka naam, ya folder ka link / ID
var SECRET = 'CHANGE-ME';      // app ki Busy Import -> Drive settings wala secret

var COMPANY = 'COMPBOD';       // Busy backup me company folder (COMPBOD = Bansal Oil Distributors)
var CHUNK = 12 * 1024 * 1024;  // raw download ek baar me itne bytes (base64 ke baad ~16MB)

var XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var GSHEET = 'application/vnd.google-apps.spreadsheet';

function authorize() {
  var f = folder_();
  var n = listFiles_().length;
  Logger.log('OK — folder: "' + f.getName() + '" ' + f.getUrl() + ' — ' + n + ' spreadsheet file(s)');
  // UrlFetch permission bhi abhi le lo (xls/Google Sheet convert ke liye)
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
}

function folder_() {
  var m = String(FOLDER).match(/[-\w]{25,}/);
  if (m) { try { return DriveApp.getFolderById(m[0]); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER);
  if (it.hasNext()) return it.next();
  // Naam se na mile to: jahan Busy ki "Stock Status" / "Amount Receivable" wali sabse nayi file padi hai, wahi folder
  var found = null, foundAt = 0;
  var fs = DriveApp.searchFiles("(title contains 'Stock' or title contains 'Receivable' or title contains 'Outstanding') and trashed = false");
  while (fs.hasNext()) {
    var f = fs.next(); if (!isSheetLike_(f.getName(), f.getMimeType())) continue;
    var ts = f.getLastUpdated().getTime(); if (ts <= foundAt) continue;
    var ps = f.getParents(); if (ps.hasNext()) { found = ps.next(); foundAt = ts; }
  }
  if (found) return found;
  throw new Error('Folder "' + FOLDER + '" Drive me nahi mila aur Stock/Receivable wali koi file bhi nahi — Code.gs me FOLDER theek karo');
}
function isSheetLike_(name, mime) {
  return /\.xlsx?$/i.test(name) || mime === GSHEET || mime === XLSX || /excel|spreadsheet/i.test(mime || '');
}
// Folder me do tarah ki cheez ho sakti hai:
//   (a) seedhi spreadsheet files (Stock Status / Amount Receivable export)  -> kind 'xlsx'
//   (b) Busy auto-backup ke date-time subfolders "2026-09-11 (02 00 PM)" -> <COMPANY>/DATA.ZIP -> kind 'backup'
//       sirf sabse naya backup list hota hai (purane ka koi kaam nahi)
function listFiles_() {
  var root = folder_(), files = root.getFiles(), out = [];
  while (files.hasNext()) {
    var f = files.next(), mt = f.getMimeType(), nm = f.getName();
    if (!isSheetLike_(nm, mt)) continue;
    out.push({ id: f.getId(), name: nm, mime: mt, size: f.getSize(), modified: f.getLastUpdated().toISOString(), kind: 'xlsx' });
  }
  var bk = latestBackup_(root);
  if (bk) out.push(bk);
  out.sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
  return out;
}
// "2026-09-11 (02 00 PM)" -> ms; parse na ho to folder ka lastUpdated
function stampOf_(folder) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) \((\d{1,2}) (\d{2}) (AM|PM)\)/i.exec(folder.getName());
  if (!m) return folder.getLastUpdated().getTime();
  var h = (+m[4] % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], h, +m[5]);
}
function latestBackup_(root) {
  var subs = root.getFolders(), list = [];
  while (subs.hasNext()) { var sf = subs.next(); list.push({ f: sf, t: stampOf_(sf) }); }
  list.sort(function (a, b) { return b.t - a.t; });
  for (var i = 0; i < Math.min(list.length, 3); i++) {   // naya backup adhoora ho sakta hai (upload chal raha) — agla dekho
    var cf = list[i].f.getFoldersByName(COMPANY); if (!cf.hasNext()) continue;
    var zf = cf.next().getFilesByName('DATA.ZIP'); if (!zf.hasNext()) continue;
    var z = zf.next(); if (z.getSize() < 100000) continue;
    return { id: z.getId(), name: list[i].f.getName() + '/' + COMPANY + '/DATA.ZIP', mime: z.getMimeType(), size: z.getSize(), modified: z.getLastUpdated().toISOString(), kind: 'backup', backup: list[i].f.getName() };
  }
  return null;
}
// File -> xlsx bytes. Google Sheet / purana .xls ho to Google Sheet ke raste xlsx export.
function getXlsx_(id) {
  var f = DriveApp.getFileById(id), mime = f.getMimeType(), name = f.getName();
  if (mime === XLSX || (/\.xlsx$/i.test(name) && mime !== GSHEET)) return { name: name, b64: Utilities.base64Encode(f.getBlob().getBytes()) };
  var sheetId = id, temp = null;
  if (mime !== GSHEET) { temp = convertToSheet_(f); sheetId = temp; }
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + sheetId + '/export?mimeType=' + encodeURIComponent(XLSX),
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (temp) { try { DriveApp.getFileById(temp).setTrashed(true); } catch (e) {} }
  if (resp.getResponseCode() >= 300) throw new Error('xlsx export fail: ' + resp.getContentText().slice(0, 200));
  return { name: name.replace(/\.xlsx?$/i, '') + '.xlsx', b64: Utilities.base64Encode(resp.getContent()) };
}
function convertToSheet_(file) {
  var meta = { name: 'tmp_busy_' + file.getName(), mimeType: GSHEET };
  var boundary = 'xxxBOUNDARYxxx';
  var body = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + file.getMimeType() + '\r\n\r\n').getBytes()
    .concat(file.getBlob().getBytes()).concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    { method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: body, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Convert fail: ' + resp.getContentText().slice(0, 200));
  return JSON.parse(resp.getContentText()).id;
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// GET (query params) aur POST (JSON body) dono chalte hain. Server GET use karta hai:
// POST par Google 302 redirect deta hai aur kabhi-kabhi body kho kar doGet chal jaata tha.
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.action) return out_({ ok: true, service: 'michelin-ops-busy-drive' });
  return handle_(p);
}
function doPost(e) {
  var d = {}; try { d = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  return handle_(d);
}
function handle_(d) {
  try {
    if (!d.secret || d.secret !== SECRET) return out_({ ok: false, error: 'bad secret' });
    if (d.action === 'ping') { var f = folder_(); return out_({ ok: true, folder: f.getName(), url: f.getUrl(), count: listFiles_().length }); }
    if (d.action === 'list') return out_({ ok: true, files: listFiles_() });
    // raw: kisi bhi file ke bytes (base64), offset/length se tukdon me (bade DATA.ZIP ke liye)
    if (d.action === 'raw') {
      if (!d.id) return out_({ ok: false, error: 'id missing' });
      // Bytes ko JS me copy karna bhaari hai (12M push) — poora base64 ek baar banao, phir string ka tukda.
      // offset 3 ka multiple hona chahiye (base64 me 3 byte = 4 char); CHUNK 12MB = 3 ka multiple.
      var rf = DriveApp.getFileById(String(d.id)), bytes = rf.getBlob().getBytes(), size = bytes.length;
      var off = Math.max(0, +d.offset || 0); off -= off % 3;
      var len = Math.min(+d.length || CHUNK, CHUNK, size - off); if (off + len < size) len -= len % 3;
      var full = Utilities.base64Encode(bytes);
      var b64 = (off === 0 && len === size) ? full : full.substring(off / 3 * 4, (off + len >= size) ? full.length : (off + len) / 3 * 4);
      return out_({ ok: true, name: rf.getName(), size: size, offset: off, length: len, b64: b64 });
    }
    if (d.action === 'get') { if (!d.id) return out_({ ok: false, error: 'id missing' }); var g = getXlsx_(String(d.id)); return out_({ ok: true, name: g.name, b64: g.b64 }); }
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
