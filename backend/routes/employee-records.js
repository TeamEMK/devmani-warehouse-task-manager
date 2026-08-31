// ══════════════════════════════════════════════════════
// EMPLOYEE RECORDS  (Admin / HOD / PC) — Plan vs Done
// ──────────────────────────────────────────────────────
// Ek hi CANONICAL source. Kisi bhi employee ke numbers (total / done / pending /
// score / committed plan) viewer ke role par DEPEND NAHI karte. Role sirf ye
// decide karta hai ki KAUN-KAUN employee dikhega:
//   • admin / pc  → sabhi employees
//   • hod         → sirf apne department ke employees
// Isi liye admin aur HOD dono ko ek hi employee ka EXACT same total/score dikhega.
// Har employee ke saath uska committed plan inline aata hai, aur pending tasks ki
// poori list (delegation + checklist + FMS) bhi.
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

// Score ka formula seedha lib se — ctx se nahi. Poore app me MIS score ka ek hi
// hisaab hona chahiye, aur wo hisaab kisi request ya DB par nirbhar nahi hai.
const { calcMisScore } = require('../lib/mis-render');

module.exports = function registerEmployeeRecordsRoutes(app, ctx) {
  const { db, requireAuth, requireAdminOrHod, computeFmsStats } = ctx;

  app.get('/api/employee-records', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) return res.status(400).json({ error: 'Dates required' });
      const isHod = req.session.role === 'hod';
      const uid = req.session.userId;

      // HOD ka department (sirf visibility ke liye)
      let hodDept = '';
      if (isHod) {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
        hodDept = me[0]?.department || '';
      }

      // Score formula — shared helper se (consistency). total=0 → null (Records me "—").
      // NOTE: is endpoint ki query me abhi not_on_time nahi aata, isliye yahan 0 jaata hai;
      // Records tab re-enable karte waqt not_on_time bhi query me add karna.
      const calcScore = (total, pending, overdue, revised) => {
        total = parseInt(total)||0;
        return total > 0 ? calcMisScore({ total, pending, overdue, revised }) : null;
      };

      // Dept filter sirf visibility ke liye (numbers par nahi)
      let deptFilter = '';
      let deptParams = [start, end];
      if (isHod) { deptFilter = 'AND u.department=?'; deptParams = [start, end, hodDept]; }

      // ── Delegation + Checklist aggregate per user ──
      const [delRows] = await db.query(
        `SELECT u.id AS "userId", u.name, u.department,
          COUNT(*) AS total,
          SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN t.status='revised' THEN 1 ELSE 0 END) AS revised,
          SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue
         FROM delegation_tasks t JOIN users u ON t.assigned_to=u.id
         WHERE t.due_date BETWEEN ? AND ? ${deptFilter}
         GROUP BY u.id, u.name, u.department`, deptParams);

      const [chlRows] = await db.query(
        `SELECT u.id AS "userId", u.name, u.department,
          COUNT(*) AS total,
          SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue
         FROM checklist_tasks t JOIN users u ON t.assigned_to=u.id
         WHERE t.due_date BETWEEN ? AND ? ${deptFilter}
         GROUP BY u.id, u.name, u.department`, deptParams);

      const map = {};
      const ensure = (r) => {
        if (!map[r.userId]) map[r.userId] = {
          userId: r.userId, name: r.name, department: r.department || '',
          del: { total:0, pending:0, completed:0, revised:0, overdue:0 },
          chl: { total:0, pending:0, completed:0, overdue:0 },
          fms: { total:0, pending:0, done:0 }
        };
        return map[r.userId];
      };
      for (const r of delRows) {
        const e = ensure(r);
        e.del = { total:+r.total||0, pending:+r.pending||0, completed:+r.completed||0, revised:+r.revised||0, overdue:+r.overdue||0 };
      }
      for (const r of chlRows) {
        const e = ensure(r);
        e.chl = { total:+r.total||0, pending:+r.pending||0, completed:+r.completed||0, overdue:+r.overdue||0 };
      }

      // ── FMS (ROLE-INDEPENDENT: hamesha all-doers crediting) + pending detail ──
      let fmsPerUser = {}, fmsPerUserPending = {}, fmsErrors = [];
      try {
        const fmsStats = await computeFmsStats('', true);
        fmsPerUser = fmsStats.perUser || {};
        fmsPerUserPending = fmsStats.perUserPending || {};
        fmsErrors = fmsStats.errors || [];
      } catch (e) { fmsErrors = ['FMS data unavailable']; }

      // Sirf-FMS-walon ko bhi list me daalo (dept visibility ke saath)
      const fmsOnlyIds = Object.keys(fmsPerUser).map(x => parseInt(x)).filter(x => !map[x]);
      if (fmsOnlyIds.length) {
        let q = `SELECT id, name, department FROM users WHERE id IN (${fmsOnlyIds.map(()=>'?').join(',')})`;
        const qp = [...fmsOnlyIds];
        if (isHod) { q += ' AND department=?'; qp.push(hodDept); }
        const [extra] = await db.query(q, qp);
        for (const u of extra) ensure({ userId: u.id, name: u.name, department: u.department });
      }
      for (const e of Object.values(map)) {
        const f = fmsPerUser[e.userId] || { pending:0, done:0 };
        e.fms = { pending: f.pending||0, done: f.done||0, total: (f.pending||0)+(f.done||0) };
      }

      // ── Committed plans (week_plans) for range ──
      let planMap = {};
      try {
        const [plans] = await db.query(
          `SELECT employee_id, target_count, TO_CHAR(start_date,'YYYY-MM-DD') AS start_date, improvement_pct
           FROM week_plans WHERE start_date BETWEEN ? AND ? ORDER BY start_date DESC`, [start, end]);
        for (const p of plans) if (!planMap[p.employee_id]) planMap[p.employee_id] = p;
      } catch (e) { /* table may not exist */ }

      // Jis employee ka plan committed hai par koi task/FMS nahi — usse bhi list me laao
      // (taaki "har employee ke saamne plan" dikhe). HOD ke liye dept visibility respect hoti hai.
      const planOnlyIds = Object.keys(planMap).map(x => parseInt(x)).filter(x => !map[x]);
      if (planOnlyIds.length) {
        let pq = `SELECT id, name, department FROM users WHERE id IN (${planOnlyIds.map(()=>'?').join(',')})`;
        const pqp = [...planOnlyIds];
        if (isHod) { pq += ' AND department=?'; pqp.push(hodDept); }
        const [pu] = await db.query(pq, pqp);
        for (const u of pu) ensure({ userId: u.id, name: u.name, department: u.department });
      }

      // ── Pending task lists (delegation + checklist) for visible users ──
      const visibleIds = Object.keys(map).map(x => parseInt(x));
      let delPending = {}, chlPending = {};
      if (visibleIds.length) {
        const ph = visibleIds.map(()=>'?').join(',');
        const [dp] = await db.query(
          `SELECT t.assigned_to AS uid, t.description, t.status,
                  TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date
           FROM delegation_tasks t
           WHERE t.assigned_to IN (${ph}) AND t.due_date BETWEEN ? AND ?
             AND t.status IN ('pending','revised')
           ORDER BY t.due_date ASC`, [...visibleIds, start, end]);
        for (const r of dp) { (delPending[r.uid] = delPending[r.uid] || []).push(r); }
        const [cp] = await db.query(
          `SELECT t.assigned_to AS uid, t.description, t.status,
                  TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date
           FROM checklist_tasks t
           WHERE t.assigned_to IN (${ph}) AND t.due_date BETWEEN ? AND ?
             AND t.status='pending'
           ORDER BY t.due_date ASC`, [...visibleIds, start, end]);
        for (const r of cp) { (chlPending[r.uid] = chlPending[r.uid] || []).push(r); }
      }

      // ── Assemble canonical rows ──
      const rows = Object.values(map).map(e => {
        const total   = e.del.total + e.chl.total + e.fms.total;
        const pending = e.del.pending + e.chl.pending + e.fms.pending;
        const done    = e.del.completed + e.chl.completed + e.fms.done;
        const overdue = e.del.overdue + e.chl.overdue;
        const revised = e.del.revised;
        const score   = calcScore(total, pending, overdue, revised);
        const plan    = planMap[e.userId] || null;
        return {
          userId: e.userId, name: e.name, department: e.department,
          committed: plan ? {
            start_date: plan.start_date,
            target_count: plan.target_count,
            improvement_pct: (plan.improvement_pct === null || plan.improvement_pct === undefined) ? null : plan.improvement_pct
          } : null,
          total, done, pending, overdue, revised, score,
          breakdown: {
            delegation: { total: e.del.total, done: e.del.completed, pending: e.del.pending },
            checklist:  { total: e.chl.total, done: e.chl.completed, pending: e.chl.pending },
            fms:        { total: e.fms.total, done: e.fms.done,       pending: e.fms.pending }
          },
          pendingTasks: {
            delegation: delPending[e.userId] || [],
            checklist:  chlPending[e.userId] || [],
            fms:        fmsPerUserPending[e.userId] || []
          }
        };
      }).filter(r => r.total > 0 || r.committed)
        .sort((a,b) => a.name.localeCompare(b.name));

      res.json({ rows, fmsErrors });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // ── PC: Users with pending tasks (for smart dropdown) ──
  app.get('/api/users/with-pending-tasks', requireAuth, async (req, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      let dateFilter = 'AND t.due_date <= CURRENT_DATE';
      if (dateFrom && dateTo) dateFilter = `AND t.due_date BETWEEN '${dateFrom}' AND '${dateTo}'`;
      const [rows] = await db.query(`
        SELECT DISTINCT u.id, u.name FROM users u
        WHERE u.id IN (
          SELECT DISTINCT assigned_to FROM delegation_tasks t WHERE status='pending' ${dateFilter}
          UNION
          SELECT DISTINCT assigned_to FROM checklist_tasks t WHERE status='pending' ${dateFilter}
        ) AND u.role NOT IN ('admin','pc')
        ORDER BY u.name ASC`);
      res.json(rows);
    } catch(err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
