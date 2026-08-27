<?php
/**
 * ArchiColor AI — пополнение баланса через ЮKassa (СБП).
 *
 * Документация: https://yookassa.ru/developers/api
 *
 * Два правила, вокруг которых всё построено:
 *
 * 1. Баллы начисляются только по вебхуку payment.succeeded — не в момент,
 *    когда клиент нажал «оплатить», и не по возврату на сайт. Возврат на
 *    страницу успеха ничего не доказывает: его можно открыть руками.
 *
 * 2. Вебхук ЮKassa ничем не подписан. Поэтому уведомление — это только
 *    сигнал «сходи проверь»: статус и сумму мы перечитываем из API по
 *    payment_id и верим ответу API, а не телу запроса. Дополнительно
 *    проверяется адрес отправителя.
 *
 * Если на сайте уже есть своя интеграция ЮKassa, этот класс можно не
 * использовать: достаточно вызвать Balance::topUp($userId, $rub, $paymentId)
 * из вашего обработчика — защита от повторного начисления живёт там.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/Storage.php';
require_once __DIR__ . '/Balance.php';

class YooKassa
{
    public static function isConfigured()
    {
        return (string) Config::get('yookassa_shop_id') !== ''
            && (string) Config::get('yookassa_secret_key') !== '';
    }

    /**
     * Создаёт платёж и возвращает ссылку на оплату.
     *
     * @param array $user
     * @param float $amountRub
     * @return array ['paymentId' => string, 'confirmationUrl' => string, 'points' => int]
     * @throws AppException
     */
    public static function createPayment(array $user, $amountRub)
    {
        if (!self::isConfigured()) {
            throw new AppException(
                'payments_not_configured',
                'Пополнение пока недоступно. Загляните чуть позже.',
                503,
                'не заданы YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY'
            );
        }

        $amountRub = round((float) $amountRub, 2);
        $min = (float) Config::get('yookassa_min_rub', 100);
        $max = (float) Config::get('yookassa_max_rub', 50000);

        if ($amountRub < $min || $amountRub > $max) {
            throw new AppException(
                'amount_invalid',
                'Сумма пополнения — от ' . (int) $min . ' до ' . (int) $max . ' ₽.',
                422
            );
        }

        $points = (int) round($amountRub * max(1, (int) Config::get('points_per_rub', 1)));

        $body = array(
            'amount'      => array('value' => number_format($amountRub, 2, '.', ''), 'currency' => 'RUB'),
            'capture'     => true,
            'description' => 'Баллы ArchiPaint: ' . $points . ' на визуализатор',
            'confirmation' => array(
                'type'       => 'redirect',
                'return_url' => self::returnUrl(),
            ),
            'metadata'    => array(
                'user_id' => (string) $user['id'],
                'points'  => (string) $points,
                'purpose' => 'archicolor_topup',
            ),
        );

        $method = (string) Config::get('yookassa_payment_method', 'sbp');
        if ($method !== '') {
            $body['payment_method_data'] = array('type' => $method);
        }

        // Ключ идемпотентности: повтор запроса из-за таймаута не создаст
        // второй платёж, а вернёт тот же самый.
        $idempotenceKey = self::uuid();

        $payment = self::request('POST', '/payments', $body, $idempotenceKey);

        if (empty($payment['id'])) {
            throw new AppException('payment_failed', 'Не удалось создать платёж. Попробуйте ещё раз.', 502,
                json_encode($payment, JSON_UNESCAPED_UNICODE));
        }

        Db::run(
            'INSERT INTO ac_payment (payment_id, user_id, amount_rub, points, status, created_at)
             VALUES (:payment_id, :user_id, :amount_rub, :points, :status, :created_at)',
            array(
                'payment_id' => $payment['id'],
                'user_id'    => $user['id'],
                'amount_rub' => $amountRub,
                'points'     => $points,
                'status'     => isset($payment['status']) ? $payment['status'] : 'pending',
                'created_at' => Db::utcNow(),
            )
        );

        Storage::log('yookassa_payment_created', array(
            'paymentId' => $payment['id'], 'userId' => $user['id'], 'amount' => $amountRub,
        ));

        $confirmationUrl = isset($payment['confirmation']['confirmation_url'])
            ? $payment['confirmation']['confirmation_url'] : null;

        return array(
            'paymentId'       => $payment['id'],
            'confirmationUrl' => $confirmationUrl,
            'points'          => $points,
            'amountRub'       => $amountRub,
            'status'          => isset($payment['status']) ? $payment['status'] : 'pending',
        );
    }

    /**
     * Обрабатывает уведомление payment.succeeded.
     *
     * Телу запроса не верим: берём из него только payment_id, а статус и
     * сумму перечитываем из API. Начисление идемпотентно — за это отвечает
     * уникальный индекс на (type, source_id) в balance_transactions.
     *
     * @param array $notification разобранное тело вебхука
     * @return array ['handled' => bool, 'credited' => bool, 'duplicate' => bool, 'reason' => string]
     * @throws AppException
     */
    public static function handleNotification(array $notification)
    {
        $event = isset($notification['event']) ? (string) $notification['event'] : '';
        $paymentId = isset($notification['object']['id']) ? (string) $notification['object']['id'] : '';

        if ($paymentId === '') {
            throw new AppException('notification_invalid', 'Некорректное уведомление.', 400, json_encode($notification));
        }

        if ($event !== 'payment.succeeded') {
            // Остальные события нас не касаются, но ответить надо 200,
            // иначе ЮKassa будет слать их повторно ещё сутки.
            self::updateStatus($paymentId, $event);
            return array('handled' => false, 'credited' => false, 'duplicate' => false, 'reason' => 'event_ignored');
        }

        $payment = self::isConfigured() ? self::request('GET', '/payments/' . rawurlencode($paymentId)) : null;

        if ($payment === null) {
            throw new AppException('payments_not_configured', 'Платежи не настроены.', 503);
        }
        if (empty($payment['status']) || $payment['status'] !== 'succeeded') {
            Storage::log('yookassa_not_succeeded', array(
                'paymentId' => $paymentId,
                'status'    => isset($payment['status']) ? $payment['status'] : null,
            ));
            return array('handled' => true, 'credited' => false, 'duplicate' => false, 'reason' => 'not_succeeded');
        }

        $row = Db::fetch('SELECT user_id, amount_rub, points FROM ac_payment WHERE payment_id = :id',
            array('id' => $paymentId));

        // Сумма берётся из ответа API, а не из нашей таблицы и не из вебхука.
        $amountRub = isset($payment['amount']['value']) ? (float) $payment['amount']['value'] : null;
        $userId = $row !== null ? (int) $row['user_id'] : null;

        if ($userId === null && isset($payment['metadata']['user_id'])) {
            $userId = (int) $payment['metadata']['user_id'];
        }

        if ($userId === null || $amountRub === null) {
            Storage::log('yookassa_unknown_payment', array('paymentId' => $paymentId));
            return array('handled' => true, 'credited' => false, 'duplicate' => false, 'reason' => 'unknown_payment');
        }

        $result = Balance::topUp($userId, $amountRub, $paymentId);
        self::updateStatus($paymentId, 'succeeded', true);

        Storage::log('yookassa_credited', array(
            'paymentId' => $paymentId,
            'userId'    => $userId,
            'amount'    => $amountRub,
            'points'    => $result['points'],
            'duplicate' => $result['duplicate'],
        ));

        return array(
            'handled'   => true,
            'credited'  => $result['credited'],
            'duplicate' => $result['duplicate'],
            'points'    => $result['points'],
            'reason'    => $result['duplicate'] ? 'already_credited' : 'credited',
        );
    }

    private static function updateStatus($paymentId, $status, $captured = false)
    {
        Db::execute(
            'UPDATE ac_payment SET status = :status' . ($captured ? ', captured_at = :captured' : '')
                . ' WHERE payment_id = :id',
            $captured
                ? array('status' => $status, 'captured' => Db::utcNow(), 'id' => $paymentId)
                : array('status' => $status, 'id' => $paymentId)
        );
    }

    /**
     * Пришёл ли вебхук с адреса ЮKassa.
     *
     * Подписи у уведомлений нет, так что это первый барьер. Второй и главный —
     * перечитывание платежа через API в handleNotification().
     */
    public static function isTrustedIp($ip)
    {
        $ranges = (array) Config::get('yookassa_webhook_ips');
        if (!$ranges) {
            return true;    // список пуст — проверка сознательно выключена
        }
        if ($ip === '') {
            return false;
        }

        foreach ($ranges as $range) {
            if (self::ipInRange($ip, $range)) {
                return true;
            }
        }
        return false;
    }

    private static function ipInRange($ip, $range)
    {
        if (strpos($range, '/') === false) {
            return $ip === $range;
        }

        list($subnet, $bits) = explode('/', $range, 2);
        $bits = (int) $bits;

        $ipBin = @inet_pton($ip);
        $subnetBin = @inet_pton($subnet);
        if ($ipBin === false || $subnetBin === false || strlen($ipBin) !== strlen($subnetBin)) {
            return false;
        }

        $bytes = intdiv($bits, 8);
        $remainder = $bits % 8;

        if ($bytes > 0 && strncmp($ipBin, $subnetBin, $bytes) !== 0) {
            return false;
        }
        if ($remainder === 0) {
            return true;
        }

        $mask = chr((0xFF << (8 - $remainder)) & 0xFF);
        return (substr($ipBin, $bytes, 1) & $mask) === (substr($subnetBin, $bytes, 1) & $mask);
    }

    /* ------------------------------------------------------------------ */

    /** @throws AppException */
    private static function request($method, $path, array $body = null, $idempotenceKey = null)
    {
        $url = rtrim((string) Config::get('yookassa_api_base'), '/') . $path;

        $headers = array(
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode(
                Config::get('yookassa_shop_id') . ':' . Config::get('yookassa_secret_key')
            ),
        );
        if ($idempotenceKey !== null) {
            $headers[] = 'Idempotence-Key: ' . $idempotenceKey;
        }

        $ch = curl_init($url);
        $options = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CUSTOMREQUEST  => $method,
        );
        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        curl_setopt_array($ch, $options);

        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($errno !== 0) {
            throw new AppException('payments_unreachable', 'Платёжный сервис недоступен. Попробуйте позже.', 502,
                'curl#' . $errno . ' ' . $error);
        }

        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            throw new AppException('payments_bad_json', 'Платёжный сервис вернул неожиданный ответ.', 502,
                substr((string) $raw, 0, 400));
        }

        if ($status >= 400) {
            $description = isset($decoded['description']) ? $decoded['description'] : ('HTTP ' . $status);
            throw new AppException('payment_rejected', 'Платёжный сервис отклонил запрос.', 502,
                $description . ' ' . substr((string) $raw, 0, 300));
        }

        return $decoded;
    }

    private static function returnUrl()
    {
        $url = (string) Config::get('yookassa_return_url', '/personal/balance/');
        if (strpos($url, 'http://') === 0 || strpos($url, 'https://') === 0) {
            return $url;
        }
        return Config::absoluteUrl($url);
    }

    private static function uuid()
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
