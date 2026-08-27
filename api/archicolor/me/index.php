<?php
/**
 * GET /api/archicolor/me
 *
 * Текущий пользователь, остаток бесплатных примерок, баланс и последние
 * операции. Одним запросом, чтобы личный кабинет и страница визуализатора
 * не дёргали три эндпоинта подряд.
 *
 * Ответ для гостя: {"ok":true,"authorized":false}
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\Balance;
use ArchiColor\Quota;

try {
    Api::requireMethod('GET');

    $user = Auth::currentUser();
    if ($user === null) {
        Api::send(array('ok' => true, 'authorized' => false, 'quota' => Quota::state(null)));
    }

    $limit = (int) Api::query('limit', '20');

    Api::send(array(
        'ok'         => true,
        'authorized' => true,
        'user'       => array('phone' => $user['phoneMasked']),
        'quota'      => Quota::state($user),
        'balance'    => Balance::get($user['id']),
        'history'    => Balance::history($user['id'], $limit > 0 ? $limit : 20),
        'total'      => Balance::historyCount($user['id']),
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
