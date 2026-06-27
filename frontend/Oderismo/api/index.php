<?php
declare(strict_types=1);

// API minimal para el frontend (misma forma que FastAPI /api/*).
// Se monta bajo /ucatedra/oderismo/api/ en Apache.

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../php/lib/auth.php';

// Compatibilidad: estas funciones existen desde PHP 8.
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool
    {
        if ($needle === '') return true;
        return substr($haystack, 0, strlen($needle)) === $needle;
    }
}
if (!function_exists('str_contains')) {
    function str_contains(string $haystack, string $needle): bool
    {
        if ($needle === '') return true;
        return strpos($haystack, $needle) !== false;
    }
}

function json_out(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function debug_enabled(): bool
{
    // 1) Activación global por entorno.
    $v = getenv('API_DEBUG') ?: '';
    if ($v === '1' || strtolower($v) === 'true') return true;

    // 2) Activación puntual por query param + token.
    //    Útil cuando no se puede tocar la config del servidor.
    if (($_GET['debug'] ?? '') !== '1') return false;
    $expected = getenv('API_DEBUG_TOKEN') ?: '';
    if ($expected === '') return false;
    $provided = (string)($_GET['token'] ?? '');
    return $provided !== '' && hash_equals($expected, $provided);
}

function server_error(string $publicMsg, ?Throwable $e = null): void
{
    $payload = ['detail' => $publicMsg];
    if (debug_enabled() && $e) {
        $payload['debug'] = [
            'type' => get_class($e),
            'message' => $e->getMessage(),
        ];
    }
    json_out($payload, 500);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) json_out(['detail' => 'JSON inválido'], 400);
    return $data;
}

function is_legacy_hex_hash(?string $storedHash): bool
{
    if ($storedHash === null) return true;
    $h = trim($storedHash);
    return ($h === '') || (strlen($h) === 64 && ctype_xdigit($h));
}

/** Hash antiguo del dump: SHA-256 de la contraseña en hex (64 caracteres). */
function legacy_password_matches(string $storedHash, string $password): bool
{
    $stored = strtolower(trim($storedHash));
    if (strlen($stored) !== 64 || !ctype_xdigit($stored)) {
        return false;
    }
    return hash_equals($stored, hash('sha256', $password));
}

function api_path(): string
{
    // Extrae la parte a partir de /api
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH) ?: '/';
    $pos = strpos($path, '/api');
    if ($pos === false) return '/';
    $sub = substr($path, $pos + 4); // sin "/api"
    $sub = '/' . ltrim((string)$sub, '/');
    return rtrim($sub, '/') ?: '/';
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$methodOverride = trim((string)(
    $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']
    ?? $_SERVER['HTTP_X_HTTP_METHOD']
    ?? $_GET['_method']
    ?? ''
));
if ($methodOverride !== '') {
    $method = strtoupper($methodOverride);
}
$path = api_path();

function oderismo_pdo(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    if (!function_exists('oderismo_database_module')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $pdoFactory = oderismo_database_module()['pdo'] ?? null;
    if (!is_callable($pdoFactory)) throw new RuntimeException('DB factory no disponible');
    /** @var PDO $pdo */
    $pdo = $pdoFactory();
    return $pdo;
}

function client_ip_address(): ?string
{
    $candidates = [
        $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null,
        $_SERVER['HTTP_CLIENT_IP'] ?? null,
        $_SERVER['REMOTE_ADDR'] ?? null,
    ];

    foreach ($candidates as $value) {
        if (!is_string($value) || trim($value) === '') {
            continue;
        }
        $ip = trim(explode(',', $value)[0]);
        return $ip !== '' ? substr($ip, 0, 45) : null;
    }
    return null;
}

function activity_action_for_request(string $method, string $path): string
{
    if ($path === '/auth/me') return 'session_validate';
    if ($path === '/auth/refresh') return 'session_refresh';
    if (str_starts_with($path, '/admin/')) return 'admin_request';
    if ($method !== 'GET') return 'data_change';
    return 'api_request';
}

function activity_log(PDO $pdo, ?int $userId, ?string $email, string $action, array $details = []): void
{
    global $method, $path;

    try {
        $detailsJson = $details
            ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : null;

        $stmt = $pdo->prepare(
            "INSERT INTO user_activity_logs
                (user_id, user_email, action, method, path, ip_address, user_agent, details)
             VALUES
                (:user_id, :user_email, :action, :method, :path, :ip_address, :user_agent, :details)"
        );
        $stmt->execute([
            'user_id' => $userId && $userId > 0 ? $userId : null,
            'user_email' => $email !== null && $email !== '' ? substr($email, 0, 255) : null,
            'action' => substr($action, 0, 80),
            'method' => $method,
            'path' => substr($path, 0, 255),
            'ip_address' => client_ip_address(),
            'user_agent' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 512),
            'details' => $detailsJson,
        ]);
    } catch (Throwable $e) {
        error_log('activity_log: ' . $e->getMessage());
    }
}

function activity_client_details_from_body(array $body): array
{
    $client = isset($body['client']) && is_array($body['client']) ? $body['client'] : [];
    $out = [];
    foreach (['source', 'timezone', 'language', 'platform', 'screen'] as $key) {
        if (!isset($client[$key]) || !is_scalar($client[$key])) {
            continue;
        }
        $value = trim((string)$client[$key]);
        if ($value !== '') {
            $out[$key] = substr($value, 0, 120);
        }
    }
    return $out;
}

function activity_log_authenticated_request(array $payload): void
{
    global $method, $path;

    static $logged = [];
    $uid = isset($payload['uid']) ? (int)$payload['uid'] : null;
    $email = isset($payload['email']) ? (string)$payload['email'] : null;
    $key = ($uid ?? 0) . '|' . $method . '|' . $path;
    if (isset($logged[$key])) {
        return;
    }
    $logged[$key] = true;

    try {
        activity_log(oderismo_pdo(), $uid, $email, activity_action_for_request($method, $path), [
            'query' => $_GET ? array_diff_key($_GET, ['token' => true]) : null,
        ]);
    } catch (Throwable $e) {
        error_log('activity_log_authenticated_request: ' . $e->getMessage());
    }
}

function auth_payload_or_401(): array
{
    $p = oderismo_current_user_payload();
    if (!$p) json_out(['detail' => 'No autenticado'], 401);
    activity_log_authenticated_request($p);
    return $p;
}

function require_any_role_or_403(array $payload, array $roleCodes): void
{
    try {
        oderismo_require_any_role($payload, $roleCodes);
    } catch (RuntimeException $e) {
        if ($e->getMessage() === 'FORBIDDEN') json_out(['detail' => 'Permiso denegado'], 403);
        throw $e;
    }
}

function fastapi_base_url(): string
{
    // Motor IA (FastAPI) - no se reescribe, solo se consume.
    // Permite override por entorno.
    $base = getenv('ETIQUETAS_API_BASE') ?: '';
    if ($base === '') $base = 'https://a22.uca.es/backend-etiquetas/api';
    return rtrim($base, '/');
}

/**
 * Token para llamadas servidor→FastAPI (distinto del JWT de login Oderismo/MySQL).
 * Configuración (una opción):
 *   - ETIQUETAS_SERVICE_TOKEN en entorno, o
 *   - etiquetas_service_token en database.local.php, o
 *   - ETIQUETAS_SERVICE_EMAIL + ETIQUETAS_SERVICE_PASSWORD (login /api/auth/login del motor).
 */
function fastapi_service_bearer(): ?string
{
    static $cachedToken = null;
    static $cachedUntil = 0;

    $fixed = getenv('ETIQUETAS_SERVICE_TOKEN') ?: '';
    if ($fixed !== '') {
        return $fixed;
    }

    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    if (is_array($local) && !empty($local['etiquetas_service_token']) && is_string($local['etiquetas_service_token'])) {
        return $local['etiquetas_service_token'];
    }

    $email = getenv('ETIQUETAS_SERVICE_EMAIL') ?: '';
    $password = getenv('ETIQUETAS_SERVICE_PASSWORD') ?: '';
    if (is_array($local)) {
        if ($email === '' && !empty($local['etiquetas_service_email']) && is_string($local['etiquetas_service_email'])) {
            $email = $local['etiquetas_service_email'];
        }
        if ($password === '' && !empty($local['etiquetas_service_password']) && is_string($local['etiquetas_service_password'])) {
            $password = $local['etiquetas_service_password'];
        }
    }

    if ($email === '' || $password === '') {
        return null;
    }

    if (is_string($cachedToken) && $cachedToken !== '' && time() < $cachedUntil) {
        return $cachedToken;
    }

    $url = fastapi_base_url() . '/auth/login';
    $ch = curl_init($url);
    if ($ch === false) return null;
    $body = json_encode(['email' => $email, 'password' => $password], JSON_UNESCAPED_UNICODE);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false || $code < 200 || $code >= 300) {
        return null;
    }
    $data = json_decode((string)$raw, true);
    $token = is_array($data) ? ($data['access_token'] ?? null) : null;
    if (!is_string($token) || $token === '') {
        return null;
    }

    $cachedToken = $token;
    $cachedUntil = time() + (23 * 3600);
    return $cachedToken;
}

function fastapi_service_error_response(): void
{
    json_out([
        'detail' => 'No se pudo autenticar con el motor de etiquetas (a22). '
            . 'En el servidor sibila, edita php/config/database.local.php y define '
            . 'etiquetas_service_email y etiquetas_service_password '
            . '(usuario del POST /backend-etiquetas/api/auth/login), o etiquetas_service_token.',
        'code' => 'ETIQUETAS_SERVICE_UNAVAILABLE',
    ], 502);
}

function link_secret(): string
{
    $s = getenv('LINK_SECRET') ?: '';
    return $s !== '' ? $s : oderismo_jwt_secret();
}

function signed_link_token(array $payload, string $secret): string
{
    $p = oderismo_b64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $sig = hash_hmac('sha256', $p, $secret, true);
    return $p . '.' . oderismo_b64url_encode($sig);
}

function verify_signed_link_token(string $token, string $secret): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 2) throw new RuntimeException('Token inválido');
    [$p64, $s64] = $parts;
    $sig = oderismo_b64url_decode($s64);
    $expected = hash_hmac('sha256', $p64, $secret, true);
    if (!hash_equals($expected, $sig)) throw new RuntimeException('Token inválido');
    $payloadJson = oderismo_b64url_decode($p64);
    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) throw new RuntimeException('Token inválido');
    $exp = isset($payload['exp']) ? (int)$payload['exp'] : 0;
    if ($exp !== 0 && time() > $exp) throw new RuntimeException('Token caducado');
    return $payload;
}

function oderismo_public_base_url(): string
{
    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    if (is_array($local) && !empty($local['public_url']) && is_string($local['public_url'])) {
        return rtrim($local['public_url'], '/');
    }
    $env = getenv('APP_PUBLIC_URL') ?: '';
    if ($env !== '') {
        return rtrim($env, '/');
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '/api/index.php';
    $basePath = dirname(dirname($script));
    if ($basePath === '/' || $basePath === '\\' || $basePath === '.') {
        $basePath = '';
    }
    return $scheme . '://' . $host . $basePath;
}

function should_expose_reset_link(): bool
{
    if (debug_enabled()) {
        return true;
    }
    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    return is_array($local) && !empty($local['dev_expose_reset_links']);
}

function password_reset_token_for_user(array $user, int $ttlSeconds = 3600): string
{
    $hash = (string)($user['password_hash'] ?? '');
    return signed_link_token([
        'uid' => (int)$user['id'],
        'exp' => time() + $ttlSeconds,
        'ph' => hash('sha256', $hash),
    ], link_secret());
}

function activation_url_for_user(array $user, int $ttlSeconds = 86400): string
{
    $token = password_reset_token_for_user($user, $ttlSeconds);
    return oderismo_public_base_url()
        . '/establecer-contrasena.html?token='
        . rawurlencode($token);
}

function mail_config_value(string $localKey, string $envKey, string $default = ''): string
{
    $env = getenv($envKey) ?: '';
    if ($env !== '') {
        return $env;
    }

    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    if (is_array($local) && isset($local[$localKey]) && is_scalar($local[$localKey])) {
        $value = trim((string)$local[$localKey]);
        if ($value !== '') {
            return $value;
        }
    }

    return $default;
}

function mail_config_source(string $localKey, string $envKey): string
{
    $env = getenv($envKey) ?: '';
    if ($env !== '') {
        return 'env:' . $envKey;
    }

    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    if (is_array($local) && isset($local[$localKey]) && is_scalar($local[$localKey])
        && trim((string)$local[$localKey]) !== '') {
        return 'database.local.php:' . $localKey;
    }

    return 'default';
}

function mail_local_config_mtime(): ?string
{
    $path = __DIR__ . '/../php/config/database.local.php';
    if (!is_file($path)) {
        return null;
    }
    $mtime = filemtime($path);
    if ($mtime === false) {
        return null;
    }
    return (new DateTimeImmutable('@' . $mtime))->format(DateTimeInterface::ATOM);
}

function smtp_mail_config(): array
{
    $user = mail_config_value('smtp_user', 'SMTP_USER');
    $from = mail_config_value('mail_from', 'MAIL_FROM', $user);
    $password = preg_replace('/\s+/', '', mail_config_value('smtp_password', 'SMTP_PASSWORD')) ?? '';

    return [
        'host' => mail_config_value('smtp_host', 'SMTP_HOST'),
        'port' => (int)mail_config_value('smtp_port', 'SMTP_PORT', '587'),
        'secure' => strtolower(mail_config_value('smtp_secure', 'SMTP_SECURE', 'tls')),
        'user' => $user,
        'password' => $password,
        'from' => $from,
        'from_name' => mail_config_value('mail_from_name', 'MAIL_FROM_NAME', 'Oderismo'),
    ];
}

function mail_debug_enabled(): bool
{
    $env = getenv('MAIL_DEBUG') ?: '';
    if ($env !== '') {
        return in_array(strtolower($env), ['1', 'true', 'yes', 'on'], true);
    }

    if (!function_exists('oderismo_local_override')) {
        require_once __DIR__ . '/../php/config/database.php';
    }
    $local = oderismo_local_override();
    return is_array($local) && !empty($local['mail_debug']);
}

function mail_log_path(): string
{
    return mail_config_value('mail_log_path', 'MAIL_LOG_PATH');
}

function mail_mask_email(string $email): string
{
    $email = trim($email);
    if ($email === '' || !str_contains($email, '@')) {
        return $email;
    }
    [$local, $domain] = explode('@', $email, 2);
    $first = substr($local, 0, 1);
    return $first . str_repeat('*', max(1, strlen($local) - 1)) . '@' . $domain;
}

function mail_log_sanitize(array $context): array
{
    $out = [];
    foreach ($context as $key => $value) {
        $lower = strtolower((string)$key);
        if (in_array($lower, ['password_source', 'password_length'], true)) {
            $out[$key] = $value;
            continue;
        }
        if (str_contains($lower, 'password') || str_contains($lower, 'token') || str_contains($lower, 'secret')) {
            $out[$key] = '[redacted]';
            continue;
        }
        if (is_array($value)) {
            $out[$key] = mail_log_sanitize($value);
            continue;
        }
        if (is_scalar($value) || $value === null) {
            $out[$key] = $value;
        } else {
            $out[$key] = gettype($value);
        }
    }
    return $out;
}

function mail_log(string $event, array $context = []): void
{
    if (!mail_debug_enabled()) {
        return;
    }

    $payload = [
        'ts' => (new DateTimeImmutable('now'))->format(DateTimeInterface::ATOM),
        'event' => $event,
        'context' => mail_log_sanitize($context),
    ];
    $line = '[oderismo-mail] ' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    error_log($line);

    $path = mail_log_path();
    if ($path === '') {
        return;
    }
    $paths = [$path, rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'oderismo-mail.log'];
    foreach ($paths as $candidate) {
        $dir = dirname($candidate);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        if (@file_put_contents($candidate, $line . PHP_EOL, FILE_APPEND | LOCK_EX) !== false) {
            return;
        }
    }
}

function mail_last_error(?string $message = null): string
{
    if ($message !== null) {
        $GLOBALS['oderismo_last_mail_error'] = $message;
    }
    return isset($GLOBALS['oderismo_last_mail_error'])
        ? (string)$GLOBALS['oderismo_last_mail_error']
        : '';
}

function smtp_is_configured(array $cfg): bool
{
    return ($cfg['host'] ?? '') !== ''
        && ($cfg['user'] ?? '') !== ''
        && ($cfg['password'] ?? '') !== ''
        && ($cfg['from'] ?? '') !== '';
}

function smtp_read_response($stream, array $expectedCodes, string $step = 'response'): string
{
    $response = '';
    while (($line = fgets($stream, 515)) !== false) {
        $response .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') {
            break;
        }
    }
    $code = (int)substr($response, 0, 3);
    mail_log('smtp.response', [
        'step' => $step,
        'code' => $code,
        'expected' => $expectedCodes,
        'line' => trim(strtok($response, "\n") ?: $response),
    ]);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('SMTP respuesta inesperada: ' . trim($response));
    }
    return $response;
}

function smtp_command($stream, string $command, array $expectedCodes, ?string $logLabel = null): string
{
    mail_log('smtp.command', ['command' => $logLabel ?? $command]);
    fwrite($stream, $command . "\r\n");
    return smtp_read_response($stream, $expectedCodes, $logLabel ?? $command);
}

function smtp_dot_stuff(string $body): string
{
    $body = str_replace(["\r\n", "\r"], "\n", $body);
    $lines = explode("\n", $body);
    foreach ($lines as $i => $line) {
        if (str_starts_with($line, '.')) {
            $lines[$i] = '.' . $line;
        }
    }
    return implode("\r\n", $lines);
}

function smtp_send_mail(array $cfg, string $to, string $subject, string $body): bool
{
    $host = (string)$cfg['host'];
    $port = (int)$cfg['port'];
    $secure = (string)$cfg['secure'];
    $target = (($secure === 'ssl' || $secure === 'smtps') ? 'ssl://' : '') . $host . ':' . $port;
    mail_log('smtp.start', [
        'host' => $host,
        'port' => $port,
        'secure' => $secure,
        'user' => mail_mask_email((string)$cfg['user']),
        'from' => mail_mask_email((string)$cfg['from']),
        'to' => mail_mask_email($to),
    ]);
    mail_log('smtp.config_summary', [
        'host_source' => mail_config_source('smtp_host', 'SMTP_HOST'),
        'port_source' => mail_config_source('smtp_port', 'SMTP_PORT'),
        'secure_source' => mail_config_source('smtp_secure', 'SMTP_SECURE'),
        'user_source' => mail_config_source('smtp_user', 'SMTP_USER'),
        'password_source' => mail_config_source('smtp_password', 'SMTP_PASSWORD'),
        'from_source' => mail_config_source('mail_from', 'MAIL_FROM'),
        'password_length' => strlen((string)$cfg['password']),
        'local_config_mtime' => mail_local_config_mtime(),
    ]);
    $stream = @stream_socket_client($target, $errno, $errstr, 20, STREAM_CLIENT_CONNECT);
    if (!$stream) {
        mail_log('smtp.connect_failed', [
            'errno' => $errno,
            'errstr' => $errstr,
            'target' => $target,
        ]);
        throw new RuntimeException('No se pudo conectar al SMTP: ' . $errstr);
    }

    try {
        stream_set_timeout($stream, 20);
        mail_log('smtp.connected', ['target' => $target]);
        smtp_read_response($stream, [220], 'banner');
        $ehloHost = $_SERVER['HTTP_HOST'] ?? 'localhost';
        smtp_command($stream, 'EHLO ' . $ehloHost, [250], 'EHLO');

        if ($secure === 'tls' || $secure === 'starttls') {
            smtp_command($stream, 'STARTTLS', [220], 'STARTTLS');
            $cryptoOk = stream_socket_enable_crypto($stream, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($cryptoOk !== true) {
                mail_log('smtp.tls_failed', ['result' => $cryptoOk]);
                throw new RuntimeException('No se pudo activar TLS en SMTP');
            }
            mail_log('smtp.tls_enabled');
            smtp_command($stream, 'EHLO ' . $ehloHost, [250], 'EHLO after STARTTLS');
        }

        smtp_command($stream, 'AUTH LOGIN', [334], 'AUTH LOGIN');
        smtp_command($stream, base64_encode((string)$cfg['user']), [334], 'AUTH username');
        smtp_command($stream, base64_encode((string)$cfg['password']), [235], 'AUTH password');
        smtp_command($stream, 'MAIL FROM:<' . (string)$cfg['from'] . '>', [250], 'MAIL FROM');
        smtp_command($stream, 'RCPT TO:<' . $to . '>', [250, 251], 'RCPT TO');
        smtp_command($stream, 'DATA', [354], 'DATA');

        $fromName = trim((string)$cfg['from_name']);
        $fromHeader = $fromName !== ''
            ? sprintf('"%s" <%s>', addcslashes($fromName, "\\\""), (string)$cfg['from'])
            : '<' . (string)$cfg['from'] . '>';
        $message = [
            'From: ' . $fromHeader,
            'To: <' . $to . '>',
            'Subject: ' . $subject,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            smtp_dot_stuff($body),
        ];
        fwrite($stream, implode("\r\n", $message) . "\r\n.\r\n");
        smtp_read_response($stream, [250], 'message body');
        mail_log('smtp.accepted', [
            'to' => mail_mask_email($to),
            'subject' => $subject,
        ]);
        smtp_command($stream, 'QUIT', [221], 'QUIT');
    } finally {
        fclose($stream);
        mail_log('smtp.closed');
    }

    return true;
}

function send_activation_email(string $email, string $fullName, string $activationUrl): bool
{
    mail_last_error('');
    mail_log('mail.activation.start', ['to' => mail_mask_email($email)]);
    $subject = 'Activacion de cuenta Oderismo';
    $name = trim($fullName) !== '' ? trim($fullName) : $email;
    $body = "Hola {$name},\n\n"
        . "Tu solicitud para ser investigador de la coleccion en Oderismo ha sido aprobada.\n\n"
        . "Para activar tu cuenta y establecer tu contrasena, abre este enlace:\n"
        . $activationUrl . "\n\n"
        . "El enlace caduca en 24 horas.\n\n"
        . "Oderismo";

    $smtp = smtp_mail_config();
    if (smtp_is_configured($smtp)) {
        try {
            $sent = smtp_send_mail($smtp, $email, $subject, $body);
            mail_log('mail.activation.sent_smtp', ['to' => mail_mask_email($email)]);
            return $sent;
        } catch (Throwable $e) {
            mail_last_error($e->getMessage());
            mail_log('mail.activation.smtp_exception', ['error' => $e->getMessage()]);
            // Fallback a mail() si el servidor lo tiene configurado.
        }
    } else {
        mail_last_error('SMTP no configurado completamente');
        mail_log('mail.activation.smtp_not_configured');
    }

    $from = mail_config_value('mail_from', 'MAIL_FROM');
    $headers = [];
    if ($from !== '') {
        $headers[] = 'From: ' . $from;
        $headers[] = 'Reply-To: ' . $from;
    }
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';

    $sent = @mail($email, $subject, $body, implode("\r\n", $headers));
    if (!$sent && mail_last_error() === '') {
        mail_last_error('mail() devolvió false');
    }
    mail_log('mail.activation.mail_fallback_result', [
        'sent' => $sent,
        'last_error' => mail_last_error(),
    ]);
    return $sent;
}

function send_password_link_email(string $email, ?string $fullName, string $resetUrl, bool $firstSetup = false): bool
{
    mail_last_error('');
    mail_log('mail.password_link.start', [
        'to' => mail_mask_email($email),
        'first_setup' => $firstSetup,
    ]);
    $subject = $firstSetup ? 'Activa tu cuenta Oderismo' : 'Recuperacion de contrasena Oderismo';
    $name = trim((string)$fullName) !== '' ? trim((string)$fullName) : $email;
    $intro = $firstSetup
        ? 'Tu cuenta de Oderismo necesita establecer una contrasena para activarse.'
        : 'Hemos recibido una solicitud para recuperar la contrasena de tu cuenta de Oderismo.';
    $body = "Hola {$name},\n\n"
        . $intro . "\n\n"
        . "Abre este enlace para establecer una nueva contrasena:\n"
        . $resetUrl . "\n\n"
        . "El enlace caduca en 1 hora. Si no has solicitado este correo, puedes ignorarlo.\n\n"
        . "Oderismo";

    $smtp = smtp_mail_config();
    if (smtp_is_configured($smtp)) {
        try {
            $sent = smtp_send_mail($smtp, $email, $subject, $body);
            mail_log('mail.password_link.sent_smtp', ['to' => mail_mask_email($email)]);
            return $sent;
        } catch (Throwable $e) {
            mail_last_error($e->getMessage());
            mail_log('mail.password_link.smtp_exception', ['error' => $e->getMessage()]);
            // Fallback a mail() si el servidor lo tiene configurado.
        }
    } else {
        mail_last_error('SMTP no configurado completamente');
        mail_log('mail.password_link.smtp_not_configured');
    }

    $from = mail_config_value('mail_from', 'MAIL_FROM');
    $headers = [];
    if ($from !== '') {
        $headers[] = 'From: ' . $from;
        $headers[] = 'Reply-To: ' . $from;
    }
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';

    $sent = @mail($email, $subject, $body, implode("\r\n", $headers));
    if (!$sent && mail_last_error() === '') {
        mail_last_error('mail() devolvió false');
    }
    mail_log('mail.password_link.mail_fallback_result', [
        'sent' => $sent,
        'last_error' => mail_last_error(),
    ]);
    return $sent;
}

function fastapi_public_base_url(): string
{
    return preg_replace('#/api$#', '', fastapi_base_url());
}

function oderismo_media_url_with_token(string $pathOrUrl, string $bearer): string
{
    $u = trim($pathOrUrl);
    if ($u === '' || str_contains($u, 'token=')) {
        return $u;
    }
    if (str_starts_with($u, '/images/') || str_starts_with($u, '/thumbs/')) {
        $u = fastapi_public_base_url() . $u;
    }
    $sep = str_contains($u, '?') ? '&' : '?';
    return $u . $sep . 'token=' . rawurlencode($bearer);
}

function enrich_images_json_response(array $data, string $bearer): array
{
    if ($bearer === '' || !isset($data['images']) || !is_array($data['images'])) {
        return $data;
    }
    foreach ($data['images'] as $i => $img) {
        if (!is_array($img) || empty($img['url'])) {
            continue;
        }
        $data['images'][$i]['url'] = oderismo_media_url_with_token((string)$img['url'], $bearer);
    }
    return $data;
}

function stream_fastapi_image_file(string $filename, bool $thumb = false): void
{
    $file = basename($filename);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $file)) {
        json_out(['detail' => 'Nombre de fichero inválido'], 400);
    }
    $segment = $thumb ? 'thumbs' : 'images';
    stream_fastapi_binary('/' . $segment . '/' . rawurlencode($file), 'image/png');
}

function stream_fastapi_binary(string $relativePath, string $fallbackContentType = 'application/octet-stream'): void
{
    $relativePath = '/' . ltrim($relativePath, '/');
    $bearer = fastapi_service_bearer();
    if (!$bearer) {
        fastapi_service_error_response();
    }

    $url = fastapi_public_base_url() . $relativePath;
    if (str_starts_with($relativePath, '/images/') || str_starts_with($relativePath, '/thumbs/')) {
        $url .= (str_contains($url, '?') ? '&' : '?') . 'token=' . rawurlencode($bearer);
    }
    $ch = curl_init($url);
    if ($ch === false) server_error('No se pudo conectar al motor de imágenes');

    $headers = [
        'Accept: */*',
        'Authorization: Bearer ' . $bearer,
    ];
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    if (is_string($referer) && $referer !== '') {
        $headers[] = 'Referer: ' . $referer;
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($body === false) {
        server_error('Error leyendo recurso del motor');
    }
    if ($code === 404) {
        json_out(['detail' => 'Imagen no encontrada'], 404);
    }
    if ($code < 200 || $code >= 300) {
        json_out(['detail' => 'Error obteniendo imagen del motor'], $code >= 400 && $code < 600 ? $code : 502);
    }

    $mime = $contentType !== '' ? strtok($contentType, ';') : $fallbackContentType;
    header('Content-Type: ' . $mime);
    header('Cache-Control: private, max-age=3600');
    echo $body;
    exit;
}

function proxy_to_fastapi(string $upstreamPath): void
{
    $url = fastapi_base_url() . $upstreamPath;
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    $ch = curl_init($url);
    if ($ch === false) server_error('No se pudo inicializar proxy');

    $headers = [];
    $headers[] = 'Accept: ' . ($_SERVER['HTTP_ACCEPT'] ?? '*/*');

    // Token del motor FastAPI (no el JWT de Oderismo). Permisos ya validados en PHP.
    $bearer = fastapi_service_bearer();
    if ($bearer) {
        $headers[] = 'Authorization: Bearer ' . $bearer;
    }

    // Importante para multipart y JSON.
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (is_string($contentType) && $contentType !== '') {
        $headers[] = 'Content-Type: ' . $contentType;
    }

    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_HEADER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 0); // streams largos (SSE)
    curl_setopt($ch, CURLOPT_ENCODING, ''); // descomprimir gzip del motor antes de reenviar

    // Reenviar cuerpo (JSON o multipart).
    // Nota: en esta fase lo reenviamos como bytes para mantener compatibilidad con multipart.
    // (Optimizable más adelante para evitar cargar ficheros grandes en memoria.)
    $len = $_SERVER['CONTENT_LENGTH'] ?? null;
    if (!in_array($method, ['GET', 'HEAD'], true) && is_string($len) && ctype_digit($len) && (int)$len > 0) {
        $body = file_get_contents('php://input');
        if ($body !== false) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
    }

    // Forward de SSE / chunks (cabeceras ANTES de cualquier echo).
    header_remove('Content-Type');
    $isUploadBatch = str_contains($upstreamPath, '/upload/batch/');
    $downstreamContentType = $isUploadBatch
        ? 'text/event-stream; charset=utf-8'
        : 'application/json; charset=utf-8';

    if ($isUploadBatch) {
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('X-Accel-Buffering: no');
        header('Connection: keep-alive');
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        @ini_set('zlib.output_compression', '0');
        @ini_set('output_buffering', 'off');
        @ini_set('implicit_flush', '1');
    }
    header('Content-Type: ' . $downstreamContentType);

    if ($isUploadBatch) {
        echo ": oderismo-stream\n\n";
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }

    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, string $data): int {
        echo $data;
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
        return strlen($data);
    });

    $ok = curl_exec($ch);

    if ($ok === false) {
        $err = curl_error($ch);
        curl_close($ch);
        server_error('Error proxy FastAPI', new RuntimeException($err));
    }
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    http_response_code($code ?: 502);
    exit;
}

// Health (útil para comprobar rutas)
if ($method === 'GET' && ($path === '/' || $path === '/health')) {
    json_out(['ok' => true, 'service' => 'oderismo-php-api']);
}

// Debug: inspección mínima de esquema (solo si debug_enabled() == true)
if ($method === 'GET' && $path === '/debug/schema') {
    if (!debug_enabled()) json_out(['detail' => 'Not found'], 404);

    try {
        $pdo = oderismo_pdo();

        $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_NUM);
        $tableNames = array_map(fn ($r) => (string)$r[0], $tables ?: []);

        $usersDescribe = null;
        if (in_array('users', $tableNames, true)) {
            $usersDescribe = $pdo->query('DESCRIBE users')->fetchAll(PDO::FETCH_ASSOC);
        }

        $notesDescribe = null;
        if (in_array('collections_notes', $tableNames, true)) {
            $notesDescribe = $pdo->query('DESCRIBE collections_notes')->fetchAll(PDO::FETCH_ASSOC);
        }

        json_out([
            'ok' => true,
            'tables' => $tableNames,
            'users' => $usersDescribe,
            'collections_notes' => $notesDescribe,
        ]);
    } catch (Throwable $e) {
        server_error('Error inspeccionando esquema', $e);
    }
}

// POST /auth/login
if ($method === 'POST' && $path === '/auth/login') {
    $body = read_json_body();
    $email = isset($body['email']) ? strtolower(trim((string)$body['email'])) : '';
    $password = isset($body['password']) ? (string)$body['password'] : '';
    if ($email === '' || $password === '') json_out(['detail' => 'Email y contraseña son obligatorios'], 400);

    try {
        $pdo = oderismo_pdo();
    } catch (Throwable $e) {
        server_error('Error de conexión a base de datos', $e);
    }

    try {
        // users(id, email, password_hash, is_active, ...)
        // roles(code) + user_roles N:M
        $stmt = $pdo->prepare(
            "SELECT
                u.id,
                u.email,
                u.full_name,
                u.password_hash,
                u.is_active
             FROM users u
             WHERE LOWER(u.email) = :email
             LIMIT 1"
        );
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        server_error('Error consultando usuario (tabla/columnas)', $e);
    }

    $clientDetails = activity_client_details_from_body($body);

    if (!$user) {
        activity_log($pdo, null, $email, 'login_failed', [
            'reason' => 'unknown_user',
            'client' => $clientDetails,
        ]);
        json_out(['detail' => 'Credenciales inválidas'], 401);
    }
    if ((int)($user['is_active'] ?? 0) !== 1) {
        activity_log($pdo, (int)$user['id'], (string)$user['email'], 'login_failed', [
            'reason' => 'inactive_user',
            'client' => $clientDetails,
        ]);
        json_out(['detail' => 'Usuario desactivado'], 403);
    }
    $stored = isset($user['password_hash']) ? (string)$user['password_hash'] : '';
    $authenticated = false;

    if (is_legacy_hex_hash($stored)) {
        if (legacy_password_matches($stored, $password)) {
            try {
                $newHash = password_hash($password, PASSWORD_DEFAULT);
                if (!is_string($newHash) || $newHash === '') {
                    server_error('No se pudo actualizar la contraseña');
                }
                $up = $pdo->prepare(
                    'UPDATE users SET password_hash = :h, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
                );
                $up->execute(['h' => $newHash, 'id' => (int)$user['id']]);
                $authenticated = true;
            } catch (Throwable $e) {
                server_error('Error actualizando contraseña', $e);
            }
        } else {
            activity_log($pdo, (int)$user['id'], (string)$user['email'], 'login_failed', [
                'reason' => 'password_setup_required',
                'client' => $clientDetails,
            ]);
            json_out([
                'detail' => 'Debes establecer una contraseña nueva. Usa «¿La has olvidado?» para recibir el enlace.',
                'code' => 'PASSWORD_SETUP_REQUIRED',
            ], 403);
        }
    } elseif (password_verify($password, $stored)) {
        $authenticated = true;
    }

    if (!$authenticated) {
        activity_log($pdo, (int)$user['id'], (string)$user['email'], 'login_failed', [
            'reason' => 'bad_password',
            'client' => $clientDetails,
        ]);
        json_out(['detail' => 'Credenciales inválidas'], 401);
    }

    try {
        $pdo->prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = :id')
            ->execute(['id' => (int)$user['id']]);
    } catch (Throwable $e) {
        server_error('Error registrando acceso de usuario', $e);
    }

    try {
        $rolesStmt = $pdo->prepare(
            "SELECT r.code
             FROM user_roles ur
             INNER JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = :uid
             ORDER BY r.code"
        );
        $rolesStmt->execute(['uid' => (int)$user['id']]);
        $roles = array_map(
            fn ($r) => strtoupper((string)$r['code']),
            $rolesStmt->fetchAll(PDO::FETCH_ASSOC) ?: []
        );
        $roles = array_values(array_unique(array_filter($roles, fn ($x) => is_string($x) && $x !== '')));
    } catch (Throwable $e) {
        server_error('Error cargando roles', $e);
    }
    if (!$roles) $roles = ['USER'];

    activity_log($pdo, (int)$user['id'], (string)$user['email'], 'login_success', [
        'roles' => $roles,
        'client' => $clientDetails,
    ]);

    $token = oderismo_jwt_hs256([
        'sub' => (string)$user['email'],
        'uid' => (int)$user['id'],
        'email' => (string)$user['email'],
        'roles' => $roles,
    ], oderismo_jwt_secret(), oderismo_jwt_ttl_seconds());

    json_out(array_merge([
        'access_token' => $token,
        'token_type' => 'bearer',
        'user' => [
            'id' => (int)$user['id'],
            'email' => (string)$user['email'],
            'full_name' => isset($user['full_name']) && $user['full_name'] !== null
                ? (string)$user['full_name']
                : null,
            'roles' => $roles,
        ],
    ], oderismo_auth_session_meta($token)));
}

// GET /auth/session-config — parámetros globales de duración de sesión
if ($method === 'GET' && $path === '/auth/session-config') {
    json_out(oderismo_session_config());
}

// POST /auth/refresh — renueva el JWT (misma duración configurada)
if ($method === 'POST' && $path === '/auth/refresh') {
    $payload = auth_payload_or_401();
    $uid = isset($payload['uid']) ? (int)$payload['uid'] : 0;
    if ($uid < 1) {
        json_out(['detail' => 'No autenticado'], 401);
    }

    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare(
            'SELECT id, email, full_name, is_active FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $uid]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        server_error('Error consultando usuario', $e);
    }

    if (!$user || (int)($user['is_active'] ?? 0) !== 1) {
        json_out(['detail' => 'Usuario no disponible'], 401);
    }

    try {
        $roles = user_role_codes($pdo, $uid);
    } catch (Throwable $e) {
        server_error('Error cargando roles', $e);
    }
    if (!$roles) {
        $roles = ['USER'];
    }

    $token = oderismo_jwt_hs256([
        'sub' => (string)$user['email'],
        'uid' => (int)$user['id'],
        'email' => (string)$user['email'],
        'roles' => $roles,
    ], oderismo_jwt_secret(), oderismo_jwt_ttl_seconds());

    json_out(array_merge([
        'access_token' => $token,
        'token_type' => 'bearer',
        'user' => [
            'id' => (int)$user['id'],
            'email' => (string)$user['email'],
            'full_name' => isset($user['full_name']) && $user['full_name'] !== null
                ? (string)$user['full_name']
                : null,
            'roles' => $roles,
        ],
    ], oderismo_auth_session_meta($token)));
}

// GET /auth/me — valida el JWT guardado tras login (Bearer o ?token=)
if ($method === 'GET' && $path === '/auth/me') {
    $payload = auth_payload_or_401();
    $uid = isset($payload['uid']) ? (int)$payload['uid'] : 0;
    if ($uid < 1) {
        json_out(['detail' => 'No autenticado'], 401);
    }

    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare(
            'SELECT id, email, full_name, is_active FROM users WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $uid]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        server_error('Error consultando usuario', $e);
    }

    if (!$user || (int)($user['is_active'] ?? 0) !== 1) {
        json_out(['detail' => 'Usuario no disponible'], 401);
    }

    try {
        $roles = user_role_codes($pdo, $uid);
    } catch (Throwable $e) {
        server_error('Error cargando roles', $e);
    }
    if (!$roles) {
        $roles = ['USER'];
    }

    $meta = oderismo_session_config();
    if (isset($payload['exp'])) {
        $meta['expires_at'] = (int)$payload['exp'];
    }

    json_out(array_merge([
        'user' => [
            'id' => (int)$user['id'],
            'email' => (string)$user['email'],
            'full_name' => isset($user['full_name']) && $user['full_name'] !== null
                ? (string)$user['full_name']
                : null,
            'roles' => $roles,
        ],
    ], $meta));
}

// POST /auth/set-password  (vía enlace firmado)
if ($method === 'POST' && $path === '/auth/set-password') {
    $body = read_json_body();
    $token = isset($body['token']) ? trim((string)$body['token']) : '';
    $password = isset($body['password']) ? (string)$body['password'] : '';
    if ($token === '' || $password === '') json_out(['detail' => 'Token y contraseña son obligatorios'], 400);
    if (strlen($password) < 8) json_out(['detail' => 'La contraseña debe tener al menos 8 caracteres'], 400);

    try {
        $payload = verify_signed_link_token($token, link_secret());
    } catch (Throwable $e) {
        json_out(['detail' => 'Token inválido o caducado'], 400);
    }
    $uid = isset($payload['uid']) ? (int)$payload['uid'] : 0;
    $ph = isset($payload['ph']) ? (string)$payload['ph'] : '';
    if ($uid <= 0 || $ph === '') json_out(['detail' => 'Token inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare("SELECT id, email, password_hash, is_active FROM users WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $uid]);
        $u = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if (!$u) json_out(['detail' => 'Token inválido'], 400);
        if ((int)($u['is_active'] ?? 0) !== 1) json_out(['detail' => 'Usuario desactivado'], 403);
        $current = isset($u['password_hash']) ? (string)$u['password_hash'] : '';
        $expectedPh = hash('sha256', $current);
        if (!hash_equals($expectedPh, $ph)) json_out(['detail' => 'Token inválido o ya usado'], 400);

        $newHash = password_hash($password, PASSWORD_DEFAULT);
        if (!is_string($newHash) || $newHash === '') server_error('No se pudo generar el hash');
        $up = $pdo->prepare("UPDATE users SET password_hash = :h, updated_at = CURRENT_TIMESTAMP WHERE id = :id");
        $up->execute(['h' => $newHash, 'id' => (int)$u['id']]);
    } catch (Throwable $e) {
        server_error('Error estableciendo contraseña', $e);
    }

    json_out(['ok' => true]);
}

// POST /auth/forgot-password — recuperación / primera activación (mismo enlace firmado)
if ($method === 'POST' && $path === '/auth/forgot-password') {
    $body = read_json_body();
    $email = isset($body['email']) ? trim((string)$body['email']) : '';
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_out(['detail' => 'Introduce un email válido'], 400);
    }

    $response = [
        'ok' => true,
        'message' => 'Si existe una cuenta activa con ese email, recibirás un enlace para establecer o restablecer tu contraseña.',
    ];

    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare(
            'SELECT id, email, password_hash, full_name, is_active FROM users WHERE email = :email LIMIT 1'
        );
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        server_error('Error procesando solicitud', $e);
    }

    if ($user && (int)($user['is_active'] ?? 0) === 1) {
        $token = password_reset_token_for_user($user);
        $resetUrl = oderismo_public_base_url()
            . '/establecer-contrasena.html?token='
            . rawurlencode($token);

        $stored = (string)($user['password_hash'] ?? '');
        $firstSetup = is_legacy_hex_hash($stored) || $stored === '';
        $emailSent = send_password_link_email(
            (string)$user['email'],
            isset($user['full_name']) ? (string)$user['full_name'] : null,
            $resetUrl,
            $firstSetup
        );
        $mailError = mail_last_error();
        $response['email_sent'] = $emailSent;
        $response['message'] = $emailSent
            ? 'Te hemos enviado un enlace para establecer o restablecer tu contraseña.'
            : 'No se pudo enviar el correo automáticamente. Contacta con el administrador.';
        if (!$emailSent && $mailError !== '' && (should_expose_reset_link() || mail_debug_enabled())) {
            $response['mail_error'] = $mailError;
            $response['message'] .= ' Error: ' . $mailError;
        }
        if (should_expose_reset_link() || is_legacy_hex_hash($stored)) {
            $response['reset_url'] = $resetUrl;
            if (is_legacy_hex_hash($stored) && !$emailSent) {
                $response['message'] =
                    'Tu cuenta necesita una contraseña nueva. Abre el enlace siguiente (válido 1 hora).';
                if ($mailError !== '' && (should_expose_reset_link() || mail_debug_enabled())) {
                    $response['message'] .= ' Error de correo: ' . $mailError;
                }
            }
        }
    }

    json_out($response);
}

// POST /auth/researcher-request — solicitud publica para alta como investigador.
if ($method === 'POST' && $path === '/auth/researcher-request') {
    $body = read_json_body();
    $email = isset($body['email']) ? strtolower(trim((string)$body['email'])) : '';
    $fullName = isset($body['full_name']) ? trim((string)$body['full_name']) : '';
    $description = isset($body['description']) ? trim((string)$body['description']) : '';

    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_out(['detail' => 'Introduce un email válido'], 400);
    }
    if ($fullName === '') {
        json_out(['detail' => 'El nombre y apellidos son obligatorios'], 400);
    }
    if ($description === '') {
        json_out(['detail' => 'Indica la motivación de la solicitud'], 400);
    }

    try {
        $pdo = oderismo_pdo();
        $dup = $pdo->prepare('SELECT id, is_active, password_hash, description FROM users WHERE LOWER(email) = :email LIMIT 1');
        $dup->execute(['email' => $email]);
        $existing = $dup->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($existing) {
            $isPending = (int)($existing['is_active'] ?? 0) === 0
                && (string)($existing['password_hash'] ?? '') === ''
                && trim((string)($existing['description'] ?? '')) !== '';
            json_out([
                'detail' => $isPending
                    ? 'Ya existe una solicitud pendiente con ese email'
                    : 'Ya existe una cuenta con ese email',
            ], 409);
        }

        $ins = $pdo->prepare(
            'INSERT INTO users (email, password_hash, full_name, is_active, description, created_at, updated_at)
             VALUES (:email, :hash, :name, 0, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        );
        $ins->execute([
            'email' => $email,
            'hash' => '',
            'name' => $fullName,
            'description' => $description,
        ]);
    } catch (Throwable $e) {
        server_error('Error registrando solicitud', $e);
    }

    json_out([
        'ok' => true,
        'message' => 'Solicitud recibida. Cuando sea aprobada recibirás un enlace para activar la cuenta.',
    ], 201);
}

// Debug: generar enlace de activación (solo con debug_enabled()).
// GET /debug/activation-link?email=...  => devuelve token y URL
if ($method === 'GET' && $path === '/debug/activation-link') {
    if (!debug_enabled()) json_out(['detail' => 'Not found'], 404);
    $email = isset($_GET['email']) ? trim((string)$_GET['email']) : '';
    if ($email === '') json_out(['detail' => 'Email obligatorio'], 400);
    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare("SELECT id, email, password_hash FROM users WHERE email = :email LIMIT 1");
        $stmt->execute(['email' => $email]);
        $u = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if (!$u) json_out(['detail' => 'No existe'], 404);
        $ph = hash('sha256', (string)($u['password_hash'] ?? ''));
        $token = signed_link_token([
            'uid' => (int)$u['id'],
            'exp' => time() + 60 * 60, // 1h
            'ph' => $ph,
        ], link_secret());
        $base = (string)(new DateTimeImmutable('now'))->format('c');
        json_out([
            'ok' => true,
            'token' => $token,
            'hint' => 'Usa POST /api/auth/set-password con {token,password}',
            'issued_at' => $base,
        ]);
    } catch (Throwable $e) {
        server_error('Error generando enlace', $e);
    }
}

function fastapi_get_json(string $upstreamPath, string $bearer): ?array
{
    $url = fastapi_base_url() . $upstreamPath;
    $ch = curl_init($url);
    if ($ch === false) return null;
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: application/json',
        'Authorization: Bearer ' . $bearer,
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($body === false || $code < 200 || $code >= 300) return null;
    $data = json_decode((string)$body, true);
    return is_array($data) ? $data : null;
}

/** Busca una imagen en el listado paginado del motor (fallback si GET /images/{id} no existe). */
function fastapi_find_image_in_catalog(int $imageId, string $bearer): ?array
{
    $page = 0;
    $limit = 100;
    $maxPages = 300;
    while ($page < $maxPages) {
        $data = fastapi_get_json('/images?page=' . $page . '&limit=' . $limit, $bearer);
        if ($data === null || !isset($data['images']) || !is_array($data['images'])) {
            return null;
        }
        foreach ($data['images'] as $img) {
            if (!is_array($img)) {
                continue;
            }
            if ((int)($img['id'] ?? 0) === $imageId) {
                $enriched = enrich_images_json_response(['images' => [$img]], $bearer);
                return $enriched['images'][0] ?? $img;
            }
        }
        if (empty($data['has_more'])) {
            break;
        }
        $page++;
    }
    return null;
}

/** Normaliza el cuerpo POST /search del frontend al formato del motor FastAPI. */
function parse_search_request_body(string $rawBody): array
{
    $decoded = json_decode($rawBody, true);
    if (!is_array($decoded)) {
        json_out(['detail' => 'Cuerpo JSON inválido'], 400);
    }
    $query = trim((string)($decoded['query'] ?? ''));
    if ($query === '') {
        json_out(['detail' => 'El campo query es obligatorio'], 400);
    }
    $limit = (int)($decoded['limit'] ?? 20);
    if ($limit < 1) $limit = 1;
    if ($limit > 100) $limit = 100;
    $scoreThreshold = (float)($decoded['score_threshold'] ?? 0.0);
    return [
        'query' => $query,
        'limit' => $limit,
        'score_threshold' => $scoreThreshold,
        'motor_body' => json_encode([
            'query' => $query,
            'score_threshold' => $scoreThreshold,
        ], JSON_UNESCAPED_UNICODE),
    ];
}

/**
 * Búsqueda por texto en descripción/título cuando falla la semántica (p. ej. Ollama caído en a22).
 * @return array{images: array<int, array<string, mixed>>, total: int, has_more: bool, mode: string}
 */
function search_images_lexical_fallback(string $query, string $bearer, int $limit = 20): array
{
    $needle = mb_strtolower(trim($query));
    if ($needle === '') {
        return ['images' => [], 'total' => 0, 'has_more' => false, 'mode' => 'lexical'];
    }

    $matches = [];
    $page = 0;
    while ($page < 120) {
        $data = fastapi_get_json('/images?page=' . $page . '&limit=100', $bearer);
        if (!$data || !is_array($data['images'] ?? null)) break;
        foreach ($data['images'] as $img) {
            if (!is_array($img)) continue;
            $desc = mb_strtolower((string)($img['description'] ?? ''));
            $title = mb_strtolower((string)($img['title'] ?? ''));
            if (str_contains($desc, $needle) || str_contains($title, $needle)) {
                $matches[] = array_merge($img, ['score' => 1.0]);
            }
        }
        if (empty($data['has_more'])) break;
        $page++;
    }

    $total = count($matches);
    $slice = array_slice($matches, 0, $limit);
    return [
        'images' => $slice,
        'total' => $total,
        'has_more' => $total > $limit,
        'mode' => 'lexical',
    ];
}

/**
 * POST /search al motor FastAPI.
 * @return array{ok: bool, code: int, data: ?array, detail: ?string}
 */
function fastapi_post_search(string $motorBody, string $bearer): array
{
    $url = fastapi_base_url() . '/search';
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'code' => 502, 'data' => null, 'detail' => 'No se pudo conectar al motor'];
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: Bearer ' . $bearer,
        ],
        CURLOPT_POSTFIELDS => $motorBody,
        CURLOPT_TIMEOUT => 120,
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        return [
            'ok' => false,
            'code' => 502,
            'data' => null,
            'detail' => $curlErr !== '' ? 'Error de red con el motor: ' . $curlErr : 'Error de red con el motor',
        ];
    }

    $data = json_decode((string)$raw, true);
    if ($code < 200 || $code >= 300) {
        $detail = 'Error en la búsqueda del motor';
        if (is_array($data)) {
            if (isset($data['detail']) && is_string($data['detail'])) {
                $detail = $data['detail'];
            } elseif (isset($data['detail']) && is_array($data['detail'])) {
                $detail = 'Error de validación en el motor';
            }
        }
        return ['ok' => false, 'code' => $code, 'data' => null, 'detail' => $detail];
    }
    if (!is_array($data)) {
        return ['ok' => false, 'code' => 502, 'data' => null, 'detail' => 'Respuesta inválida del motor'];
    }
    return ['ok' => true, 'code' => $code, 'data' => $data, 'detail' => null];
}

function fastapi_images_by_ids(array $ids, string $bearer): array
{
    if (!$ids) return [];
    $want = [];
    foreach ($ids as $id) {
        $want[(int)$id] = true;
    }
    $found = [];
    $page = 0;
    while (count($found) < count($want) && $page < 80) {
        $data = fastapi_get_json('/images?page=' . $page . '&limit=100', $bearer);
        if (!$data || !is_array($data['images'] ?? null)) break;
        foreach ($data['images'] as $img) {
            if (!is_array($img)) continue;
            $iid = (int)($img['id'] ?? 0);
            if ($iid > 0 && isset($want[$iid])) {
                $found[$iid] = $img;
            }
        }
        if (empty($data['has_more'])) break;
        $page++;
    }
    $out = [];
    foreach ($ids as $id) {
        $iid = (int)$id;
        if (isset($found[$iid])) $out[] = $found[$iid];
    }
    return $out;
}

function label_assign_roles(): array
{
    return ['ADMIN', 'RESEARCHER', 'PUBLISHER'];
}

function label_slug_from_name(string $name): string
{
    $s = mb_strtolower(trim($name), 'UTF-8');
    $s = preg_replace('/[^\p{L}\p{N}]+/u', '-', $s) ?? '';
    $s = trim((string)$s, '-');
    return $s !== '' ? $s : 'etiqueta';
}

function label_unique_slug(PDO $pdo, string $baseSlug): string
{
    $slug = $baseSlug;
    $n = 1;
    $stmt = $pdo->prepare('SELECT 1 FROM labels WHERE slug = :slug LIMIT 1');
    while (true) {
        $stmt->execute(['slug' => $slug]);
        if (!$stmt->fetchColumn()) return $slug;
        $n++;
        $slug = $baseSlug . '-' . $n;
    }
}

function label_row_to_json(array $r): array
{
    return [
        'id' => (int)$r['id'],
        'name' => (string)$r['name'],
        'slug' => (string)$r['slug'],
        'color' => (string)($r['color'] ?: '#6366f1'),
        'description' => isset($r['description']) && $r['description'] !== null
            ? (string)$r['description'] : null,
    ];
}

function fetch_labels_for_image(PDO $pdo, int $imageId, int $userId): array
{
    $stmt = $pdo->prepare(
        "SELECT l.id, l.name, l.slug, l.color, l.description, il.assigned_at, il.assigned_by
         FROM image_labels il
         INNER JOIN labels l ON l.id = il.label_id
         WHERE il.image_id = :iid AND l.created_by = :uid AND l.is_active = 1
         ORDER BY l.name"
    );
    $stmt->execute(['iid' => $imageId, 'uid' => $userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    return array_map(static function ($r) {
        return [
            'id' => (int)$r['id'],
            'name' => (string)$r['name'],
            'slug' => (string)$r['slug'],
            'color' => (string)($r['color'] ?: '#6366f1'),
            'description' => $r['description'] !== null ? (string)$r['description'] : null,
            'assigned_at' => (string)$r['assigned_at'],
            'assigned_by' => (int)$r['assigned_by'],
        ];
    }, $rows);
}

function note_href_is_safe(string $href): bool
{
    $href = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($href === '' || $href === '#') {
        return true;
    }
    if (preg_match('/^\s*(javascript|data|vbscript):/iu', $href)) {
        return false;
    }
    return (bool)preg_match('/^(https?:\/\/|mailto:|\/|#)/i', $href);
}

function sanitize_note_html(string $html): string
{
    $allowed = '<p><br><strong><b><em><i><u><s><ol><ul><li><a><h1><h2><h3><blockquote>';
    $clean = strip_tags($html, $allowed);
    $clean = preg_replace(
        '/\s+(on\w+|style|formaction)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/iu',
        '',
        $clean
    ) ?? $clean;
    $clean = preg_replace_callback(
        '/<a\s+([^>]*)>/iu',
        static function (array $m): string {
            if (!preg_match('/href\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>"\']+))/iu', $m[1], $hrefM)) {
                return '<a>';
            }
            $href = $hrefM[2] ?? $hrefM[3] ?? $hrefM[4] ?? '';
            if (!note_href_is_safe($href)) {
                return '<a>';
            }
            return '<a href="' . htmlspecialchars($href, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '">';
        },
        $clean
    ) ?? $clean;
    $clean = preg_replace(
        '/<(p|br|strong|b|em|i|u|s|ol|ul|li|h1|h2|h3|blockquote)\s+[^>]*>/iu',
        '<$1>',
        $clean
    ) ?? $clean;
    return trim($clean);
}

function is_note_body_empty(string $html): bool
{
    $text = trim(strip_tags($html, '<br>'));
    $text = str_replace(["\xc2\xa0", '&nbsp;'], ' ', $text);
    $text = trim(preg_replace('/\s+/u', '', $text) ?? '');
    return $text === '';
}

function note_row_to_json(array $r): array
{
    return [
        'id' => (int)$r['id'],
        'body' => (string)$r['body'],
        'author_id' => (int)$r['author_id'],
        'created_at' => (string)$r['created_at'],
        'updated_at' => (string)$r['updated_at'],
    ];
}

function fetch_note_for_image(PDO $pdo, int $imageId, int $userId): ?array
{
    $stmt = $pdo->prepare(
        "SELECT id, body, author_id, created_at, updated_at
         FROM image_notes
         WHERE image_id = :iid AND author_id = :uid
         ORDER BY updated_at DESC, id DESC
         LIMIT 1"
    );
    $stmt->execute(['iid' => $imageId, 'uid' => $userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? note_row_to_json($row) : null;
}

function save_note_for_image(PDO $pdo, int $imageId, int $userId, string $bodyHtml): ?array
{
    $html = sanitize_note_html($bodyHtml);
    if (is_note_body_empty($html)) {
        $del = $pdo->prepare('DELETE FROM image_notes WHERE image_id = :iid AND author_id = :uid');
        $del->execute(['iid' => $imageId, 'uid' => $userId]);
        return null;
    }

    $existing = $pdo->prepare(
        'SELECT id FROM image_notes WHERE image_id = :iid AND author_id = :uid ORDER BY id ASC LIMIT 1'
    );
    $existing->execute(['iid' => $imageId, 'uid' => $userId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        $noteId = (int)$row['id'];
        $upd = $pdo->prepare(
            'UPDATE image_notes SET body = :body, updated_at = CURRENT_TIMESTAMP WHERE id = :nid'
        );
        $upd->execute(['body' => $html, 'nid' => $noteId]);
        $cleanup = $pdo->prepare(
            'DELETE FROM image_notes WHERE image_id = :iid AND author_id = :uid AND id != :nid'
        );
        $cleanup->execute(['iid' => $imageId, 'uid' => $userId, 'nid' => $noteId]);
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO image_notes (image_id, author_id, body) VALUES (:iid, :uid, :body)'
        );
        $ins->execute(['iid' => $imageId, 'uid' => $userId, 'body' => $html]);
    }

    return fetch_note_for_image($pdo, $imageId, $userId);
}

function collections_notes_table_exists(PDO $pdo): bool
{
    return (bool)$pdo->query("SHOW TABLES LIKE 'collections_notes'")->fetchColumn();
}

function collections_notes_has_column(PDO $pdo, string $column): bool
{
    if (!collections_notes_table_exists($pdo)) {
        return false;
    }
    $stmt = $pdo->query(
        'SHOW COLUMNS FROM `collections_notes` LIKE ' . $pdo->quote($column)
    );
    return (bool)($stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false);
}

function collections_notes_has_auto_increment(PDO $pdo): bool
{
    if (!collections_notes_table_exists($pdo)) {
        return true;
    }
    $idCol = $pdo->query("SHOW COLUMNS FROM `collections_notes` LIKE 'id'")->fetch(PDO::FETCH_ASSOC);
    return $idCol && stripos((string)($idCol['Extra'] ?? ''), 'auto_increment') !== false;
}

function collections_notes_next_id(PDO $pdo): int
{
    return (int)$pdo->query('SELECT COALESCE(MAX(id), 0) + 1 FROM `collections_notes`')->fetchColumn();
}

function collection_note_pdo_error_message(PDOException $e): string
{
    $m = $e->getMessage();
    if (str_contains($m, 'collections_notes') && str_contains($m, "doesn't exist")) {
        return 'Falta la tabla collections_notes en la base de datos.';
    }
    if (str_contains($m, "doesn't have a default value") && str_contains($m, 'image_id')) {
        return 'Error de esquema: collections_notes requiere image_id (ver sql/oderismo.sql).';
    }
    if (str_contains($m, "doesn't have a default value") && str_contains($m, 'id')) {
        return 'La tabla collections_notes no tiene AUTO_INCREMENT en id.';
    }
    if (str_contains($m, 'Duplicate entry')) {
        return 'Conflicto al guardar la nota. Recarga la página e inténtalo de nuevo.';
    }
    return 'Error guardando nota de catálogo';
}

function collection_note_row_to_json(array $row): array
{
    $j = note_row_to_json($row);
    $j['image_id'] = (int)($row['image_id'] ?? 0);
    return $j;
}

/** Asegura que collections_notes existe (esquema sql/oderismo.sql: image_id + author_id). */
function ensure_collections_notes_table(PDO $pdo): void
{
    static $ready = false;
    if ($ready) {
        return;
    }

    if (!collections_notes_table_exists($pdo)) {
        $pdo->exec(
            'CREATE TABLE `collections_notes` (
              `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
              `image_id` bigint(20) UNSIGNED NOT NULL,
              `author_id` bigint(20) UNSIGNED NOT NULL,
              `body` text NOT NULL,
              `created_at` datetime NOT NULL DEFAULT current_timestamp(),
              `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
              PRIMARY KEY (`id`),
              KEY `idx_notes_image` (`image_id`),
              KEY `idx_notes_author` (`author_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $ready = true;
        return;
    }

    if (!collections_notes_has_column($pdo, 'image_id')) {
        throw new RuntimeException('La tabla collections_notes no tiene columna image_id (ver sql/oderismo.sql)');
    }

    if (!collections_notes_has_auto_increment($pdo)) {
        try {
            $pdo->exec(
                'ALTER TABLE `collections_notes`
                 MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT'
            );
        } catch (Throwable $e) {
            error_log('ensure_collections_notes_table auto_increment: ' . $e->getMessage());
        }
    }

    $ready = true;
}

/** Nota pública de catálogo para una imagen (collections_notes). */
function fetch_collection_note_for_image(PDO $pdo, int $imageId, int $authorId): ?array
{
    if ($imageId <= 0 || $authorId <= 0) {
        return null;
    }
    try {
        ensure_collections_notes_table($pdo);
        $stmt = $pdo->prepare(
            "SELECT id, image_id, body, author_id, created_at, updated_at
             FROM collections_notes
             WHERE image_id = :iid AND author_id = :uid
             ORDER BY updated_at DESC, id DESC
             LIMIT 1"
        );
        $stmt->execute(['iid' => $imageId, 'uid' => $authorId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? collection_note_row_to_json($row) : null;
    } catch (Throwable $e) {
        error_log('fetch_collection_note_for_image: ' . $e->getMessage());
        return null;
    }
}

function save_collection_note_for_image(PDO $pdo, int $imageId, int $authorId, string $bodyHtml): ?array
{
    if ($imageId <= 0 || $authorId <= 0) {
        return null;
    }
    ensure_collections_notes_table($pdo);
    $html = sanitize_note_html($bodyHtml);
    if (is_note_body_empty($html)) {
        $del = $pdo->prepare('DELETE FROM collections_notes WHERE image_id = :iid AND author_id = :uid');
        $del->execute(['iid' => $imageId, 'uid' => $authorId]);
        return null;
    }

    $existing = $pdo->prepare(
        'SELECT id FROM collections_notes WHERE image_id = :iid AND author_id = :uid ORDER BY id ASC LIMIT 1'
    );
    $existing->execute(['iid' => $imageId, 'uid' => $authorId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        $noteId = (int)$row['id'];
        $upd = $pdo->prepare(
            'UPDATE collections_notes SET body = :body, updated_at = CURRENT_TIMESTAMP WHERE id = :nid'
        );
        $upd->execute(['body' => $html, 'nid' => $noteId]);
        $cleanup = $pdo->prepare(
            'DELETE FROM collections_notes WHERE image_id = :iid AND author_id = :uid AND id != :nid'
        );
        $cleanup->execute(['iid' => $imageId, 'uid' => $authorId, 'nid' => $noteId]);
    } else {
        $autoInc = collections_notes_has_auto_increment($pdo);
        if ($autoInc) {
            $ins = $pdo->prepare(
                'INSERT INTO collections_notes (image_id, author_id, body) VALUES (:iid, :uid, :body)'
            );
            $ins->execute(['iid' => $imageId, 'uid' => $authorId, 'body' => $html]);
        } else {
            $newId = collections_notes_next_id($pdo);
            $ins = $pdo->prepare(
                'INSERT INTO collections_notes (id, image_id, author_id, body) VALUES (:id, :iid, :uid, :body)'
            );
            $ins->execute([
                'id' => $newId,
                'iid' => $imageId,
                'uid' => $authorId,
                'body' => $html,
            ]);
        }
    }

    return fetch_collection_note_for_image($pdo, $imageId, $authorId);
}

function delete_collection_note_for_image(PDO $pdo, int $imageId, int $authorId): void
{
    if ($imageId <= 0 || $authorId <= 0) {
        return;
    }
    ensure_collections_notes_table($pdo);
    $del = $pdo->prepare('DELETE FROM collections_notes WHERE image_id = :iid AND author_id = :uid');
    $del->execute(['iid' => $imageId, 'uid' => $authorId]);
}

/** Nota pública en vista de catálogo: del creador de la colección para esa imagen. */
function fetch_collection_creator_note(PDO $pdo, int $imageId, int $createdBy): ?array
{
    if ($imageId <= 0 || $createdBy <= 0) {
        return null;
    }
    try {
        ensure_collections_notes_table($pdo);
        $stmt = $pdo->prepare(
            "SELECT cn.id, cn.image_id, cn.body, cn.author_id, cn.created_at, cn.updated_at,
                    u.full_name AS author_name
             FROM collections_notes cn
             LEFT JOIN users u ON u.id = cn.author_id
             WHERE cn.image_id = :iid AND cn.author_id = :uid
             ORDER BY cn.updated_at DESC, cn.id DESC
             LIMIT 1"
        );
        $stmt->execute(['iid' => $imageId, 'uid' => $createdBy]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        $j = collection_note_row_to_json($row);
        $j['author_name'] = isset($row['author_name']) && $row['author_name'] !== null
            ? (string)$row['author_name'] : null;
        return $j;
    } catch (Throwable $e) {
        error_log('fetch_collection_creator_note: ' . $e->getMessage());
        return null;
    }
}

// GET /labels — catálogo para autocompletar (etiquetado en modal)
if ($method === 'GET' && $path === '/labels') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $q = trim((string)($_GET['q'] ?? ''));
    try {
        $pdo = oderismo_pdo();
        $sql = "SELECT id, name, slug, color, description FROM labels WHERE is_active = 1 AND created_by = :uid";
        $params = ['uid' => $uid];
        if ($q !== '') {
            // PDO (prepares nativos): un nombre de parámetro no puede repetirse en la misma consulta.
            $sql .= " AND (name LIKE :q_name OR slug LIKE :q_slug)";
            $like = '%' . $q . '%';
            $params['q_name'] = $like;
            $params['q_slug'] = $like;
        }
        $sql .= ' ORDER BY name LIMIT 200';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $labels = array_map(
            'label_row_to_json',
            $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []
        );
        json_out(['labels' => $labels]);
    } catch (Throwable $e) {
        server_error('Error cargando etiquetas', $e);
    }
}

// POST /labels — crear etiqueta en catálogo
if ($method === 'POST' && $path === '/labels') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);

    $body = read_json_body();
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 255) {
        json_out(['detail' => 'Nombre de etiqueta inválido'], 400);
    }
    $color = resolve_new_label_color($body);
    $description = isset($body['description']) ? trim((string)$body['description']) : null;
    if ($description === '') $description = null;

    try {
        $pdo = oderismo_pdo();
        $slug = label_unique_slug($pdo, label_slug_from_name($name));
        $stmt = $pdo->prepare(
            "INSERT INTO labels (name, slug, description, color, created_by)
             VALUES (:name, :slug, :description, :color, :uid)"
        );
        $stmt->execute([
            'name' => $name,
            'slug' => $slug,
            'description' => $description,
            'color' => $color,
            'uid' => $uid,
        ]);
        $id = (int)$pdo->lastInsertId();
        $rowStmt = $pdo->prepare(
            "SELECT id, name, slug, color, description FROM labels WHERE id = :id LIMIT 1"
        );
        $rowStmt->execute(['id' => $id]);
        $row = $rowStmt->fetch(PDO::FETCH_ASSOC);
        json_out(['label' => label_row_to_json($row ?: ['id' => $id, 'name' => $name, 'slug' => $slug, 'color' => $color, 'description' => $description])], 201);
    } catch (Throwable $e) {
        server_error('Error creando etiqueta', $e);
    }
}

// GET /image-meta/{imageId} — etiquetas y notas propias del usuario en la imagen
if ($method === 'GET' && preg_match('#^/image-meta/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        $roleCodes = user_role_codes($pdo, $uid);
        $canManageCollections = (bool)array_intersect($roleCodes, collection_manage_roles());
        $out = [
            'image_id' => $imageId,
            'labels' => fetch_labels_for_image($pdo, $imageId, $uid),
            'note' => fetch_note_for_image($pdo, $imageId, $uid),
            'can_edit' => true,
        ];
        if ($canManageCollections) {
            $out['collection_note'] = fetch_collection_note_for_image($pdo, $imageId, $uid);
        }
        json_out($out);
    } catch (Throwable $e) {
        server_error('Error cargando metadatos de imagen', $e);
    }
}

// PUT /image-meta/{imageId}/collection-note — nota pública de catálogo (ADMIN/PUBLISHER)
if ($method === 'PUT' && preg_match('#^/image-meta/(\d+)/collection-note$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, collection_manage_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    $body = read_json_body();
    $raw = (string)($body['body'] ?? '');
    if (mb_strlen($raw) > 65535) json_out(['detail' => 'Nota demasiado larga'], 400);

    try {
        $pdo = oderismo_pdo();
        $note = save_collection_note_for_image($pdo, $imageId, $uid, $raw);
        json_out(['note' => $note]);
    } catch (PDOException $e) {
        error_log('PUT collection-note PDO: ' . $e->getMessage());
        server_error(collection_note_pdo_error_message($e), $e);
    } catch (Throwable $e) {
        server_error('Error guardando nota de catálogo', $e);
    }
}

// DELETE /image-meta/{imageId}/collection-note — borrar nota pública de catálogo
if ($method === 'DELETE' && preg_match('#^/image-meta/(\d+)/collection-note$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, collection_manage_roles());
    $uid = (int)($payload['uid'] ?? 0);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        delete_collection_note_for_image($pdo, $imageId, $uid);
        json_out(['note' => null]);
    } catch (Throwable $e) {
        server_error('Error eliminando nota de catálogo', $e);
    }
}

// PUT /image-meta/{imageId}/labels — sincronizar etiquetas asignadas
if ($method === 'PUT' && preg_match('#^/image-meta/(\d+)/labels$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    $body = read_json_body();
    $rawIds = $body['label_ids'] ?? [];
    if (!is_array($rawIds)) json_out(['detail' => 'label_ids debe ser un array'], 400);

    $labelIds = [];
    foreach ($rawIds as $id) {
        $lid = (int)$id;
        if ($lid > 0) $labelIds[$lid] = true;
    }
    $labelIds = array_keys($labelIds);

    try {
        $pdo = oderismo_pdo();
        if ($labelIds) {
            $placeholders = implode(',', array_fill(0, count($labelIds), '?'));
            $check = $pdo->prepare(
                "SELECT COUNT(*) FROM labels WHERE is_active = 1 AND created_by = ? AND id IN ($placeholders)"
            );
            $check->execute(array_merge([$uid], $labelIds));
            if ((int)$check->fetchColumn() !== count($labelIds)) {
                json_out(['detail' => 'Una o más etiquetas no existen o no son tuyas'], 400);
            }
        }

        $pdo->beginTransaction();
        $del = $pdo->prepare(
            "DELETE il FROM image_labels il
             INNER JOIN labels l ON l.id = il.label_id
             WHERE il.image_id = :iid AND l.created_by = :uid"
        );
        $del->execute(['iid' => $imageId, 'uid' => $uid]);
        if ($labelIds) {
            $ins = $pdo->prepare(
                "INSERT INTO image_labels (image_id, label_id, assigned_by)
                 VALUES (:iid, :lid, :uid)"
            );
            foreach ($labelIds as $lid) {
                $ins->execute(['iid' => $imageId, 'lid' => $lid, 'uid' => $uid]);
            }
        }
        $pdo->commit();

        json_out([
            'image_id' => $imageId,
            'labels' => fetch_labels_for_image($pdo, $imageId, $uid),
        ]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        server_error('Error guardando etiquetas', $e);
    }
}

// PUT /image-meta/{imageId}/note — crear o actualizar la nota única del usuario
if ($method === 'PUT' && preg_match('#^/image-meta/(\d+)/note$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    $body = read_json_body();
    $raw = (string)($body['body'] ?? '');
    if (mb_strlen($raw) > 65535) json_out(['detail' => 'Nota demasiado larga'], 400);

    try {
        $pdo = oderismo_pdo();
        $note = save_note_for_image($pdo, $imageId, $uid, $raw);
        json_out(['note' => $note]);
    } catch (Throwable $e) {
        server_error('Error guardando nota', $e);
    }
}

// DELETE /image-meta/{imageId}/note — borrar la nota del usuario
if ($method === 'DELETE' && preg_match('#^/image-meta/(\d+)/note$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, label_assign_roles());
    $uid = (int)($payload['uid'] ?? 0);
    $imageId = (int)$m[1];
    if ($imageId <= 0) json_out(['detail' => 'ID inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        $del = $pdo->prepare('DELETE FROM image_notes WHERE image_id = :iid AND author_id = :uid');
        $del->execute(['iid' => $imageId, 'uid' => $uid]);
        json_out(['note' => null]);
    } catch (Throwable $e) {
        server_error('Error eliminando nota', $e);
    }
}

function fetch_marca_row_or_404(PDO $pdo, int $labelId, int $uid): array
{
    $stmt = $pdo->prepare(
        "SELECT id, name, slug, color, created_by FROM labels WHERE id = :id AND is_active = 1 LIMIT 1"
    );
    $stmt->execute(['id' => $labelId]);
    $label = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    if (!$label) json_out(['detail' => 'Etiqueta no encontrada'], 404);
    if ((int)$label['created_by'] !== $uid) {
        json_out(['detail' => 'Permiso denegado'], 403);
    }
    return $label;
}

function find_label_by_name_for_user(PDO $pdo, int $uid, string $name): ?array
{
    $stmt = $pdo->prepare(
        "SELECT id, name, slug, color, description FROM labels
         WHERE is_active = 1 AND created_by = :uid AND LOWER(name) = LOWER(:name)
         LIMIT 1"
    );
    $stmt->execute(['uid' => $uid, 'name' => $name]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// POST /marcas/merge — unificar varias etiquetas en una (existente o nueva)
if ($method === 'POST' && $path === '/marcas/merge') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);

    $body = read_json_body();
    $rawIds = $body['source_ids'] ?? [];
    if (!is_array($rawIds)) json_out(['detail' => 'source_ids debe ser un array'], 400);

    $sourceIds = [];
    foreach ($rawIds as $id) {
        $lid = (int)$id;
        if ($lid > 0) $sourceIds[$lid] = true;
    }
    $sourceIds = array_keys($sourceIds);
    if (count($sourceIds) < 2) {
        json_out(['detail' => 'Selecciona al menos dos etiquetas para fundir'], 400);
    }

    $targetName = trim((string)($body['target_name'] ?? ''));
    if ($targetName === '' || mb_strlen($targetName) > 255) {
        json_out(['detail' => 'Nombre de etiqueta destino inválido'], 400);
    }

    try {
        $pdo = oderismo_pdo();
        $placeholders = implode(',', array_fill(0, count($sourceIds), '?'));
        $check = $pdo->prepare(
            "SELECT id, name, slug, color, description FROM labels
             WHERE is_active = 1 AND created_by = ? AND id IN ($placeholders)"
        );
        $check->execute(array_merge([$uid], $sourceIds));
        $sources = $check->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if (count($sources) !== count($sourceIds)) {
            json_out(['detail' => 'Una o más etiquetas no existen o no son tuyas'], 400);
        }

        $targetRow = null;
        $targetLower = mb_strtolower($targetName, 'UTF-8');
        foreach ($sources as $s) {
            if (mb_strtolower((string)$s['name'], 'UTF-8') === $targetLower) {
                $targetRow = $s;
                break;
            }
        }
        if (!$targetRow) {
            $targetRow = find_label_by_name_for_user($pdo, $uid, $targetName);
        }
        if (!$targetRow) {
            $slug = label_unique_slug($pdo, label_slug_from_name($targetName));
            $ins = $pdo->prepare(
                "INSERT INTO labels (name, slug, description, color, created_by)
                 VALUES (:name, :slug, NULL, :color, :uid)"
            );
            $color = trim((string)($sources[0]['color'] ?? ''));
            if ($color === '' || !preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
                $color = random_label_color();
            }
            $ins->execute([
                'name' => $targetName,
                'slug' => $slug,
                'color' => $color,
                'uid' => $uid,
            ]);
            $targetId = (int)$pdo->lastInsertId();
            $rowStmt = $pdo->prepare(
                "SELECT id, name, slug, color, description FROM labels WHERE id = :id LIMIT 1"
            );
            $rowStmt->execute(['id' => $targetId]);
            $targetRow = $rowStmt->fetch(PDO::FETCH_ASSOC) ?: [
                'id' => $targetId,
                'name' => $targetName,
                'slug' => $slug,
                'color' => $color,
                'description' => null,
            ];
        }

        $targetId = (int)$targetRow['id'];
        $toDeactivate = array_values(array_filter(
            $sourceIds,
            static fn (int $id) => $id !== $targetId
        ));

        $pdo->beginTransaction();

        $imgStmt = $pdo->prepare(
            "SELECT DISTINCT image_id FROM image_labels WHERE label_id IN ($placeholders)"
        );
        $imgStmt->execute($sourceIds);
        $imageIds = array_map(
            static fn ($r) => (int)$r['image_id'],
            $imgStmt->fetchAll(PDO::FETCH_ASSOC) ?: []
        );

        if ($imageIds) {
            $ins = $pdo->prepare(
                "INSERT IGNORE INTO image_labels (image_id, label_id, assigned_by)
                 VALUES (:iid, :lid, :uid)"
            );
            foreach ($imageIds as $iid) {
                $ins->execute(['iid' => $iid, 'lid' => $targetId, 'uid' => $uid]);
            }
        }

        $del = $pdo->prepare(
            "DELETE FROM image_labels WHERE label_id IN ($placeholders) AND label_id != ?"
        );
        $del->execute(array_merge($sourceIds, [$targetId]));

        if ($toDeactivate) {
            $ph2 = implode(',', array_fill(0, count($toDeactivate), '?'));
            $deact = $pdo->prepare(
                "UPDATE labels SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                 WHERE created_by = ? AND id IN ($ph2)"
            );
            $deact->execute(array_merge([$uid], $toDeactivate));
        }

        if ((string)$targetRow['name'] !== $targetName) {
            $newSlug = label_unique_slug($pdo, label_slug_from_name($targetName));
            $updName = $pdo->prepare(
                "UPDATE labels SET name = :name, slug = :slug, updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND created_by = :uid"
            );
            $updName->execute(['name' => $targetName, 'slug' => $newSlug, 'id' => $targetId, 'uid' => $uid]);
            $targetRow['name'] = $targetName;
            $targetRow['slug'] = $newSlug;
        }

        $pdo->commit();

        $countStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM image_labels WHERE label_id = :lid'
        );
        $countStmt->execute(['lid' => $targetId]);

        json_out([
            'marca' => label_row_to_json(array_merge($targetRow, [
                'id' => $targetId,
                'name' => $targetName,
            ])),
            'merged_count' => count($toDeactivate),
            'image_count' => (int)$countStmt->fetchColumn(),
        ]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        server_error('Error fusionando etiquetas', $e);
    }
}

function random_label_color(): string
{
    static $palette = [
        '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
        '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
        '#14b8a6', '#06b6d4', '#3b82f6', '#64748b', '#71492c',
    ];
    return $palette[random_int(0, count($palette) - 1)];
}

function normalize_label_color(string $raw): string
{
    $color = trim($raw);
    if (!preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
        json_out(['detail' => 'Color inválido (use formato #RRGGBB)'], 400);
    }
    return strtolower($color);
}

function resolve_new_label_color(array $body): string
{
    if (!array_key_exists('color', $body)) {
        return random_label_color();
    }
    $color = trim((string)$body['color']);
    if ($color === '' || !preg_match('/^#[0-9A-Fa-f]{6}$/', $color)) {
        return random_label_color();
    }
    return strtolower($color);
}

// PATCH /marcas/{id} — actualizar etiqueta (p. ej. color)
if ($method === 'PATCH' && preg_match('#^/marcas/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $labelId = (int)$m[1];
    if ($labelId <= 0) json_out(['detail' => 'ID inválido'], 400);

    $body = read_json_body();
    if (!array_key_exists('color', $body)) {
        json_out(['detail' => 'Indica el campo color'], 400);
    }
    $color = normalize_label_color((string)$body['color']);

    try {
        $pdo = oderismo_pdo();
        fetch_marca_row_or_404($pdo, $labelId, $uid);
        $upd = $pdo->prepare(
            'UPDATE labels SET color = :color, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND created_by = :uid'
        );
        $upd->execute(['color' => $color, 'id' => $labelId, 'uid' => $uid]);
        $rowStmt = $pdo->prepare(
            'SELECT id, name, slug, color, description FROM labels WHERE id = :id LIMIT 1'
        );
        $rowStmt->execute(['id' => $labelId]);
        $row = $rowStmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if (!$row) json_out(['detail' => 'Etiqueta no encontrada'], 404);
        json_out(['marca' => label_row_to_json($row)]);
    } catch (Throwable $e) {
        server_error('Error actualizando etiqueta', $e);
    }
}

// DELETE /marcas/{id} — eliminar etiqueta y quitarla de todas las imágenes
if ($method === 'DELETE' && preg_match('#^/marcas/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);
    $labelId = (int)$m[1];
    if ($labelId <= 0) json_out(['detail' => 'ID inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        fetch_marca_row_or_404($pdo, $labelId, $uid);
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM image_labels WHERE label_id = :lid')->execute(['lid' => $labelId]);
        $pdo->prepare('DELETE FROM collection_labels WHERE label_id = :lid')->execute(['lid' => $labelId]);
        $pdo->prepare(
            'UPDATE labels SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND created_by = :uid'
        )->execute(['id' => $labelId, 'uid' => $uid]);
        $pdo->commit();
        json_out(['ok' => true, 'id' => $labelId]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        server_error('Error eliminando etiqueta', $e);
    }
}

function sql_like_pattern(string $q): string
{
    $q = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
    return '%' . $q . '%';
}

function marcas_row_from_db(array $r): array
{
    return [
        'id' => (int)$r['id'],
        'name' => (string)$r['name'],
        'slug' => (string)$r['slug'],
        'description' => $r['description'] !== null ? (string)$r['description'] : null,
        'color' => (string)($r['color'] ?: '#6366f1'),
        'created_at' => (string)$r['created_at'],
        'image_count' => (int)($r['image_count'] ?? 0),
        'note_match_count' => isset($r['note_match_count']) ? (int)$r['note_match_count'] : null,
    ];
}

function fetch_image_ids_untagged_by_note_search(PDO $pdo, int $uid, string $like): array
{
    $stmt = $pdo->prepare(
        "SELECT DISTINCT n.image_id
         FROM image_notes n
         WHERE n.author_id = :uid AND n.body LIKE :like
           AND NOT EXISTS (
             SELECT 1 FROM image_labels il
             INNER JOIN labels l ON l.id = il.label_id
             WHERE il.image_id = n.image_id
               AND l.created_by = :label_uid
               AND l.is_active = 1
           )
         ORDER BY n.image_id
         LIMIT 200"
    );
    $stmt->execute(['uid' => $uid, 'label_uid' => $uid, 'like' => $like]);
    return array_map(
        static fn ($r) => (int)$r['image_id'],
        $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []
    );
}

// GET /marcas/search-by-notes?q= — etiquetas con notas propias que contienen el texto
if ($method === 'GET' && $path === '/marcas/search-by-notes') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);

    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '') {
        json_out(['marcas' => [], 'query' => '']);
    }
    if (mb_strlen($q) < 2) {
        json_out(['detail' => 'Escribe al menos 2 caracteres para buscar'], 400);
    }
    if (mb_strlen($q) > 200) {
        json_out(['detail' => 'Texto de búsqueda demasiado largo'], 400);
    }

    try {
        $pdo = oderismo_pdo();
        $like = sql_like_pattern($q);
        $stmt = $pdo->prepare(
            "SELECT l.id, l.name, l.slug, l.description, l.color, l.created_at,
                    COUNT(DISTINCT n.image_id) AS note_match_count,
                    (SELECT COUNT(*) FROM image_labels il_all WHERE il_all.label_id = l.id) AS image_count
             FROM labels l
             INNER JOIN image_labels il ON il.label_id = l.id
             INNER JOIN image_notes n ON n.image_id = il.image_id AND n.author_id = :note_uid
             WHERE l.created_by = :uid AND l.is_active = 1 AND n.body LIKE :like
             GROUP BY l.id, l.name, l.slug, l.description, l.color, l.created_at
             ORDER BY note_match_count DESC, l.name ASC
             LIMIT 80"
        );
        $stmt->execute(['uid' => $uid, 'note_uid' => $uid, 'like' => $like]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $marcas = array_map('marcas_row_from_db', $rows);

        $untaggedCount = count(fetch_image_ids_untagged_by_note_search($pdo, $uid, $like));
        $sinEtiquetar = $untaggedCount > 0 ? [
            'id' => 0,
            'name' => 'Sin Etiquetar',
            'slug' => 'sin-etiquetar',
            'color' => '#94a3b8',
            'description' => null,
            'image_count' => $untaggedCount,
            'note_match_count' => $untaggedCount,
            'is_untagged' => true,
        ] : null;

        json_out(['marcas' => $marcas, 'sin_etiquetar' => $sinEtiquetar, 'query' => $q]);
    } catch (Throwable $e) {
        server_error('Error buscando etiquetas por notas', $e);
    }
}

// GET /marcas — labels creadas por el investigador (created_by)
if ($method === 'GET' && $path === '/marcas') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);

    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->prepare(
            "SELECT l.id, l.name, l.slug, l.description, l.color, l.created_at,
                    (SELECT COUNT(*) FROM image_labels il WHERE il.label_id = l.id) AS image_count
             FROM labels l
             WHERE l.created_by = :uid AND l.is_active = 1
             ORDER BY l.name"
        );
        $stmt->execute(['uid' => $uid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $marcas = array_map('marcas_row_from_db', $rows);
        json_out(['marcas' => $marcas]);
    } catch (Throwable $e) {
        server_error('Error cargando marcas', $e);
    }
}

// GET /marcas/sin-etiquetar/by-notes?q= — imágenes sin etiqueta con notas que coinciden
if ($method === 'GET' && $path === '/marcas/sin-etiquetar/by-notes') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) json_out(['detail' => 'Sesión inválida'], 401);

    $q = trim((string)($_GET['q'] ?? ''));
    if ($q === '' || mb_strlen($q) < 2) {
        json_out(['detail' => 'Consulta de búsqueda inválida'], 400);
    }
    if (mb_strlen($q) > 200) {
        json_out(['detail' => 'Texto de búsqueda demasiado largo'], 400);
    }

    try {
        $pdo = oderismo_pdo();
        $like = sql_like_pattern($q);
        $imageIds = fetch_image_ids_untagged_by_note_search($pdo, $uid, $like);
        $bearer = fastapi_service_bearer() ?? '';
        $images = $bearer !== '' ? fastapi_images_by_ids($imageIds, $bearer) : [];

        json_out([
            'marca' => [
                'id' => 0,
                'name' => 'Sin Etiquetar',
                'slug' => 'sin-etiquetar',
                'color' => '#94a3b8',
                'is_untagged' => true,
            ],
            'images' => $images,
            'image_ids' => $imageIds,
            'query' => $q,
        ]);
    } catch (Throwable $e) {
        server_error('Error cargando imágenes sin etiquetar', $e);
    }
}

// GET /marcas/{id}/images
if ($method === 'GET' && preg_match('#^/marcas/(\d+)/images$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER']);
    $uid = (int)($payload['uid'] ?? 0);
    $labelId = (int)$m[1];
    if ($labelId <= 0) json_out(['detail' => 'ID inválido'], 400);

    try {
        $pdo = oderismo_pdo();
        $label = fetch_marca_row_or_404($pdo, $labelId, $uid);

        $idsStmt = $pdo->prepare(
            "SELECT image_id FROM image_labels WHERE label_id = :lid ORDER BY image_id"
        );
        $idsStmt->execute(['lid' => $labelId]);
        $imageIds = array_map(
            static fn ($r) => (int)$r['image_id'],
            $idsStmt->fetchAll(PDO::FETCH_ASSOC) ?: []
        );

        $bearer = fastapi_service_bearer() ?? '';
        $images = $bearer !== '' ? fastapi_images_by_ids($imageIds, $bearer) : [];

        json_out([
            'marca' => [
                'id' => (int)$label['id'],
                'name' => (string)$label['name'],
                'slug' => (string)$label['slug'],
                'color' => (string)($label['color'] ?: '#6366f1'),
            ],
            'images' => $images,
            'image_ids' => $imageIds,
        ]);
    } catch (Throwable $e) {
        server_error('Error cargando imágenes de la marca', $e);
    }
}

// Token del motor FastAPI para <img src="...?token="> (tras validar sesión Oderismo).
if ($method === 'GET' && $path === '/etiquetas-token') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $t = fastapi_service_bearer();
    if (!$t) {
        fastapi_service_error_response();
    }
    json_out(['token' => $t, 'token_type' => 'bearer']);
}

// Medios: el navegador no puede mandar Bearer a a22; se sirven vía PHP con JWT (?token= o header).
if ($method === 'GET' && preg_match('#^/media/images/([^/]+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $file = basename($m[1]);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $file)) {
        json_out(['detail' => 'Nombre de fichero inválido'], 400);
    }
    stream_fastapi_image_file($file, false);
}

if ($method === 'GET' && preg_match('#^/media/thumbs/([^/]+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $file = basename($m[1]);
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $file)) {
        json_out(['detail' => 'Nombre de fichero inválido'], 400);
    }
    stream_fastapi_image_file($file, true);
}

// Proxy al motor IA (FastAPI) — el navegador debe llamar a PHP.
// GET /images (listado): enriquecer URLs con ?token= para <img>.
if ($method === 'GET' && $path === '/images') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $bearer = fastapi_service_bearer();
    if (!$bearer) {
        fastapi_service_error_response();
    }
    $qs = $_SERVER['QUERY_STRING'] ?? '';
    $up = '/images' . (is_string($qs) && $qs !== '' ? '?' . $qs : '');
    $data = fastapi_get_json($up, $bearer);
    if ($data === null) {
        json_out(['detail' => 'Error obteniendo imágenes del motor'], 502);
    }
    json_out(enrich_images_json_response($data, $bearer));
}

// GET /images/{id} — detalle con image_description (Qdrant)
if ($method === 'GET' && preg_match('#^/images/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'UPLOADER']);
    $imageId = (int)$m[1];
    if ($imageId < 1) {
        json_out(['detail' => 'ID inválido'], 400);
    }
    $bearer = fastapi_service_bearer();
    if (!$bearer) {
        fastapi_service_error_response();
    }

    $direct = fastapi_get_json('/images/' . $imageId, $bearer);
    if (is_array($direct) && isset($direct['id'])) {
        $enriched = enrich_images_json_response(['images' => [$direct]], $bearer);
        json_out($enriched['images'][0] ?? $direct);
    }

    $found = fastapi_find_image_in_catalog($imageId, $bearer);
    if ($found !== null) {
        json_out($found);
    }
    json_out(['detail' => 'Imagen no encontrada'], 404);
}

if (preg_match('#^/images(/.*)?$#', $path)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $qs = $_SERVER['QUERY_STRING'] ?? '';
    $suffix = substr($path, strlen('/images'));
    $up = '/images' . ($suffix !== '' ? $suffix : '');
    if (is_string($qs) && $qs !== '') $up .= '?' . $qs;
    proxy_to_fastapi($up);
}

// POST /search — búsqueda semántica (todos los roles con sesión en Explorar).
if ($method === 'POST' && $path === '/search') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'RESEARCHER', 'UPLOADER', 'PUBLISHER', 'USER']);
    $bearer = fastapi_service_bearer();
    if (!$bearer) {
        fastapi_service_error_response();
    }

    $rawBody = file_get_contents('php://input');
    $searchReq = parse_search_request_body($rawBody !== false ? $rawBody : '{}');
    $result = fastapi_post_search($searchReq['motor_body'], $bearer);

    if (!$result['ok']) {
        $fallback = search_images_lexical_fallback($searchReq['query'], $bearer, $searchReq['limit']);
        if (!empty($fallback['images'])) {
            json_out(enrich_images_json_response($fallback, $bearer));
        }
        $status = $result['code'] >= 400 && $result['code'] < 600 ? $result['code'] : 502;
        json_out([
            'detail' => ($result['detail'] ?? 'Error en la búsqueda del motor')
                . '. La búsqueda por texto en descripciones tampoco encontró coincidencias.',
            'code' => 'SEARCH_MOTOR_UNAVAILABLE',
        ], $status);
    }

    $data = $result['data'];
    if (isset($data['images']) && is_array($data['images']) && $searchReq['limit'] > 0) {
        $total = (int)($data['total'] ?? count($data['images']));
        $data['images'] = array_slice($data['images'], 0, $searchReq['limit']);
        $data['total'] = min($total, count($data['images']));
        $data['has_more'] = $total > count($data['images']);
    }
    $data['mode'] = 'semantic';
    json_out(enrich_images_json_response($data, $bearer));
}

// Upload pipeline (SSE) — OCR/recorte pueden tardar varios minutos.
if (str_starts_with($path, '/upload/batch/')) {
    @set_time_limit(0);
    @ini_set('max_execution_time', '0');
    ignore_user_abort(true);
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'UPLOADER']);
    if (!fastapi_service_bearer()) {
        fastapi_service_error_response();
    }
    proxy_to_fastapi($path);
}

function user_role_codes(PDO $pdo, int $userId): array
{
    $stmt = $pdo->prepare(
        "SELECT r.code
         FROM user_roles ur
         INNER JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = :uid
         ORDER BY r.code"
    );
    $stmt->execute(['uid' => $userId]);
    return array_values(array_unique(array_map(
        static fn ($r) => strtoupper((string)$r['code']),
        $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []
    )));
}

function valid_role_codes(): array
{
    return ['ADMIN', 'RESEARCHER', 'UPLOADER', 'USER', 'PUBLISHER'];
}

function normalize_role_codes(array $codes): array
{
    $valid = valid_role_codes();
    $out = [];
    foreach ($codes as $c) {
        $code = strtoupper(trim((string)$c));
        if ($code === '') continue;
        if (!in_array($code, $valid, true)) {
            json_out(['detail' => 'Rol inválido: ' . $code], 400);
        }
        $out[$code] = true;
    }
    $list = array_keys($out);
    if (!$list) json_out(['detail' => 'Debe asignar al menos un rol'], 400);
    sort($list);
    return $list;
}

function role_id_by_code(PDO $pdo, string $code): ?int
{
    $stmt = $pdo->prepare('SELECT id FROM roles WHERE code = :c LIMIT 1');
    $stmt->execute(['c' => strtoupper($code)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? (int)$row['id'] : null;
}

function set_user_roles(PDO $pdo, int $userId, array $codes): void
{
    $codes = normalize_role_codes($codes);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM user_roles WHERE user_id = :uid')->execute(['uid' => $userId]);
        $ins = $pdo->prepare('INSERT INTO user_roles (user_id, role_id) VALUES (:uid, :rid)');
        foreach ($codes as $code) {
            $rid = role_id_by_code($pdo, $code);
            if (!$rid) {
                throw new RuntimeException('Rol no encontrado en catálogo: ' . $code);
            }
            $ins->execute(['uid' => $userId, 'rid' => $rid]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

function format_user_row(array $row, array $roles): array
{
    return [
        'id' => (int)$row['id'],
        'email' => (string)$row['email'],
        'full_name' => $row['full_name'] !== null ? (string)$row['full_name'] : null,
        'is_active' => (int)($row['is_active'] ?? 0) === 1,
        'roles' => $roles,
        'created_at' => isset($row['created_at']) ? (string)$row['created_at'] : null,
    ];
}

function format_researcher_request_row(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'email' => (string)$row['email'],
        'full_name' => $row['full_name'] !== null ? (string)$row['full_name'] : null,
        'description' => $row['description'] !== null ? (string)$row['description'] : '',
        'created_at' => isset($row['created_at']) ? (string)$row['created_at'] : null,
    ];
}

// Admin altas pendientes — ADMIN y UPLOADER pueden aprobar investigadores.
if ($path === '/admin/researcher-requests') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'UPLOADER']);

    if ($method === 'GET') {
        try {
            $pdo = oderismo_pdo();
            $stmt = $pdo->query(
                "SELECT id, email, full_name, description, created_at
                 FROM users
                 WHERE is_active = 0
                   AND password_hash = ''
                   AND description IS NOT NULL
                   AND TRIM(description) <> ''
                 ORDER BY created_at ASC, id ASC"
            );
            $requests = array_map(
                static fn ($row) => format_researcher_request_row($row),
                $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []
            );
            json_out(['requests' => $requests]);
        } catch (Throwable $e) {
            server_error('Error cargando altas pendientes', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

if (preg_match('#^/admin/researcher-requests/(\d+)/approve$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'UPLOADER']);
    $requestId = (int)$m[1];
    if ($requestId <= 0) json_out(['detail' => 'ID inválido'], 400);

    if ($method === 'POST') {
        try {
            $pdo = oderismo_pdo();
            $stmt = $pdo->prepare(
                "SELECT id, email, password_hash, full_name, is_active, description, created_at
                 FROM users
                 WHERE id = :id
                 LIMIT 1"
            );
            $stmt->execute(['id' => $requestId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
            if (!$row) json_out(['detail' => 'Solicitud no encontrada'], 404);

            $isPending = (int)($row['is_active'] ?? 0) === 0
                && (string)($row['password_hash'] ?? '') === ''
                && trim((string)($row['description'] ?? '')) !== '';
            if (!$isPending) {
                json_out(['detail' => 'La solicitud ya no está pendiente'], 409);
            }

            $pdo->prepare('UPDATE users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                ->execute(['id' => $requestId]);
            set_user_roles($pdo, $requestId, ['RESEARCHER']);

            $fresh = $pdo->prepare(
                'SELECT id, email, password_hash, full_name FROM users WHERE id = :id LIMIT 1'
            );
            $fresh->execute(['id' => $requestId]);
            $user = $fresh->fetch(PDO::FETCH_ASSOC) ?: $row;
            $activationUrl = activation_url_for_user($user, 86400);
            $emailSent = send_activation_email(
                (string)$user['email'],
                (string)($user['full_name'] ?? ''),
                $activationUrl
            );
            $mailError = mail_last_error();

            $response = [
                'ok' => true,
                'email_sent' => $emailSent,
                'activation_url' => $activationUrl,
                'message' => $emailSent
                    ? 'Solicitud aprobada. Se ha enviado el enlace de activación.'
                    : 'Solicitud aprobada. No se pudo enviar el correo automáticamente; copia el enlace de activación.',
            ];
            if (!$emailSent && $mailError !== '' && (should_expose_reset_link() || mail_debug_enabled())) {
                $response['mail_error'] = $mailError;
                $response['message'] .= ' Error: ' . $mailError;
            }
            json_out($response);
        } catch (Throwable $e) {
            server_error('Error aprobando solicitud', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

// Admin usuarios (MySQL) — solo ADMIN
if ($path === '/admin/users') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN']);
    $actorUid = (int)($payload['uid'] ?? 0);

    if ($method === 'GET') {
        try {
            $pdo = oderismo_pdo();
            $stmt = $pdo->query(
                'SELECT id, email, full_name, is_active, created_at FROM users ORDER BY email'
            );
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $users = [];
            foreach ($rows as $row) {
                $uid = (int)$row['id'];
                $users[] = format_user_row($row, user_role_codes($pdo, $uid));
            }
            $rolesStmt = $pdo->query('SELECT code, name FROM roles ORDER BY id');
            $available = array_map(static function ($r) {
                return [
                    'code' => strtoupper((string)$r['code']),
                    'name' => (string)$r['name'],
                ];
            }, $rolesStmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
            json_out(['users' => $users, 'available_roles' => $available]);
        } catch (Throwable $e) {
            server_error('Error cargando usuarios', $e);
        }
    }

    if ($method === 'POST') {
        $body = read_json_body();
        $email = isset($body['email']) ? strtolower(trim((string)$body['email'])) : '';
        $password = isset($body['password']) ? (string)$body['password'] : '';
        $fullName = isset($body['full_name']) ? trim((string)$body['full_name']) : '';
        $roles = isset($body['roles']) && is_array($body['roles']) ? $body['roles'] : [];
        if ($email === '') json_out(['detail' => 'Email obligatorio'], 400);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['detail' => 'Email inválido'], 400);
        if ($password !== '' && strlen($password) < 8) {
            json_out(['detail' => 'La contraseña debe tener al menos 8 caracteres'], 400);
        }
        $roleCodes = normalize_role_codes($roles ?: ['USER']);

        try {
            $pdo = oderismo_pdo();
            $dup = $pdo->prepare('SELECT id FROM users WHERE LOWER(email) = :email LIMIT 1');
            $dup->execute(['email' => $email]);
            if ($dup->fetch(PDO::FETCH_ASSOC)) json_out(['detail' => 'El email ya está registrado'], 409);

            $hash = '';
            if ($password !== '') {
                $hash = password_hash($password, PASSWORD_DEFAULT);
                if (!is_string($hash) || $hash === '') server_error('No se pudo generar el hash');
            }

            $ins = $pdo->prepare(
                'INSERT INTO users (email, password_hash, full_name, is_active, created_at, updated_at)
                 VALUES (:email, :hash, :name, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
            );
            $ins->execute([
                'email' => $email,
                'hash' => $hash,
                'name' => $fullName !== '' ? $fullName : null,
            ]);
            $newId = (int)$pdo->lastInsertId();
            set_user_roles($pdo, $newId, $roleCodes);

            $stmt = $pdo->prepare(
                'SELECT id, email, full_name, is_active, created_at FROM users WHERE id = :id LIMIT 1'
            );
            $stmt->execute(['id' => $newId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
            json_out(['user' => format_user_row($row, user_role_codes($pdo, $newId))], 201);
        } catch (Throwable $e) {
            server_error('Error creando usuario', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

if (preg_match('#^/admin/users/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN']);
    $actorUid = (int)($payload['uid'] ?? 0);
    $userId = (int)$m[1];
    if ($userId <= 0) json_out(['detail' => 'ID inválido'], 400);

    if ($method === 'PATCH') {
        $body = read_json_body();
        try {
            $pdo = oderismo_pdo();
            $stmt = $pdo->prepare(
                'SELECT id, email, full_name, is_active, created_at FROM users WHERE id = :id LIMIT 1'
            );
            $stmt->execute(['id' => $userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
            if (!$row) json_out(['detail' => 'Usuario no encontrado'], 404);

            if (array_key_exists('full_name', $body)) {
                $name = trim((string)$body['full_name']);
                $pdo->prepare('UPDATE users SET full_name = :n, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                    ->execute(['n' => $name !== '' ? $name : null, 'id' => $userId]);
            }
            if (array_key_exists('is_active', $body)) {
                $active = filter_var($body['is_active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if ($active === null) json_out(['detail' => 'is_active inválido'], 400);
                if ($userId === $actorUid && !$active) {
                    json_out(['detail' => 'No puedes desactivar tu propia cuenta'], 400);
                }
                $pdo->prepare('UPDATE users SET is_active = :a, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                    ->execute(['a' => $active ? 1 : 0, 'id' => $userId]);
            }
            if (isset($body['password']) && (string)$body['password'] !== '') {
                $password = (string)$body['password'];
                if (strlen($password) < 8) json_out(['detail' => 'La contraseña debe tener al menos 8 caracteres'], 400);
                $hash = password_hash($password, PASSWORD_DEFAULT);
                if (!is_string($hash) || $hash === '') server_error('No se pudo generar el hash');
                $pdo->prepare('UPDATE users SET password_hash = :h, updated_at = CURRENT_TIMESTAMP WHERE id = :id')
                    ->execute(['h' => $hash, 'id' => $userId]);
            }
            if (isset($body['roles']) && is_array($body['roles'])) {
                if ($userId === $actorUid) {
                    $next = normalize_role_codes($body['roles']);
                    if (!in_array('ADMIN', $next, true)) {
                        json_out(['detail' => 'No puedes quitarte el rol ADMIN a ti mismo'], 400);
                    }
                }
                set_user_roles($pdo, $userId, $body['roles']);
            }

            $fresh = $pdo->prepare(
                'SELECT id, email, full_name, is_active, created_at FROM users WHERE id = :id LIMIT 1'
            );
            $fresh->execute(['id' => $userId]);
            $row = $fresh->fetch(PDO::FETCH_ASSOC) ?: $row;
            json_out(['user' => format_user_row($row, user_role_codes($pdo, $userId))]);
        } catch (Throwable $e) {
            server_error('Error actualizando usuario', $e);
        }
    }

    if ($method === 'DELETE') {
        if ($userId === $actorUid) json_out(['detail' => 'No puedes eliminar tu propia cuenta'], 400);
        try {
            $pdo = oderismo_pdo();
            $stmt = $pdo->prepare('SELECT id FROM users WHERE id = :id LIMIT 1');
            $stmt->execute(['id' => $userId]);
            if (!$stmt->fetch(PDO::FETCH_ASSOC)) json_out(['detail' => 'Usuario no encontrado'], 404);
            $pdo->prepare('DELETE FROM users WHERE id = :id')->execute(['id' => $userId]);
            json_out(['ok' => true]);
        } catch (Throwable $e) {
            server_error('Error eliminando usuario', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

function collection_manage_roles(): array
{
    return ['ADMIN', 'PUBLISHER'];
}

function collection_slug_from_name(string $name): string
{
    return label_slug_from_name($name);
}

function collection_unique_slug(PDO $pdo, string $baseSlug, ?int $excludeId = null): string
{
    $slug = $baseSlug;
    $n = 1;
    $sql = 'SELECT 1 FROM collections WHERE slug = :slug';
    if ($excludeId !== null && $excludeId > 0) {
        $sql .= ' AND id != :id';
    }
    $sql .= ' LIMIT 1';
    $stmt = $pdo->prepare($sql);
    while (true) {
        $params = ['slug' => $slug];
        if ($excludeId !== null && $excludeId > 0) {
            $params['id'] = $excludeId;
        }
        $stmt->execute($params);
        if (!$stmt->fetchColumn()) {
            return $slug;
        }
        $n++;
        $slug = $baseSlug . '-' . $n;
    }
}

function parse_optional_date(?string $raw): ?string
{
    if ($raw === null) {
        return null;
    }
    $s = trim($raw);
    if ($s === '') {
        return null;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $s);
    if (!$dt || $dt->format('Y-m-d') !== $s) {
        json_out(['detail' => 'Fecha inválida (use AAAA-MM-DD)'], 400);
    }
    return $s;
}

function collection_visible_now(array $row): bool
{
    if ((int)($row['is_public'] ?? 0) !== 1 || (int)($row['is_active'] ?? 0) !== 1) {
        return false;
    }
    $today = (new DateTimeImmutable('today'))->format('Y-m-d');
    $start = $row['start_date'] ?? null;
    if ($start !== null && $start !== '' && $today < (string)$start) {
        return false;
    }
    $end = $row['end_date'] ?? null;
    if ($end !== null && $end !== '' && $today > (string)$end) {
        return false;
    }
    return true;
}

function collection_row_to_json(array $r, bool $includeAdmin = false): array
{
    $out = [
        'id' => (int)$r['id'],
        'name' => (string)$r['name'],
        'slug' => (string)$r['slug'],
        'small_description' => isset($r['small_description']) && $r['small_description'] !== null
            ? (string)$r['small_description'] : null,
        'description' => $r['description'] !== null ? (string)$r['description'] : null,
        'start_date' => $r['start_date'] !== null ? (string)$r['start_date'] : null,
        'end_date' => $r['end_date'] !== null ? (string)$r['end_date'] : null,
        'is_public' => (int)($r['is_public'] ?? 0) === 1,
        'is_active' => (int)($r['is_active'] ?? 0) === 1,
        'created_at' => (string)($r['created_at'] ?? ''),
        'updated_at' => (string)($r['updated_at'] ?? ''),
    ];
    if (isset($r['label_count'])) {
        $out['label_count'] = (int)$r['label_count'];
    }
    if (isset($r['image_count'])) {
        $out['image_count'] = (int)$r['image_count'];
    }
    if (!empty($r['sample_image']) && is_array($r['sample_image'])) {
        $out['sample_image'] = $r['sample_image'];
    }
    if ($includeAdmin) {
        $out['created_by'] = (int)($r['created_by'] ?? 0);
        $out['updated_by'] = isset($r['updated_by']) && $r['updated_by'] !== null
            ? (int)$r['updated_by'] : null;
    }
    return $out;
}

function fetch_collection_labels(PDO $pdo, int $collectionId): array
{
    $stmt = $pdo->prepare(
        "SELECT l.id, l.name, l.slug, l.color, l.description,
                (SELECT COUNT(*) FROM image_labels il WHERE il.label_id = l.id) AS image_count
         FROM collection_labels cl
         INNER JOIN labels l ON l.id = cl.label_id AND l.is_active = 1
         WHERE cl.collection_id = :cid
         ORDER BY l.name"
    );
    $stmt->execute(['cid' => $collectionId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    return array_map(static function (array $r): array {
        $j = label_row_to_json($r);
        $j['image_count'] = (int)($r['image_count'] ?? 0);
        return $j;
    }, $rows);
}

function collection_sample_image_json(?array $img): ?array
{
    if (!$img || (int)($img['id'] ?? 0) <= 0) {
        return null;
    }
    $out = ['id' => (int)$img['id']];
    if (!empty($img['url'])) {
        $out['url'] = (string)$img['url'];
    }
    if (isset($img['title']) && $img['title'] !== '') {
        $out['title'] = (string)$img['title'];
    }
    return $out;
}

/** @param callable(array): bool|null $rowFilter */
function build_collections_list_json(PDO $pdo, array $rows, bool $includeAdmin, ?callable $rowFilter = null): array
{
    $prepared = [];
    $sampleImageIds = [];
    foreach ($rows as $row) {
        if ($rowFilter !== null && !$rowFilter($row)) {
            continue;
        }
        $cid = (int)$row['id'];
        $imageIds = fetch_collection_image_ids($pdo, $cid);
        $row['image_count'] = count($imageIds);
        $sampleId = $imageIds[0] ?? null;
        if ($sampleId) {
            $sampleImageIds[$cid] = $sampleId;
        }
        $prepared[] = ['row' => $row, 'cid' => $cid];
    }

    $imagesById = [];
    $bearer = fastapi_service_bearer() ?? '';
    if ($bearer !== '' && $sampleImageIds) {
        $uniqueIds = array_values(array_unique(array_values($sampleImageIds)));
        $fetched = fastapi_images_by_ids($uniqueIds, $bearer);
        $enriched = enrich_images_json_response(['images' => $fetched], $bearer)['images'] ?? $fetched;
        foreach ($enriched as $img) {
            if (!is_array($img)) {
                continue;
            }
            $iid = (int)($img['id'] ?? 0);
            if ($iid > 0) {
                $imagesById[$iid] = $img;
            }
        }
    }

    $collections = [];
    foreach ($prepared as $item) {
        $row = $item['row'];
        $cid = $item['cid'];
        $sampleId = $sampleImageIds[$cid] ?? null;
        if ($sampleId && isset($imagesById[$sampleId])) {
            $sample = collection_sample_image_json($imagesById[$sampleId]);
            if ($sample !== null) {
                $row['sample_image'] = $sample;
            }
        }
        $collections[] = collection_row_to_json($row, $includeAdmin);
    }

    return $collections;
}

function fetch_collection_image_ids(PDO $pdo, int $collectionId): array
{
    $stmt = $pdo->prepare(
        "SELECT DISTINCT image_id FROM (
            SELECT ci.image_id AS image_id
            FROM collection_images ci
            WHERE ci.collection_id = :cid1
            UNION
            SELECT il.image_id AS image_id
            FROM collection_labels cl
            INNER JOIN image_labels il ON il.label_id = cl.label_id
            WHERE cl.collection_id = :cid2
        ) AS u
        ORDER BY image_id"
    );
    $stmt->execute(['cid1' => $collectionId, 'cid2' => $collectionId]);
    return array_map(
        static fn ($r) => (int)$r['image_id'],
        $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []
    );
}

function sync_collection_labels(PDO $pdo, int $collectionId, array $labelIds): void
{
    $pdo->prepare('DELETE FROM collection_labels WHERE collection_id = :cid')
        ->execute(['cid' => $collectionId]);
    if (!$labelIds) {
        return;
    }
    $ins = $pdo->prepare(
        'INSERT INTO collection_labels (collection_id, label_id) VALUES (:cid, :lid)'
    );
    foreach ($labelIds as $lid) {
        $ins->execute(['cid' => $collectionId, 'lid' => $lid]);
    }
}

function sync_collection_images(PDO $pdo, int $collectionId, array $imageIds, int $addedBy): void
{
    $pdo->prepare('DELETE FROM collection_images WHERE collection_id = :cid')
        ->execute(['cid' => $collectionId]);
    if (!$imageIds) {
        return;
    }
    $ins = $pdo->prepare(
        'INSERT INTO collection_images (collection_id, image_id, sort_order, added_by)
         VALUES (:cid, :iid, :ord, :uid)'
    );
    $order = 0;
    foreach ($imageIds as $iid) {
        $ins->execute([
            'cid' => $collectionId,
            'iid' => $iid,
            'ord' => $order,
            'uid' => $addedBy,
        ]);
        $order++;
    }
}

function validate_label_ids_for_collection(PDO $pdo, array $labelIds): array
{
    $labelIds = array_values(array_unique(array_filter(array_map('intval', $labelIds), static fn ($id) => $id > 0)));
    if (!$labelIds) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($labelIds), '?'));
    $check = $pdo->prepare(
        "SELECT id FROM labels WHERE is_active = 1 AND id IN ($placeholders)"
    );
    $check->execute($labelIds);
    $found = array_map(static fn ($r) => (int)$r['id'], $check->fetchAll(PDO::FETCH_ASSOC) ?: []);
    if (count($found) !== count($labelIds)) {
        json_out(['detail' => 'Una o más etiquetas no existen o están inactivas'], 400);
    }
    sort($found);
    return $found;
}

function validate_image_ids_list(array $raw): array
{
    if (!is_array($raw)) {
        json_out(['detail' => 'image_ids debe ser un array'], 400);
    }
    $out = [];
    foreach ($raw as $id) {
        $iid = (int)$id;
        if ($iid > 0) {
            $out[$iid] = true;
        }
    }
    return array_keys($out);
}

function fetch_collection_row_by_id(PDO $pdo, int $collectionId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, name, slug, small_description, description, start_date, end_date, is_public, is_active,
                created_by, updated_by, created_at, updated_at
         FROM collections WHERE id = :id LIMIT 1'
    );
    $stmt->execute(['id' => $collectionId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function fetch_collection_row_by_slug(PDO $pdo, string $slug): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, name, slug, small_description, description, start_date, end_date, is_public, is_active,
                created_by, updated_by, created_at, updated_at
         FROM collections WHERE slug = :slug LIMIT 1'
    );
    $stmt->execute(['slug' => $slug]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function collection_detail_payload(PDO $pdo, array $row, bool $includeAdmin, bool $withImages): array
{
    $cid = (int)$row['id'];
    $createdBy = (int)($row['created_by'] ?? 0);
    $payload = [
        'collection' => collection_row_to_json($row, $includeAdmin),
        'labels' => fetch_collection_labels($pdo, $cid),
    ];
    $imageIds = fetch_collection_image_ids($pdo, $cid);
    $payload['image_count'] = count($imageIds);
    $payload['collection']['image_count'] = count($imageIds);
    $payload['collection']['label_count'] = count($payload['labels']);

    if ($withImages) {
        $bearer = fastapi_service_bearer() ?? '';
        $images = $bearer !== '' ? fastapi_images_by_ids($imageIds, $bearer) : [];
        if ($bearer !== '') {
            $images = enrich_images_json_response(['images' => $images], $bearer)['images'] ?? $images;
        }
        if ($createdBy > 0) {
            foreach ($images as $idx => $img) {
                $iid = (int)($img['id'] ?? 0);
                if ($iid <= 0) {
                    continue;
                }
                $note = fetch_collection_creator_note($pdo, $iid, $createdBy);
                if ($note) {
                    $images[$idx]['collection_note'] = [
                        'body' => $note['body'],
                        'updated_at' => $note['updated_at'] ?? null,
                    ];
                }
            }
        }
        $payload['images'] = $images;
        $payload['image_ids'] = $imageIds;
    }

    return $payload;
}

function parse_collection_body(array $body, bool $isCreate): array
{
    $name = isset($body['name']) ? trim((string)$body['name']) : '';
    if ($isCreate && ($name === '' || mb_strlen($name) > 255)) {
        json_out(['detail' => 'Nombre de catálogo inválido'], 400);
    }
    if (!$isCreate && array_key_exists('name', $body) && ($name === '' || mb_strlen($name) > 255)) {
        json_out(['detail' => 'Nombre de catálogo inválido'], 400);
    }

    $fields = [];
    if ($name !== '' || ($isCreate && array_key_exists('name', $body))) {
        $fields['name'] = $name;
    }
    if (array_key_exists('small_description', $body)) {
        $raw = trim((string)$body['small_description']);
        if ($raw === '') {
            $fields['small_description'] = null;
        } else {
            if (mb_strlen($raw) > 2000) {
                json_out(['detail' => 'La descripción breve es demasiado larga (máx. 2000 caracteres)'], 400);
            }
            $fields['small_description'] = $raw;
        }
    }
    if (array_key_exists('description', $body)) {
        $raw = trim((string)$body['description']);
        if ($raw === '') {
            $fields['description'] = null;
        } else {
            if (mb_strlen($raw) > 65535) {
                json_out(['detail' => 'Descripción demasiado larga'], 400);
            }
            $html = sanitize_note_html($raw);
            $fields['description'] = is_note_body_empty($html) ? null : $html;
        }
    }
    if (array_key_exists('slug', $body)) {
        $slug = trim((string)$body['slug']);
        $fields['slug'] = $slug !== '' ? collection_slug_from_name($slug) : null;
    }
    if (array_key_exists('start_date', $body)) {
        $fields['start_date'] = parse_optional_date(
            $body['start_date'] === null ? null : (string)$body['start_date']
        );
    }
    if (array_key_exists('end_date', $body)) {
        $fields['end_date'] = parse_optional_date(
            $body['end_date'] === null ? null : (string)$body['end_date']
        );
    }
    if (array_key_exists('is_public', $body)) {
        $pub = filter_var($body['is_public'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($pub === null) {
            json_out(['detail' => 'is_public inválido'], 400);
        }
        $fields['is_public'] = $pub;
    }
    if (array_key_exists('is_active', $body)) {
        $act = filter_var($body['is_active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($act === null) {
            json_out(['detail' => 'is_active inválido'], 400);
        }
        $fields['is_active'] = $act;
    }

    $labelIds = null;
    if (array_key_exists('label_ids', $body)) {
        if (!is_array($body['label_ids'])) {
            json_out(['detail' => 'label_ids debe ser un array'], 400);
        }
        $labelIds = [];
        foreach ($body['label_ids'] as $id) {
            $lid = (int)$id;
            if ($lid > 0) {
                $labelIds[$lid] = true;
            }
        }
        $labelIds = array_keys($labelIds);
    }

    $imageIds = null;
    if (array_key_exists('image_ids', $body)) {
        $imageIds = validate_image_ids_list($body['image_ids']);
    }

    return [$fields, $labelIds, $imageIds];
}

// Salvapantallas (portada): intervalo configurable (imágenes vía motor público en a22).
if ($method === 'GET' && $path === '/screensaver/config') {
    require_once __DIR__ . '/../php/lib/app_settings.php';
    $row = oderismo_parameters_row();
    json_out([
        'time_label' => (int)$row['time_label'],
        'time_index' => (int)$row['time_index'],
    ]);
}

// Cuadro expositor de la portada: intervalo desde `parameters.time_index`.
if ($method === 'GET' && $path === '/landing-frame/config') {
    require_once __DIR__ . '/../php/lib/app_settings.php';
    $row = oderismo_parameters_row();
    json_out([
        'time_index' => (int)$row['time_index'],
    ]);
}

// GET /collections/public — catálogos visibles sin sesión
if ($method === 'GET' && $path === '/collections/public') {
    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->query(
            "SELECT c.id, c.name, c.slug, c.small_description, c.description, c.start_date, c.end_date,
                    c.is_public, c.is_active, c.created_by, c.updated_by, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM collection_labels cl WHERE cl.collection_id = c.id) AS label_count
             FROM collections c
             WHERE c.is_public = 1 AND c.is_active = 1
             ORDER BY c.name"
        );
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $collections = build_collections_list_json(
            $pdo,
            $rows,
            false,
            static fn (array $row): bool => collection_visible_now($row)
        );
        json_out(['collections' => $collections]);
    } catch (Throwable $e) {
        server_error('Error cargando catálogos públicos', $e);
    }
}

// GET /collections/public/{slug}
if ($method === 'GET' && preg_match('#^/collections/public/([^/]+)$#', $path, $m)) {
    $slug = rawurldecode((string)$m[1]);
    try {
        $pdo = oderismo_pdo();
        $row = fetch_collection_row_by_slug($pdo, $slug);
        if (!$row || !collection_visible_now($row)) {
            json_out(['detail' => 'Catálogo no encontrado'], 404);
        }
        json_out(collection_detail_payload($pdo, $row, false, true));
    } catch (Throwable $e) {
        server_error('Error cargando catálogo', $e);
    }
}

// GET /collections/available-labels — etiquetas activas para armar catálogos
if ($method === 'GET' && $path === '/collections/available-labels') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, collection_manage_roles());
    $q = trim((string)($_GET['q'] ?? ''));
    try {
        $pdo = oderismo_pdo();
        $sql = "SELECT l.id, l.name, l.slug, l.color, l.description, l.created_by,
                       u.full_name AS creator_name,
                       (SELECT COUNT(*) FROM image_labels il WHERE il.label_id = l.id) AS image_count
                FROM labels l
                LEFT JOIN users u ON u.id = l.created_by
                WHERE l.is_active = 1";
        $params = [];
        if ($q !== '') {
            $sql .= ' AND (l.name LIKE :q_name OR l.slug LIKE :q_slug)';
            $like = '%' . $q . '%';
            $params['q_name'] = $like;
            $params['q_slug'] = $like;
        }
        $sql .= ' ORDER BY l.name LIMIT 500';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $labels = array_map(static function (array $r): array {
            $j = label_row_to_json($r);
            $j['image_count'] = (int)($r['image_count'] ?? 0);
            $j['created_by'] = (int)($r['created_by'] ?? 0);
            $j['creator_name'] = $r['creator_name'] !== null ? (string)$r['creator_name'] : null;
            return $j;
        }, $rows);
        json_out(['labels' => $labels]);
    } catch (Throwable $e) {
        server_error('Error cargando etiquetas', $e);
    }
}

// GET /collections — listado para editores
if ($method === 'GET' && $path === '/collections') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, collection_manage_roles());
    try {
        $pdo = oderismo_pdo();
        $stmt = $pdo->query(
            "SELECT c.id, c.name, c.slug, c.small_description, c.description, c.start_date, c.end_date,
                    c.is_public, c.is_active, c.created_by, c.updated_by, c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM collection_labels cl WHERE cl.collection_id = c.id) AS label_count
             FROM collections c
             ORDER BY c.updated_at DESC, c.name"
        );
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $collections = build_collections_list_json($pdo, $rows, true);
        json_out(['collections' => $collections]);
    } catch (Throwable $e) {
        server_error('Error cargando catálogos', $e);
    }
}

// POST /collections — crear catálogo
if ($method === 'POST' && $path === '/collections') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, collection_manage_roles());
    $uid = (int)($payload['uid'] ?? 0);
    if ($uid <= 0) {
        json_out(['detail' => 'Sesión inválida'], 401);
    }

    $body = read_json_body();
    [$fields, $labelIds, $imageIds] = parse_collection_body($body, true);
    $name = (string)($fields['name'] ?? '');
    if ($name === '') {
        json_out(['detail' => 'Nombre obligatorio'], 400);
    }

    try {
        $pdo = oderismo_pdo();
        $baseSlug = isset($fields['slug']) && $fields['slug']
            ? (string)$fields['slug']
            : collection_slug_from_name($name);
        $slug = collection_unique_slug($pdo, $baseSlug);
        $isPublic = !empty($fields['is_public']) ? 1 : 0;
        $isActive = array_key_exists('is_active', $fields)
            ? (!empty($fields['is_active']) ? 1 : 0)
            : 1;

        $pdo->beginTransaction();
        // PDO nativo (EMULATE_PREPARES=false): cada placeholder debe tener nombre único.
        $ins = $pdo->prepare(
            "INSERT INTO collections (name, slug, small_description, description, start_date, end_date, is_public, is_active, created_by, updated_by)
             VALUES (:name, :slug, :small_description, :description, :start, :end, :pub, :act, :created_by, :updated_by)"
        );
        $ins->execute([
            'name' => $name,
            'slug' => $slug,
            'small_description' => $fields['small_description'] ?? null,
            'description' => $fields['description'] ?? null,
            'start' => $fields['start_date'] ?? null,
            'end' => $fields['end_date'] ?? null,
            'pub' => $isPublic,
            'act' => $isActive,
            'created_by' => $uid,
            'updated_by' => $uid,
        ]);
        $collectionId = (int)$pdo->lastInsertId();

        if ($labelIds !== null) {
            $validLabels = validate_label_ids_for_collection($pdo, $labelIds);
            sync_collection_labels($pdo, $collectionId, $validLabels);
        }
        if ($imageIds !== null) {
            sync_collection_images($pdo, $collectionId, $imageIds, $uid);
        }

        $pdo->commit();
        $row = fetch_collection_row_by_id($pdo, $collectionId);
        if (!$row) {
            json_out(['detail' => 'Error creando catálogo'], 500);
        }
        json_out(collection_detail_payload($pdo, $row, true, false), 201);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        server_error('Error creando catálogo', $e);
    }
}

// GET|PATCH|DELETE /collections/{id}
if (preg_match('#^/collections/(\d+)$#', $path, $m)) {
    $collectionId = (int)$m[1];
    if ($collectionId <= 0) {
        json_out(['detail' => 'ID inválido'], 400);
    }

    if ($method === 'GET') {
        $payload = auth_payload_or_401();
        require_any_role_or_403($payload, collection_manage_roles());
        try {
            $pdo = oderismo_pdo();
            $row = fetch_collection_row_by_id($pdo, $collectionId);
            if (!$row) {
                json_out(['detail' => 'Catálogo no encontrado'], 404);
            }
            json_out(collection_detail_payload($pdo, $row, true, true));
        } catch (Throwable $e) {
            server_error('Error cargando catálogo', $e);
        }
    }

    if ($method === 'PATCH') {
        $payload = auth_payload_or_401();
        require_any_role_or_403($payload, collection_manage_roles());
        $uid = (int)($payload['uid'] ?? 0);
        if ($uid <= 0) {
            json_out(['detail' => 'Sesión inválida'], 401);
        }

        $body = read_json_body();
        [$fields, $labelIds, $imageIds] = parse_collection_body($body, false);

        try {
            $pdo = oderismo_pdo();
            $row = fetch_collection_row_by_id($pdo, $collectionId);
            if (!$row) {
                json_out(['detail' => 'Catálogo no encontrado'], 404);
            }

            $sets = [];
            $params = ['id' => $collectionId, 'uid' => $uid];
            if (isset($fields['name'])) {
                $sets[] = 'name = :name';
                $params['name'] = $fields['name'];
            }
            if (array_key_exists('small_description', $fields)) {
                $sets[] = 'small_description = :small_description';
                $params['small_description'] = $fields['small_description'];
            }
            if (array_key_exists('description', $fields)) {
                $sets[] = 'description = :description';
                $params['description'] = $fields['description'];
            }
            if (isset($fields['slug'])) {
                $base = $fields['slug'] ?: collection_slug_from_name((string)($fields['name'] ?? $row['name']));
                $params['slug'] = collection_unique_slug($pdo, $base, $collectionId);
                $sets[] = 'slug = :slug';
            } elseif (isset($fields['name'])) {
                $params['slug'] = collection_unique_slug(
                    $pdo,
                    collection_slug_from_name($fields['name']),
                    $collectionId
                );
                $sets[] = 'slug = :slug';
            }
            if (array_key_exists('start_date', $fields)) {
                $sets[] = 'start_date = :start';
                $params['start'] = $fields['start_date'];
            }
            if (array_key_exists('end_date', $fields)) {
                $sets[] = 'end_date = :end';
                $params['end'] = $fields['end_date'];
            }
            if (array_key_exists('is_public', $fields)) {
                $sets[] = 'is_public = :pub';
                $params['pub'] = !empty($fields['is_public']) ? 1 : 0;
            }
            if (array_key_exists('is_active', $fields)) {
                $sets[] = 'is_active = :act';
                $params['act'] = !empty($fields['is_active']) ? 1 : 0;
            }

            $pdo->beginTransaction();
            if ($sets) {
                $sets[] = 'updated_by = :uid';
                $sets[] = 'updated_at = CURRENT_TIMESTAMP';
                $sql = 'UPDATE collections SET ' . implode(', ', $sets) . ' WHERE id = :id';
                $pdo->prepare($sql)->execute($params);
            } elseif ($labelIds !== null || $imageIds !== null) {
                $pdo->prepare(
                    'UPDATE collections SET updated_by = :uid, updated_at = CURRENT_TIMESTAMP WHERE id = :id'
                )->execute(['uid' => $uid, 'id' => $collectionId]);
            }

            if ($labelIds !== null) {
                $validLabels = validate_label_ids_for_collection($pdo, $labelIds);
                sync_collection_labels($pdo, $collectionId, $validLabels);
            }
            if ($imageIds !== null) {
                sync_collection_images($pdo, $collectionId, $imageIds, $uid);
            }

            $pdo->commit();
            $fresh = fetch_collection_row_by_id($pdo, $collectionId);
            json_out(collection_detail_payload($pdo, $fresh ?: $row, true, false));
        } catch (Throwable $e) {
            if (isset($pdo) && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            server_error('Error actualizando catálogo', $e);
        }
    }

    if ($method === 'DELETE') {
        $payload = auth_payload_or_401();
        require_any_role_or_403($payload, collection_manage_roles());
        try {
            $pdo = oderismo_pdo();
            $row = fetch_collection_row_by_id($pdo, $collectionId);
            if (!$row) {
                json_out(['detail' => 'Catálogo no encontrado'], 404);
            }
            $pdo->prepare('DELETE FROM collections WHERE id = :id')->execute(['id' => $collectionId]);
            json_out(['ok' => true, 'id' => $collectionId]);
        } catch (Throwable $e) {
            server_error('Error eliminando catálogo', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

// Parámetros globales — tabla MySQL `parameters` (un registro), solo ADMIN
if ($path === '/admin/parameters' || $path === '/admin/session-settings') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN']);

    require_once __DIR__ . '/../php/lib/app_settings.php';

    if ($method === 'GET') {
        try {
            $cfg = oderismo_session_config();
            $row = oderismo_parameters_row();
            json_out([
                'session' => (int)$cfg['session'],
                'session_close' => (int)$cfg['session_close'],
                'time_label' => (int)$row['time_label'],
                'time_index' => (int)$row['time_index'],
                'session_ttl_seconds' => (int)$cfg['session_ttl_seconds'],
                'session_warning_before_seconds' => (int)$cfg['session_warning_before_seconds'],
                'defaults' => ['session' => 10, 'session_close' => 1, 'time_label' => 10, 'time_index' => 30],
                'limits' => [
                    'session' => ['min' => 1, 'max' => 1440],
                    'session_close' => ['min' => 0],
                    'time_label' => ['min' => 2, 'max' => 600],
                    'time_index' => ['min' => 2, 'max' => 600],
                ],
            ]);
        } catch (Throwable $e) {
            server_error('Error cargando parámetros', $e);
        }
    }

    if ($method === 'PUT') {
        $body = read_json_body();
        try {
            $row = oderismo_parameters_row();
            $sessionMinutes = isset($body['session'])
                ? (int)$body['session']
                : (isset($body['session_ttl_seconds'])
                    ? (int)round(((int)$body['session_ttl_seconds']) / 60)
                    : (int)$row['session']);
            $sessionCloseMinutes = isset($body['session_close'])
                ? (int)$body['session_close']
                : (isset($body['session_warning_before_seconds'])
                    ? (int)round(((int)$body['session_warning_before_seconds']) / 60)
                    : (int)$row['session_close']);
            $timeLabelSeconds = isset($body['time_label'])
                ? (int)$body['time_label']
                : (int)$row['time_label'];
            $timeIndexSeconds = isset($body['time_index'])
                ? (int)$body['time_index']
                : (int)$row['time_index'];

            $saved = oderismo_save_parameters(
                $sessionMinutes,
                $sessionCloseMinutes,
                $timeLabelSeconds,
                $timeIndexSeconds
            );
            oderismo_invalidate_parameters_cache();
            $cfg = oderismo_session_config();
            json_out(array_merge(['ok' => true], $cfg, [
                'time_label' => $saved['time_label'],
                'time_index' => $saved['time_index'],
            ]));
        } catch (InvalidArgumentException $e) {
            json_out(['detail' => $e->getMessage()], 400);
        } catch (Throwable $e) {
            server_error('Error guardando parámetros', $e);
        }
    }

    json_out(['detail' => 'Método no permitido'], 405);
}

// Ajustes de redimensionado para descripción (motor FastAPI / Qdrant)
if ($path === '/admin/description-settings') {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN']);
    if ($method === 'GET' || $method === 'PUT') {
        proxy_to_fastapi('/admin/description-settings');
    }
    if ($method === 'POST') {
        proxy_to_fastapi('/admin/description-settings/preview');
    }
    json_out(['detail' => 'Método no permitido'], 405);
}

// Admin del motor (operaciones puntuales)
if (preg_match('#^/admin/images/(\d+)$#', $path, $m)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN', 'UPLOADER']);
    if ($method === 'GET') {
        proxy_to_fastapi($path);
    }
    json_out(['detail' => 'Método no permitido'], 405);
}

if (preg_match('#^/admin/images/(\d+)/rotate$#', $path)) {
    $payload = auth_payload_or_401();
    require_any_role_or_403($payload, ['ADMIN']);
    $qs = $_SERVER['QUERY_STRING'] ?? '';
    $up = $path;
    if (is_string($qs) && $qs !== '') $up .= '?' . $qs;
    proxy_to_fastapi($up);
}

json_out(['detail' => 'Not found'], 404);

