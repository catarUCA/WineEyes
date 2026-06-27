import { renderUploadModal } from './upload.js';

export function renderUploadPage(container) {
  container.innerHTML = `
    <div class="app-page upload-page">
      <div class="app-hero app-hero-compact">
        <div class="app-hero-text">
          <h1 class="app-page-title font-serifDisplay">Subir</h1>
          <p class="app-page-lead">Añade nuevas etiquetas al archivo.</p>
        </div>
      </div>

      <section class="upload-panel-card" aria-labelledby="upload-panel-title">
        <h2 id="upload-panel-title" class="upload-section-title">Subida por lotes</h2>
        <p class="upload-section-desc">Recorte, OCR, descripción e indexación con detección de duplicados.</p>
        <div id="upload-inline-mount" class="upload-inline-mount"></div>
      </section>
    </div>
  `;

  const inlineMount = container.querySelector('#upload-inline-mount');

  function openUploadFlow(files) {
    renderUploadModal(null, files?.length ? Array.from(files) : null);
  }

  inlineMount.innerHTML = `
    <div class="upload-inline-drop" id="upload-inline-drop">
      <p class="upload-inline-drop-title">Arrastra imágenes aquí</p>
      <p class="upload-inline-drop-hint">o haz clic para elegir archivos y abrir el asistente</p>
      <input type="file" id="upload-inline-file" multiple accept="image/*" class="is-hidden" />
    </div>
  `;
  const drop = inlineMount.querySelector('#upload-inline-drop');
  const fileInput = inlineMount.querySelector('#upload-inline-file');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    if (e.dataTransfer.files?.length) openUploadFlow(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) {
      openUploadFlow(fileInput.files);
      fileInput.value = '';
    }
  });
}
