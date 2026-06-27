import { api, exploreImageUrl, prefetchEtiquetasMediaToken } from './api.js';
import { toastError, toastWarn } from './toast.js';

function existingCatalogThumb(existingPath) {
  const name = String(existingPath || '').split('/').pop();
  return name ? exploreImageUrl(`/images/${name}`, { thumb: true }) : '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderUploadModal(onDone, initialFiles = null) {
  const objectUrls = [];
  const trackObjectUrl = (file) => {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    return url;
  };
  const revokeObjectUrls = () => {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.length = 0;
  };
  const existing = document.getElementById('upload-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'upload-overlay';
  overlay.className = 'app-modal upload-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `<div id="upload-panel" class="upload-dialog-card"></div>`;
  document.body.appendChild(overlay);

  let currentSessionId = null;
  let processingActive = false;
  const panel = document.getElementById('upload-panel');
  panel.addEventListener('click', (e) => e.stopPropagation());

  function setProcessing(active) {
    processingActive = active;
    overlay.classList.toggle('upload-overlay--locked', active);
    const closeBtn = document.getElementById('upload-close');
    if (closeBtn) {
      closeBtn.disabled = active;
      closeBtn.classList.toggle('is-disabled', active);
      closeBtn.setAttribute('aria-disabled', active ? 'true' : 'false');
    }
  }

  function closeModal() {
    revokeObjectUrls();
    overlay.remove();
    document.body.style.overflow = '';
    if (typeof onDone === 'function') onDone();
  }

  function requestClose() {
    if (processingActive) {
      toastWarn('Espera a que termine el proceso de subida.');
      return;
    }
    if (currentSessionId) api.deleteSession(currentSessionId).catch(() => {});
    closeModal();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) requestClose();
  });

  function bindClose() {
    const btn = document.getElementById('upload-close');
    if (btn) {
      btn.addEventListener('click', requestClose);
      btn.disabled = processingActive;
      btn.classList.toggle('is-disabled', processingActive);
      btn.setAttribute('aria-disabled', processingActive ? 'true' : 'false');
    }
  }

  // Fase 1: subida + OCR
  function renderPhase1() {
    panel.innerHTML = `
      <header class="upload-dialog-head">
        <h2 class="upload-section-title font-serifDisplay">Subir imágenes</h2>
        <button type="button" id="upload-close" class="shot-modal-close-inner" aria-label="Cerrar">×</button>
      </header>
      <div class="upload-dialog-body">
        <div id="drop-zone" class="upload-inline-drop" tabindex="0" role="button" aria-label="Seleccionar imágenes">
          <p class="upload-inline-drop-title">Arrastra imágenes aquí</p>
          <p class="upload-inline-drop-hint">o haz clic para elegir archivos</p>
          <input type="file" id="file-input" multiple accept="image/*" class="is-hidden" />
        </div>
        <div id="ocr-progress" class="upload-progress is-hidden" aria-live="polite">
          <div class="upload-progress-row">
            <div class="upload-progress-track">
              <div id="ocr-bar" class="upload-progress-bar"></div>
            </div>
            <span id="ocr-text" class="upload-progress-label">0/0</span>
          </div>
        </div>
        <div id="ocr-grid" class="explore-grid upload-confirm-grid" role="list"></div>
        <div id="ocr-actions" class="upload-dialog-actions is-hidden">
          <button type="button" id="select-all-btn" class="app-btn app-btn-secondary app-btn-sm">Seleccionar todo</button>
          <button type="button" id="continue-crop-btn" class="app-btn app-btn-primary" disabled>Recortando…</button>
        </div>
      </div>
    `;
    bindClose();

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('is-dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
      handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => handleFiles(fileInput.files));

    const localPreviewByName = new Map();

    function buildOcrCard(evt, previewSrc, previewAlt = 'Vista previa') {
      const card = document.createElement('article');
      card.className = 'explore-card upload-confirm-card';
      card.dataset.filename = evt.filename;
      card.setAttribute('role', 'listitem');
      const name = escapeHtml(evt.filename);
      const ocr = escapeHtml(evt.ocr_text?.substring(0, 140) || '(sin texto)');
      const mediaInner = previewSrc
        ? `<img src="${previewSrc}" alt="${escapeHtml(previewAlt)}" loading="lazy" />`
        : '<span class="upload-confirm-placeholder">Sin vista previa</span>';
      card.innerHTML = `
        <label class="upload-confirm-check">
          <input type="checkbox" checked class="upload-confirm-check-input" />
          <span class="upload-confirm-check-box" aria-hidden="true"></span>
        </label>
        <div class="explore-card-media upload-confirm-card-media">${mediaInner}</div>
        <div class="upload-confirm-card-body">
          <p class="upload-confirm-card-title" title="${name}">${name}</p>
          <p class="upload-confirm-card-ocr">${ocr}</p>
        </div>
      `;
      return card;
    }

    function updateCardCropPreview(filename, b64Preview) {
      const card = document.querySelector(`#ocr-grid [data-filename="${CSS.escape(filename)}"]`);
      if (!card || !b64Preview) return;
      const media = card.querySelector('.upload-confirm-card-media');
      if (!media) return;
      let img = media.querySelector('img');
      const src = `data:image/png;base64,${b64Preview}`;
      if (!img) {
        media.innerHTML = '';
        img = document.createElement('img');
        img.alt = 'Etiqueta recortada';
        img.loading = 'lazy';
        media.appendChild(img);
      }
      img.src = src;
    }

    async function runCropOnCards(sessionId, accepted, bar, text) {
      text.textContent = 'Recortando…';
      const response = await api.cropBatch(sessionId, accepted, null);
      const stream = await api.ensureUploadStream(response);
      const last = await api.sseReader(stream, (evt) => {
        if (evt.done) {
          bar.style.width = '100%';
          bar.classList.add('is-crop');
          text.textContent = `Recorte ${evt.success}/${evt.total}`;
        } else if (evt.ok && evt.preview) {
          bar.style.width = `${(evt.processed / evt.total) * 100}%`;
          bar.classList.add('is-crop');
          text.textContent = `Recorte ${evt.processed}/${evt.total}`;
          updateCardCropPreview(evt.filename, evt.preview);
        }
      });
      return last;
    }

    async function handleFiles(files) {
      if (!files?.length) return;

      const progress = document.getElementById('ocr-progress');
      const bar = document.getElementById('ocr-bar');
      const text = document.getElementById('ocr-text');
      const grid = document.getElementById('ocr-grid');
      const actions = document.getElementById('ocr-actions');
      const continueBtn = document.getElementById('continue-crop-btn');

      revokeObjectUrls();
      localPreviewByName.clear();
      Array.from(files).forEach((f) => {
        localPreviewByName.set(f.name, trackObjectUrl(f));
      });

      progress.classList.remove('is-hidden');
      dropZone.classList.add('is-hidden');
      grid.innerHTML = '';
      actions.classList.add('is-hidden');
      bar.classList.remove('is-crop', 'is-describe', 'is-done');
      continueBtn.disabled = true;
      continueBtn.textContent = 'Recortando…';
      text.textContent = 'OCR…';
      setProcessing(true);

      try {
        const response = await api.uploadAndOCR(files, null, currentSessionId);
        const stream = await api.ensureUploadStream(response);
        const lastEvt = await api.sseReader(stream, (evt) => {
          if (evt.done) {
            currentSessionId = evt.session_id;
            bar.style.width = '100%';
            text.textContent = `OCR ${evt.success}/${evt.total}`;
          } else if (evt.ok) {
            bar.style.width = `${(evt.processed / evt.total) * 100}%`;
            text.textContent = `OCR ${evt.processed}/${evt.total}`;
            const preview = localPreviewByName.get(evt.filename) || '';
            grid.appendChild(buildOcrCard(evt, preview, 'Original'));
          }
        });
        if (!lastEvt?.done) {
          throw new Error(
            'El OCR no terminó (conexión cortada o motor sin respuesta). '
            + 'Revisa en Red si hay líneas data: con "done":true.'
          );
        }
        if (!currentSessionId || !grid.children.length) {
          throw new Error('No se procesó ninguna imagen. Comprueba que el archivo sea una imagen válida.');
        }

        actions.classList.remove('is-hidden');
        const accepted = Array.from(grid.querySelectorAll('#ocr-grid [data-filename]'))
          .map((card) => card.dataset.filename)
          .filter(Boolean);

        await runCropOnCards(currentSessionId, accepted, bar, text);

        continueBtn.disabled = false;
        continueBtn.textContent = 'Continuar con indexado';
        setProcessing(false);
      } catch (err) {
        console.error('[UPLOAD] OCR:', err);
        toastError(err.message || 'Error al procesar las imágenes');
        progress.classList.add('is-hidden');
        dropZone.classList.remove('is-hidden');
        actions.classList.add('is-hidden');
        setProcessing(false);
      }
    }

    document.getElementById('select-all-btn').addEventListener('click', () => {
      const checks = document.querySelectorAll('#ocr-grid .upload-confirm-check-input');
      const allChecked = Array.from(checks).every((c) => c.checked);
      checks.forEach((c) => { c.checked = !allChecked; });
    });

    document.getElementById('continue-crop-btn').addEventListener('click', () => {
      const accepted = Array.from(document.querySelectorAll('#ocr-grid [data-filename]'))
        .filter((card) => card.querySelector('.upload-confirm-check-input')?.checked)
        .map((card) => card.dataset.filename)
        .filter(Boolean);
      if (!accepted.length) {
        toastWarn('Selecciona al menos una imagen');
        return;
      }
      renderPhase3(currentSessionId, accepted);
    });

    if (initialFiles?.length) {
      handleFiles(initialFiles);
    }
  }

  // Fase 2: recorte
  function renderPhase2(sessionId, accepted) {
    panel.innerHTML = `
      <div class="flex items-center justify-between p-4 border-b dark:border-gray-700">
        <h2 class="text-lg font-bold dark:text-white">Recortando</h2>
      </div>
      <div class="p-6 flex-1 overflow-y-auto">
        <div class="flex items-center gap-2 mb-4">
          <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div id="crop-bar" class="bg-green-600 h-2 rounded-full transition-all" style="width:0%"></div>
          </div>
          <span id="crop-text" class="text-sm text-gray-500 dark:text-gray-400">0/${accepted.length}</span>
        </div>
        <div id="crop-grid" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3"></div>
      </div>
    `;

    const bar = document.getElementById('crop-bar');
    const cropText = document.getElementById('crop-text');
    const grid = document.getElementById('crop-grid');

    setProcessing(true);
    (async () => {
      try {
        const response = await api.cropBatch(sessionId, accepted, null);
        const stream = await api.ensureUploadStream(response);
        await api.sseReader(stream, (evt) => {
          if (evt.done) {
            bar.style.width = '100%';
            cropText.textContent = `${evt.success}/${evt.total}`;
            renderPhase3(sessionId, accepted);
          } else if (evt.ok) {
            bar.style.width = `${(evt.processed / evt.total) * 100}%`;
            cropText.textContent = `${evt.processed}/${evt.total}`;
            const card = document.createElement('div');
            card.className = 'relative bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden';
            card.innerHTML = `
              <img src="data:image/png;base64,${evt.preview}" class="w-full h-32 object-cover" alt="" />
              <p class="p-1 text-xs truncate dark:text-gray-300">${evt.filename}</p>
            `;
            grid.appendChild(card);
          }
        });
      } catch (err) {
        console.error('[UPLOAD] Recorte:', err);
        toastError(err.message || 'Error en el recorte');
        setProcessing(false);
      }
    })();
  }

  // Fase 3: describir (motor) + fase 4: indexar en Qdrant y disco
  function renderPhase3(sessionId, accepted) {
    const totalCount = accepted.length;
    panel.innerHTML = `
      <header class="upload-dialog-head">
        <h2 class="upload-section-title font-serifDisplay">Describiendo e indexando</h2>
        <button type="button" id="upload-close" class="shot-modal-close-inner" aria-label="Cerrar">×</button>
      </header>
      <div class="upload-dialog-body">
        <div class="upload-progress" aria-live="polite">
          <div class="upload-progress-row">
            <div class="upload-progress-track">
              <div id="desc-bar" class="upload-progress-bar is-describe"></div>
            </div>
            <span id="desc-text" class="upload-progress-label">0/${totalCount}</span>
          </div>
        </div>
        <div id="desc-results" class="upload-results"></div>
        <div id="desc-done" class="upload-done-panel app-banner is-hidden" role="status">
          <p class="upload-done-title font-serifDisplay">¡Completado!</p>
          <p class="upload-done-text">La etiqueta se ha guardado en el archivo. Ya puedes consultarla en Explorar.</p>
          <button type="button" id="close-done-btn" class="app-btn app-btn-primary">Cerrar</button>
        </div>
      </div>
    `;
    bindClose();

    const bar = document.getElementById('desc-bar');
    const descText = document.getElementById('desc-text');
    const results = document.getElementById('desc-results');
    const doneDiv = document.getElementById('desc-done');
    const doneTitle = doneDiv.querySelector('.upload-done-title');
    const doneText = doneDiv.querySelector('.upload-done-text');
    const seenErrors = new Set();

    function showDone({ title, text, variant = 'success' } = {}) {
      bar.style.width = '100%';
      bar.classList.remove('is-describe');
      bar.classList.add('is-done');
      doneDiv.classList.remove(
        'is-hidden',
        'upload-done-panel--dup',
        'upload-done-panel--error',
        'upload-done-panel--partial',
      );
      doneDiv.classList.toggle('app-banner', variant === 'success');
      doneDiv.classList.toggle('upload-done-panel--dup', variant === 'duplicate');
      doneDiv.classList.toggle('upload-done-panel--error', variant === 'error');
      doneDiv.classList.toggle('upload-done-panel--partial', variant === 'partial');
      if (title) doneTitle.textContent = title;
      if (text) doneText.textContent = text;
      doneDiv.classList.remove('is-hidden');
      setProcessing(false);
    }

    function updateProgress(evt, labelPrefix) {
      if (!evt?.total) return;
      const n = (evt.processed ?? 0)
        + (evt.duplicates ?? 0)
        + (evt.duplicate ? 1 : 0)
        + (evt.errors?.length ?? 0);
      bar.style.width = `${Math.min(100, (n / evt.total) * 100)}%`;
      descText.textContent = `${labelPrefix} ${Math.min(evt.total, evt.processed ?? n)}/${evt.total}`;
    }

    function appendIndexedRow(filename) {
      if (results.querySelector(`[data-result-file="${CSS.escape(filename)}"]`)) return;
      const row = document.createElement('div');
      row.className = 'upload-result-row upload-result-row--ok';
      row.dataset.resultFile = filename;
      row.innerHTML = `<span aria-hidden="true">✓</span> ${escapeHtml(filename)}`;
      results.appendChild(row);
    }

    function appendErrorRow(filename) {
      if (seenErrors.has(filename)) return;
      seenErrors.add(filename);
      const row = document.createElement('div');
      row.className = 'upload-result-row upload-result-row--error';
      row.dataset.resultFile = filename;
      row.innerHTML = `
        <span aria-hidden="true">✕</span>
        <span>No se pudo indexar <strong>${escapeHtml(filename)}</strong>. Comprueba que el recorte se completó.</span>
      `;
      results.appendChild(row);
    }

    function appendDuplicateRow(evt) {
      if (!evt?.filename) return;
      const sel = `.upload-result-row--dup[data-filename="${CSS.escape(evt.filename)}"]`;
      if (results.querySelector(sel)) return;

      const row = document.createElement('div');
      row.className = 'upload-result-row upload-result-row--dup';
      row.dataset.filename = evt.filename;
      const fn = escapeHtml(evt.filename);
      const existingName = evt.existing_path?.split('/').pop() || '';
      const existingLabel = escapeHtml(existingName || 'etiqueta existente');
      const existingThumb = existingCatalogThumb(evt.existing_path);
      const existingMedia = existingThumb
        ? `<img src="${existingThumb}" alt="${existingLabel}" loading="lazy" />`
        : `<p class="upload-confirm-card-ocr" style="-webkit-line-clamp:2">${existingLabel}</p>`;
      const newPreview = evt.new_preview
        ? `<img src="data:image/png;base64,${evt.new_preview}" alt="" />`
        : '<span class="upload-confirm-placeholder">Nueva</span>';

      row.innerHTML = `
        <p class="upload-confirm-card-title">Ya existe en el archivo: ${fn}</p>
        <p class="upload-dup-hint">Coincide con <strong>${existingLabel}</strong> catalogada previamente.</p>
        <div class="upload-dup-compare">
          ${newPreview}
          <span aria-hidden="true">≈</span>
          ${existingMedia}
        </div>
        <button type="button" class="add-dup-btn app-btn app-btn-sm app-btn-secondary">Añadir de todos modos</button>
      `;
      row.querySelector('.add-dup-btn').addEventListener('click', async () => {
        const btn = row.querySelector('.add-dup-btn');
        btn.disabled = true;
        btn.textContent = 'Indexando…';
        try {
          const reResponse = await api.indexBatch(sessionId, [evt.filename], true, null);
          const reStream = await api.ensureUploadStream(reResponse);
          const reLast = await api.sseReader(reStream, (reEvt) => {
            updateProgress(reEvt, 'Indexando');
            if (reEvt.duplicate) return;
            if (reEvt.status === 'indexed' && reEvt.filename) {
              appendIndexedRow(reEvt.filename);
            }
            if (reEvt.filename && reEvt.errors?.includes(reEvt.filename)) {
              appendErrorRow(reEvt.filename);
            }
          });
          if (reLast?.done && (reLast.processed ?? 0) > 0) {
            row.remove();
          } else if (reLast?.duplicates) {
            toastWarn('Sigue detectándose como duplicado.');
            btn.disabled = false;
            btn.textContent = 'Añadir de todos modos';
            return;
          }
          if (!results.querySelector('.upload-result-row--dup')) {
            showDone();
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Añadir de todos modos';
          toastError(err.message || 'Error al añadir duplicado');
        }
      });
      results.appendChild(row);
    }

    function finishIndexPhase(indexLast) {
      const processed = indexLast.processed ?? 0;
      const duplicates = indexLast.duplicates ?? 0;
      const errors = indexLast.errors ?? [];
      const pendingDups = results.querySelectorAll('.upload-result-row--dup').length;

      errors.forEach((filename) => appendErrorRow(filename));

      if (processed === 0 && duplicates === 0 && errors.length === 0) {
        throw new Error('No se indexó ninguna imagen. Revisa los logs del motor en a22.');
      }

      if (pendingDups > 0 || duplicates > 0) {
        if (processed === 0 && errors.length === 0) {
          showDone({
            variant: 'duplicate',
            title: duplicates === 1 ? 'Ya existe en el archivo' : 'Imágenes ya catalogadas',
            text: duplicates === 1
              ? 'La imagen coincide con una etiqueta que ya está en la base de datos. No se ha vuelto a indexar. Puedes añadirla de todos modos o cerrar esta ventana.'
              : `${duplicates} imágenes coinciden con etiquetas ya catalogadas. No se han indexado de nuevo. Revisa la lista y decide si quieres añadirlas.`,
          });
        } else {
          showDone({
            variant: 'partial',
            title: 'Indexado con avisos',
            text: `${processed} etiqueta(s) guardada(s). ${duplicates || pendingDups} duplicado(s) pendiente(s) de decisión.`,
          });
        }
        return;
      }

      if (errors.length > 0 && processed === 0) {
        showDone({
          variant: 'error',
          title: 'No se pudo indexar',
          text: errors.length === 1
            ? 'La imagen no se guardó en la base de datos. Comprueba que el recorte se completó correctamente.'
            : `${errors.length} imágenes no se guardaron en la base de datos.`,
        });
        return;
      }

      if (errors.length > 0) {
        showDone({
          variant: 'partial',
          title: 'Completado con errores',
          text: `${processed} etiqueta(s) guardada(s). ${errors.length} no se pudieron indexar.`,
        });
        return;
      }

      showDone();
    }

    setProcessing(true);
    (async () => {
      try {
        await prefetchEtiquetasMediaToken();
        descText.textContent = `Describiendo 0/${totalCount}`;
        const describeResponse = await api.describeBatch(sessionId, null);
        const describeStream = await api.ensureUploadStream(describeResponse);
        const describeLast = await api.sseReader(describeStream, (evt) => {
          updateProgress(evt, 'Describiendo');
        });
        if (!describeLast?.done) {
          throw new Error('La descripción no terminó correctamente.');
        }

        descText.textContent = `Indexando 0/${totalCount}`;
        bar.classList.add('is-describe');
        const indexResponse = await api.indexBatch(sessionId, accepted, false, null);
        const indexStream = await api.ensureUploadStream(indexResponse);
        const indexLast = await api.sseReader(indexStream, (evt) => {
          updateProgress(evt, 'Indexando');
          if (evt.duplicate) {
            appendDuplicateRow(evt);
          } else if (evt.status === 'indexed' && evt.filename) {
            appendIndexedRow(evt.filename);
          } else if (evt.filename && evt.errors?.includes(evt.filename)) {
            appendErrorRow(evt.filename);
          }
        });

        if (!indexLast?.done) {
          throw new Error('El indexado no terminó correctamente.');
        }
        finishIndexPhase(indexLast);
      } catch (err) {
        console.error('[UPLOAD] Describe/Index:', err);
        toastError(err.message || 'Error en el indexado');
        setProcessing(false);
      }
    })();

    document.getElementById('close-done-btn').addEventListener('click', () => {
      currentSessionId = null;
      closeModal();
    });
  }

  document.body.style.overflow = 'hidden';
  renderPhase1();
}
