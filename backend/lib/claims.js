// ══════════════════════════════════════════════════════
// CLAIMS — tyre warranty claim workflow (port from Google Apps Script "AREA SHEETS")
// ══════════════════════════════════════════════════════
// Purane system me har status ek alag Google Sheet tha aur row status badalte
// hi doosri sheet me "move" ho jaata tha — beech ka history kho jaata tha.
// Yahan ek hi `claims` row rehta hai, sirf `status` badalta hai; har badlaav
// `claim_status_log` me likha jaata hai (audit trail jo purane system me nahi tha).

const CLAIM_PREFIX = 'WJFH00';
function formatClaimNo(n) { return CLAIM_PREFIX + String(n || '').trim(); }

// Entry type (Claim Entry form) -> initial status
const ENTRY_INITIAL_STATUS = {
  NEW_CLAIM: 'INSPECTION',
  WITHOUT_ONLINE: 'WITHOUT_ONLINE',
  RETURN_DEALER: 'RETURN_BY_DEALER',
  NO_DATA_TYRE: 'NO_DATA_TYRE',
};

// Purane "map" object (AREA SHEETS updateStatus/updateBulkStatus) ka wahi transitions,
// bas naam canonical (UPPER_SNAKE) status keys me. Value = agla status.
const STATUS_TRANSITIONS = {
  INSPECTION: { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', RESUBMITTED: 'RESUBMITTED' },
  ACCEPTED: { FG_KUNDLI: 'FG_KUNDLI', PLANT: 'PLANT' },
  REJECTED: { HOLD: 'HOLD', SEND_BACK_TO_DEALER: 'SEND_BACK_TO_DEALER' },
  HOLD: { RESUBMITTED: 'RESUBMITTED', SEND_BACK_TO_DEALER: 'SEND_BACK_TO_DEALER' },
  RESUBMITTED: { ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' },
  RETURN_BY_DEALER: { RESUBMITTED: 'RESUBMITTED', SEND_BACK_TO_DEALER: 'SEND_BACK_TO_DEALER', HOLD: 'HOLD' },
  SEND_BACK_TO_DEALER: { REJECTED_DISPATCHED: 'REJECTED_DISPATCHED' },
  FG_KUNDLI: { DONE: 'DONE' },
  PLANT: { DONE: 'DONE' },
};

// Remark-only areas (purane "remarkAreas") — status khud nahi badalta, sirf ek
// note save hota hai. WITHOUT_ONLINE / NO_DATA_TYRE.
const REMARK_STATUSES = ['WITHOUT_ONLINE', 'NO_DATA_TYRE'];
// Read-only areas (purane "readOnlyAreas") — koi action nahi.
const READONLY_STATUSES = ['REJECTED_DISPATCHED', 'WITHOUT_ONLINE', 'NO_DATA_TYRE'];

// Dashboard card order (purane "keys" array), label + count-key ke liye.
const STATUS_CARDS = [
  { key: 'INSPECTION', label: 'Inspection' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'HOLD', label: 'Hold' },
  { key: 'RESUBMITTED', label: 'Resubmitted' },
  { key: 'WITHOUT_ONLINE', label: 'Without Online' },
  { key: 'RETURN_BY_DEALER', label: 'Return By Dealer' },
  { key: 'SEND_BACK_TO_DEALER', label: 'Send Back To Dealer' },
  { key: 'NO_DATA_TYRE', label: 'No Data Tyre' },
  { key: 'REJECTED_DISPATCHED', label: 'Rejected Dispatched' },
  { key: 'FG_KUNDLI', label: 'FG-Kundli' },
  { key: 'PLANT', label: 'Plant' },
];

function nextStatusesFor(status) { return Object.keys(STATUS_TRANSITIONS[status] || {}); }

// Dashboard ke liye — Dashboard/Bulk action buttons ke labels + colors (purane
// "actionMap" jaisa hi), aur read-only/remark-only areas — sab ek jagah, frontend
// GET /api/claims/meta se fetch karta hai (koi duplicate catalog nahi rakhna padta).
const STATUS_LABELS = {
  INSPECTION: 'Inspection', ACCEPTED: 'Accepted', REJECTED: 'Rejected', HOLD: 'Hold',
  RESUBMITTED: 'Resubmitted', WITHOUT_ONLINE: 'Without Online', RETURN_BY_DEALER: 'Return By Dealer',
  SEND_BACK_TO_DEALER: 'Send Back To Dealer', NO_DATA_TYRE: 'No Data Tyre',
  REJECTED_DISPATCHED: 'Rejected Dispatched', FG_KUNDLI: 'FG-Kundli', PLANT: 'Plant', DONE: 'Done',
};
const STATUS_COLOR = {
  ACCEPTED: 'green', REJECTED: 'red', HOLD: 'yellow', RESUBMITTED: 'purple',
  SEND_BACK_TO_DEALER: 'pink', FG_KUNDLI: 'cyan', PLANT: 'orange',
  REJECTED_DISPATCHED: 'gray', DONE: 'green',
};

// Ek claim ka status badlo — validate karke, log likh kar. db = mysql pool/connection.
async function applyStatusChange(db, claimId, newStatus, userId, note) {
  const [[claim]] = await db.query('SELECT id, status FROM claims WHERE id=?', [claimId]);
  if (!claim) throw new Error('Claim not found');
  const allowed = STATUS_TRANSITIONS[claim.status] || {};
  if (!allowed[newStatus]) throw new Error(`${claim.status} se ${newStatus} par nahi ja sakte`);
  const finalStatus = allowed[newStatus];
  await db.query('UPDATE claims SET status=? WHERE id=?', [finalStatus, claimId]);
  await db.query('INSERT INTO claim_status_log (claim_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?)',
    [claimId, claim.status, finalStatus, String(note || '').slice(0, 300), userId || null]);
  return finalStatus;
}

module.exports = {
  CLAIM_PREFIX, formatClaimNo, ENTRY_INITIAL_STATUS, STATUS_TRANSITIONS,
  REMARK_STATUSES, READONLY_STATUSES, STATUS_CARDS, STATUS_LABELS, STATUS_COLOR,
  nextStatusesFor, applyStatusChange,
};
