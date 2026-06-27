<?php
/**
 * Conexión MySQL para identificación de usuarios (login, roles, admin usuarios).
 * El API PHP carga este archivo antes que variables de entorno DB_*.
 * IMPORTANTE: no lo subas al repositorio.
 */
return [
    'host' => '127.0.0.1',
    'port' => 3306,
    'name' => 'oderismo',
    'user' => 'oderismo_app',
    'pass' => 'TUCLAVEAQUI',
    'charset' => 'utf8mb4',

    // Opcional: JWT estable entre peticiones (alternativa: variable de entorno JWT_SECRET).
    'jwt_secret' => 'oderismo-local-jwt-2026',

    // URL pública del frontend (enlaces de recuperación de contraseña).
    'public_url' => 'TUURLPUBLICA',

    // SMTP para enviar enlaces de activación/recuperación.
    // Gmail requiere una contraseña de aplicación, no la contraseña normal.
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 587,
    'smtp_secure' => 'tls',
    'smtp_user' => 'EMAIL_ADDRESS',
    'smtp_password' => 'EMAIL_PASSWORD',
    'mail_from' => 'EMAIL_ADDRESS',
    'mail_from_name' => 'WineEye',
    'mail_debug' => false,

    // Solo desarrollo: la API devuelve reset_url en JSON (hasta tener correo SMTP).
    'dev_expose_reset_links' => false,

    // Motor de etiquetas (a22) — necesario para /api/images y miniaturas.
    'etiquetas_service_email' => 'ADMIN_USER',
    'etiquetas_service_password' => 'ADMIN_PASSWORD',
];

