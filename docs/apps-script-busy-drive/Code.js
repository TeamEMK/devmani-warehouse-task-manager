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
   ═══════════════════════════════════════════════════════════════ */
var FOLDER = 'Busy';           // folder ka naam, ya folder ka link / ID
var SECRET = 'CHANGE-ME';      // app ki Busy Import -> Drive settings wala secret

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
  throw new Error('Folder "' + FOLDER + '" Drive me nahi mila — Code.gs me FOLDER theek karo');
}
function isSheetLike_(name, mime) {
  return /\.xlsx?$/i.test(name) || mime === GSHEET || mime === XLSX || /excel|spreadsheet/i.test(mime || '');
}
function listFiles_() {
  var files = folder_().getFiles(), out = [];
  while (files.hasNext()) {
    var f = files.next(), mt = f.getMimeType(), nm = f.getName();
    if (!isSheetLike_(nm, mt)) continue;
    out.push({ id: f.getId(), name: nm, mime: mt, size: f.getSize(), modified: f.getLastUpdated().toISOString() });
  }
  out.sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
  return out;
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
function doGet() { return out_({ ok: true, service: 'michelin-ops-busy-drive' }); }
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents || '{}');
    if (!d.secret || d.secret !== SECRET) return out_({ ok: false, error: 'bad secret' });
    if (d.action === 'ping') { var f = folder_(); return out_({ ok: true, folder: f.getName(), url: f.getUrl(), count: listFiles_().length }); }
    if (d.action === 'list') return out_({ ok: true, files: listFiles_() });
    if (d.action === 'get') { if (!d.id) return out_({ ok: false, error: 'id missing' }); var g = getXlsx_(String(d.id)); return out_({ ok: true, name: g.name, b64: g.b64 }); }
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
