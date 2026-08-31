// ══════════════════════════════════════════════════════
// DEPARTMENTS
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerDepartmentsRoutes(app, ctx) {
  const { db, requireAuth, requireAdmin } = ctx;

  app.get('/api/departments', requireAuth, async (req, res) => {
    try {
      const [saved] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['departments']);
      const savedList = saved[0] ? JSON.parse(saved[0].value) : [];
      const [used] = await db.query("SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department<>''");
      const all = new Set([...savedList, ...used.map(u => u.department)]);
      res.json([...all].sort((a,b) => a.localeCompare(b)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

  app.post('/api/departments', requireAuth, requireAdmin, async (req, res) => {
    try {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Department name required' });
      const [saved] = await db.query('SELECT value FROM app_settings WHERE key_name=?', ['departments']);
      const list = saved[0] ? JSON.parse(saved[0].value) : [];
      if (!list.some(d => d.toLowerCase() === name.toLowerCase())) list.push(name);
      // ON CONFLICT me nayi value EXCLUDED se aati hai, isliye MySQL wala teesra
      // parameter ab nahi chahiye — chhodne par Postgres "3 parameters supplied,
      // 2 required" kehkar fail karta.
      await db.query('INSERT INTO app_settings (key_name,value) VALUES (?,?) ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value',
        ['departments', JSON.stringify(list)]);
      res.json(list.sort((a,b) => a.localeCompare(b)));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
  });

};
