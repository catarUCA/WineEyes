import { api } from './api.js';
import { confirmDialog, toastError } from './toast.js';
import { escapeHtml } from './nav.js';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function requestRowHtml(request) {
  return `
    <tr data-request-id="${request.id}">
      <td>${escapeHtml(request.email)}</td>
      <td>${escapeHtml(request.full_name || '—')}</td>
      <td class="admin-request-description">${escapeHtml(request.description || '—')}</td>
      <td>${escapeHtml(formatDate(request.created_at))}</td>
      <td class="admin-table-actions">
        <button type="button" class="approve-request-btn app-btn app-btn-primary app-btn-sm" data-id="${request.id}">
          Aprobar
        </button>
      </td>
    </tr>`;
}

/**
 * Solicitudes pendientes de alta como investigador.
 * @param {HTMLElement} container
 */
export function renderAdminPendingUsers(container) {
  container.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Altas pendientes</h2>
      </div>
      <p class="admin-panel-intro">
        Solicitudes para obtener el perfil Investigador. Al aprobar una solicitud se activa la cuenta,
        se asigna el perfil Investigador y se genera el enlace para establecer contraseña.
      </p>
      <div id="pending-activation-result" class="app-banner app-banner-warn is-hidden"></div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre y apellidos</th>
              <th>Motivación</th>
              <th>Solicitud</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="pending-users-table">
            <tr><td colspan="5" class="admin-table-muted">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  const tbody = container.querySelector('#pending-users-table');
  const resultEl = container.querySelector('#pending-activation-result');

  function showActivationResult(data) {
    if (!resultEl) return;
    const link = data?.activation_url || '';
    resultEl.innerHTML = `
      <strong>${escapeHtml(data?.message || 'Solicitud aprobada.')}</strong>
      ${link ? `<br><a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>` : ''}
    `;
    resultEl.classList.remove('is-hidden');
  }

  async function loadRequests({ keepResult = false } = {}) {
    if (!keepResult) resultEl?.classList.add('is-hidden');
    try {
      const data = await api.getResearcherRequests();
      const requests = data.requests ?? [];
      if (!requests.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="admin-table-muted">No hay altas pendientes.</td></tr>`;
        return;
      }

      tbody.innerHTML = requests.map(requestRowHtml).join('');
      const byId = Object.fromEntries(requests.map((request) => [String(request.id), request]));
      tbody.querySelectorAll('.approve-request-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const request = byId[btn.dataset.id];
          if (!request) return;
          if (!await confirmDialog(`¿Aprobar el alta de ${request.email}?`, {
            title: 'Aprobar alta',
            confirmLabel: 'Aprobar',
            cancelLabel: 'Cancelar',
          })) return;

          btn.disabled = true;
          try {
            const approved = await api.approveResearcherRequest(request.id);
            showActivationResult(approved);
            await loadRequests({ keepResult: true });
          } catch (err) {
            btn.disabled = false;
            toastError(err.message || 'No se pudo aprobar la solicitud');
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="admin-table-error">${escapeHtml(err.message || 'Error cargando altas pendientes')}</td></tr>`;
    }
  }

  loadRequests();
}
