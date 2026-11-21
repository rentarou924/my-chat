// 友達用チャット - 外部パッケージ不要 (Node.js 18以降)
// 起動: CHAT_PASSWORD=あなたの合言葉 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.CHAT_PASSWORD;
if (!PASSWORD) {
  console.error('環境変数 CHAT_PASSWORD を設定してください。例: CHAT_PASSWORD=himitsu node server.js');
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');
const LOG_FILE = path.join(DATA_DIR, 'messages.json');
fs.mkdirSync(IMG_DIR, { recursive: true });

const MAX_MESSAGES = 500;
const MAX_TEXT = 2000;
const MAX_NAME = 20;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// 合言葉から作る固定トークン(再起動してもログイン状態が保たれる)
const TOKEN = crypto.createHmac('sha256', 'chat-v1').update(PASSWORD).digest('hex');

let messages = [];
try { messages = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch (_) {}
let nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(LOG_FILE, JSON.stringify(messages), () => {});
  }, 300);
}

const clients = new Set();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function getCookie(req, name) {
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function authed(req) {
  const t = getCookie(req, 'chat_token');
  return !!t && safeEqual(t, TOKEN);
}

// ログイン試行の制限 (IPごとに15分で10回)
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = (attempts.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(ip, rec);
  return rec.length >= 10;
}
function recordFail(ip) { attempts.get(ip).push(Date.now()); }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function broadcast(msg) {
  const data = `id: ${msg.id}\ndata: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (tooMany(ip)) return json(res, 429, { error: '試行回数が多すぎます。しばらく待ってください。' });
      const body = JSON.parse(await readBody(req, 4096) || '{}');
      if (typeof body.password === 'string' && safeEqual(body.password, PASSWORD)) {
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `chat_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 90}${secure}`);
        return json(res, 200, { ok: true });
      }
      recordFail(ip);
      return json(res, 401, { error: '合言葉が違います' });
    }

    // 以降は認証必須
    if (!authed(req)) return json(res, 401, { error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, { ok: true });

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      for (const m of messages) res.write(`id: ${m.id}\ndata: ${JSON.stringify(m)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/send') {
      const body = JSON.parse(await readBody(req, MAX_IMAGE_BYTES * 1.4 + 10000) || '{}');
      const name = String(body.name || '').trim().slice(0, MAX_NAME) || '名無し';
      const text = String(body.text || '').slice(0, MAX_TEXT);
      let image = null;

      if (body.image) {
        const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
        if (!m) return json(res, 400, { error: '画像形式が不正です' });
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_IMAGE_BYTES) return json(res, 413, { error: '画像が大きすぎます(4MBまで)' });
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const file = crypto.randomBytes(12).toString('hex') + '.' + ext;
        fs.writeFileSync(path.join(IMG_DIR, file), buf);
        image = '/img/' + file;
      }
      if (!text.trim() && !image) return json(res, 400, { error: '空のメッセージです' });

      const msg = { id: nextId++, name, text, image, time: Date.now() };
      messages.push(msg);
      while (messages.length > MAX_MESSAGES) {
        const old = messages.shift();
        if (old.image) fs.unlink(path.join(IMG_DIR, path.basename(old.image)), () => {});
      }
      save();
      broadcast(msg);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/img/')) {
      const file = path.basename(url.pathname);
      const p = path.join(IMG_DIR, file);
      if (!/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(file) || !fs.existsSync(p)) {
        res.writeHead(404); return res.end();
      }
      const types = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
      res.writeHead(200, {
        'Content-Type': types[file.split('.').pop()],
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
      return fs.createReadStream(p).pipe(res);
    }

    res.writeHead(404); res.end();
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: 'bad request' });
  }
});

server.listen(PORT, () => console.log(`チャット起動: http://localhost:${PORT}`));
