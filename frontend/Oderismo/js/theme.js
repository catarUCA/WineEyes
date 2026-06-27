import { syncBrandLogos } from './brand-logo.js';

const STORAGE_KEY = 'oderismo-theme';

export function isDark() {
  return document.documentElement.classList.contains('dark');
}

export function setDark(enabled) {
  document.documentElement.classList.toggle('dark', enabled);
  localStorage.setItem(STORAGE_KEY, enabled ? 'dark' : 'light');
  syncDarkIcons();
  syncBrandLogos();
}

export function toggleDark() {
  setDark(!isDark());
}

export function syncDarkIcons() {
  const dark = isDark();
  const icon = dark ? '☀️' : '🌙';
  const label = dark ? 'Modo claro' : 'Modo oscuro';
  document.querySelectorAll('[data-dark-icon]').forEach((el) => {
    el.textContent = icon;
  });
  document.querySelectorAll('#shell-dark-toggle, [data-dark-toggle]').forEach((btn) => {
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
  });
}

/** Restaura preferencia guardada (o sistema). Llamar al cargar la página. */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const useDark =
    saved === 'dark' ||
    (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', useDark);
  syncDarkIcons();
  syncBrandLogos();
}

export function bindDarkToggle(button) {
  if (!button) return;
  button.addEventListener('click', toggleDark);
}
