/**
 * Menú superior (orden fijo) y visibilidad por roles.
 *
 * | Vista          | id        | Roles / acceso                          |
 * |----------------|-----------|-----------------------------------------|
 * | Explorar       | explore   | USER+ (no visible para invitados)                 |
 * | Etiquetas      | labels    | RESEARCHER                              |
 * | Catálogos      | catalogs  | Invitado, USER, ADMIN, PUBLISHER (no UPLOADER)      |
 * | Subir          | upload    | UPLOADER                                |
 * | Administración | admin     | ADMIN (completo); UPLOADER «Altas pendientes» y «Descripción» |
 */
const NAV_CATALOG = [
  { id: 'explore', label: 'Explorar', minRole: 'USER' },
  { id: 'catalogs', label: 'Catálogos', guestLabel: 'Colecciones', guest: true },
  { id: 'labels', label: 'Etiquetas', roles: ['RESEARCHER'] },
  { id: 'upload', label: 'Subir', roles: ['UPLOADER'] },
  { id: 'admin', label: 'Administración', roles: ['ADMIN', 'UPLOADER'] },
];

/** Subsecciones del menú Administración (barra superior). */
export const ADMIN_SECTIONS = [
  { id: 'users', label: 'Usuarios' },
  { id: 'pending-users', label: 'Altas pendientes' },
  { id: 'dimension', label: 'Dimensión' },
  { id: 'description', label: 'Descripción' },
  { id: 'parameters', label: 'Parámetros' },
];

const ROLE_RANK = {
  USER: 1,
  PUBLISHER: 2,
  UPLOADER: 3,
  RESEARCHER: 4,
  ADMIN: 5,
};

function hasMinRole(roles, minCode) {
  const need = ROLE_RANK[minCode] ?? 99;
  return roles.some((r) => (ROLE_RANK[r] ?? 0) >= need);
}

/** Menú Administración visible para ADMIN y UPLOADER. */
export function canSeeAdminNav(roles) {
  return roles.includes('ADMIN') || roles.includes('UPLOADER');
}

/** Subsecciones visibles según rol. */
export function getAdminSections(roles = []) {
  if (roles.includes('ADMIN')) return ADMIN_SECTIONS;
  if (roles.includes('UPLOADER')) {
    return ADMIN_SECTIONS.filter((s) => ['pending-users', 'description'].includes(s.id));
  }
  return [];
}

/** Sección admin por defecto al entrar en la vista. */
export function defaultAdminSection(roles = []) {
  if (roles.includes('ADMIN')) return 'users';
  if (roles.includes('UPLOADER')) return 'pending-users';
  return 'users';
}

/**
 * Resuelve la subsección admin permitida.
 * @returns {string|null}
 */
export function resolveAdminSection(roles = [], requestedSection) {
  if (!canSeeAdminNav(roles)) return null;
  if (roles.includes('ADMIN')) {
    return ADMIN_SECTIONS.some((s) => s.id === requestedSection) ? requestedSection : 'users';
  }
  const uploaderSections = getAdminSections(roles);
  return uploaderSections.some((s) => s.id === requestedSection) ? requestedSection : 'pending-users';
}

/** Catálogos: invitados, USER, ADMIN y PUBLISHER; excluye UPLOADER. */
export function canSeeCatalogsNav(roles) {
  if (roles.includes('ADMIN') || roles.includes('PUBLISHER')) return true;
  if (roles.includes('UPLOADER')) return false;
  return roles.includes('USER');
}

export function getNavItems(roles = [], guest = false) {
  if (guest) {
    return NAV_CATALOG.filter((item) => item.guest).map((item) => ({
      ...item,
      label: item.guestLabel || item.label,
    }));
  }
  return NAV_CATALOG.filter((item) => {
    if (item.id === 'catalogs') return canSeeCatalogsNav(roles);
    if (item.minRole) return hasMinRole(roles, item.minRole);
    if (!item.roles) return true;
    return item.roles.some((code) => roles.includes(code));
  });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function displayUserName(user) {
  const name = user?.full_name?.trim();
  if (name) return name;
  const email = user?.email?.trim() || '';
  if (!email) return 'Usuario';
  return email.split('@')[0];
}

export function userInitials(user) {
  const name = user?.full_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return name.charAt(0).toUpperCase();
  }
  const email = user?.email?.trim() || '';
  return email ? email.charAt(0).toUpperCase() : '?';
}

export function roleLabel(roles) {
  if (!roles?.length) return 'Invitado';
  const map = {
    ADMIN: 'Admin',
    RESEARCHER: 'Investigador',
    UPLOADER: 'Subidor',
    PUBLISHER: 'Editor',
    USER: 'Usuario',
  };
  return roles.map((r) => map[r] || r).join(' · ');
}

/** Usuario con solo USER (sin otros roles operativos). */
export function isUserOnly(roles) {
  if (!roles?.length) return false;
  if (!roles.includes('USER')) return false;
  return !roles.some((r) => ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER'].includes(r));
}
