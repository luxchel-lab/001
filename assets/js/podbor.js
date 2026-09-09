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
    wheelMode: 'flat',   // 'flat' — круг LCh, 'lab' — объём CIE Lab
    labSpin: null,       // поворот сцены Lab вокруг оси светлоты, градусы
    labTilt: 38,         // подъём точки зрения: 0 — сбоку, 90 — сверху
    labHover: null,      // подсвеченная точка схемы
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
    S.labSpin = null;   // новую схему разворачиваем базовым цветом к зрителю
    S.labHover = null;
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

    // Каталог умеет работать в двух режимах: обычном — клик открывает
    // карточку цвета, и «отдай выбранный цвет» — калькулятор просит
    // указать любой оттенок и получает его обратным вызовом.
    var pickHandler = null;

    openCatalog = function (collectionId, onPick) {
      activeCollection = collectionId || null;
      pickHandler = onPick || null;
      if (search) search.value = '';
      open();
    };

    function open() {
      openModal(back);
      renderFilters();
      render();
    }

    // закрыли окно, не выбрав цвет — режим выбора снимается,
    // иначе следующий клик по каталогу молча уехал бы в калькулятор
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('#catX')) pickHandler = null;
    });

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
            if (pickHandler) {
              var fn = pickHandler;
              pickHandler = null;
              fn(c);
              return;
            }
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
    var tools = byId('labTools');
    if (tools) tools.hidden = S.wheelMode !== 'lab';
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
      el('div', { class: 'mono fine', text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) + '° · LRV ' + fmt(C.lrv(S.activeHex), 1) +
        (lch.c >= 3 ? ' · круг Иттена: ' + ittenSectorName(lch.h) : '') })
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

  /** Ближайший сектор круга Иттена — на языке цветоведения, а не координат. */
  function ittenSectorName(hue) {
    var a = C.lchToItten(hue);
    var i = Math.round(a / 30) % 12;
    return C.ITTEN_WHEEL[i].label;
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
        class: 'hs-item' + (S.labHover === i ? ' is-active' : ''),
        type: 'button',
        title: i === 0 ? 'Базовый цвет схемы' : 'Цвет ' + (i + 1) + ' схемы',
        // наведение подсвечивает ту же точку в объёме Lab
        onmouseenter: function () { S.labHover = i; markSchemeHover(); if (S.wheelMode === 'lab') drawWheel(); },
        onmouseleave: function () { S.labHover = null; markSchemeHover(); if (S.wheelMode === 'lab') drawWheel(); },
        onclick: function () {
          if (match) openColorCard(match.color, { sourceHex: c.hex, deltaE: match.deltaE, sourceLabel: i === 0 ? 'базовый' : 'цвет схемы' });
        }
      }, [
        el('span', { class: 'hs-num', text: String(i + 1) }),
        el('span', { class: 'hs-sw', style: { background: shown } }),
        el('span', { class: 'hs-meta' }, [
          el('span', { class: 'hs-hex', text: c.hex }),
          el('span', { class: 'hs-coords', text: 'L ' + fmt(c.lch.l, 0) + ' · C ' + fmt(c.lch.c, 0) + ' · h ' + fmt(c.lch.h, 0) + '° · LRV ' + fmt(C.lrv(c.hex), 0) }),
          match ? el('span', { class: 'hs-near', text: match.color.code + ' · ' + match.color.name }) : null
        ]),
        el('span', { class: 'hs-right' }, [
          el('span', { class: 'badge ' + (i === 0 ? 'badge-base' : 'badge-additional'), text: i === 0 ? 'база' : 'цвет ' + (i + 1) }),
          match ? deltaBadge(match.deltaE) : null
        ])
      ]));
    });
  }

  /** Синхронная подсветка карточки цвета и точки в объёме Lab. */
  function markSchemeHover() {
    $$('#hsGrid .hs-item').forEach(function (row, i) {
      row.classList.toggle('is-active', S.labHover === i);
    });
  }

  /**
   * Цветовой круг Иттена: кольцо тонов при фиксированной светлоте
   * и маркеры выбранной схемы. Угловая координата кольца — угол круга
   * Иттена, а не тон LCh, поэтому равные углы схемы дают и равные углы
   * на картинке: триада видна как три маркера через 120°.
   * Рисуем на canvas — это дешевле сотни SVG-сегментов.
   */
  /**
   * Переключение вида и орбитальная камера сцены Lab.
   * По горизонтали сцена вращается, по вертикали поднимается и опускается
   * точка зрения; пресеты дают три осмысленных положения сразу.
   */
  function initWheelModes() {
    var seg = byId('wheelViews');
    var presets = byId('labPresets');
    var canvas = byId('wheel');

    function syncMode() {
      var tools = byId('labTools');
      if (tools) tools.hidden = S.wheelMode !== 'lab';
      drawWheel();
    }

    if (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-wheel]');
        if (!btn) return;
        S.wheelMode = btn.dataset.wheel;
        $$('button', seg).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        syncMode();
      });
    }

    if (presets) {
      Object.keys(LAB_PRESETS).forEach(function (id) {
        presets.appendChild(el('button', {
          type: 'button',
          class: id === 'iso' ? 'is-active' : '',
          dataset: { preset: id }
        }, LAB_PRESETS[id].label));
      });
      presets.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-preset]');
        if (!btn) return;
        S.labTilt = LAB_PRESETS[btn.dataset.preset].tilt;
        markPreset();
        drawWheel();
      });
    }

    function markPreset() {
      if (!presets) return;
      $$('button', presets).forEach(function (b) {
        b.classList.toggle('is-active', LAB_PRESETS[b.dataset.preset].tilt === S.labTilt);
      });
    }

    if (!canvas) return;

    // Вращение заканчивается тем же кликом, что открывает карточку цвета,
    // поэтому считаем пройденный путь: сдвинулись заметно — это поворот,
    // а не выбор точки.
    var dragging = false, lastX = 0, lastY = 0, travel = 0;
    function start(x, y) {
      if (S.wheelMode !== 'lab') return;
      dragging = true; lastX = x; lastY = y; travel = 0;
      canvas.classList.add('is-spinning');
    }
    function move(x, y) {
      if (!dragging) return;
      travel += Math.abs(x - lastX) + Math.abs(y - lastY);
      S.labSpin = (S.labSpin || 0) + (x - lastX) * 0.6;
      S.labTilt = C.clamp(S.labTilt - (y - lastY) * 0.45, LAB_TILT_MIN, LAB_TILT_MAX);
      lastX = x; lastY = y;
      markPreset();
      drawWheel();
    }
    function end() { dragging = false; canvas.classList.remove('is-spinning'); }

    canvas.addEventListener('mousedown', function (e) { e.preventDefault(); start(e.clientX, e.clientY); });
    global.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    global.addEventListener('mouseup', end);

    // наведение подсвечивает точку и строку таблицы под сценой
    canvas.addEventListener('mousemove', function (e) {
      if (dragging || S.wheelMode !== 'lab' || !labMarks.length) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var hit = null, best = 22 * 22;
      labMarks.forEach(function (m) {
        var d = (m.p.x - mx) * (m.p.x - mx) + (m.p.y - my) * (m.p.y - my);
        if (d < best) { best = d; hit = m.i; }
      });
      if (hit !== S.labHover) { S.labHover = hit; drawWheel(); markSchemeHover(); }
      canvas.style.cursor = hit == null ? 'grab' : 'pointer';
    });
    canvas.addEventListener('mouseleave', function () {
      if (S.labHover == null) return;
      S.labHover = null; drawWheel(); markSchemeHover();
    });
    canvas.addEventListener('click', function () {
      if (S.wheelMode !== 'lab' || S.labHover == null || travel > 5) return;
      var harmony = C.buildHarmony(S.activeHex, S.scheme);
      if (!harmony) return;
      var col = harmony.colors[S.labHover];
      var match = D.nearestOne(col.lab, matchOpts());
      if (match) openColorCard(match.color, { sourceHex: col.hex, deltaE: match.deltaE, sourceLabel: S.labHover === 0 ? 'базовый' : 'цвет схемы' });
    });

    canvas.addEventListener('touchstart', function (e) {
      if (S.wheelMode !== 'lab' || !e.touches.length) return;
      e.preventDefault(); start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      if (!dragging || !e.touches.length) return;
      e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', end);
  }

  function drawWheel() {
    var canvas = byId('wheel');
    if (!canvas || !S.activeHex) return;

    var isLab = S.wheelMode === 'lab';
    canvas.classList.toggle('is-lab', isLab);
    canvas.classList.toggle('is-spinnable', isLab);

    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || 300;
    var cssH = canvas.clientHeight || cssW;
    var cssSize = Math.min(cssW, cssH);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var hint = byId('wheelHint');
    if (hint) {
      hint.textContent = S.wheelMode === 'lab'
        ? 'Вверх — светлота L, поперёк — оси a и b, цветной срез — охват sRGB на светлоте базы. Тяните вбок и вверх-вниз, чтобы повернуть сцену.'
        : 'Углы схем отложены по кругу Иттена. Здесь виден только тон — светлота и насыщенность показаны в объёме Lab.';
    }
    if (isLab) {
      drawLab3D(ctx, cssW, cssH);
      return;
    }

    var cx = cssSize / 2, cy = cssSize / 2;
    var outer = cssSize * 0.46, inner = cssSize * 0.31;

    var baseLab = C.hexToLab(S.activeHex);
    var baseLch = C.labToLch(baseLab.l, baseLab.a, baseLab.b);
    var ringL = C.clamp(baseLch.l, 34, 78);
    var ringC = Math.max(24, Math.min(baseLch.c * 1.15, 62));

    // кольцо тонов
    var step = 1.5;
    for (var a = 0; a < 360; a += step) {
      var lab = C.fitToGamut(ringL, ringC, C.ittenToLch(a));
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
      var rad = (C.lchToItten(h) - 90) * Math.PI / 180;
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

  /* ------------------------------------------------------------
   *  Схема в объёме CIE Lab
   *
   *  Круг показывает только тон: два цвета одного тона ложатся в одну
   *  точку, хотя различаются светлотой вдвое — а в интерьере именно
   *  светлота решает, что станет стенами, а что акцентом. В объёме
   *  видно всё сразу: ось L вверх, оси a и b поперёк, срез охвата sRGB
   *  на светлоте базового цвета.
   *
   *  Камера орбитальная: горизонтальное перетаскивание вращает сцену,
   *  вертикальное поднимает и опускает точку зрения. Крайние положения
   *  осмысленны сами по себе: сверху — привычный цветовой круг, сбоку —
   *  чистая шкала светлоты.
   * ---------------------------------------------------------- */

  var LAB_PRESETS = {
    iso:  { tilt: 38, label: 'Объём' },
    top:  { tilt: 84, label: 'Сверху' },
    side: { tilt: 10, label: 'Сбоку' }
  };
  var LAB_TILT_MIN = 6, LAB_TILT_MAX = 86;

  // положения точек последнего кадра — для наведения курсором
  var labMarks = [];

  /**
   * Орбитальная камера. spin — поворот вокруг оси светлоты, tilt —
   * подъём точки зрения: 0 — вид строго сбоку, 90 — строго сверху.
   */
  function labProjector(spin, tilt) {
    var t = spin * Math.PI / 180, e = tilt * Math.PI / 180;
    var cs = Math.cos(t), sn = Math.sin(t), ce = Math.cos(e), se = Math.sin(e);
    var KL = 1.26;   // светлота идёт чуть крупнее осей a и b
    return function (a, b, l) {
      var ax = a * cs + b * sn;
      var bz = -a * sn + b * cs;
      return {
        x: ax,
        y: -(l - 50) * KL * ce + bz * se,
        // глубина к камере: сбоку решает b, сверху — светлота
        z: bz * ce + (l - 50) * KL * se
      };
    };
  }

  /**
   * Подгонка сцены под кадр.
   *
   * При наклоне сцена то растягивается вверх (вид сбоку), то расплывается
   * вширь (вид сверху). Фиксированный масштаб оставлял бы половину холста
   * пустой, поэтому кадрируем по фактическим габаритам содержимого.
   */
  function labFit(raw, points, w, h, leftGutter) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function (p) {
      var q = raw(p[0], p[1], p[2]);
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    });
    // при взгляде почти сверху шкала светлоты вырождается и не рисуется —
    // тогда левое поле под неё не нужно
    var boxX0 = w * (leftGutter ? 0.19 : 0.05), boxX1 = w * 0.97;
    var boxY0 = h * 0.08, boxY1 = h * 0.94;
    var k = Math.min(
      (boxX1 - boxX0) / Math.max(1e-6, maxX - minX),
      (boxY1 - boxY0) / Math.max(1e-6, maxY - minY)
    );
    var dx = (boxX0 + boxX1) / 2 - (minX + maxX) / 2 * k;
    var dy = (boxY0 + boxY1) / 2 - (minY + maxY) / 2 * k;
    return function (a, b, l) {
      var q = raw(a, b, l);
      return { x: q.x * k + dx, y: q.y * k + dy, z: q.z };
    };
  }

  function drawLab3D(ctx, w, h) {
    var baseLab = C.hexToLab(S.activeHex);
    var baseLch = C.labToLch(baseLab.l, baseLab.a, baseLab.b);
    var harmony = C.buildHarmony(S.activeHex, S.scheme);
    if (!harmony) return;

    // при первом показе разворачиваем сцену базовым цветом к зрителю
    if (S.labSpin == null) S.labSpin = (baseLch.c < 3 ? 60 : baseLch.h) - 90;
    var tilt = C.clamp(S.labTilt, LAB_TILT_MIN, LAB_TILT_MAX);
    var raw = labProjector(S.labSpin, tilt);
    var discL = baseLch.l;
    var RINGS = 7, SECT = 60;
    var font = getComputedStyle(document.body).fontFamily || 'sans-serif';

    ctx.font = '600 11px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /** Подпись с белой обводкой: при повороте она может лечь на срез. */
    function label(text, x, y, dim) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = dim ? 'rgba(32,36,31,.42)' : 'rgba(32,36,31,.62)';
      ctx.fillText(text, x, y);
    }

    // Предельная хрома охвата sRGB на этой светлоте — по каждому тону.
    // Считаем её на границах секторов, тогда соседние ячейки среза
    // сходятся кромка в кромку и край получается гладким.
    var edge = [];
    for (var ei = 0; ei <= SECT; ei++) {
      var he = 360 * ei / SECT;
      var fit = C.fitToGamut(discL, 150, he);
      edge.push({ h: he, c: C.labToLch(fit.l, fit.a, fit.b).c });
    }

    // габариты сцены: кромка среза с запасом под подписи, ось и точки схемы
    var span = edge.reduce(function (m, e) { return Math.max(m, e.c); }, 0) + 15;
    var bounds = [[0, 0, 0], [0, 0, 100]];
    edge.forEach(function (e) {
      var q = C.lchToLab(discL, span, e.h);
      bounds.push([q.a, q.b, discL]);
    });
    harmony.colors.forEach(function (c) { bounds.push([c.lab.a, c.lab.b, c.lab.l]); });
    // шкала светлоты имеет смысл, пока сцена не легла плашмя
    var hasRuler = Math.cos(tilt * Math.PI / 180) > 0.2;
    var pr = labFit(raw, bounds, w, h, hasRuler);

    var cells = [];
    for (var si = 0; si < SECT; si++) {
      var e0 = edge[si], e1 = edge[si + 1];
      for (var ri = 0; ri < RINGS; ri++) {
        var t0 = ri / RINGS, t1 = (ri + 1) / RINGS;
        var cm = (e0.c + e1.c) / 2 * (t0 + t1) / 2, hm = (e0.h + e1.h) / 2;
        var lab = C.lchToLab(discL, cm, hm);
        cells.push({
          quad: [[e0.c * t0, e0.h], [e0.c * t1, e0.h], [e1.c * t1, e1.h], [e1.c * t0, e1.h]]
            .map(function (p) {
              var q = C.lchToLab(discL, p[0], p[1]);
              return pr(q.a, q.b, discL);
            }),
          fill: C.simulateCVD(C.labToHex(lab.l, lab.a, lab.b), S.cvd),
          z: pr(lab.a, lab.b, discL).z
        });
      }
    }

    function paintCells(filter) {
      cells.forEach(function (cell) {
        if (!filter(cell)) return;
        ctx.beginPath();
        ctx.moveTo(cell.quad[0].x, cell.quad[0].y);
        for (var i = 1; i < 4; i++) ctx.lineTo(cell.quad[i].x, cell.quad[i].y);
        ctx.closePath();
        ctx.fillStyle = cell.fill;
        ctx.fill();
        ctx.strokeStyle = cell.fill;   // шов убирает муар от антиалиасинга
        ctx.lineWidth = 0.7;
        ctx.stroke();
      });
    }

    /** Окружность постоянной хромы на плоскости среза. */
    function ring(c, style, width) {
      ctx.beginPath();
      for (var a = 0; a <= 360; a += 6) {
        var lab = C.lchToLab(discL, c, a);
        var p = pr(lab.a, lab.b, discL);
        if (a === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = style;
      ctx.lineWidth = width || 1;
      ctx.stroke();
    }

    /** Ось светлоты: настоящая шкала от чёрного к белому. */
    function axis(l0, l1, ghost) {
      var a = pr(0, 0, l0), b = pr(0, 0, l1);
      var grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, C.labToHex(l0, 0, 0));
      grad.addColorStop(1, C.labToHex(l1, 0, 0));
      ctx.save();
      if (ghost) { ctx.globalAlpha = 0.4; ctx.setLineDash([5, 5]); }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(32,36,31,.28)';
      ctx.stroke();
      ctx.restore();
    }

    // дальняя половина среза → ось → ближняя половина: ось протыкает срез.
    // Скрытую часть проводим сквозь срез вполсилы, иначе вся шкала светлоты
    // ниже плоскости пропадала и кадр читался плоским.
    paintCells(function (c) { return c.z <= 0; });
    axis(0, 100);
    paintCells(function (c) { return c.z > 0; });
    axis(0, 100, true);

    [25, 50, 75].forEach(function (c) { ring(c, 'rgba(255,255,255,.4)', 1); });

    // кромка охвата
    ctx.beginPath();
    edge.forEach(function (e, i) {
      var lab = C.lchToLab(discL, e.c, e.h);
      var q = pr(lab.a, lab.b, discL);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(32,36,31,.3)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // подписи осей за самой дальней точкой кромки
    [[0, '+a'], [90, '+b'], [180, '−a'], [270, '−b']].forEach(function (p) {
      var lab = C.lchToLab(discL, span, p[0]);
      var q = pr(lab.a, lab.b, discL);
      label(p[1], q.x, q.y, true);
    });

    // Шкала светлоты у левого края кадра: на самой оси подписи ложились
    // поверх цветного среза и не читались.
    var rulerX = w * 0.062;
    var top = pr(0, 0, 100).y, bottom = pr(0, 0, 0).y;
    if (hasRuler) {
      ctx.beginPath();
      ctx.moveTo(rulerX, top);
      ctx.lineTo(rulerX, bottom);
      ctx.strokeStyle = 'rgba(32,36,31,.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      [0, 25, 50, 75, 100].forEach(function (l) {
        var y = bottom + (top - bottom) * l / 100;
        ctx.beginPath();
        ctx.moveTo(rulerX - 4, y);
        ctx.lineTo(rulerX + 4, y);
        ctx.strokeStyle = 'rgba(32,36,31,.28)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        label(String(l), rulerX + 8 + ctx.measureText(String(l)).width / 2, y, true);
      });
      label('L', rulerX, top - 14);
      // уровень среза виден на шкале — понятно, на какой светлоте он лежит
      var dy = bottom + (top - bottom) * discL / 100;
      ctx.beginPath();
      ctx.moveTo(rulerX - 6, dy);
      ctx.lineTo(rulerX + 6, dy);
      ctx.strokeStyle = '#3E4A3D';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    // --- цвета схемы
    labMarks = harmony.colors.map(function (col, i) {
      return {
        col: col, i: i,
        p: pr(col.lab.a, col.lab.b, col.lab.l),
        foot: pr(col.lab.a, col.lab.b, discL)
      };
    });

    // связь между цветами схемы — видно её форму в объёме
    ctx.beginPath();
    labMarks.forEach(function (m, i) {
      if (i === 0) ctx.moveTo(m.p.x, m.p.y); else ctx.lineTo(m.p.x, m.p.y);
    });
    ctx.strokeStyle = 'rgba(32,36,31,.22)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    labMarks.slice().sort(function (a, b) { return a.p.z - b.p.z; }).forEach(function (m) {
      var active = S.labHover === m.i;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(m.foot.x, m.foot.y);
      ctx.lineTo(m.p.x, m.p.y);
      ctx.strokeStyle = active ? 'rgba(32,36,31,.7)' : 'rgba(32,36,31,.38)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(m.foot.x, m.foot.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(32,36,31,.35)';
      ctx.fill();

      var r = (m.i === 0 ? 14 : 11) * (active ? 1.25 : 1);
      var shown = displayHex(m.col.hex);
      var grad = ctx.createRadialGradient(m.p.x - r * 0.35, m.p.y - r * 0.4, r * 0.15, m.p.x, m.p.y, r);
      grad.addColorStop(0, C.lighten(shown, 26));
      grad.addColorStop(0.55, shown);
      grad.addColorStop(1, C.darken(shown, 18));
      ctx.beginPath();
      ctx.arc(m.p.x, m.p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = active ? 4 : (m.i === 0 ? 3 : 2.5);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(32,36,31,.3)';
      ctx.stroke();

      // номер точки — тот же, что в таблице под сценой
      ctx.font = '700 ' + (m.i === 0 ? 12 : 10.5) + 'px ' + font;
      ctx.fillStyle = C.readableTextColor(shown);
      ctx.fillText(String(m.i + 1), m.p.x, m.p.y + 0.5);
      ctx.font = '600 11px ' + font;
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

    // Полоса площадей: 60/30/10 с поправкой на контраст площади Иттена
    var areas = D.ittenAreas(scheme.colors);
    if (areas) {
      var bar = el('div', { class: 'scheme-bar', title: areas.note });
      areas.shares.forEach(function (s) {
        var shown = displayHex(s.hex);
        bar.appendChild(el('i', {
          style: { background: shown, flex: String(s.share), color: C.readableTextColor(shown) },
          title: D.roleMeta(s.role).label + ' · ' + s.hex + ' · ' + s.share + '%'
        }, s.share + '%'));
      });
      card.appendChild(bar);
      card.appendChild(el('div', { class: 'scheme-ratio' },
        areas.shares.map(function (s) {
          return el('span', { text: D.roleMeta(s.role).short.toLowerCase() });
        })));
    }

    var list = el('div', { class: 'scheme-colors' });
    var order = D.ROLE_ORDER;
    scheme.colors.slice().sort(function (a, b) {
      return order.indexOf(a.role) - order.indexOf(b.role);
    }).forEach(function (col) {
      list.appendChild(buildSchemeColorRow(col));
    });
    card.appendChild(list);

    // Разбор палитры: ведущий контраст по Иттену и найденные огрехи
    var checks = D.paletteChecks(scheme.colors);
    var box = el('div', { class: 'scheme-checks' });
    box.appendChild(el('div', { class: 'check-lead', title: checks.lead.note }, [
      el('b', { text: 'Ведёт контраст ' + checks.lead.label }),
      el('span', { text: checks.lead.note })
    ]));
    checks.warnings.forEach(function (w) {
      box.appendChild(el('div', { class: 'check-' + (w.level === 'warn' ? 'warn' : 'note'), text: w.text }));
    });
    card.appendChild(box);

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
    // калькулятор берёт цвета из этого же списка поверхностей
    dispatchToolEvent('archipaint:surfaces', { view: vizState.view });
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
  /* ============================================================
   *  Геометрия сцены
   *
   *  Комната описывается в нормированных координатах:
   *    u — поперёк, 0 у левой стены, 1 у правой;
   *    v — по высоте, 0 пол, 1 потолок;
   *    d — вглубь, 0 дальняя стена, 1 передний план кадра.
   *
   *  projector() переводит их в координаты SVG по правилам одноточечной
   *  перспективы. Благодаря этому мебель ставится в объёме комнаты,
   *  а не рисуется плоскими прямоугольниками поверх стены: у каждого
   *  предмета сами собой получаются верхняя и боковая грани.
   * ============================================================ */

  var VIEW_W = 900, VIEW_H = 620;
  var VP_X = 450, VP_Y = 268;

  /**
   * Помещения. depth — насколько далеко дальняя стена: чем меньше число,
   * тем ближе стена и тем меньше кажется комната. Ванная и прихожая
   * мельче жилых комнат, кухня чуть глубже.
   */
  var ROOM_VIEWS = [
    { id: 'living',  label: 'Гостиная',  win: 'left',  day: 0.44, depth: 215 },
    { id: 'kitchen', label: 'Кухня',     win: 'left',  day: 0.46, depth: 225, tiles: true },
    { id: 'dining',  label: 'Столовая',  win: 'right', day: 0.44, depth: 210 },
    { id: 'bedroom', label: 'Спальня',   win: 'right', day: 0.42, depth: 205 },
    { id: 'office',  label: 'Кабинет',   win: 'left',  day: 0.40, depth: 215 },
    { id: 'bath',    label: 'Ванная',    win: 'right', day: 0.46, depth: 172, tiles: true },
    { id: 'hall',    label: 'Прихожая',  win: null,    day: 0.30, depth: 162, tiles: true }
  ];

  function roomView(id) {
    return ROOM_VIEWS.filter(function (v) { return v.id === id; })[0] || ROOM_VIEWS[0];
  }

  /**
   * Границы дальней стены выводятся из глубины и точки схода, чтобы рёбра
   * комнаты честно сходились в одну точку: иначе перспектива «плывёт».
   */
  function roomGeom(view) {
    var bx0 = view.depth || 215;
    var by0 = VP_Y * bx0 / VP_X;
    return {
      bx0: bx0, bx1: VIEW_W - bx0,
      by0: by0, by1: by0 + VIEW_H * (VP_X - bx0) / VP_X,
      win: view.win, day: view.day, tiles: !!view.tiles
    };
  }

  /** Функция проекции (u, v, d) → точка SVG. */
  function projector(G) {
    var K = VIEW_W / (G.bx1 - G.bx0);          // во сколько раз передний план крупнее дальней стены
    var w = G.bx1 - G.bx0, h = G.by1 - G.by0;
    return function (u, v, d) {
      var k = 1 / (1 - (d || 0) * (1 - 1 / K));
      return {
        x: VP_X + (G.bx0 + u * w - VP_X) * k,
        y: VP_Y + (G.by1 - v * h - VP_Y) * k
      };
    };
  }

  function pts(list) {
    return list.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  }

  function poly(list, fill, extra) {
    return '<polygon points="' + pts(list) + '" fill="' + fill + '"' + (extra || '') + '/>';
  }

  /**
   * Прямоугольный объём. Рисуются только видимые грани: передняя всегда,
   * верхняя — если предмет ниже линии горизонта, боковая — та, что
   * обращена к камере. Верх подсвечен, бок притенён: объём читается,
   * а цвет краски под накладкой остаётся тем же.
   */
  function box(pr, u0, u1, v0, v1, d0, d1, fill, opts) {
    opts = opts || {};
    var far = [pr(u0, v1, d0), pr(u1, v1, d0), pr(u1, v0, d0), pr(u0, v0, d0)];
    var near = [pr(u0, v1, d1), pr(u1, v1, d1), pr(u1, v0, d1), pr(u0, v0, d1)];
    var out = [];

    // верхняя грань видна, пока верх предмета ниже горизонта
    if (near[0].y > VP_Y) {
      out.push(poly([far[0], far[1], near[1], near[0]], fill));
      out.push(poly([far[0], far[1], near[1], near[0]], '#FFFFFF', ' opacity=".14"'));
    }
    // боковая грань — со стороны, повёрнутой к зрителю
    var mid = (u0 + u1) / 2;
    if (mid < 0.5) {
      out.push(poly([far[1], near[1], near[2], far[2]], fill));
      out.push(poly([far[1], near[1], near[2], far[2]], '#000000', ' opacity=".16"'));
    } else {
      out.push(poly([far[0], near[0], near[3], far[3]], fill));
      out.push(poly([far[0], near[0], near[3], far[3]], '#000000', ' opacity=".16"'));
    }
    out.push(poly(near, fill, opts.rx ? ' rx="' + opts.rx + '"' : ''));
    if (!opts.flat) out.push(poly(near, 'url(#apSoft)'));
    return out.join('');
  }

  /** Плоскость на полу: ковёр, световое пятно, подложка под мебель. */
  function floorQuad(pr, u0, u1, d0, d1, fill, extra) {
    return poly([pr(u0, 0, d0), pr(u1, 0, d0), pr(u1, 0, d1), pr(u0, 0, d1)], fill, extra);
  }

  /** Тень под предметом — по полу, поэтому тоже в перспективе. */
  function floorShadow(pr, u0, u1, d0, d1, opacity) {
    return poly([pr(u0, 0, d0), pr(u1, 0, d0), pr(u1, 0, d1), pr(u0, 0, d1)],
      '#000000', ' opacity="' + (opacity || 0.24) + '" filter="url(#apBlurS)"');
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
    // текстиль берёт светлый или тёмный тон от мебели — чтобы не сливался
    P.soft = displayHex(C.readableTextColor(vizState.furniture) === '#FFFFFF'
      ? C.lighten(vizState.furniture, 34)
      : C.darken(vizState.furniture, 26));
    // корпусная мебель — древесный тон от пола
    P.wood = displayHex(C.darken(vizState.floor, 16));
    P.woodLit = displayHex(C.lighten(vizState.floor, 8));
    P.metal = '#C9CDCB';
    P.white = '#F4F6F5';

    var view = roomView(vizState.view);
    var G = roomGeom(view);
    var pr = projector(G);

    stage.innerHTML = [
      '<svg viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" role="img" aria-label="' + view.label + ' в выбранных цветах">',
      vizDefs(P),
      roomShell(P, G, pr),
      (ROOM_BUILDERS[view.id] || ROOM_BUILDERS.living)(P, G, pr),
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
      // стекло и блик по нему
      '<linearGradient id="apGlass" x1="0" y1="0" x2=".15" y2="1">',
      '<stop offset="0" stop-color="#DCEBF5"/>',
      '<stop offset=".52" stop-color="#C6DCEA"/>',
      '<stop offset=".54" stop-color="#A9BFA6"/>',
      '<stop offset="1" stop-color="#8AA487"/>',
      '</linearGradient>',
      '<linearGradient id="apGlare" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".45"/>',
      '<stop offset=".45" stop-color="#FFFFFF" stop-opacity=".05"/>',
      '<stop offset="1" stop-color="#FFFFFF" stop-opacity=".22"/>',
      '</linearGradient>',
      // объём мягкой мебели
      '<linearGradient id="apSoft" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".16"/>',
      '<stop offset=".6" stop-color="#000000" stop-opacity="0"/>',
      '<stop offset="1" stop-color="#000000" stop-opacity=".18"/>',
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
      '<feGaussianBlur stdDeviation="7"/>',
      '</filter>',
      // матовое зерно: краска не бывает идеально гладкой
      '<filter id="apGrain">',
      '<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>',
      '<feColorMatrix type="saturate" values="0"/>',
      '</filter>',
      '</defs>'
    ].join('');
  }

  /** Финальный слой: виньетка и зерно поверх всей сцены. */
  function vizFinish() {
    return '<rect width="' + VIEW_W + '" height="' + VIEW_H + '" fill="url(#apVign)"/>' +
           '<rect width="' + VIEW_W + '" height="' + VIEW_H + '" filter="url(#apGrain)" opacity=".05" style="mix-blend-mode:multiply"/>';
  }

  /* ------------------------------------------------------------
   *  Коробка помещения
   * ---------------------------------------------------------- */

  /** Швы пола: доски вдоль взгляда и поперечные стыки, всё в перспективе. */
  function floorSeams(pr, G) {
    var out = [];
    var n = G.tiles ? 8 : 12;
    for (var i = 1; i < n; i++) {
      var a = pr(i / n, 0, 0), b = pr(i / n, 0, 1);
      out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
               '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
               '" stroke="#000" stroke-opacity=".09" stroke-width="1.4"/>');
    }
    [0.12, 0.28, 0.48, 0.72, 1].forEach(function (d) {
      var a = pr(0, 0, d), b = pr(1, 0, d);
      out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
               '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
               '" stroke="#000" stroke-opacity=".07" stroke-width="1.3"/>');
    });
    return out.join('');
  }

  /** Окно в боковой стене: откос, рама, стекло и свет из проёма. */
  function sideWindow(P, G, pr) {
    if (!G.win) return '';
    var u = G.win === 'left' ? 0 : 1;
    var d0 = 0.16, d1 = 0.56, v0 = 0.32, v1 = 0.82;
    var frame = [pr(u, v1, d0), pr(u, v1, d1), pr(u, v0, d1), pr(u, v0, d0)];
    var mid = (d0 + d1) / 2, vm = (v0 + v1) / 2;

    return [
      poly(frame, 'url(#apGlass)'),
      poly(frame, 'url(#apGlare)'),
      '<polygon points="' + pts(frame) + '" fill="none" stroke="' + P.trim + '" stroke-width="13" stroke-linejoin="round"/>',
      '<line x1="' + pr(u, v1, mid).x.toFixed(1) + '" y1="' + pr(u, v1, mid).y.toFixed(1) +
        '" x2="' + pr(u, v0, mid).x.toFixed(1) + '" y2="' + pr(u, v0, mid).y.toFixed(1) +
        '" stroke="' + P.trim + '" stroke-width="7"/>',
      '<line x1="' + pr(u, vm, d0).x.toFixed(1) + '" y1="' + pr(u, vm, d0).y.toFixed(1) +
        '" x2="' + pr(u, vm, d1).x.toFixed(1) + '" y2="' + pr(u, vm, d1).y.toFixed(1) +
        '" stroke="' + P.trim + '" stroke-width="6"/>',
      // подоконник
      poly([pr(u, v0, d0), pr(u, v0, d1),
            pr(u === 0 ? 0.06 : 0.94, v0, d1), pr(u === 0 ? 0.06 : 0.94, v0, d0)], P.trim),
      // свет, уходящий вглубь комнаты
      poly([pr(u, v1, d1), pr(u === 0 ? 0.34 : 0.66, v1 - 0.1, d1 + 0.16),
            pr(u === 0 ? 0.34 : 0.66, v0 + 0.06, d1 + 0.16), pr(u, v0, d1)],
        DAY_TINT, ' opacity="' + (G.day * 0.6).toFixed(3) + '" filter="url(#apBlur)"'),
      '<ellipse cx="' + pr(u, vm, mid).x.toFixed(1) + '" cy="' + pr(u, vm, mid).y.toFixed(1) +
        '" rx="165" ry="205" fill="url(#apDay)" opacity="' + (G.day * 1.4).toFixed(3) + '"/>'
    ].join('');
  }

  /** Пятно дневного света на полу под окном. */
  function daylightPool(G, pr) {
    if (!G.win) return '';
    var a = G.win === 'left' ? 0.02 : 0.58, b = G.win === 'left' ? 0.42 : 0.98;
    return floorQuad(pr, a, b, 0.18, 0.9, DAY_TINT,
      ' opacity="' + G.day + '" filter="url(#apBlur)"');
  }

  /**
   * Потолок, пол, три стены, карниз, плинтус и окно.
   * Дальняя стена — акцентная, боковые — основной цвет: со стороны окна
   * светлее, с противоположной в полутени.
   */
  function roomShell(P, G, pr) {
    var bx0 = G.bx0, bx1 = G.bx1, by0 = G.by0, by1 = G.by1;
    var r1 = function (v) { return v.toFixed(1); };
    var ceilPts = '0,0 ' + VIEW_W + ',0 ' + r1(bx1) + ',' + r1(by0) + ' ' + r1(bx0) + ',' + r1(by0);
    var floorPts = '0,' + VIEW_H + ' ' + VIEW_W + ',' + VIEW_H + ' ' + r1(bx1) + ',' + r1(by1) + ' ' + r1(bx0) + ',' + r1(by1);
    var leftPts = '0,0 ' + r1(bx0) + ',' + r1(by0) + ' ' + r1(bx0) + ',' + r1(by1) + ' 0,' + VIEW_H;
    var rightPts = VIEW_W + ',0 ' + r1(bx1) + ',' + r1(by0) + ' ' + r1(bx1) + ',' + r1(by1) + ' ' + VIEW_W + ',' + VIEW_H;
    var litLeft = G.win !== 'right';
    var PL = 0.045;   // высота плинтуса
    var CR = 0.972;   // низ карниза

    return [
      '<polygon points="' + ceilPts + '" fill="' + P.ceiling + '"/>',
      '<polygon points="' + ceilPts + '" fill="url(#apCeil)"/>',

      '<polygon points="' + floorPts + '" fill="' + P.floor + '"/>',
      '<clipPath id="apFloorClip"><polygon points="' + floorPts + '"/></clipPath>',
      '<g clip-path="url(#apFloorClip)">',
      floorSeams(pr, G),
      daylightPool(G, pr),
      '<polygon points="' + floorPts + '" fill="url(#apFloor)"/>',
      '</g>',

      '<polygon points="' + leftPts + '" fill="' + P.wall + '"/>',
      '<polygon points="' + leftPts + '" fill="url(#' + (litLeft ? 'apLit' : 'apShade') + ')"/>',
      '<polygon points="' + rightPts + '" fill="' + P.wall + '"/>',
      litLeft
        ? '<polygon points="' + rightPts + '" fill="url(#apShade)"/>'
        : '<polygon points="' + rightPts + '" fill="url(#apLit)" transform="translate(' + VIEW_W + ',0) scale(-1,1)"/>',

      '<rect x="' + r1(bx0) + '" y="' + r1(by0) + '" width="' + r1(bx1 - bx0) + '" height="' + r1(by1 - by0) + '" fill="' + P.accent + '"/>',
      '<rect x="' + r1(bx0) + '" y="' + r1(by0) + '" width="' + r1(bx1 - bx0) + '" height="' + r1(by1 - by0) + '" fill="url(#apBack)"/>',
      // мягкая тень в стыках стен — воздух в углах
      '<rect x="' + r1(bx0) + '" y="' + r1(by0) + '" width="28" height="' + r1(by1 - by0) + '" fill="#000" opacity=".11" filter="url(#apBlurS)"/>',
      '<rect x="' + r1(bx1 - 28) + '" y="' + r1(by0) + '" width="28" height="' + r1(by1 - by0) + '" fill="#000" opacity=".11" filter="url(#apBlurS)"/>',

      // плинтус: по дальней стене и по обеим боковым, в перспективе
      poly([pr(0, PL, 0), pr(1, PL, 0), pr(1, 0, 0), pr(0, 0, 0)], P.trim),
      poly([pr(0, PL, 0), pr(0, PL, 1), pr(0, 0, 1), pr(0, 0, 0)], P.trim),
      poly([pr(0, PL, 0), pr(0, PL, 1), pr(0, 0, 1), pr(0, 0, 0)], '#000000', ' opacity=".07"'),
      poly([pr(1, PL, 0), pr(1, PL, 1), pr(1, 0, 1), pr(1, 0, 0)], P.trim),
      poly([pr(1, PL, 0), pr(1, PL, 1), pr(1, 0, 1), pr(1, 0, 0)], '#000000', ' opacity=".12"'),

      // карниз по периметру потолка
      poly([pr(0, 1, 0), pr(1, 1, 0), pr(1, CR, 0), pr(0, CR, 0)], P.trim),
      poly([pr(0, 1, 0), pr(0, 1, 1), pr(0, CR, 1), pr(0, CR, 0)], P.trim),
      poly([pr(1, 1, 0), pr(1, 1, 1), pr(1, CR, 1), pr(1, CR, 0)], P.trim),
      poly([pr(1, 1, 0), pr(1, 1, 1), pr(1, CR, 1), pr(1, CR, 0)], '#000000', ' opacity=".10"'),

      sideWindow(P, G, pr)
    ].join('');
  }

  /* ------------------------------------------------------------
   *  Обстановка помещений
   *
   *  Всё задаётся в координатах комнаты, поэтому предметы стоят
   *  на полу, а не висят на стене, и сами получают перспективу.
   * ---------------------------------------------------------- */

  /** Ножки под столешницей или корпусом. */
  function legs(pr, u0, u1, v, d0, d1, fill) {
    var t = 0.014, s = 0.02;
    return [
      box(pr, u0 + s, u0 + s + t, 0, v, d1 - s - t, d1 - s, fill, { flat: true }),
      box(pr, u1 - s - t, u1 - s, 0, v, d1 - s - t, d1 - s, fill, { flat: true }),
      box(pr, u0 + s, u0 + s + t, 0, v, d0 + s, d0 + s + t, fill, { flat: true }),
      box(pr, u1 - s - t, u1 - s, 0, v, d0 + s, d0 + s + t, fill, { flat: true })
    ].join('');
  }

  /** Плоская картина или панель на дальней стене. */
  function wallPanel(pr, u0, u1, v0, v1, fill, extra) {
    return poly([pr(u0, v1, 0), pr(u1, v1, 0), pr(u1, v0, 0), pr(u0, v0, 0)], fill, extra);
  }

  /** Плоскость на боковой стене (u = 0 или 1). */
  function sidePanel(pr, u, v0, v1, d0, d1, fill, extra) {
    return poly([pr(u, v1, d0), pr(u, v1, d1), pr(u, v0, d1), pr(u, v0, d0)], fill, extra);
  }

  /** Горизонтальная плоскость на высоте v — столешница, сиденье, полка. */
  function slab(pr, u0, u1, v, d0, d1, fill, extra) {
    return poly([pr(u0, v, d0), pr(u1, v, d0), pr(u1, v, d1), pr(u0, v, d1)], fill, extra);
  }

  /**
   * Стул: ножки, сиденье и спинка вместо сплошного бруска.
   * back — 'far' спинкой от зрителя, 'near' спинкой к зрителю.
   */
  function chair(pr, u0, u1, d0, d1, P, back) {
    var seat = 0.165, top = 0.34;
    var bd0 = back === 'near' ? d1 - 0.03 : d0;
    return [
      floorShadow(pr, u0, u1, d0, d1, 0.2),
      legs(pr, u0, u1, seat, d0, d1, P.wood),
      box(pr, u0, u1, seat, seat + 0.03, d0, d1, P.furniture),
      box(pr, u0 + 0.006, u1 - 0.006, seat + 0.03, top, bd0, bd0 + 0.03, P.furniture)
    ].join('');
  }

  /** Картина в раме на дальней стене. */
  function picture(pr, u0, u1, v0, v1, P, inner) {
    return wallPanel(pr, u0, u1, v0, v1, P.trim) +
           wallPanel(pr, u0 + 0.012, u1 - 0.012, v0 + 0.018, v1 - 0.018, inner);
  }

  var ROOM_BUILDERS = {

    /* --- Гостиная --- */
    living: function (P, G, pr) {
      return [
        // дверь в правой стене
        sidePanel(pr, 1, 0, 0.78, 0.34, 0.64, P.door),
        sidePanel(pr, 1, 0, 0.78, 0.34, 0.64, '#000000', ' opacity=".10"'),
        '<polygon points="' + pts([pr(1, 0.78, 0.34), pr(1, 0.78, 0.64), pr(1, 0, 0.64), pr(1, 0, 0.34)]) +
          '" fill="none" stroke="' + P.trim + '" stroke-width="9" stroke-linejoin="round"/>',
        sidePanel(pr, 1, 0.12, 0.68, 0.38, 0.60, '#000000', ' opacity=".06"'),

        // ковёр
        floorQuad(pr, 0.14, 0.86, 0.06, 0.66, P.soft, ' opacity=".34"'),
        floorQuad(pr, 0.17, 0.83, 0.10, 0.62, 'none', ' stroke="#000" stroke-opacity=".08" stroke-width="3"'),

        // диван у дальней стены
        floorShadow(pr, 0.22, 0.78, 0.04, 0.28, 0.26),
        box(pr, 0.25, 0.75, 0, 0.34, 0.05, 0.12, P.furniture),          // спинка
        box(pr, 0.25, 0.75, 0, 0.20, 0.05, 0.27, P.furniture),          // сиденье
        slab(pr, 0.30, 0.70, 0.201, 0.09, 0.265, P.soft, ' opacity=".35"'),
        box(pr, 0.24, 0.30, 0, 0.27, 0.05, 0.27, P.furniture),          // подлокотники
        box(pr, 0.70, 0.76, 0, 0.27, 0.05, 0.27, P.furniture),
        box(pr, 0.33, 0.41, 0.20, 0.31, 0.09, 0.13, P.soft),            // подушки
        box(pr, 0.59, 0.67, 0.20, 0.31, 0.09, 0.13, P.soft),

        // журнальный столик: 0,4 м, а не вровень с обеденным
        floorShadow(pr, 0.40, 0.62, 0.36, 0.54, 0.22),
        legs(pr, 0.40, 0.62, 0.15, 0.36, 0.52, P.wood),
        box(pr, 0.39, 0.63, 0.15, 0.175, 0.35, 0.53, P.woodLit),

        // картины на акцентной стене
        picture(pr, 0.30, 0.42, 0.60, 0.80, P, P.door),
        picture(pr, 0.45, 0.53, 0.58, 0.83, P, P.furniture),

        // торшер у окна
        floorShadow(pr, 0.10, 0.16, 0.32, 0.38, 0.2),
        box(pr, 0.115, 0.145, 0, 0.012, 0.335, 0.365, P.door, { flat: true }),
        box(pr, 0.127, 0.133, 0, 0.50, 0.347, 0.353, P.door, { flat: true }),
        '<polygon points="' + pts([pr(0.093, 0.62, 0.35), pr(0.167, 0.62, 0.35), pr(0.152, 0.50, 0.35), pr(0.108, 0.50, 0.35)]) +
          '" fill="' + P.soft + '"/>',

        // растение в углу
        floorShadow(pr, 0.83, 0.93, 0.10, 0.20, 0.2),
        box(pr, 0.855, 0.905, 0, 0.11, 0.13, 0.18, P.trim),
        '<path d="M' + pr(0.88, 0.11, 0.155).x.toFixed(0) + ' ' + pr(0.88, 0.11, 0.155).y.toFixed(0) +
          ' c-30,-14 -40,-52 -28,-80 28,8 44,38 28,80z" fill="#5C6B4F"/>',
        '<path d="M' + pr(0.88, 0.11, 0.155).x.toFixed(0) + ' ' + pr(0.88, 0.11, 0.155).y.toFixed(0) +
          ' c28,-18 34,-56 20,-80 -28,12 -36,46 -20,80z" fill="#7B8F6C"/>'
      ].join('');
    },

    /* --- Кухня --- */
    kitchen: function (P, G, pr) {
      var out = [
        // фартук
        wallPanel(pr, 0.06, 0.86, 0.35, 0.53, P.trim),
        wallPanel(pr, 0.06, 0.86, 0.35, 0.53, 'url(#apBack)')
      ];
      for (var i = 1; i < 12; i++) {
        var u = 0.06 + (0.80 * i / 12);
        var a = pr(u, 0.35, 0), b = pr(u, 0.53, 0);
        out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) +
                 '" y2="' + b.y.toFixed(1) + '" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      }

      return out.concat([
        // нижний ряд и столешница
        floorShadow(pr, 0.05, 0.87, 0.0, 0.16, 0.2),
        box(pr, 0.06, 0.86, 0.04, 0.33, 0, 0.14, P.furniture),
        box(pr, 0.05, 0.87, 0.33, 0.355, 0, 0.155, P.woodLit),
        slab(pr, 0.14, 0.24, 0.356, 0.02, 0.12, P.metal),               // мойка
        '<path d="M' + pr(0.19, 0.356, 0.04).x.toFixed(0) + ' ' + pr(0.19, 0.356, 0.04).y.toFixed(0) +
          ' v-34 q0,-10 12,-10 h8" stroke="' + P.metal + '" stroke-width="5" fill="none" stroke-linecap="round"/>',
        slab(pr, 0.46, 0.60, 0.357, 0.02, 0.12, '#3B3E3A'),             // варочная панель

        // навесные шкафы слева, открытые полки справа
        box(pr, 0.08, 0.40, 0.56, 0.80, 0, 0.09, P.furniture),
        slab(pr, 0.60, 0.84, 0.60, 0, 0.075, P.trim),
        slab(pr, 0.60, 0.84, 0.72, 0, 0.075, P.trim),
        box(pr, 0.63, 0.66, 0.60, 0.69, 0.02, 0.05, P.wood, { flat: true }),
        box(pr, 0.67, 0.695, 0.60, 0.665, 0.02, 0.05, P.soft, { flat: true }),
        box(pr, 0.70, 0.735, 0.72, 0.795, 0.02, 0.05, P.door, { flat: true }),
        box(pr, 0.75, 0.78, 0.72, 0.78, 0.02, 0.05, P.wood, { flat: true }),

        // вытяжка
        '<polygon points="' + pts([pr(0.46, 0.80, 0), pr(0.60, 0.80, 0), pr(0.575, 0.66, 0.055), pr(0.485, 0.66, 0.055)]) +
          '" fill="' + P.trim + '"/>',
        box(pr, 0.51, 0.55, 0.80, 0.94, 0.01, 0.045, P.trim, { flat: true }),

        // холодильник
        floorShadow(pr, 0.86, 1.0, 0.0, 0.20, 0.24),
        box(pr, 0.87, 1.0, 0, 0.68, 0, 0.17, P.door),
        slab(pr, 0.87, 1.0, 0.42, 0.001, 0.169, '#000000', ' opacity=".16"'),

        // остров с табуретами
        floorShadow(pr, 0.26, 0.72, 0.40, 0.66, 0.26),
        box(pr, 0.28, 0.70, 0.03, 0.33, 0.44, 0.62, P.furniture),
        box(pr, 0.27, 0.71, 0.33, 0.355, 0.43, 0.63, P.woodLit),
        slab(pr, 0.29, 0.69, 0.331, 0.45, 0.61, '#000000', ' opacity=".10"'),
        // барные табуреты у острова
        floorShadow(pr, 0.34, 0.42, 0.66, 0.74, 0.2),
        legs(pr, 0.34, 0.42, 0.24, 0.66, 0.74, P.wood),
        box(pr, 0.335, 0.425, 0.24, 0.275, 0.655, 0.745, P.door),
        floorShadow(pr, 0.56, 0.64, 0.66, 0.74, 0.2),
        legs(pr, 0.56, 0.64, 0.24, 0.66, 0.74, P.wood),
        box(pr, 0.555, 0.645, 0.24, 0.275, 0.655, 0.745, P.door)
      ]).join('');
    },

    /* --- Столовая --- */
    dining: function (P, G, pr) {
      var top = 0.285;
      return [
        // буфет и картина
        floorShadow(pr, 0.08, 0.36, 0.0, 0.16, 0.22),
        box(pr, 0.09, 0.35, 0.05, 0.31, 0, 0.13, P.door),
        box(pr, 0.08, 0.36, 0.31, 0.335, 0, 0.14, P.woodLit),
        picture(pr, 0.12, 0.32, 0.50, 0.78, P, P.furniture),

        // подвес над столом
        '<line x1="' + pr(0.5, 1, 0.34).x.toFixed(1) + '" y1="0" x2="' + pr(0.5, 1, 0.34).x.toFixed(1) +
          '" y2="' + pr(0.5, 0.78, 0.34).y.toFixed(1) + '" stroke="' + P.door + '" stroke-width="4"/>',
        '<polygon points="' + pts([pr(0.44, 0.66, 0.34), pr(0.56, 0.66, 0.34), pr(0.535, 0.78, 0.34), pr(0.465, 0.78, 0.34)]) +
          '" fill="' + P.soft + '"/>',

        // стулья за столом
        chair(pr, 0.31, 0.43, 0.13, 0.24, P, 'far'),
        chair(pr, 0.57, 0.69, 0.13, 0.24, P, 'far'),

        // стол
        floorShadow(pr, 0.24, 0.76, 0.20, 0.52, 0.26),
        legs(pr, 0.26, 0.74, top, 0.22, 0.50, P.wood),
        box(pr, 0.25, 0.75, top, top + 0.028, 0.21, 0.51, P.woodLit),
        // ваза
        box(pr, 0.485, 0.515, top + 0.028, top + 0.09, 0.34, 0.37, P.trim, { flat: true }),

        // стулья перед столом, спинками к зрителю
        chair(pr, 0.31, 0.43, 0.47, 0.58, P, 'near'),
        chair(pr, 0.57, 0.69, 0.47, 0.58, P, 'near')
      ].join('');
    },

    /* --- Спальня --- */
    bedroom: function (P, G, pr) {
      return [
        floorQuad(pr, 0.12, 0.88, 0.08, 0.76, P.soft, ' opacity=".3"'),

        // изголовье
        box(pr, 0.27, 0.73, 0.10, 0.50, 0.02, 0.07, P.furniture),

        // кровать
        floorShadow(pr, 0.24, 0.76, 0.04, 0.56, 0.26),
        box(pr, 0.28, 0.72, 0, 0.12, 0.07, 0.50, P.wood),                // основание
        box(pr, 0.26, 0.74, 0.12, 0.26, 0.05, 0.53, P.soft),             // матрас с покрывалом
        slab(pr, 0.262, 0.738, 0.261, 0.055, 0.525, P.soft, ' opacity=".45"'),
        slab(pr, 0.262, 0.738, 0.262, 0.055, 0.20, '#FFFFFF', ' opacity=".5"'),
        box(pr, 0.30, 0.45, 0.26, 0.33, 0.07, 0.16, '#FFFFFF'),          // подушки
        box(pr, 0.55, 0.70, 0.26, 0.33, 0.07, 0.16, '#FFFFFF'),

        // тумбы и лампы
        floorShadow(pr, 0.12, 0.26, 0.02, 0.16, 0.22),
        box(pr, 0.13, 0.25, 0.03, 0.22, 0.03, 0.15, P.door),
        slab(pr, 0.128, 0.252, 0.221, 0.028, 0.152, P.wood),
        box(pr, 0.185, 0.195, 0.222, 0.30, 0.085, 0.095, P.trim, { flat: true }),
        '<polygon points="' + pts([pr(0.155, 0.38, 0.09), pr(0.225, 0.38, 0.09), pr(0.211, 0.30, 0.09), pr(0.169, 0.30, 0.09)]) +
          '" fill="' + P.soft + '"/>',
        floorShadow(pr, 0.74, 0.88, 0.02, 0.16, 0.22),
        box(pr, 0.75, 0.87, 0.03, 0.22, 0.03, 0.15, P.door),
        slab(pr, 0.748, 0.872, 0.221, 0.028, 0.152, P.wood),
        box(pr, 0.805, 0.815, 0.222, 0.30, 0.085, 0.095, P.trim, { flat: true }),
        '<polygon points="' + pts([pr(0.775, 0.38, 0.09), pr(0.845, 0.38, 0.09), pr(0.831, 0.30, 0.09), pr(0.789, 0.30, 0.09)]) +
          '" fill="' + P.soft + '"/>',

        // картина над изголовьем
        picture(pr, 0.36, 0.64, 0.56, 0.76, P, P.wood)
      ].join('');
    },

    /* --- Кабинет --- */
    office: function (P, G, pr) {
      var out = [
        // стеллаж вдоль дальней стены
        floorShadow(pr, 0.52, 0.92, 0.0, 0.16, 0.22),
        box(pr, 0.53, 0.91, 0.04, 0.82, 0, 0.14, P.door)
      ];
      [0.26, 0.44, 0.62].forEach(function (v, row) {
        out.push(slab(pr, 0.545, 0.895, v, 0.005, 0.135, P.trim, ' opacity=".85"'));
        for (var i = 0; i < 9; i++) {
          var h = 0.055 + ((i * 7 + row * 5) % 14) / 400;
          var fill = i % 3 === 0 ? P.furniture : i % 3 === 1 ? P.soft : P.wood;
          out.push(box(pr, 0.552 + i * 0.038, 0.552 + i * 0.038 + 0.024, v, v + h, 0.03, 0.09, fill, { flat: true }));
        }
      });

      return out.concat([
        // стол у окна
        floorShadow(pr, 0.08, 0.44, 0.26, 0.56, 0.24),
        legs(pr, 0.10, 0.42, 0.28, 0.28, 0.54, P.wood),
        box(pr, 0.09, 0.43, 0.28, 0.305, 0.27, 0.55, P.woodLit),
        box(pr, 0.11, 0.27, 0.03, 0.27, 0.30, 0.50, P.furniture),        // тумба

        // монитор и лампа
        box(pr, 0.20, 0.36, 0.305, 0.50, 0.33, 0.35, '#2E312C'),
        sidePanel(pr, 0.5, 0, 0, 0, 0, 'none'),
        box(pr, 0.275, 0.285, 0.30, 0.315, 0.36, 0.40, '#2E312C', { flat: true }),
        box(pr, 0.385, 0.395, 0.305, 0.42, 0.36, 0.37, P.trim, { flat: true }),
        '<polygon points="' + pts([pr(0.365, 0.48, 0.365), pr(0.415, 0.48, 0.365), pr(0.405, 0.42, 0.365), pr(0.375, 0.42, 0.365)]) +
          '" fill="' + P.soft + '"/>',

        // кресло
        floorShadow(pr, 0.21, 0.35, 0.56, 0.70, 0.24),
        box(pr, 0.275, 0.295, 0, 0.17, 0.625, 0.645, P.door, { flat: true }),
        box(pr, 0.24, 0.33, 0, 0.025, 0.60, 0.67, P.door, { flat: true }),
        box(pr, 0.21, 0.35, 0.17, 0.21, 0.56, 0.70, P.furniture),
        box(pr, 0.215, 0.345, 0.21, 0.42, 0.665, 0.695, P.furniture),

        floorQuad(pr, 0.18, 0.92, 0.30, 0.86, P.soft, ' opacity=".26"')
      ]).join('');
    },

    /* --- Ванная --- */
    bath: function (P, G, pr) {
      var out = [
        wallPanel(pr, 0, 1, 0.045, 0.52, P.trim),
        wallPanel(pr, 0, 1, 0.045, 0.52, 'url(#apBack)')
      ];
      for (var i = 1; i < 10; i++) {
        var a = pr(i / 10, 0.045, 0), b = pr(i / 10, 0.52, 0);
        out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) +
                 '" y2="' + b.y.toFixed(1) + '" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      }
      [0.20, 0.36].forEach(function (v) {
        var a = pr(0, v, 0), b = pr(1, v, 0);
        out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) +
                 '" y2="' + b.y.toFixed(1) + '" stroke="#000" stroke-opacity=".07" stroke-width="1.5"/>');
      });

      return out.concat([
        // тумба с раковиной
        floorShadow(pr, 0.30, 0.56, 0.0, 0.16, 0.22),
        box(pr, 0.31, 0.55, 0.05, 0.32, 0, 0.14, P.furniture),
        box(pr, 0.30, 0.56, 0.32, 0.345, 0, 0.15, P.trim),
        slab(pr, 0.36, 0.50, 0.346, 0.02, 0.12, P.white),
        '<path d="M' + pr(0.43, 0.346, 0.04).x.toFixed(0) + ' ' + pr(0.43, 0.346, 0.04).y.toFixed(0) +
          ' v-30 q0,-9 11,-9 h7" stroke="' + P.metal + '" stroke-width="5" fill="none" stroke-linecap="round"/>',

        // зеркало и бра
        wallPanel(pr, 0.33, 0.53, 0.56, 0.82, '#DCE6EC'),
        wallPanel(pr, 0.33, 0.53, 0.56, 0.82, 'url(#apGlare)'),
        '<polygon points="' + pts([pr(0.33, 0.82, 0), pr(0.53, 0.82, 0), pr(0.53, 0.56, 0), pr(0.33, 0.56, 0)]) +
          '" fill="none" stroke="' + P.trim + '" stroke-width="6"/>',
        wallPanel(pr, 0.575, 0.605, 0.70, 0.74, '#EFEADF'),
        wallPanel(pr, 0.255, 0.285, 0.70, 0.74, '#EFEADF'),

        // ванна вдоль левой стены
        floorShadow(pr, 0.0, 0.30, 0.22, 0.72, 0.24),
        box(pr, 0.01, 0.29, 0.02, 0.21, 0.24, 0.70, P.white),
        slab(pr, 0.03, 0.27, 0.215, 0.26, 0.68, '#DCE6EC'),
        '<path d="M' + pr(0.28, 0.215, 0.30).x.toFixed(0) + ' ' + pr(0.28, 0.215, 0.30).y.toFixed(0) +
          ' v-38 q0,-10 -12,-10 h-8" stroke="' + P.metal + '" stroke-width="6" fill="none" stroke-linecap="round"/>',

        // унитаз: бачок у стены, чаша вынесена вперёд
        floorShadow(pr, 0.73, 0.85, 0.02, 0.30, 0.22),
        box(pr, 0.755, 0.825, 0.14, 0.33, 0.02, 0.12, P.white),          // бачок
        box(pr, 0.762, 0.818, 0.02, 0.15, 0.12, 0.26, P.white),          // ножка чаши
        box(pr, 0.748, 0.832, 0.15, 0.175, 0.11, 0.30, P.white),         // чаша
        slab(pr, 0.752, 0.828, 0.176, 0.12, 0.29, '#E4E8E6'),

        // полотенца
        slab(pr, 0.60, 0.72, 0.50, 0, 0.03, P.trim),
        box(pr, 0.615, 0.655, 0.32, 0.50, 0.005, 0.025, P.soft, { flat: true }),
        box(pr, 0.665, 0.705, 0.36, 0.50, 0.005, 0.025, P.furniture, { flat: true })
      ]).join('');
    },

    /* --- Прихожая --- */
    hall: function (P, G, pr) {
      return [
        // входная дверь в дальней стене
        wallPanel(pr, 0.34, 0.66, 0.02, 0.80, P.door),
        wallPanel(pr, 0.34, 0.66, 0.02, 0.80, 'url(#apSoft)'),
        '<polygon points="' + pts([pr(0.34, 0.80, 0), pr(0.66, 0.80, 0), pr(0.66, 0.02, 0), pr(0.34, 0.02, 0)]) +
          '" fill="none" stroke="' + P.trim + '" stroke-width="10"/>',
        wallPanel(pr, 0.38, 0.62, 0.50, 0.72, '#000000', ' opacity=".08"'),
        wallPanel(pr, 0.38, 0.62, 0.16, 0.44, '#000000', ' opacity=".08"'),
        wallPanel(pr, 0.625, 0.645, 0.40, 0.44, P.trim),

        // освещённый проём в комнату — единственный источник света
        sidePanel(pr, 1, 0, 0.80, 0.28, 0.66, '#F6F1E6'),
        sidePanel(pr, 1, 0, 0.80, 0.28, 0.66, 'url(#apGlare)'),
        '<polygon points="' + pts([pr(1, 0.80, 0.28), pr(1, 0.80, 0.66), pr(1, 0, 0.66), pr(1, 0, 0.28)]) +
          '" fill="none" stroke="' + P.trim + '" stroke-width="10" stroke-linejoin="round"/>',
        floorQuad(pr, 0.52, 1, 0.24, 0.86, DAY_TINT, ' opacity="' + G.day + '" filter="url(#apBlur)"'),

        // консоль с зеркалом слева
        floorShadow(pr, 0.04, 0.30, 0.18, 0.42, 0.22),
        legs(pr, 0.06, 0.28, 0.30, 0.20, 0.40, P.wood),
        box(pr, 0.05, 0.29, 0.30, 0.325, 0.19, 0.41, P.woodLit),
        sidePanel(pr, 0, 0.46, 0.84, 0.22, 0.44, '#DCE6EC'),
        sidePanel(pr, 0, 0.46, 0.84, 0.22, 0.44, 'url(#apGlare)'),
        '<polygon points="' + pts([pr(0, 0.84, 0.22), pr(0, 0.84, 0.44), pr(0, 0.46, 0.44), pr(0, 0.46, 0.22)]) +
          '" fill="none" stroke="' + P.trim + '" stroke-width="7"/>',

        // банкетка и обувь
        floorShadow(pr, 0.30, 0.62, 0.60, 0.82, 0.24),
        legs(pr, 0.32, 0.60, 0.17, 0.62, 0.80, P.wood),
        box(pr, 0.31, 0.61, 0.17, 0.21, 0.61, 0.81, P.furniture),
        box(pr, 0.345, 0.415, 0, 0.045, 0.86, 0.94, P.door, { flat: true }),
        box(pr, 0.44, 0.51, 0, 0.045, 0.86, 0.94, P.door, { flat: true })
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

    /**
     * Площадь по геометрии выбранной поверхности. Стены — периметр на высоту,
     * потолок и пол — план, акцентная стена — большая сторона на высоту.
     * У столярки, двери и мебели геометрии в габаритах комнаты нет,
     * поэтому площадь остаётся за пользователем.
     */
    function basisArea() {
      var basis = currentBasis();
      if (!basis) return wallsBySize();
      if (basis.id === 'plan') return num('calcLength') * num('calcWidth');
      if (basis.id === 'accent') {
        return Math.max(num('calcLength'), num('calcWidth')) * num('calcHeight');
      }
      return wallsBySize();
    }

    /** Площадь считается автоматически только там, где её есть из чего вывести. */
    function basisIsAuto() {
      var opt = colorOptions().filter(function (o) { return o.value === colorState; })[0];
      return !opt || !!opt.basis;
    }

    /** Держит поле площади и подпись под ним в согласии с режимом ввода. */
    function syncArea() {
      if (!areaInput) return;
      var auto = basisIsAuto();
      var basis = currentBasis();
      if (!areaManual) {
        // у поверхности без геометрии поле очищается: цифра от прошлой
        // поверхности выглядела бы как посчитанная для этой
        areaInput.value = auto ? fmt(basisArea(), 1).replace(',', '.') : '';
      }
      if (areaReset) areaReset.hidden = !(areaManual && auto);
      // подпись поля идёт за выбранной поверхностью: «площадь стен» над
      // числом, посчитанным по потолку, читалась как ошибка расчёта
      var areaLabel = document.querySelector('label[for="calcArea"]');
      if (areaLabel) {
        areaLabel.textContent = !basis ? 'Площадь поверхности, м²'
          : basis.id === 'plan' ? 'Площадь потолка или пола, м²'
          : basis.id === 'accent' ? 'Площадь стены, м²'
          : 'Площадь стен, м²';
      }
      var note = byId('calcAreaNote');
      if (note) {
        note.textContent = !auto
          ? 'Задайте площадь этой поверхности сами — из размеров комнаты она не следует'
          : areaManual
            ? 'Введено вручную — размеры комнаты не учитываются'
            : 'Посчитано по размерам — ' + (basis ? basis.label : 'стены: 2 × (длина + ширина) × высота');
      }
      // потолок «в довесок» имеет смысл только при расчёте стен
      var wallsMode = !!basis && basis.id === 'walls';
      var ceilRow = byId('calcCeilingRow');
      if (ceilRow) {
        ceilRow.hidden = !wallsMode;
        if (!wallsMode && byId('calcCeiling')) byId('calcCeiling').checked = false;
      }
      // Проёмы вычитаются только из стен. На потолке, двери или столярке
      // вычитать нечего, а оставленные 6 м² уводили расчёт в минус
      // и результат просто не показывался.
      var openRow = byId('calcOpeningsRow');
      if (openRow) openRow.hidden = !wallsMode;
    }

    // калькулятор показывает выбранный цвет — пересчитываем при его смене
    document.addEventListener('archipaint:activecolor', function () {
      renderColorOptions();
      recalc();
    });
    // примерка перекрасила поверхности — список цветов обновляется вместе с ней
    document.addEventListener('archipaint:surfaces', function () {
      renderColorOptions();
      recalc();
    });

    function currentProduct() {
      return D.getProduct(productSel ? productSel.value : null) || D.PRODUCTS[0];
    }

    /* --------------------------------------------------------
     *  Выбор цвета: поверхности примерки, активный цвет и каталог
     *
     *  Клиент красит комнату не одной банкой: стены, потолок,
     *  столярка и дверь идут разными цветами и разными объёмами.
     *  Поэтому цвет выбирается из тех же поверхностей, что и
     *  в примерке, а площадь подставляется по геометрии этой
     *  поверхности — каждый цвет считается и кладётся в корзину
     *  отдельно.
     * ------------------------------------------------------ */

    var colorSel = byId('calcColorSel');
    // оттенок, выбранный вручную из каталога
    var pickedColor = null;

    // Как считать площадь для поверхности. null — площадь только вручную:
    // погонаж столярки, площадь мебели и двери из габаритов комнаты
    // не выводятся, и выдумывать их калькулятору нечего.
    var WALLS_BASIS = { id: 'walls', label: 'стены: 2 × (длина + ширина) × высота' };
    var AREA_BASIS = {
      wall:       WALLS_BASIS,
      accentWall: { id: 'accent',  label: 'одна стена: большая сторона × высота' },
      ceiling:    { id: 'plan',    label: 'потолок: длина × ширина' },
      floor:      { id: 'plan',    label: 'пол: длина × ширина' },
      trim:       null,
      furniture:  null,
      door:       null
    };

    function surfaceOptions() {
      return VIZ_SURFACES.map(function (sf) {
        var hex = vizState[sf.key];
        var match = hex ? D.nearestOne(hex, matchOpts()) : null;
        return {
          value: 'viz:' + sf.key,
          hex: hex,
          color: match ? match.color : null,
          label: sf.label,
          basis: AREA_BASIS[sf.key] || null
        };
      }).filter(function (o) { return !!o.color; });
    }

    /** Полный список вариантов выпадающего списка цвета. */
    function colorOptions() {
      var list = [];
      if (S.activeHex) {
        var m = D.nearestOne(S.activeHex, matchOpts());
        if (m) list.push({ value: 'active', hex: S.activeHex, color: m.color,
                           label: 'Выбранный цвет', basis: WALLS_BASIS, group: 'Подбор' });
      }
      surfaceOptions().forEach(function (o) { o.group = 'Примерка в комнате'; list.push(o); });
      if (pickedColor) {
        list.push({ value: 'picked', hex: pickedColor.hex, color: pickedColor,
                    label: 'Из каталога', basis: WALLS_BASIS, group: 'Каталог' });
      }
      return list;
    }

    function renderColorOptions() {
      if (!colorSel) return;
      var keep = colorSel.value;
      var list = colorOptions();
      clear(colorSel);

      if (!list.length) {
        colorSel.appendChild(el('option', { value: '' }, 'Цвет не выбран — база под колеровку'));
      }

      var groups = [];
      list.forEach(function (o) {
        var g = groups.filter(function (x) { return x.name === o.group; })[0];
        if (!g) { g = { name: o.group, items: [] }; groups.push(g); }
        g.items.push(o);
      });
      groups.forEach(function (g) {
        var box = el('optgroup', { label: g.name });
        g.items.forEach(function (o) {
          box.appendChild(el('option', { value: o.value },
            o.label + ' · ' + o.color.code + ' ' + o.color.name));
        });
        colorSel.appendChild(box);
      });

      colorSel.appendChild(el('option', { value: 'pick' }, 'Выбрать другой оттенок из каталога…'));

      var has = list.filter(function (o) { return o.value === keep; }).length;
      colorSel.value = has ? keep : (list.length ? list[0].value : '');
      colorState = colorSel.value;
    }

    // что выбрано в списке цветов
    var colorState = '';

    if (colorSel) {
      colorSel.addEventListener('change', function () {
        if (this.value === 'pick') {
          this.value = colorState;                 // не оставляем «выбрать…» выбранным
          if (openCatalog) {
            openCatalog(null, function (color) {
              pickedColor = color;
              renderColorOptions();
              if (colorSel) { colorSel.value = 'picked'; colorState = 'picked'; }
              areaManual = false;
              syncArea();
              recalc();
              scrollToSection(byId('calculator'));
              toast('Цвет калькулятора: ' + color.code + ' · ' + color.name);
            });
          }
          return;
        }
        colorState = this.value;
        // новая поверхность — новая геометрия, ручной ввод площади сбрасываем
        areaManual = false;
        syncArea();
        recalc();
      });
    }

    /** Цвет, в который будет заколерована краска. */
    function currentColor() {
      var opt = colorOptions().filter(function (o) { return o.value === colorState; })[0];
      return opt ? opt.color : null;
    }

    /** Название поверхности — попадает в корзину отдельной строкой. */
    function currentSurface() {
      var opt = colorOptions().filter(function (o) { return o.value === colorState; })[0];
      return opt && opt.group === 'Примерка в комнате' ? opt.label : null;
    }

    /** Способ расчёта площади для выбранной поверхности. */
    function currentBasis() {
      var opt = colorOptions().filter(function (o) { return o.value === colorState; })[0];
      return opt ? opt.basis : null;
    }

    function renderColorChip() {
      var sw = byId('calcColorSw');
      var note = byId('calcColorNote');
      var color = currentColor();
      if (sw) sw.style.background = color ? displayHex(color.hex) : '';   // пусто — вернётся штриховка «нет цвета» из CSS
      if (note) {
        var basis = currentBasis();
        note.textContent = !color
          ? 'Цвет не выбран — краска пойдёт как база под колеровку'
          : basis
            ? 'Площадь подставлена по геометрии — ' + basis.label
            : 'Площадь этой поверхности задайте вручную — из габаритов комнаты она не выводится';
      }
    }

    // порядок важен: список цветов задаёт способ расчёта площади,
    // поэтому он строится до первой синхронизации поля площади
    renderColorOptions();
    syncArea();
    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });
    recalc();

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

      var basis = currentBasis();
      var wallsMode = !!basis && basis.id === 'walls';
      if (!wallsMode) openings = 0;

      var wallArea = (areaManual || !basisIsAuto()) ? num('calcArea') : basisArea();
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
        wallsMode && openings ? ['Вычтено проёмов', fmt(openings, 1) + ' м²'] : null,
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
      var surface = currentSurface();
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
                surface: surface,
                productSku: product.sku,
                productName: (surface ? surface + ' · ' : '') + product.name + ' · ' + product.sheen,
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
            toast('Добавлено в корзину: ' + (surface ? surface.toLowerCase() + ', ' : '') +
              fmt(plan.litres, 1) + ' л' + (color ? ' · ' + color.code : ''));
          }
        }, 'В корзину — ' + plan.price.toLocaleString('ru-RU') + ' ₽'),
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          onclick: function () {
            copyText(
              (surface ? surface + ': ' : '') +
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
      } else if (surface) {
        out.appendChild(el('p', { class: 'fine', style: { marginTop: '10px' },
          text: 'Считается только «' + surface.toLowerCase() + '». Для остальных поверхностей выберите их в списке цвета и добавьте в корзину отдельно.' }));
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
    initWheelModes();
    initShortcuts();

    // Любая смена базового цвета — из фото, пипетки, каталога, стандарта,
    // координат или ссылки — сразу перестраивает гармонии и интерьерные
    // палитры. Раньше об этом помнил каждый обработчик по отдельности,
    // и пипетка забывала: палитры оставались от прошлого цвета, пока
    // пользователь не трогал их сам.
    document.addEventListener('archipaint:activecolor', function () {
      renderResults();
      renderHarmony();
      // полоски настроений строятся от базового цвета, поэтому их тоже надо
      // пересобрать: иначе ряд «Настроение палитры» оставался от прошлого
      // оттенка и оживал только после клика по карточке
      renderMoodGrid();
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
    refresh: function () { renderResults(); renderHarmony(); renderMoodGrid(); renderInteriorSection(); },
    toast: toast
  };
})(typeof window !== 'undefined' ? window : globalThis);
