// Hostinger par deploy: git HEAD ka zip banao -> upload (TUS) -> Node.js build trigger -> poll.
// Yahi asal deploy hai — `git push` se Hostinger par kuch nahi hota (GitHub connect nahi hai).
//
// Chalao:  npm run deploy        (push + deploy, ~2 min)
//    ya:   node scripts/hostinger-deploy.js
// Token: env HOSTINGER_API_TOKEN, warna .env se khud padh leta hai.
const fs = require('fs');
const { execSync } = require('child_process');

function tokenFromDotenv() {
  try {
    const m = fs.readFileSync('.env', 'utf8').match(/^HOSTINGER_API_TOKEN=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const TOKEN = process.env.HOSTINGER_API_TOKEN || tokenFromDotenv();
const API = 'https://developers.hostinger.com/api/hosting/v1';
const USERNAME = 'u641984508';
const DOMAIN = 'devmanierp.com';
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };

if (!TOKEN) { console.error('HOSTINGER_API_TOKEN missing (env ya .env me daalo)'); process.exit(1); }

(async () => {
  // Zip hamesha taaza banao — git HEAD se (uncommitted changes deploy nahi hote)
  execSync('git archive --format=zip --prefix=devmani-warehouse-task-manager/ -o app.zip HEAD', { stdio: 'inherit' });
  console.log('zip banaya:', execSync('git log --oneline -1').toString().trim());
  // Har run ka apna filename — TUS purani adhuri upload se conflict na kare
  const name = `devmani-deploy-${Date.now()}.zip`;
  const data = fs.readFileSync('app.zip');

  let r = await fetch(API + '/files/upload-urls', {
    method: 'POST', headers: H,
    body: JSON.stringify({ username: USERNAME, domain: DOMAIN }),
  });
  const up = await r.json();
  if (!up.url) { console.error('upload-url failed:', JSON.stringify(up)); process.exit(1); }

  const tus = { 'X-Auth': up.auth_key, 'X-Auth-Rest': up.rest_auth_key, 'Tus-Resumable': '1.0.0' };
  const base = up.url.replace(/\/$/, '');
  r = await fetch(`${base}/${name}`, {
    method: 'POST',
    headers: { ...tus, 'Upload-Length': String(data.length),
      'Upload-Metadata': 'filename ' + Buffer.from(name).toString('base64') },
  });
  if (r.status !== 201) { console.error('TUS create failed:', r.status); process.exit(1); }

  // Location relative aati hai; /rest prefix wala hi chalta hai
  const loc = r.headers.get('location');
  const uploadUrl = loc.startsWith('http') ? loc : new URL(up.url).origin + '/rest' + loc;
  r = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: { ...tus, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    body: data,
  });
  if (r.headers.get('upload-offset') !== String(data.length)) {
    console.error('upload incomplete:', r.status, r.headers.get('upload-offset')); process.exit(1);
  }
  console.log('uploaded', name, data.length, 'bytes');

  r = await fetch(`${API}/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      node_version: 20, app_type: 'express',
      root_directory: 'devmani-warehouse-task-manager',
      output_directory: null, build_script: null,
      entry_file: 'backend/start.js', package_manager: null,
      source_type: 'archive', source_options: { archive_path: name },
    }),
  });
  const build = await r.json();
  console.log('build started:', r.status, build.uuid || JSON.stringify(build).slice(0, 200));

  for (let i = 0; i < 36; i++) {
    await new Promise(s => setTimeout(s, 10000));
    r = await fetch(`${API}/accounts/${USERNAME}/websites/${DOMAIN}/nodejs/builds`, { headers: H });
    const d = (await r.json()).data[0];
    process.stdout.write(d.state + ' ');
    if (!['pending', 'running', 'in_progress', 'building'].includes(d.state)) {
      console.log('\nfinal:', d.state);
      process.exit(d.state === 'completed' ? 0 : 1);
    }
  }
  console.error('\ntimeout waiting for build');
  process.exit(1);
})().catch(e => { console.error('deploy failed:', e.message); process.exit(1); });
