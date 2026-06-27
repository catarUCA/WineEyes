// catalogs-form-build: 2026-06-05.08
import { api, exploreImageUrl, attachExploreImageFallback } from './api.js';
import { createRichNoteEditor } from './rich-note-editor.js';
import { isRichHtmlEmpty, loadHtmlSanitizer, setRichHtmlContent } from './sanitize-html.js';
import { startScreensaver, stopScreensaver } from './screensaver.js';
import { confirmDialog, toastError, toastSuccess } from './toast.js';
import {
  trapFocusIn,
  releaseFocusTrap,
  syncLoginModalInert,
  setAppChromeInert,
} from './modal-a11y.js';

export const CATALOGS_FORM_BUILD = '2026-06-05.08';

/** Asegura orden: etiquetas → datos → guardar. */
function ensureCatalogEditorLayout(root) {
  const layout = root.querySelector('.catalogs-editor-layout');
  const labels = root.querySelector('.catalogs-editor-panel--labels');
  const meta = root.querySelector('.catalogs-editor-panel--meta');
  const actions = root.querySelector('.catalogs-form-actions');
  if (!layout || !labels || !meta) return;
  layout.appendChild(labels);
  layout.appendChild(meta);
  if (actions) layout.appendChild(actions);
}

/** Inserta small_description si el HTML servido es de una versión anterior. */
function ensureSmallDescriptionField(root) {
  const meta = root.querySelector('.catalogs-editor-panel--meta');
  if (!meta || meta.querySelector('#catalog-small-description')) return;

  const nameRow = meta.querySelector('#catalog-name')?.closest('.catalogs-form-row');
  const descRow = meta.querySelector('#catalog-desc-editor')?.closest('.catalogs-form-row');
  if (!nameRow) return;

  const row = document.createElement('div');
  row.className = 'catalogs-form-row catalogs-form-row--small-desc';
  row.innerHTML = `
    <label class="catalogs-form-label" for="catalog-small-description">Descripción breve</label>
    <p class="catalogs-form-hint">Resumen corto en texto plano; aparece en el listado de catálogos (no admite formato).</p>
    <textarea
      id="catalog-small-description"
      name="small_description"
      class="catalogs-form-input catalogs-form-textarea catalogs-form-textarea--brief"
      rows="4"
      maxlength="500"
      placeholder="Una o dos frases que resuman el catálogo…"
      autocomplete="off"
    ></textarea>
  `;

  if (descRow) {
    descRow.parentNode.insertBefore(row, descRow);
    const label = descRow.querySelector('#catalog-desc-label');
    if (label && label.textContent.trim() === 'Descripción') {
      label.textContent = 'Descripción completa';
    }
    if (!descRow.querySelector('.catalogs-form-hint')) {
      const hint = document.createElement('p');
      hint.className = 'catalogs-form-hint';
      hint.textContent = 'Texto enriquecido para la ficha del catálogo (puede ocupar el equivalente a una página).';
      label?.insertAdjacentElement('afterend', hint);
    }
    descRow.classList.add('catalogs-form-row--desc');
  } else {
    nameRow.insertAdjacentElement('afterend', row);
  }
}

function patchCatalogEditorForm(root) {
  ensureCatalogEditorLayout(root);
  ensureSmallDescriptionField(root);
  const form = root.querySelector('#catalogs-editor-form');
  if (form) form.dataset.build = CATALOGS_FORM_BUILD;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Texto plano para vistas previas (listado de catálogos). */
function descriptionPreview(html) {
  const text = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function catalogCardSummary(col) {
  const brief = String(col.small_description || '').trim();
  if (brief) return brief.length > 160 ? `${brief.slice(0, 157)}…` : brief;
  return descriptionPreview(col.description);
}

function guestCollectionCardSummary(col) {
  return String(col.small_description || '').trim();
}

function setCatalogSmallDescriptionDisplay(el, text) {
  if (!el) return;
  const raw = String(text || '').trim();
  if (!raw) {
    el.textContent = '';
    el.classList.add('is-hidden');
    return;
  }
  el.textContent = raw;
  el.classList.remove('is-hidden');
}

function setCatalogDescriptionDisplay(el, html) {
  setRichHtmlContent(el, html);
}

function formatDisplayDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
}

function formatDateRange(start, end) {
  if (!start && !end) return '';
  const startText = formatDisplayDate(start);
  const endText = formatDisplayDate(end);
  if (startText && endText) return `Del ${startText} al ${endText}`;
  if (startText) return `Desde ${startText}`;
  return `Hasta ${endText}`;
}

function catalogVisibilityHtml(col) {
  const range = formatDateRange(col.start_date, col.end_date);
  if (!range) return '';
  return `<span class="catalog-card-visibility">Visible ${escapeHtml(range.toLowerCase())}</span>`;
}

function statusBadges(col) {
  const parts = [];
  if (col.is_public) parts.push('<span class="catalog-badge catalog-badge--public">Público</span>');
  else parts.push('<span class="catalog-badge">Privado</span>');
  if (!col.is_active) parts.push('<span class="catalog-badge catalog-badge--inactive">Inactivo</span>');
  const range = formatDateRange(col.start_date, col.end_date);
  if (range) parts.push(`<span class="catalog-badge catalog-badge--dates">${escapeHtml(range)}</span>`);
  return parts.join(' ');
}

export async function renderCatalogs(container, options = {}) {
  await loadHtmlSanitizer();
  const canEdit = options.canEdit === true;
  const guest = options.guest === true;

  let collections = [];
  let selected = null;
  let images = [];
  let availableLabels = [];
  let editorMode = false;
  let editingId = null;
  let labelPickMode = 'individual';
  const selectedLabelIds = new Set();
  const groupPickBuffer = new Set();
  let catalogDescEditor = null;

  const pageTitle = guest ? 'Colecciones' : 'Catálogos';
  const backLabel = guest ? '← Volver a Colecciones' : '← Volver a Catálogos';

  container.innerHTML = `
    <div class="app-page catalogs-page${guest ? ' catalogs-page--guest' : ''}">
      <div id="catalogs-list-view">
        <div class="app-hero app-hero-compact">
          <div class="app-hero-text">
            <h1 class="app-page-title font-serifDisplay">${pageTitle}</h1>
            <p class="app-page-lead" id="catalogs-lead">
              ${guest
    ? 'Colecciones activas de etiquetas'
    : canEdit
      ? 'Crea catálogos públicos eligiendo etiquetas de forma individual o por agrupación.'
      : 'Colecciones publicadas de etiquetas.'}
            </p>
          </div>
          ${canEdit ? `
          <div class="app-hero-actions">
            <button type="button" id="catalogs-create-btn" class="app-btn app-btn-primary app-btn-sm">Nuevo catálogo</button>
          </div>` : ''}
        </div>
        <div id="catalogs-grid" class="catalogs-grid${guest ? ' catalogs-grid--full' : ''}" role="list"></div>
        <div id="catalogs-loading" class="explore-loading">
          <div class="animate-spin explore-spinner"></div>
        </div>
        <p id="catalogs-empty" class="explore-empty is-hidden">${guest ? 'No hay colecciones disponibles en este momento.' : 'No hay catálogos publicados en este momento.'}</p>
        <p id="catalogs-error" class="explore-empty is-hidden"></p>
      </div>

      <div id="catalogs-detail-view" class="is-hidden">
        <button type="button" id="catalogs-back" class="marcas-back">${backLabel}</button>
        <div class="catalogs-detail-head">
          <div class="catalogs-detail-text">
            <h2 id="catalogs-detail-title" class="app-page-title font-serifDisplay"></h2>
            ${guest ? '' : `
            <p id="catalogs-detail-small-desc" class="catalogs-detail-small-desc is-hidden"></p>
            <p id="catalogs-detail-meta" class="app-page-lead"></p>
            <div id="catalogs-detail-badges" class="catalogs-detail-badges"></div>`}
            <div id="catalogs-detail-desc" class="catalogs-detail-desc rich-html-content is-hidden"></div>
            ${guest ? `
            <div class="catalogs-detail-actions catalogs-detail-actions--screensaver">
              <button type="button" id="catalogs-screensaver-btn" class="app-btn app-btn-secondary app-btn-sm" disabled>Ver como salvapantallas</button>
            </div>` : ''}
            ${guest ? '' : '<div id="catalogs-detail-labels" class="catalogs-detail-labels is-hidden"></div>'}
          </div>
          ${!guest && canEdit ? `
          <div class="catalogs-detail-actions">
            <button type="button" id="catalogs-edit-btn" class="app-btn app-btn-secondary app-btn-sm">Editar</button>
            <button type="button" id="catalogs-delete-btn" class="app-btn app-btn-ghost app-btn-sm catalogs-delete-btn">Eliminar</button>
          </div>` : ''}
        </div>
        <div id="catalog-image-grid" class="explore-grid catalogs-detail-images" role="list"></div>
        <div id="catalog-images-loading" class="explore-loading is-hidden">
          <div class="animate-spin explore-spinner"></div>
        </div>
        <p id="catalog-images-empty" class="explore-empty is-hidden">${guest ? 'Esta colección no tiene imágenes.' : 'Este catálogo no tiene imágenes asociadas.'}</p>
      </div>

      <div id="catalogs-editor-view" class="is-hidden">
        <button type="button" id="catalogs-editor-back" class="marcas-back">← Cancelar</button>
        <h2 id="catalogs-editor-title" class="app-page-title font-serifDisplay">Nuevo catálogo</h2>
        <form id="catalogs-editor-form" class="catalogs-editor-form">
          <div class="catalogs-editor-layout">
            <section class="catalogs-editor-panel catalogs-editor-panel--labels" aria-labelledby="catalogs-labels-title">
              <div class="catalogs-labels-head">
                <h3 id="catalogs-labels-title" class="catalogs-panel-title">Etiquetas del catálogo</h3>
                <div class="catalogs-pick-modes" role="tablist" aria-label="Modo de selección">
                  <button type="button" class="catalogs-pick-mode is-active" data-mode="individual" role="tab" aria-selected="true">Individual</button>
                  <button type="button" class="catalogs-pick-mode" data-mode="group" role="tab" aria-selected="false">Agrupación</button>
                </div>
              </div>
              <p id="catalogs-pick-hint" class="catalogs-pick-hint">
                Pulsa una etiqueta para añadirla o quitarla del catálogo.
              </p>
              <div id="catalogs-group-actions" class="catalogs-group-actions is-hidden">
                <p id="catalogs-group-count" class="catalogs-group-count">0 en la agrupación</p>
                <button type="button" id="catalogs-group-add" class="app-btn app-btn-secondary app-btn-sm" disabled>Añadir agrupación al catálogo</button>
                <button type="button" id="catalogs-group-clear" class="app-btn app-btn-ghost app-btn-sm">Vaciar agrupación</button>
              </div>
              <p id="catalogs-selected-summary" class="catalogs-selected-summary">0 etiquetas en el catálogo</p>
              <input type="search" id="catalog-label-filter" class="catalogs-form-input" placeholder="Filtrar etiquetas…" autocomplete="off" />
              <div id="catalog-labels-grid" class="marcas-grid catalogs-labels-grid" role="list"></div>
              <div id="catalog-labels-loading" class="explore-loading is-hidden">
                <div class="animate-spin explore-spinner"></div>
              </div>
            </section>

            <section class="catalogs-editor-panel catalogs-editor-panel--meta" aria-labelledby="catalogs-meta-title">
              <h3 id="catalogs-meta-title" class="catalogs-panel-title">Datos del catálogo</h3>
              <div class="catalogs-form-row">
                <label class="catalogs-form-label" for="catalog-name">Nombre</label>
                <input type="text" id="catalog-name" class="catalogs-form-input" required maxlength="255" autocomplete="off" />
              </div>
              <div class="catalogs-form-row catalogs-form-row--small-desc">
                <label class="catalogs-form-label" for="catalog-small-description">Descripción breve</label>
                <p class="catalogs-form-hint">Resumen corto en texto plano; aparece en el listado de catálogos (no admite formato).</p>
                <textarea
                  id="catalog-small-description"
                  name="small_description"
                  class="catalogs-form-input catalogs-form-textarea catalogs-form-textarea--brief"
                  rows="4"
                  maxlength="500"
                  placeholder="Una o dos frases que resuman el catálogo…"
                  autocomplete="off"
                ></textarea>
              </div>
              <div class="catalogs-form-row catalogs-form-row--desc">
                <label id="catalog-desc-label" class="catalogs-form-label" for="catalog-desc-editor">Descripción completa</label>
                <p class="catalogs-form-hint">Texto enriquecido para la ficha del catálogo (puede ocupar el equivalente a una página).</p>
                <div id="catalog-desc-editor" class="catalog-desc-editor-mount" role="textbox" aria-labelledby="catalog-desc-label"></div>
              </div>
              <div class="catalogs-form-row catalogs-form-row--split catalogs-form-row--dates">
                <div>
                  <label class="catalogs-form-label" for="catalog-start">Desde</label>
                  <input type="date" id="catalog-start" class="catalogs-form-input" />
                </div>
                <div>
                  <label class="catalogs-form-label" for="catalog-end">Hasta</label>
                  <input type="date" id="catalog-end" class="catalogs-form-input" />
                </div>
              </div>
              <div class="catalogs-form-row catalogs-form-checks">
                <label class="catalogs-form-check">
                  <input type="checkbox" id="catalog-public" checked />
                  <span>Visible para visitantes (público)</span>
                </label>
                <label class="catalogs-form-check">
                  <input type="checkbox" id="catalog-active" checked />
                  <span>Activo</span>
                </label>
              </div>
            </section>

            <div class="catalogs-form-actions">
              <button type="submit" id="catalogs-save-btn" class="app-btn app-btn-primary">Guardar catálogo</button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div id="catalog-image-modal" class="shot-modal is-hidden" role="dialog" aria-modal="true">
      <div class="shot-modal-card shot-modal-card--collection-note">
        <button type="button" id="catalog-modal-close" class="shot-modal-close-inner" aria-label="Cerrar">×</button>
        <div class="shot-modal-main">
          <div id="catalog-modal-note" class="shot-modal-note shot-modal-collection-note is-hidden" tabindex="0" aria-live="polite">
            <p class="shot-modal-collection-note-title">Indicaciones de la colección</p>
            <div id="catalog-modal-note-body" class="shot-modal-collection-note-body rich-html-content"></div>
          </div>
          <div class="shot-modal-body">
            <img id="catalog-modal-img" src="" alt="" draggable="false" />
          </div>
        </div>
        <div class="shot-modal-zoom" aria-label="Controles de zoom">
          <button type="button" id="catalog-zoom-out" class="shot-zoom-btn" aria-label="Disminuir zoom">−</button>
          <button type="button" id="catalog-zoom-reset" class="shot-zoom-btn" aria-label="Reset zoom">Reset</button>
          <button type="button" id="catalog-zoom-in" class="shot-zoom-btn" aria-label="Aumentar zoom">+</button>
        </div>
      </div>
    </div>

    <section id="catalog-screensaver-page" class="shell-content catalog-screensaver-page is-hidden" aria-hidden="true" inert>
      <section id="catalog-screensaver" class="screensaver catalog-screensaver">
        <header class="screensaver-header catalog-screensaver-controls">
          <a href="#" id="catalog-screensaver-home" class="screensaver-logo-link" aria-label="Oderismo — Volver a colecciones">
            <img
              id="catalog-screensaver-logo"
              class="screensaver-logo"
              data-brand-logo="white"
              src="figures/oderismoblanco.png"
              alt="Oderismo — Catálogo de etiquetas de vino"
              width="130"
              height="31"
              decoding="async"
            />
          </a>
          <div class="catalog-screensaver-header-actions">
            <div class="catalog-screensaver-modes" role="group" aria-label="Etiquetas por pantalla">
              <button type="button" class="catalog-screensaver-mode-btn is-active" data-count="1" aria-label="Mostrar 1 etiqueta">1</button>
              <button type="button" class="catalog-screensaver-mode-btn" data-count="2" aria-label="Mostrar 2 etiquetas">2</button>
              <button type="button" class="catalog-screensaver-mode-btn" data-count="4" aria-label="Mostrar 4 etiquetas">4</button>
            </div>
            <button type="button" id="catalog-screensaver-back" class="screensaver-back">Volver</button>
          </div>
        </header>
        <div id="catalog-screensaver-stage" class="screensaver-stage" aria-live="polite"></div>
        <footer class="screensaver-partners" aria-label="Enlaces de entidades colaboradoras">
          <a class="partner-link" href="https://thesherrygallery.com/" target="_blank" rel="noopener noreferrer">
            <img class="partner-logo" src="figures/sherryGallery.png" alt="The Sherry Gallery" decoding="async" />
          </a>
          <a class="partner-link" href="https://ucatedravino.com/" target="_blank" rel="noopener noreferrer">
            <img class="partner-logo" src="figures/catedraFondoBlanco.png" alt="Cátedra Vino, Sociedad y Sostenibilidad" decoding="async" />
          </a>
          <a class="partner-link" href="https://catar360.es/" target="_blank" rel="noopener noreferrer">
            <img class="partner-logo" src="figures/cataFondoBlanco.png" alt="CATAR · Immersive Wine Experiences" decoding="async" />
          </a>
          <a class="partner-link" href="https://www.sherry.wine/es" target="_blank" rel="noopener noreferrer">
            <img class="partner-logo" src="figures/consejoRegulador.jpg" alt="Consejo Regulador Jerez-Xérès-Sherry" decoding="async" />
          </a>
        </footer>
      </section>
    </section>
  `;

  const listView = container.querySelector('#catalogs-list-view');
  const detailView = container.querySelector('#catalogs-detail-view');
  const editorView = container.querySelector('#catalogs-editor-view');
  const grid = container.querySelector('#catalogs-grid');
  const loading = container.querySelector('#catalogs-loading');
  const emptyEl = container.querySelector('#catalogs-empty');
  const errorEl = container.querySelector('#catalogs-error');
  const imageGrid = container.querySelector('#catalog-image-grid');
  const imagesLoading = container.querySelector('#catalog-images-loading');
  const imagesEmpty = container.querySelector('#catalog-images-empty');
  const modal = container.querySelector('#catalog-image-modal');
  const modalImg = container.querySelector('#catalog-modal-img');
  const modalBody = container.querySelector('#catalog-image-modal .shot-modal-body');
  const zoomOutBtn = container.querySelector('#catalog-zoom-out');
  const zoomInBtn = container.querySelector('#catalog-zoom-in');
  const zoomResetBtn = container.querySelector('#catalog-zoom-reset');
  const modalNote = container.querySelector('#catalog-modal-note');
  const modalNoteBody = container.querySelector('#catalog-modal-note-body');
  const catalogScreensaverPage = container.querySelector('#catalog-screensaver-page');
  const catalogScreensaver = container.querySelector('#catalog-screensaver');
  const catalogScreensaverStage = container.querySelector('#catalog-screensaver-stage');
  const catalogScreensaverBtn = container.querySelector('#catalogs-screensaver-btn');
  let catalogScreensaverGroupSize = 1;
  let catalogScreensaverHiddenSiblings = [];
  patchCatalogEditorForm(container);
  if (catalogScreensaverPage && catalogScreensaverPage.parentElement !== document.body) {
    const previousScreensaver = document.body.querySelector('#catalog-screensaver-page');
    if (previousScreensaver && previousScreensaver !== catalogScreensaverPage) {
      previousScreensaver.remove();
    }
    document.body.appendChild(catalogScreensaverPage);
  }

  // Visor de imágenes (como el explorador): zoom + arrastre + reset.
  let viewScale = 1;
  let viewPanX = 0;
  let viewPanY = 0;
  let isPanning = false;
  let panPointerId = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  function getPanLimits() {
    if (!modalBody || !modalImg || viewScale <= 1) return { maxX: 0, maxY: 0 };
    const bodyW = modalBody.clientWidth;
    const bodyH = modalBody.clientHeight;
    const nw = modalImg.naturalWidth;
    const nh = modalImg.naturalHeight;
    if (!nw || !nh || !bodyW || !bodyH) return { maxX: 0, maxY: 0 };
    const fit = Math.min(bodyW / nw, bodyH / nh);
    const displayW = nw * fit;
    const displayH = nh * fit;
    return {
      maxX: Math.max(0, (displayW * viewScale - bodyW) / 2),
      maxY: Math.max(0, (displayH * viewScale - bodyH) / 2),
    };
  }

  function clampPan() {
    const { maxX, maxY } = getPanLimits();
    viewPanX = Math.max(-maxX, Math.min(maxX, viewPanX));
    viewPanY = Math.max(-maxY, Math.min(maxY, viewPanY));
  }

  function applyViewerTransform() {
    if (!modalImg) return;
    if (viewScale <= 1) {
      viewPanX = 0;
      viewPanY = 0;
    } else {
      clampPan();
    }
    modalImg.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewScale})`;
    modalImg.classList.toggle('is-pannable', viewScale > 1);
    modalImg.classList.toggle('is-dragging', isPanning);
  }

  function resetViewerTransform() {
    viewScale = 1;
    viewPanX = 0;
    viewPanY = 0;
    isPanning = false;
    panPointerId = null;
    applyViewerTransform();
  }

  function setScale(next) {
    viewScale = Math.max(1, Math.min(6, next));
    applyViewerTransform();
  }


  async function destroyCatalogDescEditor() {
    if (catalogDescEditor) {
      catalogDescEditor.destroy();
      catalogDescEditor = null;
    }
  }

  async function ensureCatalogDescEditor() {
    const mount = container.querySelector('#catalog-desc-editor');
    if (!mount) return null;
    if (!catalogDescEditor) {
      catalogDescEditor = await createRichNoteEditor(mount, {
        rootClass: 'rich-note-editor--catalog-desc',
        placeholder: 'Describe el catálogo para el visitante: contexto, criterios, historia…',
      });
    }
    return catalogDescEditor;
  }

  function showList() {
    closeCatalogScreensaver();
    void destroyCatalogDescEditor();
    selected = null;
    images = [];
    editorMode = false;
    editingId = null;
    listView.classList.remove('is-hidden');
    detailView.classList.add('is-hidden');
    editorView.classList.add('is-hidden');
  }

  function showDetail() {
    listView.classList.add('is-hidden');
    detailView.classList.remove('is-hidden');
    editorView.classList.add('is-hidden');
  }

  function showEditor(isNew) {
    listView.classList.add('is-hidden');
    detailView.classList.add('is-hidden');
    editorView.classList.remove('is-hidden');
    container.querySelector('#catalogs-editor-title').textContent =
      isNew ? 'Nuevo catálogo' : 'Editar catálogo';
  }

  function catalogCardPreviewHtml(col) {
    const img = col.sample_image;
    if (!img?.url && !img?.title) return '';
    return `<span class="catalog-card-preview" aria-hidden="true">
      <img src="${exploreImageUrl(img, { thumb: true })}" alt="" loading="lazy" />
    </span>`;
  }

  function renderCollectionCard(col) {
    const card = document.createElement('article');
    card.className = 'catalog-card';
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    const summary = guest ? guestCollectionCardSummary(col) : catalogCardSummary(col);
    const previewHtml = catalogCardPreviewHtml(col);
    const visibilityHtml = guest ? catalogVisibilityHtml(col) : '';
    if (previewHtml) card.classList.add('catalog-card--with-preview');
    if (guest) {
      card.classList.add('catalog-card--full');
      card.innerHTML = `
        ${previewHtml}
        <span class="catalog-card-body">
          <span class="catalog-card-name">${escapeHtml(col.name)}</span>
          ${visibilityHtml}
          ${summary ? `<span class="catalog-card-desc">${escapeHtml(summary)}</span>` : ''}
        </span>
      `;
    } else {
      const count = col.image_count ?? 0;
      const labels = col.label_count ?? 0;
      card.innerHTML = `
        ${previewHtml}
        <span class="catalog-card-body">
          <span class="catalog-card-name">${escapeHtml(col.name)}</span>
          ${summary ? `<span class="catalog-card-desc">${escapeHtml(summary)}</span>` : ''}
          <span class="catalog-card-stats">${labels} etiqueta${labels === 1 ? '' : 's'} · ${count} imagen${count === 1 ? '' : 'es'}</span>
          <span class="catalog-card-badges">${statusBadges(col)}</span>
        </span>
      `;
    }
    const previewImg = card.querySelector('.catalog-card-preview img');
    if (previewImg && col.sample_image) {
      attachExploreImageFallback(previewImg, exploreImageUrl(col.sample_image, { thumb: false }));
    }
    const open = () => openCollection(col);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return card;
  }

  function renderCollectionsGrid() {
    grid.innerHTML = '';
    collections.forEach((c) => grid.appendChild(renderCollectionCard(c)));
  }

  function renderImageCard(img) {
    const card = document.createElement('article');
    card.className = 'explore-card';
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <button type="button" class="explore-card-hit" aria-label="Ver imagen">
        <div class="explore-card-media">
          <img src="${exploreImageUrl(img, { thumb: true })}" alt="${escapeHtml(img.title || '')}" loading="lazy" />
        </div>
      </button>
    `;
    attachExploreImageFallback(
      card.querySelector('.explore-card-media img'),
      exploreImageUrl(img, { thumb: false }),
    );
    card.querySelector('.explore-card-hit').addEventListener('click', () => {
      modalImg.src = exploreImageUrl(img, { thumb: false });
      modalImg.alt = img.title || '';
      resetViewerTransform();
      if (modalNote && modalNoteBody) {
        const noteHtml = String(img.collection_note?.body || '').trim();
        setRichHtmlContent(modalNoteBody, noteHtml);
        modalNote.classList.toggle('is-hidden', !noteHtml || isRichHtmlEmpty(noteHtml));
      }
      modal.classList.remove('is-hidden');
      document.body.style.overflow = 'hidden';
      syncLoginModalInert();
      setAppChromeInert(true);
      trapFocusIn(modal);
    });
    return card;
  }

  function renderImages() {
    if (!imageGrid) return;
    imageGrid.innerHTML = '';
    images.forEach((img) => imageGrid.appendChild(renderImageCard(img)));
    imagesEmpty?.classList.toggle('is-hidden', images.length > 0);
  }

  function collectionScreensaverUrls() {
    return images
      .map((img) => exploreImageUrl(img, { thumb: true }))
      .filter(Boolean);
  }

  function syncCatalogScreensaverModeButtons() {
    catalogScreensaver?.querySelectorAll('.catalog-screensaver-mode-btn').forEach((btn) => {
      const active = Number(btn.dataset.count || 1) === catalogScreensaverGroupSize;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setCatalogScreensaverGroupSize(size, restart = false) {
    catalogScreensaverGroupSize = [1, 2, 4].includes(Number(size)) ? Number(size) : 1;
    syncCatalogScreensaverModeButtons();
    if (restart && catalogScreensaverPage && !catalogScreensaverPage.classList.contains('is-hidden')) {
      void openCatalogScreensaver();
    }
  }

  function isolateCatalogScreensaverPage() {
    if (!catalogScreensaverPage) return;
    catalogScreensaverHiddenSiblings = [];
    [...document.body.children].forEach((child) => {
      if (child === catalogScreensaverPage || child.tagName === 'SCRIPT') return;
      catalogScreensaverHiddenSiblings.push({
        el: child,
        display: child.style.display,
        inert: child.hasAttribute('inert'),
        ariaHidden: child.getAttribute('aria-hidden'),
      });
      child.style.display = 'none';
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
    });
  }

  function restoreCatalogScreensaverSiblings() {
    catalogScreensaverHiddenSiblings.forEach(({ el, display, inert, ariaHidden }) => {
      el.style.display = display;
      if (!inert) el.removeAttribute('inert');
      if (ariaHidden === null) {
        el.removeAttribute('aria-hidden');
      } else {
        el.setAttribute('aria-hidden', ariaHidden);
      }
    });
    catalogScreensaverHiddenSiblings = [];
  }

  async function openCatalogScreensaver() {
    const urls = collectionScreensaverUrls();
    if (!guest || !catalogScreensaverPage || !catalogScreensaverStage || !urls.length) {
      toastError('Esta colección no tiene imágenes para el salvapantallas.');
      return;
    }
    const alreadyOpen = !catalogScreensaverPage.classList.contains('is-hidden');
    if (catalogScreensaverPage.parentElement !== document.body) {
      document.body.appendChild(catalogScreensaverPage);
    }
    document.documentElement.classList.add('catalog-screensaver-open');
    document.body.classList.add('catalog-screensaver-open');
    if (!alreadyOpen) isolateCatalogScreensaverPage();
    catalogScreensaverPage.classList.remove('is-hidden');
    catalogScreensaverPage.removeAttribute('inert');
    catalogScreensaverPage.removeAttribute('aria-hidden');
    document.body.style.overflow = 'hidden';
    syncCatalogScreensaverModeButtons();
    trapFocusIn(catalogScreensaverPage);

    await startScreensaver({
      stageEl: catalogScreensaverStage,
      imageUrls: urls,
      groupSize: catalogScreensaverGroupSize,
      emptyMessage: 'Esta colección no tiene imágenes para mostrar.',
      onError: (err) => console.warn('Salvapantallas de colección:', err?.message || err),
    });
  }

  function closeCatalogScreensaver() {
    stopScreensaver();
    if (catalogScreensaverStage) catalogScreensaverStage.innerHTML = '';
    catalogScreensaverPage?.classList.add('is-hidden');
    catalogScreensaverPage?.setAttribute('inert', '');
    catalogScreensaverPage?.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('catalog-screensaver-open');
    document.body.classList.remove('catalog-screensaver-open');
    restoreCatalogScreensaverSiblings();
    document.body.style.overflow = modal?.classList.contains('is-hidden') ? '' : document.body.style.overflow;
    releaseFocusTrap();
  }

  async function openCollection(col) {
    showDetail();
    container.querySelector('#catalogs-detail-title').textContent = col.name;
    const descEl = container.querySelector('#catalogs-detail-desc');
    setCatalogDescriptionDisplay(descEl, col.description);
    if (!guest) {
      const labels = col.label_count ?? 0;
      const count = col.image_count ?? 0;
      container.querySelector('#catalogs-detail-meta').textContent =
        `${labels} etiqueta${labels === 1 ? '' : 's'} · ${count} imagen${count === 1 ? '' : 'es'}`;
      container.querySelector('#catalogs-detail-badges').innerHTML = statusBadges(col);
      const smallDescEl = container.querySelector('#catalogs-detail-small-desc');
      setCatalogSmallDescriptionDisplay(smallDescEl, col.small_description);
    }

    imagesLoading?.classList.remove('is-hidden');
    imageGrid.innerHTML = '';
    imagesEmpty?.classList.add('is-hidden');
    if (catalogScreensaverBtn) catalogScreensaverBtn.disabled = true;
    if (imagesEmpty) {
      imagesEmpty.textContent = guest
        ? 'Esta colección no tiene imágenes.'
        : 'Este catálogo no tiene imágenes asociadas.';
    }

    try {
      const data = guest
        ? await api.getPublicCollection(col.slug)
        : await api.getCollection(col.id);
      selected = data.collection;
      images = data.images || [];
      setCatalogDescriptionDisplay(descEl, data.collection?.description);
      if (!guest) {
        const smallDescEl = container.querySelector('#catalogs-detail-small-desc');
        setCatalogSmallDescriptionDisplay(smallDescEl, data.collection?.small_description);
        const labelsWrap = container.querySelector('#catalogs-detail-labels');
        if (data.labels?.length) {
          labelsWrap.innerHTML = data.labels.map((l) =>
            `<span class="catalog-label-chip" style="--chip-color:${escapeHtml(l.color || '#6366f1')}">${escapeHtml(l.name)}</span>`,
          ).join('');
          labelsWrap.classList.remove('is-hidden');
        } else {
          labelsWrap.classList.add('is-hidden');
        }
      }

      renderImages();
      if (catalogScreensaverBtn) catalogScreensaverBtn.disabled = images.length === 0;
      if (!images.length) {
        imagesEmpty?.classList.remove('is-hidden');
      }
    } catch (err) {
      images = [];
      if (catalogScreensaverBtn) catalogScreensaverBtn.disabled = true;
      if (imagesEmpty) {
        imagesEmpty.textContent = err.message || (guest ? 'No se pudo cargar la colección' : 'No se pudo cargar el catálogo');
        imagesEmpty.classList.remove('is-hidden');
      }
    } finally {
      imagesLoading?.classList.add('is-hidden');
    }
  }

  async function loadCollections() {
    loading.classList.remove('is-hidden');
    emptyEl.classList.add('is-hidden');
    errorEl.classList.add('is-hidden');
    grid.innerHTML = '';
    try {
      const data = guest
        ? await api.getPublicCollections()
        : (canEdit ? await api.getCollections() : await api.getPublicCollections());
      collections = data.collections || [];
      if (!guest && canEdit) {
        // Editores ven todos; invitados solo públicos activos en rango.
      } else if (!guest && !canEdit) {
        collections = collections.filter((c) => c.is_public && c.is_active);
      }
      renderCollectionsGrid();
      emptyEl.classList.toggle('is-hidden', collections.length > 0);
    } catch (err) {
      errorEl.textContent = err.message || 'Error cargando catálogos';
      errorEl.classList.remove('is-hidden');
    } finally {
      loading.classList.add('is-hidden');
    }
  }

  function updatePickHint() {
    const hint = container.querySelector('#catalogs-pick-hint');
    const groupActions = container.querySelector('#catalogs-group-actions');
    if (labelPickMode === 'individual') {
      hint.textContent = 'Pulsa una etiqueta para añadirla o quitarla del catálogo.';
      groupActions.classList.add('is-hidden');
    } else {
      hint.textContent = 'Marca varias etiquetas en la agrupación y pulsa «Añadir agrupación al catálogo».';
      groupActions.classList.remove('is-hidden');
      updateGroupUi();
    }
    container.querySelectorAll('.catalogs-pick-mode').forEach((btn) => {
      const on = btn.dataset.mode === labelPickMode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderLabelPickerGrid();
  }

  function updateGroupUi() {
    const n = groupPickBuffer.size;
    container.querySelector('#catalogs-group-count').textContent =
      `${n} en la agrupación`;
    container.querySelector('#catalogs-group-add').disabled = n === 0;
  }

  function updateSelectedSummary() {
    const n = selectedLabelIds.size;
    container.querySelector('#catalogs-selected-summary').textContent =
      `${n} etiqueta${n === 1 ? '' : 's'} en el catálogo`;
  }

  function renderLabelPickerGrid() {
    const labelGrid = container.querySelector('#catalog-labels-grid');
    const filter = (container.querySelector('#catalog-label-filter')?.value || '').trim().toLowerCase();
    labelGrid.innerHTML = '';
    const list = availableLabels.filter((l) => {
      if (!filter) return true;
      return l.name.toLowerCase().includes(filter) || (l.slug || '').toLowerCase().includes(filter);
    });
    list.forEach((label) => {
      const card = document.createElement('article');
      const inCatalog = selectedLabelIds.has(label.id);
      const inGroup = groupPickBuffer.has(label.id);
      card.className = 'marca-card marca-card--selectable catalog-label-pick-card';
      if (labelPickMode === 'individual' && inCatalog) card.classList.add('is-selected');
      if (labelPickMode === 'group' && inGroup) card.classList.add('is-selected');
      card.setAttribute('role', 'listitem');
      card.tabIndex = 0;
      const color = label.color || '#6366f1';
      card.innerHTML = `
        <span class="marca-card-check" aria-hidden="true">${(labelPickMode === 'individual' ? inCatalog : inGroup) ? '✓' : ''}</span>
        <span class="marca-card-body">
          <span class="marca-card-name">${escapeHtml(label.name)}</span>
          ${label.creator_name ? `<span class="marca-card-desc">${escapeHtml(label.creator_name)}</span>` : ''}
          <span class="marca-card-count">${label.image_count ?? 0} imagen${(label.image_count ?? 0) === 1 ? '' : 'es'}</span>
        </span>
        <span class="marca-card-color-dot" style="background:${escapeHtml(color)}"></span>
      `;
      const toggle = () => {
        if (labelPickMode === 'individual') {
          if (selectedLabelIds.has(label.id)) selectedLabelIds.delete(label.id);
          else selectedLabelIds.add(label.id);
          updateSelectedSummary();
          renderLabelPickerGrid();
          return;
        }
        if (groupPickBuffer.has(label.id)) groupPickBuffer.delete(label.id);
        else groupPickBuffer.add(label.id);
        updateGroupUi();
        renderLabelPickerGrid();
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      labelGrid.appendChild(card);
    });
  }

  async function loadAvailableLabels() {
    const labelLoading = container.querySelector('#catalog-labels-loading');
    labelLoading.classList.remove('is-hidden');
    try {
      const data = await api.getCollectionAvailableLabels('');
      availableLabels = data.labels || [];
      renderLabelPickerGrid();
    } catch (err) {
      toastError(err.message || 'No se pudieron cargar las etiquetas');
    } finally {
      labelLoading.classList.add('is-hidden');
    }
  }

  async function resetEditorForm(col = null) {
    selectedLabelIds.clear();
    groupPickBuffer.clear();
    labelPickMode = 'individual';
    container.querySelector('#catalog-name').value = col?.name || '';
    const smallDescInput = container.querySelector('#catalog-small-description');
    if (smallDescInput) smallDescInput.value = col?.small_description || '';
    const editor = await ensureCatalogDescEditor();
    editor?.setHtml(col?.description || '');
    container.querySelector('#catalog-start').value = col?.start_date || '';
    container.querySelector('#catalog-end').value = col?.end_date || '';
    container.querySelector('#catalog-public').checked = col ? !!col.is_public : true;
    container.querySelector('#catalog-active').checked = col ? !!col.is_active : true;
    if (col?.labels) {
      col.labels.forEach((l) => selectedLabelIds.add(l.id));
    }
    updatePickHint();
    updateSelectedSummary();
  }

  async function startCreate() {
    editingId = null;
    showEditor(true);
    await resetEditorForm();
    await loadAvailableLabels();
  }

  async function startEdit() {
    if (!selected) return;
    editingId = selected.id;
    try {
      const data = await api.getCollection(selected.id);
      showEditor(false);
      await resetEditorForm({ ...data.collection, labels: data.labels });
      await loadAvailableLabels();
    } catch (err) {
      toastError(err.message || 'No se pudo cargar el catálogo');
    }
  }

  container.querySelector('#catalogs-back')?.addEventListener('click', showList);
  container.querySelector('#catalogs-editor-back')?.addEventListener('click', () => {
    void destroyCatalogDescEditor();
    if (selected) {
      showDetail();
    } else {
      showList();
    }
  });

  container.querySelector('#catalogs-create-btn')?.addEventListener('click', () => {
    selected = null;
    void startCreate();
  });

  container.querySelector('#catalogs-edit-btn')?.addEventListener('click', () => void startEdit());
  container.querySelector('#catalogs-screensaver-btn')?.addEventListener('click', () => {
    void openCatalogScreensaver();
  });
  catalogScreensaver?.querySelector('#catalog-screensaver-back')?.addEventListener('click', () => {
    closeCatalogScreensaver();
    showList();
  });
  catalogScreensaver?.querySelector('#catalog-screensaver-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeCatalogScreensaver();
    showList();
  });
  catalogScreensaver?.querySelectorAll('.catalog-screensaver-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setCatalogScreensaverGroupSize(btn.dataset.count, true));
  });

  container.querySelector('#catalogs-delete-btn')?.addEventListener('click', async () => {
    if (!selected) return;
    if (!await confirmDialog(
      `¿Eliminar el catálogo «${selected.name}»?`,
      { title: 'Eliminar catálogo', confirmLabel: 'Eliminar', danger: true },
    )) return;
    try {
      await api.deleteCollection(selected.id);
      toastSuccess('Catálogo eliminado');
      showList();
      await loadCollections();
    } catch (err) {
      toastError(err.message || 'No se pudo eliminar');
    }
  });

  container.querySelectorAll('.catalogs-pick-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      labelPickMode = btn.dataset.mode === 'group' ? 'group' : 'individual';
      groupPickBuffer.clear();
      updatePickHint();
    });
  });

  container.querySelector('#catalogs-group-add')?.addEventListener('click', () => {
    groupPickBuffer.forEach((id) => selectedLabelIds.add(id));
    groupPickBuffer.clear();
    updateGroupUi();
    updateSelectedSummary();
    renderLabelPickerGrid();
    toastSuccess('Agrupación añadida al catálogo');
  });

  container.querySelector('#catalogs-group-clear')?.addEventListener('click', () => {
    groupPickBuffer.clear();
    updateGroupUi();
    renderLabelPickerGrid();
  });

  container.querySelector('#catalog-label-filter')?.addEventListener('input', () => {
    renderLabelPickerGrid();
  });

  container.querySelector('#catalogs-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = container.querySelector('#catalog-name').value.trim();
    if (!name) {
      toastError('Indica un nombre');
      return;
    }
    const descHtml = catalogDescEditor?.getHtml() ?? '';
    const smallDesc = container.querySelector('#catalog-small-description')?.value.trim() ?? '';
    const payload = {
      name,
      small_description: smallDesc || null,
      description: isRichHtmlEmpty(descHtml) ? null : descHtml.trim(),
      start_date: container.querySelector('#catalog-start').value || null,
      end_date: container.querySelector('#catalog-end').value || null,
      is_public: container.querySelector('#catalog-public').checked,
      is_active: container.querySelector('#catalog-active').checked,
      label_ids: [...selectedLabelIds],
    };
    const saveBtn = container.querySelector('#catalogs-save-btn');
    saveBtn.disabled = true;
    try {
      if (editingId) {
        await api.updateCollection(editingId, payload);
        toastSuccess('Catálogo actualizado');
        const data = await api.getCollection(editingId);
        selected = data.collection;
        await destroyCatalogDescEditor();
        showDetail();
        await openCollection(selected);
      } else {
        const data = await api.createCollection(payload);
        toastSuccess('Catálogo creado');
        selected = data.collection;
        await loadCollections();
        await destroyCatalogDescEditor();
        showDetail();
        await openCollection(selected);
      }
      await loadCollections();
    } catch (err) {
      toastError(err.message || 'No se pudo guardar');
    } finally {
      saveBtn.disabled = false;
    }
  });

  function closeCatalogModal() {
    modal.classList.add('is-hidden');
    document.body.style.overflow = '';
    resetViewerTransform();
    releaseFocusTrap();
    setAppChromeInert(false);
    syncLoginModalInert();
  }

  container.querySelector('#catalog-modal-close')?.addEventListener('click', closeCatalogModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCatalogModal();
  });
  catalogScreensaver?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCatalogScreensaver();
      showList();
    }
  });

  // Controles de zoom del visor
  zoomOutBtn?.addEventListener('click', () => setScale(viewScale / 1.25));
  zoomInBtn?.addEventListener('click', () => setScale(viewScale * 1.25));
  zoomResetBtn?.addEventListener('click', resetViewerTransform);

  // Arrastre para desplazar cuando hay zoom
  modalBody?.addEventListener('pointerdown', (e) => {
    if (viewScale <= 1 || !modalImg) return;
    isPanning = true;
    panPointerId = e.pointerId;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = viewPanX;
    panOriginY = viewPanY;
    try {
      modalBody.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    applyViewerTransform();
  });

  modalBody?.addEventListener('pointermove', (e) => {
    if (!isPanning || panPointerId !== e.pointerId) return;
    viewPanX = panOriginX + (e.clientX - panStartX);
    viewPanY = panOriginY + (e.clientY - panStartY);
    applyViewerTransform();
  });

  function endPan(e) {
    if (!isPanning) return;
    if (panPointerId != null && e && e.pointerId !== panPointerId) return;
    isPanning = false;
    panPointerId = null;
    applyViewerTransform();
  }

  modalBody?.addEventListener('pointerup', endPan);
  modalBody?.addEventListener('pointercancel', endPan);
  modalBody?.addEventListener('pointerleave', endPan);

  // Rueda: zoom suave (trackpad/mouse)
  modalBody?.addEventListener('wheel', (e) => {
    if (!modal?.classList.contains('is-hidden')) {
      e.preventDefault();
      const delta = e.deltaY;
      if (delta === 0) return;
      const factor = delta > 0 ? (1 / 1.12) : 1.12;
      setScale(viewScale * factor);
    }
  }, { passive: false });

  void loadCollections();
}
