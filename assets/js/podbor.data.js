/*!
 * ArchiPaint · podbor.data.js
 * Каталог, пресеты настроений, роли в интерьере и построение интерьерных палитр.
 *
 * Работает полностью автономно на данных из podbor.palette.js.
 * Если у проекта есть колеровочный API — подключите его через
 * ArchiPaintData.configure({ apiBase: '...' }): сетевые ответы будут
 * использоваться в первую очередь, а локальный расчёт останется запасным вариантом.
 *
 * Зависит от: podbor.color.js, podbor.palette.js
 * Опционально: podbor.standards.js (справочник RAL Classic)
 */
(function (global) {
  'use strict';

  var C = global.ArchiPaintColor;
  if (!C) throw new Error('podbor.data.js: сначала подключите podbor.color.js');

  /* ============================================================
   *  Настройки
   * ============================================================ */

  var config = {
    apiBase: null,             // например 'https://color-api.archipaint.ru'
    apiTimeout: 8000,
    logEvents: false,          // отправка аналитики о показах и оценках
    storagePrefix: 'archipaint:',
    catalogUrl: null           // JSON с расширенным каталогом
  };

  function configure(opts) {
    Object.keys(opts || {}).forEach(function (k) {
      if (k in config) config[k] = opts[k];
    });
    return config;
  }

  /* ============================================================
   *  Каталог
   * ============================================================ */

  var catalog = (global.ARCHIPAINT_PALETTE || []).map(function (c) {
    var lab = { l: c.lab[0], a: c.lab[1], b: c.lab[2] };
    var lch = C.labToLch(lab.l, lab.a, lab.b);
    return {
      code: c.code,
      name: c.name,
      hex: c.hex,
      family: c.family,
      familyId: c.familyId,
      collection: c.collection,
      lab: lab,
      lch: lch,
      lrv: C.lrv(c.hex),
      temperature: C.temperature(c.hex),
      search: (c.code + ' ' + c.name + ' ' + c.hex + ' ' + c.family + ' ' + c.collection).toLowerCase()
    };
  });

  var byCode = {};
  catalog.forEach(function (c) { byCode[c.code] = c; });

  var COLLECTIONS = (function () {
    var meta = {
      'ArchiPaint Minerals': {
        tagline: 'Холодные нейтральные, зелёные и бирюзовые',
        desc: 'Оттенки камня, лишайника и патины. Спокойная основа для гостиных, кабинетов и общественных пространств.'
      },
      'ArchiPaint Terra': {
        tagline: 'Земляные: песок, охра, терракота',
        desc: 'Тёплая палитра юга — глина, солома, обожжённый кирпич. Хорошо работает в комнатах с недостатком солнца.'
      },
      'ArchiPaint Pigments': {
        tagline: 'Насыщенные пигментные тона',
        desc: 'Красные, розовые и фиолетовые для акцентных стен, ниш и столярки.'
      },
      'ArchiPaint Nord': {
        tagline: 'Тёплые нейтральные и синие',
        desc: 'Северная гамма: белила, лён, индиго. Нейтральная база для любого интерьера плюс глубокая синева.'
      }
    };
    var counts = {};
    catalog.forEach(function (c) { counts[c.collection] = (counts[c.collection] || 0) + 1; });
    return Object.keys(counts).sort().map(function (name) {
      return {
        id: name,
        name: name,
        count: counts[name],
        tagline: (meta[name] || {}).tagline || '',
        desc: (meta[name] || {}).desc || '',
        preview: catalog.filter(function (c) { return c.collection === name; })
          .filter(function (_, i) { return i % 12 === 3; }).slice(0, 8).map(function (c) { return c.hex; })
      };
    });
  })();

  var FAMILIES = (function () {
    var seen = {}, out = [];
    catalog.forEach(function (c) {
      if (!seen[c.familyId]) {
        seen[c.familyId] = true;
        out.push({ id: c.familyId, name: c.family, hex: c.hex });
      }
    });
    return out;
  })();

  function getCatalog() { return catalog; }
  function getByCode(code) { return byCode[code] || null; }

  /** Поиск по коду, названию, HEX и семье. Терпим к регистру и решётке. */
  function searchCatalog(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 25;
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var qNoHash = q.replace(/^#/, '');
    var scored = [];

    for (var i = 0; i < catalog.length; i++) {
      var c = catalog[i];
      if (opts.collections && opts.collections.length && opts.collections.indexOf(c.collection) === -1) continue;
      var score = -1;
      var code = c.code.toLowerCase();
      var name = c.name.toLowerCase();
      var hex = c.hex.toLowerCase().replace('#', '');

      if (code === q || hex === qNoHash) score = 100;
      else if (name === q) score = 95;
      else if (code.indexOf(q) === 0) score = 80;
      else if (name.indexOf(q) === 0) score = 70;
      else if (hex.indexOf(qNoHash) === 0) score = 65;
      else if (c.search.indexOf(q) !== -1) score = 40;

      // «7016» должно находить AP-0716 и подобные — сравниваем только цифры
      if (score < 0 && /^\d{2,4}$/.test(q) && code.replace(/\D/g, '').indexOf(q) !== -1) score = 30;

      if (score >= 0) scored.push({ item: c, score: score });
    }
    scored.sort(function (a, b) {
      return b.score - a.score || a.item.code.localeCompare(b.item.code);
    });

    // Запрос сам может быть цветом («#A89480», «46, 32, 28»). Точного совпадения
    // в каталоге почти никогда нет, поэтому дополняем выдачу ближайшими по ΔE.
    if (scored.length < limit) {
      var parsed = C.parseColorInput(query);
      if (parsed) {
        var have = {};
        scored.forEach(function (s2) { have[s2.item.code] = true; });
        nearest(parsed.lab, {
          limit: limit - scored.length,
          collections: opts.collections,
          exclude: Object.keys(have)
        }).forEach(function (n) {
          scored.push({ item: Object.assign({}, n.item || n.color, { queryDeltaE: n.deltaE }), score: -1 });
        });
      }
    }
    return scored.slice(0, limit).map(function (s3) { return s3.item; });
  }

  function nearest(lab, opts) {
    return C.findNearest(lab, catalog, opts);
  }

  function nearestOne(hexOrLab, opts) {
    var lab = typeof hexOrLab === 'string' ? C.hexToLab(hexOrLab) : hexOrLab;
    if (!lab) return null;
    var r = nearest(lab, Object.assign({ limit: 1 }, opts || {}));
    return r.length ? r[0] : null;
  }

  /* ============================================================
   *  Внешние стандарты (RAL Classic и т. п.)
   *
   *  Клиент приходит с кодом чужой системы — «покрасьте в RAL 7016».
   *  Задача сервиса: найти этот код и показать, чем его закрыть
   *  из колеровочной палитры ArchiPaint, честно указав ΔE.
   * ============================================================ */

  var standards = (global.ARCHIPAINT_STANDARDS || []).map(function (s) {
    var lab = { l: s.lab[0], a: s.lab[1], b: s.lab[2] };
    return {
      standard: s.standard,
      code: s.code,
      num: s.num,
      name: s.name,
      hex: s.hex,
      lab: lab,
      lch: C.labToLch(lab.l, lab.a, lab.b),
      lrv: C.lrv(s.hex),
      search: (s.code + ' ' + s.num + ' ' + s.name + ' ' + s.hex).toLowerCase()
    };
  });

  var STANDARD_NAMES = (function () {
    var seen = {}, out = [];
    standards.forEach(function (s) {
      if (!seen[s.standard]) { seen[s.standard] = 0; out.push(s.standard); }
      seen[s.standard]++;
    });
    return out.map(function (n) { return { id: n, name: n, count: seen[n] }; });
  })();

  function getStandards() { return standards; }

  /** Поиск по чужим стандартам: «7016», «RAL 7016», «антрацит». */
  function searchStandards(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 12;
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var qDigits = q.replace(/\D/g, '');
    var scored = [];

    standards.forEach(function (s) {
      var score = -1;
      if (s.num === qDigits && qDigits) score = 100;
      else if (s.code.toLowerCase() === q) score = 100;
      else if (qDigits && s.num.indexOf(qDigits) === 0) score = 80;
      else if (s.name.toLowerCase().indexOf(q) === 0) score = 60;
      else if (s.search.indexOf(q) !== -1) score = 35;
      if (score >= 0) scored.push({ item: s, score: score });
    });

    scored.sort(function (a, b) { return b.score - a.score || a.item.num.localeCompare(b.item.num); });
    return scored.slice(0, limit).map(function (x) { return x.item; });
  }

  /**
   * Полный ответ на запрос по коду: сам стандарт плюс чем его закрыть.
   * Именно это заменяет клиенту поход с веером в магазин.
   */
  function matchStandard(standardItem, opts) {
    opts = opts || {};
    var matches = nearest(standardItem.lab, {
      limit: opts.limit || 4,
      formula: opts.formula || 'de2000',
      collections: opts.collections
    });
    return {
      source: standardItem,
      matches: matches.map(function (m) {
        return {
          color: m.color,
          deltaE: m.deltaE,
          quality: C.deltaEQuality(m.deltaE)
        };
      })
    };
  }

  /* ============================================================
   *  Роли цвета в интерьере
   * ============================================================ */

  var ROLES = {
    main:        { id: 'main', label: 'Стены', short: 'Стены', tone: 'main', weight: 60,
                   hint: 'Основной объём цвета — 60% помещения.' },
    additional:  { id: 'additional', label: 'Дополнительный', short: 'Доп.', tone: 'additional', weight: 30,
                   hint: 'Второй по площади: смежная стена, крупная мебель, шторы — 30%.' },
    accent:      { id: 'accent', label: 'Акцент', short: 'Акцент', tone: 'accent', weight: 10,
                   hint: 'Небольшие яркие пятна: подушки, двери, ниша — 10%.' },
    deep_accent: { id: 'deep_accent', label: 'Глубокий акцент', short: 'Глубокий', tone: 'accent', weight: 10,
                   hint: 'Тёмный контрастный тон для столярки и ниш.' },
    ceiling:     { id: 'ceiling', label: 'Потолок', short: 'Потолок', tone: 'main', weight: 0,
                   hint: 'На 2–4 тона светлее стен — визуально поднимает высоту.' },
    trim:        { id: 'trim', label: 'Плинтус и столярка', short: 'Плинтус', tone: 'additional', weight: 0,
                   hint: 'Обрамление проёмов, плинтус, наличники.' }
  };

  var ROLE_ORDER = ['main', 'additional', 'accent', 'deep_accent', 'ceiling', 'trim'];

  function roleMeta(id) {
    return ROLES[id] || { id: id, label: 'Дополнительный', short: 'Доп.', tone: 'additional', weight: 0, hint: '' };
  }

  /* ============================================================
   *  Пресеты «настроения палитры»
   *
   *  Каждый пресет описывает целевые светлоту (L) и множитель хромы
   *  для каждой роли, а также «притяжение» тона к тёплой или холодной
   *  части круга. Значения подобраны по практике интерьерной колеровки:
   *  стены светлее и спокойнее, акцент темнее и насыщеннее.
   * ============================================================ */

  var WARM_HUE = 62;   // охра
  var COOL_HUE = 245;  // серо-синий

  // ниже этой хромы цвет считается нейтральным: поворот тона на нём не читается
  var NEUTRAL_CHROMA = 6;
  // минимальная рабочая хрома по ролям для нейтральной базы
  var NEUTRAL_CHROMA_FLOOR = {
    main: 0, ceiling: 0, trim: 0,
    additional: 9, accent: 24, deep_accent: 28
  };

  var MOOD_PRESETS = [
    {
      id: 'soft_light', title: 'Дыхание света',
      desc: 'Светлая воздушная гамма с мягким контрастом. Комната кажется просторнее, свет распределяется ровно.',
      roles: { main: [80, 0.42], additional: [68, 0.55], accent: [46, 1.15], deep_accent: [32, 1.30], ceiling: [94, 0.15], trim: [88, 0.25] },
      hueTarget: null, tempPull: 0, chromaScale: 0.8
    },
    {
      id: 'deep_contrast', title: 'Тень и блеск',
      desc: 'Сильный перепад светлоты: светлые стены и глубокий тёмный акцент. Графичный, «журнальный» интерьер.',
      roles: { main: [78, 0.5], additional: [52, 0.8], accent: [26, 1.5], deep_accent: [18, 1.60], ceiling: [93, 0.2], trim: [22, 1.2] },
      hueTarget: null, tempPull: 0, chromaScale: 1.05
    },
    {
      id: 'pastel_air', title: 'Пудровый ветер',
      desc: 'Разбелённые пастельные тона одной светлоты. Нежная гамма для спален и детских.',
      roles: { main: [85, 0.3], additional: [79, 0.38], accent: [66, 0.7], deep_accent: [52, 0.95], ceiling: [95, 0.12], trim: [90, 0.2] },
      hueTarget: null, tempPull: 0.15, chromaScale: 0.55
    },
    {
      id: 'earthy_warm', title: 'Тепло земли',
      desc: 'Охра, глина и обожжённый кирпич. Согревает комнаты с северными окнами.',
      roles: { main: [72, 0.6], additional: [58, 0.85], accent: [40, 1.3], deep_accent: [28, 1.45], ceiling: [92, 0.2], trim: [84, 0.4] },
      hueTarget: WARM_HUE, tempPull: 0.55, chromaScale: 1.0
    },
    {
      id: 'cold_modern', title: 'Северный холод',
      desc: 'Серо-синяя гамма с металлическим отблеском. Строгий современный интерьер.',
      roles: { main: [74, 0.45], additional: [58, 0.65], accent: [36, 1.15], deep_accent: [24, 1.30], ceiling: [93, 0.15], trim: [84, 0.3] },
      hueTarget: COOL_HUE, tempPull: 0.55, chromaScale: 0.85
    },
    {
      id: 'muted_vintage', title: 'Пыль времени',
      desc: 'Приглушённые выцветшие оттенки, будто под слоем патины. Отсылка к старым фрескам.',
      roles: { main: [70, 0.35], additional: [56, 0.5], accent: [42, 0.8], deep_accent: [30, 0.95], ceiling: [90, 0.18], trim: [80, 0.3] },
      hueTarget: WARM_HUE, tempPull: 0.2, chromaScale: 0.5
    },
    {
      id: 'luxury_dark', title: 'Ночная роскошь',
      desc: 'Глубокие тёмные стены, насыщенный цвет и контрастная светлая столярка. Кабинет, спальня, ресторан.',
      roles: { main: [30, 0.95], additional: [42, 0.8], accent: [62, 1.2], deep_accent: [18, 1.30], ceiling: [80, 0.3], trim: [88, 0.2] },
      hueTarget: null, tempPull: 0, chromaScale: 1.15
    },
    {
      id: 'nature_organic', title: 'Голос природы',
      desc: 'Зелень листвы, мох и древесная кора. Живая, но неутомительная гамма.',
      roles: { main: [68, 0.55], additional: [54, 0.8], accent: [38, 1.25], deep_accent: [26, 1.40], ceiling: [92, 0.2], trim: [82, 0.35] },
      hueTarget: 135, tempPull: 0.45, chromaScale: 0.95
    },
    {
      id: 'white_minimal', title: 'Светлая тишина',
      desc: 'Почти монохромная белая гамма с едва уловимым подтоном. Максимум света и воздуха.',
      roles: { main: [90, 0.16], additional: [83, 0.24], accent: [58, 0.9], deep_accent: [40, 1.10], ceiling: [96, 0.08], trim: [93, 0.12] },
      hueTarget: null, tempPull: 0.1, chromaScale: 0.35
    },
    {
      id: 'beige_soft', title: 'Песочный ветер',
      desc: 'Тёплые бежевые и льняные тона. Самая универсальная база для жилых комнат.',
      roles: { main: [80, 0.35], additional: [70, 0.5], accent: [50, 1.0], deep_accent: [36, 1.15], ceiling: [94, 0.15], trim: [87, 0.25] },
      hueTarget: 78, tempPull: 0.5, chromaScale: 0.6
    },
    {
      id: 'neutral_soft', title: 'Тёплая туманность',
      desc: 'Тёплые серые с бежевым подтоном — «greige». Фон, на котором хорошо смотрится любое дерево.',
      roles: { main: [77, 0.22], additional: [64, 0.32], accent: [44, 0.85], deep_accent: [30, 1.00], ceiling: [93, 0.1], trim: [85, 0.18] },
      hueTarget: 70, tempPull: 0.65, chromaScale: 0.4
    },
    {
      id: 'neutral_cool', title: 'Серебристая дымка',
      desc: 'Холодные серые с голубым подтоном. Подходит для комнат с избытком южного солнца.',
      roles: { main: [76, 0.22], additional: [63, 0.32], accent: [43, 0.85], deep_accent: [29, 1.00], ceiling: [93, 0.1], trim: [85, 0.18] },
      hueTarget: 250, tempPull: 0.65, chromaScale: 0.4
    }
  ];

  var PRESETS_BY_ID = {};
  MOOD_PRESETS.forEach(function (p) { PRESETS_BY_ID[p.id] = p; });

  /* ============================================================
   *  Построение интерьерных палитр
   * ============================================================ */

  /** Кратчайший поворот от h к target, ослабленный на pull. */
  function pullHue(h, target, pull) {
    if (target == null || !pull) return h;
    var d = ((target - h + 540) % 360) - 180;
    return ((h + d * pull) % 360 + 360) % 360;
  }

  /**
   * Определяет, чем логичнее быть выбранному цвету — стенами или акцентом.
   * Тёмные и насыщенные оттенки плохо работают на всей площади стен.
   */
  /**
   * Чем логичнее быть выбранному цвету — стенами или акцентом.
   *
   * Решает не абстрактная «тёмность», а близость к целевой светлоте роли
   * в конкретном пресете: почти чёрный оттенок в «Дыхании света» может быть
   * только акцентом, а в «Ночной роскоши» он как раз и есть стены.
   * Роли «стены» дана фора — это ожидание клиента по умолчанию.
   */
  function autoBaseRole(hex, preset) {
    var lab = C.hexToLab(hex);
    if (!lab) return 'main';
    var lch = C.labToLch(lab.l, lab.a, lab.b);

    var mainTarget = preset && preset.roles && preset.roles.main ? preset.roles.main[0] : 74;
    var accentTarget = preset && preset.roles && preset.roles.accent ? preset.roles.accent[0] : 44;

    // очень насыщенный цвет не может занимать 60% светлой комнаты
    if (lch.c > 48 && mainTarget >= 55) return 'accent';

    var dMain = Math.abs(mainTarget - lch.l);
    var dAccent = Math.abs(accentTarget - lch.l) * 1.25;
    return dAccent < dMain ? 'accent' : 'main';
  }

  /**
   * Строит один цвет палитры: тянет базовый тон к целевым параметрам роли
   * и пресета, вгоняет в охват sRGB и подбирает ближайший цвет каталога.
   */
  function buildRoleColor(baseLch, roleId, preset, hueOffset, opts) {
    var spec = preset.roles[roleId] || preset.roles.additional || [60, 0.6];
    var targetL = spec[0];
    var chromaMul = spec[1];

    var h = pullHue((baseLch.h + (hueOffset || 0)) % 360, preset.hueTarget, preset.tempPull);
    var c = Math.max(0.6, baseLch.c * chromaMul * preset.chromaScale);

    // Почти нейтральная база (серый, белый, антрацит) обнуляет смысл
    // гармонических схем: поворот тона у цвета с хромой 3 не даёт разницы,
    // и все схемы выглядят одинаково. Поэтому неосновным ролям задаём
    // минимальную рабочую хрому — стены и потолок остаются нейтральными,
    // а акценты получают настоящий тон. Так и работает дизайнер:
    // спокойный фон плюс цветной акцент.
    if (baseLch.c < NEUTRAL_CHROMA) {
      var floor = NEUTRAL_CHROMA_FLOOR[roleId] || 0;
      if (floor) c = Math.max(c, floor * preset.chromaScale);
    }
    c = Math.min(c, 96);

    var lab = C.fitToGamut(C.clamp(targetL, 6, 97), c, h);
    var targetHex = C.labToHex(lab.l, lab.a, lab.b);

    var match = nearestOne(lab, {
      formula: (opts && opts.formula) || 'de2000',
      collections: opts && opts.collections
    });

    var finalColor = match ? match.color : null;
    var hex = finalColor ? finalColor.hex : targetHex;
    var finalLab = finalColor ? finalColor.lab : lab;

    return {
      role: roleId,
      roleLabel: roleMeta(roleId).label,
      weight: roleMeta(roleId).weight,
      hex: hex,
      targetHex: targetHex,
      lab: finalLab,
      lch: C.labToLch(finalLab.l, finalLab.a, finalLab.b),
      lrv: C.lrv(hex),
      temperature: C.temperature(hex),
      catalogColorCode: finalColor ? finalColor.code : null,
      catalogColorName: finalColor ? finalColor.name : null,
      catalogCollection: finalColor ? finalColor.collection : null,
      deltaE: match ? match.deltaE : null
    };
  }

  /**
   * Полный набор интерьерных палитр для базового цвета.
   *
   * @param {string} baseHex
   * @param {string} presetId идентификатор настроения
   * @param {object} [opts] { baseRoleOverride, schemes, formula, collections }
   * @returns {{baseColor, presetId, autoBaseRole, effectiveBaseRole, results:[]}}
   */
  function buildInteriorPalettes(baseHex, presetId, opts) {
    opts = opts || {};
    var hex = C.normalizeHex(baseHex);
    if (!hex) return null;
    var preset = PRESETS_BY_ID[presetId] || MOOD_PRESETS[0];

    var lab = C.hexToLab(hex);
    var lch = C.labToLch(lab.l, lab.a, lab.b);
    // у полностью нейтрального цвета тон не определён — берём опору из пресета,
    // чтобы схемам было от чего отсчитывать углы
    if (lch.c < 1.5) lch = { l: lch.l, c: lch.c, h: preset.hueTarget == null ? 60 : preset.hueTarget };

    var auto = autoBaseRole(hex, preset);
    var effective = opts.baseRoleOverride && opts.baseRoleOverride !== 'auto'
      ? opts.baseRoleOverride
      : auto;

    var schemeIds = opts.schemes && opts.schemes.length
      ? opts.schemes
      : ['monochrome', 'analogous', 'complementary', 'split_complementary', 'triad', 'accented_analogous'];

    var results = schemeIds.map(function (schemeId) {
      var scheme = C.HARMONY_SCHEMES.filter(function (s) { return s.id === schemeId; })[0];
      if (!scheme) return null;

      // роли распределяются по смещениям схемы; базовый цвет занимает свою роль как есть
      var offsets = scheme.offsets;
      var plan = [
        { role: 'main', off: offsets[0] },
        { role: 'additional', off: offsets[1] },
        { role: 'accent', off: offsets[2] },
        { role: 'deep_accent', off: offsets[3] }
      ];

      // если выбранный цвет — акцент, схема разворачивается вокруг него
      if (effective === 'accent') {
        plan = [
          { role: 'accent', off: offsets[0] },
          { role: 'main', off: offsets[1] },
          { role: 'additional', off: offsets[2] },
          { role: 'deep_accent', off: offsets[3] }
        ];
      }

      var colors = plan.map(function (p) {
        return buildRoleColor(lch, p.role, preset, p.off, opts);
      });

      // базовый цвет клиента должен остаться в палитре ровно таким, каким он выбран
      var baseSlot = colors.filter(function (c2) { return c2.role === effective; })[0] || colors[0];
      var baseMatch = nearestOne(lab, { formula: opts.formula, collections: opts.collections });
      baseSlot.hex = hex;
      baseSlot.lab = lab;
      baseSlot.lch = C.labToLch(lab.l, lab.a, lab.b);
      baseSlot.lrv = C.lrv(hex);
      baseSlot.temperature = C.temperature(hex);
      baseSlot.isBase = true;
      baseSlot.catalogColorCode = baseMatch ? baseMatch.color.code : null;
      baseSlot.catalogColorName = baseMatch ? baseMatch.color.name : null;
      baseSlot.catalogCollection = baseMatch ? baseMatch.color.collection : null;
      baseSlot.deltaE = baseMatch ? baseMatch.deltaE : null;

      // потолок и столярка добавляются всегда — без них палитра не готова к работе
      var ceiling = buildRoleColor(lch, 'ceiling', preset, 0, opts);
      var trim = buildRoleColor(lch, 'trim', preset, offsets[1], opts);

      // убираем дубли: два одинаковых кода в палитре бесполезны
      var all = dedupeByCode(colors.concat([ceiling, trim]), lch, preset, opts);

      return {
        schemeId: scheme.id,
        label: scheme.label,
        desc: scheme.desc,
        colors: all,
        contrast: paletteContrast(all),
        meta: {
          presetId: preset.id,
          presetTitle: preset.title,
          baseRole: effective
        }
      };
    }).filter(Boolean);

    return {
      baseColor: hex,
      presetId: preset.id,
      presetTitle: preset.title,
      presetDesc: preset.desc,
      autoBaseRole: auto,
      effectiveBaseRole: effective,
      results: results
    };
  }

  /** Если две роли получили один каталожный цвет, вторую сдвигаем по светлоте. */
  function dedupeByCode(colors, baseLch, preset, opts) {
    var used = {};
    return colors.map(function (col) {
      if (col.isBase || !col.catalogColorCode) {
        if (col.catalogColorCode) used[col.catalogColorCode] = true;
        return col;
      }
      if (!used[col.catalogColorCode]) {
        used[col.catalogColorCode] = true;
        return col;
      }
      var lab = col.lab;
      for (var shift = 8; shift <= 32; shift += 8) {
        for (var dir = 0; dir < 2; dir++) {
          var dl = dir === 0 ? shift : -shift;
          var probe = { l: C.clamp(lab.l + dl, 6, 97), a: lab.a, b: lab.b };
          var alt = nearest(probe, {
            limit: 4,
            formula: (opts && opts.formula) || 'de2000',
            collections: opts && opts.collections
          });
          for (var i = 0; i < alt.length; i++) {
            if (!used[alt[i].color.code]) {
              used[alt[i].color.code] = true;
              var f = alt[i].color;
              return Object.assign({}, col, {
                hex: f.hex, lab: f.lab, lch: f.lch, lrv: f.lrv,
                temperature: f.temperature,
                catalogColorCode: f.code, catalogColorName: f.name,
                catalogCollection: f.collection, deltaE: alt[i].deltaE
              });
            }
          }
        }
      }
      return col;
    });
  }

  /** Диапазон светлоты палитры — по нему видно, «плоская» она или контрастная. */
  function paletteContrast(colors) {
    var ls = colors.map(function (c) { return c.lch.l; });
    var min = Math.min.apply(null, ls), max = Math.max.apply(null, ls);
    var spread = max - min;
    var wall = colors.filter(function (c) { return c.role === 'main'; })[0];
    var accent = colors.filter(function (c) { return c.role === 'accent'; })[0];
    return {
      spread: C.round(spread, 1),
      level: spread > 45 ? 'high' : spread > 24 ? 'medium' : 'low',
      levelLabel: spread > 45 ? 'Высокий контраст' : spread > 24 ? 'Средний контраст' : 'Мягкий контраст',
      wallAccentRatio: wall && accent ? C.round(C.contrastRatio(wall.hex, accent.hex), 2) : null
    };
  }

  /* ============================================================
   *  Форматы заказа
   * ============================================================ */

  var ORDER_OPTIONS = [
    { id: 'swatch', title: 'Выкрас на бумаге', volume: 'A5, 2 слоя', price: 190,
      note: 'Реальная краска на плотной бумаге — единственный способ увидеть точный оттенок.',
      lead: '1–2 дня', badge: 'Точнее экрана' },
    { id: 'tester', title: 'Пробник', volume: '50 мл', price: 490,
      note: 'Хватает выкрасить участок примерно 0,5 м² в два слоя.', lead: '24 часа' },
    { id: 'l1', title: 'Краска', volume: '1 л', price: 1690,
      note: 'До 10 м² в два слоя — небольшая стена или откосы.', lead: '24 часа' },
    { id: 'l27', title: 'Краска', volume: '2,7 л', price: 3990,
      note: 'До 27 м² в два слоя — комната среднего размера.', lead: '24 часа', badge: 'Популярно' },
    { id: 'l9', title: 'Краска', volume: '9 л', price: 11900,
      note: 'До 90 м² в два слоя — квартира или большое помещение.', lead: '1–2 дня', badge: 'Выгодно' }
  ];

  /* ============================================================
   *  Поверхности для расчёта расхода
   * ============================================================ */

  var SURFACES = [
    { id: 'plaster', label: 'Гладкая штукатурка / шпаклёвка', consumption: 11, factor: 1.0 },
    { id: 'primed', label: 'Загрунтованный гипсокартон', consumption: 12, factor: 1.0 },
    { id: 'wallpaper', label: 'Обои под покраску', consumption: 9, factor: 1.1 },
    { id: 'concrete', label: 'Бетон, кирпич без штукатурки', consumption: 7, factor: 1.25 },
    { id: 'decor', label: 'Декоративная фактура', consumption: 6, factor: 1.35 },
    { id: 'wood', label: 'Дерево, столярка', consumption: 10, factor: 1.05 }
  ];

  /* ============================================================
   *  Локальное хранилище: избранное, оценки, история
   * ============================================================ */

  function storeKey(name) { return config.storagePrefix + name; }

  function readStore(name, fallback) {
    try {
      var raw = global.localStorage.getItem(storeKey(name));
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeStore(name, value) {
    try {
      global.localStorage.setItem(storeKey(name), JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  var store = {
    getFavorites: function () { return readStore('favorites', []); },
    isFavorite: function (code) { return this.getFavorites().indexOf(code) !== -1; },
    toggleFavorite: function (code) {
      var list = this.getFavorites();
      var i = list.indexOf(code);
      if (i === -1) list.push(code); else list.splice(i, 1);
      writeStore('favorites', list);
      return i === -1;
    },
    getRatings: function () { return readStore('ratings', {}); },
    setRating: function (key, value) {
      var r = this.getRatings();
      r[key] = value;
      writeStore('ratings', r);
      return r;
    },
    getRecent: function () { return readStore('recent', []); },
    pushRecent: function (entry) {
      var list = this.getRecent().filter(function (e) { return e.hex !== entry.hex; });
      list.unshift(Object.assign({ at: Date.now() }, entry));
      writeStore('recent', list.slice(0, 24));
      return list;
    },
    getSavedPalettes: function () { return readStore('palettes', []); },
    savePalette: function (palette) {
      var list = this.getSavedPalettes();
      list.unshift(Object.assign({ id: 'p' + Date.now(), at: Date.now() }, palette));
      writeStore('palettes', list.slice(0, 40));
      return list;
    },
    removePalette: function (id) {
      var list = this.getSavedPalettes().filter(function (p) { return p.id !== id; });
      writeStore('palettes', list);
      return list;
    },
    clear: function () {
      ['favorites', 'ratings', 'recent', 'palettes'].forEach(function (n) {
        try { global.localStorage.removeItem(storeKey(n)); } catch (e) {}
      });
    }
  };

  /* ============================================================
   *  Сетевой слой (необязательный)
   * ============================================================ */

  function apiUrl(path) {
    return config.apiBase ? String(config.apiBase).replace(/\/$/, '') + path : null;
  }

  function fetchJson(url, options) {
    if (!global.fetch) return Promise.reject(new Error('fetch недоступен'));
    var ctrl = global.AbortController ? new global.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, config.apiTimeout) : null;
    return global.fetch(url, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, options || {}))
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  /** Поиск по каталогу: сначала API, при недоступности — локальный индекс. */
  function searchCatalogAsync(query, opts) {
    var url = apiUrl('/api/v1/catalog/colors?q=' + encodeURIComponent(query) + '&limit=' + ((opts && opts.limit) || 25));
    if (!url) return Promise.resolve(searchCatalog(query, opts));
    return fetchJson(url, { headers: { Accept: 'application/json' } })
      .then(function (data) {
        var items = Array.isArray(data) ? data : (data.items || []);
        if (!items.length) return searchCatalog(query, opts);
        return items.map(normalizeRemoteColor).filter(Boolean);
      })
      .catch(function () { return searchCatalog(query, opts); });
  }

  function normalizeRemoteColor(item) {
    var hex = C.normalizeHex(item.hex || item.HEX);
    if (!hex) return null;
    var lab = item.lab && typeof item.lab.l === 'number'
      ? item.lab
      : (typeof item.lab_l === 'number' ? { l: item.lab_l, a: item.lab_a, b: item.lab_b } : C.hexToLab(hex));
    return {
      code: item.color_code || item.code || '—',
      name: item.color_name || item.name || '',
      hex: hex,
      collection: item.collection || item.palette_name || 'Внешний каталог',
      family: item.family || '',
      familyId: item.familyId || '',
      lab: lab,
      lch: C.labToLch(lab.l, lab.a, lab.b),
      lrv: C.lrv(hex),
      temperature: C.temperature(hex),
      remote: true,
      detailUrl: item.catalogDetailUrl || item.url || null
    };
  }

  /** Интерьерные палитры: API имеет приоритет, локальный расчёт — резерв. */
  function buildInteriorPalettesAsync(baseHex, presetId, opts) {
    var url = apiUrl('/api/v1/palettes/interior/harmonies');
    var local = function () { return buildInteriorPalettes(baseHex, presetId, opts); };
    if (!url) return Promise.resolve(local());

    var payload = { baseColor: C.normalizeHex(baseHex), presetId: presetId, schemes: (opts && opts.schemes) || [] };
    if (opts && opts.baseRoleOverride && opts.baseRoleOverride !== 'auto') {
      payload.baseRoleOverride = opts.baseRoleOverride;
    }
    return fetchJson(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) { return (data && data.results && data.results.length) ? data : local(); })
      .catch(function () { return local(); });
  }

  function logEvent(eventType, payload) {
    if (!config.logEvents) return;
    var url = apiUrl('/api/v1/frontend-events');
    if (!url || !global.fetch) return;
    try {
      global.fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: eventType, payload: payload, at: new Date().toISOString() }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  /* ============================================================
   *  Экспорт
   * ============================================================ */

  global.ArchiPaintData = {
    configure: configure,
    config: config,

    getCatalog: getCatalog,
    getByCode: getByCode,
    getStandards: getStandards,
    searchStandards: searchStandards,
    matchStandard: matchStandard,
    STANDARD_NAMES: STANDARD_NAMES,
    searchCatalog: searchCatalog,
    searchCatalogAsync: searchCatalogAsync,
    nearest: nearest,
    nearestOne: nearestOne,

    COLLECTIONS: COLLECTIONS,
    FAMILIES: FAMILIES,
    ROLES: ROLES,
    ROLE_ORDER: ROLE_ORDER,
    roleMeta: roleMeta,
    MOOD_PRESETS: MOOD_PRESETS,
    PRESETS_BY_ID: PRESETS_BY_ID,
    ORDER_OPTIONS: ORDER_OPTIONS,
    SURFACES: SURFACES,

    autoBaseRole: autoBaseRole,
    buildInteriorPalettes: buildInteriorPalettes,
    buildInteriorPalettesAsync: buildInteriorPalettesAsync,
    paletteContrast: paletteContrast,

    store: store,
    logEvent: logEvent
  };
})(typeof window !== 'undefined' ? window : globalThis);
