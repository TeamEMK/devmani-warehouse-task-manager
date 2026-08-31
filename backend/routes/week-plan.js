// ══════════════════════════════════════════════════════
// WEEK PLAN
// ══════════════════════════════════════════════════════
// server.js se nikaale gaye — wahan ye routes ke beech dabe hue the.
// Registration usi jagah se hota hai jahan pehle likhe the, taaki Express me
// kram na badle (wildcard :id routes ka kram maayne rakhta hai).

module.exports = function registerWeekPlanRoutes(app, ctx) {
  const { db, requireAuth, requireAdminOrHod } = ctx;

  app.post('/api/week-plan', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { employeeId, startDate, targetCount, hodId, improvementPct } = req.body;
      if (!employeeId || !startDate) {
        return res.json({ error: 'employeeId and startDate required' });
      }
      const impPct = (improvementPct !== undefined && improvementPct !== null && improvementPct !== '') ? parseInt(improvementPct) : null;
      const tCount = (targetCount !== undefined && targetCount !== null && targetCount !== '') ? parseInt(targetCount) : 0;
      const finalHodId = hodId || req.session.userId;
      // Upsert: insert ya update if same employee+startDate exists.
      // IMPORTANT: created_at sirf insert pe set hota hai (DEFAULT CURRENT_TIMESTAMP); update pe preserve rehta hai.
      // updated_at auto-update hota hai schema ki vajah se (ON UPDATE CURRENT_TIMESTAMP).
      const [wpRows] = await db.execute(
        `INSERT INTO week_plans (employee_id, hod_id, start_date, target_count, improvement_pct)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (employee_id, start_date) DO UPDATE SET
           target_count = EXCLUDED.target_count,
           hod_id = EXCLUDED.hod_id,
           improvement_pct = EXCLUDED.improvement_pct
         RETURNING (xmax = 0) AS inserted`,
        [employeeId, finalHodId, startDate, tCount, impPct]
      );
      // MySQL me affectedRows batata tha (1 = insert, 2 = update). Postgres dono
      // par 1 deta hai, isliye xmax: naye row par wo 0 hota hai, update kiye gaye
      // row par nahi.
      const action = (wpRows[0] && wpRows[0].inserted) ? 'INSERTED' : 'UPDATED';
      console.log(`  📅 Week Plan ${action}: employee=${employeeId}, week=${startDate}, improvement_pct=${impPct}, by_hod=${finalHodId}`);
      res.json({ success: true, action: action.toLowerCase() });
    } catch (e) {
      // Safety net: table hi nahi hai. Postgres SQLSTATE 42P01 = undefined_table
      // (MySQL ka ER_NO_SUCH_TABLE).
      if (e.code === '42P01') {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS week_plans (
            id serial PRIMARY KEY,
            employee_id int NOT NULL,
            hod_id int NOT NULL,
            start_date date NOT NULL,
            target_count int DEFAULT 0,
            improvement_pct int DEFAULT NULL,
            created_at timestamp DEFAULT NOW(),
            updated_at timestamp DEFAULT NOW(),
            CONSTRAINT week_plans_emp_week_uq UNIQUE (employee_id, start_date)
          )
        `);
        await db.execute(`CREATE INDEX IF NOT EXISTS week_plans_idx_start_date ON week_plans (start_date)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS week_plans_idx_employee ON week_plans (employee_id)`);
        const { employeeId, startDate, targetCount, hodId, improvementPct } = req.body;
        const impPct = (improvementPct !== undefined && improvementPct !== null && improvementPct !== '') ? parseInt(improvementPct) : null;
        const tCount = (targetCount !== undefined && targetCount !== null && targetCount !== '') ? parseInt(targetCount) : 0;
        await db.execute(
          `INSERT INTO week_plans (employee_id, hod_id, start_date, target_count, improvement_pct)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (employee_id, start_date) DO UPDATE SET
             target_count = EXCLUDED.target_count,
             hod_id = EXCLUDED.hod_id,
             improvement_pct = EXCLUDED.improvement_pct`,
          [employeeId, hodId || req.session.userId, startDate, tCount, impPct]
        );
        console.log(`  📅 Week Plan saved (after table create): employee=${employeeId}, week=${startDate}`);
        return res.json({ success: true });
      }
      // Column missing (purana table). Postgres SQLSTATE 42703 = undefined_column
      // (MySQL ka ER_BAD_FIELD_ERROR).
      if (e.code === '42703') {
        try {
          await db.execute(`ALTER TABLE week_plans ADD COLUMN IF NOT EXISTS improvement_pct int DEFAULT NULL`);
        } catch(ae) { /* already exists */ }
        try {
          await db.execute(`ALTER TABLE week_plans ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW()`);
        } catch(ae) { /* already exists */ }
        const { employeeId, startDate, targetCount, hodId, improvementPct } = req.body;
        const impPct = (improvementPct !== undefined && improvementPct !== null && improvementPct !== '') ? parseInt(improvementPct) : null;
        const tCount = (targetCount !== undefined && targetCount !== null && targetCount !== '') ? parseInt(targetCount) : 0;
        await db.execute(
          `INSERT INTO week_plans (employee_id, hod_id, start_date, target_count, improvement_pct)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (employee_id, start_date) DO UPDATE SET
             target_count = EXCLUDED.target_count,
             hod_id = EXCLUDED.hod_id,
             improvement_pct = EXCLUDED.improvement_pct`,
          [employeeId, hodId || req.session.userId, startDate, tCount, impPct]
        );
        console.log(`  📅 Week Plan saved (after column add): employee=${employeeId}, week=${startDate}`);
        return res.json({ success: true });
      }
      console.error('  ❌ Week Plan save failed:', e);
      res.json({ error: 'Failed to save plan' });
    }
  });

  // GET week-plan list — supports filters for Reports tab (next update)
  // Query params (all optional):
  //   ?employeeId=123      → specific employee ka history
  //   ?from=YYYY-MM-DD     → start_date >= from
  //   ?to=YYYY-MM-DD       → start_date <= to
  //   ?limit=N             → default 500 (Reports tab ke liye sufficient; pagination future)
  app.get('/api/week-plan', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const { employeeId, from, to } = req.query;
      const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
      const where = [];
      const params = [];
      if (employeeId) { where.push('wp.employee_id = ?'); params.push(parseInt(employeeId)); }
      if (from) { where.push('wp.start_date >= ?'); params.push(from); }
      if (to)   { where.push('wp.start_date <= ?'); params.push(to); }
      // HOD ko apne dept ke users hi dikhne chahiye (admin sab dekh sakta hai)
      // JWT me department nahi hai, isliye fresh DB se fetch karna padta hai
      if (req.session.role === 'hod') {
        const [me] = await db.query('SELECT department FROM users WHERE id=?', [req.session.userId]);
        where.push('u.department = ?');
        params.push((me[0] && me[0].department) || '');
      }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const [rows] = await db.execute(
        `SELECT wp.id, wp.employee_id, wp.hod_id, 
                TO_CHAR(wp.start_date,'YYYY-MM-DD') AS start_date,
                wp.target_count, wp.improvement_pct,
                wp.created_at, wp.updated_at,
                u.name AS employee_name, u.department AS employee_department,
                h.name AS hod_name
         FROM week_plans wp
         JOIN users u ON u.id = wp.employee_id
         LEFT JOIN users h ON h.id = wp.hod_id
         ${whereSql}
         ORDER BY wp.start_date DESC, wp.employee_id ASC
         LIMIT ${limit}`,
        params
      );
      res.json(rows);
    } catch (e) {
      console.error('  ❌ Week Plan fetch failed:', e.message);
      res.json([]);
    }
  });

  // GET history endpoint — Reports tab ke liye dedicated:
  //   /api/week-plan/history/:employeeId
  // Returns sare weeks (newest first) for a single employee, with HOD name aur timestamps.
  app.get('/api/week-plan/history/:employeeId', requireAuth, requireAdminOrHod, async (req, res) => {
    try {
      const empId = parseInt(req.params.employeeId);
      if (!empId) return res.json({ error: 'Invalid employeeId' });
      // HOD sirf apne dept ke user ka history dekh sake
      if (req.session.role === 'hod') {
        const [me]  = await db.query('SELECT department FROM users WHERE id=?', [req.session.userId]);
        const [chk] = await db.execute('SELECT department FROM users WHERE id=?', [empId]);
        const myDept = (me[0] && me[0].department) || '';
        if (!chk.length || chk[0].department !== myDept) {
          return res.status(403).json({ error: 'Not allowed' });
        }
      }
      const [rows] = await db.execute(
        `SELECT wp.id,
                TO_CHAR(wp.start_date,'YYYY-MM-DD') AS start_date,
                wp.target_count, wp.improvement_pct,
                wp.created_at, wp.updated_at,
                h.name AS hod_name
         FROM week_plans wp
         LEFT JOIN users h ON h.id = wp.hod_id
         WHERE wp.employee_id = ?
         ORDER BY wp.start_date DESC`,
        [empId]
      );
      const [emp] = await db.execute('SELECT id, name, department FROM users WHERE id=?', [empId]);
      res.json({
        employee: emp[0] || null,
        plans: rows,
        total: rows.length
      });
    } catch (e) {
      console.error('  ❌ Week Plan history fetch failed:', e.message);
      res.json({ error: 'Failed to fetch history', plans: [] });
    }
  });

};
