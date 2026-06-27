import { escapeHtml } from './nav.js';

const ICONS = {
  success: '✓',
  error: '✕',
  warn: '!',
  info: 'i',
};

let stackEl = null;
let confirmRoot = null;
let confirmResolve = null;

function ensureStack() {
  if (!stackEl) {
    stackEl = document.createElement('div');
    stackEl.id = 'oderismo-toast-stack';
    stackEl.className = 'oderismo-toast-stack';
    stackEl.setAttribute('aria-live', 'polite');
    stackEl.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(stackEl);
  }
  return stackEl;
}

/**
 * Notificación toast (estilo Oderismo).
 * @param {string} message
 * @param {{ type?: 'success'|'error'|'warn'|'info', duration?: number }} [opts]
 * @returns {() => void} cerrar manualmente
 */
export function showToast(message, opts = {}) {
  const type = opts.type || 'info';
  const duration = opts.duration ?? (type === 'error' ? 6500 : 4200);
  const stack = ensureStack();

  const el = document.createElement('div');
  el.className = `oderismo-toast oderismo-toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="oderismo-toast-icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>
    <p class="oderismo-toast-message">${escapeHtml(String(message))}</p>
    <button type="button" class="oderismo-toast-close" aria-label="Cerrar">×</button>
  `;

  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.remove('oderismo-toast--visible');
    el.classList.add('oderismo-toast--leaving');
    window.setTimeout(() => el.remove(), 240);
  };

  el.querySelector('.oderismo-toast-close')?.addEventListener('click', dismiss);
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('oderismo-toast--visible'));
  if (duration > 0) window.setTimeout(dismiss, duration);
  return dismiss;
}

export function toastSuccess(message, opts) {
  return showToast(message, { ...opts, type: 'success' });
}

export function toastError(message, opts) {
  return showToast(message, { ...opts, type: 'error' });
}

export function toastWarn(message, opts) {
  return showToast(message, { ...opts, type: 'warn' });
}

export function toastInfo(message, opts) {
  return showToast(message, { ...opts, type: 'info' });
}

function ensureConfirmRoot() {
  if (confirmRoot) return confirmRoot;
  confirmRoot = document.createElement('div');
  confirmRoot.id = 'oderismo-confirm-dialog';
  confirmRoot.className = 'oderismo-confirm is-hidden';
  confirmRoot.setAttribute('role', 'alertdialog');
  confirmRoot.setAttribute('aria-modal', 'true');
  confirmRoot.innerHTML = `
    <div class="oderismo-confirm-backdrop" data-confirm-cancel></div>
    <div class="oderismo-confirm-card glass-card">
      <h2 id="oderismo-confirm-title" class="title title-sm font-serifDisplay"></h2>
      <p id="oderismo-confirm-message" class="lead oderismo-confirm-lead"></p>
      <div class="oderismo-confirm-actions actions">
        <button type="button" id="oderismo-confirm-cancel" class="btn btn-secondary"></button>
        <button type="button" id="oderismo-confirm-ok" class="btn btn-primary"></button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmRoot);

  const finish = (value) => {
    confirmRoot.classList.add('is-hidden');
    document.body.style.overflow = '';
    const r = confirmResolve;
    confirmResolve = null;
    r?.(value);
  };

  confirmRoot.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => finish(false));
  confirmRoot.querySelector('#oderismo-confirm-cancel')?.addEventListener('click', () => finish(false));
  confirmRoot.querySelector('#oderismo-confirm-ok')?.addEventListener('click', () => finish(true));
  document.addEventListener('keydown', (e) => {
    if (confirmRoot.classList.contains('is-hidden') || !confirmResolve) return;
    if (e.key === 'Escape') finish(false);
  });

  return confirmRoot;
}

/**
 * Diálogo de confirmación (sustituye window.confirm).
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, options = {}) {
  const root = ensureConfirmRoot();
  const title = options.title ?? 'Confirmar';
  const confirmLabel = options.confirmLabel ?? 'Aceptar';
  const cancelLabel = options.cancelLabel ?? 'Cancelar';
  const danger = options.danger === true;

  root.querySelector('#oderismo-confirm-title').textContent = title;
  root.querySelector('#oderismo-confirm-message').textContent = message;
  const okBtn = root.querySelector('#oderismo-confirm-ok');
  const cancelBtn = root.querySelector('#oderismo-confirm-cancel');
  okBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

  return new Promise((resolve) => {
    if (confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
    root.classList.remove('is-hidden');
    document.body.style.overflow = 'hidden';
    cancelBtn.focus();
  });
}
