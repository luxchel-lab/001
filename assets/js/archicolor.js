/*!
 * ArchiPaint · archicolor.js
 * Страница /AI: фотография комнаты + задание в свободной форме → Decor8.ai,
 * затем разбор результата на цвета и подбор оттенков ArchiPaint.
 *
 * Вся тяжёлая работа — на бэкенде (/api/archicolor/*): ключ провайдера, лимиты
 * и цветовая математика живут там. Здесь только интерфейс: загрузка файла,
 * прогресс, показ результата и список к заказу.
 *
 * Точка входа: archicolor({ ... }) — параметры смотрите в DEFAULTS.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    generateUrl: '/api/archicolor/generate',
    quotaUrl: '/api/archicolor/quota',
    analyzeUrl: '/api/archicolor/analyze',
    catalogUrl: '/podbor-kraski-po-foto/',
    /** Ссылка на карточку цвета: {code} заменяется на артикул. */
    colorUrl: '/podbor-kraski-po-foto/?color={code}',
    /** Варианты покупки. Замените на реальные товары каталога. */
    options: [
      { id: 'sample', title: 'Выкрас А5', note: 'Настоящая краска на плотной бумаге', price: 290 },
      { id: 'tester', title: 'Пробник 100 мл', note: 'Хватит выкрасить участок стены', price: 590 },
      { id: 'can', title: 'Банка 0,9 л', note: 'Примерно 10 м² в два слоя', price: 2490 }
    ],
    maxUploadMb: 12
  };

  var STAGES = [
    'Отправляем фотографию в генератор…',
    'Разбираем планировку и освещение…',
    'Прорабатываем ваше задание…',
    'Подбираем материалы и цвет…',
    'Дорисовываем финальные детали…'
  ];

  function archicolor(userOptions) {
    var opts = merge(DEFAULTS, userOptions || {});
    var root = document.querySelector('[data-archicolor]');
    if (!root) { return null; }

    var el = {
      drop: q('#acDrop'), file: q('#acFile'), preview: q('#acPreview'), previewImg: q('#acPreviewImg'),
      fileNote: q('#acFileNote'), reset: q('#acReset'),
      prompt: q('#acPrompt'), promptCount: q('#acPromptCount'), samples: q('#acSamples'),
      submit: q('#acSubmit'), quota: q('#acQuota'), form: q('#acForm'),
      progress: q('#acProgress'), progressFill: q('#acProgressFill'), progressText: q('#acProgressText'),
      result: q('#acResult'), before: q('#acBefore'), after: q('#acAfter'),
      compare: q('#acCompare'), range: q('#acRange'),
      resultNote: q('#acResultNote'), download: q('#acDownload'),
      again: q('#acAgain'), newPhoto: q('#acNewPhoto'),
      colors: q('#acColors'), colorsCard: q('#acColorsCard'), colorsIntro: q('#acColorsIntro'),
      error: q('#acError'), errorText: q('#acErrorText'),
      cartBtn: q('#acCartBtn'), cartCount: q('#acCartCount'), drawer: q('#acDrawer'),
      drawerBack: q('#acDrawerBack'), cartItems: q('#acCartItems'), cartTotal: q('#acCartTotal'),
      toast: q('#acToast')
    };

    function q(sel) { return root.querySelector(sel); }

    var state = {
      file: null,
      previewUrl: null,
      busy: false,
      blocked: false,
      quota: null,
      job: null,
      timer: null,
      progress: 0,
      cart: []
    };

    /* ================= загрузка фотографии ================= */

    function acceptFile(file) {
      if (!file) { return; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        showError('Поддерживаются JPG, PNG и WebP.');
        return;
      }
      var limit = (state.quota && state.quota.maxUploadMb) || opts.maxUploadMb;
      if (file.size > limit * 1024 * 1024) {
        showError('Файл больше ' + limit + ' МБ. Уменьшите фотографию и попробуйте снова.');
        return;
      }

      hideError();
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); }
      state.file = file;
      state.previewUrl = URL.createObjectURL(file);

      el.previewImg.src = state.previewUrl;
      el.preview.hidden = false;
      el.drop.hidden = true;
      el.fileNote.textContent = file.name + ' · ' + Math.round(file.size / 1024) + ' КБ';
      updateSubmit();
    }

    el.drop.addEventListener('click', function () { el.file.click(); });
    el.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
    });
    el.file.addEventListener('change', function () { acceptFile(el.file.files[0]); });

    ['dragenter', 'dragover'].forEach(function (type) {
      el.drop.addEventListener(type, function (e) {
        e.preventDefault();
        el.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      el.drop.addEventListener(type, function (e) {
        e.preventDefault();
        el.drop.classList.remove('is-over');
      });
    });
    el.drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        acceptFile(e.dataTransfer.files[0]);
      }
    });

    document.addEventListener('paste', function (e) {
      if (!e.clipboardData || !e.clipboardData.items) { return; }
      for (var i = 0; i < e.clipboardData.items.length; i++) {
        var item = e.clipboardData.items[i];
        if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
          acceptFile(item.getAsFile());
          return;
        }
      }
    });

    el.reset.addEventListener('click', function () {
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); }
      state.file = null;
      state.previewUrl = null;
      el.file.value = '';
      el.preview.hidden = true;
      el.drop.hidden = false;
      el.fileNote.textContent = '';
      updateSubmit();
    });

    /* ================= задание ================= */

    el.prompt.addEventListener('input', function () {
      el.promptCount.textContent = el.prompt.value.length + ' / 900';
      updateSubmit();
    });

    if (el.samples) {
      el.samples.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-sample]');
        if (!chip) { return; }
        el.prompt.value = chip.getAttribute('data-sample');
        el.prompt.dispatchEvent(new Event('input'));
        el.prompt.focus();
      });
    }

    function updateSubmit() {
      var ready = !!state.file && el.prompt.value.trim().length >= 3 && !state.busy && !state.blocked;
      el.submit.disabled = !ready;
    }

    /* ================= квота ================= */

    function loadQuota() {
      fetch(opts.quotaUrl, { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data.ok) { return; }
          state.quota = data;
          renderQuota();
        })
        .catch(function () { /* бейдж — необязательная деталь, молчим */ });
    }

    function renderQuota() {
      var data = state.quota;
      if (!data) { el.quota.hidden = true; return; }

      el.quota.hidden = false;
      if (data.freeLeft > 0) {
        el.quota.className = 'ac-quota' + (data.freeLeft <= 3 ? ' is-low' : '');
        el.quota.textContent = 'Бесплатно: ' + data.freeLeft + ' из ' + data.freeTotal;
        state.blocked = false;
      } else if (data.canGenerate) {
        el.quota.className = 'ac-quota is-low';
        el.quota.textContent = 'Платно: ' + data.pricePerImage + ' ₽ за генерацию';
        state.blocked = false;
      } else {
        el.quota.className = 'ac-quota is-out';
        el.quota.textContent = 'Бесплатные генерации закончились';
        state.blocked = true;
      }
      updateSubmit();
    }

    /* ================= генерация ================= */

    el.submit.addEventListener('click', generate);
    el.again.addEventListener('click', function () { generate(); });
    el.newPhoto.addEventListener('click', function () {
      el.reset.click();
      el.result.hidden = true;
      el.colorsCard.hidden = true;
      el.form.hidden = false;
      window.scrollTo({ top: el.form.offsetTop - 40, behavior: 'smooth' });
    });

    function generate() {
      if (state.busy || !state.file || state.blocked) { return; }
      hideError();

      state.busy = true;
      updateSubmit();
      el.form.hidden = true;
      el.result.hidden = true;
      el.colorsCard.hidden = true;
      el.progress.hidden = false;
      startProgress();

      var body = new FormData();
      body.append('image', state.file);
      body.append('prompt', el.prompt.value.trim());

      fetch(opts.generateUrl, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) { return { status: res.status, data: data }; });
        })
        .then(function (result) {
          if (!result.data || result.data.ok !== true) {
            throw describeError(result);
          }
          finishProgress();
          setTimeout(function () { showResult(result.data); }, 320);
        })
        .catch(function (error) {
          stopProgress();
          state.busy = false;
          el.progress.hidden = true;
          el.form.hidden = false;
          updateSubmit();
          showError(error && error.message ? error.message : 'Не удалось связаться с сервером. Проверьте соединение.');
          if (error && error.quota) { loadQuota(); }
        });
    }

    function describeError(result) {
      var data = result.data || {};
      var error = data.error || {};
      var e = new Error(error.message || 'Не удалось получить дизайн. Попробуйте ещё раз.');
      e.code = error.code || 'unknown';
      e.quota = (e.code === 'quota_exceeded' || e.code === 'rate_limited');
      return e;
    }

    function startProgress() {
      state.progress = 0;
      el.progressFill.style.width = '0%';
      el.progressText.textContent = STAGES[0];

      var stage = 0;
      stopProgress();
      state.timer = setInterval(function () {
        stage = (stage + 1) % STAGES.length;
        el.progressText.textContent = STAGES[stage];
        // до 90% ползём сами, последние 10% дорисовывает ответ сервера
        state.progress = Math.min(90, state.progress + 8 + Math.random() * 7);
        el.progressFill.style.width = state.progress + '%';
      }, 1200);
    }

    function stopProgress() {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    function finishProgress() {
      stopProgress();
      el.progressFill.style.width = '100%';
    }

    /* ================= результат ================= */

    function showResult(data) {
      state.busy = false;
      state.job = data;
      el.progress.hidden = true;
      el.result.hidden = false;

      el.before.src = state.previewUrl;
      el.after.src = data.resultImageUrl;
      el.download.href = data.resultImageUrl;
      el.download.setAttribute('download', 'archicolor-' + data.jobId + '.jpg');

      var parts = [];
      if (data.prompt && data.prompt.roomType) { parts.push(roomLabel(data.prompt.roomType)); }
      if (data.prompt && data.prompt.style) { parts.push(styleLabel(data.prompt.style)); }
      parts.push('готово за ' + formatSeconds(data.elapsed));
      el.resultNote.textContent = parts.join(' · ');

      el.range.value = 50;
      applyCompare(50);

      state.quota = merge(state.quota || {}, {
        freeLeft: data.freeLeft, freeTotal: data.freeTotal,
        balance: data.balance, pricePerImage: data.pricePerImage,
        canGenerate: data.freeLeft > 0 || (data.balance >= data.pricePerImage)
      });
      renderQuota();

      renderColors(data.colors || []);
      updateSubmit();
      el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    el.range.addEventListener('input', function () { applyCompare(this.value); });

    function applyCompare(value) {
      el.compare.style.setProperty('--ac-split', value + '%');
    }

    /* ================= цвета и заказ ================= */

    function renderColors(colors) {
      if (!colors.length) { el.colorsCard.hidden = true; return; }

      el.colorsCard.hidden = false;
      el.colorsIntro.innerHTML = 'Мы разложили готовое изображение на ' + colors.length +
        ' основных ' + plural(colors.length, 'цвет', 'цвета', 'цветов') +
        ' и подобрали к каждому ближайшие оттенки ArchiPaint. ΔE — расхождение по CIEDE2000: ' +
        'до 1,5 глаз разницы не увидит.';

      el.colors.innerHTML = '';
      colors.forEach(function (color, index) {
        el.colors.appendChild(buildColorRow(color, index));
      });
    }

    function buildColorRow(color, index) {
      var row = document.createElement('article');
      row.className = 'ac-color';
      row.style.animationDelay = (index * 70) + 'ms';

      var matches = color.matches.map(function (match) {
        return '<button class="ac-match" data-code="' + escapeAttr(match.code) + '">' +
          '<span class="ac-match-sw" style="background:' + escapeAttr(match.hex) + '"></span>' +
          '<span class="ac-match-txt">' +
            '<b>' + escapeHtml(match.name) + '</b>' +
            '<small>' + escapeHtml(match.code) + ' · ' + escapeHtml(match.collection) + '</small>' +
          '</span>' +
          '<span class="ac-de ac-de--' + escapeAttr(match.qualityCls) + '" title="' + escapeAttr(match.quality) + '">ΔE ' +
            match.deltaE.toFixed(2) + '</span>' +
        '</button>';
      }).join('');

      row.innerHTML =
        '<div class="ac-color-sw" style="background:' + escapeAttr(color.hex) + ';color:' + escapeAttr(color.textOn) + '">' +
          '<b>' + escapeHtml(color.hex) + '</b>' +
          '<span>' + color.sharePct + '%</span>' +
        '</div>' +
        '<div class="ac-color-meta">' +
          '<b>' + escapeHtml(color.role) + '</b>' +
          '<small>LRV ' + color.lrv + ' · Lab ' + color.lab.join(', ') + '</small>' +
          '<span class="ac-share"><i style="width:' + Math.max(4, color.sharePct) + '%"></i></span>' +
        '</div>' +
        '<div class="ac-color-matches">' + matches + '</div>';

      return row;
    }

    el.colors.addEventListener('click', function (e) {
      var button = e.target.closest('[data-code]');
      if (!button) { return; }
      openBuy(button.getAttribute('data-code'));
    });

    /** Панель покупки: варианты выкраса, пробника и банки. */
    function openBuy(code) {
      var color = findColor(code);
      if (!color) { return; }

      var html = opts.options.map(function (option) {
        return '<div class="ac-opt">' +
          '<div class="ac-opt-info"><b>' + escapeHtml(option.title) + '</b><p>' + escapeHtml(option.note) + '</p></div>' +
          '<span class="ac-opt-price">' + formatPrice(option.price) + '</span>' +
          '<button class="ac-btn ac-btn--accent" data-buy="' + escapeAttr(option.id) + '" data-color="' +
            escapeAttr(code) + '">В список</button>' +
        '</div>';
      }).join('');

      var link = opts.colorUrl.replace('{code}', encodeURIComponent(code));
      showModal(
        '<div class="ac-modal-head" style="background:' + escapeAttr(color.hex) + ';color:' + escapeAttr(color.textOn) + '">' +
          '<span class="ac-modal-kicker">Оттенок ArchiPaint</span>' +
          '<h3>' + escapeHtml(color.name) + '</h3>' +
          '<span class="ac-modal-code">' + escapeHtml(color.code) + ' · ' + escapeHtml(color.hex) + '</span>' +
        '</div>' +
        '<div class="ac-modal-body">' +
          '<p class="ac-modal-note">Расхождение с цветом на изображении — ΔE ' + color.deltaE.toFixed(2) +
            ' (' + escapeHtml(color.quality) + '). LRV ' + color.lrv + '.</p>' +
          html +
          '<p class="ac-modal-fine">Цвет на экране зависит от монитора. Перед покупкой краски закажите выкрас — ' +
            'это единственный честный способ увидеть оттенок в вашем освещении.</p>' +
          '<a class="ac-link" href="' + escapeAttr(link) + '">Открыть карточку цвета в каталоге →</a>' +
        '</div>'
      );
    }

    function findColor(code) {
      var found = null;
      (state.job && state.job.colors ? state.job.colors : []).forEach(function (color) {
        color.matches.forEach(function (match) {
          if (match.code === code && !found) { found = match; }
        });
      });
      return found;
    }

    /* ================= список к заказу ================= */

    function addToCart(code, optionId) {
      var color = findColor(code);
      var option = null;
      opts.options.forEach(function (item) { if (item.id === optionId) { option = item; } });
      if (!color || !option) { return; }

      var key = code + ':' + optionId;
      var existing = null;
      state.cart.forEach(function (item) { if (item.key === key) { existing = item; } });

      if (existing) {
        existing.qty++;
      } else {
        state.cart.push({ key: key, color: color, option: option, qty: 1 });
      }

      renderCart();
      toast(color.name + ' (' + color.code + ') — ' + option.title + ': добавлено');

      // Хук для интеграции с корзиной Bitrix: определите функцию на странице.
      if (typeof global.archicolorAddToBasket === 'function') {
        try { global.archicolorAddToBasket(color, option); } catch (error) { /* корзина сайта своя */ }
      }
    }

    function renderCart() {
      var total = 0;
      var count = 0;

      if (!state.cart.length) {
        el.cartItems.innerHTML = '<p class="ac-cart-empty">Список пуст. Добавьте оттенок из подбора — ' +
          'мы посчитаем стоимость выкрасов и пробников.</p>';
      } else {
        el.cartItems.innerHTML = state.cart.map(function (item) {
          total += item.option.price * item.qty;
          count += item.qty;
          return '<div class="ac-cart-item">' +
            '<span class="ac-cart-sw" style="background:' + escapeAttr(item.color.hex) + '"></span>' +
            '<span class="ac-cart-info"><b>' + escapeHtml(item.color.name) + '</b>' +
              '<small>' + escapeHtml(item.color.code) + ' · ' + escapeHtml(item.option.title) + '</small></span>' +
            '<span class="ac-cart-qty">' +
              '<button class="ac-qty" data-qty="-1" data-key="' + escapeAttr(item.key) + '">−</button>' +
              '<b>' + item.qty + '</b>' +
              '<button class="ac-qty" data-qty="1" data-key="' + escapeAttr(item.key) + '">+</button>' +
            '</span>' +
            '<span class="ac-cart-price">' + formatPrice(item.option.price * item.qty) + '</span>' +
          '</div>';
        }).join('');
      }

      el.cartTotal.textContent = formatPrice(total);
      el.cartCount.textContent = count;
      el.cartCount.hidden = count === 0;
    }

    el.cartItems.addEventListener('click', function (e) {
      var button = e.target.closest('[data-qty]');
      if (!button) { return; }
      var delta = parseInt(button.getAttribute('data-qty'), 10);
      var key = button.getAttribute('data-key');
      state.cart = state.cart.filter(function (item) {
        if (item.key === key) { item.qty += delta; }
        return item.qty > 0;
      });
      renderCart();
    });

    el.cartBtn.addEventListener('click', function () { toggleDrawer(true); });
    el.drawerBack.addEventListener('click', function () { toggleDrawer(false); });
    root.querySelector('#acDrawerClose').addEventListener('click', function () { toggleDrawer(false); });

    function toggleDrawer(show) {
      el.drawer.classList.toggle('is-open', show);
      el.drawerBack.classList.toggle('is-open', show);
    }

    /* ================= модальное окно ================= */

    var modalBack = root.querySelector('#acModalBack');
    var modalBody = root.querySelector('#acModal');

    function showModal(html) {
      modalBody.innerHTML = '<button class="ac-modal-x" id="acModalX" aria-label="Закрыть">✕</button>' + html;
      modalBack.classList.add('is-open');
      root.querySelector('#acModalX').addEventListener('click', hideModal);
    }

    function hideModal() { modalBack.classList.remove('is-open'); }

    modalBack.addEventListener('click', function (e) { if (e.target === modalBack) { hideModal(); } });
    modalBody.addEventListener('click', function (e) {
      var button = e.target.closest('[data-buy]');
      if (!button) { return; }
      addToCart(button.getAttribute('data-color'), button.getAttribute('data-buy'));
      hideModal();
      toggleDrawer(true);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      hideModal();
      toggleDrawer(false);
    });

    /* ================= мелочи ================= */

    function showError(message) {
      el.errorText.textContent = message;
      el.error.hidden = false;
    }

    function hideError() { el.error.hidden = true; }

    var toastTimer = null;
    function toast(message) {
      el.toast.textContent = message;
      el.toast.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2600);
    }

    renderCart();
    loadQuota();
    updateSubmit();

    return { generate: generate, reloadQuota: loadQuota, state: state };
  }

  /* ================= утилиты ================= */

  function merge(base, extra) {
    var out = {};
    var key;
    for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key)) { out[key] = base[key]; } }
    for (key in extra) { if (Object.prototype.hasOwnProperty.call(extra, key)) { out[key] = extra[key]; } }
    return out;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(value) { return escapeHtml(value); }

  function formatPrice(value) {
    return Math.round(value).toLocaleString('ru-RU') + ' ₽';
  }

  function formatSeconds(value) {
    if (typeof value !== 'number') { return 'меньше минуты'; }
    if (value < 60) { return Math.max(1, Math.round(value)) + ' с'; }
    return Math.round(value / 60) + ' мин';
  }

  function plural(count, one, few, many) {
    var n = Math.abs(count) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) { return many; }
    if (n1 > 1 && n1 < 5) { return few; }
    if (n1 === 1) { return one; }
    return many;
  }

  var ROOMS = {
    livingroom: 'гостиная', bedroom: 'спальня', kitchen: 'кухня', bathroom: 'ванная',
    kidsroom: 'детская', office: 'кабинет', diningroom: 'столовая', foyer: 'прихожая',
    balcony: 'балкон', walkincloset: 'гардеробная', gym: 'спортзал', basement: 'подвал',
    openplan: 'студия', laundryroom: 'постирочная', back_patio: 'терраса', cafe: 'кафе'
  };

  var STYLES = {
    modern: 'современный', scandinavian: 'скандинавский', minimalist: 'минимализм',
    industrial: 'лофт', traditional: 'классика', artdeco: 'ар-деко', boho: 'бохо',
    japandi: 'джапанди', frenchcountry: 'прованс', rustic: 'рустик', coastal: 'прибрежный',
    mediterranean: 'средиземноморский', vintage: 'винтаж', farmhouse: 'фермерский',
    luxemodern: 'современная роскошь', organicmodern: 'органик-модерн', asian_zen: 'дзен',
    contemporary: 'хай-тек', maximalist: 'максимализм', eclectic: 'эклектика',
    midcenturymodern: 'мид-сенчури', tropical: 'тропический', biophilic: 'биофильный',
    shabbychic: 'шебби-шик', transitional: 'переходный', victorian: 'викторианский',
    southwestern: 'юго-западный'
  };

  function roomLabel(value) { return ROOMS[value] || value; }
  function styleLabel(value) { return STYLES[value] || value; }

  global.archicolor = archicolor;
  if (typeof module !== 'undefined' && module.exports) { module.exports = archicolor; }
})(typeof window !== 'undefined' ? window : globalThis);
