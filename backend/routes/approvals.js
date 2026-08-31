// ══════════════════════════════════════════════════════
// APPROVALS
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerApprovalsRoutes(app, ctx) {
  const { db, requireAuth, getTable } = ctx;

  app.get('/api/approvals', requireAuth, async (req, res) => {
    try {
      const role = req.session.role;
      const isAdminOrPC = role === 'admin' || role === 'pc';
      // Admin/PC sees all pending approvals; others see only theirs
      const whereClause = isAdminOrPC
        ? `WHERE ta.status='pending'`
        : `WHERE ta.requested_to=? AND ta.status='pending'`;
      const params = isAdminOrPC ? [] : [req.session.userId];
      const [rows] = await db.query(`SELECT ta.*,u1.name AS "requestedByName",u2.name AS "requestedToName",dt.description,dt.approval AS "taskApproval" FROM task_approvals ta JOIN users u1 ON ta.requested_by=u1.id JOIN users u2 ON ta.requested_to=u2.id LEFT JOIN delegation_tasks dt ON ta.task_id=dt.id AND ta.task_type='delegation' ${whereClause} ORDER BY ta.created_at DESC`, params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.get('/api/approvals/count', requireAuth, async (req, res) => {
    try {
      const role = req.session.role;
      const isAdminOrPC = role === 'admin' || role === 'pc';
      const [rows] = isAdminOrPC
        ? await db.query(`SELECT COUNT(*) AS count FROM task_approvals WHERE status='pending'`)
        : await db.query(`SELECT COUNT(*) AS count FROM task_approvals WHERE requested_to=? AND status='pending'`, [req.session.userId]);
      res.json({ count: rows[0].count });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/approvals/:id', requireAuth, async (req, res) => {
    try {
      const { action, note } = req.body;
      const role = req.session.role;
      const [rows] = await db.query('SELECT * FROM task_approvals WHERE id=?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Approval not found' });
      const appr = rows[0];
      // PC and admin can approve any; others only their own
      const canApprove = role === 'admin' || role === 'pc' || appr.requested_to === req.session.userId;
      if (!canApprove) return res.status(403).json({ error: 'Not allowed' });
      await db.query('UPDATE task_approvals SET status=?,note=? WHERE id=?', [action, note||'', req.params.id]);
      const table = getTable(appr.task_type);
      if (action === 'approved') await db.query(`UPDATE ${table} SET status=?,waiting_approval=0,completed_at=CASE WHEN ?='completed' THEN NOW() ELSE NULL END WHERE id=?`, [appr.action_type, appr.action_type, appr.task_id]);
      else await db.query(`UPDATE ${table} SET waiting_approval=0 WHERE id=?`, [appr.task_id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
