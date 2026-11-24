const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'saved-data.json');
const RSVP_FILE = path.join(DIR, 'rsvps.json');
// Senha da lista de confirmados. Troque aqui ou rode: RSVP_SENHA=minhasenha node server.js
const RSVP_SENHA = process.env.RSVP_SENHA || 'troque-esta-senha';

function readRsvps() {
  try {
    return JSON.parse(fs.readFileSync(RSVP_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/data' && req.method === 'GET') {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(raw);
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ empty: true }));
      return;
    }
  }

  // Recebe uma confirmação de presença de um convidado
  if (pathname === '/api/rsvp' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 20000) req.destroy();
    });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
        const entry = {
          createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          name: clip(d.name, 100),
          attendance: d.attendance === 'Sim' ? 'Sim' : 'Não',
          count: Math.max(0, Math.min(20, parseInt(d.count, 10) || 0)),
          companions: (Array.isArray(d.companions) ? d.companions : []).slice(0, 20).map(c => clip(c, 100)),
          message: clip(d.message, 1000)
        };
        if (!entry.name) return sendJson(res, 400, { ok: false, error: 'Nome obrigatório' });
        const all = readRsvps();
        all.unshift(entry);
        fs.writeFileSync(RSVP_FILE, JSON.stringify(all, null, 2), 'utf-8');
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  // Lista privada de confirmados (exige senha)
  if (pathname === '/api/rsvps' && req.method === 'GET') {
    if (parsedUrl.searchParams.get('key') !== RSVP_SENHA) return sendJson(res, 200, { ok: false, error: 'Senha incorreta' });
    return sendJson(res, 200, { ok: true, rows: readRsvps() });
  }

  if (pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Arquivos de dados privados nunca são servidos diretamente
  if (/\/(rsvps|saved-data)\.json$/i.test(pathname) || /server\.js$/i.test(pathname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let filePath = pathname === '/' ? path.join(DIR, 'index.html') : path.join(DIR, pathname);
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor do site de casamento rodando em http://localhost:${PORT}`);
  console.log(`Lista de confirmados: abra http://localhost:${PORT}/?admin e use a senha definida em RSVP_SENHA`);
});
