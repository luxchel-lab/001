<?php
/**
 * ArchiColor AI — авторизация по номеру телефона.
 *
 * Идентификатор пользователя — номер в формате E.164 (+79991234567).
 * Пароля нет: на номер уходит одноразовый код, по нему выдаётся сессия.
 *
 * Что здесь важно:
 *   — сам код в базе не хранится, только его хеш с секретом (pepper),
 *     сравнение через hash_equals;
 *   — попытки ввода считаются атомарно, после auth_code_max_attempts код
 *     сгорает: перебор четырёхзначного кода иначе занимает секунды;
 *   — частота запроса кодов ограничена и по номеру, и по IP, иначе через
 *     форму входа можно рассылать SMS за чужой счёт;
 *   — в cookie уходит токен, в базе лежит его хеш: утечка дампа сессий
 *     не даёт войти под пользователем.
 *
 * Если на сайте уже есть свои аккаунты, связь с ними — поле
 * ac_user.bitrix_user_id: при входе через Bitrix оно проставляется само.
 */

namespace ArchiColor;

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Sms.php';
require_once __DIR__ . '/Storage.php';

class Auth
{
    const COOKIE = 'archicolor_session';

    /** @var array|null */
    private static $user = null;
    /** @var bool */
    private static $resolved = false;

    /* ============================ номер ============================ */

    /**
     * Приводит номер к E.164.
     *
     * Понимает то, что реально вводят: 8 999 123-45-67, +7 (999) 1234567,
     * 9991234567. Всё остальное отвергаем — молча «исправленный» чужой
     * номер хуже отказа.
     *
     * @return string|null
     */
    public static function normalizePhone($raw)
    {
        $digits = preg_replace('/\D+/', '', (string) $raw);
        if ($digits === '') {
            return null;
        }

        $country = (string) Config::get('auth_default_country', '7');

        if ($country === '7') {
            if (strlen($digits) === 11 && $digits[0] === '8') {
                $digits = '7' . substr($digits, 1);
            } elseif (strlen($digits) === 10 && $digits[0] === '9') {
                $digits = '7' . $digits;
            }
            if (strlen($digits) === 11 && $digits[0] === '7') {
                return '+' . $digits;
            }
        }

        // Международный номер: 8–15 цифр по E.164
        if (strlen($digits) >= 8 && strlen($digits) <= 15) {
            return '+' . $digits;
        }

        return null;
    }

    /* ============================ код ============================ */

    /**
     * Высылает код подтверждения.
     *
     * @return array ['ttl' => int, 'resendAfter' => int, 'code' => string|null]
     *               code возвращается только при включённом debug
     * @throws AppException
     */
    public static function requestCode($phone, $ip)
    {
        $phone = self::normalizePhone($phone);
        if ($phone === null) {
            throw new AppException('phone_invalid', 'Проверьте номер телефона.', 422);
        }

        self::guardFrequency($phone, $ip);

        $length = max(4, min(8, (int) Config::get('auth_code_length', 4)));
        $code = self::randomCode($length);
        $ttl = max(60, (int) Config::get('auth_code_ttl', 300));

        Db::run(
            'INSERT INTO ac_auth_code (phone, code_hash, attempts, ip, created_at, expires_at)
             VALUES (:phone, :code_hash, 0, :ip, :created_at, :expires_at)',
            array(
                'phone'      => $phone,
                'code_hash'  => self::hashCode($phone, $code),
                'ip'         => $ip !== '' ? $ip : null,
                'created_at' => Db::utcNow(),
                'expires_at' => Db::utcAt(time() + $ttl),
            )
        );

        if (!Sms::send($phone, Sms::codeText($code))) {
            throw new AppException(
                'sms_failed',
                'Не удалось отправить SMS. Попробуйте позже или другой номер.',
                502,
                'шлюз не принял сообщение'
            );
        }

        Storage::log('auth_code_sent', array('phone' => Sms::mask($phone), 'ip' => $ip));

        return array(
            'ttl'         => $ttl,
            'resendAfter' => max(0, (int) Config::get('auth_code_resend', 60)),
            // Показывать код в ответе можно только на стенде: иначе
            // авторизация по SMS перестаёт быть авторизацией.
            'code'        => Config::get('debug') ? $code : null,
        );
    }

    /** Ограничения на частоту: и по номеру, и по адресу. */
    private static function guardFrequency($phone, $ip)
    {
        $resend = max(0, (int) Config::get('auth_code_resend', 60));
        if ($resend > 0) {
            $last = Db::fetchValue(
                'SELECT created_at FROM ac_auth_code WHERE phone = :phone ORDER BY id DESC LIMIT 1',
                array('phone' => $phone)
            );
            if ($last !== null) {
                $elapsed = time() - strtotime($last . ' UTC');
                if ($elapsed < $resend) {
                    throw new AppException(
                        'code_too_soon',
                        'Новый код можно запросить через ' . ($resend - $elapsed) . ' с.',
                        429,
                        'resend cooldown'
                    );
                }
            }
        }

        $perHour = max(1, (int) Config::get('auth_codes_per_hour', 5));
        $since = Db::utcAt(time() - 3600);

        $byPhone = (int) Db::fetchValue(
            'SELECT COUNT(*) FROM ac_auth_code WHERE phone = :phone AND created_at >= :since',
            array('phone' => $phone, 'since' => $since),
            0
        );
        if ($byPhone >= $perHour) {
            throw new AppException('too_many_codes', 'Слишком много запросов на этот номер. Попробуйте через час.', 429);
        }

        if ($ip !== '') {
            $byIp = (int) Db::fetchValue(
                'SELECT COUNT(*) FROM ac_auth_code WHERE ip = :ip AND created_at >= :since',
                array('ip' => $ip, 'since' => $since),
                0
            );
            if ($byIp >= $perHour * 3) {
                throw new AppException('too_many_codes', 'Слишком много запросов с этого адреса. Попробуйте через час.', 429);
            }
        }
    }

    /**
     * Проверяет код и открывает сессию.
     *
     * @return array пользователь
     * @throws AppException
     */
    public static function verifyCode($phone, $code, $ip)
    {
        $phone = self::normalizePhone($phone);
        if ($phone === null) {
            throw new AppException('phone_invalid', 'Проверьте номер телефона.', 422);
        }

        $code = preg_replace('/\D+/', '', (string) $code);
        if ($code === '') {
            throw new AppException('code_invalid', 'Введите код из SMS.', 422);
        }

        $row = Db::fetch(
            'SELECT id, code_hash, attempts FROM ac_auth_code
              WHERE phone = :phone AND consumed_at IS NULL AND expires_at >= :now
              ORDER BY id DESC LIMIT 1',
            array('phone' => $phone, 'now' => Db::utcNow())
        );

        if ($row === null) {
            throw new AppException('code_expired', 'Код устарел. Запросите новый.', 410);
        }

        $maxAttempts = max(1, (int) Config::get('auth_code_max_attempts', 5));

        // Счётчик попыток растёт до сверки кода и атомарно: иначе параллельные
        // запросы успевали бы перебирать код быстрее, чем растёт счётчик.
        $attemptTaken = Db::execute(
            'UPDATE ac_auth_code SET attempts = attempts + 1 WHERE id = :id AND attempts < :max',
            array('id' => $row['id'], 'max' => $maxAttempts)
        );
        if ($attemptTaken !== 1) {
            Db::execute('UPDATE ac_auth_code SET consumed_at = :now WHERE id = :id',
                array('now' => Db::utcNow(), 'id' => $row['id']));
            throw new AppException('code_attempts', 'Слишком много попыток. Запросите новый код.', 429);
        }

        if (!hash_equals($row['code_hash'], self::hashCode($phone, $code))) {
            throw new AppException('code_wrong', 'Неверный код. Проверьте SMS.', 401);
        }

        Db::execute('UPDATE ac_auth_code SET consumed_at = :now WHERE id = :id',
            array('now' => Db::utcNow(), 'id' => $row['id']));

        $user = self::findOrCreateUser($phone);
        self::startSession($user['id'], $ip);

        Storage::log('auth_login', array('userId' => $user['id'], 'phone' => Sms::mask($phone)));

        return $user;
    }

    /* ============================ сессия ============================ */

    private static function startSession($userId, $ip)
    {
        $token = bin2hex(random_bytes(32));
        $days = max(1, (int) Config::get('auth_session_days', 90));

        Db::run(
            'INSERT INTO ac_session (token_hash, user_id, ip, created_at, expires_at)
             VALUES (:token_hash, :user_id, :ip, :created_at, :expires_at)',
            array(
                'token_hash' => hash('sha256', $token),
                'user_id'    => $userId,
                'ip'         => $ip !== '' ? $ip : null,
                'created_at' => Db::utcNow(),
                'expires_at' => Db::utcAt(time() + $days * 86400),
            )
        );

        Db::execute('UPDATE ac_user SET last_login_at = :now WHERE id = :id',
            array('now' => Db::utcNow(), 'id' => $userId));

        self::setCookie($token, time() + $days * 86400);
        self::$user = null;
        self::$resolved = false;

        // Протухшие сессии чистим по случаю — отдельный крон ради этого не нужен
        if (mt_rand(1, 50) === 1) {
            Db::execute('DELETE FROM ac_session WHERE expires_at < :now', array('now' => Db::utcNow()));
        }
    }

    /**
     * Текущий пользователь или null.
     *
     * @return array|null ['id' => int, 'phone' => string, 'phoneMasked' => string]
     */
    public static function currentUser()
    {
        if (self::$resolved) {
            return self::$user;
        }
        self::$resolved = true;
        self::$user = null;

        if (!Db::isReady()) {
            return null;
        }

        $token = isset($_COOKIE[self::COOKIE]) ? (string) $_COOKIE[self::COOKIE] : '';
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            return self::fromBitrix();
        }

        $row = Db::fetch(
            'SELECT u.id, u.phone, u.bitrix_user_id
               FROM ac_session s
               JOIN ac_user u ON u.id = s.user_id
              WHERE s.token_hash = :token_hash AND s.expires_at >= :now',
            array('token_hash' => hash('sha256', $token), 'now' => Db::utcNow())
        );

        if ($row === null) {
            return self::fromBitrix();
        }

        self::$user = array(
            'id'          => (int) $row['id'],
            'phone'       => $row['phone'],
            'phoneMasked' => Sms::mask($row['phone']),
            'bitrixId'    => $row['bitrix_user_id'] === null ? null : (int) $row['bitrix_user_id'],
        );
        return self::$user;
    }

    /**
     * Пользователь, уже вошедший на сайт через Bitrix.
     *
     * Заводить ему отдельный вход по SMS незачем: если в его профиле есть
     * телефон, привязываем аккаунт к нашей таблице по нему.
     */
    private static function fromBitrix()
    {
        if (!isset($GLOBALS['USER']) || !is_object($GLOBALS['USER'])
            || !method_exists($GLOBALS['USER'], 'GetID') || !$GLOBALS['USER']->GetID()) {
            return null;
        }

        $bitrixId = (int) $GLOBALS['USER']->GetID();
        $row = Db::fetch('SELECT id, phone, bitrix_user_id FROM ac_user WHERE bitrix_user_id = :id',
            array('id' => $bitrixId));

        if ($row === null) {
            $phone = null;
            if (method_exists($GLOBALS['USER'], 'GetParam')) {
                $phone = self::normalizePhone($GLOBALS['USER']->GetParam('PERSONAL_PHONE'));
            }
            if ($phone === null) {
                return null;    // без телефона привязывать не к чему
            }

            $user = self::findOrCreateUser($phone);
            Db::execute('UPDATE ac_user SET bitrix_user_id = :bitrix WHERE id = :id',
                array('bitrix' => $bitrixId, 'id' => $user['id']));
            $user['bitrixId'] = $bitrixId;
            self::$user = $user;
            return self::$user;
        }

        self::$user = array(
            'id'          => (int) $row['id'],
            'phone'       => $row['phone'],
            'phoneMasked' => Sms::mask($row['phone']),
            'bitrixId'    => $bitrixId,
        );
        return self::$user;
    }

    /** @throws AppException если не авторизован */
    public static function requireUser()
    {
        $user = self::currentUser();
        if ($user === null) {
            throw new AppException(
                'auth_required',
                'Войдите по номеру телефона, чтобы пользоваться визуализатором.',
                401
            );
        }
        return $user;
    }

    public static function logout()
    {
        $token = isset($_COOKIE[self::COOKIE]) ? (string) $_COOKIE[self::COOKIE] : '';
        if (preg_match('/^[a-f0-9]{64}$/', $token)) {
            Db::execute('DELETE FROM ac_session WHERE token_hash = :token_hash',
                array('token_hash' => hash('sha256', $token)));
        }
        self::setCookie('', time() - 3600);
        self::$user = null;
        self::$resolved = true;
    }

    /* ============================ служебное ============================ */

    private static function findOrCreateUser($phone)
    {
        // Гонку двух одновременных входов закрывает уникальный индекс на phone
        Db::insertIgnore('ac_user', array(
            'phone'      => $phone,
            'created_at' => Db::utcNow(),
        ));

        $row = Db::fetch('SELECT id, phone, bitrix_user_id FROM ac_user WHERE phone = :phone',
            array('phone' => $phone));

        return array(
            'id'          => (int) $row['id'],
            'phone'       => $row['phone'],
            'phoneMasked' => Sms::mask($row['phone']),
            'bitrixId'    => $row['bitrix_user_id'] === null ? null : (int) $row['bitrix_user_id'],
        );
    }

    private static function randomCode($length)
    {
        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= (string) random_int(0, 9);
        }
        return $code;
    }

    private static function hashCode($phone, $code)
    {
        return hash('sha256', $phone . ':' . $code . ':' . self::pepper());
    }

    /**
     * Секрет для хеширования кодов. Задаётся конфигом; если не задан —
     * генерируется один раз и лежит в .state рядом с квотами.
     */
    private static function pepper()
    {
        $configured = (string) Config::get('auth_pepper', '');
        if ($configured !== '') {
            return $configured;
        }

        $file = Storage::stateDir() . '/auth-pepper.txt';
        if (is_readable($file)) {
            $value = trim((string) file_get_contents($file));
            if ($value !== '') {
                return $value;
            }
        }

        $value = bin2hex(random_bytes(32));
        @file_put_contents($file, $value, LOCK_EX);
        @chmod($file, 0600);
        return $value;
    }

    private static function setCookie($value, $expires)
    {
        if (headers_sent()) {
            return;
        }
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

        if (PHP_VERSION_ID >= 70300) {
            setcookie(self::COOKIE, $value, array(
                'expires'  => $expires,
                'path'     => '/',
                'secure'   => $secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ));
        } else {
            setcookie(self::COOKIE, $value, $expires, '/; samesite=Lax', '', $secure, true);
        }

        if ($value === '') {
            unset($_COOKIE[self::COOKIE]);
        } else {
            $_COOKIE[self::COOKIE] = $value;
        }
    }

    /** Только для тестов. */
    public static function reset()
    {
        self::$user = null;
        self::$resolved = false;
    }
}
