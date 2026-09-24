// language: Node.js, file: server.js, target: Railway / Node 20
// env: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_PATH, GITHUB_REF, PORT

import express from 'express';
import crypto from 'crypto';

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- github config ----
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = process.env.GITHUB_OWNER || '';
const GH_REPO  = process.env.GITHUB_REPO  || '';
const GH_PATH  = process.env.GITHUB_PATH  || 'script.lua';
const GH_REF   = process.env.GITHUB_REF   || 'main';

if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
  console.error('missing GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO');
  process.exit(1);
}

// ---- in-memory cache ----
let CACHED_LUA = null;
let CACHED_AT  = 0;
const CACHE_TTL_MS = 60_000; // refresh at most once per minute

async function fetchLuaFromGitHub() {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_PATH}?ref=${GH_REF}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github.raw',
      'User-Agent': 'neegy-loader',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
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

// ---- static page ----
app.use(express.static('public'));

// ---- mint endpoint (executor only) ----
app.get('/mint', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress
           || 'unknown';
  const ua = (req.headers['user-agent'] || '').toLowerCase();

  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!ua.includes('roblox')) return res.status(403).type('text/plain').send('-- forbidden');

  res.type('text/plain').send(mintToken());
});

// ---- loader endpoint ----
app.get('/loader.lua', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress
           || 'unknown';
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const token = req.query.t;

  if (rateLimited(ip)) return res.status(429).type('text/plain').send('-- slow down');
  if (!ua.includes('roblox')) return res.status(403).type('text/plain').send('-- forbidden');
  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(403).type('text/plain').send('-- forbidden');
  }

  // burn — one shot
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

// ---- manual cache bust (optional, protect with a header) ----
app.get('/reload', async (req, res) => {
  if (req.headers['x-reload-key'] !== process.env.RELOAD_KEY) {
    return res.status(403).send('no');
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
