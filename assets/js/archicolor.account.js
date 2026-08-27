/*!
 * ArchiPaint · archicolor.account.js
 * Вход по номеру телефона, баланс баллов и пополнение.
 *
 * Общий модуль для страницы визуализатора и личного кабинета: окно входа,
 * состояние счёта и пополнение через ЮKassa живут в одном месте.
 *
 * Кода из SMS здесь нет и быть не может — он проверяется на сервере,
 * браузер только передаёт то, что ввёл человек.
 *
 * Использование:
 *   var account = archicolorAccount({ onChange: function (state) { … } });
 *   account.load();                       // подтянуть состояние
 *   account.requireLogin(function () {}); // открыть окно входа
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    meUrl: '/api/archicolor/me',
    requestCodeUrl: '/api/archicolor/auth/request-code',
    verifyUrl: '/api/archicolor/auth/verify',
    logoutUrl: '/api/archicolor/auth/logout',
    topUpUrl: '/api/archicolor/balance/topup',
    /** Готовые суммы пополнения, ₽. Курс: 1 ₽ = 1 балл. */
    topUpPresets: [200, 500, 1000, 2000],
    onChange: null
  };

  function archicolorAccount(userOptions) {
    var opts = merge(DEFAULTS, userOptions || {});
    var state = { loaded: false, authorized: false, user: null, quota: null, balance: 0, history: [] };
    var listeners = opts.onChange ? [opts.onChange] : [];
    var pendingAction = null;
    var modal = null;
    var resendTimer = null;

    /* ========================= состояние ========================= */

    function load() {
      return fetch(opts.meUrl, { credentials: 'same-origin' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.ok) { throw new Error('me-failed'); }
          state.loaded = true;
          state.authorized = !!data.authorized;
          state.user = data.user || null;
          state.quota = data.quota || null;
          state.balance = typeof data.balance === 'number' ? data.balance : 0;
          state.history = data.history || [];
          state.total = data.total || 0;
          emit();
          return state;
        })
        .catch(function () {
          state.loaded = true;
          emit();
          return state;
        });
    }

    function emit() {
      listeners.forEach(function (fn) {
        try { fn(state); } catch (e) { /* один сломанный слушатель не должен ронять остальные */ }
      });
    }

    function onChange(fn) { listeners.push(fn); }

    /* ========================= вход ========================= */

    /** Открывает окно входа; колбэк вызывается после успешной авторизации. */
    function requireLogin(onSuccess) {
      if (state.authorized) {
        if (onSuccess) { onSuccess(state); }
        return;
      }
      pendingAction = onSuccess || null;
      openModal();
    }

    function ensureModal() {
      if (modal) { return modal; }

      var back = document.createElement('div');
      back.className = 'ac-auth-back';
      back.innerHTML =
        '<div class="ac-auth" role="dialog" aria-modal="true" aria-label="Вход по номеру телефона">' +
          '<button class="ac-auth-x" type="button" aria-label="Закрыть">✕</button>' +
          '<div class="ac-auth-step" data-step="phone">' +
            '<h3>Вход по номеру телефона</h3>' +
            '<p>Пришлём код в SMS. Пароль придумывать не нужно.</p>' +
            '<label class="ac-visually-hidden" for="acAuthPhone">Номер телефона</label>' +
            '<input class="ac-auth-input" id="acAuthPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (999) 123-45-67">' +
            '<p class="ac-auth-error" hidden></p>' +
            '<button class="ac-btn ac-btn--accent ac-auth-submit" type="button">Получить код</button>' +
            '<p class="ac-auth-fine">Нажимая кнопку, вы соглашаетесь с обработкой персональных данных.</p>' +
          '</div>' +
          '<div class="ac-auth-step" data-step="code" hidden>' +
            '<h3>Введите код из SMS</h3>' +
            '<p class="ac-auth-sent"></p>' +
            '<label class="ac-visually-hidden" for="acAuthCode">Код из SMS</label>' +
            '<input class="ac-auth-input ac-auth-input--code" id="acAuthCode" type="text" inputmode="numeric" ' +
              'autocomplete="one-time-code" maxlength="8" placeholder="0000">' +
            '<p class="ac-auth-error" hidden></p>' +
            '<button class="ac-btn ac-btn--accent ac-auth-verify" type="button">Войти</button>' +
            '<button class="ac-auth-resend" type="button">Отправить код ещё раз</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(back);
      modal = back;

      back.querySelector('.ac-auth-x').addEventListener('click', closeModal);
      back.addEventListener('click', function (e) { if (e.target === back) { closeModal(); } });
      back.querySelector('.ac-auth-submit').addEventListener('click', submitPhone);
      back.querySelector('.ac-auth-verify').addEventListener('click', submitCode);
      back.querySelector('.ac-auth-resend').addEventListener('click', function () {
        if (!this.disabled) { submitPhone(); }
      });

      back.querySelector('#acAuthPhone').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { submitPhone(); }
      });
      back.querySelector('#acAuthCode').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { submitCode(); }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.classList.contains('is-open')) { closeModal(); }
      });

      return modal;
    }

    function openModal() {
      ensureModal();
      showStep('phone');
      modal.classList.add('is-open');
      setTimeout(function () { modal.querySelector('#acAuthPhone').focus(); }, 60);
    }

    function closeModal() {
      if (!modal) { return; }
      modal.classList.remove('is-open');
      clearInterval(resendTimer);
    }

    function showStep(name) {
      Array.prototype.forEach.call(modal.querySelectorAll('.ac-auth-step'), function (step) {
        step.hidden = step.getAttribute('data-step') !== name;
      });
      Array.prototype.forEach.call(modal.querySelectorAll('.ac-auth-error'), function (node) {
        node.hidden = true;
      });
    }

    function stepError(step, message) {
      var node = modal.querySelector('[data-step="' + step + '"] .ac-auth-error');
      node.textContent = message;
      node.hidden = false;
    }

    function submitPhone() {
      var input = modal.querySelector('#acAuthPhone');
      var phone = input.value.trim();
      if (phone.replace(/\D/g, '').length < 10) {
        stepError('phone', 'Проверьте номер телефона.');
        return;
      }

      var button = modal.querySelector('.ac-auth-submit');
      button.disabled = true;

      post(opts.requestCodeUrl, { phone: phone })
        .then(function (data) {
          button.disabled = false;
          modal.querySelector('.ac-auth-sent').textContent = 'Код отправлен на ' + data.phone + '.';
          showStep('code');
          startResendTimer(data.resendAfter || 60);

          // На стенде бэкенд возвращает код — подставляем, чтобы не искать в логах.
          if (data.devCode) { modal.querySelector('#acAuthCode').value = data.devCode; }
          setTimeout(function () { modal.querySelector('#acAuthCode').focus(); }, 60);
        })
        .catch(function (error) {
          button.disabled = false;
          stepError('phone', error.message);
        });
    }

    function submitCode() {
      var phone = modal.querySelector('#acAuthPhone').value.trim();
      var code = modal.querySelector('#acAuthCode').value.trim();
      if (!code) {
        stepError('code', 'Введите код из SMS.');
        return;
      }

      var button = modal.querySelector('.ac-auth-verify');
      button.disabled = true;

      post(opts.verifyUrl, { phone: phone, code: code })
        .then(function () {
          button.disabled = false;
          closeModal();
          return load();
        })
        .then(function () {
          var action = pendingAction;
          pendingAction = null;
          if (action) { action(state); }
        })
        .catch(function (error) {
          button.disabled = false;
          stepError('code', error.message);
          if (error.code === 'code_expired' || error.code === 'code_attempts') {
            showStep('phone');
            stepError('phone', error.message);
          }
        });
    }

    function startResendTimer(seconds) {
      var button = modal.querySelector('.ac-auth-resend');
      var left = seconds;
      clearInterval(resendTimer);

      function tick() {
        if (left <= 0) {
          button.disabled = false;
          button.textContent = 'Отправить код ещё раз';
          clearInterval(resendTimer);
          return;
        }
        button.disabled = true;
        button.textContent = 'Отправить код ещё раз через ' + left + ' с';
        left--;
      }

      tick();
      resendTimer = setInterval(tick, 1000);
    }

    function logout() {
      return post(opts.logoutUrl, {}).then(load);
    }

    /* ========================= пополнение ========================= */

    /**
     * Создаёт платёж и уводит на страницу оплаты.
     * Баллы начисляет вебхук после оплаты, а не этот вызов.
     */
    function topUp(amountRub) {
      return post(opts.topUpUrl, { amount: amountRub }).then(function (data) {
        if (data.confirmationUrl) {
          global.location.href = data.confirmationUrl;
        }
        return data;
      });
    }

    /* ========================= утилиты ========================= */

    function post(url, fields) {
      var body = new FormData();
      Object.keys(fields).forEach(function (key) { body.append(key, fields[key]); });

      return fetch(url, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (res) {
          return res.json().then(function (data) { return { status: res.status, data: data }; });
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

    function merge(base, extra) {
      var out = {};
      var key;
      for (key in base) { if (Object.prototype.hasOwnProperty.call(base, key)) { out[key] = base[key]; } }
      for (key in extra) { if (Object.prototype.hasOwnProperty.call(extra, key)) { out[key] = extra[key]; } }
      return out;
    }

    return {
      state: state,
      load: load,
      onChange: onChange,
      requireLogin: requireLogin,
      openLogin: openModal,
      logout: logout,
      topUp: topUp,
      presets: opts.topUpPresets
    };
  }

  global.archicolorAccount = archicolorAccount;
  if (typeof module !== 'undefined' && module.exports) { module.exports = archicolorAccount; }
})(typeof window !== 'undefined' ? window : globalThis);
