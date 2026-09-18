// ══════════════════════════════════════════════════════
// CLAIMS — tyre warranty claim management (port from Google Apps Script)
// ══════════════════════════════════════════════════════
// server.js jaisे hi routes ke beech register hote hain (approvals.js/transfers.js
// jaisa pattern) — RPC wrapper nahi, plain Express req/res.

const claims = require('../lib/claims');
const { readXlsx, parseCellDate } = require('../lib/xlsx');

module.exports = function registerClaimsRoutes(app, ctx) {
  const { db, requireAuth, requirePerm, handleServerError } = ctx;
  const gate = requirePerm('claims.manage');

  // ── Claim Entry ──
  app.post('/api/claims', requireAuth, gate, async (req, res) => {
    try {
      const { entryType, claimNo, dealerName, material, stencilNo, mouldNo } = req.body;
      const status = claims.ENTRY_INITIAL_STATUS[entryType];
      if (!status) return res.status(400).json({ error: 'Invalid entry type' });
      if (!dealerName) return res.status(400).json({ error: 'Dealer name chahiye' });
      let finalClaimNo = null;
      if (entryType === 'NEW_CLAIM' || entryType === 'RETURN_DEALER') {
        if (!claimNo) return res.status(400).json({ error: 'Claim No chahiye' });
        finalClaimNo = entryType === 'NEW_CLAIM' ? claims.formatClaimNo(claimNo) : String(claimNo).trim();
        const [[dup]] = await db.query('SELECT id FROM claims WHERE claim_no=?', [finalClaimNo]);
        if (dup) return res.status(400).json({ error: 'Ye Claim No. pehle se maujood hai! Dobara online na karein.' });
      }
      const [ins] = await db.query(
        `INSERT INTO claims (claim_no, entry_type, dealer_name, material, stencil_no, mould_no, status)
         VALUES (?,?,?,?,?,?,?)`,
        [finalClaimNo, entryType, dealerName, material || '', stencilNo || '', mouldNo || '', status]);
      await db.query('INSERT INTO claim_status_log (claim_id, from_status, to_status, note, changed_by) VALUES (?,?,?,?,?)',
        [ins.insertId, '', status, 'Claim Entry', req.session.userId]);
      res.json({ success: true, id: ins.insertId, claimNo: finalClaimNo, status });
    } catch (err) { handleServerError(res, err); }
  });

  // Auto-Find (claim_master_ref) — Claim Entry ka autoFind()
  app.get('/api/claims/master-ref', requireAuth, gate, async (req, res) => {
    try {
      const claimNo = claims.formatClaimNo(req.query.claimNo || '');
      const [[row]] = await db.query('SELECT dealer_name, material, stencil_no, mould_no FROM claim_master_ref WHERE claim_no=?', [claimNo]);
      if (!row) return res.json(null);
      res.json({ dealerName: row.dealer_name, material: row.material, stencilNo: row.stencil_no, mouldNo: row.mould_no });
    } catch (err) { handleServerError(res, err); }
  });

  // Admin: master reference .xlsx upload — poora table replace, jaise Scheme Catalog
  app.post('/api/claims/master-ref/upload', requireAuth, gate, async (req, res) => {
    try {
      const { b64 } = req.body;
      if (!b64) return res.status(400).json({ error: 'File chuno' });
      const buf = Buffer.from(b64, 'base64');
      const sheets = readXlsx(buf);
      const rows = ((sheets.find(s => s.rows.length > 1) || sheets[0]) || { rows: [] }).rows;
      const headerIdx = rows.findIndex(r => r && r.some(v => /claim\s*no/i.test(String(v || ''))));
      if (headerIdx < 0) return res.status(400).json({ error: 'File me "Claim No" column nahi mila' });
      const headers = rows[headerIdx].map(h => String(h || '').trim().toLowerCase());
      const idx = name => headers.findIndex(h => h.includes(name));
      const cClaim = idx('claim'), cDealer = idx('dealer'), cMaterial = idx('material'), cStencil = idx('stenc'), cMould = idx('mould');
      const parsed = [];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || cClaim < 0 || !row[cClaim]) continue;
        parsed.push([String(row[cClaim]).trim(), cDealer >= 0 ? (row[cDealer] || '') : '', cMaterial >= 0 ? (row[cMaterial] || '') : '', cStencil >= 0 ? (row[cStencil] || '') : '', cMould >= 0 ? (row[cMould] || '') : '']);
      }
      if (!parsed.length) return res.status(400).json({ error: 'Koi row nahi mili' });
      await db.query('DELETE FROM claim_master_ref');
      const CH = 500;
      for (let i = 0; i < parsed.length; i += CH) {
        await db.query('INSERT INTO claim_master_ref (claim_no, dealer_name, material, stencil_no, mould_no) VALUES ?', [parsed.slice(i, i + CH)]);
      }
      res.json({ success: true, count: parsed.length });
    } catch (err) { handleServerError(res, err); }
  });

  // ── Dashboard ──
  // Ek hi jagah se catalog (cards/transitions/labels/colors) — frontend duplicate
  // nahi rakhta, jaise permissions.js ka catalog /api/permissions/catalog se aata hai.
  app.get('/api/claims/meta', requireAuth, gate, (req, res) => {
    res.json({
      statusCards: claims.STATUS_CARDS, transitions: claims.STATUS_TRANSITIONS,
      labels: claims.STATUS_LABELS, colors: claims.STATUS_COLOR,
      remarkStatuses: claims.REMARK_STATUSES, readonlyStatuses: claims.READONLY_STATUSES,
    });
  });

  app.get('/api/claims/counts', requireAuth, gate, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT status, COUNT(*) AS n FROM claims GROUP BY status');
      const byStatus = {}; rows.forEach(r => { byStatus[r.status] = r.n; });
      const cards = claims.STATUS_CARDS.map(c => ({ key: c.key, label: c.label, count: byStatus[c.key] || 0 }));
      res.json({ cards, total: rows.reduce((a, r) => a + r.n, 0) });
    } catch (err) { handleServerError(res, err); }
  });

  app.get('/api/claims', requireAuth, gate, async (req, res) => {
    try {
      const { status, dealer, q, pendingReceiving } = req.query;
      const where = [], params = [];
      if (status) { where.push('status=?'); params.push(status); }
      if (dealer) { where.push('dealer_name=?'); params.push(dealer); }
      if (q) { where.push('claim_no LIKE ?'); params.push(`%${q}%`); }
      if (pendingReceiving === '1') where.push('received_at IS NULL');
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const [rows] = await db.query(`SELECT * FROM claims ${whereSql} ORDER BY id DESC`, params);
      res.json(rows);
    } catch (err) { handleServerError(res, err); }
  });

  app.get('/api/claims/find', requireAuth, gate, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.json(null);
      const [[row]] = await db.query('SELECT * FROM claims WHERE claim_no=? OR claim_no LIKE ? ORDER BY id DESC LIMIT 1', [q, `%${q}%`]);
      res.json(row || null);
    } catch (err) { handleServerError(res, err); }
  });

  app.put('/api/claims/:id/status', requireAuth, gate, async (req, res) => {
    try {
      const finalStatus = await claims.applyStatusChange(db, req.params.id, req.body.newStatus, req.session.userId, req.body.note);
      res.json({ success: true, status: finalStatus });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/claims/bulk-status', requireAuth, gate, async (req, res) => {
    try {
      const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
      if (!ids.length) return res.status(400).json({ error: 'Pehle records select karo' });
      let ok = 0;
      for (const id of ids) {
        try { await claims.applyStatusChange(db, id, req.body.newStatus, req.session.userId, req.body.note); ok++; } catch (_) {}
      }
      res.json({ success: true, count: ok });
    } catch (err) { handleServerError(res, err); }
  });

  // Without Online / No Data Tyre remark
  app.put('/api/claims/:id/remark', requireAuth, gate, async (req, res) => {
    try {
      await db.query('UPDATE claims SET remark=? WHERE id=?', [String(req.body.remark || '').slice(0, 2000), req.params.id]);
      res.json({ success: true });
    } catch (err) { handleServerError(res, err); }
  });

  // Claim Receiving Upload
  app.put('/api/claims/:id/receiving', requireAuth, gate, async (req, res) => {
    try {
      await db.query('UPDATE claims SET receiving=?, received_at=NOW() WHERE id=?', [String(req.body.receiving || '').slice(0, 2000), req.params.id]);
      res.json({ success: true });
    } catch (err) { handleServerError(res, err); }
  });

  // ── Dealers ──
  app.get('/api/claims/dealers', requireAuth, gate, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT id, name FROM claim_dealers ORDER BY name');
      res.json(rows);
    } catch (err) { handleServerError(res, err); }
  });
  app.post('/api/claims/dealers', requireAuth, gate, async (req, res) => {
    try {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Dealer naam chahiye' });
      await db.query('INSERT IGNORE INTO claim_dealers (name) VALUES (?)', [name]);
      res.json({ success: true });
    } catch (err) { handleServerError(res, err); }
  });

  // ── ACK Tracking ──
  app.get('/api/claims/ack/dealers', requireAuth, gate, async (req, res) => {
    try {
      const [rows] = await db.query('SELECT DISTINCT dealer_name FROM claim_ack WHERE dealer_name<>\'\' ORDER BY dealer_name');
      res.json(rows.map(r => r.dealer_name));
    } catch (err) { handleServerError(res, err); }
  });
  app.get('/api/claims/ack', requireAuth, gate, async (req, res) => {
    try {
      const { dealer, from, to } = req.query;
      const where = [], params = [];
      if (dealer) { where.push('dealer_name=?'); params.push(dealer); }
      if (from) { where.push('claim_date>=?'); params.push(from); }
      if (to) { where.push('claim_date<=?'); params.push(to); }
      const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const [rows] = await db.query(`SELECT claim_no, dealer_name, item_desc, stencil_no, DATE_FORMAT(claim_date,'%d/%m/%Y') AS claim_date, status FROM claim_ack ${whereSql} ORDER BY claim_date DESC, id DESC`, params);
      res.json(rows);
    } catch (err) { handleServerError(res, err); }
  });
  app.post('/api/claims/ack/upload', requireAuth, gate, async (req, res) => {
    try {
      const { b64 } = req.body;
      if (!b64) return res.status(400).json({ error: 'File chuno' });
      const buf = Buffer.from(b64, 'base64');
      const sheets = readXlsx(buf);
      const rows = ((sheets.find(s => s.rows.length > 1) || sheets[0]) || { rows: [] }).rows;
      const headerIdx = rows.findIndex(r => r && r.some(v => /claim\s*number|claim\s*no/i.test(String(v || ''))));
      if (headerIdx < 0) return res.status(400).json({ error: 'File me "Claim Number" column nahi mila' });
      const headers = rows[headerIdx].map(h => String(h || '').trim().toLowerCase());
      const idx = name => headers.findIndex(h => h.includes(name));
      const cClaim = idx('claim'), cDealer = idx('dealer'), cItem = idx('item'), cStencil = idx('stenc'), cDate = idx('date'), cStatus = idx('status');
      const parsed = [];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r]; if (!row || cClaim < 0 || !row[cClaim]) continue;
        let claimDate = null;
        if (cDate >= 0 && row[cDate]) {
          const d = parseCellDate(row[cDate]);
          if (d && !isNaN(d.getTime())) claimDate = d.toISOString().slice(0, 10);
        }
        parsed.push([String(row[cClaim]).trim(), cDealer >= 0 ? (row[cDealer] || '') : '', cItem >= 0 ? (row[cItem] || '') : '', cStencil >= 0 ? (row[cStencil] || '') : '', claimDate, cStatus >= 0 ? (row[cStatus] || '') : '']);
      }
      if (!parsed.length) return res.status(400).json({ error: 'Koi row nahi mili' });
      await db.query('DELETE FROM claim_ack');
      const CH = 500;
      for (let i = 0; i < parsed.length; i += CH) {
        await db.query('INSERT INTO claim_ack (claim_no, dealer_name, item_desc, stencil_no, claim_date, status) VALUES ?', [parsed.slice(i, i + CH)]);
      }
      res.json({ success: true, count: parsed.length });
    } catch (err) { handleServerError(res, err); }
  });
};
