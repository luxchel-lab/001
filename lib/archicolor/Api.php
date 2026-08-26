<?php
/**
 * ArchiColor AI — общая обвязка HTTP-эндпоинтов.
 *
 * Все ответы — JSON. Ошибки отдаются в одном формате:
 *   {"ok": false, "error": {"code": "...", "message": "..."}}
 * чтобы фронтенд мог показать человеческий текст, не разбирая HTML-страницу
 * с фаталом PHP.
 */

namespace ArchiColor;

require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';

class Api
{
    /** Готовит окружение эндпоинта: заголовки, буфер, перехват фаталов. */
    public static function bootstrap()
    {
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }

        // Предупреждения PHP не должны попадать в тело JSON-ответа.
        ini_set('display_errors', '0');
        if (ob_get_level() === 0) {
            ob_start();
        }

        register_shutdown_function(array(__CLASS__, 'handleShutdown'));
    }

    public static function handleShutdown()
    {
        $error = error_get_last();
        if (!$error || !in_array($error['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR), true)) {
            return;
        }
        Storage::log('fatal', array(
            'message' => $error['message'],
            'file'    => $error['file'],
            'line'    => $error['line'],
        ));
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        echo json_encode(array(
            'ok' => false,
            'error' => array(
                'code'    => 'internal',
                'message' => 'Внутренняя ошибка сервиса. Мы уже видим её в логе.',
            ),
        ), JSON_UNESCAPED_UNICODE);
    }

    /** @throws AppException */
    public static function requireMethod($method)
    {
        $actual = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
        if ($actual === strtoupper($method)) {
            return;
        }
        if ($actual === 'OPTIONS') {
            if (!headers_sent()) {
                header('Allow: ' . strtoupper($method));
            }
            self::send(array('ok' => true), 204);
        }
        throw new AppException('method_not_allowed', 'Метод не поддерживается.', 405, $actual);
    }

    /**
     * Простая защита от запросов с чужих сайтов: форма на /AI ходит на свой же
     * домен, значит Origin/Referer должны совпадать с хостом сайта.
     *
     * @throws AppException
     */
    public static function requireSameOrigin()
    {
        $host = isset($_SERVER['HTTP_HOST']) ? strtolower($_SERVER['HTTP_HOST']) : '';
        if ($host === '') {
            return;
        }

        $source = '';
        if (!empty($_SERVER['HTTP_ORIGIN'])) {
            $source = $_SERVER['HTTP_ORIGIN'];
        } elseif (!empty($_SERVER['HTTP_REFERER'])) {
            $source = $_SERVER['HTTP_REFERER'];
        } else {
            return;    // прямой вызов из curl или старого браузера — не блокируем
        }

        $sourceHost = strtolower((string) parse_url($source, PHP_URL_HOST));
        if ($sourceHost === '') {
            return;
        }
        $hostOnly = strtolower((string) parse_url('http://' . $host, PHP_URL_HOST));
        if ($sourceHost !== $hostOnly) {
            throw new AppException('bad_origin', 'Запрос пришёл с чужого домена.', 403, $sourceHost);
        }
    }

    public static function post($key, $default = '')
    {
        return isset($_POST[$key]) && is_string($_POST[$key]) ? $_POST[$key] : $default;
    }

    public static function query($key, $default = '')
    {
        return isset($_GET[$key]) && is_string($_GET[$key]) ? $_GET[$key] : $default;
    }

    /** Первое непустое значение среди нескольких имён полей. */
    public static function postAny(array $keys, $default = '')
    {
        foreach ($keys as $key) {
            $value = self::post($key, '');
            if (trim($value) !== '') {
                return $value;
            }
        }
        return $default;
    }

    public static function send(array $payload, $status = 200)
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
        }
        while (ob_get_level() > 1) {
            ob_end_clean();
        }
        if (ob_get_level() === 1) {
            ob_clean();
        }
        if ($status !== 204) {
            echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        exit;
    }

    public static function fail(AppException $e)
    {
        Storage::log('api_error', array(
            'code'   => $e->errorCode(),
            'status' => $e->status(),
            'detail' => $e->detail(),
        ));

        $error = array(
            'code'    => $e->errorCode(),
            'message' => $e->getMessage(),
        );
        if (Config::get('debug') && $e->detail() !== '') {
            $error['detail'] = $e->detail();
        }

        self::send(array('ok' => false, 'error' => $error), $e->status());
    }

    /** Непредвиденное исключение: в лог — подробности, клиенту — общий текст. */
    public static function failUnexpected(\Exception $e)
    {
        Storage::log('exception', array(
            'message' => $e->getMessage(),
            'file'    => $e->getFile(),
            'line'    => $e->getLine(),
        ));

        $error = array(
            'code'    => 'internal',
            'message' => 'Внутренняя ошибка сервиса. Попробуйте ещё раз.',
        );
        if (Config::get('debug')) {
            $error['detail'] = $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine();
        }

        self::send(array('ok' => false, 'error' => $error), 500);
    }
}
