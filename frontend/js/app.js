// ══════════════════════════════════════════════════════
// TASK MANAGER — app
// ══════════════════════════════════════════════════════
// Ye pehle app.html ke andar do <script> blocks me tha. Dono adjacent the,
// isliye jodne se execution ka kram nahi badla.
//
// Theme set karne wali chhoti script app.html me hi rehti hai — use paint se
// PEHLE chalna hota hai, warna page ek pal ke liye galat theme me dikhta hai.
//
// Neeche kuch hisse marker comments ke beech hain; "New Client Copy" unhe
// client ki copy se poora nikaal deta hai (wo tool client ko nahi jaata).
// Un markers ko hataana mat.

// ══════════════════════════════════════════════════════
// DELEGATE BY ME — modal jisme login user ne jo tasks doosron ko delegate kiye un ki list dikhti hai
// ══════════════════════════════════════════════════════
let _dbmTasks = [];
let _dbmStatusFilter = 'pending';

async function openDelegateByMeModal() {
  _dbmStatusFilter = 'pending';
  document.querySelectorAll('#delegateByMeModal .tab').forEach(t => t.classList.remove('active'));
  document.getElementById('dbmTabPending').classList.add('active');
  const searchEl = document.getElementById('dbmSearch');
  if (searchEl) searchEl.value = '';
  document.getElementById('delegateByMeModal').classList.add('open');
  document.getElementById('dbmContent').innerHTML = '<div class="empty">Loading…</div>';

  // Sirf delegation tasks fetch karte hain (checklist self-assign hota hai mostly)
  const data = await api('/api/tasks?type=delegation&mine=1');
  let tasks = [];
  if (data.grouped) {
    data.grouped.forEach(g => g.tasks.forEach(t => tasks.push(t)));
  } else {
    tasks = data.tasks || [];
  }
  // Sirf woh tasks jinhe MAINE assign kiya hai (mtlb assigned_by === ME.id) — server bhi filter karta hai but double check
  _dbmTasks = tasks.filter(t => String(t.assigned_by) === String(ME.id));
  renderDbmTable();
}

function filterDbmStatus(status, el) {
  _dbmStatusFilter = status;
  document.querySelectorAll('#delegateByMeModal .tab-group .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderDbmTable();
}

function renderDbmTable() {
  const search = (document.getElementById('dbmSearch')?.value || '').toLowerCase();
  const filtered = _dbmTasks.filter(t => {
    const matchStatus = _dbmStatusFilter === 'all' || t.status === _dbmStatusFilter;
    const matchSearch = !search ||
      (t.description||'').toLowerCase().includes(search) ||
      (t.assignedToName||'').toLowerCase().includes(search) ||
      (t.due_date||'').includes(search) ||
      (t.remarks||'').toLowerCase().includes(search);
    return matchStatus && matchSearch;
  });

  if (!filtered.length) {
    document.getElementById('dbmContent').innerHTML =
      `<div class="empty" style="padding:30px;text-align:center;color:var(--muted-foreground)">
        ${_dbmStatusFilter === 'pending' ? 'You have not delegated any pending tasks yet' : 'None of your delegated tasks are completed yet'}
      </div>`;
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const rows = filtered.map(t => {
    const isOverdue = t.status === 'pending' && t.due_date && t.due_date < today;
    return `<tr>
      <td style="font-size:13px">${t.description||'—'}</td>
      <td style="white-space:nowrap;font-size:13px">${t.assignedToName||'—'}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted-foreground)">${fmtDate(t.assigned_on||'')||'—'}</td>
      <td style="white-space:nowrap;font-size:12px">${fmtDate(t.due_date||'')||'—'}${isOverdue?' <span style="color:var(--destructive);font-weight:600;font-size:10px">⏰ Overdue</span>':''}</td>
      <td style="font-size:12px;color:var(--muted-foreground)">${t.remarks||'—'}</td>
      <td><span class="status-badge ${t.status}">${t.status==='revised'?'Revision':t.status.charAt(0).toUpperCase()+t.status.slice(1)}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('dbmContent').innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--card)">
      <div style="overflow-x:auto">
        <table style="width:100%;min-width:680px">
          <thead>
            <tr>
              <th>Task</th><th>Assigned To</th><th>Assigned On</th><th>Due Date</th><th>Remarks</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="padding:8px 12px;background:var(--muted);border-top:1px solid var(--muted);font-size:12px;color:var(--muted-foreground)">
        Total: <strong>${filtered.length}</strong> task(s) delegated by you
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════
// THEME (light / dark)
// ══════════════════════════════════════════════════════
// Sab rang CSS variables se aate hain, isliye theme badalne par
// poora UI apne aap badal jaata hai. Charts canvas hain — unhe
// variables nahi milte, isliye value padh kar dubara draw karte hain.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback || 'var(--muted-foreground)';
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
function applyChartTheme() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color            = cssVar('--muted-foreground', '#737373');
  Chart.defaults.borderColor      = cssVar('--border', '#e5e5e5');
  Chart.defaults.font.family      = "'Inter',system-ui,sans-serif";
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--popover', '#fff');
  Chart.defaults.plugins.tooltip.titleColor      = cssVar('--popover-foreground', '#0a0a0a');
  Chart.defaults.plugins.tooltip.bodyColor       = cssVar('--popover-foreground', '#0a0a0a');
  Chart.defaults.plugins.tooltip.borderColor     = cssVar('--border', '#e5e5e5');
  Chart.defaults.plugins.tooltip.borderWidth     = 1;
  Chart.defaults.plugins.tooltip.padding         = 10;
  Chart.defaults.plugins.tooltip.cornerRadius    = 8;
  Chart.defaults.plugins.tooltip.displayColors   = true;
  Chart.defaults.plugins.tooltip.boxPadding      = 4;
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('tm-theme', next); } catch (e) {}
  applyChartTheme();
  // Charts canvas par bane hote hain — theme ke naye rang lene ke liye redraw
  if (typeof dashChartInst !== 'undefined' && dashChartInst) {
    try { loadDashboard(); } catch (e) {}
  }
}
applyChartTheme();

// ══════════════════════════════════════════════════════
// SIDEBAR PIN
// ══════════════════════════════════════════════════════
// Pin lagne par sidebar khula rehta hai aur content utna hi right shift
// rehta hai — hover ki zaroorat nahi. Choice yaad rehti hai.
// Class <html> par lagti hai (head ke script se), isliye load par flash nahi hota.
function applySidebarPin(pinned) {
  document.documentElement.classList.toggle('sidebar-pinned', pinned);
  const btn = document.getElementById('sidebarPin');
  if (btn) {
    btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    btn.title = pinned ? 'Unpin sidebar' : 'Keep sidebar open';
  }
}
function toggleSidebarPin() {
  const pinned = !document.documentElement.classList.contains('sidebar-pinned');
  applySidebarPin(pinned);
  try { localStorage.setItem('tm-sidebar-pinned', pinned ? '1' : '0'); } catch (e) {}
}
// Head me class already lag chuki hai — yahan sirf button ka label/state sync karo
applySidebarPin(document.documentElement.classList.contains('sidebar-pinned'));

// Admin / HOD / PC sabka FMS dekhte hain, isliye inke liye FMS UI hamesha on
// rehta hai — chahe wo khud kisi step ke doer na hon.
function isFmsManager() {
  return !!ME && (ME.role === 'admin' || ME.role === 'hod' || ME.role === 'pc');
}

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
let ME = null;
let dashType = 'all';
// Kaunsa overview card chuna hua hai — neeche wali table isi ki list dikhati hai
let dashCard = 'pending';
let tasksType = 'delegation';
let dashChartInst = null;

// ══════════════════════════════════════════════════════
// OFFICE / FACTORY SEGMENT (admin ka current view)
// ══════════════════════════════════════════════════════
// Toggle UI hata di gayi hai — app hamesha office view me chalti hai. Purane
// browsers me 'factory' localStorage me pada ho sakta hai, isliye usse padhte
// nahi, hardcode 'office' rakhte hain (warna wapas switch karne ka koi zariya
// nahi bachta). segQuery/withSeg waise hi kaam karte rehte hain.
let SEGMENT = 'office';
localStorage.removeItem('staffSegment');
// segment sirf admin ke liye — baaki roles apne normal scope me hi rehte hain
function segQuery() { return (ME && ME.role === 'admin') ? `segment=${SEGMENT}` : ''; }
// URL me segment param jodo (jab admin ho)
function withSeg(url) {
  const q = segQuery();
  if (!q) return url;
  return url + (url.includes('?') ? '&' : '?') + q;
}
let holidays = JSON.parse(localStorage.getItem('tm_holidays') || '[]');
let transferMode = false;
let pendingTransferTaskIds = []; // task IDs that already have pending transfer
// Dashboard date sort: 0=default(API order), 1=asc(oldest first), 2=desc(newest first)
let _dashDateSortState = 0;

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
async function init() {
  try {
    const token = localStorage.getItem('authToken');
    const headers = {'Content-Type': 'application/json'};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch('/api/me', { credentials: 'include', headers });
    if (!r.ok) {
      localStorage.removeItem('authToken');
      window.location.replace('/');
      return;
    }
    ME = await r.json();
    if (!ME || !ME.id) { window.location.replace('/'); return; }
    const initials = ME.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    document.getElementById('sidebarName').textContent = ME.name;
    const roleLabel = ME.role==='admin' ? '👑 Admin' : ME.role==='hod' ? '🏢 HOD' : ME.role==='pc' ? '🖥️ PC' : '👤 Employee';
    document.getElementById('sidebarRole').textContent = roleLabel;
    document.getElementById('pName').value = ME.name;
    document.getElementById('pEmail').value = ME.email;
    document.getElementById('pNotifEmail').value = ME.notification_email || '';
    document.getElementById('pPhone').value = ME.phone || '';
    document.getElementById('profileNameDisplay').textContent = ME.name;
    document.getElementById('profileRoleDisplay').textContent = roleLabel;

    setAvatarDisplay(ME.profile_image, initials);

    // View-only user: UI se badalne wale buttons hata do. Rok server par hai,
    // ye sirf isliye ki click karne par har baar error toast na mile.
    document.documentElement.classList.toggle('view-only', Number(ME.view_only) === 1);

    if (ME.role === 'admin') {
      document.getElementById('nav-users').style.display = 'flex';
      document.getElementById('nav-mis').style.display = 'flex';
      document.getElementById('nav-fms').style.display = 'flex';
      document.getElementById('nav-ops').style.display = 'flex';
      document.getElementById('bulkDeleteBtn').style.display = 'inline-flex';
      document.getElementById('bulkEditBtn').style.display = 'inline-flex';
      document.getElementById('misCombinedBtn').style.display = 'inline-flex';
    }
    if (ME.role === 'hod') {
      // HOD ko MIS dikhta hai (apne department ka)
      document.getElementById('nav-mis').style.display = 'flex';
      document.getElementById('setPlanBtn').style.display = 'inline-flex';
    }
    if (ME.role === 'pc') {
      // PC: can view all tasks + approve, but cannot edit/delete
      // Nav items same as employee (dashboard, alltasks, approvals, profile, fms-tasks)
    }
    if (ME.role === 'user') {
      // Regular user ko MIS dikhta hai — sirf apni (self-only, backend filter karta hai)
      document.getElementById('nav-mis').style.display = 'flex';
      // FMS MIS cross-user view hai — regular user ke liye hide
      const fmsTab = document.getElementById('misTabFMS');
      if (fmsTab) fmsTab.style.display = 'none';
    }
    // Approvals admin / HOD / PC ko, aur HR ko (leave approve karne ke liye)
    if (ME.role === 'admin' || ME.role === 'hod' || ME.role === 'pc' || isHR()) {
      document.getElementById('nav-approvals').style.display = 'flex';
    }
    // Records tab temporarily disabled
    // Band kiye gaye features sidebar se hide — DISABLED_PAGES se control.
    // Ye role-wale blocks ke BAAD chalna zaroori hai, warna upar admin ke liye
    // nav-fms ko display:flex kar diya jata hai aur wo dobara dikhne lagta hai.
    Object.keys(DISABLED_PAGES).forEach(page => {
      if (!isPageDisabled(page)) return;
      const nav = document.getElementById(PAGE_NAV_ID[page]);
      if (nav) nav.style.display = 'none';
    });
    // Doer remark band hai to MIS detail table ka "Remark" column header bhi
    // hata do — rows me wo cell nikal chuka hai, header rehne se column ginti
    // mismatch ho jaati aur table ek khaali column ke saath dikhta.
    if (isTaskActionDisabled('doerRemark')) {
      const rth = document.getElementById('misDetailRemarkTh');
      if (rth) rth.style.display = 'none';
    }
    // FMS band hai to sidebar ke alawa uske baaki entry points bhi hata do —
    // dashboard/All Tasks ka "FMS" tab aur MIS ka "FMS MIS" tab. Warna feature
    // "disabled" hone ke bawajood in tabs se khulta rehta.
    if (isPageDisabled('fms') && isPageDisabled('fms-tasks')) {
      ['dashTabFms','tasksTabFms','misTabFMS'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }
    // Jo doer kisi FMS step ka hissa nahi hai, usse FMS ka poora UI hata do —
    // sidebar ka "FMS Tasks" aur dashboard table ka "FMS" tab dono.
    // Admin/HOD/PC ko hamesha dikhta hai, wo sabka FMS dekhte hain.
    if (!isFmsManager() && ME.isFmsDoer === false) {
      const ft = document.getElementById('nav-fms-tasks');
      if (ft) ft.style.display = 'none';
      const dt = document.getElementById('dashTabFms');
      if (dt) dt.style.display = 'none';
      const tt = document.getElementById('tasksTabFms');
      if (tt) tt.style.display = 'none';
    }
    setMinDates();
    _restoreActivePage(); // refresh par jahan the wahin wapis (warna dashboard)
    loadApprovalBadge();
    loadTransferBadge();
    // Band features ki badge polling / pop-up mat chalao — warna har 30 second
    // par un APIs par bekaar calls jaati rehti hain aur FMS ka pending pop-up
    // aisa page kholne ko kehta hai jo sidebar me hai hi nahi.
    if (!isPageDisabled('leaves')) loadLeaveBadge();
    if (!isPageDisabled('query'))  loadQueryBadge();
    if (!isPageDisabled('fms-tasks')) startFmsPendingReminders(); // login par + har 2 ghante FMS pending pop-up (doers ko)
    // Refresh badges every 30 seconds
    setInterval(loadApprovalBadge, 30000);
    setInterval(loadTransferBadge, 30000);
    if (!isPageDisabled('leaves')) setInterval(loadLeaveBadge, 30000);
    if (!isPageDisabled('query'))  setInterval(loadQueryBadge, 30000);
  } catch(e) { console.error('Init error:', e); window.location.replace('/'); }
}

// Set avatar in sidebar + profile page
function setAvatarDisplay(imageData, initials) {
  const sidebar = document.getElementById('sidebarAvatar');
  const profile = document.getElementById('profileAvatar');

  if (imageData) {
    // Sidebar
    sidebar.style.backgroundImage = `url(${imageData})`;
    sidebar.style.backgroundSize = 'cover';
    sidebar.style.backgroundPosition = 'center';
    sidebar.textContent = '';
    // Profile
    profile.style.backgroundImage = `url(${imageData})`;
    profile.style.backgroundSize = 'cover';
    profile.style.backgroundPosition = 'center';
    profile.textContent = '';
  } else {
    sidebar.style.backgroundImage = '';
    sidebar.textContent = initials || '?';
    profile.style.backgroundImage = '';
    profile.textContent = initials || '?';
  }
}

// Handle image file selection
function handleProfileImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image size must be under 2MB','error'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const imageData = e.target.result; // base64
    // Save to DB immediately
    const r = await api('/api/profile/image','POST',{image: imageData});
    if (r.error) { showToast(r.error,'error'); return; }
    ME.profile_image = imageData;
    const initials = ME.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    setAvatarDisplay(imageData, initials);
    showToast('Profile photo updated!');
  };
  reader.readAsDataURL(file);
}

// Remove profile image
async function removeProfileImage() {
  if (!await confirmDialog('Remove your profile photo?', {title:'Remove Photo', okText:'Remove', danger:true})) return;
  await api('/api/profile/image','POST',{image: null});
  ME.profile_image = null;
  const initials = ME.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  setAvatarDisplay(null, initials);
  showToast('Profile photo removed!');
}

function setMinDates() {
  const today = new Date().toISOString().split('T')[0];
  ['dDate','cDate','hDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.min = today;
  });
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
const pageTitles = {dashboard:'Dashboard',alltasks:'All Tasks',approvals:'Approvals',leaves:'Leave',query:'Query',users:'Users',profile:'Profile',mis:'MIS Report',fms:'FMS Admin','fms-tasks':'FMS Tasks',records:'Employee Records',newcopy:'New Client Copy',updateclient:'Update Client'};

// Sidebar par cursor jaate hi (jab wo expand hone lagta hai) koi bhi khula dropdown
// band kar do — warna native select popup sidebar ke upar overlap dikhta hai.
(function closeDropdownOnSidebarHover(){
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.addEventListener('mouseenter', () => {
    const el = document.activeElement;
    if (el && el.tagName === 'SELECT') el.blur(); // native dropdown band ho jayega
  });
})();

// ══════════════════════════════════════════════════════
// DISABLED FEATURES — sirf band hain, code hataya nahi gaya
// ══════════════════════════════════════════════════════
// Kisi feature ko wapas chalu karna ho to bas neeche uski line false kar do —
// bas itna hi. Sidebar ka nav item, deep-link/refresh se page khulna, aur uski
// background badge polling, teeno isi ek flag se chalte hain.
//
// Page ki poori HTML aur saare functions jaise the waise hi maujood hain,
// isliye false karte hi feature apne purane data ke saath wapas aa jayega.
const DISABLED_PAGES = {
  'leaves':    true,  // Leave
  'query':     true,  // Query
  // FMS ko Google service account chahiye (GOOGLE_CREDENTIALS_B64). Wo set na ho
  // to kuch tootta nahi — sheet wali API saaf error deti hai, list khaali aati
  // hai, aur regular users ko tab dikhta hi nahi (koi doer hi nahi hota).
  'fms':       false, // FMS Admin
  'fms-tasks': false, // FMS Tasks
};
function isPageDisabled(page) { return DISABLED_PAGES[page] === true; }

// Task row ke optional proof/remark actions. Ye alag flag hai kyunki ye poore
// page nahi, task ke saath lage chhote buttons hain (Dashboard, All Tasks aur
// MIS teeno jagah). Band karne se sirf UI hatta hai — server ke endpoints,
// upload modals aur purana data sab jaise the waise maujood rehte hain,
// isliye false karte hi wapas dikhne lagenge.
const DISABLED_TASK_ACTIONS = {
  proofPhoto: true,  // 📷 photo upload + 👁️ view + ♻️ replace
  proofVideo: true,  // 🎥 video upload + ▶️ play
  doerRemark: true,  // 📝 "kyun nahi hua" wala doer remark
};
function isTaskActionDisabled(a) { return DISABLED_TASK_ACTIONS[a] === true; }

// Har page ka sidebar nav item — disabled pages ko hide karne ke liye
const PAGE_NAV_ID = {
  'leaves': 'nav-leaves', 'query': 'nav-query', 'fms': 'nav-fms', 'fms-tasks': 'nav-fms-tasks',
};

function navigate(page, el) {
  // Band feature — koi bhi raasta (nav, deep-link, refresh-restore, ya koi
  // purana navigate() call jo code me kahin bacha ho) dashboard par bhej do.
  // Wahi baat un doers ke liye jo kisi FMS step ka hissa nahi hain: unke liye
  // ye page hamesha khaali rahega, isliye refresh-restore bhi dashboard par jaaye.
  if (isPageDisabled(page) || (page === 'fms-tasks' && !isFmsManager() && ME && ME.isFmsDoer === false)) {
    page = 'dashboard';
    el = document.querySelector('.nav-item[onclick*="dashboard"]');
  }
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if (el) el.classList.add('active');
  try { localStorage.setItem('activePage', page); } catch(e) {} // refresh par usi page par wapis
  document.getElementById('topbarTitle').textContent = pageTitles[page] || page;
  if (page==='dashboard') loadDashboard();
  if (page==='alltasks') loadAllTasks();
  if (page==='users') loadUsers();
  // Page khulte hi teeno tabs ke counts refresh — yahi wo lamha hai jab user
  // dekhta hai ki request kis tab me padi hai.
  if (page==='approvals') { loadApprovals(); loadApprovalBadge(); }
  if (page==='fms') loadFMSAdmin();
  if (page==='fms-tasks') loadFMSTasks();
  if (page==='mis') initMISDeptFilter();
  if (page==='leaves') loadLeaves();
  if (page==='query') loadQueries();
  if (page==='records') loadRecords();
  // navigate() core app ka hissa hai, yaani client ki copy me bhi jaata hai —
  // par ncLoadLog generator ke markers ke andar hai aur wahan hota hi nahi.
  // Isliye seedha bulane ke bajaye pehle dekh lete hain ki function hai ya nahi.
  if (page==='newcopy' && typeof ncLoadLog === 'function') ncLoadLog();
  window.scrollTo(0,0);
}

// Refresh par jahan the wahin wapis. localStorage se saved page restore karta hai;
// agar wo page us role ko allowed nahi (nav hidden) ya exist nahi karta, to Dashboard.
function _restoreActivePage() {
  let saved = '';
  try { saved = localStorage.getItem('activePage') || ''; } catch(e) {}
  if (!saved || saved === 'dashboard') { navigate('dashboard'); return; }
  const pageEl = document.getElementById('page-' + saved);
  if (!pageEl) { navigate('dashboard'); return; }
  // us page ka sidebar nav item dhoondo (highlight + role-visibility check ke liye)
  const navEl = [...document.querySelectorAll('.nav-item')]
    .find(n => (n.getAttribute('onclick') || '').includes(`navigate('${saved}'`));
  // Nav item hai par role ke liye hidden (display:none) → allowed nahi → Dashboard
  if (navEl && navEl.style.display === 'none') { navigate('dashboard'); return; }
  navigate(saved, navEl || null);
}

// ══════════════════════════════════════════════════════
// LEAVE
// ══════════════════════════════════════════════════════
// extra_working ab apply karne ke liye offer nahi hota, lekin label yahan rakha hai
// taaki purane records raw enum value ki jagah sahi naam dikhayein
const LEAVE_TYPE_LABEL = { full_day:'Full Day', half_day:'Half Day', work_from_home:'Work From Home', extra_working:'Extra Working' };
const LEAVE_STATUS_STYLE = {
  pending:  'background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning)',
  approved: 'background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success)',
  rejected: 'background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive)'
};

function openApplyLeave() {
  document.getElementById('leaveErr').style.display='none';
  document.getElementById('lvType').value='full_day';
  document.getElementById('lvReason').value='';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('lvFrom').value=today;
  document.getElementById('lvTo').value=today;
  document.getElementById('applyLeaveModal').classList.add('open');
}

async function submitLeave() {
  const err = document.getElementById('leaveErr');
  err.style.display='none';
  const leave_type = document.getElementById('lvType').value;
  const from_date  = document.getElementById('lvFrom').value;
  const to_date    = document.getElementById('lvTo').value;
  const reason     = document.getElementById('lvReason').value.trim();
  if (!from_date || !to_date) { err.textContent='Both From and To dates are required'; err.style.display='block'; return; }
  if (from_date > to_date) { err.textContent='From date must be on or before To date'; err.style.display='block'; return; }
  if (!reason) { err.textContent='Reason is required'; err.style.display='block'; return; }

  const btn = document.getElementById('lvSubmitBtn');
  btn.disabled = true; btn.textContent = 'Applying…';
  try {
    const r = await api('/api/leaves','POST',{leave_type, from_date, to_date, reason});
    if (r.error) { err.textContent=r.error; err.style.display='block'; return; }
    closeModal('applyLeaveModal');
    showToast('Leave request submitted!');
    loadLeaves();
    loadLeaveBadge();
  } finally {
    btn.disabled = false; btn.textContent = 'Apply';
  }
}

async function loadLeaves() {
  const container = document.getElementById('leavesContent');
  container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Loading…</div>`;
  const rows = await api(withSeg('/api/leaves'));
  if (rows.error) { container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ ${rows.error}</div>`; return; }
  if (!rows.length) { container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No leave requests yet</div>`; return; }

  // Approve/Reject yahan nahi — wo Approvals page ke Leave Requests tab me hai.
  // Yahan sirf apply + history + apni pending request cancel karna.
  const body = rows.map(l => {
    const isMine = String(l.user_id) === String(ME.id);
    // Admin har status (approved/rejected/pending) ki leave delete kar sakta hai;
    // applicant sirf apni PENDING leave.
    const showCancel = ME.role === 'admin' || (l.status === 'pending' && isMine);
    return `<tr>
      <td>${l.userName}${isMine?' <span style="font-size:10px;color:var(--muted-foreground)">(you)</span>':''}<div style="font-size:11px;color:var(--muted-foreground);margin-top:3px">${staffTypeBadge(l.staff_type)} ${l.department||'—'}</div></td>
      <td style="white-space:nowrap">${LEAVE_TYPE_LABEL[l.leave_type]||l.leave_type}</td>
      <td style="white-space:nowrap;font-size:12px">${fmtDate(l.from_date)}${l.to_date!==l.from_date?` → ${fmtDate(l.to_date)}`:''}</td>
      <td style="color:var(--muted-foreground);font-size:12px">${l.reason||'—'}</td>
      <td><span class="status-badge" style="${LEAVE_STATUS_STYLE[l.status]||''}">${l.status.charAt(0).toUpperCase()+l.status.slice(1)}</span>
        ${l.approverName?`<div style="font-size:10px;color:var(--muted-foreground);margin-top:2px">by ${l.approverName}</div>`:''}</td>
      <td style="white-space:nowrap">
        ${showCancel?`<button class="action-btn delete" onclick="cancelLeave(${l.id})" title="Delete this leave request" style="padding:4px 9px;font-size:14px">🗑️</button>`
                    :'<span style="color:var(--muted-foreground)">—</span>'}
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="flat-tasks-table">
      <div style="overflow-x:auto">
        <table style="min-width:760px">
          <thead><tr>
            <th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th>Action</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

async function decideLeave(id, action) {
  let note = '';
  if (action === 'rejected') {
    note = (await promptDialog('Why is this leave being rejected? (optional)', {title:'Reject Leave', okText:'Reject', placeholder:'Reason (optional)'})) || '';
  }
  const r = await api(`/api/leaves/${id}`,'PUT',{action, note});
  if (r.error) { showToast(r.error,'error'); return; }
  if (action === 'approved' && r.shifted > 0) {
    showToast(`✅ Leave approved! ${r.shifted} checklist task(s) moved to the next working day`);
  } else if (action === 'approved') {
    showToast('✅ Leave approved!');
  } else {
    showToast('Leave rejected');
  }
  // Jo bhi page khula ho use refresh karo (Leave page ya Approvals ka Leave tab)
  if (document.getElementById('page-leaves').classList.contains('active')) loadLeaves();
  if (document.getElementById('leaveApprovalsPanel').style.display !== 'none') loadLeaveApprovals();
  loadLeaveBadge();
  loadApprovalBadge();
  loadDashboard();
}

async function cancelLeave(id) {
  if (!await confirmDialog('Delete this leave request?', {title:'Delete Leave', okText:'Yes, delete', danger:true})) return;
  const r = await api(`/api/leaves/${id}`,'DELETE');
  if (r.error) { showToast(r.error,'error'); return; }
  showToast('Leave request deleted');
  loadLeaves();
  loadLeaveBadge();
}

// Pending leave count badge — sirf approve kar sakne walon ko dikhta hai
// HR = jiska department "HR" ho (role chahe 'user' hi ho) — sabki leave approve kar sakta hai
function isHR() { return !!(ME && (ME.department || '').trim().toLowerCase() === 'hr'); }

// Office / Factory badge — leave list me dikhta hai taaki HR ko pata chale banda kis segment ka hai
function staffTypeBadge(st) {
  return st === 'factory'
    ? `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);border:1px solid color-mix(in srgb,var(--warning) 26%,transparent)">🏭 Factory</span>`
    : `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--muted);color:var(--muted-foreground);border:1px solid var(--border)">🏢 Office</span>`;
}

async function loadLeaveBadge() {
  const badge = document.getElementById('leaveBadge');
  if (!badge || !ME) return;
  if (ME.role !== 'admin' && ME.role !== 'hod' && !isHR()) { badge.style.display='none'; return; }
  const rows = await api(withSeg('/api/leaves'));
  if (!Array.isArray(rows)) return;
  const pending = rows.filter(l => l.status === 'pending' && String(l.user_id) !== String(ME.id)).length;
  if (pending > 0) { badge.textContent = pending; badge.style.display = 'flex'; }
  else badge.style.display = 'none';
  setApprovalTabCount('apprCountLeave', pending);
}

// ══════════════════════════════════════════════════════
// QUERY MODULE
// ══════════════════════════════════════════════════════
// canAnswer = Admin ya HR. Wahi answer/reject kar sakte hain aur sabki queries dekhte hain.
function _canAnswerQueries() { return !!(ME && (ME.role === 'admin' || isHR())); }

// User ke liye "seen" tracking — answered/rejected queries jo user ne khol ke dekhi
function _qSeen() { try { return new Set(JSON.parse(localStorage.getItem('querySeen_' + ME.id) || '[]')); } catch(e) { return new Set(); } }
function _qMarkSeen(ids) {
  try {
    const s = _qSeen(); ids.forEach(i => s.add(i));
    localStorage.setItem('querySeen_' + ME.id, JSON.stringify([...s]));
  } catch(e) {}
}

function _queryStatusBadge(st) {
  if (st === 'answered') return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--success) 22%,transparent);color:var(--success);border:1px solid color-mix(in srgb,var(--success) 22%,transparent)">✓ Answered</span>`;
  if (st === 'rejected') return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive);border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent)">✗ Rejected</span>`;
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);border:1px solid color-mix(in srgb,var(--warning) 26%,transparent)">● Open</span>`;
}

// Sidebar badge — Admin/HR: open (bina-jawab) count; user: uski resolved-unseen count
async function loadQueryBadge() {
  const badge = document.getElementById('queryBadge');
  if (!badge || !ME) return;
  try {
    const data = await api('/api/queries');
    const list = data.queries || [];
    let n;
    if (data.canAnswer) n = list.filter(q => q.status === 'open').length;
    else { const seen = _qSeen(); n = list.filter(q => q.status !== 'open' && !seen.has(q.id)).length; }
    if (n > 0) { badge.textContent = n; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  } catch(e) {}
}

let _queries = [];
let _queryCanAnswer = false;

async function loadQueries() {
  const box = document.getElementById('queryContent');
  const info = document.getElementById('queryInfo');
  box.innerHTML = '<div style="padding:20px;color:var(--muted-foreground);font-size:13px;text-align:center">Loading…</div>';
  const data = await api('/api/queries');
  if (data.error) { box.innerHTML = `<div style="padding:20px;color:var(--destructive)">${escapeHtml(data.error)}</div>`; return; }
  _queries = data.queries || [];
  _queryCanAnswer = !!data.canAnswer;

  info.textContent = _queryCanAnswer
    ? 'You can answer or reject any query. Employees see only their own queries.'
    : 'Raise a query — HR or Admin will answer it here.';

  if (!_queries.length) {
    box.innerHTML = '<div style="padding:30px;color:var(--muted-foreground);font-size:13px;text-align:center">No queries yet.</div>';
  } else if (_queryCanAnswer) {
    box.innerHTML = _renderQueriesGrouped(_queries);
  } else {
    box.innerHTML = _queries.map(_renderQueryCard).join('');
    // user ki resolved queries ab dekh li — seen mark karke badge clear
    _qMarkSeen(_queries.filter(q => q.status !== 'open').map(q => q.id));
  }
  loadQueryBadge();
}

// Admin/HR — All Tasks jaisa: har user ka naam + aage open-count, click par expand
function _renderQueriesGrouped(list) {
  const groups = new Map();
  list.forEach(q => {
    if (!groups.has(q.user_id)) groups.set(q.user_id, { name: q.userName, staff_type: q.staff_type, items: [] });
    groups.get(q.user_id).items.push(q);
  });
  // jinke open queries hain wo upar
  const arr = [...groups.entries()].sort((a,b) => {
    const oa = a[1].items.filter(q=>q.status==='open').length, ob = b[1].items.filter(q=>q.status==='open').length;
    return ob - oa;
  });
  return arr.map(([uid, g]) => {
    const openCount = g.items.filter(q => q.status === 'open').length;
    const openBadge = openCount > 0
      ? `<span style="margin-left:8px;background:var(--destructive);color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${openCount}</span>`
      : `<span style="margin-left:8px;color:var(--muted-foreground);font-size:11px">${g.items.length}</span>`;
    const expanded = openCount > 0;
    return `<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden">
      <div onclick="toggleQueryGroup('${uid}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:12px 14px;background:var(--muted);user-select:none">
        <span id="qgArrow-${uid}" style="transition:transform .15s;transform:rotate(${expanded?90:0}deg);color:var(--muted-foreground)">▶</span>
        <span style="font-weight:600;font-size:14px;color:var(--foreground)">${escapeHtml(g.name)}</span>
        ${staffTypeBadge(g.staff_type)}
        ${openBadge}
      </div>
      <div id="qgBody-${uid}" style="display:${expanded?'block':'none'};padding:10px 14px">
        ${g.items.map(_renderQueryCard).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleQueryGroup(uid) {
  const body = document.getElementById('qgBody-' + uid);
  const arrow = document.getElementById('qgArrow-' + uid);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (arrow) arrow.style.transform = `rotate(${open?0:90}deg)`;
}

function _renderQueryCard(q) {
  const canAct = _queryCanAnswer && q.status === 'open';
  let resolvedBlock = '';
  if (q.status === 'answered' || q.status === 'rejected') {
    const label = q.status === 'answered' ? 'Answer' : 'Rejected';
    const color = q.status === 'answered' ? 'var(--success)' : 'var(--destructive)';
    const bg = q.status === 'answered' ? 'color-mix(in srgb,var(--success) 10%,transparent)' : 'color-mix(in srgb,var(--destructive) 10%,transparent)';
    const bd = q.status === 'answered' ? 'color-mix(in srgb,var(--success) 22%,transparent)' : 'color-mix(in srgb,var(--destructive) 22%,transparent)';
    resolvedBlock = `<div style="margin-top:8px;background:${bg};border:1px solid ${bd};border-radius:8px;padding:8px 10px">
      <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:3px">${label}${q.answererName ? ' · by ' + escapeHtml(q.answererName) : ''}${q.answered_at ? ' · ' + escapeHtml(q.answered_at) : ''}</div>
      <div style="font-size:13px;color:var(--foreground);white-space:pre-wrap;line-height:1.5">${q.answer ? escapeHtml(q.answer) : '<span style="color:var(--muted-foreground)">(no note)</span>'}</div>
    </div>`;
  }
  // Owner apni open query edit/delete kar sakta hai; Admin/HR koi bhi query delete kar sakte hain.
  // Answered/rejected query owner na edit kar sakta na delete.
  const isOwner = ME && q.user_id === ME.id;
  const canEdit = isOwner && q.status === 'open';
  const canDelete = _queryCanAnswer || (isOwner && q.status === 'open');
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--card)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
      <span style="font-size:11px;color:var(--muted-foreground)">🕒 ${escapeHtml(q.created_at || '')}</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${_queryStatusBadge(q.status)}
        ${canEdit ? `<button title="Edit query" onclick="openEditQuery(${q.id})" style="background:none;border:none;cursor:pointer;color:var(--chart-1);font-size:14px;padding:2px 4px;line-height:1">✏️</button>` : ''}
        ${canDelete ? `<button title="Delete query" onclick="deleteQuery(${q.id})" style="background:none;border:none;cursor:pointer;color:var(--destructive);font-size:14px;padding:2px 4px;line-height:1">🗑</button>` : ''}
      </div>
    </div>
    <div style="font-size:14px;color:var(--foreground);white-space:pre-wrap;line-height:1.5">${escapeHtml(q.message)}</div>
    ${resolvedBlock}
    ${canAct ? `<div style="margin-top:10px;text-align:right"><button class="btn btn-primary btn-sm" onclick="openResolveQuery(${q.id})">💬 Answer / Reject</button></div>` : ''}
  </div>`;
}

async function deleteQuery(id) {
  if (!await confirmDialog('Delete this query permanently? This cannot be undone.', { title: 'Delete Query', okText: 'Delete', danger: true })) return;
  const r = await api(`/api/queries/${id}`, 'DELETE');
  if (r.error) { showToast(r.error, 'error'); return; }
  showToast('Query deleted');
  loadQueries();
}

// ── New / Edit query ──
// _editQueryId null = naya; warna us query ko edit kar rahe hain
let _editQueryId = null;
function openNewQuery() {
  _editQueryId = null;
  document.getElementById('newQueryTitle').textContent = '❓ New Query';
  document.getElementById('sendQueryBtn').textContent = 'Send Query';
  document.getElementById('newQueryErr').style.display = 'none';
  document.getElementById('newQueryText').value = '';
  document.getElementById('newQueryModal').classList.add('open');
  setTimeout(() => document.getElementById('newQueryText').focus(), 50);
}

function openEditQuery(id) {
  const q = _queries.find(x => x.id === id);
  if (!q) return;
  if (q.status !== 'open') { showToast('Answered or rejected queries cannot be edited', 'error'); return; }
  _editQueryId = id;
  document.getElementById('newQueryTitle').textContent = '✏️ Edit Query';
  document.getElementById('sendQueryBtn').textContent = 'Save Changes';
  document.getElementById('newQueryErr').style.display = 'none';
  document.getElementById('newQueryText').value = q.message || '';
  document.getElementById('newQueryModal').classList.add('open');
  setTimeout(() => document.getElementById('newQueryText').focus(), 50);
}

// Guard so a fast double-click can't create/update the query twice
let _qSubmitting = false;
async function submitNewQuery() {
  if (_qSubmitting) return;
  const err = document.getElementById('newQueryErr');
  const message = document.getElementById('newQueryText').value.trim();
  if (!message) { err.textContent = 'Please type your query.'; err.style.display = 'block'; return; }
  const isEdit = !!_editQueryId;
  const btn = document.getElementById('sendQueryBtn');
  _qSubmitting = true;
  if (btn) { btn.disabled = true; btn.textContent = isEdit ? 'Saving…' : 'Sending…'; }
  try {
    const r = isEdit
      ? await api(`/api/queries/${_editQueryId}`, 'PUT', { message })
      : await api('/api/queries', 'POST', { message });
    if (r.error) { err.textContent = r.error; err.style.display = 'block'; return; }
    closeModal('newQueryModal');
    showToast(isEdit ? '✅ Query updated!' : '✅ Query sent!');
    _editQueryId = null;
    if (document.getElementById('page-query').classList.contains('active')) loadQueries();
    else loadQueryBadge();
  } finally {
    _qSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Send Query'; }
  }
}

// ── Resolve (HR/Admin) ──
let _resolveQueryId = null;
function openResolveQuery(id) {
  const q = _queries.find(x => x.id === id);
  if (!q) return;
  _resolveQueryId = id;
  document.getElementById('resolveQueryErr').style.display = 'none';
  document.getElementById('rqUser').textContent = q.userName || '';
  document.getElementById('rqTime').textContent = q.created_at || '';
  document.getElementById('rqMessage').textContent = q.message || '';
  document.getElementById('rqAnswer').value = '';
  document.getElementById('resolveQueryModal').classList.add('open');
  setTimeout(() => document.getElementById('rqAnswer').focus(), 50);
}

async function answerQuery() {
  const err = document.getElementById('resolveQueryErr');
  const answer = document.getElementById('rqAnswer').value.trim();
  if (!answer) { err.textContent = 'Please type an answer (or use Reject).'; err.style.display = 'block'; return; }
  const r = await api(`/api/queries/${_resolveQueryId}/answer`, 'PUT', { answer });
  if (r.error) { err.textContent = r.error; err.style.display = 'block'; return; }
  closeModal('resolveQueryModal');
  showToast('✅ Answer sent!');
  loadQueries();
}

async function rejectQuery() {
  const reason = document.getElementById('rqAnswer').value.trim();
  if (!await confirmDialog('Reject this query? The employee will see it as rejected.', {title:'Reject Query', okText:'Reject', danger:true})) return;
  const r = await api(`/api/queries/${_resolveQueryId}/reject`, 'PUT', { reason });
  if (r.error) { document.getElementById('resolveQueryErr').textContent = r.error; document.getElementById('resolveQueryErr').style.display = 'block'; return; }
  closeModal('resolveQueryModal');
  showToast('Query rejected');
  loadQueries();
}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
// Dashboard ke saare filters (employee, HOD dept, PC date range, Office/Factory
// segment) se URL banata hai. Counts aur neeche wali table dono isi se aate hain —
// ek hi jagah rakha hai taaki card ka number aur table ki rows kabhi alag filter
// par na chal jaayein.
function dashBaseUrl() {
  const empFilter = document.getElementById('dashEmployeeFilter');
  const empVal = empFilter ? empFilter.value : 'all';
  const isAdmin = ME.role === 'admin';
  const isHod = ME.role === 'hod';
  const isPC = ME.role === 'pc';
  // ME.department blank ho sakta hai — server DB se resolve karega
  const hodParam = isHod ? '&hodDept='+encodeURIComponent(ME.department||'') : '';

  // PC date range params
  const dateFrom = isPC ? (document.getElementById('pcDateFrom')?.value || '') : '';
  const dateTo   = isPC ? (document.getElementById('pcDateTo')?.value || '') : '';
  const dateParams = (isPC && dateFrom && dateTo) ? `&dateFrom=${dateFrom}&dateTo=${dateTo}` : '';

  const segP = segQuery() ? `&${segQuery()}` : '';
  return (isAdmin || isHod || isPC)
    ? `/api/dashboard?employee=${empVal}${hodParam}${dateParams}${segP}&taskType=`
    : `/api/dashboard?taskType=`;
}

async function loadDashboard() {
  const empFilter = document.getElementById('dashEmployeeFilter');
  const isAdmin = ME.role === 'admin';
  const isHod = ME.role === 'hod';
  const isPC = ME.role === 'pc';

  const baseUrl = dashBaseUrl();
  const [dDel, dChl] = await Promise.all([
    api(baseUrl + 'delegation&list=' + dashCard),
    api(baseUrl + 'checklist&list=' + dashCard)
  ]);

  // Error check: agar DB ya API fail ho toh user ko dikhao
  if (dDel.error || dChl.error) {
    const errMsg = dDel.error || dChl.error;
    console.error('Dashboard API error:', errMsg);
    document.getElementById('dTotal').textContent = 'Err';
    document.getElementById('dPending').textContent = 'Err';
    document.getElementById('dRevised').textContent = 'Err';
    document.getElementById('dCompleted').textContent = 'Err';
    document.getElementById('dashTbody').innerHTML = `<tr><td colspan="6" style="color:red;padding:16px;text-align:center">⚠️ Data load failed: ${errMsg}</td></tr>`;
    return;
  }

  const pendingCount   = (dDel.pending||0)   + (dChl.pending||0);
  const completedCount = (dDel.completed||0) + (dChl.completed||0);
  document.getElementById('dTotal').textContent = pendingCount + completedCount;
  document.getElementById('dPending').textContent = pendingCount;
  document.getElementById('dRevised').textContent = (dDel.revised||0) + (dChl.revised||0);
  document.getElementById('dCompleted').textContent = completedCount;

  if (isAdmin || isHod || isPC) {
    empFilter.style.display = 'block';

    if (isPC) {
      // Show date range filter for PC
      const drFilter = document.getElementById('pcDateRangeFilter');
      if (drFilter) drFilter.style.display = 'flex';
      // Smart dropdown: sirf pending wale users
      await refreshPCEmployeeDropdown();
    } else {
      // Segment badalne par dropdown dobara build hona chahiye — isliye har baar rebuild
      const users = await api(withSeg('/api/users'));
      const filtered = isHod
        ? users.filter(u => u.department === ME.department)
        : users;
      const prev = empFilter.value;
      empFilter.innerHTML = '<option value="all">All Employees</option>';
      filtered.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.name;
        empFilter.appendChild(opt);
      });
      if ([...empFilter.options].some(o => o.value === prev)) empFilter.value = prev;
    }

    if (isAdmin) {
      document.getElementById('dashBtns').innerHTML = `
        <button class="btn btn-yellow" onclick="openHoliday()">🗓 Holidays</button>
        <button class="btn btn-green" onclick="openChecklist()">+ Checklist</button>
        <button class="btn btn-primary" onclick="openDelegate()">+ Delegate</button>`;
    } else if (isHod) {
      document.getElementById('dashBtns').innerHTML = `
        <button class="btn btn-green" onclick="openChecklist()">+ Checklist</button>
        <button class="btn btn-primary" onclick="openDelegate()">+ Delegate</button>`;
    } else if (ME.role === 'user') {
      document.getElementById('dashBtns').innerHTML = `
        <button class="btn btn-primary" onclick="openDelegate()">+ Assign Task</button>`;
    }
  }

  if (dashChartInst) dashChartInst.destroy();

  const combinedPending   = (dDel.pending||0)   + (dChl.pending||0);
  const combinedCompleted = (dDel.completed||0) + (dChl.completed||0);
  const combinedRevised   = dDel.revised||0;
  const chartLabels = ['Completed','Pending','Revised'];
  const chartData   = [combinedCompleted, combinedPending, combinedRevised];
  // Theme tokens se rang — dark mode par apne aap adjust ho jate hain
  const chartColors = [cssVar('--success'), cssVar('--destructive'), cssVar('--warning')];

  dashChartInst = new Chart(document.getElementById('dashChart').getContext('2d'), {
    type:'pie',
    data:{labels:chartLabels,datasets:[{data:chartData,backgroundColor:chartColors,borderWidth:3,borderColor:cssVar('--card','#fff'),hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${c.label}: ${c.raw}`}}}}
  });

  // Combine both types for the unified task table
  syncDashCards();
  setDashTasks(dDel, dChl);
  // Keep sort state across reloads (don't reset)
  renderDashTable(window._lastDashTasks, dashType);

  // Load FMS section — respects same employee filter
  loadDashFMS();
}

// PC: date range change → refresh dropdown then dashboard
async function onPCFilterChange() {
  if (ME.role === 'pc') {
    await refreshPCEmployeeDropdown();
  }
  loadDashboard();
}

function clearPCDateFilter() {
  const df = document.getElementById('pcDateFrom');
  const dt = document.getElementById('pcDateTo');
  if (df) df.value = '';
  if (dt) dt.value = '';
  onPCFilterChange();
}

// Refresh PC employee dropdown — sirf pending tasks wale users
async function refreshPCEmployeeDropdown() {
  const empFilter = document.getElementById('dashEmployeeFilter');
  if (!empFilter) return;
  const dateFrom = document.getElementById('pcDateFrom')?.value || '';
  const dateTo   = document.getElementById('pcDateTo')?.value   || '';
  const dateQ    = (dateFrom && dateTo) ? `?dateFrom=${dateFrom}&dateTo=${dateTo}` : '';
  const pendingUsers = await api(`/api/users/with-pending-tasks${dateQ}`);
  // Current value save karo
  const currentVal = empFilter.value;
  empFilter.innerHTML = '<option value="all">All Employees</option>';
  (pendingUsers || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.name;
    empFilter.appendChild(opt);
  });
  // Restore selection agar still valid hai
  if (currentVal && [...empFilter.options].some(o => o.value === currentVal)) {
    empFilter.value = currentVal;
  } else {
    empFilter.value = 'all';
  }
}

function dashTab(type, el) {
  dashType = type;
  document.querySelectorAll('#dashTypeTabGroup .tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');

  // FMS rows Google Sheets se aati hain, isliye alag loader. Pehli baar tab par
  // aane par "Loading…" dikhao — sheet padhne me kuch second lagte hain.
  if (type === 'fms') {
    if (window._lastDashFMS) { renderDashTable(window._lastDashTasks || [], 'fms'); return; }
    const tbody = document.getElementById('dashTbody');
    const headNormal = document.getElementById('dashHeadNormal');
    const headFms = document.getElementById('dashHeadFms');
    if (headNormal) headNormal.style.display = 'none';
    if (headFms) headFms.style.display = '';
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty">⏳ Loading FMS rows from Google Sheets…</td></tr>`;
    loadDashFMS();
    return;
  }

  // Re-render table without full API reload
  if (window._lastDashTasks) {
    renderDashTable(window._lastDashTasks, dashType);
  } else {
    loadDashboard();
  }
}

// FMS Dashboard loader
let dashFMSChartInst = null;
// ── FMS pending pop-up — login par + har 2 ghante doer ko uske pending steps yaad dilao ──
let _fmsPopupTimer = null;
function startFmsPendingReminders() {
  if (_fmsPopupTimer) return;
  checkFmsPendingPopup();                                             // login par pehli baar
  _fmsPopupTimer = setInterval(checkFmsPendingPopup, 2 * 60 * 60 * 1000);  // har 2 ghante
}
async function checkFmsPendingPopup() {
  // /api/fms-dashboard regular doer ko uske APNE pending steps deta hai (admin/hod/pc ko sabke)
  if (!ME || ME.role === 'admin' || ME.role === 'hod' || ME.role === 'pc') return;
  try {
    const data = await api('/api/fms-dashboard');
    const rows = (data && data.rows) || [];
    if (rows.length) showFmsPendingPopup(rows);
  } catch (e) {}
}
function showFmsPendingPopup(rows) {
  const m = document.getElementById('fmsPendingPopup');
  if (!m || m.classList.contains('open')) return;                    // pehle se khula -> skip
  document.getElementById('fmsPendingPopupCount').textContent = rows.length;
  document.getElementById('fmsPendingPopupList').innerHTML = rows.slice(0, 30).map(r => `
    <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--muted);border-radius:8px;margin-bottom:6px">
      <div><div style="font-weight:600;font-size:13px;color:var(--foreground)">${escapeHtml(r.stepName || '')}</div>
        <div style="font-size:11px;color:var(--muted-foreground)">${escapeHtml(r.fmsName || '')}</div></div>
      <div style="text-align:right;white-space:nowrap">${r.planDate ? `<div style="font-size:12px;${r.isLate ? 'color:var(--destructive);font-weight:600' : 'color:var(--muted-foreground)'}">${escapeHtml(r.planDate)}</div>` : ''}${r.isLate ? '<div style="font-size:10px;color:var(--destructive);font-weight:700">⏰ Late</div>' : ''}</div>
    </div>`).join('') + (rows.length > 30 ? `<div style="font-size:11px;color:var(--muted-foreground);text-align:center">…and ${rows.length - 30} more</div>` : '');
  m.classList.add('open');
}
function closeFmsPendingPopupGo() {
  closeModal('fmsPendingPopup');
  navigate('fms-tasks', document.getElementById('nav-fms-tasks'));
}

async function loadDashFMS() {
  const section = document.getElementById('dashFMSSection');
  if (!section) return;
  // FMS band hai — dashboard ka poora "FMS Pending Tasks" panel bhi chhupa do
  if (isPageDisabled('fms') && isPageDisabled('fms-tasks')) { section.style.display = 'none'; return; }

  const isAdmin = ME.role === 'admin';
  const isHod   = ME.role === 'hod';
  const isPC    = ME.role === 'pc';
  // Admin/HOD/PC ko section hamesha dikhta hai — wo employee filter aur
  // step-wise panel isi se chalate hain. Doer ko tabhi jab wo kisi FMS
  // step ka hissa ho; warna khaali chart aur "No data" hi dikhte rehte hain.
  const isManager = isFmsManager();
  section.style.display = isManager ? 'block' : 'none';

  // v16: PC-only — step-detail dropdown panel show karo
  const stepPanel = document.getElementById('dashFMSStepDetailPanel');
  if (stepPanel) {
    if (isPC) {
      stepPanel.style.display = 'block';
      loadDashFMSStepDetailDropdown();
    } else {
      stepPanel.style.display = 'none';
    }
  }

  // Doer head — admin/hod/pc sees doer name, employee sees their own
  document.getElementById('dashFMSDoerHead').textContent = (isAdmin || isHod || isPC) ? 'Doer' : 'My Step';

  document.getElementById('dashFMSTbody').innerHTML = `<tr><td colspan="5" class="empty">Loading FMS tasks…</td></tr>`;
  document.getElementById('dashFMSCount').textContent = '';

  const empFilter = document.getElementById('dashEmployeeFilter');
  const empVal = empFilter ? empFilter.value : 'all';
  const url = `/api/fms-dashboard${(isAdmin||isHod||isPC) ? `?employee=${empVal}` : ''}`;

  const data = await api(url);
  if (data.error) {
    // Error sirf usko dikhao jise section dikhna hi chahiye, warna
    // non-FMS doer ke saamne wapas wahi block khul jaayega.
    if (isManager || window._dashFMSMember) {
      section.style.display = 'block';
      document.getElementById('dashFMSTbody').innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--destructive)">⚠️ ${data.error}</td></tr>`;
    }
    return;
  }

  // Membership yaad rakho — agli baar error aaye to section chhupe nahi
  window._dashFMSMember = data.inFms !== false;
  // === false hi check karo, !data.inFms nahi: purana server (deploy ke beech)
  // ye flag nahi bhejta, tab section chhupna nahi chahiye.
  if (!isManager && data.inFms === false) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  const rows = data.rows || [];
  const today = new Date().toISOString().split('T')[0];

  document.getElementById('dashFMSCount').textContent = rows.length ? `(${rows.length} pending)` : '';

  const tbody = document.getElementById('dashFMSTbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No FMS pending tasks 🎉</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => {
      const isLate = r.isLate;
      const lateBadge = isLate
        ? `<span style="font-size:10px;background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent)">⏰ Late</span>`
        : `<span style="font-size:10px;background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid color-mix(in srgb,var(--success) 22%,transparent)">✅ On Track</span>`;
      const dateDisplay = r.planDate
        ? `<span style="${isLate?'color:var(--destructive);font-weight:600':''}">${r.planDate}</span>`
        : `<span style="color:var(--muted-foreground);font-size:12px">${r.planValue||'—'}</span>`;
      return `<tr>
        <td style="font-weight:600;color:var(--foreground)">${r.fmsName}</td>
        <td style="color:var(--foreground);font-size:13px">${r.stepName}</td>
        <td style="color:var(--foreground)">${r.doer}</td>
        <td>${dateDisplay}</td>
        <td>${lateBadge}</td>
      </tr>`;
    }).join('');
  }

  // Upar wale "Pending Tasks" table ke FMS tab ko bhi yahi rows chahiye —
  // dobara API call karne ka koi matlab nahi.
  window._lastDashFMS = rows;
  if (dashType === 'fms') renderDashTable(window._lastDashTasks || [], 'fms');

  // Summary by FMS name
  const summaryByFMS = {};
  rows.forEach(r => {
    if (!summaryByFMS[r.fmsName]) summaryByFMS[r.fmsName] = { total: 0, late: 0 };
    summaryByFMS[r.fmsName].total++;
    if (r.isLate) summaryByFMS[r.fmsName].late++;
  });

  const summaryEl = document.getElementById('dashFMSSummary');
  if (summaryEl) {
    if (!Object.keys(summaryByFMS).length) {
      summaryEl.innerHTML = '<div style="color:var(--muted-foreground);font-size:13px;text-align:center;padding:16px">No data</div>';
    } else {
      summaryEl.innerHTML = Object.entries(summaryByFMS).map(([name, s]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--muted)">
          <span style="font-size:13px;font-weight:600;color:var(--foreground)">${name}</span>
          <div style="display:flex;gap:8px;align-items:center">
            <span style="font-size:12px;color:var(--destructive);font-weight:600">${s.total} pending</span>
            ${s.late ? `<span style="font-size:11px;background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive);padding:1px 7px;border-radius:8px;font-weight:600">${s.late} late</span>` : ''}
          </div>
        </div>`).join('');
    }
  }

  // FMS chart — pending vs late
  if (dashFMSChartInst) dashFMSChartInst.destroy();
  const canvas = document.getElementById('dashFMSChart');
  if (canvas) {
    const totalPending = rows.length;
    const totalLate = rows.filter(r => r.isLate).length;
    const onTrack = totalPending - totalLate;
    if (totalPending > 0) {
      dashFMSChartInst = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: {
          labels: ['On Track', 'Late'],
          datasets: [{ data: [onTrack, totalLate], backgroundColor: [cssVar('--success'), cssVar('--warning')], borderWidth: 3, borderColor: cssVar('--card','#fff'), hoverOffset: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw}` } } } }
      });
    }
  }
}

// ══════════════════════════════════════════════════════
// v16: PC-only — FMS step-wise breakdown dropdown
// ══════════════════════════════════════════════════════
let _dashFMSStepDetailCache = null; // cached /api/mis/fms response

async function loadDashFMSStepDetailDropdown() {
  const sel = document.getElementById('dashFMSStepDetailSelect');
  if (!sel) return;
  // Wide date range so we capture all FMS data (last 1 year by default)
  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const start = yearAgo.toISOString().split('T')[0];
  const end   = today.toISOString().split('T')[0];

  try {
    const data = await api(`/api/mis/fms?start=${start}&end=${end}`);
    if (data.error) {
      sel.innerHTML = `<option value="">⚠️ ${data.error}</option>`;
      return;
    }
    _dashFMSStepDetailCache = Array.isArray(data) ? data : [];
    if (!_dashFMSStepDetailCache.length) {
      sel.innerHTML = '<option value="">-- No FMS configured --</option>';
      return;
    }
    // Preserve current selection if it still exists
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Select an FMS to see pending per step --</option>' +
      _dashFMSStepDetailCache.map(f =>
        `<option value="${f.fmsId}">${f.fmsName} (${f.pending} pending / ${f.total} total)</option>`
      ).join('');
    if (prev && _dashFMSStepDetailCache.some(f => String(f.fmsId) === prev)) {
      sel.value = prev;
      onDashFMSStepDetailChange();
    }
  } catch(e) {
    sel.innerHTML = `<option value="">⚠️ Load failed: ${e.message}</option>`;
  }
}

function onDashFMSStepDetailChange() {
  const sel = document.getElementById('dashFMSStepDetailSelect');
  const body = document.getElementById('dashFMSStepDetailBody');
  const content = document.getElementById('dashFMSStepDetailContent');
  if (!sel || !body || !content) return;
  const fmsId = sel.value;
  if (!fmsId) { body.style.display = 'none'; return; }
  body.style.display = 'block';

  const fms = (_dashFMSStepDetailCache || []).find(f => String(f.fmsId) === fmsId);
  if (!fms) {
    content.innerHTML = '<div style="padding:14px;color:var(--muted-foreground);font-size:13px;text-align:center">FMS data not found.</div>';
    return;
  }

  const steps = fms.steps || [];
  if (!steps.length) {
    content.innerHTML = '<div style="padding:14px;color:var(--muted-foreground);font-size:13px;text-align:center">No steps configured for this FMS.</div>';
    return;
  }

  // Summary header
  const headerHtml = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;padding:10px 14px;background:var(--muted);border-radius:8px;margin-bottom:10px;border:1px solid var(--border)">
      <div><span style="font-size:11px;color:var(--muted-foreground);font-weight:600;text-transform:uppercase">FMS:</span> <b style="font-size:13px;color:var(--foreground)">${fms.fmsName}</b></div>
      <div><span style="font-size:11px;color:var(--destructive);font-weight:600;text-transform:uppercase">Pending:</span> <b style="font-size:13px;color:var(--destructive)">${fms.pending}</b></div>
      <div><span style="font-size:11px;color:var(--success);font-weight:600;text-transform:uppercase">Done:</span> <b style="font-size:13px;color:var(--success)">${fms.done}</b></div>
      <div><span style="font-size:11px;color:var(--muted-foreground);font-weight:600;text-transform:uppercase">Total:</span> <b style="font-size:13px;color:var(--foreground)">${fms.total}</b></div>
    </div>`;

  // Step-wise breakdown table
  const rowsHtml = steps.map(s => {
    const pct = s.total > 0 ? Math.round((s.pending / s.total) * 100) : 0;
    const barColor = s.pending === 0 ? 'var(--success)' : (pct > 50 ? 'var(--destructive)' : 'var(--warning)');
    return `<tr>
      <td style="padding:9px 12px;font-size:12px;color:var(--muted-foreground)">${s.stepOrder || '—'}</td>
      <td style="padding:9px 12px;font-size:13px;font-weight:600;color:var(--foreground)">${s.stepName || '—'}</td>
      <td style="padding:9px 12px;font-size:12px;color:var(--muted-foreground)">${s.doers || '—'}</td>
      <td style="padding:9px 12px;font-size:13px;font-weight:700;color:var(--destructive);text-align:center">${s.pending}</td>
      <td style="padding:9px 12px;font-size:13px;color:var(--success);text-align:center">${s.done}</td>
      <td style="padding:9px 12px;font-size:12px;color:var(--muted-foreground);text-align:center">${s.total}</td>
      <td style="padding:9px 12px;min-width:130px">
        <div style="background:var(--muted);height:8px;border-radius:4px;overflow:hidden;position:relative">
          <div style="background:${barColor};height:100%;width:${pct}%;transition:width .3s"></div>
        </div>
        <div style="font-size:10px;color:var(--muted-foreground);margin-top:3px;text-align:right">${pct}% pending</div>
      </td>
    </tr>`;
  }).join('');

  content.innerHTML = headerHtml + `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--muted)">
            <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">#</th>
            <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Step Name</th>
            <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Doers</th>
            <th style="padding:9px 12px;text-align:center;font-size:11px;color:var(--destructive);text-transform:uppercase;letter-spacing:.4px">Pending</th>
            <th style="padding:9px 12px;text-align:center;font-size:11px;color:var(--success);text-transform:uppercase;letter-spacing:.4px">Done</th>
            <th style="padding:9px 12px;text-align:center;font-size:11px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Total</th>
            <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Progress</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

function toggleDashDateSort() {
  _dashDateSortState = (_dashDateSortState + 1) % 3; // 0→1→2→0
  const icon = document.getElementById('dashDateSortIcon');
  if (icon) {
    icon.textContent = _dashDateSortState === 0 ? '⇅' : _dashDateSortState === 1 ? '↑' : '↓';
    icon.style.color = _dashDateSortState === 0 ? 'var(--muted-foreground)' : 'var(--primary)';
  }
  if (window._lastDashTasks) renderDashTable(window._lastDashTasks, dashType);
}

function renderDashTable(tasks, type) {
  const tbody = document.getElementById('dashTbody');
  const headNormal = document.getElementById('dashHeadNormal');
  const headFms    = document.getElementById('dashHeadFms');

  // ── FMS tab — rows Google Sheet se aati hain, tasks table se nahi ──
  if (type === 'fms') {
    if (headNormal) headNormal.style.display = 'none';
    if (headFms)    headFms.style.display    = '';
    let rows = window._lastDashFMS || [];
    if (_dashDateSortState === 1) {
      rows = [...rows].sort((a,b) => (a.planDate||'').localeCompare(b.planDate||''));
    } else if (_dashDateSortState === 2) {
      rows = [...rows].sort((a,b) => (b.planDate||'').localeCompare(a.planDate||''));
    }
    tbody.innerHTML = rows.length
      ? rows.map(_buildFmsRowHtml).join('')
      : `<tr><td colspan="4" class="empty">No pending FMS rows</td></tr>`;
    return;
  }
  if (headNormal) headNormal.style.display = '';
  if (headFms)    headFms.style.display    = 'none';

  // Show ALL pending tasks (delegation + checklist) combined
  const isAdmin = ME.role==='admin' || ME.role==='hod';
  const isPC    = ME.role==='pc';
  document.getElementById('dashDoerHead').textContent = (isAdmin||isPC)?'Doer':'Assigned By';
  // Sirf type se filter karo (all / delegation / checklist). Status ka filter
  // server par lagta hai — chune hue card ke hisaab se — isliye yahan dobara
  // 'pending' check karna galat hoga, Completed/Revised list hamesha khali aati.
  let allPending = tasks.filter(t => (!type || type === 'all') ? true : t.type === type);
  // Apply date sort
  if (_dashDateSortState === 1) {
    // Ascending: oldest (earliest) date first — aaj ki pehle aaye
    allPending = [...allPending].sort((a,b) => (a.due_date||a.date||'').localeCompare(b.due_date||b.date||''));
  } else if (_dashDateSortState === 2) {
    // Descending: newest (latest) date first
    allPending = [...allPending].sort((a,b) => (b.due_date||b.date||'').localeCompare(a.due_date||a.date||''));
  }
  if (!allPending.length) { tbody.innerHTML=`<tr><td colspan="6" class="empty">${DASH_CARD_EMPTY[dashCard] || 'No tasks'}</td></tr>`; return; }
  const typeBadge = t => t.type==='checklist'
    ? `<span style="font-size:10px;background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid color-mix(in srgb,var(--success) 22%,transparent)">✅ Checklist</span>`
    : `<span style="font-size:10px;background:var(--accent);color:var(--accent-foreground);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid var(--accent)">📋 Delegation</span>`;
  tbody.innerHTML = allPending.map(t=>`
    <tr>
      <td style="white-space:nowrap">${typeBadge(t)}</td>
      <td>${t.description||t.desc}</td>
      <td>${(isAdmin||isPC)?t.assignedToName:t.assignedByName}</td>
      <td style="white-space:nowrap">${fmtDate(t.due_date||t.date)}</td>
      <td>${t.type!=='checklist' ? `<span class="priority-badge ${t.priority||'low'}">${t.priority||'low'}</span>` : '—'}</td>
      <td style="white-space:nowrap">
        ${dashProofAllBtns(t)}
        ${t.status === 'completed' ? `
          <span style="font-size:11px;color:var(--success);font-weight:600">✅ Completed</span>
        ` : t.waiting_approval==1 ? `
          <span style="font-size:11px;color:var(--warning);font-weight:600">⏳ Waiting Approval</span>
          ${remarkBtn(t, t.type, 'left')}
          ${(!isPC || t.type==='checklist') ? dashDoneBtn(t) : ''}
        ` : `
          ${remarkBtn(t, t.type, 'left')}
          ${(!isPC || t.type==='checklist') ? dashDoneBtn(t) : ''}
          ${(!isPC && t.type!=='checklist') ? `<button class="action-btn revise" style="margin-left:3px" onclick="openReviseModal(${t.id},'${t.type}')">Revise</button>` : ''}
        `}
      </td>
    </tr>`).join('')
    + (window._dashListTruncated ? `<tr><td colspan="6" style="padding:10px 12px;text-align:center;font-size:12px;color:var(--muted-foreground);background:var(--muted)">
        Showing the first 500 — use the employee filter to narrow this list
      </td></tr>` : '');
}

// Dashboard ke pending table ke liye proof + done buttons (All Tasks jaise hi rules)
function dashProofBtns(t) {
  if (isTaskActionDisabled('proofPhoto')) return '';
  const desc = (t.description||t.desc||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  // Completed card ki wajah se ab yahan done tasks bhi aa sakte hain — un par
  // upload/replace nahi dikhate, sirf dekhne wala button. All Tasks page par
  // pehle se yahi niyam hai.
  const done = t.status === 'completed';
  if (!t.has_proof) {
    if (done) return '';
    return `<button class="action-btn" style="background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:4px 7px;margin-right:3px" onclick="uploadProof(${t.id},'${t.type}',false)" title="Upload proof photo (optional)">📷</button>`;
  }
  // Photo lag chuki hai — ab camera ki jagah 👁 (dekhne ke liye)
  const view = `<button class="action-btn" style="background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:4px 7px;margin-right:3px" onclick="viewProof(${t.id},'${t.type}','${desc}')" title="View proof photo">👁️</button>`;
  const replace = (done || t.proof_replaced == 1) ? ''
    : `<button class="action-btn" style="background:var(--muted);color:var(--chart-1);padding:4px 7px;margin-right:3px" onclick="uploadProof(${t.id},'${t.type}',true)" title="Replace photo (allowed only once)">♻️</button>`;
  return view + replace;
}
// Dashboard: photo buttons ke baad video buttons (dono slot alag hain)
function dashProofAllBtns(t) {
  return dashProofBtns(t) + proofVideoBtns(t, t.type, 'right', true);
}
function dashDoneBtn(t) {
  // Proof photo abhi optional hai — Done bina photo ke bhi chalega
  return `<button class="action-btn done" style="margin-left:3px" onclick="updateStatus(${t.id},'completed','dashboard','${t.type}')">Done</button>`;
}

// User-typed text ko innerHTML me daalne se pehle escape karo (XSS se bachav)
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 📝 Doer remark button — sirf PENDING tasks par. Remark ho to view (📝),
// na ho to add (sirf doer ya admin). Edit/delete modal me sirf admin ko.
function remarkBtn(t, type, side) {
  if (isTaskActionDisabled('doerRemark')) return '';
  if (t.status === 'completed') return '';
  const m = `margin-${side || 'left'}:3px`;
  const isAdmin = ME && ME.role === 'admin';
  const isDoer = ME && String(t.assigned_to) === String(ME.id);
  const hasRemark = !!(t.doer_remark && String(t.doer_remark).trim());
  if (hasRemark) {
    return `<button class="action-btn" style="background:var(--muted);color:var(--chart-5);padding:4px 7px;${m}" onclick="viewRemark(${t.id},'${type}')" title="View remark">📝</button>`;
  }
  if (isDoer || isAdmin) {
    return `<button class="action-btn" style="background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:4px 7px;${m}" onclick="addRemark(${t.id},'${type}')" title="Add remark — why the task isn't done">📝</button>`;
  }
  return '';
}

function _refreshAfterRemark() {
  if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
  else if (document.getElementById('page-alltasks').classList.contains('active')) loadAllTasks();
}

// Doer (ya admin) remark add kare — ek baar. Save ke baad doer ke liye locked.
async function addRemark(id, type) {
  const text = await promptDialog(
    "Why is this task not done yet? This is saved only once and cannot be edited later.",
    { title: 'Add Remark', okText: 'Save Remark', placeholder: 'Type the reason…' });
  if (text === null) return;
  const val = (text || '').trim();
  if (!val) { showToast('Remark cannot be empty', 'error'); return; }
  const r = await api(`/api/tasks/${id}/remark?type=${type}`, 'POST', { remark: val });
  if (r.error) { showToast(r.error, 'error'); return; }
  showToast('✅ Remark added');
  _refreshAfterRemark();
}

// Remark dekho — admin ko modal me Edit/Delete milega
async function viewRemark(id, type) {
  const r = await api(`/api/tasks/${id}/remark?type=${type}`);
  if (r.error) { showToast(r.error, 'error'); return; }
  document.getElementById('remarkModalBody').textContent = r.remark || '(empty)';
  const admin = document.getElementById('remarkAdminActions');
  admin.style.display = r.canEdit ? 'flex' : 'none';
  if (r.canEdit) {
    document.getElementById('remarkEditBtn').onclick = () => editRemark(id, type, r.remark);
    document.getElementById('remarkDeleteBtn').onclick = () => deleteRemark(id, type);
  }
  document.getElementById('remarkModal').classList.add('open');
}

// Admin edit — prefilled prompt
async function editRemark(id, type, current) {
  const text = await promptDialog('Edit remark', { title: 'Edit Remark', okText: 'Save', defaultValue: current || '' });
  if (text === null) return;
  const val = (text || '').trim();
  if (!val) { showToast('Remark cannot be empty', 'error'); return; }
  const r = await api(`/api/tasks/${id}/remark?type=${type}`, 'POST', { remark: val });
  if (r.error) { showToast(r.error, 'error'); return; }
  showToast('✅ Remark updated');
  closeModal('remarkModal');
  _refreshAfterRemark();
}

// Admin delete
async function deleteRemark(id, type) {
  if (!await confirmDialog('Delete this remark?', { title: 'Delete Remark', okText: 'Yes, delete', danger: true })) return;
  const r = await api(`/api/tasks/${id}/remark?type=${type}`, 'DELETE');
  if (r.error) { showToast(r.error, 'error'); return; }
  showToast('Remark deleted');
  closeModal('remarkModal');
  _refreshAfterRemark();
}

// ── Overview cards — click par neeche wali table filter hoti hai ──
const DASH_CARD_TITLE = {
  all:       'All Tasks',
  upcoming:  'Upcoming Tasks (Future Due Date)',
  pending:   'All Pending Tasks',
  revised:   'Revised Tasks',
  completed: 'Completed Tasks',
};
const DASH_CARD_EMPTY = {
  all:       'No tasks',
  upcoming:  'No upcoming tasks this month',
  pending:   'No pending tasks 🎉',
  revised:   'No revised tasks',
  completed: 'No completed tasks yet',
};

function syncDashCards() {
  document.querySelectorAll('.overview-cards .ov-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('card-' + dashCard)?.classList.add('selected');
  const title = document.getElementById('dashTableTitle');
  if (title) title.textContent = DASH_CARD_TITLE[dashCard] || 'Tasks';
}

function selectDashCard(card) {
  dashCard = card;
  syncDashCards();
  loadDashList();
}

// Sirf table ki list dobara laata hai. Counts, pie chart aur employee dropdown ko
// haath nahi lagata — warna har card click par poora dashboard blink karta.
async function loadDashList() {
  const tbody = document.getElementById('dashTbody');
  tbody.innerHTML = `<tr><td colspan="6" class="empty">Loading…</td></tr>`;
  const baseUrl = dashBaseUrl();
  const [dDel, dChl] = await Promise.all([
    api(baseUrl + 'delegation&list=' + dashCard),
    api(baseUrl + 'checklist&list=' + dashCard)
  ]);
  if (dDel.error || dChl.error) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:red;padding:16px;text-align:center">⚠️ Could not load tasks: ${dDel.error || dChl.error}</td></tr>`;
    return;
  }
  setDashTasks(dDel, dChl);
  renderDashTable(window._lastDashTasks, dashType);
}

// Server har list par LIMIT 500 lagata hai. Completed jaisi list hazaron ki ho
// sakti hai — bina bataye kaat dena matlab user ko lagega itne hi tasks hain.
function setDashTasks(dDel, dChl) {
  const del = dDel.todayPending || [], chl = dChl.todayPending || [];
  window._lastDashTasks = [...del, ...chl];
  window._dashListTruncated = del.length >= 500 || chl.length >= 500;
}

// ══════════════════════════════════════════════════════
// ALL TASKS
// ══════════════════════════════════════════════════════
let allTasksData = [];
let taskStatusFilter = 'pending';

let allTasksPage = 1;
const ALL_TASKS_PAGE_SIZE = 50;

async function loadAllTasks() {
  // Tabs ka highlight filter state se aata hai, tab par hue click se nahi —
  // isliye har load par sync kar lete hain.
  syncTaskTabs();

  const isAdmin = ME.role==='admin';
  const isHod = ME.role==='hod';
  const isPC = ME.role==='pc';
  const isUser = ME.role==='user';
  const isDesktop = window.innerWidth >= 768;

  // Show/hide assign task button based on role
  const assignBtn = document.getElementById('tasksAssignBtn');
  if (assignBtn) assignBtn.style.display = (isAdmin || isHod || isUser) ? '' : 'none';

  // Delegate by Me button — sirf un users ko dikhao jo task assign kar sakte hain
  const dbmBtn = document.getElementById('delegateByMeBtn');
  if (dbmBtn) dbmBtn.style.display = (isAdmin || isHod || isUser) ? '' : 'none';

  // PC desktop: show user filter + date range
  const filtersDiv = document.getElementById('tasksUserDateFilters');
  if (filtersDiv) {
    if (isPC && isDesktop) {
      filtersDiv.style.display = 'flex';
    } else {
      filtersDiv.style.display = 'none';
    }
  }

  // FMS ka apna endpoint hai — rows Google Sheet se aati hain, tasks table se nahi.
  if (tasksType === 'fms') {
    const empVal = document.getElementById('tasksUserFilter')?.value || 'all';
    const canFilter = isAdmin || isHod || isPC;
    const fms = await api(`/api/fms-dashboard${canFilter ? `?employee=${empVal}` : ''}`);
    _fmsTasksRows = (fms && !fms.error && Array.isArray(fms.rows)) ? fms.rows : [];
    allTasksData = [];
    allTasksPage = 1;
    renderTasksTable();
    return;
  }

  // includeFuture=1 — warna server checklist ke future tasks chhupa deta hai aur Upcoming tab hamesha khali rehta
  const data = await api(withSeg(`/api/tasks?type=${tasksType}&includeFuture=1`));

  // Flatten all tasks — admin, HOD and PC get grouped response
  let allTasks = [];
  if (isAdmin || isHod || ME.role==='pc') {
    (data.grouped||[]).forEach(g => {
      g.tasks.forEach(t => allTasks.push(t));
    });
  } else {
    allTasks = data.tasks || [];
  }
  allTasksData = allTasks;
  allTasksPage = 1;

  // PC desktop: populate user dropdown
  if (isPC && isDesktop) {
    const userSel = document.getElementById('tasksUserFilter');
    if (userSel) {
      const prevVal = userSel.value;
      const uniqueUsers = {};
      allTasks.forEach(t => {
        if (t.assignedToId && t.assignedToName) uniqueUsers[t.assignedToId] = t.assignedToName;
      });
      userSel.innerHTML = '<option value="all">All Employees</option>';
      Object.entries(uniqueUsers).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        userSel.appendChild(opt);
      });
      if (prevVal && [...userSel.options].some(o => o.value === prevVal)) userSel.value = prevVal;
    }
  }

  renderTasksTable();
}

function clearTasksDateFilter() {
  const f = document.getElementById('tasksDateFrom');
  const t = document.getElementById('tasksDateTo');
  if (f) f.value = '';
  if (t) t.value = '';
  filterTasks();
}

function filterTasks() { renderTasksTable(); }

function filterTaskStatus(status) {
  taskStatusFilter = status;
  expandedDoers.clear();
  syncTaskTabs();
  renderTasksTable();
}

// Dono tab groups ko current filter ke hisaab se highlight karo. Alag function
// isliye kyunki highlight filter ki state se aata hai, kisi tab par hue click se
// nahi — sirf onclick par bharosa nahi kar sakte.
const TASK_STATUS_TAB_ID = {
  all:'statusTabAll', pending:'statusTabPending', upcoming:'statusTabUpcoming',
  revised:'statusTabRevised', completed:'statusTabCompleted',
};
function syncTaskTabs() {
  // Revised sirf delegation me hota hai
  const revisedTab = document.getElementById('statusTabRevised');
  if (revisedTab) revisedTab.style.display = (tasksType === 'checklist' || tasksType === 'fms') ? 'none' : '';

  // FMS me sirf pending rows aati hain (plan bhara, actual khaali) — status
  // filter ka koi matlab nahi, isliye poora group hi chhupa dete hain.
  const statusGroup = document.getElementById('tasksStatusTabGroup');
  if (statusGroup) statusGroup.style.display = tasksType === 'fms' ? 'none' : '';

  document.querySelectorAll('#tasksStatusTabGroup .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(TASK_STATUS_TAB_ID[taskStatusFilter])?.classList.add('active');

  document.querySelectorAll('#tasksTypeTabGroup .tab').forEach(t=>t.classList.remove('active'));
  const typeTabId = tasksType === 'fms' ? 'tasksTabFms'
    : tasksType === 'checklist' ? 'tasksTabChl' : 'tasksTabDel';
  document.getElementById(typeTabId)?.classList.add('active');
}

let expandedDoers = new Set();
let _lastDoerIds = [];

function toggleDoerGroup(id) {
  if (expandedDoers.has(id)) expandedDoers.delete(id); else expandedDoers.add(id);
  renderTasksTable();
}
function expandAllDoers() { _lastDoerIds.forEach(id=>expandedDoers.add(id)); renderTasksTable(); }
function collapseAllDoers() { expandedDoers.clear(); renderTasksTable(); }

// All Tasks → FMS tab ki pending rows (/api/fms-dashboard se)
let _fmsTasksRows = [];

// Ek FMS pending row ka <tr>. Delegation/checklist rows se shape alag hai —
// yahan FMS + Step, sheet ke configured "show" columns, aur plan date/time dikhte hain.
function _buildFmsRowHtml(t) {
  const lateBadge = t.isLate
    ? `<span style="font-size:10px;background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent)">⏰ Late</span>`
    : `<span style="font-size:10px;background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:2px 8px;border-radius:10px;font-weight:700;border:1px solid color-mix(in srgb,var(--success) 22%,transparent)">✅ On Track</span>`;
  let dateCell;
  if (t.planDate) {
    const timePart = t.planTime
      ? `<span style="color:var(--muted-foreground);font-size:11px;font-weight:500;display:block;margin-top:1px">🕒 ${fmsEscape(t.planTime)}</span>` : '';
    dateCell = `<span style="${t.isLate?'color:var(--destructive);font-weight:700':''}">${fmsEscape(t.planDate.split('-').reverse().join('/'))}</span>${timePart}`;
  } else {
    dateCell = `<span style="color:var(--muted-foreground);font-size:12px">${fmsEscape(t.planValue||'—')}</span>`;
  }
  const detailsHtml = (Array.isArray(t.details) && t.details.length)
    ? t.details.map(d => `<div style="display:flex;gap:6px;align-items:baseline;font-size:12px;line-height:1.45">
        <span style="font-size:10px;font-weight:700;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;white-space:nowrap">${fmsEscape(d.header||'—')}:</span>
        <span style="color:var(--foreground)">${fmsEscape(d.value||'—')}</span>
      </div>`).join('')
    : '<span style="color:var(--muted-foreground);font-size:12px">—</span>';
  const refArg = JSON.stringify({ fmsId: t.fmsId, stepId: t.stepId, rowNumber: t.rowNumber }).replace(/"/g, '&quot;');
  return `<tr>
    <td style="vertical-align:top">
      <div style="font-weight:700;color:var(--foreground);font-size:13.5px">${fmsEscape(t.fmsName||'')}</div>
      <div style="color:var(--muted-foreground);font-size:11px;margin-top:2px">↳ ${fmsEscape(t.stepName||'')}</div>
      <div style="color:var(--muted-foreground);font-size:11px;margin-top:3px">Doer: ${fmsEscape(t.doer||'—')}</div>
    </td>
    <td style="vertical-align:top;max-width:380px">${detailsHtml}</td>
    <td style="vertical-align:top;white-space:nowrap">
      <div>${dateCell}</div>
      <div style="margin-top:4px">${lateBadge}</div>
    </td>
    <td style="vertical-align:top;white-space:nowrap">
      <button class="action-btn done" onclick='openFmsDoneFromRow(${refArg})' title="Mark this FMS row done">✅ Done</button>
      <button class="action-btn" style="background:var(--muted);color:var(--chart-1);padding:4px 8px;margin-left:4px" onclick='openFmsTaskFromRow(${refArg})' title="Open in FMS Tasks page">Open</button>
    </td>
  </tr>`;
}

function renderFmsTasksTable() {
  const container = document.getElementById('tasksContent');
  const search = (document.getElementById('taskSearch')?.value||'').toLowerCase();
  const dateFrom = document.getElementById('tasksDateFrom')?.value || '';
  const dateTo = document.getElementById('tasksDateTo')?.value || '';

  const rows = _fmsTasksRows.filter(t => {
    const matchSearch = !search ||
      (t.fmsName||'').toLowerCase().includes(search) ||
      (t.stepName||'').toLowerCase().includes(search) ||
      (t.doer||'').toLowerCase().includes(search) ||
      (t.planValue||'').toLowerCase().includes(search) ||
      (t.details||[]).some(d => (d.value||'').toLowerCase().includes(search));
    const matchFrom = !dateFrom || (t.planDate && t.planDate >= dateFrom);
    const matchTo   = !dateTo   || (t.planDate && t.planDate <= dateTo);
    return matchSearch && matchFrom && matchTo;
  });

  _lastDoerIds = [];

  if (!rows.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No pending FMS rows</div>`;
    return;
  }

  const lateCount = rows.filter(r => r.isLate).length;
  container.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:10px;font-size:13px;color:var(--muted-foreground)">
      <span><b style="color:var(--foreground)">${rows.length}</b> pending row(s)</span>
      ${lateCount ? `<span style="color:var(--destructive)"><b>${lateCount}</b> late</span>` : ''}
    </div>
    <div class="fms-step-rows-table">
      <table>
        <thead><tr><th>FMS / Step</th><th>Details</th><th>Planned</th><th>Action</th></tr></thead>
        <tbody>${rows.map(_buildFmsRowHtml).join('')}</tbody>
      </table>
    </div>`;
}

// FMS Tasks page kholo aur wahi FMS select kar do.
async function openFmsTaskFromRow(ref) {
  try {
    if (!ref || !ref.fmsId) return;
    navigate('fms-tasks', document.getElementById('nav-fms-tasks'));
    // Page ka dropdown async bhar-ta hai — thodi der option ka intezaar karo.
    for (let tries = 0; tries < 20; tries++) {
      const sel = document.getElementById('fmsTasksSelect');
      if (sel && [...sel.options].some(o => String(o.value) === String(ref.fmsId))) {
        sel.value = String(ref.fmsId);
        await onFMSTasksSelect();
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }
  } catch(e) { console.error(e); }
}

// All Tasks → FMS row se seedhe Done modal — FMS Tasks page par jaane ki zaroorat nahi.
async function openFmsDoneFromRow(ref) {
  try {
    if (!ref || !ref.fmsId || !ref.stepId || !ref.rowNumber) {
      showToast('Missing FMS row reference', 'error');
      return;
    }

    // Active FMS/step set karo — saveFMSDone() aur modal yahi se uthate hain.
    fmsTasksActiveFmsId = Number(ref.fmsId);
    fmsTasksActiveStepId = Number(ref.stepId);

    const [stepsData, rowsData] = await Promise.all([
      api(`/api/fms-tasks/${ref.fmsId}`),
      api(`/api/fms-tasks/${ref.fmsId}/steps/${ref.stepId}/rows`)
    ]);

    if (stepsData?.error) { showToast(stepsData.error, 'error'); return; }
    if (rowsData?.error)  { showToast(rowsData.error,  'error'); return; }

    const steps = stepsData?.steps || [];
    const step = steps.find(s => Number(s.id) === Number(ref.stepId));
    if (step && !(step.isMyStep || ME.role === 'admin')) {
      showToast('This FMS step is not assigned to you', 'error');
      return;
    }
    window._fmsAllSteps = steps;
    window._fmsActiveStepData = step || null;

    const rows = rowsData?.rows || [];
    const idx = rows.findIndex(r => Number(r.sheetRowNumber) === Number(ref.rowNumber));
    if (idx < 0) {
      showToast('This row is no longer pending — it may already be done', 'error');
      loadAllTasks(); // stale row list se hata do
      return;
    }
    window._fmsCurrentRows = rows;

    openFMSDoneModal(idx);
  } catch(e) { console.error(e); showToast('Could not open the Done modal: ' + e.message, 'error'); }
}

function renderTasksTable() {
  if (tasksType === 'fms') return renderFmsTasksTable();
  const isAdmin = ME.role==='admin' || ME.role==='hod'; // HOD gets admin-like view
  // PC gets view-only — see ME.role==='pc' branch in actionBtns below
  const search = (document.getElementById('taskSearch')?.value||'').toLowerCase();
  const userFilterVal = document.getElementById('tasksUserFilter')?.value || 'all';
  const dateFrom = document.getElementById('tasksDateFrom')?.value || '';
  const dateTo = document.getElementById('tasksDateTo')?.value || '';
  const container = document.getElementById('tasksContent');
  const today = new Date().toISOString().split('T')[0];

  let tasks = allTasksData.filter(t => {
    const matchStatus =
      taskStatusFilter === 'all' ? true :
      taskStatusFilter === 'pending' ? (t.status === 'pending' && (!t.due_date || t.due_date <= today)) :
      taskStatusFilter === 'upcoming' ? (t.status === 'pending' && t.due_date && t.due_date > today) :
      taskStatusFilter === 'completed' ? t.status === 'completed' :
      t.status === taskStatusFilter;
    const matchSearch = !search ||
      (t.description||'').toLowerCase().includes(search) ||
      (t.assignedToName||'').toLowerCase().includes(search) ||
      (t.assignedByName||'').toLowerCase().includes(search) ||
      (t.due_date||'').includes(search) ||
      (t.assigned_on||'').includes(search) ||
      (t.remarks||'').toLowerCase().includes(search) ||
      (t.status||'').toLowerCase().includes(search) ||
      (t.priority||'').toLowerCase().includes(search);
    const matchUser = userFilterVal === 'all' || String(t.assignedToId) === String(userFilterVal);
    const matchDateFrom = !dateFrom || (t.due_date && t.due_date >= dateFrom);
    const matchDateTo = !dateTo || (t.due_date && t.due_date <= dateTo);
    return matchStatus && matchSearch && matchUser && matchDateFrom && matchDateTo;
  });

  if (!tasks.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No tasks found</div>`;
    _lastDoerIds = [];
    return;
  }

  const isChecklist = tasksType === 'checklist';

  // 📷 Proof photo — optional. Upload -> View + ek baar Replace allowed.
  function proofBtns(t) {
    if (isTaskActionDisabled('proofPhoto')) return '';
    const desc = (t.description||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    if (!t.has_proof) {
      if (t.status === 'completed') return '';
      return `<button class="action-btn" style="background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:4px 7px;margin-left:3px" onclick="uploadProof(${t.id},'${tasksType}',false)" title="Upload proof photo (optional)">📷</button>`;
    }
    // Photo lag chuki hai — ab camera ki jagah 👁 (dekhne ke liye)
    const view = `<button class="action-btn" style="background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:4px 7px;margin-left:3px" onclick="viewProof(${t.id},'${tasksType}','${desc}')" title="View proof photo">👁️</button>`;
    const replace = (t.status === 'completed' || t.proof_replaced == 1) ? ''
      : `<button class="action-btn" style="background:var(--muted);color:var(--chart-1);padding:4px 7px;margin-left:3px" onclick="uploadProof(${t.id},'${tasksType}',true)" title="Replace photo (allowed only once)">♻️</button>`;
    return view + replace;
  }
  // Photo buttons ke baad video buttons — dono slot alag hain
  function proofAllBtns(t) {
    return proofBtns(t) + proofVideoBtns(t, tasksType, 'left', true);
  }
  // Proof photo abhi optional hai — Done bina photo ke bhi chalega
  function doneBtn(t) {
    return `<button class="action-btn done" style="margin-left:3px" onclick="updateStatus(${t.id},'completed','alltasks','${tasksType}')">Done</button>`;
  }

  function actionBtnsFor(t) {
    const isCompleted = t.status === 'completed';
    const isWaiting = t.waiting_approval == 1;
    return isAdmin ? `
      <button class="action-btn edit" style="padding:4px 7px" onclick="openEditTask(${t.id},'${tasksType}')" title="Edit">✏️</button>
      <button class="action-btn delete" style="padding:4px 7px;margin-left:3px" onclick="deleteTask(${t.id},'${tasksType}')" title="Delete">🗑</button>
      <button class="action-btn" style="background:var(--accent);color:var(--accent-foreground);padding:4px 7px;margin-left:3px" onclick="openComments(${t.id},'${tasksType}')" title="Comments">💬</button>
      ${proofAllBtns(t)}
      ${remarkBtn(t, tasksType, 'left')}
      ${!isCompleted && !isWaiting ? doneBtn(t) : ''}
      ${!isChecklist && !isCompleted && !isWaiting ? `<button class="action-btn revise" style="margin-left:3px" onclick="openReviseModal(${t.id},'${tasksType}')">Revise</button>` : ''}
      ${isWaiting ? `<span style="font-size:11px;color:var(--warning);font-weight:600;margin-left:4px">⏳ Waiting</span>` : ''}
    ` : (ME.role==='pc') ? `
      <button class="action-btn" style="background:var(--accent);color:var(--accent-foreground);padding:4px 7px" onclick="openComments(${t.id},'${tasksType}')" title="Comments">💬</button>
      ${proofAllBtns(t)}
      ${remarkBtn(t, tasksType, 'left')}
      ${isChecklist && !isCompleted && !isWaiting ? doneBtn(t) : ''}
      ${isWaiting ? `<span style="font-size:11px;color:var(--warning);font-weight:600;margin-left:4px">⏳ Waiting</span>` : ''}
    ` : `
      <button class="action-btn" style="background:var(--accent);color:var(--accent-foreground);padding:4px 7px" onclick="openComments(${t.id},'${tasksType}')" title="Comments">💬</button>
      ${proofAllBtns(t)}
      ${remarkBtn(t, tasksType, 'left')}
      ${!isCompleted && !isWaiting ? `
        ${doneBtn(t)}
        ${!isChecklist ? `<button class="action-btn revise" style="margin-left:3px" onclick="openReviseModal(${t.id},'${tasksType}')">Revise</button>` : ''}
      ` : ''}
      ${isWaiting ? `
        ${doneBtn(t)}
        <span style="font-size:11px;color:var(--warning);font-weight:600;margin-left:4px">⏳ Waiting</span>` : ''}
    `;
  }

  function rowFor(t) {
    return `<tr>
      <td style="white-space:nowrap">${actionBtnsFor(t)}</td>
      <td>${t.description||''}</td>
      <td>${t.assignedToName||''}</td>
      <td>${t.assignedByName||''}</td>
      <td style="white-space:nowrap">${fmtDate(t.due_date||'')||'—'}</td>
      <td style="color:var(--muted-foreground)">${t.remarks||'—'}</td>
      <td><span class="status-badge ${t.status}">${t.status==='revised'?'Revision Requested':t.status.charAt(0).toUpperCase()+t.status.slice(1)}</span></td>
    </tr>`;
  }

  // Group by doer (assigned_to)
  const groups = {};
  tasks.forEach(t => {
    const key = String(t.assigned_to ?? t.assignedToId ?? t.assignedToName);
    if (!groups[key]) groups[key] = { id: key, name: t.assignedToName || 'Unknown', tasks: [] };
    groups[key].tasks.push(t);
  });
  const groupList = Object.values(groups).sort((a,b)=>a.name.localeCompare(b.name));
  _lastDoerIds = groupList.map(g=>g.id);

  const groupsHtml = groupList.map(g => {
    const total = g.tasks.length;
    const pending = g.tasks.filter(t=>t.status==='pending').length;
    const revised = g.tasks.filter(t=>t.status==='revised').length;
    const completed = g.tasks.filter(t=>t.status==='completed').length;
    const isOpen = expandedDoers.has(g.id);
    const rows = g.tasks.map(rowFor).join('');
    return `
      <div style="border-bottom:1px solid var(--muted)">
        <div onclick="toggleDoerGroup('${g.id}')" style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;user-select:none">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="color:var(--muted-foreground);font-size:11px;transition:transform .15s;display:inline-block;transform:rotate(${isOpen?90:0}deg)">▶</span>
            <strong style="font-size:14px">${g.name}</strong>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <span class="status-badge" style="background:var(--muted);color:var(--muted-foreground)">${total} total</span>
            ${pending?`<span class="status-badge pending">${pending} pending</span>`:''}
            ${revised?`<span class="status-badge revised">${revised} revised</span>`:''}
            ${completed?`<span class="status-badge completed">${completed} completed</span>`:''}
          </div>
        </div>
        ${isOpen ? `
          <div style="overflow-x:auto">
            <table style="min-width:760px">
              <thead><tr>
                <th>Action</th><th>Desc</th><th>Doer</th><th>Assignee</th><th>Date</th><th>Remarks</th><th>Status</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="flat-tasks-table">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--muted)">
        <span style="font-size:13px;color:var(--muted-foreground)">${groupList.length} doers · ${tasks.length} tasks</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="expandAllDoers()">Expand all</button>
          <button class="btn btn-outline btn-sm" onclick="collapseAllDoers()">Collapse all</button>
        </div>
      </div>
      ${groupsHtml}
    </div>`;
}

function tasksTab(type) {
  tasksType = type;
  expandedDoers.clear();
  // Revised par rehte hue Checklist/FMS par switch kiya to list hamesha khali milti —
  // Pending par le aate hain taaki kuch to dikhe.
  if ((type === 'checklist' || type === 'fms') && taskStatusFilter === 'revised') taskStatusFilter = 'pending';
  syncTaskTabs();
  loadAllTasks();
}

function toggleBlock(header) { header.nextElementSibling.classList.toggle('open'); }

// ══════════════════════════════════════════════════════
// TASK ACTIONS
// ══════════════════════════════════════════════════════
async function updateStatus(id, status, from, type) {
  const r = await api(`/api/tasks/${id}/status`,'PUT',{status, type: type || dashType});
  if (r.needsApproval) {
    showToast('✅ Approval request sent to your manager!');
  }
  if (from==='dashboard') loadDashboard(); else loadAllTasks();
  loadApprovalBadge();
}

async function deleteTask(id, type) {
  if (!await confirmDialog('Delete this task? This cannot be undone.', {title:'Delete Task', okText:'Delete', danger:true})) return;
  await api(`/api/tasks/${id}?type=${type||tasksType}`,'DELETE');
  loadAllTasks();
}

// ══════════════════════════════════════════════════════
// REVISE DATE MODAL
// ══════════════════════════════════════════════════════
function openReviseModal(taskId, taskType) {
  const today = new Date().toISOString().split('T')[0];
  // Min date = tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  document.getElementById('reviseTaskId').value = taskId;
  document.getElementById('reviseTaskType').value = taskType;
  document.getElementById('reviseDate').value = '';
  document.getElementById('reviseDate').min = minDate;
  document.getElementById('reviseReason').value = '';
  document.getElementById('reviseErr').style.display = 'none';
  document.getElementById('reviseDateModal').classList.add('open');
}

async function submitRevise() {
  const taskId   = document.getElementById('reviseTaskId').value;
  const taskType = document.getElementById('reviseTaskType').value;
  const newDate  = document.getElementById('reviseDate').value;
  const reason   = document.getElementById('reviseReason').value.trim();
  const err      = document.getElementById('reviseErr');
  err.style.display = 'none';

  if (!newDate) { err.textContent='Please select a new date'; err.style.display='block'; return; }

  // Send revise request with new date
  const r = await api(`/api/tasks/${taskId}/status`,'PUT',{
    status: 'revised',
    type: taskType,
    newDate,
    reason
  });

  if (r.error) { err.textContent = r.error; err.style.display='block'; return; }

  closeModal('reviseDateModal');
  if (r.needsApproval) {
    showToast('✅ Revision request sent to manager!');
  } else {
    showToast('Task revised with new date!');
  }
  loadDashboard();
  loadAllTasks();
  loadApprovalBadge();
}

// ══════════════════════════════════════════════════════
// EDIT TASK MODAL (Admin only)
// ══════════════════════════════════════════════════════
async function openEditTask(id, type) {
  // Fetch task details
  const data = await api(`/api/tasks/${id}/detail?type=${type}`);
  if (data.error) { showToast(data.error,'error'); return; }
  const t = data.task;

  document.getElementById('editTId').value = id;
  document.getElementById('editTType').value = type;
  document.getElementById('editTDesc').value = t.description || '';
  document.getElementById('editTDate').value = t.due_date || '';
  document.getElementById('editTRemarks').value = t.remarks || '';
  document.getElementById('editTaskErr').style.display = 'none';

  // Show/hide priority and approval for delegation only
  const isDeleg = type === 'delegation';
  document.getElementById('editTPriorityWrap').style.display = isDeleg ? 'block' : 'none';
  document.getElementById('editTApprovalWrap').style.display = isDeleg ? 'block' : 'none';
  if (isDeleg) {
    document.getElementById('editTPriority').value = t.priority || 'low';
    document.getElementById('editTApproval').value = t.approval || 'no';
  }

  document.getElementById('editTaskModal').classList.add('open');
}

async function saveEditTask() {
  const id      = document.getElementById('editTId').value;
  const type    = document.getElementById('editTType').value;
  const desc    = document.getElementById('editTDesc').value.trim();
  const date    = document.getElementById('editTDate').value;
  const remarks = document.getElementById('editTRemarks').value.trim();
  const err     = document.getElementById('editTaskErr');
  err.style.display = 'none';

  if (!desc) { err.textContent='Description required'; err.style.display='block'; return; }
  if (!date)  { err.textContent='Date required'; err.style.display='block'; return; }

  const body = { desc, date, remarks, type };
  if (type === 'delegation') {
    body.priority = document.getElementById('editTPriority').value;
    body.approval = document.getElementById('editTApproval').value;
  }

  const r = await api(`/api/tasks/${id}/edit`,'PUT', body);
  if (r.error) { err.textContent = r.error; err.style.display='block'; return; }

  closeModal('editTaskModal');
  showToast('Task updated!');
  loadAllTasks();
}

// ══════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════
async function openComments(taskId, taskType) {
  document.getElementById('commentTaskId').value = taskId;
  document.getElementById('commentTaskType').value = taskType;
  document.getElementById('commentInput').value = '';
  await loadComments(taskId, taskType);
  document.getElementById('commentModal').classList.add('open');
}

async function loadComments(taskId, taskType) {
  const comments = await api(`/api/comments/${taskType}/${taskId}`);
  const container = document.getElementById('commentsList');
  if (!comments.length) {
    container.innerHTML = `<div class="comment-empty">No comments yet. Be the first!</div>`;
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">👤 ${c.userName}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="comment-time">${new Date(c.created_at).toLocaleString('en-IN')}</span>
          <button class="action-btn delete" style="padding:2px 7px;font-size:10px" onclick="deleteComment(${c.id})">✕</button>
        </div>
      </div>
      <div class="comment-text">${c.comment}</div>
    </div>`).join('');
  container.scrollTop = container.scrollHeight;
}

async function addComment() {
  const taskId = document.getElementById('commentTaskId').value;
  const taskType = document.getElementById('commentTaskType').value;
  const comment = document.getElementById('commentInput').value.trim();
  if (!comment) return;
  await api('/api/comments','POST',{taskId, taskType, comment});
  document.getElementById('commentInput').value = '';
  await loadComments(taskId, taskType);
}

async function deleteComment(id) {
  if (!await confirmDialog('Delete this comment?', {title:'Delete Comment', okText:'Delete', danger:true})) return;
  await api(`/api/comments/${id}`,'DELETE');
  const taskId = document.getElementById('commentTaskId').value;
  const taskType = document.getElementById('commentTaskType').value;
  await loadComments(taskId, taskType);
}

async function bulkDelete(userId) {
  if (!await confirmDialog(`Delete all ${tasksType} tasks for this user? This cannot be undone.`, {title:'Delete All Tasks', okText:'Delete all', danger:true})) return;
  await api(`/api/tasks/user/${userId}?type=${tasksType}`,'DELETE');
  loadAllTasks();
}

async function transferToday(userId) {
  await api(`/api/tasks/user/${userId}/transfer-today?type=${tasksType}`,'PUT');
  loadAllTasks();
  showToast('Tasks moved to today!');
}

// ══════════════════════════════════════════════════════
// DELEGATE MODAL
// ══════════════════════════════════════════════════════
async function openDelegate() {
  document.getElementById('delegateErr').style.display='none';
  document.getElementById('bulkFile').value=''; // purani selected file clear karo, warna dobara "Upload CSV" dabane par wahi purani file phir upload ho jaati hai
  document.getElementById('dDesc').value='';
  document.getElementById('dRemarks').value='';
  document.getElementById('dUrl').value='';
  document.getElementById('dPriority').value='low';
  document.getElementById('dApproval').value='no';
  document.getElementById('dAwaitingDueDate').checked=false;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('dDate').value=today;
  document.getElementById('dDate').min=today;
  document.getElementById('dDate').disabled=false;
  const users = await api(withSeg('/api/users'));  // current view (office/factory) ke doers hi
  const opts = users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  document.getElementById('dDoer').innerHTML='<option value="">Select Doer</option>'+opts;
  document.getElementById('delegateModal').classList.add('open');
}

function onAwaitingDueDateChange() {
  const checked = document.getElementById('dAwaitingDueDate').checked;
  const dateInput = document.getElementById('dDate');
  dateInput.disabled = checked;
  if (checked) dateInput.value = '';
}

async function saveDelegate() {
  const err = document.getElementById('delegateErr');
  err.style.display='none';
  const doer = document.getElementById('dDoer').value;
  const awaitingDueDate = document.getElementById('dAwaitingDueDate').checked;
  const date = document.getElementById('dDate').value;
  const desc = document.getElementById('dDesc').value.trim();
  const priority = document.getElementById('dPriority').value;
  const approval = document.getElementById('dApproval').value;
  const remarks = document.getElementById('dRemarks').value.trim();
  const url = document.getElementById('dUrl').value.trim();
  if (!doer) { err.textContent='Please select a doer'; err.style.display='block'; return; }
  if (!awaitingDueDate && !date) { err.textContent='Please select a date'; err.style.display='block'; return; }
  if (!desc) { err.textContent='Description is required'; err.style.display='block'; return; }
  const r = await api('/api/tasks','POST',{type:'delegation',desc,assignedTo:doer,date,priority,approval,remarks,url,awaitingDueDate});
  if (r && r.error) { err.textContent=r.error; err.style.display='block'; return; }
  closeModal('delegateModal');
  showToast('Task delegated successfully!');
  loadDashboard();
}

// ══════════════════════════════════════════════════════
// CHECKLIST MODAL - Recurring
// ══════════════════════════════════════════════════════
async function openChecklist() {
  document.getElementById('checklistErr').style.display='none';
  document.getElementById('checklistSuccess').style.display='none';
  document.getElementById('cDesc').value='';
  document.getElementById('cRemarks').value='';
  document.getElementById('cFrequency').value='daily';
  document.getElementById('cEndDate').value='';
  document.getElementById('cPreview').style.display='none';
  document.getElementById('bulkFileC').value=''; // purani selected file clear karo, warna dobara "Upload CSV" dabane par wahi purani file phir upload ho jaati hai
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('cDate').value=today;
  document.getElementById('cDate').min=today;
  document.getElementById('cEndDate').min=today;
  const users = await api(withSeg('/api/users'));  // current view (office/factory) ke doers hi
  document.getElementById('cDoer').innerHTML='<option value="">Select Employee</option>'+
    users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');

  ['cFrequency','cDate','cEndDate','cDesc'].forEach(id=>{
    document.getElementById(id).onchange = updateChecklistPreview;
    document.getElementById(id).oninput = updateChecklistPreview;
  });

  document.getElementById('checklistModal').classList.add('open');
}

function updateChecklistPreview() {
  const freq = document.getElementById('cFrequency').value;
  const date = document.getElementById('cDate').value;
  const endDateInput = document.getElementById('cEndDate').value;
  const desc = document.getElementById('cDesc').value.trim();
  if (!date || !desc) { document.getElementById('cPreview').style.display='none'; return; }

  const counts = {daily:365, weekly:52, alternative_week:26, monthly:12, quarterly:4, yearly:1};
  const labels = {daily:'Daily', weekly:'Weekly', alternative_week:'Alternative Week', monthly:'Monthly', quarterly:'Quarterly', yearly:'Yearly'};
  const count = counts[freq];
  const endDate = endDateInput || getEndDate(date, freq, count);

  document.getElementById('cPreviewText').textContent = endDateInput
    ? `"${desc}" — tasks will be created from ${date} to ${endDate} (${labels[freq]})`
    : `"${desc}" — ${count} tasks will be created from ${date} to ${endDate} (${labels[freq]})`;
  document.getElementById('cPreview').style.display='block';
}

function getEndDate(startDate, freq, count) {
  const d = new Date(startDate);
  const intervals = {daily:1, weekly:7, alternative_week:14, monthly:30, quarterly:90, yearly:365};
  d.setDate(d.getDate() + (intervals[freq] * (count-1)));
  return d.toISOString().split('T')[0];
}

function generateDates(startDate, freq, weekOffStr, extraOffStr, endDate) {
  const dates = [];
  const d = new Date(startDate+'T00:00:00');
  const endD = endDate ? new Date(endDate+'T00:00:00') : null;
  const counts = {daily:365, weekly:52, alternative_week:26, monthly:12, quarterly:4, yearly:1};
  const count = counts[freq];
  const weekOff = (weekOffStr||'').split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n));
  let extraOff = [];
  try { extraOff = extraOffStr ? JSON.parse(extraOffStr) : []; } catch(e) {}

  // Helper: get occurrence number of a weekday in its month (1=1st, 2=2nd...)
  function getNthWeekday(date) {
    const day = date.getDate();
    return Math.ceil(day / 7);
  }

  function isExtraOff(date) {
    const dayOfWeek = date.getDay();
    const nth = getNthWeekday(date);
    return extraOff.some(e => e.day === dayOfWeek && e.weeks.includes(nth));
  }

  const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

  let added = 0;
  let safety = endD ? 3660 : count * 14;
  while ((endD ? d <= endD : added < count) && safety-- > 0) {
    const day = d.getDay();
    if (freq === 'daily') {
      // Sunday company-wide off hai; week off / extra off us user ke apne hain.
      // Daily task roz aata hai, isliye off day ko chhod kar agle din chale jaate
      // hain — count kharch nahi hota.
      if (day === 0 || weekOff.includes(day) || isExtraOff(d)) {
        d.setDate(d.getDate() + 1);
        continue;
      }
      dates.push(iso(d));
      added++;
      d.setDate(d.getDate() + 1);
      continue;
    }

    // Weekly / monthly / quarterly / yearly — apni cadence par chalte hain.
    // Sunday par pada occurrence bana hi nahi, lekin schedule me apni jagah
    // kharch kar deta hai, warna baaki saare aage khisak jaate.
    if (day !== 0) dates.push(iso(d));
    added++;
    if (freq==='weekly')                d.setDate(d.getDate()+7);
    else if (freq==='alternative_week') d.setDate(d.getDate()+14);
    else if (freq==='monthly')          d.setMonth(d.getMonth()+1);
    else if (freq==='quarterly')        d.setMonth(d.getMonth()+3);
    else if (freq==='yearly')           d.setFullYear(d.getFullYear()+1);
    else break; // unknown frequency — loop me phansne se behtar hai ruk jaana
  }
  return dates;
}

async function saveChecklist() {
  const err = document.getElementById('checklistErr');
  const suc = document.getElementById('checklistSuccess');
  err.style.display='none'; suc.style.display='none';

  const doer     = document.getElementById('cDoer').value;
  const date     = document.getElementById('cDate').value;
  const endDate  = document.getElementById('cEndDate').value;
  const desc     = document.getElementById('cDesc').value.trim();
  const remarks  = document.getElementById('cRemarks').value.trim();
  const freq     = document.getElementById('cFrequency').value;

  if (!doer) { err.textContent='Please select an employee'; err.style.display='block'; return; }
  if (!date) { err.textContent='Please select a start date'; err.style.display='block'; return; }
  if (!desc) { err.textContent='Task name is required'; err.style.display='block'; return; }

  const btn = document.getElementById('cGenerateBtn');
  btn.disabled=true; btn.textContent='Generating…';

  // Get user's week_off to skip those days
  const allUsers = await api('/api/users');
  const selUser = allUsers.find(u=>String(u.id)===String(doer));
  const weekOff = selUser?.week_off || '';
  const extraOff = selUser?.extra_off || '';

  const dates = generateDates(date, freq, weekOff, extraOff, endDate);

  // Sunday par padne wale occurrences bante hi nahi. Weekly/monthly task agar
  // Sunday se shuru ho to har occurrence Sunday par gir sakti hai aur ek bhi
  // task nahi banega — us soorat me chup rehne ke bajaye saaf bata do.
  if (!dates.length) {
    btn.disabled=false; btn.textContent='Generate Tasks';
    err.textContent = new Date(date+'T00:00:00').getDay() === 0
      ? 'Start date is a Sunday and Sunday tasks are skipped — please pick another start date.'
      : 'No dates could be generated — please check the start date, end date and week off settings.';
    err.style.display='block';
    return;
  }

  const result = await api('/api/tasks/bulk-checklist','POST',{
    desc, assignedTo: doer, priority: 'low', remarks, dates, frequency: freq
  });

  btn.disabled=false; btn.textContent='Generate Tasks';

  if (result.error) { err.textContent=result.error; err.style.display='block'; return; }

  suc.textContent = `✅ ${dates.length} tasks generated! (Sundays skipped${weekOff ? ', week off days skipped' : ''})`;
  suc.style.display='block';

  setTimeout(()=>{ closeModal('checklistModal'); loadDashboard(); }, 2000);
}

// ══════════════════════════════════════════════════════
// HOLIDAYS
// ══════════════════════════════════════════════════════
function openHoliday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('hDate').value='';
  document.getElementById('hDate').min=today;
  document.getElementById('hName').value='';
  renderHolidayList();
  document.getElementById('holidayModal').classList.add('open');
}

async function addHoliday() {
  const date = document.getElementById('hDate').value;
  const name = document.getElementById('hName').value.trim();
  if (!date||!name) { showToast('Date and name required!'); return; }

  // Save holiday
  holidays.push({date,name});
  holidays.sort((a,b)=>a.date.localeCompare(b.date));
  localStorage.setItem('tm_holidays', JSON.stringify(holidays));

  // Auto-delete checklist tasks on this holiday date
  const result = await api('/api/tasks/delete-by-date','DELETE',{date});
  const deleted = result.deleted || 0;

  document.getElementById('hDate').value='';
  document.getElementById('hName').value='';
  renderHolidayList();

  if (deleted > 0) {
    showToast(`Holiday added! ${deleted} checklist task(s) auto-deleted for ${formatDate(date)}`);
  } else {
    showToast(`Holiday added! No checklist tasks were on ${formatDate(date)}`);
  }
}

function deleteHoliday(idx) {
  holidays.splice(idx,1);
  localStorage.setItem('tm_holidays', JSON.stringify(holidays));
  renderHolidayList();
}

function renderHolidayList() {
  const container = document.getElementById('holidayList');
  if (!holidays.length) { container.innerHTML='<div class="empty" style="padding:16px">No holidays added yet</div>'; return; }
  container.innerHTML = holidays.map((h,i)=>`
    <div class="holiday-item">
      <span><strong>${formatDate(h.date)}</strong> — ${h.name}</span>
      <button class="action-btn delete" onclick="deleteHoliday(${i})">Remove</button>
    </div>`).join('');
}

function formatDate(d) {
  const dt = new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}

// ══════════════════════════════════════════════════════
// BULK UPLOAD
// ══════════════════════════════════════════════════════
function downloadSample() {
  const csv = `doer_email,approver_email,due_date,priority,approval,description,remarks\npriyanka@test.com,aman@test.com,2026-04-01,high,yes,Complete sales report,Follow up needed\npooja@test.com,aman@test.com,2026-04-02,medium,no,Prepare presentation,`;
  downloadFile(csv,'delegation_sample.csv');
}

function downloadSampleC() {
  // Format: user_email, frequency (D/W/M/F/Y/Q), description, due_date (DD/MM/YYYY)
  const csv = [
    'user_email,frequency,description,due_date',
    'priyanka@test.com,D,Review attendance sheet,14/07/2026',
    'pooja@test.com,W,Send weekly report,14/07/2026',
    'rahul@test.com,M,Submit monthly expense report,14/07/2026',
    'amit@test.com,F,Bi-weekly team sync notes,14/07/2026',
    'neha@test.com,Y,Annual performance self-review,14/07/2026',
    'sneha@test.com,Q,Quarterly audit checklist,14/07/2026',
  ].join('\n');
  downloadFile(csv,'checklist_bulk_sample.csv');
}

function downloadFile(content, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + content);
  a.download = filename;
  a.click();
}

// Proper CSV parser — handles quoted fields with embedded commas/newlines (naive split(',') breaks on these)
function parseCSVRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function uploadCSV() {
  const file = document.getElementById('bulkFile').files[0];
  if (!file) { showToast('Please select a CSV file','error'); return; }
  const btn = document.getElementById('uploadCSVBtn');
  if (btn.disabled) return; // upload pehle se chal raha hai — dobara click ignore karo
  btn.disabled = true; btn.textContent = '⏳ Uploading…';
  try {
    const text = await file.text();
    const rows = parseCSVRows(text).slice(1).filter(r => r.some(f => (f||'').trim()));
    if (!rows.length) { showToast('CSV is empty','error'); return; }
    const allUsers = await api('/api/users');
    let count = 0, skipped = 0;
    for (const row of rows) {
      const [doer_email,approver_email,due_date,priority,approval,description,remarks] = row.map(s=>(s||'').trim());
      if (!doer_email||!description) { skipped++; continue; }
      const doer = allUsers.find(u=>u.email===doer_email);
      if (!doer) { skipped++; continue; }
      await api('/api/tasks','POST',{type:'delegation',desc:description,assignedTo:doer.id,approverEmail:approver_email,date:due_date,priority,approval,remarks});
      count++;
    }
    showToast(`✅ ${count} tasks uploaded! ${skipped?`(${skipped} skipped)`:''}`);
    document.getElementById('bulkFile').value = '';
    closeModal('delegateModal');
    loadDashboard();
  } finally {
    btn.disabled = false; btn.textContent = '⬆ Upload CSV';
  }
}

// Frequency: single-letter (D/W/M/F/Y/Q) ya full word dono chalega
const CSV_FREQ_MAP = {
  d:'daily', w:'weekly', m:'monthly', f:'alternative_week', y:'yearly', q:'quarterly',
  daily:'daily', weekly:'weekly', monthly:'monthly', yearly:'yearly', quarterly:'quarterly',
  alternative_week:'alternative_week', fortnightly:'alternative_week', alternate_week:'alternative_week'
};
// Date: DD/MM/YYYY, D/M/YYYY ya YYYY-MM-DD dono
function csvDateToISO(v) {
  v = (v||'').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const p = v.split(/[\/\-.]/).map(x=>x.trim());
  if (p.length === 3 && p[0].length <= 2) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  return null;
}

async function uploadCSVC() {
  const file = document.getElementById('bulkFileC').files[0];
  if (!file) { showToast('Please select a CSV file','error'); return; }
  const btn = document.getElementById('uploadCSVCBtn');
  if (btn.disabled) return; // upload pehle se chal raha hai — dobara click ignore karo
  btn.disabled = true; btn.textContent = '⏳ Uploading…';
  try {
    const allRows = parseCSVRows(await file.text());
    if (allRows.length < 2) { showToast('CSV is empty','error'); return; }

    // Header ke naam se columns dhoondo (position/order pe depend nahi)
    const headerCells = allRows[0].map(h => (h||'').trim().toLowerCase().replace(/\s+/g,'_'));
    const findCol = (...names) => { for (const n of names) { const i = headerCells.indexOf(n); if (i !== -1) return i; } return -1; };
    const iEmail = findCol('user_email','email','doer_email');
    const iName  = findCol('name','employee','employee_name');
    const iFreq  = findCol('frequency','freq');
    const iDesc  = findCol('description','task','task_name');
    const iDate  = findCol('due_date','start_date','next_due_date','new_date','date');
    const iRemarks = findCol('remarks','remark');

    if (iFreq === -1 || iDesc === -1 || iDate === -1 || (iEmail === -1 && iName === -1)) {
      showToast('Invalid CSV header. Required columns: user_email (or name), frequency, description, due_date','error');
      return;
    }

    const dataLines = allRows.slice(1).filter(r => r.some(f => (f||'').trim()));
    const allUsers = await api('/api/users');

    let totalTasks = 0, skipped = 0;
    showToast('⏳ Generating tasks, please wait…');

    for (const row of dataLines) {
      const g = i => (i === -1 ? '' : (row[i]||'').trim());
      const email = g(iEmail), name = g(iName);
      const freq = CSV_FREQ_MAP[g(iFreq).toLowerCase()];
      const description = g(iDesc);
      const isoStart = csvDateToISO(g(iDate));
      if (!description || !freq || !isoStart) { skipped++; continue; }

      // user match: pehle email se, warna name se
      let user = email ? allUsers.find(u => (u.email||'').toLowerCase() === email.toLowerCase()) : null;
      if (!user && name) user = allUsers.find(u => (u.name||'').toLowerCase() === name.toLowerCase());
      if (!user) { skipped++; continue; }

      const dates = generateDates(isoStart, freq, user.week_off||'', user.extra_off||'');
      if (!dates.length) { skipped++; continue; }
      const result = await api('/api/tasks/bulk-checklist','POST',{
        desc: description, assignedTo: user.id, priority: 'low', remarks: g(iRemarks), dates, frequency: freq
      });
      if (!result.error) totalTasks += dates.length; else skipped++;
    }

    showToast(`✅ ${totalTasks} tasks generated!${skipped ? ` (${skipped} rows skipped)` : ''}`);
    document.getElementById('bulkFileC').value = '';
    closeModal('checklistModal');
    loadDashboard();
  } finally {
    btn.disabled = false; btn.textContent = '⬆ Upload CSV';
  }
}

// ══════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════
let allUsersData = [];

async function loadUsers() {
  allUsersData = await api(withSeg('/api/users'));
  renderUsersTable(allUsersData);
}

function filterUsers() {
  const q = (document.getElementById('userSearch')?.value||'').toLowerCase().trim();
  if (!q) { renderUsersTable(allUsersData); return; }
  const filtered = allUsersData.filter(u =>
    (u.name||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.department||'').toLowerCase().includes(q) ||
    (u.role||'').toLowerCase().includes(q) ||
    (u.phone||'').includes(q)
  );
  renderUsersTable(filtered);
}

// Map to store full user data for safe edit access (avoids inline special-char bugs)
const _usersMap = {};

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTbody');
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted-foreground)">No users found</td></tr>`;
    _syncUserSelection();
    return;
  }
  // Store all users in map so openEditUser(id) can safely retrieve data
  users.forEach(u => { _usersMap[u.id] = u; });
  const roleLabel = r => r==='admin'?'👑 Admin':r==='hod'?'🏢 HOD':r==='pc'?'🖥️ PC':'👤 User';
  tbody.innerHTML = users.map(u=>`
    <tr>
      <td>${String(u.id) === String(ME.id)
        ? `<span title="Aap khud ko delete nahi kar sakte" style="color:var(--muted-foreground);font-size:11px">—</span>`
        : `<input type="checkbox" class="user-cb" value="${u.id}" onclick="_syncUserSelection()" style="accent-color:var(--primary);cursor:pointer"/>`}</td>
      <td style="font-weight:600">${u.name}</td>
      <td style="color:var(--muted-foreground)">${u.email}</td>
      <td style="color:var(--muted-foreground)">${u.phone||'—'}</td>
      <td style="color:var(--muted-foreground)">${u.department||'—'}${u.staff_type==='factory'?' <span style="font-size:10px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:1px 6px;border-radius:8px;font-weight:600">🏭 Factory</span>':''}</td>
      <td><span class="role-badge ${u.role}">${roleLabel(u.role)}</span>${Number(u.view_only)===1?' <span class="status-badge revised" title="Can view everything, cannot make changes">👁 View only</span>':''}</td>
      <td style="white-space:nowrap">
        <button class="action-btn edit" onclick="openEditUser(${u.id})">Edit</button>
        <button class="action-btn" style="background:var(--accent);color:var(--accent-foreground);margin-left:6px" onclick="openSetPassword(${u.id})">Set Password</button>
        <button class="action-btn delete" style="margin-left:6px" onclick="deleteUser(${u.id})">Delete</button>
      </td>
    </tr>`).join('');
  // Table dobara render hone par purani selection chali jaati hai (search
  // filter, delete ke baad refresh) — count aur button usi hisaab se reset.
  _syncUserSelection();
}

// ── Bulk select / delete ──────────────────────────────
// Selection sirf abhi dikh rahi rows ki hai. Search filter lagane par table
// dobara render hota hai aur tick clear ho jaate hain — jaan-boojh kar, warna
// koi chhupa hua user bhi delete ho sakta tha jo dikh hi nahi raha.
function _syncUserSelection() {
  const boxes = [...document.querySelectorAll('.user-cb')];
  const picked = boxes.filter(cb => cb.checked);
  document.getElementById('userSelCount').textContent = picked.length;
  document.getElementById('userBulkDeleteBtn').style.display = picked.length ? 'inline-flex' : 'none';
  const all = document.getElementById('userSelectAll');
  all.checked = boxes.length > 0 && picked.length === boxes.length;
  all.indeterminate = picked.length > 0 && picked.length < boxes.length;
}

function toggleAllUsers(master) {
  document.querySelectorAll('.user-cb').forEach(cb => { cb.checked = master.checked; });
  _syncUserSelection();
}

async function deleteSelectedUsers() {
  const ids = [...document.querySelectorAll('.user-cb:checked')].map(cb => cb.value);
  if (!ids.length) return;
  const names = ids.map(id => (_usersMap[id] || {}).name || id);
  const list = names.slice(0, 8).join(', ') + (names.length > 8 ? ` +${names.length - 8} aur` : '');
  if (!await confirmDialog(
        `Delete ${ids.length} user${ids.length > 1 ? 's' : ''}?\n\n${list}\n\nThis cannot be undone.`,
        {title:'Delete Users', okText:`Delete ${ids.length}`, danger:true})) return;

  const btn = document.getElementById('userBulkDeleteBtn');
  btn.disabled = true;
  const original = btn.innerHTML;
  let done = 0; const failed = [];
  // Ek-ek karke, wahi endpoint jo single delete use karta hai — uske saare
  // checks (jaise "khud ko delete nahi kar sakte") apne aap lagu rehte hain.
  for (const id of ids) {
    btn.innerHTML = `⏳ Deleting ${done + 1}/${ids.length}…`;
    const r = await api(`/api/users/${id}`, 'DELETE');
    if (r && r.error) failed.push(`${(_usersMap[id]||{}).name || id}: ${r.error}`);
    else done++;
  }
  btn.disabled = false; btn.innerHTML = original;
  await loadUsers();
  if (failed.length) showToast(`${done} deleted, ${failed.length} failed — ${failed[0]}`, 'error');
  else showToast(`${done} user${done > 1 ? 's' : ''} deleted`);
}

function _setWeekOff(s) {
  const offs = (s||'').split(',').map(x=>x.trim()).filter(Boolean);
  document.querySelectorAll('.woff-cb').forEach(cb => { cb.checked = offs.includes(cb.value); });
}
function _getWeekOff() {
  return [...document.querySelectorAll('.woff-cb:checked')].map(cb=>cb.value).join(',');
}

// Extra Off — stored as JSON: [{day:6, weeks:[2,4]}]
let _extraOffData = [];

function _renderExtraOffList() {
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const weekNames = {1:'1st',2:'2nd',3:'3rd',4:'4th',5:'5th'};
  const container = document.getElementById('extraOffList');
  if (!container) return;
  container.innerHTML = _extraOffData.map((item,i) => `
    <div style="display:flex;align-items:center;gap:6px;background:var(--muted);border:1px solid var(--border);border-radius:8px;padding:6px 10px">
      <span style="font-size:12px;flex:1">
        <strong>${item.weeks.map(w=>weekNames[w]).join(', ')}</strong> ${dayNames[item.day]}
      </span>
      <select onchange="_extraOffData[${i}].day=parseInt(this.value);_renderExtraOffList()"
        style="padding:3px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'Inter',sans-serif;outline:none">
        ${[0,1,2,3,4,5,6].map(d=>`<option value="${d}" ${item.day===d?'selected':''}>${dayNames[d]}</option>`).join('')}
      </select>
      <div style="display:flex;gap:3px">
        ${[1,2,3,4,5].map(w=>`
          <label style="display:flex;align-items:center;gap:2px;font-size:11px;cursor:pointer;text-transform:none;letter-spacing:0">
            <input type="checkbox" ${item.weeks.includes(w)?'checked':''}
              onchange="if(this.checked)_extraOffData[${i}].weeks.push(${w});else _extraOffData[${i}].weeks=_extraOffData[${i}].weeks.filter(x=>x!==${w});_renderExtraOffList()"
              style="accent-color:var(--primary);width:12px;height:12px"/>
            ${weekNames[w]}
          </label>`).join('')}
      </div>
      <button type="button" onclick="_extraOffData.splice(${i},1);_renderExtraOffList()"
        style="background:none;border:none;color:var(--destructive);cursor:pointer;font-size:14px;padding:0 2px">✕</button>
    </div>`).join('');
}

function addExtraOff() {
  _extraOffData.push({ day: 6, weeks: [2,4] }); // default: 2nd & 4th Saturday
  _renderExtraOffList();
}

function _setExtraOff(jsonStr) {
  try { _extraOffData = jsonStr ? JSON.parse(jsonStr) : []; } catch(e) { _extraOffData = []; }
  _renderExtraOffList();
}

function _getExtraOff() {
  return JSON.stringify(_extraOffData.filter(e => e.weeks.length > 0));
}

let _departmentsList = [];

async function loadDepartments(selected) {
  const r = await api('/api/departments');
  _departmentsList = Array.isArray(r) ? r : [];
  _renderDeptOptions(selected);
}

function _renderDeptOptions(selected) {
  const sel = document.getElementById('uDepartment');
  const list = (selected && !_departmentsList.includes(selected)) ? [..._departmentsList, selected] : _departmentsList;
  sel.innerHTML = '<option value="">— Select Department —</option>' +
    list.map(d => `<option value="${d}">${d}</option>`).join('') +
    '<option value="__add_new__">+ Add New Department...</option>';
  sel.value = selected || '';
  document.getElementById('uDepartmentNew').style.display = 'none';
}

function handleDeptChange() {
  const sel = document.getElementById('uDepartment');
  const newInput = document.getElementById('uDepartmentNew');
  if (sel.value === '__add_new__') {
    newInput.style.display = 'block';
    newInput.value = '';
    newInput.focus();
  } else {
    newInput.style.display = 'none';
  }
}

async function saveNewDepartment() {
  const newInput = document.getElementById('uDepartmentNew');
  const name = newInput.value.trim();
  if (!name) { document.getElementById('uDepartment').value=''; newInput.style.display='none'; return; }
  const r = await api('/api/departments','POST',{name});
  if (r.error) { showToast(r.error,'error'); return; }
  _departmentsList = r;
  _renderDeptOptions(name);
  showToast('Department added!');
}

function openAddUser() {
  document.getElementById('userModalTitle').textContent='Add User';
  ['editUserId','uName','uEmail','uNotifEmail','uPhone','uPassword'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('uRole').value='user';
  setUserViewOnly(false); // naya user by default full access
  document.getElementById('pwdOptional').style.display='none';
  document.getElementById('bulkUserSection').style.display=''; // CSV upload sirf yahan
  document.getElementById('userErr').style.display='none';
  document.getElementById('userSuccess').style.display='none';
  loadDepartments('');
  _setWeekOff('');
  _setExtraOff('');
  document.getElementById('userModal').classList.add('open');
}

// Access toggle — Full ya View only. Value hidden input me rehti hai,
// aur wahi saveUser() body me bhejta hai.
function setUserViewOnly(on) {
  document.getElementById('uViewOnly').value = on ? '1' : '0';
  document.getElementById('uAccessFull').classList.toggle('active', !on);
  document.getElementById('uAccessView').classList.toggle('active', on);
  document.getElementById('uAccessHint').style.display = on ? 'block' : 'none';
}

function openEditUser(id) {
  const u = _usersMap[id];
  if (!u) { showToast('User data not found. Please refresh the page.','error'); return; }
  setUserViewOnly(Number(u.view_only) === 1);
  document.getElementById('userModalTitle').textContent='Edit User';
  document.getElementById('editUserId').value=u.id;
  document.getElementById('uName').value=u.name||'';
  document.getElementById('uEmail').value=u.email||'';
  document.getElementById('uNotifEmail').value=u.notification_email||'';
  document.getElementById('uPhone').value=u.phone||'';
  document.getElementById('uPassword').value='';
  document.getElementById('uRole').value=u.role||'user';
  document.getElementById('pwdOptional').style.display='inline';
  document.getElementById('bulkUserSection').style.display='none'; // edit me bulk add ka matlab nahi
  document.getElementById('userErr').style.display='none';
  document.getElementById('userSuccess').style.display='none';
  loadDepartments(u.department||'');
  _setWeekOff(u.week_off||'');
  _setExtraOff(u.extra_off||'');
  document.getElementById('userModal').classList.add('open');
}

function openSetPassword(id) {
  const u = _usersMap[id];
  if (!u) { showToast('User data not found. Please refresh the page.','error'); return; }
  document.getElementById('setPasswordErr').style.display='none';
  document.getElementById('setPasswordUserId').value = u.id;
  document.getElementById('setPasswordUserName').textContent = `${u.name} (${u.email})`;
  const pw = document.getElementById('setPasswordValue');
  pw.value = '';
  pw.type = 'password';
  document.getElementById('setPasswordToggle').innerHTML = PW_EYE_SVG;
  document.getElementById('setPasswordModal').classList.add('open');
}

// Professional eye / eye-off SVG icons (emoji ki jagah)
const PW_EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const PW_EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function toggleSetPassword() {
  const pw = document.getElementById('setPasswordValue');
  const btn = document.getElementById('setPasswordToggle');
  if (pw.type === 'password') { pw.type = 'text'; btn.innerHTML = PW_EYE_OFF_SVG; }
  else { pw.type = 'password'; btn.innerHTML = PW_EYE_SVG; }
}

// Generic password show/hide toggle — kisi bhi input pe (profile ke 3 fields, etc.)
function togglePw(btn, inputId) {
  const pw = document.getElementById(inputId);
  if (!pw) return;
  const show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  btn.innerHTML = show ? PW_EYE_OFF_SVG : PW_EYE_SVG;
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

async function saveSetPassword() {
  const err = document.getElementById('setPasswordErr');
  err.style.display='none';
  const id = document.getElementById('setPasswordUserId').value;
  const password = document.getElementById('setPasswordValue').value;
  if (!password || password.length < 4) { err.textContent='Password must be at least 4 characters'; err.style.display='block'; return; }
  const r = await api(`/api/users/${id}/password`,'PUT',{password});
  if (r && r.error) { err.textContent=r.error; err.style.display='block'; return; }
  closeModal('setPasswordModal');
  showToast('Password updated — user logged out of all sessions.');
}

async function saveUser() {
  const err=document.getElementById('userErr'); err.style.display='none';
  const suc=document.getElementById('userSuccess'); suc.style.display='none';
  const id=document.getElementById('editUserId').value;
  const name=document.getElementById('uName').value.trim();
  const email=document.getElementById('uEmail').value.trim();
  const notification_email=document.getElementById('uNotifEmail').value.trim();
  const phone=document.getElementById('uPhone').value.trim();
  let department=document.getElementById('uDepartment').value.trim();
  if (department === '__add_new__') department = document.getElementById('uDepartmentNew').value.trim();
  const password=document.getElementById('uPassword').value;
  const role=document.getElementById('uRole').value;
  const view_only=document.getElementById('uViewOnly').value==='1'?1:0;
  const week_off=_getWeekOff();
  const extra_off=_getExtraOff();
  if (!name||!email) { err.textContent='Name and email required'; err.style.display='block'; return; }
  if (!id&&!password) { err.textContent='Password required for new user'; err.style.display='block'; return; }
  if (view_only && String(id) === String(ME.id)) {
    err.textContent='You cannot set yourself to view-only — you would not be able to change it back.';
    err.style.display='block'; return;
  }
  // staff_type nahi bhejte — Office/Factory ab UI me hai hi nahi. Server
  // missing value ko 'office' maan leta hai (server.js me
  // `staff_type === 'factory' ? 'factory' : 'office'`), aur DB column ka
  // default bhi wahi hai. Dhyan rahe: iska matlab hai ki kisi user ko edit
  // karke save karne par uska staff_type 'office' set ho jayega. Yahan koi
  // farak nahi padta kyunki feature hata diya gaya hai aur sabhi users
  // 'office' hi hain — par feature wapas laao to ye pehle theek karna.
  const body={name,email,notification_email,role,view_only,phone,department,week_off,extra_off};
  if (password) body.password=password;
  const r = id ? await api(`/api/users/${id}`,'PUT',body) : await api('/api/users','POST',body);
  if (r.error) { err.textContent=r.error; err.style.display='block'; return; }
  closeModal('userModal');
  loadUsers();
}

function downloadUserSample() {
  const csv = `name,email,password,role,phone,department,week_off\nJohn Doe,john@test.com,pass123,user,9876543210,Sales,0\nJane Smith,jane@test.com,pass123,hod,9876543211,Production,0\nAdmin User,admin2@test.com,pass123,admin,,Management,`;
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
  a.download = 'users_sample.csv'; a.click();
  showToast('Sample CSV downloaded!');
}

async function uploadUsersCSV() {
  const file = document.getElementById('bulkUserFile').files[0];
  if (!file) { showToast('Please select a CSV file','error'); return; }
  const text = await file.text();
  const lines = text.trim().split('\n');
  const hdrs = lines[0].toLowerCase().split(',').map(h=>h.trim());
  const users = [];
  for (let i=1; i<lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(',').map(c=>c.trim());
    const u = {}; hdrs.forEach((h,hi) => u[h]=cols[hi]||'');
    if (u.name && u.email && u.password) users.push(u);
  }
  if (!users.length) { showToast('No valid rows found','error'); return; }
  const r = await api('/api/users/bulk','POST',{users});
  if (r.error) { showToast(r.error,'error'); return; }
  const suc = document.getElementById('userSuccess');
  suc.textContent = `✅ Added: ${r.added}, Skipped: ${r.skipped}`;
  suc.style.display='block';
  loadUsers();
}


// ══════════════════════════════════════════════════════
// Approvals page ke tab par pending count dikhata hai. Sidebar ka badge sirf
// total batata hai — usse ye pata nahi chalta ki request kis tab me hai.
function setApprovalTabCount(id, n) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = n > 0 ? n : '';
  el.classList.toggle('show', n > 0);
}

async function loadApprovalBadge() {
  const d = await api('/api/approvals/count');
  const badge = document.getElementById('approvalBadge');
  if (d.count > 0) {
    badge.textContent = d.count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
  setApprovalTabCount('apprCountTask', d.count || 0);
  // Baaki dono tabs ke counts bhi saath me refresh karo, warna user ko
  // sirf ek tab ka number dikhta hai aur baaki khaali lagte hain.
  loadTransferBadge();
  loadLeaveBadge();
}

function switchApprovalTab(tab, el) {
  document.querySelectorAll('#page-approvals .tab').forEach(t=>t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('approvalsPanel').style.display = tab==='task' ? 'block' : 'none';
  document.getElementById('transferApprovalsPanel').style.display = tab==='transfer' ? 'block' : 'none';
  document.getElementById('leaveApprovalsPanel').style.display = tab==='leave' ? 'block' : 'none';
  if (tab==='transfer') loadTransferApprovals();
  if (tab==='leave') loadLeaveApprovals();
}

// Approvals page ka Leave tab — sirf pending requests, approve/reject ke saath.
// (Leave page par apply + poori history rehti hai.)
async function loadLeaveApprovals() {
  const container = document.getElementById('leaveApprovalsContent');
  container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Loading…</div>`;
  const rows = await api(withSeg('/api/leaves'));
  if (rows.error) { container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ ${rows.error}</div>`; return; }

  // Apni khud ki leave approve nahi kar sakte, isliye woh yahan nahi dikhti
  const pending = (rows||[]).filter(l => l.status === 'pending' && String(l.user_id) !== String(ME.id));
  if (!pending.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">✅ No pending leave requests!</div>`;
    return;
  }

  const body = pending.map(l => `
    <tr>
      <td>${l.userName}<div style="font-size:11px;color:var(--muted-foreground);margin-top:3px">${staffTypeBadge(l.staff_type)} ${l.department||'—'}</div></td>
      <td style="white-space:nowrap">${LEAVE_TYPE_LABEL[l.leave_type]||l.leave_type}</td>
      <td style="white-space:nowrap;font-size:12px">${fmtDate(l.from_date)}${l.to_date!==l.from_date?` → ${fmtDate(l.to_date)}`:''}</td>
      <td style="color:var(--muted-foreground);font-size:12px">${l.reason||'—'}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--muted-foreground)">${fmtDate(l.applied_on)}</td>
      <td style="white-space:nowrap">
        <button class="action-btn done" onclick="decideLeave(${l.id},'approved')">Approve</button>
        <button class="action-btn" style="background:color-mix(in srgb,var(--destructive) 10%,transparent);color:var(--destructive);margin-left:3px" onclick="decideLeave(${l.id},'rejected')">Reject</button>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="flat-tasks-table">
      <div style="overflow-x:auto">
        <table style="min-width:760px">
          <thead><tr>
            <th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th>Applied On</th><th>Action</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
}

async function loadApprovals() {
  // Leave band hai to Approvals ka "Leave Requests" tab bhi nahi dikhna chahiye.
  // NOTE: HR wala block neeche seedha Leave tab par le jaata hai — is haal me
  // uske paas approve karne ko kuch bachta hi nahi, isliye wo bhi skip.
  const leaveOff = isPageDisabled('leaves');
  if (isHR() && ME.role !== 'admin' && ME.role !== 'hod' && ME.role !== 'pc' && !leaveOff) {
    document.getElementById('apprTabTask').style.display = 'none';
    document.getElementById('apprTabLeave').style.display = 'block';
    switchApprovalTab('leave', document.getElementById('apprTabLeave'));
    return;
  }
  // Show Transfer + Leave tabs for admin/HOD/PC
  if (ME.role === 'admin' || ME.role === 'hod' || ME.role === 'pc') {
    document.getElementById('apprTabTransfer').style.display = 'block';
  }
  // Leave approve sirf admin/HOD kar sakte hain
  if ((ME.role === 'admin' || ME.role === 'hod') && !leaveOff) {
    document.getElementById('apprTabLeave').style.display = 'block';
  }

  const approvals = await api('/api/approvals');
  const container = document.getElementById('approvalsContent');
  const isAdminOrPC = ME.role === 'admin' || ME.role === 'pc';

  if (!approvals.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">✅ No pending task approvals!</div>`;
  } else {
    container.innerHTML = `
      <div class="flat-tasks-table">
        <table>
          <thead><tr>
            <th>Employee</th>${isAdminOrPC ? '<th>Approver</th>' : ''}<th>Task</th><th>Action Requested</th><th>Requested On</th><th>Approve / Reject</th>
          </tr></thead>
          <tbody>
            ${approvals.map(a => `
              <tr>
                <td style="font-weight:600">${a.requestedByName}</td>
                ${isAdminOrPC ? `<td style="color:var(--muted-foreground);font-size:12px">${a.requestedToName}</td>` : ''}
                <td>${a.description||'—'}</td>
                <td><span class="status-badge ${a.action_type}">${a.action_type==='completed'?'✅ Mark Complete':'🔄 Revision'}</span></td>
                <td style="color:var(--muted-foreground);font-size:12px">${new Date(a.created_at).toLocaleDateString('en-IN')}</td>
                <td>
                  <button class="action-btn done" onclick="handleApproval(${a.id},'approved')">Approve</button>
                  <button class="action-btn delete" style="margin-left:6px" onclick="handleApproval(${a.id},'rejected')">Reject</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }
}

async function handleApproval(id, action) {
  const note = action === 'rejected' ? ((await promptDialog('Why is this being rejected? (optional)', {title:'Reject', okText:'Reject', placeholder:'Reason (optional)'})) || '') : '';
  await api(`/api/approvals/${id}`,'PUT',{action, note: note||''});
  showToast(action === 'approved' ? '✅ Approved!' : '❌ Rejected!');
  loadApprovals();
  loadApprovalBadge();
}

async function deleteUser(id) {
  if (!await confirmDialog('Delete this user? This cannot be undone.', {title:'Delete User', okText:'Delete', danger:true})) return;
  const r=await api(`/api/users/${id}`,'DELETE');
  if (r.error) return showToast(r.error,'error');
  loadUsers();
}

// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════
async function saveProfile() {
  const s=document.getElementById('profileSuccess'),e=document.getElementById('profileError');
  s.style.display='none'; e.style.display='none';
  const name=document.getElementById('pName').value.trim();
  const email=document.getElementById('pEmail').value.trim();
  const notification_email=document.getElementById('pNotifEmail').value.trim();
  const phone=document.getElementById('pPhone').value.trim();
  const currentPassword=document.getElementById('pCurrent').value;
  const newPassword=document.getElementById('pNew').value;
  const confirmPassword=document.getElementById('pConfirm').value;
  if (newPassword&&newPassword!==confirmPassword) { e.textContent='Passwords do not match'; e.style.display='block'; return; }
  const body={name,email,notification_email,phone};
  if (currentPassword) { body.currentPassword=currentPassword; body.newPassword=newPassword; }
  const r=await api('/api/profile','PUT',body);
  if (r.error) { e.textContent=r.error; e.style.display='block'; return; }
  s.textContent='Profile updated!'; s.style.display='block';
  ME.name=name; ME.phone=phone; ME.notification_email=notification_email;
  const initials=name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('sidebarName').textContent=name;
  document.getElementById('profileNameDisplay').textContent=name;
  if (!ME.profile_image) setAvatarDisplay(null, initials);
  document.getElementById('pCurrent').value='';
  document.getElementById('pNew').value='';
  document.getElementById('pConfirm').value='';
}

// ══════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════
async function api(url,method='GET',body=null) {
  const token = localStorage.getItem('authToken');
  const opts={method, headers:{'Content-Type':'application/json'}, credentials:'include'};
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body=JSON.stringify(body);
  let r;
  try {
    r = await fetch(url, opts);
  } catch(e) {
    console.error('API fetch failed:', url, e);
    return { error: 'Network error — could not reach the server' };
  }
  if (r.status===401) {
    localStorage.removeItem('authToken');
    window.location.replace('/');
    return {};
  }
  try {
    const data = await r.json();
    // If server sent a JSON error body on non-200, surface it cleanly
    if (!r.ok && !data.error) data.error = `HTTP ${r.status}`;
    return data;
  } catch(e) {
    console.error('API error:', url, r.status, e);
    if (r.status === 503) return { error: 'Server is not available right now (503) — please try again in a little while' };
    if (r.status === 502) return { error: 'Could not reach the server (502) — check that the server is running' };
    return { error: `HTTP ${r.status}` };
  }
}

// Modal band karne ka ek hi raasta — Close button, X aur Esc teeno yahin se guzarte
// hain, taaki modal ke andar chal raha Drive player har case me ruk jaaye. Warna
// X/Esc se band karne par audio background me chalti rehti hai.
function hideModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.querySelectorAll('iframe').forEach(f => f.removeAttribute('src'));
}
function closeModal(id) { hideModal(document.getElementById(id)); }

// Modals sirf Cancel/Close button se band honge — bahar click se nahi
// document.querySelectorAll('.modal-overlay').forEach(m=>{
//   m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
// });

// Har modal me top-right cross button add karo + Esc se close
document.querySelectorAll('.modal-overlay').forEach(overlay=>{
  const modal = overlay.querySelector('.modal');
  if (modal && !modal.querySelector('.modal-close-x')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-close-x';
    btn.setAttribute('aria-label','Close');
    btn.innerHTML = '✕';
    btn.onclick = () => hideModal(overlay);
    modal.prepend(btn);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(hideModal);
  }
});

async function logout() {
  await fetch('/api/logout',{method:'POST', credentials:'include'});
  localStorage.removeItem('authToken');
  window.location.replace('/');
}

// ══════════════════════════════════════════════════════
// PROOF OF WORK — photo upload (DB)
// ══════════════════════════════════════════════════════
// Photo base64 me DB me jaati hai (video ke ulat, jo Drive par jaati hai).
// Isliye browser me hi compress karte hain (max 1280px, JPEG q=0.7 => ~150-250KB),
// warna DB bahut jaldi bhar jaayega.
function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This image is corrupt or unsupported'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Hidden file input — har proof upload isi ke through hota hai
function _proofInput() {
  let el = document.getElementById('_proofFileInput');
  if (!el) {
    el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    el.capture = 'environment'; // mobile par seedha camera khulega
    el.id = '_proofFileInput';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

// Proof photo choose karo -> compress -> upload. isReplace sirf confirm dikhane ke liye.
function uploadProof(taskId, type, isReplace) {
  const input = _proofInput();
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Only image files can be uploaded','error'); return; }
    if (isReplace && !await confirmDialog('The photo can only be replaced ONCE. After this it cannot be changed again.', {title:'Replace Photo', okText:'Replace'})) return;
    showToast('⏳ Compressing photo…');
    let dataUrl;
    try { dataUrl = await compressImage(file); }
    catch (e) { showToast(e.message,'error'); return; }
    showToast('⏳ Uploading…');
    const r = await api(`/api/tasks/${taskId}/proof`,'POST',{ type, image: dataUrl });
    if (r.error) { showToast(r.error,'error'); return; }
    showToast(r.replaced ? '✅ Photo replaced!' : '✅ Proof photo uploaded');
    // Jis page par hain usko refresh karo
    if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
    else if (document.getElementById('page-alltasks').classList.contains('active')) loadAllTasks();
  };
  input.click();
}

// Proof photo dekho — image list me nahi aati, yahan alag se load hoti hai
async function viewProof(taskId, type, taskDesc) {
  document.getElementById('proofViewMeta').textContent = taskDesc || '';
  const img = document.getElementById('proofViewImg');
  const loading = document.getElementById('proofViewLoading');
  const dl = document.getElementById('proofViewDownload');
  img.style.display = 'none';
  loading.style.display = 'block';
  loading.textContent = 'Loading…';
  dl.style.display = 'none';
  document.getElementById('proofViewModal').classList.add('open');

  const r = await api(`/api/tasks/${taskId}/proof?type=${type}`);
  if (r.error) { loading.textContent = r.error; return; }
  img.src = r.image;
  img.style.display = 'inline-block';
  loading.style.display = 'none';
  dl.href = r.image;
  dl.download = `proof_${(taskDesc||'task').replace(/[^\w\s-]/g,'').trim().slice(0,40)}.jpg`;
  dl.style.display = '';
}

// ══════════════════════════════════════════════════════
// PROOF OF WORK — video upload (Google Drive)
// ══════════════════════════════════════════════════════
// Photo se alag slot hai: ek task par photo bhi ho sakti hai aur video bhi.
// Video Drive par jaati hai — DB me sirf uska file id.
// Limit server ke PROOF_VIDEO_MAX_BYTES se match honi chahiye (Apps Script ka
// payload cap) — yahan sirf isliye hai taaki 25MB upload karke fail hone se pehle
// hi user ko pata chal jaaye.
const PROOF_VIDEO_MAX_MB = 25;

function _proofVideoInput() {
  let el = document.getElementById('_proofVideoInput');
  if (!el) {
    el = document.createElement('input');
    el.type = 'file';
    el.accept = 'video/*';
    el.capture = 'environment'; // mobile par seedha camera khulega
    el.id = '_proofVideoInput';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

// 🎥 Proof video buttons — photo wale hi 3 states (upload / view / replace-once).
// side: dashboard table 'right' margin use karti hai, All Tasks 'left'.
function proofVideoBtns(t, type, side, hideWhenCompleted) {
  if (isTaskActionDisabled('proofVideo')) return '';
  // Video feature sirf Admin aur HR ke liye — baaki kisi ko koi video button nahi
  if (!(ME && (ME.role === 'admin' || isHR()))) return '';
  const desc = (t.description||t.desc||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const m = `margin-${side}:3px`;
  const done = hideWhenCompleted && t.status === 'completed';
  if (!t.has_video) {
    if (done) return '';
    return `<button class="action-btn" style="background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:4px 7px;${m}" onclick="uploadProofVideo(${t.id},'${type}',false)" title="Upload proof video (optional)">🎥</button>`;
  }
  const view = `<button class="action-btn" style="background:color-mix(in srgb,var(--success) 10%,transparent);color:var(--success);padding:4px 7px;${m}" onclick="viewProofVideo(${t.id},'${type}','${desc}')" title="Play proof video">▶️</button>`;
  const replace = (done || t.proof_video_replaced == 1) ? ''
    : `<button class="action-btn" style="background:var(--muted);color:var(--chart-1);padding:4px 7px;${m}" onclick="uploadProofVideo(${t.id},'${type}',true)" title="Replace video (allowed only once)">🎥</button>`;
  return view + replace;
}

// Video choose karo -> seedha upload. Photo ki tarah browser me compress nahi kar
// sakte (canvas trick sirf images par chalti hai), isliye size par hard limit hai.
function uploadProofVideo(taskId, type, isReplace) {
  const input = _proofVideoInput();
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) { showToast('Only video files can be uploaded','error'); return; }
    if (file.size > PROOF_VIDEO_MAX_MB * 1024 * 1024) {
      showToast(`Video is ${(file.size/1024/1024).toFixed(1)}MB — the limit is ${PROOF_VIDEO_MAX_MB}MB. Please record a shorter clip.`,'error');
      return;
    }
    if (isReplace && !await confirmDialog('The video can only be replaced ONCE. After this it cannot be changed again.', {title:'Replace Video', okText:'Replace'})) return;
    showToast('⏳ Uploading video to Drive… this can take a minute');
    // Raw binary bhejte hain, JSON base64 nahi — base64 se size 33% badh jaata hai.
    // Isliye yahan common api() helper use nahi ho sakta.
    const token = localStorage.getItem('authToken');
    const headers = { 'Content-Type': file.type };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let r;
    try {
      const resp = await fetch(`/api/tasks/${taskId}/proof-video?type=${type}`, {
        method: 'POST', headers, credentials: 'include', body: file,
      });
      try { r = await resp.json(); }
      catch { r = { error: resp.status === 413 ? `Video is too large — the limit is ${PROOF_VIDEO_MAX_MB}MB` : 'Upload failed. Please try again.' }; }
    } catch (e) {
      console.error('Video upload failed:', e);
      showToast('Upload failed — check your connection and try again','error');
      return;
    }
    if (r.error) { showToast(r.error,'error'); return; }
    // Upload hone ke baad Drive video ko stream-layak banata hai (transcoding), aur
    // tab tak player "still being processed" dikhata hai. Ye minute-do minute le
    // sakta hai, isliye pehle hi bata dete hain — warna user ko lagta hai kuch toota hai.
    showToast(r.replaced
      ? '✅ Video replaced — Drive is processing it, playback may take a minute'
      : '✅ Proof video uploaded — Drive is processing it, playback may take a minute');
    if (document.getElementById('page-dashboard').classList.contains('active')) loadDashboard();
    else if (document.getElementById('page-alltasks').classList.contains('active')) loadAllTasks();
  };
  input.click();
}

// Drive file id list me nahi aati — pehle role check wale endpoint se preview link
// lete hain, phir Drive ka player embed karte hain.
async function viewProofVideo(taskId, type, taskDesc) {
  const frame = document.getElementById('proofVideoFrame');
  const status = document.getElementById('proofVideoStatus');
  const dl = document.getElementById('proofVideoDownload');
  document.getElementById('proofVideoMeta').textContent = taskDesc || '';
  frame.style.display = 'none';
  frame.removeAttribute('src');
  dl.style.display = 'none';
  status.style.display = 'block';
  status.textContent = 'Loading…';
  document.getElementById('proofVideoModal').classList.add('open');

  const r = await api(`/api/tasks/${taskId}/proof-video?type=${encodeURIComponent(type)}`);
  if (r.error) { status.textContent = r.error; return; }
  frame.src = r.previewUrl;
  frame.style.display = '';
  status.style.display = 'none';
  dl.href = r.downloadUrl;
  dl.style.display = '';
}

// ══════════════════════════════════════════════════════
// CONFIRM / PROMPT — native browser popups ki jagah styled modal
// ══════════════════════════════════════════════════════
let _confirmCb = null;
function _confirmResolve(ok) {
  const cb = _confirmCb;
  _confirmCb = null;
  const wrap = document.getElementById('confirmInputWrap');
  const val = document.getElementById('confirmInput').value;
  document.getElementById('confirmModal').classList.remove('open');
  if (cb) cb(ok ? (wrap.style.display === 'none' ? true : val) : null);
}
// confirmDialog('Delete this task?') -> Promise<true|null>
function confirmDialog(msg, { title = 'Confirm', okText = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    _confirmCb = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    document.getElementById('confirmInputWrap').style.display = 'none';
    const ok = document.getElementById('confirmOkBtn');
    ok.textContent = okText;
    ok.style.background = danger ? 'var(--destructive)' : '';
    document.getElementById('confirmModal').classList.add('open');
  });
}
// promptDialog('Reason?') -> Promise<string|null>  (Cancel par null)
function promptDialog(msg, { title = 'Enter details', okText = 'Submit', placeholder = '', defaultValue = '' } = {}) {
  return new Promise(resolve => {
    _confirmCb = resolve;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    const wrap = document.getElementById('confirmInputWrap');
    const input = document.getElementById('confirmInput');
    wrap.style.display = '';
    input.value = defaultValue || '';
    input.placeholder = placeholder || 'Type here…';
    const ok = document.getElementById('confirmOkBtn');
    ok.textContent = okText;
    ok.style.background = '';
    document.getElementById('confirmModal').classList.add('open');
    setTimeout(() => input.focus(), 50);
  });
}

function showToast(msg,type='success') {
  const t=document.createElement('div');
  const bg=type==='error'?'var(--destructive)':'var(--foreground)';
  t.style.cssText=`position:fixed;bottom:24px;right:24px;background:${bg};color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.2);animation:fadeIn .3s ease`;
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// ══════════════════════════════════════════════════════
// ── DATE FORMAT HELPER ──────────────────────────────
// Converts YYYY-MM-DD → DD-MM-YYYY for display only
function fmtDate(d) {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}
// ── SET WEEK PLAN ───────────────────────────────────
// preEmpId / preWeek optional — Records tab se inline "Set Plan" ke liye.
async function openSetPlanModal(preEmpId, preWeek) {
  document.getElementById('setPlanErr').style.display = 'none';
  document.getElementById('setPlanErr').textContent = '';
  document.getElementById('planEmpSelect').innerHTML = '<option value="">Select Employee</option>';
  document.getElementById('planStartDate').value = preWeek || '';
  document.getElementById('planImprovementPct').value = '';
  document.getElementById('planPctPreview').textContent = '';

  // Live preview for improvement pct
  document.getElementById('planImprovementPct').oninput = function() {
    const v = parseInt(this.value);
    const preview = document.getElementById('planPctPreview');
    if (isNaN(v)) { preview.textContent = ''; return; }
    const color = v < 0 ? 'var(--destructive)' : 'var(--success)';
    const arrow = v < 0 ? '📉' : '📈';
    preview.innerHTML = `<span style="color:${color};font-weight:600">${arrow} Next week target: ${v > 0 ? '+' : ''}${v}% improvement</span>`;
  };

  // Load department employees. Admin/PC org-wide; HOD apne dept ka.
  const allUsers = await api('/api/users');
  const deptUsers = (ME.role === 'admin' || ME.role === 'pc')
    ? allUsers.filter(u => u.role === 'user' || u.role === 'employee')
    : allUsers.filter(u => u.department === ME.department && u.id !== ME.id);
  deptUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name + ' (' + u.email + ')';
    document.getElementById('planEmpSelect').appendChild(opt);
  });

  if (preEmpId) document.getElementById('planEmpSelect').value = String(preEmpId);

  document.getElementById('setPlanModal').classList.add('open');
}

async function saveWeekPlan() {
  const empId = document.getElementById('planEmpSelect').value;
  const startDate = document.getElementById('planStartDate').value;
  const improvementPct = document.getElementById('planImprovementPct').value;
  const err = document.getElementById('setPlanErr');
  err.style.display = 'none';

  if (!empId) { err.textContent = 'Please select an employee'; err.style.display = 'block'; return; }
  if (!startDate) { err.textContent = 'Please select start date of week'; err.style.display = 'block'; return; }

  const payload = {
    employeeId: parseInt(empId),
    startDate,
    targetCount: 0,
    hodId: ME.id
  };
  if (improvementPct !== '' && !isNaN(parseInt(improvementPct))) {
    payload.improvementPct = parseInt(improvementPct);
  }

  const res = await api('/api/week-plan', 'POST', payload);

  if (res.error) { err.textContent = res.error; err.style.display = 'block'; return; }
  closeModal('setPlanModal');
  showToast('✅ Week plan saved successfully!');
  // Records tab khula ho to turant refresh karke inline plan update dikhao
  if (document.getElementById('page-records').classList.contains('active')) {
    generateRecords();
  }
}



// MIS REPORT
// ══════════════════════════════════════════════════════
let misType = 'delegation';
let misData = {};
let misFMSData = [];
let misAllData = [];

// Department filter (Admin only)
async function initMISDeptFilter() {
  // Only show for admin
  const wrap = document.getElementById('misDeptFilterWrap');
  if (!wrap) return;
  if (ME && ME.role === 'admin') {
    wrap.style.display = '';
    // Departments turant bharo (Generate ka wait na karna pade) — current segment ke users se
    try {
      const users = await api(withSeg('/api/users'));
      if (Array.isArray(users)) populateMISDeptDropdown(users);
    } catch(e) {}
  } else {
    wrap.style.display = 'none';
  }
}

function populateMISDeptDropdown(data) {
  const sel = document.getElementById('misDeptFilter');
  if (!sel) return;
  const currentVal = sel.value;
  // Collect unique departments
  const depts = [...new Set((data || [])
    .map(e => (e.department || '').trim())
    .filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">All Departments</option>' +
    depts.map(d => `<option value="${d}"${d===currentVal?' selected':''}>${d}</option>`).join('');
}

function filterMISDept() {
  if (misType === 'all') {
    renderAllMIS(misAllData, misFMSData);
  } else if (misType === 'delegation' || misType === 'checklist') {
    renderMIS(misData);
  }
  // FMS MIS tab does not have per-user dept data, skip
}

function getSelectedMISDept() {
  const sel = document.getElementById('misDeptFilter');
  return sel ? sel.value : '';
}

function switchMisTab(type, el) {
  misType = type;
  document.querySelectorAll('#page-mis .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  // Department dropdown: show only on 'all' and delegation/checklist tabs for admin
  const deptWrap = document.getElementById('misDeptFilterWrap');
  if (deptWrap && ME && ME.role === 'admin') {
    deptWrap.style.display = (type !== 'fms') ? '' : 'none';
  }
  if (type === 'fms') {
    if (misFMSData.length) renderFMSMIS(misFMSData);
    else document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Click Generate to load FMS MIS</div>`;
  } else if (type === 'all') {
    if (misAllData.length) renderAllMIS(misAllData, misFMSData);
    else document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Click Generate to load All MIS</div>`;
  } else {
    if (Object.keys(misData).length) renderMIS(misData);
  }
}

async function generateMIS() {
  const start = document.getElementById('misStart').value;
  const end   = document.getElementById('misEnd').value;
  if (!start || !end) { showToast('Please select start and end date','error'); return; }
  if (start > end) { showToast('Start date must be before end date','error'); return; }

  // Init dept filter visibility
  initMISDeptFilter();

  document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Loading…</div>`;

  if (misType === 'fms') {
    const data = await api(`/api/mis/fms?start=${start}&end=${end}`);
    if (data.error) {
      document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ ${data.error}</div>`;
      showToast(data.error,'error');
      return;
    }
    misFMSData = data;
    renderFMSMIS(data);
  } else if (misType === 'all') {
    document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">Loading…</div>`;
    try {
      // ── Step 1: User-wise table pehle render karo ──
      const data = await api(withSeg(`/api/mis/all?start=${start}&end=${end}`));
      if (data && data.error) {
        document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ ${data.error}</div>`;
        showToast(data.error,'error');
        return;
      }
      // Response do form me aa sakta hai: array (sab theek) ya {rows, fmsErrors} (kuch sheet fail)
      let fmsErrors = [];
      if (Array.isArray(data)) {
        misAllData = data;
      } else if (data && Array.isArray(data.rows)) {
        misAllData = data.rows;
        fmsErrors = data.fmsErrors || [];
      } else {
        misAllData = [];
      }
      misFMSData = [];
      populateMISDeptDropdown(misAllData);
      renderAllMIS(misAllData, []);
      if (fmsErrors.length) {
        showToast(`⚠️ ${fmsErrors.length} FMS sheet(s) did not load — please Generate again`, 'error');
      }

      // ── Step 2: FMS Overview ko background me append karo ──
      if (misAllData.length) {
        const container = document.getElementById('misResults');
        const placeholder = document.createElement('div');
        placeholder.id = 'fmsOverviewLoading';
        placeholder.style.cssText = 'margin-top:18px;padding:14px;text-align:center;color:var(--muted-foreground);font-size:12px;background:var(--card);border:1px dashed var(--border);border-radius:10px';
        placeholder.innerHTML = '⏳ Loading FMS Overview… (fetching data from Google Sheets)';
        container.appendChild(placeholder);

        api(`/api/mis/fms?start=${start}&end=${end}`).then(fmsData => {
          const ph = document.getElementById('fmsOverviewLoading');
          if (fmsData && fmsData.error) {
            if (ph) ph.innerHTML = `⚠️ Could not load FMS Overview: ${fmsData.error}`;
            return;
          }
          misFMSData = Array.isArray(fmsData) ? fmsData : [];
          // Re-render to attach FMS Overview section below user table
          renderAllMIS(misAllData, misFMSData);
        }).catch(e => {
          const ph = document.getElementById('fmsOverviewLoading');
          if (ph) ph.innerHTML = `⚠️ Could not load FMS Overview: ${e.message || 'unknown error'}`;
        });
      }
    } catch (e) {
      console.error('All MIS error:', e);
      document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ Could not load All MIS: ${e.message || 'unknown error'}</div>`;
      showToast('All MIS load failed','error');
    }
  } else {
    const data = await api(withSeg(`/api/mis?start=${start}&end=${end}`));
    if (data.error) {
      document.getElementById('misResults').innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);color:var(--destructive)">⚠️ ${data.error}</div>`;
      showToast(data.error,'error');
      return;
    }
    misData = data;
    // Populate dept dropdown from delegation/checklist data
    const key = misType === 'delegation' ? 'delegation' : 'checklist';
    const rows = data[key] || [];
    // rows may not have department — skip populate if missing
    if (rows.length && rows[0].department !== undefined) {
      populateMISDeptDropdown(rows);
    }
    renderMIS(data);
  }
}

// NEGATIVE score ka color + label + bar. 0% = perfect, neeche = problems (−100 tak).
// Sab MIS-score display yehi use karein. null (koi data nahi) → dash.
// FMS completion% is helper se ALAG hai.
function misScoreStyle(score) {
  if (score === null || score === undefined || isNaN(score)) return { color:'var(--muted-foreground)', label:'—', bar:'var(--muted-foreground)', width:0 };
  if (score === 0) return { color:'var(--success)', label:'✅ Perfect', bar:'var(--muted-foreground)', width:0 };
  // negative = problems (jitna neeche, utna kharab)
  return { color:'var(--destructive)', label:'⚠️ Needs Improvement', bar:'var(--destructive)', width:Math.min(Math.abs(score), 100) };
}

function renderMIS(data) {
  const container = document.getElementById('misResults');
  const key = misType === 'delegation' ? 'delegation' : 'checklist';
  let rows = data[key] || [];

  // Apply department filter (Admin only, if rows have dept field)
  const selectedDept = getSelectedMISDept();
  if (selectedDept && rows.length && rows[0].department !== undefined) {
    rows = rows.filter(r => (r.department || '').trim() === selectedDept);
  }

  if (!rows.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No data found for this date range</div>`;
    return;
  }

  const tableRows = rows.map((r,i) => {
    const score = parseFloat(r.score);
    const st = misScoreStyle(score);
    const notScore = parseFloat(r.notOnTimeScore);

    return `<tr style="cursor:pointer" onclick="openMISDetail('${r.userId||r.id}','${r.name}')" title="Click to see task details">
      <td>
        <span style="font-weight:600;color:var(--primary);text-decoration:underline dotted">${r.name}</span>
      </td>
      <td style="font-weight:700">${r.total}</td>
      <td style="color:var(--destructive);font-weight:600">${r.pending}</td>
      <td style="color:var(--success);font-weight:600">${r.completed}</td>
      ${misType==='delegation' ? `<td style="color:var(--warning);font-weight:600">${r.revised||0}</td>` : ''}
      <td style="color:var(--destructive);font-weight:600">${r.delayed||0}</td>
      <td style="color:var(--warning);font-weight:600">${r.notOnTime||0}</td>
      <td style="font-weight:700;color:${notScore<0?'var(--destructive)':'var(--muted-foreground)'}">${notScore?notScore.toFixed(1)+'%':'—'}</td>
      <td>
        <div style="font-size:14px;font-weight:700;color:${st.color}">${score.toFixed(1)}%</div>
        <div style="font-size:10px;color:var(--muted-foreground);margin-top:1px">${st.label}</div>
        <div class="mis-score-bar">
          <div class="mis-score-fill" style="width:${st.width}%;background:${st.bar}"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="mis-table-wrap">
      <table>
        <thead><tr>
          <th>Name <span style="font-weight:400;color:var(--muted-foreground);font-size:10px">(click for details)</span></th>
          <th>Total</th><th>Pending</th><th>Completed</th>${misType==='delegation'?'<th>Revised</th>':''}<th>Delayed</th><th title="Completed tasks that were done after the due date">Not on Time</th><th title="Impact of not-on-time tasks on the score (penalty)">Not on Time %</th><th>Score %</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--muted-foreground);margin-top:10px;padding:0 4px">
      * Score: 0% = All completed | Negative = Pending/delayed tasks reduce score
    </div>`;
}

// Open MIS detail modal for a user
async function openMISDetail(userId, userName) {
  const key = misType === 'delegation' ? 'delegation' : 'checklist';
  // Find row by userId
  const row = (misData[key] || []).find(r => String(r.userId||r.id) === String(userId));
  if (!row) { showToast('Data not found, please Generate again', 'error'); return; }

  const start = document.getElementById('misStart').value;
  const end   = document.getElementById('misEnd').value;

  const data = await api(`/api/mis/detail?userId=${userId}&type=${misType}&start=${start}&end=${end}`);

  const score = parseFloat(row.score);
  const scoreColor = misScoreStyle(score).color;

  let scoreReason = '';
  if (score === 0) scoreReason = '✅ All tasks completed on time — perfect score!';
  else {
    const parts = [];
    if (parseInt(row.pending) > 0) parts.push(`${row.pending} task(s) still pending`);
    if (parseInt(row.delayed) > 0) parts.push(`${row.delayed} task(s) past due date`);
    if (parseInt(row.notOnTime) > 0) parts.push(`${row.notOnTime} task(s) completed late`);
    if (parseInt(row.revised) > 0) parts.push(`${row.revised} task(s) revised/rejected`);
    scoreReason = '⚠️ Score reduced because: ' + parts.join(', ');
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const taskRows = (data.tasks||[]).map(t => {
    // Completed Date cell: green agar due date se pehle/us din done, red agar baad me. Purane (date null) => dash.
    let completedCell;
    if (t.status === 'completed') {
      if (t.completed_at) {
        const late = t.completed_at > t.due_date;
        // Time bhi dikhao (kis waqt done hua) + proof photo ka link
        const time = t.completed_at_ts ? t.completed_at_ts.split(' ').slice(1).join(' ') : ''; // "02:24 PM"
        const pdesc = (t.description||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const proof = (t.has_proof && !isTaskActionDisabled('proofPhoto')) ? ` <span onclick="viewProof(${t.id},'${misType}','${pdesc}')" title="View proof photo" style="cursor:pointer">👁️</span>` : '';
        // Video sirf Admin/HR ko — baaki kisi ko play icon bhi nahi
        const canVideo = ME && (ME.role === 'admin' || isHR()) && !isTaskActionDisabled('proofVideo');
        const vproof = (t.has_video && canVideo) ? ` <span onclick="viewProofVideo(${t.id},'${misType}','${pdesc}')" title="Play proof video" style="cursor:pointer">▶️</span>` : '';
        completedCell = `<td style="white-space:nowrap;font-size:12px;font-weight:600;color:${late?'var(--destructive)':'var(--success)'}">${fmtDate(t.completed_at)}${time?`<span style="font-weight:400;color:var(--muted-foreground)"> ${time}</span>`:''}${proof}${vproof}</td>`;
      } else {
        completedCell = `<td style="color:var(--muted-foreground)">—</td>`;
      }
    } else if (t.status === 'pending' && t.due_date < todayStr) {
      completedCell = `<td style="color:var(--destructive);font-size:11px;font-weight:600">⏰ Overdue</td>`;
    } else {
      completedCell = `<td style="color:var(--muted-foreground)">—</td>`;
    }
    return `
    <tr>
      <td>${t.description}</td>
      <td style="color:var(--muted-foreground);font-size:12px">${t.assigned_by_name||'—'}</td>
      <td style="white-space:nowrap;font-size:12px">${fmtDate(t.due_date)}</td>
      <td><span class="status-badge ${t.status}">${t.status==='revised'?'Revision Requested':t.status.charAt(0).toUpperCase()+t.status.slice(1)}</span></td>
      ${completedCell}
      ${isTaskActionDisabled('doerRemark') ? '' : `<td style="font-size:12px;color:var(--chart-5);max-width:220px;word-break:break-word">${t.doer_remark ? escapeHtml(t.doer_remark) : '<span style="color:var(--muted-foreground)">—</span>'}</td>`}
    </tr>`;
  }).join('');

  // "Not on time" = completed tasks jinki completed_at, due_date ke baad hai
  const notOnTime = (data.tasks||[]).filter(t => t.status==='completed' && t.completed_at && t.completed_at > t.due_date).length;

  document.getElementById('misDetailTitle').textContent = `${row.name} — ${misType === 'delegation' ? 'Delegation' : 'Checklist'} Tasks`;
  const notScore = parseFloat(row.notOnTimeScore);
  const notScoreColor = misScoreStyle(notScore).color;
  document.getElementById('misDetailScore').innerHTML = `
    <div style="display:flex;gap:40px;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">MIS Score</div>
        <div style="font-size:28px;font-weight:800;color:${scoreColor}">${score.toFixed(1)}%</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Not on Time</div>
        <div style="font-size:28px;font-weight:800;color:${notScoreColor}">${isNaN(notScore)?'—':notScore.toFixed(1)+'%'}</div>
      </div>
    </div>
    <div style="font-size:13px;color:var(--muted-foreground);margin-top:8px">${scoreReason}</div>
    <div style="display:flex;gap:16px;margin-top:12px;font-size:13px;flex-wrap:wrap">
      <span>📋 Total: <strong>${row.total}</strong></span>
      <span style="color:var(--success)">✅ Done: <strong>${row.completed}</strong></span>
      <span style="color:var(--destructive)">⏳ Pending: <strong>${row.pending}</strong></span>
      <span style="color:var(--destructive)">⏰ Delayed: <strong>${row.delayed||0}</strong></span>
      <span style="color:var(--warning)">⚠️ Not on time: <strong>${notOnTime}</strong></span>
      ${misType==='delegation'?`<span style="color:var(--warning)">🔄 Revised: <strong>${row.revised||0}</strong></span>`:''}
    </div>`;
  document.getElementById('misDetailBody').innerHTML = taskRows || `<tr><td colspan="6" class="empty">No tasks found</td></tr>`;
  document.getElementById('misDetailModal').classList.add('open');
}

// Admin-only: date range ke saare users ki full MIS (Checklist + Delegation)
// ek PDF me download. Binary aata hai isliye api() ke bajaye fetch->blob.
async function downloadCombinedMIS() {
  const start = document.getElementById('misStart').value;
  const end = document.getElementById('misEnd').value;
  if (!start || !end) { showToast('Select start and end date first', 'error'); return; }
  if (start > end) { showToast('Start date cannot be after end date', 'error'); return; }
  const btn = document.getElementById('misCombinedBtn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Generating…';
  try {
    const res = await fetch(withSeg(`/api/mis/combined-pdf?start=${start}&end=${end}`), { credentials: 'same-origin' });
    if (!res.ok) {
      let msg = 'Failed to generate PDF';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      showToast(msg, 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `All-Users-MIS-${start}_to_${end}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('✅ PDF downloaded!');
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

function exportMIS() {
  // CSV escape helper — name/department me comma, quote ya newline ho to bhi columns na toote
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const fmtScore = s => (s === null || s === undefined) ? '—' : `${s}%`;
  const downloadCSV = (csv, filename) => {
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
    a.download = filename;
    a.click();
    showToast('CSV exported!');
  };
  const dateSuffix = `${document.getElementById('misStart').value}_to_${document.getElementById('misEnd').value}`;

  if (misType === 'fms') {
    if (!misFMSData || !misFMSData.length) { showToast('Generate FMS report first','error'); return; }
    const lines = ['FMS Name,Step,Doer(s),Total,Pending,Done'];
    misFMSData.forEach(fms => {
      lines.push([esc(fms.fmsName), 'Total', '', fms.total||0, fms.pending||0, fms.done||0].join(','));
      (fms.steps||[]).forEach(s => {
        lines.push([esc(fms.fmsName), esc(`Step ${s.stepOrder}: ${s.stepName}`), esc(s.doers||''), s.total||0, s.pending||0, s.done||0].join(','));
      });
    });
    downloadCSV(lines.join('\n'), `FMS_MIS_${dateSuffix}.csv`);
    return;
  }

  if (misType === 'all') {
    // ── USER-WISE All MIS export ──
    // Pehle misAllData check karo (yahi All tab generate par populate hota hai, misData nahi).
    if (!misAllData || !misAllData.length) { showToast('Generate All report first','error'); return; }
    const header = [
      'Employee','Department',
      'Del Total','Del Pending','Del Completed','Del Revised','Del Delayed','Del Score%',
      'Checklist Total','Checklist Pending','Checklist Completed','Checklist Delayed','Checklist Score%',
      'FMS Total','FMS Pending','FMS Done','FMS Score%',
      'Total All','Pending All','Completed All','Revised All','Delayed All','Overall Score%'
    ].join(',');
    const lines = [header];
    misAllData.forEach(emp => {
      const d = emp.delegation || {};
      const c = emp.checklist || {};
      const f = emp.fms || {};
      const delScore = d.total > 0 ? fmtScore(d.score) : '—';
      const chlScore = c.total > 0 ? fmtScore(c.score) : '—';
      const fmsScore = (f.total > 0 && f.score !== null && f.score !== undefined) ? fmtScore(f.score) : '—';
      const overall = (emp.overallScore === null || emp.overallScore === undefined) ? '—' : `${emp.overallScore}%`;
      lines.push([
        esc(emp.name),
        esc(emp.department || ''),
        d.total||0, d.pending||0, d.completed||0, d.revised||0, d.overdue||0, delScore,
        c.total||0, c.pending||0, c.completed||0, c.overdue||0, chlScore,
        f.total||0, f.pending||0, f.done||0, fmsScore,
        emp.totalAll||0, emp.pendingAll||0, emp.completedAll||0, emp.revisedAll||0, emp.overdueAll||0, overall
      ].join(','));
    });
    downloadCSV(lines.join('\n'), `All_MIS_UserWise_${dateSuffix}.csv`);
    return;
  }

  // Delegation / Checklist single-tab export
  if (!misData || !misData[misType]?.length) { showToast('Generate report first','error'); return; }
  const rows = misData[misType];
  const lines = ['Name,Total,Pending,Completed,Revised,Delayed,Not on Time,Not on Time %,Score%'];
  rows.forEach(r => {
    lines.push([
      esc(r.name),
      r.total||0, r.pending||0, r.completed||0, r.revised||0, r.delayed||0, r.notOnTime||0,
      fmtScore(r.notOnTimeScore||0),
      fmtScore(r.score)
    ].join(','));
  });
  downloadCSV(lines.join('\n'), `MIS_${misType}_${dateSuffix}.csv`);
}

function renderFMSMIS(data) {
  const container = document.getElementById('misResults');
  if (!data || !data.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No FMS data found</div>`;
    return;
  }
  const sections = data.map(fms => {
    const hasError = fms.error;
    const stepRows = (fms.steps||[]).map(s => `
      <tr>
        <td style="padding-left:24px;color:var(--muted-foreground);font-size:12px">Step ${s.stepOrder}: ${s.stepName}</td>
        <td style="font-size:12px;color:var(--muted-foreground)">${s.doers}</td>
        <td style="font-weight:600;color:var(--primary)">${s.total}</td>
        <td style="color:var(--destructive);font-weight:600">${s.pending}</td>
        <td style="color:var(--success);font-weight:600">${s.done}</td>
        <td>
          ${s.total > 0 ? `
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;width:80px">
            <div style="height:100%;background:var(--success);border-radius:3px;width:${Math.round((s.done/s.total)*100)}%"></div>
          </div>
          <div style="font-size:11px;color:var(--muted-foreground);margin-top:2px">${Math.round((s.done/s.total)*100)}% done</div>` : '—'}
        </td>
      </tr>`).join('');

    return `
      <div class="mis-table-wrap" style="margin-bottom:16px">
        <div style="background:var(--muted);padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:14px;font-weight:700;color:var(--foreground)">📊 ${fms.fmsName}</div>
          <div style="display:flex;gap:16px;font-size:13px">
            <span>Total: <strong style="color:var(--primary)">${fms.total}</strong></span>
            <span>Pending: <strong style="color:var(--destructive)">${fms.pending}</strong></span>
            <span>Done: <strong style="color:var(--success)">${fms.done}</strong></span>
            ${hasError ? `<span style="color:var(--destructive);font-size:11px">⚠️ ${fms.error}</span>` : ''}
          </div>
        </div>
        <table>
          <thead><tr><th>Step</th><th>Doer(s)</th><th>Total</th><th>Pending</th><th>Done</th><th>Progress</th></tr></thead>
          <tbody>${stepRows || `<tr><td colspan="6" class="empty">No step data</td></tr>`}</tbody>
        </table>
      </div>`;
  }).join('');

  container.innerHTML = sections;
}

function renderAllMIS(data, fmsData) {
  const container = document.getElementById('misResults');
  if (!data || !data.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No data found for this date range. Click Generate.</div>`;
    return;
  }

  // Apply department filter (Admin only)
  const selectedDept = getSelectedMISDept();
  const filtered = selectedDept
    ? data.filter(e => (e.department || '').trim() === selectedDept)
    : data;

  if (!filtered.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No employees found for selected department.</div>`;
    return;
  }

  const tableRows = filtered.map(emp => {
    const score = emp.overallScore;
    const st = misScoreStyle(score);
    const scoreDisplay = score === null ? '—' : `${score.toFixed(1)}%`;
    const barColor = st.bar, barWidth = st.width, scoreLabel = st.label;

    const delScore = emp.delegation.score;
    const chlScore = emp.checklist.score;
    const fmsObj = emp.fms || { total: 0, pending: 0, done: 0, score: null };
    // Server hi completedAll bhejta hai (consistent). Fallback purane response ke liye.
    const completedAll = (emp.completedAll !== undefined && emp.completedAll !== null)
      ? emp.completedAll
      : (emp.delegation.completed||0) + (emp.checklist.completed||0) + (fmsObj.done||0);

    // Mini breakdown badges — Delegation, Checklist (negative scale: <0 red, 0 green)
    const _bBg = s => s<0?'color-mix(in srgb,var(--destructive) 10%,transparent)':'color-mix(in srgb,var(--success) 10%,transparent)';
    const _bFg = s => s<0?'var(--destructive)':'var(--success)';
    const _bBd = s => s<0?'color-mix(in srgb,var(--destructive) 22%,transparent)':'color-mix(in srgb,var(--success) 22%,transparent)';
    const delBadge = emp.delegation.total > 0
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:${_bBg(delScore)};color:${_bFg(delScore)};font-weight:600;border:1px solid ${_bBd(delScore)}">Del: ${delScore.toFixed(0)}%</span>` : '';
    const chlBadge = emp.checklist.total > 0
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:${_bBg(chlScore)};color:${_bFg(chlScore)};font-weight:600;border:1px solid ${_bBd(chlScore)}">CL: ${chlScore.toFixed(0)}%</span>` : '';
    const fmsBadge = (fmsObj.total > 0 && fmsObj.score !== null)
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:8px;background:${fmsObj.score<50?'color-mix(in srgb,var(--destructive) 10%,transparent)':fmsObj.score<80?'color-mix(in srgb,var(--warning) 12%,transparent)':'color-mix(in srgb,var(--success) 10%,transparent)'};color:${fmsObj.score<50?'var(--destructive)':fmsObj.score<80?'var(--warning)':'var(--success)'};font-weight:600;border:1px solid ${fmsObj.score<50?'color-mix(in srgb,var(--destructive) 22%,transparent)':fmsObj.score<80?'color-mix(in srgb,var(--warning) 26%,transparent)':'color-mix(in srgb,var(--success) 22%,transparent)'}">FMS: ${fmsObj.score.toFixed(0)}%</span>` : '';

    // Next Week Plan column
    let planHtml = '<span style="color:var(--muted-foreground);font-size:12px">—</span>';
    if (emp.plan) {
      const weekDate = fmtDate(emp.plan.start_date);

      let improvBadge = '<span style="font-size:11px;color:var(--muted-foreground)">No improvement goal set</span>';
      if (emp.plan.improvement_pct !== null && emp.plan.improvement_pct !== undefined) {
        const ip = emp.plan.improvement_pct;
        const ipColor = ip < 0 ? 'var(--destructive)' : 'var(--success)';
        const ipBg = ip < 0 ? 'color-mix(in srgb,var(--destructive) 10%,transparent)' : 'color-mix(in srgb,var(--success) 10%,transparent)';
        const ipBorder = ip < 0 ? 'color-mix(in srgb,var(--destructive) 22%,transparent)' : 'color-mix(in srgb,var(--success) 22%,transparent)';
        const ipArrow = ip < 0 ? '📉' : '📈';
        improvBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${ipBg};color:${ipColor};font-weight:700;border:1px solid ${ipBorder}">${ipArrow} ${ip > 0 ? '+' : ''}${ip}% improvement</span>`;
      }

      planHtml = `
        <div style="font-size:11px;color:var(--muted-foreground);margin-bottom:4px">📅 Week: <strong>${weekDate}</strong></div>
        <div>${improvBadge}</div>`;
    }

    return `<tr style="cursor:pointer" onclick="openAllMISDetail('${emp.userId}','${emp.name.replace(/'/g,"\\'")}')">
      <td>
        <div style="font-weight:600;color:var(--primary);text-decoration:underline dotted">${emp.name}</div>
        <div style="font-size:11px;color:var(--muted-foreground);margin-top:2px">${emp.department||'—'}</div>
      </td>
      <td style="font-weight:700">${emp.totalAll}</td>
      <td style="color:var(--destructive);font-weight:600">${emp.pendingAll}</td>
      <td style="color:var(--success);font-weight:600">${completedAll}</td>
      <td style="color:var(--warning);font-weight:600">${emp.revisedAll}</td>
      <td style="color:var(--destructive);font-weight:600">${emp.overdueAll}</td>
      <td>${planHtml}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">${delBadge}${chlBadge}${fmsBadge}</div>
        <div style="font-size:15px;font-weight:800;color:${st.color}">${scoreDisplay}</div>
        <div style="font-size:10px;color:var(--muted-foreground)">${scoreLabel}</div>
        <div class="mis-score-bar" style="margin-top:3px">
          <div class="mis-score-fill" style="width:${barWidth}%;background:${barColor}"></div>
        </div>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="mis-table-wrap mis-scroll-x">
      <table style="min-width:900px">
        <thead><tr>
          <th>Employee <span style="font-weight:400;color:var(--muted-foreground);font-size:10px">(click for breakdown)</span></th>
          <th>Total</th><th>Pending</th><th>Completed</th><th>Revised</th><th>Delayed</th>
          <th>📅 Next Week Plan</th><th>Overall Score</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--muted-foreground);margin-top:10px;padding:0 4px">
      * Score combines Delegation + Checklist + FMS. Click employee name to see full breakdown.
    </div>`;

  // FMS section append karo agar data hai
  if (fmsData && fmsData.length) {
    const fmsRows = fmsData.map(f => {
      const pct = f.total > 0 ? Math.round((f.done/f.total)*100) : 0;
      const barColor = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--destructive)';
      return `<tr>
        <td style="font-weight:600;color:var(--foreground)">${f.fmsName}</td>
        <td style="font-weight:700">${f.total}</td>
        <td style="color:var(--destructive);font-weight:600">${f.pending}</td>
        <td style="color:var(--success);font-weight:600">${f.done}</td>
        <td>
          <div style="font-size:13px;font-weight:700;color:${barColor}">${pct}%</div>
          <div style="height:5px;border-radius:3px;background:var(--border);margin-top:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div>
          </div>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML += `
      <div style="margin-top:18px">
        <div style="font-size:13px;font-weight:700;color:var(--foreground);margin-bottom:8px">📊 FMS Overview</div>
        <div class="mis-table-wrap">
          <table>
            <thead><tr>
              <th>FMS Name</th><th>Total</th><th>Pending</th><th>Done</th><th>Completion %</th>
            </tr></thead>
            <tbody>${fmsRows}</tbody>
          </table>
        </div>
      </div>`;
  }
}

// Open All MIS detail modal for employee
async function openAllMISDetail(userId, userName) {
  const emp = (misAllData || []).find(e => String(e.userId) === String(userId));
  if (!emp) { showToast('Generate report first', 'error'); return; }

  const start = document.getElementById('misStart').value;
  const end   = document.getElementById('misEnd').value;

  // Fetch task details for both types
  const [delDetail, chlDetail] = await Promise.all([
    emp.delegation.total > 0 ? api(`/api/mis/detail?userId=${userId}&type=delegation&start=${start}&end=${end}`) : Promise.resolve({ tasks: [] }),
    emp.checklist.total > 0  ? api(`/api/mis/detail?userId=${userId}&type=checklist&start=${start}&end=${end}`)  : Promise.resolve({ tasks: [] })
  ]);

  const today = new Date().toISOString().split('T')[0];

  const makeTaskRows = (tasks, showRevised) => tasks.map(t => `
    <tr>
      <td style="font-size:12px">${t.description}</td>
      <td style="color:var(--muted-foreground);font-size:11px;white-space:nowrap">${fmtDate(t.due_date)}</td>
      <td><span class="status-badge ${t.status}">${t.status === 'revised' ? 'Revision' : t.status.charAt(0).toUpperCase()+t.status.slice(1)}</span></td>
      <td>${t.status==='pending' && t.due_date < today ? '<span style="font-size:10px;color:var(--destructive);font-weight:600">⏰ Overdue</span>' : ''}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty" style="font-size:12px">No tasks</td></tr>`;

  const score = emp.overallScore;
  const scoreColor = misScoreStyle(score).color;

  document.getElementById('misDetailTitle').textContent = `${userName} — All Tasks`;
  const fms = emp.fms || { total: 0, pending: 0, done: 0, score: null };
  const completedTotal = (emp.delegation.completed||0) + (emp.checklist.completed||0) + (fms.done||0);
  document.getElementById('misDetailScore').innerHTML = `
    <div style="font-size:28px;font-weight:800;color:${scoreColor}">${score !== null ? score.toFixed(1)+'%' : '—'}</div>
    <div style="display:flex;gap:16px;margin-top:10px;font-size:13px;flex-wrap:wrap">
      <span>📋 Total: <strong>${emp.totalAll}</strong></span>
      <span style="color:var(--success)">✅ Done: <strong>${completedTotal}</strong></span>
      <span style="color:var(--destructive)">⏳ Pending: <strong>${emp.pendingAll}</strong></span>
      <span style="color:var(--destructive)">⏰ Delayed: <strong>${emp.overdueAll}</strong></span>
      <span style="color:var(--warning)">🔄 Revised: <strong>${emp.revisedAll}</strong></span>
    </div>

    ${emp.delegation.total > 0 ? `
    <div style="margin-top:16px;border-top:1px solid var(--muted);padding-top:12px">
      <div style="font-size:13px;font-weight:700;color:var(--accent-foreground);margin-bottom:8px">📋 Delegation (${emp.delegation.total} tasks) — Score: ${emp.delegation.score > 0 ? '+' : ''}${emp.delegation.score.toFixed(1)}%</div>
      <div style="overflow-x:auto">
        <table style="font-size:12px">
          <thead><tr><th>Task</th><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>${makeTaskRows(delDetail.tasks || [], true)}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${emp.checklist.total > 0 ? `
    <div style="margin-top:16px;border-top:1px solid var(--muted);padding-top:12px">
      <div style="font-size:13px;font-weight:700;color:var(--success);margin-bottom:8px">✅ Checklist (${emp.checklist.total} tasks) — Score: ${emp.checklist.score > 0 ? '+' : ''}${emp.checklist.score.toFixed(1)}%</div>
      <div style="overflow-x:auto">
        <table style="font-size:12px">
          <thead><tr><th>Task</th><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>${makeTaskRows(chlDetail.tasks || [], false)}</tbody>
        </table>
      </div>
    </div>` : ''}

    ${fms.total > 0 ? `
    <div style="margin-top:16px;border-top:1px solid var(--muted);padding-top:12px">
      <div style="font-size:13px;font-weight:700;color:var(--chart-5);margin-bottom:8px">📊 FMS (${fms.total} entries) — Completion: ${fms.score !== null ? fms.score.toFixed(1) : 0}%</div>
      <div style="display:flex;gap:14px;font-size:12px;flex-wrap:wrap;padding:8px 10px;background:color-mix(in srgb,var(--chart-5) 12%,transparent);border-radius:8px">
        <span>Total entries: <strong>${fms.total}</strong></span>
        <span style="color:var(--success)">Done: <strong>${fms.done}</strong></span>
        <span style="color:var(--destructive)">Pending: <strong>${fms.pending}</strong></span>
      </div>
    </div>` : ''}`;

  // Reuse existing misDetailBody (blank it since we put everything in score div)
  document.getElementById('misDetailBody').innerHTML = '';
  document.getElementById('misDetailModal').classList.add('open');
}

// Set default MIS dates — rolling 1 week (7 days) ending today
function setDefaultMISDates() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  document.getElementById('misStart').value = weekAgo.toISOString().split('T')[0];
  document.getElementById('misEnd').value = today.toISOString().split('T')[0];
}

// ══════════════════════════════════════════════════════
// EMPLOYEE RECORDS  (Admin / HOD / PC — shared single source of truth)
// ══════════════════════════════════════════════════════
let recordsData = [];

function setDefaultRecordDates() {
  // Current week: Monday → Sunday
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today); monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  document.getElementById('recStart').value = monday.toISOString().split('T')[0];
  document.getElementById('recEnd').value   = sunday.toISOString().split('T')[0];
}

function loadRecords() {
  // Pehli baar khulne par default week set karo, fir auto-generate
  if (!document.getElementById('recStart').value) setDefaultRecordDates();
  // Admin ko hi dept filter dikhe
  document.getElementById('recDeptWrap').style.display = (ME.role === 'admin') ? 'block' : 'none';
  generateRecords();
}

async function generateRecords() {
  const start = document.getElementById('recStart').value;
  const end   = document.getElementById('recEnd').value;
  if (!start || !end) { showToast('Please select a week', 'error'); return; }
  const container = document.getElementById('recordsResults');
  container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">⏳ Loading records…</div>`;

  const data = await api(`/api/employee-records?start=${start}&end=${end}`);
  if (data.error) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);color:var(--destructive);">⚠️ ${data.error}</div>`;
    return;
  }
  recordsData = data.rows || [];

  // Admin dept dropdown populate
  if (ME.role === 'admin') {
    const sel = document.getElementById('recDeptFilter');
    const prev = sel.value;
    const depts = [...new Set(recordsData.map(r => (r.department||'').trim()).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}">${d}</option>`).join('');
    if (depts.includes(prev)) sel.value = prev;
  }

  renderRecords(data.fmsErrors || []);
}

function renderRecords(fmsErrors) {
  const container = document.getElementById('recordsResults');
  if (!recordsData.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No records found for this week.</div>`;
    return;
  }
  const dept = (ME.role === 'admin') ? (document.getElementById('recDeptFilter').value || '') : '';
  const q = (document.getElementById('recSearch').value || '').trim().toLowerCase();

  let rows = recordsData;
  if (dept) rows = rows.filter(r => (r.department||'').trim() === dept);
  if (q)    rows = rows.filter(r => r.name.toLowerCase().includes(q));

  if (!rows.length) {
    container.innerHTML = `<div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">No employees match the filter.</div>`;
    return;
  }

  const fmsWarn = (Array.isArray(fmsErrors) && fmsErrors.length)
    ? `<div style="background:color-mix(in srgb,var(--warning) 12%,transparent);border:1px solid color-mix(in srgb,var(--warning) 26%,transparent);color:var(--warning);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px">
         ⚠️ Some FMS sheets could not be read (${fmsErrors.join(', ')}). FMS counts may be incomplete — please refresh and try again.
       </div>` : '';

  const tableRows = rows.map(r => {
    const score = r.score;
    const scoreColor = misScoreStyle(score).color;
    const scoreTxt   = score === null ? '—' : `${score.toFixed(1)}%`;

    // Committed plan inline (har employee ke saamne)
    let committedHtml = '<span style="font-size:12px;color:var(--muted-foreground)">No plan set</span>';
    if (r.committed) {
      const ip = r.committed.improvement_pct;
      let badge = '<span style="font-size:11px;color:var(--muted-foreground)">Week set, no % goal</span>';
      if (ip !== null && ip !== undefined) {
        const c = ip < 0 ? 'var(--destructive)' : 'var(--success)';
        const bg = ip < 0 ? 'color-mix(in srgb,var(--destructive) 10%,transparent)' : 'color-mix(in srgb,var(--success) 10%,transparent)';
        const bd = ip < 0 ? 'color-mix(in srgb,var(--destructive) 22%,transparent)' : 'color-mix(in srgb,var(--success) 22%,transparent)';
        badge = `<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:${bg};color:${c};font-weight:700;border:1px solid ${bd}">${ip<0?'📉':'📈'} ${ip>0?'+':''}${ip}%</span>`;
      }
      committedHtml = `<div style="font-size:11px;color:var(--muted-foreground);margin-bottom:3px">📅 ${fmtDate(r.committed.start_date)}</div>${badge}`;
    }

    const nameEsc = r.name.replace(/'/g,"\\'");
    return `<tr>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer">
        <div style="font-weight:600;color:var(--primary);text-decoration:underline dotted">${r.name}</div>
        <div style="font-size:11px;color:var(--muted-foreground);margin-top:2px">${r.department||'—'}</div>
      </td>
      <td>${committedHtml}</td>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer;font-weight:700">${r.total}</td>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer;color:var(--success);font-weight:700">${r.done}</td>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer;color:var(--destructive);font-weight:700">${r.pending}</td>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer;color:var(--destructive);font-weight:600">${r.overdue}</td>
      <td onclick="openRecordDetail('${r.userId}')" style="cursor:pointer">
        <div style="font-size:15px;font-weight:800;color:${scoreColor}">${scoreTxt}</div>
      </td>
      <td><button class="btn btn-outline" style="padding:5px 10px;font-size:12px;white-space:nowrap"
            onclick="openSetPlanModal('${r.userId}', document.getElementById('recStart').value)">📅 Set Plan</button></td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    ${fmsWarn}
    <div class="mis-table-wrap mis-scroll-x">
      <table style="min-width:820px">
        <thead><tr>
          <th>Employee <span style="font-weight:400;color:var(--muted-foreground);font-size:10px">(click for pending)</span></th>
          <th>🎯 Committed</th>
          <th>Total</th><th>✅ Done</th><th>⏳ Pending</th><th>⏰ Overdue</th><th>Score</th><th>Plan</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--muted-foreground);margin-top:10px;padding:0 4px">
      * <strong>Total = Done + Pending</strong> (Delegation + Checklist + FMS). Score Admin/HOD/PC sabko ek jaisa.
    </div>`;
}

async function openRecordDetail(userId) {
  const r = (recordsData || []).find(e => String(e.userId) === String(userId));
  if (!r) { showToast('Generate first', 'error'); return; }

  const today = new Date().toISOString().split('T')[0];
  const scoreColor = misScoreStyle(r.score).color;

  // Committed summary
  let committedLine = '<span style="color:var(--muted-foreground)">No plan committed for this week</span>';
  if (r.committed) {
    const ip = r.committed.improvement_pct;
    committedLine = `📅 Week of <strong>${fmtDate(r.committed.start_date)}</strong>` +
      ((ip !== null && ip !== undefined) ? ` — improvement target <strong style="color:${ip<0?'var(--destructive)':'var(--success)'}">${ip>0?'+':''}${ip}%</strong>` : '');
  }

  // Pending task list builders
  const taskRow = (desc, date, tag) => `
    <tr>
      <td style="font-size:12px">${desc}</td>
      <td style="color:var(--muted-foreground);font-size:11px;white-space:nowrap">${date ? fmtDate(date) : '—'}</td>
      <td>${date && date < today ? '<span style="font-size:10px;color:var(--destructive);font-weight:700">⏰ Overdue</span>' : (tag||'')}</td>
    </tr>`;

  const delRows = (r.pendingTasks.delegation || []).map(t =>
    taskRow(t.description, t.due_date, t.status==='revised'?'<span style="font-size:10px;color:var(--warning);font-weight:700">🔄 Revision</span>':'')).join('');
  const chlRows = (r.pendingTasks.checklist || []).map(t => taskRow(t.description, t.due_date, '')).join('');
  const fmsRows = (r.pendingTasks.fms || []).map(t =>
    taskRow(`<strong>${t.fmsName}</strong> — ${t.stepName}` + (t.planValue?` <span style="color:var(--muted-foreground)">(${t.planValue})</span>`:''), t.planDate, t.isLate?'<span style="font-size:10px;color:var(--destructive);font-weight:700">⏰ Late</span>':'')).join('');

  const section = (title, color, count, bodyRows) => count === 0 ? '' : `
    <div style="margin-top:16px;border-top:1px solid var(--muted);padding-top:12px">
      <div style="font-size:13px;font-weight:700;color:${color};margin-bottom:8px">${title} — ${count} pending</div>
      <div style="overflow-x:auto">
        <table style="font-size:12px">
          <thead><tr><th>Task</th><th>Date</th><th></th></tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;

  const b = r.breakdown;
  document.getElementById('recDetailTitle').textContent = `${r.name} — Record`;
  document.getElementById('recDetailBody').innerHTML = `
    <div style="background:var(--muted);border:1px solid var(--border);border-radius:10px;padding:14px">
      <div style="font-size:12px;color:var(--muted-foreground);margin-bottom:10px">${committedLine}</div>
      <div style="font-size:26px;font-weight:800;color:${scoreColor}">${r.score !== null ? r.score.toFixed(1)+'%' : '—'}</div>
      <div style="display:flex;gap:16px;margin-top:10px;font-size:13px;flex-wrap:wrap">
        <span>📋 Total: <strong>${r.total}</strong></span>
        <span style="color:var(--success)">✅ Done: <strong>${r.done}</strong></span>
        <span style="color:var(--destructive)">⏳ Pending: <strong>${r.pending}</strong></span>
        <span style="color:var(--destructive)">⏰ Overdue: <strong>${r.overdue}</strong></span>
        ${r.revised ? `<span style="color:var(--warning)">🔄 Revised: <strong>${r.revised}</strong></span>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:11px;color:var(--muted-foreground)">
        <span style="padding:2px 8px;background:var(--accent);border:1px solid var(--accent);border-radius:8px">Delegation: ${b.delegation.done}/${b.delegation.total} done</span>
        <span style="padding:2px 8px;background:color-mix(in srgb,var(--success) 10%,transparent);border:1px solid color-mix(in srgb,var(--success) 22%,transparent);border-radius:8px">Checklist: ${b.checklist.done}/${b.checklist.total} done</span>
        <span style="padding:2px 8px;background:color-mix(in srgb,var(--chart-5) 12%,transparent);border:1px solid color-mix(in srgb,var(--chart-5) 12%,transparent);border-radius:8px">FMS: ${b.fms.done}/${b.fms.total} done</span>
      </div>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--foreground);margin-top:16px">⏳ Pending Tasks (${r.pending})</div>
    ${r.pending === 0 ? '<div class="empty" style="font-size:12px;margin-top:8px">🎉 Nothing pending — all complete!</div>' : ''}
    ${section('📋 Delegation', 'var(--accent-foreground)', b.delegation.pending, delRows)}
    ${section('✅ Checklist', 'var(--success)', b.checklist.pending, chlRows)}
    ${section('📊 FMS', 'var(--chart-5)', b.fms.pending, fmsRows)}`;

  document.getElementById('recordDetailModal').classList.add('open');
}

function exportRecords() {
  if (!recordsData.length) { showToast('Generate report first', 'error'); return; }
  const dept = (ME.role === 'admin') ? (document.getElementById('recDeptFilter').value || '') : '';
  const q = (document.getElementById('recSearch').value || '').trim().toLowerCase();
  let rows = recordsData;
  if (dept) rows = rows.filter(r => (r.department||'').trim() === dept);
  if (q)    rows = rows.filter(r => r.name.toLowerCase().includes(q));

  const esc = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const lines = ['Employee,Department,Committed Week,Improvement %,Total,Done,Pending,Overdue,Revised,Score %'];
  rows.forEach(r => {
    lines.push([
      esc(r.name), esc(r.department||''),
      esc(r.committed ? r.committed.start_date : ''),
      esc(r.committed && r.committed.improvement_pct != null ? r.committed.improvement_pct : ''),
      r.total, r.done, r.pending, r.overdue, r.revised,
      esc(r.score === null ? '' : r.score)
    ].join(','));
  });
  const start = document.getElementById('recStart').value;
  const csv = lines.join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
  a.download = `Employee_Records_${start}.csv`;
  a.click();
  showToast('CSV exported!');
}

// ══════════════════════════════════════════════════════
// FMS ADMIN
// ══════════════════════════════════════════════════════
let fmsData = { fmsName:'', sheetName:'', sheetId:'', headerRow:1, totalSteps:1 };
let fmsSteps = [];
let fmsDeleteMode = false;
let fmsDupMode = false;
let fmsAllSheets = [];
let fmsActiveId = null;
let fmsActiveStep = 0;
let fmsAllUsers = [];
let fmsSheetHeaders = [];

async function loadFMSAdmin() {
  const usersRes = await api('/api/users');
  fmsAllUsers = Array.isArray(usersRes) ? usersRes : [];
  const sheets = await api('/api/fms');
  fmsAllSheets = sheets;

  const tabsEl = document.getElementById('fmsListTabs');
  const emptyEl = document.getElementById('fmsEmpty');
  const detailEl = document.getElementById('fmsDetailView');

  if (!sheets.length) {
    tabsEl.innerHTML = '';
    emptyEl.style.display = 'block';
    detailEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  // ✅ Use fms_name if available, else sheet_name
  tabsEl.innerHTML = sheets.map(s => `
    <div class="fms-name-tab ${fmsActiveId===s.id?'active':''}" onclick="loadFMSDetail(${s.id})">${s.fms_name||s.sheet_name}</div>
  `).join('');

  if (!fmsActiveId && sheets.length) loadFMSDetail(sheets[0].id);
  else if (fmsActiveId) loadFMSDetail(fmsActiveId);
}

async function loadFMSDetail(id) {
  fmsActiveId = id;
  const sheet_data = fmsAllSheets.find(s=>s.id===id);
  document.querySelectorAll('.fms-name-tab').forEach(t => {
    t.classList.toggle('active', sheet_data && t.textContent.trim() === (sheet_data.fms_name||sheet_data.sheet_name));
  });

  const data = await api(`/api/fms/${id}`);
  const { sheet, steps } = data;
  document.getElementById('fmsDetailView').style.display = 'block';
  document.getElementById('fmsEmpty').style.display = 'none';

  // Sheet info bar
  document.getElementById('fmsSheetInfoText').innerHTML =
    `<strong>${sheet.sheet_name}</strong> &nbsp;·&nbsp; Sheet ID: <code style="background:var(--muted);padding:1px 6px;border-radius:4px;font-size:12px">${sheet.sheet_id}</code> &nbsp;·&nbsp; Header Row: ${sheet.header_row}`;

  // Step tabs
  const stepTabsEl = document.getElementById('fmsStepTabs');
  stepTabsEl.innerHTML = steps.map((s,i) => `
    <div class="fms-step-tab ${i===0?'active':''}" onclick="showFMSStep(${i})" id="fmsStepTab${i}">${s.step_name}</div>
  `).join('');

  fmsActiveStep = 0;
  showFMSStepData(steps, 0);
  document.getElementById('fmsDetailView').dataset.steps = JSON.stringify(steps);
  document.getElementById('fmsSyncResult').style.display = 'none';
}

function showFMSStep(idx) {
  fmsActiveStep = idx;
  document.querySelectorAll('.fms-step-tab').forEach((t,i) => t.classList.toggle('active', i===idx));
  const steps = JSON.parse(document.getElementById('fmsDetailView').dataset.steps || '[]');
  showFMSStepData(steps, idx);
}

function showFMSStepData(steps, idx) {
  const s = steps[idx];
  if (!s) return;
  const doerNames = (s.doers||[]).map(d=>d.name).join(', ') || '—';
  const extraRowsHtml = s.extraInput==='yes' ? `
    <div style="margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:var(--muted-foreground);margin-bottom:6px">Extra Input Rows:</div>
      ${(s.extraRows||[]).map(r=>`<div style="font-size:13px;padding:4px 0;color:var(--foreground)">• ${r.row_label||'(unnamed)'}</div>`).join('')}
    </div>` : '';

  document.getElementById('fmsStepContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Step Name</div>
        <div style="font-size:15px;font-weight:600;color:var(--foreground);margin-top:4px">${s.step_name}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Step Doer(s)</div>
        <div style="font-size:14px;color:var(--foreground);margin-top:4px">${doerNames}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Plan Column</div>
        <div style="font-size:14px;color:var(--foreground);margin-top:4px">${s.plan_col||'—'} <span style="color:var(--muted-foreground);font-size:12px">(Plan ${idx+1})</span></div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Actual Column</div>
        <div style="font-size:14px;color:var(--foreground);margin-top:4px">${s.actual_col||'—'} <span style="color:var(--muted-foreground);font-size:12px">(Actual ${idx+1})</span></div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">Extra Input</div>
        <div style="font-size:14px;color:var(--foreground);margin-top:4px">${s.extra_input==='yes'?'Yes (Col: '+s.extra_col+')':'No'}</div>
      </div>
    </div>
    ${extraRowsHtml}
    <div style="display:flex;gap:8px;margin-top:16px;border-top:1px solid var(--muted);padding-top:14px">
      ${idx>0?`<button class="btn btn-outline btn-sm" onclick="showFMSStep(${idx-1})">← Prev Step</button>`:''}
      ${idx<steps.length-1?`<button class="btn btn-primary btn-sm" onclick="showFMSStep(${idx+1})">Next Step →</button>`:''}
    </div>`;
}

async function deleteFMSSheet(id) {
  if (!await confirmDialog('Delete this FMS? This cannot be undone.', {title:'Delete FMS', okText:'Delete', danger:true})) return;
  await api(`/api/fms/${id}`,'DELETE');
  fmsActiveId = null;
  document.getElementById('fmsDetailView').style.display='none';
  showToast('FMS deleted!');
  loadFMSAdmin();
}

// ══════════════ INTAKE FORM — BUILDER (admin) ══════════════
let _intakeCols = [];    // fetched headers [{name,col,index}]
let _intakeFields = [];  // [{label,col,type,required,options}]
let _intakeNextColSel = ''; // next-step planned column (saved value, select after cols load)

// Next-step planned-column dropdown ko fetched columns se bharo (selection bachate hue)
function _populateIntakeNextCol() {
  const sel = document.getElementById('intakeNextCol');
  if (!sel) return;
  const cur = sel.value || _intakeNextColSel || '';
  const cols = _intakeCols.length ? _intakeCols : (cur ? [{ col: cur, name: cur }] : []);
  sel.innerHTML = '<option value="">-- column --</option>' +
    cols.map(c => `<option value="${escapeHtml(c.col)}" ${c.col === cur ? 'selected' : ''}>${escapeHtml(c.name)} (COL ${escapeHtml(c.col)})</option>`).join('');
}

// ── Derived plan dates (Transport = Material Ready − 1 din jaise rules) ──
let _intakeDerived = []; // [{planCol, label, offsetDays}]
function _colOptsHtml(sel) {
  const cols = _intakeCols.length ? _intakeCols : (sel ? [{ col: sel, name: sel }] : []);
  return '<option value="">-- column --</option>' +
    cols.map(c => `<option value="${escapeHtml(c.col)}" ${c.col === sel ? 'selected' : ''}>${escapeHtml(c.name)} (COL ${escapeHtml(c.col)})</option>`).join('');
}
function _syncDerivedFromDom() {
  document.querySelectorAll('#intakeDerivedList [data-dv]').forEach(row => {
    const i = parseInt(row.dataset.dv); if (!_intakeDerived[i]) return;
    _intakeDerived[i].planCol = row.querySelector('.dv-col').value;
    _intakeDerived[i].label = row.querySelector('.dv-label').value;
    _intakeDerived[i].offsetDays = parseInt(row.querySelector('.dv-off').value, 10) || 0;
    const fr = row.querySelector('.dv-from'); if (fr) _intakeDerived[i].from = fr.value;
    const hc = row.querySelector('.dv-hascond');
    if (hc && hc.checked) {
      _intakeDerived[i].cond = {
        col: (row.querySelector('.dv-condcol') || {}).value || '',
        value: (row.querySelector('.dv-condval') || {}).value || '',
        daysMatch: parseInt((row.querySelector('.dv-daysm') || {}).value, 10) || 0,
        daysElse: parseInt((row.querySelector('.dv-dayse') || {}).value, 10) || 0
      };
    } else { _intakeDerived[i].cond = null; }
  });
}
function renderDerivedSteps() {
  const box = document.getElementById('intakeDerivedList');
  if (!box) return;
  if (!_intakeDerived.length) { box.innerHTML = '<div style="color:var(--muted-foreground);font-size:12px;padding:6px 0">No derived dates. Click "+ Add" (e.g. Transport Planned = next step − 1 day).</div>'; return; }
  const fromOpts = (f) => `<option value="plan" ${f!=='actual'?'selected':''}>Next step Planned</option><option value="actual" ${f==='actual'?'selected':''}>Next step Actual (on Done)</option>`;
  const inp = "padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none";
  box.innerHTML = _intakeDerived.map((d, i) => {
    // hasCond = condition ENABLED (checkbox) — NOT "col filled". Warna tick karte hi
    // col khaali hone se checkbox turant untick ho jaata tha (condcol dropdown tab tak
    // banta hi nahi). cond object hone ka matlab hai checkbox on. Save pe khaali col
    // waise bhi null ho jaata hai (dekho saveIntakeConfig ka cond mapping).
    const hasCond = !!d.cond;
    return `<div data-dv="${i}" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px">
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="width:150px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">COLUMN</label>
          <select class="dv-col" style="width:100%;${inp};background:var(--card)">${_colOptsHtml(d.planCol)}</select></div>
        <div style="flex:1;min-width:110px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">LABEL</label>
          <input class="dv-label" value="${escapeHtml(d.label||'')}" placeholder="e.g. Tracking Planned" style="width:100%;${inp}"/></div>
        <div style="width:180px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">FROM</label>
          <select class="dv-from" style="width:100%;${inp};background:var(--card)">${fromOpts(d.from)}</select></div>
        <div style="width:80px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">DAYS (±)</label>
          <input class="dv-off" type="number" value="${Number(d.offsetDays)||0}" style="width:100%;${inp}"/></div>
        <button class="btn btn-outline btn-sm" onclick="removeDerivedStep(${i})" title="Remove" style="padding:4px 8px;color:var(--destructive);margin-bottom:1px">✕</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-foreground);margin-top:8px;cursor:pointer">
        <input type="checkbox" class="dv-hascond" ${hasCond?'checked':''} onchange="_syncDerivedFromDom(); renderDerivedSteps()" style="width:15px;height:15px"> 🔀 Condition (days depend on a field, e.g. Location)
      </label>
      ${hasCond ? `<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:6px;background:var(--muted);border-radius:8px;padding:8px">
        <span style="font-size:12px;color:var(--muted-foreground);padding-bottom:8px">If</span>
        <div style="width:140px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">COLUMN</label>
          <select class="dv-condcol" style="width:100%;${inp};background:var(--card)">${_colOptsHtml((d.cond&&d.cond.col)||'')}</select></div>
        <span style="font-size:12px;color:var(--muted-foreground);padding-bottom:8px">=</span>
        <div style="width:100px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">VALUE</label>
          <input class="dv-condval" value="${escapeHtml((d.cond&&d.cond.value)||'')}" placeholder="Delhi" style="width:100%;${inp}"/></div>
        <div style="width:80px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">DAYS ✓</label>
          <input class="dv-daysm" type="number" value="${(d.cond&&Number(d.cond.daysMatch))||0}" style="width:100%;${inp}"/></div>
        <div style="width:90px"><label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">ELSE DAYS</label>
          <input class="dv-dayse" type="number" value="${(d.cond&&Number(d.cond.daysElse))||0}" style="width:100%;${inp}"/></div>
      </div>` : ''}
    </div>`;
  }).join('');
}
function addDerivedStep() { _syncDerivedFromDom(); _intakeDerived.push({ planCol:'', label:'', offsetDays:0 }); renderDerivedSteps(); }
function removeDerivedStep(i) { _syncDerivedFromDom(); _intakeDerived.splice(i,1); renderDerivedSteps(); }

// Record-creators picker: kaunse users "New Record" bana sakte hain (empty = sabhi)
let _intakeCreators = [], _intakeAllUsers = [];
async function loadIntakeCreators() {
  const box = document.getElementById('intakeCreatorsBox');
  if (!box) return;
  if (!_intakeAllUsers.length) {
    const us = await api('/api/users');
    _intakeAllUsers = Array.isArray(us) ? us.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))) : [];
  }
  renderIntakeCreators();
}
function renderIntakeCreators() {
  const box = document.getElementById('intakeCreatorsBox');
  if (!box) return;
  if (!_intakeAllUsers.length) { box.innerHTML = '<span style="color:var(--muted-foreground);font-size:12px">No users found</span>'; return; }
  box.innerHTML = _intakeAllUsers.map(u => {
    const on = _intakeCreators.includes(Number(u.id));
    return `<label style="display:flex;align-items:center;gap:5px;font-size:11.5px;background:var(--card);border:1px solid ${on ? 'var(--chart-1)' : 'var(--border)'};border-radius:6px;padding:4px 8px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleIntakeCreator(${Number(u.id)}, this.checked)" style="accent-color:var(--chart-1);width:13px;height:13px"/>
      ${escapeHtml(u.name || ('User ' + u.id))}${u.email ? `<span style="color:var(--muted-foreground)"> · ${escapeHtml(u.email)}</span>` : ''}
    </label>`;
  }).join('');
}
function toggleIntakeCreator(id, on) {
  id = Number(id);
  if (on) { if (!_intakeCreators.includes(id)) _intakeCreators.push(id); }
  else { _intakeCreators = _intakeCreators.filter(x => x !== id); }
  renderIntakeCreators();
}

// Intake Form (config) kholne se pehle password gate — admin ko apna login password
// dobara enter karna hoga (config galti se / bina permission ke na badle).
function openIntakeForm() {
  if (!fmsActiveId) { showToast('Select an FMS first','error'); return; }
  openPwGate('Intake Form', _openIntakeFormReal);
}
async function _openIntakeFormReal() {
  if (!fmsActiveId) { showToast('Select an FMS first','error'); return; }
  const err = document.getElementById('intakeErr'); err.style.display = 'none';
  document.getElementById('intakeColsStatus').textContent = '';
  const data = await api(`/api/fms/${fmsActiveId}`);
  const sh = (data && data.sheet) || {};
  let cfg = null; try { cfg = JSON.parse(sh.intake_config || 'null'); } catch(e) {}
  document.getElementById('intakeEnabled').checked = cfg ? cfg.enabled !== false : true;
  document.getElementById('intakeSheetId').value = (cfg && cfg.targetSheetId) || sh.sheet_id || '';
  document.getElementById('intakeTab').value = (cfg && cfg.targetTab) || sh.sheet_name || '';
  document.getElementById('intakeHeaderRow').value = (cfg && cfg.targetHeaderRow) || sh.header_row || 1;
  _intakeFields = (cfg && Array.isArray(cfg.fields)) ? cfg.fields.map(f => ({...f})) : [];
  _intakeCols = [];
  // Next-step config
  const ns = cfg && cfg.nextStep;
  const nextOn = !!(ns && ns.enabled !== false && ns.planCol);
  document.getElementById('intakeNextEnabled').checked = nextOn;
  document.getElementById('intakeNextFields').style.display = nextOn ? 'flex' : 'none';
  document.getElementById('intakeNextLabel').value = (ns && ns.label) || '';
  _intakeNextColSel = (ns && ns.planCol) || '';
  _populateIntakeNextCol();
  _intakeDerived = (cfg && Array.isArray(cfg.derivedSteps)) ? cfg.derivedSteps.map(d => ({ ...d })) : [];
  renderDerivedSteps();
  _intakeCreators = (cfg && Array.isArray(cfg.recordCreators)) ? cfg.recordCreators.map(Number) : [];
  loadIntakeCreators();
  renderIntakeFields();
  document.getElementById('intakeModal').classList.add('open');
  fetchIntakeColumns(true); // Column dropdowns bharne ke liye auto-fetch
}

async function fetchIntakeColumns(silent) {
  const sheetId = document.getElementById('intakeSheetId').value.trim();
  const tab = document.getElementById('intakeTab').value.trim();
  const headerRow = document.getElementById('intakeHeaderRow').value.trim();
  const statusEl = document.getElementById('intakeColsStatus');
  if (!sheetId) { if (!silent) showToast('Enter Sheet ID first','error'); return; }
  statusEl.textContent = 'Fetching…'; statusEl.style.color = 'var(--muted-foreground)';
  const r = await api('/api/fms/fetch-headers','POST',{ sheetId, sheetName: tab, headerRow });
  if (r.error) { statusEl.textContent = '⚠️ ' + r.error; statusEl.style.color = 'var(--destructive)'; return; }
  _intakeCols = r.headers || [];
  statusEl.textContent = `✅ ${_intakeCols.length} columns loaded`; statusEl.style.color = 'var(--success)';
  _syncIntakeFieldsFromDom(); // pehle se bhare label/column edits bachao
  renderIntakeFields();
  _populateIntakeNextCol();
  _syncDerivedFromDom();
  renderDerivedSteps();
}

function addIntakeField() { _syncIntakeFieldsFromDom(); _intakeFields.push({ label:'', col:'', type:'text', required:false, options:'' }); renderIntakeFields(); }
function removeIntakeField(i) { _syncIntakeFieldsFromDom(); _intakeFields.splice(i,1); renderIntakeFields(); }
function moveIntakeField(i, dir) {
  _syncIntakeFieldsFromDom();
  const j = i + dir; if (j < 0 || j >= _intakeFields.length) return;
  [_intakeFields[i], _intakeFields[j]] = [_intakeFields[j], _intakeFields[i]];
  renderIntakeFields();
}
// DOM inputs -> model (re-render/save se pehle values bachane ke liye)
function _syncIntakeFieldsFromDom() {
  document.querySelectorAll('#intakeFieldsList [data-if]').forEach(row => {
    const i = parseInt(row.dataset.if); if (!_intakeFields[i]) return;
    _intakeFields[i].label = row.querySelector('.if-label').value;
    _intakeFields[i].col = row.querySelector('.if-col').value;
    _intakeFields[i].type = row.querySelector('.if-type').value;
    _intakeFields[i].required = row.querySelector('.if-req').checked;
    const au = row.querySelector('.if-auto'); if (au) _intakeFields[i].auto = au.checked;
    const opt = row.querySelector('.if-opts'); if (opt) _intakeFields[i].options = opt.value;
  });
}
function renderIntakeFields() {
  const box = document.getElementById('intakeFieldsList');
  if (!_intakeFields.length) { box.innerHTML = '<div style="color:var(--muted-foreground);font-size:13px;padding:14px;text-align:center;border:1px dashed var(--border);border-radius:8px">No fields yet. Click "+ Add Field".</div>'; return; }
  const colOpts = (sel) => ['<option value="">-- column --</option>'].concat(
    (_intakeCols.length ? _intakeCols : (sel ? [{col:sel, name:sel}] : []))
      .map(c => `<option value="${escapeHtml(c.col)}" ${c.col===sel?'selected':''}>${escapeHtml(c.name)} (COL ${escapeHtml(c.col)})</option>`)
  ).join('');
  const TYPE_LABELS = { text:'Text', number:'Number', date:'Date', dropdown:'Dropdown', file:'File', people:'Doer (person)' };
  const typeOpts = (t) => ['text','number','date','dropdown','file','people']
    .map(x => `<option value="${x}" ${x===t?'selected':''}>${TYPE_LABELS[x]}</option>`).join('');
  box.innerHTML = _intakeFields.map((f,i) => `
    <div data-if="${i}" style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--card)">
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:120px">
          <label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">LABEL</label>
          <input class="if-label" value="${escapeHtml(f.label||'')}" style="width:100%;padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>
        </div>
        <div style="width:150px">
          <label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">COLUMN</label>
          <select class="if-col" style="width:100%;padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">${colOpts(f.col)}</select>
        </div>
        <div style="width:118px">
          <label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">FIELD TYPE</label>
          <select class="if-type" onchange="_syncIntakeFieldsFromDom(); renderIntakeFields()" style="width:100%;padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">${typeOpts(f.type)}</select>
        </div>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted-foreground);padding-bottom:8px;cursor:pointer">
          <input class="if-req" type="checkbox" ${f.required?'checked':''} style="width:15px;height:15px"> Required
        </label>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted-foreground);padding-bottom:8px;cursor:pointer" title="Auto-fills in New Record as last value + 1 (editable). For fields like Order No.">
          <input class="if-auto" type="checkbox" ${f.auto?'checked':''} style="width:15px;height:15px"> Auto #
        </label>
        <div style="display:flex;gap:4px;padding-bottom:4px">
          <button class="btn btn-outline btn-sm" onclick="moveIntakeField(${i},-1)" title="Move up" style="padding:4px 8px">↑</button>
          <button class="btn btn-outline btn-sm" onclick="moveIntakeField(${i},1)" title="Move down" style="padding:4px 8px">↓</button>
          <button class="btn btn-outline btn-sm" onclick="removeIntakeField(${i})" title="Remove" style="padding:4px 8px;color:var(--destructive)">✕</button>
        </div>
      </div>
      ${f.type==='dropdown' ? `<div style="margin-top:8px">
        <label style="font-size:10px;font-weight:700;color:var(--muted-foreground)">DROPDOWN OPTIONS (comma separated)</label>
        <input class="if-opts" value="${escapeHtml(f.options||'')}" placeholder="e.g. Yes, No, Pending" style="width:100%;padding:7px 9px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>
      </div>` : ''}
    </div>`).join('');
}

async function saveIntakeConfig() {
  _syncIntakeFieldsFromDom();
  const err = document.getElementById('intakeErr'); err.style.display = 'none';
  const fields = _intakeFields.filter(f => f.col);
  for (const f of fields) {
    if (f.type === 'dropdown' && !(f.options||'').trim()) { err.textContent = `Dropdown field "${f.label||f.col}" needs options.`; err.style.display='block'; return; }
  }
  const nextEnabled = document.getElementById('intakeNextEnabled').checked;
  const nextCol = document.getElementById('intakeNextCol').value;
  if (nextEnabled && !nextCol) { err.textContent = 'Pick the next step’s Planned column (or turn the option off).'; err.style.display='block'; return; }
  const config = {
    enabled: document.getElementById('intakeEnabled').checked,
    targetSheetId: document.getElementById('intakeSheetId').value.trim(),
    targetTab: document.getElementById('intakeTab').value.trim(),
    targetHeaderRow: parseInt(document.getElementById('intakeHeaderRow').value) || null,
    fields: fields.map(f => ({ label:(f.label||'').trim()||f.col, col:f.col, type:f.type||'text', required:!!f.required, auto:!!f.auto, options:f.type==='dropdown'?(f.options||''):'' })),
    nextStep: (nextEnabled && nextCol) ? { enabled:true, planCol:nextCol, label:(document.getElementById('intakeNextLabel').value.trim()||'Next step planned date') } : null,
    derivedSteps: (_syncDerivedFromDom(), _intakeDerived.filter(d => d.planCol).map(d => ({ planCol:d.planCol, label:(d.label||'').trim(), offsetDays:parseInt(d.offsetDays,10)||0, from:(d.from==='actual'?'actual':'plan'), cond:(d.cond&&d.cond.col)?{ col:d.cond.col, value:(d.cond.value||'').trim(), daysMatch:parseInt(d.cond.daysMatch,10)||0, daysElse:parseInt(d.cond.daysElse,10)||0 }:null }))),
    recordCreators: _intakeCreators.slice()
  };
  const r = await api(`/api/fms/${fmsActiveId}/intake`,'PUT',{ config });
  if (r.error) { err.textContent = r.error; err.style.display='block'; return; }
  closeModal('intakeModal');
  showToast('✅ Intake form saved!');
}

// ══════════════ INTAKE FORM — NEW RECORD (submit, users) ══════════════
let _newRecordConfig = null, _newRecordFmsId = null, _newRecordUsers = [];
let _nrInPhase2 = false, _nrRow = null; // phase 2 = create ke baad next-step plan date

async function openNewRecord(fmsId) {
  const id = fmsId || fmsTasksActiveFmsId;   // Admin: fmsActiveId, FMS Tasks: fmsTasksActiveFmsId
  if (!id) { showToast('Select an FMS first','error'); return; }
  _newRecordFmsId = id;
  _nrInPhase2 = false; _nrRow = null;
  document.getElementById('newRecordErr').style.display = 'none';
  const box = document.getElementById('newRecordFields');
  box.innerHTML = '<div style="color:var(--muted-foreground);font-size:13px;padding:14px;text-align:center">Loading…</div>';
  document.getElementById('newRecordSub').textContent = '';
  const _nrBtn = document.getElementById('newRecordSubmitBtn');
  _nrBtn.onclick = submitNewRecord; _nrBtn.textContent = 'Create Record'; _nrBtn.disabled = false;
  document.getElementById('newRecordModal').classList.add('open');
  const r = await api(`/api/fms-tasks/${id}/intake`);
  if (r.error) { box.innerHTML = `<div style="color:var(--destructive);padding:12px">${escapeHtml(r.error)}</div>`; return; }
  const cfg = r.config;
  if (!cfg || cfg.enabled === false || !Array.isArray(cfg.fields) || !cfg.fields.length) {
    box.innerHTML = '<div style="color:var(--muted-foreground);padding:14px;text-align:center">No intake form is set up for this FMS yet. Configure it from FMS Admin → 📝 Intake Form.</div>';
    return;
  }
  _newRecordConfig = cfg;
  // 'Doer (person)' fields ho to app ke users ki naam-list laao (dropdown ke liye)
  _newRecordUsers = [];
  if (cfg.fields.some(f => f.type === 'people')) {
    const us = await api('/api/users');
    _newRecordUsers = Array.isArray(us) ? us.map(u => u.name).filter(Boolean).sort((a, b) => a.localeCompare(b)) : [];
  }
  // FMS ka naam — FMS Tasks dropdown se (agar wahi selected) warna admin ke fmsAllSheets se
  let fmsName = '';
  const sel = document.getElementById('fmsTasksSelect');
  if (sel && String(sel.value) === String(id)) fmsName = sel.options[sel.selectedIndex]?.text || '';
  if (!fmsName) { const s = (fmsAllSheets || []).find(x => x.id === id); fmsName = s ? (s.fms_name || s.sheet_name) : 'this FMS'; }
  document.getElementById('newRecordSub').textContent = 'A new row will be added to ' + fmsName + '.';
  renderNewRecordFields();
  // Bulk upload section — fields ke labels se format hint + show
  const _bulkSec = document.getElementById('fmsBulkSection');
  const _bulkFmt = document.getElementById('fmsBulkFormat');
  if (_bulkSec && _bulkFmt) {
    const _cols = _newRecordConfig.fields.filter(f => f.type !== 'file').map(f => f.label || f.col);
    _bulkFmt.innerHTML = `Columns (in this order): <b>${_cols.map(escapeHtml).join(', ')}</b>. File columns are not included in the CSV — add them later from Edit Record.`;
    const _bf = document.getElementById('fmsBulkFile'); if (_bf) _bf.value = '';
    _bulkSec.style.display = 'block';
  }
  // Auto-number field (jaise Order No) → last+1 se prefill (editable). Blank sheet → 1.
  const autoField = _newRecordConfig.fields.find(f => f.auto);
  if (autoField) {
    try {
      const nr = await api(`/api/fms-tasks/${id}/next-number?col=${encodeURIComponent(autoField.col)}`);
      const el = document.querySelector(`#newRecordFields .nr-in[data-col="${autoField.col}"]`);
      if (el && nr && nr.next != null) el.value = nr.next;
    } catch (e) {}
  }
}

function renderNewRecordFields() {
  const box = document.getElementById('newRecordFields');
  const base = "width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none";
  box.innerHTML = _newRecordConfig.fields.map(f => {
    const req = f.required ? ' <span style="color:var(--destructive)">*</span>' : '';
    const label = `<label style="font-size:12px;font-weight:600;color:var(--foreground);display:block;margin-bottom:4px">${escapeHtml(f.label||f.col)}${req}</label>`;
    let input;
    if (f.type === 'number') input = `<input type="number" class="nr-in" data-col="${escapeHtml(f.col)}" data-type="number" style="${base}"/>`;
    else if (f.type === 'date') input = `<input type="date" class="nr-in" data-col="${escapeHtml(f.col)}" data-type="date" style="${base}"/>`;
    else if (f.type === 'dropdown') {
      const opts = (f.options||'').split(',').map(o=>o.trim()).filter(Boolean);
      input = `<select class="nr-in" data-col="${escapeHtml(f.col)}" data-type="dropdown" style="${base};background:var(--card)"><option value="">-- select --</option>${opts.map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
    }
    else if (f.type === 'people') {
      input = `<select class="nr-in" data-col="${escapeHtml(f.col)}" data-type="people" style="${base};background:var(--card)"><option value="">-- select doer --</option>${_newRecordUsers.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</select>`;
    }
    else if (f.type === 'file') input = `<input type="file" class="nr-in" data-col="${escapeHtml(f.col)}" data-type="file" accept="image/*,application/pdf" style="${base};padding:7px"/>`;
    else input = `<input type="text" class="nr-in" data-col="${escapeHtml(f.col)}" data-type="text" style="${base}"/>`;
    return `<div style="margin-bottom:12px">${label}${input}</div>`;
  }).join('');
}

async function submitNewRecord() {
  const err = document.getElementById('newRecordErr'); err.style.display = 'none';
  const btn = document.getElementById('newRecordSubmitBtn');
  const inputs = [...document.querySelectorAll('#newRecordFields .nr-in')];
  for (const f of _newRecordConfig.fields) {
    if (!f.required) continue;
    const el = inputs.find(x => x.dataset.col === f.col); if (!el) continue;
    if (f.type === 'file') { if (!el.files || !el.files.length) { err.textContent = `${f.label||f.col} is required`; err.style.display='block'; return; } }
    else if (!el.value.trim()) { err.textContent = `${f.label||f.col} is required`; err.style.display='block'; return; }
  }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const values = {};
    const fileJobs = []; // file fields — record banne ke BAAD background me upload honge
    for (const el of inputs) {
      const col = el.dataset.col, type = el.dataset.type;
      if (type === 'file') {
        if (el.files && el.files.length) {
          values[col] = 'Uploading…';        // placeholder; asli link background me aayega
          fileJobs.push({ col, file: el.files[0] });
        }
      } else if (type === 'date') {
        values[col] = el.value ? _isoToDMY(el.value) : '';
      } else {
        values[col] = el.value;
      }
    }
    // Record TURANT bana do (file ka wait nahi) — isse 15s ka hang khatam
    const r = await api(`/api/fms-tasks/${_newRecordFmsId}/intake`,'POST',{ values });
    if (r.error) { err.textContent = r.error; err.style.display='block'; return; }
    showToast(fileJobs.length ? '✅ Record created — file background me upload ho rahi…' : '✅ Record created!');
    // File(s) BACKGROUND me upload → link apne aap us cell me aa jaayega (await nahi)
    fileJobs.forEach(job => _uploadFileToCell(_newRecordFmsId, job.file, r.row, job.col));
    const sel = document.getElementById('fmsTasksSelect');
    if (sel && String(sel.value) === String(_newRecordFmsId)) onFMSTasksSelect();
    // Next step configured ho to plan-date wala phase 2 dikhao; warna band karo
    const ns = _newRecordConfig.nextStep;
    if (ns && ns.enabled && ns.planCol) _showNextStepPhase(r.row, ns);
    else closeModal('newRecordModal');
  } finally {
    if (!_nrInPhase2) { btn.disabled = false; btn.textContent = 'Create Record'; }
  }
}

// File ko upload karke seedha (row,col) cell me HYPERLINK likhwao — background me.
async function _uploadFileToCell(fmsId, file, row, col) {
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`/api/fms-tasks/${fmsId}/intake-upload?row=${row}&col=${encodeURIComponent(col)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || '') },
      body: buf
    });
    const j = await res.json().catch(() => null);
    if (j && j.success) showToast('📎 File added to the sheet');
    else showToast('⚠️ File upload fail — sheet me "Uploading…" cell dobara bharni padegi', 'error');
  } catch (e) { showToast('⚠️ File upload failed', 'error'); }
}

// Phase 2 — record ban gaya, ab next step ki Planned date bharo (usi row ke plan-col me)
function _showNextStepPhase(row, ns) {
  _nrInPhase2 = true; _nrRow = row;
  const _bs = document.getElementById('fmsBulkSection'); if (_bs) _bs.style.display = 'none';   // phase 2 me bulk hide
  document.getElementById('newRecordErr').style.display = 'none';
  document.getElementById('newRecordSub').innerHTML = 'Record created ✅ — set the next step’s planned date now, <span style="color:var(--muted-foreground)">or Cancel to fill it later from ⏳ Plan date pending.</span>';
  const base = "width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none";
  document.getElementById('newRecordFields').innerHTML =
    `<label style="font-size:12px;font-weight:600;color:var(--foreground);display:block;margin-bottom:4px">${escapeHtml(ns.label || 'Next step planned date')} <span style="color:var(--destructive)">*</span></label>
     <input type="date" id="nrNextDate" style="${base}"/>`;
  const btn = document.getElementById('newRecordSubmitBtn');
  btn.textContent = 'Save Planned Date'; btn.disabled = false; btn.onclick = saveNextStepDate;
  setTimeout(() => { const el = document.getElementById('nrNextDate'); if (el) el.focus(); }, 50);
}

async function saveNextStepDate() {
  const err = document.getElementById('newRecordErr'); err.style.display = 'none';
  const dateEl = document.getElementById('nrNextDate');
  if (!dateEl || !dateEl.value) { err.textContent = 'Please pick a date.'; err.style.display = 'block'; return; }
  const btn = document.getElementById('newRecordSubmitBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = await api(`/api/fms-tasks/${_newRecordFmsId}/intake-nextstep`, 'POST', { row: _nrRow, date: _isoToDMY(dateEl.value).replace(/-/g, '/') });
  btn.disabled = false; btn.textContent = 'Save Planned Date';
  if (r.error) { err.textContent = r.error; err.style.display = 'block'; return; }
  _nrInPhase2 = false;
  closeModal('newRecordModal');
  showToast('✅ Next step planned date set!');
  const sel = document.getElementById('fmsTasksSelect');
  if (sel && String(sel.value) === String(_newRecordFmsId)) onFMSTasksSelect();
}

async function _uploadIntakeFile(fmsId, file) {
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch(`/api/fms-tasks/${fmsId}/intake-upload`, {
      method:'POST', credentials:'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || '') },
      body: buf
    });
    return await res.json();
  } catch(e) { return { error: 'Upload failed: ' + e.message }; }
}
function _isoToDMY(iso) { const p = String(iso).split('-'); return p.length===3 ? `${p[2]}-${p[1]}-${p[0]}` : iso; }
function _dmyToIso(dmy) { const m = String(dmy||'').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : ''; }

// ══════════════ EDIT RECORD (Order No se dhoondo -> intake fields edit) ══════════════
let _editRecordConfig = null, _editRecordFmsId = null, _editRecordRow = null;
function openEditRecord() {
  const id = fmsTasksActiveFmsId;
  if (!id) { showToast('Select an FMS first', 'error'); return; }
  _editRecordFmsId = id; _editRecordRow = null; _editRecordConfig = null;
  document.getElementById('editRecordErr').style.display = 'none';
  document.getElementById('editRecordSearch').value = '';
  document.getElementById('editRecordFields').innerHTML = '<div style="color:var(--muted-foreground);font-size:12px;padding:10px;text-align:center">Enter an Order No and click Find</div>';
  document.getElementById('editRecordSaveBtn').style.display = 'none';
  document.getElementById('editRecordModal').classList.add('open');
  setTimeout(() => { const s = document.getElementById('editRecordSearch'); if (s) s.focus(); }, 60);
}
async function findEditRecord() {
  const q = document.getElementById('editRecordSearch').value.trim();
  const err = document.getElementById('editRecordErr'); err.style.display = 'none';
  if (!q) { err.textContent = 'Enter an Order No'; err.style.display = 'block'; return; }
  const box = document.getElementById('editRecordFields');
  box.innerHTML = '<div style="color:var(--muted-foreground);font-size:12px;padding:10px;text-align:center">Searching…</div>';
  document.getElementById('editRecordSaveBtn').style.display = 'none';
  const r = await api(`/api/fms-tasks/${_editRecordFmsId}/find-record?orderNo=${encodeURIComponent(q)}`);
  if (r.error) { box.innerHTML = ''; err.textContent = r.error; err.style.display = 'block'; return; }
  _editRecordConfig = { fields: r.fields }; _editRecordRow = r.rowNumber;
  if (r.fields.some(f => f.type === 'people') && !(_newRecordUsers && _newRecordUsers.length)) {
    const us = await api('/api/users'); _newRecordUsers = Array.isArray(us) ? us.map(u => u.name).filter(Boolean).sort((a, b) => a.localeCompare(b)) : [];
  }
  renderEditRecordFields(r.values || {});
  document.getElementById('editRecordSaveBtn').style.display = 'inline-flex';
}
function renderEditRecordFields(values) {
  const box = document.getElementById('editRecordFields');
  const base = "width:100%;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none";
  box.innerHTML = _editRecordConfig.fields.map(f => {
    const cur = values[f.col] != null ? String(values[f.col]) : '';
    const req = f.required ? ' <span style="color:var(--destructive)">*</span>' : '';
    const label = `<label style="font-size:12px;font-weight:600;color:var(--foreground);display:block;margin-bottom:4px">${escapeHtml(f.label || f.col)}${req} <span style="color:var(--muted-foreground);font-weight:400">(COL ${escapeHtml(f.col)})</span></label>`;
    let input;
    if (f.type === 'number') input = `<input type="number" class="er-in" data-col="${escapeHtml(f.col)}" data-type="number" value="${escapeHtml(cur)}" style="${base}"/>`;
    else if (f.type === 'date') input = `<input type="date" class="er-in" data-col="${escapeHtml(f.col)}" data-type="date" value="${escapeHtml(_dmyToIso(cur))}" style="${base}"/>`;
    else if (f.type === 'dropdown') { const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean); input = `<select class="er-in" data-col="${escapeHtml(f.col)}" data-type="dropdown" style="${base};background:var(--card)"><option value="">-- select --</option>${opts.map(o => `<option value="${escapeHtml(o)}" ${o === cur ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`; }
    else if (f.type === 'people') { input = `<select class="er-in" data-col="${escapeHtml(f.col)}" data-type="people" style="${base};background:var(--card)"><option value="">-- select doer --</option>${(_newRecordUsers || []).map(n => `<option value="${escapeHtml(n)}" ${n === cur ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>`; }
    else if (f.type === 'file') input = `${cur ? `<div style="font-size:12px;color:var(--foreground);margin-bottom:4px">📎 file already set</div>` : ''}<input type="file" class="er-in" data-col="${escapeHtml(f.col)}" data-type="file" accept="image/*,application/pdf" style="${base};padding:7px"/><div style="font-size:10.5px;color:var(--muted-foreground);margin-top:3px">Choose a new file to replace (optional)</div>`;
    else input = `<input type="text" class="er-in" data-col="${escapeHtml(f.col)}" data-type="text" value="${escapeHtml(cur)}" style="${base}"/>`;
    return `<div style="margin-bottom:12px">${label}${input}</div>`;
  }).join('');
}
async function saveEditRecord() {
  const err = document.getElementById('editRecordErr'); err.style.display = 'none';
  const btn = document.getElementById('editRecordSaveBtn');
  const inputs = [...document.querySelectorAll('#editRecordFields .er-in')];
  for (const f of _editRecordConfig.fields) {
    if (!f.required || f.type === 'file') continue;   // file: nayi na chuni to purani rehne do
    const el = inputs.find(x => x.dataset.col === f.col); if (!el) continue;
    if (!el.value.trim()) { err.textContent = `${f.label || f.col} is required`; err.style.display = 'block'; return; }
  }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const values = {}; const fileJobs = [];
    for (const el of inputs) {
      const col = el.dataset.col, type = el.dataset.type;
      if (type === 'file') { if (el.files && el.files.length) fileJobs.push({ col, file: el.files[0] }); }
      else if (type === 'date') values[col] = el.value ? _isoToDMY(el.value) : '';
      else values[col] = el.value;
    }
    const r = await api(`/api/fms-tasks/${_editRecordFmsId}/update-record`, 'POST', { rowNumber: _editRecordRow, values });
    if (r.error) { err.textContent = r.error; err.style.display = 'block'; return; }
    fileJobs.forEach(job => _uploadFileToCell(_editRecordFmsId, job.file, _editRecordRow, job.col));   // background
    showToast(fileJobs.length ? '✅ Updated — file uploading…' : '✅ Record updated!');
    const sel = document.getElementById('fmsTasksSelect');
    if (sel && String(sel.value) === String(_editRecordFmsId)) onFMSTasksSelect();
    closeModal('editRecordModal');
  } finally { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
}

// ══════════════ BULK ADD (New Record — ek saath kaafi records, CSV) ══════════════
function fmsBulkSample() {
  if (!_newRecordConfig) { showToast('Open New Record first', 'error'); return; }
  const fields = _newRecordConfig.fields.filter(f => f.type !== 'file');
  const header = fields.map(f => (f.label || f.col)).join(',');
  const example = fields.map(f => f.type === 'date' ? '30/07/2026' : f.type === 'number' ? '1' : (f.type === 'dropdown' || f.type === 'people') ? ((f.options || '').split(',')[0] || 'sample').trim() : 'sample').join(',');
  downloadFile(`${header}\n${example}`, 'fms_bulk_sample.csv');
}
async function fmsBulkUpload() {
  const fileEl = document.getElementById('fmsBulkFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  const err = document.getElementById('newRecordErr'); err.style.display = 'none';
  if (!file) { err.textContent = 'Select a CSV file first'; err.style.display = 'block'; return; }
  if (!_newRecordConfig) { err.textContent = 'Config not loaded'; err.style.display = 'block'; return; }
  const btn = document.getElementById('fmsBulkUploadBtn'); if (btn.disabled) return;
  btn.disabled = true; btn.textContent = '⏳ Uploading…';
  try {
    const text = await file.text();
    const rawRows = parseCSVRows(text).filter(r => r.some(c => String(c || '').trim()));
    if (rawRows.length < 2) { err.textContent = 'CSV needs a header row plus at least 1 data row'; err.style.display = 'block'; return; }
    const headers = rawRows[0].map(h => String(h || '').trim().toLowerCase());
    const fields = _newRecordConfig.fields.filter(f => f.type !== 'file');
    const map = {}; fields.forEach(f => { map[f.col] = headers.indexOf(String(f.label || f.col).trim().toLowerCase()); });
    if (fields.every(f => map[f.col] < 0)) { err.textContent = 'CSV headers did not match — download the Sample and use the same format'; err.style.display = 'block'; return; }
    const rows = [];
    for (let r = 1; r < rawRows.length; r++) {
      const rr = rawRows[r]; const rec = {};
      fields.forEach(f => { const ci = map[f.col]; rec[f.col] = ci >= 0 ? String(rr[ci] || '').trim() : ''; });
      rows.push(rec);
    }
    const res = await api(`/api/fms-tasks/${_newRecordFmsId}/bulk-intake`, 'POST', { rows });
    if (res.error) { err.textContent = res.error; err.style.display = 'block'; return; }
    showToast(`✅ ${res.added} records added!`);
    const sel = document.getElementById('fmsTasksSelect'); if (sel && String(sel.value) === String(_newRecordFmsId)) onFMSTasksSelect();
    closeModal('newRecordModal');
  } catch (e) { err.textContent = 'Upload failed: ' + e.message; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = '⬆ Upload CSV'; }
}

// ── Plan date pending (baad me fill) ──
async function openPlanPending() {
  const fmsId = fmsTasksActiveFmsId;
  if (!fmsId) { showToast('Select an FMS first', 'error'); return; }
  document.getElementById('planPendingErr').style.display = 'none';
  const box = document.getElementById('planPendingList');
  box.innerHTML = '<div style="color:var(--muted-foreground);font-size:13px;padding:14px;text-align:center">Loading…</div>';
  document.getElementById('planPendingModal').classList.add('open');
  const r = await api(`/api/fms-tasks/${fmsId}/plan-pending`);
  if (r.error) { box.innerHTML = `<div style="color:var(--destructive);padding:12px">${escapeHtml(r.error)}</div>`; return; }
  _renderPlanPending(fmsId, r.rows || [], r.label || 'Planned date');
}

function _renderPlanPending(fmsId, rows, label) {
  const box = document.getElementById('planPendingList');
  if (!rows.length) {
    box.innerHTML = '<div style="color:var(--success);padding:16px;text-align:center;font-size:13px">✅ No records waiting — every plan date is set.</div>';
    return;
  }
  const base = "padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none";
  box.innerHTML = rows.map(row => {
    const info = (row.preview || []).filter(p => p.value).map(p => `<b>${escapeHtml(p.value)}</b>`).join(' · ') || `Row ${row.rowNumber}`;
    return `<div data-pp="${row.rowNumber}" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--card)">
      <div style="font-size:13px;color:var(--foreground);margin-bottom:8px">${info} <span style="color:var(--muted-foreground);font-size:11px">(row ${row.rowNumber})</span></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="date" class="pp-date" style="${base};flex:1">
        <button class="btn btn-primary btn-sm" onclick="savePlanPendingRow(${fmsId}, ${row.rowNumber}, this)">Save ${escapeHtml(label)}</button>
      </div>
    </div>`;
  }).join('');
}

async function savePlanPendingRow(fmsId, rowNumber, btn) {
  const wrap = btn.closest('[data-pp]');
  const dateEl = wrap.querySelector('.pp-date');
  const err = document.getElementById('planPendingErr'); err.style.display = 'none';
  if (!dateEl.value) { err.textContent = 'Pick a date for this record.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = await api(`/api/fms-tasks/${fmsId}/intake-nextstep`, 'POST', { row: rowNumber, date: _isoToDMY(dateEl.value).replace(/-/g, '/') });
  if (r.error) { err.textContent = r.error; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Save'; return; }
  wrap.remove();  // us row ko list se hata do
  showToast('✅ Plan date set!');
  if (!document.querySelectorAll('#planPendingList [data-pp]').length) {
    document.getElementById('planPendingList').innerHTML = '<div style="color:var(--success);padding:16px;text-align:center;font-size:13px">✅ All done!</div>';
  }
  // FMS Tasks refresh (step ab pending dikhega) + button count update
  const sel = document.getElementById('fmsTasksSelect');
  if (sel && String(sel.value) === String(fmsId)) onFMSTasksSelect();
}

// ── Edit FMS ──
async function openEditFMS() {
  if (!fmsActiveId) return;
  const usersRes = await api('/api/users');
  fmsAllUsers = Array.isArray(usersRes) ? usersRes : [];
  const data = await api(`/api/fms/${fmsActiveId}`);
  const { sheet, steps } = data;

  document.getElementById('editFmsFmsName').value = sheet.fms_name || sheet.sheet_name;
  document.getElementById('editFmsSheetName').value = sheet.sheet_name;
  document.getElementById('editFmsSheetId').value = sheet.sheet_id;
  document.getElementById('editFmsHeaderRow').value = sheet.header_row;
  document.getElementById('fmsEditErr').style.display='none';

  fmsSteps = steps.map(s => ({
    stepName: s.step_name,
    doers: (s.doers||[]).map(d=>parseInt(d.user_id)),
    planCol: s.plan_col||'',
    actualCol: s.actual_col||'',
    extraInput: s.extra_input||'no',
    extraCol: s.extra_col||'',
    extraRows: (s.extraRows||[]).map(r=>({col_letter:r.col_letter||'', field_type:r.field_type||'text', label:r.row_label||r.label||r.col_letter||'', dropdown_options:r.dropdown_options||'', required: r.required==null?1:([0,1,2].includes(Number(r.required))?Number(r.required):(r.required?1:0))})),
    showCols: s.show_cols_parsed || [],
    delayReasonCol: s.delay_reason_col||'',
    doerNameCol: s.doer_name_col||''
  }));

  fmsDeleteMode = false;
  fmsDupMode = false;
  document.getElementById('editFmsDeleteModeBtn').textContent = '🗑 Select to Delete';
  document.getElementById('fmsConfirmDeleteBtn').style.display='none';
  const dupBtn = document.getElementById('editFmsDupModeBtn');
  const dupConfBtn = document.getElementById('editFmsDupConfirmBtn');
  if (dupBtn) dupBtn.textContent = '📋 Duplicate';
  if (dupConfBtn) dupConfBtn.style.display = 'none';

  // Open modal first — show loading
  document.getElementById('fmsEditModal').classList.add('open');
  const container = document.getElementById('fmsEditStepsContainer');
  container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted-foreground)">⏳ Loading headers...</div>`;

  // Fetch headers
  fmsSheetHeaders = [];
  try {
    const payload = { sheetId: sheet.sheet_id, sheetName: sheet.sheet_name, headerRow: sheet.header_row };
    console.log('Fetching headers:', payload);
    const hRes = await api('/api/fms/fetch-headers','POST', payload);
    console.log('Headers response:', hRes);
    fmsSheetHeaders = hRes.headers || [];
    if (fmsSheetHeaders.length) showToast(`✅ ${fmsSheetHeaders.length} headers loaded!`);
    else showToast(`⚠️ ${hRes.error || 'No headers found'}`, 'error');
  } catch(e) {
    console.error('Headers fetch error:', e);
    showToast('⚠️ Headers fetch failed','error');
  }

  // Render steps with or without headers
  container.innerHTML = '';
  fmsSteps.forEach((_,i) => appendFMSStepBox(i, 'fmsEditStepsContainer'));
  updateEditStepNav();
}

function updateEditStepNav() {
  const nav = document.getElementById('editFmsStepNav');
  if (!nav) return;
  nav.innerHTML = fmsSteps.map((s,i)=>`
    <div class="fms-step-tab active" onclick="scrollToStep(${i})" style="font-size:11px;padding:4px 10px">${s.stepName||'Step '+(i+1)}</div>
  `).join('');
}

function scrollToStep(idx) {
  const boxes = document.querySelectorAll('.fms-step-box');
  if (boxes[idx]) boxes[idx].scrollIntoView({behavior:'smooth', block:'center'});
}

async function saveEditFMS() {
  const fmsName    = document.getElementById('editFmsFmsName')?.value.trim() || document.getElementById('editFmsSheetName').value.trim();
  const sheetName  = document.getElementById('editFmsSheetName').value.trim();
  const sheetId    = document.getElementById('editFmsSheetId').value.trim();
  const headerRow  = parseInt(document.getElementById('editFmsHeaderRow').value)||1;
  const err = document.getElementById('fmsEditErr');
  err.style.display='none';

  if (!sheetName) { err.textContent='Sheet Tab Name required'; err.style.display='block'; return; }

  // ✅ Read latest values from DOM (same as saveFMS does)
  const boxes = document.querySelectorAll('#fmsEditStepsContainer .fms-step-box');
  boxes.forEach((box, i) => {
    if (!fmsSteps[i]) return;
    const nameInput = box.querySelector('input[type=text]');
    if (nameInput) fmsSteps[i].stepName = nameInput.value.trim() || `Step ${i+1}`;
    fmsSteps[i].step_order = i+1;
    // Flush dropdown_options and labels for all extraRows from DOM
    (fmsSteps[i].extraRows||[]).forEach((_, ri) => {
      const el = document.getElementById(`fmsDropOpt_${i}_${ri}`);
      if (el) fmsSteps[i].extraRows[ri].dropdown_options = el.value;
      const labelEl = document.getElementById(`fmsExtraLabel_${i}_${ri}`);
      if (labelEl) fmsSteps[i].extraRows[ri].label = labelEl.value;
    });
  });

  console.log('Saving steps count:', fmsSteps.length); // debug

  const r = await api(`/api/fms/${fmsActiveId}`,'PUT',{
    fmsName: fmsName || sheetName,
    sheetName, sheetId, headerRow,
    steps: fmsSteps.map(s=>({...s, showCols:s.showCols||[], delayReasonCol:s.delayReasonCol||'', doerNameCol:s.doerNameCol||s.doer_name_col||'', extraRows:(s.extraRows||[]).map(r=>({...r,dropdown_options:r.dropdown_options||''}))}))
  });
  if (r.error) { err.textContent=r.error; err.style.display='block'; return; }

  closeModal('fmsEditModal');
  showToast('✅ FMS updated! Steps: ' + fmsSteps.length);
  fmsSheetHeaders = [];
  loadFMSAdmin();
}

// ── Sync Data ──
async function syncFMSData() {
  const syncBtn = document.querySelector('[onclick="syncFMSData()"]');
  if (syncBtn) { syncBtn.textContent='⏳ Syncing...'; syncBtn.disabled=true; }

  const r = await api(`/api/fms/${fmsActiveId}/sync`);

  if (syncBtn) { syncBtn.textContent='🔄 Sync Data'; syncBtn.disabled=false; }

  const syncEl = document.getElementById('fmsSyncResult');

  if (r.error) {
    syncEl.style.cssText='display:block;background:color-mix(in srgb,var(--destructive) 10%,transparent);border:1px solid color-mix(in srgb,var(--destructive) 22%,transparent);border-radius:12px;padding:16px;margin-top:14px';
    syncEl.innerHTML=`<strong style="color:var(--destructive)">❌ Error:</strong> <span style="color:var(--foreground)">${r.error}</span>`;
    return;
  }

  const headerBadges = r.headers.map(h=>
    `<span style="background:var(--accent);color:var(--accent-foreground);padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">${h}</span>`
  ).join(' ');

  syncEl.style.cssText='display:block;background:color-mix(in srgb,var(--success) 10%,transparent);border:1px solid color-mix(in srgb,var(--success) 22%,transparent);border-radius:12px;padding:16px;margin-top:14px';
  syncEl.innerHTML=`
    <div style="font-weight:600;color:var(--success);margin-bottom:10px;font-size:14px">✅ Sync Successful!</div>
    <div style="font-size:13px;color:var(--foreground);margin-bottom:6px">
      📊 Header Row: <strong>${r.headerRow}</strong> &nbsp;·&nbsp; Total Data Rows: <strong>${r.totalRows}</strong>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--muted-foreground);margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px">
      Headers Found (${r.headers.length}):
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${r.sample?.length?'12px':'0'}">
      ${headerBadges}
    </div>
    ${r.sample?.length ? `
    <div style="font-size:12px;font-weight:600;color:var(--muted-foreground);margin-bottom:6px;margin-top:8px;text-transform:uppercase;letter-spacing:.4px">All Data (${r.sample.length} rows):</div>
    <div style="overflow-x:auto;max-height:300px;overflow-y:auto">
      <table style="font-size:12px;border-collapse:collapse;width:100%">
        <thead><tr>${r.headers.map(h=>`<th style="padding:4px 8px;background:color-mix(in srgb,var(--success) 10%,transparent);border:1px solid color-mix(in srgb,var(--success) 22%,transparent);text-align:left;font-weight:600;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
        <tbody>${r.sample.map(row=>`<tr>${r.headers.map((_,ci)=>`<td style="padding:4px 8px;border:1px solid var(--border);color:var(--foreground);white-space:nowrap">${row[ci]||'—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
  `;
}

// ── Add New FMS Flow ──
function openAddFMS() {
  document.getElementById('fmsFmsName').value='';
  document.getElementById('fmsSheetName').value='';
  document.getElementById('fmsSheetId').value='';
  document.getElementById('fmsHeaderRow').value='1';
  document.getElementById('fmsTotalSteps').value='1';
  document.getElementById('fmsAddErr').style.display='none';
  fmsActiveId = null; // ✅ Reset so saveFMS doesn't PUT on wrong ID
  document.getElementById('fmsAddModal').classList.add('open');
}

function proceedToShareNotice() {
  const fmsName = document.getElementById('fmsFmsName').value.trim();
  const name = document.getElementById('fmsSheetName').value.trim();
  const id   = document.getElementById('fmsSheetId').value.trim();
  const err  = document.getElementById('fmsAddErr');
  if (!fmsName) { err.textContent='FMS Name required'; err.style.display='block'; return; }
  if (!name) { err.textContent='Sheet Tab Name required'; err.style.display='block'; return; }
  if (!id)   { err.textContent='Sheet ID required'; err.style.display='block'; return; }

  fmsData = {
    fmsName,
    sheetName: name,
    sheetId: id,
    headerRow: parseInt(document.getElementById('fmsHeaderRow').value)||1,
    totalSteps: parseInt(document.getElementById('fmsTotalSteps').value)||1
  };

  closeModal('fmsAddModal');
  startShareCountdown();
}

// Server par jo service account hai wahi — hardcode NAHI karna. Pehle yahan ek
// insaan ka email likha tha, jisse sheet share karne par server ko access milta
// hi nahi tha. Ek baar laakar yaad rakh lete hain.
let _fmsServiceAccountEmail = null;

// Returns { email } or { error } — never a bare null, so the caller can show
// what actually went wrong instead of guessing at one cause.
async function getFMSServiceAccountEmail() {
  if (_fmsServiceAccountEmail) return { email: _fmsServiceAccountEmail };
  const r = await api('/api/fms/service-account');
  if (r && r.email) { _fmsServiceAccountEmail = r.email; return { email: r.email }; }
  return { error: (r && r.error) || 'Could not reach the server' };
}

function startShareCountdown() {
  const emailEl = document.getElementById('fmsShareEmail');
  if (emailEl) {
    emailEl.textContent = 'Loading...';
    getFMSServiceAccountEmail().then(r => {
      emailEl.textContent = r.email || `⚠️ ${r.error}`;
    });
  }

  document.getElementById('fmsShareModal').classList.add('open');
  const btn = document.getElementById('fmsSkipBtn');
  const cd  = document.getElementById('fmsCountdown');
  let sec = 7;
  btn.style.pointerEvents='none'; btn.style.opacity='.6';
  btn.innerHTML = `Skip (<span id="fmsCountdown">${sec}</span>s)`;
  const timer = setInterval(()=>{
    sec--;
    const cdEl = document.getElementById('fmsCountdown');
    if (cdEl) cdEl.textContent = sec;
    if (sec<=0) {
      clearInterval(timer);
      btn.style.pointerEvents='auto'; btn.style.opacity='1';
      btn.innerHTML = 'Skip & Continue →';
    }
  }, 1000);
}

async function copyFMSEmail() {
  const { email, error } = await getFMSServiceAccountEmail();
  if (!email) { showToast(error || 'Could not fetch the service account email', 'error'); return; }
  navigator.clipboard.writeText(email).then(()=>showToast('Email copied!')).catch(()=>{
    const el = document.createElement('textarea');
    el.value = email; document.body.appendChild(el);
    el.select(); document.execCommand('copy');
    document.body.removeChild(el); showToast('Email copied!');
  });
}

async function proceedToStepsConfig() {
  closeModal('fmsShareModal');
  if (!fmsAllUsers.length) { const ur = await api('/api/users'); fmsAllUsers = Array.isArray(ur) ? ur : []; }

  // Build default steps
  fmsSteps = [];
  const container = document.getElementById('fmsStepsContainer');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted-foreground)">⏳ Loading headers...</div>';
  for (let i=0; i<fmsData.totalSteps; i++) {
    fmsSteps.push({ stepName:`Step ${i+1}`, doers:[], planCol:'', actualCol:'', extraInput:'no', extraCol:'', extraRows:[], showCols:[], delayReasonCol:'', doerNameCol:'' }); // extraRows items: {col_letter, field_type, label}
  }

  fmsDeleteMode = false;
  const addDelBtn = document.getElementById('fmsAddDeleteModeBtn');
  const addDelConfBtn = document.getElementById('fmsAddConfirmDeleteBtn');
  if (addDelBtn) addDelBtn.textContent = '🗑 Select to Delete';
  if (addDelConfBtn) addDelConfBtn.style.display='none';
  document.getElementById('fmsStepsModal').classList.add('open');

  // Fetch headers after modal open
  fmsSheetHeaders = [];
  try {
    const hRes = await api('/api/fms/fetch-headers', 'POST', {
      sheetId: fmsData.sheetId,
      sheetName: fmsData.sheetName,
      headerRow: fmsData.headerRow
    });
    fmsSheetHeaders = hRes.headers || [];
    if (fmsSheetHeaders.length) showToast(`✅ ${fmsSheetHeaders.length} headers loaded!`);
    else showToast('⚠️ No headers found','error');
  } catch(e) {
    showToast('⚠️ Headers fetch failed — using text input','error');
  }

  // Re-render steps with headers
  container.innerHTML = '';
  fmsSteps.forEach((_, i) => appendFMSStepBox(i, 'fmsStepsContainer'));
}

function appendFMSStepBox(idx, containerId) {
  const cid = containerId || 'fmsStepsContainer';
  const container = document.getElementById(cid);
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'fms-step-box';
  div.dataset.idx = idx;
  div.draggable = true;
  div.innerHTML = buildStepBoxHTML(idx);
  container.appendChild(div);
  setupDragEvents(div);
  setupMultiSelect(idx);
  // Show existing doer tags
  updateFMSDoerTags(idx);
}

function buildStepBoxHTML(idx) {
  const s = fmsSteps[idx];
  const userOptions = fmsAllUsers.map(u=>`
    <div class="multi-select-item" data-uid="${u.id}" onclick="toggleFMSDoer(event,${idx},${u.id})">
      <input type="checkbox" ${(s.doers||[]).map(d=>parseInt(d)).includes(parseInt(u.id))?'checked':''}/> ${u.name}
    </div>`).join('');

  // Build header options for selects — MUST be declared BEFORE extraRowsHTML
  const headers = fmsSheetHeaders || [];

  const extraRowsHTML = (s.extraRows||[]).map((r,ri)=>{
    const colSel = headers.length ? `
      <select onchange="onFMSExtraColChange(${idx},${ri},this)"
        style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">
        <option value="">-- Select Column --</option>
        ${headers.map(h=>`<option value="${h.col}" data-name="${h.name}" ${(r.col_letter)===h.col?'selected':''}>` + h.name + ` (COL ${h.col})</option>`).join('')}
      </select>` : `
      <input type="text" value="${r.col_letter||''}" placeholder="Col e.g. AS"
        oninput="fmsSteps[${idx}].extraRows[${ri}].col_letter=this.value"
        style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>`;
    const labelField = `<input type="text" value="${(r.label||'').replace(/"/g,'&quot;')}" placeholder="Label (auto from header)"
      oninput="fmsSteps[${idx}].extraRows[${ri}].label=this.value"
      id="fmsExtraLabel_${idx}_${ri}"
      style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>`;
    const ftSel = `<select onchange="onFMSExtraTypeChange(${idx},${ri},this.value)"
      style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">
      <option value="text" ${(r.field_type||'text')==='text'?'selected':''}>📝 Text</option>
      <option value="number" ${r.field_type==='number'?'selected':''}>🔢 Number</option>
      <option value="date" ${r.field_type==='date'?'selected':''}>📅 Date</option>
      <option value="link" ${r.field_type==='link'?'selected':''}>🔗 Link</option>
      <option value="dropdown" ${r.field_type==='dropdown'?'selected':''}>🔽 Dropdown</option>
      <option value="file" ${r.field_type==='file'?'selected':''}>📎 File (photo / PDF → Drive)</option>
    </select>`;
    const dropSection = r.field_type==='dropdown' ? buildDropdownOptionsHTML(idx, ri, r) : '';
    // required: 0=optional, 1=always required, 2=required-only-when-late (Actual > Planned).
    // Purani rows me undefined = 1 (pehle jaisa — always required).
    const reqVal = (r.required === 0 || r.required === false || r.required === '0') ? 0
                 : (r.required === 2 || r.required === '2') ? 2 : 1;
    return `<div class="extra-row-item" id="fmsExtraRow_${idx}_${ri}" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
        <div>
          <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Column</div>
          ${colSel}
        </div>
        <div>
          <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Label</div>
          ${labelField}
        </div>
        <div>
          <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Field Type</div>
          ${ftSel}
        </div>
        <div>
          <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Required?</div>
          <select onchange="fmsSteps[${idx}].extraRows[${ri}].required=parseInt(this.value)"
            style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:var(--card);cursor:pointer">
            <option value="0" ${reqVal===0?'selected':''}>Optional</option>
            <option value="1" ${reqVal===1?'selected':''}>Always required</option>
            <option value="2" ${reqVal===2?'selected':''}>Required if late (Actual &gt; Planned)</option>
          </select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:6px">
        <button class="action-btn delete" style="padding:4px 12px" onclick="removeFMSExtraRow(${idx},${ri})">✕ Remove Row</button>
      </div>
      <div id="fmsDropOptSection_${idx}_${ri}">${dropSection}</div>
    </div>`;
  }).join('');
  const blankOpt = `<option value="">-- Select Column --</option>`;
  const hdrOpts = headers.map(h=>`<option value="${h.col}" title="${h.name}">${h.name} (COL ${h.col})</option>`).join('');

  // Show cols — multi-select badges
  const showColsSelected = s.showCols || [];
  const showColsBadges = showColsSelected.map(ci=>{
    const hdr = headers[ci] || { name:`COL ${ci}`, col:'' };
    return `<span class="hdr-tag" onclick="removeFMSShowCol(${idx},${ci})">${hdr.name} <span class="rm">✕</span></span>`;
  }).join('');
  const unusedHeaders = headers.filter(h=>!showColsSelected.includes(h.index));
  const showColsOpts = `<option value="">+ Add column to show</option>`+unusedHeaders.map(h=>`<option value="${h.index}">${h.name} (COL ${h.col})</option>`).join('');

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="fms-step-num">Step ${idx+1}</div>
      ${fmsDeleteMode?`<input type="checkbox" class="fms-del-check" style="margin-left:auto" data-idx="${idx}"/>`:''}
      ${fmsDupMode?`<input type="checkbox" class="fms-dup-check" style="margin-left:auto;accent-color:var(--chart-5)" data-idx="${idx}"/>`:''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0">
        <label>Step Name</label>
        <input type="text" value="${s.stepName||''}" placeholder="Step Name"
          oninput="fmsSteps[${idx}].stepName=this.value;updateStepNum(${idx},this.value)"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>
      </div>
      <div class="form-group" style="margin:0">
        <label>Step Doer(s)</label>
        <div class="multi-select-wrap" id="fmsDoerWrap_${idx}">
          <div class="selected-tags" id="fmsDoerTags_${idx}" onclick="toggleFMSDropdown(${idx})">
            <span style="color:var(--muted-foreground);font-size:12px">Select users...</span>
          </div>
          <div class="multi-select-dropdown" id="fmsDoerDrop_${idx}">
            <div class="multi-select-search">
              <input type="text" id="fmsDoerSearch_${idx}" placeholder="Search users..." autocomplete="off"
                oninput="filterFMSDoers(${idx}, this.value)" onclick="event.stopPropagation()"/>
            </div>
            <div id="fmsDoerList_${idx}">${userOptions}</div>
            <div id="fmsDoerNoMatch_${idx}" style="display:none;padding:10px 12px;font-size:12px;color:var(--muted-foreground)">No users match</div>
          </div>
        </div>
      </div>
      <div class="form-group" style="margin:0">
        <label>Plan <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(Plan ${idx+1})</span></label>
        ${headers.length ? `
        <select class="header-select" onchange="fmsSteps[${idx}].planCol=this.value">
          ${blankOpt}${headers.map(h=>`<option value="${h.col}" ${s.planCol===h.col?'selected':''}>${h.name} (COL ${h.col})</option>`).join('')}
        </select>` : `
        <input type="text" value="${s.planCol||''}" placeholder="Column e.g. I"
          oninput="fmsSteps[${idx}].planCol=this.value"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>`}
      </div>
      <div class="form-group" style="margin:0">
        <label>Actual <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(Actual ${idx+1})</span></label>
        ${headers.length ? `
        <select class="header-select" onchange="fmsSteps[${idx}].actualCol=this.value">
          ${blankOpt}${headers.map(h=>`<option value="${h.col}" ${s.actualCol===h.col?'selected':''}>${h.name} (COL ${h.col})</option>`).join('')}
        </select>` : `
        <input type="text" value="${s.actualCol||''}" placeholder="Column e.g. J"
          oninput="fmsSteps[${idx}].actualCol=this.value"
          style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>`}
      </div>
    </div>

    <!-- Columns to show in FMS Tasks -->
    <div class="form-group" style="margin:10px 0 0">
      <label>Columns to Show in FMS Tasks <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(blank = show all)</span></label>
      ${headers.length ? `
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--muted);max-height:160px;overflow-y:auto">
        ${headers.map(h => `
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-weight:500;cursor:pointer;text-transform:none;letter-spacing:0;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:3px 8px;white-space:nowrap">
            <input type="checkbox" ${showColsSelected.includes(h.index)?'checked':''}
              onchange="if(this.checked){if(!fmsSteps[${idx}].showCols.includes(${h.index}))fmsSteps[${idx}].showCols.push(${h.index})}else{fmsSteps[${idx}].showCols=fmsSteps[${idx}].showCols.filter(x=>x!==${h.index})}"
              style="accent-color:var(--primary);width:12px;height:12px"/>
            ${h.name}
          </label>`).join('')}
      </div>` : '<span style="color:var(--muted-foreground);font-size:12px">Will appear once headers are loaded</span>'}
    </div>

    <!-- Delay Reason Column -->
    <div class="form-group" style="margin:10px 0 0">
      <label>Delay Reason Column <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(where the delay reason gets saved)</span></label>
      ${headers.length ? `
      <select class="header-select" onchange="fmsSteps[${idx}].delayReasonCol=this.value">
        <option value="">-- None (don't save delay reason) --</option>
        ${headers.map(h=>`<option value="${h.col}" ${s.delayReasonCol===h.col?'selected':''}>${h.name} (COL ${h.col})</option>`).join('')}
      </select>` : `
      <input type="text" value="${s.delayReasonCol||''}" placeholder="e.g. K"
        oninput="fmsSteps[${idx}].delayReasonCol=this.value"
        style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>`}
    </div>

    <div class="form-group" style="margin:10px 0 0">
      <label>Doer Name Column <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(where the doer's name is saved on completion)</span></label>
      <div style="display:flex;gap:8px;align-items:stretch">
        ${headers.length ? `
        <select class="header-select" id="fmsDoerNameCol_${idx}" onchange="fmsSteps[${idx}].doerNameCol=this.value" style="flex:1">
          <option value="">-- None (don't save doer name) --</option>
          ${headers.map(h=>`<option value="${h.col}" ${(s.doerNameCol||s.doer_name_col||'')===h.col?'selected':''}>${h.name} (COL ${h.col})</option>`).join('')}
        </select>` : `
        <input type="text" id="fmsDoerNameCol_${idx}" value="${s.doerNameCol||s.doer_name_col||''}" placeholder="e.g. L"
          oninput="fmsSteps[${idx}].doerNameCol=this.value"
          style="flex:1;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>`}
        <button class="btn btn-sm" type="button" onclick="loadDoersFromColumn(${idx})"
          style="background:var(--success);color:#fff;border:none;padding:0 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap"
          title="Auto-fill Step Doers from this column's unique values">
          🔄 Load Doers
        </button>
      </div>
      <div id="fmsLoadDoersResult_${idx}" style="margin-top:8px;font-size:12px;display:none"></div>
    </div>

    <div class="form-group" style="margin:10px 0 0">
      <label>Extra Input</label>
      <select onchange="toggleFMSExtra(${idx},this.value)"
        style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none">
        <option value="no" ${s.extraInput==='no'?'selected':''}>No</option>
        <option value="yes" ${s.extraInput==='yes'?'selected':''}>Yes</option>
      </select>
    </div>
    <div id="fmsExtraSection_${idx}" style="display:${s.extraInput==='yes'?'block':'none'};margin-top:10px;background:var(--muted);border-radius:8px;padding:12px">
      <!-- Column selection moved to individual rows below -->
      <div id="fmsExtraRows_${idx}">${extraRowsHTML}</div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addFMSExtraRow(${idx})">+ Add Row</button>
    </div>`;
}

function addFMSShowCol(idx, colIndex) {
  if (isNaN(colIndex)) return;
  if (!fmsSteps[idx].showCols) fmsSteps[idx].showCols = [];
  if (!fmsSteps[idx].showCols.includes(colIndex)) {
    fmsSteps[idx].showCols.push(colIndex);
    refreshStepBox(idx);
  }
}

function removeFMSShowCol(idx, colIndex) {
  if (!fmsSteps[idx].showCols) return;
  fmsSteps[idx].showCols = fmsSteps[idx].showCols.filter(c=>c!==colIndex);
  refreshStepBox(idx);
}

function updateStepNum(idx, val) {
  const boxes = document.querySelectorAll('.fms-step-box');
  boxes.forEach((b,i)=>{
    const numEl = b.querySelector('.fms-step-num');
    if (numEl) numEl.textContent = `Step ${i+1}`;
  });
}

function toggleFMSExtra(idx, val) {
  fmsSteps[idx].extraInput = val;
  document.getElementById(`fmsExtraSection_${idx}`).style.display = val==='yes'?'block':'none';
}

function addFMSExtraRow(idx) {
  if (!fmsSteps[idx].extraRows) fmsSteps[idx].extraRows=[];
  // Flush any dropdown_options values typed in DOM before re-render
  fmsSteps[idx].extraRows.forEach((_, ri) => {
    const el = document.getElementById(`fmsDropOpt_${idx}_${ri}`);
    if (el) fmsSteps[idx].extraRows[ri].dropdown_options = el.value;
    const labelEl = document.getElementById(`fmsExtraLabel_${idx}_${ri}`);
    if (labelEl) fmsSteps[idx].extraRows[ri].label = labelEl.value;
  });
  fmsSteps[idx].extraRows.push({col_letter:'', field_type:'text', label:'', dropdown_options:'', required:1});
  refreshStepBox(idx);
  setupMultiSelect(idx);
  updateFMSDoerTags(idx);
}

function buildExtraRowHTML(idx, ri, headers) {
  const r = (fmsSteps[idx].extraRows || [])[ri] || {};
  const colSel = headers.length
    ? `<select onchange="onFMSExtraColChange(${idx},${ri},this)"
        style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">
        <option value="">-- Select Column --</option>
        ${headers.map(h=>`<option value="${h.col}" data-name="${h.name}" ${r.col_letter===h.col?'selected':''}>${h.name} (COL ${h.col})</option>`).join('')}
      </select>`
    : `<input type="text" value="${r.col_letter||''}" placeholder="Col e.g. AS"
        oninput="fmsSteps[${idx}].extraRows[${ri}].col_letter=this.value"
        style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>`;
  const labelField = `<input type="text" value="${(r.label||'').replace(/"/g,'&quot;')}" placeholder="Label (auto-filled from header)"
    oninput="fmsSteps[${idx}].extraRows[${ri}].label=this.value"
    id="fmsExtraLabel_${idx}_${ri}"
    style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none"/>`;
  const ftSel = `<select onchange="onFMSExtraTypeChange(${idx},${ri},this.value)"
    style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;background:var(--card)">
    <option value="text" ${(r.field_type||'text')==='text'?'selected':''}>📝 Text</option>
    <option value="number" ${r.field_type==='number'?'selected':''}>🔢 Number</option>
    <option value="date" ${r.field_type==='date'?'selected':''}>📅 Date</option>
    <option value="link" ${r.field_type==='link'?'selected':''}>🔗 Link</option>
    <option value="dropdown" ${r.field_type==='dropdown'?'selected':''}>🔽 Dropdown</option>
  </select>`;
  const dropOptsSection = r.field_type==='dropdown' ? buildDropdownOptionsHTML(idx, ri, r) : '';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
      <div>
        <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Column</div>
        ${colSel}
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Label</div>
        ${labelField}
      </div>
      <div>
        <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px;margin-bottom:3px">Field Type</div>
        ${ftSel}
      </div>
      <div style="display:flex;align-items:flex-end">
        <button class="action-btn delete" style="padding:5px 14px;width:100%" onclick="removeFMSExtraRow(${idx},${ri})">✕ Remove</button>
      </div>
    </div>
    <div id="fmsDropOptSection_${idx}_${ri}">${dropOptsSection}</div>`;
}

function buildDropdownOptionsHTML(idx, ri, r) {
  const opts = (r.dropdown_options || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div style="margin-top:4px">
    <label style="font-size:11px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.3px">Dropdown Options <span style="color:var(--muted-foreground);font-weight:400">(comma separated, e.g. Yes,No,N/A)</span></label>
    <input type="text" value="${opts}" placeholder="Yes,No,N/A or Option1,Option2,Option3"
      oninput="fmsSteps[${idx}].extraRows[${ri}].dropdown_options=this.value"
      id="fmsDropOpt_${idx}_${ri}"
      style="width:100%;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:12px;font-family:'Inter',sans-serif;outline:none;margin-top:4px"/>
  </div>`;
}

function onFMSExtraColChange(idx, ri, sel) {
  fmsSteps[idx].extraRows[ri].col_letter = sel.value;
  // Auto-fill label from header name
  const selectedOpt = sel.options[sel.selectedIndex];
  const headerName = selectedOpt.dataset.name || sel.value;
  fmsSteps[idx].extraRows[ri].label = headerName;
  const labelEl = document.getElementById(`fmsExtraLabel_${idx}_${ri}`);
  if (labelEl) labelEl.value = headerName;
}

function onFMSExtraTypeChange(idx, ri, val) {
  fmsSteps[idx].extraRows[ri].field_type = val;
  const section = document.getElementById(`fmsDropOptSection_${idx}_${ri}`);
  if (section) {
    section.innerHTML = val === 'dropdown' ? buildDropdownOptionsHTML(idx, ri, fmsSteps[idx].extraRows[ri]) : '';
  }
}

function removeFMSExtraRow(idx, ri) {
  // Flush all dropdown_options and labels from DOM before splice so data isn't lost
  fmsSteps[idx].extraRows.forEach((_, i) => {
    const el = document.getElementById(`fmsDropOpt_${idx}_${i}`);
    if (el) fmsSteps[idx].extraRows[i].dropdown_options = el.value;
    const labelEl = document.getElementById(`fmsExtraLabel_${idx}_${i}`);
    if (labelEl) fmsSteps[idx].extraRows[i].label = labelEl.value;
  });
  fmsSteps[idx].extraRows.splice(ri,1);
  refreshStepBox(idx);
  setupMultiSelect(idx);
  updateFMSDoerTags(idx);
}

function toggleFMSDropdown(idx) {
  const drop = document.getElementById(`fmsDoerDrop_${idx}`);
  const opened = drop.classList.toggle('open');
  // Khulte hi cursor search box me — taaki 25 users ki list me scroll na karna pade
  if (opened) {
    const box = document.getElementById(`fmsDoerSearch_${idx}`);
    if (box) { box.value = ''; filterFMSDoers(idx, ''); box.focus(); }
  }
}

// Naam se list chhaanto. Chune hue users hamesha dikhte hain, chahe search se
// match na karein — warna filter karte hi lagta hai ki selection udd gayi.
function filterFMSDoers(idx, term) {
  const q = (term || '').trim().toLowerCase();
  const list = document.getElementById(`fmsDoerList_${idx}`);
  if (!list) return;
  const chosen = (fmsSteps[idx].doers || []).map(Number);
  let shown = 0;
  list.querySelectorAll('.multi-select-item').forEach(item => {
    const uid = parseInt(item.dataset.uid);
    const name = (item.textContent || '').trim().toLowerCase();
    const visible = !q || name.includes(q) || chosen.includes(uid);
    item.style.display = visible ? '' : 'none';
    if (visible) shown++;
  });
  const none = document.getElementById(`fmsDoerNoMatch_${idx}`);
  if (none) none.style.display = shown ? 'none' : 'block';
}

function toggleFMSDoer(e, idx, uid) {
  e.stopPropagation();
  uid = parseInt(uid);
  if (!fmsSteps[idx].doers) fmsSteps[idx].doers=[];
  const i = fmsSteps[idx].doers.indexOf(uid);
  if (i===-1) fmsSteps[idx].doers.push(uid);
  else fmsSteps[idx].doers.splice(i,1);
  // Update checkbox state
  const drop = document.getElementById(`fmsDoerDrop_${idx}`);
  if (drop) {
    drop.querySelectorAll('.multi-select-item').forEach(item => {
      const itemUid = parseInt(item.dataset.uid);
      const cb = item.querySelector('input[type=checkbox]');
      if (cb) cb.checked = fmsSteps[idx].doers.includes(itemUid);
    });
  }
  updateFMSDoerTags(idx);
}

function updateFMSDoerTags(idx) {
  const tags = document.getElementById(`fmsDoerTags_${idx}`);
  const doers = fmsSteps[idx].doers||[];
  if (!doers.length) { tags.innerHTML=`<span style="color:var(--muted-foreground);font-size:12px">Select users...</span>`; return; }
  const names = doers.map(uid=>{ const u=fmsAllUsers.find(u=>parseInt(u.id)===parseInt(uid)); return u?u.name:''; }).filter(Boolean);
  tags.innerHTML = names.map(n=>`<span class="tag-badge">${n}</span>`).join('');
}

function setupMultiSelect(idx) {
  document.addEventListener('click', function(e) {
    const drop = document.getElementById(`fmsDoerDrop_${idx}`);
    const wrap = document.getElementById(`fmsDoerWrap_${idx}`);
    if (drop && wrap && !wrap.contains(e.target)) drop.classList.remove('open');
  });
}

// Sheet se aaye naam seedhe HTML me daalna theek nahi — ye chhota escaper
// sirf FMS ke un jagahon ke liye hai jahan sheet ka raw text render hota hai.
function fmsEscape(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// 🔄 Sheet ke ek column (doer_name_col) ki unique values se Step Doers auto-fill.
async function loadDoersFromColumn(idx) {
  const step = fmsSteps[idx];
  const col = (step.doerNameCol || step.doer_name_col || '').trim().toUpperCase();
  const resultBox = document.getElementById(`fmsLoadDoersResult_${idx}`);
  resultBox.style.display = 'block';
  resultBox.innerHTML = '<i style="color:var(--muted-foreground)">Loading...</i>';

  if (!col) {
    resultBox.innerHTML = '<span style="color:var(--destructive)">⚠️ Select the "Doer Name Column" above first, then click this button.</span>';
    return;
  }

  // Sheet ID / tab / header row — jo bhi modal khula hai (Add ya Edit) usse lo
  const isEdit = document.getElementById('fmsEditModal')?.classList.contains('open');
  const sheetId = isEdit
    ? document.getElementById('editFmsSheetId').value.trim()
    : document.getElementById('fmsSheetId').value.trim();
  const tabName = isEdit
    ? document.getElementById('editFmsSheetName').value.trim()
    : document.getElementById('fmsSheetName').value.trim();
  const headerRow = isEdit
    ? (parseInt(document.getElementById('editFmsHeaderRow').value)||1)
    : (parseInt(document.getElementById('fmsHeaderRow').value)||1);

  if (!sheetId) {
    resultBox.innerHTML = '<span style="color:var(--destructive)">⚠️ Enter the Sheet ID above first.</span>';
    return;
  }

  try {
    const params = new URLSearchParams({ sheetId, tabName, col, headerRow });
    const r = await api('/api/fms/sheet-column-values?' + params.toString());
    if (r.error) throw new Error(r.error);

    // Matched users auto-select
    const matchedIds = r.matched.map(m => m.user_id);
    fmsSteps[idx].doers = matchedIds;

    // Checkboxes + tags refresh
    const drop = document.getElementById(`fmsDoerDrop_${idx}`);
    if (drop) {
      drop.querySelectorAll('.multi-select-item').forEach(item => {
        const itemUid = parseInt(item.dataset.uid);
        const cb = item.querySelector('input[type=checkbox]');
        if (cb) cb.checked = matchedIds.includes(itemUid);
      });
    }
    updateFMSDoerTags(idx);

    let html = `<div style="background:color-mix(in srgb,var(--success) 10%,transparent);border:1px solid color-mix(in srgb,var(--success) 22%,transparent);color:var(--success);padding:8px 12px;border-radius:6px;line-height:1.5">`;
    html += `<b>✅ Col ${fmsEscape(col)} found ${r.total_unique} unique name(s)</b><br>`;
    html += `Matched & auto-selected: <b>${r.matched_count}</b>`;
    if (r.matched_count) {
      html += ` <span style="color:var(--muted-foreground)">(${r.matched.map(m => fmsEscape(m.user_name)).join(', ')})</span>`;
    }
    if (r.unmatched_count) {
      html += `<br><span style="color:var(--warning)">⚠️ Not in the users database (${r.unmatched_count}): ${r.unmatched.map(n => fmsEscape(n)).join(', ')}</span>`;
      html += `<br><span style="color:var(--muted-foreground);font-size:11px">→ Add them under the Users tab, then click Load Doers again.</span>`;
    }
    html += `</div>`;
    resultBox.innerHTML = html;
  } catch (e) {
    resultBox.innerHTML = `<span style="color:var(--destructive)">❌ ${fmsEscape(e.message)}</span>`;
  }
}

function getActiveFMSContainer() {
  if (document.getElementById('fmsEditModal')?.classList.contains('open')) return 'fmsEditStepsContainer';
  return 'fmsStepsContainer';
}

function addFMSStep() {
  const idx = fmsSteps.length;
  fmsSteps.push({stepName:`Step ${idx+1}`, doers:[], planCol:'', actualCol:'', extraInput:'no', extraCol:'', extraRows:[], showCols:[], delayReasonCol:'', doerNameCol:''});
  appendFMSStepBox(idx, getActiveFMSContainer());
  updateEditStepNav();
}

// ── Delete mode (Edit modal) ──
function toggleFMSDeleteMode() {
  fmsDeleteMode = !fmsDeleteMode;
  const btn = document.getElementById('editFmsDeleteModeBtn');
  const delBtn = document.getElementById('fmsConfirmDeleteBtn');
  if (btn) btn.textContent = fmsDeleteMode ? '✕ Cancel' : '🗑 Select to Delete';
  if (delBtn) delBtn.style.display = fmsDeleteMode ? 'inline-block' : 'none';
  refreshAllStepBoxes();
  updateEditStepNav();
}

function confirmFMSDelete() {
  const checked = [...document.querySelectorAll('.fms-del-check:checked')].map(c=>parseInt(c.dataset.idx));
  if (!checked.length) { showToast('No step selected','error'); return; }
  checked.sort((a,b)=>b-a).forEach(idx=>fmsSteps.splice(idx,1));
  fmsDeleteMode=false;
  const btn = document.getElementById('editFmsDeleteModeBtn');
  if (btn) btn.textContent='🗑 Select to Delete';
  document.getElementById('fmsConfirmDeleteBtn').style.display='none';
  refreshAllStepBoxes();
  updateEditStepNav();
}

// ── Duplicate mode (Edit modal) ──
function toggleFMSDupMode() {
  fmsDupMode = !fmsDupMode;
  const btn = document.getElementById('editFmsDupModeBtn');
  const confBtn = document.getElementById('editFmsDupConfirmBtn');
  if (btn) btn.textContent = fmsDupMode ? '✕ Cancel' : '📋 Duplicate';
  if (confBtn) confBtn.style.display = fmsDupMode ? 'inline-block' : 'none';
  refreshAllStepBoxes();
  updateEditStepNav();
}

function confirmFMSDup() {
  const checked = [...document.querySelectorAll('.fms-dup-check:checked')].map(c=>parseInt(c.dataset.idx));
  if (!checked.length) { showToast('No step selected','error'); return; }
  // Deep copy selected steps and add at end
  checked.forEach(idx => {
    const orig = fmsSteps[idx];
    const copy = JSON.parse(JSON.stringify(orig));
    copy.stepName = orig.stepName + ' (Copy)';
    fmsSteps.push(copy);
  });
  fmsDupMode = false;
  const btn = document.getElementById('editFmsDupModeBtn');
  if (btn) btn.textContent = '📋 Duplicate';
  document.getElementById('editFmsDupConfirmBtn').style.display = 'none';
  refreshAllStepBoxes();
  updateEditStepNav();
  showToast(`✅ ${checked.length} step(s) duplicated!`);
}

// ── Delete mode (Add modal) ──
function toggleFMSDeleteModeAdd() {
  fmsDeleteMode = !fmsDeleteMode;
  const btn = document.getElementById('fmsAddDeleteModeBtn');
  const delBtn = document.getElementById('fmsAddConfirmDeleteBtn');
  if (btn) btn.textContent = fmsDeleteMode ? '✕ Cancel' : '🗑 Select to Delete';
  if (delBtn) delBtn.style.display = fmsDeleteMode ? 'inline-block' : 'none';
  refreshAllStepBoxes();
}

function confirmFMSDeleteAdd() {
  const checked = [...document.querySelectorAll('.fms-del-check:checked')].map(c=>parseInt(c.dataset.idx));
  if (!checked.length) { showToast('No step selected','error'); return; }
  checked.sort((a,b)=>b-a).forEach(idx=>fmsSteps.splice(idx,1));
  fmsDeleteMode=false;
  const btn = document.getElementById('fmsAddDeleteModeBtn');
  if (btn) btn.textContent='🗑 Select to Delete';
  document.getElementById('fmsAddConfirmDeleteBtn').style.display='none';
  refreshAllStepBoxes();
}

function refreshAllStepBoxes() {
  const cid = getActiveFMSContainer();
  const container = document.getElementById(cid);
  if (!container) return;
  container.innerHTML='';
  fmsSteps.forEach((_,i) => appendFMSStepBox(i, cid));
  updateEditStepNav();
}

function refreshStepBox(idx) {
  const boxes = document.querySelectorAll('.fms-step-box');
  if (boxes[idx]) {
    boxes[idx].innerHTML = buildStepBoxHTML(idx);
    setupMultiSelect(idx);
  }
}

// ── Drag & Drop reorder ──
let dragSrcIdx = null;

function setupDragEvents(el) {
  el.addEventListener('dragstart', e => {
    dragSrcIdx = parseInt(el.dataset.idx);
    e.dataTransfer.effectAllowed='move';
  });
  el.addEventListener('dragover', e => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const destIdx = parseInt(el.dataset.idx);
    if (dragSrcIdx===null || dragSrcIdx===destIdx) return;
    // Swap
    const moved = fmsSteps.splice(dragSrcIdx,1)[0];
    fmsSteps.splice(destIdx,0,moved);
    dragSrcIdx=null;
    refreshAllStepBoxes();
  });
}

// ── Save FMS ──
async function saveFMS() {
  const boxes = document.querySelectorAll('#fmsStepsContainer .fms-step-box');
  boxes.forEach((box,i)=>{
    const nameInput = box.querySelector('input[type=text]');
    if (nameInput) fmsSteps[i].stepName = nameInput.value.trim() || `Step ${i+1}`;
    fmsSteps[i].step_order = i+1;
    // Flush dropdown_options and labels for all extraRows from DOM
    (fmsSteps[i].extraRows||[]).forEach((_, ri) => {
      const el = document.getElementById(`fmsDropOpt_${i}_${ri}`);
      if (el) fmsSteps[i].extraRows[ri].dropdown_options = el.value;
      const labelEl = document.getElementById(`fmsExtraLabel_${i}_${ri}`);
      if (labelEl) fmsSteps[i].extraRows[ri].label = labelEl.value;
    });
  });

  if (fmsSteps.some(s=>!s.stepName)) { showToast('Saari steps ka naam dalo','error'); return; }

  const body = {
    fmsName: fmsData.fmsName || fmsData.sheetName,
    sheetName: fmsData.sheetName,
    sheetId: fmsData.sheetId,
    headerRow: fmsData.headerRow,
    totalSteps: fmsSteps.length,
    steps: fmsSteps.map(s=>({...s, showCols: s.showCols||[], delayReasonCol: s.delayReasonCol||'', doerNameCol: s.doerNameCol||s.doer_name_col||'', extraRows: (s.extraRows||[]).map(r=>({...r, dropdown_options: r.dropdown_options||''}))}))
  };

  const r = await api('/api/fms', 'POST', body);
  if (r.error) { showToast(r.error,'error'); return; }

  closeModal('fmsStepsModal');
  showToast('✅ FMS saved successfully!');
  fmsActiveId = r.id;
  fmsSheetHeaders = [];
  loadFMSAdmin();
}

// ══════════════════════════════════════════════════════
// FMS TASKS
// ══════════════════════════════════════════════════════
let fmsTasksActiveFmsId = null;
let fmsTasksActiveStepId = null;
let fmsTasksActiveStepData = null;
let fmsTrainPaused = false;

async function loadFMSTasks() {
  document.getElementById('fmsTasksRefreshBtn').style.display = 'block';
  const sel = document.getElementById('fmsTasksSelect');
  const trainContainer = document.getElementById('fmsTrainContainer');
  const stepPanel = document.getElementById('fmsTaskStepPanel');
  const emptyEl = document.getElementById('fmsTasksEmpty');

  sel.innerHTML = '<option value="">Loading...</option>';
  trainContainer.style.display = 'none';
  stepPanel.style.display = 'none';
  emptyEl.style.display = 'none';

  const list = await api('/api/fms-tasks');
  if (list.error) {
    sel.innerHTML = '<option value="">-- Error loading FMS --</option>';
    emptyEl.style.display = 'block';
    emptyEl.textContent = '⚠️ ' + list.error;
    showToast(list.error, 'error');
    return;
  }
  if (!list || !list.length) {
    sel.innerHTML = '<option value="">-- No FMS available --</option>';
    emptyEl.style.display = 'block';
    return;
  }

  sel.innerHTML = '<option value="">-- Select an FMS --</option>' +
    list.map(f => `<option value="${f.id}">${f.fms_name || f.sheet_name}</option>`).join('');

  // Auto-select first
  if (list.length === 1) {
    sel.value = list[0].id;
    onFMSTasksSelect();
  }
}

async function onFMSTasksSelect() {
  const fmsId = document.getElementById('fmsTasksSelect').value;
  const trainContainer = document.getElementById('fmsTrainContainer');
  const stepPanel = document.getElementById('fmsTaskStepPanel');

  const nrBtn = document.getElementById('fmsNewRecordBtn');
  const editBtn = document.getElementById('fmsEditRecordBtn');
  const ppBtn = document.getElementById('fmsPlanPendingBtn');
  if (!fmsId) {
    trainContainer.style.display = 'none';
    stepPanel.style.display = 'none';
    if (nrBtn) nrBtn.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
    if (ppBtn) ppBtn.style.display = 'none';
    return;
  }

  fmsTasksActiveFmsId = parseInt(fmsId);
  fmsTasksActiveStepId = null;
  stepPanel.style.display = 'none';
  trainContainer.style.display = 'block';

  document.getElementById('fmsTrainInner').innerHTML = '<div style="color:var(--muted-foreground);font-size:12px;padding:20px">Loading steps...</div>';

  const data = await api(`/api/fms-tasks/${fmsId}`);
  if (data.error) {
    document.getElementById('fmsTrainInner').innerHTML = `<div style="color:var(--destructive);font-size:13px;padding:20px">⚠️ ${data.error}</div>`;
    showToast(data.error, 'error');
    return;
  }
  buildFMSTrain(data.steps || [], data.sheet);
  // "+ New Record" tabhi dikhao jab is FMS ka intake form configured + enabled ho
  // AUR current user allowed ho (admin, ya recordCreators khaali, ya list me shaamil).
  let _cfg = null; try { _cfg = JSON.parse((data.sheet && data.sheet.intake_config) || 'null'); } catch (e) {}
  const _creators = (_cfg && Array.isArray(_cfg.recordCreators)) ? _cfg.recordCreators.map(Number) : [];
  const _canCreate = ME.role === 'admin' || !_creators.length || _creators.includes(Number(ME.id));
  const _intakeOn = !!(_cfg && _cfg.enabled !== false && Array.isArray(_cfg.fields) && _cfg.fields.length);
  if (nrBtn) nrBtn.style.display = (_intakeOn && _canCreate) ? 'inline-flex' : 'none';
  if (editBtn) editBtn.style.display = (_intakeOn && _canCreate) ? 'inline-flex' : 'none';
  // "⏳ Plan date pending" tabhi jab next-step planned column configured ho
  if (ppBtn) ppBtn.style.display = (_cfg && _cfg.nextStep && _cfg.nextStep.enabled !== false && _cfg.nextStep.planCol) ? 'inline-flex' : 'none';
}

function buildFMSTrain(steps, sheet) {
  if (!steps || !steps.length) {
    document.getElementById('fmsTrainInner').innerHTML = '<div style="color:var(--muted-foreground);font-size:12px;padding:20px">No steps configured for this FMS.</div>';
    return;
  }
  window._fmsAllSteps = steps; // Store all steps for modal use
  const isAdmin = ME.role === 'admin';
  const uid = ME.id;

  // Build double set for infinite scroll loop
  const buildCoaches = () => steps.map((s, i) => {
    const isMine = isAdmin || s.isMyStep;
    const doerNames = (s.doers || []).map(d => d.name).join(', ') || '—';
    return `
      <div class="fms-coach ${isMine ? 'mine' : 'not-mine'}" 
           onclick="${isMine ? `selectFMSStep(${s.id},'${s.step_name.replace(/'/g,"\\'")}','${doerNames.replace(/'/g,"\\'")}')` : ''}"
           title="${isMine ? 'Click to view tasks' : 'Not your step'}">
        <div class="fms-coach-num">Step ${s.step_order}</div>
        <div class="fms-coach-name">${s.step_name}</div>
        <div class="fms-coach-doers">👤 ${doerNames}</div>
        ${isMine ? '<div style="font-size:9px;margin-top:4px;opacity:.7">▶ Click to open</div>' : '<div style="font-size:9px;margin-top:4px;opacity:.5">🔒 Not assigned</div>'}
      </div>
      ${i < steps.length - 1 ? '<div class="fms-coach-connector"></div>' : ''}`;
  }).join('');

  const engine = `
    <div class="fms-train-engine">
      🚂
      <div style="font-size:9px;margin-top:4px;opacity:.7;max-width:70px;text-align:center;word-break:break-word">${(document.getElementById('fmsTasksSelect').selectedOptions[0]?.text || '').substring(0,12)}</div>
    </div>
    <div class="fms-coach-connector"></div>`;

  // Double the coaches for seamless loop
  const coaches = buildCoaches();
  document.getElementById('fmsTrainInner').innerHTML = engine + coaches + '<div style="width:30px;flex-shrink:0"></div>' + coaches;

  // Set initial speed
  setTrainSpeed(document.getElementById('fmsTrainSpeedSlider').value);
}

function selectFMSStep(stepId, stepName, doerNames) {
  fmsTasksActiveStepId = stepId;
  // Store active step data for modal
  window._fmsActiveStepData = (window._fmsAllSteps || []).find(s => s.id === stepId) || null;

  // "Update Completed" button sirf tab dikhao jab is step me extra-input fields hon
  // (jaise Final Status) — jinhe Done ke baad edit karna pad sakta hai.
  const updBtn = document.getElementById('fmsTaskUpdateBtn');
  if (updBtn) {
    const hasExtras = !!(window._fmsActiveStepData && (window._fmsActiveStepData.extraRows||[]).some(r => r.col_letter));
    updBtn.style.display = hasExtras ? 'inline-flex' : 'none';
  }

  // Highlight selected coach
  document.querySelectorAll('.fms-coach').forEach(c => {
    c.classList.toggle('active', c.querySelector('.fms-coach-name')?.textContent === stepName);
  });

  document.getElementById('fmsTaskStepName').textContent = stepName;
  document.getElementById('fmsTaskStepDoers').textContent = '👤 ' + doerNames;
  document.getElementById('fmsTaskRowCount').textContent = '';
  document.getElementById('fmsTaskRowsContainer').innerHTML = `
    <div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">
      Click "Load Tasks" to fetch pending rows for this step
    </div>`;
  document.getElementById('fmsTaskStepPanel').style.display = 'block';
  document.getElementById('fmsTaskStepPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadFMSTaskRows() {
  if (!fmsTasksActiveFmsId || !fmsTasksActiveStepId) return;
  const btn = document.getElementById('fmsTaskLoadBtn');
  btn.textContent = '⏳ Loading...';
  btn.disabled = true;

  const r = await api(`/api/fms-tasks/${fmsTasksActiveFmsId}/steps/${fmsTasksActiveStepId}/rows`);
  btn.textContent = 'Refresh';
  btn.disabled = false;

  if (r.error) {
    showToast(r.error, 'error');
    return;
  }

  document.getElementById('fmsTaskRowCount').textContent = r.total ? `${r.total} pending row(s)` : '✅ All done!';

  if (!r.rows || !r.rows.length) {
    document.getElementById('fmsTaskRowsContainer').innerHTML = `
      <div class="empty" style="background:var(--card);border-radius:12px;border:1px solid var(--border);">
        ✅ No pending rows — all actual values filled for this step!
      </div>`;
    return;
  }

  // Build table headers from first row's data keys
  const colKeys = Object.keys(r.rows[0].data);
  // Store rows in memory for modal + search
  window._fmsCurrentRows = r.rows;
  window._fmsCurrentColKeys = colKeys;

  document.getElementById('fmsTaskRowsContainer').innerHTML = `
    <div class="fms-search-bar">
      <span style="font-size:14px">🔍</span>
      <input type="text" id="fmsRowSearch" placeholder="Search tasks (any column)..."
        oninput="filterFMSTaskRows()" autocomplete="off"/>
      <span class="fms-search-count" id="fmsRowSearchCount">${r.rows.length} row(s)</span>
      <button class="fms-search-clear" onclick="clearFMSRowSearch()" style="display:none" id="fmsRowSearchClearBtn">✕ Clear</button>
    </div>
    <div class="fms-step-rows-table">
      <div class="fms-step-rows-scroll" id="fmsRowsScroll">
        <table>
          <thead><tr>
            <th>Action</th>
            ${colKeys.map(k => `<th>${k}</th>`).join('')}
            <th>Status</th>
          </tr></thead>
          <tbody id="fmsRowsTbody"></tbody>
        </table>
      </div>
    </div>`;

  renderFMSTaskRows(r.rows);
}

// Render a (possibly filtered) subset of FMS task rows
function renderFMSTaskRows(rowsToShow) {
  const colKeys = window._fmsCurrentColKeys || [];
  const allRows = window._fmsCurrentRows || [];
  // Map rowsToShow back to original indices (so Done button refers to the right row)
  const tbody = document.getElementById('fmsRowsTbody');
  if (!tbody) return;
  if (!rowsToShow.length) {
    tbody.innerHTML = `<tr><td colspan="${colKeys.length + 2}" style="padding:24px;text-align:center;color:var(--muted-foreground);font-size:13px">No matching rows. Try a different search.</td></tr>`;
    return;
  }
  tbody.innerHTML = rowsToShow.map(row => {
    const origIdx = allRows.indexOf(row);
    return `<tr>
      <td><button class="fms-done-btn" onclick="openFMSDoneModal(${origIdx})">✅ Done</button></td>
      ${colKeys.map(k => `<td>${row.data[k] || '—'}</td>`).join('')}
      <td><span class="fms-status-badge">⏳ Pending</span></td>
    </tr>`;
  }).join('');
}

// Filter rows by search query (matches any data value, plan/actual value, header name)
function filterFMSTaskRows() {
  const q = (document.getElementById('fmsRowSearch')?.value || '').trim().toLowerCase();
  const all = window._fmsCurrentRows || [];
  const clearBtn = document.getElementById('fmsRowSearchClearBtn');
  if (clearBtn) clearBtn.style.display = q ? 'inline-block' : 'none';
  const filtered = !q ? all : all.filter(row => {
    if ((row.planValue || '').toLowerCase().includes(q)) return true;
    if ((row.actualValue || '').toLowerCase().includes(q)) return true;
    const data = row.data || {};
    for (const k of Object.keys(data)) {
      if (String(k).toLowerCase().includes(q)) return true;
      if (String(data[k] || '').toLowerCase().includes(q)) return true;
    }
    return false;
  });
  const countEl = document.getElementById('fmsRowSearchCount');
  if (countEl) countEl.textContent = q
    ? `${filtered.length} of ${all.length} match`
    : `${all.length} row(s)`;
  renderFMSTaskRows(filtered);
}

function clearFMSRowSearch() {
  const input = document.getElementById('fmsRowSearch');
  if (input) { input.value = ''; filterFMSTaskRows(); input.focus(); }
}

// ── FMS: Update COMPLETED rows — Done ke baad extra-input fields edit karo ──
// (jaise Final Status: On The way → Reach). Row Done hone par pending list se hat
// jaati hai, isliye ye alag panel se completed rows dikha kar edit karwaate hain.
let _fmsUpdateRows = [];
async function openFMSUpdateModal() {
  const step = window._fmsActiveStepData;
  const defs = ((step && step.extraRows) || []).filter(r => r.col_letter);
  if (!fmsTasksActiveFmsId || !fmsTasksActiveStepId || !defs.length) { showToast('This step has no editable fields', 'error'); return; }
  document.getElementById('fmsUpdateErr').style.display = 'none';
  document.getElementById('fmsUpdateStepName').textContent =
    `${document.getElementById('fmsTaskStepName').textContent} — edit fields after completion`;
  document.getElementById('fmsUpdateList').innerHTML = '<div class="empty">Loading completed rows…</div>';
  document.getElementById('fmsUpdateSearchWrap').style.display = 'none';
  document.getElementById('fmsUpdateModal').classList.add('open');
  const r = await api(`/api/fms-tasks/${fmsTasksActiveFmsId}/steps/${fmsTasksActiveStepId}/done-rows`);
  if (r.error) { document.getElementById('fmsUpdateList').innerHTML = `<div class="empty">${r.error}</div>`; return; }
  _fmsUpdateRows = r.rows || [];
  if (!_fmsUpdateRows.length) { document.getElementById('fmsUpdateList').innerHTML = '<div class="empty">No completed rows yet for this step.</div>'; return; }
  const s = document.getElementById('fmsUpdateSearch'); if (s) s.value = '';
  document.getElementById('fmsUpdateSearchWrap').style.display = _fmsUpdateRows.length > 4 ? 'block' : 'none';
  renderFMSUpdateRows();
}

function renderFMSUpdateRows() {
  const step = window._fmsActiveStepData;
  const defs = ((step && step.extraRows) || []).filter(r => r.col_letter);
  const q = (document.getElementById('fmsUpdateSearch')?.value || '').trim().toLowerCase();
  const rows = !q ? _fmsUpdateRows : _fmsUpdateRows.filter(row => {
    const d = row.data || {}; return Object.keys(d).some(k => String(d[k] || '').toLowerCase().includes(q));
  });
  const box = document.getElementById('fmsUpdateList');
  if (!rows.length) { box.innerHTML = '<div class="empty">No matching rows.</div>'; return; }
  const inp = "width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;font-family:'Inter',sans-serif;outline:none;box-sizing:border-box";
  box.innerHTML = rows.map(row => {
    const gi = _fmsUpdateRows.indexOf(row);
    const ident = Object.values(row.data || {}).slice(0, 3).map(v => `<b>${escapeHtml(String(v || '—'))}</b>`).join(' · ') || `Row ${row.sheetRowNumber}`;
    const fields = defs.map((d, di) => {
      const cl = (d.col_letter || '').toUpperCase();
      const cur = (row.extraValues && row.extraValues[cl] != null) ? String(row.extraValues[cl]) : '';
      const label = d.label || d.row_label || cl;
      const ft = d.field_type || 'text';
      let ctrl;
      if (ft === 'dropdown') {
        const opts = (d.dropdown_options || '').split(',').map(o => o.trim()).filter(Boolean);
        ctrl = `<select id="fmsUpd_${gi}_${di}" data-col="${cl}" style="${inp};background:var(--card)"><option value="">-- Select --</option>${opts.map(o => `<option value="${escapeHtml(o)}" ${o === cur ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`;
      } else if (ft === 'file') {
        ctrl = (cur ? `<div style="font-size:12px;color:var(--foreground);margin-bottom:5px">📎 ${escapeHtml(cur)}</div>` : `<div style="color:var(--muted-foreground);font-size:12px;margin-bottom:5px">— no file —</div>`) +
          `<input type="file" id="fmsUpdFile_${gi}_${di}" accept="image/*,application/pdf" style="${inp};padding:6px 8px"/>` +
          `<div style="font-size:10.5px;color:var(--muted-foreground);margin-top:3px">Choose a new file to replace it (optional)</div>`;
      } else {
        const type = ft === 'number' ? 'number' : ft === 'date' ? 'date' : ft === 'link' ? 'url' : 'text';
        ctrl = `<input type="${type}" id="fmsUpd_${gi}_${di}" data-col="${cl}" value="${escapeHtml(cur)}" style="${inp}"/>`;
      }
      return `<div style="margin-bottom:8px"><label style="font-size:11px;font-weight:600;color:var(--muted-foreground);display:block;margin-bottom:3px">${escapeHtml(label)} <span style="color:var(--muted-foreground);font-weight:400">(COL ${cl})</span></label>${ctrl}</div>`;
    }).join('');
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;background:var(--card)">
      <div style="font-size:13px;color:var(--foreground);margin-bottom:10px">${ident}</div>
      ${fields}
      <div style="display:flex;justify-content:flex-end"><button class="btn btn-green btn-sm" onclick="saveFMSUpdateRow(${gi}, this)">💾 Save</button></div>
    </div>`;
  }).join('');
}

async function saveFMSUpdateRow(gi, btn) {
  const row = _fmsUpdateRows[gi];
  if (!row) return;
  const step = window._fmsActiveStepData;
  const defs = ((step && step.extraRows) || []).filter(r => r.col_letter);
  const errEl = document.getElementById('fmsUpdateErr'); errEl.style.display = 'none';
  const extraInputs = [];
  btn.textContent = '⏳ Saving…'; btn.disabled = true;
  for (let di = 0; di < defs.length; di++) {
    const d = defs[di];
    const cl = (d.col_letter || '').toUpperCase();
    if ((d.field_type || '') === 'file') {
      // Nayi file chuni ho to upload karke HYPERLINK(filename) cell me likho; warna chhod do.
      const fileEl = document.getElementById(`fmsUpdFile_${gi}_${di}`);
      const f = fileEl && fileEl.files && fileEl.files[0];
      if (!f) continue;
      btn.textContent = '⏳ Uploading…';
      try {
        const resp = await fetch(`/api/fms-tasks/${fmsTasksActiveFmsId}/steps/${fmsTasksActiveStepId}/upload?rowNumber=${encodeURIComponent(row.sheetRowNumber)}`, {
          method: 'POST',
          headers: { 'Content-Type': f.type || 'application/octet-stream', ...(localStorage.getItem('authToken') ? { Authorization: 'Bearer ' + localStorage.getItem('authToken') } : {}) },
          credentials: 'include', body: f
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.url) throw new Error(data.error || `Upload failed (HTTP ${resp.status})`);
        const fn = String(f.name || 'file').replace(/"/g, "'");
        extraInputs.push({ colLetter: cl, value: `=HYPERLINK("${data.url}","${fn}")` });
      } catch (e) {
        errEl.textContent = `Could not upload "${f.name}": ${e.message}`; errEl.style.display = 'block';
        btn.textContent = '💾 Save'; btn.disabled = false; return;
      }
    } else {
      const el = document.getElementById(`fmsUpd_${gi}_${di}`);
      if (el) extraInputs.push({ colLetter: cl, value: el.value });
    }
  }
  if (!extraInputs.length) { showToast('Nothing to update', 'error'); btn.textContent = '💾 Save'; btn.disabled = false; return; }
  btn.textContent = '⏳ Saving…';
  const r = await api(`/api/fms-tasks/${fmsTasksActiveFmsId}/steps/${fmsTasksActiveStepId}/update-extra`, 'POST', { rowNumber: row.sheetRowNumber, extraInputs });
  btn.disabled = false;
  if (r.error) { errEl.textContent = r.error; errEl.style.display = 'block'; btn.textContent = '💾 Save'; return; }
  extraInputs.forEach(ei => { row.extraValues[ei.colLetter] = ei.value; });
  btn.textContent = '✅ Saved'; setTimeout(() => { btn.textContent = '💾 Save'; }, 1500);
  showToast('✅ Updated in Google Sheet');
}

// ── FMS SUMMARY (admin) — poori FMS ki summary + order-no search ──
let _fmsSummary = { fmsId: null, data: null };
let _sumSearchT = null;

async function openFMSSummary(fmsId) {
  document.getElementById('fmsSummaryErr').style.display = 'none';
  document.getElementById('fmsSummaryBody').innerHTML = '<div class="empty">Loading…</div>';
  document.getElementById('fmsSummaryModal').classList.add('open');
  // FMS picker — admin ko saari FMS milti hain
  const picker = document.getElementById('fmsSummaryPicker');
  if (picker.dataset.loaded !== '1') {
    const list = await api('/api/fms-tasks');
    if (Array.isArray(list) && list.length) {
      picker.innerHTML = list.map(f => `<option value="${f.id}">${escapeHtml(f.fms_name || ('FMS ' + f.id))}</option>`).join('');
      picker.dataset.loaded = '1';
    }
  }
  if (fmsId) picker.value = String(fmsId);
  loadFMSSummaryData(picker.value || fmsId);
}

async function loadFMSSummaryData(fmsId) {
  if (!fmsId) return;
  _fmsSummary.fmsId = fmsId;
  _fmsSummary.filter = 'all';   // FMS switch par filter reset
  document.getElementById('fmsSummaryErr').style.display = 'none';
  document.getElementById('fmsSummaryBody').innerHTML = '<div class="empty">Loading summary…</div>';
  const r = await api(`/api/fms-tasks/${fmsId}/summary`);
  if (r.error) { document.getElementById('fmsSummaryBody').innerHTML = `<div class="empty" style="color:var(--destructive)">${escapeHtml(r.error)}</div>`; return; }
  _fmsSummary.data = r;
  renderFMSSummary();
  const s = document.getElementById('fmsSummarySearch'); if (s) s.focus();
}

function renderFMSSummary() {
  const d = _fmsSummary.data; if (!d) return;
  if (!_fmsSummary.filter) _fmsSummary.filter = 'all';
  const stages = `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px">
    <div style="font-size:11px;font-weight:700;color:var(--muted-foreground);letter-spacing:.3px;margin-bottom:10px">STAGE-WISE</div>
    <div style="display:flex;flex-direction:column;gap:7px">
      ${d.stages.map(s => `<div style="display:flex;align-items:center;gap:14px;font-size:12.5px;flex-wrap:wrap">
        <div style="width:200px;max-width:45vw;font-weight:600;color:var(--foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</div>
        <span style="color:var(--success)">✅ ${s.done} done</span>
        <span style="color:var(--warning)">⏳ ${s.pending} pending</span>
        <span style="color:var(--destructive)">🔴 ${s.delayed} late</span>
      </div>`).join('')}
    </div></div>`;
  const search = `<div style="position:sticky;top:0;background:var(--card);z-index:5;padding:6px 0 10px;border-bottom:1px solid var(--muted);margin-bottom:10px;display:flex;align-items:center;gap:10px">
    <input type="search" id="fmsSummarySearch" inputmode="numeric" aria-label="Search by order number" oninput="onSummarySearch()"
      placeholder="🔍 Search by ${escapeHtml(d.orderLabel || 'Order No')}…"
      style="flex:1;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'Inter',sans-serif;outline:none"/>
    <span id="fmsSummaryCount" style="font-size:12px;color:var(--muted-foreground);font-weight:600;white-space:nowrap">${d.orders.length} orders</span>
  </div>`;
  document.getElementById('fmsSummaryBody').innerHTML = `<div id="fmsSummaryKpis"></div>` + stages + search + `<div id="fmsSummaryTableWrap"></div>`;
  renderSummaryKpis();
  applySummaryFilters();
}

// KPI cards — clickable filters. Click par neeche wale table me us category ke orders.
function renderSummaryKpis() {
  const d = _fmsSummary.data; if (!d) return;
  const k = d.kpis; const active = _fmsSummary.filter || 'all';
  const card = (label, val, color, filter) => {
    const on = active === filter;
    return `<div onclick="setSummaryFilter('${filter}')" role="button" tabindex="0" title="Click to see these orders"
      style="background:${on ? 'var(--primary)' : 'var(--card)'};border:1.5px solid ${on ? 'var(--primary)' : 'var(--border)'};border-radius:10px;padding:11px 14px;min-width:100px;flex:1;cursor:pointer;transition:.12s">
      <div style="font-size:10.5px;font-weight:600;color:${on ? 'color-mix(in srgb,var(--primary-foreground) 80%,transparent)' : 'var(--muted-foreground)'};text-transform:uppercase;letter-spacing:.4px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${on ? '#fff' : (color || 'var(--foreground)')};margin-top:2px;font-variant-numeric:tabular-nums">${val}</div></div>`;
  };
  const info = (label, val, color) => `<div style="background:var(--muted);border:1px solid var(--border);border-radius:10px;padding:9px 12px;min-width:92px;flex:1">
    <div style="font-size:10px;font-weight:600;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.4px">${label}</div>
    <div style="font-size:18px;font-weight:800;color:${color || 'var(--foreground)'};margin-top:2px">${val}</div></div>`;
  document.getElementById('fmsSummaryKpis').innerHTML =
    `<div style="font-size:11px;color:var(--muted-foreground);margin-bottom:6px">👇 Kisi card par click karo — us category ke orders neeche dikhenge</div>
     <div style="display:flex;flex-wrap:wrap;gap:9px;margin-bottom:8px">
       ${card('Total', k.total, 'var(--foreground)', 'all')}
       ${card('ACP', k.acp || 0, 'var(--chart-5)', 'acp')}
       ${card('APP', k.app || 0, 'var(--chart-1)', 'app')}
       ${card('Dispatched', k.dispatched || 0, 'var(--chart-3)', 'dispatched')}
       ${card('Complete', k.complete || 0, 'var(--success)', 'complete')}
       ${card('Delayed', k.delayed || 0, 'var(--destructive)', 'delayed')}
     </div>
     <div style="display:flex;flex-wrap:wrap;gap:9px;margin-bottom:14px">
       ${info('In Progress', k.inProgress, 'var(--chart-1)')}
       ${info('On-time %', (k.onTimePct || 0) + '%', 'var(--success)')}
       ${info('Avg Delay', (k.avgDelayDays || 0) + ' d', 'var(--warning)')}
     </div>`;
}

function setSummaryFilter(key) {
  _fmsSummary.filter = key || 'all';
  renderSummaryKpis();
  applySummaryFilters();
}

// Active KPI-filter + order-no search dono apply karke table render karo
function applySummaryFilters() {
  const d = _fmsSummary.data; if (!d) return;
  const f = _fmsSummary.filter || 'all';
  const q = (document.getElementById('fmsSummarySearch')?.value || '').trim().toLowerCase();
  let rows = d.orders.slice();
  if (f === 'acp') rows = rows.filter(o => String(o.orderType || '').toUpperCase() === 'ACP');
  else if (f === 'app') rows = rows.filter(o => String(o.orderType || '').toUpperCase() === 'APP');
  else if (f === 'dispatched') rows = rows.filter(o => o.dispatched);
  else if (f === 'complete') rows = rows.filter(o => o.complete);
  else if (f === 'delayed') rows = rows.filter(o => o.delayDays > 0);
  if (q) rows = rows.filter(o => String(o.orderNo || '').toLowerCase().includes(q));
  renderFMSSummaryTable(rows);
  const c = document.getElementById('fmsSummaryCount');
  if (c) c.textContent = `${rows.length} of ${d.orders.length}`;
}

function renderFMSSummaryTable(rows) {
  const d = _fmsSummary.data; if (!d) return;
  const stageNames = (d.stages || []).map(s => s.name);
  const chipCell = (st) => {
    let bg = 'var(--muted)', fg = 'var(--muted-foreground)', txt = '—';
    if (st.status === 'done') {
      if (st.late) { bg = 'color-mix(in srgb,var(--destructive) 10%,transparent)'; fg = 'var(--destructive)'; txt = `✔ ${st.actual}${st.delay ? ` (+${st.delay}d)` : ''}`; }
      else { bg = 'color-mix(in srgb,var(--success) 22%,transparent)'; fg = 'var(--success)'; txt = `✔ ${st.actual || 'done'}`; }
    } else if (st.status === 'pending') { bg = 'color-mix(in srgb,var(--warning) 12%,transparent)'; fg = 'var(--warning)'; txt = '⏳ pending'; }
    return `<td style="padding:6px 8px"><span title="${escapeHtml(st.name)}${st.planned ? ' · plan ' + escapeHtml(st.planned) : ''}" style="display:inline-block;background:${bg};color:${fg};border-radius:6px;padding:2px 7px;font-size:11px;font-weight:600;white-space:nowrap">${escapeHtml(txt)}</span></td>`;
  };
  const html = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;white-space:nowrap">
      <thead><tr style="background:var(--muted)">
        <th style="padding:8px;text-align:left;position:sticky;left:0;background:var(--muted)">${escapeHtml(d.orderLabel || 'Order No')}</th>
        <th style="padding:8px;text-align:left">Vendor</th>
        <th style="padding:8px;text-align:left">Location</th>
        <th style="padding:8px;text-align:left">Type</th>
        <th style="padding:8px;text-align:left">Current Stage</th>
        <th style="padding:8px;text-align:left">Delay</th>
        ${stageNames.map(n => `<th style="padding:8px;text-align:left" title="${escapeHtml(n)}">${escapeHtml(n.length > 16 ? n.slice(0, 15) + '…' : n)}</th>`).join('')}
      </tr></thead>
      <tbody>
      ${rows.length ? rows.map(o => `<tr style="border-top:1px solid var(--muted)">
        <td style="padding:6px 8px;font-weight:700;font-variant-numeric:tabular-nums;position:sticky;left:0;background:var(--card)">${escapeHtml(o.orderNo || '—')}</td>
        <td style="padding:6px 8px">${escapeHtml(o.vendor || '—')}</td>
        <td style="padding:6px 8px">${escapeHtml(o.location || '—')}</td>
        <td style="padding:6px 8px">${escapeHtml(o.orderType || '—')}</td>
        <td style="padding:6px 8px">${o.status === 'completed' ? '<span style="color:var(--success);font-weight:600">✅ Completed</span>' : escapeHtml(o.currentStage)}</td>
        <td style="padding:6px 8px;color:${o.delayDays > 0 ? 'var(--destructive)' : 'var(--muted-foreground)'};font-weight:600">${o.delayDays > 0 ? ('+' + o.delayDays + 'd') : '—'}</td>
        ${o.stages.map(chipCell).join('')}
      </tr>`).join('') : `<tr><td colspan="${6 + stageNames.length}" style="padding:22px;text-align:center;color:var(--muted-foreground)">No orders found.</td></tr>`}
      </tbody>
    </table></div>`;
  document.getElementById('fmsSummaryTableWrap').innerHTML = html;
}

function onSummarySearch() { clearTimeout(_sumSearchT); _sumSearchT = setTimeout(applySummaryFilters, 200); }

// ── Password gate (re-auth) — protected actions ke liye. openPwGate(title, callback)
// callback tabhi chalta hai jab user apna sahi login password daale. ──
let _pwGateCb = null;
function openPwGate(title, cb) {
  _pwGateCb = cb;
  document.getElementById('pwGateTitle').textContent = title ? `🔒 ${title} — enter your password` : '🔒 Enter your password';
  document.getElementById('pwGateInput').value = '';
  document.getElementById('pwGateErr').style.display = 'none';
  const btn = document.getElementById('pwGateBtn'); btn.disabled = false; btn.textContent = '🔓 Unlock';
  document.getElementById('pwGateModal').classList.add('open');
  setTimeout(() => { const i = document.getElementById('pwGateInput'); if (i) i.focus(); }, 60);
}
async function submitPwGate() {
  const pw = document.getElementById('pwGateInput').value;
  const err = document.getElementById('pwGateErr');
  if (!pw) { err.textContent = 'Enter your password'; err.style.display = 'block'; return; }
  const btn = document.getElementById('pwGateBtn'); btn.disabled = true; btn.textContent = 'Checking…';
  const r = await api('/api/verify-password', 'POST', { password: pw });
  btn.disabled = false; btn.textContent = '🔓 Unlock';
  if (!r || r.error || !r.ok) { err.textContent = (r && r.error) || 'Incorrect password'; err.style.display = 'block'; return; }
  closeModal('pwGateModal');
  document.getElementById('pwGateInput').value = '';
  const cb = _pwGateCb; _pwGateCb = null;
  if (typeof cb === 'function') cb();
}

function openFMSDoneModal(rowIdx) {
  const row = window._fmsCurrentRows[rowIdx];
  if (!row) return;

  document.getElementById('fmsDoneFmsId').value = fmsTasksActiveFmsId;
  document.getElementById('fmsDoneStepId').value = fmsTasksActiveStepId;
  document.getElementById('fmsDoneRowNum').value = row.sheetRowNumber;
  document.getElementById('fmsDonePlanVal').value = row.planValue;
  document.getElementById('fmsDoneErr').style.display = 'none';
  document.getElementById('fmsDoneDelaySection').style.display = 'none';
  document.getElementById('fmsDoneDelayReason').value = '';

  // Show row data
  const colKeys = Object.keys(row.data);
  document.getElementById('fmsDoneRowPreview').innerHTML = colKeys.map(k =>
    `<div style="display:flex;gap:8px;margin-bottom:4px"><span style="font-size:11px;font-weight:600;color:var(--muted-foreground);min-width:120px;flex-shrink:0">${k}</span><span style="color:var(--foreground)">${row.data[k]||'—'}</span></div>`
  ).join('');

  // Set plan display
  document.getElementById('fmsDonePlanDisplay').textContent = row.planValue || '—';

  // Set actual = today's date only (DD/MM/YYYY) — no timestamp saved to sheet
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const dateOnlyStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
  const actualStr = dateOnlyStr; // Only date saved to sheet
  document.getElementById('fmsDoneActualDisplay').textContent = actualStr;

  // Check delay: actual > plan = delayed
  const planVal = (row.planValue || '').trim();
  let isDelayed = false;
  try {
    // Try various date formats: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY HH:MM:SS
    let planDate;
    const ddmmyyyy = planVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)?$/);
    const yyyymmdd = planVal.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(.*)?$/);
    if (ddmmyyyy) {
      const [, d, m, y, time=''] = ddmmyyyy;
      planDate = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}${time.replace(' ','T')||'T23:59:59'}`);
    } else if (yyyymmdd) {
      planDate = new Date(planVal);
    }
    if (planDate && !isNaN(planDate.getTime()) && now > planDate) isDelayed = true;
  } catch(e) {}

  // Remark box HAMESHA dikhao. Late ho to warning-style + required, warna optional.
  window._fmsDoneIsLate = isDelayed;
  document.getElementById('fmsDoneDelaySection').style.display = 'block';
  document.getElementById('fmsDoneDelayReason').value = '';
  const rBox = document.getElementById('fmsDoneRemarkBox');
  const rLabel = document.getElementById('fmsDoneRemarkLabel');
  if (isDelayed) {
    rBox.style.background = 'color-mix(in srgb,var(--warning) 12%,transparent)'; rBox.style.borderColor = 'color-mix(in srgb,var(--warning) 26%,transparent)';
    rLabel.innerHTML = '⚠️ Delay detected — reason required <span style="color:var(--destructive)">*</span>';
    document.getElementById('fmsDoneDelayReason').placeholder = 'Reason for the delay…';
  } else {
    rBox.style.background = 'var(--muted)'; rBox.style.borderColor = 'var(--border)';
    rLabel.innerHTML = '📝 Remark <span style="color:var(--muted-foreground);font-weight:400;font-size:11px">(optional)</span>';
    document.getElementById('fmsDoneDelayReason').placeholder = 'Add a remark…';
  }

  // Populate extra input fields based on step configuration
  const activeStep = window._fmsActiveStepData;
  const extraRows = (activeStep && activeStep.extraRows) ? activeStep.extraRows.filter(r => r.col_letter) : [];
  const extraSection = document.getElementById('fmsDoneExtraSection');
  const extraFieldsEl = document.getElementById('fmsDoneExtraFields');
  if (extraRows.length > 0) {
    const inputStyle = 'width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:\'Inter\',sans-serif;outline:none;box-sizing:border-box';
    extraFieldsEl.innerHTML = extraRows.map((r, i) => {
      const label = r.label || r.row_label || r.col_letter || `Field ${i+1}`;
      let inputHtml;
      switch(r.field_type || 'text') {
        case 'number':
          inputHtml = `<input type="number" id="fmsExtra_${i}" placeholder="Enter number..." style="${inputStyle}"/>`;
          break;
        case 'date':
          inputHtml = `<input type="date" id="fmsExtra_${i}" style="${inputStyle}"/>`;
          break;
        case 'link':
          inputHtml = `<input type="url" id="fmsExtra_${i}" placeholder="https://..." style="${inputStyle}"/>`;
          break;
        case 'dropdown': {
          const rawOpts = (r.dropdown_options || '').split(',').map(o => o.trim()).filter(Boolean);
          const optionsList = rawOpts.length
            ? rawOpts.map(o => `<option value="${o}">${o}</option>`).join('')
            : '<option value="">-- No options configured --</option>';
          inputHtml = `<select id="fmsExtra_${i}" style="${inputStyle};background:var(--card)"><option value="">-- Select --</option>${optionsList}</select>`;
          break;
        }
        case 'file':
          // Hidden input me Drive ka link aata hai — save hone par wahi sheet me jaata hai.
          // File khud Save dabane par upload hoti hai, chunte hi nahi.
          inputHtml = `
            <input type="hidden" id="fmsExtra_${i}"/>
            <input type="file" id="fmsExtraFile_${i}" accept="image/*,application/pdf"
              onchange="onFMSExtraFilePick(${i})" style="${inputStyle};padding:7px 10px"/>
            <div id="fmsExtraFileInfo_${i}" style="font-size:11px;color:var(--muted-foreground);margin-top:4px"></div>`;
          break;
        default:
          inputHtml = `<input type="text" id="fmsExtra_${i}" placeholder="Enter value..." style="${inputStyle}"/>`;
      }
      // required: 0=optional, 1=always, 2=required-only-when-late. reqMode=2 wala field
      // sirf tab required (*) hai jab row late ho (Actual > Planned = _fmsDoneIsLate).
      const reqMode = (r.required === 0 || r.required === false || r.required === '0') ? 0
                    : (r.required === 2 || r.required === '2') ? 2 : 1;
      const effReq = reqMode === 1 || (reqMode === 2 && window._fmsDoneIsLate);
      const requiredTag = effReq
        ? '<span style="color:var(--destructive)">*</span>'
        : (reqMode === 2
            ? '<span style="color:var(--muted-foreground);font-size:10px;font-weight:600">(required only if late)</span>'
            : '<span style="color:var(--muted-foreground);font-size:10px;font-weight:600">(optional)</span>');
      return `<div style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:var(--muted-foreground);display:block;margin-bottom:4px">${label} ${requiredTag} <span style="color:var(--muted-foreground);font-weight:400">(COL ${r.col_letter})</span></label>
        ${inputHtml}
      </div>`;
    }).join('');
    extraSection.style.display = 'block';
  } else {
    extraSection.style.display = 'none';
    extraFieldsEl.innerHTML = '';
  }

  document.getElementById('fmsDoneModal').classList.add('open');
}

// (delay reason is now a plain text input — no dropdown listener needed)

const FMS_FILE_MAX_MB = 15;

// File chunte hi sirf naam/size dikhate hain aur size check karte hain. Upload
// Save dabane par hota hai — warna user file badal kar Cancel kar de to bhi
// Drive par ek bekaar file pad jaati.
function onFMSExtraFilePick(i) {
  const input = document.getElementById(`fmsExtraFile_${i}`);
  const info  = document.getElementById(`fmsExtraFileInfo_${i}`);
  const hidden = document.getElementById(`fmsExtra_${i}`);
  if (hidden) hidden.value = '';           // nayi file chuni — purana link hata do
  const f = input && input.files && input.files[0];
  if (!f) { if (info) info.textContent = ''; return; }

  const mb = f.size / 1024 / 1024;
  if (mb > FMS_FILE_MAX_MB) {
    info.innerHTML = `<span style="color:var(--destructive)">File is ${mb.toFixed(1)}MB — the limit is ${FMS_FILE_MAX_MB}MB</span>`;
    input.value = '';
    return;
  }
  info.textContent = `${f.name} · ${mb.toFixed(1)}MB — will upload when you save`;
}

// Sab chuni hui files Drive par bhejta hai aur hidden input me link rakh deta hai.
// Koi ek fail ho to poora save rok dete hain, taaki sheet me aadhi jaankari na jaaye.
async function uploadFMSExtraFiles(fmsId, stepId, rowNum, extraRows, errEl) {
  for (let i = 0; i < extraRows.length; i++) {
    if ((extraRows[i].field_type || '') !== 'file') continue;
    const input = document.getElementById(`fmsExtraFile_${i}`);
    const hidden = document.getElementById(`fmsExtra_${i}`);
    const info = document.getElementById(`fmsExtraFileInfo_${i}`);
    const f = input && input.files && input.files[0];
    if (!f) continue;                       // koi file nahi chuni
    if (hidden && hidden.value) continue;    // pehle hi upload ho chuki

    if (info) info.textContent = `Uploading ${f.name}…`;
    try {
      const url = `/api/fms-tasks/${fmsId}/steps/${stepId}/upload?rowNumber=${encodeURIComponent(rowNum)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': f.type || 'application/octet-stream',
          ...(localStorage.getItem('authToken') ? { Authorization: 'Bearer ' + localStorage.getItem('authToken') } : {})
        },
        credentials: 'include',
        body: f
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.url) throw new Error(data.error || `Upload failed (HTTP ${resp.status})`);
      // Cell me raw URL ke bajaye clickable FILENAME (HYPERLINK) likho — jaisa PI Upload karta hai.
      // Done endpoint USER_ENTERED se likhta hai, to ye formula sheet me hyperlink ban jaata hai.
      const _fn = String(data.fileName || f.name || 'file').replace(/"/g, "'");
      if (hidden) hidden.value = `=HYPERLINK("${data.url}","${_fn}")`;
      if (info) info.innerHTML = `<span style="color:var(--success)">✅ Uploaded — ${f.name}</span>`;
    } catch (e) {
      if (info) info.innerHTML = `<span style="color:var(--destructive)">❌ ${e.message}</span>`;
      errEl.textContent = `Could not upload "${f.name}": ${e.message}`;
      errEl.style.display = 'block';
      return false;
    }
  }
  return true;
}

async function saveFMSDone() {
  const fmsId = document.getElementById('fmsDoneFmsId').value;
  const stepId = document.getElementById('fmsDoneStepId').value;
  const rowNum = document.getElementById('fmsDoneRowNum').value;
  const actualValue = document.getElementById('fmsDoneActualDisplay').textContent;
  const errEl = document.getElementById('fmsDoneErr');
  errEl.style.display = 'none';

  // Remark (auto → Remarks column). Late ho to required, warna optional.
  const delayReason = document.getElementById('fmsDoneDelayReason').value.trim();
  if (window._fmsDoneIsLate && !delayReason) { errEl.textContent = 'A delay reason is required'; errEl.style.display = 'block'; return; }

  const saveBtn = document.getElementById('fmsDoneSaveBtn') || document.querySelector('#fmsDoneModal .btn-green');
  saveBtn.textContent = '⏳ Saving...';
  saveBtn.disabled = true;

  // Collect extra input values — mandatory check sirf `required` fields par
  const activeStep = window._fmsActiveStepData;
  const extraRows = (activeStep && activeStep.extraRows) ? activeStep.extraRows.filter(r => r.col_letter) : [];
  // Files pehle Drive par bhejo — tabhi unke hidden inputs me link aayega, jise
  // neeche wala "required" check bhara hua maanega.
  saveBtn.textContent = '⏳ Uploading…';
  const uploaded = await uploadFMSExtraFiles(fmsId, stepId, rowNum, extraRows, errEl);
  if (!uploaded) { saveBtn.textContent = '💾 Save to Sheet'; saveBtn.disabled = false; return; }
  saveBtn.textContent = '⏳ Saving...';

  for (let i = 0; i < extraRows.length; i++) {
    const r = extraRows[i];
    const reqMode = (r.required === 0 || r.required === false || r.required === '0') ? 0
                  : (r.required === 2 || r.required === '2') ? 2 : 1;
    const isRequired = reqMode === 1 || (reqMode === 2 && window._fmsDoneIsLate);
    const el = document.getElementById(`fmsExtra_${i}`);
    const val = el ? el.value.trim() : '';
    if (isRequired && !val) {
      const label = r.label || r.row_label || r.col_letter || `Field ${i+1}`;
      const isFile = (r.field_type || '') === 'file';
      errEl.textContent = isFile ? `"${label}" needs a file` : `"${label}" is required`;
      errEl.style.display = 'block';
      saveBtn.textContent = '💾 Save to Sheet';
      saveBtn.disabled = false;
      // File type me asli input hidden hota hai — highlight file picker par lagao
      const focusEl = isFile ? document.getElementById(`fmsExtraFile_${i}`) : el;
      if (focusEl) { focusEl.style.border = '1.5px solid var(--destructive)'; focusEl.focus(); }
      return;
    } else if (el) {
      const isFile = (r.field_type || '') === 'file';
      const styleEl = isFile ? document.getElementById(`fmsExtraFile_${i}`) : el;
      if (styleEl) styleEl.style.border = '1.5px solid var(--border)';
    }
  }
  const extraInputs = extraRows.map((r, i) => {
    const el = document.getElementById(`fmsExtra_${i}`);
    return { colLetter: r.col_letter, value: el ? el.value.trim() : '' };
  }).filter(e => e.colLetter && e.value !== '');

  const r = await api(`/api/fms-tasks/${fmsId}/steps/${stepId}/done`, 'POST', {
    rowNumber: parseInt(rowNum),
    actualValue,
    planValue: document.getElementById('fmsDonePlanVal').value, // Delay = Actual − Planned
    delayReason,
    extraInputs
  });

  saveBtn.textContent = '💾 Save to Sheet';
  saveBtn.disabled = false;

  if (r.error) { errEl.textContent = r.error; errEl.style.display = 'block'; return; }

  closeModal('fmsDoneModal');
  showToast('✅ Saved to Google Sheet!');

  // ── OPTIMISTIC REMOVE: Google Sheet se dobara load karne ki zaroorat nahi ──
  // Done hua row ko seedha memory se hataao aur table re-render karo
  const doneRowNum = parseInt(rowNum);
  const rowsContainer = document.getElementById('fmsTaskRowsContainer');
  // Modal All Tasks page se bhi khul sakta hai — us waqt FMS Tasks page ke
  // elements DOM me nahi hote, isliye pehle unka hona check karte hain.
  if (window._fmsCurrentRows && rowsContainer) {
    window._fmsCurrentRows = window._fmsCurrentRows.filter(row => row.sheetRowNumber !== doneRowNum);
    const remaining = window._fmsCurrentRows.length;
    // Row count badge update karo
    const countEl = document.getElementById('fmsTaskRowCount');
    if (countEl) countEl.textContent = remaining ? `${remaining} pending row(s)` : '✅ All done!';
    const searchCountEl = document.getElementById('fmsRowSearchCount');
    if (searchCountEl) searchCountEl.textContent = `${remaining} row(s)`;
    // Table re-render (instant, no API call)
    if (remaining === 0) {
      rowsContainer.innerHTML =
        `<div style="padding:32px;text-align:center;color:var(--success);font-size:16px;font-weight:600">🎉 All tasks complete!</div>`;
    } else {
      filterFMSTaskRows(); // search filter bhi apply rehta hai
    }
  }

  // All Tasks ke FMS tab se done kiya ho to wahan se bhi row hata do.
  // rowNumber alag-alag FMS/steps me repeat hota hai, isliye teeno match karo.
  if (tasksType === 'fms' && Array.isArray(_fmsTasksRows)) {
    _fmsTasksRows = _fmsTasksRows.filter(row => !(
      row.rowNumber === doneRowNum &&
      String(row.fmsId) === String(fmsId) &&
      String(row.stepId) === String(stepId)
    ));
    if (document.getElementById('page-alltasks')?.classList.contains('active')) renderTasksTable();
  }

  // Dashboard ki pending-FMS list bhi refresh — completed row wahan se nikal jaaye.
  if (typeof loadDashFMS === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) {
    loadDashFMS();
  }
}

function setTrainSpeed(val) {
  const dur = parseInt(val);
  document.getElementById('fmsTrainSpeedLabel').textContent = dur + 's';
  const scroll = document.getElementById('fmsTrainInner');
  if (scroll) {
    scroll.style.setProperty('--train-dur', dur + 's');
    scroll.style.animationDuration = dur + 's';
  }
  const track = document.getElementById('fmsTrainTrack');
  if (track) track.style.setProperty('--train-dur', dur + 's');
}

function toggleTrainPause() {
  fmsTrainPaused = !fmsTrainPaused;
  const scroll = document.getElementById('fmsTrainInner');
  const btn = document.getElementById('fmsTrainPauseBtn');
  if (scroll) scroll.style.animationPlayState = fmsTrainPaused ? 'paused' : 'running';
  if (btn) btn.textContent = fmsTrainPaused ? '▶ Play' : '⏸ Pause';
}

// ══════════════════════════════════════════════════════
// BULK DELETE
// ══════════════════════════════════════════════════════
let _bdFromUserId = null;
let _bdDateTasks = [];

async function openBulkDeleteModal() {
  document.getElementById('bulkDeleteErr').style.display = 'none';
  document.getElementById('bdStep1').style.display = 'none';
  document.getElementById('bdStep2').style.display = 'none';
  document.getElementById('bdStep3').style.display = 'none';
  document.getElementById('bdCancelBtn').style.display = 'block';
  document.getElementById('bdDate').value = '';
  document.getElementById('bdTasksList').innerHTML = '';
  _bdFromUserId = null;
  _bdDateTasks = [];

  const isAdmin = ME.role === 'admin';
  const isHod = ME.role === 'hod';

  if (isAdmin || isHod) {
    const allUsers = await api(withSeg('/api/users')); // current Office/Factory view ke users hi
    const eligible = isAdmin
      ? allUsers
      : allUsers.filter(u => u.department === ME.department);
    document.getElementById('bdFromUser').innerHTML =
      '<option value="">-- Select user --</option>' +
      eligible.map(u=>`<option value="${u.id}">${u.name} — ${u.email} (${u.department||u.role})</option>`).join('');
    document.getElementById('bdStep1').style.display = 'block';

    // 12-month section: admin only
    if (isAdmin) {
      document.getElementById('bdYearSection').style.display = 'block';
      // v16: Reset frequency dropdown + lock employee dropdown until frequency picked
      const freqSel = document.getElementById('bdYearFreq');
      if (freqSel) freqSel.value = '';
      const userSel = document.getElementById('bdYearUser');
      if (userSel) userSel.disabled = true;
      // Populate user dropdown
      // Admin-role users bhi doer ho sakte hain (Sachin jaise) — unhe hatao mat.
      // Naam ke saath email dikhao taaki same naam wale (do "Rahul") alag pehchane ja saken.
      document.getElementById('bdYearUser').innerHTML =
        '<option value="">-- Select Employee --</option>' +
        eligible.map(u=>`<option value="${u.id}" data-email="${u.email}">${u.name} — ${u.email}</option>`).join('');
      document.getElementById('bdYearUserEmail').style.display = 'none';
      // Specific-task checkbox list reset (frequency+employee chunne par bharegi)
      const taskBox = document.getElementById('bdYearTaskBox');
      if (taskBox) { taskBox.innerHTML = 'All tasks in this category'; taskBox.style.color = 'var(--muted-foreground)'; }
    } else {
      document.getElementById('bdYearSection').style.display = 'none';
    }
  } else {
    _bdFromUserId = ME.id;
    document.getElementById('bdStep2').style.display = 'block';
    document.getElementById('bdYearSection').style.display = 'none';
  }
  document.getElementById('bulkDeleteModal').classList.add('open');
}

async function onBdFromChange() {
  const val = document.getElementById('bdFromUser').value;
  if (!val) return;
  _bdFromUserId = parseInt(val);
  document.getElementById('bdStep2').style.display = 'block';
  document.getElementById('bdDate').value = '';
  document.getElementById('bdStep3').style.display = 'none';
}

async function onBdDateChange() {
  const date = document.getElementById('bdDate').value;
  if (!date || !_bdFromUserId) return;

  document.getElementById('bulkDeleteErr').style.display = 'none';
  document.getElementById('bdTasksList').innerHTML = '<div style="padding:10px;color:var(--muted-foreground);font-size:13px">Loading...</div>';
  document.getElementById('bdStep3').style.display = 'block';
  document.getElementById('bdCancelBtn').style.display = 'none';
  document.getElementById('bdDateLabel').textContent = date;

  // v16: includeFuture=1 so upcoming checklist tasks bhi dikhe (jaise daily/weekly)
  const [delData, chlData] = await Promise.all([
    api('/api/tasks?type=delegation'),
    api('/api/tasks?type=checklist&includeFuture=1')
  ]);

  const allTasks = [];
  const pick = (data, type) => {
    const list = data.grouped
      ? (data.grouped.find(g => g.userId === _bdFromUserId)?.tasks || [])
      : (data.tasks || []);
    // v16: completed tasks ko bulk-delete me NEVER show — wo delete nahi honge
    list.forEach(t => { if (t.due_date === date && t.status !== 'completed') allTasks.push({...t, taskType: type}); });
  };
  pick(delData, 'delegation');
  pick(chlData, 'checklist');
  _bdDateTasks = allTasks;

  if (!allTasks.length) {
    document.getElementById('bdTasksList').innerHTML =
      '<div style="padding:12px;color:var(--muted-foreground);font-size:13px;text-align:center">No deletable tasks on this date (completed tasks excluded)</div>';
    return;
  }

  document.getElementById('bdTasksList').innerHTML = allTasks.map((t,i) => {
    const freqBadge = t.frequency
      ? `<span style="font-size:10px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:2px 7px;border-radius:8px;font-weight:600;border:1px solid color-mix(in srgb,var(--warning) 26%,transparent)">${t.frequency}</span>`
      : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--muted)">
      <input type="checkbox" class="bd-cb" data-idx="${i}" checked
        style="width:15px;height:15px;accent-color:var(--destructive);cursor:pointer;flex-shrink:0"/>
      <span style="font-size:13px;flex:1">${t.description||'—'}</span>
      ${freqBadge}
      <span style="font-size:11px;background:${t.status==='pending'?'color-mix(in srgb,var(--destructive) 10%,transparent)':'color-mix(in srgb,var(--warning) 12%,transparent)'};color:${t.status==='pending'?'var(--destructive)':'var(--warning)'};padding:2px 7px;border-radius:8px;font-weight:600">${t.status}</span>
      <span style="font-size:11px;background:var(--accent);color:var(--accent-foreground);padding:2px 7px;border-radius:8px;font-weight:600">${t.taskType}</span>
    </div>`;
  }).join('');
}

async function _doBulkDelete(tasks) {
  // v16: extra safety — completed tasks ko bulk delete me never include
  tasks = tasks.filter(t => t.status !== 'completed');
  if (!tasks.length) {
    document.getElementById('bulkDeleteErr').textContent = 'No pending tasks selected (completed tasks cannot be bulk deleted)';
    document.getElementById('bulkDeleteErr').style.display = 'block';
    return;
  }
  if (!await confirmDialog(`Permanently delete ${tasks.length} task(s)? This cannot be undone.`, {title:'Bulk Delete', okText:'Delete', danger:true})) return;

  let deleted = 0, skipped = 0;
  for (const t of tasks) {
    const r = await api(`/api/tasks/${t.id}?type=${t.taskType}&skipCompleted=1`, 'DELETE');
    if (r.error) skipped++;
    else deleted++;
  }

  closeModal('bulkDeleteModal');
  showToast(`🗑 ${deleted} task(s) deleted${skipped ? ` (${skipped} skipped)` : ''}!`);
  loadAllTasks();
}

async function bulkDeleteAll() { await _doBulkDelete(_bdDateTasks); }

async function bulkDeleteSelected() {
  const checked = [...document.querySelectorAll('.bd-cb:checked')];
  await _doBulkDelete(checked.map(cb => _bdDateTasks[parseInt(cb.dataset.idx)]).filter(Boolean));
}

function onBdYearFreqChange() {
  const freq = document.getElementById('bdYearFreq').value;
  const userSel = document.getElementById('bdYearUser');
  // Frequency select hone tak Employee dropdown disabled rakho
  if (userSel) userSel.disabled = !freq;
  _loadBdYearTasks(); // frequency badalne par specific-task list refresh
}

function onBdYearUserChange() {
  const sel = document.getElementById('bdYearUser');
  const opt = sel.options[sel.selectedIndex];
  const email = opt?.dataset?.email || '';
  const emailDiv = document.getElementById('bdYearUserEmail');
  const emailText = document.getElementById('bdYearUserEmailText');
  if (opt?.value && email) {
    emailText.textContent = email;
    emailDiv.style.display = 'block';
  } else {
    emailDiv.style.display = 'none';
  }
  _loadBdYearTasks(); // employee badalne par uske task naam bharo
}

// "Specific Tasks" checkbox list — chuni hui employee + frequency ke distinct task naam.
// Multiple tick kar sakte ho; kuch bhi na tick karo to poori category delete hoti hai.
// createElement/textContent se bharte hain taaki task naam me quote/HTML ho to bhi safe.
async function _loadBdYearTasks() {
  const box = document.getElementById('bdYearTaskBox');
  if (!box) return;
  const userId = document.getElementById('bdYearUser').value;
  const freq = document.getElementById('bdYearFreq').value;
  box.innerHTML = 'All tasks in this category';
  box.style.color = 'var(--muted-foreground)';
  if (!userId || !freq) return;
  try {
    const rows = await api(`/api/tasks/checklist-task-names?userId=${userId}&frequency=${encodeURIComponent(freq)}`);
    if (Array.isArray(rows) && rows.length) {
      box.innerHTML = '';
      box.style.color = 'var(--foreground)';
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11px;color:var(--muted-foreground);margin-bottom:5px';
      hint.textContent = 'Tick tasks to delete (none ticked = all in category)';
      box.appendChild(hint);
      rows.forEach(r => {
        const lab = document.createElement('label');
        lab.style.cssText = 'display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'bd-year-task-cb';
        cb.value = r.description;
        cb.dataset.count = r.count;
        cb.style.cssText = 'width:15px;height:15px;cursor:pointer;flex-shrink:0';
        const span = document.createElement('span');
        span.textContent = `${r.description} (${r.count})`;
        lab.appendChild(cb);
        lab.appendChild(span);
        box.appendChild(lab);
      });
    }
  } catch (e) {}
}

async function openDelete12MonthsConfirm() {
  const freqSel = document.getElementById('bdYearFreq');
  const freq = freqSel.value;
  if (!freq) { showToast('Please select a frequency category first (daily / weekly / monthly etc.)','error'); freqSel.focus(); return; }

  const sel = document.getElementById('bdYearUser');
  const userId = sel.value;
  if (!userId) { showToast('Please select an employee','error'); return; }

  const userName = sel.options[sel.selectedIndex].text;
  const userEmail = sel.options[sel.selectedIndex]?.dataset?.email || '';
  const freqLabel = freqSel.options[freqSel.selectedIndex].text;

  // Checked specific tasks (multiple). Kuch bhi na ticked = poori category.
  const checked = [...document.querySelectorAll('.bd-year-task-cb:checked')];
  const descriptions = checked.map(cb => cb.value);

  // Count: tasks ticked ho to unke counts ka sum (server call nahi chahiye);
  // warna poori category ka count server se lao.
  let count;
  if (descriptions.length) {
    count = checked.reduce((s, cb) => s + (parseInt(cb.dataset.count, 10) || 0), 0);
  } else {
    const data = await api(`/api/tasks/checklist-year-count?userId=${userId}&year=all&frequency=${encodeURIComponent(freq)}`);
    if (data.error) { showToast(data.error,'error'); return; }
    count = data.count || 0;
  }

  if (count === 0) {
    showToast(`No deletable ${descriptions.length ? 'occurrences of the selected task(s)' : freqLabel + ' checklist tasks'} found for ${userName}. (Completed tasks are never included.)`, 'error');
    return;
  }

  const taskLine = descriptions.length === 1 ? `Task: ${descriptions[0]}\n`
                 : descriptions.length > 1 ? `Tasks: ${descriptions.length} selected\n`
                 : `Category: ${freqLabel}\n`;

  const confirmed = await confirmDialog(
    `Employee: ${userName}\n` +
    `Email: ${userEmail}\n` +
    taskLine +
    `\n${count} pending/revised task(s) will be permanently deleted.\n` +
    `Completed tasks are safe — they will not be deleted.\n\n` +
    `This cannot be undone.`,
    { title: '⚠️ Confirm Delete', okText: `Delete ${count} task(s)`, danger: true }
  );
  if (!confirmed) return;

  const result = await api('/api/tasks/checklist-year-delete', 'POST', {
    userId: parseInt(userId),
    frequency: freq,
    descriptions: descriptions.length ? descriptions : undefined
  });
  if (result.error) { showToast(result.error,'error'); return; }

  closeModal('bulkDeleteModal');
  const what = descriptions.length === 1 ? `${result.deleted} occurrence(s) of the selected task`
             : descriptions.length > 1 ? `${result.deleted} occurrence(s) of ${descriptions.length} selected tasks`
             : `${result.deleted} ${freqLabel} checklist task(s)`;
  showToast(`🗑 ${what} deleted for ${userName}!`);
  loadAllTasks();
}

// ═══════════════════ BULK EDIT (admin only) ═══════════════════
async function openBulkEditModal() {
  document.getElementById('bulkEditErr').style.display = 'none';
  // Reset selection
  const freqSel = document.getElementById('beFreq'); freqSel.value = '';
  const userSel = document.getElementById('beUser'); userSel.disabled = true;
  const taskSel = document.getElementById('beTask');
  taskSel.innerHTML = '<option value="">All tasks in this category</option>'; taskSel.disabled = true;
  document.getElementById('beUserEmail').style.display = 'none';
  // Reset changes
  document.getElementById('bePriority').value = '';
  const nameInp = document.getElementById('beName'); nameInp.value = ''; nameInp.disabled = true; nameInp.style.background = 'var(--muted)';
  document.getElementById('beNameHint').textContent = '(select a specific task first)';
  document.getElementById('beDueMode').value = '';
  document.getElementById('beShiftDays').value = '';
  document.getElementById('beNewDate').value = '';
  document.getElementById('beShiftWrap').style.display = 'none';
  document.getElementById('beNewDate').style.display = 'none';

  // Employee dropdown — current Office/Factory view ke users hi.
  // Admin-role users bhi doer ho sakte hain (Sachin jaise) — hatao mat.
  // Naam + email dikhao taaki same naam wale (do "Rahul") alag pehchane ja saken.
  const allUsers = await api(withSeg('/api/users'));
  userSel.innerHTML = '<option value="">-- Select Employee --</option>' +
    allUsers.map(u=>`<option value="${u.id}" data-email="${u.email}">${u.name} — ${u.email}</option>`).join('');

  document.getElementById('bulkEditModal').classList.add('open');
}

function onBeFreqChange() {
  const freq = document.getElementById('beFreq').value;
  document.getElementById('beUser').disabled = !freq;
  _loadBeTasks();
}

function onBeUserChange() {
  const sel = document.getElementById('beUser');
  const opt = sel.options[sel.selectedIndex];
  const email = opt?.dataset?.email || '';
  const div = document.getElementById('beUserEmail');
  if (opt?.value && email) { document.getElementById('beUserEmailText').textContent = email; div.style.display = 'block'; }
  else div.style.display = 'none';
  _loadBeTasks();
}

// Task naam tabhi editable jab ek specific task chuna ho
function onBeTaskChange() {
  const hasTask = !!document.getElementById('beTask').value;
  const nameInp = document.getElementById('beName');
  nameInp.disabled = !hasTask;
  nameInp.style.background = hasTask ? 'var(--card)' : 'var(--muted)';
  document.getElementById('beNameHint').textContent = hasTask ? '(all occurrences renamed)' : '(select a specific task first)';
  if (!hasTask) nameInp.value = '';
}

async function _loadBeTasks() {
  const taskSel = document.getElementById('beTask');
  const userId = document.getElementById('beUser').value;
  const freq = document.getElementById('beFreq').value;
  taskSel.innerHTML = '<option value="">All tasks in this category</option>';
  taskSel.disabled = true;
  onBeTaskChange();
  if (!userId || !freq) return;
  try {
    const rows = await api(`/api/tasks/checklist-task-names?userId=${userId}&frequency=${encodeURIComponent(freq)}`);
    if (Array.isArray(rows) && rows.length) {
      rows.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.description;
        opt.textContent = `${r.description} (${r.count})`;
        taskSel.appendChild(opt);
      });
      taskSel.disabled = false;
    }
  } catch (e) {}
}

function onBeDueModeChange() {
  const mode = document.getElementById('beDueMode').value;
  document.getElementById('beShiftWrap').style.display = mode === 'shift' ? 'flex' : 'none';
  document.getElementById('beNewDate').style.display = mode === 'set' ? 'inline-block' : 'none';
}

async function applyBulkEdit() {
  const errBox = document.getElementById('bulkEditErr');
  const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'block'; };
  errBox.style.display = 'none';

  const freqSel = document.getElementById('beFreq');
  const freq = freqSel.value;
  if (!freq) { showErr('Please select a frequency category first.'); return; }
  const userSel = document.getElementById('beUser');
  const userId = userSel.value;
  if (!userId) { showErr('Please select an employee.'); return; }

  const taskSel = document.getElementById('beTask');
  const description = taskSel.value || '';
  const taskName = description ? taskSel.options[taskSel.selectedIndex].text.replace(/ \(\d+\)$/,'') : '';

  // Build changes
  const priority = document.getElementById('bePriority').value || '';
  const newName = document.getElementById('beName').value.trim();
  const dueMode = document.getElementById('beDueMode').value;
  let shiftDays = '', newDueDate = '';
  if (dueMode === 'shift') {
    shiftDays = document.getElementById('beShiftDays').value.trim();
    if (shiftDays === '' || parseInt(shiftDays,10) === 0 || !Number.isFinite(parseInt(shiftDays,10))) { showErr('Enter a non-zero number of days to shift (e.g. 7 or -3).'); return; }
  } else if (dueMode === 'set') {
    newDueDate = document.getElementById('beNewDate').value;
    if (!newDueDate) { showErr('Pick a date to set.'); return; }
  }
  if (newName && !description) { showErr('To rename, select a specific task first.'); return; }

  const changes = [];
  if (priority) changes.push(`Priority → ${priority.charAt(0).toUpperCase()+priority.slice(1)}`);
  if (newName) changes.push(`Name → "${newName}"`);
  if (dueMode === 'shift') changes.push(`Due date → shift ${parseInt(shiftDays,10) > 0 ? '+' : ''}${parseInt(shiftDays,10)} day(s)`);
  if (dueMode === 'set') changes.push(`Due date → ${newDueDate}`);
  if (!changes.length) { showErr('Select at least one thing to change (priority, name, or due date).'); return; }

  // Count affected (completed excluded server-side)
  const cnt = await api(`/api/tasks/checklist-year-count?userId=${userId}&year=all&frequency=${encodeURIComponent(freq)}${description?`&description=${encodeURIComponent(description)}`:''}`);
  if (cnt.error) { showErr(cnt.error); return; }
  const count = cnt.count || 0;
  if (count === 0) { showErr(`No editable ${description ? 'occurrences of this task' : 'tasks in this category'} found (completed tasks are never changed).`); return; }

  const userName = userSel.options[userSel.selectedIndex].text;
  const freqLabel = freqSel.options[freqSel.selectedIndex].text;
  const confirmed = await confirmDialog(
    `Employee: ${userName}\n` +
    (description ? `Task: ${taskName}\n` : `Category: ${freqLabel}\n`) +
    `\nChanges:\n  • ${changes.join('\n  • ')}\n\n` +
    `${count} pending/revised task(s) will be updated.\n` +
    `Completed tasks are safe — they will not change.`,
    { title: '✏️ Confirm Bulk Edit', okText: `Update ${count} task(s)` }
  );
  if (!confirmed) return;

  const result = await api('/api/tasks/checklist-bulk-edit', 'POST', {
    userId: parseInt(userId),
    frequency: freq,
    description: description || undefined,
    priority: priority || undefined,
    newDescription: newName || undefined,
    shiftDays: dueMode === 'shift' ? parseInt(shiftDays,10) : undefined,
    newDueDate: dueMode === 'set' ? newDueDate : undefined
  });
  if (result.error) { showErr(result.error); return; }

  closeModal('bulkEditModal');
  showToast(`✏️ ${result.updated} task(s) updated for ${userName}!`);
  loadAllTasks();
}


let _transferFromUserId = null;
let _transferDateTasks = [];

async function openNewTransferModal() {
  document.getElementById('transferErr').style.display = 'none';
  document.getElementById('transferStep1').style.display = 'none';
  document.getElementById('transferStep2').style.display = 'none';
  document.getElementById('transferStep3').style.display = 'none';
  document.getElementById('transferCancelBtn').style.display = 'block';
  document.getElementById('transferDate').value = '';
  document.getElementById('transferTasksListNew').innerHTML = '';
  document.getElementById('transferToUser').innerHTML = '<option value="">-- Select user --</option>';
  _transferFromUserId = null;
  _transferDateTasks = [];

  const isAdmin = ME.role === 'admin';
  const isHod = ME.role === 'hod';

  if (isAdmin || isHod) {
    const allUsers = await api('/api/users');
    const eligible = isAdmin
      ? allUsers
      : allUsers.filter(u => u.department === ME.department && u.id !== ME.id);
    document.getElementById('transferFromUser').innerHTML =
      '<option value="">-- Select user --</option>' +
      eligible.map(u=>`<option value="${u.id}">${u.name} (${u.department||u.role})</option>`).join('');
    document.getElementById('transferStep1').style.display = 'block';
  } else {
    _transferFromUserId = ME.id;
    document.getElementById('transferStep2').style.display = 'block';
  }
  document.getElementById('transferModal').classList.add('open');
}

async function onTransferFromChange() {
  const val = document.getElementById('transferFromUser').value;
  if (!val) return;
  _transferFromUserId = parseInt(val);
  document.getElementById('transferStep2').style.display = 'block';
  document.getElementById('transferDate').value = '';
  document.getElementById('transferStep3').style.display = 'none';
}

async function onTransferDateChange() {
  const date = document.getElementById('transferDate').value;
  if (!date || !_transferFromUserId) return;

  document.getElementById('transferErr').style.display = 'none';
  document.getElementById('transferTasksListNew').innerHTML =
    '<div style="padding:10px;color:var(--muted-foreground);font-size:13px">Loading...</div>';
  document.getElementById('transferStep3').style.display = 'block';
  document.getElementById('transferCancelBtn').style.display = 'none';
  document.getElementById('transferDateLabel').textContent = date;

  // v16: includeFuture=1 so upcoming checklist tasks bhi dikhe (transfer ke liye)
  const [delData, chlData] = await Promise.all([
    api('/api/tasks?type=delegation'),
    api('/api/tasks?type=checklist&includeFuture=1')
  ]);

  const allTasks = [];
  const pick = (data, type) => {
    const list = data.grouped
      ? (data.grouped.find(g => g.userId === _transferFromUserId)?.tasks || [])
      : (data.tasks || []);
    list.forEach(t => { if (t.due_date === date && t.status === 'pending') allTasks.push({...t, taskType: type}); });
  };
  pick(delData, 'delegation');
  pick(chlData, 'checklist');
  _transferDateTasks = allTasks;

  if (!allTasks.length) {
    document.getElementById('transferTasksListNew').innerHTML =
      '<div style="padding:12px;color:var(--muted-foreground);font-size:13px;text-align:center">No pending tasks on this date</div>';
  } else {
    const pendingRes = await api('/api/transfers/pending-tasks');
    const pendingIds = new Set((pendingRes||[]).map(p=>`${p.task_type}_${p.task_id}`));
    document.getElementById('transferTasksListNew').innerHTML = allTasks.map((t,i) => {
      const isPending = pendingIds.has(`${t.taskType}_${t.id}`);
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--muted)">
        ${isPending
          ? `<span style="font-size:10px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);padding:2px 7px;border-radius:10px;font-weight:600;border:1px solid color-mix(in srgb,var(--warning) 26%,transparent);white-space:nowrap">⏳ Sent</span>`
          : `<input type="checkbox" class="tr-date-cb" data-idx="${i}" checked
              style="width:15px;height:15px;accent-color:var(--chart-5);cursor:pointer;flex-shrink:0"/>`}
        <span style="font-size:13px;flex:1">${t.description||'—'}</span>
        <span style="font-size:11px;background:var(--accent);color:var(--accent-foreground);padding:2px 7px;border-radius:8px;font-weight:600">${t.taskType}</span>
      </div>`;
    }).join('');
  }

  const allUsers = await api('/api/users');
  const eligible = (ME.role === 'hod')
    ? allUsers.filter(u => u.department === ME.department && u.id !== _transferFromUserId)
    : allUsers.filter(u => u.id !== _transferFromUserId);
  document.getElementById('transferToUser').innerHTML =
    '<option value="">-- Select user --</option>' +
    eligible.map(u=>`<option value="${u.id}">${u.name} (${u.department||u.role})</option>`).join('');
}

async function _doTransfer(tasks) {
  const err = document.getElementById('transferErr');
  err.style.display = 'none';
  const toUserId = document.getElementById('transferToUser').value;
  if (!toUserId) { err.textContent='Please select a "Transfer To" user first'; err.style.display='block'; return; }
  if (!tasks.length) { err.textContent='No task selected'; err.style.display='block'; return; }
  const r = await api('/api/transfers','POST',{
    tasks: tasks.map(t => ({ taskId: t.id, taskType: t.taskType })),
    toUserId: parseInt(toUserId)
  });
  if (r.error) { err.textContent = r.error; err.style.display='block'; return; }
  closeModal('transferModal');
  if (r.count > 0) showToast(`✅ ${r.count} transfer request(s) sent for approval!`);
  else showToast('⚠️ All these tasks already have a pending request!', 'error');
  loadTransferBadge();
}

async function submitTransferAll() { await _doTransfer(_transferDateTasks); }
async function submitTransferSelected() {
  const checked = [...document.querySelectorAll('.tr-date-cb:checked')];
  await _doTransfer(checked.map(cb => _transferDateTasks[parseInt(cb.dataset.idx)]).filter(Boolean));
}

async function loadTransferBadge() {
  if (ME.role !== 'admin' && ME.role !== 'hod') return;
  try {
    const d = await api('/api/transfers/count');
    const badge = document.getElementById('transferBadge');
    if (badge) { badge.textContent = d.count||0; badge.style.display = d.count>0 ? 'flex' : 'none'; }
    setApprovalTabCount('apprCountTransfer', d.count || 0);
  } catch(e) {}
}

async function loadTransferApprovals() {
  const container = document.getElementById('transferApprovalsContent');
  if (!container) return;
  const transfers = await api('/api/transfers');
  if (!transfers.length) { container.innerHTML=`<div class="empty">✅ No pending transfer requests!</div>`; return; }
  container.innerHTML = `
    <table>
      <thead><tr><th>Task</th><th>Type</th><th>From</th><th>To</th><th>Requested By</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        ${transfers.map(t=>`<tr>
          <td style="font-size:12px;max-width:180px">${t.description}</td>
          <td><span class="status-badge pending" style="font-size:10px">${t.task_type}</span></td>
          <td style="font-weight:600">${t.fromUserName}</td>
          <td style="color:var(--chart-5);font-weight:600">${t.toUserName}</td>
          <td style="color:var(--muted-foreground);font-size:12px">${t.requestedByName}</td>
          <td style="color:var(--muted-foreground);font-size:12px">${new Date(t.created_at).toLocaleDateString('en-IN')}</td>
          <td>
            <button class="action-btn done" onclick="handleTransfer(${t.id},'approved')">✅ Approve</button>
            <button class="action-btn delete" style="margin-left:4px" onclick="handleTransfer(${t.id},'rejected')">❌ Reject</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

async function handleTransfer(id, action) {
  const note = action === 'rejected' ? ((await promptDialog('Why is this being rejected? (optional)', {title:'Reject', okText:'Reject', placeholder:'Reason (optional)'})) || '') : '';
  await api(`/api/transfers/${id}`,'PUT',{ action, note: note||'' });
  showToast(action === 'approved' ? '✅ Transfer approved!' : '❌ Transfer rejected!');
  loadTransferApprovals();
  loadTransferBadge();
}


init();
setDefaultMISDates();
