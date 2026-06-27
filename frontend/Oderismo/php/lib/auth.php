<?php
declare(strict_types=1);

function oderismo_b64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function oderismo_b64url_decode(string $data): string
{
    $pad = strlen($data) % 4;
    if ($pad !== 0) {
        $data .= str_repeat('=', 4 - $pad);
    }
    $decoded = base64_decode(strtr($data, '-_', '+/'), true);
    if ($decoded === false) {
        throw new RuntimeException('Base64 inválido');
    }
    return $decoded;
}

/** Duración del JWT de sesión (segundos) desde `parameters.session` (minutos). */
function oderismo_jwt_ttl_seconds(): int
{
    require_once __DIR__ . '/app_settings.php';
    $row = oderismo_parameters_row();
    return max(60, (int)$row['session'] * 60);
}

/** Segundos de aviso antes del cierre desde `parameters.session_close` (minutos). */
function oderismo_session_warning_before_seconds(): int
{
    require_once __DIR__ . '/app_settings.php';
    $row = oderismo_parameters_row();
    $ttl = oderismo_jwt_ttl_seconds();
    $closeMinutes = max(0, (int)$row['session_close']);
    return min($closeMinutes * 60, max(0, $ttl - 1));
}

/** Parámetros globales de sesión (API + frontend). */
function oderismo_session_config(): array
{
    require_once __DIR__ . '/app_settings.php';
    $row = oderismo_parameters_row();
    $sessionMinutes = max(1, (int)$row['session']);
    $sessionCloseMinutes = max(0, (int)$row['session_close']);
    $ttlSeconds = $sessionMinutes * 60;
    $warnSeconds = min($sessionCloseMinutes * 60, max(0, $ttlSeconds - 1));

    return [
        'session' => $sessionMinutes,
        'session_close' => $sessionCloseMinutes,
        'session_ttl_seconds' => $ttlSeconds,
        'session_warning_before_seconds' => $warnSeconds,
    ];
}

/** Metadatos de sesión para respuestas JSON (incluye expires_at del JWT si se pasa). */
function oderismo_auth_session_meta(?string $jwt = null): array
{
    $meta = oderismo_session_config();
    if ($jwt !== null && $jwt !== '') {
        try {
            $payload = oderismo_jwt_verify_hs256($jwt, oderismo_jwt_secret());
            if (isset($payload['exp'])) {
                $meta['expires_at'] = (int)$payload['exp'];
            }
        } catch (Throwable $e) {
            // Sin expires_at si el token no es válido.
        }
    }
    return $meta;
}

function oderismo_jwt_secret(): string
{
    $secret = getenv('JWT_SECRET') ?: '';
    if ($secret !== '') {
        return $secret;
    }

    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../config/database.php';
    }
    $local = oderismo_local_override();
    if (is_array($local) && !empty($local['jwt_secret']) && is_string($local['jwt_secret'])) {
        return $local['jwt_secret'];
    }

    // Fallback: evita romper si no hay JWT_SECRET ni jwt_secret en local.
    return hash('sha256', ($_SERVER['HTTP_HOST'] ?? 'localhost') . '|oderismo');
}

function oderismo_jwt_hs256(array $payload, string $secret, int $ttlSeconds): string
{
    $now = time();
    $header = ['alg' => 'HS256', 'typ' => 'JWT'];
    $payload = array_merge($payload, [
        'iat' => $now,
        'exp' => $now + $ttlSeconds,
    ]);

    $h = oderismo_b64url_encode(json_encode($header, JSON_UNESCAPED_UNICODE));
    $p = oderismo_b64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $sig = hash_hmac('sha256', $h . '.' . $p, $secret, true);
    return $h . '.' . $p . '.' . oderismo_b64url_encode($sig);
}

function oderismo_jwt_verify_hs256(string $jwt, string $secret): array
{
    $parts = explode('.', $jwt);
    if (count($parts) !== 3) {
        throw new RuntimeException('JWT inválido');
    }
    [$h64, $p64, $s64] = $parts;
    $sig = oderismo_b64url_decode($s64);
    $expected = hash_hmac('sha256', $h64 . '.' . $p64, $secret, true);
    if (!hash_equals($expected, $sig)) {
        throw new RuntimeException('Firma inválida');
    }
    $payloadJson = oderismo_b64url_decode($p64);
    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        throw new RuntimeException('JWT inválido');
    }
    $exp = isset($payload['exp']) ? (int)$payload['exp'] : 0;
    if ($exp !== 0 && time() > $exp) {
        throw new RuntimeException('Token caducado');
    }
    return $payload;
}

function oderismo_authorization_header_value(): ?string
{
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
    ];

    if (function_exists('apache_request_headers')) {
        $apache = apache_request_headers();
        if (is_array($apache)) {
            foreach ($apache as $name => $value) {
                if (strcasecmp((string)$name, 'Authorization') === 0) {
                    $candidates[] = $value;
                }
            }
        }
    }

    if (function_exists('getallheaders')) {
        $all = getallheaders();
        if (is_array($all)) {
            foreach ($all as $name => $value) {
                if (strcasecmp((string)$name, 'Authorization') === 0) {
                    $candidates[] = $value;
                }
            }
        }
    }

    foreach ($candidates as $h) {
        if (is_string($h) && $h !== '') {
            return $h;
        }
    }
    return null;
}

function oderismo_get_bearer_token(): ?string
{
    $h = oderismo_authorization_header_value();
    if ($h !== null && stripos($h, 'Bearer ') === 0) {
        $t = trim(substr($h, 7));
        if ($t !== '') return $t;
    }
    // <img src> no puede enviar Authorization; ?token= en proxy de medios.
    $q = isset($_GET['token']) ? trim((string)$_GET['token']) : '';
    return $q !== '' ? $q : null;
}

function oderismo_current_user_payload(): ?array
{
    $t = oderismo_get_bearer_token();
    if (!$t) return null;
    try {
        return oderismo_jwt_verify_hs256($t, oderismo_jwt_secret());
    } catch (Throwable $e) {
        return null;
    }
}

function oderismo_user_roles(array $payload): array
{
    $roles = $payload['roles'] ?? [];
    if (!is_array($roles)) return [];
    $out = [];
    foreach ($roles as $r) {
        if (!is_string($r) || $r === '') continue;
        $out[] = strtoupper($r);
    }
    return array_values(array_unique($out));
}

function oderismo_user_has_role(array $payload, string $roleCode): bool
{
    $roleCode = strtoupper(trim($roleCode));
    if ($roleCode === '') return false;
    return in_array($roleCode, oderismo_user_roles($payload), true);
}

function oderismo_require_any_role(array $payload, array $roleCodes): void
{
    foreach ($roleCodes as $c) {
        if (is_string($c) && $c !== '' && oderismo_user_has_role($payload, $c)) return;
    }
    throw new RuntimeException('FORBIDDEN');
}
