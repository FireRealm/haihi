// language: Node.js, file: server.js, target: Railway / Node 20
// env: GITHUB_OWNER, GITHUB_REPO (required) — GITHUB_TOKEN, GITHUB_PATH, GITHUB_REF (optional)

import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- github config ----
// token now optional — public repos fetch without auth
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = process.env.GITHUB_OWNER || '';
const GH_REPO  = process.env.GITHUB_REPO  || '';
const GH_PATH  = process.env.GITHUB_PATH  || 'script.lua';
const GH_REF   = process.env.GITHUB_REF   || 'main';

// boot log — quoted strings reveal hidden spaces/newlines
console.log('ENV KEYS SEEN:', Object.keys(process.env).filter(k => k.startsWith('GITHUB')).join(', ') || '(none)');
console.log('GH_TOKEN:', GH_TOKEN ? `len=${GH_TOKEN.length} prefix=${GH_TOKEN.slice(0, 12)}` : 'EMPTY (ok for public repo)');
console.log('GH_OWNER:', JSON.stringify(GH_OWNER));
console.log('GH_REPO :', JSON.stringify(GH_REPO));
console.log('GH_PATH :', JSON.stringify(GH_PATH));
console.log('GH_REF  :', JSON.stringify(GH_REF));

if (!GH_OWNER || !GH_REPO) {
  console.error('missing GITHUB_OWNER / GITHUB_REPO');
  process.exit(1);
}

// ---- in-memory cache ----
let CACHED_LUA = null;
let CACHED_AT  = 0;
const CACHE_TTL_MS = 60_000;

async function fetchLuaFromGitHub() {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_REF}`;

  console.log('FETCHING:', JSON.stringify(url));

  const headers = {
    'Accept': 'application/vnd.github.raw',
    'User-Agent': 'firehub-loader',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  // only send auth if a token is actually set — empty bearer breaks public fetches
  if (GH_TOKEN) headers['Authorization'] = `Bearer ${GH_TOKEN}`;

  const r = await fetch(url, { headers });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`github ${r.status}: ${body.slice(0, 200)}`);
  }
  return await r.text();
}

async function getLua() {
  const now = Date.now();
  if (CACHED_LUA && now - CACHED_AT < CACHE_TTL_MS) return CACHED_LUA;
  CACHED_LUA = await fetchLuaFromGitHub();
  CACHED_AT  = now;
  return CACHED_LUA;
}

// ---- rate limiting ----
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_HITS  = 30;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count++;
  hits.set(ip, rec);
  return rec.count > MAX_HITS;
}

// ---- mint tokens ----
const VALID_TOKENS = new Set();
const TOKEN_TTL_MS = 5 * 60_000;

function mintToken() {
  const t = crypto.randomBytes(16).toString('hex');
  VALID_TOKENS.add(t);
  setTimeout(() => VALID_TOKENS.delete(t), TOKEN_TTL_MS);
  return t;
}

function burnToken(t) {
  VALID_TOKENS.delete(t);
}

// ---- executor UA check ----
function isExecutor(ua) {
  const u = (ua || '').toLowerCase();
  return u.includes('roblox')
      || u.includes('synapse')
      || u.includes('krnl')
      || u.includes('delta')
      || u.includes('fluxus')
      || u.includes('argon')
      || u.includes('codex')
      || u.includes('hydrogen')
      || u.includes('wave')
      || u.includes('solara')
      || u.includes('xeno');
}

// ---- static page ----
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- mint endpoint ----
app.get('/mint', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress
           || 'unknown';

  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!isExecutor(req.headers['user-agent'])) {
    return res.status(403).type('text/plain').send('-- forbidden');
  }

  res.type('text/plain').send(mintToken());
});

// ---- loader endpoint ----
app.get('/loader.lua', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress
           || 'unknown';
  const token = req.query.t;

  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!isExecutor(req.headers['user-agent'])) {
    return res.status(403).type('text/plain').send('-- forbidden');
  }
  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(403).type('text/plain').send('-- forbidden');
  }

  burnToken(token);

  let lua;
  try {
    lua = await getLua();
  } catch (e) {
    console.error('fetch failed:', e.message);
    return res.status(502).type('text/plain').send('-- upstream error');
  }

  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(lua);
});

// ---- manual cache bust ----
app.get('/reload', async (req, res) => {
  if (req.headers['x-reload-key'] !== process.env.RELOAD_KEY) {
    return res.status(403).type('text/plain').send('no');
  }
  try {
    CACHED_LUA = await fetchLuaFromGitHub();
    CACHED_AT  = Date.now();
    res.type('text/plain').send('reloaded');
  } catch (e) {
    res.status(502).type('text/plain').send('fetch failed: ' + e.message);
  }
});

// ---- health ----
app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

app.listen(PORT, () => console.log(`loader up on ${PORT}`));
