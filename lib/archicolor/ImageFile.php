<?php
/**
 * ArchiColor AI — работа с файлами изображений.
 *
 * Отвечает за три вещи:
 *   1. проверку и нормализацию загруженного клиентом фото (тип, размер, EXIF);
 *   2. сохранение результата Decor8 на наш домен — иначе браузер не даст
 *      скачать его без CORS, а клиенту нужна кнопка «скачать»;
 *   3. защиту от SSRF при скачивании: тянем только https с домена Decor8.
 */

namespace ArchiColor;

require_once __DIR__ . '/AppException.php';
require_once __DIR__ . '/Config.php';

class ImageFile
{
    /** Расширение по MIME. */
    private static $extByMime = array(
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
    );

    /**
     * Загружает изображение в GD-ресурс.
     *
     * @return resource|\GdImage
     * @throws AppException
     */
    public static function load($path)
    {
        if (!is_readable($path)) {
            throw new AppException('image_unreadable', 'Файл изображения недоступен.', 500);
        }
        $info = @getimagesize($path);
        if (!$info) {
            throw new AppException('image_broken', 'Не удалось прочитать изображение.', 415);
        }

        switch ($info[2]) {
            case IMAGETYPE_JPEG:
                $image = @imagecreatefromjpeg($path);
                break;
            case IMAGETYPE_PNG:
                $image = @imagecreatefrompng($path);
                break;
            case IMAGETYPE_GIF:
                $image = @imagecreatefromgif($path);
                break;
            case IMAGETYPE_WEBP:
                $image = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : false;
                break;
            default:
                $image = false;
        }

        if (!$image) {
            throw new AppException('image_unsupported', 'Формат изображения не поддерживается. Загрузите JPG, PNG или WebP.', 415);
        }

        // У палитровых PNG и GIF imagecolorat() отдаёт индекс, а не цвет,
        // поэтому переводим их в truecolor сразу при загрузке.
        if (!imageistruecolor($image) && function_exists('imagepalettetotruecolor')) {
            imagepalettetotruecolor($image);
        }

        return $image;
    }

    /**
     * Проверяет загруженный файл и сохраняет нормализованный JPEG.
     *
     * Пересжатие — не косметика: оно снимает EXIF (в том числе геометки),
     * разворачивает фото по ориентации камеры и ограничивает размер,
     * который уйдёт в Decor8.
     *
     * @param array  $file запись из $_FILES
     * @param string $destPath куда положить результат
     * @return array ['width' => int, 'height' => int, 'bytes' => int]
     * @throws AppException
     */
    public static function storeUpload(array $file, $destPath)
    {
        if (!isset($file['error']) || is_array($file['error'])) {
            throw new AppException('upload_invalid', 'Файл не получен.', 400);
        }
        switch ($file['error']) {
            case UPLOAD_ERR_OK:
                break;
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                throw new AppException('upload_too_large', 'Файл слишком большой.', 413);
            case UPLOAD_ERR_NO_FILE:
                throw new AppException('upload_missing', 'Выберите фотографию комнаты.', 400);
            default:
                throw new AppException('upload_failed', 'Не удалось загрузить файл. Попробуйте ещё раз.', 400);
        }

        $maxBytes = (int) Config::get('max_upload_bytes');
        if ($file['size'] > $maxBytes) {
            throw new AppException(
                'upload_too_large',
                'Файл больше ' . round($maxBytes / 1048576) . ' МБ. Уменьшите фотографию и попробуйте снова.',
                413
            );
        }

        $tmp = $file['tmp_name'];
        if (!is_uploaded_file($tmp) && !is_readable($tmp)) {
            throw new AppException('upload_invalid', 'Файл не получен.', 400);
        }

        $mime = self::detectMime($tmp);
        $allowed = (array) Config::get('allowed_mime');
        if (!in_array($mime, $allowed, true)) {
            throw new AppException('upload_type', 'Поддерживаются JPG, PNG и WebP.', 415);
        }

        $info = @getimagesize($tmp);
        if (!$info) {
            throw new AppException('image_broken', 'Файл повреждён или это не изображение.', 415);
        }
        $minSide = (int) Config::get('min_input_side');
        if (min($info[0], $info[1]) < $minSide) {
            throw new AppException(
                'image_too_small',
                'Фотография слишком маленькая: нужно не меньше ' . $minSide . ' px по короткой стороне.',
                422
            );
        }

        $image = self::load($tmp);
        $image = self::applyExifOrientation($image, $tmp, $mime);
        $image = self::fitInto($image, (int) Config::get('max_input_side'));

        self::ensureDir(dirname($destPath));
        $ok = imagejpeg($image, $destPath, (int) Config::get('jpeg_quality'));
        $width  = imagesx($image);
        $height = imagesy($image);
        imagedestroy($image);

        if (!$ok) {
            throw new AppException('storage_failed', 'Не удалось сохранить фотографию на сервере.', 500);
        }
        @chmod($destPath, 0664);

        return array('width' => $width, 'height' => $height, 'bytes' => (int) filesize($destPath));
    }

    /**
     * Скачивает готовое изображение к нам на диск.
     *
     * @throws AppException
     */
    public static function download($url, $destPath, array $allowedHosts = array())
    {
        $host = parse_url($url, PHP_URL_HOST);
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!$host || !in_array($scheme, array('http', 'https'), true)) {
            throw new AppException('result_url_bad', 'Провайдер вернул некорректную ссылку на результат.', 502);
        }
        if ($allowedHosts && !self::hostAllowed($host, $allowedHosts)) {
            throw new AppException('result_url_host', 'Провайдер вернул ссылку с неожиданного домена.', 502, $host);
        }

        self::ensureDir(dirname($destPath));
        $fh = @fopen($destPath, 'wb');
        if (!$fh) {
            throw new AppException('storage_failed', 'Не удалось сохранить результат на сервере.', 500);
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_FILE           => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 120,
            CURLOPT_FAILONERROR    => true,
            CURLOPT_USERAGENT      => 'ArchiColorAI/1.0 (+archipaint.ru)',
        ));
        $ok = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        fclose($fh);

        if (!$ok || $status >= 400) {
            @unlink($destPath);
            throw new AppException('result_download', 'Не удалось скачать готовое изображение.', 502, $error . ' HTTP ' . $status);
        }
        if (!@getimagesize($destPath)) {
            @unlink($destPath);
            throw new AppException('result_broken', 'Провайдер вернул повреждённое изображение.', 502);
        }
        @chmod($destPath, 0664);

        return (int) filesize($destPath);
    }

    private static function hostAllowed($host, array $allowed)
    {
        $host = strtolower($host);
        foreach ($allowed as $pattern) {
            $pattern = strtolower(trim($pattern));
            if ($pattern === '') {
                continue;
            }
            if ($host === $pattern || substr($host, -strlen('.' . $pattern)) === '.' . $pattern) {
                return true;
            }
        }
        return false;
    }

    public static function detectMime($path)
    {
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo) {
                $mime = finfo_file($finfo, $path);
                finfo_close($finfo);
                if ($mime) {
                    return strtolower($mime);
                }
            }
        }
        $info = @getimagesize($path);
        return $info && isset($info['mime']) ? strtolower($info['mime']) : '';
    }

    public static function extensionFor($mime)
    {
        $mime = strtolower($mime);
        return isset(self::$extByMime[$mime]) ? self::$extByMime[$mime] : 'jpg';
    }

    /** Разворачивает снимок по EXIF: телефоны почти всегда пишут ориентацию. */
    private static function applyExifOrientation($image, $path, $mime)
    {
        if ($mime !== 'image/jpeg' || !function_exists('exif_read_data')) {
            return $image;
        }
        $exif = @exif_read_data($path);
        if (!$exif || empty($exif['Orientation'])) {
            return $image;
        }

        switch ((int) $exif['Orientation']) {
            case 3:
                $rotated = imagerotate($image, 180, 0);
                break;
            case 6:
                $rotated = imagerotate($image, -90, 0);
                break;
            case 8:
                $rotated = imagerotate($image, 90, 0);
                break;
            default:
                return $image;
        }
        if ($rotated) {
            imagedestroy($image);
            return $rotated;
        }
        return $image;
    }

    /** Ужимает картинку до заданной длинной стороны, сохраняя пропорции. */
    private static function fitInto($image, $maxSide)
    {
        $w = imagesx($image);
        $h = imagesy($image);
        $longest = max($w, $h);
        if ($maxSide <= 0 || $longest <= $maxSide) {
            return self::flatten($image);
        }

        $scale = $maxSide / $longest;
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));

        $dst = imagecreatetruecolor($nw, $nh);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagecopyresampled($dst, $image, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($image);
        return $dst;
    }

    /** PNG/WebP с альфой на белом фоне: JPEG прозрачность не умеет. */
    private static function flatten($image)
    {
        $w = imagesx($image);
        $h = imagesy($image);
        $dst = imagecreatetruecolor($w, $h);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagecopy($dst, $image, 0, 0, 0, 0, $w, $h);
        imagedestroy($image);
        return $dst;
    }

    public static function ensureDir($dir)
    {
        if (is_dir($dir)) {
            return;
        }
        if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new AppException('storage_failed', 'Каталог хранения недоступен для записи.', 500, $dir);
        }
    }
}
