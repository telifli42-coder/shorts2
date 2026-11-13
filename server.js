'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'public', 'index.html'))
  ? path.join(ROOT, 'public')
  : ROOT;

const MAX_CLIP_SECONDS = 180;
const JOB_TTL_MS = Number(process.env.JOB_TTL_HOURS || 24) * 60 * 60 * 1000;
const X264_PRESET = process.env.X264_PRESET || 'veryfast';

const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_COOKIE = 'st_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let COOKIES_FILE = null;
if (process.env.YTDLP_COOKIES && process.env.YTDLP_COOKIES.trim()) {
  try {
    COOKIES_FILE = path.join(os.tmpdir(), 'yt-cookies.txt');
    fs.writeFileSync(COOKIES_FILE, process.env.YTDLP_COOKIES, 'utf8');
    console.log('[info] YouTube cookies yüklendi.');
  } catch (err) {
    console.warn('[warn] cookies yazılamadı:', err.message);
    COOKIES_FILE = null;
  }
}

fs.mkdirSync(JOBS_DIR, { recursive: true });

const PYTHON = process.env.PYTHON || 'python';

let FFMPEG = process.env.FFMPEG || '';
if (!FFMPEG) {
  try {
    FFMPEG = execFileSync(
      PYTHON,
      ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
  } catch (err) {
    console.warn('[warn] ffmpeg yolu bulunamadi, "ffmpeg" varsayilani kullanilacak:', err.message);
    FFMPEG = 'ffmpeg';
  }
}

const jobs = new Map();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));

const PUBLIC_PATHS = new Set(['/styles.css', '/favicon.svg', '/giris', '/api/login', '/api/health', '/api/config']);

app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (verifySessionToken(readCookie(req, SESSION_COOKIE))) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Giriş gerekli.' });
  }
  return res.redirect('/giris');
});

app.get('/giris', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'giris.html'));
});

const SENSITIVE_FILES = new Set([
  'server.js', 'package.json', 'package-lock.json', 'Dockerfile',
  '.dockerignore', '.gitignore', 'render.yaml', 'README.md',
  'kurulum.bat', 'baslat.bat',
]);

app.use((req, res, next) => {
  if (PUBLIC_DIR === ROOT) {
    const base = path.basename(req.path.split('?')[0]);
    if (
      SENSITIVE_FILES.has(base) ||
      req.path.includes('node_modules') ||
      req.path.includes('/.')
    ) {
      return res.status(404).end();
    }
  }
  next();
});

app.use(express.static(PUBLIC_DIR));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isYouTubeUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com';
  } catch {
    return false;
  }
}

function cleanError(text) {
  const lines = String(text || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^\[download\]/.test(l) && !/^\[youtube\]/.test(l) && !/^\[info\]/.test(l));
  const tail = lines.slice(-4).join(' ');
  return tail.slice(0, 400);
}

function friendlyError(message) {
  const text = String(message || '');
  if (/sign in to confirm|confirm you.re not a bot|not a bot|bot check/i.test(text)) {
    return 'YouTube bu sunucudan gelen isteği engelledi. Bir YouTube hesabından cookies.txt alıp YTDLP_COOKIES değişkenine eklemelisin.';
  }
  return text || 'Beklenmeyen bir hata oluştu.';
}

/* --------------------------- oturum / şifre --------------------------- */

function sessionSecret() {
  return crypto.createHash('sha256').update(`shorts-studio::${APP_PASSWORD || 'local-only'}`).digest();
}

function sessionSignature(exp) {
  return crypto.createHmac('sha256', sessionSecret()).update(String(exp)).digest('hex').slice(0, 32);
}

function makeSessionToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  return `${exp}.${sessionSignature(exp)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return false;
  const exp = Number(token.slice(0, idx));
  const sig = token.slice(idx + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sessionSignature(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${makeSessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`
  );
}

function makeJob(url) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const job = {
    id,
    url,
    dir,
    status: 'queued',
    progress: 0,
    message: 'Sira bekleniyor…',
    error: null,
    info: null,
    sourceFile: null,
    clipFile: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function view(job) {
  return {
    id: job.id,
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.round(job.progress || 0))),
    message: job.message || '',
    error: job.error || null,
    info: job.info,
    sourceUrl: job.sourceFile ? `/api/jobs/${job.id}/video` : null,
    clipUrl: job.clipFile ? `/api/jobs/${job.id}/clip` : null,
  };
}

function fetchInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ['-m', 'yt_dlp', '--dump-single-json', '--no-playlist', '--no-warnings'];
    if (COOKIES_FILE) args.push('--cookies', COOKIES_FILE);
    args.push(url);
    const child = spawn(PYTHON, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(cleanError(err) || 'Video bilgisi alinamadi.'));
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error('Video bilgisi okunamadi.'));
      }
    });
  });
}

function downloadJob(job) {
  return new Promise((resolve, reject) => {
    const format =
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]/b';
    const args = [
      '-m',
      'yt_dlp',
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--retries',
      '3',
      '--socket-timeout',
      '30',
      '--ffmpeg-location',
      FFMPEG,
      '-f',
      format,
      '--merge-output-format',
      'mp4',
      '-o',
      path.join(job.dir, 'video.%(ext)s'),
    ];
    if (COOKIES_FILE) args.push('--cookies', COOKIES_FILE);
    args.push(job.url);

    job.status = 'downloading';
    job.message = 'Video indiriliyor…';
    job.error = null;

    const child = spawn(PYTHON, args, { cwd: job.dir, windowsHide: true });
    let err = '';

    child.stdout.on('data', (d) => {
      const text = d.toString();
      const m = text.match(/\[download\]\s+([\d.]+)%/);
      if (m) {
        job.progress = parseFloat(m[1]);
        job.message = 'Video indiriliyor…';
      }
    });
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(cleanError(err) || 'Video indirilemedi.'));
      }
      const file = fs.readdirSync(job.dir).find((f) => f.startsWith('video.'));
      if (!file) return reject(new Error('Video dosyasi bulunamadi.'));
      job.sourceFile = path.join(job.dir, file);
      job.progress = 100;
      job.status = 'ready';
      job.message = 'Hazir';
      resolve(job);
    });
  });
}

function renderClip(job, { start, end, mode }) {
  return new Promise((resolve, reject) => {
    const duration = end - start;
    const filters = {
      blur:
        '[0:v]split=2[bg0][fg0];' +
        '[bg0]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=8:2,scale=1080:1920[bg];' +
        '[fg0]scale=1080:-2[fg];' +
        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]',
      crop: '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v]',
      original:
        '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,' +
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v]',
    };

    const outFile = path.join(job.dir, 'clip.mp4');
    const args = [
      '-y',
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-i',
      job.sourceFile,
      '-filter_complex',
      filters[mode] || filters.blur,
      '-map',
      '[v]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      X264_PRESET,
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      outFile,
    ];

    job.status = 'rendering';
    job.progress = 0;
    job.message = 'Klip olusturuluyor…';
    job.error = null;

    const child = spawn(FFMPEG, args, { cwd: job.dir, windowsHide: true });
    let err = '';

    child.stdout.on('data', (d) => {
      const text = d.toString();
      const us = text.match(/out_time_us=(\d+)/) || text.match(/out_time_ms=(\d+)/);
      if (us) {
        const micro = Number(us[1]);
        job.progress = Math.max(0, Math.min(99, (micro / (duration * 1e6)) * 100));
      }
    });
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outFile)) {
        return reject(new Error(cleanError(err) || 'Klip olusturulamadi.'));
      }
      job.clipFile = outFile;
      job.progress = 100;
      job.status = 'done';
      job.message = 'Hazir';
      resolve(job);
    });
  });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', (req, res) => res.json({ auth: Boolean(APP_PASSWORD) }));

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  const password = (req.body && req.body.password) || '';
  if (typeof password !== 'string' || password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Şifre hatalı.' });
  }
  setSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  res.json({ ok: true });
});

app.post('/api/jobs', (req, res) => {
  const url = (req.body && req.body.url) || '';
  if (!isYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Gecerli bir YouTube linki gir.' });
  }

  const job = makeJob(url);
  res.status(202).json(view(job));

  (async () => {
    try {
      job.status = 'preparing';
      job.message = 'Video bilgileri aliniyor…';
      const info = await fetchInfo(url);
      if (!info || !info.duration || !Number.isFinite(info.duration)) {
        const err = new Error('Bu video indirilemiyor (canli yayin veya kisitli icerik olabilir).');
        job.status = 'error';
        job.error = err.message;
        return;
      }
      job.info = {
        title: info.title || 'Başlıksız video',
        duration: info.duration,
        thumbnail: info.thumbnail || null,
        uploader: info.uploader || '',
        webpage_url: info.webpage_url || url,
      };
      await downloadJob(job);
    } catch (err) {
      job.status = 'error';
      job.error = friendlyError(err.message);
      job.progress = 0;
    }
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Is bulunamadi.' });
  res.json(view(job));
});

app.post('/api/jobs/:id/render', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Is bulunamadi.' });
  if (job.status === 'rendering') {
    return res.status(409).json({ error: 'Klip zaten olusturuluyor.' });
  }
  if (job.status !== 'ready' && job.status !== 'done' && job.status !== 'error') {
    return res.status(409).json({ error: 'Video henuz hazir degil.' });
  }
  if (!job.sourceFile) {
    return res.status(409).json({ error: 'Kaynak video bulunamadi.' });
  }

  const start = Number(req.body && req.body.start);
  const end = Number(req.body && req.body.end);
  const mode = ['blur', 'crop', 'original'].includes(req.body && req.body.mode)
    ? req.body.mode
    : 'blur';

  const duration = (job.info && job.info.duration) || 0;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return res.status(400).json({ error: 'Gecerli bir zaman araligi sec.' });
  }
  if (start < 0 || (duration && end > duration + 0.5)) {
    return res.status(400).json({ error: 'Secim videonun disina taşıyor.' });
  }
  if (end - start > MAX_CLIP_SECONDS) {
    return res.status(400).json({ error: `Klip en fazla ${MAX_CLIP_SECONDS} saniye olabilir.` });
  }
  if (end - start < 1) {
    return res.status(400).json({ error: 'Klip en az 1 saniye olmali.' });
  }

  res.status(202).json({ ok: true });

  renderClip(job, { start, end, mode }).catch((err) => {
    job.status = 'error';
    job.error = friendlyError(err.message);
    job.progress = 0;
  });
});

app.get('/api/jobs/:id/video', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.sourceFile || !fs.existsSync(job.sourceFile)) {
    return res.status(404).json({ error: 'Video bulunamadi.' });
  }
  res.sendFile(job.sourceFile);
});

app.get('/api/jobs/:id/clip', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.clipFile || !fs.existsSync(job.clipFile)) {
    return res.status(404).json({ error: 'Klip bulunamadi.' });
  }
  if (req.query.download) {
    return res.download(job.clipFile, `shorts-${job.id}.mp4`);
  }
  res.sendFile(job.clipFile);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadi.' }));

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== 'downloading' && job.status !== 'rendering') {
      jobs.delete(id);
      fs.rm(job.dir, { recursive: true, force: true }, () => {});
    }
  }
}

cleanupOldJobs();
setInterval(cleanupOldJobs, 60 * 60 * 1000).unref();

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ShortsStudio calisiyor');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ffmpeg: ${FFMPEG}`);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} kullanımda. PORT=3001 node server.js deneyin.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});