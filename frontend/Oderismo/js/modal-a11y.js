const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let trapRoot = null;
let trapHandler = null;
let focusBeforeTrap = null;

export function getFocusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.closest('.is-hidden')) return false;
    return el.getClientRects().length > 0;
  });
}

/** Mantiene Tab/Shift+Tab dentro del contenedor del modal. */
export function trapFocusIn(container) {
  releaseFocusTrap();
  if (!container) return;

  trapRoot = container;
  focusBeforeTrap = document.activeElement;

  const items = getFocusableElements(container);
  if (items.length) items[0].focus();

  trapHandler = (e) => {
    if (e.key !== 'Tab' || !trapRoot) return;
    const nodes = getFocusableElements(trapRoot);
    if (!nodes.length) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    const inside = trapRoot.contains(active);

    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', trapHandler, true);
}

export function releaseFocusTrap() {
  if (trapHandler) {
    document.removeEventListener('keydown', trapHandler, true);
    trapHandler = null;
  }
  trapRoot = null;
  focusBeforeTrap = null;
}

/** El modal de login no debe recibir foco cuando está oculto u otro visor está activo. */
export function syncLoginModalInert() {
  const loginModal = document.getElementById('login-modal');
  if (!loginModal) return;

  const loginOpen = !loginModal.classList.contains('is-hidden');
  const shotModalOpen = Boolean(document.querySelector('.shot-modal:not(.is-hidden)'));

  if (loginOpen && !shotModalOpen) {
    loginModal.removeAttribute('inert');
    loginModal.removeAttribute('aria-hidden');
    return;
  }

  loginModal.setAttribute('inert', '');
  loginModal.setAttribute('aria-hidden', 'true');
}

/** Bloquea la barra superior mientras un visor modal de la app está abierto. */
export function setAppChromeInert(enabled) {
  document.querySelector('.app-topbar')?.toggleAttribute('inert', Boolean(enabled));
}
