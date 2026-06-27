import { api } from './api.js';

function pctFromScale(scale) {
  return Math.round(Number(scale) * 1000) / 10;
}

function scaleFromPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0.2;
  return Math.max(0.01, Math.min(1, n / 100));
}

function formatPreview(p) {
  if (!p) return '—';
  return `${p.source_w}×${p.source_h} px → ${p.new_w}×${p.new_h} px`;
}

/**
 * Ajustes scale_w / scale_h (new_w, new_h) del motor de descripción → Qdrant.
 * @param {HTMLElement} container
 */
export function renderAdminDescription(container) {
  let settings = null;

  container.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Dimensión</h2>
      </div>
      <p class="admin-panel-intro">
        Antes de generar la descripción con el modelo de visión, la imagen se redimensiona
        (<code>new_w</code>, <code>new_h</code> en
        <span class="admin-code-ref">feature_extractor.py</span>).
        Los valores se aplican a las <strong>nuevas</strong> etiquetas indexadas en Oderismo.
      </p>

      <form id="description-settings-form" class="admin-form admin-description-form">
        <div class="admin-desc-grid">
          <div>
            <label class="admin-label" for="desc-scale-w">Escala ancho (scale_w)</label>
            <div class="admin-scale-row">
              <input id="desc-scale-w" type="range" min="1" max="100" step="1" class="admin-scale-range" />
              <input id="desc-scale-w-pct" type="number" min="1" max="100" step="0.1" class="app-input admin-scale-pct" />
              <span class="admin-scale-unit">%</span>
            </div>
            <p class="admin-field-hint">new_w = floor(ancho × scale_w)</p>
          </div>
          <div>
            <label class="admin-label" for="desc-scale-h">Escala alto (scale_h)</label>
            <div class="admin-scale-row">
              <input id="desc-scale-h" type="range" min="1" max="100" step="1" class="admin-scale-range" />
              <input id="desc-scale-h-pct" type="number" min="1" max="100" step="0.1" class="app-input admin-scale-pct" />
              <span class="admin-scale-unit">%</span>
            </div>
            <p class="admin-field-hint">new_h = floor(alto × scale_h)</p>
          </div>
        </div>

        <div class="admin-preview-box">
          <h3 class="admin-preview-title">Vista previa del redimensionado</h3>
          <div class="admin-preview-dims">
            <label class="admin-label" for="preview-w">Ancho ejemplo</label>
            <input id="preview-w" type="number" min="1" max="20000" value="1000" class="app-input admin-preview-input" />
            <label class="admin-label" for="preview-h">Alto ejemplo</label>
            <input id="preview-h" type="number" min="1" max="20000" value="1500" class="app-input admin-preview-input" />
          </div>
          <p id="desc-preview-result" class="admin-preview-result">—</p>
          <p id="desc-example-result" class="admin-preview-muted"></p>
        </div>

        <div class="admin-form-actions">
          <button type="submit" class="app-btn app-btn-primary app-btn-sm">Guardar ajustes</button>
        </div>
        <p id="desc-settings-status" class="admin-status is-hidden"></p>
        <p id="desc-settings-error" class="admin-form-error is-hidden"></p>
      </form>
    </section>
  `;

  const form = container.querySelector('#description-settings-form');
  const scaleWRange = container.querySelector('#desc-scale-w');
  const scaleHRange = container.querySelector('#desc-scale-h');
  const scaleWPct = container.querySelector('#desc-scale-w-pct');
  const scaleHPct = container.querySelector('#desc-scale-h-pct');
  const previewW = container.querySelector('#preview-w');
  const previewH = container.querySelector('#preview-h');
  const previewResult = container.querySelector('#desc-preview-result');
  const exampleResult = container.querySelector('#desc-example-result');
  const statusEl = container.querySelector('#desc-settings-status');
  const errorEl = container.querySelector('#desc-settings-error');

  function bindScalePair(rangeEl, pctEl) {
    const syncFromRange = () => {
      pctEl.value = rangeEl.value;
      updateLocalPreview();
    };
    const syncFromPct = () => {
      const v = Math.max(1, Math.min(100, Number(pctEl.value) || 1));
      rangeEl.value = String(Math.round(v));
      pctEl.value = rangeEl.value;
      updateLocalPreview();
    };
    rangeEl.addEventListener('input', syncFromRange);
    pctEl.addEventListener('change', syncFromPct);
    pctEl.addEventListener('input', () => {
      if (pctEl.value !== '') updateLocalPreview();
    });
  }

  function currentScales() {
    return {
      scale_w: scaleFromPct(scaleWPct.value),
      scale_h: scaleFromPct(scaleHPct.value),
    };
  }

  function updateLocalPreview() {
    const w = Math.max(1, parseInt(previewW.value, 10) || 1);
    const h = Math.max(1, parseInt(previewH.value, 10) || 1);
    const { scale_w, scale_h } = currentScales();
    const new_w = Math.max(1, Math.floor(w * scale_w));
    const new_h = Math.max(1, Math.floor(h * scale_h));
    previewResult.textContent = formatPreview({
      source_w: w,
      source_h: h,
      new_w,
      new_h,
    });
  }

  function applySettingsToForm(data) {
    settings = data;
    const sw = data?.scale_w ?? 0.2;
    const sh = data?.scale_h ?? 0.2;
    scaleWPct.value = pctFromScale(sw);
    scaleHPct.value = pctFromScale(sh);
    scaleWRange.value = String(Math.round(pctFromScale(sw)));
    scaleHRange.value = String(Math.round(pctFromScale(sh)));
    if (data?.preview_example) {
      exampleResult.textContent = `Referencia 1000×1500 px: ${formatPreview(data.preview_example)}`;
    }
    updateLocalPreview();
  }

  function showStatus(msg, ok = true) {
    statusEl.textContent = msg;
    statusEl.classList.remove('is-hidden', 'admin-status-ok', 'admin-status-err');
    statusEl.classList.add(ok ? 'admin-status-ok' : 'admin-status-err');
  }

  bindScalePair(scaleWRange, scaleWPct);
  bindScalePair(scaleHRange, scaleHPct);
  previewW.addEventListener('input', updateLocalPreview);
  previewH.addEventListener('input', updateLocalPreview);

  async function loadSettings() {
    errorEl.classList.add('is-hidden');
    try {
      const data = await api.getDescriptionSettings();
      applySettingsToForm(data);
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudieron cargar los ajustes del motor';
      errorEl.classList.remove('is-hidden');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('is-hidden');
    statusEl.classList.add('is-hidden');
    const { scale_w, scale_h } = currentScales();
    try {
      const data = await api.updateDescriptionSettings({ scale_w, scale_h });
      applySettingsToForm(data);
      showStatus('Ajustes guardados. Se aplicarán a las próximas descripciones generadas.');
    } catch (err) {
      errorEl.textContent = err.message || 'Error al guardar';
      errorEl.classList.remove('is-hidden');
    }
  });

  loadSettings();
}
