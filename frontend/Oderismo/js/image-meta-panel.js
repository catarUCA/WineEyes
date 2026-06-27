import { api, getUser } from './api.js';
import { escapeHtml } from './nav.js';
import { createTagsInput } from './tags-input.js';
import { randomLabelColor } from './tag-text-utils.js';
import { createRichNoteEditor } from './rich-note-editor.js';
import { confirmDialog, toastError } from './toast.js';

const ANNOTATE_ROLES = ['ADMIN', 'RESEARCHER', 'PUBLISHER'];
const COLLECTION_NOTE_ROLES = ['ADMIN', 'PUBLISHER'];

export function canAnnotateImages(roles = []) {
  return roles.some((r) => ANNOTATE_ROLES.includes(r));
}

export function canEditCollectionNotes(roles = []) {
  return roles.some((r) => COLLECTION_NOTE_ROLES.includes(r));
}

/** Bloque HTML del panel de etiquetas/notas en el modal de imagen (Explorar). */
export function shotModalMetaHtml(options = {}) {
  const tagsTitle = options.tagsTitle || 'Etiquetas';
  const noteTitle = options.noteTitle || 'Nota';
  const showCollectionNote = options.showCollectionNote === true;
  const ariaLabel = options.ariaLabel || (showCollectionNote
    ? 'Etiquetas, nota privada y nota de catálogo'
    : 'Etiquetas y notas');
  const collectionSection = showCollectionNote ? `
        <section class="shot-modal-meta-section shot-modal-note-section shot-modal-collection-note-section">
          <div class="shot-modal-note-head">
            <h3 class="shot-modal-meta-title">Nota de catálogo</h3>
            <span id="shot-modal-collection-note-status" class="shot-modal-note-status"></span>
          </div>
          <p class="shot-modal-note-scope">Visible para visitantes al ver esta imagen en un catálogo.</p>
          <div id="shot-modal-collection-note-editor" class="shot-modal-note-editor-mount"></div>
          <div class="shot-modal-note-actions">
            <button type="button" id="shot-modal-collection-note-clear" class="shot-modal-note-clear">Borrar nota de catálogo</button>
          </div>
        </section>` : '';
  return `
    <aside class="shot-modal-meta is-hidden" id="shot-modal-meta" aria-label="${ariaLabel}">
      <div class="shot-modal-meta-inner">
        <section class="shot-modal-meta-section">
          <h3 class="shot-modal-meta-title">${tagsTitle}</h3>
          <div id="shot-modal-tags" class="shot-modal-tags-root"></div>
        </section>
        <section class="shot-modal-meta-section shot-modal-note-section">
          <div class="shot-modal-note-head">
            <h3 class="shot-modal-meta-title">${noteTitle}</h3>
            <span id="shot-modal-note-status" class="shot-modal-note-status"></span>
          </div>
          <div id="shot-modal-note-editor" class="shot-modal-note-editor-mount"></div>
          <div class="shot-modal-note-actions">
            <button type="button" id="shot-modal-note-clear" class="shot-modal-note-clear">Borrar nota</button>
          </div>
        </section>${collectionSection}
      </div>
    </aside>
  `;
}

/**
 * Enlaza carga/guardado de etiquetas y notas al abrir una imagen en el modal de Explorar.
 * @param {HTMLElement} modalEl — contenedor .shot-modal
 * @param {{ roles?: string[], canEditCollection?: boolean, getImageId: () => number | null }} options
 */
export function bindImageMetaPanel(modalEl, options = {}) {
  const roles = options.roles ?? getUser()?.roles ?? [];
  if (!canAnnotateImages(roles)) return null;

  const metaPanel = modalEl.querySelector('#shot-modal-meta');
  const tagsRoot = modalEl.querySelector('#shot-modal-tags');
  const noteMount = modalEl.querySelector('#shot-modal-note-editor');
  const noteStatus = modalEl.querySelector('#shot-modal-note-status');
  const noteClearBtn = modalEl.querySelector('#shot-modal-note-clear');
  const collectionNoteMount = modalEl.querySelector('#shot-modal-collection-note-editor');
  const collectionNoteStatus = modalEl.querySelector('#shot-modal-collection-note-status');
  const collectionNoteClearBtn = modalEl.querySelector('#shot-modal-collection-note-clear');

  if (!metaPanel || !tagsRoot || !noteMount) return null;

  const manageCollectionNotes = options.canEditCollection === true
    && canEditCollectionNotes(roles)
    && collectionNoteMount;

  const modalCard = modalEl.querySelector('.shot-modal-card');
  let tagsEditor = null;
  let noteEditor = null;
  let collectionNoteEditor = null;
  let loadToken = 0;

  function setNoteStatus(text, kind = '') {
    if (!noteStatus) return;
    noteStatus.textContent = text;
    noteStatus.className = 'shot-modal-note-status' + (kind ? ` is-${kind}` : '');
  }

  function setCollectionNoteStatus(text, kind = '') {
    if (!collectionNoteStatus) return;
    collectionNoteStatus.textContent = text;
    collectionNoteStatus.className = 'shot-modal-note-status' + (kind ? ` is-${kind}` : '');
  }

  async function initNoteEditor() {
    if (noteEditor) return noteEditor;
    noteEditor = await createRichNoteEditor(noteMount, {
      placeholder: 'Escribe tu nota sobre esta imagen…',
      onSave: async (html) => {
        const imageId = options.getImageId?.();
        if (!imageId) return;
        setNoteStatus('Guardando…', 'saving');
        try {
          const data = await api.saveImageNote(imageId, html);
          if (data.note?.updated_at) {
            setNoteStatus(`Guardado ${formatNoteDate(data.note.updated_at)}`, 'saved');
          } else {
            setNoteStatus('', '');
          }
        } catch (err) {
          setNoteStatus('Error al guardar', 'error');
          toastError(err.message || 'No se pudo guardar la nota');
          throw err;
        }
      },
    });
    return noteEditor;
  }

  async function initCollectionNoteEditor() {
    if (collectionNoteEditor) return collectionNoteEditor;
    collectionNoteEditor = await createRichNoteEditor(collectionNoteMount, {
      placeholder: 'Indicaciones para visitantes al ver esta imagen en un catálogo…',
      debounceMs: 900,
      onSave: async (html) => {
        const imageId = options.getImageId?.();
        if (!imageId) return;
        setCollectionNoteStatus('Guardando…', 'saving');
        try {
          const res = await api.saveImageCollectionNote(imageId, html);
          const u = res.note?.updated_at || '';
          setCollectionNoteStatus(u ? `Guardado ${formatNoteDate(u)}` : '', u ? 'saved' : '');
          return res;
        } catch (err) {
          setCollectionNoteStatus('Error al guardar', 'error');
          toastError(err.message || 'No se pudo guardar la nota de catálogo');
          throw err;
        }
      },
    });
    return collectionNoteEditor;
  }

  tagsEditor = createTagsInput(tagsRoot, {
    placeholder: 'Escribe y pulsa Enter…',
    fetchSuggestions: (q) => api.searchLabels(q).then((d) => d.labels || []),
    onCreateTag: (name) => api.createLabel(name, randomLabelColor()).then((d) => d.label),
    onChange: async (tags) => {
      const imageId = options.getImageId?.();
      if (!imageId) throw new Error('Imagen no disponible');
      const data = await api.setImageLabels(
        imageId,
        tags.map((t) => t.id),
      );
      tagsEditor.setTags(data.labels || tags);
    },
  });

  collectionNoteClearBtn?.addEventListener('click', async () => {
    const imageId = options.getImageId?.();
    if (!imageId) return;
    if (!await confirmDialog('¿Borrar la nota pública de catálogo de esta imagen?', {
      title: 'Eliminar nota de catálogo',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
    })) return;
    try {
      await api.deleteImageCollectionNote(imageId);
      collectionNoteEditor?.setHtml('');
      setCollectionNoteStatus('', '');
    } catch (err) {
      toastError(err.message || 'No se pudo borrar la nota de catálogo');
    }
  });

  async function loadForImage(imageId) {
    if (!imageId) {
      metaPanel.classList.add('is-hidden');
      modalCard?.classList.remove('shot-modal-card--meta');
      return;
    }
    metaPanel.classList.remove('is-hidden');
    modalCard?.classList.add('shot-modal-card--meta');

    const token = ++loadToken;
    setNoteStatus('Cargando…', 'saving');
    if (manageCollectionNotes) {
      setCollectionNoteStatus('Cargando…', 'saving');
    }
    metaPanel.querySelectorAll('.shot-modal-meta-error').forEach((el) => el.remove());
    try {
      const editors = [initNoteEditor()];
      if (manageCollectionNotes) {
        editors.push(initCollectionNoteEditor());
      }
      const [data, editor, collectionEditor] = await Promise.all([
        api.getImageMeta(imageId),
        ...editors,
      ]);
      if (token !== loadToken) return;
      tagsEditor.setTags(data.labels || []);
      try {
        const catalog = await api.searchLabels('');
        tagsEditor.setCatalog?.(catalog.labels || []);
        await tagsEditor.preloadCatalog?.();
      } catch {
        /* catálogo opcional para fuzzy local */
      }
      editor.setHtml(data.note?.body || '');
      if (data.note?.updated_at) {
        setNoteStatus(`Actualizada ${formatNoteDate(data.note.updated_at)}`, 'saved');
      } else {
        setNoteStatus('Se guarda automáticamente al editar', '');
      }
      if (manageCollectionNotes && collectionEditor) {
        const cNote = data.collection_note;
        collectionEditor.setHtml(cNote?.body || '');
        const cu = cNote?.updated_at || '';
        setCollectionNoteStatus(
          cu ? `Actualizada ${formatNoteDate(cu)}` : 'Se guarda automáticamente al editar',
          cu ? 'saved' : '',
        );
      }
    } catch (err) {
      if (token !== loadToken) return;
      tagsEditor.setTags([]);
      noteEditor?.setHtml('');
      collectionNoteEditor?.setHtml('');
      setNoteStatus('', '');
      setCollectionNoteStatus('', '');
      tagsRoot.insertAdjacentHTML(
        'afterend',
        `<p class="shot-modal-meta-error">${escapeHtml(err.message || 'Error cargando metadatos')}</p>`,
      );
    }
  }

  noteClearBtn?.addEventListener('click', async () => {
    const imageId = options.getImageId?.();
    if (!imageId) return;
    if (!await confirmDialog('¿Eliminar esta nota?', {
      title: 'Eliminar nota',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
    })) return;
    try {
      await api.deleteImageNote(imageId);
      noteEditor?.setHtml('');
      setNoteStatus('', '');
    } catch (err) {
      toastError(err.message || 'No se pudo borrar la nota');
    }
  });

  return {
    loadForImage,
    async flushNote() {
      await Promise.all([
        noteEditor?.saveNow?.(),
        collectionNoteEditor?.saveNow?.(),
      ]);
    },
    reset() {
      loadToken += 1;
      metaPanel.classList.add('is-hidden');
      modalCard?.classList.remove('shot-modal-card--meta');
      tagsEditor?.setTags([]);
      noteEditor?.setHtml('');
      setNoteStatus('', '');
      collectionNoteEditor?.setHtml('');
      setCollectionNoteStatus('', '');
      modalEl.querySelectorAll('.shot-modal-meta-error').forEach((el) => el.remove());
    },
    destroy() {
      tagsEditor?.destroy();
      noteEditor?.destroy();
      collectionNoteEditor?.destroy();
      tagsEditor = null;
      noteEditor = null;
      collectionNoteEditor = null;
    },
  };
}

function formatNoteDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T'));
    return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
