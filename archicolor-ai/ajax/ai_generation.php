<?php

define("NO_KEEP_STATISTIC", true);
define("NOT_CHECK_PERMISSIONS", true);
define("BX_NO_ACCELERATOR_RESET", true);

require($_SERVER["DOCUMENT_ROOT"]."/bitrix/modules/main/include/prolog_before.php");

use Bitrix\Main\Application;
use Bitrix\Main\Config\Option;
use Bitrix\Main\Web\Json;

header('Content-Type: application/json; charset=utf-8');

function translateToEnglish($text) {
    if (empty($text)) return "";
    
    if (!preg_match('/[А-Яа-яёЁ]/u', $text)) {
        return $text;
    }

    $url = "https://googleapis.com" . urlencode($text);
    
    $httpClient = new \Bitrix\Main\Web\HttpClient(["socketTimeout" => 5]);
    $response = $httpClient->get($url);
    
    if ($httpClient->getStatus() == 200 && !empty($response)) {
        try {
            $resData = json_decode($response, true);
            if (isset($resData[0][0][0])) {
                return $resData[0][0][0];
            }
        } catch (\Exception $e) {
            // Игнорируем ошибку парсинга
        }
    }
    
    return $text;
}

global $USER;
if (!$USER->IsAuthorized()) {
    http_response_code(401);
    echo Json::encode(["success" => false, "error" => "Пользователь не авторизован"]);
    die();
}

$userId = intval($USER->GetID());
$request = Application::getInstance()->getContext()->getRequest();

if (!$request->isPost()) {
    http_response_code(405);
    echo Json::encode(["success" => false, "error" => "Метод не поддерживается"]);
    die();
}

if (!check_bitrix_sessid()) {
    http_response_code(403);
    echo Json::encode(["success" => false, "error" => "Сессия истекла. Обновите страницу и попробуйте снова."]);
    die();
}

$fileArray = $_FILES['image'];
if (!$fileArray || $fileArray['error'] !== UPLOAD_ERR_OK) {
    echo Json::encode(["success" => false, "error" => "Файл изображения не загружен или поврежден"]);
    die();
}

$maxFileSize = 12 * 1024 * 1024;
if ((int)$fileArray['size'] <= 0 || (int)$fileArray['size'] > $maxFileSize) {
    http_response_code(413);
    echo Json::encode(["success" => false, "error" => "Размер изображения не должен превышать 12 МБ"]);
    die();
}

$imageInfo = @getimagesize($fileArray['tmp_name']);
$allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
if (!$imageInfo || !in_array($imageInfo['mime'], $allowedMime, true)) {
    http_response_code(415);
    echo Json::encode(["success" => false, "error" => "Поддерживаются только JPG, PNG и WEBP"]);
    die();
}

$freeLimit = 3;
$optionName = "ai_user_used_" . $userId;
$usedQuota = intval(Option::get("main", $optionName, 0));

$isPaid = false;
$price = 20.00;
$currency = "RUB";

if ($usedQuota >= $freeLimit) {
    if (\Bitrix\Main\Loader::includeModule("sale")) {
        $dbAccount = CSaleUserAccount::GetList([], ["USER_ID" => $userId, "CURRENCY" => $currency]);
        if ($arAccount = $dbAccount->Fetch()) {
            if (floatval($arAccount["CURRENT_BUDGET"]) < $price) {
                echo Json::encode([
                    "success" => false,
                    "error_code" => "LOW_BALANCE",
                    "error" => "Недостаточно средств на счете. Стоимость генерации — 20 руб."
                ]);
                die();
            }
            $isPaid = true; 
        } else {
            echo Json::encode([
                "success" => false,
                "error_code" => "LOW_BALANCE",
                "error" => "Внутренний счет отсутствует. Пожалуйста, пополните баланс."
            ]);
            die();
        }
    } else {
        echo Json::encode(["success" => false, "error" => "Модуль интернет-магазина (sale) недоступен"]);
        die();
    }
}

$roomType = htmlspecialcharsbx($request->getPost("room_type"));
$style = htmlspecialcharsbx($request->getPost("style"));
$notes = trim((string)$request->getPost("notes"));

$arFile = CFile::MakeFileArray($fileArray["tmp_name"]);
$arFile["name"] = $fileArray["name"];
$arFile["type"] = $fileArray["type"];
$fileId = CFile::SaveFile($arFile, "archicolor_ai/generation_records");

if (!$fileId) {
    echo Json::encode(["success" => false, "error" => "Не удалось сохранить исходный файл в Битрикс"]);
    die();
}

$requestServer = Application::getInstance()->getContext()->getServer();
$protocol = ($request->isHttps() ? 'https://' : 'http://');
$domain = $requestServer->getServerName();
$absoluteSourceImageUrl = $protocol . $domain . CFile::GetPath($fileId);

$roomMapping = [
    "living_room" => "livingroom", "bedroom" => "bedroom", "kitchen" => "kitchen",
    "bathroom" => "bathroom", "kids_room" => "kidsroom", "home_office" => "office",
    "dining_room" => "diningroom", "hallway" => "foyer"
];

$styleMapping = [
    "modern" => "modern", "scandinavian" => "scandinavian", "minimalist" => "minimalist",
    "neoclassic" => "transitional", "loft" => "industrial", "artdeco" => "artdeco"
];

$apiRoomType = isset($roomMapping[$roomType]) ? $roomMapping[$roomType] : "livingroom";
$apiDesignStyle = isset($styleMapping[$style]) ? $styleMapping[$style] : "modern";

$apiFields = [
    "input_image_url" => $absoluteSourceImageUrl,
    "num_images"      => 1,
    "scale_factor"    => 2
];

if (!empty($notes)) {
    $englishNotes = translateToEnglish($notes);
    $apiFields["prompt"] = "A " . $apiDesignStyle . " style " . $apiRoomType . ". Additional requirements: " . $englishNotes;
} else {
    $apiFields["room_type"] = $apiRoomType;
    $apiFields["design_style"] = $apiDesignStyle;
}

$httpClient = new \Bitrix\Main\Web\HttpClient([
    "socketTimeout" => 60, 
    "streamTimeout" => 60
]);

$apiToken = trim((string)getenv("DECOR8_API_TOKEN"));
if ($apiToken === '') {
    $apiToken = trim((string)Option::get("archipaint", "decor8_api_token", ""));
}
if ($apiToken === '') {
    http_response_code(503);
    echo Json::encode(["success" => false, "error" => "AI-сервис временно не настроен"]);
    die();
}

$httpClient->setHeader("Authorization", "Bearer " . $apiToken);
$httpClient->setHeader("Content-Type", "application/json");

$apiUrl = "https://api.decor8.ai/generate_designs_for_room";

$apiResponse = $httpClient->post($apiUrl, Json::encode($apiFields));
$responseStatus = $httpClient->getStatus();

$resultFileId = null;

if ($responseStatus == 200 && !empty($apiResponse)) {
    try {
        $resData = Json::decode($apiResponse);
        
        if (!empty($resData['info']['images'][0]['url'])) {
            $aiGeneratedImageUrl = $resData['info']['images'][0]['url'];
            
            // Скачиваем готовую картинку от ИИ и регистрируем в Битриксе
            $arResultFile = CFile::MakeFileArray($aiGeneratedImageUrl);
            if ($arResultFile) {
                $arResultFile["name"] = "ai_generation_" . time() . ".jpg";
                $resultFileId = CFile::SaveFile($arResultFile, "archicolor_ai/generation_results");
            }
        }
    } catch (\Exception $e) {
        // Ошибка парсинга JSON
    }
}

if (!$resultFileId) {
    $apiErrorDetails = !empty($apiResponse) ? $apiResponse : "HTTP Status: " . $responseStatus;
    echo Json::encode([
        "success" => false,
        "error" => "Не удалось сгенерировать или сохранить дизайн интерьера"
    ]);
    die();
}

if ($isPaid) {
    \Bitrix\Main\Loader::includeModule("sale");
    CSaleUserAccount::UpdateAccount(
        $userId,
        -$price,
        $currency,
        "ARCHICOLOR_AI_GEN",
        0,
        "Оплата генерации дизайна интерьера в ArchiColor AI"
    );
} else {
    $usedQuota++;
    Option::set("main", $optionName, $usedQuota);
}

$styleLabels = [
    "modern"        => "Современный", 
    "scandinavian"  => "Скандинавский", 
    "minimalist"    => "Минимализм", 
    "neoclassic"    => "Неоклассицизм", 
    "loft"          => "Лофт", 
    "artdeco"       => "Ар-деко"
];
$roomLabels = [
    "living_room" => "Гостиная", "bedroom" => "Спальня", "kitchen" => "Кухня",
    "bathroom" => "Ванная", "kids_room" => "Детская", "home_office" => "Кабинет",
    "dining_room" => "Столовая", "hallway" => "Прихожая"
];

$roomText = isset($roomLabels[$roomType]) ? $roomLabels[$roomType] : "Помещение";
$styleText = isset($styleLabels[$style]) ? $styleLabels[$style] : "Выбранный стиль";

$promptEcho = "Перерисовка помещения: <u>" . $roomText . "</u> в стиле <u>" . $styleText . "</u>.";
if (!empty($notes)) {
    $promptEcho .= " Дополнительно: <i>«" . $notes . "»</i>";
}

if (\Bitrix\Main\Loader::includeModule("highloadblock")) {
    $hlblock = \Bitrix\Highloadblock\HighloadBlockTable::getById(3)->fetch();
    if ($hlblock && !empty($hlblock['TABLE_NAME'])) {
        $tableName = $hlblock['TABLE_NAME'];
        $connection = \Bitrix\Main\Application::getConnection();

        $sqlHelper    = $connection->getSqlHelper();
        $safeRoomType = $sqlHelper->forSql($roomType);
        $safeStyle    = $sqlHelper->forSql($style);
        $safeNotes    = $sqlHelper->forSql($notes);

        $intUserId    = intval($userId);
        $intSourceImg = intval($fileId);
        $intResultImg = intval($resultFileId);

        $sqlInsert = "INSERT INTO " . $tableName . " 
            (UF_USER_ID, UF_ROOM_TYPE, UF_STYLE, UF_SOURCE_IMAGE, UF_RESULT_IMAGE, UF_NOTES) 
            VALUES 
            (" . $intUserId . ", '" . $safeRoomType . "', '" . $safeStyle . "', " . $intSourceImg . ", " . $intResultImg . ", '" . $safeNotes . "')";
        
        $connection->queryExecute($sqlInsert);
    }
}

echo Json::encode([
    "success" => true,
    "image_url" => CFile::GetPath($resultFileId),
    "prompt_echo" => $promptEcho,
    "used_quota" => $usedQuota
]);

require($_SERVER["DOCUMENT_ROOT"]."/bitrix/modules/main/include/epilog_after.php");
?>