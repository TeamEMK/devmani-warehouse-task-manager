const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// ══════════════════════════════════════════════════════
// BRANDING
// Client ka naam, logo aur rang — sab lib/brand.js se (wahi single source).
const BRAND = require('./lib/brand');
// IST ka hisaab — server kis timezone me hai isse farak nahi padta.
const { istParts: _istParts, fmtDMY: _fmtDMY, lastWeekMonSat } = require('./lib/dates');
// WhatsApp (Waumfy): number normalize, bhejna, aur message ka text. "Kis-ko-
// bhejna hai" wali passes DB ko chhuti hain, isliye wo neeche hi rehti hain.
const {
  WA_ENABLED, sleep: _sleep, normalizeWhatsAppPhone,
  sendWhatsApp, sendWhatsAppDocument, sendWhatsAppImage,
  buildPendingWhatsAppMessage, buildLeaveDecisionMessage,
} = require('./lib/whatsapp');

// Last-resort safety nets — log full detail server-side, never crash the whole
// process (and never expose internals) because of one bad async error.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const JWT_SECRET = process.env.SESSION_SECRET || 'change-me';

// ══════════════════════════════════════════════════════
// SERVERLESS (VERCEL) DETECTION
// ══════════════════════════════════════════════════════
// Vercel par har request ek alag, short-lived function invocation hai. Wahan
// setInterval bemaani hai: response bhejte hi process freeze/khatam ho jaata
// hai, timer kabhi fire nahi karta. Isliye serverless par background schedulers
// start hi nahi karte — unka kaam /api/cron/* endpoints karte hain jinhe Vercel
// Cron time par HTTP se bulata hai (vercel.json me schedule likha hai).
// Kaam karne wale functions wahi ke wahi hain, sirf trigger badla hai.
const IS_SERVERLESS = !!process.env.VERCEL;

// Postgres (Railway). db.js mysql2 jaisi hi shakl deta hai — [rows] / insertId /
// getConnection — isliye neeche ke 247 call sites waise ke waise chalte hain.
// Connection ka timezone IST wahin set hota hai.
const db = require('../data/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Proof-of-work photos base64 me aati hain — default 100kb limit kam padta hai
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ══════════════════════════════════════════════════════
// ROUTE MODULES KA SHARED CONTEXT
// ══════════════════════════════════════════════════════
// routes/*.js ko jo bhi chahiye, wo yahin se milta hai — taaki har module ko
// server.js ke andar ki cheezein alag-alag import na karni padein.
//
// YE OBJECT SAARE ROUTES SE UPAR HONA CHAHIYE. `const` hoist nahi hota, isliye
// isse pehle koi `require('./routes/x')(app, ROUTE_CTX)` likhne par boot par
// "Cannot access 'ROUTE_CTX' before initialization" phatega — aur uncaught
// exception handler use sirf log karta hai, process zinda reh jaata hai. Yaani
// app chalti dikhegi par kisi port par sunegi nahi.
//
// Isi wajah se niyam: har member ya to hoisted `function` ho, ya `db` jaisa
// upar wala const, ya GETTER. Neeche kahin declare hue const ko seedha likhoge
// to yahi TDZ crash milega.
//
// Getters isliye ki kuch cheezein (BRAND.palette, helpers) tab tak define nahi
// hoti jab tak file poori load na ho jaye. Sidha value rakhne par module ko
// undefined milta.
const ROUTE_CTX = {
  db,
  requireAuth, requireAdmin, requireAdminOrHod, requireAdminOrPC,
  // Jo route session_version ya view_only badalta hai, wo ise bulaye — warna
  // requireAuth ka cache kuch second tak purani baat maanta rahega.
  authCacheDrop,
  get BRAND() { return BRAND; },
  get getTable() { return getTable; },
  get segmentFilter() { return segmentFilter; },
  // HR check queries, leaves aur task-proof teeno jagah lagta hai, isliye
  // yahan — kisi ek module ka nahi hai.
  get isHRUser() { return _isHRUser; },
  // FMS ke numbers ka ek hi hisaab — MIS, employee records aur FMS dashboard
  // teeno isi ko bulate hain, warna teen jagah teen alag jawab aa jaate the.
  get computeFmsStats() { return computeFmsStats; },
};


const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

(async () => {
  try {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      await mailTransporter.verify();
      console.log('  ✅ Gmail SMTP Ready');
    } else {
      console.log('  ⚠️  SMTP credentials missing — emails disabled');
    }
  } catch (err) {
    console.error('  ❌ SMTP verification failed:', err.message);
  }
})();

// Reusable email sender — never throws (failures are logged only)
async function sendMail(to, subject, html) {
  if (!to || !process.env.SMTP_USER) return;
  try {
    await mailTransporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || (BRAND.company ? `${BRAND.company} ${BRAND.product}` : BRAND.product)}" <${process.env.SMTP_USER}>`,
      to, subject, html
    });
    console.log(`  📧 Email sent to ${to} — ${subject}`);
  } catch (err) {
    console.error(`  ❌ Email failed (${to}):`, err.message);
  }
}

// Helper: get user's notification email + name
async function getNotifyTarget(userId) {
  try {
    const [rows] = await db.query(
      'SELECT name, notification_email FROM users WHERE id=? LIMIT 1',
      [userId]
    );
    if (!rows[0] || !rows[0].notification_email) return null;
    return { name: rows[0].name, email: rows[0].notification_email };
  } catch { return null; }
}

// Email template for delegation task
function delegationEmailHtml({ assigneeName, assignerName, desc, dueDate, priority, approval, remarks }) {
  const appUrl = process.env.APP_URL || '#';
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f6f9fc;padding:20px;">
    <div style="background:#fff;border-radius:8px;padding:30px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
      <h2 style="color:${BRAND.palette.primary};margin-top:0;">📋 New Task Assigned to You</h2>
      <p>Hi <b>${assigneeName || 'there'}</b>,</p>
      <p><b>${assignerName || 'Someone'}</b> has assigned you a new delegation task:</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px;background:#f0f4f8;width:140px;"><b>Task</b></td><td style="padding:8px;">${desc}</td></tr>
        <tr><td style="padding:8px;background:#f0f4f8;"><b>Due Date</b></td><td style="padding:8px;">${dueDate}</td></tr>
        <tr><td style="padding:8px;background:#f0f4f8;"><b>Priority</b></td><td style="padding:8px;text-transform:capitalize;">${priority}</td></tr>
        <tr><td style="padding:8px;background:#f0f4f8;"><b>Approval Required</b></td><td style="padding:8px;text-transform:capitalize;">${approval}</td></tr>
        ${remarks ? `<tr><td style="padding:8px;background:#f0f4f8;"><b>Remarks</b></td><td style="padding:8px;">${remarks}</td></tr>` : ''}
      </table>
      <a href="${appUrl}" style="display:inline-block;background:${BRAND.palette.primary};color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Open ${BRAND.product}</a>
      <p style="color:#777;font-size:12px;margin-top:30px;">This is an automated email from ${BRAND.short}.</p>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
// v16: DELEGATION REMINDER EMAILS (daily at 12:00 PM)
// Ek hi mail address ko 3-4 employees use karte hain — isliye user-wise
// section banakar ek hi mail me sab tasks bhejte hain. Reminder window:
// due_date <= today+2 AND status='pending'. Task complete ya delete hone
// par reminders bandh ho jaate hain. Same task ek din me 2 baar reminder
// nahi bhejti (last_reminder_date column tracking).
// ══════════════════════════════════════════════════════

// Build the combined reminder email HTML for a single notification_email
// `byUser` = { "User Name": [task, task, ...], ... }
function reminderEmailHtml(byUser, todayStr) {
  const appUrl = process.env.APP_URL || '#';
  const userNames = Object.keys(byUser);
  const totalTasks = userNames.reduce((s, n) => s + byUser[n].length, 0);

  // Per-user blocks — user ka naam clearly upar, neeche uski tasks ki table
  const sections = userNames.map(name => {
    const tasks = byUser[name];
    const rows = tasks.map(t => {
      const isOverdue = t.due_date < todayStr;
      const dueLabel = isOverdue
        ? `<span style="color:#dc2626;font-weight:700">${t.due_date} ⏰ Overdue</span>`
        : (t.due_date === todayStr
            ? `<span style="color:#d97706;font-weight:700">${t.due_date} (Today)</span>`
            : `<b>${t.due_date}</b>`);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px">${t.description||'—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;white-space:nowrap">${dueLabel}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:12px;text-transform:capitalize;color:#64748b">${t.priority||'low'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:12px;color:#64748b">${t.assignerName||'—'}</td>
      </tr>`;
    }).join('');
    return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <span style="background:${BRAND.palette.primary};color:#fff;width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${(name||'?').charAt(0).toUpperCase()}</span>
        <div>
          <div style="font-weight:700;font-size:15px;color:#1e293b">${name||'Unknown'}</div>
          <div style="font-size:12px;color:#64748b">${tasks.length} pending task${tasks.length>1?'s':''}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fafbfc;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Task</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Due Date</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Priority</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px">Assigned By</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

  return `
  <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#f6f9fc;padding:20px;">
    <div style="background:#fff;border-radius:10px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
      <h2 style="color:#dc2626;margin:0 0 4px 0">⏰ Pending Task Reminder</h2>
      <p style="margin:0 0 18px 0;color:#475569;font-size:14px">
        As of <b>${todayStr}</b> — the tasks listed below are due in 2 days or less. Please complete them on time.
        ${userNames.length > 1 ? `<br><span style="font-size:12px;color:#64748b">This email is for <b>${userNames.length} user${userNames.length>1?'s':''}</b> (same email account): ${userNames.join(', ')}</span>` : ''}
      </p>
      ${sections}
      <a href="${appUrl}" style="display:inline-block;background:${BRAND.palette.primary};color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:600;margin-top:6px">Open ${BRAND.product}</a>
      <p style="color:#94a3b8;font-size:11px;margin-top:18px;border-top:1px solid #eef2f7;padding-top:12px">
        Total <b>${totalTasks}</b> pending task${totalTasks>1?'s':''}. Reminders will be sent daily at 12:00 PM until the task is completed.
        To stop them, complete or delete the task.
      </p>
    </div>
  </div>`;
}

// Run the daily delegation reminder pass.
// Filter: status='pending' AND due_date <= (today + 2 days) AND last_reminder_date != today
async function runDelegationReminders() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const cutoff = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    const [tasks] = await db.query(`
      SELECT t.id, t.description, t.assigned_to, t.assigned_by, t.priority,
             COALESCE(t.approval,'no') AS approval, t.remarks,
             TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date,
             u1.name AS "assigneeName", u1.notification_email AS "assigneeEmail",
             u2.name AS "assignerName"
      FROM delegation_tasks t
      JOIN users u1 ON t.assigned_to = u1.id
      JOIN users u2 ON t.assigned_by = u2.id
      WHERE t.status = 'pending'
        AND t.due_date <= ?
        AND (t.last_reminder_date IS NULL OR t.last_reminder_date < ?)
      ORDER BY u1.notification_email, t.due_date ASC
    `, [cutoff, todayStr]);

    if (!tasks.length) {
      console.log(`  🔔 Reminder pass @ ${todayStr}: 0 pending tasks in window`);
      return { sent: 0, skipped: 0 };
    }

    // Group by notification_email — ek email pe ek hi mail jaayegi
    const groups = {};
    for (const t of tasks) {
      const email = (t.assigneeEmail || '').trim().toLowerCase();
      if (!email) continue; // skip users without notification_email
      if (!groups[email]) groups[email] = { byUser: {}, taskIds: [] };
      if (!groups[email].byUser[t.assigneeName]) groups[email].byUser[t.assigneeName] = [];
      groups[email].byUser[t.assigneeName].push(t);
      groups[email].taskIds.push(t.id);
    }

    let sent = 0, failed = 0;
    for (const email of Object.keys(groups)) {
      const { byUser, taskIds } = groups[email];
      const totalForEmail = taskIds.length;
      const userNames = Object.keys(byUser);
      const subject = userNames.length === 1
        ? `⏰ ${totalForEmail} pending task${totalForEmail>1?'s':''} for ${userNames[0]}`
        : `⏰ ${totalForEmail} pending task${totalForEmail>1?'s':''} (${userNames.length} users)`;
      try {
        await sendMail(email, subject, reminderEmailHtml(byUser, todayStr));
        // Mark all included tasks as reminded today (prevents same-day duplicates if pass re-runs)
        if (taskIds.length) {
          await db.query(
            `UPDATE delegation_tasks SET last_reminder_date=? WHERE id IN (${taskIds.map(()=>'?').join(',')})`,
            [todayStr, ...taskIds]
          );
        }
        sent++;
      } catch (e) {
        console.error('  ❌ Reminder failed for', email, e.message);
        failed++;
      }
    }
    console.log(`  🔔 Reminder pass @ ${todayStr}: ${sent} email(s) sent, ${failed} failed, ${tasks.length} tasks covered, ${Object.keys(groups).length} unique inbox(es)`);
    return { sent, failed };
  } catch (err) {
    console.error('  ❌ runDelegationReminders error:', err.message);
    return { error: err.message };
  }
}

// Scheduler — checks every minute, fires once at the first 12:00 onwards each day.
// Server restart-safe: agar 12 PM ke baad start hua aur aaj abhi tak run nahi hua,
// to seedha fire ho jaata hai (taaki Hostinger restart pe miss na ho).
let _lastReminderRunDate = ''; // YYYY-MM-DD of last successful run
function reminderScheduler() {
  setInterval(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const hour = now.getHours();
      // Fire any time at/after 12:00 PM — ek din me ek hi baar
      if (hour >= 12 && _lastReminderRunDate !== todayStr) {
        _lastReminderRunDate = todayStr;
        console.log(`  🔔 Triggering daily delegation reminders (${now.toLocaleString()})`);
        await runDelegationReminders();
      }
    } catch(e) { console.error('  ❌ Scheduler tick error:', e.message); }
  }, 60 * 1000); // tick every 60 seconds
  console.log('  ✅ Delegation reminder scheduler started (fires daily at 12:00 PM)');
}

// Manual trigger endpoint for testing / catch-up (admin only)
app.post('/api/admin/run-reminders', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await runDelegationReminders();
    res.json(r);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Kick off scheduler after SMTP verify (deferred 5s so verify can finish first)
setTimeout(() => {
  if (IS_SERVERLESS) {
    console.log('  ⏭️  Reminder scheduler skipped — serverless par Vercel Cron chalata hai');
  } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    reminderScheduler();
  } else {
    console.log('  ⚠️  Reminder scheduler skipped — SMTP credentials missing');
  }
}, 5000);

// ══════════════════════════════════════════════════════
// WHATSAPP PASSES  —  kis-kis ko bhejna hai
// ══════════════════════════════════════════════════════
// Message ka text banana aur bhejna lib/whatsapp.js me hai. Yahan sirf wo
// hissa hai jo DB se poochta hai ki kiske paas kya pending hai.
// Schedule: daily pass Mon–Sat 9:30 AM IST, weekly MIS Monday subah.
// Daily pass (Monday–Saturday) — har user ke AAJ ke aur aaj se pehle ke
// pending checklist tasks nikaalta hai, group karta hai, aur WhatsApp bhejta hai.
// opts.userId → sirf ek user (testing ke liye). opts.dryRun → bhejta nahi, sirf preview.
async function runDailyChecklistWhatsApp(opts = {}) {
  if (!WA_ENABLED) { console.log('  📲 WhatsApp summary skipped — WAUMFY_* env missing'); return { error: 'not_configured' }; }
  const { userId = null, dryRun = false, testPhone = null } = opts;
  const todayDMY = _fmtDMY(new Date());
  const todayISO = _istParts().dateStr;
  try {
    const params = [];
    let userClause = '';
    if (userId) { userClause = ' AND u.id = ?'; params.push(userId); }
    // Aaj ke tasks + aaj se pehle ke jo abhi tak pending hain (oldest pehle)
    const [rows] = await db.query(`
      SELECT c.id, c.description, TO_CHAR(c.due_date,'DD/MM/YYYY') AS due_fmt,
             TO_CHAR(c.due_date,'YYYY-MM-DD') AS due_iso, c.frequency, c.assigned_to,
             u.name AS "userName", u.phone
      FROM checklist_tasks c
      JOIN users u ON c.assigned_to = u.id
      WHERE c.status = 'pending' AND c.due_date <= CURRENT_DATE${userClause}
      ORDER BY c.assigned_to, c.due_date ASC
    `, params);

    // Group by user
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.assigned_to)) byUser.set(r.assigned_to, { name: r.userName, phone: r.phone, tasks: [] });
      byUser.get(r.assigned_to).tasks.push(r);
    }

    let sent = 0, failed = 0, skipped = 0;
    const details = [];
    for (const [uid, info] of byUser) {
      const phone = testPhone ? normalizeWhatsAppPhone(testPhone) : normalizeWhatsAppPhone(info.phone);
      if (!phone) { skipped++; details.push({ user: info.name, status: 'skipped_no_phone' }); continue; }
      const message = buildPendingWhatsAppMessage(info.name, info.tasks, todayDMY, todayISO);
      if (dryRun) { details.push({ user: info.name, phone, tasks: info.tasks.length, status: 'dry_run' }); continue; }
      try {
        await sendWhatsApp(phone, message);
        sent++;
        details.push({ user: info.name, phone, tasks: info.tasks.length, status: 'sent' });
      } catch (e) {
        failed++;
        details.push({ user: info.name, phone, status: 'failed', error: e.message });
        console.error(`  ❌ WhatsApp failed for ${info.name} (${phone}):`, e.message);
      }
      await _sleep(400); // throttle — Waumfy rate limit se bachne ke liye
    }
    console.log(`  📲 Daily pending pass @ ${todayDMY}: ${sent} sent, ${failed} failed, ${skipped} skipped (no phone), ${byUser.size} users with pending`);
    return { sent, failed, skipped, users: byUser.size, details };
  } catch (err) {
    console.error('  ❌ runDailyChecklistWhatsApp error:', err.message);
    return { error: err.message };
  }
}

// ══════════════════════════════════════════════════════
// WEEKLY CHECKLIST MIS  —  har employee ka performance card
// ══════════════════════════════════════════════════════
// Card ka drawing lib/mis-render.js me hai. Yahan sirf ye hai ki pichle hafte
// kiska kya record raha — yaani DB wala hissa.
const fs = require('fs');
const mis = require('./lib/mis-render');
const {
  calcMisScore, notOnTimeScoreOf,
  ensureLogo: _ensureMisLogo, renderPageBuffers: renderMISPageBuffers,
  generateImage: generateMISImage, generatePdf: generateMISPdf,
  PDF_ROWS_PER_PAGE: MIS_PDF_ROWS_PER_PAGE,
} = mis;

// Weekly MIS pass — pichle Mon–Sat ka checklist MIS har employee ko image me.
async function runWeeklyChecklistMIS(opts = {}) {
  if (!WA_ENABLED || !process.env.WAUMFY_IMAGE_TRIGGER_URL) {
    console.log('  🖼️  MIS image pass skipped — WAUMFY image trigger not configured');
    return { error: 'not_configured' };
  }
  const { userId = null, dryRun = false, testPhone = null } = opts;
  const { start, end } = lastWeekMonSat();
  const period = {
    start, end,
    startDMY: _fmtDMY(new Date(`${start}T12:00:00`)),
    endDMY: _fmtDMY(new Date(`${end}T12:00:00`))
  };
  const todayISO = _istParts().dateStr;
  await _ensureMisLogo(); // logo ek baar decode karke cache (renderMISPage sync me use karta hai)
  try {
    // Har task ki detail chahiye (image me poori table jaati hai), sirf totals nahi
    const params = [start, end];
    let userClause = '';
    if (userId) { userClause = ' AND u.id = ?'; params.push(userId); }
    const [rows] = await db.query(`
      SELECT u.id AS user_id, u.name AS user_name, u.department, u.phone,
             t.id, t.description, t.status, t.doer_remark,
             TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_iso,
             TO_CHAR(t.due_date,'DD-MM-YYYY') AS due_fmt,
             TO_CHAR(t.completed_at,'YYYY-MM-DD') AS completed_iso,
             TO_CHAR(t.completed_at,'DD-MM-YYYY') AS completed_fmt,
             ub.name AS assigned_by_name
      FROM checklist_tasks t
      JOIN users u ON t.assigned_to = u.id
      LEFT JOIN users ub ON t.assigned_by = ub.id
      WHERE t.due_date BETWEEN ? AND ?${userClause}
      ORDER BY u.name, t.due_date ASC, t.id ASC
    `, params);

    // Group by user
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) {
        byUser.set(r.user_id, { id: r.user_id, name: r.user_name, department: r.department, phone: r.phone, tasks: [] });
      }
      // due_iso / completed_iso SQL se hi 'YYYY-MM-DD' string aate hain —
      // JS Date object par string compare karne se date logic toot jaata hai.
      byUser.get(r.user_id).tasks.push({
        id: r.id, description: r.description, status: r.status,
        due_iso: r.due_iso, due_fmt: r.due_fmt,
        completed_iso: r.completed_iso, completed_fmt: r.completed_fmt,
        assigned_by_name: r.assigned_by_name, doer_remark: r.doer_remark
      });
    }

    let sent = 0, failed = 0, skipped = 0;
    const details = [];
    for (const [, u] of byUser) {
      const tasks = u.tasks;
      if (!tasks.length) { skipped++; continue; }
      const phone = testPhone ? normalizeWhatsAppPhone(testPhone) : normalizeWhatsAppPhone(u.phone);
      if (!phone) { skipped++; details.push({ user: u.name, status: 'skipped_no_phone' }); continue; }

      // Stats — app ke MIS detail modal jaisa hi
      const s = { total: tasks.length, completed: 0, pending: 0, overdue: 0, notOnTime: 0 };
      for (const t of tasks) {
        if (t.status === 'completed') {
          s.completed++;
          if (t.completed_iso && t.due_iso && t.completed_iso > t.due_iso) s.notOnTime++;
        } else {
          s.pending++;
          if (t.due_iso && t.due_iso < todayISO) s.overdue++;
        }
      }
      s.score = calcMisScore({ total: s.total, pending: s.pending, overdue: s.overdue, notOnTime: s.notOnTime });

      const emp = { id: u.id, name: u.name, department: u.department };
      // 5 tak tasks -> image, usse zyada -> PDF
      const asPdf = tasks.length > MIS_IMAGE_MAX_TASKS;
      let asset;
      try {
        asset = asPdf
          ? await generateMISPdf(emp, s, period, tasks, todayISO)
          : generateMISImage(emp, s, period, tasks, todayISO);
      } catch (e) {
        failed++; details.push({ user: u.name, status: 'render_failed', error: e.message }); continue;
      }
      if (!asset) { failed++; details.push({ user: u.name, status: 'render_failed' }); continue; }

      const caption = [
        `*${u.name} — Weekly Checklist MIS*`,
        `${period.startDMY} to ${period.endDMY}`,
        `Total ${s.total}  ·  Done ${s.completed}  ·  Pending ${s.pending}  ·  Delayed ${s.overdue}`,
        `Score ${s.score.toFixed(1)}%`
      ].join('\n');

      if (dryRun) {
        details.push({ user: u.name, phone, tasks: tasks.length, kind: asset.kind,
          pages: asset.pages || 1, bytes: asset.bytes, stats: s, status: 'dry_run' });
        continue;
      }

      try {
        if (asPdf) {
          const safe = u.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
          await sendWhatsAppDocument(phone, caption, asset.dataUri, `MIS-${safe}-${period.start}.pdf`);
        } else {
          await sendWhatsAppImage(phone, caption, asset.dataUri);
        }
        sent++;
        details.push({ user: u.name, phone, tasks: tasks.length, kind: asset.kind, bytes: asset.bytes, status: 'sent' });
      } catch (e) {
        failed++;
        details.push({ user: u.name, phone, kind: asset.kind, status: 'failed', error: e.message });
        console.error(`  ❌ MIS ${asset.kind} failed for ${u.name}:`, e.message);
      }
      await _sleep(700);
    }
    console.log(`  🖼️  Weekly MIS pass ${period.startDMY}–${period.endDMY}: ${sent} sent, ${failed} failed, ${skipped} skipped`);
    return { period, sent, failed, skipped, details };
  } catch (err) {
    console.error('  ❌ runWeeklyChecklistMIS error:', err.message);
    return { error: err.message };
  }
}

// Current IST wall-clock parts (server timezone chahe kuch bhi ho)


// Scheduler — har minute tick, Monday ko 9:30 AM IST ke baad ek baar fire.
// Restart-safe: agar Monday 9:30 ke baad server start hua aur aaj nahi chala,
// to seedha fire ho jaata hai (Hostinger restart pe miss na ho).
// "Aaj bheja ja chuka hai" — ye DB me rakha jaata hai, RAM me nahi.
// RAM me rakhne se app restart hote hi nishani mit jaati thi aur usi din
// dobara sabko messages chale jaate the. Table apne aap ban jaati hai,
// isliye production par koi manual migration nahi chahiye.
async function _ensureAppState() {
  // updated_at ka auto-touch Postgres me trigger se hota hai (ON UPDATE
  // CURRENT_TIMESTAMP MySQL-only hai). Function schema migration me banta hai;
  // yahan sirf tab lagate hain jab wo maujood ho, taaki fresh DB par ye
  // bootstrap bina migration ke bhi na gire.
  await db.query(`CREATE TABLE IF NOT EXISTS app_state (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v VARCHAR(255) DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
         AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'app_state_touch') THEN
        CREATE TRIGGER app_state_touch BEFORE UPDATE ON app_state
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END $$;
  `);
}
// Atomic day-claim — MULTI-PROCESS SAFE. Hostinger 2+ Node workers chalata hai,
// isliye check-then-set race deta (dono process ek hi din claim karke double bhej dete).
// Yahan ek hi atomic UPDATE se claim hoti hai: `v` ko naye din par tabhi set karta hai
// jab wo pehle se us din ka na ho. Sirf PEHLE process ka UPDATE affectedRows=1 dega
// (MySQL row-lock serialize karta hai), baaki 0 → skip. True = "aaj tumne claim ki".
async function _claimDay(k, date) {
  try {
    await db.query('INSERT INTO app_state (k, v) VALUES (?, ?) ON CONFLICT DO NOTHING', [k, '']);
    const [r] = await db.query('UPDATE app_state SET v=? WHERE k=? AND v<>?', [date, k, date]);
    return r.affectedRows > 0;
  } catch (e) { console.error('  ❌ app_state day-claim failed:', e.message); return false; }
}

// Auto-send ON hai ya nahi — env var (WA_SCHEDULER_ENABLED=true) YA DB flag
// (app_state.wa_scheduler_enabled='true'), dono me se koi bhi.
// DB flag isliye: kuch hosting panels env var reliably save nahi karte;
// phpMyAdmin se set karna hamesha kaam karta hai. Har tick par padhte hain,
// isliye DB flag badalne par restart ki bhi zaroorat nahi (agla tick pick karega).
async function _schedulerEnabled() {
  if (String(process.env.WA_SCHEDULER_ENABLED).toLowerCase() === 'true') return true;
  try {
    const [r] = await db.query("SELECT v FROM app_state WHERE k='wa_scheduler_enabled'");
    return r.length > 0 && String(r[0].v).toLowerCase() === 'true';
  } catch (_) { return false; }
}

function whatsappScheduler() {
  setInterval(async () => {
    try {
      const ist = _istParts();
      // 9:30 AM IST se pehle kuch nahi (sasta skip — DB touch nahi)
      if (!(ist.hour > 9 || (ist.hour === 9 && ist.minute >= 30))) return;
      // Auto-send OFF ho to kuch nahi (env var ya DB flag se control)
      if (!await _schedulerEnabled()) return;
      const clock = `${String(ist.hour).padStart(2,'0')}:${String(ist.minute).padStart(2,'0')}`;

      // 1) Pending checklist reminder — Monday se Saturday, roz
      //    (aaj ke tasks + aaj se pehle ke jo pending hain).
      //    Din pehle atomically claim hoti hai — ek hi process bhejega,
      //    aur pass ke beech restart ho to jo log pa chuke unhe dobara nahi.
      if (ist.day >= 1 && ist.day <= 6 && await _claimDay('wa_last_pending_date', ist.dateStr)) {
        console.log(`  📲 Daily pending checklist pass (IST ${ist.dateStr} ${clock})`);
        await runDailyChecklistWhatsApp();
      }

      // 2) MIS report — sirf Monday ko, pichle Mon–Sat ka
      if (ist.day === 1 && await _claimDay('wa_last_mis_date', ist.dateStr)) {
        console.log(`  🖼️  Weekly MIS pass (IST ${ist.dateStr} ${clock})`);
        await runWeeklyChecklistMIS();
      }
    } catch (e) { console.error('  ❌ WhatsApp scheduler tick:', e.message); }
  }, 60 * 1000);
  console.log('  ✅ WhatsApp scheduler started (pending: Mon–Sat ~9:30 AM IST, MIS: Mondays)');
}

// Manual/test endpoint (admin only).
//   body {}                       → poora pass abhi chalao (sab users)
//   body { userId }               → sirf ek user ko bhejo (safe test)
//   body { dryRun:true }          → kuch bhejo mat, sirf preview return karo
//   body { phone, message }       → ek raw test message bhejo
app.post('/api/admin/whatsapp-summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!WA_ENABLED) return res.status(400).json({ error: 'WhatsApp not configured on server (WAUMFY_* env missing).' });
    const { userId, dryRun, phone, message } = req.body || {};
    if (phone && message) {
      const norm = normalizeWhatsAppPhone(phone);
      if (!norm) return res.status(400).json({ error: 'Invalid phone number.' });
      const r = await sendWhatsApp(norm, message);
      return res.json({ ok: true, sentTo: norm, api: r });
    }
    // mode: 'pending' (default) | 'mis' | 'both'
    // testPhone: sab messages real numbers ki jagah is ek number par (safe testing)
    const mode = (req.body && req.body.mode) || 'pending';
    const testPhone = (req.body && req.body.testPhone) || null;
    const common = { userId: userId || null, dryRun: !!dryRun, testPhone };
    const out = {};
    if (mode === 'pending' || mode === 'both') out.pending = await runDailyChecklistWhatsApp(common);
    if (mode === 'mis' || mode === 'both') out.mis = await runWeeklyChecklistMIS(common);
    res.json(mode === 'pending' ? out.pending : out);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// One-time migration helper — purane checklist rows me frequency NULL hai
// (app pehle ise store nahi karta tha). Same user + same task ke consecutive
// due_dates ka sabse common gap dekh kar frequency infer karta hai.
// body { apply: true } ke bina sirf preview deta hai, kuch update nahi karta.
const _GAP_FREQ = [
  [1, 4, 'daily'], [6, 8, 'weekly'], [13, 16, 'alternative_week'],
  [27, 32, 'monthly'], [86, 95, 'quarterly'], [360, 370, 'yearly']
];
app.post('/api/admin/backfill-frequency', requireAuth, requireAdmin, async (req, res) => {
  try {
    const apply = !!(req.body && req.body.apply);
    const [rows] = await db.query(`
      SELECT id, assigned_to, description, due_date
      FROM checklist_tasks
      WHERE frequency IS NULL AND due_date IS NOT NULL
      ORDER BY assigned_to, description, due_date`);

    const groups = new Map();
    for (const r of rows) {
      const k = r.assigned_to + '||' + r.description;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    const summary = {};
    const updates = new Map();
    let unknown = 0;
    for (const [, list] of groups) {
      if (list.length < 2) { unknown += list.length; continue; }
      const gaps = {};
      for (let i = 1; i < list.length; i++) {
        const d = Math.round((new Date(list[i].due_date) - new Date(list[i - 1].due_date)) / 86400000);
        if (d > 0) gaps[d] = (gaps[d] || 0) + 1;
      }
      const top = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0];
      const gap = top ? Number(top[0]) : 0;
      const hit = _GAP_FREQ.find(([lo, hi]) => gap >= lo && gap <= hi);
      if (!hit) { unknown += list.length; continue; }
      const freq = hit[2];
      summary[freq] = (summary[freq] || 0) + list.length;
      if (!updates.has(freq)) updates.set(freq, []);
      updates.get(freq).push(...list.map(r => r.id));
    }

    if (!apply) return res.json({ preview: true, scanned: rows.length, wouldSet: summary, couldNotInfer: unknown });

    let updated = 0;
    for (const [freq, ids] of updates) {
      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        await db.query(`UPDATE checklist_tasks SET frequency=? WHERE id IN (${chunk.map(() => '?').join(',')})`, [freq, ...chunk]);
        updated += chunk.length;
      }
    }
    console.log(`  🔁 Frequency backfill: ${updated} rows updated`);
    res.json({ applied: true, scanned: rows.length, updated, set: summary, couldNotInfer: unknown });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Kick off WhatsApp scheduler. Interval hamesha chalta hai; har tick par
// _schedulerEnabled() check hota hai (env var YA DB flag). Isse:
//  - dev/local par galti se messages nahi jaate (dono OFF rehte hain),
//  - production par phpMyAdmin se DB flag on karke chalu kar sakte ho —
//    Hostinger env panel reliably save na kare tab bhi.
setTimeout(async () => {
  if (!WA_ENABLED) {
    console.log('  ⚠️  WhatsApp scheduler skipped — WAUMFY_* credentials missing');
    return;
  }
  try {
    await _ensureAppState();
  } catch (e) {
    console.error('  ❌ WhatsApp scheduler NOT started — app_state table unavailable:', e.message);
    return;
  }
  if (IS_SERVERLESS) {
    console.log('  ⏭️  WhatsApp scheduler skipped — serverless par Vercel Cron chalata hai');
    return;
  }
  whatsappScheduler();
  const on = await _schedulerEnabled();
  console.log(`  ${on ? '✅' : '⏸️'}  WhatsApp scheduler running — auto-send currently ${on ? 'ENABLED' : 'DISABLED'}` +
    ` (toggle: env WA_SCHEDULER_ENABLED=true, ya DB app_state.wa_scheduler_enabled='true')`);
}, 6000);

// ══════════════════════════════════════════════════════
// CRON ENDPOINTS (Vercel)
// ══════════════════════════════════════════════════════
// Serverless par background timers nahi chal sakte, isliye wahi kaam Vercel
// Cron HTTP se trigger karta hai (schedule vercel.json me hai). Kaam karne
// wale functions bilkul wahi hain jo local scheduler bulata tha.
//
// Idempotency pehle jaisi hi hai: WhatsApp pass se pehle _claimDay() ek atomic
// UPDATE se din claim karta hai, isliye cron do baar chal jaye (retry ya
// overlap) to bhi messages dobara nahi jaate.
//
// Suraksha: Vercel Cron har request me `Authorization: Bearer $CRON_SECRET`
// bhejta hai jab wo env var set ho. Bina us secret ke ye endpoints koi bhi
// bahar se bula kar sabko messages bhijwa sakta hai — isliye secret na hone
// par hum inhe band hi rakhte hain (fail-closed).
function cronAuthed(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'CRON_SECRET is not configured — cron endpoints are disabled' });
    return false;
  }
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (given !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Roz 12:00 PM IST — delegation reminders (email)
app.get('/api/cron/reminders', async (req, res) => {
  if (!cronAuthed(req, res)) return;
  try {
    if (!(process.env.SMTP_USER && process.env.SMTP_PASS)) {
      return res.json({ skipped: 'SMTP credentials missing' });
    }
    const r = await runDelegationReminders();
    console.log('  🔔 Cron: delegation reminders done');
    res.json({ ok: true, result: r });
  } catch (e) {
    console.error('  ❌ Cron reminders failed:', e.message);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Mon–Sat 9:30 AM IST — pending checklist WhatsApp; Monday ko MIS report bhi.
// Din ka faisla IST se hota hai (Vercel Cron UTC me chalta hai), wahi logic jo
// local scheduler use karta tha.
app.get('/api/cron/whatsapp', async (req, res) => {
  if (!cronAuthed(req, res)) return;
  try {
    if (!WA_ENABLED) return res.json({ skipped: 'WAUMFY_* credentials missing' });
    await _ensureAppState();
    if (!await _schedulerEnabled()) return res.json({ skipped: 'auto-send disabled' });

    const ist = _istParts();
    const done = [];
    if (ist.day >= 1 && ist.day <= 6 && await _claimDay('wa_last_pending_date', ist.dateStr)) {
      await runDailyChecklistWhatsApp();
      done.push('pending-checklist');
    }
    if (ist.day === 1 && await _claimDay('wa_last_mis_date', ist.dateStr)) {
      await runWeeklyChecklistMIS();
      done.push('weekly-mis');
    }
    console.log(`  📲 Cron: WhatsApp pass — ${done.length ? done.join(', ') : 'kuch nahi (pehle hi ho chuka ya din match nahi)'}`);
    res.json({ ok: true, ran: done, ist: ist.dateStr });
  } catch (e) {
    console.error('  ❌ Cron WhatsApp failed:', e.message);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// ══════════════════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════════════════
// view-only user ko in POST routes ki chhoot hai — ye kuch badalte nahi.
const VIEW_ONLY_ALLOWED_POSTS = new Set(['/api/verify-password']);

// ── Auth check ka chhota cache ────────────────────────
// requireAuth har request par chalta hai, aur uski query bhi. Jab database
// paas ho (localhost) to ye kuch millisecond ki baat hai. Par managed database
// aksar door ke region me hota hai — wahan ek round-trip 300-500ms ka hai, aur
// wo poora samay HAR button par lagta hai, endpoint ka apna kaam shuru hone se
// bhi pehle. Naapa gaya: sab endpoints par ek jaisa +414ms.
//
// Isliye is check ka nateeja kuch second ke liye yaad rakh lete hain. Ye kuch
// bhi "sach" nahi badalta — sirf ye ki DB se kitni baar poochha jaaye.
//
// Kya kho rahe hain: force-logout aur view-only flag ko lagne me itni der lag
// sakti hai. Isi liye jahan-jahan ye badalte hain (password change, view_only
// toggle) wahan cache turant saaf kar dete hain — yaani asal me der tabhi hai
// jab badlaav kisi doosre server instance par hua ho.
const AUTH_CACHE_MS = 10_000;
const _authCache = new Map();          // userId -> { sv, viewOnly, at }

function authCacheDrop(userId) { _authCache.delete(Number(userId)); }

// Map ko badhne se rokna: har baar purani entries hata do. Users itne nahi
// hote ki ye mehnga pade, aur ek chalta hua server hafton khula reh sakta hai.
function _authCacheSweep(now) {
  for (const [k, v] of _authCache) if (now - v.at > AUTH_CACHE_MS) _authCache.delete(k);
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers['authorization']?.replace('Bearer ','');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // session_version check — jab admin kisi user ka password change karta hai, uska
    // version bump hota hai, purane tokens is check se fail ho jaate hain (force logout)
    // view_only bhi yahin aata hai (same query) — DB se, token se nahi, taaki
    // flag badalne par purana token bhi turant restricted ho jaye.
    const now = Date.now();
    let cached = _authCache.get(decoded.userId);
    if (cached && now - cached.at > AUTH_CACHE_MS) cached = null;

    if (!cached) {
      let rows;
      try {
        [rows] = await db.query('SELECT session_version, view_only FROM users WHERE id=?', [decoded.userId]);
      } catch (e) {
        // Column abhi migrate na hua ho to app chalta rahe (42703 = undefined_column)
        if (e.code !== '42703') throw e;
        [rows] = await db.query('SELECT session_version FROM users WHERE id=?', [decoded.userId]);
      }
      // User hi na mile to cache mat karo — warna delete kiya hua user 10
      // second tak "abhi bhi hai" jaisa vyavhaar karta.
      if (!rows.length) return res.status(401).json({ error: 'Invalid token' });
      cached = { sv: rows[0].session_version, viewOnly: rows[0].view_only === 1, at: now };
      _authCache.set(decoded.userId, cached);
      _authCacheSweep(now);
    }

    if ((decoded.sv || 1) !== cached.sv) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const viewOnly = cached.viewOnly;
    req.session = { userId: decoded.userId, role: decoded.role, name: decoded.name, viewOnly };

    // Yahi ek jagah saare writes rukte hain. Har endpoint par alag check lagate
    // to 56 mutating routes me se koi na koi chhoot jaata — isliye gate yahan hai.
    if (viewOnly && req.method !== 'GET' && !VIEW_ONLY_ALLOWED_POSTS.has(req.path)) {
      return res.status(403).json({ error: 'You have view-only access — changes are not allowed.' });
    }
    next();
  } catch(e) { res.status(401).json({ error: 'Invalid token' }); }
}
function requireAdmin(req, res, next) {
  if (req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}
function requireAdminOrHod(req, res, next) {
  if (req.session.role === 'admin' || req.session.role === 'hod' || req.session.role === 'pc') return next();
  res.status(403).json({ error: 'Admin or HOD only' });
}
function requireAdminOrPC(req, res, next) {
  if (req.session.role === 'admin' || req.session.role === 'pc') return next();
  res.status(403).json({ error: 'Admin or PC only' });
}


// ── New Client Copy (white-label build generator) ─────
// Sirf humare apne (base) repo me maujood hota hai. Client ko di gayi copy me
// lib/brand-copy.js jaati hi nahi, isliye wahan ye require fail hota hai aur
// routes register nahi hote — app baaki sab kuch normally chalati rehti hai.
try {
  require('./lib/brand-copy').register(app, { requireAuth, requireAdmin, db });
} catch (e) {
  // Chup sirf tab rehna hai jab brand-copy KHUD na ho (client ki copy). Uske
  // andar ka koi aur require toot jaye to wo asli galti hai — usse chup rehne
  // par tab bina kisi wajah ke gaayab ho jaata aur log me kuch bhi na aata.
  // Sirf PEHLI line dekho. Node ke MODULE_NOT_FOUND message me neeche
  // "Require stack:" hoti hai jisme brand-copy.js ka naam bhi aata hai — poora
  // message match karne par brand-copy ke ANDAR ka koi missing require bhi
  // nigal jaata, aur dono tab bina kisi log ke gaayab ho jaate.
  const isMissingSelf = e.code === 'MODULE_NOT_FOUND'
    && /brand-copy/.test(String(e.message || '').split('\n')[0]);
  if (!isMissingSelf) console.error('  ⚠️  brand-copy load failed:', e.message);
}

function getTable(type) {
  return type === 'delegation' ? 'delegation_tasks' : 'checklist_tasks';
}
// Office vs Factory segment filter. req.query.segment = 'office' | 'factory' | (absent/all).
// alias = users table ka alias jis query me (jaise 'u'), ya '' agar users hi main table hai.
// Returns { clause, param } — clause ke aage 'AND' laga hota hai; segment na ho to khali.
function segmentFilter(req, alias = 'u') {
  const seg = (req.query.segment || '').toLowerCase();
  if (seg !== 'office' && seg !== 'factory') return { clause: '', param: null };
  const col = alias ? `${alias}.staff_type` : 'staff_type';
  return { clause: ` AND ${col}=?`, param: seg };
}

// ══════════════════════════════════════════════════════
// GOOGLE SHEETS  /  DRIVE
// ══════════════════════════════════════════════════════
// Credentials aur Sheets client lib/google.js me; column letters aur header
// naam se healing lib/sheet-cols.js me. Yahan sirf unka istemaal hai.
const {
  loadGoogleCredentials, getSheetsClient, prewarmGoogleAuth,
  callProofScript, extractDriveFolderId, extractSpreadsheetId,
} = require('./lib/google');
const {
  colToIdx, idxToCol, parseDMY: _parseDMY, addDaysDMY: _addDaysDMY,
  derivedOffset: _derivedOffset, fetchSheetHeaders: _fetchSheetHeaders,
  findColByNameNear: _findColByNameNear, healStepCols: _healStepCols,
  capStepNames: _capStepNames, intakeNameAt: _intakeNameAt,
  capIntakeNames: _capIntakeNames, healIntakeConfig: _healIntakeConfig,
  getSheetGid: _getSheetGid, forceCellNumber: _forceCellNumber,
} = require('./lib/sheet-cols');

// Boot par hi Google auth bana lo — pehli asli request tab tez chalti hai.
prewarmGoogleAuth();

// Sheet kis account ke saath share karni hai — wahi jo credentials.json me hai.
// Pehle ye email frontend me hardcoded tha (aur galat tha: ek insaan ka email,
// service account ka nahi), jisse share karne par server ko access milta hi
// nahi tha. Ab yahin se aata hai, to credentials badalne par apne aap sahi rehta hai.
// client_email koi secret nahi — ye service account ki pehchaan hai, chaabi
// (private_key) nahi. Wo kabhi bheji nahi jaati.
// Credentials wahi tarike se uthao jo getSheetsClient() use karta hai — pehle
// GOOGLE_CREDENTIALS env var, phir file. Sirf file padhne se production par ye
// fail hota tha (wahan credentials.json deploy hoti hi nahi, kyunki gitignored
// hai) jabki Sheets bilkul theek chal rahi hoti thi.
// Batata hai ki credentials kis wajah se nahi mile — env var hai hi nahi, ya hai
// par toot-phoot gayi (panel ne kaat di / aadhi paste hui). Bina iske production
// par sirf "not configured" dikhta tha aur pata nahi chalta tha kya thik karna hai.
// Kabhi bhi key ka content wapas nahi bhejte — sirf lambai aur pehla/aakhri char.
app.get('/api/fms/service-account', requireAuth, (req, res) => {
  const source = process.env.GOOGLE_CREDENTIALS_B64 ? 'GOOGLE_CREDENTIALS_B64'
               : process.env.GOOGLE_CREDENTIALS     ? 'GOOGLE_CREDENTIALS'
               : null;

  if (!source) {
    try {
      const creds = require('../credentials.json');
      if (!creds.client_email) return res.status(500).json({ error: 'credentials.json has no client_email' });
      return res.json({ email: creds.client_email, source: 'file' });
    } catch (e) {
      return res.status(500).json({
        error: 'No Google credentials on this server — set GOOGLE_CREDENTIALS_B64 (recommended) or GOOGLE_CREDENTIALS. '
             + 'If you just added it, the server still needs a restart to pick it up.'
      });
    }
  }

  let creds;
  try {
    creds = loadGoogleCredentials();
  } catch (e) {
    // Kabhi bhi key ka content wapas nahi bhejte — sirf lambai aur pehla/aakhri char,
    // jisse pata chal jaata hai ki value kati hai ya escape ho gayi hai.
    const raw = (process.env.GOOGLE_CREDENTIALS_B64 || process.env.GOOGLE_CREDENTIALS).trim();
    return res.status(500).json({
      error: `${source} is set but could not be read (${raw.length} chars, `
           + `starts "${raw[0] || '?'}", ends "${raw[raw.length-1] || '?'}"). `
           + (raw[0] === '\\' || raw[0] === '"'
              ? 'It looks escaped — the panel added backslashes on paste. Use GOOGLE_CREDENTIALS_B64 instead; base64 cannot be mangled.'
              : 'It was probably truncated or reformatted when pasted.')
    });
  }

  if (!creds.client_email) {
    return res.status(500).json({ error: `${source} was read, but has no client_email — is it the full service-account JSON?` });
  }
  res.json({ email: creds.client_email, source });
});

// ══════════════════════════════════════════════════════
// FMS SCHEMA BOOTSTRAP
// ══════════════════════════════════════════════════════
// Ab tak fms_* tables sirf DB me haath se bani hui thi — code unhe padhta-likhta
// tha par banata nahi tha. Fresh deploy (naya database) par isi wajah se saara
// FMS "table doesn't exist" pe girta tha. CREATE TABLE IF NOT EXISTS safe hai:
// jo table pehle se hai use chhoo tak nahi jaata.
async function _ensureFmsSchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS fms_sheets (
    id serial PRIMARY KEY,
    fms_name VARCHAR(255) DEFAULT '',
    sheet_name VARCHAR(255) NOT NULL,
    sheet_id VARCHAR(255) NOT NULL,
    header_row INT DEFAULT 1,
    total_steps INT DEFAULT 0,
    created_by INT,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // Postgres CREATE TABLE ke andar INDEX nahi leta — alag CREATE INDEX chahiye.
  // Naam bhi table-prefixed hain kyunki Postgres me index namespace poore
  // schema ka hota hai (MySQL me per-table), warna idx_step do baar banega.
  await db.query(`CREATE TABLE IF NOT EXISTS fms_steps (
    id serial PRIMARY KEY,
    fms_id INT NOT NULL,
    step_order INT NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    plan_col VARCHAR(10) DEFAULT '',
    actual_col VARCHAR(10) DEFAULT '',
    extra_input VARCHAR(10) DEFAULT 'no',
    extra_col VARCHAR(10) DEFAULT '',
    show_cols TEXT,
    delay_reason_col VARCHAR(10) DEFAULT '',
    doer_name_col VARCHAR(10) DEFAULT ''
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS fms_steps_idx_fms ON fms_steps (fms_id)`);

  await db.query(`CREATE TABLE IF NOT EXISTS fms_step_doers (
    id serial PRIMARY KEY,
    step_id INT NOT NULL,
    user_id INT NOT NULL
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS fms_step_doers_idx_step ON fms_step_doers (step_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS fms_step_doers_idx_user ON fms_step_doers (user_id)`);

  await db.query(`CREATE TABLE IF NOT EXISTS fms_extra_rows (
    id serial PRIMARY KEY,
    step_id INT NOT NULL,
    row_label VARCHAR(255) DEFAULT '',
    col_letter VARCHAR(10) DEFAULT '',
    field_type VARCHAR(20) DEFAULT 'text',
    dropdown_options TEXT,
    required SMALLINT DEFAULT 1
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS fms_extra_rows_idx_step ON fms_extra_rows (step_id)`);

  // Purane databases ke liye column-level migrations. Postgres me
  // ADD COLUMN IF NOT EXISTS hota hai, isliye MySQL wale "column pehle se hai"
  // error ko pakadne ki zarurat nahi. 42701 (duplicate_column) phir bhi nigal
  // rahe hain — race me do instance ek saath boot hon to wahi aata hai.
  // NOTE: Postgres me AFTER <col> nahi hota; naya column hamesha aakhir me
  // judta hai. Koi bhi query `SELECT *` ke column order par tiki nahi hai.
  const addCol = async (sql) => {
    try { await db.query(sql); }
    catch (e) { if (e.code !== '42701') throw e; }
  };
  await addCol(`ALTER TABLE fms_sheets ADD COLUMN IF NOT EXISTS fms_name VARCHAR(255) DEFAULT ''`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS show_cols TEXT`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS delay_reason_col VARCHAR(10) DEFAULT ''`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS doer_name_col VARCHAR(10) DEFAULT ''`);
  await addCol(`ALTER TABLE fms_extra_rows ADD COLUMN IF NOT EXISTS col_letter VARCHAR(10) DEFAULT ''`);
  await addCol(`ALTER TABLE fms_extra_rows ADD COLUMN IF NOT EXISTS field_type VARCHAR(20) DEFAULT 'text'`);
  await addCol(`ALTER TABLE fms_extra_rows ADD COLUMN IF NOT EXISTS dropdown_options TEXT`);
  // required default 1 — purani rows pehle jaisi mandatory hi rahengi.
  await addCol(`ALTER TABLE fms_extra_rows ADD COLUMN IF NOT EXISTS required SMALLINT DEFAULT 1`);
  // Intake Form config (per FMS) — JSON: { targetSheetId, targetTab, targetHeaderRow, fields:[{label,col,type,required,options}] }
  await addCol(`ALTER TABLE fms_sheets ADD COLUMN IF NOT EXISTS intake_config TEXT DEFAULT NULL`);
  // Column NAMES (headers) — taaki sheet me column add/delete se letters shift hon to bhi
  // app naam se sahi column dhoondh le (letter fallback). Save par capture hote hain.
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS plan_col_name VARCHAR(255) DEFAULT NULL`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS actual_col_name VARCHAR(255) DEFAULT NULL`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS show_col_names TEXT DEFAULT NULL`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS delay_reason_col_name VARCHAR(255) DEFAULT NULL`);
  await addCol(`ALTER TABLE fms_steps ADD COLUMN IF NOT EXISTS doer_name_col_name VARCHAR(255) DEFAULT NULL`);
}

// FMS access — admin sabko, warna user tabhi jab wo us FMS ke kisi step ka doer ho.
async function _canAccessFms(uid, fmsId, isAdmin) {
  if (isAdmin) return true;
  const [r] = await db.query(
    `SELECT 1 FROM fms_step_doers fsd JOIN fms_steps s ON s.id=fsd.step_id
     WHERE s.fms_id=? AND fsd.user_id=? LIMIT 1`, [fmsId, uid]);
  return r.length > 0;
}

// Startup par ek baar chalao. Fail ho to app band nahi karte — baaki modules
// (delegation/checklist) FMS ke bina bhi theek chalte hain.
setTimeout(() => {
  _ensureFmsSchema()
    .then(() => console.log('  ✅ FMS schema ready'))
    .catch(e => console.error('  ❌ FMS schema setup failed:', e.message));
}, 3000);

// Query module — user query daalta hai, HR/Admin answer/reject karte hain.
// created_at/answered_at IST me store honge (pool time_zone +05:30).
async function _ensureQueriesTable() {
  // ENUM ki jagah TEXT + CHECK — Postgres me enum ek alag type hota hai jise
  // badalne ke liye ALTER TYPE karna padta; CHECK me sirf constraint badalti hai.
  // Baaki schema me bhi yahi tarika use kiya gaya hai.
  await db.query(`CREATE TABLE IF NOT EXISTS queries (
    id serial PRIMARY KEY,
    user_id INT NOT NULL,
    message TEXT NOT NULL,
    answer TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','rejected')),
    answered_by INT DEFAULT NULL,
    answered_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS queries_idx_user ON queries (user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS queries_idx_status ON queries (status)`);
}
setTimeout(() => {
  _ensureQueriesTable()
    .then(() => console.log('  ✅ Queries table ready'))
    .catch(e => console.error('  ❌ Queries table setup failed:', e.message));
}, 3200);

// view_only — user sab kuch dekh sakta hai lekin kuch bhi badal nahi sakta.
// Role se alag rakha hai: kisi bhi role par laga sakte hain, aur role ke
// saare view permissions waise ke waise rehte hain.
async function _ensureViewOnlyColumn() {
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS view_only SMALLINT NOT NULL DEFAULT 0`);
  } catch (e) {
    if (e.code !== '42701') throw e;   // 42701 = duplicate_column
  }
}
setTimeout(() => {
  _ensureViewOnlyColumn()
    .then(() => console.log('  ✅ view_only column ready'))
    .catch(e => console.error('  ❌ view_only column setup failed:', e.message));
}, 3400);

// Plan-column ki value ko YYYY-MM-DD me badalta hai (DD-MM-YYYY, DD/MM/YYYY,
// YYYY-MM-DD, aage time laga ho to bhi). Parse na ho to null.
// ── FMS: kai steps ka data EK query me ────────────────
// Pehle har step ke liye alag query jaati thi. 6 sheets x 6 steps par ye 36
// queries ban jaati thi — aur /api/fms-dashboard har dashboard load par chalta
// hai, yaani seedha Railway ka bill. Ab sab ek saath aata hai aur JS me group
// hota hai.
//
// Dono `step_id -> rows[]` ka map lautate hain. Call sites wahi shape banate
// hain jo pehle bhejte the (kahin {id,name}, kahin {user_id,name}), isliye API
// ka response bilkul waisa hi rehta hai.
async function _fmsDoersByStep(stepIds) {
  if (!stepIds.length) return {};
  const ph = stepIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT fsd.step_id, fsd.user_id, u.name, u.department
       FROM fms_step_doers fsd JOIN users u ON fsd.user_id=u.id
      WHERE fsd.step_id IN (${ph})
      ORDER BY fsd.step_id, fsd.id`, stepIds);
  const by = {};
  for (const r of rows) (by[r.step_id] = by[r.step_id] || []).push(r);
  return by;
}

async function _fmsExtraRowsByStep(stepIds) {
  if (!stepIds.length) return {};
  const ph = stepIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT * FROM fms_extra_rows WHERE step_id IN (${ph}) ORDER BY step_id, id ASC`, stepIds);
  const by = {};
  for (const r of rows) (by[r.step_id] = by[r.step_id] || []).push(r);
  return by;
}

function parseFmsPlanDate(val) {
  if (!val) return null;
  const v = String(val).trim();
  let m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    const dt = new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`);
    return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
  }
  m = v.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    const dt = new Date(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`);
    return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
  }
  return null;
}

// ══════════════════════════════════════════════════════
// SHARED FMS STATS ENGINE  (single source of truth)
// ══════════════════════════════════════════════════════
// Pehle /api/mis/all aur /api/mis/fms dono apne-apne tareeke se Google Sheets
// padhte the — alag filtering, alag aggregation, silent error swallow. Isi se
// "kabhi kya dikhata hai" aur "HOD ko alag total" wale bugs aate the.
//
// Ab dono ek hi function se data lete hain:
//   • Har sheet ek hi baar padhi jaati hai (request ke andar) + 60s ka cache
//     => refresh karne par numbers STABLE rehte hain (deterministic).
//   • Step-level pending/done ek hi jagah count hota hai => per-FMS overview aur
//     per-user attribution kabhi disagree nahi karte.
//   • Read fail ho to sheet ka naam `errors[]` me aata hai (silently 0 nahi hota)
//     => total achanak change nahi hota; UI warning dikha sakta hai.
//   • HOD ke liye department filter dono jagah EK jaisa lagta hai.

const _fmsSheetCache = new Map(); // key: spreadsheetId|range  -> { rows, ts }
const FMS_CACHE_TTL_MS = 60 * 1000;

async function fetchSheetRows(sheet) {
  const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
  const tabName = sheet.sheet_name || 'Sheet1';
  const headerRowIdx = (sheet.header_row || 1) - 1;

  // Poori tab padho — naam-se-heal ke baad kisi column ka data cut na ho isliye
  // range ko plan/actual letters se limit nahi karte.
  const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
  const range = qTab;

  const cacheKey = `${spreadsheetId}|${range}`;
  const hit = _fmsSheetCache.get(cacheKey);
  if (hit && (Date.now() - hit.ts) < FMS_CACHE_TTL_MS) return hit.rows;

  const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
  const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
  const allRowsData = response.data.values || [];
  const rows = allRowsData.slice(headerRowIdx + 1);
  _fmsSheetCache.set(cacheKey, { rows, ts: Date.now() });
  return rows;
}

// Returns { perFms: [...], perUser: { uid: {pending,done,total} }, errors: [name] }
// hodDept '' => admin/pc (sab kuch). hodDept set => sirf un steps jinme us dept ka doer hai.
async function computeFmsStats(hodDept = '', collectPending = false) {
  const result = { perFms: [], perUser: {}, errors: [] };
  if (collectPending) result.perUserPending = {}; // uid -> [ {fmsName, stepName, planValue, planDate, isLate} ]
  const _today = new Date().toISOString().split('T')[0];
  const [sheets] = await db.query('SELECT * FROM fms_sheets ORDER BY fms_name ASC');
  if (!sheets.length) return result;

  // Saare sheets ke steps, phir un sab ke doers — do queries, chahe kitni bhi
  // sheets hon. Pehle ye per-sheet aur per-step chalti thi.
  const _sheetPh = sheets.map(() => '?').join(',');
  const [_allSteps] = await db.query(
    `SELECT * FROM fms_steps WHERE fms_id IN (${_sheetPh}) ORDER BY fms_id, step_order ASC`,
    sheets.map(s => s.id));
  const _stepsByFms = {};
  for (const s of _allSteps) (_stepsByFms[s.fms_id] = _stepsByFms[s.fms_id] || []).push(s);
  const _doersByStep = await _fmsDoersByStep(_allSteps.map(s => s.id));
  for (const s of _allSteps) {
    s.doers = (_doersByStep[s.id] || []).map(d => ({ id: d.user_id, name: d.name, department: d.department }));
  }

  for (const sheet of sheets) {
    const fmsName = sheet.fms_name || sheet.sheet_name;
    const steps = _stepsByFms[sheet.id] || [];

    // HOD filter: sirf woh steps jahan us dept ka koi doer hai
    const activeSteps = hodDept
      ? steps.filter(s => s.doers.some(d => (d.department || '') === hodDept))
      : steps;
    if (!activeSteps.length) continue;

    let rows;
    try {
      rows = await fetchSheetRows(sheet);
    } catch (e) {
      // Silent 0 NAHI — error report karo taaki total achanak na badle
      result.errors.push(fmsName);
      result.perFms.push({ fmsId: sheet.id, fmsName, pending: 0, done: 0, total: 0, steps: [], error: 'Sheet read failed (try again)' });
      continue;
    }

    // Naam-se-heal: sheet me column shift ho to bhi sahi column mile (sirf jab naam stored ho)
    if (activeSteps.some(s => s.plan_col_name || s.actual_col_name || s.show_col_names)) {
      const _hdrs = await _fetchSheetHeaders(sheet);
      if (_hdrs.length) activeSteps.forEach(s => _healStepCols(s, _hdrs));
    }

    let fmsPending = 0, fmsDone = 0;
    const perStep = [];

    for (const step of activeSteps) {
      const planIdx = colToIdx(step.plan_col);
      const actualIdx = colToIdx(step.actual_col);
      if (planIdx < 0 || actualIdx < 0) continue;

      let stepPending = 0, stepDone = 0;
      const stepPendingRows = []; // collectPending ke liye — pending row ka detail
      for (const row of rows) {
        const planVal = (row[planIdx] || '').trim();
        const actualVal = (row[actualIdx] || '').trim();
        if (planVal && !actualVal) {
          stepPending++;
          if (collectPending) {
            // plan date parse (same logic as /api/fms-dashboard)
            let planDate = '';
            const dateMatch = planVal.match(/(\d{4}-\d{2}-\d{2})|(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
            if (dateMatch) {
              const raw = dateMatch[0];
              if (raw.includes('-') && raw.length === 10 && raw[4] === '-') planDate = raw;
              else { const parts = raw.split(/[\/\-]/); if (parts.length === 3) planDate = `${parts[2]}-${parts[1]}-${parts[0]}`; }
            }
            stepPendingRows.push({
              fmsName, stepName: step.step_name, planValue: planVal,
              planDate, isLate: !!(planDate && planDate < _today)
            });
          }
        }
        else if (planVal && actualVal) stepDone++;
      }

      fmsPending += stepPending;
      fmsDone += stepDone;

      // Per-user attribution: HOD view me sirf dept-doers ko credit (consistency)
      const creditDoers = hodDept ? step.doers.filter(d => (d.department || '') === hodDept) : step.doers;
      for (const d of creditDoers) {
        if (!result.perUser[d.id]) result.perUser[d.id] = { pending: 0, done: 0, total: 0 };
        result.perUser[d.id].pending += stepPending;
        result.perUser[d.id].done    += stepDone;
        result.perUser[d.id].total   += stepPending + stepDone;
        if (collectPending && stepPendingRows.length) {
          if (!result.perUserPending[d.id]) result.perUserPending[d.id] = [];
          for (const pr of stepPendingRows) result.perUserPending[d.id].push(pr);
        }
      }

      perStep.push({
        stepName: step.step_name,
        stepOrder: step.step_order,
        doers: step.doers.map(d => d.name).join(', ') || '—',
        pending: stepPending,
        done: stepDone,
        total: stepPending + stepDone
      });
    }

    result.perFms.push({
      fmsId: sheet.id,
      fmsName,
      pending: fmsPending,
      done: fmsDone,
      total: fmsPending + fmsDone,
      steps: perStep
    });
  }

  return result;
}

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════
// Current logged-in user ka password verify (re-auth) — protected actions ke liye
// (jaise Intake Form config kholna). Koi naya secret nahi; login password hi use hota hai.
app.post('/api/verify-password', requireAuth, async (req, res) => {
  try {
    const pw = String((req.body && req.body.password) || '');
    if (!pw) return res.status(400).json({ error: 'Password required' });
    const [rows] = await db.query('SELECT password FROM users WHERE id=?', [req.session.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(pw, rows[0].password)) return res.status(401).json({ error: 'Incorrect password' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // LOWER() dono taraf — MySQL ka default collation case-insensitive tha, to
    // "Rajesh@Gmail.com" wala banda "rajesh@gmail.com" likh kar bhi login kar
    // leta tha. Postgres case-sensitive hai; iske bina wo log bahar reh jaate.
    const [rows] = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid email or password' });

    // Issue JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role, name: user.name, sv: user.session_version || 1 },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, token });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;

    // Teenon cheezein pehle ek-ek karke aati thi — teen alag round-trip. Dono
    // baaki queries pehli par nirbhar nahi hain (teenon ka input sirf uid hai),
    // isliye saath me chalti hain: teen round-trip ki jagah ek.
    //
    // extra_off ab usi user query me hai. Alag isliye tha ki purane database me
    // wo column na ho — ab poori query try karke, sirf "column hi nahi hai"
    // (42703) par bina uske dobara poochte hain. Yaani aam haalat me ek hi query.
    const COLS = 'id,name,email,notification_email,role,view_only,phone,profile_image,department,week_off';
    const userQ = db.query(`SELECT ${COLS},extra_off FROM users WHERE id=?`, [uid])
      .catch(e => {
        if (e.code !== '42703') throw e;
        return db.query(`SELECT ${COLS} FROM users WHERE id=?`, [uid]);
      });

    // Kya ye user kisi FMS step ka doer hai? UI isse FMS wale hisse
    // (sidebar item, dashboard block, FMS tab) chhupata hai. Query fail ho
    // to true — kuch chhupane se behtar hai sab dikhta rahe.
    const fmsQ = db.query('SELECT 1 FROM fms_step_doers WHERE user_id=? LIMIT 1', [uid])
      .then(([f]) => f.length > 0)
      .catch(() => true);

    const [[rows], isFmsDoer] = await Promise.all([userQ, fmsQ]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    rows[0].extra_off = rows[0].extra_off || '';
    rows[0].isFmsDoer = isFmsDoer;
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/dashboard')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════════
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const role = req.session.role;
    const isAdmin = role === 'admin';
    const isHod = role === 'hod';
    const { type, mine } = req.query;
    const isMine = (mine === '1' || mine === 'true');
    const table = getTable(type || 'delegation');
    const isDeleg = (type || 'delegation') === 'delegation';
    let where = 'WHERE 1=1';
    const params = [];

    if (isMine) {
      // "Delegate by Me" mode — sirf woh tasks jinhe MAINE assign kiya hai.
      // Role-based scoping skip — koi bhi role apne assign kiye tasks dekh sakta hai.
      where += ' AND t.assigned_by = ?';
      params.push(uid);
    } else if (isAdmin || role === 'pc') {
      // Admin/PC — sab dikhta hai
    } else if (isHod) {
      // HOD — apne department ke users ki tasks
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      const dept = me[0]?.department || '';
      const [deptUsers] = await db.query('SELECT id FROM users WHERE department=?', [dept]);
      if (!deptUsers.length) {
        return res.json({ grouped: [] });
      }
      const ids = deptUsers.map(u=>u.id);
      where += ` AND t.assigned_to IN (${ids.map(()=>'?').join(',')})`;
      params.push(...ids);
    } else {
      // Regular user — sirf apni tasks
      where += ' AND t.assigned_to = ?';
      params.push(uid);
    }

    // Office/Factory segment filter
    const segT = segmentFilter(req);
    if (segT.param) { where += ' AND t.assigned_to IN (SELECT id FROM users WHERE staff_type=?)'; params.push(segT.param); }

    // All Tasks — Delegation me upcoming/future tasks bhi dikhao (taaki kal/parso ke task pehle se visible ho aur transfer ho sakein).
    // Checklist: by default future wale chhupao, BUT if includeFuture=1 query param diya hai (Transfer modal use karta hai)
    // to upcoming bhi dikhao taaki future checklist tasks bhi transfer ho sake.
    const includeFuture = req.query.includeFuture === '1' || req.query.includeFuture === 'true';
    if (!isDeleg && !includeFuture) {
      where += ' AND t.due_date <= CURRENT_DATE';
    }

    const [tasks] = await db.query(`SELECT t.id,'${type||'delegation'}' AS type,t.description,t.status,t.assigned_to,t.assigned_by,COALESCE(t.priority,'low') AS priority,${isDeleg?"COALESCE(t.approval,'no') AS approval,COALESCE(t.waiting_approval,0) AS waiting_approval,t.remarks,":"'no' AS approval,0 AS waiting_approval,t.remarks,"}t.doer_remark,TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date,TO_CHAR(t.created_at,'YYYY-MM-DD') AS assigned_on,TO_CHAR(t.completed_at,'YYYY-MM-DD HH12:MI AM') AS completed_at_ts,t.proof_image IS NOT NULL AS has_proof,t.proof_replaced,t.proof_video_id IS NOT NULL AS has_video,t.proof_video_replaced,u1.name AS "assignedToName",u2.name AS "assignedByName" FROM ${table} t JOIN users u1 ON t.assigned_to=u1.id JOIN users u2 ON t.assigned_by=u2.id ${where} ORDER BY t.due_date ASC`, params);

    // mine=1 mode me hamesha flat tasks return karte hain (grouped nahi)
    if (isMine) {
      return res.json({ tasks });
    }
    if (isAdmin || isHod || role === 'pc') {
      const grouped = {};
      tasks.forEach(t => {
        if (!grouped[t.assigned_to]) grouped[t.assigned_to] = { userId: t.assigned_to, name: t.assignedToName, tasks: [] };
        grouped[t.assigned_to].tasks.push(t);
      });
      return res.json({ grouped: Object.values(grouped) });
    }
    res.json({ tasks });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { type, desc, assignedTo, approverEmail, date, priority, approval, remarks, url, awaitingDueDate } = req.body;
    const isAdmin = req.session.role === 'admin';
    const isHod   = req.session.role === 'hod';
    const isUser  = req.session.role === 'user';
    // Admin, HOD and regular users can all assign to others; fallback to self if not specified
    const targetUser = (isAdmin || isHod || isUser) && assignedTo ? parseInt(assignedTo) : req.session.userId;
    const taskType = type || 'checklist';
    const skipDate = taskType === 'delegation' && !!awaitingDueDate;
    if (!desc || (!date && !skipDate)) return res.status(400).json({ error: 'Description and date required' });
    if (taskType === 'delegation') {
      // Approver: agar approverEmail diya hai to usse dhundo, warna logged-in user
      let assignedBy = req.session.userId;
      if (approverEmail) {
        const [aprRows] = await db.query('SELECT id FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1', [approverEmail]);
        if (aprRows.length) assignedBy = aprRows[0].id;
      }
      await db.query(
        `INSERT INTO delegation_tasks (description,assigned_to,assigned_by,due_date,status,priority,approval,remarks,url,awaiting_due_date) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [desc, targetUser, assignedBy, skipDate ? null : date, 'pending', priority||'low', approval||'no', remarks||'', url||null, skipDate ? 1 : 0]
      );
      // 📧 Send delegation email (non-blocking — fire and forget)
      (async () => {
        const target = await getNotifyTarget(targetUser);
        if (!target) return;
        const [aprRows] = await db.query('SELECT name FROM users WHERE id=? LIMIT 1', [assignedBy]);
        const assignerName = aprRows[0]?.name || 'Admin';
        await sendMail(
          target.email,
          `📋 New Task Assigned: ${(desc||'').slice(0,60)}`,
          delegationEmailHtml({
            assigneeName: target.name,
            assignerName,
            desc, dueDate: skipDate ? 'To be set by doer' : date,
            priority: priority||'low',
            approval: approval||'no',
            remarks: remarks||''
          })
        );
      })();
    } else {
      await db.query(`INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,remarks) VALUES (?,?,?,?,?,?,?)`, [desc, targetUser, req.session.userId, date, 'pending', priority||'low', remarks||'']);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.post('/api/tasks/bulk-checklist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { desc, assignedTo, priority, remarks, dates, frequency } = req.body;
    if (!desc || !assignedTo || !dates || !dates.length) return res.status(400).json({ error: 'Missing fields' });
    // frequency store hoti hai taaki reports (WhatsApp summary) me dikha sakein
    // aur frequency-wise delete/count filter kaam kare
    const freq = ['daily','weekly','alternative_week','monthly','quarterly','yearly'].includes(frequency) ? frequency : null;
    // Sunday par koi checklist task nahi banta. Dates client se aati hain,
    // isliye asli rok yahan hai — purana ya galat client Sunday bhej de to bhi
    // yahin chhant jaati hai. UTC se parse karke getUTCDay() liya hai taaki
    // server ka timezone din na badal de.
    const notSunday = d => new Date(String(d) + 'T00:00:00Z').getUTCDay() !== 0;
    const cleanDates = dates.filter(notSunday);
    if (!cleanDates.length) return res.status(400).json({ error: 'All the selected dates fall on a Sunday — Sunday tasks are skipped.' });
    const values = cleanDates.map(date => [desc, parseInt(assignedTo), req.session.userId, date, 'pending', priority||'low', remarks||'', freq]);
    await db.query(`INSERT INTO checklist_tasks (description,assigned_to,assigned_by,due_date,status,priority,remarks,frequency) VALUES ?`, [values]);
    res.json({ success: true, count: cleanDates.length, skippedSundays: dates.length - cleanDates.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Proof of work — photo base64 ke roop me seedha DB me store hoti hai ──
// Pehli baar upload = proof. Dobara upload = REPLACE (sirf ek baar allowed, galti sudharne ke liye).
// NOTE: task LIST queries me image kabhi select nahi karte (bahut bhaari ho jaata) —
// sirf has_proof flag jaata hai; asli image GET /api/tasks/:id/proof se aati hai.
app.post('/api/tasks/:id/proof', requireAuth, async (req, res) => {
  try {
    const { type, image } = req.body;
    if (!image) return res.status(400).json({ error: 'Photo required' });

    const table = getTable(type || 'delegation');
    const [rows] = await db.query(`SELECT id, assigned_to, proof_image IS NOT NULL AS has_proof, proof_replaced FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];

    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && task.assigned_to !== req.session.userId) return res.status(403).json({ error: 'Not allowed' });
    if (task.has_proof && task.proof_replaced) return res.status(400).json({ error: 'Photo has already been replaced once — it cannot be changed again' });

    const dataUrl = String(image);
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(dataUrl)) {
      return res.status(400).json({ error: 'Invalid image format' });
    }
    // ~8MB base64 se bada mat lo — frontend compress karke bhejta hai, ye sirf safety guard hai
    if (dataUrl.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Image is too large' });

    const isReplace = !!task.has_proof;
    await db.query(`UPDATE ${table} SET proof_image=?, proof_replaced=? WHERE id=?`,
      [dataUrl, isReplace ? 1 : 0, req.params.id]);

    res.json({ success: true, replaced: isReplace });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Proof photo dekhne ke liye — image alag se aati hai (list me nahi bhejte) ──
app.get('/api/tasks/:id/proof', requireAuth, async (req, res) => {
  try {
    const table = getTable(req.query.type || 'delegation');
    const [rows] = await db.query(`SELECT assigned_to, proof_image, proof_replaced FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    // Apni photo har koi dekh sakta hai; doosron ki sirf admin/hod/pc
    const role = req.session.role;
    const canSeeOthers = role === 'admin' || role === 'hod' || role === 'pc';
    if (!canSeeOthers && task.assigned_to !== req.session.userId) return res.status(403).json({ error: 'Not allowed' });
    if (!task.proof_image) return res.status(404).json({ error: 'No proof photo uploaded for this task' });
    res.json({ image: task.proof_image, replaced: task.proof_replaced });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Proof of work — VIDEO. Photo se bilkul alag slot hai (dono saath chal sakte hain) ──
// Video Drive par jaati hai, DB me sirf file id. Photo wale hi rules: pehli baar
// upload = proof, dobara = REPLACE (sirf ek baar).
// 25MB — Apps Script ka doPost payload ~50MB par cap hota hai aur base64 karne se
// size 33% badh jaata hai (25MB video ≈ 34MB payload). Isse zyada rakha to bade
// videos Apps Script ke andar hi silently fail hone lagenge.
const PROOF_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const PROOF_VIDEO_TYPES = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',   // iPhone
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',        // purane Android
};

// Video raw binary aati hai, base64 JSON me nahi — base64 se size 33% badh jaata
// aur upar wali express.json 12mb limit turant tut jaati.
app.post('/api/tasks/:id/proof-video', requireAuth,
  express.raw({ type: () => true, limit: PROOF_VIDEO_MAX_BYTES }),
  async (req, res) => {
  try {
    const folderId = extractDriveFolderId(process.env.GDRIVE_VIDEO_FOLDER_ID);
    if (!folderId) return res.status(500).json({ error: 'Video upload is not configured — GDRIVE_VIDEO_FOLDER_ID is missing' });

    const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = PROOF_VIDEO_TYPES[mime];
    if (!ext) return res.status(400).json({ error: 'Only MP4, MOV, WEBM, MKV or 3GP videos can be uploaded' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Video required' });

    const table = getTable(req.query.type || 'delegation');
    const [rows] = await db.query(`SELECT id, description, assigned_to, proof_video_id, proof_video_replaced FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];

    // Video feature sirf Admin aur HR ke liye
    const canVideo = req.session.role === 'admin' || await _isHRUser(req.session.userId);
    if (!canVideo) return res.status(403).json({ error: 'Not allowed' });
    if (task.proof_video_id && task.proof_video_replaced) return res.status(400).json({ error: 'Video has already been replaced once — it cannot be changed again' });

    const safeDesc = String(task.description || '').replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'task';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let fileId;
    try {
      const r = await callProofScript({
        action: 'upload',
        folderId,
        fileName: `proof_${req.params.id}_${safeDesc}_${stamp}.${ext}`,
        mimeType: mime,
        dataBase64: req.body.toString('base64'),
      });
      fileId = r.fileId;
    } catch (e) {
      console.error('Proof video upload failed:', e.message);
      return res.status(502).json({ error: 'Could not upload the video to Drive. Admin: check /api/admin/drive-check.' });
    }

    const oldFileId = task.proof_video_id;
    await db.query(`UPDATE ${table} SET proof_video_id=?, proof_video_mime=?, proof_video_replaced=? WHERE id=?`,
      [fileId, mime, oldFileId ? 1 : 0, req.params.id]);
    // Replace ke baad purani video Drive par pade rehne ka koi matlab nahi.
    // Fail ho jaaye to bhi upload successful hi hai — sirf log kar do.
    if (oldFileId) {
      callProofScript({ action: 'delete', fileId: oldFileId })
        .catch(e => console.error('Old proof video delete failed:', e.message));
    }
    res.json({ success: true, replaced: !!oldFileId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Proof video dekhne ke liye — Drive ka preview link ──
// Video khud Drive se chalti hai (Apps Script use "anyone with the link" bana deti
// hai), isliye app server par streaming ka koi load nahi. File id list queries me
// nahi bhejte — sirf has_video flag jaata hai aur id yahan role check ke baad milti
// hai, taaki app ke andar wahi rules lagein jo photo par lagte hain.
app.get('/api/tasks/:id/proof-video', requireAuth, async (req, res) => {
  try {
    const table = getTable(req.query.type || 'delegation');
    const [rows] = await db.query(`SELECT assigned_to, proof_video_id FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    // Video feature sirf Admin aur HR ke liye
    const canVideo = req.session.role === 'admin' || await _isHRUser(req.session.userId);
    if (!canVideo) return res.status(403).json({ error: 'Not allowed' });
    if (!task.proof_video_id) return res.status(404).json({ error: 'No proof video uploaded for this task' });

    res.json({
      fileId: task.proof_video_id,
      previewUrl: `https://drive.google.com/file/d/${task.proof_video_id}/preview`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${task.proof_video_id}`,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ══════════════════════════════════════════════════════
// DOER REMARK — "task kyun complete nahi hua" ka reason.
// Rules: doer sirf EK baar add kar sakta hai (khaali ho tabhi), phir locked —
//        na edit na delete. Admin kabhi bhi edit/delete kar sakta hai.
// (Ye assigner ke purane `remarks` field se bilkul alag hai.)
// ══════════════════════════════════════════════════════

// View — remark + canEdit (sirf admin edit/delete kar sakta hai)
app.get('/api/tasks/:id/remark', requireAuth, async (req, res) => {
  try {
    const table = getTable(req.query.type || 'delegation');
    const [rows] = await db.query(`SELECT assigned_to, doer_remark FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    const role = req.session.role;
    const canSee = role === 'admin' || role === 'hod' || role === 'pc' || task.assigned_to === req.session.userId;
    if (!canSee) return res.status(403).json({ error: 'Not allowed' });
    res.json({ remark: task.doer_remark || '', canEdit: role === 'admin' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Add / edit — doer sirf pehli baar (khaali par), admin kabhi bhi
app.post('/api/tasks/:id/remark', requireAuth, async (req, res) => {
  try {
    const table = getTable(req.query.type || req.body?.type || 'delegation');
    const remark = typeof req.body?.remark === 'string' ? req.body.remark.trim() : '';
    if (!remark) return res.status(400).json({ error: 'Remark is required' });
    if (remark.length > 2000) return res.status(400).json({ error: 'Remark is too long (max 2000 characters)' });

    const [rows] = await db.query(`SELECT assigned_to FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    const isAdmin = req.session.role === 'admin';
    const isDoer = task.assigned_to === req.session.userId;

    if (isAdmin) {
      // Admin: kabhi bhi set/edit
      await db.query(`UPDATE ${table} SET doer_remark=? WHERE id=?`, [remark, req.params.id]);
      return res.json({ success: true, remark });
    }
    if (!isDoer) return res.status(403).json({ error: 'Not allowed' });

    // Doer: sirf pehli baar. Atomic conditional UPDATE — do concurrent clicks (TOCTOU)
    // me sirf pehla set karega; doosre par affectedRows=0 → locked.
    const [u] = await db.query(
      `UPDATE ${table} SET doer_remark=? WHERE id=? AND (doer_remark IS NULL OR doer_remark='')`,
      [remark, req.params.id]);
    if (!u.affectedRows) return res.status(400).json({ error: 'Remark already added — it cannot be changed. Only an admin can edit it.' });
    res.json({ success: true, remark });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Delete — sirf admin
app.delete('/api/tasks/:id/remark', requireAuth, requireAdmin, async (req, res) => {
  try {
    const table = getTable(req.query.type || 'delegation');
    const [r] = await db.query(`UPDATE ${table} SET doer_remark=NULL WHERE id=?`, [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Video storage setup theek hai ya nahi — pehli upload se pehle yahan check karo ──
app.get('/api/admin/drive-check', requireAuth, requireAdmin, async (req, res) => {
  const folderId = extractDriveFolderId(process.env.GDRIVE_VIDEO_FOLDER_ID);
  if (!process.env.APPS_SCRIPT_UPLOAD_URL) return res.json({ ok: false, problem: 'APPS_SCRIPT_UPLOAD_URL is not set in .env' });
  if (!folderId) return res.json({ ok: false, problem: 'GDRIVE_VIDEO_FOLDER_ID is not set in .env' });
  try {
    const r = await callProofScript({ action: 'ping', folderId });
    res.json({ ok: true, folderId, folderName: r.folderName, uploadsAs: r.owner });
  } catch (e) {
    res.json({ ok: false, folderId, problem: e.message });
  }
});

app.put('/api/tasks/:id/status', requireAuth, async (req, res) => {
  try {
    const { status, type, newDate, reason } = req.body;
    const table = getTable(type||'delegation');
    const isAdmin = req.session.role === 'admin';
    const isPC = req.session.role === 'pc';
    const uid = req.session.userId;
    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    if (!isAdmin && !isPC && task.assigned_to !== uid) return res.status(403).json({ error: 'Not allowed' });
    // NOTE: proof-of-work photo abhi OPTIONAL hai — bina photo ke bhi Done ho sakta hai.
    // Mandatory karna ho to yahan task.proof_image ka check wapas laga dena.
    if (status === 'completed' && task.waiting_approval) {
      await db.query(`DELETE FROM task_approvals WHERE task_id=? AND task_type=? AND status='pending'`, [req.params.id, type]);
      if (type === 'checklist') await db.query(`UPDATE ${table} SET status='completed',completed_at=NOW() WHERE id=?`, [req.params.id]);
      else await db.query(`UPDATE ${table} SET status='completed',waiting_approval=0,completed_at=NOW() WHERE id=?`, [req.params.id]);
      return res.json({ success: true, needsApproval: false });
    }
    const needsApproval = type === 'delegation' && task.approval === 'yes';
    if (needsApproval && !isAdmin && !isPC) {
      const [existing] = await db.query(`SELECT id FROM task_approvals WHERE task_id=? AND task_type=? AND status='pending'`, [req.params.id, type]);
      if (existing[0]) return res.status(400).json({ error: 'Approval already pending' });
      await db.query(`INSERT INTO task_approvals (task_id,task_type,requested_by,requested_to,action_type,status,note) VALUES (?,?,?,?,?,'pending',?)`, [req.params.id, type, uid, task.assigned_by, status, reason||'']);
      if (newDate && status === 'revised') await db.query(`UPDATE ${table} SET waiting_approval=1,due_date=? WHERE id=?`, [newDate, req.params.id]);
      else await db.query(`UPDATE ${table} SET waiting_approval=1 WHERE id=?`, [req.params.id]);
      return res.json({ success: true, needsApproval: true });
    }
    if (newDate && status === 'revised') await db.query(`UPDATE ${table} SET status=?,waiting_approval=0,due_date=?,completed_at=NULL WHERE id=?`, [status, newDate, req.params.id]);
    else {
      // completed_at: status='completed' hone par aaj ki date, warna NULL (dobara pending/revised)
      // checklist_tasks mein waiting_approval column nahi hota
      if (type === 'checklist') await db.query(`UPDATE ${table} SET status=?,completed_at=CASE WHEN ?='completed' THEN NOW() ELSE NULL END WHERE id=?`, [status, status, req.params.id]);
      else await db.query(`UPDATE ${table} SET status=?,waiting_approval=0,completed_at=CASE WHEN ?='completed' THEN NOW() ELSE NULL END WHERE id=?`, [status, status, req.params.id]);
    }
    res.json({ success: true, needsApproval: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.get('/api/tasks/:id/detail', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type } = req.query;
    const table = getTable(type||'delegation');
    const [rows] = await db.query(`SELECT t.*,TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date FROM ${table} t WHERE t.id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.put('/api/tasks/:id/edit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type, desc, date, priority, approval, remarks } = req.body;
    const table = getTable(type||'delegation');
    if (type === 'delegation') await db.query(`UPDATE ${table} SET description=?,due_date=?,priority=?,approval=?,remarks=? WHERE id=?`, [desc, date, priority||'low', approval||'no', remarks||'', req.params.id]);
    else await db.query(`UPDATE ${table} SET description=?,due_date=?,remarks=? WHERE id=?`, [desc, date, remarks||'', req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.delete('/api/tasks/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type, skipCompleted } = req.query;
    const table = getTable(type||'delegation');
    // v16: bulk-delete flows pass skipCompleted=1 — refuse to delete completed tasks
    if (skipCompleted === '1' || skipCompleted === 'true') {
      const [rows] = await db.query(`SELECT status FROM ${table} WHERE id=?`, [req.params.id]);
      if (rows[0] && rows[0].status === 'completed') {
        return res.status(400).json({ error: 'Completed tasks cannot be deleted in bulk', skipped: true });
      }
    }
    await db.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Bulk delete by user — v16: completed tasks excluded
app.delete('/api/tasks/user/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type } = req.query;
    const table = getTable(type || 'delegation');
    await db.query(`DELETE FROM ${table} WHERE assigned_to = ? AND status != 'completed'`, [req.params.userId]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Transfer pending tasks to today
app.put('/api/tasks/user/:userId/transfer-today', requireAuth, requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { type } = req.query;
    const table = getTable(type || 'delegation');
    await db.query(`UPDATE ${table} SET due_date=? WHERE assigned_to=? AND status='pending'`,
      [today, req.params.userId]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.delete('/api/tasks/delete-by-date', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'Date required' });
    const [result] = await db.query('DELETE FROM checklist_tasks WHERE due_date=?', [date]);
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Count checklist tasks for a user (all time or by year, optionally filtered by frequency).
// v16: completed tasks are EXCLUDED — bulk delete sirf pending/revised pe lagti hai.
app.get('/api/tasks/checklist-year-count', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, year, frequency, description } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const where = ['assigned_to=?', "status!='completed'"];
    const params = [userId];
    if (year && year !== 'all') { where.push('EXTRACT(YEAR FROM due_date)=?'); params.push(year); }
    if (frequency && frequency !== 'all') { where.push('frequency=?'); params.push(frequency); }
    if (description) { where.push('description=?'); params.push(description); } // ek specific task
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM checklist_tasks WHERE ${where.join(' AND ')}`, params);
    res.json({ count: rows[0].count });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Ek employee ke distinct checklist task naam (bulk-delete ke "specific task"
// filter ke liye). Completed exclude; frequency optional.
app.get('/api/tasks/checklist-task-names', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, frequency } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const where = ['assigned_to=?', "status!='completed'"];
    const params = [userId];
    if (frequency && frequency !== 'all') { where.push('frequency=?'); params.push(frequency); }
    const [rows] = await db.query(
      `SELECT description, COUNT(*) AS count FROM checklist_tasks
       WHERE ${where.join(' AND ')} GROUP BY description ORDER BY description`, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Delete checklist tasks for a user — optionally filtered by frequency and/or a specific task.
// v16: completed tasks NEVER deleted in bulk; frequency filter respected.
app.post('/api/tasks/checklist-year-delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, frequency, description, descriptions } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const where = ['assigned_to=?', "status!='completed'"];
    const params = [userId];
    if (frequency && frequency !== 'all') { where.push('frequency=?'); params.push(frequency); }
    // Ek ya kai specific task naam — descriptions[] (multi) ya description (single). Khaali = poori category.
    const descs = Array.isArray(descriptions) ? descriptions.filter(d => typeof d === 'string' && d)
                : (description ? [description] : []);
    if (descs.length) { where.push(`description IN (${descs.map(() => '?').join(',')})`); params.push(...descs); }
    const [result] = await db.query(
      `DELETE FROM checklist_tasks WHERE ${where.join(' AND ')}`, params);
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Bulk EDIT checklist tasks — employee (+ frequency / specific task) ke pending/revised
// tasks par priority / due-date (shift ya set) / description (rename) ek saath.
// Completed tasks NEVER touch hote.
app.post('/api/tasks/checklist-bulk-edit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, frequency, description, newDescription, priority, shiftDays, newDueDate } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // SET banao — jo diya wahi badlega
    const sets = [], setParams = [];
    if (priority) {
      if (!['low','medium','high'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
      sets.push('priority=?'); setParams.push(priority);
    }
    if (newDueDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) return res.status(400).json({ error: 'Invalid date' });
      sets.push('due_date=?'); setParams.push(newDueDate);
    } else if (shiftDays !== undefined && shiftDays !== null && shiftDays !== '' && Number(shiftDays) !== 0) {
      const n = parseInt(shiftDays, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'Invalid shift days' });
      sets.push('due_date = due_date + make_interval(days => ?::int)'); setParams.push(n);
    }
    if (newDescription && String(newDescription).trim()) {
      // Rename tabhi jab ek specific task target ho (warna sab tasks ka naam ek ho jaayega)
      if (!description) return res.status(400).json({ error: 'Select a specific task first to rename it' });
      sets.push('description=?'); setParams.push(String(newDescription).trim());
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing selected to change' });

    // WHERE — completed kabhi nahi
    const where = ['assigned_to=?', "status!='completed'"];
    const whereParams = [userId];
    if (frequency && frequency !== 'all') { where.push('frequency=?'); whereParams.push(frequency); }
    if (description) { where.push('description=?'); whereParams.push(description); }

    const [r] = await db.query(
      `UPDATE checklist_tasks SET ${sets.join(', ')} WHERE ${where.join(' AND ')}`,
      [...setParams, ...whereParams]);
    res.json({ success: true, updated: r.affectedRows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

require('./routes/queries')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// APPROVALS
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/approvals')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// LEAVES
// ──────────────────────────────────────────────────────
// Full-day leave approve hone par us user ke un dates ke PENDING checklist tasks
// agle working day par shift ho jaate hain (week off / extra off / doosri approved
// leave dates skip karke). Kaam delete nahi hota — bas aage khisak jaata hai,
// isliye MIS score bhi galat pending/overdue se kharab nahi hota.
// ══════════════════════════════════════════════════════
// Chhutti / agla working day ka hisaab — sirf date logic, isliye alag file me.
const { parseWeekOff: _parseWeekOff, parseExtraOff: _parseExtraOff,
        isExtraOff: _isExtraOff, toISO: _toISO,
        nextWorkingDay: _nextWorkingDay } = require('./lib/workdays');

async function shiftChecklistTasksForLeave(userId, fromISO, toISO) {
  const [uRows] = await db.query('SELECT week_off, extra_off FROM users WHERE id=?', [userId]);
  if (!uRows.length) return 0;
  const weekOff = _parseWeekOff(uRows[0].week_off);
  const extraOff = _parseExtraOff(uRows[0].extra_off);

  // Is user ki saari approved full-day leave dates — shift karte waqt inhe bhi skip karna hai
  const [lvRows] = await db.query(
    `SELECT TO_CHAR(from_date,'YYYY-MM-DD') AS f, TO_CHAR(to_date,'YYYY-MM-DD') AS t
     FROM leave_requests WHERE user_id=? AND status='approved' AND leave_type='full_day'`, [userId]);
  const leaveDates = new Set();
  for (const lv of lvRows) {
    const d = new Date(lv.f + 'T00:00:00'), end = new Date(lv.t + 'T00:00:00');
    let guard = 0;
    while (d <= end && guard++ < 400) { leaveDates.add(_toISO(d)); d.setDate(d.getDate()+1); }
  }

  // Sirf PENDING tasks shift hote hain — completed ko haath nahi lagate
  const [tasks] = await db.query(
    `SELECT id, TO_CHAR(due_date,'YYYY-MM-DD') AS due FROM checklist_tasks
     WHERE assigned_to=? AND status='pending' AND due_date BETWEEN ? AND ?`, [userId, fromISO, toISO]);

  let shifted = 0;
  for (const t of tasks) {
    const next = _nextWorkingDay(t.due, weekOff, extraOff, leaveDates);
    if (!next) continue;
    await db.query('UPDATE checklist_tasks SET due_date=? WHERE id=?', [next, t.id]);
    shifted++;
  }
  return shifted;
}

// HR department wale users sabki leave dekh/approve kar sakte hain (role
// chahe 'user' hi ho). Department string se pehchaan — koi extra column nahi.
async function _isHRUser(uid) {
  try {
    const [r] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
    return (r[0]?.department || '').trim().toLowerCase() === 'hr';
  } catch (_) { return false; }
}

// List — role ke hisaab se: user apni, HOD apne dept ki, admin/pc/HR sabki
app.get('/api/leaves', requireAuth, async (req, res) => {
  try {
    const role = req.session.role, uid = req.session.userId;
    let where = '', params = [];
    if (role === 'admin' || role === 'pc' || await _isHRUser(uid)) {
      // sab dikhega
    } else if (role === 'hod') {
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      where = 'WHERE u.department=?'; params = [me[0]?.department || ''];
    } else {
      where = 'WHERE lr.user_id=?'; params = [uid];
    }
    // Office/Factory segment — admin/pc ke liye hi relevant (unhi ka where khali hota hai)
    const segL = segmentFilter(req, 'u');
    if (segL.param) { where += (where ? ' AND' : 'WHERE') + ' u.staff_type=?'; params.push(segL.param); }
    const [rows] = await db.query(
      `SELECT lr.id, lr.user_id, u.name AS "userName", u.department, u.staff_type, lr.leave_type,
              TO_CHAR(lr.from_date,'YYYY-MM-DD') AS from_date,
              TO_CHAR(lr.to_date,'YYYY-MM-DD') AS to_date,
              lr.reason, lr.status, lr.approver_note, a.name AS "approverName",
              TO_CHAR(lr.created_at,'YYYY-MM-DD') AS applied_on
       FROM leave_requests lr
       JOIN users u ON lr.user_id=u.id
       LEFT JOIN users a ON lr.approver_id=a.id
       ${where} ORDER BY lr.id DESC LIMIT 500`, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Apply — koi bhi logged-in user apni leave apply kar sakta hai
app.post('/api/leaves', requireAuth, async (req, res) => {
  try {
    const { leave_type, from_date, to_date, reason } = req.body;
    const valid = ['full_day','half_day']; // Work From Home hata diya (purane records phir bhi display hote hain)
    if (!valid.includes(leave_type)) return res.status(400).json({ error: 'Invalid leave type' });
    if (!from_date || !to_date) return res.status(400).json({ error: 'From and To date required' });
    if (from_date > to_date) return res.status(400).json({ error: 'From date must be on or before To date' });
    if (!(reason||'').trim()) return res.status(400).json({ error: 'Reason required' });
    await db.query(
      `INSERT INTO leave_requests (user_id, leave_type, from_date, to_date, reason, status) VALUES (?,?,?,?,?,'pending')`,
      [req.session.userId, leave_type, from_date, to_date, reason.trim()]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Approve / reject — admin sabki, HOD sirf apne department ki
app.put('/api/leaves/:id', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    // note ko string me normalize — non-string (number/array/object) aaye to reason skip.
    // Isse DB bind (mysql2 array ko '?' me galat expand karta hai) aur WA message dono safe.
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    if (!['approved','rejected'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
    const role = req.session.role, uid = req.session.userId;
    const [rows] = await db.query(
      `SELECT lr.*, TO_CHAR(lr.from_date,'YYYY-MM-DD') AS from_iso,
              TO_CHAR(lr.to_date,'YYYY-MM-DD') AS to_iso,
              u.department, u.name AS user_name, u.phone AS user_phone
       FROM leave_requests lr JOIN users u ON lr.user_id=u.id WHERE lr.id=?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Leave request not found' });
    const lv = rows[0];

    let allowed = role === 'admin';
    if (!allowed && role === 'hod') {
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      allowed = (me[0]?.department || '') === (lv.department || '');
    }
    if (!allowed) allowed = await _isHRUser(uid); // HR sabki approve kar sakta hai
    if (!allowed) return res.status(403).json({ error: 'Not allowed' });
    if (lv.status !== 'pending') return res.status(400).json({ error: 'This request has already been decided' });
    if (lv.user_id === uid) return res.status(400).json({ error: 'You cannot approve your own leave' });

    await db.query('UPDATE leave_requests SET status=?, approver_id=?, approver_note=?, decided_at=NOW() WHERE id=?',
      [action, uid, note || '', req.params.id]);

    // Leave approve hone par tasks SHIFT NAHI hote — apni original due date par hi
    // rehte hain (pending/overdue dikhenge). Pehle full-day leave par checklist tasks
    // next working day shift hote the; ab wo behaviour band hai (client ki demand).
    const shifted = 0;

    // Applicant ko WhatsApp par decision bhejo — fire-and-forget, taaki WA fail hone
    // par bhi approve/reject ka response na ruke aur na toote. Event notification hai,
    // isliye sirf WA_ENABLED par chalti hai (morning-blast wala flag isse alag hai).
    if (WA_ENABLED) {
      // Notification best-effort hai — message banane/bhejne me koi bhi error
      // (sync ya async) approve/reject ke response ko na toote.
      try {
        const phone = normalizeWhatsAppPhone(lv.user_phone);
        if (phone) {
          const msg = buildLeaveDecisionMessage({
            name: lv.user_name, action, leaveType: lv.leave_type,
            fromISO: lv.from_iso, toISO: lv.to_iso, approver: req.session.name, note
          });
          sendWhatsApp(phone, msg).catch(e => console.error('  ❌ Leave decision WhatsApp failed:', e.message));
        }
      } catch (e) {
        console.error('  ❌ Leave decision WhatsApp prep failed:', e.message);
      }
    }

    res.json({ success: true, shifted });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Cancel — apni pending request (admin koi bhi hata sakta hai)
app.delete('/api/leaves/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM leave_requests WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const lv = rows[0];
    const isAdmin = req.session.role === 'admin';
    if (!isAdmin && lv.user_id !== req.session.userId) return res.status(403).json({ error: 'Not allowed' });
    if (!isAdmin && lv.status !== 'pending') return res.status(400).json({ error: 'A leave that has already been decided cannot be cancelled' });
    await db.query('DELETE FROM leave_requests WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ══════════════════════════════════════════════════════
// MIS
// ══════════════════════════════════════════════════════
app.get('/api/mis', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Dates required' });
    const isHod = req.session.role === 'hod';
    const isSelfOnly = req.session.role === 'user'; // regular user — sirf apni MIS
    // HOD ke liye apne department ka filter; regular user ke liye sirf apna
    let deptFilter = '';
    let deptParams = [start, end];
    if (isSelfOnly) {
      deptFilter = 'AND u.id=?';
      deptParams = [start, end, req.session.userId];
    } else if (isHod) {
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [req.session.userId]);
      const dept = me[0]?.department || '';
      deptFilter = 'AND u.department=?';
      deptParams = [start, end, dept];
    }
    // Office/Factory segment
    const segM = segmentFilter(req, 'u');
    if (segM.param) { deptFilter += segM.clause; deptParams.push(segM.param); }

    const calc = rows => rows.map(r => {
      const overdue = parseInt(r.overdue)||0, notOnTime = parseInt(r.not_on_time)||0;
      const score = calcMisScore({ total: r.total, pending: r.pending, overdue, notOnTime, revised: r.revised });
      const notOnTimeScore = notOnTimeScoreOf(r.total, notOnTime);
      return { ...r, delayed: overdue, notOnTime, notOnTimeScore, score };
    });
    // not_on_time = completed tasks jinki completed_at, due_date ke baad hai (late complete hue)
    const [delRows] = await db.query(`SELECT u.id AS "userId",u.name,COUNT(*) AS total,SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN t.status='revised' THEN 1 ELSE 0 END) AS revised,SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN t.status='completed' AND t.completed_at IS NOT NULL AND DATE(t.completed_at)>t.due_date THEN 1 ELSE 0 END) AS not_on_time FROM delegation_tasks t JOIN users u ON t.assigned_to=u.id WHERE t.due_date BETWEEN ? AND ? ${deptFilter} GROUP BY u.id,u.name ORDER BY u.name`, deptParams);
    const [chlRows] = await db.query(`SELECT u.id AS "userId",u.name,COUNT(*) AS total,SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,0 AS revised,SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue,SUM(CASE WHEN t.status='completed' AND t.completed_at IS NOT NULL AND DATE(t.completed_at)>t.due_date THEN 1 ELSE 0 END) AS not_on_time FROM checklist_tasks t JOIN users u ON t.assigned_to=u.id WHERE t.due_date BETWEEN ? AND ? ${deptFilter} GROUP BY u.id,u.name ORDER BY u.name`, deptParams);
    res.json({ delegation: calc(delRows), checklist: calc(chlRows) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Admin-only: date range daalo -> saare users ki full MIS report (Checklist +
// Delegation, har user ke full task table ke saath) ek hi PDF me. Har user ki
// har section wahi layout use karta hai jo pop-up / WhatsApp MIS me hai.
app.get('/api/mis/combined-pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Start and end date required' });
    const todayISO = _istParts().dateStr;
    const period = {
      start, end,
      startDMY: _fmtDMY(new Date(`${start}T12:00:00`)),
      endDMY: _fmtDMY(new Date(`${end}T12:00:00`))
    };
    if (!(await _ensureMisLogo())) { /* logo optional — text fallback dikhega */ }

    // Office/Factory segment (MIS page ke toggle jaisa)
    const segM = segmentFilter(req, 'u');
    const params = [start, end];
    let segClause = '';
    if (segM.param) { segClause = segM.clause; params.push(segM.param); }

    const detailSql = (table) => `
      SELECT u.id AS user_id, u.name AS user_name, u.department,
             t.description, t.status, t.doer_remark,
             TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_iso,
             TO_CHAR(t.due_date,'DD-MM-YYYY') AS due_fmt,
             TO_CHAR(t.completed_at,'YYYY-MM-DD') AS completed_iso,
             TO_CHAR(t.completed_at,'DD-MM-YYYY') AS completed_fmt,
             ub.name AS assigned_by_name
      FROM ${table} t
      JOIN users u ON t.assigned_to = u.id
      LEFT JOIN users ub ON t.assigned_by = ub.id
      WHERE t.due_date BETWEEN ? AND ?${segClause}
      ORDER BY u.name, t.due_date ASC, t.id ASC`;

    const [chlRows] = await db.query(detailSql('checklist_tasks'), params);
    const [delRows] = await db.query(detailSql('delegation_tasks'), params);

    const group = (rows) => {
      const m = new Map();
      for (const r of rows) {
        if (!m.has(r.user_id)) m.set(r.user_id, { id: r.user_id, name: r.user_name, department: r.department, tasks: [] });
        m.get(r.user_id).tasks.push(r);
      }
      return m;
    };
    const chlByUser = group(chlRows), delByUser = group(delRows);

    // Users ka ordered union (naam se sort) — dono me se jinke tasks hain
    const names = new Map();
    for (const [id, u] of chlByUser) names.set(id, u.name);
    for (const [id, u] of delByUser) if (!names.has(id)) names.set(id, u.name);
    const orderedIds = [...names.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(e => e[0]);

    const statsOf = (tasks) => {
      const s = { total: tasks.length, completed: 0, pending: 0, overdue: 0, notOnTime: 0, revised: 0 };
      for (const t of tasks) {
        if (t.status === 'completed') {
          s.completed++;
          if (t.completed_iso && t.due_iso && t.completed_iso > t.due_iso) s.notOnTime++;
        } else if (t.status === 'revised') {
          s.revised++;
        } else {
          s.pending++;
          if (t.due_iso && t.due_iso < todayISO) s.overdue++;
        }
      }
      s.score = calcMisScore(s);
      return s;
    };

    // Har user: pehle Checklist section, phir Delegation section (jinke tasks ho)
    const allBufs = [];
    for (const uid of orderedIds) {
      for (const [byUser, label] of [[chlByUser, 'Checklist Tasks'], [delByUser, 'Delegation Tasks']]) {
        const u = byUser.get(uid);
        if (!u || !u.tasks.length) continue;
        const s = statsOf(u.tasks);
        const emp = { id: u.id, name: u.name, department: u.department, sectionLabel: label };
        const bufs = renderMISPageBuffers(emp, s, period, u.tasks, todayISO, MIS_PDF_ROWS_PER_PAGE);
        if (bufs) allBufs.push(...bufs);
      }
    }
    if (!allBufs.length) return res.status(404).json({ error: 'No tasks found in this date range' });

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="All-Users-MIS-${start}_to_${end}.pdf"`);
    doc.pipe(res);
    for (const b of allBufs) {
      const img = doc.openImage(b);
      doc.addPage({ size: [img.width, img.height], margin: 0 });
      doc.image(img, 0, 0);
    }
    doc.end();
  } catch (err) {
    console.error('combined-pdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── FMS Dashboard — row-level pending tasks (like delegation/checklist) ──
app.get('/api/fms-dashboard', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const role = req.session.role;
    const isAdmin = role === 'admin' || role === 'pc';
    const isHod = role === 'hod';
    const filterEmployee = req.query.employee;

    const today = new Date().toISOString().split('T')[0];

    // Determine which user IDs to show
    let targetUserIds = null; // null = all (admin)
    if (isAdmin && filterEmployee && filterEmployee !== 'all') {
      targetUserIds = [parseInt(filterEmployee)];
    } else if (isHod) {
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      const dept = me[0]?.department || '';
      if (filterEmployee && filterEmployee !== 'all') {
        targetUserIds = [parseInt(filterEmployee)];
      } else {
        const [deptUsers] = await db.query('SELECT id FROM users WHERE department=? AND role NOT IN (?,?)', [dept, 'admin', 'hod']);
        targetUserIds = deptUsers.map(u => u.id);
        if (!targetUserIds.length) return res.json({ rows: [], pendingCount: 0, inFms: false });
      }
    } else {
      // Regular employee — only their own steps
      targetUserIds = [uid];
    }

    // Get FMS sheets
    let fmsList;
    if (isAdmin && !filterEmployee || (isAdmin && filterEmployee === 'all')) {
      [fmsList] = await db.query('SELECT * FROM fms_sheets ORDER BY fms_name ASC');
    } else {
      // Get FMS where targetUserIds are doers
      [fmsList] = await db.query(
        `SELECT DISTINCT fs.* FROM fms_sheets fs
         JOIN fms_steps fst ON fst.fms_id=fs.id
         JOIN fms_step_doers fsd ON fsd.step_id=fst.id
         WHERE fsd.user_id IN (${targetUserIds.map(()=>'?').join(',')})
         ORDER BY fs.fms_name ASC`, targetUserIds);
    }

    // inFms=false ka matlab: ye user kisi bhi FMS step ka doer nahi hai.
    // Client isse "aaj kuch pending nahi" se alag treat karta hai —
    // non-member doer ko dashboard par FMS section dikhta hi nahi.
    if (!fmsList.length) return res.json({ rows: [], pendingCount: 0, inFms: false });

    const allRows = [];

    for (const sheet of fmsList) {
      const fmsName = sheet.fms_name || sheet.sheet_name;

      // Get steps for this FMS that are assigned to targetUserIds
      let steps;
      if (isAdmin && (!filterEmployee || filterEmployee === 'all')) {
        [steps] = await db.query('SELECT * FROM fms_steps WHERE fms_id=? ORDER BY step_order ASC', [sheet.id]);
      } else {
        [steps] = await db.query(
          `SELECT DISTINCT fst.* FROM fms_steps fst
           JOIN fms_step_doers fsd ON fsd.step_id=fst.id
           WHERE fst.fms_id=? AND fsd.user_id IN (${targetUserIds.map(()=>'?').join(',')})
           ORDER BY fst.step_order ASC`, [sheet.id, ...targetUserIds]);
      }
      if (!steps.length) continue;

      // Doers — saare steps ke ek hi query me
      const doersByStep = await _fmsDoersByStep(steps.map(s => s.id));
      for (const step of steps) {
        const doers = doersByStep[step.id] || [];
        step.doerNames = doers.map(d => d.name).join(', ');
        step.doerIds = doers.map(d => d.user_id);
      }

      try {
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
        const tabName = sheet.sheet_name || 'Sheet1';
        const headerRowIdx = (sheet.header_row || 1) - 1;

        const filteredSteps = steps; // fix: was undefined, use steps array
        // Poori tab padho → headers milte hi har step ke columns NAAM se heal karo (shift-safe)
        const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
        const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
        const sheetData = response.data.values || [];
        const headers = sheetData[headerRowIdx] || [];
        const _needHeal = filteredSteps.some(s => s.plan_col_name || s.actual_col_name || s.show_col_names);
        if (_needHeal) filteredSteps.forEach(s => _healStepCols(s, headers));
        // show_cols ke indices — All Tasks ke "Details" me inhi ki values dikhti hain.
        const showColsByStep = filteredSteps.map(s => {
          try { return JSON.parse(s.show_cols || '[]').filter(n => Number.isInteger(n) && n >= 0); }
          catch { return []; }
        });
        const dataRows = sheetData.slice(headerRowIdx + 1);

        // Har tarah ka whitespace (normal, NBSP, zero-width, BOM) hata do — warna
        // sirf invisible chars wali cell "bhari hui" lagti hai aur row chhup jaati hai.
        const blankClean = v => (v || '').toString().replace(/[\s ​-‍﻿]+/g, '');

        for (let si = 0; si < steps.length; si++) {
          const step = steps[si];
          const showCols = showColsByStep[si];
          const planIdx = colToIdx(step.plan_col);
          const actualIdx = colToIdx(step.actual_col);
          if (planIdx < 0 || actualIdx < 0) continue;

          dataRows.forEach((row, i) => {
            const planVal = (row[planIdx] || '').trim();
            const actualVal = (row[actualIdx] || '').trim();
            if (!blankClean(planVal) || blankClean(actualVal)) return; // skip if no plan or already done

            // Parse plan date — try to extract date from value
            // planVal "2026-04-07" / "07/04/2026" / plain text ho sakta hai,
            // aage " 14:30" ya " 14:30:00" jaisa time bhi laga ho sakta hai.
            let planDate = '';
            let planTime = '';
            const dateMatch = planVal.match(/(\d{4}-\d{2}-\d{2})|(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
            if (dateMatch) {
              const raw = dateMatch[0];
              if (raw.includes('-') && raw.length === 10 && raw[4] === '-') {
                planDate = raw; // already YYYY-MM-DD
              } else {
                // DD/MM/YYYY → YYYY-MM-DD
                const parts = raw.split(/[\/\-]/);
                if (parts.length === 3) planDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
              }
              // Date ke baad kahin bhi HH:MM ya HH:MM:SS
              const after = planVal.slice(dateMatch.index + raw.length);
              const timeMatch = after.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
              if (timeMatch) {
                const hh = timeMatch[1].padStart(2,'0');
                const mm = timeMatch[2];
                const ss = timeMatch[3];
                planTime = ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
              }
            }

            // isLate: plan date is in the past and still pending
            const isLate = planDate && planDate < today;

            // "details" — pehle 5 configured show_cols, header + value ke saath.
            // Admin ne koi column nahi chuna (show_cols khaali) to Admin UI ka
            // "BLANK = SHOW ALL" wala vaada nibhao: pehle 5 aise columns dikhao
            // jinme header bhi ho aur is row me value bhi. Pehle yahan khaali
            // list jaati thi, jisse Details column bilkul khali dikhta tha.
            let colsToShow = showCols || [];
            if (!colsToShow.length) {
              colsToShow = [];
              for (let ci = 0; ci < headers.length && colsToShow.length < 5; ci++) {
                if (ci === planIdx || ci === actualIdx) continue;   // ye alag column me pehle se hain
                if (!String(headers[ci] || '').trim()) continue;
                if (!String(row[ci] || '').trim()) continue;
                colsToShow.push(ci);
              }
            }
            const details = [];
            for (const ci of colsToShow.slice(0, 5)) {
              details.push({
                header: headers[ci] || `Col ${idxToCol(ci)}`,
                value: (row[ci] || '').toString().trim()
              });
            }

            allRows.push({
              fmsName,
              fmsId: sheet.id,
              stepName: step.step_name,
              stepId: step.id,
              doer: step.doerNames || '—',
              planValue: planVal,
              planDate: planDate || '',
              planTime: planTime || '',
              isLate,
              rowNumber: headerRowIdx + 1 + i + 1,
              details
            });
          });
        }
      } catch(e) {
        // Skip sheet on error, don't fail whole request
      }
    }

    res.json({ rows: allRows, pendingCount: allRows.length, inFms: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.get('/api/mis/detail', requireAuth, async (req, res) => {
  try {
    let { userId, type, start, end } = req.query;
    if (!userId || !start || !end) return res.status(400).json({ error: 'Missing params' });
    // Regular user sirf apni detail dekh sakta hai — kisi aur ka userId maang bhi le to apna hi force
    if (req.session.role === 'user') userId = req.session.userId;
    const table = type === 'delegation' ? 'delegation_tasks' : 'checklist_tasks';
    const [tasks] = await db.query(`SELECT t.id,t.description,t.status,t.doer_remark,TO_CHAR(t.due_date,'YYYY-MM-DD') AS due_date,TO_CHAR(t.completed_at,'YYYY-MM-DD') AS completed_at,TO_CHAR(t.completed_at,'YYYY-MM-DD HH12:MI AM') AS completed_at_ts,t.proof_image IS NOT NULL AS has_proof,t.proof_video_id IS NOT NULL AS has_video,u2.name AS assigned_by_name FROM ${table} t JOIN users u2 ON t.assigned_by=u2.id WHERE t.assigned_to=? AND t.due_date BETWEEN ? AND ? ORDER BY t.due_date ASC`, [userId, start, end]);
    res.json({ tasks });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── All MIS — per employee combined score ──
app.get('/api/mis/all', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Dates required' });
    const isHod = req.session.role === 'hod';
    const isSelfOnly = req.session.role === 'user'; // regular user — sirf apni MIS
    const uid = req.session.userId;

    // HOD ka department ek hi baar nikaal lo (FMS aur task filter dono me use hoga)
    let hodDept = '';
    if (isHod) {
      const [me] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      hodDept = me[0]?.department || '';
    }

    // Same deptFilter logic as /api/mis — tasks JOIN users se filter
    let deptFilter = '';
    let deptParams = [start, end];
    if (isSelfOnly) {
      deptFilter = 'AND u.id=?';
      deptParams = [start, end, uid];
    } else if (isHod) {
      deptFilter = 'AND u.department=?';
      deptParams = [start, end, hodDept];
    }
    // Office/Factory segment
    const segA = segmentFilter(req, 'u');
    if (segA.param) { deptFilter += segA.clause; deptParams.push(segA.param); }

    const calc = (total, pending, overdue, revised, notOnTime) => {
      total = parseInt(total)||0; pending = parseInt(pending)||0;
      overdue = parseInt(overdue)||0; revised = parseInt(revised)||0; notOnTime = parseInt(notOnTime)||0;
      const score = calcMisScore({ total, pending, overdue, notOnTime, revised });
      return { total, pending, overdue, revised, notOnTime, score };
    };

    // Fetch delegation + checklist stats per user (same style as /api/mis)
    const [delRows] = await db.query(
      `SELECT u.id AS "userId", u.name, u.department,
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status='revised' THEN 1 ELSE 0 END) AS revised,
        SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.status='completed' AND t.completed_at IS NOT NULL AND DATE(t.completed_at)>t.due_date THEN 1 ELSE 0 END) AS not_on_time
       FROM delegation_tasks t JOIN users u ON t.assigned_to=u.id
       WHERE t.due_date BETWEEN ? AND ? ${deptFilter}
       GROUP BY u.id, u.name, u.department ORDER BY u.name`, deptParams);

    const [chlRows] = await db.query(
      `SELECT u.id AS "userId", u.name, u.department,
        COUNT(*) AS total,
        SUM(CASE WHEN t.status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed,
        0 AS revised,
        SUM(CASE WHEN t.status='pending' AND t.due_date<CURRENT_DATE THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.status='completed' AND t.completed_at IS NOT NULL AND DATE(t.completed_at)>t.due_date THEN 1 ELSE 0 END) AS not_on_time
       FROM checklist_tasks t JOIN users u ON t.assigned_to=u.id
       WHERE t.due_date BETWEEN ? AND ? ${deptFilter}
       GROUP BY u.id, u.name, u.department ORDER BY u.name`, deptParams);

    // Merge by userId
    const userMap = {};
    for (const r of delRows) {
      userMap[r.userId] = { userId: r.userId, name: r.name, department: r.department||'',
        delegation: calc(r.total, r.pending, r.overdue, r.revised, r.not_on_time),
        delegationCompleted: parseInt(r.completed)||0,
        checklist: calc(0,0,0,0,0), checklistCompleted: 0 };
      userMap[r.userId].delegation.completed = parseInt(r.completed)||0;
    }
    for (const r of chlRows) {
      if (!userMap[r.userId]) {
        userMap[r.userId] = { userId: r.userId, name: r.name, department: r.department||'',
          delegation: calc(0,0,0,0,0), delegationCompleted: 0,
          checklist: calc(0,0,0,0,0), checklistCompleted: 0 };
        userMap[r.userId].delegation.completed = 0;
      }
      userMap[r.userId].checklist = calc(r.total, r.pending, r.overdue, 0, r.not_on_time);
      userMap[r.userId].checklist.completed = parseInt(r.completed)||0;
      userMap[r.userId].checklistCompleted = parseInt(r.completed)||0;
    }

    // Fetch week plan for each user — DATE_FORMAT taaki frontend ko clean YYYY-MM-DD mile (ISO timestamp nahi)
    let planMap = {};
    try {
      const [plans] = await db.query(
        `SELECT employee_id, target_count, TO_CHAR(start_date,'YYYY-MM-DD') AS start_date, improvement_pct FROM week_plans WHERE start_date BETWEEN ? AND ? ORDER BY start_date DESC`, [start, end]);
      for (const p of plans) {
        if (!planMap[p.employee_id]) planMap[p.employee_id] = p;
      }
    } catch(e) { /* week_plans table may not exist yet */ }

    // ── FMS contribution per user (shared engine — deterministic + cached) ──
    // computeFmsStats() se hi /api/mis/fms bhi data leta hai, isliye per-employee
    // FMS aur FMS Overview ke numbers ab HAMESHA match karte hain. HOD/admin dono
    // par EK jaisa dept-filter lagta hai. Read fail ho to fmsErrors me naam aata hai.
    let fmsUserMap = {};
    let fmsErrors = [];
    try {
      // ROLE-INDEPENDENT: hamesha all-doers crediting (hodDept='') taaki ek hi employee ka
      // FMS total/score admin aur HOD dono ko BILKUL EK JAISA dikhe. Dept ka filter sirf
      // niche rows (kaun-kaun employee dikhega) par lagta hai — numbers par nahi.
      const fmsStats = await computeFmsStats('');
      fmsUserMap = fmsStats.perUser || {};
      fmsErrors = fmsStats.errors || [];
    } catch (e) { fmsErrors = ['FMS data unavailable']; }

    // Agar koi user sirf FMS me kaam karta hai (del/chl me 0 tasks) to use bhi userMap me daalo.
    if (Object.keys(fmsUserMap).length) {
      const fmsUserIds = Object.keys(fmsUserMap).map(x => parseInt(x)).filter(x => !userMap[x]);
      if (fmsUserIds.length) {
        let userQ = `SELECT id, name, department FROM users WHERE id IN (${fmsUserIds.map(()=>'?').join(',')})`;
        const userQParams = [...fmsUserIds];
        if (isHod) { userQ += ' AND department=?'; userQParams.push(hodDept); }
        if (segA.param) { userQ += ' AND staff_type=?'; userQParams.push(segA.param); }
        const [extraUsers] = await db.query(userQ, userQParams);
        for (const u of extraUsers) {
          userMap[u.id] = { userId: u.id, name: u.name, department: u.department||'',
            delegation: calc(0,0,0,0,0), delegationCompleted: 0,
            checklist: calc(0,0,0,0,0), checklistCompleted: 0 };
          userMap[u.id].delegation.completed = 0;
        }
      }
    }

    const rows = Object.values(userMap).map(u => {
      const d = u.delegation, c = u.checklist;
      const fms = fmsUserMap[u.userId] || { total: 0, pending: 0, done: 0 };
      // FMS total = done + pending (dono Total column me count hone chahiye)
      const fmsRealTotal = fms.done + fms.pending;
      const totalAll = d.total + c.total + fmsRealTotal;
      const pendingAll = d.pending + c.pending + fms.pending;
      const overdueAll = d.overdue + c.overdue;
      const revisedAll = d.revised;
      const notOnTimeAll = (d.notOnTime||0) + (c.notOnTime||0);
      const completedAll = (d.completed||0) + (c.completed||0) + fms.done;
      const overallScore = totalAll > 0
        ? calcMisScore({ total: totalAll, pending: pendingAll, overdue: overdueAll, notOnTime: notOnTimeAll, revised: revisedAll })
        : null;
      const plan = planMap[u.userId] || null;
      const fmsScore = fmsRealTotal > 0
        ? Math.round((fms.done / fmsRealTotal) * 100 * 10) / 10  // 0-100% completion
        : null;
      return { ...u, fms: { total: fmsRealTotal, pending: fms.pending, done: fms.done, score: fmsScore },
        totalAll, pendingAll, overdueAll, revisedAll, completedAll, overallScore, plan };
    }).filter(u => u.totalAll > 0)
      .filter(u => !isSelfOnly || u.userId === uid) // regular user — sirf apni row
      .sort((a,b) => a.name.localeCompare(b.name));

    // Backward compatible: agar koi error nahi to seedha array bhejte hain (jaise pehle).
    // Error hone par object bhejte hain taaki frontend warning dikha sake.
    if (fmsErrors.length) return res.json({ rows, fmsErrors });
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── FMS MIS ──
app.get('/api/mis/fms', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Dates required' });
    // FMS MIS ek cross-user (per-sheet) view hai — regular user ke liye applicable nahi
    if (req.session.role === 'user') return res.json([]);
    const isHod = req.session.role === 'hod';
    const uid = req.session.userId;

    // HOD ka department (FMS dept-filter ke liye)
    let hodDept = '';
    if (isHod) {
      const [meRow] = await db.query('SELECT department FROM users WHERE id=?', [uid]);
      hodDept = meRow[0]?.department || '';
    }

    // Same shared engine jo /api/mis/all use karta hai => numbers HAMESHA match honge
    const fmsStats = await computeFmsStats(hodDept);
    res.json(fmsStats.perFms);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ══════════════════════════════════════════════════════
// EMPLOYEE RECORDS  (Admin / HOD / PC) — Plan vs Done
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/employee-records')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════
// DEPARTMENTS
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/departments')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/users')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/profile')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/comments')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// FMS ADMIN APIs
// ══════════════════════════════════════════════════════

app.get('/api/fms', requireAuth, requireAdmin, async (req, res) => {
  try {
    // LEFT JOIN jaan-boojh kar: pehle INNER tha, jisse jis FMS ka banane wala
    // user delete ho chuka ho wo poori list se hi gayab ho jaati thi.
    // createdByName kahin use nahi hota, isliye null aana bilkul theek hai.
    const [sheets] = await db.query(`SELECT f.*,u.name AS "createdByName" FROM fms_sheets f LEFT JOIN users u ON f.created_by=u.id ORDER BY f.created_at DESC`);
    res.json(sheets);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ZAROORI: ye route /api/fms/:id se PEHLE aana chahiye, warna ":id" wildcard
// "sheet-column-values" ko hi id samajh lega.
// Sheet ke ek column ki unique values padhta hai aur unhe DB users se match
// karta hai — FMS Admin me "Load Doers" isi se step doers auto-fill karta hai.
// Query: ?sheetId=...&tabName=...&col=E&headerRow=1
app.get('/api/fms/sheet-column-values', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sheetId, tabName, col, headerRow } = req.query;
    if (!sheetId || !col) return res.status(400).json({ error: 'sheetId and col required' });

    const colIdx = colToIdx(col);
    if (colIdx < 0) return res.status(400).json({ error: 'Invalid column letter' });

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheetId);
    const tab = tabName || 'Sheet1';
    const headerIdx = (parseInt(headerRow) || 1) - 1;

    const range = `${tab}!${col}:${col}`;
    const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
    const values = response.data.values || [];

    // Header row(s) chhodo, non-empty unique values utha lo
    const dataValues = values.slice(headerIdx + 1).map(r => (r[0] || '').trim()).filter(v => v);
    const uniqueNames = [...new Set(dataValues)];

    // Har naam ko DB users se match karo (case-insensitive exact match)
    const [allUsers] = await db.query('SELECT id, name, email, role FROM users');
    const matched = [];
    const unmatched = [];
    for (const sheetName of uniqueNames) {
      const user = allUsers.find(u => (u.name || '').trim().toLowerCase() === sheetName.toLowerCase());
      if (user) matched.push({ sheet_name: sheetName, user_id: user.id, user_name: user.name, email: user.email });
      else unmatched.push(sheetName);
    }

    res.json({
      total_unique: uniqueNames.length,
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      matched,
      unmatched,
      all_unique: uniqueNames
    });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Sheet access denied. Share with service account.' });
    if (err.code === 404) return res.status(400).json({ error: 'Sheet not found.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

app.get('/api/fms/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.id]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE fms_id=? ORDER BY step_order ASC', [req.params.id]);
    const stepIds = steps.map(s => s.id);
    const doersByStep = await _fmsDoersByStep(stepIds);
    const extraByStep = await _fmsExtraRowsByStep(stepIds);
    for (const step of steps) {
      step.doers = (doersByStep[step.id] || []).map(d => ({ user_id: d.user_id, name: d.name }));
      step.extraRows = extraByStep[step.id] || [];
      try { step.show_cols_parsed = JSON.parse(step.show_cols || '[]'); } catch(e) { step.show_cols_parsed = []; }
    }
    // Intake config ko NAAM se heal karke bhejo — editor current (sahi) columns dikhaye
    // aur re-save par sahi header-naam capture ho (column add/delete ke baad bhi).
    try {
      const sh0 = sheets[0];
      let cfg = null; try { cfg = JSON.parse(sh0.intake_config || 'null'); } catch (e) {}
      if (cfg) {
        const tTab = cfg.targetTab || sh0.sheet_name || 'Sheet1';
        const tHRow = parseInt(cfg.targetHeaderRow) || sh0.header_row || 1;
        const qTab = /^[A-Za-z0-9_]+$/.test(tTab) ? tTab : `'${tTab.replace(/'/g, "''")}'`;
        const spreadsheetId = extractSpreadsheetId(cfg.targetSheetId || sh0.sheet_id);
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const rr = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${tHRow}:${tHRow}` });
        _healIntakeConfig(cfg, (rr.data.values || [[]])[0] || []);
        sh0.intake_config = JSON.stringify(cfg);
      }
    } catch (e) { console.error('fms GET intake heal skipped:', e.message); }
    res.json({ sheet: sheets[0], steps });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

app.post('/api/fms', requireAuth, requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { fmsName, sheetName, sheetId, headerRow, totalSteps, steps } = req.body;
    const [result] = await conn.query(
      `INSERT INTO fms_sheets (fms_name,sheet_name,sheet_id,header_row,total_steps,created_by) VALUES (?,?,?,?,?,?)`,
      [fmsName||sheetName, sheetName, sheetId, headerRow||1, totalSteps||1, req.session.userId]
    );
    const fmsId = result.insertId;
    const headers = await _fetchSheetHeaders({ sheet_id: sheetId, sheet_name: sheetName, header_row: headerRow || 1 });
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const nm = _capStepNames(s, headers);
      const [sr] = await conn.query(
        `INSERT INTO fms_steps (fms_id,step_order,step_name,plan_col,plan_col_name,actual_col,actual_col_name,extra_input,extra_col,show_cols,show_col_names,delay_reason_col,delay_reason_col_name,doer_name_col,doer_name_col_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [fmsId,i+1,s.stepName,s.planCol||'',nm.planName,s.actualCol||'',nm.actualName,s.extraInput||'no',s.extraCol||'',JSON.stringify(s.showCols||[]),nm.showNames,s.delayReasonCol||'',nm.delayReasonName,s.doerNameCol||'',nm.doerNameName]
      );
      const stepId = sr.insertId;
      if (s.doers?.length) for (const uid of s.doers) await conn.query('INSERT INTO fms_step_doers (step_id,user_id) VALUES (?,?)', [stepId, uid]);
      if (s.extraInput==='yes' && s.extraRows?.length) for (const row of s.extraRows) await conn.query('INSERT INTO fms_extra_rows (step_id,row_label,col_letter,field_type,dropdown_options,required) VALUES (?,?,?,?,?,?)', [stepId, row.label||row.col_letter||'', row.col_letter||'', row.field_type||'text', row.dropdown_options||'', [0,1,2].includes(Number(row.required))?Number(row.required):(row.required===false?0:1)]);
    }
    await conn.commit();
    res.json({ success: true, id: fmsId });
  } catch (err) { await conn.rollback(); console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); } finally { conn.release(); }
});

app.put('/api/fms/:id', requireAuth, requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { fmsName, sheetName, sheetId, headerRow, steps } = req.body;
    await conn.query(`UPDATE fms_sheets SET fms_name=?,sheet_name=?,sheet_id=?,header_row=?,total_steps=? WHERE id=?`, [fmsName||sheetName, sheetName, sheetId, headerRow||1, steps.length, req.params.id]);
    const [oldSteps] = await conn.query('SELECT id FROM fms_steps WHERE fms_id=?', [req.params.id]);
    for (const os of oldSteps) {
      await conn.query('DELETE FROM fms_step_doers WHERE step_id=?', [os.id]);
      await conn.query('DELETE FROM fms_extra_rows WHERE step_id=?', [os.id]);
    }
    await conn.query('DELETE FROM fms_steps WHERE fms_id=?', [req.params.id]);
    const headers = await _fetchSheetHeaders({ sheet_id: sheetId, sheet_name: sheetName, header_row: headerRow || 1 });
    for (let i=0; i<steps.length; i++) {
      const s = steps[i];
      const nm = _capStepNames(s, headers);
      const [sr] = await conn.query(
        `INSERT INTO fms_steps (fms_id,step_order,step_name,plan_col,plan_col_name,actual_col,actual_col_name,extra_input,extra_col,show_cols,show_col_names,delay_reason_col,delay_reason_col_name,doer_name_col,doer_name_col_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.params.id,i+1,s.stepName,s.planCol||'',nm.planName,s.actualCol||'',nm.actualName,s.extraInput||'no',s.extraCol||'',JSON.stringify(s.showCols||[]),nm.showNames,s.delayReasonCol||'',nm.delayReasonName,s.doerNameCol||'',nm.doerNameName]
      );
      const stepId = sr.insertId;
      if (s.doers?.length) for (const uid of s.doers) await conn.query('INSERT INTO fms_step_doers (step_id,user_id) VALUES (?,?)', [stepId, uid]);
      if (s.extraInput==='yes' && s.extraRows?.length) for (const row of s.extraRows) await conn.query('INSERT INTO fms_extra_rows (step_id,row_label,col_letter,field_type,dropdown_options,required) VALUES (?,?,?,?,?,?)', [stepId, row.label||row.col_letter||'', row.col_letter||'', row.field_type||'text', row.dropdown_options||'', [0,1,2].includes(Number(row.required))?Number(row.required):(row.required===false?0:1)]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) { await conn.rollback(); console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); } finally { conn.release(); }
});

app.delete('/api/fms/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM fms_sheets WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Intake Form config save (admin). Config: { enabled, targetSheetId, targetTab, targetHeaderRow, fields:[...] }
app.put('/api/fms/:id/intake', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = req.body?.config;
    let json = null;
    if (cfg && typeof cfg === 'object') {
      const fields = Array.isArray(cfg.fields) ? cfg.fields.filter(f => f && f.col).map(f => ({
        label: String(f.label || '').trim() || String(f.col).toUpperCase(),
        col: String(f.col).toUpperCase(),
        type: ['text', 'number', 'date', 'dropdown', 'file', 'people'].includes(f.type) ? f.type : 'text',
        required: !!f.required,
        auto: !!f.auto, // auto-number: New Record me last+1 se prefill
        options: typeof f.options === 'string' ? f.options : ''
      })) : [];
      // Next step: submit ke baad iss column me planned date bharwate hain (jaise Material Ready = K)
      const ns = cfg.nextStep;
      const nextStep = (ns && ns.planCol) ? {
        enabled: ns.enabled !== false,
        planCol: String(ns.planCol).toUpperCase(),
        label: String(ns.label || 'Next step planned date').trim()
      } : null;
      // Derived plan dates: jab next-step ki plan date set ho, ye columns apne aap
      // (main plan date ± offsetDays) bhar jaate hain. Jaise Transport = Material Ready − 1 din.
      const derivedSteps = Array.isArray(cfg.derivedSteps)
        ? cfg.derivedSteps.filter(d => d && d.planCol).map(d => ({
            planCol: String(d.planCol).toUpperCase(),
            label: String(d.label || '').trim(),
            offsetDays: parseInt(d.offsetDays, 10) || 0,
            from: d.from === 'actual' ? 'actual' : 'plan', // 'plan' = next-step planned pe; 'actual' = next-step Done pe
            // Condition (optional): agar row ka condCol === value ho to daysMatch, warna daysElse
            cond: (d.cond && d.cond.col) ? {
              col: String(d.cond.col).toUpperCase(),
              value: String(d.cond.value || '').trim(),
              daysMatch: parseInt(d.cond.daysMatch, 10) || 0,
              daysElse: parseInt(d.cond.daysElse, 10) || 0
            } : null
          }))
        : [];
      // Record creators: kaunse users "New Record" bana sakte hain. Empty/undefined
      // = access wale sabhi (backward-compatible). Non-empty = sirf ye users (+ admin).
      const recordCreators = Array.isArray(cfg.recordCreators)
        ? [...new Set(cfg.recordCreators.map(x => parseInt(x, 10)).filter(n => n > 0))] : [];
      const configObj = {
        enabled: cfg.enabled !== false,
        targetSheetId: String(cfg.targetSheetId || '').trim(),
        targetTab: String(cfg.targetTab || '').trim(),
        targetHeaderRow: parseInt(cfg.targetHeaderRow) || null,
        fields,
        nextStep,
        derivedSteps,
        recordCreators
      };
      // Har column letter ke saath uska header-NAAM capture karo — taaki sheet me column
      // add/delete hone par read-time par config khud NAAM se heal ho jaaye (steps jaisa).
      try {
        const [sh] = await db.query('SELECT sheet_id, sheet_name, header_row FROM fms_sheets WHERE id=?', [req.params.id]);
        const tSheetId = configObj.targetSheetId || (sh[0] && sh[0].sheet_id) || '';
        const tTab = configObj.targetTab || (sh[0] && sh[0].sheet_name) || 'Sheet1';
        const tHRow = configObj.targetHeaderRow || (sh[0] && sh[0].header_row) || 1;
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const spreadsheetId = extractSpreadsheetId(tSheetId);
        const qTab = /^[A-Za-z0-9_]+$/.test(tTab) ? tTab : `'${tTab.replace(/'/g, "''")}'`;
        const rr = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${tHRow}:${tHRow}` });
        _capIntakeNames(configObj, (rr.data.values || [[]])[0] || []);
      } catch (e) { console.error('intake save: header-name capture skipped:', e.message); }
      json = JSON.stringify(configObj);
    }
    await db.query('UPDATE fms_sheets SET intake_config=? WHERE id=?', [json, req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// ── Fetch headers ONLY (fast — just one row from sheet) ──
app.post('/api/fms/fetch-headers', requireAuth, async (req, res) => {
  try {
    const { sheetId, sheetName, headerRow } = req.body;
    if (!sheetId) return res.status(400).json({ error: 'sheetId required' });
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheetId);
    const hRow = parseInt(headerRow) || 1;
    // Fetch ONLY the header row — very fast even for 10000-row sheets
    const range = sheetName ? `${sheetName}!${hRow}:${hRow}` : `${hRow}:${hRow}`;
    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId, range,
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rawHeaders = (response.data.values || [[]])[0] || [];
    const headers = rawHeaders
      .map((h, i) => ({
        name: String(h ?? '').trim() || `COL_${idxToCol(i)}`,
        col: idxToCol(i),
        index: i
      }))
      .filter(h => String(h.name).trim().length > 0);
    res.json({ headers });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Share sheet with service account.' });
    if (err.code === 404) return res.status(400).json({ error: 'Sheet not found. Check Sheet ID.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Sync data (full) — FIX: now uses sheet.sheet_name as tab name ──
app.get('/api/fms/:id/sync', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.id]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const headerRowIdx = (sheet.header_row || 1) - 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    // ✅ FIXED: use sheet.sheet_name (actual tab name) instead of hardcoded 'Sheet1'
    const tabName = sheet.sheet_name || 'Sheet1';
    const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: tabName });
    const allRows = response.data.values || [];
    if (allRows.length <= headerRowIdx) {
      return res.status(400).json({ error: `Sheet has only ${allRows.length} rows but header row is set to ${sheet.header_row}` });
    }
    const headers = allRows[headerRowIdx].filter(h => h && h.trim());
    const dataRows = allRows.slice(headerRowIdx + 1);
    // Return ALL data rows
    res.json({ success: true, headers, totalRows: dataRows.length, headerRow: sheet.header_row, sample: dataRows });
  } catch (err) {
    if (err.message?.includes('ENOENT') || err.message?.includes('credentials')) return res.status(500).json({ error: 'credentials.json not found.' });
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Share sheet with service account.' });
    if (err.code === 404) return res.status(400).json({ error: 'Sheet not found. Check Sheet ID.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════
// FMS TASKS APIs (all users)
// ══════════════════════════════════════════════════════

// List FMS visible to user
app.get('/api/fms-tasks', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.role === 'admin';
    let list;
    if (isAdmin) {
      [list] = await db.query('SELECT * FROM fms_sheets ORDER BY created_at DESC');
    } else {
      [list] = await db.query(`SELECT DISTINCT fs.* FROM fms_sheets fs JOIN fms_steps fst ON fst.fms_id=fs.id JOIN fms_step_doers fsd ON fsd.step_id=fst.id WHERE fsd.user_id=? ORDER BY fs.created_at DESC`, [uid]);
    }
    res.json(list);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Get FMS steps for tasks view
app.get('/api/fms-tasks/:id', requireAuth, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.role === 'admin';
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.id]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE fms_id=? ORDER BY step_order ASC', [req.params.id]);
    const stepIds = steps.map(s => s.id);
    const doersByStep = await _fmsDoersByStep(stepIds);
    const extraByStep = await _fmsExtraRowsByStep(stepIds);
    for (const step of steps) {
      const doers = (doersByStep[step.id] || []).map(d => ({ user_id: d.user_id, name: d.name }));
      step.doers = doers;
      step.isMyStep = isAdmin || doers.some(d => d.user_id === uid);
      try { step.show_cols_parsed = JSON.parse(step.show_cols||'[]'); } catch(e) { step.show_cols_parsed = []; }
      step.extraRows = extraByStep[step.id] || [];
    }
    res.json({ sheet: sheets[0], steps });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Get pending rows for a step (plan filled, actual empty)
app.get('/api/fms-tasks/:fmsId/steps/:stepId/rows', requireAuth, async (req, res) => {
  try {
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE id=? AND fms_id=?', [req.params.stepId, req.params.fmsId]);
    if (!steps[0]) return res.status(404).json({ error: 'Step not found' });
    const step = steps[0];

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tabName = sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;

    // Poori tab padho — headers milte hi step ke columns ko NAAM se heal karo (letter
    // shift ho to bhi sahi column mile). Phir healed columns se indices nikaalo.
    const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
    const allRows = response.data.values || [];
    const headerRowIdx = (sheet.header_row || 1) - 1;
    const headers = allRows[headerRowIdx] || [];
    _healStepCols(step, headers);

    const planIdx = colToIdx(step.plan_col);
    const actualIdx = colToIdx(step.actual_col);
    let showCols = [];
    try { showCols = JSON.parse(step.show_cols||'[]'); } catch(e) {}

    const dataRows = allRows.slice(headerRowIdx + 1);

    const matchedRows = [];
    dataRows.forEach((row, i) => {
      const planVal = planIdx >= 0 ? (row[planIdx]||'').trim() : '';
      const actualVal = actualIdx >= 0 ? (row[actualIdx]||'').trim() : '';
      if (planVal && !actualVal) {
        const rowData = {};
        let colsToShow = showCols.length ? showCols : headers.map((_,hi) => hi);
        // Plan column always show karo — mandatory
        if (planIdx >= 0 && !colsToShow.includes(planIdx)) colsToShow = [planIdx, ...colsToShow];
        colsToShow.forEach(ci => {
          const h = headers[ci] || `COL ${idxToCol(ci)}`;
          rowData[h] = row[ci] || '';
        });
        matchedRows.push({
          sheetRowNumber: headerRowIdx + 1 + i + 1,
          planValue: planVal,
          actualValue: actualVal,
          data: rowData
        });
      }
    });

    res.json({ rows: matchedRows, headers, total: matchedRows.length });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied.' });
    if (err.code === 404) return res.status(400).json({ error: 'Sheet not found.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// COMPLETED rows for a step (plan + actual DONO filled) — step ke extra-input columns
// ki current values ke saath. Isse Done ke BAAD bhi wo fields app se edit ho sakti hain
// (jaise Final Status: On The way -> Reach).
app.get('/api/fms-tasks/:fmsId/steps/:stepId/done-rows', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE id=? AND fms_id=?', [req.params.stepId, req.params.fmsId]);
    if (!steps[0]) return res.status(404).json({ error: 'Step not found' });
    const step = steps[0];
    const [extraRows] = await db.query('SELECT * FROM fms_extra_rows WHERE step_id=? ORDER BY id ASC', [step.id]);
    const extraCols = extraRows.filter(r => r.col_letter).map(r => r.col_letter.toUpperCase());

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tabName = sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
    const response = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
    const allRows = response.data.values || [];
    const headerRowIdx = (sheet.header_row || 1) - 1;
    const headers = allRows[headerRowIdx] || [];
    _healStepCols(step, headers);
    const planIdx = colToIdx(step.plan_col);
    const actualIdx = colToIdx(step.actual_col);
    let showCols = [];
    try { showCols = JSON.parse(step.show_cols||'[]'); } catch(e) {}
    const dataRows = allRows.slice(headerRowIdx + 1);

    const matchedRows = [];
    dataRows.forEach((row, i) => {
      const planVal = planIdx >= 0 ? (row[planIdx]||'').trim() : '';
      const actualVal = actualIdx >= 0 ? (row[actualIdx]||'').trim() : '';
      if (planVal && actualVal) {                       // dono filled = ho chuka
        const rowData = {};
        let colsToShow = showCols.length ? showCols : headers.map((_,hi) => hi);
        colsToShow.forEach(ci => { const h = headers[ci] || `COL ${idxToCol(ci)}`; rowData[h] = row[ci] || ''; });
        const extraValues = {};
        extraCols.forEach(cl => { const ci = colToIdx(cl); extraValues[cl] = ci >= 0 ? (row[ci]||'') : ''; });
        matchedRows.push({
          sheetRowNumber: headerRowIdx + 1 + i + 1,
          planValue: planVal, actualValue: actualVal,
          data: rowData, extraValues
        });
      }
    });
    res.json({ rows: matchedRows, total: matchedRows.length });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Done ho chuki row ke extra-input columns update karo (jaise Final Status).
app.post('/api/fms-tasks/:fmsId/steps/:stepId/update-extra', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const rowNumber = parseInt(req.body?.rowNumber);
    const extraInputs = Array.isArray(req.body?.extraInputs) ? req.body.extraInputs : [];
    if (!rowNumber || rowNumber < 1) return res.status(400).json({ error: 'Invalid row' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tabName = sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
    const batchData = [];
    for (const ei of extraInputs) {
      if (ei && ei.colLetter) batchData.push({ range: `${qTab}!${String(ei.colLetter).toUpperCase()}${rowNumber}`, values: [[ei.value == null ? '' : ei.value]] });
    }
    if (!batchData.length) return res.status(400).json({ error: 'Nothing to update' });
    await sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: batchData } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ADMIN: poori FMS ki summary — KPIs + stage-wise breakdown + per-order table
// (search order no. se frontend par hota hai; poora set ek baar bhej dete hain).
app.get('/api/fms-tasks/:fmsId/summary', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE fms_id=? ORDER BY step_order ASC', [req.params.fmsId]);

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tabName = sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;
    const all = (await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab })).data.values || [];
    const hIdx = (sheet.header_row || 1) - 1;
    const headers = all[hIdx] || [];
    steps.forEach(s => _healStepCols(s, headers));   // column add/delete safe

    let cfg = null; try { cfg = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    if (cfg) _healIntakeConfig(cfg, headers);       // column add/delete-safe (naam se heal)
    const fields = Array.isArray(cfg && cfg.fields) ? cfg.fields : [];
    const findCol = re => { const f = fields.find(f => re.test(f.label || '')); return f ? colToIdx(f.col) : -1; };
    const autoF = fields.find(f => f.auto);
    const orderIdx = autoF ? colToIdx(autoF.col) : findCol(/order\s*no/i);
    const vendorIdx = findCol(/vendor|party|name/i);
    const locIdx = findCol(/location|city|place/i);
    const orderLabel = autoF ? (autoF.label || 'Order No') : (fields.find(f => /order\s*no/i.test(f.label || ''))?.label || 'Order No');
    // Order Type (ACP/APP) column + Dispatch (Billing done) / Complete (Tracking done) steps
    const orderTypeIdx = headers.findIndex(h => /order\s*type/i.test(String(h || '')));
    const billingIdx = steps.findIndex(s => /billing/i.test(s.step_name || ''));
    const trackingIdx = steps.findIndex(s => /tracking/i.test(s.step_name || ''));

    const daysDiff = (planned, actual) => {
      const p = _parseDMY(planned), a = _parseDMY(actual);
      return (p && a) ? Math.round((a.getTime() - p.getTime()) / 86400000) : 0;
    };

    const stageAgg = steps.map(s => ({ name: s.step_name, pending: 0, done: 0, delayed: 0 }));
    let completed = 0, delayedOrders = 0, onTime = 0, doneCnt = 0, orderDelaySum = 0;
    let acpCnt = 0, appCnt = 0, dispatchedCnt = 0, completeCnt = 0;
    const orders = [];

    for (const row of all.slice(hIdx + 1)) {
      if (!row.some(c => String(c || '').trim())) continue;    // blank row skip
      const stages = steps.map((s, i) => {
        const planned = (row[colToIdx(s.plan_col)] || '').trim();
        const actual = (row[colToIdx(s.actual_col)] || '').trim();
        const status = !planned ? 'not-started' : !actual ? 'pending' : 'done';
        let late = false, d = 0;
        if (status === 'done') {
          doneCnt++; stageAgg[i].done++;
          d = daysDiff(planned, actual);
          if (d > 0) { late = true; stageAgg[i].delayed++; } else onTime++;   // per-stage late count
        } else if (status === 'pending') stageAgg[i].pending++;
        return { name: s.step_name, planned, actual, status, late, delay: d > 0 ? d : 0 };
      });
      const started = stages.some(s => s.status !== 'not-started');
      if (!started) continue;                                  // intake hi nahi hua to skip
      const allDone = stages.every(s => s.status === 'done');
      if (allDone) completed++;
      const orderDelayDays = stages.reduce((n, s) => n + (s.delay || 0), 0);
      const orderLate = stages.some(s => s.late);
      if (orderLate) { delayedOrders++; orderDelaySum += orderDelayDays; }   // ORDER-level delay KPI
      const orderType = orderTypeIdx >= 0 ? String(row[orderTypeIdx] || '').trim() : '';
      const dispatched = billingIdx >= 0 && stages[billingIdx] && stages[billingIdx].status === 'done';   // Billing done = dispatched
      const complete = trackingIdx >= 0 && stages[trackingIdx] && stages[trackingIdx].status === 'done';   // Tracking done = complete
      const ot = orderType.toUpperCase();
      if (ot === 'ACP') acpCnt++; else if (ot === 'APP') appCnt++;
      if (dispatched) dispatchedCnt++;
      if (complete) completeCnt++;
      orders.push({
        orderNo: orderIdx >= 0 ? String(row[orderIdx] || '').trim() : '',
        vendor: vendorIdx >= 0 ? String(row[vendorIdx] || '').trim() : '',
        location: locIdx >= 0 ? String(row[locIdx] || '').trim() : '',
        orderType,
        currentStage: allDone ? 'Completed' : (stages.find(s => s.status !== 'done')?.name || '—'),
        status: allDone ? 'completed' : 'in-progress',
        dispatched, complete,
        delayDays: orderDelayDays,
        stages
      });
    }

    res.json({
      fms: { id: sheet.id, name: sheet.fms_name },
      orderLabel,
      kpis: {
        total: orders.length, completed, inProgress: orders.length - completed, delayed: delayedOrders,
        acp: acpCnt, app: appCnt, dispatched: dispatchedCnt, complete: completeCnt,
        onTimePct: doneCnt ? Math.round(onTime / doneCnt * 100) : 100,
        avgDelayDays: delayedOrders ? +(orderDelaySum / delayedOrders).toFixed(1) : 0
      },
      stages: stageAgg,
      orders
    });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Sheet not shared with the service account.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Mark row as done — writes actual (date only) + delay reason to sheet
app.post('/api/fms-tasks/:fmsId/steps/:stepId/done', requireAuth, async (req, res) => {
  try {
    const { rowNumber, actualValue, delayReason, extraInputs, planValue } = req.body;
    if (!rowNumber || !actualValue) return res.status(400).json({ error: 'rowNumber and actualValue required' });
    // Strip time portion — save only date (DD-MM-YYYY) to Google Sheet
    let dateOnlyValue = actualValue;
    const dtMatch = actualValue.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
    if (dtMatch) dateOnlyValue = dtMatch[1];

    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    const [steps] = await db.query('SELECT * FROM fms_steps WHERE id=? AND fms_id=?', [req.params.stepId, req.params.fmsId]);
    if (!steps[0]) return res.status(404).json({ error: 'Step not found' });
    const step = steps[0];

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
    const spreadsheetId = extractSpreadsheetId(sheet.sheet_id);
    const tabName = sheet.sheet_name || 'Sheet1';
    // Tab naam me space/special ho to A1 notation me single-quote chahiye ('Copy of FMS'!L8)
    const qTab = /^[A-Za-z0-9_]+$/.test(tabName) ? tabName : `'${tabName.replace(/'/g, "''")}'`;

    // Header row padho + step ke columns NAAM se heal karo (letter shift-safe)
    const hRow = sheet.header_row || 1;
    let hdrs = [];
    try {
      const hdrResp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${hRow}:${hRow}` });
      hdrs = (hdrResp.data.values || [[]])[0] || [];
      _healStepCols(step, hdrs);
    } catch (e) { console.error('  ⚠️  FMS done header read failed:', e.message); }

    const actualCol = (step.actual_col||'').toUpperCase();
    if (!actualCol) return res.status(400).json({ error: 'Actual column not configured for this step' });

    // ── BATCH WRITE: sab columns ek hi API call mein likhte hain ──
    // Pehle doer name fetch karo (DB call) taaki sheet call sirf ek ho
    let doerName = '';
    if (step.doer_name_col) {
      const [userRows] = await db.query('SELECT name FROM users WHERE id=? LIMIT 1', [req.session.userId]);
      doerName = userRows[0]?.name || '';
    }

    // Sabhi ranges build karo
    const batchData = [];

    // 1. Actual date column (mandatory)
    batchData.push({ range: `${qTab}!${actualCol}${rowNumber}`, values: [[dateOnlyValue]] });

    // 2. Delay reason ab neeche auto-detect "Remarks" column me jaata hai (shift-safe).

    // 3. Extra input columns (optional)
    if (extraInputs && extraInputs.length) {
      for (const ei of extraInputs) {
        if (ei.colLetter && ei.value !== undefined && ei.value !== '') {
          batchData.push({ range: `${qTab}!${ei.colLetter.toUpperCase()}${rowNumber}`, values: [[ei.value]] });
        }
      }
    }

    // 4. Doer name column (optional)
    if (doerName && step.doer_name_col) {
      batchData.push({ range: `${qTab}!${step.doer_name_col.toUpperCase()}${rowNumber}`, values: [[doerName]] });
    }

    // 5. Status="Done" + Delay(days) + Remark — Actual ke daayein sabse nazdeek
    //    "Status" / "Delay" / "Remarks"(ya "Remark") columns naam se auto-detect (upar
    //    padhe hdrs se). Delay = Actual − Planned; Remark = delay reason (agar diya ho).
    let delayColForFmt = -1; // delay cell ka format baad me number karenge
    try {
      const actualIdx = colToIdx(actualCol);
      let statusIdx = -1, delayIdx = -1, remarksIdx = -1;
      for (let i = actualIdx + 1; i < hdrs.length; i++) {
        const h = String(hdrs[i] || '').trim().toLowerCase();
        if (statusIdx < 0 && h === 'status') statusIdx = i;
        if (delayIdx < 0 && h === 'delay') delayIdx = i;
        if (remarksIdx < 0 && (h === 'remarks' || h === 'remark')) remarksIdx = i;
      }
      if (statusIdx >= 0) batchData.push({ range: `${qTab}!${idxToCol(statusIdx)}${rowNumber}`, values: [['Done']] });
      if (delayIdx >= 0) {
        const pd = _parseDMY(planValue), ad = _parseDMY(dateOnlyValue);
        if (pd && ad) {
          const days = Math.round((ad.getTime() - pd.getTime()) / 86400000);
          // Delay sirf tab likho jab positive ho (Actual > Planned = late). On-time/
          // jaldi (days <= 0) par cell blank rakho — 0 ya negative nahi dikhta.
          if (days > 0) {
            batchData.push({ range: `${qTab}!${idxToCol(delayIdx)}${rowNumber}`, values: [[days]] });
            delayColForFmt = delayIdx;   // number-format sirf actual delay value par
          } else {
            batchData.push({ range: `${qTab}!${idxToCol(delayIdx)}${rowNumber}`, values: [['']] });
          }
        }
      }
      if (delayReason && remarksIdx >= 0) {
        batchData.push({ range: `${qTab}!${idxToCol(remarksIdx)}${rowNumber}`, values: [[delayReason]] });
      }
    } catch (e) { console.error('  ⚠️  FMS status/delay/remark auto-fill skipped:', e.message); }

    // 6. Derived-from-ACTUAL: jab FMS ka PEHLA workflow step (Material Ready) Done hota
    //    hai, uski actual date se kuch aur columns ki Planned bhar do (jaise Packing/
    //    Billing/Dispatch/Tracking Planned = Material Ready Actual ± offset). Config
    //    intake_config.derivedSteps me from='actual' wale.
    //    NOTE: pehle trigger `step.plan_col === nextStep.planCol` (letter) se hota tha, jo
    //    column add/delete pe TOOT jaata tha — kyunki nextStep.planCol naam se heal nahi
    //    hota (stale letter reh jaata). Ab step_order se pehla step detect karte hain
    //    (letter-shift safe), aur fallback me purana letter-match bhi rakha hai.
    try {
      let cfg = null; try { cfg = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
      if (cfg) _healIntakeConfig(cfg, hdrs);        // column add/delete-safe (naam se heal)
      const rules = cfg && Array.isArray(cfg.derivedSteps)
        ? cfg.derivedSteps.filter(d => d && d.planCol && (d.from || 'plan') === 'actual') : [];
      if (rules.length) {
        // Ye FMS ka pehla step hai? (min step_order = Material Ready = trigger step)
        const [minRows] = await db.query('SELECT MIN(step_order) AS "minOrder" FROM fms_steps WHERE fms_id=?', [req.params.fmsId]);
        const isFirstStep = minRows[0] && Number(step.step_order) === Number(minRows[0].minOrder);
        const ns = cfg && cfg.nextStep;
        const letterMatch = ns && ns.planCol && String(step.plan_col || '').toUpperCase() === String(ns.planCol).toUpperCase();
        if (isFirstStep || letterMatch) {
          // Condition wale rules (jaise Location=Delhi) ho to us row ki values padho
          let rowVals = null;
          if (rules.some(d => d.cond && d.cond.col)) {
            try { const rr = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${rowNumber}:${rowNumber}` }); rowVals = (rr.data.values || [[]])[0] || []; } catch (e) {}
          }
          const getCell = (col) => rowVals ? (rowVals[colToIdx(col)] || '') : '';
          for (const d of rules) {
            const dd = _addDaysDMY(dateOnlyValue, _derivedOffset(d, getCell));
            if (dd) batchData.push({ range: `${qTab}!${String(d.planCol).toUpperCase()}${rowNumber}`, values: [[dd]] });
          }
        }
      }
    } catch (e) { console.error('  ⚠️  derived-from-actual skipped:', e.message); }

    // Single batchUpdate API call — replaces N sequential calls
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchData
      }
    });

    // Delay cell ko number-format karo (agar wo column date-format me ho to "12/1899" bug se bacho)
    if (delayColForFmt >= 0) {
      try { await _forceCellNumber(sheetsApi, spreadsheetId, tabName, delayColForFmt, rowNumber); }
      catch (e) { console.error('  ⚠️  delay number-format skipped:', e.message); }
    }

    res.json({ success: true });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════
// FMS — EXTRA INPUT FILE UPLOAD (photo / PDF → Drive)
// ══════════════════════════════════════════════════════
// Jin extra-input rows ka field_type 'file' hai, unke liye doer photo ya PDF
// chunta hai. File Drive par jaati hai (proof video wale hi Apps Script se —
// service account ka apna storage quota 0 hota hai, isliye wo seedha upload
// nahi kar sakta), aur sheet ke cell me sirf uska link likha jaata hai.
//
// Video ki tarah raw binary leti hai, base64 JSON me nahi: base64 se size 33%
// badh jaata hai aur express.json ki 12mb limit turant tut jaati.
const FMS_FILE_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const FMS_FILE_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif',   // iPhone
  'application/pdf': 'pdf',
};

app.post('/api/fms-tasks/:fmsId/steps/:stepId/upload', requireAuth,
  express.raw({ type: () => true, limit: FMS_FILE_MAX_BYTES }),
  async (req, res) => {
  try {
    // Apna alag folder ho to accha, warna video wala hi chalega.
    const folderId = extractDriveFolderId(
      process.env.GDRIVE_FMS_FOLDER_ID || process.env.GDRIVE_VIDEO_FOLDER_ID);
    if (!folderId) {
      return res.status(500).json({ error: 'File upload is not configured — set GDRIVE_FMS_FOLDER_ID' });
    }

    const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = FMS_FILE_TYPES[mime];
    if (!ext) return res.status(400).json({ error: 'Only JPG, PNG, WEBP, HEIC images or PDF files can be uploaded' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'File required' });

    // Step wahi FMS ka hai — iske bina koi bhi stepId bhej kar upload kara sakta tha.
    const [steps] = await db.query('SELECT id, step_name FROM fms_steps WHERE id=? AND fms_id=?',
      [req.params.stepId, req.params.fmsId]);
    if (!steps[0]) return res.status(404).json({ error: 'Step not found' });

    const rowNumber = parseInt(req.query.rowNumber) || 0;
    const safeStep = String(steps[0].step_name || 'step').replace(/[^\w\s-]/g, '').trim().slice(0, 30) || 'step';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    let fileId;
    try {
      const r = await callProofScript({
        action: 'upload',
        folderId,
        fileName: `fms_${req.params.fmsId}_${safeStep}_row${rowNumber}_${stamp}.${ext}`,
        mimeType: mime,
        dataBase64: req.body.toString('base64'),
      });
      fileId = r.fileId;
    } catch (e) {
      console.error('FMS file upload failed:', e.message);
      return res.status(502).json({ error: 'Could not upload to Drive. Admin: check /api/admin/drive-check.' });
    }

    // Sheet me yahi link jaata hai — Drive ka aam viewer link, jise koi bhi khol sake.
    res.json({ success: true, fileId, url: `https://drive.google.com/file/d/${fileId}/view` });
  } catch (err) {
    if (err.type === 'entity.too.large') {
      return res.status(400).json({ error: `File is too large — the limit is ${FMS_FILE_MAX_BYTES / 1024 / 1024}MB` });
    }
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════
// FMS — INTAKE FORM (naya record banana → sheet me new row = first step)
// ══════════════════════════════════════════════════════
// EDIT RECORD: Order No se existing record dhoondo — us row ke intake field values wapas.
// Permission: New Record jaisa (admin ya recordCreators).
app.get('/api/fms-tasks/:fmsId/find-record', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    if (!config || !Array.isArray(config.fields) || !config.fields.length) return res.status(400).json({ error: 'Intake form not configured for this FMS' });
    if (!isAdmin && Array.isArray(config.recordCreators) && config.recordCreators.length && !config.recordCreators.map(Number).includes(Number(req.session.userId)))
      return res.status(403).json({ error: 'You are not allowed to edit records for this FMS' });
    const orderNo = String(req.query.orderNo || '').trim();
    if (!orderNo) return res.status(400).json({ error: 'Order No required' });
    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
    const hRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const all = (await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab })).data.values || [];
    _healIntakeConfig(config, all[hRow - 1] || []);
    const autoF = config.fields.find(f => f.auto);
    const orderCol = autoF ? autoF.col : (config.fields.find(f => /order\s*no/i.test(f.label || ''))?.col);
    const orderIdx = orderCol ? colToIdx(orderCol) : -1;
    if (orderIdx < 0) return res.status(400).json({ error: 'Order No column not found in the intake fields' });
    let foundRow = -1;
    for (let r = hRow; r < all.length; r++) { if (String((all[r] || [])[orderIdx] || '').trim() === orderNo) { foundRow = r + 1; break; } }
    if (foundRow < 0) return res.status(404).json({ error: `No record found with ${autoF ? (autoF.label || 'Order No') : 'Order No'} = ${orderNo}` });
    const row = all[foundRow - 1] || [];
    const values = {};
    config.fields.forEach(f => { const i = colToIdx(f.col); values[f.col] = i >= 0 ? String(row[i] || '') : ''; });
    res.json({ rowNumber: foundRow, values, fields: config.fields });
  } catch (err) { if (err.code === 403) return res.status(400).json({ error: 'Access denied.' }); console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// EDIT RECORD: existing row ke intake fields update karo (append nahi, usi row me likho)
app.post('/api/fms-tasks/:fmsId/update-record', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    if (!config || !Array.isArray(config.fields)) return res.status(400).json({ error: 'Intake form not configured' });
    if (!isAdmin && Array.isArray(config.recordCreators) && config.recordCreators.length && !config.recordCreators.map(Number).includes(Number(req.session.userId)))
      return res.status(403).json({ error: 'You are not allowed to edit records for this FMS' });
    const rowNumber = parseInt(req.body?.rowNumber);
    const values = (req.body && typeof req.body.values === 'object' && req.body.values) ? req.body.values : {};
    if (!rowNumber || rowNumber < 1) return res.status(400).json({ error: 'Invalid row' });
    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
    const hRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
    const hdrResp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${hRow}:${hRow}` });
    _healIntakeConfig(config, (hdrResp.data.values || [[]])[0] || []);
    const batchData = [];
    for (const f of config.fields) {
      if (!(f.col in values)) continue;              // sirf bheje gaye fields update karo (file skip)
      const idx = colToIdx(f.col);
      if (idx < 0) continue;
      let v = values[f.col]; if (v === undefined || v === null) v = '';
      batchData.push({ range: `${qTab}!${idxToCol(idx)}${rowNumber}`, values: [[String(v)]] });
    }
    if (!batchData.length) return res.status(400).json({ error: 'Nothing to update' });
    await sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: batchData } });
    res.json({ success: true });
  } catch (err) { if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' }); console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// BULK ADD: ek saath kaafi records (CSV se) — har row ek naye row me append
app.post('/api/fms-tasks/:fmsId/bulk-intake', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    if (!config || !Array.isArray(config.fields) || !config.fields.length) return res.status(400).json({ error: 'Intake form not configured' });
    if (!isAdmin && Array.isArray(config.recordCreators) && config.recordCreators.length && !config.recordCreators.map(Number).includes(Number(req.session.userId)))
      return res.status(403).json({ error: 'You are not allowed to add records for this FMS' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to add' });
    if (rows.length > 500) return res.status(400).json({ error: 'Max 500 rows at a time' });
    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
    const hRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
    const readResp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
    const allRows = readResp.data.values || [];
    _healIntakeConfig(config, allRows[hRow - 1] || []);
    const startRow = Math.max(allRows.length + 1, hRow + 1);
    // Auto-number field: existing max + sequential (blank hone par)
    const autoF = config.fields.find(f => f.auto);
    let autoBase = 0;
    if (autoF) { const ai = colToIdx(autoF.col); for (let r = hRow; r < allRows.length; r++) { const n = parseInt(String((allRows[r] || [])[ai] || '').trim(), 10); if (Number.isFinite(n) && n > autoBase) autoBase = n; } }
    const batchData = [];
    rows.forEach((rec, i) => {
      const rowNum = startRow + i;
      config.fields.forEach(f => {
        const idx = colToIdx(f.col); if (idx < 0) return;
        let v = (rec && rec[f.col] != null) ? rec[f.col] : '';
        if (autoF && f.col === autoF.col && String(v).trim() === '') v = autoBase + i + 1;  // blank auto -> sequential
        if (String(v).trim() === '') return;   // blank -> cell khaali chhod do
        batchData.push({ range: `${qTab}!${idxToCol(idx)}${rowNum}`, values: [[String(v)]] });
      });
    });
    if (!batchData.length) return res.status(400).json({ error: 'Nothing to write — please check the CSV columns' });
    await sheetsApi.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data: batchData } });
    res.json({ success: true, added: rows.length, firstRow: startRow });
  } catch (err) { if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' }); console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Config lao (submit form render karne ke liye) — access-wale users
app.get('/api/fms-tasks/:id/intake', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.id, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [rows] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = rows[0];
    let config = null;
    try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    // Column letters ko current headers ke against NAAM se heal karo (column add/delete-safe),
    // taaki New Record form sahi (current) columns par values bheje.
    if (config) {
      try {
        const tTab = config.targetTab || sheet.sheet_name || 'Sheet1';
        const tHRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
        const qTab = /^[A-Za-z0-9_]+$/.test(tTab) ? tTab : `'${tTab.replace(/'/g, "''")}'`;
        const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
        const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const rr = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${tHRow}:${tHRow}` });
        _healIntakeConfig(config, (rr.data.values || [[]])[0] || []);
      } catch (e) { console.error('intake GET heal skipped:', e.message); }
    }
    res.json({ config });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Intake file (image/PDF) → Drive; viewer link return karta hai (sheet me link jaata hai)
app.post('/api/fms-tasks/:fmsId/intake-upload', requireAuth,
  express.raw({ type: () => true, limit: FMS_FILE_MAX_BYTES }),
  async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const folderId = extractDriveFolderId(process.env.GDRIVE_FMS_FOLDER_ID || process.env.GDRIVE_VIDEO_FOLDER_ID);
    if (!folderId) return res.status(500).json({ error: 'File upload is not configured — set GDRIVE_FMS_FOLDER_ID' });
    const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = FMS_FILE_TYPES[mime];
    if (!ext) return res.status(400).json({ error: 'Only JPG, PNG, WEBP, HEIC images or PDF files can be uploaded' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'File required' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    // Original filename (frontend se X-File-Name header me, URL-encoded). Sheet me yahi naam
    // dikhega aur Drive par bhi yahi save hoga. Na mile to generated naam.
    let fileName = '';
    try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || '')).trim(); } catch (e) { fileName = String(req.headers['x-file-name'] || '').trim(); }
    fileName = fileName.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
    if (!fileName) fileName = `fms_${req.params.fmsId}_intake_${stamp}.${ext}`;
    let fileId;
    try {
      const r = await callProofScript({
        action: 'upload', folderId,
        fileName,
        mimeType: mime, dataBase64: req.body.toString('base64')
      });
      fileId = r.fileId;
    } catch (e) {
      console.error('FMS intake upload failed:', e.message);
      return res.status(502).json({ error: 'Could not upload to Drive.' });
    }
    const url = `https://drive.google.com/file/d/${fileId}/view`;

    // Background-upload flow: agar row+col diye ho to upload ke baad seedha us cell me
    // HYPERLINK (file naam) likh do — record pehle hi ban chuka hota hai.
    const row = parseInt(req.query.row);
    const col = String(req.query.col || '').toUpperCase();
    if (row > 0 && /^[A-Z]+$/.test(col)) {
      try {
        const [sh] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
        if (sh[0]) {
          let cfg = null; try { cfg = JSON.parse(sh[0].intake_config || 'null'); } catch (e) {}
          const tab = (cfg && cfg.targetTab) || sh[0].sheet_name || 'Sheet1';
          const qTab = /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;
          const ssId = extractSpreadsheetId((cfg && cfg.targetSheetId) || sh[0].sheet_id);
          const wApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
          const link = `=HYPERLINK("${url}","${fileName.replace(/"/g, '""')}")`;
          await wApi.spreadsheets.values.update({ spreadsheetId: ssId, range: `${qTab}!${col}${row}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [[link]] } });
        }
      } catch (e) { console.error('intake-upload cell write failed:', e.message); }
    }
    res.json({ success: true, url, fileName });
  } catch (err) {
    if (err.type === 'entity.too.large') return res.status(400).json({ error: `File is too large — the limit is ${FMS_FILE_MAX_BYTES / 1024 / 1024}MB` });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Intake submit — configured fields ki values leke target sheet me NEW ROW append.
app.post('/api/fms-tasks/:fmsId/intake', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    const fmsId = req.params.fmsId;
    if (!await _canAccessFms(req.session.userId, fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null;
    try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    if (!config || !Array.isArray(config.fields) || !config.fields.length) return res.status(400).json({ error: 'Intake form not configured for this FMS' });
    // Record-creators restriction: agar list set hai to sirf wahi users (+ admin) new record bana sakte hain.
    if (!isAdmin && Array.isArray(config.recordCreators) && config.recordCreators.length &&
        !config.recordCreators.map(Number).includes(Number(req.session.userId))) {
      return res.status(403).json({ error: 'You are not allowed to add records for this FMS' });
    }

    const values = (req.body && typeof req.body.values === 'object' && req.body.values) ? req.body.values : {};

    const targetSheetId = config.targetSheetId || sheet.sheet_id;
    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const spreadsheetId = extractSpreadsheetId(targetSheetId);
    const hRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);
    // Tab naam me space/special ho to A1 notation me single-quote chahiye
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;

    // Poori tab padho — headers milte hi config ko NAAM se heal karo (column add/delete-safe).
    // Phir last data row nikaalo (merged headers / right-side data ke bawajood sahi empty row).
    const readResp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
    const allRows = readResp.data.values || [];
    _healIntakeConfig(config, allRows[hRow - 1] || []);

    // Required fields check — healed cols par (values frontend ke healed cols se aati hain)
    for (const f of config.fields) {
      if (f.required) {
        const v = values[f.col];
        if (v === undefined || v === null || String(v).trim() === '') return res.status(400).json({ error: `${f.label || f.col} is required` });
      }
    }

    const existingRows = allRows.length;
    const nextRow = Math.max(existingRows + 1, hRow + 1); // header ke andar/upar kabhi mat likho

    // Har value SEEDHA uske apne cell me (explicit address).
    const batchData = [];
    for (const f of config.fields) {
      const idx = colToIdx(f.col);
      if (idx < 0) continue;
      let v = values[f.col];
      if (v === undefined || v === null) v = '';
      batchData.push({ range: `${qTab}!${idxToCol(idx)}${nextRow}`, values: [[String(v)]] });
    }
    if (!batchData.length) return res.status(400).json({ error: 'No valid fields to write' });
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: batchData }
    });
    res.json({ success: true, row: nextRow });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Intake ke baad — next step ki Planned date usi row ke configured plan-column me likho
// (jaise Material Ready = K). Isse woh step "pending" ho jaata hai.
app.post('/api/fms-tasks/:fmsId/intake-nextstep', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const rowNum = parseInt(req.body?.row);
    const date = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
    if (!rowNum || rowNum < 1) return res.status(400).json({ error: 'Invalid row' });
    if (!date) return res.status(400).json({ error: 'Planned date required' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    // Config ko NAAM se heal karo (column add/delete-safe) — headers laa kar
    if (config) {
      try {
        const _hr = parseInt(config.targetHeaderRow) || sheet.header_row || 1;
        const _tt = config.targetTab || sheet.sheet_name || 'Sheet1';
        const _q = /^[A-Za-z0-9_]+$/.test(_tt) ? _tt : `'${_tt.replace(/'/g, "''")}'`;
        const _ss = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
        const _ra = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const _rh = await _ra.spreadsheets.values.get({ spreadsheetId: _ss, range: `${_q}!${_hr}:${_hr}` });
        _healIntakeConfig(config, (_rh.data.values || [[]])[0] || []);
      } catch (e) { console.error('nextstep heal skipped:', e.message); }
    }
    const ns = config && config.nextStep;
    if (!ns || !ns.planCol) return res.status(400).json({ error: 'Next step not configured' });
    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets']);

    // Main plan date + derived-from-PLANNED dates (main ± offsetDays), ek hi batch me.
    // (from='actual' wale Done pe bharte hain, yahan nahi.)
    const batchData = [{ range: `${qTab}!${ns.planCol}${rowNum}`, values: [[date]] }];
    const derived = Array.isArray(config.derivedSteps) ? config.derivedSteps.filter(d => d && d.planCol && (d.from || 'plan') === 'plan') : [];
    // Condition wale rules ho to us row ki values padho (jaise Location)
    let rowVals = null;
    if (derived.some(d => d.cond && d.cond.col)) {
      try { const rr = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${rowNum}:${rowNum}` }); rowVals = (rr.data.values || [[]])[0] || []; } catch (e) {}
    }
    const getCell = (col) => rowVals ? (rowVals[colToIdx(col)] || '') : '';
    for (const d of derived) {
      const dd = _addDaysDMY(date, _derivedOffset(d, getCell));
      if (dd) batchData.push({ range: `${qTab}!${String(d.planCol).toUpperCase()}${rowNum}`, values: [[dd]] });
    }
    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: batchData }
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied. Sheet write permission needed.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Intake ho gaya par next-step Plan date abhi set nahi — aisi rows ki list (baad me bharne ke liye).
app.get('/api/fms-tasks/:fmsId/plan-pending', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access to this FMS' });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    const ns = config && config.nextStep;
    if (!ns || !ns.planCol) return res.json({ rows: [], label: '' });
    const fields = Array.isArray(config.fields) ? config.fields : [];

    const targetTab = config.targetTab || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId(config.targetSheetId || sheet.sheet_id);
    const hRow = parseInt(config.targetHeaderRow) || sheet.header_row || 1;

    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: qTab });
    const allRows = resp.data.values || [];
    _healIntakeConfig(config, allRows[hRow - 1] || []);   // column add/delete-safe
    const planIdx = colToIdx(ns.planCol);
    if (planIdx < 0) return res.json({ rows: [], label: ns.label || '' });
    const previewFields = fields.slice(0, 4).map(f => ({ label: f.label || f.col, idx: colToIdx(f.col) })).filter(p => p.idx >= 0);

    const rows = [];
    for (let r = hRow; r < allRows.length; r++) {        // data header ke baad se
      const row = allRows[r] || [];
      if (String(row[planIdx] || '').trim()) continue;    // plan already set → skip
      const hasData = fields.some(f => { const i = colToIdx(f.col); return i >= 0 && String(row[i] || '').trim(); });
      if (!hasData) continue;
      const preview = previewFields.map(p => ({ label: p.label, value: String(row[p.idx] || '').trim() }));
      rows.push({ rowNumber: r + 1, preview });
    }
    res.json({ rows, label: ns.label || 'Planned date' });
  } catch (err) {
    if (err.code === 403) return res.status(400).json({ error: 'Access denied.' });
    console.error(err); res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Auto-number: kisi column ka last (sabse bada) number + 1 — New Record me prefill ke liye.
// Column khaali / koi number nahi → 1.
app.get('/api/fms-tasks/:fmsId/next-number', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.session.role === 'admin';
    if (!await _canAccessFms(req.session.userId, req.params.fmsId, isAdmin)) return res.status(403).json({ error: 'No access' });
    const col = String(req.query.col || '').toUpperCase();
    const idx = colToIdx(col);
    if (idx < 0) return res.json({ next: 1 });
    const [sheets] = await db.query('SELECT * FROM fms_sheets WHERE id=?', [req.params.fmsId]);
    if (!sheets[0]) return res.status(404).json({ error: 'FMS not found' });
    const sheet = sheets[0];
    let config = null; try { config = JSON.parse(sheet.intake_config || 'null'); } catch (e) {}
    const targetTab = (config && config.targetTab) || sheet.sheet_name || 'Sheet1';
    const qTab = /^[A-Za-z0-9_]+$/.test(targetTab) ? targetTab : `'${targetTab.replace(/'/g, "''")}'`;
    const spreadsheetId = extractSpreadsheetId((config && config.targetSheetId) || sheet.sheet_id);
    const hRow = (config && parseInt(config.targetHeaderRow)) || sheet.header_row || 1;
    const sheetsApi = await getSheetsClient(['https://www.googleapis.com/auth/spreadsheets.readonly']);
    const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range: `${qTab}!${col}${hRow + 1}:${col}` });
    const vals = (resp.data.values || []).map(r => r[0]);
    let max = 0;
    for (const v of vals) {
      const n = parseInt(String(v == null ? '' : v).trim(), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    res.json({ next: max + 1 });
  } catch (err) { console.error(err); res.json({ next: 1 }); }
});

// ══════════════════════════════════════════════════════
// FMS — PER-USER ROW FEED (calendar / week / MIS drill-down)
// ══════════════════════════════════════════════════════

// Ek user ke FMS rows. Default me un sheets ki har row jahan wo doer hai aur
// plan column bhara hua hai (yahi /api/mis/all ke aggregate counts se match
// karta hai). { applyDateFilter: true } bhejo to sirf woh rows aati hain jinki
// plan-date [start, end] ke andar hai.
// FMS use na karne wale users ke liye safe — khaali array milta hai.
async function fmsTasksForUserInRange(uid, start, end, opts = {}) {
  const applyDateFilter = opts.applyDateFilter === true;
  const [doerSteps] = await db.query(
    `SELECT fs.id AS step_id, fs.step_name, fs.fms_id, fs.plan_col, fs.actual_col,
            fsh.fms_name, fsh.sheet_name, fsh.sheet_id, fsh.header_row
       FROM fms_step_doers fsd
       JOIN fms_steps  fs  ON fs.id = fsd.step_id
       JOIN fms_sheets fsh ON fsh.id = fs.fms_id
      WHERE fsd.user_id = ?`,
    [uid]);
  if (!doerSteps.length) return [];

  // Sheet ke hisaab se group karo — ek spreadsheet ek hi baar padhi jaaye,
  // chahe user ke usme kai steps hon. fetchSheetRows() ko `id` chahiye (wo usse
  // sheet ke saare steps ka range nikaalta hai), isliye yahan alag object banate
  // hain — join wali row me fms_id hai, id nahi.
  const bySheet = {};
  for (const s of doerSteps) {
    if (!bySheet[s.fms_id]) {
      bySheet[s.fms_id] = {
        sheet: {
          id: s.fms_id,
          fms_name: s.fms_name,
          sheet_name: s.sheet_name,
          sheet_id: s.sheet_id,
          header_row: s.header_row
        },
        steps: []
      };
    }
    bySheet[s.fms_id].steps.push(s);
  }

  const tasks = [];
  for (const fmsId of Object.keys(bySheet)) {
    const { sheet, steps } = bySheet[fmsId];
    try {
      // fetchSheetRows() header row hata kar cached data rows deta hai.
      const rows = await fetchSheetRows(sheet);
      const headerRowIdx = (sheet.header_row || 1) - 1;
      // Naam-se-heal: sirf tab header padho jab kisi step ke naam stored hon
      const _needHeal = steps.some(s => s.plan_col_name || s.actual_col_name || s.show_col_names);
      const _hdrs = _needHeal ? await _fetchSheetHeaders(sheet) : [];

      for (const step of steps) {
        if (_needHeal) _healStepCols(step, _hdrs);
        const planIdx = colToIdx(step.plan_col);
        const actualIdx = colToIdx(step.actual_col);
        if (planIdx < 0) continue;
        rows.forEach((row, i) => {
          const planVal = (row[planIdx] || '').toString().trim();
          if (!planVal) return;
          const planDate = parseFmsPlanDate(planVal);
          if (applyDateFilter && (!planDate || planDate < start || planDate > end)) return;
          const actualVal = actualIdx >= 0 ? (row[actualIdx] || '').toString().trim() : '';
          tasks.push({
            fmsName: sheet.fms_name || sheet.sheet_name,
            stepName: step.step_name,
            planValue: planVal,
            actualValue: actualVal,
            planDate: planDate || '',
            status: actualVal ? 'completed' : 'pending',
            rowNumber: headerRowIdx + 1 + i + 1
          });
        });
      }
    } catch (e) { /* is sheet ko chhod do, baaki chalti rahe */ }
  }
  tasks.sort((a, b) => (a.planDate || '').localeCompare(b.planDate || ''));
  return tasks;
}

// Caller ke apne FMS rows ek week window me (Monday check-in view).
app.get('/api/my-week-fms-tasks', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'start, end (YYYY-MM-DD) required' });
    }
    // Monday check-in ko sirf pichhle hafte ki rows chahiye — date filter ON.
    const tasks = await fmsTasksForUserInRange(req.session.userId, start, end, { applyDateFilter: true });
    res.json({ tasks });
  } catch (err) {
    console.error('my-week-fms-tasks error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Calendar feed — caller ke apne tasks (delegation + checklist + FMS) jinki
// due/plan date [from, to] ke andar hai. Flat list with `date`, taaki calendar
// har din meetings ke saath tasks bhi dikha sake.
app.get('/api/calendar/tasks', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from, to (YYYY-MM-DD) required' });
    const uid = req.session.userId;

    const [del] = await db.query(
      `SELECT t.id, t.description, t.status, COALESCE(t.priority,'low') AS priority,
              TO_CHAR(t.due_date,'YYYY-MM-DD') AS date
         FROM delegation_tasks t
        WHERE t.assigned_to=? AND t.due_date BETWEEN ? AND ?`, [uid, from, to]);
    const [chl] = await db.query(
      `SELECT t.id, t.description, t.status, COALESCE(t.priority,'low') AS priority,
              TO_CHAR(t.due_date,'YYYY-MM-DD') AS date
         FROM checklist_tasks t
        WHERE t.assigned_to=? AND t.due_date BETWEEN ? AND ?`, [uid, from, to]);

    let fms = [];
    try { fms = await fmsTasksForUserInRange(uid, from, to, { applyDateFilter: true }); } catch (e) { /* FMS optional */ }

    const items = [
      ...del.map(t => ({ type: 'delegation', id: t.id, date: t.date, title: t.description, status: t.status, priority: t.priority, client_name: t.client_name })),
      ...chl.map(t => ({ type: 'checklist', id: t.id, date: t.date, title: t.description, status: t.status, priority: t.priority, client_name: t.client_name })),
      ...fms.map(t => ({ type: 'fms', date: t.planDate, title: `${t.fmsName} · ${t.stepName}`, status: t.status }))
    ].filter(x => x.date);

    res.json({ items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error. Please try again.' }); }
});

// Admin/HOD — kisi bhi user ke FMS rows ek date range me (MIS drill-down).
app.get('/api/mis/fms-detail', requireAuth, requireAdminOrHod, async (req, res) => {
  try {
    const { userId, start, end } = req.query;
    if (!userId || !start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({ error: 'userId, start, end (YYYY-MM-DD) required' });
    }
    // Date filter ON taaki drill-down rows MIS card ke counts se match karein.
    const tasks = await fmsTasksForUserInRange(parseInt(userId), start, end, { applyDateFilter: true });
    res.json({ tasks });
  } catch (err) {
    console.error('mis/fms-detail error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════
// TASK TRANSFERS
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/transfers')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// WEEK PLAN
// ══════════════════════════════════════════════════════
// Routes yahin register hote hain — usi jagah jahan pehle likhe the, taaki
// Express me registration ka kram na badle.
require('./routes/week-plan')(app, ROUTE_CTX);

// ══════════════════════════════════════════════════════
// PAGES
// ══════════════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));
// Auth check is handled client-side via /api/me in init() — removing server-side
// requireAuth here prevents app.html from loading if cookie has any timing/domain issue
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'app.html')));

// ══════════════════════════════════════════════════════
// MICHELIN OPS — DSR order app (alag login: mobile number, cookie ops_token)
// ══════════════════════════════════════════════════════
// Google Sheet + Apps Script wala "MICHELIN OPS" system yahan utara gaya hai.
// Routes: /api/ops/* (backend/routes/ops.js), page: /ops (frontend/ops.html).
// Iska apna auth hai — upar wale requireAuth se koi lena-dena nahi.
app.get('/ops', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'ops.html')));
require('./routes/ops')(app, { db, JWT_SECRET, IS_SERVERLESS });

// Unmatched API routes — generic JSON 404 (no Express default HTML/path disclosure)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error-handling safety net — catches anything a route forgot to try/catch.
// Never expose err.message/err.stack to the client; full detail goes to the server log only.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

// Serverless par port par sunna nahi hota — Vercel har request khud function ko
// deta hai (api/index.js `app` ko wahan pass karta hai). listen() wahan
// bekaar bhi hai aur cold start ko dheema bhi karta hai.
if (!IS_SERVERLESS) {
  app.listen(PORT, () => {
    console.log(`\n  ✦ ${BRAND.short}: http://localhost:${PORT}\n`);
  });
}

module.exports = app;