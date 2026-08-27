<?php
/**
 * POST /api/archicolor/auth/verify
 *
 * Проверяет код из SMS и открывает сессию (httponly cookie).
 *
 * Поля: phone, code.
 *
 * Ответ: {"ok":true,"user":{"phone":"+7999***4455"},"quota":{…}}
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\Quota;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    $user = Auth::verifyCode(
        Api::postAny(array('phone', 'tel'), ''),
        Api::post('code', ''),
        Quota::clientIp()
    );

    Api::send(array(
        'ok'    => true,
        'user'  => array('phone' => $user['phoneMasked']),
        'quota' => Quota::state($user),
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
