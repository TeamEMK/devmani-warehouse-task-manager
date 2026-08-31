// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerDashboardRoutes(app, ctx) {
  const { db, requireAuth, segmentFilter } = ctx;

  app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
      const uid = req.session.userId;
      const role = req.session.role;
      const isAdmin = role === 'admin' || role === 'pc';
      const isHod = role === 'hod';
      const isPC = role === 'pc';
      const filterEmployee = req.query.employee;
      const hodDept = req.query.hodDept || '';
      // PC date range filter — default to today if not provided
      const dateFrom = req.query.dateFrom || '';
      const dateTo   = req.query.dateTo   || '';

      let userFilter, params;

      if (isAdmin && filterEmployee && filterEmployee !== 'all') {
        userFilter = 'AND t.assigned_to = ?'; params = [filterEmployee];
      } else if (isAdmin) {
        userFilter = ''; params = [];
      } else if (isHod) {
        if (filterEmployee && filterEmployee !== 'all') {
          userFilter = 'AND t.assigned_to = ?'; params = [filterEmployee];
        } else {
          // HOD ka department DB se fetch karo — query param pe depend mat karo
          let resolvedDept = hodDept;
          if (!resolvedDept) {
            const [meRow] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
            resolvedDept = meRow[0]?.department || '';
          }
          if (!resolvedDept) {
            // Department set nahi hai — sirf apni tasks dikhao
            userFilter = 'AND t.assigned_to = ?'; params = [uid];
          } else {
            const [deptUsers] = await db.query('SELECT id FROM users WHERE department=? AND role NOT IN (?,?)', [resolvedDept, 'admin','hod']);
            if (!deptUsers.length) {
              // Dept mein koi user nahi — apni tasks dikhao
              userFilter = 'AND t.assigned_to = ?'; params = [uid];
            } else {
              const ids = deptUsers.map(u=>u.id);
              // HOD khud bhi include karo
              if (!ids.includes(uid)) ids.push(uid);
              userFilter = `AND t.assigned_to IN (${ids.map(()=>'?').join(',')})`;
              params = ids;
            }
          }
        }
      } else {
        userFilter = 'AND t.assigned_to = ?'; params = [uid];
      }

      // Office/Factory segment — assigned_to us staff_type ke users me hona chahiye
      const seg = segmentFilter(req);
      if (seg.param) { userFilter += ' AND t.assigned_to IN (SELECT id FROM users WHERE staff_type=?)'; params.push(seg.param); }

      // Stats + Table: aaj aur usse pehle ki pending tasks (due_date <= CURRENT_DATE)
      // PC: agar date range diya hai toh woh use karo
      const dateClause = isPC && dateFrom && dateTo
        ? `AND t.due_date BETWEEN '${dateFrom}' AND '${dateTo}'`
        : `AND t.due_date <= CURRENT_DATE`;

      const taskType = req.query.taskType || 'both';
      const wantDeleg = taskType === 'delegation' || taskType === 'both';
      const wantChk   = taskType === 'checklist'  || taskType === 'both';

      // Dashboard ke overview cards clickable hain — `list` batata hai ki neeche wali
      // table me kaunsi list chahiye. Ye list yahin se aati hai (alag /api/tasks se
      // nahi) taaki upar ke counts aur neeche ki table par bilkul wahi employee /
      // department / date-range / segment filter lagein. Warna card ka number aur
      // table ki rows kabhi match nahi karengi.
      const list = ['pending','upcoming','revised','completed','all'].includes(req.query.list)
        ? req.query.list : 'pending';
      const listClause =
        list === 'upcoming'  ? `t.status='pending' AND t.due_date > CURRENT_DATE AND t.due_date <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date`
      : list === 'revised'   ? `t.status='revised' ${dateClause}`
      : list === 'completed' ? `t.status='completed' ${dateClause}`
      // Total card = pending + completed, to 'all' bhi wahi do dikhata hai
      : list === 'all'       ? `((t.status='pending' ${dateClause}) OR (t.status='completed' ${dateClause}))`
      :                        `t.status='pending' ${dateClause}`;
      // NOTE: dateClause apni dates SQL me seedha jodta hai, placeholder se nahi —
      // isliye use dohrane par bhi params nahi badhte. Saare placeholders sirf
      // userFilter ke hain, jo har query me ek hi baar aata hai.

      // Upcoming count ab nahi nikalte — wo card dashboard se hata diya gaya hai.
      // Uske liye har dashboard load par do extra COUNT queries chal rahi thi, aur
      // checklist table lakhon rows tak ja sakta hai. Upcoming tasks All Tasks
      // page ke Upcoming tab me milte hain, jo apna data alag se laata hai.
      const counts = t => `SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='revised' THEN 1 ELSE 0 END) AS revised,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM ${t} t WHERE 1=1 ${userFilter} ${dateClause}`;
      const listSql = (t, type, approval, waiting) =>
        `SELECT t.id,'${type}' AS type,t.description,t.status,t.assigned_to,COALESCE(t.priority,'low') AS priority,${approval} AS approval,${waiting} AS waiting_approval,t.remarks,t.doer_remark,TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date,t.proof_image IS NOT NULL AS has_proof,t.proof_replaced,t.proof_video_id IS NOT NULL AS has_video,t.proof_video_replaced,u1.name AS "assignedToName",u2.name AS "assignedByName" FROM ${t} t JOIN users u1 ON t.assigned_to=u1.id JOIN users u2 ON t.assigned_by=u2.id WHERE ${listClause} ${userFilter} ORDER BY t.due_date ASC LIMIT 500`;

      // Chaaron queries saath me. Ye ek doosre par nirbhar nahi hain — userFilter
      // aur listClause upar hi tay ho chuke hain, aur koi kisi ka nateeja nahi
      // maangti. Pehle ye ek-ek karke chalti thi, yaani chaar round-trip.
      //
      // Jab database usi machine par ho to farak dikhta bhi nahi. Par managed
      // database door ke region me hota hai — wahan ek round-trip 300-500ms ka
      // hai, aur chaar ka matlab poora ~1.2 second, jisme se lagbhag saara samay
      // sirf intezaar hai. Saath chalane se wahi kaam ek round-trip me ho jaata hai.
      const [dCount, cCount, dRows, cRows] = await Promise.all([
        wantDeleg ? db.query(counts('delegation_tasks'), params) : null,
        wantChk   ? db.query(counts('checklist_tasks'),  params) : null,
        wantDeleg ? db.query(listSql('delegation_tasks', 'delegation', "COALESCE(t.approval,'no')", 'COALESCE(t.waiting_approval,0)'), params) : null,
        wantChk   ? db.query(listSql('checklist_tasks',  'checklist',  "'no'", '0'), params) : null,
      ]);

      let pending = 0, revised = 0, completed = 0;
      for (const c of [dCount, cCount]) {
        if (!c) continue;
        const d = c[0];
        pending += parseInt(d[0].pending)||0; revised += parseInt(d[0].revised)||0; completed += parseInt(d[0].completed)||0;
      }
      const delegationList = dRows ? dRows[0] : [];
      const checklistList  = cRows ? cRows[0] : [];
      // todayPending naam purana hai — ab isme jo bhi list maangi gayi wo aati hai
      res.json({ pending, revised, completed, list, todayPending: [...delegationList, ...checklistList] });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
