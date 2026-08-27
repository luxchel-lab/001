<?php
/**
 * ArchiColor AI — доступ к примерке: авторизация, дневной лимит, баллы.
 *
 * Одна точка, через которую проходит каждая примерка, и один порядок решений:
 *
 *   1. пользователь должен быть авторизован по телефону;
 *   2. сначала тратим бесплатную примерку из трёх суточных;
 *   3. если бесплатные кончились — списываем баллы;
 *   4. если баллов не хватает — не запускаем генерацию и просим пополнить.
 *
 * Всё списывается ДО обращения к Decor8 и возвращается, если провайдер
 * не справился: клиент не платит за чужую неудачу.
 *
 * Проверять лимит на фронтенде нельзя — он тут только для подписи на кнопке.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Auth.php';
require_once __DIR__ . '/Limits.php';
require_once __DIR__ . '/Balance.php';
require_once __DIR__ . '/Storage.php';
require_once __DIR__ . '/AppException.php';

class Quota
{
    /**
     * Что показать пользователю: остаток бесплатных, баланс, цена примерки.
     *
     * @return array
     */
    public static function state(array $user = null)
    {
        $user = $user === null ? Auth::currentUser() : $user;
        $price = Balance::pricePoints();

        if ($user === null) {
            return array(
                'authorized'    => false,
                'freePerDay'    => Limits::perDay(),
                'freeLeft'      => Limits::perDay(),
                'usedToday'     => 0,
                'resetAt'       => Limits::resetAt(),
                'balance'       => 0,
                'pricePoints'   => $price,
                'canGenerate'   => false,
            );
        }

        $limits = Limits::state($user['id']);
        $balance = Balance::get($user['id']);

        return array(
            'authorized'  => true,
            'phone'       => $user['phoneMasked'],
            'freePerDay'  => $limits['perDay'],
            'freeLeft'    => $limits['left'],
            'usedToday'   => $limits['used'],
            'resetAt'     => $limits['resetAt'],
            'balance'     => $balance,
            'pricePoints' => $price,
            'canGenerate' => $limits['left'] > 0 || $balance >= $price,
        );
    }

    /**
     * Занимает одну примерку.
     *
     * @param string $jobId идентификатор примерки — попадёт в журнал списания
     * @return array ['userId' => int, 'charged' => 'free'|'points', 'points' => int, 'date' => string]
     * @throws AppException если нет авторизации, превышен потолок на IP
     *                      или не хватает баллов
     */
    public static function consume($jobId)
    {
        $user = Auth::requireUser();
        self::checkRateLimit();

        $date = Limits::today();

        if (Limits::consume($user['id'])) {
            return array(
                'userId'  => $user['id'],
                'charged' => 'free',
                'points'  => 0,
                'date'    => $date,
                'jobId'   => $jobId,
            );
        }

        $price = Balance::pricePoints();
        if ($price <= 0) {
            throw new AppException(
                'quota_exceeded',
                'Бесплатные примерки на сегодня закончились. Попробуйте завтра.',
                402
            );
        }

        // Комментарий не пишем: подпись типа операции уже говорит, за что списано
        if (!Balance::spend($user['id'], $price, $jobId, null)) {
            $balance = Balance::get($user['id']);
            throw new AppException(
                'not_enough_points',
                'Бесплатные примерки на сегодня закончились, а на счету ' . $balance . ' из ' . $price
                    . ' баллов. Пополните баланс, чтобы продолжить.',
                402
            );
        }

        return array(
            'userId'  => $user['id'],
            'charged' => 'points',
            'points'  => $price,
            'date'    => $date,
            'jobId'   => $jobId,
        );
    }

    /**
     * Возврат примерки, если Decor8 её не выполнил.
     *
     * Возвращаем ровно то, что списали: бесплатную — в счётчик суток,
     * баллы — на счёт отдельной строкой журнала.
     */
    public static function refund(array $consumed)
    {
        if (empty($consumed['userId'])) {
            return;
        }

        try {
            if ($consumed['charged'] === 'free') {
                Limits::refund($consumed['userId'], $consumed['date']);
            } else {
                Balance::refundSpend($consumed['userId'], $consumed['points'], $consumed['jobId']);
            }
        } catch (\Exception $e) {
            Storage::log('refund_failed', array(
                'userId'  => $consumed['userId'],
                'charged' => $consumed['charged'],
                'message' => $e->getMessage(),
            ));
        }
    }

    /**
     * Потолок на IP: защита от скрипта, который регистрирует номера пачкой.
     * К деньгам отношения не имеет — это защита инфраструктуры.
     *
     * @throws AppException
     */
    private static function checkRateLimit()
    {
        $limit = (int) Config::get('rate_limit_per_hour');
        if ($limit <= 0) {
            return;
        }

        $ip = self::clientIp();
        if ($ip === '') {
            return;
        }

        $path = Storage::stateDir() . '/rate-' . sha1($ip) . '.json';
        $handle = @fopen($path, 'c+');
        if (!$handle) {
            return;     // не смогли посчитать — не повод ронять примерку
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                return;
            }
            rewind($handle);
            $raw = stream_get_contents($handle);
            $data = $raw === '' ? array() : json_decode($raw, true);
            $hits = isset($data['hits']) && is_array($data['hits']) ? $data['hits'] : array();

            $deadline = time() - 3600;
            $recent = array();
            foreach ($hits as $ts) {
                if ((int) $ts >= $deadline) {
                    $recent[] = (int) $ts;
                }
            }

            if (count($recent) >= $limit) {
                throw new AppException(
                    'rate_limited',
                    'Слишком много запросов с этого адреса. Попробуйте через час.',
                    429
                );
            }

            $recent[] = time();
            rewind($handle);
            ftruncate($handle, 0);
            fwrite($handle, json_encode(array('hits' => array_slice($recent, -200))));
            fflush($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    public static function clientIp()
    {
        foreach (array('HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR') as $key) {
            if (empty($_SERVER[$key])) {
                continue;
            }
            $parts = explode(',', (string) $_SERVER[$key]);
            $first = trim($parts[0]);
            if (filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }
        return '';
    }
}
