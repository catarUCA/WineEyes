<?php
/**
 * Copia a `database.local.php` y rellena credenciales de tu MySQL `oderismo`.
 * Ese archivo es el que usa el API PHP para login y mantenimiento de usuarios.
 *
 * IMPORTANTE: no subas `database.local.php` al repositorio.
 */
return [
    'host' => 'DB_HOST',
    'port' => DB_PORT,
    'name' => 'DB_NAME',
    'user' => 'DB_USER',
    'pass' => 'DB_PASS',
    'charset' => 'utf8mb4',
];
