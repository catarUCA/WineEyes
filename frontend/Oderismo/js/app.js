import { hasSession, logout, restoreSession, prefetchEtiquetasMediaToken } from './api.js';
import { startSessionWatchdog, stopSessionWatchdog } from './session-timeout.js';
import { renderGallery } from './gallery.js';
import { renderAdmin } from './admin.js';
import { renderPlaceholder } from './placeholder.js';
import { renderMarcas } from './marcas.js';
import { renderUploadPage } from './upload-page.js';
import { mountAppShell } from './shell.js';
import { canSeeCatalogsNav, resolveAdminSection, defaultAdminSection } from './nav.js';
import { initTheme } from './theme.js';
import { preloadHtmlSanitizer } from './sanitize-html.js';
function getAppRoot() {
  const el = document.getElementById('app');
  if (!el) throw new Error('No se encontró el contenedor #app');
  return el;
}

let shellApi = null;
let currentView = 'explore';
let currentAdminSection = 'users';
let pendingAdminDescriptionImage = null;
let catalogsModulePromise = null;

function takePendingAdminDescriptionImage() {
  const img = pendingAdminDescriptionImage;
  pendingAdminDescriptionImage = null;
  return img;
}

/** Vuelve a la portada (index.html con figura de Odero) o redirige si no hay landing en esta página. */
export function returnToHome() {
  stopSessionWatchdog();
  shellApi?.closeAdminMenu?.();
  window.ODERISMO_CLOSE_LOGIN?.();

  const landing = document.getElementById('landing');
  const appRoot = document.getElementById('app');
  const pageShell = document.querySelector('.page-shell');

  if (landing && appRoot) {
    landing.classList.remove('is-hidden');
    appRoot.classList.add('is-hidden');
    appRoot.innerHTML = '';
    appRoot.classList.remove('shell-content', 'app-root');
    pageShell?.classList.remove('page-shell--app');
    shellApi = null;
    currentView = 'explore';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.ODERISMO_ON_RETURN_HOME?.();
    return;
  }

  window.location.assign(new URL('index.html', document.baseURI).href);
}

function loadCatalogsModule() {
  if (!catalogsModulePromise) {
    const v = window.ASSET_VERSION || '';
    catalogsModulePromise = import(`./catalogs.js?v=${v}`);
  }
  return catalogsModulePromise;
}

function defaultViewForUser(guest = false) {
  return guest ? 'catalogs' : 'explore';
}

async function renderView(viewId, contentEl, options) {
  const {
    guest,
    onRequestLogin,
    roles,
    adminSection = 'users',
    initialImage = null,
  } = options;

  if (viewId === 'explore' || viewId === 'search') {
    await renderGallery(contentEl, {
      guest,
      roles,
      onRequestLogin,
      onOpenAdminDescription: (img) => {
        pendingAdminDescriptionImage = img && typeof img === 'object'
          ? { ...img, id: String(img.id) }
          : { id: String(img) };
        navigate('admin', { guest, onRequestLogin, roles }, 'description');
      },
    });
    return;
  }

  if (viewId === 'labels') {
    if (!roles.includes('RESEARCHER')) {
      renderPlaceholder(contentEl, {
        title: 'Etiquetas',
        description: 'Esta sección está disponible para el perfil Investigador.',
      });
      return;
    }
    renderMarcas(contentEl);
    return;
  }

  if (viewId === 'admin') {
    const section = resolveAdminSection(roles, adminSection);
    if (!section) {
      renderPlaceholder(contentEl, {
        title: 'Administración',
        description: 'Esta sección está disponible para el perfil Administrador o Subidor.',
      });
      return;
    }
    const image = initialImage ?? takePendingAdminDescriptionImage();
    renderAdmin(contentEl, { section, initialImage: image });
    return;
  }

  if (viewId === 'upload') {
    if (!roles.includes('UPLOADER')) {
      renderPlaceholder(contentEl, {
        title: 'Subir',
        description: 'Esta sección está disponible para el perfil Subidor.',
      });
      return;
    }
    renderUploadPage(contentEl);
    return;
  }

  if (viewId === 'catalogs') {
    if (!guest && !canSeeCatalogsNav(roles)) {
      renderPlaceholder(contentEl, {
        title: 'Catálogos',
        description: 'Esta sección no está disponible para el perfil Subidor.',
      });
      return;
    }
    const canEdit = !guest && roles.some((r) => ['ADMIN', 'PUBLISHER'].includes(r));
    const { renderCatalogs } = await loadCatalogsModule();
    await renderCatalogs(contentEl, { guest, canEdit });
    return;
  }

  // Compatibilidad con ids antiguos del menú
  if (viewId === 'marcas') {
    renderView('labels', contentEl, options);
    return;
  }
  if (viewId === 'opcion') {
    renderView('admin', contentEl, options);
    return;
  }

  renderPlaceholder(contentEl, {
    title: 'Sección no disponible',
    description: 'No tienes permiso para esta vista o aún no está implementada.',
  });
}

function navigate(viewId, options, adminSection) {
  if (!shellApi) return;
  currentView = viewId;
  if (viewId === 'admin') {
    const resolved = resolveAdminSection(options.roles ?? [], adminSection || currentAdminSection);
    if (resolved) currentAdminSection = resolved;
  }
  shellApi.setActiveView(viewId, currentAdminSection);
  shellApi.contentEl.innerHTML = '';
  const initialImage = viewId === 'admin' && currentAdminSection === 'description'
    ? takePendingAdminDescriptionImage()
    : null;
  renderView(viewId, shellApi.contentEl, {
    ...options,
    adminSection: currentAdminSection,
    initialImage,
  });
}

export async function initApp(options = {}) {
  initTheme();
  preloadHtmlSanitizer().catch(() => {});
  const onRequestLogin = options.onRequestLogin || (() => window.ODERISMO_OPEN_LOGIN?.());
  const onGoHome = options.onGoHome || returnToHome;
  window.ODERISMO_GO_HOME = onGoHome;

  let user = null;
  if (hasSession()) {
    user = await restoreSession();
  }
  const guest = !user;
  const roles = user?.roles ?? [];
  currentAdminSection = defaultAdminSection(roles);

  if (!guest) {
    prefetchEtiquetasMediaToken().catch(() => {});
    startSessionWatchdog({
      onExpire: () => {
        stopSessionWatchdog();
        if (typeof onRequestLogin === 'function') onRequestLogin();
        else window.location.reload();
      },
    });
  } else {
    stopSessionWatchdog();
  }

  const root = getAppRoot();
  root.classList.add('app-root');

  const initialView = options.initialView || defaultViewForUser(guest);
  currentView = initialView;

  shellApi = mountAppShell(root, {
    guest,
    user,
    roles,
    activeView: initialView,
    onNavigate: (viewId, adminSection) =>
      navigate(viewId, { guest, onRequestLogin, roles }, adminSection),
    activeAdminSection: currentAdminSection,
    onRequestLogin,
    onLogout: logout,
    onGoHome,
  });

  renderView(initialView, shellApi.contentEl, { guest, onRequestLogin, roles });
}

if (window.ODERISMO_AUTO_INIT !== false) {
  initApp();
}
