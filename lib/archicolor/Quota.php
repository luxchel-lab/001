<?php
/**
 * ArchiColor AI — лимиты, баланс и защита от перебора.
 *
 * Каждая генерация стоит денег на стороне Decor8, поэтому лимит проверяется
 * и списывается ТОЛЬКО здесь, на сервере. Фронтенд показывает остаток для
 * удобства, но полагаться на него нельзя.
 *
 * Хранилище — файлы в .state/quota. Этого достаточно для одного сервера;
 * если сайт живёт на нескольких машинах или уже есть биллинг, подмените
 * источник данных через config: 'balance_provider' и 'balance_charge'.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';
require_once __DIR__ . '/AppException.php';

class Quota
{
    const COOKIE = 'archicolor_uid';

    /** @var string|null */
    private static $identity = null;

    /**
     * Кто перед нами: авторизованный пользователь Bitrix или гость с меткой в cookie.
     *
     * @return array ['key' => string, 'type' => 'user'|'guest', 'userId' => int|null]
     */
    public static function identity()
    {
        if (self::$identity !== null) {
            return self::$identity;
        }

        $userId = self::bitrixUserId();
        if ($userId > 0) {
            self::$identity = array('key' => 'u' . $userId, 'type' => 'user', 'userId' => $userId);
            return self::$identity;
        }

        $uid = isset($_COOKIE[self::COOKIE]) ? preg_replace('/[^a-f0-9]/', '', (string) $_COOKIE[self::COOKIE]) : '';
        if (strlen($uid) !== 32) {
            $uid = bin2hex(self::randomBytes(16));
            self::setCookie($uid);
        }

        self::$identity = array('key' => 'g' . $uid, 'type' => 'guest', 'userId' => null);
        return self::$identity;
    }

    private static function bitrixUserId()
    {
        if (isset($GLOBALS['USER']) && is_object($GLOBALS['USER']) && method_exists($GLOBALS['USER'], 'GetID')) {
            $id = (int) $GLOBALS['USER']->GetID();
            return $id > 0 ? $id : 0;
        }
        return 0;
    }

    private static function setCookie($uid)
    {
        if (headers_sent()) {
            return;
        }
        $expires = time() + 400 * 86400;
        $secure  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

        if (PHP_VERSION_ID >= 70300) {
            setcookie(self::COOKIE, $uid, array(
                'expires'  => $expires,
                'path'     => '/',
                'secure'   => $secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ));
        } else {
            setcookie(self::COOKIE, $uid, $expires, '/; samesite=Lax', '', $secure, true);
        }
        $_COOKIE[self::COOKIE] = $uid;
    }

    /**
     * Текущее состояние лимита — то, что видит фронтенд.
     *
     * @return array ['freeLeft','freeTotal','used','pricePerImage','balance','resetAt','canGenerate']
     */
    public static function state()
    {
        $record = self::read(self::identity());
        return self::describe($record);
    }

    private static function describe(array $record)
    {
        $freeTotal = (int) Config::get('free_generations');
        $used = (int) $record['used'];
        $freeLeft = max(0, $freeTotal - $used);
        $price = (int) Config::get('price_per_image');
        $balance = self::balance();

        return array(
            'freeLeft'      => $freeLeft,
            'freeTotal'     => $freeTotal,
            'used'          => $used,
            'pricePerImage' => $price,
            'balance'       => $balance,
            'resetAt'       => date('c', (int) $record['windowStart'] + (int) Config::get('free_window_days') * 86400),
            'canGenerate'   => $freeLeft > 0 || ($price > 0 && $balance >= $price),
        );
    }

    /**
     * Списывает одну генерацию. Вызывать ДО обращения к Decor8.
     *
     * @return array состояние после списания + ['charged' => bool, 'amount' => int]
     * @throws AppException если лимит исчерпан и платить нечем
     */
    public static function consume()
    {
        $identity = self::identity();
        self::checkRateLimit($identity);

        $path = self::path($identity);
        $handle = self::open($path);

        try {
            $record = self::readHandle($handle, $path);
            $freeTotal = (int) Config::get('free_generations');
            $price = (int) Config::get('price_per_image');

            $charged = false;
            $amount = 0;

            if ($record['used'] < $freeTotal) {
                $record['used']++;
            } else {
                $balance = self::balance();
                if ($price <= 0 || $balance < $price) {
                    throw new AppException(
                        'quota_exceeded',
                        'Бесплатные генерации закончились. Пополните баланс, чтобы продолжить.',
                        402
                    );
                }
                if (!self::charge($price)) {
                    throw new AppException(
                        'charge_failed',
                        'Не удалось списать оплату. Проверьте баланс и попробуйте ещё раз.',
                        402
                    );
                }
                $record['used']++;
                $record['paid'] = (int) $record['paid'] + 1;
                $charged = true;
                $amount = $price;
            }

            $record['lastAt'] = time();
            $record['hits'][] = time();
            $record['hits'] = self::recentHits($record['hits']);
            self::writeHandle($handle, $record);

            $state = self::describe($record);
            $state['charged'] = $charged;
            $state['amount'] = $amount;
            return $state;
        } finally {
            self::close($handle);
        }
    }

    /**
     * Возврат генерации, если Decor8 её не выполнил: клиент не должен платить
     * за неудачу провайдера.
     */
    public static function refund(array $consumed)
    {
        $identity = self::identity();
        $path = self::path($identity);
        $handle = self::open($path);

        try {
            $record = self::readHandle($handle, $path);
            if ($record['used'] > 0) {
                $record['used']--;
            }
            if (!empty($consumed['charged'])) {
                if ($record['paid'] > 0) {
                    $record['paid']--;
                }
                self::charge(-1 * (int) $consumed['amount']);
            }
            self::writeHandle($handle, $record);
        } finally {
            self::close($handle);
        }
    }

    /* ------------------------- баланс ------------------------- */

    /** Баланс берётся из вашего биллинга через хук; по умолчанию его нет. */
    public static function balance()
    {
        $provider = Config::get('balance_provider');
        if (is_callable($provider)) {
            try {
                return (float) call_user_func($provider, self::identity());
            } catch (\Exception $e) {
                Storage::log('balance_provider_failed', array('message' => $e->getMessage()));
            }
        }
        return 0.0;
    }

    private static function charge($amount)
    {
        $charger = Config::get('balance_charge');
        if (is_callable($charger)) {
            try {
                return (bool) call_user_func($charger, self::identity(), $amount);
            } catch (\Exception $e) {
                Storage::log('balance_charge_failed', array('message' => $e->getMessage()));
                return false;
            }
        }
        return false;
    }

    /* ------------------------- rate limit ------------------------- */

    /**
     * Потолок на IP: спасает от скрипта, который перебирает cookie,
     * чтобы бесконечно получать бесплатные генерации.
     *
     * @throws AppException
     */
    private static function checkRateLimit(array $identity)
    {
        $limit = (int) Config::get('rate_limit_per_hour');
        if ($limit <= 0) {
            return;
        }

        $ip = self::clientIp();
        if ($ip === '') {
            return;
        }

        $path = self::stateDir() . '/rate-' . sha1($ip) . '.json';
        $handle = self::open($path);

        try {
            $record = self::readHandle($handle, $path);
            $record['hits'] = self::recentHits($record['hits']);
            if (count($record['hits']) >= $limit) {
                throw new AppException(
                    'rate_limited',
                    'Слишком много запросов с этого адреса. Попробуйте через час.',
                    429
                );
            }
            $record['hits'][] = time();
            self::writeHandle($handle, $record);
        } finally {
            self::close($handle);
        }
    }

    private static function recentHits($hits)
    {
        $out = array();
        $deadline = time() - 3600;
        foreach ((array) $hits as $ts) {
            if ((int) $ts >= $deadline) {
                $out[] = (int) $ts;
            }
        }
        return array_slice($out, -200);
    }

    public static function clientIp()
    {
        foreach (array('HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR') as $key) {
            if (empty($_SERVER[$key])) {
                continue;
            }
            $value = (string) $_SERVER[$key];
            $first = trim(explode(',', $value)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }
        return '';
    }

    /* ------------------------- хранилище ------------------------- */

    private static function stateDir()
    {
        $dir = Storage::stateDir() . '/quota';
        ImageFile::ensureDir($dir);
        return $dir;
    }

    private static function path(array $identity)
    {
        return self::stateDir() . '/' . sha1($identity['key']) . '.json';
    }

    private static function open($path)
    {
        ImageFile::ensureDir(dirname($path));
        $handle = @fopen($path, 'c+');
        if (!$handle) {
            throw new AppException('storage_failed', 'Не удалось прочитать лимит генераций.', 500, $path);
        }
        if (!flock($handle, LOCK_EX)) {
            fclose($handle);
            throw new AppException('storage_locked', 'Сервис занят, попробуйте ещё раз.', 503, $path);
        }
        return $handle;
    }

    private static function close($handle)
    {
        if ($handle) {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private static function read(array $identity)
    {
        $path = self::path($identity);
        $handle = self::open($path);
        try {
            return self::readHandle($handle, $path);
        } finally {
            self::close($handle);
        }
    }

    private static function readHandle($handle, $path)
    {
        rewind($handle);
        $raw = stream_get_contents($handle);
        $data = $raw === '' ? null : json_decode($raw, true);

        $record = array(
            'used'        => 0,
            'paid'        => 0,
            'windowStart' => time(),
            'lastAt'      => 0,
            'hits'        => array(),
        );
        if (is_array($data)) {
            $record = array_merge($record, $data);
        }

        // окно лимита истекло — счётчик обнуляется
        $windowDays = (int) Config::get('free_window_days');
        if ($windowDays > 0 && time() - (int) $record['windowStart'] > $windowDays * 86400) {
            $record['used'] = 0;
            $record['paid'] = 0;
            $record['windowStart'] = time();
        }

        $record['used'] = max(0, (int) $record['used']);
        $record['paid'] = max(0, (int) $record['paid']);
        $record['hits'] = is_array($record['hits']) ? $record['hits'] : array();

        return $record;
    }

    private static function writeHandle($handle, array $record)
    {
        $json = json_encode($record, JSON_UNESCAPED_UNICODE);
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, $json);
        fflush($handle);
    }

    private static function randomBytes($length)
    {
        try {
            return random_bytes($length);
        } catch (\Exception $e) {
            $out = '';
            for ($i = 0; $i < $length; $i++) {
                $out .= chr(mt_rand(0, 255));
            }
            return $out;
        }
    }

    /** Только для тестов. */
    public static function resetIdentity()
    {
        self::$identity = null;
    }
}
