import { api, getUser, hasSession, exploreImageUrl, attachExploreImageFallback } from './api.js';
import {
  shotModalMetaHtml,
  bindImageMetaPanel,
  canAnnotateImages,
  canEditCollectionNotes,
} from './image-meta-panel.js';
import { confirmDialog, toastError } from './toast.js';

const LIMIT_OPTIONS = [10, 20, 50, 100];

export async function renderGallery(container, options = {}) {
  const guest = options.guest === true || !hasSession();
  const onRequestLogin = options.onRequestLogin;
  const onOpenAdminDescription = options.onOpenAdminDescription;
  const roles = options.roles ?? getUser()?.roles ?? [];

  const canSearch = !guest && roles.some((r) =>
    ['USER', 'ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER'].includes(r));
  const canBrowseAll = canSearch;
  const canDelete = !guest && roles.includes('ADMIN');
  const canEditDescription = !guest && roles.some((r) => ['ADMIN', 'UPLOADER'].includes(r));
  const showImageMeta = !guest && canAnnotateImages(roles);
  const canEditCollection = !guest && canEditCollectionNotes(roles);

  let page = 0;
  let loading = false;
  let loadingMore = false;
  let hasMore = false;
  let images = [];
  let currentQuery = '';
  let searchLimit = 20;
  let lastOpened = null;
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panPointerId = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  const pageLead = 'Navega el archivo de imágenes o busca por descripción.';

  container.innerHTML = `
    <div class="app-page explore-page">
      <div class="app-hero app-hero-compact">
        <div class="app-hero-text">
          <h1 class="app-page-title font-serifDisplay">Explorar</h1>
          <p class="app-page-lead">${pageLead}</p>
        </div>
      </div>
      ${guest ? `
        <div class="app-banner">
          <span>Inicia sesión para buscar en el archivo de etiquetas.</span>
          <button type="button" id="guest-login-btn" class="app-banner-link">Acceder</button>
        </div>
      ` : ''}

      <form id="search-form" class="explore-search-form">
        <div class="explore-search-box">
          <textarea id="search-input" class="explore-search-input" rows="1"
            placeholder="${guest ? 'Inicia sesión para buscar…' : 'Busca imágenes por descripción…'}"
            ${guest || !canSearch ? 'disabled' : ''}></textarea>
          <button type="submit" id="search-submit" class="explore-search-submit" aria-label="Buscar" ${guest || !canSearch ? 'disabled' : ''}>
            <span class="explore-search-submit-icon" aria-hidden="true">⌕</span>
            <span class="explore-search-submit-spinner animate-spin is-hidden" aria-hidden="true"></span>
          </button>
        </div>
        <div id="limit-row" class="explore-limit-row is-hidden">
          <span class="explore-limit-label">Mostrar</span>
          <div id="limit-buttons" class="explore-limit-buttons"></div>
          <span class="explore-limit-label">resultados</span>
        </div>
      </form>

      <div id="image-grid" class="explore-grid" role="list"></div>
      <div id="gallery-loading" class="explore-loading is-hidden" aria-hidden="true">
        <div class="animate-spin explore-spinner"></div>
      </div>
      <p id="no-results" class="explore-empty is-hidden">No se encontraron imágenes</p>
      <div id="load-more-wrap" class="explore-load-more is-hidden">
        <button type="button" id="load-more-btn" class="app-btn app-btn-primary">Ver más</button>
      </div>
    </div>

    <div id="image-modal" class="shot-modal is-hidden" role="dialog" aria-modal="true">
      <div class="shot-modal-card">
        <button id="modal-close" type="button" class="shot-modal-close-inner" aria-label="Cerrar">×</button>
        ${canEditDescription ? '<button id="modal-description" type="button" class="shot-modal-desc-inner">Descripción</button>' : ''}
        ${canDelete ? '<button id="modal-delete" type="button" class="shot-modal-delete-inner">Eliminar</button>' : ''}
        <div class="shot-modal-main">
          <div class="shot-modal-body">
            <img id="image-viewer" src="" alt="" draggable="false" />
          </div>
          ${showImageMeta ? shotModalMetaHtml({
    showCollectionNote: canEditCollection,
    noteTitle: canEditCollection ? 'Nota privada' : 'Nota',
  }) : ''}
        </div>
        <div class="shot-modal-zoom">
          <button type="button" id="zoom-out" class="shot-zoom-btn">−</button>
          <button type="button" id="zoom-reset" class="shot-zoom-btn">Reset</button>
          <button type="button" id="zoom-in" class="shot-zoom-btn">+</button>
        </div>
      </div>
    </div>
  `;

  const grid = container.querySelector('#image-grid');
  const searchForm = container.querySelector('#search-form');
  const searchInput = container.querySelector('#search-input');
  const limitRow = container.querySelector('#limit-row');
  const limitButtons = container.querySelector('#limit-buttons');
  const searchSubmit = container.querySelector('#search-submit');
  const searchSubmitIcon = container.querySelector('.explore-search-submit-icon');
  const searchSubmitSpinner = container.querySelector('.explore-search-submit-spinner');
  const galleryLoading = container.querySelector('#gallery-loading');
  const noResults = container.querySelector('#no-results');
  const loadMoreWrap = container.querySelector('#load-more-wrap');
  const loadMoreBtn = container.querySelector('#load-more-btn');
  const modal = container.querySelector('#image-modal');
  const viewer = container.querySelector('#image-viewer');
  const viewerBody = container.querySelector('.shot-modal-body');

  const imageMeta = showImageMeta
    ? bindImageMetaPanel(modal, {
        roles,
        canEditCollection,
        getImageId: () => {
          const id = lastOpened?.id;
          return id != null ? parseInt(String(id), 10) : null;
        },
      })
    : null;

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

  searchInput?.addEventListener('input', () => {
    autoResizeSearch();
    limitRow.classList.toggle('is-hidden', !searchInput.value.trim());
  });

  function setSearchLoading(on) {
    searchSubmit?.classList.toggle('is-loading', on);
    searchSubmitSpinner?.classList.toggle('is-hidden', !on);
    searchSubmitIcon?.classList.toggle('is-hidden', on);
    if (searchSubmit && canSearch) searchSubmit.disabled = on;
    if (searchInput && canSearch) searchInput.disabled = on;
  }

  function setGalleryLoading(on, more = false) {
    if (more) loadingMore = on;
    else loading = on;
    galleryLoading?.classList.toggle('is-hidden', !on);
    if (loadMoreBtn) loadMoreBtn.disabled = Boolean(on && more);
  }

  function renderGrid(list) {
    grid.innerHTML = '';
    list.forEach((img) => grid.appendChild(renderCard(img)));
  }

  function renderCard(img) {
    const card = document.createElement('article');
    card.className = 'explore-card';
    card.setAttribute('data-id', img.id);
    card.setAttribute('role', 'listitem');
    const scoreHtml = img.score != null
      ? `<span class="explore-card-score">${(Number(img.score) * 100).toFixed(0)}%</span>`
      : '';
    card.innerHTML = `
      <button type="button" class="explore-card-hit" aria-label="Ver imagen">
        <div class="explore-card-media">
          <img src="${exploreImageUrl(img, { thumb: true })}" alt="${img.title || ''}" loading="lazy" />
        </div>
        ${scoreHtml}
      </button>
      ${canDelete ? '<button type="button" class="explore-card-delete" title="Eliminar">×</button>' : ''}
    `;
    const fullSrc = exploreImageUrl(img, { thumb: false });
    attachExploreImageFallback(card.querySelector('.explore-card-media img'), fullSrc);
    card.querySelector('.explore-card-hit').addEventListener('click', () => openViewer(img));
    card.querySelector('.explore-card-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await confirmDialog('¿Eliminar esta imagen?', {
        title: 'Eliminar imagen',
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        danger: true,
      })) return;
      try {
        await api.deleteImage(parseInt(img.id, 10));
        images = images.filter((i) => i.id !== img.id);
        card.remove();
      } catch (err) {
        toastError(err.message);
      }
    });
    return card;
  }

  function getViewerPanLimits() {
    if (!viewerBody || scale <= 1) return { maxX: 0, maxY: 0 };
    const bodyW = viewerBody.clientWidth;
    const bodyH = viewerBody.clientHeight;
    const nw = viewer.naturalWidth;
    const nh = viewer.naturalHeight;
    if (!nw || !nh || !bodyW || !bodyH) return { maxX: 0, maxY: 0 };
    const fit = Math.min(bodyW / nw, bodyH / nh);
    const displayW = nw * fit;
    const displayH = nh * fit;
    return {
      maxX: Math.max(0, (displayW * scale - bodyW) / 2),
      maxY: Math.max(0, (displayH * scale - bodyH) / 2),
    };
  }

  function clampViewerPan() {
    const { maxX, maxY } = getViewerPanLimits();
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  function applyViewerTransform() {
    if (scale <= 1) {
      panX = 0;
      panY = 0;
    } else {
      clampViewerPan();
    }
    viewer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    viewer.classList.toggle('is-pannable', scale > 1);
    viewer.classList.toggle('is-dragging', isPanning);
  }

  function resetViewerTransform() {
    scale = 1;
    panX = 0;
    panY = 0;
    isPanning = false;
    panPointerId = null;
    applyViewerTransform();
  }

  function openViewer(img) {
    lastOpened = img;
    viewer.src = exploreImageUrl(img, { thumb: false });
    viewer.alt = img.title || '';
    resetViewerTransform();
    modal.classList.remove('is-hidden');
    document.body.style.overflow = 'hidden';
    const imageId = parseInt(String(img.id), 10);
    if (imageId > 0) imageMeta?.loadForImage(imageId);
  }

  async function closeViewer() {
    try {
      await imageMeta?.flushNote?.();
    } catch {
      /* ignore */
    }
    modal.classList.add('is-hidden');
    viewer.src = '';
    lastOpened = null;
    resetViewerTransform();
    imageMeta?.reset();
    document.body.style.overflow = '';
  }

  viewer.addEventListener('load', () => {
    if (!modal.classList.contains('is-hidden')) applyViewerTransform();
  });

  viewerBody?.addEventListener('pointerdown', (e) => {
    if (scale <= 1 || e.button !== 0 || e.target !== viewer) return;
    isPanning = true;
    panPointerId = e.pointerId;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    viewer.setPointerCapture(e.pointerId);
    applyViewerTransform();
    e.preventDefault();
  });

  viewer.addEventListener('pointermove', (e) => {
    if (!isPanning || e.pointerId !== panPointerId) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyViewerTransform();
    e.preventDefault();
  });

  function endViewerPan(e) {
    if (!isPanning || (e && e.pointerId !== panPointerId)) return;
    isPanning = false;
    panPointerId = null;
    try {
      viewer.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    clampViewerPan();
    applyViewerTransform();
  }

  viewer.addEventListener('pointerup', endViewerPan);
  viewer.addEventListener('pointercancel', endViewerPan);

  container.querySelector('#modal-close').addEventListener('click', closeViewer);
  container.querySelector('#modal-description')?.addEventListener('click', async () => {
    if (!lastOpened || typeof onOpenAdminDescription !== 'function') return;
    const img = { ...lastOpened };
    await closeViewer();
    onOpenAdminDescription(img);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeViewer();
  });

  container.querySelector('#zoom-in')?.addEventListener('click', () => {
    scale = Math.min(8, scale + 0.25);
    applyViewerTransform();
  });
  container.querySelector('#zoom-out')?.addEventListener('click', () => {
    scale = Math.max(1, scale - 0.25);
    applyViewerTransform();
  });
  container.querySelector('#zoom-reset')?.addEventListener('click', resetViewerTransform);

  container.querySelector('#modal-delete')?.addEventListener('click', async () => {
    if (!lastOpened) return;
    if (!await confirmDialog('¿Eliminar imagen?', {
      title: 'Eliminar imagen',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
    })) return;
    try {
      await api.deleteImage(parseInt(lastOpened.id, 10));
      grid.querySelector(`[data-id="${lastOpened.id}"]`)?.remove();
      images = images.filter((i) => i.id !== lastOpened.id);
      closeViewer();
    } catch (err) {
      toastError(err.message);
    }
  });

  container.querySelector('#guest-login-btn')?.addEventListener('click', () => onRequestLogin?.());

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput?.value.trim() ?? '';
    if (!q) {
      if (canBrowseAll) loadImages(true);
      return;
    }
    doSearch(q);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      searchForm?.requestSubmit();
    }
  });

  async function doSearch(query) {
    if (!canSearch) return;
    currentQuery = query;
    setSearchLoading(true);
    noResults.classList.add('is-hidden');
    loadMoreWrap.classList.add('is-hidden');
    hasMore = false;
    try {
      const data = await api.searchImages(query, searchLimit);
      images = data.images || [];
      renderGrid(images);
      if (!images.length) {
        noResults.textContent = 'No se encontraron imágenes';
        noResults.classList.remove('is-hidden');
      }
    } catch (err) {
      noResults.textContent = err.message || 'Error en la búsqueda';
      noResults.classList.remove('is-hidden');
      renderGrid([]);
    }
    setSearchLoading(false);
  }

  async function loadImages(reset = false) {
    if (!canBrowseAll) return;
    if (loading || loadingMore) return;
    if (reset) {
      page = 0;
      images = [];
      currentQuery = '';
      setGalleryLoading(true);
    } else {
      setGalleryLoading(true, true);
    }
    noResults.classList.add('is-hidden');
    try {
      const data = await api.getImages(page, 20);
      images = reset ? data.images : [...images, ...data.images];
      renderGrid(images);
      hasMore = data.has_more;
      page++;
      loadMoreWrap.classList.toggle('is-hidden', !hasMore);
      if (!images.length) {
        noResults.textContent = 'No se encontraron imágenes';
        noResults.classList.remove('is-hidden');
      }
    } catch (err) {
      noResults.textContent = 'No se pudieron cargar las imágenes.';
      noResults.classList.remove('is-hidden');
    }
    setGalleryLoading(false);
    loadingMore = false;
  }

  loadMoreBtn?.addEventListener('click', () => loadImages(false));

  if (guest) {
    noResults.textContent = 'Inicia sesión para buscar imágenes.';
    noResults.classList.remove('is-hidden');
  } else if (canBrowseAll) {
    loadImages(true);
  } else {
    noResults.textContent = 'Usa el buscador para encontrar imágenes.';
    noResults.classList.remove('is-hidden');
  }

  autoResizeSearch();
}
