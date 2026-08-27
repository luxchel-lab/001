<?php
/**
 * POST /api/archicolor/auth/request-code
 *
 * Высылает одноразовый код на номер телефона.
 *
 * Поля: phone — номер в любом привычном виде (8..., +7..., 9...).
 *
 * Ответ: {"ok":true,"phone":"+7999***4455","ttl":300,"resendAfter":60}
 *
 * Код в ответ не попадает никогда, кроме режима debug на стенде.
 * Частота ограничена и по номеру, и по IP: через эту форму иначе можно
 * рассылать SMS за счёт магазина.
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\Quota;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    $phone = Api::postAny(array('phone', 'tel'), '');
    $result = Auth::requestCode($phone, Quota::clientIp());

    $payload = array(
        'ok'          => true,
        'phone'       => \ArchiColor\Sms::mask(Auth::normalizePhone($phone)),
        'ttl'         => $result['ttl'],
        'resendAfter' => $result['resendAfter'],
    );
    if ($result['code'] !== null) {
        $payload['devCode'] = $result['code'];   // только при debug
    }

    Api::send($payload);
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
