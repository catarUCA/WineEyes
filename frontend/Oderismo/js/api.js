import { randomLabelColor } from './tag-text-utils.js';

const AUTH_API_URL = window.AUTH_API_URL || window.API_URL || '/api';
const ETIQUETAS_API_URL = window.ETIQUETAS_API_URL || AUTH_API_URL;
const ETIQUETAS_ORIGIN = (window.ETIQUETAS_ORIGIN || 'https://a22.uca.es/backend-etiquetas').replace(/\/$/, '');

let etiquetasMediaTokenCache = '';

/** API FastAPI en a22 (subida SSE). El login Oderismo sigue en PHP (sibila). */
function motorApiBase() {
  return `${ETIQUETAS_ORIGIN}/api`;
}

async function ensureMotorToken() {
  if (!getToken()) {
    throw new Error('Inicia sesión para subir imágenes');
  }
  await prefetchEtiquetasMediaToken();
  const t = getEtiquetasMediaToken();
  if (!t) {
    throw new Error(
      'No se pudo obtener acceso al motor en a22. '
      + 'Revisa etiquetas_service_email/password en php/config/database.local.php (sibila).'
    );
  }
  return t;
}

/** Proxy PHP (respaldo si /images en a22 no es público). */
export function mediaAssetUrl(url, kind = 'images') {
  if (!url) return url;
  const m = String(url).match(/\/(?:images|thumbs)\/([^/?#]+)/i);
  const filename = m?.[1];
  if (!filename) return url;
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  const base = AUTH_API_URL.replace(/\/$/, '');
  return `${base}/media/${kind}/${encodeURIComponent(filename)}${q}`;
}

function resolveAssetUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return appendMediaToken(url);
  if (url.startsWith('/images/') || url.startsWith('/thumbs/')) {
    return appendMediaToken(`${ETIQUETAS_ORIGIN}${url}`);
  }
  return url;
}

function withResolvedImageUrls(data) {
  if (!data?.images) return data;
  return {
    ...data,
    images: data.images.map((img) => ({
      ...img,
      url: resolveAssetUrl(img.url),
    })),
  };
}

function normalizeImagePath(url, fallbackName = '') {
  if (!url) return fallbackName ? `/images/${fallbackName}` : '';
  if (url.includes('/media/')) {
    const m = String(url).match(/\/([^/?#]+\.(?:png|jpe?g|webp))$/i);
    if (m) return `/images/${m[1]}`;
  }
  if (/^https?:\/\//i.test(url)) {
    const m = url.match(/\/(?:images|thumbs)\/([^/?#]+)/i);
    return m ? `/images/${m[1]}` : url;
  }
  if (url.startsWith('/images/') || url.startsWith('/thumbs/')) {
    return url.replace('/thumbs/', '/images/');
  }
  return url.startsWith('/') ? url : `/images/${url}`;
}

/** Token FastAPI para query ?token= en <img> (lo emite PHP tras validar sesión Oderismo). */
export async function prefetchEtiquetasMediaToken() {
  if (!getToken()) {
    etiquetasMediaTokenCache = '';
    return '';
  }
  try {
    const r = await fetch(`${AUTH_API_URL}/etiquetas-token`, {
      headers: getAuthHeaders({ json: false }),
    });
    const data = await handleResponse(r);
    etiquetasMediaTokenCache = typeof data?.token === 'string' ? data.token : '';
  } catch {
    etiquetasMediaTokenCache = '';
  }
  return etiquetasMediaTokenCache;
}

export function getEtiquetasMediaToken() {
  return etiquetasMediaTokenCache;
}

function appendMediaToken(absoluteUrl) {
  const t = etiquetasMediaTokenCache;
  if (!t || absoluteUrl.includes('token=')) return absoluteUrl;
  const sep = absoluteUrl.includes('?') ? '&' : '?';
  return `${absoluteUrl}${sep}token=${encodeURIComponent(t)}`;
}

/** URL absoluta en a22 para la rejilla o el visor. */
export function exploreImageUrl(imgOrPath, { thumb = false, fallbackName = '' } = {}) {
  const raw = typeof imgOrPath === 'string'
    ? imgOrPath
    : (imgOrPath?.url || (imgOrPath?.title ? `/images/${imgOrPath.title}` : ''));
  if (/^https?:\/\//i.test(raw)) {
    let u = raw;
    if (thumb) u = u.replace('/images/', '/thumbs/');
    return appendMediaToken(u);
  }
  const path = normalizeImagePath(raw, fallbackName);
  let absolute = `${ETIQUETAS_ORIGIN}${path.startsWith('/') ? path : `/images/${path}`}`;
  if (thumb) absolute = absolute.replace('/images/', '/thumbs/');
  return appendMediaToken(absolute);
}

/** @deprecated Usar exploreImageUrl */
export function thumbUrl(url) {
  return exploreImageUrl(url, { thumb: true });
}

/** Si falla el thumb, probar la imagen completa en a22 (sin proxy PHP). */
export function attachExploreImageFallback(img, fullUrl) {
  if (!img || !fullUrl) return;
  img.addEventListener('error', () => {
    if (img.src !== fullUrl) img.src = fullUrl;
  }, { once: true });
}

export function getToken() {
  return localStorage.getItem('token');
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('session_expires_at');
  etiquetasMediaTokenCache = '';
}

/** Unix seconds (UTC) de caducidad del JWT actual. */
export function jwtExpiresAtSec(accessToken) {
  if (!accessToken || accessToken === 'dev-admin-session') return null;
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const pad = part.length % 4 ? '='.repeat(4 - (part.length % 4)) : '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const payload = JSON.parse(json);
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

function applySessionMeta(data) {
  if (!data || typeof data !== 'object') return;
  if (data.expires_at != null) {
    localStorage.setItem('session_expires_at', String(Number(data.expires_at)));
  } else if (data.access_token) {
    const exp = jwtExpiresAtSec(data.access_token);
    if (exp) localStorage.setItem('session_expires_at', String(exp));
  }
  if (data.session != null) {
    window.ODERISMO_SESSION_MINUTES = Number(data.session);
  }
  if (data.session_close != null) {
    window.ODERISMO_SESSION_CLOSE_MINUTES = Number(data.session_close);
  }
  if (data.session_ttl_seconds != null) {
    window.ODERISMO_SESSION_TTL_SECONDS = Number(data.session_ttl_seconds);
  } else if (data.session != null) {
    window.ODERISMO_SESSION_TTL_SECONDS = Number(data.session) * 60;
  }
  if (data.session_warning_before_seconds != null) {
    window.ODERISMO_SESSION_WARNING_BEFORE_SECONDS = Number(data.session_warning_before_seconds);
  } else if (data.session_close != null) {
    window.ODERISMO_SESSION_WARNING_BEFORE_SECONDS = Number(data.session_close) * 60;
  }
}

export function getSessionExpiresAtMs() {
  const raw = localStorage.getItem('session_expires_at');
  if (raw) {
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  }
  const exp = jwtExpiresAtSec(getToken());
  return exp ? exp * 1000 : null;
}

/** Solo pruebas: sesión admin local sin llamar a /auth/login */
export function setDevAdminSession() {
  localStorage.setItem('oderismo-dev-admin', '1');
  localStorage.setItem('token', 'dev-admin-session');
  localStorage.setItem('user', JSON.stringify({
    id: 1,
    email: 'admin@example.com',
    full_name: 'Admin',
    roles: ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER'],
  }));
}

export function isDevAdminSession() {
  return getToken() === 'dev-admin-session';
}

export function hasSession() {
  const token = getToken();
  const user = getUser();
  return Boolean(token && user);
}

/** Reanuda sesión tras F5: valida en servidor si hay token guardado. */
export async function restoreSession() {
  if (!hasSession()) return null;
  return api.validateSession();
}

export function getUser() {
  const token = getToken();
  if (!token) return null;

  const raw = localStorage.getItem('user');
  if (!raw) return null;

  try {
    const user = JSON.parse(raw);
    if (!user || typeof user !== 'object') return null;

    // Solo confiar en roles devueltos por el servidor (array de codes).
    const roles = Array.isArray(user.roles)
      ? user.roles.filter((r) => typeof r === 'string' && r !== '').map((r) => r.toUpperCase())
      : [];

    return {
      id: user.id,
      email: user.email,
      full_name: typeof user.full_name === 'string' ? user.full_name : null,
      roles,
    };
  } catch {
    return null;
  }
}

export function logout() {
  clearSession();
  location.reload();
}

function saveSession(data) {
  if (!data?.access_token || !data?.user) {
    throw new Error('Respuesta de login inválida');
  }
  const roles = Array.isArray(data.user.roles)
    ? data.user.roles.filter((r) => typeof r === 'string' && r !== '').map((r) => r.toUpperCase())
    : [];
  if (!roles.length) {
    throw new Error('El usuario no tiene roles asignados');
  }
  localStorage.setItem('token', data.access_token);
  localStorage.setItem('user', JSON.stringify({
    id: data.user.id,
    email: data.user.email,
    full_name: data.user.full_name ?? null,
    roles,
  }));
  applySessionMeta(data);
}

function getAuthHeaders(options = {}) {
  const token = getToken();
  const headers = {};
  if (options.json !== false) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function handleResponse(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Error desconocido' }));
    const err = new Error(error.detail || 'Error en la petición');
    if (error.code) err.code = error.code;
    throw err;
  }
  return response.json();
}

async function parseErrorResponse(response) {
  const error = await response.json().catch(() => ({ detail: 'Error desconocido' }));
  const err = new Error(error.detail || 'Error en la petición');
  if (error.code) err.code = error.code;
  return err;
}

function loginClientContext() {
  const screenSize = window.screen
    ? `${window.screen.width || 0}x${window.screen.height || 0}`
    : '';
  return {
    source: 'login_screen',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    language: navigator.language || '',
    platform: navigator.platform || '',
    screen: screenSize,
  };
}

export const api = {
  async login(email, password) {
    clearSession();
    const r = await fetch(`${AUTH_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(email).trim().toLowerCase(),
        password,
        client: loginClientContext(),
      }),
    });
    if (!r.ok) {
      const err = await parseErrorResponse(r);
      if (r.status === 401) {
        err.message =
          'Email o contraseña incorrectos en Oderismo. El acceso no usa un token previo: '
          + 'introduce la cuenta creada en esta aplicación. Si es la primera vez, usa «¿La has olvidado?».';
      }
      throw err;
    }
    const data = await r.json();
    saveSession(data);
    return data;
  },

  /**
   * Comprueba el JWT en localStorage con GET /auth/me.
   * Solo borra la sesión si el servidor responde 401/403 (token inválido o caducado).
   */
  async validateSession() {
    const token = getToken();
    if (!token) {
      clearSession();
      return null;
    }
    if (token === 'dev-admin-session') {
      return getUser();
    }

    const expMs = getSessionExpiresAtMs();
    if (expMs && Date.now() >= expMs) {
      clearSession();
      return null;
    }

    let r;
    try {
      r = await fetch(`${AUTH_API_URL}/auth/me`, {
        headers: getAuthHeaders(),
      });
    } catch {
      if (expMs && Date.now() >= expMs) {
        clearSession();
        return null;
      }
      return getUser();
    }

    if (r.status === 401 || r.status === 403) {
      clearSession();
      return null;
    }
    if (!r.ok) {
      return getUser();
    }

    const data = await r.json();
    if (!data?.user) {
      clearSession();
      return null;
    }
    const roles = Array.isArray(data.user.roles)
      ? data.user.roles.filter((x) => typeof x === 'string' && x !== '').map((x) => x.toUpperCase())
      : [];
    if (!roles.length) {
      clearSession();
      return null;
    }
    localStorage.setItem('user', JSON.stringify({
      id: data.user.id,
      email: data.user.email,
      full_name: data.user.full_name ?? null,
      roles,
    }));
    applySessionMeta(data);
    return getUser();
  },

  async fetchSessionConfig() {
    const r = await fetch(`${AUTH_API_URL}/auth/session-config`);
    const data = await handleResponse(r);
    applySessionMeta(data);
    return data;
  },

  /** Renueva el JWT (misma duración global configurada en el servidor). */
  async refreshSession() {
    const token = getToken();
    if (!token || token === 'dev-admin-session') {
      return getUser();
    }
    const r = await fetch(`${AUTH_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        clearSession();
        return null;
      }
      throw await parseErrorResponse(r);
    }
    const data = await r.json();
    saveSession(data);
    return getUser();
  },

  async requestPasswordReset(email) {
    const r = await fetch(`${AUTH_API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return handleResponse(r);
  },

  async setPassword(token, password) {
    const r = await fetch(`${AUTH_API_URL}/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    return handleResponse(r);
  },

  async requestResearcherAccess({ email, fullName, description }) {
    const r = await fetch(`${AUTH_API_URL}/auth/researcher-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(email || '').trim().toLowerCase(),
        full_name: String(fullName || '').trim(),
        description: String(description || '').trim(),
      }),
    });
    return handleResponse(r);
  },

  async getImages(page = 0, limit = 20) {
    const r = await fetch(`${ETIQUETAS_API_URL}/images?page=${page}&limit=${limit}`, {
      headers: getAuthHeaders({ json: false }),
    });
    return withResolvedImageUrls(await handleResponse(r));
  },

  async searchImages(query, limit = 20) {
    const r = await fetch(`${ETIQUETAS_API_URL}/search`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ query: String(query).trim(), limit, score_threshold: 0 }),
    });
    const data = withResolvedImageUrls(await handleResponse(r));
    if (data?.images && limit > 0 && data.images.length > limit) {
      return { ...data, images: data.images.slice(0, limit) };
    }
    return data;
  },

  async getMarcas() {
    const r = await fetch(`${AUTH_API_URL}/marcas`, { headers: getAuthHeaders() });
    return handleResponse(r);
  },

  async searchMarcasByNotes(query) {
    const q = encodeURIComponent(String(query).trim());
    const r = await fetch(`${AUTH_API_URL}/marcas/search-by-notes?q=${q}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async getUntaggedImagesByNotes(query) {
    const q = encodeURIComponent(String(query).trim());
    const r = await fetch(`${AUTH_API_URL}/marcas/sin-etiquetar/by-notes?q=${q}`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse(r);
    return withResolvedImageUrls(data);
  },

  async getMarcaImages(labelId) {
    const r = await fetch(`${AUTH_API_URL}/marcas/${labelId}/images`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse(r);
    return withResolvedImageUrls(data);
  },

  async deleteMarca(labelId) {
    const r = await fetch(`${AUTH_API_URL}/marcas/${labelId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async updateMarcaColor(labelId, color) {
    const url = `${AUTH_API_URL}/marcas/${labelId}`;
    const headers = getAuthHeaders();
    const body = JSON.stringify({ color });
    let r = await fetch(url, { method: 'PATCH', headers, body });
    if (r.status === 405) {
      r = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'X-HTTP-Method-Override': 'PATCH' },
        body,
      });
    }
    return handleResponse(r);
  },

  async mergeMarcas(sourceIds, targetName) {
    const r = await fetch(`${AUTH_API_URL}/marcas/merge`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        source_ids: sourceIds,
        target_name: String(targetName).trim(),
      }),
    });
    return handleResponse(r);
  },

  async searchLabels(query = '') {
    const q = encodeURIComponent(String(query).trim());
    const r = await fetch(`${AUTH_API_URL}/labels?q=${q}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async createLabel(name, color) {
    const c = typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/i.test(color.trim())
      ? color.trim()
      : randomLabelColor();
    const r = await fetch(`${AUTH_API_URL}/labels`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name: String(name).trim(), color: c }),
    });
    return handleResponse(r);
  },

  async getImageMeta(imageId) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async setImageLabels(imageId, labelIds) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}/labels`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ label_ids: labelIds }),
    });
    return handleResponse(r);
  },

  /** Crea o actualiza la nota única del usuario para esta imagen (HTML enriquecido). */
  async saveImageNote(imageId, bodyHtml) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}/note`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ body: bodyHtml }),
    });
    return handleResponse(r);
  },

  async deleteImageNote(imageId) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}/note`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async deleteImage(imageId) {
    const r = await fetch(`${ETIQUETAS_API_URL}/images/${imageId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!r.ok) throw new Error('Error al eliminar imagen');
  },

  /** PATCH /images/{id}/description — payload image_description en Qdrant. */
  async updateImageDescription(imageId, description) {
    const r = await fetch(`${ETIQUETAS_API_URL}/images/${imageId}/description`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ description: String(description ?? '') }),
    });
    return handleResponse(r);
  },

  /** Detalle de imagen en Qdrant (image_description, url, título). */
  async getImageQdrantDetail(imageId) {
    const r = await fetch(`${ETIQUETAS_API_URL}/images/${imageId}`, {
      headers: getAuthHeaders({ json: false }),
    });
    const data = await handleResponse(r);
    const img = {
      id: String(data.id ?? imageId),
      title: typeof data.title === 'string' ? data.title : '',
      description: typeof data.description === 'string' ? data.description : '',
      url: typeof data.url === 'string' ? data.url : '',
    };
    return withResolvedImageUrls({ images: [img] }).images[0];
  },

  async getUsers() {
    const r = await fetch(`${AUTH_API_URL}/admin/users`, { headers: getAuthHeaders() });
    return handleResponse(r);
  },

  async getResearcherRequests() {
    const r = await fetch(`${AUTH_API_URL}/admin/researcher-requests`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async approveResearcherRequest(requestId) {
    const r = await fetch(`${AUTH_API_URL}/admin/researcher-requests/${requestId}/approve`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async createUser(email, password, roles, fullName = '') {
    const r = await fetch(`${AUTH_API_URL}/admin/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        email,
        password: password || '',
        roles,
        full_name: fullName || undefined,
      }),
    });
    return handleResponse(r);
  },

  async deleteUser(userId) {
    const r = await fetch(`${AUTH_API_URL}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.detail || 'Error al eliminar usuario');
    }
  },

  async updateUser(userId, patch) {
    const r = await fetch(`${AUTH_API_URL}/admin/users/${userId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(patch),
    });
    return handleResponse(r);
  },

  async getParameters() {
    const r = await fetch(`${AUTH_API_URL}/admin/parameters`, {
      headers: getAuthHeaders(),
    });
    const data = await handleResponse(r);
    applySessionMeta(data);
    return data;
  },

  async updateParameters({ session, session_close, time_label, time_index }) {
    const r = await fetch(`${AUTH_API_URL}/admin/parameters`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ session, session_close, time_label, time_index }),
    });
    const data = await handleResponse(r);
    applySessionMeta(data);
    return data;
  },

  async getDescriptionSettings() {
    const r = await fetch(`${AUTH_API_URL}/admin/description-settings`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async updateDescriptionSettings({ scale_w, scale_h }) {
    const r = await fetch(`${AUTH_API_URL}/admin/description-settings`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ scale_w, scale_h }),
    });
    return handleResponse(r);
  },

  async rotateImage(imageId, degrees) {
    const r = await fetch(`${ETIQUETAS_API_URL}/admin/images/${imageId}/rotate?degrees=${degrees}`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async uploadAndOCR(files, signal, sessionId = null) {
    const motorToken = await ensureMotorToken();
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append('files', f));
    if (sessionId) formData.append('session_id', sessionId);

    const r = await fetch(`${motorApiBase()}/upload/batch/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${motorToken}` },
      body: formData,
      signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Error' }));
      throw new Error(err.detail || 'Error en la subida');
    }
    return r;
  },

  async cropBatch(sessionId, accepted, signal) {
    const motorToken = await ensureMotorToken();
    const r = await fetch(`${motorApiBase()}/upload/batch/crop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${motorToken}`,
      },
      body: JSON.stringify({ session_id: sessionId, accepted }),
      signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Error' }));
      throw new Error(err.detail || 'Error en el recorte');
    }
    return r;
  },

  async ensureUploadStream(response) {
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/event-stream')) {
      return response;
    }

    const preview = (await response.clone().text()).trim().slice(0, 800);

    if (ct.includes('application/json') || preview.startsWith('{')) {
      let detail = 'Error del servidor en la subida';
      try {
        const data = JSON.parse(preview);
        if (data.detail) detail = String(data.detail);
        if (data.code === 'ETIQUETAS_SERVICE_UNAVAILABLE') {
          detail += ' — En sibila, configura etiquetas_service_email/password o etiquetas_service_token en php/config/database.local.php.';
        }
      } catch {
        if (preview) detail += `: ${preview}`;
      }
      throw new Error(detail);
    }

    if (ct.includes('text/html') || preview.startsWith('<!')) {
      throw new Error(
        'El servidor devolvió HTML en lugar de progreso SSE. '
        + 'Suele deberse a un error PHP/Apache o a desplegar api/index.php antiguo. '
        + preview.slice(0, 200)
      );
    }

    if (preview.includes('data:') || preview.startsWith(':')) {
      return response;
    }

    throw new Error(
      'El servidor no devolvió progreso de subida (SSE). '
      + `Content-Type: ${ct || '(vacío)'}. `
      + (preview ? `Respuesta: ${preview.slice(0, 200)}` : 'Sin cuerpo en la respuesta.')
    );
  },

  /** Extrae JSON de bloques SSE (`data: {...}`), tolerando \\r\\n y cortes entre chunks. */
  _parseSseBuffer(buffer, onEvent) {
    let lastEvent = null;
    const blocks = buffer.split(/\n\n+/);
    for (const block of blocks) {
      const line = block
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.replace(/^data:\s*/, '');
      if (!payload) continue;
      try {
        const data = JSON.parse(payload);
        lastEvent = data;
        if (onEvent) onEvent(data);
      } catch (e) {
        console.error('[SSE] JSON inválido:', e, payload.substring(0, 120));
      }
    }
    return lastEvent;
  },

  async sseReader(response, onEvent, signal) {
    if (!response.body) {
      throw new Error('El servidor no envió cuerpo en la respuesta de subida');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = null;

    const flushCompleteBlocks = () => {
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = this._parseSseBuffer(block + '\n\n', onEvent);
        if (parsed) lastEvent = parsed;
      }
    };

    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      flushCompleteBlocks();
    }

    if (buffer.trim()) {
      const parsed = this._parseSseBuffer(buffer.includes('\n\n') ? buffer : buffer + '\n\n', onEvent);
      if (parsed) lastEvent = parsed;
    }
    if (!lastEvent) {
      const hint = buffer.trim().startsWith(':')
        ? ' Solo llegó el comentario inicial del proxy PHP; la subida debe ir directa a a22 (actualiza api.js).'
        : '';
      throw new Error(
        'La subida respondió 200 pero sin eventos `data:` de progreso.'
        + hint
        + (buffer.trim() ? ` Fragmento: ${buffer.trim().slice(0, 120)}` : ' Respuesta vacía.')
      );
    }
    return lastEvent;
  },

  async ocrBatch(sessionId, accepted, signal) {
    const token = getToken();
    const r = await fetch(`${ETIQUETAS_API_URL}/upload/batch/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify({ session_id: sessionId, accepted }),
      signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Error' }));
      throw new Error(err.detail || 'Error');
    }
    return r;
  },

  async describeBatch(sessionId, signal) {
    const motorToken = await ensureMotorToken();
    const r = await fetch(`${motorApiBase()}/upload/batch/describe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${motorToken}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Error' }));
      throw new Error(err.detail || 'Error en la descripción');
    }
    return r;
  },

  /** Persiste en disco y Qdrant (fase 4 del motor v2). */
  async indexBatch(sessionId, accepted, force = false, signal) {
    const motorToken = await ensureMotorToken();
    const r = await fetch(`${motorApiBase()}/upload/batch/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${motorToken}`,
      },
      body: JSON.stringify({ session_id: sessionId, accepted, force }),
      signal,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: 'Error' }));
      throw new Error(err.detail || 'Error en el indexado');
    }
    return r;
  },

  async deleteSession(sessionId) {
    try {
      const motorToken = await ensureMotorToken();
      await fetch(`${motorApiBase()}/upload/batch/session/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${motorToken}` },
      }).catch(() => {});
    } catch {
      // ignore
    }
  },

  async getPublicCollections() {
    const r = await fetch(`${AUTH_API_URL}/collections/public`);
    return handleResponse(r);
  },

  async getPublicCollection(slug) {
    const r = await fetch(`${AUTH_API_URL}/collections/public/${encodeURIComponent(slug)}`);
    const data = await handleResponse(r);
    return withResolvedImageUrls(data);
  },

  async getCollections() {
    const r = await fetch(`${AUTH_API_URL}/collections`, { headers: getAuthHeaders() });
    return handleResponse(r);
  },

  async getCollection(id) {
    const r = await fetch(`${AUTH_API_URL}/collections/${id}`, { headers: getAuthHeaders() });
    const data = await handleResponse(r);
    return withResolvedImageUrls(data);
  },

  async getCollectionAvailableLabels(query = '') {
    const q = encodeURIComponent(String(query).trim());
    const r = await fetch(`${AUTH_API_URL}/collections/available-labels?q=${q}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  async createCollection(payload) {
    const r = await fetch(`${AUTH_API_URL}/collections`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(r);
  },

  async updateCollection(id, payload) {
    const url = `${AUTH_API_URL}/collections/${id}`;
    const headers = getAuthHeaders();
    const body = JSON.stringify(payload);
    let r = await fetch(url, { method: 'PATCH', headers, body });
    if (r.status === 405) {
      r = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'X-HTTP-Method-Override': 'PATCH' },
        body,
      });
    }
    return handleResponse(r);
  },

  async deleteCollection(id) {
    const r = await fetch(`${AUTH_API_URL}/collections/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },

  /** Nota pública de catálogo para una imagen (collections_notes; ADMIN/PUBLISHER). */
  async saveImageCollectionNote(imageId, bodyHtml) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}/collection-note`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ body: bodyHtml }),
    });
    return handleResponse(r);
  },

  async deleteImageCollectionNote(imageId) {
    const r = await fetch(`${AUTH_API_URL}/image-meta/${imageId}/collection-note`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return handleResponse(r);
  },
};
