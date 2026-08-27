<?php
/**
 * ArchiColor AI — отправка SMS с кодом подтверждения.
 *
 * Провайдера в проекте нет: у каждого сайта свой договор и свой шлюз.
 * Поэтому здесь только точка подключения — задайте в конфиге callable:
 *
 *   'sms_sender' => function ($phone, $text) {
 *       return MySmsGate::send($phone, $text);   // true, если принято шлюзом
 *   },
 *
 * Пока хук не задан, работает драйвер 'log': код уходит в
 * upload/archicolor/.state/archicolor.log. Этого хватает для разработки,
 * но на боевом сайте так авторизацию оставлять нельзя — selftest про это
 * предупредит.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';

class Sms
{
    /**
     * @return bool принял ли шлюз сообщение
     */
    public static function send($phone, $text)
    {
        $sender = Config::get('sms_sender');

        if (is_callable($sender)) {
            try {
                return (bool) call_user_func($sender, $phone, $text);
            } catch (\Exception $e) {
                Storage::log('sms_failed', array('phone' => self::mask($phone), 'error' => $e->getMessage()));
                return false;
            }
        }

        if (Config::get('sms_driver') === 'log') {
            Storage::log('sms_debug', array('phone' => self::mask($phone), 'text' => $text));
            return true;
        }

        Storage::log('sms_no_provider', array('phone' => self::mask($phone)));
        return false;
    }

    /** Настоящий ли шлюз подключён — нужно для selftest и диагностики. */
    public static function hasProvider()
    {
        return is_callable(Config::get('sms_sender'));
    }

    /**
     * Номер для лога: +7999***4455.
     * Полные номера в логах — лишний персональный данные там, где он не нужен.
     */
    public static function mask($phone)
    {
        $phone = (string) $phone;
        if (strlen($phone) < 8) {
            return '***';
        }
        return substr($phone, 0, 5) . str_repeat('*', 3) . substr($phone, -4);
    }

    public static function codeText($code)
    {
        return 'ArchiPaint: код входа ' . $code . '. Никому его не сообщайте.';
    }
}
