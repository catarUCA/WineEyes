import {
  api,
  clearSession,
  getSessionExpiresAtMs,
  getToken,
  hasSession,
  isDevAdminSession,
  logout,
  prefetchEtiquetasMediaToken,
} from './api.js';
import { toastWarn } from './toast.js';

let warnTimer = null;
let expireTimer = null;
let configCache = null;
let modalEl = null;
let handlersCache = {};

export function clearSessionConfigCache() {
  configCache = null;
}

async function loadSessionConfig() {
  if (configCache) return configCache;
  try {
    configCache = await api.fetchSessionConfig();
  } catch {
    const sessionMin = Number(window.ODERISMO_SESSION_MINUTES);
    const closeMin = Number(window.ODERISMO_SESSION_CLOSE_MINUTES);
    configCache = {
      session_ttl_seconds: Number.isFinite(sessionMin) && sessionMin > 0
        ? sessionMin * 60
        : (window.ODERISMO_SESSION_TTL_SECONDS ?? 600),
      session_warning_before_seconds: Number.isFinite(closeMin) && closeMin >= 0
        ? closeMin * 60
        : (window.ODERISMO_SESSION_WARNING_BEFORE_SECONDS ?? 60),
    };
  }
  return configCache;
}

function warnBeforeMs(cfg) {
  const sec = Number(cfg?.session_warning_before_seconds ?? 60);
  return Math.max(0, sec) * 1000;
}

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.id = 'session-timeout-modal';
  modalEl.className = 'session-timeout-modal is-hidden';
  modalEl.setAttribute('role', 'alertdialog');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.setAttribute('aria-labelledby', 'session-timeout-title');
  modalEl.innerHTML = `
    <div class="session-timeout-backdrop" data-dismiss="0"></div>
    <div class="session-timeout-card glass-card">
      <h2 id="session-timeout-title" class="title title-sm font-serifDisplay">Sesión a punto de cerrarse</h2>
      <p id="session-timeout-text" class="lead session-timeout-lead">
        Tu sesión se cerrará en breve por inactividad de seguridad.
      </p>
      <div class="session-timeout-actions actions">
        <button type="button" id="session-timeout-extend" class="btn btn-primary">
          Mantener sesión abierta
        </button>
        <button type="button" id="session-timeout-logout" class="btn btn-secondary">
          Cerrar sesión ahora
        </button>
      </div>
      <p id="session-timeout-error" class="text-red-500 text-sm is-hidden session-timeout-error"></p>
    </div>
  `;
  document.body.appendChild(modalEl);

  modalEl.querySelector('#session-timeout-extend')?.addEventListener('click', onExtendClick);
  modalEl.querySelector('#session-timeout-logout')?.addEventListener('click', () => {
    hideSessionWarning();
    logout();
  });

  return modalEl;
}

function hideSessionWarning() {
  ensureModal().classList.add('is-hidden');
}

function showSessionWarning(cfg) {
  const modal = ensureModal();
  const warnSec = Math.round(warnBeforeMs(cfg) / 1000);
  const textEl = modal.querySelector('#session-timeout-text');
  if (textEl) {
    textEl.textContent =
      warnSec >= 60
        ? `Tu sesión se cerrará en aproximadamente ${Math.round(warnSec / 60)} minuto(s). ¿Quieres seguir conectado?`
        : `Tu sesión se cerrará en unos ${warnSec} segundos. ¿Quieres seguir conectado?`;
  }
  const errEl = modal.querySelector('#session-timeout-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('is-hidden');
  }
  modal.classList.remove('is-hidden');
}

async function onExtendClick() {
  const btn = modalEl?.querySelector('#session-timeout-extend');
  const errEl = modalEl?.querySelector('#session-timeout-error');
  if (btn) btn.disabled = true;
  try {
    const user = await api.refreshSession();
    if (!user) {
      hideSessionWarning();
      await handleExpire(handlersCache);
      return;
    }
    await prefetchEtiquetasMediaToken().catch(() => {});
    hideSessionWarning();
    clearSessionConfigCache();
    await startSessionWatchdog(handlersCache);
  } catch (e) {
    if (errEl) {
      errEl.textContent = e?.message || 'No se pudo renovar la sesión';
      errEl.classList.remove('is-hidden');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleExpire(handlers = {}) {
  stopSessionWatchdog();
  hideSessionWarning();
  clearSession();
  if (typeof handlers.onExpire === 'function') {
    handlers.onExpire();
    return;
  }
  toastWarn('Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.', { duration: 8000 });
  window.setTimeout(() => window.location.reload(), 400);
}

export function stopSessionWatchdog() {
  if (warnTimer) clearTimeout(warnTimer);
  if (expireTimer) clearTimeout(expireTimer);
  warnTimer = null;
  expireTimer = null;
}

/**
 * Programa aviso (N s antes del cierre) y cierre automático según expires_at del JWT.
 */
export async function startSessionWatchdog(handlers = {}) {
  stopSessionWatchdog();
  handlersCache = handlers;

  if (!hasSession() || !getToken()) return;

  const cfg = await loadSessionConfig();

  if (isDevAdminSession()) {
    const ttlMs = (Number(cfg.session_ttl_seconds) || 600) * 1000;
    const expiresMs = Date.now() + ttlMs;
    localStorage.setItem('session_expires_at', String(Math.floor(expiresMs / 1000)));
  }

  const expiresMs = getSessionExpiresAtMs();
  if (!expiresMs) return;

  const now = Date.now();
  const warnAt = expiresMs - warnBeforeMs(cfg);

  if (warnAt > now) {
    warnTimer = setTimeout(() => {
      showSessionWarning(cfg);
      handlers.onWarn?.();
    }, warnAt - now);
  } else if (expiresMs > now) {
    showSessionWarning(cfg);
    handlers.onWarn?.();
  }

  if (expiresMs > now) {
    expireTimer = setTimeout(() => handleExpire(handlers), expiresMs - now);
  } else {
    await handleExpire(handlers);
  }
}
