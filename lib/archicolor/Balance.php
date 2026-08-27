<?php
/**
 * ArchiColor AI — баллы: баланс, списание, начисление, история.
 *
 * Две таблицы:
 *   user_balance         — текущий остаток, одна строка на пользователя;
 *   balance_transactions — журнал движений, из которого этот остаток вырос.
 *
 * Журнал здесь не для отчётности, а для защиты: уникальный индекс
 * (type, source_id) физически не даёт зачислить один платёж ЮKassa или один
 * заказ дважды. Поэтому строка журнала пишется ПЕРВОЙ, и только если она
 * прошла — меняется баланс. Обратный порядок допускал бы удвоение при
 * повторном вебхуке.
 *
 * Списание устроено симметрично: проверка «хватает ли баллов» живёт внутри
 * UPDATE, а не в PHP, и решение принимается по числу затронутых строк.
 */

namespace ArchiColor;

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';

class Balance
{
    const TYPE_TOPUP    = 'topup';
    const TYPE_CASHBACK = 'cashback';
    const TYPE_SPEND    = 'spend';

    /** Текущий остаток баллов. */
    public static function get($userId)
    {
        return (int) Db::fetchValue(
            'SELECT balance FROM user_balance WHERE user_id = :user_id',
            array('user_id' => $userId),
            0
        );
    }

    public static function pricePoints()
    {
        return max(0, (int) Config::get('price_points', 20));
    }

    /**
     * Списывает баллы за примерку.
     *
     * Атомарно: условие balance >= :points стоит в самом UPDATE, поэтому
     * два параллельных запроса при остатке в 20 баллов дадут 1 и 0
     * затронутых строк — в минус баланс не уйдёт.
     *
     * @param string $sourceId идентификатор примерки (jobId) — попадает в журнал
     * @return bool удалось ли списать
     */
    public static function spend($userId, $points, $sourceId, $comment = null)
    {
        $points = (int) $points;
        if ($points <= 0) {
            return true;
        }

        return Db::transaction(function () use ($userId, $points, $sourceId, $comment) {
            $affected = Db::execute(
                'UPDATE user_balance
                    SET balance = balance - :points,
                        updated_at = :now
                  WHERE user_id = :user_id
                    AND balance >= :points_check',
                array(
                    'points'       => $points,
                    'points_check' => $points,
                    'now'          => Db::utcNow(),
                    'user_id'      => $userId,
                )
            );

            if ($affected !== 1) {
                return false;      // строки нет или баллов не хватило
            }

            Db::run(
                'INSERT INTO balance_transactions (user_id, amount, type, source_id, comment, created_at)
                 VALUES (:user_id, :amount, :type, :source_id, :comment, :created_at)',
                array(
                    'user_id'    => $userId,
                    'amount'     => -$points,
                    'type'       => self::TYPE_SPEND,
                    'source_id'  => $sourceId,
                    'comment'    => $comment,
                    'created_at' => Db::utcNow(),
                )
            );

            return true;
        });
    }

    /**
     * Возврат списанных баллов — когда провайдер не выполнил работу.
     *
     * Отдельной строкой журнала, а не удалением старой: история операций
     * должна оставаться правдой о том, что происходило со счётом.
     */
    public static function refundSpend($userId, $points, $sourceId)
    {
        $points = (int) $points;
        if ($points <= 0) {
            return false;
        }

        try {
            return Db::transaction(function () use ($userId, $points, $sourceId) {
                Db::run(
                    'INSERT INTO balance_transactions (user_id, amount, type, source_id, comment, created_at)
                     VALUES (:user_id, :amount, :type, :source_id, :comment, :created_at)',
                    array(
                        'user_id'    => $userId,
                        'amount'     => $points,
                        'type'       => self::TYPE_SPEND,
                        'source_id'  => $sourceId . ':refund',
                        'comment'    => 'Возврат: примерка не выполнена',
                        'created_at' => Db::utcNow(),
                    )
                );

                self::ensureRow($userId);
                Db::execute(
                    'UPDATE user_balance SET balance = balance + :points, updated_at = :now WHERE user_id = :user_id',
                    array('points' => $points, 'now' => Db::utcNow(), 'user_id' => $userId)
                );

                return true;
            });
        } catch (\PDOException $e) {
            if (Db::isDuplicateKey($e)) {
                return false;      // возврат по этой примерке уже сделан
            }
            throw $e;
        }
    }

    /**
     * Начисление баллов.
     *
     * Строка журнала пишется первой: уникальный индекс (type, source_id) —
     * это и есть защита от повторного начисления. Дубликат ключа означает
     * «уже зачислено», а не ошибку.
     *
     * @return array ['credited' => bool, 'duplicate' => bool, 'balance' => int]
     */
    public static function credit($userId, $points, $type, $sourceId, $comment = null)
    {
        $points = (int) $points;
        if ($points <= 0) {
            return array('credited' => false, 'duplicate' => false, 'balance' => self::get($userId));
        }

        try {
            Db::transaction(function () use ($userId, $points, $type, $sourceId, $comment) {
                Db::run(
                    'INSERT INTO balance_transactions (user_id, amount, type, source_id, comment, created_at)
                     VALUES (:user_id, :amount, :type, :source_id, :comment, :created_at)',
                    array(
                        'user_id'    => $userId,
                        'amount'     => $points,
                        'type'       => $type,
                        'source_id'  => $sourceId,
                        'comment'    => $comment,
                        'created_at' => Db::utcNow(),
                    )
                );

                self::ensureRow($userId);
                Db::execute(
                    'UPDATE user_balance SET balance = balance + :points, updated_at = :now WHERE user_id = :user_id',
                    array('points' => $points, 'now' => Db::utcNow(), 'user_id' => $userId)
                );
            });
        } catch (\PDOException $e) {
            if (Db::isDuplicateKey($e)) {
                Storage::log('balance_credit_duplicate', array(
                    'userId' => $userId, 'type' => $type, 'sourceId' => $sourceId,
                ));
                return array('credited' => false, 'duplicate' => true, 'balance' => self::get($userId));
            }
            throw $e;
        }

        return array('credited' => true, 'duplicate' => false, 'balance' => self::get($userId));
    }

    /**
     * Кэшбэк за покупку краски: 1000 ₽ суммы заказа = 1 балл.
     *
     * Округление обычное арифметическое: 1500 ₽ → 2 балла, 1499 ₽ → 1 балл.
     * Заказ дешевле 500 ₽ даёт 0 баллов — начисления не будет, но и ошибкой
     * это не считается.
     *
     * @param string $orderId номер заказа — по нему работает защита от повтора
     * @return array ['credited' => bool, 'duplicate' => bool, 'points' => int, 'balance' => int]
     */
    public static function cashbackForOrder($userId, $amountRub, $orderId)
    {
        $rate = max(1, (int) Config::get('rub_per_cashback_point', 1000));
        $points = (int) round((float) $amountRub / $rate);

        if ($points <= 0) {
            return array(
                'credited'  => false,
                'duplicate' => false,
                'points'    => 0,
                'balance'   => self::get($userId),
            );
        }

        $result = self::credit(
            $userId,
            $points,
            self::TYPE_CASHBACK,
            (string) $orderId,
            'Заказ №' . $orderId
        );
        $result['points'] = $points;

        return $result;
    }

    /** Пополнение из ЮKassa: 1 ₽ = 1 балл (курс настраивается). */
    public static function topUp($userId, $amountRub, $paymentId)
    {
        $rate = max(1, (int) Config::get('points_per_rub', 1));
        $points = (int) round((float) $amountRub * $rate);

        $result = self::credit(
            $userId,
            $points,
            self::TYPE_TOPUP,
            (string) $paymentId,
            self::formatRub($amountRub) . ' через ЮKassa'
        );
        $result['points'] = $points;

        return $result;
    }

    /**
     * История операций для личного кабинета.
     *
     * @return array строки журнала, новые сверху
     */
    public static function history($userId, $limit = 50, $offset = 0)
    {
        $limit = max(1, min(200, (int) $limit));
        $offset = max(0, (int) $offset);

        $rows = Db::fetchAll(
            'SELECT id, amount, type, source_id, comment, created_at
               FROM balance_transactions
              WHERE user_id = :user_id
              ORDER BY id DESC
              LIMIT ' . $limit . ' OFFSET ' . $offset,
            array('user_id' => $userId)
        );

        $out = array();
        foreach ($rows as $row) {
            $out[] = array(
                'id'        => (int) $row['id'],
                'amount'    => (int) $row['amount'],
                'type'      => $row['type'],
                'typeLabel' => self::typeLabel($row['type'], (int) $row['amount']),
                'comment'   => $row['comment'],
                'createdAt' => self::toIso($row['created_at']),
            );
        }
        return $out;
    }

    public static function historyCount($userId)
    {
        return (int) Db::fetchValue(
            'SELECT COUNT(*) FROM balance_transactions WHERE user_id = :user_id',
            array('user_id' => $userId),
            0
        );
    }

    /* ------------------------------------------------------------------ */

    private static function ensureRow($userId)
    {
        Db::insertIgnore('user_balance', array(
            'user_id'    => $userId,
            'balance'    => 0,
            'updated_at' => Db::utcNow(),
        ));
    }

    public static function typeLabel($type, $amount)
    {
        if ($type === self::TYPE_TOPUP) {
            return 'Пополнение';
        }
        if ($type === self::TYPE_CASHBACK) {
            return 'Кэшбэк за заказ';
        }
        return $amount > 0 ? 'Возврат за примерку' : 'Примерка в визуализаторе';
    }

    /** Даты в базе лежат в UTC — наружу отдаём с часовым поясом. */
    public static function toIso($utcDateTime)
    {
        try {
            $date = new \DateTime($utcDateTime, new \DateTimeZone('UTC'));
        } catch (\Exception $e) {
            return (string) $utcDateTime;
        }
        try {
            $date->setTimezone(new \DateTimeZone((string) Config::get('timezone', 'Europe/Moscow')));
        } catch (\Exception $e) {
            $date->setTimezone(new \DateTimeZone('+03:00'));
        }
        return $date->format('c');
    }

    private static function formatRub($amount)
    {
        return number_format((float) $amount, 2, ',', ' ') . ' ₽';
    }
}
