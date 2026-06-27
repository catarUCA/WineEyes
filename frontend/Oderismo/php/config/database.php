<?php
declare(strict_types=1);

/**
 * Config y conexión a MySQL (PDO) para identificación de usuarios (tabla `users` + `user_roles`).
 *
 * - Prioridad: `php/config/database.local.php` (no commitear; ver `database.local.example.php`).
 * - Si no existe local: variables de entorno DB_*.
 */

if (!function_exists('oderismo_local_override')) {
    function oderismo_local_override(): ?array
    {
        static $cached = null;
        static $loaded = false;
        if ($loaded) {
            return $cached;
        }
        $loaded = true;
        $path = __DIR__ . '/database.local.php';
        if (!is_file($path)) {
            return null;
        }
        $data = require $path;
        $cached = is_array($data) ? $data : null;
        return $cached;
    }
}

if (!function_exists('oderismo_db_config')) {
    function oderismo_db_config(): array
    {
        $local = oderismo_local_override();
        if ($local !== null) {
            return $local;
        }

        $cfg = [
            'host' => getenv('DB_HOST') ?: null,
            'port' => (int)(getenv('DB_PORT') ?: 3306),
            'name' => getenv('DB_NAME') ?: null,
            'user' => getenv('DB_USER') ?: null,
            'pass' => getenv('DB_PASS') ?: null,
            'charset' => getenv('DB_CHARSET') ?: 'utf8mb4',
        ];

        foreach (['host', 'name', 'user', 'pass'] as $k) {
            if (!is_string($cfg[$k]) || $cfg[$k] === '') {
                throw new RuntimeException(
                    'Falta configuración de BD. Define variables de entorno DB_* o crea php/config/database.local.php'
                );
            }
        }

        return $cfg;
    }
}

if (!function_exists('oderismo_connect_pdo')) {
    function oderismo_connect_pdo(array $cfg): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $cfg['host'],
            (int)$cfg['port'],
            $cfg['name'],
            $cfg['charset']
        );

        return new PDO($dsn, $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
}

if (!function_exists('oderismo_database_module')) {
    /**
     * Módulo de BD (config + factory PDO). Usar esto en lugar de `require database.php`:
     * un segundo `require_once` devuelve true y rompe el acceso a ['pdo'].
     */
    function oderismo_database_module(): array
    {
        static $module = null;
        if ($module !== null) {
            return $module;
        }
        $cfg = oderismo_db_config();
        $module = [
            'config' => $cfg,
            'pdo' => static function () use ($cfg): PDO {
                return oderismo_connect_pdo($cfg);
            },
        ];
        return $module;
    }
}

return oderismo_database_module();
