<?php
/**
 * ArchiColor AI — конфигурация бэкенда.
 *
 * Значения берутся, в порядке убывания приоритета:
 *   1. lib/archicolor/config.local.php  (возвращает массив; в git не хранится)
 *   2. переменные окружения
 *   3. значения по умолчанию из этого файла
 *
 * Ключ Decor8.ai задаётся ТОЛЬКО на сервере (env DECOR8AI_API_KEY или
 * config.local.php) и никогда не попадает в браузер.
 */

namespace ArchiColor;

class Config
{
    /** @var array|null */
    private static $cache = null;

    public static function defaults()
    {
        $docRoot = self::documentRoot();

        return array(
            /* ---------- Decor8.ai ---------- */
            'decor8_api_key'        => '',
            'decor8_api_base'       => 'https://api.decor8.ai',
            'decor8_timeout'        => 180,          // сек. на генерацию
            'decor8_connect_timeout'=> 15,
            'decor8_retries'        => 2,            // повторы при 429/5xx
            'decor8_num_images'     => 1,            // сколько вариантов просить
            'decor8_scale_factor'   => 0,            // апскейл результата отдельным вызовом (0 и 1 — не апскейлить)

            /**
             * Как передавать исходное фото в Decor8:
             *   'url'       — сохранить у себя и передать input_image_url
             *                 (сайт должен быть доступен извне);
             *   'multipart' — отправить файл полем input_image;
             *   'auto'      — url, если public_base_url похож на боевой домен,
             *                 иначе multipart; при ошибке пробуем второй способ.
             */
            'decor8_input_mode'     => 'auto',

            /**
             * Имя поля с цветом стен в /change_wall_color. Документация и SDK
             * Decor8 расходятся: на сайте это wall_color_hex_code, в SDK —
             * wall_color_hex. По умолчанию клиент пробует оба; если провайдер
             * зафиксирует одно имя, поставьте его здесь и лишний запрос уйдёт.
             */
            'decor8_wall_color_key' => '',

            /* ---------- Хранилище ---------- */
            'document_root'         => $docRoot,
            'storage_dir'           => $docRoot . '/upload/archicolor',
            'storage_url'           => '/upload/archicolor',
            'state_dir'             => $docRoot . '/upload/archicolor/.state',
            'public_base_url'       => '',           // https://archipaint.ru — обязательно для режима url
            'keep_files_days'       => 14,           // TTL картинок, дальше сборщик мусора их удалит

            /* ---------- Загрузка ---------- */
            'max_upload_bytes'      => 12 * 1024 * 1024,
            'allowed_mime'          => array('image/jpeg', 'image/png', 'image/webp'),
            'max_input_side'        => 1600,         // фото ужимается перед отправкой
            'jpeg_quality'          => 90,
            'min_input_side'        => 256,

            /**
             * Домены, с которых мы готовы скачивать готовое изображение.
             * Decor8 отдаёт ссылки со своей CDN; список закрывает SSRF, если
             * ответ провайдера когда-нибудь подменят.
             */
            'result_allowed_hosts'  => array(
                'decor8.ai', 'decor8ai.com', 'amazonaws.com', 'cloudfront.net',
                'googleapis.com', 'storage.googleapis.com', 'r2.dev', 'r2.cloudflarestorage.com',
            ),

            /* ---------- Разбор результата на цвета ---------- */
            'palette_slots'         => 5,            // сколько доминирующих цветов показывать
            'matches_per_slot'      => 3,            // сколько оттенков ArchiPaint на каждый цвет
            'analyze_max_samples'   => 26000,
            'analyze_iterations'    => 24,
            'merge_delta_e'         => 3.0,          // ближе этого ΔE цвета считаем одним
            'min_color_share'       => 0.015,        // цвета мельче 1.5% кадра не показываем

            /* ---------- Визуализатор стен ---------- */
            'wall_tones'            => 3,            // сколько тонов стены показывать (свет, полутон, тень)
            'wall_diff_delta_e'     => 6.0,          // с какого ΔE точка считается перекрашенной
            'wall_min_share'        => 0.02,         // если изменилось меньше 2% кадра — разбираем весь кадр

            /* ---------- Квоты и оплата ---------- */
            'free_generations'      => 10,           // бесплатных генераций на пользователя
            'free_window_days'      => 30,           // окно, в котором действует лимит
            'price_per_image'       => 149,          // ₽ за генерацию сверх лимита
            'rate_limit_per_hour'   => 20,           // жёсткий потолок на IP

            /* ---------- Прочее ---------- */
            'log_file'              => $docRoot . '/upload/archicolor/.state/archicolor.log',
            'log_enabled'           => true,
            'debug'                 => false,        // true — отдавать текст ошибки Decor8 клиенту
        );
    }

    public static function all()
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $config = self::defaults();

        $envMap = array(
            'decor8_api_key'   => 'DECOR8AI_API_KEY',
            'decor8_api_base'  => 'DECOR8AI_API_BASE',
            'decor8_input_mode'=> 'DECOR8AI_INPUT_MODE',
            'public_base_url'  => 'ARCHICOLOR_PUBLIC_BASE_URL',
            'free_generations' => 'ARCHICOLOR_FREE_GENERATIONS',
            'price_per_image'  => 'ARCHICOLOR_PRICE_PER_IMAGE',
            'debug'            => 'ARCHICOLOR_DEBUG',
        );
        foreach ($envMap as $key => $env) {
            $value = getenv($env);
            if ($value !== false && $value !== '') {
                $config[$key] = is_bool($config[$key]) ? self::toBool($value)
                    : (is_int($config[$key]) ? (int) $value : $value);
            }
        }

        $hosts = getenv('ARCHICOLOR_RESULT_HOSTS');
        if ($hosts !== false && trim($hosts) !== '') {
            $config['result_allowed_hosts'] = array_values(array_filter(array_map('trim', explode(',', $hosts))));
        }

        $local = __DIR__ . '/config.local.php';
        if (is_readable($local)) {
            $override = include $local;
            if (is_array($override)) {
                $config = array_merge($config, $override);
            }
        }

        $config['public_base_url'] = rtrim((string) $config['public_base_url'], '/');
        $config['storage_url']     = rtrim((string) $config['storage_url'], '/');
        $config['decor8_api_base'] = rtrim((string) $config['decor8_api_base'], '/');

        self::$cache = $config;
        return $config;
    }

    public static function get($key, $default = null)
    {
        $all = self::all();
        return array_key_exists($key, $all) ? $all[$key] : $default;
    }

    public static function isConfigured()
    {
        return self::get('decor8_api_key') !== '';
    }

    /** Абсолютный URL для пути вида /upload/archicolor/... */
    public static function absoluteUrl($path)
    {
        $base = self::get('public_base_url');
        if ($base === '') {
            $base = self::guessBaseUrl();
        }
        if ($base === '') {
            return $path;
        }
        return $base . '/' . ltrim($path, '/');
    }

    /** Догадка о базовом URL по заголовкам запроса — только для режима 'auto'. */
    public static function guessBaseUrl()
    {
        if (empty($_SERVER['HTTP_HOST'])) {
            return '';
        }
        $host = preg_replace('/[^A-Za-z0-9\.\-:]/', '', $_SERVER['HTTP_HOST']);
        if ($host === '') {
            return '';
        }
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
        return ($https ? 'https://' : 'http://') . $host;
    }

    /** Виден ли сайт из интернета: localhost и приватные адреса Decor8 не откроет. */
    public static function baseUrlIsPublic($base)
    {
        if ($base === '' || strpos($base, 'https://') !== 0 && strpos($base, 'http://') !== 0) {
            return false;
        }
        $host = parse_url($base, PHP_URL_HOST);
        if (!$host) {
            return false;
        }
        if (in_array(strtolower($host), array('localhost', '127.0.0.1', '::1'), true)) {
            return false;
        }
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return (bool) filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        }
        if (preg_match('/\.(local|test|localhost|internal)$/i', $host)) {
            return false;
        }
        return strpos($host, '.') !== false;
    }

    public static function documentRoot()
    {
        if (!empty($_SERVER['DOCUMENT_ROOT']) && is_dir($_SERVER['DOCUMENT_ROOT'])) {
            return rtrim($_SERVER['DOCUMENT_ROOT'], '/');
        }
        // CLI и тесты: корень репозитория на два уровня выше lib/archicolor
        return dirname(dirname(__DIR__));
    }

    private static function toBool($value)
    {
        return in_array(strtolower((string) $value), array('1', 'true', 'yes', 'on'), true);
    }

    /** Только для тестов. */
    public static function override(array $values)
    {
        self::$cache = array_merge(self::all(), $values);
    }
}
