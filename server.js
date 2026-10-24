// Chat colaborativo en tiempo real.
// - Web desde /public, chat en vivo con Socket.io
// - Archivos: POST /api/upload (máx. 10 MB, se bloquean ejecutables)
// - Ping a Pepe: mensaje con ping=true o con @Pepe en el texto
// - API para Pepe y otros Muse:
//     GET  /api/messages  -> últimos mensajes
//     GET  /api/pings     -> solo pings y menciones @Pepe (para el vigilante)
//     POST /api/messages  -> { author, text, ping?, target? }
//       Con CHAT_TOKEN definido, exige el header x-chat-token: TU_CLAVE.
//       La web y la subida de archivos no piden token: la sala es abierta
//       para quien tenga el enlace, como decidió el usuario.
// En Render gratis el disco puede borrarse al reiniciar: mensajes y archivos
// subidos pueden perderse. Para permanencia, usar almacenamiento externo.

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const CHAT_TOKEN = process.env.CHAT_TOKEN || '';
const DATA_FILE = path.join(__dirname, 'messages.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const MAX_MESSAGES = 200;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BLOCKED_EXT = new Set(['.exe', '.bat', '.sh', '.msi', '.dll', '.com', '.scr', '.ps1', '.jar']);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let messages = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(saved)) messages = saved.slice(-MAX_MESSAGES);
  }
} catch (e) {
  console.log('No se pudo cargar messages.json, se empieza vacío.');
}
function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(messages.slice(-MAX_MESSAGES))); } catch (e) {}
}
function cleanText(t) {
  return String(t || '').trim().slice(0, 500);
}
function isPing(text, ping, target) {
  if (ping) return true;
  if (target && String(target).toLowerCase().includes('pepe')) return true;
  return /@pepe/i.test(String(text || ''));
}
function addMessage(author, text, file, ping, target) {
  const clean = cleanText(text);
  const safeFile = file && typeof file.url === 'string' && file.url.startsWith('/uploads/')
    ? { url: file.url, name: String(file.name || 'archivo').slice(0, 100), size: Number(file.size) || 0, mime: String(file.mime || '') }
    : null;
  if (!clean && !safeFile) return null;
  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    author: String(author || 'Anónimo').trim().slice(0, 30) || 'Anónimo',
    text: clean,
    file: safeFile,
    ping: isPing(clean, ping, target),
    target: ping || isPing(clean, ping, target) ? 'Pepe' : null,
    time: new Date().toISOString(),
  };
  messages.push(msg);
  messages = messages.slice(-MAX_MESSAGES);
  save();
  io.emit('message', msg);
  return msg;
}

// --- Subida de archivos ---
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'archivo';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error('Tipo de archivo bloqueado por seguridad.'));
    cb(null, true);
  },
});
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'No se pudo subir el archivo (máx. 10 MB).' });
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    res.json({
      url: '/uploads/' + req.file.filename,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  });
});

// --- API ---
app.get('/api/health', (req, res) => res.json({ ok: true, messages: messages.length }));
app.get('/api/messages', (req, res) => {
  const since = req.query.since ? new Date(req.query.since).getTime() : 0;
  const list = since ? messages.filter((m) => new Date(m.time).getTime() > since) : messages;
  res.json(list.slice(-100));
});
app.get('/api/pings', (req, res) => {
  const since = req.query.since ? new Date(req.query.since).getTime() : 0;
  const list = messages.filter((m) => m.ping && (!since || new Date(m.time).getTime() > since));
  res.json(list.slice(-100));
});
app.post('/api/messages', (req, res) => {
  if (CHAT_TOKEN && req.headers['x-chat-token'] !== CHAT_TOKEN) {
    return res.status(401).json({ error: 'Token no válido. Envía el header x-chat-token.' });
  }
  const msg = addMessage(req.body.author, req.body.text, req.body.file, req.body.ping, req.body.target);
  if (!msg) return res.status(400).json({ error: 'Falta texto o archivo.' });
  res.json(msg);
});

// --- Chat en vivo ---
const online = new Map();
function broadcastOnline() {
  io.emit('online', [...new Set(online.values())]);
}
io.on('connection', (socket) => {
  socket.emit('history', messages);
  socket.on('join', (name) => {
    online.set(socket.id, String(name || 'Anónimo').slice(0, 30));
    broadcastOnline();
  });
  socket.on('message', (data) => {
    const msg = addMessage(data && data.author, data && data.text, data && data.file, data && data.ping, data && data.target);
    if (!msg) socket.emit('error-message', 'Escribe algo o adjunta un archivo antes de enviar.');
  });
  socket.on('typing', (name) => socket.broadcast.emit('typing', name));
  socket.on('disconnect', () => {
    online.delete(socket.id);
    broadcastOnline();
  });
});

server.listen(PORT, () => {
  console.log(`Chat listo en http://localhost:${PORT}`);
  console.log(CHAT_TOKEN ? 'API protegida con CHAT_TOKEN.' : 'API sin token (modo pruebas). Define CHAT_TOKEN en producción.');
});
