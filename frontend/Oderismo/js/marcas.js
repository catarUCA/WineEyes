import { api, exploreImageUrl, attachExploreImageFallback, getUser } from './api.js';
import { shotModalMetaHtml, bindImageMetaPanel } from './image-meta-panel.js';
import { confirmDialog, toastError, toastSuccess } from './toast.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeHexColor(c) {
  const s = String(c || '#6366f1').trim();
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const h = s.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return '#6366f1';
}

function setColorDot(el, color) {
  if (!el) return;
  const hex = normalizeHexColor(color);
  el.style.background = hex;
  el.style.setProperty('--marca-color', hex);
}

export function renderMarcas(container) {
  let marcas = [];
  let selectedMarca = null;
  let images = [];
  let mergeMode = false;
  const mergeSelected = new Set();
  let noteSearchQuery = '';

  container.innerHTML = `
    <div class="app-page marcas-page">
      <div id="marcas-list-view">
        <div class="app-hero app-hero-compact">
          <div class="app-hero-text">
            <h1 class="app-page-title font-serifDisplay">Etiquetas</h1>
            <p class="app-page-lead" id="marcas-lead">Marcas que has creado. Pulsa una para ver las imágenes asociadas.</p>
          </div>
          <div class="app-hero-actions marcas-hero-actions">
            <button type="button" id="marcas-merge-toggle" class="app-btn app-btn-secondary app-btn-sm">Fundir etiquetas</button>
          </div>
        </div>
        <form id="marcas-note-search-form" class="explore-search-form marcas-note-search" aria-label="Buscar etiquetas por texto en notas">
          <div class="explore-search-box">
            <input type="search" id="marcas-note-search-input" class="explore-search-input marcas-note-search-input"
              placeholder="Buscar en tus notas de imagen…" autocomplete="off" maxlength="200" />
            <button type="submit" id="marcas-note-search-submit" class="explore-search-submit" aria-label="Buscar">
              <span class="explore-search-submit-icon" aria-hidden="true">⌕</span>
              <span class="explore-search-submit-spinner animate-spin is-hidden" aria-hidden="true"></span>
            </button>
          </div>
          <div id="marcas-note-search-meta" class="marcas-note-search-meta is-hidden">
            <p id="marcas-note-search-summary" class="marcas-note-search-summary"></p>
            <button type="button" id="marcas-note-search-clear" class="marcas-note-search-clear">Ver todas las etiquetas</button>
          </div>
        </form>
        <div id="marcas-merge-panel" class="marcas-merge-panel is-hidden" role="region" aria-label="Fundir etiquetas">
          <p class="marcas-merge-hint">Selecciona dos o más etiquetas y escribe el nombre unificado.</p>
          <div class="marcas-merge-form">
            <label class="marcas-merge-label" for="marcas-merge-target">Nombre final</label>
            <input type="text" id="marcas-merge-target" class="marcas-merge-input" placeholder="p. ej. azul" maxlength="255" autocomplete="off" />
            <button type="button" id="marcas-merge-submit" class="app-btn app-btn-primary app-btn-sm" disabled>Fundir</button>
            <button type="button" id="marcas-merge-cancel" class="app-btn app-btn-ghost app-btn-sm">Cancelar</button>
          </div>
          <p id="marcas-merge-count" class="marcas-merge-count">0 seleccionadas</p>
        </div>
        <div id="marcas-grid" class="marcas-grid" role="list"></div>
        <div id="marcas-loading" class="explore-loading">
          <div class="animate-spin explore-spinner"></div>
        </div>
        <p id="marcas-empty" class="explore-empty is-hidden">Aún no has creado ninguna marca.</p>
        <p id="marcas-search-empty" class="explore-empty is-hidden">Ninguna etiqueta tiene notas con ese texto.</p>
        <p id="marcas-error" class="explore-empty is-hidden"></p>
      </div>

      <div id="marcas-detail-view" class="is-hidden">
        <button type="button" id="marcas-back" class="marcas-back">← Volver a Etiquetas</button>
        <div class="marcas-detail-head">
          <button type="button" id="marcas-detail-swatch" class="marcas-swatch marcas-color-trigger" aria-label="Cambiar color de la etiqueta">
            <span class="marcas-swatch-dot" id="marcas-detail-swatch-dot"></span>
          </button>
          <input type="color" id="marcas-detail-color-input" class="marcas-color-input" tabindex="-1" aria-hidden="true" />
          <div class="marcas-detail-text">
            <h2 id="marcas-detail-title" class="app-page-title font-serifDisplay"></h2>
            <p id="marcas-detail-meta" class="app-page-lead"></p>
          </div>
          <button type="button" id="marcas-detail-delete" class="marcas-detail-delete" aria-label="Eliminar etiqueta">
            <svg class="marcas-detail-delete-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            <span class="marcas-detail-delete-label">Eliminar etiqueta</span>
          </button>
        </div>
        <div id="marca-image-grid" class="explore-grid" role="list"></div>
        <div id="marca-images-loading" class="explore-loading is-hidden">
          <div class="animate-spin explore-spinner"></div>
        </div>
        <p id="marca-images-empty" class="explore-empty is-hidden">No hay imágenes con esta marca.</p>
        <p id="marca-images-error" class="explore-empty is-hidden"></p>
      </div>
    </div>

    <div id="marca-image-modal" class="shot-modal is-hidden" role="dialog" aria-modal="true">
      <div class="shot-modal-card">
        <button type="button" id="marca-modal-close" class="shot-modal-close-inner" aria-label="Cerrar">×</button>
        <div class="shot-modal-main">
          <div class="shot-modal-body">
            <img id="marca-modal-img" src="" alt="" draggable="false" />
          </div>
          ${shotModalMetaHtml()}
        </div>
      </div>
    </div>
  `;

  const listView = container.querySelector('#marcas-list-view');
  const detailView = container.querySelector('#marcas-detail-view');
  const marcasGrid = container.querySelector('#marcas-grid');
  const marcasLoading = container.querySelector('#marcas-loading');
  const marcasEmpty = container.querySelector('#marcas-empty');
  const marcasError = container.querySelector('#marcas-error');
  const marcasLead = container.querySelector('#marcas-lead');
  const mergeToggle = container.querySelector('#marcas-merge-toggle');
  const mergePanel = container.querySelector('#marcas-merge-panel');
  const mergeTargetInput = container.querySelector('#marcas-merge-target');
  const mergeSubmit = container.querySelector('#marcas-merge-submit');
  const mergeCancel = container.querySelector('#marcas-merge-cancel');
  const mergeCount = container.querySelector('#marcas-merge-count');
  const noteSearchForm = container.querySelector('#marcas-note-search-form');
  const noteSearchInput = container.querySelector('#marcas-note-search-input');
  const noteSearchSubmit = container.querySelector('#marcas-note-search-submit');
  const noteSearchIcon = container.querySelector('#marcas-note-search-form .explore-search-submit-icon');
  const noteSearchSpinner = container.querySelector('#marcas-note-search-form .explore-search-submit-spinner');
  const noteSearchMeta = container.querySelector('#marcas-note-search-meta');
  const noteSearchSummary = container.querySelector('#marcas-note-search-summary');
  const noteSearchClear = container.querySelector('#marcas-note-search-clear');
  const marcasSearchEmpty = container.querySelector('#marcas-search-empty');
  const imageGrid = container.querySelector('#marca-image-grid');
  const imagesLoading = container.querySelector('#marca-images-loading');
  const imagesEmpty = container.querySelector('#marca-images-empty');
  const imagesError = container.querySelector('#marca-images-error');
  const modal = container.querySelector('#marca-image-modal');
  const modalImg = container.querySelector('#marca-modal-img');
  const detailDeleteBtn = container.querySelector('#marcas-detail-delete');
  const detailColorBtn = container.querySelector('#marcas-detail-swatch');
  const detailColorInput = container.querySelector('#marcas-detail-color-input');
  const detailSwatchDot = container.querySelector('#marcas-detail-swatch-dot');
  let modalImageId = null;
  let savingColor = false;
  const roles = getUser()?.roles ?? [];
  const imageMeta = bindImageMetaPanel(modal, {
    roles,
    getImageId: () => modalImageId,
  });

  function updateMergeUi() {
    const n = mergeSelected.size;
    mergeCount.textContent = `${n} seleccionada${n === 1 ? '' : 's'}`;
    const target = mergeTargetInput.value.trim();
    mergeSubmit.disabled = n < 2 || target === '';
    marcasGrid.classList.toggle('marcas-grid--merge', mergeMode);
  }

  function setNoteSearchLoading(on) {
    noteSearchSubmit?.classList.toggle('is-loading', on);
    noteSearchSpinner?.classList.toggle('is-hidden', !on);
    noteSearchIcon?.classList.toggle('is-hidden', on);
    if (noteSearchSubmit) noteSearchSubmit.disabled = on;
    if (noteSearchInput) noteSearchInput.disabled = on;
  }

  function updateNoteSearchMeta() {
    const active = noteSearchQuery !== '';
    noteSearchMeta?.classList.toggle('is-hidden', !active);
    mergeToggle?.classList.toggle('is-hidden', active);
    if (active && mergeMode) setMergeMode(false);
    if (noteSearchSummary && active) {
      const tagged = marcas.filter((m) => !m.is_untagged).length;
      const untagged = marcas.find((m) => m.is_untagged);
      const parts = [];
      if (tagged) {
        parts.push(`${tagged} etiqueta${tagged === 1 ? '' : 's'}`);
      }
      if (untagged) {
        parts.push(`${untagged.image_count} sin etiquetar`);
      }
      noteSearchSummary.textContent =
        `${parts.join(' y ')} con notas que contienen «${noteSearchQuery}»`;
    }
  }

  function setMergeMode(on) {
    if (on && noteSearchQuery) return;
    mergeMode = on;
    mergeSelected.clear();
    mergeToggle.textContent = on ? 'Salir de fundir' : 'Fundir etiquetas';
    mergeToggle.classList.toggle('app-btn-primary', on);
    mergeToggle.classList.toggle('app-btn-secondary', !on);
    mergePanel.classList.toggle('is-hidden', !on);
    marcasLead.textContent = on
      ? 'Marca las etiquetas que quieras unificar y elige el nombre final.'
      : 'Marcas que has creado. Pulsa una para ver las imágenes asociadas.';
    mergeTargetInput.value = '';
    updateMergeUi();
    renderMarcasGrid();
  }

  function showList() {
    listView.classList.remove('is-hidden');
    detailView.classList.add('is-hidden');
    selectedMarca = null;
    detailColorBtn?.classList.remove('is-hidden');
    detailColorInput?.classList.remove('is-hidden');
    detailDeleteBtn?.classList.remove('is-hidden');
  }

  function syncMarcaColorInList(marcaId, color) {
    const card = marcasGrid.querySelector(`[data-marca-id="${marcaId}"]`);
    const dot = card?.querySelector('.marca-card-color-dot');
    const input = card?.querySelector('.marca-card-color-input');
    if (dot) setColorDot(dot, color);
    if (input) input.value = normalizeHexColor(color);
  }

  async function saveMarcaColor(marca, colorHex) {
    const color = normalizeHexColor(colorHex);
    const persisted = normalizeHexColor(marca.color);
    if (persisted === color || savingColor) return;
    savingColor = true;
    try {
      const data = await api.updateMarcaColor(marca.id, color);
      const updated = data.marca?.color || color;
      marca.color = updated;
      const inList = marcas.find((m) => m.id === marca.id);
      if (inList) inList.color = updated;
      syncMarcaColorInList(marca.id, updated);
      if (selectedMarca?.id === marca.id) {
        setColorDot(detailSwatchDot, updated);
        detailColorInput.value = normalizeHexColor(updated);
      }
    } catch (err) {
      toastError(err.message || 'No se pudo guardar el color');
      syncMarcaColorInList(marca.id, marca.color);
      if (selectedMarca?.id === marca.id) {
        setColorDot(detailSwatchDot, marca.color);
        detailColorInput.value = normalizeHexColor(marca.color);
      }
    } finally {
      savingColor = false;
    }
  }

  function bindColorPicker(trigger, input, dotEl, marca) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mergeMode) return;
      input.value = normalizeHexColor(marca.color);
      input.click();
    });
    input.addEventListener('input', () => {
      setColorDot(dotEl, input.value);
    });
    input.addEventListener('change', () => {
      void saveMarcaColor(marca, input.value);
    });
  }

  detailColorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedMarca) return;
    detailColorInput.value = normalizeHexColor(selectedMarca.color);
    detailColorInput.click();
  });
  detailColorInput.addEventListener('input', () => {
    if (!selectedMarca) return;
    setColorDot(detailSwatchDot, detailColorInput.value);
    syncMarcaColorInList(selectedMarca.id, detailColorInput.value);
  });
  detailColorInput.addEventListener('change', () => {
    if (selectedMarca) void saveMarcaColor(selectedMarca, detailColorInput.value);
  });

  function showDetail(marca) {
    if (mergeMode) return;
    selectedMarca = marca;
    listView.classList.add('is-hidden');
    detailView.classList.remove('is-hidden');
    container.querySelector('#marcas-detail-title').textContent = marca.name;
    const metaEl = container.querySelector('#marcas-detail-meta');
    if (marca.is_untagged) {
      metaEl.textContent =
        `${marca.image_count} imagen${marca.image_count === 1 ? '' : 'es'} sin etiqueta con notas que coinciden`;
    } else {
      metaEl.textContent =
        `${marca.image_count} imagen${marca.image_count === 1 ? '' : 'es'} en el archivo`;
    }
    setColorDot(detailSwatchDot, marca.color);
    detailColorInput.value = normalizeHexColor(marca.color);
    detailColorBtn.classList.toggle('is-hidden', !!marca.is_untagged);
    detailColorInput.classList.toggle('is-hidden', !!marca.is_untagged);
    detailDeleteBtn.classList.toggle('is-hidden', !!marca.is_untagged);
    loadMarcaImages(marca);
  }

  async function deleteMarca(marca, { fromDetail = false } = {}) {
    const count = marca.image_count ?? 0;
    const msg =
      count > 0
        ? `¿Eliminar «${marca.name}»? Se quitará de ${count} imagen${count === 1 ? '' : 'es'}.`
        : `¿Eliminar la etiqueta «${marca.name}»?`;
    if (
      !await confirmDialog(msg, {
        title: 'Eliminar etiqueta',
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        danger: true,
      })
    ) {
      return;
    }
    try {
      await api.deleteMarca(marca.id);
      toastSuccess(`Etiqueta «${marca.name}» eliminada`);
      if (fromDetail) showList();
      await loadMarcas();
    } catch (err) {
      toastError(err.message || 'No se pudo eliminar la etiqueta');
    }
  }

  function renderMarcaCard(marca) {
    const card = document.createElement('article');
    card.className = 'marca-card' + (marca.is_untagged ? ' marca-card--untagged' : '');
    card.setAttribute('role', 'listitem');
    card.dataset.marcaId = String(marca.id);
    card.tabIndex = 0;
    const color = normalizeHexColor(marca.color);
    const selected = !marca.is_untagged && mergeSelected.has(marca.id);
    if (mergeMode && !marca.is_untagged) {
      card.classList.add('marca-card--selectable');
      if (selected) card.classList.add('is-selected');
    }
    const actionsHtml = marca.is_untagged
      ? `<span class="marca-card-untagged-mark" aria-hidden="true">—</span>`
      : `<div class="marca-card-actions">
          <button type="button" class="marca-card-color" aria-label="Cambiar color de ${escapeHtml(marca.name)}">
            <span class="marca-card-color-dot" style="background:${escapeHtml(color)}"></span>
          </button>
          <input type="color" class="marca-card-color-input marcas-color-input" value="${escapeHtml(color)}" tabindex="-1" aria-hidden="true" />
          <button type="button" class="marca-card-delete" aria-label="Eliminar ${escapeHtml(marca.name)}">×</button>
        </div>`;
    card.innerHTML = `
      ${mergeMode && !marca.is_untagged ? `<span class="marca-card-check" aria-hidden="true">${selected ? '✓' : ''}</span>` : ''}
      <span class="marca-card-body">
        <span class="marca-card-name">${escapeHtml(marca.name)}</span>
        ${marca.description ? `<span class="marca-card-desc">${escapeHtml(marca.description)}</span>` : ''}
        <span class="marca-card-count">${marca.image_count} imagen${marca.image_count === 1 ? '' : 'es'}</span>
        ${marca.note_match_count != null
          ? `<span class="marca-card-note-hits">${marca.is_untagged ? 'Coincidencia en notas' : `${marca.note_match_count} con coincidencia en notas`}</span>`
          : ''}
      </span>
      ${actionsHtml}
    `;

    if (!marca.is_untagged) {
      const colorBtn = card.querySelector('.marca-card-color');
      const colorInput = card.querySelector('.marca-card-color-input');
      const colorDot = card.querySelector('.marca-card-color-dot');
      bindColorPicker(colorBtn, colorInput, colorDot, marca);

      card.querySelector('.marca-card-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        void deleteMarca(marca);
      });
    }

    const onActivate = () => {
      if (mergeMode) {
        if (mergeSelected.has(marca.id)) mergeSelected.delete(marca.id);
        else mergeSelected.add(marca.id);
        updateMergeUi();
        renderMarcasGrid();
        return;
      }
      showDetail(marca);
    };

    card.addEventListener('click', (e) => {
      if (e.target.closest('.marca-card-delete, .marca-card-color, .marca-card-color-input')) return;
      onActivate();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    });

    return card;
  }

  function renderMarcasGrid() {
    marcasGrid.innerHTML = '';
    marcas.forEach((m) => marcasGrid.appendChild(renderMarcaCard(m)));
  }

  function renderImageCard(img) {
    const card = document.createElement('article');
    card.className = 'explore-card';
    card.innerHTML = `
      <button type="button" class="explore-card-hit" aria-label="Ver imagen">
        <div class="explore-card-media">
          <img src="${exploreImageUrl(img, { thumb: true })}" alt="${escapeHtml(img.title || '')}" loading="lazy" />
        </div>
      </button>
    `;
    attachExploreImageFallback(card.querySelector('.explore-card-media img'), exploreImageUrl(img, { thumb: false }));
    card.querySelector('.explore-card-hit').addEventListener('click', () => {
      modalImageId = parseInt(String(img.id), 10) || null;
      modalImg.src = exploreImageUrl(img, { thumb: false });
      modalImg.alt = img.title || '';
      modal.classList.remove('is-hidden');
      document.body.style.overflow = 'hidden';
      if (modalImageId) imageMeta?.loadForImage(modalImageId);
    });
    return card;
  }

  container.querySelector('#marcas-back').addEventListener('click', showList);

  mergeToggle.addEventListener('click', () => setMergeMode(!mergeMode));
  mergeCancel.addEventListener('click', () => setMergeMode(false));
  mergeTargetInput.addEventListener('input', updateMergeUi);

  noteSearchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = noteSearchInput?.value.trim() ?? '';
    if (q.length < 2) {
      toastError('Escribe al menos 2 caracteres para buscar');
      return;
    }
    void searchMarcasByNotes(q);
  });

  noteSearchClear?.addEventListener('click', () => {
    noteSearchQuery = '';
    if (noteSearchInput) noteSearchInput.value = '';
    updateNoteSearchMeta();
    void loadMarcas();
  });

  async function searchMarcasByNotes(query) {
    noteSearchQuery = query;
    marcasLoading.classList.remove('is-hidden');
    marcasEmpty.classList.add('is-hidden');
    marcasSearchEmpty.classList.add('is-hidden');
    marcasError.classList.add('is-hidden');
    marcasGrid.innerHTML = '';
    setNoteSearchLoading(true);
    try {
      const data = await api.searchMarcasByNotes(query);
      marcas = data.marcas || [];
      if (data.sin_etiquetar) {
        marcas = [...marcas, data.sin_etiquetar];
      }
      noteSearchQuery = data.query || query;
      if (!marcas.length) {
        marcasSearchEmpty.classList.remove('is-hidden');
      } else {
        renderMarcasGrid();
      }
      updateNoteSearchMeta();
    } catch (err) {
      marcasError.textContent = err.message || 'Error en la búsqueda';
      marcasError.classList.remove('is-hidden');
    }
    marcasLoading.classList.add('is-hidden');
    setNoteSearchLoading(false);
  }

  mergeSubmit.addEventListener('click', async () => {
    const targetName = mergeTargetInput.value.trim();
    const sourceIds = [...mergeSelected];
    if (sourceIds.length < 2 || !targetName) return;

    const names = marcas
      .filter((m) => mergeSelected.has(m.id))
      .map((m) => `«${m.name}»`)
      .join(', ');
    if (
      !await confirmDialog(
        `Las etiquetas ${names} pasarán a llamarse «${targetName}» en todas las imágenes donde aparezcan.`,
        {
          title: 'Fundir etiquetas',
          confirmLabel: 'Fundir',
          cancelLabel: 'Cancelar',
        },
      )
    ) {
      return;
    }

    mergeSubmit.disabled = true;
    try {
      const data = await api.mergeMarcas(sourceIds, targetName);
      toastSuccess(
        `Etiquetas unificadas en «${data.marca?.name || targetName}» (${data.image_count ?? 0} imágenes)`,
      );
      setMergeMode(false);
      await loadMarcas();
    } catch (err) {
      toastError(err.message || 'No se pudieron fusionar las etiquetas');
    } finally {
      updateMergeUi();
    }
  });

  detailDeleteBtn.addEventListener('click', () => {
    if (selectedMarca) void deleteMarca(selectedMarca, { fromDetail: true });
  });

  async function closeMarcaModal() {
    try {
      await imageMeta?.flushNote?.();
    } catch {
      /* ignore */
    }
    modal.classList.add('is-hidden');
    modalImg.src = '';
    modalImageId = null;
    imageMeta?.reset();
    document.body.style.overflow = '';
  }

  container.querySelector('#marca-modal-close').addEventListener('click', closeMarcaModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeMarcaModal();
  });

  async function loadMarcas() {
    noteSearchQuery = '';
    if (noteSearchInput) noteSearchInput.value = '';
    updateNoteSearchMeta();
    marcasLoading.classList.remove('is-hidden');
    marcasEmpty.classList.add('is-hidden');
    marcasSearchEmpty.classList.add('is-hidden');
    marcasError.classList.add('is-hidden');
    marcasGrid.innerHTML = '';
    try {
      const data = await api.getMarcas();
      marcas = data.marcas || [];
      mergeSelected.forEach((id) => {
        if (!marcas.some((m) => m.id === id)) mergeSelected.delete(id);
      });
      if (!marcas.length) {
        marcasEmpty.classList.remove('is-hidden');
      } else {
        renderMarcasGrid();
      }
      updateMergeUi();
    } catch (err) {
      marcasError.textContent = err.message || 'No se pudieron cargar las marcas';
      marcasError.classList.remove('is-hidden');
    }
    marcasLoading.classList.add('is-hidden');
  }

  async function loadMarcaImages(marca) {
    imageGrid.innerHTML = '';
    imagesLoading.classList.remove('is-hidden');
    imagesEmpty.classList.add('is-hidden');
    imagesError.classList.add('is-hidden');
    try {
      const data = marca.is_untagged
        ? await api.getUntaggedImagesByNotes(noteSearchQuery)
        : await api.getMarcaImages(marca.id);
      images = data.images || [];
      if (!images.length && (data.image_ids || []).length > 0) {
        imagesError.textContent =
          'Hay imágenes vinculadas en la base de datos, pero no se pudieron obtener del motor de búsqueda.';
        imagesError.classList.remove('is-hidden');
      } else if (!images.length) {
        imagesEmpty.classList.remove('is-hidden');
      } else {
        images.forEach((img) => imageGrid.appendChild(renderImageCard(img)));
      }
    } catch (err) {
      imagesError.textContent = err.message || 'Error cargando imágenes';
      imagesError.classList.remove('is-hidden');
    }
    imagesLoading.classList.add('is-hidden');
  }

  loadMarcas();
}
