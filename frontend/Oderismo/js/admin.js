import { renderAdminUsers, adminUsersDevBanner } from './admin-users.js';
import { renderAdminPendingUsers } from './admin-pending-users.js';
import { renderAdminDescription } from './admin-description.js';
import { renderAdminImageDescription } from './admin-image-description.js';
import { renderAdminParameters } from './admin-parameters.js';

const SECTION_META = {
  users: {
    title: 'Usuarios',
    lead: 'Mantenimiento de usuarios y perfiles del sistema.',
  },
  'pending-users': {
    title: 'Altas pendientes',
    lead: 'Solicitudes de alta como Investigador pendientes de aprobación.',
  },
  dimension: {
    title: 'Dimensión',
    lead: 'Ajustes del redimensionado (new_w, new_h) antes de generar la descripción en Qdrant.',
  },
  description: {
    title: 'Descripción',
    lead: 'Edición manual del texto de cada etiqueta almacenado en Qdrant.',
  },
  parameters: {
    title: 'Parámetros',
    lead: 'Ajustes generales de la aplicación.',
  },
};

/**
 * Vista de administración (subsección elegida desde el menú superior).
 * @param {HTMLElement} container
 * @param {{ section?: string }} [options]
 */
export function renderAdmin(container, options = {}) {
  const section = SECTION_META[options.section] ? options.section : 'users';
  const meta = SECTION_META[section];
  const { initialImageId = null, initialImage = null } = options;

  container.innerHTML = `
    <div class="app-page admin-page">
      ${adminUsersDevBanner()}
      <div class="app-hero app-hero-compact">
        <div class="app-hero-text">
          <h1 class="app-page-title font-serifDisplay">${meta.title}</h1>
          <p class="app-page-lead admin-page-lead">${meta.lead}</p>
        </div>
      </div>
      <div id="admin-section-root" class="admin-section-root"></div>
    </div>
  `;

  const sectionRoot = container.querySelector('#admin-section-root');
  if (section === 'dimension') {
    renderAdminDescription(sectionRoot);
  } else if (section === 'pending-users') {
    renderAdminPendingUsers(sectionRoot);
  } else if (section === 'description') {
    const image = initialImage ?? (initialImageId != null ? { id: String(initialImageId) } : null);
    renderAdminImageDescription(sectionRoot, { initialImage: image });
  } else if (section === 'parameters') {
    renderAdminParameters(sectionRoot);
  } else {
    renderAdminUsers(sectionRoot);
  }
}
