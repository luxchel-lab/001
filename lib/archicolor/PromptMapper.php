<?php
/**
 * ArchiColor AI — превращение свободного задания клиента в параметры Decor8.
 *
 * Клиент пишет по-русски и в свободной форме: «спальня в скандинавском стиле,
 * тёплые бежевые тона, много дерева». Decor8 построен на диффузионной модели с
 * англоязычным текстовым энкодером, поэтому кириллицу он понимает плохо.
 *
 * Поэтому здесь:
 *   1. по ключевым словам определяем room_type и design_style — это
 *      перечисления Decor8, они работают надёжнее любого промпта;
 *   2. собираем англоязычный промпт из распознанных признаков;
 *   3. исходный текст клиента добавляем в конец — он не мешает, а если
 *      подключить переводчик (config 'prompt_translator'), то заменяется
 *      нормальным переводом.
 *
 * Если ничего не распозналось — отдаём промпт как есть: Decor8 разрешает
 * работать по одному только prompt, без room_type и design_style.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Storage.php';

class PromptMapper
{
    const MAX_PROMPT_LENGTH = 900;

    /** Типы комнат Decor8 (значения передаются в нижнем регистре). */
    private static $roomTypes = array(
        'livingroom', 'kitchen', 'diningroom', 'bedroom', 'bathroom', 'kidsroom',
        'familyroom', 'readingnook', 'sunroom', 'walkincloset', 'mudroom', 'toyroom',
        'office', 'foyer', 'powderroom', 'laundryroom', 'gym', 'basement', 'garage',
        'balcony', 'cafe', 'homebar', 'study_room', 'front_porch', 'back_porch',
        'back_patio', 'openplan',
    );

    /** Стили Decor8. */
    private static $designStyles = array(
        'minimalist', 'scandinavian', 'industrial', 'boho', 'traditional', 'artdeco',
        'midcenturymodern', 'coastal', 'modern', 'contemporary', 'frenchcountry',
        'rustic', 'asian_zen', 'japandi', 'vintage', 'farmhouse', 'luxemodern',
        'organicmodern', 'maximalist', 'eclectic', 'mediterranean', 'tropical',
        'shabbychic', 'transitional', 'victorian', 'southwestern', 'biophilic',
    );

    /** Значения из формы страницы /AI → перечисления Decor8. */
    private static $roomAliases = array(
        'living_room' => 'livingroom',
        'livingroom'  => 'livingroom',
        'bedroom'     => 'bedroom',
        'kitchen'     => 'kitchen',
        'bathroom'    => 'bathroom',
        'kids_room'   => 'kidsroom',
        'home_office' => 'office',
        'office'      => 'office',
        'dining_room' => 'diningroom',
        'hallway'     => 'foyer',
        'balcony'     => 'balcony',
        'nursery'     => 'kidsroom',
    );

    private static $styleAliases = array(
        'modern'       => 'modern',
        'scandinavian' => 'scandinavian',
        'minimalist'   => 'minimalist',
        'neoclassic'   => 'traditional',
        'classic'      => 'traditional',
        'loft'         => 'industrial',
        'industrial'   => 'industrial',
        'artdeco'      => 'artdeco',
        'art_deco'     => 'artdeco',
        'provence'     => 'frenchcountry',
        'japandi'      => 'japandi',
        'boho'         => 'boho',
        'eco'          => 'organicmodern',
    );

    /** Русские слова → тип комнаты. Проверяются по вхождению подстроки. */
    private static $roomKeywords = array(
        'гостин'      => 'livingroom',
        'зал'         => 'livingroom',
        'спальн'      => 'bedroom',
        'кухн'        => 'kitchen',
        'кухон'       => 'kitchen',
        'ванн'        => 'bathroom',
        'санузел'     => 'bathroom',
        'детск'       => 'kidsroom',
        'кабинет'     => 'office',
        'офис'        => 'office',
        'рабоч'       => 'office',
        'столов'      => 'diningroom',
        'прихож'      => 'foyer',
        'коридор'     => 'foyer',
        'холл'        => 'foyer',
        'балкон'      => 'balcony',
        'лоджи'       => 'balcony',
        'гардероб'    => 'walkincloset',
        'спортзал'    => 'gym',
        'тренажёр'    => 'gym',
        'тренажер'    => 'gym',
        'подвал'      => 'basement',
        'гараж'       => 'garage',
        'террас'      => 'back_patio',
        'кафе'        => 'cafe',
        'студи'       => 'openplan',
        'постиран'    => 'laundryroom',
        'прачечн'     => 'laundryroom',
    );

    /** Русские слова → стиль. */
    private static $styleKeywords = array(
        'скандинав'    => 'scandinavian',
        'сканди'       => 'scandinavian',
        'минимал'      => 'minimalist',
        'лофт'         => 'industrial',
        'индустриал'   => 'industrial',
        'современн'    => 'modern',
        'неокласс'     => 'traditional',
        'класси'       => 'traditional',
        'ар-деко'      => 'artdeco',
        'ардеко'       => 'artdeco',
        'арт-деко'     => 'artdeco',
        'прованс'      => 'frenchcountry',
        'кантри'       => 'rustic',
        'деревенск'    => 'rustic',
        'шале'         => 'rustic',
        'рустик'       => 'rustic',
        'бохо'         => 'boho',
        'этно'         => 'boho',
        'джапанди'     => 'japandi',
        'японск'       => 'japandi',
        'ваби'         => 'asian_zen',
        'дзен'         => 'asian_zen',
        'средиземномор'=> 'mediterranean',
        'винтаж'       => 'vintage',
        'ретро'        => 'vintage',
        'фермерск'     => 'farmhouse',
        'прибрежн'     => 'coastal',
        'морск'        => 'coastal',
        'тропич'       => 'tropical',
        'эклектик'     => 'eclectic',
        'максимал'     => 'maximalist',
        'эко'          => 'organicmodern',
        'биофил'       => 'biophilic',
        'хай-тек'      => 'contemporary',
        'хайтек'       => 'contemporary',
        'люкс'         => 'luxemodern',
        'роскош'       => 'luxemodern',
        'шебби'        => 'shabbychic',
        'викториан'    => 'victorian',
        'миксенчури'   => 'midcenturymodern',
        'мид-сенчури'  => 'midcenturymodern',
    );

    /** Русские признаки → английские слова для промпта. */
    private static $featureKeywords = array(
        // цвет
        'бел'          => 'white tones',
        'беж'          => 'beige tones',
        'сер'          => 'grey tones',
        'графит'       => 'graphite grey tones',
        'чёрн'         => 'black accents',
        'черн'         => 'black accents',
        'зелён'        => 'green tones',
        'зелен'        => 'green tones',
        'син'          => 'blue tones',
        'голуб'        => 'light blue tones',
        'терракот'     => 'terracotta tones',
        'охр'          => 'ochre tones',
        'песочн'       => 'sand tones',
        'оливков'      => 'olive tones',
        'бордов'       => 'burgundy accents',
        'розов'        => 'pink tones',
        'жёлт'         => 'yellow accents',
        'желт'         => 'yellow accents',
        'пастельн'     => 'pastel palette',
        'тёмн'         => 'dark palette',
        'темн'         => 'dark palette',
        'светл'        => 'light palette',
        'тёпл'         => 'warm palette',
        'тепл'         => 'warm palette',
        'холодн'       => 'cool palette',
        'контрастн'    => 'high contrast palette',
        'монохром'     => 'monochrome palette',
        'нейтральн'    => 'neutral palette',
        // материалы
        'дерев'        => 'natural wood',
        'дуб'          => 'oak wood',
        'орех'         => 'walnut wood',
        'кирпич'       => 'exposed brick',
        'бетон'        => 'concrete surfaces',
        'мрамор'       => 'marble surfaces',
        'латун'        => 'brass details',
        'металл'       => 'metal details',
        'стекл'        => 'glass surfaces',
        'кожа'         => 'leather furniture',
        'кожан'        => 'leather furniture',
        'лён'          => 'linen textiles',
        'льнян'        => 'linen textiles',
        'ротанг'       => 'rattan furniture',
        'камен'        => 'stone surfaces',
        'плитк'        => 'tiled surfaces',
        'штукатурк'    => 'plaster walls',
        'панел'        => 'wall panelling',
        'молдинг'      => 'wall mouldings',
        'обо'          => 'wallpaper',
        // наполнение и атмосфера
        'растен'       => 'indoor plants',
        'цвет в горшк' => 'potted plants',
        'камин'        => 'fireplace',
        'ковёр'        => 'area rug',
        'ковер'        => 'area rug',
        'штор'         => 'curtains',
        'жалюзи'       => 'blinds',
        'диван'        => 'sofa',
        'кресл'        => 'armchair',
        'кроват'       => 'bed',
        'шкаф'         => 'wardrobe',
        'полк'         => 'shelving',
        'стеллаж'      => 'open shelving',
        'остров'       => 'kitchen island',
        'барн'         => 'bar counter',
        'зеркал'       => 'large mirror',
        'картин'       => 'wall art',
        'уютн'         => 'cozy atmosphere',
        'просторн'     => 'spacious layout',
        'светл и прост'=> 'bright and airy',
        'много свет'   => 'abundant natural light',
        'панорамн'     => 'large panoramic windows',
        'подсветк'     => 'accent lighting',
        'торшер'       => 'floor lamp',
        'люстр'        => 'ceiling chandelier',
        'лампа'        => 'table lamps',
        'мягк'         => 'soft furnishings',
        'лаконичн'     => 'clean lines',
        'функционал'   => 'functional layout',
    );

    /**
     * @param string $freeText свободное задание клиента
     * @param string $roomHint значение поля room_type формы (может быть пустым)
     * @param string $styleHint значение поля style формы (может быть пустым)
     * @return array ['prompt','room_type','design_style','detected'=>[...],'source'=>string]
     */
    public static function build($freeText, $roomHint = '', $styleHint = '')
    {
        $text = self::sanitize($freeText);
        $lower = self::lower($text);

        $room  = self::normalizeEnum($roomHint, self::$roomAliases, self::$roomTypes);
        $style = self::normalizeEnum($styleHint, self::$styleAliases, self::$designStyles);

        if ($room === '') {
            $room = self::matchKeyword($lower, self::$roomKeywords);
        }
        if ($style === '') {
            $style = self::matchKeyword($lower, self::$styleKeywords);
        }

        $features = self::matchFeatures($lower);

        $parts = array();
        $parts[] = 'Interior redesign of this room';
        if ($room !== '') {
            $parts[0] = 'Interior redesign of this ' . self::roomLabel($room);
        }
        if ($style !== '') {
            $parts[] = 'in ' . self::styleLabel($style) . ' style';
        }
        if ($features) {
            $parts[] = 'with ' . implode(', ', $features);
        }

        $english = implode(' ', $parts) . '. Keep the existing room geometry, windows and doors.';

        $translated = self::translate($text);
        $prompt = $english;
        if ($translated !== '') {
            $prompt .= ' ' . $translated;
        } elseif ($text !== '') {
            // Переводчик не подключён — отдаём и оригинал: часть терминов
            // (бренды, названия цветов) модель разберёт и так.
            $prompt .= ' Client request: ' . $text;
        }

        if (self::length($prompt) > self::MAX_PROMPT_LENGTH) {
            $prompt = self::cut($prompt, self::MAX_PROMPT_LENGTH);
        }

        return array(
            'prompt'       => $prompt,
            'room_type'    => $room,
            'design_style' => $style,
            'detected'     => array(
                'room'     => $room,
                'style'    => $style,
                'features' => $features,
            ),
            'userText'     => $text,
        );
    }

    /** Хук перевода: config 'prompt_translator' — callable(string): string. */
    private static function translate($text)
    {
        if ($text === '') {
            return '';
        }
        $translator = Config::get('prompt_translator');
        if (!is_callable($translator)) {
            return '';
        }
        try {
            $result = call_user_func($translator, $text);
        } catch (\Exception $e) {
            Storage::log('translator_failed', array('message' => $e->getMessage()));
            return '';
        }
        return is_string($result) ? self::sanitize($result) : '';
    }

    public static function sanitize($text)
    {
        $text = is_string($text) ? $text : '';
        $text = str_replace(array("\r\n", "\r", "\n", "\t"), ' ', $text);
        $text = preg_replace('/[\x00-\x1F\x7F]/u', '', $text);
        $text = preg_replace('/\s{2,}/u', ' ', $text);
        $text = trim((string) $text);
        return self::cut($text, self::MAX_PROMPT_LENGTH);
    }

    public static function isRoomType($value)
    {
        return in_array(self::lower($value), self::$roomTypes, true);
    }

    public static function isDesignStyle($value)
    {
        return in_array(self::lower($value), self::$designStyles, true);
    }

    private static function normalizeEnum($value, array $aliases, array $allowed)
    {
        $value = self::lower(trim((string) $value));
        if ($value === '') {
            return '';
        }
        if (isset($aliases[$value])) {
            return $aliases[$value];
        }
        return in_array($value, $allowed, true) ? $value : '';
    }

    private static function matchKeyword($lowerText, array $map)
    {
        if ($lowerText === '') {
            return '';
        }
        $best = '';
        $bestLen = 0;
        foreach ($map as $needle => $value) {
            // самое длинное совпадение выигрывает: «неоклассика» важнее «класси»
            if (self::length($needle) > $bestLen && mb_strpos($lowerText, $needle) !== false) {
                $best = $value;
                $bestLen = self::length($needle);
            }
        }
        return $best;
    }

    private static function matchFeatures($lowerText)
    {
        if ($lowerText === '') {
            return array();
        }
        $out = array();
        foreach (self::$featureKeywords as $needle => $value) {
            if (mb_strpos($lowerText, $needle) !== false && !in_array($value, $out, true)) {
                $out[] = $value;
            }
            if (count($out) >= 10) {
                break;
            }
        }
        return $out;
    }

    private static function roomLabel($room)
    {
        $labels = array(
            'livingroom' => 'living room', 'diningroom' => 'dining room',
            'kidsroom' => 'kids room', 'familyroom' => 'family room',
            'readingnook' => 'reading nook', 'walkincloset' => 'walk-in closet',
            'mudroom' => 'mud room', 'toyroom' => 'toy room',
            'powderroom' => 'powder room', 'laundryroom' => 'laundry room',
            'homebar' => 'home bar', 'study_room' => 'study room',
            'front_porch' => 'front porch', 'back_porch' => 'back porch',
            'back_patio' => 'back patio', 'openplan' => 'open plan space',
            'office' => 'home office',
        );
        return isset($labels[$room]) ? $labels[$room] : $room;
    }

    private static function styleLabel($style)
    {
        $labels = array(
            'midcenturymodern' => 'mid-century modern',
            'frenchcountry'    => 'french country',
            'asian_zen'        => 'asian zen',
            'artdeco'          => 'art deco',
            'luxemodern'       => 'luxe modern',
            'organicmodern'    => 'organic modern',
            'shabbychic'       => 'shabby chic',
        );
        return isset($labels[$style]) ? $labels[$style] : $style;
    }

    private static function lower($text)
    {
        return function_exists('mb_strtolower') ? mb_strtolower((string) $text, 'UTF-8') : strtolower((string) $text);
    }

    private static function length($text)
    {
        return function_exists('mb_strlen') ? mb_strlen((string) $text, 'UTF-8') : strlen((string) $text);
    }

    private static function cut($text, $limit)
    {
        if (self::length($text) <= $limit) {
            return $text;
        }
        return function_exists('mb_substr')
            ? rtrim(mb_substr($text, 0, $limit, 'UTF-8'))
            : rtrim(substr($text, 0, $limit));
    }
}
