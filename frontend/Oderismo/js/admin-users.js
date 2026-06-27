import { api, isDevAdminSession } from './api.js';
import { confirmDialog, toastError } from './toast.js';

const ROLE_LABELS = {
  ADMIN: 'Admin',
  RESEARCHER: 'Investigador',
  UPLOADER: 'Subidor',
  PUBLISHER: 'Editor',
  USER: 'Usuario',
};

function rolesFieldHtml(prefix, roles = [], available = []) {
  const codes = available.length
    ? available.map((r) => r.code)
    : Object.keys(ROLE_LABELS);
  return codes
    .map((code) => {
      const checked = roles.includes(code) ? 'checked' : '';
      const label = ROLE_LABELS[code] || code;
      return `
        <label class="admin-role-chip">
          <input type="checkbox" name="${prefix}-roles" value="${code}" ${checked} />
          <span>${label}</span>
        </label>`;
    })
    .join('');
}

function readRolesFromForm(container, prefix) {
  return [...container.querySelectorAll(`input[name="${prefix}-roles"]:checked`)].map(
    (el) => el.value
  );
}

/**
 * Mantenimiento de usuarios (MySQL vía API PHP).
 * @param {HTMLElement} container
 */
export function renderAdminUsers(container) {
  let availableRoles = [];
  let editingUserId = null;

  container.innerHTML = `
    <section class="admin-panel">
      <div class="admin-panel-head">
        <h2 class="admin-panel-title">Usuarios</h2>
        <button type="button" id="add-user-btn" class="app-btn app-btn-primary app-btn-sm">+ Nuevo usuario</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Perfiles</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="users-table">
            <tr><td colspan="5" class="admin-table-muted">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div id="user-modal" class="app-modal is-hidden" role="dialog" aria-modal="true">
      <div class="app-modal-card admin-modal-card">
        <h3 id="user-modal-title" class="app-modal-title">Nuevo usuario</h3>
        <form id="user-form" class="admin-form">
          <label class="admin-label" for="user-email">Email</label>
          <input id="user-email" type="email" required class="app-input" autocomplete="off" />

          <label class="admin-label" for="user-full-name">Nombre (opcional)</label>
          <input id="user-full-name" type="text" class="app-input" autocomplete="off" />

          <label class="admin-label" for="user-password">Contraseña</label>
          <input id="user-password" type="password" class="app-input" autocomplete="new-password"
            placeholder="Vacío = cuenta pendiente de activación" />

          <fieldset class="admin-roles-fieldset">
            <legend class="admin-label">Perfiles</legend>
            <div id="user-roles-fields" class="admin-roles-grid"></div>
          </fieldset>

          <label id="user-active-row" class="admin-active-row is-hidden">
            <input id="user-active" type="checkbox" checked />
            <span>Cuenta activa</span>
          </label>

          <div class="admin-form-actions">
            <button type="button" id="cancel-user-btn" class="app-btn app-btn-ghost app-btn-sm">Cancelar</button>
            <button type="submit" class="app-btn app-btn-primary app-btn-sm">Guardar</button>
          </div>
          <p id="user-error" class="admin-form-error is-hidden"></p>
        </form>
      </div>
    </div>
  `;

  const userModal = container.querySelector('#user-modal');
  const userModalTitle = container.querySelector('#user-modal-title');
  const rolesFields = container.querySelector('#user-roles-fields');
  const emailInput = container.querySelector('#user-email');
  const activeRow = container.querySelector('#user-active-row');
  const activeInput = container.querySelector('#user-active');

  function openModal(mode, user = null) {
    editingUserId = mode === 'edit' ? user.id : null;
    userModalTitle.textContent = mode === 'edit' ? 'Editar usuario' : 'Nuevo usuario';
    emailInput.value = user?.email ?? '';
    emailInput.disabled = mode === 'edit';
    container.querySelector('#user-full-name').value = user?.full_name ?? '';
    container.querySelector('#user-password').value = '';
    container.querySelector('#user-password').required = false;
    rolesFields.innerHTML = rolesFieldHtml('user', user?.roles ?? ['USER'], availableRoles);
    activeRow.classList.toggle('is-hidden', mode !== 'edit');
    if (mode === 'edit') activeInput.checked = user?.is_active !== false;
    container.querySelector('#user-error').classList.add('is-hidden');
    userModal.classList.remove('is-hidden');
  }

  function closeModal() {
    userModal.classList.add('is-hidden');
    editingUserId = null;
    emailInput.disabled = false;
  }

  function renderRoleBadges(roles) {
    if (!roles?.length) return '<span class="admin-table-muted">—</span>';
    return roles
      .map((code) => `<span class="admin-role-badge">${ROLE_LABELS[code] || code}</span>`)
      .join('');
  }

  async function loadUsers() {
    const tbody = container.querySelector('#users-table');
    try {
      const data = await api.getUsers();
      availableRoles = data.available_roles ?? [];
      const users = data.users ?? [];
      if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="admin-table-muted">No hay usuarios registrados.</td></tr>`;
        return;
      }
      tbody.innerHTML = users
        .map(
          (u) => `
        <tr data-user-id="${u.id}">
          <td>${u.email}</td>
          <td>${u.full_name || '—'}</td>
          <td><div class="admin-role-badges">${renderRoleBadges(u.roles)}</div></td>
          <td>
            <span class="admin-status-pill ${u.is_active ? 'is-on' : 'is-off'}">
              ${u.is_active ? 'Activo' : 'Inactivo'}
            </span>
          </td>
          <td class="admin-table-actions">
            <button type="button" class="edit-user-btn app-btn app-btn-ghost app-btn-sm" data-id="${u.id}">Editar</button>
            <button type="button" class="delete-user-btn app-btn app-btn-ghost app-btn-sm">Eliminar</button>
          </td>
        </tr>`
        )
        .join('');

      const byId = Object.fromEntries(users.map((u) => [String(u.id), u]));

      tbody.querySelectorAll('.edit-user-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const u = byId[btn.dataset.id];
          if (u) openModal('edit', u);
        });
      });

      tbody.querySelectorAll('.delete-user-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const id = row?.dataset.userId;
          const u = byId[id];
          if (!u) return;
          if (!await confirmDialog(`¿Eliminar a ${u.email}?`, {
            title: 'Eliminar usuario',
            confirmLabel: 'Eliminar',
            cancelLabel: 'Cancelar',
            danger: true,
          })) return;
          try {
            await api.deleteUser(id);
            loadUsers();
          } catch (err) {
            toastError(err.message || 'No se pudo eliminar');
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="admin-table-error">${err.message || 'Error cargando usuarios'}</td></tr>`;
    }
  }

  container.querySelector('#add-user-btn').addEventListener('click', () => openModal('create'));
  container.querySelector('#cancel-user-btn').addEventListener('click', closeModal);
  userModal.addEventListener('click', (e) => {
    if (e.target === userModal) closeModal();
  });

  container.querySelector('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = container.querySelector('#user-error');
    errEl.classList.add('is-hidden');
    const roles = readRolesFromForm(container, 'user');
    if (!roles.length) {
      errEl.textContent = 'Selecciona al menos un perfil.';
      errEl.classList.remove('is-hidden');
      return;
    }
    try {
      const fullName = container.querySelector('#user-full-name').value.trim();
      const password = container.querySelector('#user-password').value;
      if (editingUserId) {
        await api.updateUser(editingUserId, {
          roles,
          full_name: fullName,
          is_active: activeInput.checked,
          ...(password ? { password } : {}),
        });
      } else {
        await api.createUser(emailInput.value.trim(), password, roles, fullName);
      }
      closeModal();
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message || 'Error al guardar';
      errEl.classList.remove('is-hidden');
    }
  });

  loadUsers();
}

export function adminUsersDevBanner() {
  return isDevAdminSession()
    ? `<div class="app-banner app-banner-warn">Modo prueba: sesión admin local. El mantenimiento de usuarios requiere el API PHP en el servidor.</div>`
    : '';
}
