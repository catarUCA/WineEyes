// Este archivo puede cargarse más de una vez (login + arranque).
// Debe ser idempotente.
(function () {
  if (window.__ODERISMO_CONFIG_LOADED__) return;
  window.__ODERISMO_CONFIG_LOADED__ = true;

  // Auth (login/usuarios): API PHP local bajo la app (p. ej. /ucatedra/oderismo/api).
  const authApiUrl = new URL('api', document.baseURI);
  window.AUTH_API_URL = authApiUrl.pathname.replace(/\/$/, '');

  // Integración: el navegador SIEMPRE habla con PHP.
  // PHP valida permisos y hace de pasarela hacia el motor FastAPI.
  window.ETIQUETAS_API_URL = window.AUTH_API_URL;

  // Medios (/images, /thumbs): siempre en el motor FastAPI (a22), aunque Oderismo esté en sibila u otro host.
  const ETIQUETAS_MEDIA_DEFAULT = 'https://a22.uca.es/backend-etiquetas';
  window.ETIQUETAS_ORIGIN = window.ETIQUETAS_ORIGIN
    || (window.location.hostname === 'a22.uca.es'
      ? `${window.location.origin}/backend-etiquetas`
      : ETIQUETAS_MEDIA_DEFAULT);

  // Compatibilidad con código que use API_URL solo para login.
  window.API_URL = window.AUTH_API_URL;

  // Salvapantallas (portada): imagen aleatoria pública, sin token.
  window.ETIQUETAS_PUBLIC_RANDOM_IMAGE = `${window.ETIQUETAS_ORIGIN}/api/public/random-image`;
})();
