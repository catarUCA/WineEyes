import { api, getUser, hasSession, exploreImageUrl, attachExploreImageFallback } from './api.js';
import {
  shotModalMetaHtml,
  bindImageMetaPanel,
  canAnnotateImages,
  canEditCollectionNotes,
} from './image-meta-panel.js';
import { confirmDialog, toastError } from './toast.js';

const DEFAULT_THRESHOLD = 0.2;

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
  let searchThreshold = DEFAULT_THRESHOLD;
  let searchLimit = 20;
  const PAGE_SIZE = 20;
  let paginated = false;
  let searchPage = 0;
  let collectionTotal = null;
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
        <div id="threshold-row" class="explore-threshold-row is-hidden">
          <label class="explore-limit-label" for="threshold-range">Similitud mínima</label>
          <input type="range" id="threshold-range" class="explore-threshold-range"
            min="0" max="100" step="5" value="${Math.round(DEFAULT_THRESHOLD * 100)}" />
          <span id="threshold-value" class="explore-threshold-value">${Math.round(DEFAULT_THRESHOLD * 100)}%</span>
          <span class="explore-limit-label">Mostrar</span>
          <span id="top-buttons" class="explore-top-buttons">
            <button type="button" class="explore-top-btn" data-limit="0">Todas</button>
            <button type="button" class="explore-top-btn" data-limit="5">5</button>
            <button type="button" class="explore-top-btn" data-limit="10">10</button>
            <button type="button" class="explore-top-btn is-active" data-limit="20">20</button>
            <button type="button" class="explore-top-btn" data-limit="50">50</button>
          </span>
        </div>
      </form>

      ${!guest ? '<p id="gallery-count" class="explore-count is-hidden" aria-live="polite"></p>' : ''}

      <div id="image-grid" class="explore-grid" role="list"></div>
      <div id="gallery-loading" class="explore-loading is-hidden" aria-hidden="true">
        <div class="animate-spin explore-spinner"></div>
      </div>
      <p id="no-results" class="explore-empty is-hidden">No se encontraron imágenes</p>
      <div id="load-more-wrap" class="explore-load-more is-hidden">
        <button type="button" id="load-more-btn" class="app-btn app-btn-primary">Ver más</button>
      </div>
      <nav id="pager" class="explore-pager is-hidden" aria-label="Paginación de resultados"></nav>
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
  const thresholdRow = container.querySelector('#threshold-row');
  const thresholdRange = container.querySelector('#threshold-range');
  const thresholdValue = container.querySelector('#threshold-value');
  const topSelect = container.querySelector('#top-select');
  const topButtons = container.querySelector('#top-buttons');
  const searchSubmit = container.querySelector('#search-submit');
  const searchSubmitIcon = container.querySelector('.explore-search-submit-icon');
  const searchSubmitSpinner = container.querySelector('.explore-search-submit-spinner');
  const galleryLoading = container.querySelector('#gallery-loading');
  const noResults = container.querySelector('#no-results');
  const loadMoreWrap = container.querySelector('#load-more-wrap');
  const loadMoreBtn = container.querySelector('#load-more-btn');
  const pager = container.querySelector('#pager');
  const modal = container.querySelector('#image-modal');
  const viewer = container.querySelector('#image-viewer');
  const viewerBody = container.querySelector('.shot-modal-body');
  const countEl = container.querySelector('#gallery-count');

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

  function updateThresholdRowVisibility() {
    if (!thresholdRow) return;
    const active = Boolean(searchInput?.value.trim());
    thresholdRow.classList.toggle('is-hidden', !active);
  }

  thresholdRange?.addEventListener('input', () => {
    searchThreshold = Number(thresholdRange.value) / 100;
    if (thresholdValue) thresholdValue.textContent = `${thresholdRange.value}%`;
  });

  topSelect?.addEventListener('change', () => {
    searchLimit = parseInt(topSelect.value, 10) || 0;
  });

  topButtons?.addEventListener('click', (e) => {
    const btn = e.target.closest('.explore-top-btn');
    if (!btn) return;
    searchLimit = parseInt(btn.dataset.limit, 10) || 0;
    topButtons.querySelectorAll('.explore-top-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });

  function autoResizeSearch() {
    if (!searchInput) return;
    searchInput.style.height = 'auto';
    searchInput.style.height = `${searchInput.scrollHeight}px`;
  }

  searchInput?.addEventListener('input', () => {
    autoResizeSearch();
    updateThresholdRowVisibility();
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
        if (paginated) afterDeleteRefresh();
        else card.remove();
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

  // ===== Paginación =====
  function pagerNumbers(cur, pages) {
    const wanted = [0, pages - 1, cur, cur - 1, cur + 1]
      .filter((n) => n >= 0 && n < pages);
    const uniqueSorted = [...new Set(wanted)].sort((a, b) => a - b);
    const out = [];
    let prev = -1;
    for (const n of uniqueSorted) {
      if (prev >= 0 && n - prev > 1) out.push('…');
      out.push(n);
      prev = n;
    }
    return out;
  }

  function renderPager(pages) {
    if (!pager) return;
    if (pages <= 1) {
      pager.classList.add('is-hidden');
      pager.innerHTML = '';
      return;
    }
    const cur = searchPage;
    const parts = [
      `<button type="button" class="explore-pager-btn" data-nav="prev" ${cur === 0 ? 'disabled' : ''} aria-label="Página anterior">‹</button>`,
    ];
    for (const n of pagerNumbers(cur, pages)) {
      parts.push(n === '…'
        ? '<span class="explore-pager-ellipsis" aria-hidden="true">…</span>'
        : `<button type="button" class="explore-pager-num${n === cur ? ' is-active' : ''}" data-page="${n}"${n === cur ? ' aria-current="page"' : ''}>${n + 1}</button>`);
    }
    parts.push(`<button type="button" class="explore-pager-btn" data-nav="next" ${cur >= pages - 1 ? 'disabled' : ''} aria-label="Página siguiente">›</button>`);
    pager.innerHTML = parts.join('');
    pager.classList.remove('is-hidden');

    const goTo = (p) => {
      const target = Math.max(0, Math.min(pages - 1, p));
      if (target === searchPage) return;
      searchPage = target;
      renderSearchResults();
      grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    pager.querySelectorAll('[data-page]').forEach((b) => {
      b.addEventListener('click', () => goTo(parseInt(b.dataset.page, 10)));
    });
    pager.querySelector('[data-nav="prev"]')?.addEventListener('click', () => goTo(cur - 1));
    pager.querySelector('[data-nav="next"]')?.addEventListener('click', () => goTo(cur + 1));
  }

  function renderSearchResults() {
    const total = images.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (searchPage >= pages) searchPage = pages - 1;
    if (searchPage < 0) searchPage = 0;
    const start = searchPage * PAGE_SIZE;
    renderGrid(images.slice(start, start + PAGE_SIZE));
    renderPager(pages);
  }

  function hidePager() {
    pager?.classList.add('is-hidden');
    if (pager) pager.innerHTML = '';
  }

  // ===== Contador =====
  function updateCountMessage() {
    if (!countEl) return;
    let text = '';
    if (paginated) {
      const n = images.length;
      text = n === 1 ? '1 resultado' : `${n} resultados`;
    } else if (collectionTotal != null) {
      text = collectionTotal === 1
        ? '1 imagen en la colección'
        : `${collectionTotal} imágenes en la colección`;
    }
    countEl.textContent = text;
    countEl.classList.toggle('is-hidden', !text);
  }

  async function refreshCollectionTotal() {
    try {
      const data = await api.getImages(0, 1);
      collectionTotal = data.total ?? null;
    } catch {
      collectionTotal = null;
    }
    if (!paginated) updateCountMessage();
  }

  function afterDeleteRefresh() {
    if (!paginated) return;
    renderSearchResults();
    updateCountMessage();
    if (!images.length) {
      noResults.textContent = 'No se encontraron imágenes';
      noResults.classList.remove('is-hidden');
    }
  }

  // ===== Búsqueda =====
  async function doSearch(query) {
    if (!canSearch) return;
    currentQuery = query;
    setSearchLoading(true);
    noResults.classList.add('is-hidden');
    loadMoreWrap.classList.add('is-hidden');
    hasMore = false;
    try {
      const data = await api.searchImages(query, 0, searchThreshold);
      images = data.images || [];
      paginated = true;
      searchPage = 0;
      if (searchLimit > 0 && images.length > searchLimit) {
        images = images.slice(0, searchLimit);
      }
      if (images.length) {
        renderSearchResults();
      } else {
        renderGrid([]);
        hidePager();
        noResults.textContent = 'No se encontraron imágenes por encima del umbral';
        noResults.classList.remove('is-hidden');
      }
      updateCountMessage();
    } catch (err) {
      paginated = false;
      hidePager();
      updateCountMessage();
      noResults.textContent = err.message || 'Error en la búsqueda';
      noResults.classList.remove('is-hidden');
      renderGrid([]);
    }
    setSearchLoading(false);
  }

  async function loadImages(reset = false) {
    if (!canBrowseAll) return;
    if (loading || loadingMore) return;
    paginated = false;
    hidePager();
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
      if (data.total != null) collectionTotal = data.total;
      updateCountMessage();
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
    refreshCollectionTotal();
  }

  autoResizeSearch();
}
