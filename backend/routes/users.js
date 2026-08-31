// ══════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

const bcrypt = require('bcryptjs');

module.exports = function registerUsersRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin, segmentFilter, authCacheDrop } = ctx;

  app.get('/api/users', requireAuth, async (req, res) => {
    try {
      const seg = segmentFilter(req, '');
      const params = seg.param ? [seg.param] : [];
      const [rows] = await db.query(
        `SELECT id,name,email,notification_email,role,view_only,phone,department,week_off,extra_off,staff_type FROM users WHERE 1=1${seg.clause} ORDER BY role DESC,name ASC`, params);
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, email, notification_email, password, role, view_only, phone, department, week_off, extra_off, staff_type } = req.body;
      if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
      const staffType = staff_type === 'factory' ? 'factory' : 'office';
      const viewOnly = (view_only === 1 || view_only === true || view_only === '1') ? 1 : 0;
      // Duplicate check bhi case-insensitive, warna a@x.com aur A@x.com dono ban
      // jaate hain aur login me se ek hi milta hai.
      const [ex] = await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER(?)', [email]);
      if (ex[0]) return res.status(400).json({ error: 'Email already exists' });
      await db.query('INSERT INTO users (name,email,notification_email,password,role,view_only,phone,department,week_off,extra_off,staff_type) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [name, email, notification_email||'', bcrypt.hashSync(password,10), role||'user', viewOnly, phone||null, department||'', week_off||'', extra_off||'', staffType]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, email, notification_email, role, view_only, password, phone, department, week_off, extra_off, staff_type } = req.body;
      const staffType = staff_type === 'factory' ? 'factory' : 'office';
      const viewOnly = (view_only === 1 || view_only === true || view_only === '1') ? 1 : 0;
      // Khud ko view-only banane par admin phir se kuch badal nahi paayega —
      // apni hi setting hatana bhi ek write hai. Isliye self par rok.
      if (viewOnly && String(req.params.id) === String(req.session.userId)) {
        return res.status(400).json({ error: 'You cannot set yourself to view-only — you would not be able to change it back.' });
      }
      if (password) await db.query('UPDATE users SET name=?,email=?,notification_email=?,role=?,view_only=?,password=?,phone=?,department=?,week_off=?,extra_off=?,staff_type=?,session_version=session_version+1 WHERE id=?',
        [name,email,notification_email||'',role,viewOnly,bcrypt.hashSync(password,10),phone||null,department||'',week_off||'',extra_off||'',staffType,req.params.id]);
      else await db.query('UPDATE users SET name=?,email=?,notification_email=?,role=?,view_only=?,phone=?,department=?,week_off=?,extra_off=?,staff_type=? WHERE id=?',
        [name,email,notification_email||'',role,viewOnly,phone||null,department||'',week_off||'',extra_off||'',staffType,req.params.id]);
      // requireAuth session_version aur view_only ko kuch second cache karta hai.
      // Yahin dono badal sakte hain, isliye cache turant saaf — warna
      // force-logout ya view-only lagne me der lagti.
      authCacheDrop(req.params.id);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.put('/api/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
      await db.query('UPDATE users SET password=?,session_version=session_version+1 WHERE id=?',
        [bcrypt.hashSync(password,10), req.params.id]);
      authCacheDrop(req.params.id);   // purane token turant band ho jayein
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
      await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  // Bulk add users via CSV
  app.post('/api/users/bulk', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { users } = req.body;
      if (!users || !users.length) return res.status(400).json({ error: 'No users provided' });
      let added = 0, skipped = 0, errors = [];
      for (const u of users) {
        if (!u.name || !u.email || !u.password) { errors.push(`${u.email||'?'}: missing fields`); continue; }
        const [ex] = await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER(?)', [u.email]);
        if (ex[0]) { skipped++; continue; }
        await db.query('INSERT INTO users (name,email,password,role,phone,department,week_off,extra_off) VALUES (?,?,?,?,?,?,?,?)',
          [u.name, u.email, bcrypt.hashSync(u.password,10), u.role||'user', u.phone||null, u.department||'', u.week_off||'', u.extra_off||'']);
        added++;
      }
      res.json({ success: true, added, skipped, errors });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
