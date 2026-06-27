const DOMPURIFY_JS = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js';

/** Etiquetas permitidas (Quill + descripciones de catálogo). */
export const RICH_HTML_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ol', 'ul', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote',
];

export const RICH_HTML_ALLOWED_ATTR = ['href', 'target', 'rel'];

let domPurifyPromise = null;

function getPurify() {
  return typeof window !== 'undefined' ? window.DOMPurify : null;
}

/** Precarga DOMPurify (llamar al iniciar la app). */
export function preloadHtmlSanitizer() {
  return loadHtmlSanitizer();
}

export function loadHtmlSanitizer() {
  if (getPurify()) return Promise.resolve(getPurify());
  if (!domPurifyPromise) {
    domPurifyPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DOMPURIFY_JS;
      script.async = true;
      script.onload = () => {
        const purify = getPurify();
        if (purify) resolve(purify);
        else reject(new Error('DOMPurify no disponible'));
      };
      script.onerror = () => reject(new Error('No se pudo cargar DOMPurify'));
      document.head.appendChild(script);
    });
  }
  return domPurifyPromise;
}

export function isRichHtmlEmpty(html) {
  const raw = String(html || '').trim();
  if (!raw) return true;
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();
  return text === '';
}

/** @deprecated Usar isRichHtmlEmpty */
export const isQuillEmpty = isRichHtmlEmpty;

/**
 * Sanea HTML enriquecido antes de innerHTML o Quill.setHtml.
 * Requiere DOMPurify cargado (await loadHtmlSanitizer()).
 */
export function sanitizeRichHtml(html) {
  const raw = String(html || '');
  if (!raw.trim()) return '';
  const purify = getPurify();
  if (!purify) {
    console.error('DOMPurify no cargado; el HTML no se mostrará.');
    return '';
  }
  return purify.sanitize(raw, {
    ALLOWED_TAGS: RICH_HTML_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_HTML_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

/** Asigna HTML enriquecido saneado a un contenedor de solo lectura. */
export function setRichHtmlContent(el, html, options = {}) {
  if (!el) return;
  const raw = String(html || '').trim();
  const hideClass = options.hiddenClass ?? 'is-hidden';
  if (!raw || isRichHtmlEmpty(raw)) {
    el.innerHTML = '';
    if (hideClass) el.classList.add(hideClass);
    return;
  }
  el.innerHTML = sanitizeRichHtml(raw);
  if (hideClass) el.classList.remove(hideClass);
}
