<?php
/**
 * GET /api/archicolor/balance/history?limit=50&offset=0
 *
 * История движений баллов для личного кабинета: тип, сумма, дата.
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\Balance;

try {
    Api::requireMethod('GET');

    $user = Auth::requireUser();
    $limit = (int) Api::query('limit', '50');
    $offset = (int) Api::query('offset', '0');

    Api::send(array(
        'ok'      => true,
        'balance' => Balance::get($user['id']),
        'items'   => Balance::history($user['id'], $limit > 0 ? $limit : 50, $offset),
        'total'   => Balance::historyCount($user['id']),
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
