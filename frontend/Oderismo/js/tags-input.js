import { escapeHtml } from './nav.js';
import { toastError } from './toast.js';
import {
  normalizeTagText,
  findMatchingCatalogTag,
  findBestPrefixCompletion,
  findDidYouMeanTag,
  rankSuggestList,
  completionSuffix,
} from './tag-text-utils.js';

/**
 * Estructura DOM del componente (se genera en render()):
 *
 * <div class="tags-input">
 *   <div class="tags-input-inner" role="list">
 *     <span class="tags-input-chip">…</span>
 *     <div class="tags-input-field-wrap">
 *       <input class="tags-input-field" />
 *       <span class="tags-input-ghost" aria-hidden="true"></span>
 *     </div>
 *   </div>
 *   <div class="tags-input-hint is-hidden">¿Quisiste decir «…»?</div>
 *   <p class="tags-input-ac-bar is-hidden">Pulsa Enter o Tab para usar «…»</p>
 *   <ul class="tags-input-suggest is-hidden" role="listbox"></ul>
 * </div>
 */

/**
 * Editor de etiquetas (chips + normalización + sugerencias difusas + autocompletado).
 * @param {HTMLElement} root
 * @param {{
 *   tags?: { id: number, name: string, color?: string }[],
 *   readOnly?: boolean,
 *   placeholder?: string,
 *   fetchSuggestions?: (query: string) => Promise<{ id: number, name: string, color?: string }[]>,
 *   onCreateTag?: (name: string) => Promise<{ id: number, name: string, color?: string }>,
 *   onChange?: (tags: { id: number, name: string, color?: string }[]) => void | Promise<void>,
 *   onError?: (message: string) => void,
 * }} options
 */
export function createTagsInput(root, options = {}) {
  let tags = [...(options.tags || [])];
  const readOnly = options.readOnly === true;
  const placeholder = options.placeholder || 'Añadir etiqueta…';
  /** Catálogo acumulado (respuestas de la API) para fuzzy y prefijos sin esperar red. */
  let catalogPool = [];
  let catalogLoadPromise = null;
  let fullCatalogLoaded = false;
  let refreshToken = 0;
  let suggestions = [];
  let activeIdx = -1;
  let saving = false;
  /** Etiqueta prioritaria para Enter / Tab (prefijo o «quisiste decir»). */
  let primarySuggestion = null;

  root.classList.add('tags-input');
  if (readOnly) root.classList.add('tags-input--readonly');

  function notifyError(err) {
    const msg = err?.message || 'Error al guardar etiquetas';
    if (options.onError) options.onError(msg);
    else toastError(msg);
  }

  function takenIds() {
    return new Set(tags.map((t) => t.id));
  }

  function mergeCatalog(items) {
    const map = new Map(catalogPool.map((t) => [t.id, t]));
    for (const item of items || []) {
      if (item?.id) map.set(item.id, item);
    }
    catalogPool = [...map.values()];
  }

  /** Carga todo el catálogo del usuario (necesario para plural/typo: «coches» → «coche»). */
  async function ensureFullCatalog() {
    if (!options.fetchSuggestions || fullCatalogLoaded) return;
    if (!catalogLoadPromise) {
      catalogLoadPromise = options.fetchSuggestions('')
        .then((items) => {
          mergeCatalog(items || []);
          fullCatalogLoaded = true;
        })
        .catch((err) => {
          catalogLoadPromise = null;
          throw err;
        });
    }
    await catalogLoadPromise;
  }

  function render() {
    const chips = tags.map((t) => {
      const color = t.color || '#6366f1';
      const removeBtn = readOnly
        ? ''
        : `<button type="button" class="tags-input-chip-remove" data-id="${t.id}" aria-label="Quitar ${escapeHtml(t.name)}">×</button>`;
      return `<span class="tags-input-chip" style="--tag-color:${escapeHtml(color)}">
        <span class="tags-input-chip-label">${escapeHtml(t.name)}</span>${removeBtn}
      </span>`;
    }).join('');

    const field = readOnly
      ? ''
      : `<div class="tags-input-field-wrap">
          <input type="text" class="tags-input-field" autocomplete="off" spellcheck="false"
            placeholder="${tags.length ? '' : escapeHtml(placeholder)}" aria-autocomplete="list"
            aria-controls="tags-suggest-list" />
          <span class="tags-input-ghost" aria-hidden="true"></span>
        </div>`;

    root.innerHTML = `
      <div class="tags-input-inner" role="list">${chips}${field}</div>
      <div class="tags-input-hint is-hidden" role="status"></div>
      <p class="tags-input-ac-bar is-hidden" role="status"></p>
      <ul id="tags-suggest-list" class="tags-input-suggest is-hidden" role="listbox"></ul>
    `;

    if (!readOnly) bindField();
    root.querySelectorAll('.tags-input-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        void removeTag(parseInt(btn.getAttribute('data-id'), 10));
      });
    });
  }

  function restoreFocus(previousValue = '') {
    const input = root.querySelector('.tags-input-field');
    if (!input) return;
    input.focus();
    if (previousValue) input.value = previousValue;
    void refreshUi();
  }

  function hideSuggest() {
    root.querySelector('.tags-input-suggest')?.classList.add('is-hidden');
    activeIdx = -1;
  }

  function showSuggestList(items) {
    suggestions = items;
    const list = root.querySelector('.tags-input-suggest');
    if (!list) return;
    if (!items.length) {
      hideSuggest();
      return;
    }
    list.innerHTML = items.map((item, i) => {
      const color = item.color || '#6366f1';
      const prefix = i === 0 && primarySuggestion?.id === item.id
        ? '<span class="tags-input-suggest-badge">Tab / Enter</span>'
        : '';
      return `<li role="option" data-idx="${i}" class="tags-input-suggest-item${i === activeIdx ? ' is-active' : ''}">
        <span class="tags-input-suggest-swatch" style="background:${escapeHtml(color)}"></span>
        <span class="tags-input-suggest-label">${escapeHtml(item.name)}</span>${prefix}
      </li>`;
    }).join('');
    list.classList.remove('is-hidden');
    list.querySelectorAll('.tags-input-suggest-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        void pickSuggestion(parseInt(el.getAttribute('data-idx'), 10));
      });
    });
  }

  function updateHint(didYouMean) {
    const hint = root.querySelector('.tags-input-hint');
    if (!hint) return;
    if (!didYouMean) {
      hint.classList.add('is-hidden');
      hint.innerHTML = '';
      return;
    }
    hint.classList.remove('is-hidden');
    hint.innerHTML = `¿Quisiste decir «<button type="button" class="tags-input-hint-btn">${escapeHtml(didYouMean.name)}</button>»? Haz clic para usarla.`;
    hint.querySelector('.tags-input-hint-btn')?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      void acceptPrimary(didYouMean);
    });
  }

  function updateAcBar(tag) {
    const bar = root.querySelector('.tags-input-ac-bar');
    if (!bar) return;
    if (!tag) {
      bar.classList.add('is-hidden');
      bar.textContent = '';
      return;
    }
    bar.classList.remove('is-hidden');
    bar.textContent = `Pulsa Enter o Tab para añadir «${tag.name}»`;
  }

  function updateGhost(input, tag) {
    const ghost = root.querySelector('.tags-input-ghost');
    if (!ghost || !input) return;
    const suffix = completionSuffix(input.value, tag);
    if (!suffix) {
      ghost.textContent = '';
      ghost.style.display = 'none';
      return;
    }
    ghost.style.display = 'block';
    ghost.textContent = input.value + suffix;
  }

  /**
   * Recalcula hint, ghost, lista y sugerencia primaria según el texto actual.
   */
  async function refreshUi() {
    const input = root.querySelector('.tags-input-field');
    if (!input || readOnly) return;

    const token = ++refreshToken;
    const raw = input.value;
    const norm = normalizeTagText(raw);
    const taken = takenIds();

    try {
      await ensureFullCatalog();
      if (token !== refreshToken) return;

      if (options.fetchSuggestions && norm.length > 0) {
        try {
          const fromApi = await options.fetchSuggestions(norm);
          if (token !== refreshToken) return;
          mergeCatalog(fromApi);
        } catch (err) {
          notifyError(err);
        }
      }

      const didYouMean = findDidYouMeanTag(raw, catalogPool, taken);
      const prefixComplete = findBestPrefixCompletion(raw, catalogPool, taken);
      const ranked = rankSuggestList(raw, catalogPool, taken);

      primarySuggestion = prefixComplete || didYouMean || ranked[0] || null;

      // Siempre mostrar el aviso cuando hay coincidencia cercana (no prefijo exacto).
      updateHint(didYouMean);

      updateGhost(input, prefixComplete);
      updateAcBar(prefixComplete || (didYouMean && !prefixComplete ? didYouMean : null));
      showSuggestList(ranked);
    } catch (err) {
      if (token === refreshToken) notifyError(err);
    }
  }

  async function acceptPrimary(tag) {
    if (!tag) return;
    const input = root.querySelector('.tags-input-field');
    if (input) input.value = '';
    hideSuggest();
    updateHint(null);
    updateAcBar(null);
    primarySuggestion = null;
    await addTag(tag);
    restoreFocus();
  }

  async function pickSuggestion(idx) {
    const item = suggestions[idx];
    if (!item) return;
    await acceptPrimary(item);
  }

  async function persistTags(previousTags) {
    if (!options.onChange) return;
    saving = true;
    root.classList.add('tags-input--busy');
    try {
      await options.onChange([...tags]);
    } catch (err) {
      tags = [...previousTags];
      render();
      notifyError(err);
      throw err;
    } finally {
      saving = false;
      root.classList.remove('tags-input--busy');
    }
  }

  async function addTag(tag) {
    if (tags.some((t) => t.id === tag.id) || saving) return;
    const previous = [...tags];
    tags.push({
      id: tag.id,
      name: tag.name,
      color: tag.color || '#6366f1',
    });
    render();
    await persistTags(previous);
  }

  async function removeTag(id) {
    if (saving) return;
    const previous = [...tags];
    tags = tags.filter((t) => t.id !== id);
    render();
    await persistTags(previous);
  }

  /**
   * Añade etiqueta por nombre: normaliza, evita duplicados semánticos y reutiliza catálogo.
   */
  async function addByName(name) {
    const sanitized = normalizeTagText(name);
    if (!sanitized || saving) return;

    const displayName = String(name).trim();
    if (tags.some((t) => normalizeTagText(t.name) === sanitized)) return;

    if (options.fetchSuggestions) {
      try {
        const fromApi = await options.fetchSuggestions(sanitized);
        mergeCatalog(fromApi);
      } catch (err) {
        notifyError(err);
        return;
      }
    }

    const existing = findMatchingCatalogTag(displayName, catalogPool);
    if (existing) {
      await addTag(existing);
      return;
    }

    if (!options.onCreateTag) return;
    try {
      const created = await options.onCreateTag(displayName);
      if (created?.id) {
        mergeCatalog([created]);
        await addTag(created);
      }
    } catch (err) {
      notifyError(err);
    }
  }

  function bindField() {
    const input = root.querySelector('.tags-input-field');
    const inner = root.querySelector('.tags-input-inner');
    if (!input) return;

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => refreshUi(), 120);
    });

    input.addEventListener('focus', () => {
      if (options.fetchSuggestions) {
        void (async () => {
          try {
            const items = await options.fetchSuggestions('');
            mergeCatalog(items);
            await refreshUi();
          } catch (err) {
            notifyError(err);
          }
        })();
      }
    });

    input.addEventListener('blur', (e) => {
      const hint = root.querySelector('.tags-input-hint');
      if (hint?.contains(e.relatedTarget)) return;
      setTimeout(() => {
        if (root.querySelector('.tags-input-hint:hover')) return;
        hideSuggest();
        updateHint(null);
        updateAcBar(null);
        const ghost = root.querySelector('.tags-input-ghost');
        if (ghost) ghost.textContent = '';
      }, 280);
    });

    input.addEventListener('keydown', (e) => {
      const list = root.querySelector('.tags-input-suggest');
      const visible = list && !list.classList.contains('is-hidden');

      if (e.key === 'ArrowDown' && visible) {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, suggestions.length - 1);
        showSuggestList(suggestions);
        return;
      }
      if (e.key === 'ArrowUp' && visible) {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        showSuggestList(suggestions);
        return;
      }
      if (e.key === 'Escape') {
        hideSuggest();
        updateHint(null);
        updateAcBar(null);
        return;
      }

      // 3) Enter o Tab: autocompletado agresivo con sugerencia activa
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
        if (e.key === 'Tab' && !primarySuggestion && activeIdx < 0) return;

        e.preventDefault();
        e.stopPropagation();

        if (visible && activeIdx >= 0) {
          void pickSuggestion(activeIdx);
          return;
        }
        if (primarySuggestion) {
          void acceptPrimary(primarySuggestion);
          return;
        }

        if (e.key === 'Tab') return;

        const val = input.value.replace(/,/g, '').trim();
        if (!val) return;
        input.value = '';
        hideSuggest();
        void addByName(val);
        return;
      }

      if (e.key === 'Backspace' && input.value === '' && tags.length) {
        e.preventDefault();
        const last = tags[tags.length - 1];
        if (last) void removeTag(last.id);
      }
    });

    inner?.addEventListener('mousedown', (e) => {
      if (e.target === inner || e.target.classList.contains('tags-input-field-wrap')) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  render();

  if (!readOnly && options.fetchSuggestions) {
    void ensureFullCatalog().catch(() => {});
  }

  return {
    getTags: () => [...tags],
    setTags(next) {
      tags = [...(next || [])];
      const input = root.querySelector('.tags-input-field');
      const value = input?.value ?? '';
      const focused = document.activeElement === input;
      render();
      if (focused) restoreFocus(value);
    },
    /** Expone catálogo precargado (p. ej. todas las etiquetas del investigador). */
    setCatalog(items) {
      mergeCatalog(items);
      if (items?.length) fullCatalogLoaded = true;
    },
    async preloadCatalog() {
      await ensureFullCatalog();
    },
    destroy() {
      root.innerHTML = '';
      catalogPool = [];
      root.classList.remove('tags-input', 'tags-input--readonly', 'tags-input--busy');
    },
  };
}
