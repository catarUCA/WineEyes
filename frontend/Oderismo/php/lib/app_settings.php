<?php
declare(strict_types=1);

/**
 * Parámetros globales (tabla MySQL `parameters`, un solo registro).
 * - `session`: duración de sesión en minutos.
 * - `session_close`: aviso antes del cierre, en minutos.
 * - `time_label`: intervalo del salvapantallas a pantalla completa, en segundos.
 * - `time_index`: intervalo del cuadro expositor en la portada, en segundos.
 */

if (!function_exists('oderismo_parameters_pdo')) {
    function oderismo_parameters_pdo(): PDO
    {
        static $pdo = null;
        if ($pdo instanceof PDO) {
            return $pdo;
        }
        if (!function_exists('oderismo_database_module')) {
            require_once __DIR__ . '/../config/database.php';
        }
        $factory = oderismo_database_module()['pdo'] ?? null;
        if (!is_callable($factory)) {
            throw new RuntimeException('DB factory no disponible');
        }
        /** @var PDO $pdo */
        $pdo = $factory();
        return $pdo;
    }
}

if (!function_exists('oderismo_invalidate_parameters_cache')) {
    function oderismo_invalidate_parameters_cache(): void
    {
        unset($GLOBALS['__oderismo_parameters']);
    }
}

/** @deprecated alias */
if (!function_exists('oderismo_invalidate_app_settings_cache')) {
    function oderismo_invalidate_app_settings_cache(): void
    {
        oderismo_invalidate_parameters_cache();
    }
}

if (!function_exists('oderismo_ensure_parameters_row')) {
    function oderismo_ensure_parameters_row(PDO $pdo): void
    {
        $count = (int)$pdo->query('SELECT COUNT(*) FROM parameters')->fetchColumn();
        if ($count < 1) {
            $pdo->exec('INSERT INTO parameters (`session`, `session_close`, `time_label`, `time_index`) VALUES (10, 1, 10, 30)');
        }
    }
}

if (!function_exists('oderismo_parameters_row')) {
    /**
     * @return array{session: int, session_close: int, time_label: int, time_index: int}
     */
    function oderismo_parameters_row(): array
    {
        if (isset($GLOBALS['__oderismo_parameters']) && is_array($GLOBALS['__oderismo_parameters'])) {
            return $GLOBALS['__oderismo_parameters'];
        }

        $defaults = ['session' => 10, 'session_close' => 1, 'time_label' => 10, 'time_index' => 30];

        try {
            $pdo = oderismo_parameters_pdo();
            oderismo_ensure_parameters_row($pdo);
            $stmt = $pdo->query('SELECT `session`, `session_close`, `time_label`, `time_index` FROM parameters LIMIT 1');
            $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
            if (!$row) {
                $GLOBALS['__oderismo_parameters'] = $defaults;
                return $defaults;
            }
            $session = max(1, (int)$row['session']);
            $sessionClose = (int)($row['session_close'] ?? 1);
            if ($sessionClose < 0) {
                $sessionClose = 0;
            }
            if ($sessionClose >= $session) {
                $sessionClose = max(0, $session - 1);
            }
            $timeLabel = (int)($row['time_label'] ?? 10);
            if ($timeLabel < 2) {
                $timeLabel = 2;
            }
            if ($timeLabel > 600) {
                $timeLabel = 600;
            }
            $timeIndex = (int)($row['time_index'] ?? 30);
            if ($timeIndex < 2) {
                $timeIndex = 2;
            }
            if ($timeIndex > 600) {
                $timeIndex = 600;
            }
            $GLOBALS['__oderismo_parameters'] = [
                'session' => $session,
                'session_close' => $sessionClose,
                'time_label' => $timeLabel,
                'time_index' => $timeIndex,
            ];
            return $GLOBALS['__oderismo_parameters'];
        } catch (Throwable $e) {
            // Tabla inaccesible o columnas aún no migradas.
            try {
                $pdo = oderismo_parameters_pdo();
                oderismo_ensure_parameters_row($pdo);
                $stmt = $pdo->query('SELECT `session`, `session_close`, `time_label` FROM parameters LIMIT 1');
                $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
                if ($row) {
                    $GLOBALS['__oderismo_parameters'] = array_merge($defaults, [
                        'session' => max(1, (int)$row['session']),
                        'session_close' => max(0, (int)($row['session_close'] ?? 1)),
                        'time_label' => max(2, min(600, (int)($row['time_label'] ?? 10))),
                    ]);
                    return $GLOBALS['__oderismo_parameters'];
                }
            } catch (Throwable $ignored) {
            }
            $GLOBALS['__oderismo_parameters'] = $defaults;
            return $defaults;
        }
    }
}

if (!function_exists('oderismo_save_parameters')) {
    /**
     * @return array{session: int, session_close: int, time_label: int, time_index: int}
     */
    function oderismo_save_parameters(
        int $sessionMinutes,
        int $sessionCloseMinutes,
        int $timeLabelSeconds,
        int $timeIndexSeconds
    ): array {
        if ($sessionMinutes < 1 || $sessionMinutes > 1440) {
            throw new InvalidArgumentException('session debe estar entre 1 y 1440 minutos');
        }
        if ($sessionCloseMinutes < 0 || $sessionCloseMinutes >= $sessionMinutes) {
            throw new InvalidArgumentException(
                'session_close debe ser >= 0 y menor que session (duración total)'
            );
        }
        if ($timeLabelSeconds < 2 || $timeLabelSeconds > 600) {
            throw new InvalidArgumentException('time_label debe estar entre 2 y 600 segundos');
        }
        if ($timeIndexSeconds < 2 || $timeIndexSeconds > 600) {
            throw new InvalidArgumentException('time_index debe estar entre 2 y 600 segundos');
        }

        $pdo = oderismo_parameters_pdo();
        oderismo_ensure_parameters_row($pdo);
        try {
            $stmt = $pdo->prepare(
                'UPDATE parameters SET `session` = :session, `session_close` = :session_close, '
                . '`time_label` = :time_label, `time_index` = :time_index'
            );
            $stmt->execute([
                'session' => $sessionMinutes,
                'session_close' => $sessionCloseMinutes,
                'time_label' => $timeLabelSeconds,
                'time_index' => $timeIndexSeconds,
            ]);
        } catch (Throwable $e) {
            $stmt = $pdo->prepare(
                'UPDATE parameters SET `session` = :session, `session_close` = :session_close, `time_label` = :time_label'
            );
            $stmt->execute([
                'session' => $sessionMinutes,
                'session_close' => $sessionCloseMinutes,
                'time_label' => $timeLabelSeconds,
            ]);
        }

        $saved = [
            'session' => $sessionMinutes,
            'session_close' => $sessionCloseMinutes,
            'time_label' => $timeLabelSeconds,
            'time_index' => $timeIndexSeconds,
        ];
        $GLOBALS['__oderismo_parameters'] = $saved;
        return $saved;
    }
}

/** @deprecated Usar oderismo_save_parameters() */
if (!function_exists('oderismo_save_parameters_session_minutes')) {
    function oderismo_save_parameters_session_minutes(int $minutes): int
    {
        $row = oderismo_parameters_row();
        $saved = oderismo_save_parameters(
            $minutes,
            (int)$row['session_close'],
            (int)$row['time_label'],
            (int)($row['time_index'] ?? 30)
        );
        return $saved['session'];
    }
}
