import { bootstrap } from './config.js';

const byId = id => document.getElementById(id);
const status = byId('status');
const input = byId('url');
const result = byId('result');
const inspect = byId('inspect');
const save = byId('save');
let session;
let media;
let busy = false;
let playbackUrl;
let dbPromise;
let libraryRender = 0;

function message(value, error = false) {
  status.textContent = value;
  status.toggleAttribute('data-error', error);
}

function setBusy(value) {
  busy = value;
  inspect.disabled = value;
  input.readOnly = value;
  byId('paste').disabled = value;
  save.disabled = value;
}

async function api(path, body, retry = true) {
  const request = async (url, data, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      return await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(data),
        signal: AbortSignal.timeout(325000), redirect: 'error'
      });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'The media service timed out.' :
        'Could not reach the media service. Try again shortly.');
    }
  };

  if (!session || session.expires < Date.now()) {
    const response = await request(bootstrap + '/bootstrap', {});
    if (!response.ok) throw new Error('The media service is unavailable.');
    const data = await response.json();
    if (new URL(data.server).origin !== new URL(bootstrap).origin || typeof data.token !== 'string') {
      throw new Error('The media service returned an invalid session.');
    }
    session = { token: data.token, expires: Date.now() + (data.expires_in - 15) * 1000 };
  }
  const response = await request(bootstrap + path, body, session.token);
  if (response.status === 401 && retry) {
    session = undefined;
    return api(path, body, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'The media request failed.');
  }
  return response;
}

function showFormats(info) {
  const formats = byId('formats');
  formats.replaceChildren();
  for (const [kind, label, unit] of [['video', 'Video · MP4', 'p'], ['audio', 'Audio · MP3', ' kbps']]) {
    const values = [...new Set(info[kind])].filter(Number.isInteger).sort((a, b) => b - a);
    if (!values.length) continue;
    const group = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = label;
    const choices = document.createElement('div');
    choices.className = 'choices';
    for (const quality of values) {
      const choice = document.createElement('label');
      choice.className = 'choice';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'format';
      radio.value = kind + ':' + quality;
      choice.append(radio, quality + unit);
      choices.append(choice);
    }
    group.append(title, choices);
    formats.append(group);
  }
  const preferred = formats.querySelector('[value="audio:320"]') || formats.querySelector('input');
  if (!preferred) throw new Error('No downloadable formats are available for this link.');
  preferred.checked = true;
  byId('media-title').textContent = info.title;
  byId('author').textContent = info.author;
  const thumbnail = byId('thumbnail');
  thumbnail.hidden = !/^https:\/\//i.test(info.thumbnail);
  if (!thumbnail.hidden) thumbnail.src = info.thumbnail;
  result.hidden = false;
}

byId('link-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let url;
  try { url = new URL(input.value.trim()); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:(?:www\.|m\.|mobile\.)?(?:youtube\.com|instagram\.com|x\.com|twitter\.com)|youtu\.be)$/.test(url.hostname)) {
    message('Enter an HTTPS link to a video on YouTube, Instagram, or X.', true);
    return;
  }
  url.hash = '';
  result.hidden = true;
  setBusy(true);
  message('Looking up available formats…');
  try {
    const info = await (await api('/inspect', { url: url.href })).json();
    showFormats(info);
    media = { url: url.href, title: info.title };
    message('Choose a format to download.');
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
});

input.addEventListener('input', () => {
  result.hidden = true;
  message('');
});

byId('paste').addEventListener('click', async () => {
  try {
    const pasted = await navigator.clipboard.readText();
    if (busy) return;
    input.value = (pasted.match(/https:\/\/[^\s<>]+/i)?.[0] || pasted.trim()).slice(0, 2000);
    input.dispatchEvent(new Event('input'));
  } catch {
    message('Use your browser’s Paste command in the media link field.');
  }
  input.focus();
});

function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('clipdock', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function libraryStore(mode, operation) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('media', mode);
    const request = operation(transaction.objectStore('media'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function browserDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

save.addEventListener('click', async () => {
  if (busy || !media) return;
  const [kind, value] = result.querySelector('input:checked').value.split(':');
  const quality = Number(value);
  const selected = media;
  const title = selected.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'ClipDock';
  const name = title + ' - ' + quality + (kind === 'audio' ? ' kbps.mp3' : 'p.mp4');
  message('Preparing your download. This can take a few minutes…');
  setBusy(true);
  try {
    const response = await api('/download', { url: selected.url, kind, quality });
    const mime = kind === 'audio' ? 'audio/mpeg' : 'video/mp4';
    if (response.headers.get('Content-Type')?.split(';')[0] !== mime) {
      throw new Error('The media service did not return the requested file.');
    }
    const blob = await response.blob();
    browserDownload(blob, name);
    try {
      const date = Date.now();
      await libraryStore('readwrite', store => store.put({ id: crypto.randomUUID(), date, name, kind, blob }));
      message('Download started. A copy is available in Library.');
      if (!byId('library').hidden) await showLibrary();
    } catch {
      message('Download started. The browser could not keep a copy in Library.');
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
});

function stopPlayback() {
  const player = document.querySelector('.file-player');
  player?.pause();
  player?.remove();
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = undefined;
}

async function showLibrary() {
  const render = ++libraryRender;
  stopPlayback();
  const files = byId('files');
  const libraryStatus = byId('library-status');
  files.replaceChildren();
  libraryStatus.textContent = 'Loading Library…';
  try {
    const records = await libraryStore('readonly', store => store.getAll());
    if (render !== libraryRender) return;
    libraryStatus.textContent = records.length ? '' : 'Your downloads will appear here.';
    for (const file of records.sort((a, b) => b.date - a.date)) {
      const item = document.createElement('li');
      item.className = 'card';
      const heading = document.createElement('h2');
      heading.textContent = file.name;
      const actions = document.createElement('div');
      actions.className = 'file-actions';
      const button = (label, click) => {
        const element = document.createElement('button');
        element.textContent = label;
        element.addEventListener('click', click);
        return element;
      };
      actions.append(button('Play', () => {
        stopPlayback();
        const player = document.createElement(file.kind === 'audio' ? 'audio' : 'video');
        player.className = 'file-player';
        player.controls = true;
        playbackUrl = URL.createObjectURL(file.blob);
        player.src = playbackUrl;
        item.append(player);
        player.play().catch(() => {});
      }), button('Save again', () => browserDownload(file.blob, file.name)),
      button('Delete from Library', async () => {
        try {
          await libraryStore('readwrite', store => store.delete(file.id));
          await showLibrary();
        } catch {
          libraryStatus.textContent = 'Could not remove this copy from Library.';
        }
      }));
      item.append(heading, actions);
      files.append(item);
    }
  } catch {
    if (render !== libraryRender) return;
    libraryStatus.textContent = 'Library storage is unavailable in this browser.';
  }
}

for (const name of ['download', 'library']) {
  byId(name + '-tab').addEventListener('click', () => {
    for (const view of ['download', 'library']) {
      byId(view).hidden = name !== view;
      if (name === view) byId(view + '-tab').setAttribute('aria-current', 'page');
      else byId(view + '-tab').removeAttribute('aria-current');
    }
    if (name === 'library') showLibrary();
    else stopPlayback();
  });
}

const themeButton = byId('theme');
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.setAttribute('aria-pressed', String(dark));
}
try { setTheme(localStorage.getItem('theme') === 'dark'); } catch {}
themeButton.addEventListener('click', () => {
  const dark = themeButton.getAttribute('aria-pressed') !== 'true';
  setTheme(dark);
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
});
