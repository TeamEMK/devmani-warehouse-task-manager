// Pehla admin banane ka script — fresh database par login karne ke liye.
//
//   npm run db:seed-admin
//
// Email/password env se aate hain, warna default. Password bcrypt hash hokar
// jaata hai (wahi tarika jo app khud use karti hai).
//
//   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD=something npm run db:seed-admin
//
// Dobara chalane par maujooda admin ka password reset ho jaata hai — bhoolne
// par yahi sabse aasan raasta hai.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const email = process.env.ADMIN_EMAIL || 'admin@smappliances.com';
const password = process.env.ADMIN_PASSWORD || 'admin123';
const name = process.env.ADMIN_NAME || 'Admin';

(async () => {
  const hash = bcrypt.hashSync(password, 10);
  const [existing] = await db.query('SELECT id FROM users WHERE email=?', [email]);

  if (existing.length) {
    await db.query(
      'UPDATE users SET password=?, role=?, session_version=session_version+1 WHERE email=?',
      [hash, 'admin', email]);
    console.log(`  ♻️  Maujooda admin ka password reset: ${email}`);
    console.log('     (session_version badha diya — purane login sab logout ho jayenge)');
  } else {
    const [r] = await db.query(
      'INSERT INTO users (name,email,password,role,department,staff_type) VALUES (?,?,?,?,?,?)',
      [name, email, hash, 'admin', 'Management', 'office']);
    console.log(`  ✅ Admin bana: ${email} (id ${r.insertId})`);
  }

  if (password === 'admin123') {
    console.log('\n  ⚠️  Default password use hua hai. Login karke turant badal do,');
    console.log('     ya ADMIN_PASSWORD env var ke saath ye script dobara chalao.');
  }
  await db.end();
})().catch(e => { console.error('seed failed:', e.message); process.exit(1); });
