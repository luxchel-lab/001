<?php
/**
 * ArchiColor AI — подключение к базе.
 *
 * Тонкая обёртка над PDO. ORM здесь не нужен: запросов немного, зато почти
 * каждый из них должен быть атомарным, а это удобнее писать руками.
 *
 * Откуда берутся реквизиты, по порядку:
 *   1. config: db_dsn / db_user / db_password;
 *   2. переменные окружения ARCHICOLOR_DB_DSN и т. д.;
 *   3. настройки Bitrix — /bitrix/.settings.php, а если его нет,
 *      глобальные $DBHost / $DBName / $DBLogin / $DBPassword из dbconn.php.
 *
 * Отдельная база не нужна: таблицы живут рядом с таблицами Bitrix.
 *
 * Все даты пишутся в UTC строками 'Y-m-d H:i:s' — так поведение не зависит
 * от таймзоны сервера БД. Московские сутки бесплатного лимита считает PHP
 * (см. Limits::mskDate()), а не база.
 */

namespace ArchiColor;

require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Config.php';

class Db
{
    /** @var \PDO|null */
    private static $pdo = null;

    /** @return \PDO @throws AppException */
    public static function pdo()
    {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $creds = self::credentials();
        if ($creds === null) {
            throw new AppException(
                'db_not_configured',
                'Сервис временно недоступен.',
                503,
                'не заданы реквизиты БД: ARCHICOLOR_DB_DSN или настройки Bitrix'
            );
        }

        try {
            $pdo = new \PDO($creds['dsn'], $creds['user'], $creds['password'], array(
                \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_EMULATE_PREPARES   => false,
            ));
        } catch (\PDOException $e) {
            throw new AppException('db_unavailable', 'Сервис временно недоступен.', 503, $e->getMessage());
        }

        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'sqlite') {
            // Без внешних ключей и ожидания блокировки параллельные тесты
            // ловят SQLITE_BUSY там, где MySQL просто подождёт.
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            $pdo->exec('PRAGMA journal_mode = WAL');
        }

        self::$pdo = $pdo;
        return self::$pdo;
    }

    public static function driver()
    {
        return self::pdo()->getAttribute(\PDO::ATTR_DRIVER_NAME);
    }

    /** @return array|null ['dsn' => …, 'user' => …, 'password' => …] */
    private static function credentials()
    {
        $dsn = (string) Config::get('db_dsn', '');
        if ($dsn !== '') {
            return array(
                'dsn'      => $dsn,
                'user'     => (string) Config::get('db_user', ''),
                'password' => (string) Config::get('db_password', ''),
            );
        }

        $bitrix = self::bitrixCredentials();
        if ($bitrix !== null) {
            return $bitrix;
        }

        return null;
    }

    /** Реквизиты из настроек Bitrix — чтобы не дублировать пароль в двух местах. */
    private static function bitrixCredentials()
    {
        $root = rtrim((string) Config::get('document_root'), '/');

        $settingsFile = $root . '/bitrix/.settings.php';
        if (is_readable($settingsFile)) {
            $settings = include $settingsFile;
            if (isset($settings['connections']['value']['default'])) {
                $c = $settings['connections']['value']['default'];
                if (!empty($c['host']) && !empty($c['database'])) {
                    return array(
                        'dsn'      => 'mysql:host=' . $c['host'] . ';dbname=' . $c['database'] . ';charset=utf8mb4',
                        'user'     => isset($c['login']) ? $c['login'] : '',
                        'password' => isset($c['password']) ? $c['password'] : '',
                    );
                }
            }
        }

        // Старые сборки Bitrix держат реквизиты в глобальных переменных dbconn.php
        if (!empty($GLOBALS['DBHost']) && !empty($GLOBALS['DBName'])) {
            return array(
                'dsn'      => 'mysql:host=' . $GLOBALS['DBHost'] . ';dbname=' . $GLOBALS['DBName'] . ';charset=utf8mb4',
                'user'     => isset($GLOBALS['DBLogin']) ? $GLOBALS['DBLogin'] : '',
                'password' => isset($GLOBALS['DBPassword']) ? $GLOBALS['DBPassword'] : '',
            );
        }

        return null;
    }

    /* ------------------------------------------------------------------ */

    /** @return \PDOStatement */
    public static function run($sql, array $params = array())
    {
        $statement = self::pdo()->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    /**
     * Выполняет запрос и возвращает число затронутых строк.
     *
     * Именно на это число опирается вся защита от гонок: «обновилась ли
     * строка» — единственный честный ответ на вопрос «успели ли мы».
     */
    public static function execute($sql, array $params = array())
    {
        return self::run($sql, $params)->rowCount();
    }

    public static function fetch($sql, array $params = array())
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public static function fetchAll($sql, array $params = array())
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function fetchValue($sql, array $params = array(), $default = null)
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? $default : $value;
    }

    public static function insert($sql, array $params = array())
    {
        self::run($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    /** INSERT, который молча пропускает дубликат ключа. */
    public static function insertIgnore($table, array $values)
    {
        $keyword = self::driver() === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        $columns = array_keys($values);
        $placeholders = array();
        foreach ($columns as $column) {
            $placeholders[] = ':' . $column;
        }

        $sql = $keyword . ' INTO ' . $table
            . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')';

        return self::execute($sql, $values);
    }

    /**
     * Транзакция. Колбэк выполняется внутри, исключение откатывает всё.
     *
     * @param callable $work
     * @return mixed то, что вернул колбэк
     */
    public static function transaction($work)
    {
        $pdo = self::pdo();
        if ($pdo->inTransaction()) {
            return call_user_func($work, $pdo);   // вложенную не открываем
        }

        $pdo->beginTransaction();
        try {
            $result = call_user_func($work, $pdo);
            $pdo->commit();
            return $result;
        } catch (\Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** Нарушение уникального индекса — по нему мы ловим повторное начисление. */
    public static function isDuplicateKey(\PDOException $e)
    {
        if ($e->getCode() === '23000' || $e->getCode() === 23000) {
            return true;
        }
        $info = $e->errorInfo;
        if (is_array($info) && isset($info[1])) {
            return (int) $info[1] === 1062      // MySQL ER_DUP_ENTRY
                || (int) $info[1] === 19        // SQLite SQLITE_CONSTRAINT
                || (int) $info[1] === 2067;     // SQLite SQLITE_CONSTRAINT_UNIQUE
        }
        return false;
    }

    /** Текущее время UTC в формате, в котором мы храним даты. */
    public static function utcNow()
    {
        return gmdate('Y-m-d H:i:s');
    }

    public static function utcAt($timestamp)
    {
        return gmdate('Y-m-d H:i:s', (int) $timestamp);
    }

    public static function isReady()
    {
        try {
            self::pdo();
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /** Только для тестов и миграций. */
    public static function setPdo(\PDO $pdo = null)
    {
        self::$pdo = $pdo;
    }
}
