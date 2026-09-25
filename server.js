// language: Node.js, file: server.js, target: Railway / Node 20
// env: DATABASE_URL (injected by Railway Postgres)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let CACHED_LUA = '';
async function getLua() {
  if (CACHED_LUA) return CACHED_LUA;
  const r = await pool.query('SELECT lua FROM script WHERE id = 1');
  if (!r.rows[0]) throw new Error('no row');
  CACHED_LUA = r.rows[0].lua;
  return CACHED_LUA;
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count++; hits.set(ip, rec);
  return rec.count > 60;
}

function isExecutor(ua) {
  const u = (ua || '').toLowerCase();
  return ['roblox','synapse','krnl','delta','fluxus','argon','codex',
          'hydrogen','wave','solara','xeno','script-ware','swift'].some(k => u.includes(k));
}

// page still served at /page
app.get('/page', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// root now serves the script — this is what the loadstring hits
app.get('/', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';

  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!isExecutor(ua)) return res.status(403).type('text/plain').send('-- forbidden');

  let lua;
  try { lua = await getLua(); }
  catch (e) { console.error('db failed:', e.message); return res.status(502).type('text/plain').send('-- upstream error'); }

  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  });
  res.send(lua);
});

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

app.listen(PORT, () => console.log(`loader up on ${PORT}`));
