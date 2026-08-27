<?php
/**
 * ArchiColor AI — бесплатный дневной лимит примерок.
 *
 * Три примерки в сутки на пользователя, сутки считаются по Москве.
 * Счётчик обнуляется не заданием по расписанию, а самой моделью данных:
 * ключ строки — это (пользователь, московская дата), поэтому в 00:00 МСК
 * запись просто становится другой. Ничего чистить не нужно, и нет окна,
 * в котором крон ещё не отработал, а сутки уже сменились.
 *
 * Московская дата считается в PHP и приезжает в базу готовой строкой:
 * так лимит не зависит от таймзоны сервера БД.
 */

namespace ArchiColor;

require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Config.php';

class Limits
{
    /** Дата в часовом поясе лимита, 'Y-m-d'. */
    public static function today($timestamp = null)
    {
        $date = new \DateTime('@' . ($timestamp === null ? time() : (int) $timestamp));
        $date->setTimezone(self::timezone());
        return $date->format('Y-m-d');
    }

    /** Момент обнуления счётчика — ближайшая полночь по Москве. */
    public static function resetAt($timestamp = null)
    {
        $date = new \DateTime('@' . ($timestamp === null ? time() : (int) $timestamp));
        $date->setTimezone(self::timezone());
        $date->modify('tomorrow midnight');
        return $date->format('c');
    }

    private static function timezone()
    {
        $name = (string) Config::get('timezone', 'Europe/Moscow');
        try {
            return new \DateTimeZone($name);
        } catch (\Exception $e) {
            // Свежих tzdata на сервере может не быть; МСК с 2014 года — ровно UTC+3
            return new \DateTimeZone('+03:00');
        }
    }

    public static function perDay()
    {
        return max(0, (int) Config::get('free_per_day', 3));
    }

    /**
     * Сколько бесплатных примерок осталось сегодня.
     *
     * @return array ['perDay' => int, 'used' => int, 'left' => int, 'resetAt' => string]
     */
    public static function state($userId)
    {
        $perDay = self::perDay();
        $used = (int) Db::fetchValue(
            'SELECT used FROM ac_daily_usage WHERE user_id = :user_id AND usage_date = :usage_date',
            array('user_id' => $userId, 'usage_date' => self::today()),
            0
        );

        return array(
            'perDay'  => $perDay,
            'used'    => $used,
            'left'    => max(0, $perDay - $used),
            'resetAt' => self::resetAt(),
        );
    }

    /**
     * Пытается занять одну бесплатную примерку.
     *
     * Никакого «прочитали, посчитали, записали»: проверка лимита живёт
     * внутри UPDATE, а решение принимается по числу затронутых строк.
     * Два параллельных запроса при последней свободной примерке получат
     * 1 и 0 — второй уйдёт списывать баллы, а не пробьёт лимит.
     *
     * @return bool удалось ли занять
     */
    public static function consume($userId)
    {
        $perDay = self::perDay();
        if ($perDay <= 0) {
            return false;
        }

        $date = self::today();

        // Строка на сегодня может ещё не существовать. INSERT IGNORE ничего
        // не сломает, если её параллельно создаст другой запрос.
        Db::insertIgnore('ac_daily_usage', array(
            'user_id'    => $userId,
            'usage_date' => $date,
            'used'       => 0,
        ));

        $affected = Db::execute(
            'UPDATE ac_daily_usage
                SET used = used + 1
              WHERE user_id = :user_id
                AND usage_date = :usage_date
                AND used < :limit',
            array('user_id' => $userId, 'usage_date' => $date, 'limit' => $perDay)
        );

        return $affected === 1;
    }

    /**
     * Возвращает бесплатную примерку обратно — если провайдер не справился,
     * сутки клиента страдать не должны.
     */
    public static function refund($userId, $date = null)
    {
        return Db::execute(
            'UPDATE ac_daily_usage
                SET used = used - 1
              WHERE user_id = :user_id
                AND usage_date = :usage_date
                AND used > 0',
            array('user_id' => $userId, 'usage_date' => $date === null ? self::today() : $date)
        ) === 1;
    }
}
