// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

const bcrypt = require('bcryptjs');

module.exports = function registerProfileRoutes(app, ctx) {
  const { db, requireAuth } = ctx;

  app.put('/api/profile', requireAuth, async (req, res) => {
    try {
      const uid = req.session.userId;
      const { name, email, notification_email, phone, currentPassword, newPassword, profileImage } = req.body;
      if (currentPassword) {
        const [rows] = await db.query('SELECT password FROM users WHERE id=?', [uid]);
        if (!bcrypt.compareSync(currentPassword, rows[0].password)) return res.status(400).json({ error: 'Current password is incorrect' });
        if (newPassword) await db.query('UPDATE users SET name=?,email=?,notification_email=?,phone=?,password=? WHERE id=?', [name,email,notification_email||'',phone||null,bcrypt.hashSync(newPassword,10),uid]);
        else await db.query('UPDATE users SET name=?,email=?,notification_email=?,phone=? WHERE id=?', [name,email,notification_email||'',phone||null,uid]);
      } else {
        await db.query('UPDATE users SET name=?,email=?,notification_email=?,phone=? WHERE id=?', [name,email,notification_email||'',phone||null,uid]);
      }
      if (profileImage !== undefined) await db.query('UPDATE users SET profile_image=? WHERE id=?', [profileImage||null, uid]);
      req.session.name = name;
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/profile/image', requireAuth, async (req, res) => {
    try {
      await db.query('UPDATE users SET profile_image=? WHERE id=?', [req.body.image||null, req.session.userId]);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
