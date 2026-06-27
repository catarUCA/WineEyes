import { api } from './api.js';
import { clearSessionConfigCache, startSessionWatchdog } from './session-timeout.js';

/**
 * Parámetros globales (tabla `parameters`: session, session_close, time_label).
 * @param {HTMLElement} container
 */
export function renderAdminParameters(container) {
  container.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Sesión</h2>
      </div>
      <p class="admin-panel-intro">
        Valores guardados en la tabla <code>parameters</code>.
        Se aplican a <strong>nuevos inicios de sesión</strong> y a las renovaciones con «Mantener sesión abierta».
      </p>

      <form id="session-params-form" class="admin-form admin-parameters-form">
        <div>
          <label class="admin-label" for="session-minutes">Duración de la sesión (minutos)</label>
          <input id="session-minutes" type="number" min="1" max="1440" step="1" class="app-input" required />
          <p class="admin-field-hint">Campo <code>session</code>. Entre 1 y 1440 minutos. Por defecto: 10.</p>
        </div>
        <div>
          <label class="admin-label" for="session-close-minutes">Aviso antes del cierre (minutos)</label>
          <input id="session-close-minutes" type="number" min="0" max="1439" step="1" class="app-input" required />
          <p class="admin-field-hint">Campo <code>session_close</code>. Debe ser menor que la duración total. Por defecto: 1.</p>
        </div>
        <p id="session-params-error" class="admin-form-error is-hidden"></p>
      </form>
    </section>

    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Portada</h2>
      </div>
      <p class="admin-panel-intro">
        Intervalos de rotación de etiquetas en la portada (tabla <code>parameters</code>, en segundos).
      </p>

      <form id="screensaver-params-form" class="admin-form admin-parameters-form">
        <div>
          <label class="admin-label" for="time-index-seconds">Cuadro expositor</label>
          <input id="time-index-seconds" type="number" min="2" max="600" step="1" class="app-input" required />
          <p class="admin-field-hint">Campo <code>time_index</code>. Marco de etiquetas en la página principal. Por defecto: 30.</p>
        </div>
        <div>
          <label class="admin-label" for="time-label-seconds">Salvapantallas</label>
          <input id="time-label-seconds" type="number" min="2" max="600" step="1" class="app-input" required />
          <p class="admin-field-hint">Campo <code>time_label</code>. Modo a pantalla completa. Por defecto: 10.</p>
        </div>
        <div class="admin-form-actions">
          <button type="submit" id="params-save" class="app-btn app-btn-primary app-btn-sm admin-desc-save-btn" aria-label="Guardar parámetros">
            <span class="admin-desc-save-label">Guardar parámetros</span>
            <span class="explore-search-submit-spinner animate-spin is-hidden" aria-hidden="true"></span>
          </button>
        </div>
        <p id="screensaver-params-error" class="admin-form-error is-hidden"></p>
      </form>
    </section>
  `;

  const sessionForm = container.querySelector('#session-params-form');
  const screensaverForm = container.querySelector('#screensaver-params-form');
  const sessionInput = container.querySelector('#session-minutes');
  const sessionCloseInput = container.querySelector('#session-close-minutes');
  const timeLabelInput = container.querySelector('#time-label-seconds');
  const timeIndexInput = container.querySelector('#time-index-seconds');
  const saveBtn = container.querySelector('#params-save');
  const saveLabel = saveBtn?.querySelector('.admin-desc-save-label');
  const saveSpinner = saveBtn?.querySelector('.explore-search-submit-spinner');
  const sessionErrorEl = container.querySelector('#session-params-error');
  const screensaverErrorEl = container.querySelector('#screensaver-params-error');

  function setSaveLoading(on) {
    saveBtn?.classList.toggle('is-loading', on);
    saveLabel?.classList.toggle('is-hidden', on);
    saveSpinner?.classList.toggle('is-hidden', !on);
    if (saveBtn) saveBtn.disabled = on;
    sessionInput.disabled = on;
    sessionCloseInput.disabled = on;
    timeLabelInput.disabled = on;
    timeIndexInput.disabled = on;
  }

  function applyToForm(data) {
    const mins = Number(data?.session ?? 10);
    const closeMins = Number(
      data?.session_close ?? (data?.session_warning_before_seconds != null
        ? data.session_warning_before_seconds / 60
        : 1)
    );
    const timeLabel = Number(data?.time_label ?? 10);
    const timeIndex = Number(data?.time_index ?? 30);
    sessionInput.value = String(Math.max(1, Math.round(mins)));
    sessionCloseInput.value = String(Math.max(0, Math.round(closeMins)));
    sessionCloseInput.max = String(Math.max(0, Math.round(mins) - 1));
    timeLabelInput.value = String(Math.max(2, Math.min(600, Math.round(timeLabel))));
    timeIndexInput.value = String(Math.max(2, Math.min(600, Math.round(timeIndex))));
  }

  async function loadSettings() {
    sessionErrorEl.classList.add('is-hidden');
    screensaverErrorEl.classList.add('is-hidden');
    try {
      const data = await api.getParameters();
      applyToForm(data);
    } catch (err) {
      sessionErrorEl.textContent = err.message || 'No se pudieron cargar los parámetros';
      sessionErrorEl.classList.remove('is-hidden');
    }
  }

  sessionInput.addEventListener('input', () => {
    const mins = Number(sessionInput.value);
    if (Number.isFinite(mins) && mins > 0) {
      sessionCloseInput.max = String(mins - 1);
      if (Number(sessionCloseInput.value) >= mins) {
        sessionCloseInput.value = String(Math.max(0, mins - 1));
      }
    }
  });

  screensaverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    sessionErrorEl.classList.add('is-hidden');
    screensaverErrorEl.classList.add('is-hidden');

    const sessionMin = Number(sessionInput.value);
    const sessionCloseMin = Number(sessionCloseInput.value);
    const timeLabelSec = Number(timeLabelInput.value);
    const timeIndexSec = Number(timeIndexInput.value);

    if (!Number.isFinite(sessionMin) || sessionMin < 1 || sessionMin > 1440) {
      sessionErrorEl.textContent = 'La duración debe estar entre 1 y 1440 minutos.';
      sessionErrorEl.classList.remove('is-hidden');
      return;
    }
    if (!Number.isFinite(sessionCloseMin) || sessionCloseMin < 0 || sessionCloseMin >= sessionMin) {
      sessionErrorEl.textContent = 'El aviso debe ser >= 0 y menor que la duración de la sesión.';
      sessionErrorEl.classList.remove('is-hidden');
      return;
    }
    if (!Number.isFinite(timeLabelSec) || timeLabelSec < 2 || timeLabelSec > 600) {
      screensaverErrorEl.textContent = 'El intervalo del salvapantallas debe estar entre 2 y 600 segundos.';
      screensaverErrorEl.classList.remove('is-hidden');
      return;
    }
    if (!Number.isFinite(timeIndexSec) || timeIndexSec < 2 || timeIndexSec > 600) {
      screensaverErrorEl.textContent = 'El intervalo del cuadro expositor debe estar entre 2 y 600 segundos.';
      screensaverErrorEl.classList.remove('is-hidden');
      return;
    }

    setSaveLoading(true);
    try {
      const data = await api.updateParameters({
        session: sessionMin,
        session_close: sessionCloseMin,
        time_label: timeLabelSec,
        time_index: timeIndexSec,
      });
      applyToForm(data);
      clearSessionConfigCache();
      await startSessionWatchdog();
    } catch (err) {
      screensaverErrorEl.textContent = err.message || 'Error al guardar';
      screensaverErrorEl.classList.remove('is-hidden');
    } finally {
      setSaveLoading(false);
    }
  });

  sessionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    screensaverForm.requestSubmit();
  });

  loadSettings();
}
