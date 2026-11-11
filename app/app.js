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

function message(value, error = false) {
  status.textContent = value;
  status.toggleAttribute('data-error', error);
  status.hidden = !value;
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

function showResult(visible) {
  result.hidden = !visible;
  byId('empty').hidden = visible;
}

function updateDownloadLabel() {
  const [kind, quality] = result.querySelector('input:checked').value.split(':');
  const format = kind === 'audio' ? 'MP3' : 'MP4';
  const unit = kind === 'audio' ? ' kbps' : 'p';
  save.textContent = 'Download ' + format;
  byId('selection').textContent = quality + unit;
}

byId('formats').addEventListener('change', updateDownloadLabel);

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
  showResult(true);
  updateDownloadLabel();
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
  showResult(false);
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
  showResult(false);
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
    message('Download sent to your browser.');
  } catch (error) {
    message(error.message, true);
  } finally {
    setBusy(false);
  }
});

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
