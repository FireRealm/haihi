// language: Node.js, file: server.js, target: Railway / Node 20
// env: GITHUB_OWNER, GITHUB_REPO, GITHUB_PATH, GITHUB_REF, GITHUB_TOKEN (optional), RELOAD_KEY (optional)

import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = process.env.GITHUB_OWNER || '';
const GH_REPO  = process.env.GITHUB_REPO  || '';
const GH_PATH  = process.env.GITHUB_PATH  || 'script.lua';
const GH_REF   = process.env.GITHUB_REF   || 'main';

console.log('GH_TOKEN:', GH_TOKEN ? `len=${GH_TOKEN.length}` : 'EMPTY (ok for public repo)');
console.log('GH_OWNER:', JSON.stringify(GH_OWNER));
console.log('GH_REPO :', JSON.stringify(GH_REPO));
console.log('GH_PATH :', JSON.stringify(GH_PATH));
console.log('GH_REF  :', JSON.stringify(GH_REF));

if (!GH_OWNER || !GH_REPO) { console.error('missing GITHUB_OWNER / GITHUB_REPO'); process.exit(1); }

let CACHED_LUA = null, CACHED_AT = 0;
const CACHE_TTL_MS = 60_000;

async function fetchLua() {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_REF}`;
  console.log('FETCHING:', JSON.stringify(url));
  const headers = { 'Accept':'application/vnd.github.raw', 'User-Agent':'firehub-loader', 'X-GitHub-Api-Version':'2022-11-28' };
  if (GH_TOKEN) headers['Authorization'] = `Bearer ${GH_TOKEN}`;
  const r = await fetch(url, { headers });
  if (!r.ok) { const b = await r.text().catch(()=> ''); throw new Error(`github ${r.status}: ${b.slice(0,200)}`); }
  return await r.text();
}

async function getLua() {
  const now = Date.now();
  if (CACHED_LUA && now - CACHED_AT < CACHE_TTL_MS) return CACHED_LUA;
  CACHED_LUA = await fetchLua(); CACHED_AT = now;
  return CACHED_LUA;
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count++; hits.set(ip, rec);
  return rec.count > 30;
}

const VALID_TOKENS = new Set();
function mintToken() { const t = crypto.randomBytes(16).toString('hex'); VALID_TOKENS.add(t); setTimeout(()=>VALID_TOKENS.delete(t), 300000); return t; }

function isExecutor(ua) {
  const u = (ua || '').toLowerCase();
  return ['roblox','synapse','krnl','delta','fluxus','argon','codex','hydrogen','wave','solara','xeno'].some(k => u.includes(k));
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/mint', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!isExecutor(req.headers['user-agent'])) return res.status(403).type('text/plain').send('-- forbidden');
  res.type('text/plain').send(mintToken());
});

app.get('/loader.lua', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const token = req.query.t;
  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!isExecutor(req.headers['user-agent'])) return res.status(403).type('text/plain').send('-- forbidden');
  if (!token || !VALID_TOKENS.has(token)) return res.status(403).type('text/plain').send('-- forbidden');
  VALID_TOKENS.delete(token);
  let lua;
  try { lua = await getLua(); }
  catch (e) { console.error('fetch failed:', e.message); return res.status(502).type('text/plain').send('-- upstream error'); }
  res.set({ 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store, no-cache, must-revalidate', 'X-Content-Type-Options':'nosniff' });
  res.send(lua);
});

app.get('/reload', async (req, res) => {
  if (req.headers['x-reload-key'] !== process.env.RELOAD_KEY) return res.status(403).type('text/plain').send('no');
  try { CACHED_LUA = await fetchLua(); CACHED_AT = Date.now(); res.type('text/plain').send('reloaded'); }
  catch (e) { res.status(502).type('text/plain').send('fetch failed: ' + e.message); }
});

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

app.listen(PORT, () => console.log(`loader up on ${PORT}`));
