import { isDark } from './theme.js';

export const BRAND_LOGO_LIGHT = 'figures/logohorizontal.png';
export const BRAND_LOGO_DARK = 'figures/oderismoblanco.png';

export function brandLogoPath({ forceWhite = false } = {}) {
  return forceWhite || isDark() ? BRAND_LOGO_DARK : BRAND_LOGO_LIGHT;
}

export function brandLogoUrl(options = {}) {
  const path = brandLogoPath(options);
  const v = window.ASSET_VERSION || '';
  const q = v ? `?v=${v}` : '';
  return new URL(`${path}${q}`, document.baseURI).href;
}

/**
 * @param {HTMLImageElement | null} img
 * @param {{ forceWhite?: boolean }} [options]
 */
export function applyBrandLogo(img, options = {}) {
  if (!img) return;
  const mode = img.getAttribute('data-brand-logo');
  const forceWhite = options.forceWhite === true || mode === 'white';
  const forceLight = mode === 'light';
  const path = forceWhite
    ? BRAND_LOGO_DARK
    : forceLight
      ? BRAND_LOGO_LIGHT
      : brandLogoPath();
  const v = window.ASSET_VERSION || '';
  img.src = new URL(`${path}${v ? `?v=${v}` : ''}`, document.baseURI).href;
}

export function syncBrandLogos(root = document) {
  root.querySelectorAll('img[data-brand-logo]').forEach((img) => applyBrandLogo(img));
}
