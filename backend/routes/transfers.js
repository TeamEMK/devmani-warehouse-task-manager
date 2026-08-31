// ══════════════════════════════════════════════════════
// TASK TRANSFERS
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerTransfersRoutes(app, ctx) {
  const { db, requireAuth, requireAdminOrHod, getTable } = ctx;


  // POST — Create transfer request (user/hod/admin)
  app.post('/api/transfers', requireAuth, async (req, res) => {
    try {
      const { tasks, toUserId } = req.body;
      // tasks = [{taskId, taskType}]
      if (!tasks || !tasks.length || !toUserId)
        return res.status(400).json({ error: 'Tasks and target user required' });

      const uid = req.session.userId;
      const role = req.session.role;

      // Validate each task — user can only transfer their own, HOD dept, admin any
      for (const t of tasks) {
        const table = getTable(t.taskType);
        const [rows] = await db.query(`SELECT * FROM ${table} WHERE id=?`, [t.taskId]);
        if (!rows[0]) return res.status(404).json({ error: `Task ${t.taskId} not found` });
        const task = rows[0];

        if (role === 'user' && task.assigned_to !== uid)
          return res.status(403).json({ error: 'You can only transfer your own tasks' });

        if (role === 'hod') {
          const [taskUser] = await db.query('SELECT department FROM users WHERE id=?', [task.assigned_to]);
          const [hodUser] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
          if (taskUser[0]?.department !== hodUser[0]?.department)
            return res.status(403).json({ error: 'HOD can only transfer tasks of their department' });
        }
      }

      // Insert transfer requests — skip if already pending
      let inserted = 0, skipped = 0;
      for (const t of tasks) {
        const table = getTable(t.taskType);
        const [rows] = await db.query(`SELECT assigned_to FROM ${table} WHERE id=?`, [t.taskId]);
        const fromUser = rows[0].assigned_to;
        const [existing] = await db.query(
          `SELECT id FROM task_transfers WHERE task_id=? AND task_type=? AND status='pending'`,
          [t.taskId, t.taskType]
        );
        if (existing[0]) { skipped++; continue; }
        await db.query(
          `INSERT INTO task_transfers (task_id, task_type, from_user, to_user, requested_by, status) VALUES (?,?,?,?,?,'pending')`,
          [t.taskId, t.taskType, fromUser, toUserId, uid]
        );
        inserted++;
      }

      res.json({ success: true, count: inserted, skipped });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // GET — Task IDs that already have a pending transfer (for current user's tasks)
  app.get('/api/transfers/pending-tasks', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT task_id, task_type FROM task_transfers WHERE status='pending' AND requested_by=?`,
        [req.session.userId]
      );
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // GET — Pending transfers for approval (admin sees all, HOD sees dept)
  app.get('/api/transfers', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const uid = req.session.userId;
      const role = req.session.role;
      let deptFilter = '';
      let params = [];

      if (role === 'hod') {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
        const dept = me[0]?.department || '';
        // HOD sees transfers of users in their department
        const [deptUsers] = await db.query('SELECT id FROM users WHERE department=?', [dept]);
        if (!deptUsers.length) return res.json([]);
        const ids = deptUsers.map(u=>u.id);
        deptFilter = `AND (tt.from_user IN (${ids.map(()=>'?').join(',')}) OR tt.to_user IN (${ids.map(()=>'?').join(',')}))`;
        params = [...ids, ...ids];
      }

      const [rows] = await db.query(`
        SELECT tt.*,
          uf.name AS "fromUserName", ut.name AS "toUserName",
          ur.name AS "requestedByName",
          u_from.department AS "fromDept"
        FROM task_transfers tt
        JOIN users uf ON tt.from_user = uf.id
        JOIN users ut ON tt.to_user = ut.id
        JOIN users ur ON tt.requested_by = ur.id
        JOIN users u_from ON tt.from_user = u_from.id
        WHERE tt.status = 'pending' ${deptFilter}
        ORDER BY tt.created_at DESC`, params);

      // Attach task description
      for (const r of rows) {
        const table = getTable(r.task_type);
        const [t] = await db.query(`SELECT description, TO_CHAR(due_date,'YYYY-MM-DD') AS due_date FROM ${table} WHERE id=?`, [r.task_id]);
        r.description = t[0]?.description || '—';
        r.due_date = t[0]?.due_date || '—';
      }

      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // GET — Transfer count for badge
  app.get('/api/transfers/count', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const uid = req.session.userId;
      const role = req.session.role;
      let count = 0;
      if (role === 'admin') {
        const [r] = await db.query(`SELECT COUNT(*) AS c FROM task_transfers WHERE status='pending'`);
        count = r[0].c;
      } else {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
        const dept = me[0]?.department || '';
        const [deptUsers] = await db.query('SELECT id FROM users WHERE department=?', [dept]);
        if (deptUsers.length) {
          const ids = deptUsers.map(u=>u.id);
          const [r] = await db.query(`SELECT COUNT(*) AS c FROM task_transfers WHERE status='pending' AND (from_user IN (${ids.map(()=>'?').join(',')}) OR to_user IN (${ids.map(()=>'?').join(',')}))`, [...ids,...ids]);
          count = r[0].c;
        }
      }
      res.json({ count });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // PUT — Approve or reject transfer
  app.put('/api/transfers/:id', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { action, note } = req.body; // action: 'approved' | 'rejected'
      const [rows] = await db.query('SELECT * FROM task_transfers WHERE id=?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Transfer not found' });
      const tr = rows[0];

      await db.query('UPDATE task_transfers SET status=?, note=? WHERE id=?', [action, note||'', req.params.id]);

      if (action === 'approved') {
        const table = getTable(tr.task_type);
        await db.query(`UPDATE ${table} SET assigned_to=? WHERE id=?`, [tr.to_user, tr.task_id]);
      }
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // GET — My sent transfer requests (for users to track)
  app.get('/api/transfers/my', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT tt.*, uf.name AS "fromUserName", ut.name AS "toUserName"
        FROM task_transfers tt
        JOIN users uf ON tt.from_user = uf.id
        JOIN users ut ON tt.to_user = ut.id
        WHERE tt.requested_by=?
        ORDER BY tt.created_at DESC LIMIT 20`, [req.session.userId]);
      for (const r of rows) {
        const table = getTable(r.task_type);
        const [t] = await db.query(`SELECT description FROM ${table} WHERE id=?`, [r.task_id]);
        r.description = t[0]?.description || '—';
      }
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
