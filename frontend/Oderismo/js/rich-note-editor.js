import {
  isRichHtmlEmpty,
  loadHtmlSanitizer,
  sanitizeRichHtml,
} from './sanitize-html.js';

const QUILL_CSS = 'https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.snow.css';
const QUILL_JS = 'https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.js';

let quillAssetsPromise = null;

function loadQuillAssets() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (!quillAssetsPromise) {
    quillAssetsPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-quill-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = QUILL_CSS;
        link.dataset.quillCss = '1';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = QUILL_JS;
      script.async = true;
      script.onload = () => resolve(window.Quill);
      script.onerror = () => reject(new Error('No se pudo cargar el editor de texto'));
      document.head.appendChild(script);
    });
  }
  return quillAssetsPromise;
}

export { isRichHtmlEmpty as isQuillEmpty } from './sanitize-html.js';

/**
 * Editor enriquecido (Quill) para notas y descripciones.
 * @param {HTMLElement} mountEl — contenedor vacío
 * @param {{
 *   placeholder?: string,
 *   onSave?: (html: string) => void | Promise<void>,
 *   debounceMs?: number,
 *   rootClass?: string,
 * }} options
 */
export async function createRichNoteEditor(mountEl, options = {}) {
  const [Quill] = await Promise.all([loadQuillAssets(), loadHtmlSanitizer()]);
  const debounceMs = options.debounceMs ?? 900;
  let saveTimer = null;
  let saving = false;
  let lastSavedHtml = '';

  mountEl.classList.add('rich-note-editor');
  if (options.rootClass) {
    mountEl.classList.add(options.rootClass);
  }
  mountEl.innerHTML = '<div class="rich-note-editor-mount"></div>';

  const editorMount = mountEl.querySelector('.rich-note-editor-mount');
  const quill = new Quill(editorMount, {
    theme: 'snow',
    placeholder: options.placeholder || 'Escribe tu nota sobre esta imagen…',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean'],
      ],
    },
  });

  function getHtml() {
    return sanitizeRichHtml(quill.root.innerHTML);
  }

  function scheduleSave() {
    if (!options.onSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), debounceMs);
  }

  async function persist() {
    if (!options.onSave || saving) return;
    const html = getHtml();
    if (html === lastSavedHtml) return;
    saving = true;
    mountEl.classList.add('rich-note-editor--saving');
    try {
      await options.onSave(html);
      lastSavedHtml = html;
    } catch {
      /* El callback muestra el error al usuario */
    } finally {
      saving = false;
      mountEl.classList.remove('rich-note-editor--saving');
    }
  }

  quill.on('text-change', scheduleSave);

  return {
    getHtml,
    setHtml(html) {
      const safe = sanitizeRichHtml(html || '');
      if (isRichHtmlEmpty(safe)) {
        quill.setText('');
      } else {
        quill.root.innerHTML = safe;
      }
      lastSavedHtml = getHtml();
    },
    async saveNow() {
      clearTimeout(saveTimer);
      await persist();
    },
    destroy() {
      clearTimeout(saveTimer);
      mountEl.innerHTML = '';
      mountEl.classList.remove('rich-note-editor', 'rich-note-editor--saving');
      if (options.rootClass) {
        mountEl.classList.remove(options.rootClass);
      }
    },
  };
}
