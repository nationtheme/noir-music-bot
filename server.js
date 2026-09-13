import http from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of (await readFile(envPath, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const DEV_USER_ID = process.env.DEV_USER_ID;
const dataDir = join(root, 'data');
const uploadDir = join(root, 'uploads');
const dbPath = join(dataDir, 'library.json');
let db = { tracks: [], playlists: [] };
let botOffset = 0;

await mkdir(dataDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });
if (existsSync(dbPath)) db = JSON.parse(await readFile(dbPath, 'utf8'));
else await saveDb();

async function saveDb() {
  const temp = `${dbPath}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2));
  await rename(temp, dbPath);
}
function telegram(method, body) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }).then(async response => {
    const result = await response.json();
    if (!result.ok) throw new Error(result.description || 'Telegram API failed');
    return result.result;
  });
}
function verifyInitData(value) {
  if (DEV_USER_ID && !value) return { id: Number(DEV_USER_ID), first_name: 'Developer' };
  if (!BOT_TOKEN || !value) return null;
  const params = new URLSearchParams(value);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const lines = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${key}=${val}`).join('\n');
  // Telegram's validation key is HMAC-SHA256(key=bot_token, data="WebAppData").
  const secret = createHmac('sha256', BOT_TOKEN).update('WebAppData').digest();
  const expected = createHmac('sha256', secret).update(lines).digest('hex');
  if (hash.length !== expected.length || !timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}
function getUser(req, url) {
  return verifyInitData(req.headers['x-telegram-init-data'] || url.searchParams.get('initData'));
}
function publicTrack(track) {
  return { id: track.id, title: track.title, artist: track.artist, duration: track.duration, addedAt: track.addedAt, streamPath: `/api/stream/${track.id}` };
}
function json(res, status, object) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(object));
}
async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Request too large'); }
  return raw ? JSON.parse(raw) : {};
}
function routeFile(res, relative, type) {
  readFile(join(root, relative)).then(file => {
    res.writeHead(200, { 'content-type': type }); res.end(file);
  }).catch(() => json(res, 404, { error: 'Not found' }));
}
async function storeTelegramFile(message, item) {
  const isAudio = message.audio;
  const file = item;
  const extension = extname(file.file_name || '').toLowerCase();
  if (!(isAudio || file.mime_type === 'audio/mpeg' || extension === '.mp3')) {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'Отправьте MP3 как аудио или файл.' }); return;
  }
  if (file.file_size && file.file_size > 50 * 1024 * 1024) {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'Файл больше 50 МБ — отправьте MP3 меньшего размера.' }); return;
  }
  const info = await telegram('getFile', { file_id: file.file_id });
  const audio = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.file_path}`);
  if (!audio.ok) throw new Error('Unable to download uploaded audio');
  const id = randomUUID();
  const filename = `${id}.mp3`;
  await writeFile(join(uploadDir, filename), Buffer.from(await audio.arrayBuffer()));
  db.tracks.unshift({
    id, ownerId: message.from.id, filename,
    title: isAudio ? (file.title || basename(file.file_name || 'Untitled', extension)) : basename(file.file_name || 'Untitled', extension),
    artist: isAudio ? (file.performer || 'Unknown artist') : 'Unknown artist',
    duration: isAudio ? (file.duration || 0) : 0,
    addedAt: new Date().toISOString()
  });
  await saveDb();
  await telegram('sendMessage', { chat_id: message.chat.id, text: `«${db.tracks[0].title}» добавлен в библиотеку.`, reply_markup: appKeyboard() });
}
function appKeyboard() {
  return APP_URL ? { inline_keyboard: [[{ text: 'Открыть плеер', web_app: { url: APP_URL } }]] } : undefined;
}
async function handleUpdate(update) {
  const message = update.message;
  if (!message) return;
  if (message.text?.startsWith('/start') || message.text?.startsWith('/app')) {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'Привет! Пришлите мне MP3 как аудио или файл — я добавлю его в вашу личную медиатеку.', reply_markup: appKeyboard() });
  } else if (message.text?.startsWith('/help')) {
    await telegram('sendMessage', { chat_id: message.chat.id, text: 'Отправьте MP3 в этот чат. Затем откройте плеер, чтобы слушать треки и создавать плейлисты.', reply_markup: appKeyboard() });
  } else if (message.audio || message.document) await storeTelegramFile(message, message.audio || message.document);
}
async function pollTelegram() {
  if (!BOT_TOKEN) return;
  try {
    await telegram('setMyCommands', { commands: [{ command: 'start', description: 'Открыть библиотеку' }, { command: 'app', description: 'Открыть плеер' }, { command: 'help', description: 'Как добавить музыку' }] });
    if (APP_URL) await telegram('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Плеер', web_app: { url: APP_URL } } });
    while (true) {
      const updates = await telegram('getUpdates', { offset: botOffset, timeout: 25, allowed_updates: ['message'] });
      for (const update of updates) { botOffset = update.update_id + 1; await handleUpdate(update); }
    }
  } catch (error) { console.error('Telegram:', error.message); setTimeout(pollTelegram, 5000); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/') return routeFile(res, 'public/index.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/app.js') return routeFile(res, 'public/app.js', 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/style.css') return routeFile(res, 'public/style.css', 'text/css; charset=utf-8');
  const user = getUser(req, url);
  if (!user) return json(res, 401, { error: 'Open this page from Telegram.' });
  const ownTracks = () => db.tracks.filter(track => track.ownerId === user.id);
  if (req.method === 'GET' && url.pathname === '/api/library') return json(res, 200, { user: { name: user.first_name }, tracks: ownTracks().map(publicTrack), playlists: db.playlists.filter(p => p.ownerId === user.id) });
  const streamMatch = url.pathname.match(/^\/api\/stream\/([\w-]+)$/);
  if (req.method === 'GET' && streamMatch) {
    const track = db.tracks.find(item => item.id === streamMatch[1] && item.ownerId === user.id);
    if (!track) return json(res, 404, { error: 'Track not found' });
    const path = join(uploadDir, track.filename), info = await stat(path), range = req.headers.range;
    if (range) { const [startText, endText] = range.replace('bytes=', '').split('-'); const start = Number(startText); const end = endText ? Number(endText) : info.size - 1; res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${info.size}`, 'accept-ranges': 'bytes' }); createReadStream(path, { start, end }).pipe(res); }
    else { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': info.size, 'accept-ranges': 'bytes' }); createReadStream(path).pipe(res); }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/playlists') {
    const { name } = await bodyJson(req); const clean = String(name || '').trim().slice(0, 80);
    if (!clean) return json(res, 400, { error: 'Enter a playlist name.' });
    const playlist = { id: randomUUID(), ownerId: user.id, name: clean, trackIds: [], createdAt: new Date().toISOString() };
    db.playlists.unshift(playlist); await saveDb(); return json(res, 201, playlist);
  }
  const playlistMatch = url.pathname.match(/^\/api\/playlists\/([\w-]+)\/tracks$/);
  if (req.method === 'POST' && playlistMatch) {
    const playlist = db.playlists.find(p => p.id === playlistMatch[1] && p.ownerId === user.id); const { trackId } = await bodyJson(req);
    if (!playlist || !ownTracks().some(t => t.id === trackId)) return json(res, 404, { error: 'Item not found.' });
    if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId); await saveDb(); return json(res, 200, playlist);
  }
  return json(res, 404, { error: 'Not found' });
});
server.listen(PORT, () => console.log(`Noir Music running on port ${PORT}`));
pollTelegram();
