import { api, exploreImageUrl, attachExploreImageFallback } from './api.js';
import { escapeHtml } from './nav.js';
import { toastError } from './toast.js';

const LIMIT_OPTIONS = [10, 20, 50, 100];

/**
 * Edición manual de image_description en Qdrant (PATCH /images/{id}/description).
 * @param {HTMLElement} container
 * @param {{ initialImage?: { id: string | number, title?: string, url?: string, description?: string } | null }} [options]
 */
export function renderAdminImageDescription(container, options = {}) {
  let images = [];
  let selectedId = null;
  let currentQuery = '';
  let searchLimit = 20;

  container.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Descripción en Qdrant</h2>
      </div>
      <p class="admin-panel-intro">
        Modifica el texto <code>image_description</code> almacenado en la base de datos del motor.
        Al guardar se actualiza el payload en Qdrant y se reindexan los segmentos de búsqueda semántica.
      </p>

      <form id="admin-desc-search-form" class="explore-search-form admin-desc-search-form">
        <div class="explore-search-box">
          <textarea id="admin-desc-search-input" class="explore-search-input" rows="1"
            placeholder="Busca imágenes por descripción…" spellcheck="true"></textarea>
          <button type="submit" id="admin-desc-search-submit" class="explore-search-submit" aria-label="Buscar">
            <span class="explore-search-submit-icon" aria-hidden="true">⌕</span>
            <span class="explore-search-submit-spinner animate-spin is-hidden" aria-hidden="true"></span>
          </button>
        </div>
        <div id="admin-desc-limit-row" class="explore-limit-row is-hidden">
          <span class="explore-limit-label">Mostrar</span>
          <div id="admin-desc-limit-buttons" class="explore-limit-buttons"></div>
          <span class="explore-limit-label">resultados</span>
        </div>
      </form>

      <div id="admin-desc-layout" class="admin-desc-layout">
        <div id="admin-desc-editor" class="admin-desc-editor is-hidden">
          <h3 class="admin-preview-title">Editar descripción</h3>
          <p id="admin-desc-editor-meta" class="admin-preview-muted"></p>
          <div id="admin-desc-editor-thumb" class="admin-desc-thumb-wrap"></div>
          <label class="admin-label" for="admin-desc-textarea">Texto en Qdrant</label>
          <textarea id="admin-desc-textarea" class="app-input admin-desc-textarea" rows="14" spellcheck="true"></textarea>
          <div class="admin-form-actions">
            <button type="button" id="admin-desc-cancel" class="app-btn app-btn-ghost app-btn-sm">Cerrar</button>
            <button type="button" id="admin-desc-save" class="app-btn app-btn-primary app-btn-sm admin-desc-save-btn" aria-label="Guardar en Qdrant">
              <span class="admin-desc-save-label">Guardar cambios</span>
              <span class="explore-search-submit-spinner animate-spin is-hidden" aria-hidden="true"></span>
            </button>
          </div>
          <p id="admin-desc-editor-error" class="admin-form-error is-hidden"></p>
        </div>

        <div class="admin-desc-results-wrap">
          <div id="admin-desc-grid" class="explore-grid" role="list"></div>
          <p id="admin-desc-empty" class="explore-empty">
            Escribe una descripción y pulsa buscar para encontrar imágenes.
          </p>
        </div>
      </div>
    </section>
  `;

  const layoutEl = container.querySelector('#admin-desc-layout');
  const searchForm = container.querySelector('#admin-desc-search-form');
  const searchInput = container.querySelector('#admin-desc-search-input');
  const searchSubmit = container.querySelector('#admin-desc-search-submit');
  const searchSubmitIcon = searchSubmit?.querySelector('.explore-search-submit-icon');
  const searchSubmitSpinner = searchSubmit?.querySelector('.explore-search-submit-spinner');
  const limitRow = container.querySelector('#admin-desc-limit-row');
  const limitButtons = container.querySelector('#admin-desc-limit-buttons');
  const grid = container.querySelector('#admin-desc-grid');
  const emptyEl = container.querySelector('#admin-desc-empty');
  const editorEl = container.querySelector('#admin-desc-editor');
  const textarea = container.querySelector('#admin-desc-textarea');
  const editorMeta = container.querySelector('#admin-desc-editor-meta');
  const editorThumb = container.querySelector('#admin-desc-editor-thumb');
  const editorError = container.querySelector('#admin-desc-editor-error');
  const saveBtn = container.querySelector('#admin-desc-save');
  const cancelBtn = container.querySelector('#admin-desc-cancel');
  const saveLabel = saveBtn?.querySelector('.admin-desc-save-label');
  const saveSpinner = saveBtn?.querySelector('.explore-search-submit-spinner');

  LIMIT_OPTIONS.forEach((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'explore-limit-btn' + (n === searchLimit ? ' is-active' : '');
    b.textContent = String(n);
    b.dataset.limit = String(n);
    b.addEventListener('click', () => {
      searchLimit = n;
      limitButtons.querySelectorAll('.explore-limit-btn').forEach((el) => {
        el.classList.toggle('is-active', el.dataset.limit === String(n));
      });
      if (currentQuery) doSearch(currentQuery);
    });
    limitButtons.appendChild(b);
  });

  function autoResizeSearch() {
    if (!searchInput) return;
    searchInput.style.height = 'auto';
    searchInput.style.height = `${searchInput.scrollHeight}px`;
  }

  function setSearchLoading(on) {
    searchSubmit?.classList.toggle('is-loading', on);
    searchSubmitSpinner?.classList.toggle('is-hidden', !on);
    searchSubmitIcon?.classList.toggle('is-hidden', on);
    if (searchSubmit) searchSubmit.disabled = on;
    if (searchInput) searchInput.disabled = on;
  }

  function setEditorOpen(on) {
    layoutEl?.classList.toggle('admin-desc-layout--editing', on);
    editorEl.classList.toggle('is-hidden', !on);
  }

  function closeEditor() {
    selectedId = null;
    setEditorOpen(false);
    grid.querySelectorAll('.explore-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
  }

  function renderCard(img) {
    const card = document.createElement('article');
    card.className = 'explore-card' + (selectedId === String(img.id) ? ' is-selected' : '');
    card.setAttribute('data-id', img.id);
    card.setAttribute('role', 'listitem');
    const scoreHtml = img.score != null
      ? `<span class="explore-card-score">${(Number(img.score) * 100).toFixed(0)}%</span>`
      : '';
    card.innerHTML = `
      <button type="button" class="explore-card-hit" aria-label="Editar descripción">
        <div class="explore-card-media">
          <img src="${exploreImageUrl(img, { thumb: true })}" alt="${escapeHtml(img.title || '')}" loading="lazy" />
        </div>
        ${scoreHtml}
      </button>
    `;
    const fullSrc = exploreImageUrl(img, { thumb: false });
    attachExploreImageFallback(card.querySelector('.explore-card-media img'), fullSrc);
    card.querySelector('.explore-card-hit').addEventListener('click', () => openEditor(img));
    return card;
  }

  function renderGrid(list) {
    grid.innerHTML = '';
    list.forEach((img) => grid.appendChild(renderCard(img)));
    const showEmpty = !list.length && !selectedId;
    emptyEl.classList.toggle('is-hidden', !showEmpty);
  }

  function showEditorShell(img) {
    selectedId = String(img.id);
    setEditorOpen(true);
    editorMeta.textContent = `ID ${img.id} · ${img.title || 'sin nombre'}`;
    editorError.classList.add('is-hidden');
    const thumbUrl = exploreImageUrl(img, { thumb: false });
    editorThumb.innerHTML = thumbUrl
      ? `<img src="${escapeHtml(thumbUrl)}" alt="" class="admin-desc-thumb" loading="lazy" />`
      : '';
    grid.querySelectorAll('.explore-card').forEach((c) => {
      c.classList.toggle('is-selected', c.dataset.id === selectedId);
    });
    editorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadDescriptionIntoEditor(img, { keepExistingOnError = false } = {}) {
    if (typeof img.description === 'string' && img.description !== '') {
      textarea.value = img.description;
    } else {
      textarea.value = '';
    }
    textarea.disabled = true;

    try {
      const detail = await api.getImageQdrantDetail(img.id);
      textarea.value = detail.description || '';
      const idx = images.findIndex((i) => String(i.id) === selectedId);
      const merged = {
        ...img,
        ...detail,
        description: detail.description || '',
      };
      if (idx >= 0) {
        images[idx] = { ...images[idx], ...merged };
      } else if (images.length === 1 && String(images[0].id) === selectedId) {
        images[0] = merged;
      }
    } catch (err) {
      if (!keepExistingOnError || !textarea.value) {
        textarea.value = img.description || '';
      }
      editorError.textContent = err.message || 'No se pudo cargar la descripción desde Qdrant';
      editorError.classList.remove('is-hidden');
    } finally {
      textarea.disabled = false;
      textarea.focus();
    }
  }

  async function openEditor(img) {
    showEditorShell(img);
    await loadDescriptionIntoEditor(img);
  }

  async function doSearch(query) {
    currentQuery = query;
    setSearchLoading(true);
    emptyEl.classList.add('is-hidden');
    closeEditor();
    try {
      const data = await api.searchImages(query, searchLimit);
      images = data.images || [];
      renderGrid(images);
      if (!images.length) {
        emptyEl.textContent = 'No se encontraron imágenes';
        emptyEl.classList.remove('is-hidden');
      }
    } catch (err) {
      images = [];
      renderGrid([]);
      emptyEl.textContent = err.message || 'Error en la búsqueda';
      emptyEl.classList.remove('is-hidden');
    }
    setSearchLoading(false);
  }

  async function openInitialImage(img) {
    if (!img?.id) return;
    images = [{ ...img, id: String(img.id) }];
    renderGrid(images);
    emptyEl.classList.add('is-hidden');
    showEditorShell(images[0]);
    await loadDescriptionIntoEditor(images[0], { keepExistingOnError: true });
  }

  function setSaveLoading(on) {
    saveBtn?.classList.toggle('is-loading', on);
    saveLabel?.classList.toggle('is-hidden', on);
    saveSpinner?.classList.toggle('is-hidden', !on);
    if (saveBtn) saveBtn.disabled = on;
    if (cancelBtn) cancelBtn.disabled = on;
    if (textarea) textarea.disabled = on;
  }

  searchInput?.addEventListener('input', () => {
    autoResizeSearch();
    limitRow.classList.toggle('is-hidden', !searchInput.value.trim());
  });

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput?.value.trim() ?? '';
    if (!q) return;
    doSearch(q);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      searchForm?.requestSubmit();
    }
  });

  cancelBtn.addEventListener('click', closeEditor);

  saveBtn.addEventListener('click', async () => {
    if (!selectedId) return;
    editorError.classList.add('is-hidden');
    const description = textarea.value;
    setSaveLoading(true);
    try {
      await api.updateImageDescription(selectedId, description);
      const idx = images.findIndex((i) => String(i.id) === selectedId);
      if (idx >= 0) images[idx] = { ...images[idx], description };
    } catch (err) {
      editorError.textContent = err.message || 'No se pudo guardar';
      editorError.classList.remove('is-hidden');
      toastError(editorError.textContent);
    } finally {
      setSaveLoading(false);
    }
  });

  autoResizeSearch();

  if (options.initialImage?.id != null) {
    openInitialImage(options.initialImage);
  }
}
