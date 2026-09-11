# Busy se data fetch — kaise hota hai, kaise automatic hoga

> Michelin Ops module (`/ops`) ke liye. Busy Accounting Software (Bansal Oil ka billing) se do cheezein app me aati hain:
> **item-wise stock** aur **dealer-wise outstanding**. Ye document batata hai ki abhi ye kaise hota hai,
> Busy me export kahan se nikalta hai, app kya karta hai, aur ise bina haath lagaye (automatic) karne ke
> kaun-kaun se raste hain.

Last updated: 11-Sep-2026

---

## 1. Ek nazar me

```
 Busy (office PC)                        App (devmanierp.com/ops)
 +---------------------+   .xlsx file    +------------------------------+
 | Display -> Stock    | --------------> | Stock page -> "Busy Import"  |
 |   Status  (ALT+E)   |                 |   POST /api/ops/importBusy   |
 | Display -> Amount   | --------------> |  - ops_items.stock update    |
 |   Receivable (ALT+E)|                 |  - ops_outstanding replace   |
 +---------------------+                 |  - payment detect -> WhatsApp|
                                         |  - ops_import_log me report  |
                                         +------------------------------+
```

| Busy report | App me kya update hota hai | Match kis se hota hai |
|---|---|---|
| **Stock Status** (item-wise closing qty) | `ops_items.stock` + `ops_stock_log` (type `BUSY`) | Item ka **Busy Name** (`ops_items.busy_name`) |
| **Amount Receivable** (party-wise balance) | `ops_outstanding` (poora snapshot replace) + `ops_payment_log` | Dealer ka **Busy Name** (`ops_dealers.busy_name`), nahi to dealer ka naam |

> **11-Sep-2026 se LIVE: Busy ke Drive backup se automatic import (Section 0).** Busy PC ka auto-backup (din me 3 baar: ~10 AM, ~2 PM, ~6:45 PM) Devmaniwarehouses@gmail.com ke Drive folder me jaata hai. App har 30 min wahan se naya backup uthata hai, Busy ki database khud padhta hai aur stock + outstanding update karta hai — koi export/upload nahi. Neeche ka manual upload ab backup rasta hai.

## 0. Drive backup se automatic import (chal raha hai)

```
 Busy PC --auto backup--> Drive "BusyBackUp_WIN-DHLNE3"/<date time>/COMPBOD/DATA.ZIP
                                   ^ Apps Script web app (list / raw)   <-- App har 30 min (backend/lib/busy-drive.js)
                          DATA.ZIP -> db1<FY>.bds (Access) -> mdb-reader (backend/lib/busy-db.js)
                          -> stock rows + outstanding rows -> wahi importStock / importOutstanding
```

**Kaise kaam karta hai**
- Drive folder (`1WhOsHzNDg80lfJAMWlivjzPb1LOaOR3d`) me Busy ke backup subfolders `2026-09-11 (02 00 PM)` jaise naam se aate hain; har ek me company folder (`COMPBOD` = Bansal Oil Distributors) me `DATA.ZIP` (~25MB). Apps Script (`docs/apps-script-busy-drive/Code.js`, Devmaniwarehouses account me deployed) `list` me sabse naya backup deta hai aur `raw` se file 12MB ke tukdon me.
- App ZIP me se sirf `db1<FY>.bds` (sabse naya saal, jaise db12026.bds = FY 2026-27) nikaalta hai aur `mdb-reader` (Access reader, npm) se padhta hai. Formula (Busy ke data par verify: trial balance 0, 155 items par DailySum se match):
  - **stock(item)** = `Folio1.D1` (opening qty) + Σ `Tran2` lines RecType 2 `Value1` (qty; sale negative). Sirf item group **Tyre** (aur uske sub-groups, jaise AUTO MARKET) ke items.
  - **outstanding(party)** = −(`Folio1.D1` (opening, Dr negative) + Σ `Tran2` lines RecType 1 `Value1`). Sirf **Sundry Debtors** group ke accounts, 0 wale chhod kar (Cr balance = negative = advance).
  - `Master1`: MasterType 2 = account, 6 = item, 1 = account group, 5 = item group.
- Ye rows `importStock` / `importOutstanding` me jaati hain — matching (Busy Name), stock log, outstanding replace, payment detection + WhatsApp, `ops_import_log` (file naam `Drive backup 11-09-2026 02:00 PM (COMPBOD)`) sab pehle jaisa. Stock rows me Busy ke wahi tyre items jinka stock ≠ 0 ya jo app me hain; baaki "Busy tyre items jo app me nahi" notes me.
- Same backup dobara import nahi hota (file id + modified `app_settings` → `busyDrive.state` me). `/api/ops/cron?key=...` par bhi chalta hai.
- Folder me seedhi `.xlsx` (Stock Status / Amount Receivable export) rakh do to wo bhi pehle jaisa import ho jaati hai.

**Setup (ho chuka 11-Sep-2026)**
- Apps Script project "Michelin Ops - Busy Drive Bridge" Devmaniwarehouses@gmail.com me (clasp se push/deploy; local clasp project scratchpad me). Code me `FOLDER` = folder id, `COMPANY = 'COMPBOD'`, `SECRET` app ki settings wala. Code badle to `clasp push -f` + `clasp redeploy <deploymentId>` (naya `deploy` = naya URL).
- App me: Stock/Reports → Busy Import → "Drive se auto-import" → Settings: web app URL + secret, "Auto-import chalu" → Save → Test connection (folder + latest backup dikhna chahiye) → Abhi sync karo.

**Dhyan**: sync me jo dealer balance pichle snapshot se kam mila wo "payment" maana jaata hai → dealer + DSR ko WhatsApp. Lambe gap ke baad (ya pehli baar) **"Sync bina WhatsApp"** button use karo — payments log me aati hain par message nahi jaata. (Prod par pehla sync 11-Sep-2026 17:17 isi tarah hua: 21 items, 66 accounts, 11 payments muted; uske baad auto on.)
Sync 1-3 min leta hai aur background me chalta hai (hosting proxy 60s par request kaat deta hai) — UI har 5 sec status poll karta hai; Apps Script ko GET query-params se call kiya jaata hai (POST par Google ka redirect kabhi body kho deta tha).

Busy khud koi public API nahi deta (busy.in ka FAQ bhi yahi kehta hai: "API integration option hai, par third-party application chahiye, channel partner se lo"). Isliye data nikalne ke teen hi practical raste hain:

1. **Report export (.xlsx) -> app me upload** — *abhi yahi chal raha hai* (Section 2–5)
2. **Uploader script Busy wale PC par** — export folder me file aate hi apne aap app me chali jaye (Section 6, Option A) — **recommended next step**
3. **Busy ki SQL database seedhe padhna** ya **paid third-party API** — bilkul haath-free, par setup bhaari (Section 6, Option B/C)

---

## 2. Busy me export kaise karein (operator ke liye)

Busy ka har report `ALT+E` (Export) se Excel me nikal jata hai. Dono report roz (ya jab bhi billing/payment entry ho jaye) nikalni hain.

### 2.1 Stock Status

1. Busy kholo -> sahi **company** aur **financial year** chuno.
2. Menu: **Display -> Inventory Reports -> Stock Status** (kuch versions me *Display -> Stock Status -> Item Wise*).
3. Date: **As On = aaj**. Item group: **All Items** (sirf tyre group bhi chalega, tube rows app khud skip karta hai).
4. Report screen par aane ke baad **ALT+E** -> format **Excel (.xlsx)** -> OK.
5. File ka naam kuch bhi ho sakta hai, par pehchan ke liye rakho: `StockStatus_DD-MM-YYYY.xlsx`.

App ko file me ye chahiye:
- Pehli 15 rows me kahin "**Stock Status**" (ya "Stock Summary" / "Item Wise Stock") likha ho — isi se app pehchanta hai ki ye stock file hai.
- Ek row jiske **column A me "Item Details"** ho — iske neeche har row = `[item ka naam, qty]`.
- "As On : DD-MM-YYYY" kahin likha ho to wahi date log me jaati hai, nahi to aaj ki.

### 2.2 Amount Receivable (outstanding)

1. Menu: **Display -> Outstanding Analysis -> Amount Receivable** (kuch versions me *Bills Receivable -> Party Wise* / *Sundry Debtors*).
2. Date: **As On = aaj**. Party group: **Sundry Debtors / All**.
3. **ALT+E** -> **Excel (.xlsx)** -> OK.
4. Naam: `AmountReceivable_DD-MM-YYYY.xlsx`.

App ko file me ye chahiye:
- Header me "**Amount Receivable**" / "Outstanding" / "Receivables" / "Sundry Debtors" / "Party Wise" me se kuch bhi.
- Ek header row jisme **"Account"** (ya Party / Party Name / Name / Customer / Dealer) column ho, aur usi row me **Balance / Amount / Outstanding / Closing / Due / Dr** jaisa balance column.
- Header na mile to app pehla text column = naam, aur us row ka pehla number = balance maan leta hai.
- `1,23,456.00 Dr`, `(12,000)`, `-12000` sab samajh me aata hai. **Cr = negative** (dealer ka advance).

> Dhyan: Busy me export ke waqt "**Export with formatting / Show Totals**" jaisa option ho to **totals off** rakho. "Total" / "Grand Total" rows app skip to karta hai, par merged headers kabhi-kabhi column hila dete hain.

---

## 3. App me upload (admin)

1. `/ops` me admin login -> **Stock** page -> upar **"Busy Import"** (ya **Reports -> Busy Import -> "Nayi file import"**).
2. **File type**: "Auto pehchano" rehne do. Agar app "SKIP: file pehchani nahi" bole to yahan **Stock Status** ya **Outstanding** chun kar wahi file dobara upload karo.
3. File chuno -> upload apne aap shuru. Result usi sheet me dikhta hai, aur **Reports -> Busy Import** tab me poori history (pichle 50 imports).

Result ki lines ka matlab:

| Result | Matlab |
|---|---|
| `STOCK: 37 items updated` | 37 items ka stock badla. Jinka stock same tha wo count me nahi. |
| `OUTSTANDING: 112 accounts, as on 08-09-2026, 3 payment(s) detected` | 112 party ka snapshot save hua; 3 dealers ka balance pichli baar se kam hua -> payment log + WhatsApp |
| `SKIP: file pehchani nahi ...` | Header me report ka naam nahi mila -> File type chun kar dobara |
| `ERROR: ...` | File padh hi nahi paye (.xls purana format? password? corrupt?) — Busy se **.xlsx** me dobara export karo |

**Notes / Unmatched column** (amber):
- Stock file: `90/90-12 CITY EXTRA TL (14)` jaise naam = ye Busy item app ke kisi item se match nahi hua (qty bracket me). Fix: Section 4.
- Outstanding file: `Dealers jinka Busy naam match nahi hua: ...` = app ke ye dealers Busy ki list me nahi mile.

---

## 4. Matching — "Busy Name" kyon zaroori hai

Busy me naam aur app me naam alag hote hain, isliye dono jagah ek **Busy Name** field hai. App compare hamesha **UPPER-CASE + single space** me karta hai, to spacing/case ka farak nahi padta, par spelling bilkul same honi chahiye.

### Items (`ops_items.busy_name`)
- Sheet import ke waqt bana tha: `size + ' ' + pattern + ' ' + tltt` (jaise `90/90-12 CITY EXTRA TL`).
- Busy me item ka naam isse alag ho (jaise `MICHELIN 90/90-12 CITY EXTRA TL 54J`) to DB me update karo:
  ```sql
  UPDATE ops_items SET busy_name='MICHELIN 90/90-12 CITY EXTRA TL 54J' WHERE code='MI-0042';
  ```
  (Abhi items ke liye UI me Busy Name edit nahi hai — phpMyAdmin / SQL se. Zaroorat ho to Stock page par edit jod denge.)
- Sabse aasan tareeka: ek baar Stock Status import karo -> **Notes me jo unmatched naam aaye, wahi exact string** item ke `busy_name` me daal do.
- Jin items ka `busy_name` khali hai, unhe Busy import kabhi nahi chhuega.

### Dealers (`ops_dealers.busy_name`)
- **Dealers page -> Edit -> "Busy Name"** me Busy ki Amount Receivable wali party ka exact naam daalo.
- Busy Name khali ho to app dealer ke naam se try karta hai (bracket wala hissa hata kar bhi, jaise `RAM TYRES (JAIPUR)` -> `RAM TYRES`).
- Dealer list me jinka Busy naam set nahi, unke saamne amber me "Busy naam set nahi" dikhta hai.
- Match hone par hi: Dealers page par outstanding dikhega, credit-limit exposure me Busy outstanding judega, aur payment aane par WhatsApp jayega.

---

## 5. Import ke baad app me kya-kya hota hai

**Stock file:**
- Har matched item jiska qty badla: `ops_items.stock = qty`, `updated_at = NOW()`.
- `ops_stock_log` me ek row: type `BUSY`, prev/after stock, note `Busy Stock Status as on <date>`, by `Busy Import`.
- Stock page par low-stock (< 10) waise hi dikhega.

**Outstanding file:**
- `ops_outstanding` **poora delete karke** nayi list insert (source `Busy`, `as_on` = report ki date).
- Purane snapshot se compare: kisi dealer ka naya balance **purane se Rs 1 se zyada kam** -> `ops_payment_log` me entry (`notified='N'`).
- Import ke turant baad `scanPayments()` chalta hai (aur har 5 min cron bhi): dealer + us dealer ke DSR ko Wati template `PAYMENT` par WhatsApp, phir `notified='Y'`.
- Reports -> **Busy Outstanding** tab aur Home ka "Busy outstanding" tile isi table se.

**Har import** (success/skip/error) `ops_import_log` me: file naam, result, notes.

---

## 6. Automatic kaise karein — options

### Option A — Uploader script Busy wale PC par (recommended)

**Idea:** Busy operator sirf export karke file ek fixed folder me save kare (jaise `C:\BusyExport\`). Us PC par ek chhota Node script folder dekhta rahe; nayi `.xlsx` aate hi app ke `/api/ops/importBusy` par bhej de aur file ko `Imported\` me move kar de. Bilkul waisa jaisa purane Sheet system me Drive folder + Apps Script (har 15 min) karta tha — bas ab Drive ki jagah seedha app.

**Kya chahiye:**
1. Busy PC par Node 20 (ek baar install).
2. App me ek **server-to-server auth** — abhi `/importBusy` sirf login cookie/JWT se chalta hai. Do raste:
   - *(Aasan, ~1 ghanta)* `.env` me `BUSY_IMPORT_SECRET` jodo; route me `requireOps, adminOnly` ke saath ek check: agar header `x-busy-secret` env se match kare to bina login ke allow. Isi tarah `/cron` me `CRON_SECRET` pehle se hai.
   - *(Bina code change)* Admin user ka JWT `Authorization: Bearer <token>` header me — `requireOps` ye bhi maanta hai. Par token expire hoga, isliye secret wala tareeka behtar.
3. Script (khaka — asli file `data/scripts/busy-uploader.js` naam se banegi):
   ```js
   // Busy PC par: node busy-uploader.js   (Task Scheduler se logon par auto-start)
   const fs = require('fs'), path = require('path');
   const DIR = 'C:\\BusyExport', DONE = path.join(DIR, 'Imported');
   const APP = 'https://devmanierp.com/api/ops/importBusy', SECRET = process.env.BUSY_IMPORT_SECRET;
   async function tick() {
     for (const f of fs.readdirSync(DIR)) {
       if (!/\.xlsx$/i.test(f)) continue;
       const full = path.join(DIR, f);
       const b64 = fs.readFileSync(full).toString('base64');
       const kind = /stock/i.test(f) ? 'STOCK' : /receiv|outstand/i.test(f) ? 'OUT' : '';
       const r = await fetch(APP, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-busy-secret': SECRET },
         body: JSON.stringify({ arg: JSON.stringify({ name: f, b64, kind }) }) }).then(x => x.json());
       console.log(new Date().toISOString(), f, r.result || r.error);
       fs.renameSync(full, path.join(DONE, new Date().toISOString().slice(0, 16).replace(/\D/g, '') + '_' + f));
     }
   }
   setInterval(() => tick().catch(e => console.error(e.message)), 60 * 1000); tick();
   ```
   File ke naam me `Stock` ya `Receivable` ho to kind seedha set ho jata hai — auto-detect par bharosa nahi rehta.
4. Busy me export path default `C:\BusyExport` kar do (export dialog path yaad rakhta hai), taaki operator ko sirf `ALT+E -> OK` karna pade.

**Fayda:** Aadha din ka kaam, Busy ke andar kuch nahi chhedna, app ka import logic same (result bhi Reports me waise hi dikhega).
**Kami:** Export ab bhi insaan karega (roz 2 baar `ALT+E`). Busy me built-in scheduler nahi hai (busy.in FAQ me sirf manual export hai).

### Option B — Busy ki database seedhe padhna (poora automatic)

Busy apna data **MS SQL Server** me rakhta hai (SQL mode) ya purane setups me **MS Access .mdb** (Access mode). Har company ka apna folder/database hota hai (`db.dbs` file wale folder ke naam se company pehchani jaati hai). Busy PC (ya usi LAN par koi PC) par ek Node script:

1. SQL Server se **read-only login** se connect kare (`mssql` npm package; Access ho to ODBC).
2. Item-wise closing stock aur party-wise closing balance khud compute kare (vouchers jod kar) **ya** Busy ki apni summary tables padhe.
3. Result JSON app ke ek naye endpoint (jaise `/api/ops/busySync`) par bhej de — ya wahi `importBusy` par ek xlsx bana kar.
4. Windows Task Scheduler se har 15 min chale.

**Pehle ye confirm karna padega (Busy PC par jaake):**
- Busy version (21 / 21 Rel 9+ ...) aur **SQL mode hai ya Access** — *Busy -> Administration -> Configuration / Company info* me server details.
- SQL Server ka naam, company database ka naam, ek read-only user.
- Tables ka structure: Busy ka schema documented nahi hai. Community me `Master1` (accounts/items masters, `MasterType` se alag), `Tran1` / `Tran2` (voucher header/body) jaise naam milte hain — **SQL Server Management Studio me kholkar verify karna hoga**, versions me farak hota hai.
- Busy ke channel partner se ek baar pooch lo ki DB seedha padhna support/warranty ke against to nahi.

**Fayda:** Koi insaan nahi chahiye, 15 min me fresh data, chahein to invoice/voucher level data bhi (order ka Busy invoice no. auto-match, bill-wise ageing).
**Kami:** 2–4 din ka kaam + schema reverse-engineer; Busy update pe toot sakta hai; office PC/SQL hamesha on aur reachable chahiye.

### Option C — Third-party API (paid)

Kuch vendors Busy PC par apna agent install karke REST API dete hain — jaise **BusyNotify** (ledger, outstanding, bills; Busy 17/18/21), **RootFi** (unified accounting API). App ka cron unki API call karke `ops_outstanding` / `ops_items.stock` bhar de.

**Fayda:** Schema ka sar-dard unka, hamara sirf ek fetch + map.
**Kami:** Monthly cost; Busy ka poora data unke server se hokar jata hai; stock endpoint hai ya nahi vendor-wise check karna hoga.

### Option D — Busy XML export

*Administration -> Data Export Import -> XML* voucher-level export deta hai (sale/receipt vouchers). Stock Status / outstanding jaise summary report isse nahi milte, aur ye bhi manual hai — humare use ke liye nahi.

---

## 7. Recommendation

| Phase | Kya | Kab / kitna kaam |
|---|---|---|
| 1 | Manual: Busy `ALT+E` -> app me upload. Dealers/items ke Busy Name theek karo taaki unmatched zero ho. | Backup rasta |
| 2 (LIVE 11-Sep-2026) | **Section 0**: Busy ka Drive auto-backup + Apps Script web app; app har 30 min backup padh kar khud import kare. Operator ko kuch nahi karna. | Ho gaya |
| 3 (agar chahiye) | **Option B**: SQL se seedha, tab jab Busy PC par SQL mode confirm ho aur invoice-level data bhi chahiye ho. | 2–4 din, Busy partner se baat ke baad |

Phase 2 se pehle Busy PC se ye info le aao — isi se Phase 3 ka faisla hoga:

- [ ] Busy version + release number
- [ ] SQL mode ya Access mode; SQL ho to server/instance naam
- [ ] Company ka naam jaise Busy me hai (aur data folder ka path)
- [ ] Kya PC hamesha on rehta hai, internet hai
- [ ] Busy partner ka contact (DB access / customization ke liye)

---

## 8. Reference — app ka import API

`POST /api/ops/importBusy` (admin login zaroori; body app ke baaki RPC jaisa `{ "arg": "<json string>" }`)

```json
{ "name": "StockStatus_08-09-2026.xlsx", "b64": "<xlsx ka base64>", "kind": "" }
```
- `kind`: `""` (auto), `"STOCK"`, `"OUT"`
- Response: `{ "ok": true, "result": "STOCK: 37 items updated", "notes": "...unmatched..." }`

`POST /api/ops/getImportLog` -> pichle 50 imports. `POST /api/ops/getPaymentLog` -> payment detections.

Code: `backend/lib/ops-busy.js` (parse + import logic), `backend/routes/ops.js` (`importBusy`, `scanPayments`), `backend/lib/xlsx.js` (bina package ka xlsx reader — sirf `.xlsx`, purana `.xls` nahi chalta).

---

## Sources

- BUSY FAQ — third-party integration: https://busy.in/faqs/third-party-services/integration/1/
- BUSY FAQ — export/import data (ALT+E, XML): https://busy.in/faqs/how-do-i-importexport-data-in-busy-answerid-67737/
- BUSY FAQ — company data folder / db.dbs: https://busy.in/faqs/data-specific/company-access/2/
- Busy SQL backup (SQL mode): https://knowledgebase.bison.co.in/view_article.php?id=99
- BusyNotify APIs: https://busynotify.in/solutions/custom-apis
- RootFi Busy integration: https://www.rootfi.dev/integrations/busy-accounting
