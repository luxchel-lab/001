<?php
/**
 * ArchiColor AI — точка подключения библиотеки для HTTP-эндпоинтов.
 *
 * Ищет lib/archicolor в нескольких очевидных местах: репозиторий может лежать
 * как в корне сайта, так и внутри раздела. Отдельного автозагрузчика нет
 * намеренно — сервис должен ставиться копированием файлов, без composer.
 */

$candidates = array(
    dirname(dirname(__DIR__)) . '/lib/archicolor',                 // <root>/api/archicolor → <root>/lib/archicolor
    dirname(dirname(dirname(__DIR__))) . '/lib/archicolor',        // на уровень выше, если api вложен в раздел
);
if (!empty($_SERVER['DOCUMENT_ROOT'])) {
    $candidates[] = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/lib/archicolor';
}

$libDir = null;
foreach ($candidates as $candidate) {
    if (is_file($candidate . '/Api.php')) {
        $libDir = $candidate;
        break;
    }
}

if ($libDir === null) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array(
        'ok' => false,
        'error' => array(
            'code' => 'lib_missing',
            'message' => 'Библиотека ArchiColor AI не найдена. Скопируйте каталог lib/archicolor на сервер.',
        ),
    ), JSON_UNESCAPED_UNICODE);
    exit;
}

require_once $libDir . '/Api.php';
require_once $libDir . '/Config.php';
require_once $libDir . '/AppException.php';
require_once $libDir . '/Storage.php';
require_once $libDir . '/ImageFile.php';
require_once $libDir . '/ImageAnalyzer.php';
require_once $libDir . '/Palette.php';
require_once $libDir . '/PromptMapper.php';
require_once $libDir . '/Decor8Client.php';
require_once $libDir . '/Quota.php';

\ArchiColor\Api::bootstrap();
