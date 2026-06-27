const DEFAULT_ROTATE_INTERVAL_MS = 10000;

let rotateTimer = null;
let stopped = true;

function apiBase() {
  return (window.AUTH_API_URL || window.API_URL || '/api').replace(/\/$/, '');
}

export function randomImageUrl() {
  const base = (window.ETIQUETAS_PUBLIC_RANDOM_IMAGE
    || `${(window.ETIQUETAS_ORIGIN || 'https://a22.uca.es/backend-etiquetas').replace(/\/$/, '')}/api/public/random-image`);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}_=${Date.now()}`;
}

export async function fetchRotateIntervalMs() {
  try {
    const r = await fetch(`${apiBase()}/screensaver/config`, {
      headers: { Accept: 'application/json' },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return DEFAULT_ROTATE_INTERVAL_MS;
    const sec = Number(data?.time_label);
    if (!Number.isFinite(sec) || sec < 2) return DEFAULT_ROTATE_INTERVAL_MS;
    return Math.min(600, sec) * 1000;
  } catch {
    return DEFAULT_ROTATE_INTERVAL_MS;
  }
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Error cargando imagen'));
    el.src = url;
  });
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Arranca el ciclo de imágenes aleatorias en el visor indicado.
 * @param {{ stageEl: HTMLElement, onError?: (err: Error) => void, imageUrls?: string[], emptyMessage?: string, groupSize?: number }} opts
 */
export async function startScreensaver({
  stageEl,
  onError,
  imageUrls = null,
  emptyMessage = 'No hay imágenes para mostrar.',
  groupSize = 1,
}) {
  stopScreensaver();
  stopped = false;

  if (!stageEl) return;

  const rotateIntervalMs = await fetchRotateIntervalMs();
  const fixedUrls = Array.isArray(imageUrls)
    ? imageUrls.map((u) => String(u || '').trim()).filter(Boolean)
    : null;
  const visibleCount = [1, 2, 4].includes(Number(groupSize)) ? Number(groupSize) : 1;
  let fixedIndex = 0;

  stageEl.classList.remove('screensaver-stage--1', 'screensaver-stage--2', 'screensaver-stage--4');
  stageEl.classList.add(`screensaver-stage--${visibleCount}`);
  stageEl.innerHTML = `
    <div class="screensaver-layer screensaver-layer--a" aria-hidden="true"></div>
    <div class="screensaver-layer screensaver-layer--b" aria-hidden="true"></div>
    <p class="screensaver-status is-hidden" role="status"></p>
  `;

  const layerA = stageEl.querySelector('.screensaver-layer--a');
  const layerB = stageEl.querySelector('.screensaver-layer--b');
  const statusEl = stageEl.querySelector('.screensaver-status');
  let active = layerA;
  let idle = layerB;
  let pendingUrls = [];

  function setStatus(msg, visible = true) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('is-hidden', !visible || !msg);
  }

  async function swapTo(urls) {
    if (stopped || !Array.isArray(urls) || !urls.length) return;
    try {
      await Promise.all(urls.map((url) => preloadImage(url)));
      if (stopped) return;
      idle.innerHTML = urls
        .map((url) => `<img class="screensaver-img" src="${escapeAttr(url)}" alt="" decoding="async" />`)
        .join('');
      idle.classList.add('is-visible');
      active.classList.remove('is-visible');
      const tmp = active;
      active = idle;
      idle = tmp;
      idle.innerHTML = '';
      setStatus('');
    } catch (err) {
      onError?.(err);
      setStatus('No se pudo mostrar la imagen. Reintentando…');
    }
  }

  function nextImageGroup() {
    if (fixedUrls) {
      if (!fixedUrls.length) return [];
      const count = Math.min(visibleCount, fixedUrls.length);
      const urls = [];
      for (let i = 0; i < count; i += 1) {
        urls.push(fixedUrls[(fixedIndex + i) % fixedUrls.length]);
      }
      fixedIndex = (fixedIndex + count) % fixedUrls.length;
      return urls;
    }
    return [randomImageUrl()];
  }

  async function prefetchNext() {
    pendingUrls = nextImageGroup();
  }

  async function showNext() {
    if (stopped) return;
    let urls = pendingUrls;
    pendingUrls = [];
    if (!urls.length) {
      urls = nextImageGroup();
    }
    if (!urls.length) {
      setStatus(emptyMessage);
      return;
    }
    await swapTo(urls);
    prefetchNext();
  }

  showNext();
  rotateTimer = window.setInterval(showNext, rotateIntervalMs);
}

export function stopScreensaver() {
  stopped = true;
  if (rotateTimer) {
    window.clearInterval(rotateTimer);
    rotateTimer = null;
  }
}
