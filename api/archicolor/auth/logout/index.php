<?php
/**
 * POST /api/archicolor/auth/logout — закрывает сессию.
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    Auth::logout();
    Api::send(array('ok' => true));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
