// ══════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerCommentsRoutes(app, ctx) {
  const { db, requireAuth } = ctx;

  app.get('/api/comments/:type/:taskId', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query(`SELECT tc.id,tc.comment,tc.created_at,u.name AS "userName" FROM task_comments tc JOIN users u ON tc.user_id=u.id WHERE tc.task_id=? AND tc.task_type=? ORDER BY tc.created_at ASC`, [req.params.taskId, req.params.type]);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/comments', requireAuth, async (req, res) => {
    try {
      const { taskId, taskType, comment } = req.body;
      if (!comment || !taskId || !taskType) return res.status(400).json({ error: 'All fields required' });
      await db.query('INSERT INTO task_comments (task_id,task_type,user_id,comment) VALUES (?,?,?,?)', [taskId, taskType, req.session.userId, comment]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.delete('/api/comments/:id', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT * FROM task_comments WHERE id=?', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      if (rows[0].user_id !== req.session.userId && req.session.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
      await db.query('DELETE FROM task_comments WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
