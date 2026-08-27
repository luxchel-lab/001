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

            /* ---------- База данных ---------- */
            'db_dsn'                => '',           // пусто — берём реквизиты из настроек Bitrix
            'db_user'               => '',
            'db_password'           => '',

            /* ---------- Лимиты и баллы ---------- */
            'free_per_day'          => 3,            // бесплатных примерок в сутки на пользователя
            'timezone'              => 'Europe/Moscow', // по этим суткам считается лимит
            'price_points'          => 20,           // баллов за примерку сверх бесплатного лимита
            'points_per_rub'        => 1,            // 1 ₽ пополнения = 1 балл
            'rub_per_cashback_point'=> 1000,         // 1000 ₽ заказа = 1 балл кэшбэка
            'rate_limit_per_hour'   => 20,           // жёсткий потолок на IP

            /* ---------- Авторизация по телефону ---------- */
            'sms_driver'            => 'log',        // 'log' — код только в лог; боевой провайдер задаётся хуком sms_sender
            'sms_sender'            => null,         // callable(string $phone, string $text): bool
            'auth_code_length'      => 4,
            'auth_code_ttl'         => 300,          // сколько живёт код, сек
            'auth_code_resend'      => 60,           // не чаще одного кода в минуту на номер
            'auth_code_max_attempts'=> 5,            // попыток ввода до сгорания кода
            'auth_codes_per_hour'   => 5,            // кодов в час на номер и на IP
            'auth_session_days'     => 90,
            'auth_default_country'  => '7',          // код страны для номеров, введённых без него
            'auth_pepper'           => '',           // секрет для хеширования кодов; пусто — сгенерируется в .state

            /* ---------- ЮKassa ---------- */
            'yookassa_shop_id'      => '',
            'yookassa_secret_key'   => '',
            'yookassa_api_base'     => 'https://api.yookassa.ru/v3',
            'yookassa_payment_method'=> 'sbp',       // СБП
            'yookassa_return_url'   => '/personal/balance/',
            'yookassa_min_rub'      => 100,
            'yookassa_max_rub'      => 50000,
            /**
             * Подсети, с которых ЮKassa шлёт вебхуки. Пустой список выключает
             * проверку — так делать не надо: вебхук ничем не подписан, и адрес
             * отправителя вместе с перепроверкой платежа по API это
             * единственное, что отличает уведомление от подделки.
             */
            'yookassa_webhook_ips'  => array(
                '185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25',
                '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25',
                '2a02:5180::/32',
            ),

            /* ---------- Кэшбэк из магазина ---------- */
            'cashback_secret'       => '',           // общий секрет для подписи вызова /api/archicolor/cashback

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
            'debug'            => 'ARCHICOLOR_DEBUG',
            'db_dsn'           => 'ARCHICOLOR_DB_DSN',
            'db_user'          => 'ARCHICOLOR_DB_USER',
            'db_password'      => 'ARCHICOLOR_DB_PASSWORD',
            'free_per_day'     => 'ARCHICOLOR_FREE_PER_DAY',
            'price_points'     => 'ARCHICOLOR_PRICE_POINTS',
            'sms_driver'       => 'ARCHICOLOR_SMS_DRIVER',
            'yookassa_shop_id' => 'YOOKASSA_SHOP_ID',
            'yookassa_secret_key' => 'YOOKASSA_SECRET_KEY',
            'yookassa_api_base' => 'YOOKASSA_API_BASE',
            'cashback_secret'  => 'ARCHICOLOR_CASHBACK_SECRET',
        );
        foreach ($envMap as $key => $env) {
            $value = getenv($env);
            if ($value !== false && $value !== '') {
                $config[$key] = is_bool($config[$key]) ? self::toBool($value)
                    : (is_int($config[$key]) ? (int) $value : $value);
            }
        }

        $webhookIps = getenv('YOOKASSA_WEBHOOK_IPS');
        if ($webhookIps !== false && trim($webhookIps) !== '') {
            $config['yookassa_webhook_ips'] = array_values(array_filter(array_map('trim', explode(',', $webhookIps))));
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
