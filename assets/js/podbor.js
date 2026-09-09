/*!
 * ArchiPaint · podbor.js
 * Интерфейс сервиса подбора краски.
 *
 * Точка входа — глобальная функция podbor(). Она идемпотентна: повторный
 * вызов не создаёт дублирующих обработчиков. Любой блок разметки
 * необязателен — если секции нет на странице, соответствующий модуль
 * молча пропускается. Это позволяет разложить инструмент по разным
 * страницам Bitrix без правки скрипта.
 *
 * Зависит от: podbor.color.js, podbor.palette.js, podbor.data.js
 * Опционально: podbor.standards.js
 */
(function (global) {
  'use strict';

  var C = global.ArchiPaintColor;
  var D = global.ArchiPaintData;
  if (!C || !D) {
    if (global.console) console.error('podbor.js: не подключены podbor.color.js / podbor.data.js');
    return;
  }

  var initialized = false;

  /* ============================================================
   *  Состояние
   * ============================================================ */

  var S = {
    image: null,          // { img, canvas, ctx, width, height, name }
    slots: [],            // 4 доминирующих + 1 снятый пипеткой
    pickedSlot: null,
    activeHex: null,      // цвет, вокруг которого строятся гармонии и палитры
    activeSource: null,   // откуда он взялся: 'photo' | 'catalog' | 'coords' | 'standard'
    activeLabel: null,

    formula: 'de2000',
    collections: [],      // пустой массив = искать по всем коллекциям
    cvd: 'normal',

    scheme: 'analogous',
    mood: 'soft_light',
    baseRole: 'auto',

    compare: [],
    picking: false,
    lastPalettes: null,
    cardColor: null
  };

  var SLOT_COUNT = 4;

  /* ============================================================
   *  Мелкие утилиты
   * ============================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  /** Создание элемента: el('div', {class:'x', onclick:fn}, [child|string]) */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else node.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(children) ? children : children == null ? [] : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /**
   * Событие наружу: страница Bitrix может его перехватить и увести
   * пользователя в свою корзину. Возвращает true, если никто не перехватил.
   */
  function dispatchToolEvent(name, detail) {
    var event;
    try {
      event = new CustomEvent(name, { detail: detail, cancelable: true, bubbles: true });
    } catch (e) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent(name, true, true, detail);
    }
    return document.dispatchEvent(event);
  }

  function svgIcon(paths, opts) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', (opts && opts.viewBox) || '0 0 24 24');
    svg.setAttribute('fill', (opts && opts.fill) || 'none');
    svg.setAttribute('stroke', (opts && opts.stroke) || 'currentColor');
    svg.setAttribute('stroke-width', (opts && opts.width) || '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (Array.isArray(paths) ? paths : [paths]).forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function fmt(n, digits) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits == null ? 2 : digits).replace('.', ',');
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* ============================================================
   *  Уведомления
   * ============================================================ */

  var toastTimer = null;

  function toast(message) {
    var node = byId('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-visible'); }, 2600);
  }

  function copyText(text, successMessage) {
    var done = function () { toast(successMessage || ('Скопировано: ' + text)); };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();

    function fallback() {
      try {
        var ta = el('textarea', { style: { position: 'fixed', opacity: '0', pointerEvents: 'none' } });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        toast('Не удалось скопировать');
      }
    }
  }

  /* ============================================================
   *  Модальные окна
   * ============================================================ */

  var modalStack = [];

  function openModal(backdrop) {
    if (!backdrop) return;
    backdrop.classList.add('is-open');
    modalStack.push({ node: backdrop, restoreFocus: document.activeElement });
    document.body.style.overflow = 'hidden';
    var focusable = backdrop.querySelector('input, button, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);
  }

  function closeModal(backdrop) {
    var entry = null;
    for (var i = modalStack.length - 1; i >= 0; i--) {
      if (!backdrop || modalStack[i].node === backdrop) { entry = modalStack.splice(i, 1)[0]; break; }
    }
    if (!entry) return;
    entry.node.classList.remove('is-open');
    if (!modalStack.length) document.body.style.overflow = '';
    if (entry.restoreFocus && entry.restoreFocus.focus) entry.restoreFocus.focus();
  }

  function closeTopModal() {
    if (modalStack.length) closeModal(modalStack[modalStack.length - 1].node);
  }

  function wireModal(backdropId, closeSelectors) {
    var back = byId(backdropId);
    if (!back) return null;
    // клик по подложке закрывает окно, клик внутри — нет
    back.addEventListener('mousedown', function (e) { if (e.target === back) closeModal(back); });
    (closeSelectors || []).forEach(function (sel) {
      var btn = typeof sel === 'string' ? byId(sel) : sel;
      if (btn) btn.addEventListener('click', function () { closeModal(back); });
    });
    return back;
  }

  /* ============================================================
   *  Загрузка изображения
   * ============================================================ */

  var MAX_ANALYSIS_SIDE = 620;   // больше не нужно: k-means и так сходится
  var MAX_FILE_BYTES = 20 * 1024 * 1024;

  function initUpload() {
    var drop = byId('drop');
    var input = byId('fileInput');
    if (!drop || !input) return;

    // blob-ссылку нельзя отзывать сразу после вставки <img> в DOM:
    // браузер ещё не успел её прочитать и картинка не показывается.
    // Держим её до замены или сброса изображения.
    var objectUrl = null;
    function releaseObjectUrl() {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    }

    var dropSection = byId('dropSection');
    var previewSection = byId('previewSection');
    var holder = byId('pvHolder');
    var note = byId('fileNameNote');

    byId('btnPick') && byId('btnPick').addEventListener('click', function (e) {
      e.stopPropagation();
      input.click();
    });
    byId('btnDemo') && byId('btnDemo').addEventListener('click', function (e) {
      e.stopPropagation();
      loadDemoScene();
    });
    byId('btnReplace') && byId('btnReplace').addEventListener('click', function () { input.click(); });
    byId('btnReset') && byId('btnReset').addEventListener('click', resetImage);
    byId('btnPicker') && byId('btnPicker').addEventListener('click', togglePicker);

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-dragover'); });
    });
    drop.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
      input.value = '';
    });

    // вставка из буфера — самый быстрый путь для скриншота из мессенджера
    document.addEventListener('paste', function (e) {
      if (modalStack.length) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          var file = items[i].getAsFile();
          if (file) { handleFile(file); e.preventDefault(); }
          return;
        }
      }
    });

    function handleFile(file) {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        toast('Нужен файл изображения: JPG, PNG или WEBP');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast('Файл больше 20 МБ — уменьшите изображение');
        return;
      }
      releaseObjectUrl();
      objectUrl = URL.createObjectURL(file);
      loadImage(objectUrl, file.name, releaseObjectUrl);
    }

    function loadImage(src, name, onFail) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) {
          toast('Не удалось прочитать изображение');
          if (onFail) onFail();
          return;
        }
        setImage(img, name);
      };
      img.onerror = function () {
        toast('Не удалось загрузить изображение');
        if (onFail) onFail();
      };
      img.src = src;
    }

    function setImage(img, name) {
      // уменьшенная копия: анализировать 12 Мп бессмысленно и медленно
      var scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));

      var canvas = el('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      S.image = { img: img, canvas: canvas, ctx: ctx, width: w, height: h, name: name || '' };
      S.pickedSlot = null;
      S.picking = false;

      clear(holder);
      img.alt = 'Загруженное изображение';
      holder.appendChild(img);

      if (dropSection) dropSection.hidden = true;
      if (previewSection) previewSection.hidden = false;
      var ws = byId('workspace');
      if (ws) ws.classList.add('has-image');
      if (note) note.textContent = name ? 'Файл: ' + name + ' · ' + img.naturalWidth + '×' + img.naturalHeight + ' px' : '';

      var wrap = byId('previewWrap');
      if (wrap) wrap.classList.remove('is-picking');
      var dot = byId('pickDot');
      if (dot) dot.hidden = true;
      hideLoupe();

      analyzeImage();
    }

    function resetImage() {
      releaseObjectUrl();
      S.image = null;
      S.slots = [];
      S.pickedSlot = null;
      S.picking = false;
      S.activeHex = null;
      S.activeSource = null;
      clear(holder);
      if (dropSection) dropSection.hidden = false;
      if (previewSection) previewSection.hidden = true;
      var wsOff = byId('workspace');
      if (wsOff) wsOff.classList.remove('has-image');
      if (note) note.textContent = '';
      renderResults();
      renderHarmony();
      renderInteriorSection();
      updateUrlState();
    }

    /**
     * Демо-сцена рисуется на canvas, а не грузится с сервера:
     * инструмент должен работать даже без картинок в проекте.
     */
    function loadDemoScene() {
      var w = 900, h = 620;
      var cv = el('canvas');
      cv.width = w; cv.height = h;
      var g = cv.getContext('2d');

      var sky = g.createLinearGradient(0, 0, 0, h * 0.55);
      sky.addColorStop(0, '#C9D6DE');
      sky.addColorStop(1, '#EBE4D6');
      g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.62);

      g.fillStyle = '#8FAE86'; g.fillRect(0, h * 0.62, w, h * 0.38);
      g.fillStyle = '#5C6B4F';
      g.beginPath(); g.moveTo(0, h * 0.72); g.lineTo(w * 0.35, h * 0.64);
      g.lineTo(w * 0.7, h * 0.75); g.lineTo(w, h * 0.66); g.lineTo(w, h); g.lineTo(0, h);
      g.closePath(); g.fill();

      g.fillStyle = '#B8A282'; g.fillRect(w * 0.12, h * 0.30, w * 0.34, h * 0.42);
      g.fillStyle = '#8C4A3E';
      g.beginPath(); g.moveTo(w * 0.09, h * 0.31); g.lineTo(w * 0.29, h * 0.16);
      g.lineTo(w * 0.49, h * 0.31); g.closePath(); g.fill();

      g.fillStyle = '#3E4A3D'; g.fillRect(w * 0.20, h * 0.46, w * 0.07, h * 0.26);
      g.fillStyle = '#D8CBB0'; g.fillRect(w * 0.33, h * 0.38, w * 0.09, h * 0.11);

      g.fillStyle = '#8A7530'; g.beginPath();
      g.arc(w * 0.72, h * 0.46, h * 0.11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4A5568'; g.fillRect(w * 0.60, h * 0.72, w * 0.30, h * 0.10);

      releaseObjectUrl();
      loadImage(cv.toDataURL('image/png'), 'Пример сцены');
    }

    function togglePicker() {
      if (!S.image) { toast('Сначала загрузите изображение'); return; }
      S.picking = !S.picking;
      var wrap = byId('previewWrap');
      if (wrap) wrap.classList.toggle('is-picking', S.picking);
      var btn = byId('btnPicker');
      if (btn) btn.classList.toggle('btn-accent', S.picking);
      toast(S.picking ? 'Наведите на изображение и кликните, чтобы снять цвет' : 'Пипетка выключена');
      if (!S.picking) hideLoupe();
    }

    initPicker();
  }

  /* ------------------------------------------------------------
   *  Пипетка и лупа
   * ---------------------------------------------------------- */

  function hideLoupe() {
    var loupe = byId('loupe');
    if (loupe) loupe.hidden = true;
  }

  function initPicker() {
    var wrap = byId('previewWrap');
    if (!wrap) return;
    var loupe = byId('loupe');
    var loupeSw = byId('loupeSw');
    var loupeHex = byId('loupeHex');
    var dot = byId('pickDot');

    wrap.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    wrap.addEventListener('mouseleave', hideLoupe);
    wrap.addEventListener('click', function (e) { onPick(e.clientX, e.clientY); });

    wrap.addEventListener('touchmove', function (e) {
      if (!S.picking || !e.touches.length) return;
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      if (!S.picking || !e.changedTouches.length) return;
      onPick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    });

    /**
     * Прямоугольник самой картинки внутри элемента.
     *
     * У превью заданы max-height и object-fit: contain, поэтому высокое фото
     * вписывается в блок с пустыми полями по бокам. Рамка элемента шире
     * картинки, и если считать координаты по ней, пипетка снимает цвет
     * не оттуда, куда наведён курсор, — промах ровно на ширину полей.
     */
    function paintedRect(view) {
      var box = view.getBoundingClientRect();
      var nw = S.image.width, nh = S.image.height;
      if (!nw || !nh || !box.width || !box.height) return box;
      var scale = Math.min(box.width / nw, box.height / nh);
      var w = nw * scale, h = nh * scale;
      return {
        left: box.left + (box.width - w) / 2,
        top: box.top + (box.height - h) / 2,
        right: box.left + (box.width + w) / 2,
        bottom: box.top + (box.height + h) / 2,
        width: w, height: h
      };
    }

    function toImageCoords(clientX, clientY) {
      if (!S.image) return null;
      var view = wrap.querySelector('img, canvas');
      if (!view) return null;
      var rect = paintedRect(view);
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      var rx = (clientX - rect.left) / rect.width;
      var ry = (clientY - rect.top) / rect.height;
      return {
        x: Math.min(S.image.width - 1, Math.max(0, Math.round(rx * S.image.width))),
        y: Math.min(S.image.height - 1, Math.max(0, Math.round(ry * S.image.height))),
        localX: clientX - rect.left + (rect.left - wrap.getBoundingClientRect().left),
        localY: clientY - rect.top + (rect.top - wrap.getBoundingClientRect().top)
      };
    }

    function sampleAt(pt) {
      var data = S.image.ctx.getImageData(
        Math.max(0, pt.x - 3), Math.max(0, pt.y - 3),
        Math.min(7, S.image.width - Math.max(0, pt.x - 3)),
        Math.min(7, S.image.height - Math.max(0, pt.y - 3))
      );
      return C.averageAt(data, Math.min(3, pt.x), Math.min(3, pt.y), 2);
    }

    function onMove(cx, cy) {
      if (!S.picking || !S.image || !loupe) return;
      var pt = toImageCoords(cx, cy);
      if (!pt) { hideLoupe(); return; }
      var s = sampleAt(pt);
      if (!s) return;
      loupe.hidden = false;
      // держим подсказку внутри превью, иначе у краёв её срезает overflow
      var half = (loupe.offsetWidth || 96) / 2 + 4;
      var maxX = wrap.clientWidth - half;
      loupe.style.left = Math.min(Math.max(pt.localX, half), Math.max(half, maxX)) + 'px';
      loupe.style.top = Math.max(pt.localY, (loupe.offsetHeight || 38) + 18) + 'px';
      if (loupeSw) loupeSw.style.background = s.hex;
      if (loupeHex) loupeHex.textContent = s.hex;
    }

    function onPick(cx, cy) {
      if (!S.picking || !S.image) return;
      var pt = toImageCoords(cx, cy);
      if (!pt) return;
      var s = sampleAt(pt);
      if (!s) return;

      S.pickedSlot = { hex: s.hex, lab: s.lab, lch: s.lch, share: null, picked: true };
      if (dot) {
        dot.hidden = false;
        dot.style.left = pt.localX + 'px';
        dot.style.top = pt.localY + 'px';
        dot.style.background = s.hex;
      }
      hideLoupe();
      setActiveColor(s.hex, 'photo', 'снято пипеткой');
      renderResults();
      toast('Снят цвет ' + s.hex);
    }
  }

  /* ------------------------------------------------------------
   *  Анализ изображения
   * ---------------------------------------------------------- */

  function analyzeImage() {
    if (!S.image) return;
    var results = byId('results');
    if (results) {
      clear(results);
      results.appendChild(el('div', { class: 'res-empty' }, [
        el('div', { class: 'spinner', style: { borderColor: 'rgba(32,36,31,.2)', borderTopColor: '#3E4A3D' } }),
        el('p', { style: { margin: '0', fontWeight: '700' }, text: 'Разбираем изображение…' }),
        el('small', { text: 'Кластеризация цветов в пространстве CIE Lab' })
      ]));
    }

    // отдаём кадр браузеру, чтобы спиннер успел отрисоваться
    setTimeout(function () {
      var data = S.image.ctx.getImageData(0, 0, S.image.width, S.image.height);
      var dominant = C.extractDominantColors(data, SLOT_COUNT, { maxSamples: 26000 });
      S.slots = dominant.map(function (d) {
        return { hex: d.hex, lab: d.lab, lch: d.lch, share: d.share, picked: false };
      });
      if (!S.slots.length) {
        toast('Не удалось выделить цвета — попробуйте другое фото');
        return;
      }
      setActiveColor(S.slots[0].hex, 'photo', 'основной цвет фото');
      renderResults();
      renderHarmony();
      renderInteriorSection();
      updateUrlState();
    }, 30);
  }

  /* ============================================================
   *  Активный цвет
   * ============================================================ */

  function setActiveColor(hex, source, label) {
    var norm = C.normalizeHex(hex);
    if (!norm) return;
    S.activeHex = norm;
    S.activeSource = source || null;
    S.activeLabel = label || null;
    D.store.pushRecent({ hex: norm, source: source || '', label: label || '' });
    // калькулятор показывает выбранный цвет и должен узнать о смене
    dispatchToolEvent('archipaint:activecolor', { hex: norm, source: source || null, label: label || null });
  }

  function matchOpts(extra) {
    return Object.assign({
      formula: S.formula,
      collections: S.collections.length ? S.collections : null
    }, extra || {});
  }

  function deltaBadge(de) {
    var q = C.deltaEQuality(de);
    return el('span', {
      class: 'de ' + q.cls,
      title: q.label,
      text: 'ΔE ' + fmt(de, 2)
    });
  }

  /* ============================================================
   *  Палитра и ближайшие цвета (шаг 2)
   * ============================================================ */

  function renderResults() {
    var box = byId('results');
    if (!box) return;
    clear(box);

    var slots = S.slots.slice(0, SLOT_COUNT);
    if (!slots.length && !S.pickedSlot) {
      box.appendChild(el('div', { class: 'res-empty' }, [
        svgIcon('M12 3a9 9 0 1 0 0 18c1.6 0 2.4-1 2.4-2.2 0-.7-.3-1.2-.7-1.7-.4-.5-.7-1-.7-1.7 0-1.2 1-2.2 2.4-2.2H17a4 4 0 0 0 4-4c0-3.5-4-6.2-9-6.2z', { width: 1.5 }),
        el('p', { style: { margin: '0', fontWeight: '700' }, text: 'Здесь появится палитра' }),
        el('small', { html: '4 доминирующих цвета + пятый слот для пипетки.<br>Для каждого — HEX и 3 ближайших цвета из каталога с ΔE.' })
      ]));
      return;
    }

    box.appendChild(buildToolbar());

    var list = el('div', { class: 'swatch-list' });
    slots.forEach(function (slot, i) { list.appendChild(buildSwatchRow(slot, i)); });
    list.appendChild(buildSwatchRow(S.pickedSlot, SLOT_COUNT));
    box.appendChild(list);

    var actions = el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { exportPaletteJson(); }
      }, 'Скачать палитру (JSON)'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { exportPalettePng(); }
      }, 'Сохранить картинкой'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(shareUrl(), 'Ссылка на подбор скопирована'); }
      }, 'Скопировать ссылку')
    ]);
    box.appendChild(actions);
  }

  /** Панель настроек расчёта: формула ΔE, коллекции, освещение, зрение. */
  function buildToolbar() {
    var bar = el('div', { class: 'toolbar' });

    var formulaSel = el('select', {
      'aria-label': 'Формула цветового различия',
      onchange: function () {
        S.formula = this.value;
        renderResults();
        renderInteriorSection();
        toast('Формула: ' + C.DELTA_E_FORMULAS[S.formula].label);
      }
    });
    Object.keys(C.DELTA_E_FORMULAS).forEach(function (id) {
      var f = C.DELTA_E_FORMULAS[id];
      formulaSel.appendChild(el('option', { value: id, selected: id === S.formula, title: f.note }, f.label));
    });
    bar.appendChild(el('label', {}, ['Формула ΔE', formulaSel]));

    var collSel = el('select', {
      'aria-label': 'Коллекция',
      onchange: function () {
        S.collections = this.value ? [this.value] : [];
        renderResults();
        renderInteriorSection();
      }
    });
    collSel.appendChild(el('option', { value: '', selected: !S.collections.length }, 'Все коллекции'));
    D.COLLECTIONS.forEach(function (c) {
      collSel.appendChild(el('option', { value: c.id, selected: S.collections[0] === c.id }, c.name + ' (' + c.count + ')'));
    });
    bar.appendChild(el('label', {}, ['Каталог', collSel]));

    var cvdSel = el('select', {
      'aria-label': 'Моделирование цветовосприятия',
      onchange: function () { S.cvd = this.value; renderResults(); }
    });
    Object.keys(C.CVD_LABELS).forEach(function (id) {
      cvdSel.appendChild(el('option', { value: id, selected: id === S.cvd }, C.CVD_LABELS[id]));
    });
    bar.appendChild(el('label', {}, ['Зрение', cvdSel]));

    return bar;
  }

  /** Как показать цвет с учётом выбранной модели зрения. */
  function displayHex(hex) {
    return C.simulateCVD(hex, S.cvd);
  }

  function buildSwatchRow(slot, index) {
    var isPicked = index === SLOT_COUNT;

    if (!slot) {
      return el('div', { class: 'sw-row is-empty-slot' }, [
        el('div', {
          class: 'sw-main',
          style: { background: 'repeating-linear-gradient(45deg,#F4F4EF,#F4F4EF 8px,#EBEBE4 8px,#EBEBE4 16px)' }
        }, el('span', { class: 'sw-hex', style: { color: '#7C8479' }, text: 'слот 5' })),
        el('div', { class: 'sw-body' }, [
          el('div', { class: 'sw-title' }, el('strong', { text: 'Свободный слот' })),
          el('div', { class: 'sw-meta', text: 'снимите цвет пипеткой' }),
          el('p', { class: 'fine', style: { margin: '0' }, text: 'Нажмите «Пипетка» и кликните по нужной точке фотографии — цвет встанет сюда.' })
        ])
      ]);
    }

    var shown = displayHex(slot.hex);
    var textColor = C.readableTextColor(shown);
    var matches = D.nearest(slot.lab, matchOpts({ limit: 3 }));

    var main = el('div', {
      class: 'sw-main',
      style: { background: shown, color: textColor }
    }, [
      slot.picked
        ? el('span', { class: 'sw-share', text: 'пипетка' })
        : el('span', { class: 'sw-share', text: slot.share != null ? Math.round(slot.share * 100) + '%' : '—' }),
      el('button', {
        class: 'sw-hex',
        style: { background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' },
        title: 'Скопировать HEX',
        onclick: function () { copyText(slot.hex); }
      }, slot.hex)
    ]);

    var lch = slot.lch || C.labToLch(slot.lab.l, slot.lab.a, slot.lab.b);
    var temp = C.temperature(slot.hex);

    var body = el('div', { class: 'sw-body' }, [
      el('div', { class: 'sw-title' }, [
        el('strong', { text: isPicked ? 'Цвет с пипетки' : 'Цвет ' + (index + 1) }),
        el('span', { class: 'chip chip-muted', text: temp.label }),
        S.activeHex === slot.hex ? el('span', { class: 'chip', text: 'активный' }) : null
      ]),
      el('div', {
        class: 'sw-meta',
        text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) + '° · LRV ' + fmt(C.lrv(slot.hex), 0)
      })
    ]);

    var matchList = el('div', { class: 'match-list' });
    if (!matches.length) {
      matchList.appendChild(el('p', { class: 'fine', style: { margin: 0 }, text: 'В выбранной коллекции нет близких оттенков — снимите фильтр каталога.' }));
    }
    matches.forEach(function (m) {
      matchList.appendChild(el('button', {
        class: 'match-item',
        type: 'button',
        onclick: function () { openColorCard(m.color, { sourceHex: slot.hex, deltaE: m.deltaE, sourceLabel: isPicked ? 'пипетка' : 'ваше фото' }); }
      }, [
        el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
        el('span', { class: 'match-name' }, [
          el('b', { text: m.color.name }),
          el('span', { text: m.color.code + ' · ' + m.color.hex })
        ]),
        deltaBadge(m.deltaE)
      ]));
    });
    body.appendChild(matchList);

    body.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: function () {
          setActiveColor(slot.hex, 'photo', isPicked ? 'снято пипеткой' : 'цвет фото');
          renderResults(); renderHarmony(); renderInteriorSection(); updateUrlState();
          toast('Гармонии и палитры построены от ' + slot.hex);
        }
      }, 'Взять за основу'),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: function () { addToCompare(slot.hex, isPicked ? 'Пипетка' : 'Цвет ' + (index + 1)); }
      }, 'В сравнение')
    ]));

    return el('div', { class: 'sw-row' }, [main, body]);
  }

  /* ============================================================
   *  Карточка цвета
   * ============================================================ */

  function openColorCard(color, ctx) {
    ctx = ctx || {};
    S.cardColor = color;
    var back = byId('cardBack');
    if (!back) return;

    var banner = byId('mBanner');
    var shown = displayHex(color.hex);
    if (banner) {
      banner.style.background = shown;
      banner.style.color = C.readableTextColor(shown);
    }
    var nameEl = byId('mName');
    if (nameEl) nameEl.textContent = color.name || color.code;
    var hexEl = byId('mHex');
    if (hexEl) hexEl.textContent = color.hex;

    var box = byId('matchBox');
    if (box) {
      box.hidden = !ctx.sourceHex;
      if (ctx.sourceHex) {
        var srcSw = byId('mSrcSw'), dstSw = byId('mDstSw'), badge = byId('mDeBadge'), srcLabel = byId('mSrcLabel');
        if (srcSw) srcSw.style.background = displayHex(ctx.sourceHex);
        if (dstSw) dstSw.style.background = shown;
        if (srcLabel) srcLabel.textContent = ctx.sourceLabel || 'ваш цвет';
        if (badge) {
          var q = C.deltaEQuality(ctx.deltaE);
          badge.textContent = 'ΔE ' + fmt(ctx.deltaE, 2);
          badge.className = 'de ' + q.cls;
          badge.title = q.label;
        }
      }
    }

    var note = byId('mNote');
    if (note) {
      var parts = [];
      if (ctx.deltaE != null) {
        parts.push(C.deltaEQuality(ctx.deltaE).label + ' по формуле ' + C.DELTA_E_FORMULAS[S.formula].label + '.');
      }
      parts.push(C.lrvAdvice(color.lrv != null ? color.lrv : C.lrv(color.hex)));
      note.textContent = parts.join(' ');
    }

    renderCardProps(color);
    renderCardOptions(color);
    renderCardSimilar(color);

    openModal(back);
  }

  function renderCardProps(color) {
    var host = byId('mProps');
    if (!host) return;
    clear(host);

    var lab = color.lab || C.hexToLab(color.hex);
    var lch = color.lch || C.labToLch(lab.l, lab.a, lab.b);
    var rgb = C.hexToRgb(color.hex);
    var lrvValue = color.lrv != null ? color.lrv : C.lrv(color.hex);
    var temp = color.temperature || C.temperature(color.hex);

    [
      ['Код', color.code, color.collection || ''],
      ['HEX', color.hex, 'sRGB'],
      ['RGB', rgb.r + ', ' + rgb.g + ', ' + rgb.b, ''],
      ['Lab (D65)', fmt(lab.l, 1) + ', ' + fmt(lab.a, 1) + ', ' + fmt(lab.b, 1), 'наблюдатель 2°'],
      ['LCh', fmt(lch.l, 1) + ', ' + fmt(lch.c, 1) + ', ' + fmt(lch.h, 0) + '°', ''],
      ['LRV', fmt(lrvValue, 1), 'отражение света'],
      ['Температура', temp.label, ''],
      ['Текст на фоне', C.readableTextColor(color.hex) === '#FFFFFF' ? 'белый' : 'тёмный',
        'контраст ' + fmt(C.contrastRatio(color.hex, C.readableTextColor(color.hex)), 1) + ':1']
    ].forEach(function (row) {
      host.appendChild(el('dl', { class: 'prop' }, [
        el('dt', { text: row[0] }),
        el('dd', {}, [document.createTextNode(row[1]), row[2] ? el('small', { text: row[2] }) : null])
      ]));
    });
  }

  function renderCardOptions(color) {
    var host = byId('mOpts');
    if (!host) return;
    clear(host);

    D.ORDER_OPTIONS.forEach(function (opt) {
      host.appendChild(el('div', { class: 'opt' }, [
        el('div', { class: 'opt-info' }, [
          el('b', {}, [
            document.createTextNode(opt.title + ' · ' + opt.volume),
            opt.badge ? el('span', { class: 'chip', style: { marginLeft: '8px' }, text: opt.badge }) : null
          ]),
          el('span', { text: opt.note + ' Готовность: ' + opt.lead + '.' })
        ]),
        el('div', { class: 'opt-buy' }, [
          el('span', { class: 'opt-price', text: opt.price.toLocaleString('ru-RU') + ' ₽' }),
          el('button', {
            class: 'btn btn-accent btn-sm',
            onclick: function () { requestOrder(color, opt); }
          }, 'В корзину')
        ])
      ]));
    });

    var fav = D.store.isFavorite(color.code);
    host.appendChild(el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function (e) {
          var added = D.store.toggleFavorite(color.code);
          e.currentTarget.textContent = added ? 'В избранном ✓' : 'В избранное';
          toast(added ? 'Цвет добавлен в избранное' : 'Убран из избранного');
          renderFavorites();
        }
      }, fav ? 'В избранном ✓' : 'В избранное'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { addToCompare(color.hex, color.code + ' · ' + color.name); }
      }, 'В сравнение'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          setActiveColor(color.hex, 'catalog', color.code + ' · ' + color.name);
          closeModal(byId('cardBack'));
          renderHarmony(); renderInteriorSection(); updateUrlState();
          toast('Палитры строятся от ' + color.code);
        }
      }, 'Построить палитру от этого цвета'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(color.code + ' · ' + color.name + ' · ' + color.hex, 'Данные цвета скопированы'); }
      }, 'Скопировать')
    ]));
  }

  function renderCardSimilar(color) {
    var host = byId('mSimilar');
    if (!host) return;
    clear(host);
    var similar = D.nearest(color.lab || C.hexToLab(color.hex), matchOpts({ limit: 6, exclude: [color.code] }));
    similar.forEach(function (m) {
      host.appendChild(el('button', {
        class: 'match-item',
        type: 'button',
        onclick: function () { openColorCard(m.color, { sourceHex: color.hex, deltaE: m.deltaE, sourceLabel: color.code }); }
      }, [
        el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
        el('span', { class: 'match-name' }, [
          el('b', { text: m.color.name }),
          el('span', { text: m.color.code + ' · ' + (m.color.collection || '') })
        ]),
        deltaBadge(m.deltaE)
      ]));
    });
  }

  /**
   * Заказ. Если на странице живёт корзина Bitrix — отдаём ей управление
   * через событие; иначе показываем понятную заглушку.
   */
  function requestOrder(color, option) {
    var detail = {
      colorCode: color.code,
      colorName: color.name,
      hex: color.hex,
      collection: color.collection || null,
      optionId: option.id,
      volume: option.volume,
      price: option.price
    };
    D.logEvent('order_intent', detail);

    D.store.addToCart({
      kind: option.id === 'swatch' || option.id === 'tester' ? 'sample' : 'paint',
      optionId: option.id,
      productName: option.title,
      volumeLabel: option.volume,
      price: option.price,
      colorCode: color.code,
      colorName: color.name,
      hex: color.hex
    });
    renderCart();

    var notHandled = dispatchToolEvent('archipaint:order', detail);
    if (notHandled) {
      toast(option.title + ' · ' + option.volume + ' — ' + color.code + ' в корзине');
    }
  }

  /* ============================================================
   *  Поиск по координатам (HEX / RGB / Lab / LCh)
   * ============================================================ */

  function initCoordSearch() {
    var back = wireModal('coordBack', ['coordX']);
    if (!back) return;

    var input = byId('coordInput');
    var preview = byId('coordPreview');
    var detected = byId('coordDetected');
    var results = byId('coordResults');
    var modes = byId('coordModes');
    var mode = 'auto';

    byId('coordBtn') && byId('coordBtn').addEventListener('click', function () {
      openModal(back);
      run();
    });

    if (modes) {
      modes.addEventListener('click', function (e) {
        var btn = e.target.closest('.mode-tab');
        if (!btn) return;
        mode = btn.dataset.mode || 'auto';
        $$('.mode-tab', modes).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        run();
      });
    }

    if (input) {
      input.addEventListener('input', debounce(run, 160));
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
    }

    function run() {
      if (!input) return;
      var raw = input.value.trim();
      clear(results);

      if (!raw) {
        if (preview) preview.style.background = '#E6E6E0';
        if (detected) { detected.textContent = ''; detected.className = 'coord-detected'; }
        return;
      }

      var parsed = C.parseColorInput(raw, mode);
      if (!parsed) {
        if (preview) preview.style.background = '#E6E6E0';
        if (detected) {
          detected.className = 'coord-detected is-error';
          detected.textContent = 'Не удалось разобрать значение. Проверьте формат или выберите его вручную.';
        }
        return;
      }

      if (preview) preview.style.background = parsed.hex;

      if (detected) {
        detected.className = 'coord-detected';
        clear(detected);
        var names = { hex: 'HEX', rgb: 'RGB', lab: 'CIE Lab', lch: 'CIE LCh', hsl: 'HSL' };
        detected.appendChild(document.createTextNode('Распознано как '));
        detected.appendChild(el('b', { text: names[parsed.format] || parsed.format }));
        detected.appendChild(document.createTextNode(
          ' → ' + parsed.hex + ' · Lab ' + fmt(parsed.lab.l, 1) + ', ' + fmt(parsed.lab.a, 1) + ', ' + fmt(parsed.lab.b, 1)
        ));
        if (parsed.inGamut === false) {
          detected.appendChild(el('span', {
            class: 'chip chip-muted',
            style: { marginLeft: '8px' },
            title: 'Такой цвет невозможно точно показать на экране sRGB — показан ближайший отображаемый.',
            text: 'вне охвата sRGB'
          }));
        }
      }

      var matches = D.nearest(parsed.lab, matchOpts({ limit: 5 }));
      if (!matches.length) {
        results.appendChild(el('p', { class: 'fine', text: 'В выбранной коллекции ничего не найдено.' }));
        return;
      }
      matches.forEach(function (m) {
        results.appendChild(el('button', {
          class: 'match-item',
          type: 'button',
          onclick: function () {
            closeModal(back);
            openColorCard(m.color, { sourceHex: parsed.hex, deltaE: m.deltaE, sourceLabel: 'запрос' });
          }
        }, [
          el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
          el('span', { class: 'match-name' }, [
            el('b', { text: m.color.name }),
            el('span', { text: m.color.code + ' · ' + m.color.hex + ' · ' + (m.color.collection || '') })
          ]),
          deltaBadge(m.deltaE)
        ]));
      });

      results.appendChild(el('div', { class: 'btn-row' }, el('button', {
        class: 'btn btn-accent btn-sm',
        onclick: function () {
          setActiveColor(parsed.hex, 'coords', 'введено вручную');
          closeModal(back);
          renderHarmony(); renderInteriorSection(); updateUrlState();
          scrollToSection(byId('harmony'));
          toast('Строим палитры от ' + parsed.hex);
        }
      }, 'Построить палитры от этого цвета')));
    }
  }

  /* ============================================================
   *  Каталог целиком
   * ============================================================ */

  /**
   * Открыть каталог, при желании сразу на нужной коллекции.
   * Ставится в initCatalogModal и вызывается карточками коллекций.
   */
  var openCatalog = null;

  function initCatalogModal() {
    var back = wireModal('catBack', ['catX']);
    if (!back) return;

    var grid = byId('catGrid');
    var search = byId('catSearch');
    var count = byId('catCount');
    var filters = byId('catFilters');
    var activeCollection = null;

    byId('navCatalog') && byId('navCatalog').addEventListener('click', function (e) {
      e.preventDefault();
      activeCollection = null;
      open();
    });

    openCatalog = function (collectionId) {
      activeCollection = collectionId || null;
      if (search) search.value = '';
      open();
    };

    function open() {
      openModal(back);
      renderFilters();
      render();
    }

    function renderFilters() {
      if (!filters) return;
      clear(filters);
      filters.appendChild(el('button', {
        class: 'filter-chip' + (activeCollection ? '' : ' is-active'),
        onclick: function () { activeCollection = null; renderFilters(); render(); }
      }, 'Все · ' + D.getCatalog().length));
      D.COLLECTIONS.forEach(function (c) {
        filters.appendChild(el('button', {
          class: 'filter-chip' + (activeCollection === c.id ? ' is-active' : ''),
          onclick: function () { activeCollection = c.id; renderFilters(); render(); }
        }, c.name.replace('ArchiPaint ', '') + ' · ' + c.count));
      });
    }

    function render() {
      if (!grid) return;
      var q = search ? search.value.trim() : '';
      var items = q
        ? D.searchCatalog(q, { limit: 400, collections: activeCollection ? [activeCollection] : null })
        : D.getCatalog().filter(function (c) { return !activeCollection || c.collection === activeCollection; });

      clear(grid);
      if (count) {
        count.textContent = items.length + ' ' + plural(items.length, 'оттенок', 'оттенка', 'оттенков');
      }
      if (!items.length) {
        grid.appendChild(el('p', { class: 'fine', text: 'Ничего не найдено. Попробуйте другой запрос — код, название или HEX.' }));
        return;
      }
      var frag = document.createDocumentFragment();
      items.forEach(function (c) {
        frag.appendChild(el('button', {
          class: 'cat-cell',
          type: 'button',
          title: c.code + ' · ' + c.name + ' · ' + c.hex,
          onclick: function () {
            closeModal(back);
            openColorCard(c, S.activeHex ? {
              sourceHex: S.activeHex,
              deltaE: C.deltaE(C.hexToLab(S.activeHex), c.lab, S.formula),
              sourceLabel: S.activeLabel || 'ваш цвет'
            } : {});
          }
        }, [
          el('i', { style: { background: displayHex(c.hex) } }),
          el('div', { class: 'cat-meta' }, [
            el('b', { text: c.code }),
            el('span', { text: c.name })
          ])
        ]));
      });
      grid.appendChild(frag);
    }

    if (search) search.addEventListener('input', debounce(render, 140));
  }

  /* ============================================================
   *  Поиск по коду чужого стандарта (RAL и т. п.)
   * ============================================================ */

  function initStandardSearch() {
    var section = byId('standardSection');
    if (!section) return;

    var input = byId('stdInput');
    var swatch = byId('stdSwatch');
    var list = byId('stdSuggest');
    var result = byId('stdResult');
    if (!input || !list || !result) return;

    var suggestions = [];
    var activeIndex = -1;

    input.addEventListener('input', debounce(suggest, 130));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!suggestions.length) return;
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (suggestions.length) choose(suggestions[Math.max(0, activeIndex)]);
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    input.addEventListener('blur', function () { setTimeout(hide, 180); });
    input.addEventListener('focus', suggest);

    function hide() { list.hidden = true; activeIndex = -1; }

    function highlight() {
      $$('.ac-item', list).forEach(function (b, i) { b.classList.toggle('is-active', i === activeIndex); });
    }

    function suggest() {
      var q = input.value.trim();
      if (q.length < 1) { clear(list); suggestions = []; activeIndex = -1; hide(); return; }

      // адаптер сам сходит в API, если он настроен, и вернётся
      // к локальному индексу при любой ошибке или пустом ответе
      D.searchCatalogAsync(q, { limit: 8, collections: S.collections.length ? S.collections : null })
        .then(function (own) {
          if (input.value.trim() !== q) return;   // пользователь уже печатает дальше
          paint(q, own);
        });
    }

    function paint(q, own) {
      clear(list);
      suggestions = [];
      activeIndex = -1;

      var stds = D.getStandards().length ? D.searchStandards(q, { limit: 8 }) : [];

      if (stds.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Чужие стандарты' }));
        stds.forEach(function (s) { addItem(s, true); });
      }
      if (own.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Палитра ArchiPaint' }));
        own.forEach(function (c) { addItem(c, false); });
      }

      if (!suggestions.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Ничего не найдено' }));
      }
      list.hidden = false;
    }

    function addItem(item, isStandard) {
      suggestions.push({ item: item, isStandard: isStandard });
      list.appendChild(el('button', {
        class: 'ac-item',
        type: 'button',
        onmousedown: function (e) { e.preventDefault(); },
        onclick: function () { choose({ item: item, isStandard: isStandard }); }
      }, [
        el('span', { class: 'ac-sw', style: { background: item.hex } }),
        el('span', {}, [
          el('b', { text: item.code + (item.name ? ' · ' + item.name : '') }),
          el('span', { text: item.hex + ' · ' + (isStandard ? item.standard : item.collection) })
        ]),
        el('span', { class: 'chip chip-muted', text: isStandard ? 'стандарт' : 'в наличии' })
      ]));
    }

    function choose(entry) {
      hide();
      input.value = entry.item.code + (entry.item.name ? ' · ' + entry.item.name : '');
      if (swatch) swatch.style.background = entry.item.hex;
      if (entry.isStandard) showStandard(entry.item);
      else showOwn(entry.item);
    }

    function showStandard(std) {
      var matched = D.matchStandard(std, matchOpts({ limit: 6 }));
      clear(result);
      result.classList.add('is-visible');

      result.appendChild(el('div', { class: 'std-source' }, [
        el('div', { class: 'std-source-sw', style: { background: displayHex(std.hex) } }),
        el('div', {}, [
          el('h3', { text: std.code + ' · ' + std.name }),
          el('div', { class: 'mono', text: std.hex + ' · Lab ' + fmt(std.lab.l, 1) + ', ' + fmt(std.lab.a, 1) + ', ' + fmt(std.lab.b, 1) + ' · LRV ' + fmt(std.lrv, 1) }),
          el('p', { class: 'fine', style: { margin: '6px 0 0' }, text: 'Стандарт ' + std.standard + '. Ниже — чем его закрыть из колеровочной палитры ArchiPaint.' })
        ])
      ]));

      var best = matched.matches[0];
      if (best) {
        result.appendChild(el('p', { class: 'section-intro', style: { margin: '0 0 14px' } }, [
          document.createTextNode('Лучшее совпадение — '),
          el('b', { text: best.color.code + ' «' + best.color.name + '»' }),
          document.createTextNode(', ΔE ' + fmt(best.deltaE, 2) + ' по ' + C.DELTA_E_FORMULAS[S.formula].label + ' — ' + best.quality.label.toLowerCase() + '.')
        ]));
      }

      var grid = el('div', { class: 'cards-grid' });
      matched.matches.forEach(function (m) {
        grid.appendChild(colorCardTile(m.color, m.deltaE));
      });
      result.appendChild(grid);

      result.appendChild(el('div', { class: 'btn-row' }, el('button', {
        class: 'btn btn-accent btn-sm',
        onclick: function () {
          setActiveColor(std.hex, 'standard', std.code);
          renderHarmony(); renderInteriorSection(); updateUrlState();
          scrollToSection(byId('interior'));
          toast('Строим интерьерные палитры от ' + std.code);
        }
      }, 'Построить интерьерные палитры от ' + std.code)));

      D.logEvent('standard_lookup', { code: std.code, hex: std.hex, bestMatch: best ? best.color.code : null });
    }

    function showOwn(color) {
      clear(result);
      result.classList.add('is-visible');
      result.appendChild(el('div', { class: 'std-source' }, [
        el('div', { class: 'std-source-sw', style: { background: displayHex(color.hex) } }),
        el('div', {}, [
          el('h3', { text: color.code + ' · ' + color.name }),
          el('div', { class: 'mono', text: color.hex + ' · ' + color.collection + ' · LRV ' + fmt(color.lrv, 1) }),
          el('p', { class: 'fine', style: { margin: '6px 0 0' }, text: C.lrvAdvice(color.lrv) })
        ])
      ]));

      var grid = el('div', { class: 'cards-grid' });
      D.nearest(color.lab, matchOpts({ limit: 6, exclude: [color.code] })).forEach(function (m) {
        grid.appendChild(colorCardTile(m.color, m.deltaE));
      });
      result.appendChild(el('h4', { text: 'Близкие оттенки' }));
      result.appendChild(grid);

      result.appendChild(el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn-accent btn-sm',
          onclick: function () { openColorCard(color, {}); }
        }, 'Открыть карточку и заказать'),
        el('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: function () {
            setActiveColor(color.hex, 'catalog', color.code);
            renderHarmony(); renderInteriorSection(); updateUrlState();
            scrollToSection(byId('interior'));
          }
        }, 'Построить палитры')
      ]));
    }
  }

  /** Плитка каталога с ΔE — используется в нескольких секциях. */
  function colorCardTile(color, deltaE) {
    var lch = color.lch || C.labToLch(color.lab.l, color.lab.a, color.lab.b);
    return el('button', {
      class: 'color-card',
      type: 'button',
      'aria-label': color.code + ' ' + color.name,
      onclick: function () {
        openColorCard(color, deltaE != null ? { sourceHex: S.activeHex, deltaE: deltaE, sourceLabel: 'запрос' } : {});
      }
    }, [
      el('div', { class: 'cc-sw', style: { background: displayHex(color.hex) } },
        el('span', { class: 'cc-lab mono', text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) })),
      el('div', { class: 'cc-meta' }, [
        el('span', { class: 'cc-code', text: color.code }),
        el('span', { class: 'cc-name', text: color.name }),
        el('span', { class: 'cc-foot' }, [
          el('span', { class: 'chip chip-muted', text: (color.collection || '').replace('ArchiPaint ', '') }),
          deltaE != null ? deltaBadge(deltaE) : null
        ])
      ])
    ]);
  }

  /* ============================================================
   *  Коллекции
   * ============================================================ */

  function renderCollections() {
    var host = byId('collectionsGrid');
    if (!host) return;
    clear(host);
    D.COLLECTIONS.forEach(function (c) {
      host.appendChild(el('button', {
        class: 'collection-card',
        type: 'button',
        onclick: function () {
          if (openCatalog) openCatalog(c.id);
        }
      }, [
        el('div', { class: 'collection-strip' }, c.preview.map(function (hex) {
          return el('i', { style: { background: displayHex(hex) } });
        })),
        el('div', { class: 'collection-body' }, [
          el('h3', { text: c.name }),
          el('p', { text: c.tagline }),
          el('p', { class: 'fine', style: { margin: '0 0 9px' }, text: c.desc }),
          el('span', { class: 'chip', text: c.count + ' ' + plural(c.count, 'оттенок', 'оттенка', 'оттенков') })
        ])
      ]));
    });
  }

  /* ============================================================
   *  Гармонические сочетания и цветовой круг
   * ============================================================ */

  function renderHarmony() {
    var empty = byId('harmonyEmpty');
    var body = byId('harmonyBody');
    if (!body) return;

    if (!S.activeHex) {
      if (empty) empty.hidden = false;
      body.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    body.hidden = false;

    renderSchemeTabs();
    renderBaseRow();
    drawWheel();
    renderSchemeColors();
  }

  function renderSchemeTabs() {
    var host = byId('schemeTabs');
    if (!host) return;
    clear(host);
    C.HARMONY_SCHEMES.forEach(function (s) {
      host.appendChild(el('button', {
        class: 'scheme-tab' + (s.id === S.scheme ? ' is-active' : ''),
        type: 'button',
        onclick: function () {
          S.scheme = s.id;
          renderHarmony();
          updateUrlState();
        }
      }, s.label));
    });
  }

  function renderBaseRow() {
    var host = byId('baseRow');
    if (!host) return;
    clear(host);

    var lab = C.hexToLab(S.activeHex);
    var lch = C.labToLch(lab.l, lab.a, lab.b);
    var match = D.nearestOne(lab, matchOpts());

    host.appendChild(el('div', { class: 'base-sw', style: { background: displayHex(S.activeHex) } }));
    host.appendChild(el('div', { style: { minWidth: '0' } }, [
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } }, [
        el('strong', { text: S.activeHex }),
        el('span', { class: 'chip chip-muted', text: S.activeLabel || 'базовый цвет' }),
        el('span', { class: 'chip chip-muted', text: C.temperature(S.activeHex).label })
      ]),
      el('div', { class: 'mono fine', text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) + '° · LRV ' + fmt(C.lrv(S.activeHex), 1) })
    ]));

    if (match) {
      host.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm',
        style: { marginLeft: 'auto' },
        onclick: function () {
          openColorCard(match.color, { sourceHex: S.activeHex, deltaE: match.deltaE, sourceLabel: S.activeLabel || 'ваш цвет' });
        }
      }, ['Ближайший: ' + match.color.code, deltaBadge(match.deltaE)]));
    }
  }

  function renderSchemeColors() {
    var host = byId('hsGrid');
    var descEl = byId('schemeDesc');
    if (!host) return;

    var harmony = C.buildHarmony(S.activeHex, S.scheme);
    if (!harmony) return;
    if (descEl) descEl.textContent = harmony.desc;

    clear(host);
    harmony.colors.forEach(function (c, i) {
      var match = D.nearestOne(c.lab, matchOpts());
      var shown = displayHex(c.hex);
      host.appendChild(el('button', {
        class: 'hs-item',
        type: 'button',
        onclick: function () {
          if (match) openColorCard(match.color, { sourceHex: c.hex, deltaE: match.deltaE, sourceLabel: i === 0 ? 'базовый' : 'цвет схемы' });
        }
      }, [
        el('div', { class: 'hs-sw', style: { background: shown } }),
        el('div', { class: 'hs-meta' }, [
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' } }, [
            el('span', { class: 'badge ' + (i === 0 ? 'badge-base' : 'badge-additional'), text: i === 0 ? 'база' : 'цвет ' + (i + 1) })
          ]),
          el('div', { class: 'mono', style: { fontSize: '12px', fontWeight: '650' }, text: c.hex }),
          match ? el('div', { class: 'fine', style: { marginTop: '3px' }, text: match.color.code + ' · ' + match.color.name }) : null,
          match ? el('div', { style: { marginTop: '6px' } }, deltaBadge(match.deltaE)) : null
        ])
      ]));
    });
  }

  /**
   * Цветовой круг: кольцо тонов LCh при фиксированной светлоте
   * и маркеры выбранной схемы. Рисуем на canvas — это дешевле,
   * чем сотня SVG-сегментов, и корректно масштабируется.
   */
  function drawWheel() {
    var canvas = byId('wheel');
    if (!canvas || !S.activeHex) return;

    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var cssSize = canvas.clientWidth || 300;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    var cx = cssSize / 2, cy = cssSize / 2;
    var outer = cssSize * 0.46, inner = cssSize * 0.31;

    var baseLab = C.hexToLab(S.activeHex);
    var baseLch = C.labToLch(baseLab.l, baseLab.a, baseLab.b);
    var ringL = C.clamp(baseLch.l, 34, 78);
    var ringC = Math.max(24, Math.min(baseLch.c * 1.15, 62));

    // кольцо тонов
    var step = 1.5;
    for (var a = 0; a < 360; a += step) {
      var lab = C.fitToGamut(ringL, ringC, a);
      ctx.beginPath();
      ctx.fillStyle = C.simulateCVD(C.labToHex(lab.l, lab.a, lab.b), S.cvd);
      var a0 = (a - 90 - step * 0.05) * Math.PI / 180;
      var a1 = (a - 90 + step * 1.1) * Math.PI / 180;
      ctx.arc(cx, cy, outer, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }

    // центр — базовый цвет
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 9, 0, Math.PI * 2);
    ctx.fillStyle = displayHex(S.activeHex);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(32,36,31,.16)';
    ctx.stroke();

    // маркеры схемы
    var harmony = C.buildHarmony(S.activeHex, S.scheme);
    if (!harmony) return;

    harmony.colors.forEach(function (col, i) {
      var h = col.lch.c < 1.5 ? baseLch.h : col.lch.h;
      var rad = (h - 90) * Math.PI / 180;
      var r = (outer + inner) / 2;
      var x = cx + Math.cos(rad) * r;
      var y = cy + Math.sin(rad) * r;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = displayHex(col.hex);
      ctx.fill();
      ctx.lineWidth = i === 0 ? 3 : 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(32,36,31,.28)';
      ctx.stroke();
    });
  }

  /* ============================================================
   *  Интерьерные палитры
   * ============================================================ */

  function initInterior() {
    var section = byId('interior');
    if (!section) return;

    var roleSel = byId('interiorRole');
    if (roleSel) {
      roleSel.addEventListener('change', function () {
        S.baseRole = this.value;
        renderInteriorSection();
        updateUrlState();
      });
    }

    var buildBtn = byId('interiorBuild');
    if (buildBtn) {
      buildBtn.addEventListener('click', function () {
        if (!S.activeHex) {
          toast('Сначала выберите базовый цвет — из фото, по коду или по координатам');
          return;
        }
        renderInteriorSection(true);
      });
    }

    renderMoodGrid();
  }

  function renderMoodGrid() {
    var host = byId('moodGrid');
    if (!host) return;
    clear(host);

    D.MOOD_PRESETS.forEach(function (preset) {
      // полоска-превью строится от текущего базового цвета,
      // поэтому пресеты сразу видно «на своём» оттенке
      var previewBase = S.activeHex || '#A89480';
      var sample = D.buildInteriorPalettes(previewBase, preset.id, { schemes: ['analogous'] });
      var strip = sample && sample.results[0]
        ? sample.results[0].colors.slice(0, 5).map(function (c) { return c.hex; })
        : ['#EEE', '#DDD', '#CCC', '#BBB', '#AAA'];

      host.appendChild(el('button', {
        class: 'mood-card' + (preset.id === S.mood ? ' is-active' : ''),
        type: 'button',
        title: preset.desc,
        onclick: function () {
          S.mood = preset.id;
          renderMoodGrid();
          renderInteriorSection();
          updateUrlState();
        }
      }, [
        el('div', { class: 'mood-strip' }, strip.map(function (hex) {
          return el('i', { style: { background: displayHex(hex) } });
        })),
        el('span', { class: 'mood-name', text: preset.title })
      ]));
    });
  }

  function renderInteriorSection(scrollIntoView) {
    var section = byId('interior');
    if (!section) return;

    var empty = byId('interiorEmpty');
    var body = byId('interiorBody');
    var results = byId('interiorResults');
    if (!results) return;

    if (!S.activeHex) {
      if (empty) empty.hidden = false;
      if (body) body.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (body) body.hidden = false;

    var opts = matchOpts({ baseRoleOverride: S.baseRole });
    var hex = S.activeHex, mood = S.mood;

    // Локальный расчёт мгновенный — показываем его сразу, не заставляя ждать сеть.
    var data = D.buildInteriorPalettes(hex, mood, opts);
    if (!data) return;
    paint(data);
    if (scrollIntoView) scrollToSection(results);

    // Если подключён колеровочный API, его ответ приходит следом и уточняет
    // результат. Пока он в пути, страница уже полностью работоспособна.
    if (D.config.apiBase) {
      D.buildInteriorPalettesAsync(hex, mood, opts).then(function (remote) {
        // за время запроса пользователь мог сменить цвет или настроение
        if (!remote || S.activeHex !== hex || S.mood !== mood) return;
        if (remote === data) return;
        paint(remote);
      });
    }

    function paint(payload) {
      S.lastPalettes = payload;
      renderInteriorHeader(payload);
      clear(results);

      var grid = el('div', { class: 'schemes-grid' });
      payload.results.forEach(function (scheme, index) {
        grid.appendChild(buildSchemeCard(payload, scheme, index));
      });
      results.appendChild(grid);

      D.logEvent('interior_palettes_shown', {
        baseColor: payload.baseColor,
        presetId: payload.presetId,
        effectiveBaseRole: payload.effectiveBaseRole,
        schemes: payload.results.map(function (x) { return x.schemeId; })
      });
    }
  }

  function renderInteriorHeader(data) {
    var host = byId('interiorSelected');
    if (!host) return;
    clear(host);

    var preset = D.PRESETS_BY_ID[data.presetId];
    var roleInfo = D.roleMeta(data.effectiveBaseRole);

    host.appendChild(el('div', { class: 'selected-swatch', style: { background: displayHex(data.baseColor) } }));
    host.appendChild(el('div', { class: 'selected-info-main' }, [
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' } }, [
        roleBadge(data.effectiveBaseRole),
        el('strong', { class: 'mono', text: data.baseColor }),
        S.activeLabel ? el('span', { class: 'chip chip-muted', text: S.activeLabel }) : null,
        data.effectiveBaseRole !== data.autoBaseRole
          ? el('span', { class: 'chip chip-muted', text: 'роль задана вручную' })
          : el('span', { class: 'chip chip-muted', text: 'роль подобрана автоматически' })
      ]),
      el('div', { class: 'fine', text: 'Настроение: ' + preset.title + '. ' + preset.desc }),
      el('div', { class: 'fine', style: { marginTop: '4px' }, text: roleInfo.hint })
    ]));

    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: 0, marginLeft: 'auto' } }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { global.print(); }
      }, 'Распечатать'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(shareUrl(), 'Ссылка скопирована'); }
      }, 'Поделиться')
    ]));
  }

  function roleBadge(roleId) {
    var meta = D.roleMeta(roleId);
    return el('span', { class: 'badge badge-' + meta.tone, title: meta.hint, text: meta.label });
  }

  function buildSchemeCard(data, scheme, index) {
    var card = el('div', { class: 'scheme-card' });
    card.appendChild(el('h3', { text: scheme.label }));
    card.appendChild(el('p', { class: 'scheme-note', text: scheme.desc }));

    // Полоса 60/30/10 — правило распределения цвета в интерьере
    var wall = pickRole(scheme.colors, 'main');
    var extra = pickRole(scheme.colors, 'additional');
    var accent = pickRole(scheme.colors, 'accent');

    var bar = el('div', { class: 'scheme-bar' });
    [[wall, 60], [extra, 30], [accent, 10]].forEach(function (pair) {
      if (!pair[0]) return;
      var shown = displayHex(pair[0].hex);
      bar.appendChild(el('i', {
        style: { background: shown, flex: String(pair[1]), color: C.readableTextColor(shown) },
        title: D.roleMeta(pair[0].role).label + ' · ' + pair[0].hex
      }, pair[1] + '%'));
    });
    card.appendChild(bar);
    card.appendChild(el('div', { class: 'scheme-ratio' }, [
      el('span', { text: 'стены' }),
      el('span', { text: 'дополнительный' }),
      el('span', { text: 'акцент' })
    ]));

    var list = el('div', { class: 'scheme-colors' });
    var order = D.ROLE_ORDER;
    scheme.colors.slice().sort(function (a, b) {
      return order.indexOf(a.role) - order.indexOf(b.role);
    }).forEach(function (col) {
      list.appendChild(buildSchemeColorRow(col));
    });
    card.appendChild(list);

    var foot = el('div', { class: 'scheme-foot' });
    foot.appendChild(el('span', {
      class: 'chip chip-muted',
      title: 'Разброс светлоты между самым светлым и самым тёмным цветом палитры',
      text: scheme.contrast.levelLabel + ' · ΔL ' + fmt(scheme.contrast.spread, 0)
    }));
    foot.appendChild(buildRating(data, scheme, index));
    card.appendChild(foot);

    card.appendChild(el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { applyPaletteToVisualizer(scheme); }
      }, 'Примерить в комнате'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          D.store.savePalette({
            baseColor: data.baseColor,
            presetId: data.presetId,
            presetTitle: data.presetTitle,
            schemeId: scheme.schemeId,
            schemeLabel: scheme.label,
            colors: scheme.colors.map(function (c) {
              return { role: c.role, hex: c.hex, code: c.catalogColorCode, name: c.catalogColorName };
            })
          });
          renderSavedPalettes();
          toast('Палитра сохранена');
        }
      }, 'Сохранить'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          var text = scheme.colors.map(function (c) {
            return D.roleMeta(c.role).label + ': ' + (c.catalogColorCode || '') + ' ' + (c.catalogColorName || '') + ' ' + c.hex;
          }).join('\n');
          copyText(text, 'Палитра скопирована');
        }
      }, 'Скопировать')
    ]));

    return card;
  }

  function pickRole(colors, role) {
    return colors.filter(function (c) { return c.role === role; })[0] || null;
  }

  function buildSchemeColorRow(col) {
    var shown = displayHex(col.hex);
    return el('button', {
      class: 'scheme-color-row',
      type: 'button',
      onclick: function () {
        var catalogColor = col.catalogColorCode ? D.getByCode(col.catalogColorCode) : null;
        if (catalogColor) {
          openColorCard(catalogColor, {
            sourceHex: col.hex,
            deltaE: col.deltaE,
            sourceLabel: D.roleMeta(col.role).label
          });
        } else {
          copyText(col.hex);
        }
      }
    }, [
      el('span', { class: 'scheme-color-sw', style: { background: shown } }),
      el('span', { class: 'scheme-color-info' }, [
        el('span', { style: { display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '2px' } }, [
          roleBadge(col.role),
          col.isBase ? el('span', { class: 'badge badge-base', text: 'ваш цвет' }) : null
        ]),
        el('span', {
          class: 'scheme-color-code',
          text: col.catalogColorCode
            ? col.catalogColorCode + ' · ' + col.catalogColorName
            : col.hex
        }),
        el('span', {
          class: 'scheme-color-lch',
          text: 'L ' + fmt(col.lch.l, 1) + ' · C ' + fmt(col.lch.c, 1) + ' · h ' + fmt(col.lch.h, 0) + '° · LRV ' + fmt(col.lrv, 0)
        })
      ]),
      col.deltaE != null && !col.isBase ? deltaBadge(col.deltaE) : el('span', { class: 'chip chip-muted', text: 'основа' })
    ]);
  }

  var STAR_PATH = 'M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.8 4.8 17.6l1-5.8L1.6 7.7l5.8-.8z';

  function buildRating(data, scheme, index) {
    var key = data.presetId + '::' + scheme.schemeId + '::' + data.baseColor;
    var saved = D.store.getRatings()[key] || 0;

    var wrap = el('div', { style: { display: 'flex', alignItems: 'center' } });
    wrap.appendChild(el('span', { class: 'rating-label', text: 'Оценка:' }));
    var stars = el('div', { class: 'rating-stars', role: 'group', 'aria-label': 'Оценить палитру' });

    for (var i = 1; i <= 5; i++) {
      (function (value) {
        var btn = el('button', {
          class: 'rating-star' + (value <= saved ? ' is-on' : ''),
          type: 'button',
          'aria-label': 'Оценка ' + value + ' из 5',
          onclick: function () {
            D.store.setRating(key, value);
            paint(value);
            D.logEvent('palette_rating', {
              presetId: data.presetId,
              schemeId: scheme.schemeId,
              schemeIndex: index,
              baseColor: data.baseColor,
              rating: value,
              colors: scheme.colors.map(function (c) {
                return { role: c.role, hex: c.hex, code: c.catalogColorCode };
              })
            });
            toast('Спасибо! Оценка учтена');
          },
          onmouseenter: function () { paint(value); }
        }, svgIcon(STAR_PATH, { viewBox: '0 0 20 20', fill: 'currentColor', stroke: 'none' }));
        stars.appendChild(btn);
      })(i);
    }

    stars.addEventListener('mouseleave', function () {
      paint(D.store.getRatings()[key] || 0);
    });

    function paint(value) {
      $$('.rating-star', stars).forEach(function (b, i) { b.classList.toggle('is-on', i + 1 <= value); });
    }

    wrap.appendChild(stars);
    return wrap;
  }

  /* ============================================================
   *  Сохранённые палитры и избранное
   * ============================================================ */

  function renderSavedPalettes() {
    var host = byId('savedPalettes');
    if (!host) return;
    clear(host);

    var saved = D.store.getSavedPalettes();
    if (!saved.length) {
      host.appendChild(el('p', { class: 'fine', text: 'Сохранённых палитр пока нет. Постройте палитру и нажмите «Сохранить» — она останется в этом браузере.' }));
      return;
    }

    saved.forEach(function (p) {
      host.appendChild(el('div', { class: 'scheme-card' }, [
        el('h3', { text: p.schemeLabel + ' · ' + p.presetTitle }),
        el('p', { class: 'scheme-note', text: 'Базовый цвет ' + p.baseColor }),
        el('div', { class: 'scheme-bar' }, p.colors.map(function (c) {
          return el('i', { style: { background: displayHex(c.hex), flex: '1' }, title: (c.code || '') + ' ' + c.hex });
        })),
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: function () {
              setActiveColor(p.baseColor, 'saved', 'сохранённая палитра');
              S.mood = p.presetId;
              renderMoodGrid(); renderHarmony(); renderInteriorSection(true);
            }
          }, 'Открыть'),
          el('button', {
            class: 'btn btn-quiet btn-sm',
            onclick: function () { D.store.removePalette(p.id); renderSavedPalettes(); toast('Палитра удалена'); }
          }, 'Удалить')
        ])
      ]));
    });
  }

  function renderFavorites() {
    var host = byId('favoritesGrid');
    if (!host) return;
    clear(host);

    var codes = D.store.getFavorites();
    var colors = codes.map(D.getByCode).filter(Boolean);

    if (!colors.length) {
      host.appendChild(el('p', { class: 'fine', text: 'Избранных цветов пока нет. Откройте карточку любого оттенка и нажмите «В избранное».' }));
      return;
    }
    colors.forEach(function (c) { host.appendChild(colorCardTile(c)); });
  }

  /* ============================================================
   *  Визуализатор комнаты
   * ============================================================ */

  /* ============================================================
   *  Визуализатор комнаты
   *
   *  Сцена собирается из SVG: сначала плоскость заливается цветом
   *  краски, поверх ложится маска освещения — градиент, мягкая тень
   *  в углах и световое пятно от окна. Цвет под маской остаётся ровно
   *  тем, что в банке, а комната читается объёмной.
   * ============================================================ */

  // Какая роль палитры на какую поверхность ложится.
  // Пол в палитру не входит: краской его не красят, и цвет роли
  // «дополнительный» на полу раньше ломал всю сцену.
  var VIZ_SURFACES = [
    { key: 'wall',       label: 'Стены',              role: 'main',        hint: 'Основной объём — 60%' },
    { key: 'accentWall', label: 'Акцентная стена',    role: 'accent',      hint: 'Стена, на которую смотрят' },
    { key: 'ceiling',    label: 'Потолок',            role: 'ceiling',     hint: 'Светлее стен' },
    { key: 'trim',       label: 'Столярка и плинтус', role: 'trim',        hint: 'Плинтус, наличники, рама' },
    { key: 'furniture',  label: 'Мягкая мебель',      role: 'additional',  hint: 'Второй по площади — 30%' },
    { key: 'door',       label: 'Дверь',              role: 'deep_accent', hint: 'Тёмный контрастный тон' },
    { key: 'floor',      label: 'Пол',                role: null,          hint: 'Не входит в палитру' }
  ];

  var vizState = {
    wall: '#C8BBA6',
    accentWall: '#8C7B63',
    ceiling: '#F4F1EA',
    trim: '#EFEAE0',
    furniture: '#A08D74',
    door: '#5A4A3C',
    floor: '#9A7B55',
    view: 'living'
  };

  function initVisualizer() {
    var stage = byId('vizStage');
    if (!stage) return;

    var viewSeg = byId('vizViews');
    if (viewSeg) {
      if (!viewSeg.children.length) {
        ROOM_VIEWS.forEach(function (v) {
          viewSeg.appendChild(el('button', {
            type: 'button',
            class: v.id === vizState.view ? 'is-active' : '',
            dataset: { view: v.id }
          }, v.label));
        });
      }
      viewSeg.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-view]');
        if (!btn) return;
        vizState.view = btn.dataset.view;
        $$('button', viewSeg).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        drawRoom();
      });
    }
    drawRoom();
    renderVizAssign();
  }

  function applyPaletteToVisualizer(scheme) {
    VIZ_SURFACES.forEach(function (s) {
      if (!s.role) return;
      var col = pickRole(scheme.colors, s.role);
      if (col) vizState[s.key] = col.hex;
    });

    drawRoom();
    renderVizAssign();
    scrollToSection(byId('visualizer'));
    toast('Палитра примерена в комнате');
  }

  function renderVizAssign() {
    var host = byId('vizAssign');
    if (!host) return;
    clear(host);

    VIZ_SURFACES.forEach(function (s) {
      var hex = vizState[s.key];
      var match = D.nearestOne(hex, matchOpts());

      host.appendChild(el('div', { class: 'viz-assign-row' }, [
        el('span', { class: 'viz-sw', style: { background: displayHex(hex) } }),
        el('span', {}, [
          el('b', { text: s.label }),
          el('span', { text: match ? match.color.code + ' · ' + match.color.name : hex })
        ]),
        el('button', {
          class: 'btn btn-accent btn-sm',
          title: match ? 'Заказать ' + match.color.code : 'Заказать этот цвет',
          disabled: !match,
          onclick: function () {
            if (!match) return;
            openColorCard(match.color, {
              sourceHex: hex,
              deltaE: match.deltaE,
              sourceLabel: s.label
            });
          }
        }, 'Купить')
      ]));
    });
  }

  /* ------------------------------------------------------------
   *  Отрисовка сцены
   * ---------------------------------------------------------- */

  /**
   * Помещения примерки. Все собираются из одной коробки (roomShell)
   * плюс своя обстановка — так добавить комнату стоит одной функции,
   * а перспектива, свет и плинтусы у всех одинаковые.
   *
   * win — сторона окна; null означает, что окна нет и свет приходит
   * из проёма, который рисует сама комната.
   */
  var ROOM_VIEWS = [
    { id: 'living',  label: 'Гостиная',  win: 'left',  day: 0.44 },
    { id: 'kitchen', label: 'Кухня',     win: 'left',  day: 0.46, tiles: true },
    { id: 'dining',  label: 'Столовая',  win: 'right', day: 0.44 },
    { id: 'bedroom', label: 'Спальня',   win: 'right', day: 0.42 },
    { id: 'office',  label: 'Кабинет',   win: 'left',  day: 0.40 },
    { id: 'bath',    label: 'Ванная',    win: 'right', day: 0.46, tiles: true },
    { id: 'hall',    label: 'Прихожая',  win: null,    day: 0.30, tiles: true,
      bx0: 310, bx1: 590 }
  ];

  function roomView(id) {
    return ROOM_VIEWS.filter(function (v) { return v.id === id; })[0] || ROOM_VIEWS[0];
  }

  /** Геометрия коробки: одна на все комнаты, кроме узкой прихожей. */
  function roomGeom(view) {
    return {
      bx0: view.bx0 || 250, bx1: view.bx1 || 650,
      by0: 150, by1: 400,
      vpx: 450, vpy: 280,
      win: view.win, day: view.day,
      tiles: !!view.tiles
    };
  }

  function drawRoom() {
    var stage = byId('vizStage');
    if (!stage) return;

    var P = {
      wall: displayHex(vizState.wall),
      accent: displayHex(vizState.accentWall),
      ceiling: displayHex(vizState.ceiling),
      trim: displayHex(vizState.trim),
      furniture: displayHex(vizState.furniture),
      door: displayHex(vizState.door),
      floor: displayHex(vizState.floor)
    };
    // подушки и бельё берут светлый или тёмный тон от мебели — чтобы не сливались
    P.soft = displayHex(C.readableTextColor(vizState.furniture) === '#FFFFFF'
      ? C.lighten(vizState.furniture, 34)
      : C.darken(vizState.furniture, 26));
    // корпусная мебель — древесный тон от пола: красить столик в цвет двери
    // означало синюю лужу посреди ковра
    P.wood = displayHex(C.darken(vizState.floor, 16));
    P.woodLit = displayHex(C.lighten(vizState.floor, 6));

    var view = roomView(vizState.view);
    var G = roomGeom(view);

    stage.innerHTML = [
      '<svg viewBox="0 0 900 560" role="img" aria-label="' + view.label + ' в выбранных цветах">',
      vizDefs(P),
      roomShell(P, G),
      (ROOM_BUILDERS[view.id] || ROOM_BUILDERS.living)(P, G),
      vizFinish(),
      '</svg>'
    ].join('');
  }


  // цвет дневного света из окна
  var DAY_TINT = '#EAF3FF';

  /** Общие определения: маски освещения, тени, зерно, свет из окна. */
  function vizDefs(P) {
    return [
      '<defs>',
      // дневной свет, льющийся из окна
      '<radialGradient id="apDay" cx=".5" cy=".5" r=".5">',
      '<stop offset="0" stop-color="' + DAY_TINT + '" stop-opacity=".55"/>',
      '<stop offset="1" stop-color="' + DAY_TINT + '" stop-opacity="0"/>',
      '</radialGradient>',
      // свет из окна — слева направо
      '<linearGradient id="apLit" x1="0" y1="0" x2="1" y2="0">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".30"/>',
      '<stop offset=".55" stop-color="#FFFFFF" stop-opacity=".05"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".14"/>',
      '</linearGradient>',
      // противоположная стена — в полутени
      '<linearGradient id="apShade" x1="0" y1="0" x2="1" y2="0">',
      '<stop offset="0" stop-color="#000000" stop-opacity=".20"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".05"/>',
      '</linearGradient>',
      // дальняя стена: светлее сверху, тень к полу
      '<linearGradient id="apBack" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".14"/>',
      '<stop offset=".62" stop-color="#000000" stop-opacity="0"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".17"/>',
      '</linearGradient>',
      // потолок темнеет вглубь
      '<linearGradient id="apCeil" x1="0" y1="1" x2="0" y2="0">',
      '<stop offset="0" stop-color="#000000" stop-opacity=".16"/>',
      '<stop offset="1" stop-color="#FFFFFF" stop-opacity=".10"/>',
      '</linearGradient>',
      // пол светлее у окна
      '<linearGradient id="apFloor" x1="0" y1="0" x2=".9" y2=".4">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".22"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".22"/>',
      '</linearGradient>',
      // стекло
      '<linearGradient id="apGlass" x1="0" y1="0" x2=".15" y2="1">',
      '<stop offset="0" stop-color="#DCEBF5"/>',
      '<stop offset=".52" stop-color="#C6DCEA"/>',
      '<stop offset=".54" stop-color="#A9BFA6"/>',   // линия горизонта
      '<stop offset="1" stop-color="#8AA487"/>',
      '</linearGradient>',
      // блик по стеклу
      '<linearGradient id="apGlare" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".45"/>',
      '<stop offset=".45" stop-color="#FFFFFF" stop-opacity=".05"/>',
      '<stop offset="1" stop-color="#FFFFFF" stop-opacity=".22"/>',
      '</linearGradient>',
      // объём мягкой мебели
      '<linearGradient id="apSoft" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".20"/>',
      '<stop offset=".6" stop-color="#000000" stop-opacity="0"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".22"/>',
      '</linearGradient>',
      // затемнение по углам — без него комната плоская
      '<radialGradient id="apVign" cx=".5" cy=".46" r=".78">',
      '<stop offset=".55" stop-color="#000000" stop-opacity="0"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".26"/>',
      '</radialGradient>',
      '<filter id="apBlur" x="-30%" y="-30%" width="160%" height="160%">',
      '<feGaussianBlur stdDeviation="14"/>',
      '</filter>',
      '<filter id="apBlurS" x="-40%" y="-40%" width="180%" height="180%">',
      '<feGaussianBlur stdDeviation="6"/>',
      '</filter>',
      // матовое зерно: краска не бывает идеально гладкой
      '<filter id="apGrain">',
      '<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>',
      '<feColorMatrix type="saturate" values="0"/>',
      '</filter>',
      '</defs>'
    ].join('');
  }

  /** Доски пола, сходящиеся в точку схода. */
  function floorPlanks(vpx, vpy, backY, frontY, x0, x1, n) {
    var out = [];
    for (var i = 1; i < n; i++) {
      var xb = x0 + (x1 - x0) * (i / n);
      var t = (frontY - vpy) / (backY - vpy);
      var xf = vpx + (xb - vpx) * t;
      out.push('<line x1="' + xb.toFixed(1) + '" y1="' + backY + '" x2="' + xf.toFixed(1) + '" y2="' + frontY +
               '" stroke="#000000" stroke-opacity=".10" stroke-width="1.4"/>');
    }
    // поперечные стыки: к дальней стене чаще
    var steps = [0.10, 0.24, 0.41, 0.60, 0.82];
    steps.forEach(function (k) {
      var y = backY + (frontY - backY) * k;
      out.push('<line x1="0" y1="' + y.toFixed(1) + '" x2="900" y2="' + y.toFixed(1) +
               '" stroke="#000000" stroke-opacity=".07" stroke-width="1.2"/>');
    });
    return out.join('');
  }

  /** Финальный слой: виньетка и зерно поверх всей сцены. */
  function vizFinish() {
    return '<rect width="900" height="560" fill="url(#apVign)"/>' +
           '<rect width="900" height="560" filter="url(#apGrain)" opacity=".05" style="mix-blend-mode:multiply"/>';
  }

  /* ------------------------------------------------------------
   *  Коробка помещения
   * ---------------------------------------------------------- */

  /** Границы боковой стены по x: она сходится к дальней стене. */
  function wallEdges(G, side, x) {
    var t = side === 'left' ? x / G.bx0 : (900 - x) / (900 - G.bx1);
    return { top: G.by0 * t, bottom: 560 + (G.by1 - 560) * t };
  }

  /** Окно в боковой стене: рама, стекло и свет, который оно даёт. */
  function sideWindow(P, G) {
    if (!G.win) return '';
    var left = G.win === 'left';
    var xa = left ? Math.round(G.bx0 * 0.24) : Math.round(900 - (900 - G.bx1) * 0.24);
    var xb = left ? Math.round(G.bx0 * 0.76) : Math.round(900 - (900 - G.bx1) * 0.76);

    var a = wallEdges(G, G.win, xa), b = wallEdges(G, G.win, xb);
    var ha = a.bottom - a.top, hb = b.bottom - b.top;
    var ay0 = a.top + ha * 0.20, ay1 = a.top + ha * 0.72;
    var by = b.top + hb * 0.20, by1 = b.top + hb * 0.72;
    var r = function (v) { return Math.round(v); };

    var quad = r(xa) + ',' + r(ay0) + ' ' + r(xb) + ',' + r(by) + ' ' +
               r(xb) + ',' + r(by1) + ' ' + r(xa) + ',' + r(ay1);
    var mx = r((xa + xb) / 2), my0 = r((ay0 + by) / 2), my1 = r((ay1 + by1) / 2);
    var day = G.day;
    // свет уходит вглубь комнаты — от дальнего края проёма к центру
    var shaft = xb + (left ? 130 : -130);

    return [
      '<polygon points="' + quad + '" fill="url(#apGlass)"/>',
      '<polygon points="' + quad + '" fill="url(#apGlare)"/>',
      '<polygon points="' + quad + '" fill="none" stroke="' + P.trim + '" stroke-width="12" stroke-linejoin="round"/>',
      '<line x1="' + mx + '" y1="' + my0 + '" x2="' + mx + '" y2="' + my1 + '" stroke="' + P.trim + '" stroke-width="7"/>',
      '<line x1="' + r(xa) + '" y1="' + r((ay0 + ay1) / 2) + '" x2="' + r(xb) + '" y2="' + r((by + by1) / 2) +
        '" stroke="' + P.trim + '" stroke-width="6"/>',
      '<polygon points="' + r(xb) + ',' + r(by) + ' ' + r(shaft) + ',' + r(by + 53) + ' ' +
        r(shaft) + ',' + r(by1 - 18) + ' ' + r(xb) + ',' + r(by1) +
        '" fill="' + DAY_TINT + '" opacity="' + (day * 0.62).toFixed(3) + '" filter="url(#apBlur)"/>',
      '<ellipse cx="' + r((xa + xb) / 2) + '" cy="' + r((ay0 + by1) / 2) + '" rx="150" ry="190" ' +
        'fill="url(#apDay)" opacity="' + (day * 1.5).toFixed(3) + '"/>'
    ].join('');
  }

  /** Пятно дневного света на полу под окном. */
  function daylightPool(G) {
    if (!G.win) return '';
    var w = G.bx1 - G.bx0;
    var pts = [
      [G.bx0 * 0.5, 560],
      [G.bx0 + w * 0.35, G.by1 + 18],
      [G.bx0 + w * 0.75, G.by1 + 22],
      [G.bx0 * 0.5 + 220, 560]
    ];
    if (G.win === 'right') pts = pts.map(function (p) { return [900 - p[0], p[1]]; });
    return '<polygon points="' + pts.map(function (p) { return Math.round(p[0]) + ',' + Math.round(p[1]); }).join(' ') +
           '" fill="' + DAY_TINT + '" opacity="' + G.day + '" filter="url(#apBlur)"/>';
  }

  /**
   * Потолок, пол, три стены, карниз, плинтус и окно.
   * Дальняя стена — акцентная, боковые — основной цвет: со стороны окна
   * светлее, с противоположной в полутени.
   */
  function roomShell(P, G) {
    var bx0 = G.bx0, bx1 = G.bx1, by0 = G.by0, by1 = G.by1;
    var ceilPts = '0,0 900,0 ' + bx1 + ',' + by0 + ' ' + bx0 + ',' + by0;
    var floorPts = '0,560 900,560 ' + bx1 + ',' + by1 + ' ' + bx0 + ',' + by1;
    var leftPts = '0,0 ' + bx0 + ',' + by0 + ' ' + bx0 + ',' + by1 + ' 0,560';
    var rightPts = '900,0 ' + bx1 + ',' + by0 + ' ' + bx1 + ',' + by1 + ' 900,560';
    var litLeft = G.win !== 'right';

    return [
      // потолок
      '<polygon points="' + ceilPts + '" fill="' + P.ceiling + '"/>',
      '<polygon points="' + ceilPts + '" fill="url(#apCeil)"/>',

      // пол
      '<polygon points="' + floorPts + '" fill="' + P.floor + '"/>',
      '<clipPath id="apFloorClip"><polygon points="' + floorPts + '"/></clipPath>',
      '<g clip-path="url(#apFloorClip)">',
      floorPlanks(G.vpx, G.vpy, by1, 560, bx0, bx1, G.tiles ? 9 : 13),
      daylightPool(G),
      '<polygon points="' + floorPts + '" fill="url(#apFloor)"/>',
      '</g>',

      // боковые стены
      '<polygon points="' + leftPts + '" fill="' + P.wall + '"/>',
      '<polygon points="' + leftPts + '" fill="url(#' + (litLeft ? 'apLit' : 'apShade') + ')"/>',
      '<polygon points="' + rightPts + '" fill="' + P.wall + '"/>',
      litLeft
        ? '<polygon points="' + rightPts + '" fill="url(#apShade)"/>'
        : '<polygon points="' + rightPts + '" fill="url(#apLit)" transform="translate(900,0) scale(-1,1)"/>',

      // дальняя (акцентная) стена
      '<rect x="' + bx0 + '" y="' + by0 + '" width="' + (bx1 - bx0) + '" height="' + (by1 - by0) + '" fill="' + P.accent + '"/>',
      '<rect x="' + bx0 + '" y="' + by0 + '" width="' + (bx1 - bx0) + '" height="' + (by1 - by0) + '" fill="url(#apBack)"/>',
      // мягкая тень в стыках стен — воздух в углах
      '<rect x="' + bx0 + '" y="' + by0 + '" width="26" height="' + (by1 - by0) + '" fill="#000" opacity=".10" filter="url(#apBlurS)"/>',
      '<rect x="' + (bx1 - 26) + '" y="' + by0 + '" width="26" height="' + (by1 - by0) + '" fill="#000" opacity=".10" filter="url(#apBlurS)"/>',

      // карниз и плинтус
      '<polygon points="' + ceilPts + '" fill="none" stroke="' + P.trim + '" stroke-width="7" stroke-opacity=".9"/>',
      '<rect x="' + bx0 + '" y="' + (by1 - 12) + '" width="' + (bx1 - bx0) + '" height="12" fill="' + P.trim + '"/>',
      '<polygon points="0,560 ' + bx0 + ',' + by1 + ' ' + bx0 + ',' + (by1 - 12) + ' 0,536" fill="' + P.trim + '"/>',
      '<polygon points="900,560 ' + bx1 + ',' + by1 + ' ' + bx1 + ',' + (by1 - 12) + ' 900,536" fill="' + P.trim + '"/>',

      sideWindow(P, G)
    ].join('');
  }

  /** Тень под предметом: без неё мебель висит в воздухе. */
  function contactShadow(cx, cy, rx, ry, opacity) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry +
           '" fill="#000" opacity="' + (opacity || 0.22) + '" filter="url(#apBlurS)"/>';
  }

  /* ------------------------------------------------------------
   *  Обстановка помещений
   * ---------------------------------------------------------- */

  var ROOM_BUILDERS = {

    /* --- Гостиная --- */
    living: function (P) {
      return [
        // дверь в правой стене
        '<polygon points="700,176 840,123 840,521 700,432" fill="' + P.door + '"/>',
        '<polygon points="700,176 840,123 840,521 700,432" fill="url(#apShade)"/>',
        '<polygon points="700,176 840,123 840,521 700,432" fill="none" stroke="' + P.trim + '" stroke-width="9" stroke-linejoin="round"/>',
        '<polygon points="722,214 820,177 820,320 722,338" fill="#000" opacity=".07"/>',
        '<circle cx="716" cy="330" r="6" fill="' + P.trim + '"/>',

        // ковёр
        '<polygon points="315,414 590,414 700,528 195,528" fill="' + P.soft + '" opacity=".38"/>',
        '<polygon points="315,414 590,414 700,528 195,528" fill="url(#apFloor)" opacity=".7"/>',
        '<polygon points="336,424 570,424 660,512 236,512" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="3"/>',

        // диван
        contactShadow(452, 424, 180, 20),
        '<rect x="300" y="300" width="304" height="70" rx="14" fill="' + P.furniture + '"/>',
        '<rect x="300" y="300" width="304" height="70" rx="14" fill="url(#apSoft)"/>',
        '<rect x="288" y="352" width="328" height="62" rx="16" fill="' + P.furniture + '"/>',
        '<rect x="288" y="352" width="328" height="62" rx="16" fill="url(#apSoft)"/>',
        '<rect x="288" y="346" width="34" height="70" rx="14" fill="' + P.furniture + '"/>',
        '<rect x="582" y="346" width="34" height="70" rx="14" fill="' + P.furniture + '"/>',
        '<rect x="288" y="346" width="34" height="70" rx="14" fill="url(#apSoft)"/>',
        '<rect x="582" y="346" width="34" height="70" rx="14" fill="url(#apSoft)"/>',
        '<rect x="338" y="312" width="52" height="46" rx="10" fill="' + P.soft + '" transform="rotate(-6 364 335)"/>',
        '<rect x="516" y="312" width="52" height="46" rx="10" fill="' + P.soft + '" transform="rotate(7 542 335)"/>',
        '<rect x="316" y="414" width="12" height="18" rx="3" fill="' + P.door + '"/>',
        '<rect x="576" y="414" width="12" height="18" rx="3" fill="' + P.door + '"/>',

        // журнальный столик
        contactShadow(452, 492, 88, 15),
        '<rect x="404" y="466" width="9" height="26" rx="3" fill="' + P.wood + '"/>',
        '<rect x="491" y="466" width="9" height="26" rx="3" fill="' + P.wood + '"/>',
        '<ellipse cx="452" cy="468" rx="82" ry="20" fill="' + P.wood + '"/>',
        '<ellipse cx="452" cy="463" rx="82" ry="20" fill="' + P.woodLit + '"/>',
        '<ellipse cx="452" cy="463" rx="82" ry="20" fill="url(#apSoft)"/>',

        // картины
        '<rect x="292" y="186" width="82" height="66" rx="3" fill="' + P.trim + '"/>',
        '<rect x="300" y="194" width="66" height="50" fill="' + P.door + '" opacity=".55"/>',
        '<rect x="386" y="176" width="60" height="86" rx="3" fill="' + P.trim + '"/>',
        '<rect x="393" y="184" width="46" height="70" fill="' + P.furniture + '" opacity=".7"/>',

        // растение
        contactShadow(672, 452, 34, 12, 0.2),
        '<path d="M654 446h36l-6-46h-24z" fill="' + P.trim + '"/>',
        '<path d="M672 400c-26-10-36-42-26-66 24 6 38 32 26 66z" fill="#5C6B4F"/>',
        '<path d="M672 400c24-14 30-46 18-68-24 10-32 38-18 68z" fill="#7B8F6C"/>',
        '<path d="M672 402c-14-22-6-52 8-64 8 22 6 46-8 64z" fill="#6E8460"/>',

        // торшер
        contactShadow(232, 470, 26, 9, 0.18),
        '<rect x="228" y="352" width="6" height="114" fill="' + P.door + '"/>',
        '<path d="M206 352h52l-10-42h-32z" fill="' + P.soft + '"/>',
        '<ellipse cx="232" cy="352" rx="26" ry="7" fill="#EFEADF" opacity=".55"/>'
      ].join('');
    },

    /* --- Кухня --- */
    kitchen: function (P) {
      var out = [
        // фартук: плитка от столешницы до навесных шкафов
        '<rect x="250" y="252" width="400" height="72" fill="' + P.trim + '"/>',
        '<rect x="250" y="252" width="400" height="72" fill="url(#apBack)"/>'
      ];
      for (var x = 282; x < 650; x += 32) {
        out.push('<line x1="' + x + '" y1="252" x2="' + x + '" y2="324" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      }
      out.push('<line x1="250" y1="288" x2="650" y2="288" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');

      return out.concat([
        // навесные шкафы только слева: справа открытые полки,
        // иначе акцентная стена скрывается за фасадами почти целиком
        '<rect x="256" y="186" width="168" height="80" rx="4" fill="' + P.furniture + '"/>',
        '<rect x="256" y="186" width="168" height="80" rx="4" fill="url(#apSoft)"/>',
        '<line x1="340" y1="188" x2="340" y2="264" stroke="#000" stroke-opacity=".14" stroke-width="2"/>',
        '<rect x="314" y="252" width="52" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="524" y="206" width="120" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="524" y="250" width="120" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="536" y="176" width="14" height="30" rx="2" fill="' + P.wood + '"/>',
        '<rect x="554" y="182" width="12" height="24" rx="2" fill="' + P.soft + '"/>',
        '<rect x="572" y="178" width="16" height="28" rx="2" fill="' + P.furniture + '"/>',
        '<rect x="540" y="224" width="18" height="26" rx="2" fill="' + P.soft + '"/>',
        '<rect x="564" y="220" width="14" height="30" rx="2" fill="' + P.wood + '"/>',
        // вытяжка
        '<path d="M446 186h76l-12 44h-52z" fill="' + P.trim + '"/>',
        '<rect x="472" y="230" width="24" height="24" fill="' + P.trim + '"/>',

        // нижние шкафы и столешница
        '<rect x="252" y="330" width="396" height="70" fill="' + P.furniture + '"/>',
        '<rect x="252" y="330" width="396" height="70" fill="url(#apSoft)"/>',
        '<rect x="250" y="322" width="400" height="12" rx="2" fill="' + P.wood + '"/>',
        '<rect x="250" y="322" width="400" height="5" rx="2" fill="' + P.woodLit + '"/>',
        '<line x1="386" y1="334" x2="386" y2="398" stroke="#000" stroke-opacity=".14" stroke-width="2"/>',
        '<line x1="520" y1="334" x2="520" y2="398" stroke="#000" stroke-opacity=".14" stroke-width="2"/>',
        '<rect x="292" y="346" width="54" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="426" y="346" width="54" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="560" y="346" width="54" height="5" rx="2.5" fill="' + P.trim + '"/>',

        // мойка и смеситель
        '<rect x="300" y="312" width="72" height="14" rx="4" fill="#C9CDCB"/>',
        '<path d="M340 312v-26c0-8 8-12 16-12h6" stroke="' + P.trim + '" stroke-width="5" fill="none" stroke-linecap="round"/>',

        // плита
        '<rect x="466" y="314" width="48" height="10" rx="3" fill="#3B3E3A"/>',

        // холодильник у правого края
        contactShadow(690, 470, 62, 14),
        '<polygon points="660,214 790,178 790,486 660,414" fill="' + P.door + '"/>',
        '<polygon points="660,214 790,178 790,486 660,414" fill="url(#apShade)"/>',
        '<line x1="660" y1="300" x2="790" y2="276" stroke="#000" stroke-opacity=".2" stroke-width="3"/>',
        '<rect x="668" y="252" width="6" height="40" rx="3" fill="' + P.trim + '"/>',
        '<rect x="668" y="318" width="6" height="40" rx="3" fill="' + P.trim + '"/>',

        // остров: без него табуреты стояли посреди пола сами по себе
        contactShadow(452, 536, 190, 20),
        '<rect x="300" y="452" width="304" height="76" rx="4" fill="' + P.furniture + '"/>',
        '<rect x="300" y="452" width="304" height="76" rx="4" fill="url(#apSoft)"/>',
        '<rect x="292" y="440" width="320" height="14" rx="3" fill="' + P.wood + '"/>',
        '<rect x="292" y="440" width="320" height="6" rx="3" fill="' + P.woodLit + '"/>',
        '<line x1="452" y1="456" x2="452" y2="526" stroke="#000" stroke-opacity=".14" stroke-width="2"/>',
        contactShadow(268, 470, 30, 10, 0.2),
        '<rect x="258" y="424" width="20" height="46" rx="5" fill="' + P.wood + '"/>',
        '<ellipse cx="268" cy="424" rx="28" ry="10" fill="' + P.door + '"/>',
        contactShadow(640, 474, 30, 10, 0.2),
        '<rect x="630" y="426" width="20" height="48" rx="5" fill="' + P.wood + '"/>',
        '<ellipse cx="640" cy="426" rx="28" ry="10" fill="' + P.door + '"/>'
      ]).join('');
    },

    /* --- Столовая --- */
    dining: function (P) {
      return [
        // буфет у дальней стены
        contactShadow(340, 404, 96, 12),
        '<rect x="252" y="318" width="176" height="82" rx="5" fill="' + P.door + '"/>',
        '<rect x="252" y="318" width="176" height="82" rx="5" fill="url(#apSoft)"/>',
        '<line x1="340" y1="322" x2="340" y2="396" stroke="#000" stroke-opacity=".16" stroke-width="2"/>',
        '<rect x="292" y="352" width="34" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="356" y="352" width="34" height="5" rx="2.5" fill="' + P.trim + '"/>',

        // картина над буфетом
        '<rect x="286" y="196" width="112" height="86" rx="3" fill="' + P.trim + '"/>',
        '<rect x="294" y="204" width="96" height="70" fill="' + P.furniture + '" opacity=".62"/>',
        '<path d="M294 274l26-30 20 16 24-26 26 40z" fill="' + P.door + '" opacity=".5"/>',

        // подвес над столом
        '<line x1="500" y1="0" x2="500" y2="188" stroke="' + P.door + '" stroke-width="4"/>',
        '<path d="M462 232h76l-20-44h-36z" fill="' + P.soft + '"/>',
        '<ellipse cx="500" cy="232" rx="38" ry="9" fill="#EFEADF" opacity=".6"/>',

        // стол
        contactShadow(470, 470, 176, 22),
        '<ellipse cx="470" cy="404" rx="168" ry="42" fill="' + P.wood + '"/>',
        '<ellipse cx="470" cy="398" rx="168" ry="42" fill="' + P.woodLit + '"/>',
        '<ellipse cx="470" cy="398" rx="168" ry="42" fill="url(#apSoft)"/>',
        '<rect x="458" y="404" width="24" height="58" fill="' + P.wood + '"/>',
        '<ellipse cx="470" cy="462" rx="52" ry="12" fill="' + P.wood + '"/>',

        // стулья за столом
        '<rect x="342" y="300" width="52" height="70" rx="8" fill="' + P.furniture + '"/>',
        '<rect x="342" y="300" width="52" height="70" rx="8" fill="url(#apSoft)"/>',
        '<rect x="546" y="300" width="52" height="70" rx="8" fill="' + P.furniture + '"/>',
        '<rect x="546" y="300" width="52" height="70" rx="8" fill="url(#apSoft)"/>',

        // стулья перед столом, спинками к зрителю
        contactShadow(360, 520, 46, 13, 0.2),
        '<rect x="316" y="410" width="88" height="96" rx="10" fill="' + P.furniture + '"/>',
        '<rect x="316" y="410" width="88" height="96" rx="10" fill="url(#apSoft)"/>',
        '<rect x="330" y="504" width="12" height="20" fill="' + P.wood + '"/>',
        '<rect x="378" y="504" width="12" height="20" fill="' + P.wood + '"/>',
        contactShadow(580, 520, 46, 13, 0.2),
        '<rect x="536" y="410" width="88" height="96" rx="10" fill="' + P.furniture + '"/>',
        '<rect x="536" y="410" width="88" height="96" rx="10" fill="url(#apSoft)"/>',
        '<rect x="550" y="504" width="12" height="20" fill="' + P.wood + '"/>',
        '<rect x="598" y="504" width="12" height="20" fill="' + P.wood + '"/>',

        // ваза на столе
        '<path d="M462 398c-6-16-2-30 8-34 10 4 14 18 8 34z" fill="' + P.trim + '"/>'
      ].join('');
    },

    /* --- Спальня --- */
    bedroom: function (P) {
      return [
        // ковёр
        '<polygon points="300,404 606,404 726,536 178,536" fill="' + P.soft + '" opacity=".5"/>',
        '<polygon points="300,404 606,404 726,536 178,536" fill="url(#apFloor)"/>',

        // изголовье
        '<rect x="330" y="212" width="246" height="112" rx="12" fill="' + P.furniture + '"/>',
        '<rect x="330" y="212" width="246" height="112" rx="12" fill="url(#apSoft)"/>',
        '<line x1="412" y1="222" x2="412" y2="314" stroke="#000" stroke-opacity=".10" stroke-width="3"/>',
        '<line x1="494" y1="222" x2="494" y2="314" stroke="#000" stroke-opacity=".10" stroke-width="3"/>',

        // кровать
        contactShadow(452, 452, 200, 24),
        '<polygon points="336,318 570,318 636,446 268,446" fill="' + P.soft + '"/>',
        '<polygon points="336,318 570,318 636,446 268,446" fill="url(#apSoft)"/>',
        '<polygon points="336,318 570,318 592,362 316,362" fill="#FFFFFF" opacity=".42"/>',
        '<polygon points="316,362 592,362 600,378 308,378" fill="#000" opacity=".07"/>',
        '<polygon points="268,428 636,428 644,452 260,452" fill="' + P.furniture + '"/>',
        '<rect x="352" y="288" width="88" height="40" rx="12" fill="#FFFFFF" opacity=".88"/>',
        '<rect x="466" y="288" width="88" height="40" rx="12" fill="#FFFFFF" opacity=".88"/>',
        '<rect x="272" y="450" width="14" height="22" rx="3" fill="' + P.door + '"/>',
        '<rect x="620" y="450" width="14" height="22" rx="3" fill="' + P.door + '"/>',

        // тумбы и лампы
        contactShadow(249, 418, 44, 11),
        '<rect x="218" y="404" width="8" height="14" fill="' + P.wood + '"/>',
        '<rect x="272" y="404" width="8" height="14" fill="' + P.wood + '"/>',
        '<rect x="212" y="336" width="74" height="72" rx="7" fill="' + P.door + '"/>',
        '<rect x="212" y="336" width="74" height="72" rx="7" fill="url(#apSoft)"/>',
        '<line x1="212" y1="372" x2="286" y2="372" stroke="#000" stroke-opacity=".18" stroke-width="2"/>',
        '<rect x="246" y="296" width="6" height="40" fill="' + P.trim + '"/>',
        '<path d="M228 296h44l-8-30h-28z" fill="' + P.soft + '"/>',
        '<ellipse cx="249" cy="298" rx="22" ry="6" fill="#EFEADF" opacity=".6"/>',

        contactShadow(653, 418, 44, 11),
        '<rect x="622" y="404" width="8" height="14" fill="' + P.wood + '"/>',
        '<rect x="676" y="404" width="8" height="14" fill="' + P.wood + '"/>',
        '<rect x="616" y="336" width="74" height="72" rx="7" fill="' + P.door + '"/>',
        '<rect x="616" y="336" width="74" height="72" rx="7" fill="url(#apSoft)"/>',
        '<line x1="616" y1="372" x2="690" y2="372" stroke="#000" stroke-opacity=".18" stroke-width="2"/>',
        '<rect x="650" y="296" width="6" height="40" fill="' + P.trim + '"/>',
        '<path d="M632 296h44l-8-30h-28z" fill="' + P.soft + '"/>',
        '<ellipse cx="653" cy="298" rx="22" ry="6" fill="#EFEADF" opacity=".6"/>',

        // картина над изголовьем
        '<rect x="386" y="160" width="128" height="46" rx="3" fill="' + P.trim + '"/>',
        '<rect x="394" y="168" width="112" height="30" fill="' + P.wood + '" opacity=".65"/>',
        '<path d="M394 198l30-16 22 10 26-18 34 24z" fill="' + P.door + '" opacity=".55"/>'
      ].join('');
    },

    /* --- Кабинет --- */
    office: function (P) {
      var out = [
        // стеллаж вдоль дальней стены
        contactShadow(560, 406, 106, 12),
        '<rect x="452" y="196" width="196" height="204" rx="4" fill="' + P.door + '"/>',
        '<rect x="452" y="196" width="196" height="204" rx="4" fill="url(#apSoft)"/>'
      ];
      // полки с книгами
      [232, 284, 336].forEach(function (y, row) {
        out.push('<rect x="458" y="' + y + '" width="184" height="6" fill="' + P.trim + '" opacity=".8"/>');
        for (var i = 0; i < 11; i++) {
          var h = 26 + ((i * 7 + row * 5) % 14);
          var fill = i % 3 === 0 ? P.furniture : i % 3 === 1 ? P.soft : P.wood;
          out.push('<rect x="' + (464 + i * 16) + '" y="' + (y - h) + '" width="' + (9 + (i % 3)) + '" height="' + h +
                   '" rx="1.5" fill="' + fill + '"/>');
        }
      });

      return out.concat([
        // стол у окна
        contactShadow(300, 486, 118, 16),
        '<rect x="196" y="376" width="212" height="14" rx="3" fill="' + P.wood + '"/>',
        '<rect x="196" y="376" width="212" height="6" rx="3" fill="' + P.woodLit + '"/>',
        '<rect x="204" y="390" width="12" height="92" fill="' + P.wood + '"/>',
        '<rect x="388" y="390" width="12" height="92" fill="' + P.wood + '"/>',
        '<rect x="228" y="390" width="140" height="52" rx="4" fill="' + P.furniture + '"/>',
        '<rect x="228" y="390" width="140" height="52" rx="4" fill="url(#apSoft)"/>',
        '<rect x="246" y="412" width="46" height="5" rx="2.5" fill="' + P.trim + '"/>',

        // монитор
        '<rect x="250" y="286" width="118" height="76" rx="5" fill="#2E312C"/>',
        '<rect x="256" y="292" width="106" height="64" rx="3" fill="#48514B"/>',
        '<rect x="256" y="292" width="106" height="64" rx="3" fill="url(#apGlare)"/>',
        '<rect x="300" y="362" width="18" height="14" fill="#2E312C"/>',
        '<rect x="282" y="374" width="54" height="6" rx="3" fill="#2E312C"/>',

        // лампа на столе
        '<rect x="378" y="336" width="5" height="42" fill="' + P.trim + '"/>',
        '<path d="M362 336h40l-8-24h-24z" fill="' + P.soft + '"/>',
        '<ellipse cx="382" cy="338" rx="20" ry="6" fill="#EFEADF" opacity=".6"/>',

        // кресло
        contactShadow(330, 528, 62, 15),
        '<rect x="286" y="418" width="90" height="94" rx="12" fill="' + P.furniture + '"/>',
        '<rect x="286" y="418" width="90" height="94" rx="12" fill="url(#apSoft)"/>',
        '<rect x="324" y="512" width="14" height="20" fill="' + P.door + '"/>',
        '<rect x="296" y="530" width="70" height="8" rx="4" fill="' + P.door + '"/>',

        // ковёр
        '<polygon points="360,436 640,436 736,540 268,540" fill="' + P.soft + '" opacity=".32"/>',
        '<polygon points="360,436 640,436 736,540 268,540" fill="url(#apFloor)" opacity=".7"/>'
      ]).join('');
    },

    /* --- Ванная --- */
    bath: function (P) {
      var out = [
        // плитка до половины стены
        '<rect x="250" y="270" width="400" height="130" fill="' + P.trim + '"/>',
        '<rect x="250" y="270" width="400" height="130" fill="url(#apBack)"/>'
      ];
      for (var x = 286; x < 650; x += 36) {
        out.push('<line x1="' + x + '" y1="270" x2="' + x + '" y2="400" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      }
      [312, 356].forEach(function (y) {
        out.push('<line x1="250" y1="' + y + '" x2="650" y2="' + y + '" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      });

      return out.concat([
        // тумба с раковиной
        contactShadow(392, 406, 82, 11),
        '<rect x="316" y="330" width="152" height="70" rx="5" fill="' + P.furniture + '"/>',
        '<rect x="316" y="330" width="152" height="70" rx="5" fill="url(#apSoft)"/>',
        '<line x1="392" y1="334" x2="392" y2="396" stroke="#000" stroke-opacity=".16" stroke-width="2"/>',
        '<rect x="310" y="322" width="164" height="11" rx="3" fill="' + P.trim + '"/>',
        '<ellipse cx="392" cy="322" rx="44" ry="11" fill="#F2F4F3"/>',
        '<path d="M392 316v-22c0-7 7-11 14-11h5" stroke="#B9BEBB" stroke-width="5" fill="none" stroke-linecap="round"/>',

        // зеркало
        '<rect x="330" y="188" width="124" height="94" rx="6" fill="#DCE6EC"/>',
        '<rect x="330" y="188" width="124" height="94" rx="6" fill="url(#apGlare)"/>',
        '<rect x="330" y="188" width="124" height="94" rx="6" fill="none" stroke="' + P.trim + '" stroke-width="6"/>',
        '<circle cx="486" cy="222" r="11" fill="#EFEADF" opacity=".75"/>',
        '<circle cx="298" cy="222" r="11" fill="#EFEADF" opacity=".75"/>',

        // ванна вдоль левой стены
        contactShadow(230, 510, 132, 20),
        '<path d="M120 400h220v66a26 26 0 0 1-26 26H146a26 26 0 0 1-26-26z" fill="#F4F6F5"/>',
        '<path d="M120 400h220v66a26 26 0 0 1-26 26H146a26 26 0 0 1-26-26z" fill="url(#apSoft)"/>',
        '<rect x="112" y="390" width="236" height="14" rx="7" fill="#FFFFFF"/>',
        '<path d="M332 390v-30c0-8-8-12-16-12h-10" stroke="#B9BEBB" stroke-width="6" fill="none" stroke-linecap="round"/>',

        // унитаз справа
        contactShadow(600, 496, 44, 12),
        '<rect x="574" y="330" width="52" height="66" rx="6" fill="#F4F6F5"/>',
        '<ellipse cx="600" cy="440" rx="40" ry="26" fill="#F4F6F5"/>',
        '<ellipse cx="600" cy="436" rx="40" ry="26" fill="url(#apSoft)"/>',
        '<rect x="586" y="396" width="28" height="34" fill="#EDEFEE"/>',

        // полотенце и штанга
        '<rect x="500" y="300" width="86" height="5" rx="2.5" fill="' + P.trim + '"/>',
        '<rect x="512" y="302" width="30" height="72" rx="4" fill="' + P.soft + '"/>',
        '<rect x="548" y="302" width="30" height="60" rx="4" fill="' + P.furniture + '"/>'
      ]).join('');
    },

    /* --- Прихожая --- */
    hall: function (P, G) {
      var bx0 = G.bx0, bx1 = G.bx1;
      return [
        // входная дверь в дальней стене
        '<rect x="' + (bx0 + 46) + '" y="176" width="188" height="224" rx="4" fill="' + P.door + '"/>',
        '<rect x="' + (bx0 + 46) + '" y="176" width="188" height="224" rx="4" fill="url(#apSoft)"/>',
        '<rect x="' + (bx0 + 46) + '" y="176" width="188" height="224" rx="4" fill="none" stroke="' + P.trim + '" stroke-width="9"/>',
        '<rect x="' + (bx0 + 74) + '" y="206" width="132" height="70" rx="3" fill="#000" opacity=".08"/>',
        '<rect x="' + (bx0 + 74) + '" y="296" width="132" height="76" rx="3" fill="#000" opacity=".08"/>',
        '<circle cx="' + (bx0 + 214) + '" cy="296" r="7" fill="' + P.trim + '"/>',

        // освещённый проём в комнату — единственный источник света
        '<polygon points="720,180 860,126 860,520 720,436" fill="#F6F1E6"/>',
        '<polygon points="720,180 860,126 860,520 720,436" fill="url(#apGlare)"/>',
        '<polygon points="720,180 860,126 860,520 720,436" fill="none" stroke="' + P.trim + '" stroke-width="10" stroke-linejoin="round"/>',
        '<polygon points="720,180 600,228 600,410 720,436" fill="' + DAY_TINT + '" opacity="' + (G.day * 0.7).toFixed(3) + '" filter="url(#apBlur)"/>',
        '<polygon points="760,560 660,430 560,436 620,560" fill="' + DAY_TINT + '" opacity="' + G.day + '" filter="url(#apBlur)"/>',

        // консоль с зеркалом слева
        contactShadow(180, 470, 74, 13),
        '<rect x="112" y="376" width="140" height="12" rx="3" fill="' + P.wood + '"/>',
        '<rect x="112" y="376" width="140" height="5" rx="3" fill="' + P.woodLit + '"/>',
        '<rect x="122" y="388" width="10" height="76" fill="' + P.wood + '"/>',
        '<rect x="232" y="388" width="10" height="76" fill="' + P.wood + '"/>',
        '<rect x="140" y="196" width="96" height="152" rx="48" fill="#DCE6EC"/>',
        '<rect x="140" y="196" width="96" height="152" rx="48" fill="url(#apGlare)"/>',
        '<rect x="140" y="196" width="96" height="152" rx="48" fill="none" stroke="' + P.trim + '" stroke-width="6"/>',

        // вешалка с одеждой у правой стены
        '<rect x="' + (bx1 + 22) + '" y="212" width="104" height="7" rx="3.5" fill="' + P.trim + '"/>',
        '<path d="M' + (bx1 + 44) + ' 219 l-14 96 h44 l-12 -96z" fill="' + P.furniture + '"/>',
        '<path d="M' + (bx1 + 44) + ' 219 l-14 96 h44 l-12 -96z" fill="url(#apSoft)"/>',
        '<path d="M' + (bx1 + 92) + ' 219 l-16 112 h48 l-14 -112z" fill="' + P.soft + '"/>',
        '<path d="M' + (bx1 + 92) + ' 219 l-16 112 h48 l-14 -112z" fill="url(#apSoft)"/>',

        // банкетка и обувь
        contactShadow(452, 520, 88, 14),
        '<rect x="374" y="452" width="156" height="26" rx="8" fill="' + P.furniture + '"/>',
        '<rect x="374" y="452" width="156" height="26" rx="8" fill="url(#apSoft)"/>',
        '<rect x="386" y="478" width="12" height="34" fill="' + P.wood + '"/>',
        '<rect x="506" y="478" width="12" height="34" fill="' + P.wood + '"/>',
        '<rect x="398" y="500" width="40" height="14" rx="6" fill="' + P.door + '" opacity=".8"/>',
        '<rect x="452" y="502" width="40" height="14" rx="6" fill="' + P.door + '" opacity=".6"/>'
      ].join('');
    }
  };

  /* ============================================================
   *  Калькулятор расхода
   * ============================================================ */

  function initCalculator() {
    var form = byId('calcForm');
    if (!form) return;

    var surfaceSel = byId('calcSurface');
    if (surfaceSel && !surfaceSel.options.length) {
      D.SURFACES.forEach(function (s) {
        surfaceSel.appendChild(el('option', { value: s.id }, s.label));
      });
    }

    var productSel = byId('calcProduct');
    if (productSel && !productSel.options.length) {
      var lines = {};
      D.PRODUCTS.forEach(function (p) { (lines[p.line] = lines[p.line] || []).push(p); });
      Object.keys(lines).forEach(function (line) {
        var group = el('optgroup', { label: line });
        lines[line].forEach(function (p) {
          group.appendChild(el('option', { value: p.sku }, p.name + ' · ' + p.sheen));
        });
        productSel.appendChild(group);
      });
    }

    // Площадь стен считается по размерам, но её можно ввести руками:
    // у клиента часто есть готовая цифра из сметы, а длину и ширину
    // комнаты сложной формы он всё равно не задаст тремя числами.
    var areaManual = false;
    var areaInput = byId('calcArea');
    var areaReset = byId('calcAreaReset');

    if (areaInput) {
      areaInput.addEventListener('input', function () { areaManual = true; syncArea(); });
    }
    ['calcLength', 'calcWidth', 'calcHeight'].forEach(function (id) {
      var node = byId(id);
      if (node) node.addEventListener('input', function () { areaManual = false; syncArea(); });
    });
    if (areaReset) {
      areaReset.addEventListener('click', function () { areaManual = false; syncArea(); recalc(); });
    }

    function wallsBySize() {
      return 2 * (num('calcLength') + num('calcWidth')) * num('calcHeight');
    }

    /** Держит поле площади и подпись под ним в согласии с режимом ввода. */
    function syncArea() {
      if (!areaInput) return;
      if (!areaManual) areaInput.value = fmt(wallsBySize(), 1).replace(',', '.');
      if (areaReset) areaReset.hidden = !areaManual;
      var note = byId('calcAreaNote');
      if (note) {
        note.textContent = areaManual
          ? 'Введено вручную — размеры комнаты не учитываются'
          : 'Посчитано по размерам: 2 × (длина + ширина) × высота';
      }
    }

    syncArea();
    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });
    recalc();

    // калькулятор показывает выбранный цвет — пересчитываем при его смене
    document.addEventListener('archipaint:activecolor', recalc);

    function currentProduct() {
      return D.getProduct(productSel ? productSel.value : null) || D.PRODUCTS[0];
    }

    /** Цвет, в который будет заколерована краска. */
    function currentColor() {
      if (!S.activeHex) return null;
      var match = D.nearestOne(S.activeHex, matchOpts());
      return match ? match.color : null;
    }

    function renderColorChip() {
      var host = byId('calcColor');
      if (!host) return;
      clear(host);
      var color = currentColor();
      if (!color) {
        host.appendChild(el('span', { class: 'fine', text: 'Не выбран — посчитаем объём базы' }));
        return;
      }
      host.appendChild(el('span', { class: 'calc-color-sw', style: { background: displayHex(color.hex) } }));
      host.appendChild(el('span', {}, [
        el('b', { text: color.code }),
        el('span', { class: 'fine', text: ' ' + color.name })
      ]));
    }

    function recalc() {
      var out = byId('calcOut');
      if (!out) return;

      var length = num('calcLength');
      var width = num('calcWidth');
      var height = num('calcHeight');
      var openings = num('calcOpenings');
      var coats = num('calcCoats') || 2;
      var includeCeiling = byId('calcCeiling') && byId('calcCeiling').checked;
      var panels = byId('calcPanels') && byId('calcPanels').checked;

      var surface = D.SURFACES.filter(function (s) {
        return s.id === (surfaceSel ? surfaceSel.value : 'plaster');
      })[0] || D.SURFACES[0];

      var product = currentProduct();
      var note = byId('calcProductNote');
      if (note) note.textContent = product.use + ' · ' + product.coverage + ' м²/л в один слой';
      renderColorChip();

      var wallArea = areaManual ? num('calcArea') : wallsBySize();
      if (includeCeiling) wallArea += length * width;

      // 3D-панели и молдинги: краска ложится на рельеф, площадь фактически
      // больше номинальной, плюс подрезка граней
      var panelFactor = panels ? 1.2 : 1;

      // расход берём у краски, фактуру основания учитываем коэффициентом
      var result = C.paintCalculator({
        area: wallArea,
        openings: openings,
        coats: coats,
        consumption: product.coverage,
        surfaceFactor: surface.factor * panelFactor
      });

      clear(out);
      if (!result) {
        out.appendChild(el('p', { class: 'fine', text: 'Введите размеры помещения или площадь стен — посчитаем объём краски.' }));
        return;
      }

      out.appendChild(el('div', { class: 'calc-big' }, [
        document.createTextNode(fmt(result.litresWithReserve, 1)),
        el('small', { text: ' л' })
      ]));
      out.appendChild(el('p', { class: 'fine', style: { margin: '4px 0 0' }, text: 'с запасом 10% на подрезку и подкрас' }));

      var rows = el('div', { class: 'calc-rows' });
      [
        ['Площадь под окраску', fmt(result.netArea, 1) + ' м²'],
        ['Слоёв', String(result.coats)],
        ['Расход краски', product.coverage + ' м²/л'],
        ['Поправка на основание', '×' + fmt(surface.factor, 2)],
        panels ? ['3D-панели и молдинги', '×1,20'] : null,
        ['Чистый расчёт', fmt(result.litres, 2) + ' л']
      ].filter(Boolean).forEach(function (r) {
        rows.appendChild(el('div', { class: 'calc-row' }, [
          el('span', { text: r[0] }),
          el('b', { text: r[1] })
        ]));
      });
      out.appendChild(rows);

      // подбор фасовки: дешевле всего закрыть нужный объём
      var plan = D.planCans(result.litresWithReserve, product.cans);
      if (!plan) {
        out.appendChild(el('p', { class: 'fine', style: { marginTop: '12px' }, text: 'Для этой краски не задана фасовка.' }));
        return;
      }

      var color = currentColor();
      var planRows = el('div', { class: 'calc-rows', style: { marginTop: '14px' } });
      plan.items.forEach(function (i) {
        planRows.appendChild(el('div', { class: 'calc-row' }, [
          el('span', { text: product.name + ' · ' + fmt(i.volume, 1) + ' л × ' + i.qty }),
          el('b', { text: (i.price * i.qty).toLocaleString('ru-RU') + ' ₽' })
        ]));
      });
      planRows.appendChild(el('div', { class: 'calc-row calc-row-total' }, [
        el('span', { text: 'Итого ' + fmt(plan.litres, 1) + ' л' }),
        el('b', { text: plan.price.toLocaleString('ru-RU') + ' ₽' })
      ]));
      out.appendChild(planRows);

      out.appendChild(el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
        el('button', {
          class: 'btn btn-accent',
          type: 'button',
          onclick: function () {
            plan.items.forEach(function (i) {
              D.store.addToCart({
                kind: 'paint',
                productSku: product.sku,
                productName: product.name + ' · ' + product.sheen,
                volume: i.volume,
                volumeLabel: fmt(i.volume, 1) + ' л',
                price: i.price,
                qty: i.qty,
                colorCode: color ? color.code : null,
                colorName: color ? color.name : null,
                hex: color ? color.hex : null
              });
            });
            renderCart();
            scrollToSection(byId('cartSection'));
            toast('Добавлено в корзину: ' + fmt(plan.litres, 1) + ' л' + (color ? ' · ' + color.code : ''));
          }
        }, 'В корзину — ' + plan.price.toLocaleString('ru-RU') + ' ₽'),
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: function () {
            copyText(
              product.name + ' · ' + (color ? color.code + ' ' + color.name : 'без колеровки') + ' · ' +
              plan.items.map(function (i) { return fmt(i.volume, 1) + ' л × ' + i.qty; }).join(', ') +
              ' · ' + plan.price + ' ₽',
              'Расчёт скопирован'
            );
          }
        }, 'Скопировать расчёт')
      ]));

      if (!color) {
        out.appendChild(el('p', { class: 'fine', style: { marginTop: '10px' }, text: 'Цвет не выбран — краска пойдёт в корзину как база под колеровку. Выберите оттенок в каталоге или подберите по фото.' }));
      }
    }

    function num(id) {
      var node = byId(id);
      if (!node) return 0;
      var v = parseFloat(String(node.value).replace(',', '.'));
      return isFinite(v) && v > 0 ? v : 0;
    }
  }

  /* ============================================================
   *  Корзина
   *
   *  Живёт в localStorage браузера. Когда страница стоит в Bitrix,
   *  «Оформить заказ» отдаёт состав корзины событием archipaint:cart —
   *  сайт кладёт его в свою корзину и ведёт клиента дальше.
   * ============================================================ */

  function renderCart() {
    var host = byId('cartBox');
    if (!host) return;
    clear(host);

    var items = D.store.getCart();
    if (!items.length) {
      host.appendChild(el('p', { class: 'fine', text: 'Корзина пуста. Добавьте выкрас или пробник из карточки цвета — или посчитайте объём в калькуляторе и положите краску сюда.' }));
      return;
    }

    var list = el('div', { class: 'cart-list' });
    items.forEach(function (item) {
      list.appendChild(el('div', { class: 'cart-item' }, [
        el('span', {
          class: 'cart-sw',
          style: { background: item.hex ? displayHex(item.hex) : 'repeating-linear-gradient(45deg,#E6E3DA,#E6E3DA 6px,#F5F3EC 6px,#F5F3EC 12px)' },
          title: item.colorCode ? item.colorCode + ' · ' + item.colorName : 'Без колеровки'
        }),
        el('div', { class: 'cart-info' }, [
          el('b', { text: item.productName || item.title || 'Позиция' }),
          el('span', { class: 'fine', text: [
            item.volumeLabel || '',
            item.colorCode ? item.colorCode + ' · ' + item.colorName : 'без колеровки'
          ].filter(Boolean).join(' · ') })
        ]),
        el('div', { class: 'cart-qty' }, [
          el('button', {
            class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Убрать одну',
            onclick: function () { D.store.setCartQty(item.key, item.qty - 1); renderCart(); }
          }, '−'),
          el('b', { text: String(item.qty) }),
          el('button', {
            class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Добавить одну',
            onclick: function () { D.store.setCartQty(item.key, item.qty + 1); renderCart(); }
          }, '+')
        ]),
        el('b', { class: 'cart-price', text: ((item.price || 0) * item.qty).toLocaleString('ru-RU') + ' ₽' }),
        el('button', {
          class: 'btn btn-quiet btn-sm', type: 'button', title: 'Удалить позицию',
          onclick: function () { D.store.removeFromCart(item.key); renderCart(); toast('Позиция удалена'); }
        }, '✕')
      ]));
    });
    host.appendChild(list);

    var total = D.store.cartTotal();
    host.appendChild(el('div', { class: 'cart-total' }, [
      el('span', { text: 'Итого' }),
      el('b', { text: total.toLocaleString('ru-RU') + ' ₽' })
    ]));

    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
      el('button', {
        class: 'btn btn-accent', type: 'button',
        onclick: function () { checkout(); }
      }, 'Оформить заказ'),
      el('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: function () { D.store.clearCart(); renderCart(); toast('Корзина очищена'); }
      }, 'Очистить')
    ]));
  }

  function checkout() {
    var items = D.store.getCart();
    if (!items.length) return;

    var detail = { items: items, total: D.store.cartTotal() };
    D.logEvent('checkout_intent', detail);

    var notHandled = dispatchToolEvent('archipaint:cart', detail);
    if (notHandled) {
      toast('Заявка на ' + detail.total.toLocaleString('ru-RU') + ' ₽ собрана. На сайте она уйдёт в корзину ArchiPaint.');
    }
  }

  /* ============================================================
   *  Сравнение цветов
   * ============================================================ */

  function addToCompare(hex, label) {
    var norm = C.normalizeHex(hex);
    if (!norm) return;
    if (S.compare.some(function (c) { return c.hex === norm; })) {
      toast('Этот цвет уже в сравнении');
      return;
    }
    if (S.compare.length >= 4) S.compare.shift();
    S.compare.push({ hex: norm, label: label || norm });
    renderCompareTray();
    toast('Добавлено в сравнение (' + S.compare.length + ' из 4)');
  }

  function renderCompareTray() {
    var tray = byId('compareTray');
    if (!tray) return;
    var items = byId('compareItems');
    var info = byId('compareInfo');

    tray.classList.toggle('is-visible', S.compare.length > 0);
    if (!S.compare.length) return;

    clear(items);
    S.compare.forEach(function (c, i) {
      items.appendChild(el('i', {
        style: { background: displayHex(c.hex) },
        title: c.label + ' — нажмите, чтобы убрать',
        onclick: function () { S.compare.splice(i, 1); renderCompareTray(); }
      }));
    });

    if (info) {
      if (S.compare.length < 2) {
        info.textContent = 'Добавьте ещё цвет для сравнения';
      } else {
        var a = C.hexToLab(S.compare[0].hex);
        var b = C.hexToLab(S.compare[S.compare.length - 1].hex);
        var de = C.deltaE(a, b, S.formula);
        info.textContent = 'ΔE между крайними: ' + fmt(de, 2) + ' — ' + C.deltaEQuality(de).label.toLowerCase();
      }
    }
  }

  /* ============================================================
   *  Экспорт
   * ============================================================ */

  function currentPaletteData() {
    var slots = S.slots.concat(S.pickedSlot ? [S.pickedSlot] : []);
    return {
      generatedAt: new Date().toISOString(),
      source: S.image ? (S.image.name || 'изображение') : (S.activeSource || 'ручной ввод'),
      deltaEFormula: C.DELTA_E_FORMULAS[S.formula].label,
      baseColor: S.activeHex,
      colors: slots.map(function (slot, i) {
        var matches = D.nearest(slot.lab, matchOpts({ limit: 3 }));
        return {
          index: i + 1,
          picked: !!slot.picked,
          hex: slot.hex,
          share: slot.share != null ? Math.round(slot.share * 1000) / 10 : null,
          lab: { L: C.round(slot.lab.l, 2), a: C.round(slot.lab.a, 2), b: C.round(slot.lab.b, 2) },
          lrv: C.lrv(slot.hex),
          matches: matches.map(function (m) {
            return { code: m.color.code, name: m.color.name, hex: m.color.hex, collection: m.color.collection, deltaE: C.round(m.deltaE, 2) };
          })
        };
      })
    };
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function exportPaletteJson() {
    var data = currentPaletteData();
    if (!data.colors.length) { toast('Сначала загрузите изображение'); return; }
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'archipaint-palette.json');
    toast('Файл палитры сохранён');
  }

  /** Карточка палитры картинкой — её удобно отправить клиенту в мессенджер. */
  function exportPalettePng() {
    var data = currentPaletteData();
    if (!data.colors.length) { toast('Сначала загрузите изображение'); return; }

    var W = 1200, rowH = 190, headH = 128, footH = 62;
    var H = headH + data.colors.length * rowH + footH;
    var cv = el('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    g.fillStyle = '#FAFAF7'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#20241F';
    g.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Палитра ArchiPaint', 48, 62);
    g.fillStyle = '#7C8479';
    g.font = '400 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Источник: ' + data.source + ' · ΔE по ' + data.deltaEFormula, 48, 94);

    data.colors.forEach(function (c, i) {
      var y = headH + i * rowH;
      g.fillStyle = c.hex;
      g.fillRect(48, y + 14, 220, rowH - 34);
      g.strokeStyle = 'rgba(32,36,31,.14)';
      g.strokeRect(48, y + 14, 220, rowH - 34);

      g.fillStyle = '#20241F';
      g.font = '700 24px ui-monospace, Consolas, monospace';
      g.fillText(c.hex, 300, y + 44);
      g.fillStyle = '#7C8479';
      g.font = '400 16px system-ui, sans-serif';
      g.fillText(
        (c.picked ? 'снято пипеткой' : (c.share != null ? c.share + '% кадра' : '')) +
        ' · LRV ' + c.lrv + ' · Lab ' + c.lab.L.toFixed(1) + ', ' + c.lab.a.toFixed(1) + ', ' + c.lab.b.toFixed(1),
        300, y + 70
      );

      c.matches.forEach(function (m, j) {
        var mx = 300 + j * 300;
        var my = y + 92;
        g.fillStyle = m.hex;
        g.fillRect(mx, my, 44, 44);
        g.strokeStyle = 'rgba(32,36,31,.14)';
        g.strokeRect(mx, my, 44, 44);
        g.fillStyle = '#20241F';
        g.font = '700 15px ui-monospace, Consolas, monospace';
        g.fillText(m.code, mx + 56, my + 18);
        g.fillStyle = '#4A5148';
        g.font = '400 14px system-ui, sans-serif';
        g.fillText(m.name.slice(0, 22), mx + 56, my + 36);
        g.fillStyle = '#7C8479';
        g.font = '400 13px ui-monospace, Consolas, monospace';
        g.fillText('ΔE ' + m.deltaE.toFixed(2), mx + 56, my + 54);
      });

      g.strokeStyle = '#E3E4DC';
      g.beginPath(); g.moveTo(48, y + rowH - 10); g.lineTo(W - 48, y + rowH - 10); g.stroke();
    });

    g.fillStyle = '#7C8479';
    g.font = '400 15px system-ui, sans-serif';
    g.fillText('Экранные цвета отличаются от реального выкраса. Закажите выкрас на бумаге для точного выбора.', 48, H - 26);

    cv.toBlob(function (blob) {
      if (!blob) { toast('Браузер не смог сохранить картинку'); return; }
      downloadBlob(blob, 'archipaint-palette.png');
      toast('Картинка палитры сохранена');
    }, 'image/png');
  }

  /* ============================================================
   *  Состояние в адресе страницы
   * ============================================================ */

  function shareUrl() {
    var params = [];
    if (S.activeHex) params.push('c=' + encodeURIComponent(S.activeHex.replace('#', '')));
    if (S.mood) params.push('m=' + S.mood);
    if (S.scheme) params.push('s=' + S.scheme);
    if (S.baseRole && S.baseRole !== 'auto') params.push('r=' + S.baseRole);
    if (S.formula !== 'de2000') params.push('f=' + S.formula);
    return location.origin + location.pathname + (params.length ? '#' + params.join('&') : '');
  }

  function updateUrlState() {
    if (!global.history || !history.replaceState) return;
    try { history.replaceState(null, '', shareUrl()); } catch (e) {}
  }

  function readUrlState() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    var params = {};
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
    });

    if (params.f && C.DELTA_E_FORMULAS[params.f]) S.formula = params.f;
    if (params.m && D.PRESETS_BY_ID[params.m]) S.mood = params.m;
    if (params.s && C.HARMONY_SCHEMES.some(function (x) { return x.id === params.s; })) S.scheme = params.s;
    if (params.r && D.ROLES[params.r]) S.baseRole = params.r;

    if (params.c) {
      var hex = C.normalizeHex(params.c);
      if (hex) setActiveColor(hex, 'link', 'из ссылки');
    }

    var roleSel = byId('interiorRole');
    if (roleSel) roleSel.value = S.baseRole;
  }

  /* ============================================================
   *  Прокрутка и горячие клавиши
   * ============================================================ */

  function scrollToSection(node) {
    if (!node) return;
    var y = node.getBoundingClientRect().top + global.pageYOffset - 70;
    try {
      global.scrollTo({ top: y, behavior: 'smooth' });
    } catch (e) {
      global.scrollTo(0, y);
    }
  }

  function initShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeTopModal(); return; }
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'p' || e.key === 'з') {
        var btn = byId('btnPicker');
        if (btn) { btn.click(); e.preventDefault(); }
      } else if (e.key === 'k' || e.key === 'л') {
        var cat = byId('navCatalog');
        if (cat) { cat.click(); e.preventDefault(); }
      } else if (e.key === '/') {
        var std = byId('stdInput');
        if (std) { std.focus(); std.select(); e.preventDefault(); }
      }
    });
  }

  /* ============================================================
   *  Инициализация
   * ============================================================ */

  function podbor(options) {
    if (initialized) {
      // повторный вызов — просто перерисовываем то, что зависит от данных
      renderResults(); renderHarmony(); renderInteriorSection();
      return;
    }
    initialized = true;

    if (options) D.configure(options);

    readUrlState();

    initUpload();
    initCoordSearch();
    initCatalogModal();
    initStandardSearch();
    initInterior();
    initVisualizer();
    initCalculator();
    initShortcuts();

    // Любая смена базового цвета — из фото, пипетки, каталога, стандарта,
    // координат или ссылки — сразу перестраивает гармонии и интерьерные
    // палитры. Раньше об этом помнил каждый обработчик по отдельности,
    // и пипетка забывала: палитры оставались от прошлого цвета, пока
    // пользователь не трогал их сам.
    document.addEventListener('archipaint:activecolor', function () {
      renderResults();
      renderHarmony();
      renderInteriorSection();
      updateUrlState();
    });

    wireModal('cardBack', ['cardX']);

    renderCollections();
    renderFavorites();
    renderSavedPalettes();
    renderCart();
    renderCompareTray();
    renderResults();
    renderHarmony();
    renderInteriorSection();

    // перерисовываем круг при смене размеров окна
    global.addEventListener('resize', debounce(function () {
      if (S.activeHex) drawWheel();
    }, 180));

    // переход по ссылке вида ...#c=C15B33&m=luxury_dark на уже открытой
    // странице меняет только фрагмент — документ не перезагружается
    global.addEventListener('hashchange', function () {
      var before = S.activeHex + '|' + S.mood + '|' + S.scheme + '|' + S.baseRole;
      readUrlState();
      if (before === S.activeHex + '|' + S.mood + '|' + S.scheme + '|' + S.baseRole) return;
      renderMoodGrid();
      renderResults();
      renderHarmony();
      renderInteriorSection();
    });
  }

  global.podbor = podbor;
  global.ArchiPaintUI = {
    state: S,
    setActiveColor: function (hex, label) {
      setActiveColor(hex, 'api', label);
      renderHarmony(); renderInteriorSection(); updateUrlState();
    },
    openColorCard: openColorCard,
    refresh: function () { renderResults(); renderHarmony(); renderInteriorSection(); },
    toast: toast
  };
})(typeof window !== 'undefined' ? window : globalThis);
