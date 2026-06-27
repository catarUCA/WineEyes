import { randomImageUrl } from './screensaver.js';

const DEFAULT_INTERVAL_MS = 30000;

function apiBase() {
  return (window.AUTH_API_URL || window.API_URL || '/api').replace(/\/$/, '');
}

/** Intervalo del cuadro expositor (`parameters.time_index`, segundos). */
export async function fetchLandingFrameIntervalMs() {
  try {
    const r = await fetch(`${apiBase()}/landing-frame/config`, {
      headers: { Accept: 'application/json' },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return DEFAULT_INTERVAL_MS;
    const sec = Number(data?.time_index);
    if (!Number.isFinite(sec) || sec < 2) return DEFAULT_INTERVAL_MS;
    return Math.min(600, sec) * 1000;
  } catch {
    return DEFAULT_INTERVAL_MS;
  }
}

let rotateTimer = null;
let progressFillEl = null;
let stopped = true;

function resetProgressBar(durationMs) {
  if (!progressFillEl || stopped) return;
  const progressEl = progressFillEl.closest('.landing-frame-progress');
  progressEl?.setAttribute('aria-valuenow', '0');
  progressFillEl.classList.remove('is-running');
  progressFillEl.style.removeProperty('width');
  progressFillEl.style.setProperty('--landing-frame-duration', `${durationMs}ms`);
  void progressFillEl.offsetWidth;
  progressFillEl.classList.add('is-running');
}

function clearProgressBar() {
  progressFillEl?.classList.remove('is-running');
  progressFillEl?.style.removeProperty('width');
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Error cargando etiqueta'));
    el.src = url;
  });
}

/**
 * Cuadro expositor en la portada: etiquetas aleatorias con fundido.
 * @param {{ stageEl: HTMLElement, onError?: (err: Error) => void }} opts
 */
export async function startLandingFrame({ stageEl, onError }) {
  stopLandingFrame();
  stopped = false;

  if (!stageEl) return;

  const rotateIntervalMs = await fetchLandingFrameIntervalMs();

  stageEl.innerHTML = `
    <img class="landing-frame-img landing-frame-img--a is-visible" alt="Etiqueta del archivo" decoding="async" />
    <img class="landing-frame-img landing-frame-img--b" alt="" decoding="async" />
    <p class="landing-frame-status is-hidden" role="status"></p>
    <div
      class="landing-frame-progress"
      role="progressbar"
      aria-label="Tiempo hasta la siguiente etiqueta"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="0"
    >
      <span class="landing-frame-progress-fill"></span>
    </div>
  `;

  const imgA = stageEl.querySelector('.landing-frame-img--a');
  const imgB = stageEl.querySelector('.landing-frame-img--b');
  const statusEl = stageEl.querySelector('.landing-frame-status');
  const progressEl = stageEl.querySelector('.landing-frame-progress');
  progressFillEl = stageEl.querySelector('.landing-frame-progress-fill');
  let active = imgA;
  let idle = imgB;
  let pendingUrl = '';

  function setStatus(msg, visible = true) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-hidden', !visible || !msg);
  }

  async function swapTo(url) {
    if (stopped || !url || url === active?.src) return;
    try {
      await preloadImage(url);
      if (stopped) return;
      idle.src = url;
      idle.alt = 'Etiqueta del archivo';
      idle.classList.add('is-visible');
      active.classList.remove('is-visible');
      const tmp = active;
      active = idle;
      idle = tmp;
      setStatus('');
    } catch (err) {
      onError?.(err);
      setStatus('Cargando otra etiqueta…');
    }
  }

  async function prefetchNext() {
    pendingUrl = randomImageUrl();
  }

  async function showNext() {
    if (stopped) return;
    let url = pendingUrl;
    pendingUrl = '';
    if (!url) url = randomImageUrl();
    await swapTo(url);
    prefetchNext();
    resetProgressBar(rotateIntervalMs);
  }

  progressFillEl?.addEventListener('animationend', () => {
    progressEl?.setAttribute('aria-valuenow', '100');
  });

  showNext();
  rotateTimer = window.setInterval(showNext, rotateIntervalMs);
}

export function stopLandingFrame() {
  stopped = true;
  if (rotateTimer) {
    window.clearInterval(rotateTimer);
    rotateTimer = null;
  }
  clearProgressBar();
  progressFillEl = null;
}
