'use strict';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const MAX_CLIP = 180;
const MIN_CLIP = 1;

const state = {
  jobId: null,
  duration: 0,
  start: 0,
  end: 30,
  mode: 'blur',
  timer: null,
  drag: null,
  ready: false,
  busy: false,
};

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

const el = {
  form: $('#url-form'),
  url: $('#url'),
  loadBtn: $('#load-btn'),
  formError: $('#form-error'),

  downloadStatus: $('#download-status'),
  dsText: $('#ds-text'),
  dsPct: $('#ds-pct'),
  dsBar: $('#ds-bar'),

  workspace: $('#workspace'),
  video: $('#video'),
  thumb: $('#thumb'),
  title: $('#v-title'),
  meta: $('#v-meta'),
  source: $('#v-source'),

  timeline: $('#timeline'),
  selection: $('#selection'),
  handleStart: $('#handle-start'),
  handleEnd: $('#handle-end'),
  tStart: $('#t-start'),
  tEnd: $('#t-end'),
  tTotal: $('#t-total'),
  tlDuration: $('#tl-duration'),

  setStart: $('#set-start'),
  setEnd: $('#set-end'),
  chips: Array.from(document.querySelectorAll('.chip')),

  formats: Array.from(document.querySelectorAll('.format')),
  sumDuration: $('#sum-duration'),
  sumRes: $('#sum-res'),
  renderBtn: $('#render-btn'),
  renderStatus: $('#render-status'),
  renderBar: $('#render-bar'),
  renderText: $('#render-text'),
  renderError: $('#render-error'),

  resultCard: $('#result-card'),
  resultVideo: $('#result-video'),
  downloadBtn: $('#download-btn'),
  resetBtn: $('#reset-btn'),
  logoutBtn: $('#logout-btn'),
};

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDuration(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s ? `${m} dk ${s} sn` : `${m} dk`;
  }
  return `${Math.round(seconds * 10) / 10} sn`;
}

function isYouTubeUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com';
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

function showFormError(message) {
  el.formError.textContent = message;
  el.formError.hidden = false;
}

function hideFormError() {
  el.formError.hidden = true;
  el.formError.textContent = '';
}

function showRenderError(message) {
  el.renderError.textContent = message;
  el.renderError.hidden = false;
}

function hideRenderError() {
  el.renderError.hidden = true;
  el.renderError.textContent = '';
}

function setDownloadUI(job) {
  el.downloadStatus.hidden = false;
  const pct = Math.max(0, Math.min(100, job.progress || 0));
  el.dsBar.style.width = `${pct}%`;
  el.dsPct.textContent = `${pct}%`;
  el.dsText.textContent = job.message || 'Hazırlanıyor…';
  el.loadBtn.disabled = true;
  el.loadBtn.querySelector('.btn-label').textContent = 'Yükleniyor…';
  el.loadBtn.querySelector('.spinner').hidden = false;
}

function resetDownloadUI() {
  el.downloadStatus.hidden = true;
  el.loadBtn.disabled = false;
  el.loadBtn.querySelector('.btn-label').textContent = 'Videoyu Yükle';
  el.loadBtn.querySelector('.spinner').hidden = true;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function clampRange() {
  const minGap = MIN_CLIP;
  state.start = Math.max(0, Math.min(state.start, state.duration - minGap));
  state.end = Math.min(state.duration, Math.max(state.end, state.start + minGap));
  state.end = Math.max(state.end, Math.min(state.duration, state.start + minGap));
  if (state.end > state.duration) state.end = state.duration;
  if (state.start > state.end - minGap) state.start = Math.max(0, state.end - minGap);
}

function syncTimeline() {
  const total = state.duration || 1;
  const startPct = (state.start / total) * 100;
  const endPct = (state.end / total) * 100;

  el.handleStart.style.left = `${startPct}%`;
  el.handleEnd.style.left = `${endPct}%`;
  el.selection.style.left = `${startPct}%`;
  el.selection.style.width = `${Math.max(0, endPct - startPct)}%`;

  el.tStart.textContent = fmtTime(state.start);
  el.tEnd.textContent = fmtTime(state.end);
  el.tTotal.textContent = `/ ${fmtTime(state.duration)}`;

  const clipLength = state.end - state.start;
  el.tlDuration.textContent = fmtDuration(clipLength);
  el.sumDuration.textContent = fmtDuration(clipLength);

  const invalid = clipLength > MAX_CLIP || clipLength < MIN_CLIP;
  el.renderBtn.disabled = state.busy || invalid;
  el.renderBtn.textContent = invalid && clipLength > MAX_CLIP ? 'Kesit çok uzun' : "Shorts'u Oluştur";
}

function timeFromClientX(clientX) {
  const rect = el.timeline.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * state.duration;
}

function beginDrag(handle, event) {
  state.drag = handle;
  el.handleStart.classList.toggle('is-active', handle === 'start');
  el.handleEnd.classList.toggle('is-active', handle === 'end');
  if (event) {
    event.preventDefault();
    if (event.pointerId != null && event.currentTarget && event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* yoksay */
      }
    }
  }
}

function endDrag() {
  state.drag = null;
  el.handleStart.classList.remove('is-active');
  el.handleEnd.classList.remove('is-active');
}

el.handleStart.addEventListener('pointerdown', (e) => beginDrag('start', e));
el.handleEnd.addEventListener('pointerdown', (e) => beginDrag('end', e));

el.timeline.addEventListener('pointerdown', (e) => {
  if (e.target.classList.contains('timeline-handle')) return;
  const t = timeFromClientX(e.clientX);
  const handle = Math.abs(t - state.start) <= Math.abs(t - state.end) ? 'start' : 'end';
  if (handle === 'start') state.start = Math.min(t, state.end - MIN_CLIP);
  else state.end = Math.max(t, state.start + MIN_CLIP);
  clampRange();
  syncTimeline();
  beginDrag(handle, e);
});

window.addEventListener('pointermove', (e) => {
  if (!state.drag) return;
  const t = timeFromClientX(e.clientX);
  if (state.drag === 'start') state.start = Math.min(t, state.end - MIN_CLIP);
  else state.end = Math.max(t, state.start + MIN_CLIP);
  clampRange();
  syncTimeline();
});

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* ------------------------------------------------------------------ */
/* Video ready                                                         */
/* ------------------------------------------------------------------ */

function onReady(job) {
  if (state.ready && el.video.src.endsWith(job.sourceUrl || '###')) return;

  state.duration = job.info.duration;
  state.start = 0;
  state.end = Math.min(30, state.duration);
  state.ready = true;

  el.thumb.src = job.info.thumbnail || '';
  el.title.textContent = job.info.title || 'Başlıksız video';
  el.meta.textContent = job.info.uploader ? `${job.info.uploader} · ${fmtDuration(job.info.duration)}` : fmtDuration(job.info.duration);
  el.source.href = job.info.webpage_url || job.url;

  el.video.src = job.sourceUrl;
  el.video.load();

  el.resultCard.hidden = true;
  el.resultVideo.removeAttribute('src');
  el.resultVideo.load();

  el.workspace.hidden = false;
  el.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });

  clampRange();
  syncTimeline();
  resetDownloadUI();
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

function schedulePoll() {
  clearTimeout(state.timer);
  state.timer = setTimeout(poll, 700);
}

async function poll() {
  if (!state.jobId) return;

  let job;
  try {
    const res = await fetch(`/api/jobs/${state.jobId}`, { cache: 'no-store' });
    job = await res.json();
  } catch {
    schedulePoll();
    return;
  }

  if (!job || job.id !== state.jobId) return;

  switch (job.status) {
    case 'queued':
    case 'preparing':
    case 'downloading':
      setDownloadUI(job);
      schedulePoll();
      break;

    case 'ready':
      if (!state.ready) onReady(job);
      break;

    case 'rendering':
      el.renderStatus.hidden = false;
      el.renderBar.style.width = `${job.progress || 0}%`;
      el.renderText.textContent = `${job.message || 'Klip oluşturuluyor…'} %${job.progress || 0}`;
      schedulePoll();
      break;

    case 'done':
      state.busy = false;
      el.renderBtn.disabled = false;
      el.renderStatus.hidden = true;
      showResult(job);
      break;

    case 'error':
      state.busy = false;
      el.renderBtn.disabled = false;
      if (state.ready) {
        el.renderStatus.hidden = true;
        showRenderError(job.error || 'Bir hata oluştu.');
      } else {
        resetDownloadUI();
        showFormError(job.error || 'Bir hata oluştu.');
      }
      break;

    default:
      schedulePoll();
  }
}

function showResult(job) {
  el.resultVideo.src = job.clipUrl;
  el.downloadBtn.href = `${job.clipUrl}?download=1`;
  el.resultCard.hidden = false;
  el.renderError.hidden = true;
  el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideFormError();

  const url = el.url.value.trim();
  if (!isYouTubeUrl(url)) {
    showFormError('Geçerli bir YouTube linki gir.');
    return;
  }

  resetDownloadUI();
  el.loadBtn.disabled = true;
  el.loadBtn.querySelector('.btn-label').textContent = 'Yükleniyor…';
  el.loadBtn.querySelector('.spinner').hidden = false;

  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Video yüklenemedi.');

    state.jobId = data.id;
    state.ready = false;
    setDownloadUI(data);
    clearTimeout(state.timer);
    poll();
  } catch (err) {
    resetDownloadUI();
    showFormError(err.message || 'Video yüklenemedi.');
  }
});

el.setStart.addEventListener('click', () => {
  const t = el.video.currentTime || 0;
  state.start = Math.min(t, state.end - MIN_CLIP);
  clampRange();
  syncTimeline();
});

el.setEnd.addEventListener('click', () => {
  const t = el.video.currentTime || 0;
  state.end = Math.max(t, state.start + MIN_CLIP);
  clampRange();
  syncTimeline();
});

el.chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const secs = Number(chip.dataset.secs) || 30;
    state.end = Math.min(state.duration, state.start + secs);
    clampRange();
    syncTimeline();
  });
});

el.formats.forEach((label) => {
  label.addEventListener('click', () => {
    const input = label.querySelector('input');
    if (!input) return;
    state.mode = input.value;
    el.formats.forEach((f) => f.classList.toggle('is-selected', f === label));
    el.sumRes.textContent = state.mode === 'original' ? '1920×1080' : '1080×1920';
  });
});

el.renderBtn.addEventListener('click', async () => {
  if (state.busy || !state.jobId) return;

  const length = state.end - state.start;
  hideRenderError();

  if (length > MAX_CLIP) {
    showRenderError(`Kesit en fazla ${MAX_CLIP} saniye olabilir.`);
    return;
  }
  if (length < MIN_CLIP) {
    showRenderError('Kesit en az 1 saniye olmalı.');
    return;
  }

  state.busy = true;
  el.renderBtn.disabled = true;
  el.renderStatus.hidden = false;
  el.renderBar.style.width = '0%';
  el.renderText.textContent = 'Klip oluşturuluyor… 0%';

  try {
    const res = await fetch(`/api/jobs/${state.jobId}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: state.start, end: state.end, mode: state.mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Klip oluşturulamadı.');
    clearTimeout(state.timer);
    poll();
  } catch (err) {
    state.busy = false;
    el.renderBtn.disabled = false;
    el.renderStatus.hidden = true;
    showRenderError(err.message || 'Klip oluşturulamadı.');
  }
});

el.resetBtn.addEventListener('click', () => {
  window.location.href = window.location.pathname;
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    /* yoksay */
  }
  window.location.href = '/giris';
});

fetch('/api/config', { cache: 'no-store' })
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg && cfg.auth) el.logoutBtn.hidden = false;
  })
  .catch(() => {});

el.video.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(el.video.duration) && el.video.duration > 0 && !state.duration) {
    state.duration = el.video.duration;
    syncTimeline();
  }
});