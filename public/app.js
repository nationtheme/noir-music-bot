const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const initData = tg?.initData || '';
let library = { tracks: [], playlists: [] }, current = -1;
const audio = new Audio();
const $ = selector => document.querySelector(selector);
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData, ...(options.headers || {}) } });
  if (!response.ok) throw new Error((await response.json()).error || 'Ошибка запроса');
  return response.json();
}
const fmt = seconds => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
function render() {
  $('#trackCount').textContent = `${library.tracks.length} ${library.tracks.length === 1 ? 'трек' : 'треков'}`;
  $('#empty').classList.toggle('hidden', library.tracks.length > 0);
  $('#trackList').innerHTML = library.tracks.map((t, i) => `<article class="track"><button class="track-art" data-play="${i}">♫</button><div><h3>${escape(t.title)}</h3><p>${escape(t.artist)} ${fmt(t.duration) ? '· ' + fmt(t.duration) : ''}</p></div><button class="more" data-add="${t.id}" title="Добавить в плейлист">＋</button></article>`).join('');
  $('#playlistList').innerHTML = library.playlists.length ? library.playlists.map(p => `<article class="playlist"><h3>${escape(p.name)}</h3><p>${p.trackIds.length} ${p.trackIds.length === 1 ? 'трек' : 'треков'}</p></article>`).join('') : '<div class="notice">Создайте первый плейлист для любимых треков.</div>';
}
function escape(value) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
function play(index) {
  if (!library.tracks.length) return;
  current = (index + library.tracks.length) % library.tracks.length;
  const track = library.tracks[current];
  audio.src = `${track.streamPath}?initData=${encodeURIComponent(initData)}`;
  audio.play().catch(() => {}); $('#player').classList.remove('hidden'); $('#nowTitle').textContent = track.title; $('#nowArtist').textContent = track.artist; $('#toggle').textContent = 'Ⅱ';
}
$('#trackList').addEventListener('click', async event => {
  const playIndex = event.target.closest('[data-play]')?.dataset.play; if (playIndex !== undefined) return play(Number(playIndex));
  const id = event.target.closest('[data-add]')?.dataset.add; if (!id) return;
  if (!library.playlists.length) return $('#playlistDialog').showModal();
  const name = prompt(`Добавить в плейлист:\n${library.playlists.map((p,i) => `${i + 1}. ${p.name}`).join('\n')}\nВведите номер:`); const p = library.playlists[Number(name) - 1];
  if (p) { await api(`/api/playlists/${p.id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId: id }) }); await load(); }
});
$('#playAll').onclick = () => play(0); $('#previous').onclick = () => play(current - 1); $('#next').onclick = () => play(current + 1);
$('#toggle').onclick = () => { if (audio.paused) { audio.play(); $('#toggle').textContent = 'Ⅱ'; } else { audio.pause(); $('#toggle').textContent = '▶'; } };
audio.ontimeupdate = () => $('#seek').value = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
audio.onended = () => play(current + 1); $('#seek').oninput = e => { if (audio.duration) audio.currentTime = audio.duration * e.target.value / 100; };
document.querySelectorAll('nav button').forEach(button => button.onclick = () => { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === button)); document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== button.dataset.view)); });
$('#newPlaylist').onclick = () => $('#playlistDialog').showModal(); $('#savePlaylist').onclick = async event => { event.preventDefault(); const name = $('#playlistName').value.trim(); if (!name) return; await api('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) }); $('#playlistName').value = ''; $('#playlistDialog').close(); await load(); };
async function load() { try { library = await api('/api/library'); $('#avatar').textContent = (library.user.name || 'N')[0].toUpperCase(); render(); } catch (error) { $('#empty').textContent = error.message; } }
load();
