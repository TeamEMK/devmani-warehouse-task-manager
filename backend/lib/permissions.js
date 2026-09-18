// ══════════════════════════════════════════════════════
// PERMISSIONS — main app ka per-user granular page/action access
// ══════════════════════════════════════════════════════
// Model wahi jo Michelin Ops ke ops_users.perms me hai (backend/lib/ops-access.js,
// backend/routes/ops-v4.js ALL_PAGES/ROLE_DEFAULT/defaultPerms/parsePerms) — bas
// main app ke users table par. Har user ke paas granted keys ki ek flat array
// (users.perms, JSON) — khali ho to role ka default use hota hai.
//
// Jaan-boojh kar SIRF "kaun sa page/button dikhta hai" yahan control hota hai.
// Data scope (HOD apne department ka, user apna khud ka) role se hi tay hota hai,
// jaisa pehle se — isko permission se badla nahi jaata.

const PERM_CATALOG = [
  { key: 'alltasks.assign', label: 'Assign Task / Delegate', group: 'All Tasks' },
  { key: 'alltasks.edit', label: 'Edit any task', group: 'All Tasks' },
  { key: 'alltasks.delete', label: 'Delete (single + bulk)', group: 'All Tasks' },
  { key: 'alltasks.bulkEdit', label: 'Bulk Edit', group: 'All Tasks' },
  { key: 'approvals.view', label: 'View Approvals page', group: 'Approvals' },
  { key: 'approvals.transfers', label: 'Transfer Requests', group: 'Approvals' },
  { key: 'approvals.leaveRequests', label: 'Leave Requests', group: 'Approvals' },
  { key: 'approvals.bulkDelete', label: 'Bulk delete tasks', group: 'Approvals' },
  { key: 'mis.view', label: 'View MIS Report', group: 'MIS Report' },
  { key: 'mis.deptFilter', label: 'Department filter', group: 'MIS Report' },
  { key: 'mis.exportPdf', label: 'All-users MIS PDF', group: 'MIS Report' },
  { key: 'weekPlan.manage', label: 'Set Plan (any employee)', group: 'Week Plan' },
  { key: 'fmsAdmin.manage', label: 'Manage FMS Admin', group: 'FMS Admin' },
  { key: 'fmsTasks.manageAnyStep', label: 'Act on any step / create intake', group: 'FMS Tasks' },
  { key: 'claims.manage', label: 'Claim Management System', group: 'Claims' },
];
const ALL_KEYS = PERM_CATALOG.map(p => p.key);
const KEY_SET = new Set(ALL_KEYS);

// Aaj role jo kar sakta hai, wahi default hai — deploy hote hi kisi ka access
// achanak nahi badalta, sirf aage se admin-adjustable ho jaata hai.
const ROLE_DEFAULT = {
  admin: ALL_KEYS,
  // Claims naya module hai — hod ko bhi by default nahi, admin dega jise chahiye.
  hod: ALL_KEYS.filter(k => k !== 'fmsAdmin.manage' && k !== 'claims.manage'),
  pc: ['approvals.view', 'approvals.transfers', 'approvals.bulkDelete', 'weekPlan.manage', 'fmsTasks.manageAnyStep'],
  user: ['alltasks.assign', 'mis.view'],
};
function defaultPerms(role) { return ROLE_DEFAULT[String(role || '').toLowerCase()] || ROLE_DEFAULT.user; }
function parsePerms(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.filter(x => KEY_SET.has(x)) : []; } catch (_) { return []; } }

// user = { role, perms(raw JSON string ya already-parsed array) }
function resolvePerms(user) {
  if (!user) return [];
  if (String(user.role).toLowerCase() === 'admin') return ALL_KEYS;
  const raw = Array.isArray(user.perms) ? user.perms : parsePerms(user.perms);
  return raw.length ? raw : defaultPerms(user.role);
}
function hasPerm(user, key) {
  if (!user) return false;
  if (String(user.role).toLowerCase() === 'admin') return true;
  return resolvePerms(user).includes(key);
}

module.exports = { PERM_CATALOG, ALL_KEYS, ROLE_DEFAULT, defaultPerms, parsePerms, resolvePerms, hasPerm };
