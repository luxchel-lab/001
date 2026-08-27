<?php
/**
 * ArchiColor AI — клиент Decor8.ai.
 *
 * Документация: https://api-docs.decor8.ai/
 *
 * Основной вызов визуализатора — POST /change_wall_color: он перекрашивает
 * только стены в переданный HEX, оставляя мебель, пол и потолок нетронутыми.
 * Это то, что нужно продаже краски: клиент видит свою комнату со своим
 * оттенком ArchiPaint, а не выдуманный интерьер.
 *
 * Рядом остаётся POST /generate_designs_for_room — полная перегенерация
 * комнаты по текстовому заданию. Визуализатор его не вызывает.
 *
 * Исходное фото можно отдать двумя способами:
 *   input_image_url  — ссылка на наш файл (сайт должен быть виден из интернета);
 *   input_image      — сам файл в multipart-запросе.
 * Способ выбирается настройкой decor8_input_mode, режим 'auto' пробует оба.
 *
 * Ключ API живёт только на сервере (env DECOR8AI_API_KEY).
 */

namespace ArchiColor;

require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';
require_once __DIR__ . '/ImageFile.php';
require_once __DIR__ . '/Color.php';

class Decor8Client
{
    /** @var array */
    private $config;

    public function __construct(array $config = null)
    {
        $this->config = $config === null ? Config::all() : $config;
        if (trim((string) $this->config['decor8_api_key']) === '') {
            throw new AppException(
                'provider_not_configured',
                'Сервис генерации пока не настроен. Мы уже чиним, попробуйте позже.',
                503,
                'DECOR8AI_API_KEY не задан'
            );
        }
        if (!function_exists('curl_init')) {
            throw new AppException('curl_missing', 'Сервис генерации временно недоступен.', 500, 'php-curl не установлен');
        }
    }

    /**
     * Генерация дизайна по фотографии.
     *
     * @param array $params [
     *   'input_image_path' => string|null,  локальный файл (multipart)
     *   'input_image_url'  => string|null,  публичная ссылка (JSON)
     *   'prompt'           => string,
     *   'room_type'        => string,
     *   'design_style'     => string,
     *   'num_images'       => int,
     *   'seed'             => int|null,
     * ]
     * @return array ['images' => [['url','uuid','width','height'], ...], 'message' => string, 'mode' => string]
     * @throws AppException
     */
    public function generateDesignsForRoom(array $params)
    {
        return $this->callWithImage(
            '/generate_designs_for_room',
            $params,
            array($this, 'buildDesignPayload'),
            'Сервис генерации не вернул изображение. Попробуйте изменить формулировку задания.'
        );
    }

    /**
     * Перекраска стен в выбранный оттенок (POST /change_wall_color).
     *
     * Провайдер сам находит стены и оставляет мебель, пол и потолок как есть,
     * поэтому никакого промпта здесь нет — только фотография и HEX.
     *
     * @param array $params [
     *   'input_image_path' => string|null,  локальный файл (multipart)
     *   'input_image_url'  => string|null,  публичная ссылка (JSON)
     *   'hex'              => string,       цвет стен, #RRGGBB
     * ]
     * @return array ['images' => [...], 'message' => string, 'mode' => string, 'colorKey' => string]
     * @throws AppException
     */
    public function changeWallColor(array $params)
    {
        $hex = $this->normalizeHex(isset($params['hex']) ? $params['hex'] : '');
        if ($hex === null) {
            throw new AppException('color_invalid', 'Не удалось разобрать выбранный цвет.', 422, (string) $params['hex']);
        }

        $keys = $this->wallColorKeys();
        $lastIndex = count($keys) - 1;

        foreach ($keys as $index => $key) {
            try {
                $result = $this->callWithImage(
                    '/change_wall_color',
                    $params,
                    function (array $p, $mode) use ($key, $hex) {
                        $payload = array($key => $hex);
                        $this->attachImage($payload, $p, $mode);
                        return $payload;
                    },
                    'Сервис не вернул перекрашенное изображение. Попробуйте другое фото комнаты.'
                );
                $result['colorKey'] = $key;
                return $result;
            } catch (AppException $e) {
                // Документация Decor8 и их SDK расходятся в имени поля с цветом
                // (wall_color_hex_code против wall_color_hex). Если провайдер
                // не понял параметр — пробуем второе имя, а не падаем.
                if ($index >= $lastIndex || !$this->isParameterProblem($e)) {
                    throw $e;
                }
                Storage::log('decor8_retry_color_key', array(
                    'key'    => $key,
                    'code'   => $e->errorCode(),
                    'detail' => $e->detail(),
                ));
            }
        }

        throw new AppException('provider_failed', 'Не удалось перекрасить стены. Попробуйте ещё раз.', 502);
    }

    /**
     * Общий цикл вызова эндпоинта, которому нужна фотография: пробует
     * доступные способы её передачи (ссылка или файл) и разбирает ответ.
     *
     * @param callable $payloadBuilder function(array $params, string $mode): array
     * @throws AppException
     */
    private function callWithImage($path, array $params, $payloadBuilder, $emptyMessage)
    {
        $modes = $this->resolveModes($params);
        $lastError = null;

        foreach ($modes as $mode) {
            try {
                $payload = call_user_func($payloadBuilder, $params, $mode);
                $response = $this->request($path, $payload, $mode === 'multipart');
                $images = $this->extractImages($response);

                if (!$images) {
                    throw new AppException(
                        'provider_empty',
                        $emptyMessage,
                        502,
                        json_encode($response, JSON_UNESCAPED_UNICODE)
                    );
                }

                return array(
                    'images'  => $images,
                    'message' => isset($response['message']) ? (string) $response['message'] : '',
                    'mode'    => $mode,
                );
            } catch (AppException $e) {
                $lastError = $e;
                // Меняем способ передачи фото только если провайдер не смог его взять.
                if (!$this->isInputImageProblem($e) || count($modes) < 2) {
                    throw $e;
                }
                Storage::log('decor8_retry_other_mode', array(
                    'mode'   => $mode,
                    'path'   => $path,
                    'code'   => $e->errorCode(),
                    'detail' => $e->detail(),
                ));
            }
        }

        throw $lastError !== null ? $lastError
            : new AppException('provider_failed', 'Не удалось получить изображение. Попробуйте ещё раз.', 502);
    }

    /** Имена поля с цветом: сначала документированное, потом из SDK. */
    private function wallColorKeys()
    {
        $configured = Config::get('decor8_wall_color_key');
        $keys = array('wall_color_hex_code', 'wall_color_hex');

        if (is_string($configured) && $configured !== '') {
            array_unshift($keys, $configured);
            $keys = array_values(array_unique($keys));
        }
        return $keys;
    }

    /** #abc и abcdef приводим к виду #AABBCC — Decor8 ждёт полный HEX. */
    private function normalizeHex($value)
    {
        $rgb = Color::hexToRgb($value);
        return $rgb === null ? null : Color::rgbToHex($rgb[0], $rgb[1], $rgb[2]);
    }

    /**
     * Апскейл готового изображения (POST /upscale_image).
     * Вызывается, только если в конфиге decor8_scale_factor > 1.
     *
     * @return string|null URL увеличенного изображения
     */
    public function upscaleImage($localPath, $scaleFactor)
    {
        $scaleFactor = (int) $scaleFactor;
        if ($scaleFactor < 2 || !is_readable($localPath)) {
            return null;
        }
        try {
            $response = $this->request('/upscale_image', array(
                'input_image'  => $this->fileField($localPath),
                'scale_factor' => $scaleFactor,
            ), true);
            $images = $this->extractImages($response);
            return $images ? $images[0]['url'] : null;
        } catch (AppException $e) {
            // Апскейл — улучшение, а не обязательный шаг: клиенту важнее получить результат.
            Storage::log('decor8_upscale_failed', array('code' => $e->errorCode(), 'detail' => $e->detail()));
            return null;
        }
    }

    /* ------------------------------------------------------------------ */

    /** Какие способы передачи фото пробовать и в каком порядке. */
    private function resolveModes(array $params)
    {
        $hasPath = !empty($params['input_image_path']);
        $hasUrl  = !empty($params['input_image_url']);

        $mode = strtolower((string) $this->config['decor8_input_mode']);

        if ($mode === 'multipart') {
            return $hasPath ? array('multipart') : array('url');
        }
        if ($mode === 'url') {
            return $hasUrl ? array('url') : array('multipart');
        }

        // auto: ссылку Decor8 откроет только если сайт доступен из интернета
        $urlUsable = $hasUrl && Config::baseUrlIsPublic(
            Config::get('public_base_url') !== '' ? Config::get('public_base_url') : Config::guessBaseUrl()
        );

        if ($urlUsable && $hasPath) {
            return array('url', 'multipart');
        }
        if ($urlUsable) {
            return array('url');
        }
        if ($hasPath) {
            return array('multipart', 'url');
        }
        return array('url');
    }

    private function buildDesignPayload(array $params, $mode)
    {
        $payload = array();

        $prompt = trim((string) (isset($params['prompt']) ? $params['prompt'] : ''));
        if ($prompt !== '') {
            $payload['prompt'] = $prompt;
        }
        foreach (array('room_type', 'design_style') as $key) {
            if (!empty($params[$key])) {
                $payload[$key] = (string) $params[$key];
            }
        }
        if (!isset($payload['prompt']) && !isset($payload['room_type'])) {
            // Decor8 требует хотя бы одно описание задачи.
            $payload['room_type'] = 'livingroom';
            $payload['design_style'] = 'modern';
        }

        $payload['num_images'] = max(1, min(4, (int) (isset($params['num_images'])
            ? $params['num_images'] : $this->config['decor8_num_images'])));

        if (isset($params['seed']) && $params['seed'] !== null && $params['seed'] !== '') {
            $payload['seed'] = (int) $params['seed'];
        }
        if (isset($params['design_creativity']) && $params['design_creativity'] !== null) {
            $payload['design_creativity'] = (float) $params['design_creativity'];
        }

        $this->attachImage($payload, $params, $mode);

        return $payload;
    }

    /** Кладёт фотографию в запрос выбранным способом. */
    private function attachImage(array &$payload, array $params, $mode)
    {
        if ($mode === 'multipart') {
            $payload['input_image'] = $this->fileField($params['input_image_path']);
        } else {
            $payload['input_image_url'] = (string) $params['input_image_url'];
        }
    }

    private function fileField($path)
    {
        if (!is_readable($path)) {
            throw new AppException('upload_missing', 'Фотография не найдена на сервере.', 500, $path);
        }
        $mime = ImageFile::detectMime($path);
        return new \CURLFile($path, $mime ?: 'image/jpeg', basename($path));
    }

    /**
     * Один HTTP-вызов с повторами при 429 и 5xx.
     *
     * @throws AppException
     */
    private function request($path, array $payload, $multipart)
    {
        $url = $this->config['decor8_api_base'] . $path;
        $retries = max(0, (int) $this->config['decor8_retries']);
        $attempt = 0;
        $lastDetail = '';
        $lastStatus = 0;

        while (true) {
            $attempt++;
            $started = microtime(true);

            $ch = curl_init($url);
            $headers = array('Authorization: Bearer ' . $this->config['decor8_api_key']);

            if ($multipart) {
                $body = $payload;    // cURL сам выставит multipart/form-data
            } else {
                $headers[] = 'Content-Type: application/json';
                $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }

            curl_setopt_array($ch, array(
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => (int) $this->config['decor8_connect_timeout'],
                CURLOPT_TIMEOUT        => (int) $this->config['decor8_timeout'],
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_USERAGENT      => 'ArchiColorAI/1.0 (+archipaint.ru)',
            ));

            $raw = curl_exec($ch);
            $curlErrno = curl_errno($ch);
            $curlError = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);

            $elapsed = round(microtime(true) - $started, 2);

            if ($curlErrno !== 0) {
                $lastDetail = 'curl#' . $curlErrno . ' ' . $curlError;
                $lastStatus = 0;
                Storage::log('decor8_transport_error', array(
                    'attempt' => $attempt, 'path' => $path, 'error' => $lastDetail, 'elapsed' => $elapsed,
                ));
                if ($attempt <= $retries && $this->isRetryableTransport($curlErrno)) {
                    $this->backoff($attempt);
                    continue;
                }
                if ($curlErrno === CURLE_OPERATION_TIMEDOUT) {
                    throw new AppException(
                        'provider_timeout',
                        'Генерация заняла слишком много времени. Попробуйте ещё раз.',
                        504,
                        $lastDetail
                    );
                }
                throw new AppException(
                    'provider_unreachable',
                    'Сервис генерации сейчас недоступен. Попробуйте через пару минут.',
                    502,
                    $lastDetail
                );
            }

            $decoded = json_decode((string) $raw, true);

            Storage::log('decor8_response', array(
                'path'    => $path,
                'attempt' => $attempt,
                'status'  => $status,
                'elapsed' => $elapsed,
                'error'   => is_array($decoded) && isset($decoded['error']) ? $decoded['error'] : null,
            ));

            if ($status === 429 || $status >= 500) {
                $lastStatus = $status;
                $lastDetail = 'HTTP ' . $status . ' ' . substr((string) $raw, 0, 400);
                if ($attempt <= $retries) {
                    $this->backoff($attempt);
                    continue;
                }
                throw $this->httpError($status, $decoded, $lastDetail);
            }

            if ($status >= 400) {
                throw $this->httpError($status, $decoded, 'HTTP ' . $status . ' ' . substr((string) $raw, 0, 400));
            }

            if (!is_array($decoded)) {
                throw new AppException(
                    'provider_bad_json',
                    'Сервис генерации вернул неожиданный ответ.',
                    502,
                    substr((string) $raw, 0, 400)
                );
            }

            // Decor8 отдаёт 200 и с ошибкой в теле: {"error":"InvalidInput", ...}
            if (!empty($decoded['error'])) {
                throw $this->providerError((string) $decoded['error'], $decoded);
            }

            return $decoded;
        }
    }

    private function isRetryableTransport($errno)
    {
        return in_array($errno, array(
            CURLE_COULDNT_CONNECT,
            CURLE_COULDNT_RESOLVE_HOST,
            CURLE_GOT_NOTHING,
            CURLE_SEND_ERROR,
            CURLE_RECV_ERROR,
        ), true);
    }

    private function backoff($attempt)
    {
        usleep((int) min(8000000, 700000 * pow(2, $attempt - 1)));
    }

    private function httpError($status, $decoded, $detail)
    {
        if (is_array($decoded) && !empty($decoded['error'])) {
            return $this->providerError((string) $decoded['error'], $decoded, $status);
        }

        if ($status === 401 || $status === 403) {
            return new AppException('provider_auth', 'Сервис генерации отклонил запрос. Мы уже разбираемся.', 502, $detail);
        }
        if ($status === 402) {
            return new AppException('provider_credits', 'На сервисе генерации закончились кредиты. Мы уже пополняем.', 503, $detail);
        }
        if ($status === 429) {
            return new AppException('provider_rate_limit', 'Сейчас слишком много запросов. Попробуйте через минуту.', 429, $detail);
        }
        if ($status >= 500) {
            return new AppException('provider_unavailable', 'Сервис генерации временно недоступен. Попробуйте позже.', 502, $detail);
        }
        return new AppException('provider_rejected', 'Сервис генерации не принял запрос.', 502, $detail);
    }

    /** Коды Decor8 → тексты, понятные клиенту. */
    private function providerError($code, $decoded, $status = 502)
    {
        $detail = is_array($decoded) ? json_encode($decoded, JSON_UNESCAPED_UNICODE) : '';
        $normalized = strtolower(preg_replace('/[^a-z]/i', '', $code));

        $map = array(
            'invalidinput'      => 'Не удалось разобрать фотографию. Загрузите более чёткий снимок комнаты.',
            'invalidimage'      => 'Не удалось разобрать фотографию. Загрузите более чёткий снимок комнаты.',
            'invalidparameters' => 'Задание не удалось передать в сервис генерации. Переформулируйте, пожалуйста.',
            'unauthorized'      => 'Сервис генерации отклонил запрос. Мы уже разбираемся.',
            'insufficientcredits' => 'На сервисе генерации закончились кредиты. Мы уже пополняем.',
            'contentmoderation' => 'Задание не прошло модерацию. Опишите, пожалуйста, интерьерную задачу.',
            'nsfwcontent'       => 'Изображение не прошло модерацию. Загрузите фотографию интерьера.',
        );

        $message = isset($map[$normalized])
            ? $map[$normalized]
            : 'Сервис генерации не смог обработать запрос. Попробуйте изменить фото или формулировку.';

        return new AppException('provider_' . ($normalized !== '' ? $normalized : 'error'), $message, $status, $detail);
    }

    /** Провайдер не понял состав параметров — можно попробовать другое имя поля. */
    private function isParameterProblem(AppException $e)
    {
        return in_array($e->errorCode(), array(
            'provider_invalidparameters',
            'provider_rejected',
            'provider_error',
        ), true);
    }

    /** Стоит ли повторить запрос другим способом передачи фото. */
    private function isInputImageProblem(AppException $e)
    {
        return in_array($e->errorCode(), array(
            'provider_invalidinput',
            'provider_invalidimage',
            'provider_rejected',
            'provider_bad_json',
        ), true);
    }

    private function extractImages($response)
    {
        $images = array();
        if (isset($response['info']['images']) && is_array($response['info']['images'])) {
            $list = $response['info']['images'];
        } elseif (isset($response['images']) && is_array($response['images'])) {
            $list = $response['images'];
        } else {
            return $images;
        }

        foreach ($list as $item) {
            if (is_string($item)) {
                $images[] = array('url' => $item, 'uuid' => '', 'width' => 0, 'height' => 0);
                continue;
            }
            if (!is_array($item) || empty($item['url'])) {
                continue;
            }
            $images[] = array(
                'url'    => (string) $item['url'],
                'uuid'   => isset($item['uuid']) ? (string) $item['uuid'] : '',
                'width'  => isset($item['width']) ? (int) $item['width'] : 0,
                'height' => isset($item['height']) ? (int) $item['height'] : 0,
            );
        }
        return $images;
    }
}
