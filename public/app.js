const socket = io();
let nickname = '';

const statusEl = document.getElementById('status');
const loginEl = document.getElementById('login');
const chatEl = document.getElementById('chat');
const messagesEl = document.getElementById('messages');

socket.on('connect', () => { statusEl.textContent = 'Conectado ✓'; });
socket.on('disconnect', () => { statusEl.textContent = 'Desconectado, reconectando…'; });

function isImage(file) {
  return (file.mime && file.mime.startsWith('image/')) || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '');
}
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function render(msg, mine) {
  const div = document.createElement('div');
  div.className = 'msg' + (mine ? ' mine' : '') + (msg.ping ? ' ping' : '');
  const author = document.createElement('b');
  author.textContent = (msg.ping ? '🔔 Ping para Pepe · ' : '') + msg.author;
  div.appendChild(author);
  if (msg.text) {
    const text = document.createElement('div');
    text.textContent = msg.text;
    div.appendChild(text);
  }
  if (msg.file) {
    if (isImage(msg.file)) {
      const link = document.createElement('a');
      link.href = msg.file.url;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = msg.file.url;
      img.alt = msg.file.name;
      img.className = 'file-img';
      link.appendChild(img);
      div.appendChild(link);
    }
    const link = document.createElement('a');
    link.href = msg.file.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'file-link';
    link.textContent = '📎 ' + msg.file.name + (msg.file.size ? ' (' + formatSize(msg.file.size) + ')' : '');
    div.appendChild(link);
  }
  const time = document.createElement('time');
  time.textContent = new Date(msg.time).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit' });
  div.appendChild(time);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

socket.on('history', (list) => { messagesEl.innerHTML = ''; list.forEach((m) => render(m, m.author === nickname)); });
socket.on('message', (m) => render(m, m.author === nickname));
socket.on('online', (list) => {
  document.getElementById('online').textContent = list.length + (list.length === 1 ? ' en línea' : ' en línea');
});
socket.on('typing', (name) => {
  const el = document.getElementById('typing');
  el.textContent = name ? name + ' está escribiendo…' : '';
  setTimeout(() => { el.textContent = ''; }, 2500);
});
socket.on('error-message', (msg) => { alert(msg); });

document.getElementById('enterBtn').onclick = () => {
  nickname = document.getElementById('nickname').value.trim() || 'Anónimo';
  socket.emit('join', nickname);
  document.getElementById('who').textContent = 'Hola, ' + nickname;
  loginEl.classList.add('hidden');
  chatEl.classList.remove('hidden');
  document.getElementById('input').focus();
};
document.getElementById('nickname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('enterBtn').click();
});
document.getElementById('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  document.getElementById('fileName').textContent = f ? f.name + ' (' + formatSize(f.size) + ')' : '';
});
document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input');
  const fileEl = document.getElementById('fileInput');
  const text = input.value.trim();
  let file = null;
  if (fileEl.files[0]) {
    const fd = new FormData();
    fd.append('file', fileEl.files[0]);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'No se pudo subir el archivo.'); return; }
    file = data;
    fileEl.value = '';
    document.getElementById('fileName').textContent = '';
  }
  if (!text && !file) return;
  socket.emit('message', { author: nickname, text, file });
  input.value = '';
});
document.getElementById('pingBtn').onclick = () => {
  const input = document.getElementById('input');
  const question = input.value.trim();
  const text = '@Pepe ' + (question || '¿Qué opinas de lo último que se ha hablado?');
  socket.emit('message', { author: nickname, text, ping: true, target: 'Pepe' });
  input.value = '';
};
document.getElementById('input').addEventListener('input', () => socket.emit('typing', nickname));
