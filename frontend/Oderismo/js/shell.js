import { getNavItems, getAdminSections, defaultAdminSection, roleLabel, displayUserName, userInitials, escapeHtml } from './nav.js';
import { applyBrandLogo } from './brand-logo.js';
import { isDark, bindDarkToggle } from './theme.js';

const MOBILE_NAV_MQ = '(max-width: 767px)';

function navViewLabel(viewId, adminSection, roles, guest) {
  const items = getNavItems(roles, guest);
  const item = items.find((entry) => entry.id === viewId);
  if (viewId === 'admin') {
    const section = getAdminSections(roles).find((entry) => entry.id === adminSection);
    if (section) return `${item?.label || 'Administración'} · ${section.label}`;
    return item?.label || 'Administración';
  }
  return item?.label || viewId;
}

function renderNavItem(item, activeView, activeAdminSection, roles) {
  if (item.id !== 'admin') {
    return `
      <button type="button" class="app-nav-link" data-nav="${item.id}" data-action="${item.action || ''}"
        aria-current="${item.id === activeView ? 'page' : 'false'}">
        ${item.label}
      </button>`;
  }

  const isAdminActive = activeView === 'admin';
  const submenu = getAdminSections(roles).map(
    (s) => `
      <li role="none">
        <button type="button" class="app-nav-submenu-item" role="menuitem"
          data-nav="admin" data-admin-section="${s.id}"
          aria-current="${isAdminActive && s.id === activeAdminSection ? 'true' : 'false'}">
          ${s.label}
        </button>
      </li>`
  ).join('');

  return `
    <div class="app-nav-dropdown" data-nav-group="admin">
      <button type="button" class="app-nav-link app-nav-link--menu" data-nav="admin" data-action="toggle-admin-menu"
        aria-current="${isAdminActive ? 'page' : 'false'}"
        aria-expanded="false" aria-haspopup="menu" id="admin-nav-trigger">
        ${item.label}
        <span class="app-nav-chevron" aria-hidden="true"></span>
      </button>
      <ul class="app-nav-submenu" role="menu" aria-labelledby="admin-nav-trigger" hidden>
        ${submenu}
      </ul>
    </div>`;
}

/**
 * Layout tipo Dribbble: topbar fija + contenido.
 * @returns {{ contentEl: HTMLElement, setActiveView: (id: string, adminSection?: string) => void, closeAdminMenu: () => void }}
 */
export function mountAppShell(container, options) {
  const {
    guest = false,
    user = null,
    roles = [],
    activeView = 'explore',
    activeAdminSection = defaultAdminSection(roles),
    onNavigate,
    onRequestLogin,
    onLogout,
    onGoHome,
  } = options;

  const navItems = getNavItems(roles, guest);
  const homeUrl = new URL('index.html', document.baseURI).href;
  const displayName = displayUserName(user);
  const initials = userInitials(user);
  const chipTitle = user?.email
    ? `${displayName} · ${user.email} — ${roleLabel(roles)}`
    : roleLabel(roles);

  const navHtml = navItems.map((item) => renderNavItem(item, activeView, activeAdminSection, roles)).join('');

  container.innerHTML = `
    <div class="app-layout">
      <header class="app-topbar">
        <div class="app-topbar-inner">
          <a href="${escapeHtml(homeUrl)}" class="app-brand" id="app-brand-home" aria-label="Oderismo — Volver al inicio">
            <img
              class="app-brand-logo"
              data-brand-logo="auto"
              src="figures/logohorizontal.png"
              alt=""
              width="200"
              height="48"
              decoding="async"
            />
          </a>

          <div class="app-nav-panel">
            <button
              type="button"
              id="app-nav-toggle"
              class="app-nav-toggle"
              aria-expanded="false"
              aria-controls="app-nav"
            >
              <span class="app-nav-toggle-text">
                <span class="app-nav-toggle-kicker">Sección</span>
                <span id="app-nav-current" class="app-nav-toggle-current">${escapeHtml(navViewLabel(activeView, activeAdminSection, roles, guest))}</span>
              </span>
              <span class="app-nav-toggle-chevron" aria-hidden="true"></span>
            </button>
            <nav id="app-nav" class="app-nav" aria-label="Principal" hidden>${navHtml}</nav>
          </div>

          <div class="app-topbar-actions">
            <button type="button" id="shell-dark-toggle" class="app-icon-btn" title="Modo oscuro" aria-label="Modo oscuro">
              <span data-dark-icon>${isDark() ? '☀️' : '🌙'}</span>
            </button>
            ${
              guest
                ? `<button type="button" id="shell-login-btn" class="app-btn app-btn-primary app-btn-sm">Acceder</button>`
                : `
              <div class="app-user-chip" title="${escapeHtml(chipTitle)}">
                <span class="app-user-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                <span class="app-user-name">${escapeHtml(displayName)}</span>
              </div>
              <button type="button" id="shell-logout-btn" class="app-btn app-btn-ghost app-btn-sm">Salir</button>`
            }
          </div>
        </div>
      </header>

      <main class="app-main" id="app-main">
        <div id="app-content" class="app-content"></div>
      </main>
    </div>
  `;

  const contentEl = container.querySelector('#app-content');
  const topbar = container.querySelector('.app-topbar');
  const appNav = container.querySelector('#app-nav');
  const navToggle = container.querySelector('#app-nav-toggle');
  const navCurrent = container.querySelector('#app-nav-current');
  const adminDropdown = container.querySelector('[data-nav-group="admin"]');
  const adminTrigger = container.querySelector('#admin-nav-trigger');
  const adminSubmenu = adminDropdown?.querySelector('.app-nav-submenu');
  let mobileNavCollapsed = true;

  function isMobileNavLayout() {
    return window.matchMedia(MOBILE_NAV_MQ).matches;
  }

  function setMobileNavCollapsed(collapsed) {
    mobileNavCollapsed = collapsed;
    if (!topbar || !appNav || !navToggle) return;

    if (!isMobileNavLayout()) {
      topbar.classList.remove('is-nav-collapsed');
      appNav.removeAttribute('hidden');
      navToggle.setAttribute('aria-expanded', 'true');
      return;
    }

    topbar.classList.toggle('is-nav-collapsed', collapsed);
    appNav.toggleAttribute('hidden', collapsed);
    navToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function collapseMobileNavAfterNavigate() {
    if (isMobileNavLayout()) setMobileNavCollapsed(true);
  }

  applyBrandLogo(container.querySelector('.app-brand-logo'));

  function closeAdminMenu() {
    if (!adminDropdown || !adminTrigger || !adminSubmenu) return;
    adminDropdown.classList.remove('is-open');
    adminTrigger.setAttribute('aria-expanded', 'false');
    adminSubmenu.hidden = true;
  }

  function positionAdminSubmenu() {
    if (!adminTrigger || !adminSubmenu) return;
    const rect = adminTrigger.getBoundingClientRect();
    adminSubmenu.style.position = 'fixed';
    adminSubmenu.style.top = `${Math.round(rect.bottom + 8)}px`;
    adminSubmenu.style.left = `${Math.round(rect.left)}px`;
    adminSubmenu.style.minWidth = `${Math.max(Math.round(rect.width), 176)}px`;
    adminSubmenu.style.zIndex = '100';
  }

  function openAdminMenu() {
    if (!adminDropdown || !adminTrigger || !adminSubmenu) return;
    adminDropdown.classList.add('is-open');
    adminTrigger.setAttribute('aria-expanded', 'true');
    adminSubmenu.removeAttribute('hidden');
    positionAdminSubmenu();
  }

  function setActiveView(viewId, adminSection = defaultAdminSection(roles)) {
    if (navCurrent) {
      navCurrent.textContent = navViewLabel(viewId, adminSection, roles, guest);
    }

    container.querySelectorAll('.app-nav-link:not(.app-nav-link--menu)').forEach((btn) => {
      const active = btn.dataset.nav === viewId;
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    if (adminTrigger) {
      const isAdmin = viewId === 'admin';
      adminTrigger.setAttribute('aria-current', isAdmin ? 'page' : 'false');
      adminDropdown?.querySelectorAll('[data-admin-section]').forEach((btn) => {
        btn.setAttribute(
          'aria-current',
          isAdmin && btn.dataset.adminSection === adminSection ? 'true' : 'false'
        );
      });
    }

    if (viewId !== 'admin') closeAdminMenu();
  }

  if (adminTrigger) {
    adminTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (adminDropdown?.classList.contains('is-open')) {
        closeAdminMenu();
      } else {
        openAdminMenu();
      }
    });
  }

  adminDropdown?.querySelectorAll('[data-admin-section]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const section = btn.dataset.adminSection;
      if (!section || !onNavigate) return;
      closeAdminMenu();
      collapseMobileNavAfterNavigate();
      onNavigate('admin', section);
    });
  });

  container.querySelector('#app-brand-home')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAdminMenu();
    collapseMobileNavAfterNavigate();
    if (typeof onGoHome === 'function') onGoHome();
    else window.location.assign(homeUrl);
  });

  container.querySelectorAll('[data-nav]').forEach((el) => {
    if (el.id === 'admin-nav-trigger' || el.dataset.adminSection) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.nav;
      if (!id || !onNavigate) return;
      closeAdminMenu();
      collapseMobileNavAfterNavigate();
      onNavigate(id);
    });
  });

  navToggle?.addEventListener('click', (e) => {
    e.preventDefault();
    setMobileNavCollapsed(!mobileNavCollapsed);
  });

  const onDocCloseAdmin = (e) => {
    if (!adminDropdown?.classList.contains('is-open')) return;
    const t = e.target;
    if (t instanceof Node && adminDropdown.contains(t)) return;
    closeAdminMenu();
  };
  document.addEventListener('click', onDocCloseAdmin);
  window.addEventListener('resize', () => {
    setMobileNavCollapsed(isMobileNavLayout() ? mobileNavCollapsed : false);
    if (adminDropdown?.classList.contains('is-open')) positionAdminSubmenu();
  });
  window.addEventListener('scroll', () => {
    if (adminDropdown?.classList.contains('is-open')) positionAdminSubmenu();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAdminMenu();
  });

  container.querySelector('#shell-login-btn')?.addEventListener('click', () => onRequestLogin?.());
  container.querySelector('#shell-logout-btn')?.addEventListener('click', () => onLogout?.());
  bindDarkToggle(container.querySelector('#shell-dark-toggle'));

  setActiveView(activeView, activeAdminSection);
  setMobileNavCollapsed(isMobileNavLayout());

  return { contentEl, setActiveView, closeAdminMenu };
}
