/*!
 * ArchiColor AI — общий скрипт прототипа.
 *
 * Один и тот же файл обслуживает обе вёрстки: и Bootstrap-вариант,
 * и авторский. Поэтому он не знает ни одного классового имени —
 * все зацепки идут через data-атрибуты:
 *
 *     <div data-archi="drop">          — зона загрузки
 *     <button data-archi="submit">     — кнопка примерки
 *
 * Состояния переключаются классами is-open / is-active / is-over,
 * которые каждая вёрстка оформляет по-своему.
 *
 * Бэкенд — заглушки в ../api/. Если PHP не запущен (страницу открыли
 * файлом), скрипт переходит на клиентскую имитацию: перекраска стен
 * рисуется на canvas. Демо не должно ломаться из-за окружения.
 */
(function (global) {
  'use strict';

  var API = {
    quota:       '../api/quota.php',
    palette:     '../api/palette.php',
    requestCode: '../api/auth-request-code.php',
    verify:      '../api/auth-verify.php',
    logout:      '../api/auth-logout.php',
    generate:    '../api/generate.php',
    topUp:       '../api/balance-topup.php',
    history:     '../api/history.php'
  };

  /** Запасная палитра — на случай, когда PHP недоступен. */
  var FALLBACK_PALETTE = [
    { code: 'AP-0101', name: 'Полярный день',       hex: '#F6F3F0', collection: 'Nord' },
    { code: 'AP-0110', name: 'Молочный туман',      hex: '#EFE9E1', collection: 'Nord' },
    { code: 'AP-0118', name: 'Ванильный крем',      hex: '#EBE1D6', collection: 'Nord' },
    { code: 'AP-0126', name: 'Льняное полотно',     hex: '#DDD3C4', collection: 'Nord' },
    { code: 'AP-0204', name: 'Серый кашемир',       hex: '#C9C7C1', collection: 'Minerals' },
    { code: 'AP-0212', name: 'Пыль дороги',         hex: '#9CA1A5', collection: 'Minerals' },
    { code: 'AP-0219', name: 'Титановый корпус',    hex: '#8D959B', collection: 'Minerals' },
    { code: 'AP-0224', name: 'Кремень',             hex: '#2C3136', collection: 'Minerals' },
    { code: 'AP-0314', name: 'Пустынный ветер',     hex: '#C9AB8C', collection: 'Terra' },
    { code: 'AP-0322', name: 'Латте',               hex: '#A9866B', collection: 'Terra' },
    { code: 'AP-0407', name: 'Пряничная корка',     hex: '#7A6450', collection: 'Terra' },
    { code: 'AP-0415', name: 'Терракотовый сад',    hex: '#9C5F45', collection: 'Terra' },
    { code: 'AP-0913', name: 'Грозовое небо',       hex: '#4F6076', collection: 'Pigments' },
    { code: 'AP-0921', name: 'Ультрамарин',         hex: '#33507E', collection: 'Pigments' },
    { code: 'AP-1003', name: 'Мятный лёд',          hex: '#B7CCC4', collection: 'Pigments' },
    { code: 'AP-1106', name: 'Лесной мох',          hex: '#5A6E56', collection: 'Minerals' },
    { code: 'AP-1107', name: 'Хвойная тень',        hex: '#414F45', collection: 'Minerals' },
    { code: 'AP-1115', name: 'Бутылочное стекло',   hex: '#2F4033', collection: 'Minerals' },
    { code: 'AP-1202', name: 'Тростниковая циновка',hex: '#D6CBB4', collection: 'Minerals' },
    { code: 'AP-1222', name: 'Зелёная умбра',       hex: '#626D3C', collection: 'Minerals' },
    { code: 'AP-0605', name: 'Пудровый шёлк',       hex: '#E2C9C4', collection: 'Terra' },
    { code: 'AP-0712', name: 'Винный погреб',       hex: '#6B3A42', collection: 'Pigments' },
    { code: 'AP-0808', name: 'Медный всадник',      hex: '#A86B4A', collection: 'Terra' },
    { code: 'AP-0230', name: 'Графитовый чертёж',   hex: '#3A3F44', collection: 'Minerals' }
  ];

  var STAGES = [
    'Загружаем фотографию…',
    'Ищем стены на снимке…',
    'Отделяем мебель и пол…',
    'Наносим выбранный оттенок…',
    'Сводим освещение и тени…'
  ];

  var TOPUP_PRESETS = [200, 500, 1000, 2000];
  var DEMO_FREE_PER_DAY = 3;
  var DEMO_PRICE_POINTS = 20;

  function archiAi() {
    var root = document.querySelector('[data-archi-root]');
    if (!root) { return null; }

    /** Все зацепки разом: el('drop'), el('submit') и так далее. */
    function el(name) { return root.querySelector('[data-archi="' + name + '"]'); }
    function all(name) { return Array.prototype.slice.call(root.querySelectorAll('[data-archi="' + name + '"]')); }

    var state = {
      file: null,
      fileUrl: null,
      color: null,
      palette: [],
      busy: false,
      offline: false,          // PHP недоступен — работаем на клиентской имитации
      quota: null,
      result: null,
      timer: null,
      progress: 0,
      resendTimer: null
    };

    /* ============================================================
     *  Загрузка фотографии
     * ============================================================ */

    var drop = el('drop');
    var fileInput = el('file');

    function acceptFile(file) {
      if (!file) { return; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        showError('Поддерживаются JPG, PNG и WebP.');
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        showError('Файл больше 12 МБ. Уменьшите фотографию и попробуйте снова.');
        return;
      }

      hideError();
      if (state.fileUrl) { URL.revokeObjectURL(state.fileUrl); }
      state.file = file;
      state.fileUrl = URL.createObjectURL(file);

      el('previewImg').src = state.fileUrl;
      show(el('preview'));
      hide(drop);
      setText('fileName', file.name + ' · ' + Math.round(file.size / 1024) + ' КБ');
      updateSubmit();
    }

    if (drop) {
      drop.addEventListener('click', function () { fileInput.click(); });
      drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
      });

      ['dragenter', 'dragover'].forEach(function (type) {
        drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (type) {
        drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      drop.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          acceptFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function () { acceptFile(fileInput.files[0]); });
    }

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

    on('reset', 'click', function () {
      if (state.fileUrl) { URL.revokeObjectURL(state.fileUrl); }
      state.file = null;
      state.fileUrl = null;
      fileInput.value = '';
      hide(el('preview'));
      show(drop);
      setText('fileName', '');
      updateSubmit();
    });

    /* Демо-фото: показать сценарий без своего снимка. */
    on('sample', 'click', function () {
      var canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      var ctx = canvas.getContext('2d');

      var wall = ctx.createLinearGradient(0, 0, 1200, 460);
      wall.addColorStop(0, '#D8D3C8');
      wall.addColorStop(1, '#C4BFB4');
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, 1200, 460);

      ctx.fillStyle = '#8A6E4F';           // пол
      ctx.fillRect(0, 460, 1200, 340);
      ctx.fillStyle = '#6E5744';
      for (var x = 0; x < 1200; x += 90) { ctx.fillRect(x, 460, 3, 340); }

      ctx.fillStyle = '#E8E4DA';           // окно
      ctx.fillRect(780, 90, 300, 250);
      ctx.fillStyle = '#F4F1E9';
      ctx.fillRect(795, 105, 270, 220);

      ctx.fillStyle = '#5C6660';           // диван
      ctx.fillRect(130, 300, 460, 200);
      ctx.fillStyle = '#6B756E';
      ctx.fillRect(150, 320, 420, 60);

      ctx.fillStyle = '#3E4A3D';           // растение
      ctx.beginPath();
      ctx.ellipse(680, 400, 46, 90, 0, 0, Math.PI * 2);
      ctx.fill();

      canvas.toBlob(function (blob) {
        acceptFile(new File([blob], 'demo-room.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    });

    /* ============================================================
     *  Палитра
     * ============================================================ */

    function loadPalette() {
      request(API.palette, null, 'GET')
        .then(function (data) {
          state.palette = (data && data.items) || FALLBACK_PALETTE;
          renderSwatches('');
        })
        .catch(function () {
          state.offline = true;
          state.palette = FALLBACK_PALETTE;
          renderSwatches('');
          markOffline();
        });
    }

    function renderSwatches(query) {
      var box = el('swatches');
      if (!box) { return; }

      var needle = (query || '').trim().toLowerCase();
      var items = state.palette.filter(function (color) {
        if (!needle) { return true; }
        return (color.name + ' ' + color.code + ' ' + color.hex + ' ' + color.collection)
          .toLowerCase().indexOf(needle) !== -1;
      });

      box.innerHTML = items.map(function (color) {
        var active = state.color && state.color.code === color.code;
        return '<button type="button" class="archi_ai-swatch' + (active ? ' is-active' : '') + '"' +
          ' data-code="' + color.code + '" title="' + esc(color.name + ' · ' + color.code) + '">' +
          '<span class="archi_ai-swatch__chip" style="background:' + esc(color.hex) + '"></span>' +
          '<span class="archi_ai-swatch__text">' +
            '<b>' + esc(color.name) + '</b>' +
            '<small>' + esc(color.code) + '</small>' +
          '</span>' +
        '</button>';
      }).join('');

      setText('swatchCount', items.length ? items.length + ' из ' + state.palette.length : 'Ничего не нашлось');

      if (!box.dataset.bound) {
        box.dataset.bound = '1';
        box.addEventListener('click', function (e) {
          var button = e.target.closest('[data-code]');
          if (button) { pickColor(button.getAttribute('data-code')); }
        });
      }
    }

    on('search', 'input', function () { renderSwatches(this.value); });

    function pickColor(code) {
      var found = null;
      state.palette.forEach(function (color) { if (color.code === code) { found = color; } });
      if (!found) { return; }

      state.color = found;
      hideError();

      var chip = el('pickedChip');
      if (chip) { chip.style.background = found.hex; }
      setText('pickedName', found.name);
      setText('pickedCode', found.code + ' · ' + found.hex + ' · ArchiPaint ' + found.collection);
      show(el('picked'));

      renderSwatches(el('search') ? el('search').value : '');
      updateSubmit();
    }

    /* ============================================================
     *  Состояние счёта
     * ============================================================ */

    function loadQuota() {
      request(API.quota, null, 'GET')
        .then(function (data) {
          state.quota = data;
          renderQuota();
        })
        .catch(function () {
          state.offline = true;
          markOffline();
          state.quota = {
            authorized: false, freePerDay: DEMO_FREE_PER_DAY, freeLeft: DEMO_FREE_PER_DAY,
            balance: 0, pricePoints: DEMO_PRICE_POINTS, canGenerate: false
          };
          renderQuota();
        });
    }

    function renderQuota() {
      var quota = state.quota;
      if (!quota) { return; }

      var badge = el('quota');
      if (badge) {
        badge.classList.remove('is-low', 'is-out');

        if (!quota.authorized) {
          badge.textContent = quota.freePerDay + ' бесплатные примерки в сутки после входа';
        } else if (quota.freeLeft > 0) {
          badge.textContent = 'Бесплатно сегодня: ' + quota.freeLeft + ' из ' + quota.freePerDay;
          if (quota.freeLeft === 1) { badge.classList.add('is-low'); }
        } else if (quota.canGenerate) {
          badge.textContent = 'Бесплатные кончились · ' + quota.pricePoints + ' ' +
            plural(quota.pricePoints, 'балл', 'балла', 'баллов') + ' за примерку';
          badge.classList.add('is-low');
        } else {
          badge.textContent = 'Не хватает баллов: ' + quota.balance + ' из ' + quota.pricePoints;
          badge.classList.add('is-out');
        }
        show(badge);
      }

      var account = el('accountText');
      if (account) {
        account.textContent = quota.authorized
          ? quota.phone + ' · ' + quota.balance + ' ' + plural(quota.balance, 'балл', 'балла', 'баллов')
          : 'Вы не вошли';
      }

      var accountBtn = el('accountBtn');
      if (accountBtn) {
        accountBtn.textContent = quota.authorized ? 'Выйти' : 'Войти по телефону';
        accountBtn.onclick = quota.authorized
          ? function () { request(API.logout, {}).then(loadQuota).catch(loadQuota); }
          : openAuth;
      }

      renderTopUp(quota);
      renderBalanceCard(quota);
      updateSubmit();
    }

    function renderBalanceCard(quota) {
      setText('balanceValue', quota.authorized
        ? quota.balance + ' ' + plural(quota.balance, 'балл', 'балла', 'баллов')
        : '—');
      setText('balanceNote', quota.authorized
        ? (quota.freeLeft > 0
            ? 'Сегодня бесплатных примерок: ' + quota.freeLeft + ' из ' + quota.freePerDay
            : 'Следующая примерка спишет ' + quota.pricePoints + ' ' +
              plural(quota.pricePoints, 'балл', 'балла', 'баллов'))
        : 'Войдите, чтобы увидеть баланс');
    }

    function renderTopUp(quota) {
      var box = el('topup');
      if (!box) { return; }

      if (!quota.authorized || quota.canGenerate) {
        hide(box);
        return;
      }
      show(box);

      setText('topupText', 'Бесплатные примерки на сегодня закончились, а на счету ' + quota.balance +
        ' из ' + quota.pricePoints + ' баллов. Пополните баланс — 1 ₽ даёт 1 балл.');

      var buttons = el('topupButtons');
      if (buttons && !buttons.dataset.bound) {
        buttons.dataset.bound = '1';
        buttons.innerHTML = TOPUP_PRESETS.map(function (sum) {
          return '<button type="button" class="archi_ai-chip" data-topup="' + sum + '">' + sum + ' ₽</button>';
        }).join('');

        buttons.addEventListener('click', function (e) {
          var button = e.target.closest('[data-topup]');
          if (!button) { return; }
          button.disabled = true;

          request(API.topUp, { amount: button.getAttribute('data-topup') })
            .then(function (data) {
              if (data.confirmationUrl) { global.location.href = '../api/' + data.confirmationUrl; }
            })
            .catch(function (error) {
              button.disabled = false;
              showError(error.message);
            });
        });
      }
    }

    /* ============================================================
     *  Вход по телефону
     * ============================================================ */

    function openAuth() {
      var modal = el('authModal');
      if (!modal) { return; }
      modal.classList.add('is-open');
      document.body.classList.add('archi_ai-locked');
      showAuthStep('phone');
      setTimeout(function () { el('authPhone').focus(); }, 80);
    }

    function closeAuth() {
      var modal = el('authModal');
      if (!modal) { return; }
      modal.classList.remove('is-open');
      document.body.classList.remove('archi_ai-locked');
      clearInterval(state.resendTimer);
    }

    function showAuthStep(name) {
      ['phone', 'code'].forEach(function (step) {
        var node = el('authStep' + step.charAt(0).toUpperCase() + step.slice(1));
        if (node) { node.hidden = step !== name; }
      });
      hide(el('authError'));
    }

    function authError(message) {
      var node = el('authError');
      if (!node) { return; }
      node.textContent = message;
      show(node);
    }

    on('authClose', 'click', closeAuth);
    on('authModal', 'click', function (e) { if (e.target === this) { closeAuth(); } });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeAuth(); }
    });

    on('authSubmit', 'click', submitPhone);
    on('authVerify', 'click', submitCode);
    on('authResend', 'click', function () { if (!this.disabled) { submitPhone(); } });

    on('authPhone', 'keydown', function (e) { if (e.key === 'Enter') { submitPhone(); } });
    on('authCode', 'keydown', function (e) { if (e.key === 'Enter') { submitCode(); } });

    function submitPhone() {
      var phone = el('authPhone').value.trim();
      if (phone.replace(/\D/g, '').length < 10) {
        authError('Проверьте номер телефона.');
        return;
      }

      var button = el('authSubmit');
      button.disabled = true;
      button.classList.add('is-busy');

      request(API.requestCode, { phone: phone })
        .then(function (data) {
          button.disabled = false;
          button.classList.remove('is-busy');
          setText('authSent', 'Код отправлен на ' + data.phone + '.');
          showAuthStep('code');

          // Заглушка возвращает код — подставляем, чтобы демо шло без SMS
          if (data.demoCode) { el('authCode').value = data.demoCode; }
          setTimeout(function () { el('authCode').focus(); }, 80);
          startResend(data.resendAfter || 60);
        })
        .catch(function (error) {
          button.disabled = false;
          button.classList.remove('is-busy');
          if (state.offline) {
            // PHP нет — пускаем в демо без проверки, иначе показывать нечего
            setText('authSent', 'Демо без сервера: подойдёт любой код.');
            showAuthStep('code');
            el('authCode').value = '1234';
            return;
          }
          authError(error.message);
        });
    }

    function submitCode() {
      var button = el('authVerify');
      button.disabled = true;
      button.classList.add('is-busy');

      var done = function () {
        button.disabled = false;
        button.classList.remove('is-busy');
        closeAuth();
        toast('Вы вошли. Три примерки в сутки — бесплатно.');
      };

      request(API.verify, { phone: el('authPhone').value.trim(), code: el('authCode').value.trim() })
        .then(function (data) {
          state.quota = data.quota;
          renderQuota();
          done();
        })
        .catch(function (error) {
          button.disabled = false;
          button.classList.remove('is-busy');

          if (state.offline) {
            state.quota = {
              authorized: true, phone: '+7999***4567', freePerDay: DEMO_FREE_PER_DAY,
              freeLeft: DEMO_FREE_PER_DAY, balance: 0, pricePoints: DEMO_PRICE_POINTS, canGenerate: true
            };
            renderQuota();
            done();
            return;
          }
          authError(error.message);
        });
    }

    function startResend(seconds) {
      var button = el('authResend');
      if (!button) { return; }
      var left = seconds;
      clearInterval(state.resendTimer);

      function tick() {
        if (left <= 0) {
          button.disabled = false;
          button.textContent = 'Отправить код ещё раз';
          clearInterval(state.resendTimer);
          return;
        }
        button.disabled = true;
        button.textContent = 'Отправить код ещё раз через ' + left + ' с';
        left--;
      }

      tick();
      state.resendTimer = setInterval(tick, 1000);
    }

    /* ============================================================
     *  Примерка
     * ============================================================ */

    function updateSubmit() {
      var button = el('submit');
      if (!button) { return; }

      var ready = !!state.file && !!state.color && !state.busy;
      if (state.quota && state.quota.authorized && !state.quota.canGenerate) {
        ready = false;
      }
      button.disabled = !ready;
    }

    on('submit', 'click', generate);
    on('again', 'click', function () { generate(); });
    on('newPhoto', 'click', function () {
      var reset = el('reset');
      if (reset) { reset.click(); }
      stage('form');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    function generate() {
      if (state.busy || !state.file || !state.color) { return; }

      if (state.quota && !state.quota.authorized) {
        openAuth();
        return;
      }

      state.busy = true;
      updateSubmit();
      hideError();
      stage('progress');
      startProgress();

      var body = new FormData();
      body.append('image', state.file);
      body.append('code', state.color.code);

      request(API.generate, body)
        .then(function (data) {
          finishProgress();
          setTimeout(function () { showResult(data); }, 350);
        })
        .catch(function (error) {
          if (state.offline) {
            // Без PHP рисуем перекраску на canvas — сценарий остаётся целым
            imitateOnCanvas().then(function (data) {
              finishProgress();
              setTimeout(function () { showResult(data); }, 350);
            });
            return;
          }

          stopProgress();
          state.busy = false;
          stage('form');
          updateSubmit();
          showError(error.message);
          if (error.code === 'auth_required') { openAuth(); }
          if (error.code === 'not_enough_points') { loadQuota(); }
        });
    }

    function startProgress() {
      state.progress = 0;
      var bar = el('progressBar');
      if (bar) { bar.style.width = '0%'; }
      setText('progressText', STAGES[0]);

      var index = 0;
      stopProgress();
      state.timer = setInterval(function () {
        index = (index + 1) % STAGES.length;
        setText('progressText', STAGES[index]);
        state.progress = Math.min(92, state.progress + 11 + Math.random() * 9);
        if (bar) { bar.style.width = state.progress + '%'; }
      }, 700);
    }

    function stopProgress() {
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    function finishProgress() {
      stopProgress();
      var bar = el('progressBar');
      if (bar) { bar.style.width = '100%'; }
    }

    function showResult(data) {
      state.busy = false;
      state.result = data;
      stage('result');

      el('before').src = state.fileUrl;
      el('after').src = data.image;

      var download = el('download');
      if (download) {
        download.href = data.image;
        download.setAttribute('download', 'archipaint-' + (data.jobId || 'demo') + '.jpg');
      }

      setText('resultNote', 'Перекрашены только стены · ' +
        (data.charged === 'points'
          ? 'списано ' + data.chargedPoints + ' ' + plural(data.chargedPoints, 'балл', 'балла', 'баллов')
          : 'бесплатная примерка'));

      var range = el('range');
      if (range) { range.value = 50; }
      setSplit(50);

      if (data.quota) {
        state.quota = data.quota;
        renderQuota();
      }

      renderWall(data.wall);
      updateSubmit();

      var result = el('stageResult');
      if (result) { result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }

    on('range', 'input', function () { setSplit(this.value); });

    function setSplit(value) {
      var compare = el('compare');
      if (compare) { compare.style.setProperty('--archi_ai-split', value + '%'); }
    }

    function renderWall(wall) {
      if (!wall) { return; }

      var requested = wall.requested || {};
      var rendered = wall.rendered || {};

      var verdict = el('verdict');
      if (verdict) {
        verdict.innerHTML =
          '<div class="archi_ai-verdict__pair">' +
            '<span class="archi_ai-verdict__side" style="background:' + esc(requested.hex) +
              ';color:' + esc(requested.textOn) + '">' +
              '<small>Выбрано в палитре</small>' +
              '<b>' + esc(requested.name) + '</b>' +
              '<span>' + esc(requested.code) + ' · ' + esc(requested.hex) + '</span>' +
            '</span>' +
            '<span class="archi_ai-verdict__arrow" aria-hidden="true">→</span>' +
            '<span class="archi_ai-verdict__side" style="background:' + esc(rendered.hex) +
              ';color:' + esc(rendered.textOn) + '">' +
              '<small>Как легло на стену</small>' +
              '<b>' + esc(rendered.hex) + '</b>' +
              '<span>LRV ' + rendered.lrv + '</span>' +
            '</span>' +
          '</div>' +
          '<p class="archi_ai-verdict__note">Расхождение выкраса и фотографии — <b>ΔE ' +
            Number(wall.deltaE).toFixed(2) + '</b> (' + esc(wall.quality) + '). ' +
            'Разницу создаёт освещение комнаты: на снимке краска всегда читается чуть иначе, ' +
            'чем в каталоге.</p>';
      }

      setText('coverage', 'Краска заняла ' + wall.coverage.changedPct + '% кадра');

      var tones = el('tones');
      if (!tones) { return; }

      tones.innerHTML = (wall.colors || []).map(function (tone, index) {
        var matches = (tone.matches || []).map(function (match) {
          return '<button type="button" class="archi_ai-match" data-match="' + esc(match.code) + '">' +
            '<span class="archi_ai-match__chip" style="background:' + esc(match.hex) + '"></span>' +
            '<span class="archi_ai-match__text">' +
              '<b>' + esc(match.name) + '</b>' +
              '<small>' + esc(match.code) + ' · ' + esc(match.collection) + '</small>' +
            '</span>' +
            '<span class="archi_ai-delta is-' + esc(match.qualityCls) + '" title="' + esc(match.quality) + '">ΔE ' +
              Number(match.deltaE).toFixed(2) + '</span>' +
          '</button>';
        }).join('');

        return '<article class="archi_ai-tone" style="animation-delay:' + (index * 80) + 'ms">' +
          '<div class="archi_ai-tone__swatch" style="background:' + esc(tone.hex) +
            ';color:' + esc(tone.textOn) + '">' +
            '<b>' + esc(tone.hex) + '</b><span>' + tone.sharePct + '%</span>' +
          '</div>' +
          '<div class="archi_ai-tone__meta">' +
            '<b>' + esc(tone.role) + '</b>' +
            '<small>LRV ' + tone.lrv + '</small>' +
            '<span class="archi_ai-bar"><i style="width:' + Math.max(6, tone.sharePct) + '%"></i></span>' +
          '</div>' +
          '<div class="archi_ai-tone__matches">' + matches + '</div>' +
        '</article>';
      }).join('');

      if (!tones.dataset.bound) {
        tones.dataset.bound = '1';
        tones.addEventListener('click', function (e) {
          var button = e.target.closest('[data-match]');
          if (button) { toast(button.getAttribute('data-match') + ' — добавлено в список к заказу'); }
        });
      }
    }

    /**
     * Клиентская имитация перекраски — работает без PHP.
     * Та же логика, что в api/generate.php: тонируем верх кадра.
     */
    function imitateOnCanvas() {
      return new Promise(function (resolve) {
        var image = new Image();
        image.onload = function () {
          var scale = Math.min(1, 1100 / Math.max(image.naturalWidth, image.naturalHeight));
          var width = Math.round(image.naturalWidth * scale);
          var height = Math.round(image.naturalHeight * scale);

          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0, width, height);

          var wallBottom = Math.round(height * 0.58);
          var frame = ctx.getImageData(0, 0, width, wallBottom);
          var data = frame.data;
          var target = hexToRgb(state.color.hex);

          for (var i = 0; i < data.length; i += 4) {
            var y = Math.floor((i / 4) / width);
            var fade = 1 - Math.pow(y / wallBottom, 3) * 0.35;
            var luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            if (luma < 0.22) { continue; }

            var mix = Math.min(0.92, luma * 1.05) * fade;
            var shade = 0.72 + luma * 0.38;

            data[i]     = data[i]     * (1 - mix) + target[0] * shade * mix;
            data[i + 1] = data[i + 1] * (1 - mix) + target[1] * shade * mix;
            data[i + 2] = data[i + 2] * (1 - mix) + target[2] * shade * mix;
          }
          ctx.putImageData(frame, 0, 0);

          var picked = state.color;
          var index = 0;
          state.palette.forEach(function (color, i) { if (color.code === picked.code) { index = i; } });

          var deltas = [0.84, 2.41, 3.96];
          var matches = [0, 1, 2].map(function (n) {
            var item = state.palette[(index + n) % state.palette.length];
            var delta = deltas[n];
            return {
              code: item.code, name: item.name, hex: item.hex,
              collection: 'ArchiPaint ' + item.collection, deltaE: delta,
              quality: delta <= 1.5 ? 'Точное совпадение' : (delta <= 3.5 ? 'Заметно при сравнении' : 'Заметная разница'),
              qualityCls: delta <= 1.5 ? 'good' : (delta <= 3.5 ? 'mid' : 'poor')
            };
          });

          var tones = [
            { hex: picked.hex, role: 'Основной тон стены', sharePct: 62.4, lrv: 71.2 },
            { hex: shift(picked.hex, 16), role: 'Стена на свету', sharePct: 24.8, lrv: 78.5 },
            { hex: shift(picked.hex, -22), role: 'Стена в тени', sharePct: 12.8, lrv: 58.1 }
          ].map(function (tone) {
            tone.matches = matches;
            tone.textOn = readable(tone.hex);
            return tone;
          });

          var free = state.quota && state.quota.freeLeft > 0;
          if (state.quota) {
            state.quota.freeLeft = Math.max(0, state.quota.freeLeft - 1);
            state.quota.canGenerate = state.quota.freeLeft > 0 || state.quota.balance >= DEMO_PRICE_POINTS;
          }

          resolve({
            ok: true, demo: true, jobId: 'offline-' + Date.now(),
            image: canvas.toDataURL('image/jpeg', 0.9),
            charged: free ? 'free' : 'points',
            chargedPoints: free ? 0 : DEMO_PRICE_POINTS,
            quota: state.quota,
            wall: {
              requested: {
                code: picked.code, name: picked.name, hex: picked.hex,
                collection: 'ArchiPaint ' + picked.collection, lrv: 71.2, textOn: readable(picked.hex)
              },
              rendered: { hex: shift(picked.hex, 6), lrv: 73.4, textOn: readable(shift(picked.hex, 6)) },
              deltaE: 1.37, quality: 'Точное совпадение', qualityCls: 'good',
              coverage: { changedPct: 34.6 },
              colors: tones
            }
          });
        };
        image.src = state.fileUrl;
      });
    }

    /* ============================================================
     *  Мелочи
     * ============================================================ */

    /** Переключает крупные блоки: форма → прогресс → результат. */
    function stage(name) {
      ['form', 'progress', 'result'].forEach(function (item) {
        var node = el('stage' + item.charAt(0).toUpperCase() + item.slice(1));
        if (node) { node.hidden = item !== name; }
      });
    }

    function markOffline() {
      var badge = el('offline');
      if (badge) { show(badge); }
    }

    function showError(message) {
      var box = el('error');
      if (!box) { return; }
      box.textContent = message;
      show(box);
    }

    function hideError() { hide(el('error')); }

    var toastTimer = null;
    function toast(message) {
      var node = el('toast');
      if (!node) { return; }
      node.textContent = message;
      node.classList.add('is-open');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { node.classList.remove('is-open'); }, 2800);
    }

    function on(name, event, handler) {
      all(name).forEach(function (node) { node.addEventListener(event, handler); });
    }

    function setText(name, text) {
      all(name).forEach(function (node) { node.textContent = text; });
    }

    function show(node) { if (node) { node.hidden = false; } }
    function hide(node) { if (node) { node.hidden = true; } }

    /* ---------- запуск ---------- */

    stage('form');
    loadPalette();
    loadQuota();
    updateSubmit();

    return { state: state, pickColor: pickColor, generate: generate, openAuth: openAuth };
  }

  /* ============================================================
   *  Утилиты
   * ============================================================ */

  function request(url, body, method) {
    var options = { credentials: 'same-origin' };

    if (method === 'GET' || body === null) {
      options.method = 'GET';
    } else {
      options.method = 'POST';
      if (body instanceof FormData) {
        options.body = body;
      } else {
        var form = new FormData();
        Object.keys(body).forEach(function (key) { form.append(key, body[key]); });
        options.body = form;
      }
    }

    return fetch(url, options)
      .then(function (res) {
        return res.text().then(function (text) {
          var data;
          try { data = JSON.parse(text); } catch (e) { throw new Error('no-backend'); }
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (!result.data || result.data.ok !== true) {
          var info = (result.data && result.data.error) || {};
          var error = new Error(info.message || 'Что-то пошло не так. Попробуйте ещё раз.');
          error.code = info.code || 'unknown';
          throw error;
        }
        return result.data;
      });
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  function shift(hex, amount) {
    var rgb = hexToRgb(hex).map(function (value) {
      return Math.max(0, Math.min(255, value + amount));
    });
    return '#' + rgb.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('').toUpperCase();
  }

  function readable(hex) {
    var rgb = hexToRgb(hex);
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) > 150 ? '#1A1D19' : '#FFFFFF';
  }

  function plural(count, one, few, many) {
    var n = Math.abs(count) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) { return many; }
    if (n1 > 1 && n1 < 5) { return few; }
    return n1 === 1 ? one : many;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', archiAi);
  } else {
    archiAi();
  }

  global.archiAi = archiAi;
})(typeof window !== 'undefined' ? window : globalThis);
