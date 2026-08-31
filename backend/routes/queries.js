// ══════════════════════════════════════════════════════
// QUERY MODULE — user query, HR/Admin answer/reject
// ══════════════════════════════════════════════════════
// ROUTE ORDER: `/api/queries/:id/answer` aur `/api/queries/:id/reject` ko
// `/api/queries/:id` se PEHLE register karna zaroori hai. Ulta hua to `:id`
// wala PUT dono ko nigal lega aur answer/reject chup-chaap "edit" ban jayenge.
// Neeche ka kram jaan-boojh kar wahi hai jo server.js me tha — badalna mat.

module.exports = function registerQueryRoutes(app, ctx) {
  const { db, requireAuth, isHRUser } = ctx;

  // Answer/reject kaun kar sakta hai: Admin (role) ya HR (department = "HR").
  const canAnswerQueries = async (req) =>
    req.session.role === 'admin' || await isHRUser(req.session.userId);

  // Nayi query — koi bhi logged-in user daal sakta hai
  app.post('/api/queries', requireAuth, async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Query message required' });
      if (message.length > 5000) return res.status(400).json({ error: 'Query too long (max 5000 chars)' });
      const [r] = await db.query(
        'INSERT INTO queries (user_id, message, status) VALUES (?, ?, ?)',
        [req.session.userId, message, 'open']);
      res.json({ success: true, id: r.insertId });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // List — Admin/HR sabki, baaki user sirf apni. Date/time IST 12-hour me.
  app.get('/api/queries', requireAuth, async (req, res) => {
    try {
      const canAnswer = await canAnswerQueries(req);
      const where = canAnswer ? '' : 'WHERE q.user_id=?';
      const params = canAnswer ? [] : [req.session.userId];
      const [rows] = await db.query(
        `SELECT q.id, q.user_id, u.name AS "userName", u.department, u.staff_type,
                q.message, q.answer, q.status, q.answered_by, a.name AS "answererName",
                TO_CHAR(q.created_at,'YYYY-MM-DD HH12:MI AM') AS created_at,
                TO_CHAR(q.answered_at,'YYYY-MM-DD HH12:MI AM') AS answered_at
         FROM queries q
         JOIN users u ON u.id = q.user_id
         LEFT JOIN users a ON a.id = q.answered_by
         ${where}
         ORDER BY (q.status='open') DESC, q.created_at DESC`, params);
      res.json({ canAnswer, queries: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Answer — sirf Admin/HR
  app.put('/api/queries/:id/answer', requireAuth, async (req, res) => {
    try {
      if (!await canAnswerQueries(req)) return res.status(403).json({ error: 'Only HR or Admin can answer' });
      const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
      if (!answer) return res.status(400).json({ error: 'Answer required' });
      const [r] = await db.query(
        "UPDATE queries SET answer=?, status='answered', answered_by=?, answered_at=NOW() WHERE id=?",
        [answer, req.session.userId, req.params.id]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Query not found' });
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Reject — sirf Admin/HR; optional reason answer field me store hota hai
  app.put('/api/queries/:id/reject', requireAuth, async (req, res) => {
    try {
      if (!await canAnswerQueries(req)) return res.status(403).json({ error: 'Only HR or Admin can reject' });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const [r] = await db.query(
        "UPDATE queries SET answer=?, status='rejected', answered_by=?, answered_at=NOW() WHERE id=?",
        [reason || null, req.session.userId, req.params.id]);
      if (!r.affectedRows) return res.status(404).json({ error: 'Query not found' });
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Edit — sirf jisne query daali (owner), aur tabhi jab query abhi 'open' ho.
  // Answered/rejected query edit nahi hoti.
  app.put('/api/queries/:id', requireAuth, async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message) return res.status(400).json({ error: 'Query message required' });
      if (message.length > 5000) return res.status(400).json({ error: 'Query too long (max 5000 chars)' });
      const [rows] = await db.query('SELECT user_id, status FROM queries WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Query not found' });
      if (rows[0].user_id !== req.session.userId) return res.status(403).json({ error: 'You can only edit your own query' });
      if (rows[0].status !== 'open') return res.status(403).json({ error: 'Answered or rejected queries cannot be edited' });
      await db.query('UPDATE queries SET message=? WHERE id=?', [message, req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Delete — Admin/HR koi bhi query hata sakte hain; user sirf apni aur tabhi jab open ho
  app.delete('/api/queries/:id', requireAuth, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT user_id, status FROM queries WHERE id=?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Query not found' });
      const canAnswer = await canAnswerQueries(req);
      const isOwner = rows[0].user_id === req.session.userId;
      if (!canAnswer && !isOwner) return res.status(403).json({ error: 'You can only delete your own query' });
      // User apni query tabhi delete kar sakta hai jab wo open ho; Admin/HR kabhi bhi
      if (!canAnswer && rows[0].status !== 'open') return res.status(403).json({ error: 'Answered or rejected queries cannot be deleted' });
      await db.query('DELETE FROM queries WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });
};
