document.addEventListener("DOMContentLoaded", function() {
    "use strict";

    var RAD = Math.PI/180;
    /* --- Состояние интерфейса --- */
    var selectedStyle = null;
    var uploadedFile = null;
    var mockInterval = null;

    /* --- Поиск DOM-элементов --- */
    var dropSection = document.getElementById("dropSection");
    var previewSection = document.getElementById("previewSection");
    var pvHolder = document.getElementById("pvHolder");
    var fileInput = document.getElementById("fileInput");
    var btnPick = document.getElementById("btnPick");
    var btnReplace = document.getElementById("btnReplace");
    var btnReset = document.getElementById("btnReset");
    var fileNameNote = document.getElementById("fileNameNote");
    
    var roomTypeSelect = document.getElementById("roomType");
    var styleChips = document.getElementById("styleChips");
    var notesInput = document.getElementById("notesInput");
    var genBtn = document.getElementById("genBtn");
    
    var genProgress = document.getElementById("genProgress");
    var genFill = document.getElementById("genFill");
    var genStatus = document.getElementById("genStatus");
    var genForm = document.getElementById("genForm");
    var btnPicker = document.getElementById("btnInlinePicker");

    var genResult = document.getElementById("genResult");
    var beforeImg = document.getElementById("beforeImg");
    var afterImg = document.getElementById("afterImg");
    var genPromptEcho = document.getElementById("genPromptEcho");
    
    var btnRegenerate = document.getElementById("btnRegenerate");
    var btnDownload = document.getElementById("btnDownload");
    var btnNewPhoto = document.getElementById("btnNewPhoto");
    
    var candidatesCard = document.getElementById("candidatesCard");
    var candIntro = document.getElementById("candIntro");
    var resultsEl = document.getElementById("results");
    var candGrid = resultsEl;
    var harmonyCard = document.getElementById("harmonyCard");
    var previewWrap = document.getElementById("previewWrap");
    var genCompare = document.querySelector(".gen-compare");

    var wheelCanvas = document.getElementById("wheel");
    var schemeTabs = document.getElementById("schemeTabs");
    var baseRow = document.getElementById("baseRow");
    var schemeDesc = document.getElementById("schemeDesc");
    var hsGrid = document.getElementById("hsGrid");

    var cardBack = document.getElementById("cardBack");

    var pvHolder = document.getElementById("pvHolder");
    var loupe = document.getElementById("loupe");
    var loupeSw = document.getElementById("loupeSw");
    var loupeHex = document.getElementById("loupeHex");
    var pickDot = document.getElementById("pickDot");

    var selectedBaseHex=null;
    var toastEl = document.getElementById("toast");
    var catSearch = document.getElementById("catSearch");
    var currentUrl=null, toastTimer=null;
    var EMPTY_HTML=candGrid.innerHTML;
    var pickCanvas=null, pickCtx=null;
    var currentRows=[], pickedColor=null, lastPick=null, pickerActive=false;
    var selectedBaseHex=null, selectedScheme="complementary", wheelImg=null;
    var catBuilt=false, catSearchTimer=null;
    var coordForcedMode="auto", coordTimer=null;
    var wheelImg = null;

    // ВАЖНО: Кнопка генерации Изначально активна, валидацию делаем при клике
    if (genBtn) {
        genBtn.disabled = false;
    }

    function toast(msg){
        toastEl.textContent=msg; toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer=setTimeout(function(){toastEl.classList.remove("show");},2800);
    }

    catSearch.addEventListener("input",function(){
        clearTimeout(catSearchTimer);
        catSearchTimer=setTimeout(function(){renderCatGrid(catSearch.value);},140);
    });

    document.getElementById("navCatalog").addEventListener("click", function(e) {
        e.preventDefault();
        openCatalog();
    });

    function openCatalog(){
        renderCatGrid(""); // Запрашиваем пустую строку (Битрикс вернет первые 150 товаров)
        showBack(catBack);  // Показываем модальное окно
    }

    /* --- Клик по чипсам стилей --- */
    styleChips.addEventListener("click", function(e) {
        var chip = e.target.closest(".style-chip");
        if (!chip) return;
        
        Array.prototype.forEach.call(styleChips.children, function(c) {
            c.classList.remove("active");
        });
        chip.classList.add("active");
        selectedStyle = chip.dataset.style;
    });

    //roomTypeSelect.addEventListener("change", validateForm);

    genBtn.disabled = false;

    btnPick.addEventListener("click", function(e) { e.stopPropagation(); fileInput.click(); });
    dropSection.addEventListener("click", function() { fileInput.click(); });
    
    fileInput.addEventListener("change", function() {
        if (fileInput.files.length) handleIncomingFile(fileInput.files[0]);
    });

    var uploadCard = document.getElementById("uploadCard");
    uploadCard.addEventListener("dragover", function(e) { e.preventDefault(); uploadCard.classList.add("dragover"); });
    uploadCard.addEventListener("dragleave", function() { uploadCard.classList.remove("dragover"); });
    uploadCard.addEventListener("drop", function(e) {
        e.preventDefault();
        uploadCard.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleIncomingFile(e.dataTransfer.files[0]);
        }
    });

    window.addEventListener("paste", function(e) {
        var ae = document.activeElement;
        var withinTool = ae && ae.closest && ae.closest(".ap-tool");
        var nothingFocused = !ae || ae === document.body;
        if (!withinTool && !nothingFocused) return;

        if (!e.clipboardData || !e.clipboardData.items) return;
        for (var i = 0; i < e.clipboardData.items.length; i++) {
            if (e.clipboardData.items[i].type.indexOf("image") !== -1) {
                handleIncomingFile(e.clipboardData.items[i].getAsFile());
                e.preventDefault();
                break;
            }
        }
    });

    function handleIncomingFile(file) {
        if (!file || !file.type || !file.type.startsWith("image/")) {
            alert("Пожалуйста, загрузите изображение интерьера (JPG, PNG, WEBP)");
            return;
        }
        uploadedFile = file;
        var reader = new FileReader();
        reader.onload = function(e) {
            pvHolder.innerHTML = '<img src="' + e.target.result + '" alt="Превью интерьера">';
            beforeImg.src = e.target.result;
            dropSection.hidden = true;
            previewSection.hidden = false;
            fileNameNote.textContent = file.name + " · " + (file.size / 1024).toFixed(1) + " КБ";
        };
        reader.readAsDataURL(file);
    }

    function renderCatGrid(q) {
        q = (q || "").trim();
        
        // 1. Во время запроса показываем скелетоны в сетке каталога
        var skeletonsHtml = '';
        for (var i = 0; i < 24; i++) {
            skeletonsHtml += '<div class="cat-cell-skeleton"></div>';
        }
        catGrid.innerHTML = skeletonsHtml;
        catCount.textContent = "Поиск в базе ArchiPaint...";

        // 2. Отправляем AJAX запрос на бэкенд поиска по каталогу
        $.ajax({
            url: '/ajax/catalog_search.php',
            method: 'GET',
            data: { q: q },
            dataType: 'json',
            success: function(response) {
                if (!response || !response.items) {
                    catGrid.innerHTML = "";
                    catCount.textContent = "Ошибка загрузки каталога";
                    return;
                }

                var shown = response.items;
                var total = response.total;

                // Обновляем счетчик найденных элементов в шапке модалки
                if (!q) {
                    catCount.textContent = "Показаны первые " + shown.length + " из " + total.toLocaleString("ru-RU") + " — введите запрос";
                } else {
                    var countLabel = total > response.limit ? "более " + response.limit : total;
                    catCount.textContent = "Показано: " + shown.length + " (найдено " + countLabel + ")";
                }

                if (!shown.length) {
                    catGrid.innerHTML = '<p style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--neutral-4);">Ничего не найдено. Попробуйте изменить запрос.</p>';
                    return;
                }

                // Рендерим ячейки цветов из Битрикса
                catGrid.innerHTML = shown.map(function(m) {
                    return '<button class="cat-cell" data-id="' + m.id + '" data-hex="' + m.h + '" data-name="' + m.n + '" data-code="' + m.code + '" title="' + m.n + ' · ' + m.code + ' · ' + m.h + '">' +
                    '<span class="cc-sw" style="background:' + m.h + '"></span>' +
                    '<span class="cc-t"><b>' + m.n + '</b><span>' + m.code + '</span></span></button>';
                }).join("");
            },
            error: function() {
                catGrid.innerHTML = "";
                catCount.textContent = "Не удалось связаться с сервером";
            }
        });
    }

    function syncLock(){
        var open=document.querySelector(".modal-back.show, #drawer.show");
        document.body.classList.toggle("lock",!!open);
    }
    function showBack(el){el.classList.add("show");syncLock();}
    function hideBack(el){el.classList.remove("show");syncLock();}

    function openCard(id, de, srcHex, srcLabel, hexValue, nameValue, codeValue) {
        
        hexValue = hexValue || "#F5F2EA";
        nameValue = nameValue || "Цвет ArchiPaint";
        codeValue = codeValue || "AP-" + id;
        // 1. Наполняем шапку и баннер модального окна переданными данными цвета
        mBanner.style.background = hexValue;
        var tc = textColorFor(hexValue);
        mBanTxt.style.color = tc;
        mBanTxt.style.textShadow = (tc === "#FFFFFF") ? "0 1px 10px rgba(0,0,0,.35)" : "none";
        mName.textContent = nameValue;
        mHex.textContent = codeValue + " · " + hexValue;
    
        // Отрисовываем блок сравнения ΔE (если открыли из палитры, гармоний или координат)
        if (de !== null && de !== undefined) {
            matchBox.style.display = "flex";
            mSrcSw.style.background = srcHex; mDstSw.style.background = hexValue;
            mSrcLabel.textContent = srcLabel || "ваше фото";
            mDeBadge.className = "de " + deClass(de);
            mDeBadge.textContent = "ΔE " + de.toFixed(2);
            mNote.textContent = deLabel(de) + " между исходным цветом (" + srcHex + ") и цветом «" + nameValue + "» (" + codeValue + "). Формула CIEDE2000.";
        } else {
            matchBox.style.display = "none";
            mNote.textContent = "Цвет " + codeValue + " из колеровочной палитры ArchiPaint.";
        }
    
        // Сохраняем текущие данные цвета в датасет модалки, чтобы их забрала кнопка покупки
        cardBack.dataset.colorId = id;
        cardBack.dataset.colorName = nameValue;
        cardBack.dataset.colorCode = codeValue;
        cardBack.dataset.colorHex = hexValue;
    
        // Выводим анимированные скелетоны-заглушки на время AJAX-запроса цен
        mOpts.innerHTML = '<div class="opt-skeleton"></div><div class="opt-skeleton"></div><div class="opt-skeleton"></div>';
        showBack(cardBack);
    
        // 2. Делаем AJAX-запрос к нашему новому бэкенду, передавая ID выбранного цвета
        $.ajax({
            url: '/ajax/get_product_options_v3.php',
            method: 'GET',
            data: { color_id: id }, // Передаем ID цвета, чтобы Api() на бэкенде рассчитал цены
            dataType: 'json',
            success: function(payload) {
                var options = payload && payload.options ? payload.options : payload;
                if (!options || !options.length) {
                    mOpts.innerHTML = '<p style="padding:20px; text-align:center; color:var(--neutral-4);">Для данного оттенка нет доступных вариантов красок или цен.</p>';
                    return;
                }
    
                // Рендерим только те варианты, которые класс API одобрил и вернул по цене
                mOpts.innerHTML = options.map(function(o) {
                    return '<div class="opt">' +
                    '<div class="opt-ico"><img src="' + o.img + '" alt="' + o.title + '" style="width:100%; height:100%; object-fit:contain; border-radius:6px;"></div>' +
                    '<div class="opt-info">' +
                        // Точечно: оборачиваем название в ссылку на товар в Битриксе
                        '<b><a href="' + o.url + '" target="_blank" class="opt-link">' + o.title + '</a></b>' +
                        '<p>' + o.desc + '</p>' +
                    '</div>' +
                    '<div class="opt-price">' + Number(o.price || 0).toLocaleString('ru-RU') + ' ₽</div>' +
                    '<button class="btn btn-accent opt-add" data-bitrix-id="' + o.bitrix_id + '" data-main-id="' + o.main_product_id + '" style="padding:9px 14px">В корзину</button></div>';
                }).join("");
            },
            error: function() {
                mOpts.innerHTML = '<p style="padding:10px;color:var(--poor)">Ошибка связи с каталогом Битрикс</p>';
            }
        });
    }

    function setPicker(on){
        pickerActive = on && !!pickCtx;
        
        var genCompare = document.querySelector(".gen-compare");
        if (genCompare) {
            genCompare.classList.toggle("picker", pickerActive);
        }

        if (pickerActive) {
            $.magnificPopup.close(); 
        }

        if (!pickerActive) {
            if (loupe) {
                loupe.hidden = true;
                loupe.style.display = "none"; // Прячем через CSS display для надежности
            }
        } else {
            if (loupe) {
                loupe.style.display = "flex"; // Возвращаем флекс-отображение плашки при включении
            }
        }
        
        var bottomBtn = document.getElementById("btnBottomPicker");
        if (bottomBtn) {
            bottomBtn.classList.toggle("active", pickerActive);
        }

        // Находим кнопку внутри dashed-слота каталога (если она отрендерена в данный момент)
        var inlineBtn = document.getElementById("btnInlinePicker");
        if (inlineBtn) {
            inlineBtn.classList.toggle("active", pickerActive);
        }

        // Находим кнопку-иконку повторного снятия цвета на готовой карточке
        var repickBtn = document.querySelector(".repick");
        if (repickBtn) {
            repickBtn.classList.toggle("active", pickerActive);
        }
    }
    var apToolContainer = document.querySelector(".ap-tool");

    apToolContainer.addEventListener("click", function(e) {
            
        // =========================================================
        // ДОБАВЛЯЕМ ОБРАБОТКУ НАШЕЙ НОВОЙ НИЖНЕЙ КНОПКИ ПИПЕТКИ:
        // =========================================================
        var bottomPickerBtn = e.target.closest("#btnBottomPicker");
        if (bottomPickerBtn) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); 
            
            if (!pickCtx) { 
                toast("Сначала загрузите изображение"); 
                return; 
            }
            
            // Включаем режим пипетки (жесткое true, чтобы не было двойных тогглов)
            if (pickerActive) {
                setPicker(false);
                toast("Режим пипетки отменён");
            } else {
                // ЕСЛИ БЫЛА ВЫКЛЮЧЕНА — ВКЛЮЧАЕМ
                setPicker(true); 
                toast("Наведите на фото — лупа покажет цвет, клик — снять");
            }
            return; 
        }
        // =========================================================

        // Старый рабочий код фиксации цвета по картинке "Стало"
        if (e.target.id === "afterImg") {
            if (!pickerActive) return; // Активно только если пипетка включена
            
            e.preventDefault();
            e.stopPropagation(); 
            
            var p = pickAt(e.clientX, e.clientY);
            if (p) {
                console.log("=== ТРИУМФ: Настоящий клик по картинке! Цвет:", p.hex);
                applyPicked(p); 
            }
        }
    });

    var afterImgEl = document.getElementById("afterImg");

    if (afterImgEl) {
        // 1. ДВИЖЕНИЕ МЫШИ (Только водим и смотрим цвет в лупе)
        afterImgEl.addEventListener("mousemove", function(e) {
            if (!pickerActive) return;
            
            // Вызываем pickAt — теперь он только считает цвет
            var p = pickAt(e.clientX, e.clientY);
            if (!p) { 
                if (loupe) loupe.hidden = true; 
                return; 
            }
            
            // Обновляем лупу
            if (loupeSw && loupeHex) {
                loupeSw.style.background = p.hex; 
                loupeHex.textContent = p.hex;
            }
            
            if (loupe) {
                // Находим блок сравнения картинок ИИ
                var genCompare = document.querySelector(".gen-compare");
                if (genCompare) {
                    // Получаем точные координаты контейнера на экране в текущий момент
                    var wr = genCompare.getBoundingClientRect();
                    
                    // Считаем положение мыши строго ОТНОСИТЕЛЬНО ГРАНИЦ блока .gen-compare
                    // e.clientX - wr.left — это чистый отступ мыши от левого края картинки
                    // e.clientY - wr.top — это чистый отступ мыши от верхнего края картинки
                    // -27 — это половина ширины лупы (55px / 2), чтобы центр круга встал ровно под курсор
                    // -65 — смещение вверх, чтобы лупа была чуть выше острия стрелки и не перекрывала обзор
                    var loupeX = e.clientX - wr.left - 27;
                    var loupeY = e.clientY - wr.top - 65;
                    
                    // Защита от вылета лупы за пределы видимости контейнера
                    loupe.style.left = Math.min(wr.width - 60, Math.max(0, loupeX)) + "px";
                    loupe.style.top = Math.max(0, loupeY) + "px";
                    loupe.hidden = false; // ПОКАЗЫВАЕМ ЛУПУ
                    
                    // ТЕСТ-МЕТКА: проверяем локальные координаты в консоли
                    console.log("Локальные координаты лупы внутри блока:", loupe.style.left, loupe.style.top);
                }
            }
        });

        // 2. УХОД МЫШИ С КАРТИНКИ
        afterImgEl.addEventListener("mouseleave", function() {
            if (loupe) loupe.hidden = true;
        });

        // 3. КЛИК ДЛЯ ФИКСАЦИИ ЦВЕТА (Сработает ТОЛЬКО если кликнули пальцем/мышкой по самой картинке!)
        afterImgEl.addEventListener("click", function(e) {
            if (!pickerActive) return;
            
            // Железно блокируем всплытие и дефолтное поведение ссылки Magnific Popup!
            e.preventDefault();
            e.stopPropagation(); 
            
            var p = pickAt(e.clientX, e.clientY);
            if (p) {
                console.log("=== ТРИУМФ: Настоящий клик по картинке! Цвет:", p.hex);
                applyPicked(p); // Фиксируем цвет
            }
        });
    }
    previewWrap.addEventListener("mousemove",function(e){
        if(!pickerActive)return;
        var p=pickAt(e.clientX,e.clientY);
        if(!p){loupe.hidden=true;return;}
        loupeSw.style.background=p.hex; loupeHex.textContent=p.hex;
        var wr=previewWrap.getBoundingClientRect();
        loupe.style.left=Math.min(wr.width-130,e.clientX-wr.left+16)+"px";
        loupe.style.top=Math.max(4,e.clientY-wr.top-46)+"px";
        loupe.hidden=false;
    });
    previewWrap.addEventListener("mouseleave",function(){loupe.hidden=true;});
    previewWrap.addEventListener("click",function(e){
        if(!pickerActive)return;
        var p=pickAt(e.clientX,e.clientY);
        if(p)applyPicked(p);
    });
    function pickAt(clientX, clientY) {
        if (!pickCtx) return null;
        
        var node = document.getElementById("afterImg"); 
        if (!node) return null;
        
        // 1. Получаем точные экранные границы HTML-тега <img>
        var rect = node.getBoundingClientRect();
        
        // 2. Узнаем оригинальные размеры картинки
        var natW = node.naturalWidth || node.width || 1;
        var natH = node.naturalHeight || node.height || 1;
        
        // 3. Расчет масштабирования по логике object-fit: cover
        var scale = Math.max(rect.width / natW, rect.height / natH);
        var cw = natW * scale; // Виртуальная ширина картинки с учетом обрезки
        var ch = natH * scale; // Виртуальная высота картинки с учетом обрезки
        
        // Находим, на сколько пикселей картинка смещена и обрезана за краями тега <img>
        var actualLeft = rect.left + (rect.width - cw) / 2;
        var actualTop = rect.top + (rect.height - ch) / 2;
        
        // 4. Вычисляем процентную позицию клика относительно реального холста
        var nx = (clientX - actualLeft) / cw;
        var ny = (clientY - actualTop) / ch;
        
        // Если клик вышел за рамки (защита) — сбрасываем
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
        
        var canvasWidth = pickCtx.canvas.width;
        var canvasHeight = pickCtx.canvas.height;
        
        // 5. Превращаем коэффициенты в пиксели оригинального холста
        var px = Math.min(canvasWidth - 1, Math.max(0, Math.round(nx * (canvasWidth - 1))));
        var py = Math.min(canvasHeight - 1, Math.max(0, Math.round(ny * (canvasHeight - 1))));
        
        // Размытие области 5х5 для сглаживания текстуры
        var sx = Math.max(0, px - 2), sy = Math.max(0, py - 2);
        var sw = Math.min(5, canvasWidth - sx), sh = Math.min(5, canvasHeight - sy);
        
        var d = pickCtx.getImageData(sx, sy, sw, sh).data;
        var r = 0, g = 0, b = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
        
        var rgb = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        
        // Исправлено: передаем три компонента раздельно
        var currentHex = typeof rgb2hex === "function" ? rgb2hex(rgb[0], rgb[1], rgb[2]) : "#000000";
        
        return { rgb: rgb, hex: currentHex, fx: nx, fy: ny };
    }
        
        window.addEventListener("mousemove", function(e) {
            if (!pickerActive) return;
            
            var targetImg = e.target.closest("#afterImg");
            if (!targetImg) {
                if (loupe) loupe.hidden = true;
                return;
            }
    
            // Просто считываем цвет для лупы (БЕЗОПАСНО!)
            var p = pickAt(e.clientX, e.clientY);
            if (!p) {
                if (loupe) loupe.hidden = true;
                return;
            }
    
            // Обновляем только внешний вид лупы на экране
            if (loupeSw && loupeHex && loupe) {
                loupeSw.style.background = p.hex; 
                loupeHex.textContent = p.hex;
                
                // ИСПРАВЛЕНИЕ: Считаем координаты СТРОГО от самой картинки "Стало"
                var imgNode = document.getElementById("afterImg");
                var genCompare = document.querySelector(".gen-compare");
                
                if (imgNode && genCompare) {
                    var imgRect = imgNode.getBoundingClientRect();
                    var parentRect = genCompare.getBoundingClientRect();
                    
                    // Вычисляем положение мыши относительно левого верхнего угла САМОЙ КАРТИНКИ
                    var localX = e.clientX - parentRect.left;
                    var localY = e.clientY - parentRect.top;
                    
                    // Смещение плашки: +16px вправо и -40px вверх от острия курсора, 
                    // чтобы она красиво парила рядом и не перекрывала точку прицела
                    loupe.style.left = (localX + 16) + "px";
                    loupe.style.top = (localY - 40) + "px";
                    loupe.hidden = false; // ПОКАЗЫВАЕМ ВАШУ ПЛАШКУ!
                }
            }
        });
    
        // 2. КЛИК МЫШИ: Сработает ТОЛЬКО когда пользователь осознанно нажал пальцем или кнопкой мыши!
        window.addEventListener("click", function(e) {
            if (!pickerActive) return;
            
            if (e.target.id === "afterImg") {
                e.preventDefault();
                e.stopPropagation(); // Останавливаем всплытие клика
                
                var p = pickAt(e.clientX, e.clientY);
                if (p) {
                    console.log("=== ТРИУМФ: Зафиксирован настоящий клик по картинке! ===");
                    applyPicked(p); // ФИКСИРУЕМ ЦВЕТ СТРОГО ТУТ
                }
            }
        });


    function contentRect(node) {
        var rect = node.getBoundingClientRect();
        var nat = node.naturalWidth ? { w: node.naturalWidth, h: node.naturalHeight } : { w: node.width, h: node.height };
        var scale = Math.min(rect.width / nat.w, rect.height / nat.h);
        var cw = nat.w * scale, ch = nat.h * scale;
        return { x: rect.left + (rect.width - cw) / 2, y: rect.top + (rect.height - ch) / 2, w: cw, h: ch };
    }

    function placePickDot(fx, fy) {
        var node = document.getElementById("afterImg"); 
        if (!node || !pickedColor) return;
        
        var genCompare = document.querySelector(".gen-compare");
        if (!genCompare) return;
        
        var rect = node.getBoundingClientRect();
        var wr = genCompare.getBoundingClientRect();
        
        var natW = node.naturalWidth || node.width || 1;
        var natH = node.naturalHeight || node.height || 1;
        
        var scale = Math.max(rect.width / natW, rect.height / natH);
        var cw = natW * scale;
        var ch = natH * scale;
        
        var actualLeft = rect.left + (rect.width - cw) / 2;
        var actualTop = rect.top + (rect.height - ch) / 2;
        
        // Вычисляем позицию строго внутри координат .gen-compare с округлением
        var dotX = Math.round(actualLeft - wr.left + fx * cw);
        var dotY = Math.round(actualTop - wr.top + fy * ch);
        
        pickDot.style.left = dotX + "px";
        pickDot.style.top = dotY + "px";
        pickDot.style.background = pickedColor.hex;
        pickDot.hidden = false;
    }
    function applyPicked(p) {
        setPicker(false); 
        
        pickedColor = { 
            hex: p.hex, 
            rgb: p.rgb, 
            lab: typeof rgb2lab === "function" ? rgb2lab(p.rgb) : []
        };
        lastPick = { fx: p.fx, fy: p.fy };
        placePickDot(p.fx, p.fy);
        
        renderAICandidates(currentRows);
        
        selectedBaseHex = p.hex; 
        if (typeof renderHarmony === "function") {
            renderHarmony();
        }
        
        toast("Цвет зафиксирован, подбираем краску по каталогу...");
    }
    window.addEventListener("resize",function(){
      if(pickedColor&&lastPick)placePickDot(lastPick.fx,lastPick.fy);
    });

    resultsEl.addEventListener("click", function(e) {
        if (e.target.closest(".pick-cta") || e.target.closest(".repick")) {
            e.stopPropagation(); 
            setPicker(true);
            toast("Кликните по изображению, чтобы снять цвет");
            return;
        }
        var chip = e.target.closest(".chip");
        if (chip) {
            // Проверьте, чтобы здесь передавались именно dataset-параметры кнопки!
            openCard(
                chip.dataset.id, 
                parseFloat(chip.dataset.de), 
                chip.dataset.src, 
                "ваше фото",
                chip.dataset.hex,   // Передаем HEX самого товара из Битрикса
                chip.dataset.name,  // Название цвета
                chip.dataset.code   // Код цвета
            );
        }
    });

    btnReset.addEventListener("click", resetWorkspace);
    btnNewPhoto.addEventListener("click", resetWorkspace);
    btnReplace.addEventListener("click", function() { fileInput.click(); });

    function resetWorkspace() {
        uploadedFile = null;
        fileInput.value = "";
        pvHolder.innerHTML = "";
        dropSection.hidden = false;
        previewSection.hidden = true;
        genForm.hidden = false;
        genProgress.hidden = true;
        genResult.hidden = true;
        candidatesCard.hidden = true;
        harmonyCard.hidden = true;
        fileNameNote.textContent = "";
    }

    var isUserAuthorized = window.GLOBAL_USER_AUTH || false; 
    var freeQuotaTotal = 3;
    var freeQuotaUsed = parseInt(window.GLOBAL_USER_USED_QUOTA) || 0; 
    
    var quotaBadge = document.getElementById("quotaBadge");
    updateQuotaDisplay();

    function updateQuotaDisplay() {
        if (!quotaBadge) return;
        quotaBadge.hidden = false;
        if (freeQuotaUsed < freeQuotaTotal) {
            quotaBadge.textContent = "Бесплатно: осталось " + (freeQuotaTotal - freeQuotaUsed) + " из " + freeQuotaTotal + " ген.";
            quotaBadge.style.background = "var(--good-light)";
        } else {
            quotaBadge.textContent = "Платные генерации: 20 ₽ / шт.";
            quotaBadge.style.background = "var(--neutral-2)";
        }
    }

    /* --- Окна ошибок и уведомлений (Модалка вместо алертов) --- */
    var paywallModal = document.getElementById("paywallModal");
    var paywallTitle = document.getElementById("paywallTitle");
    var paywallText = document.getElementById("paywallText");
    var paywallBtn = document.getElementById("paywallBtn");

    function showErrorModal(title, text, buttonText, buttonUrl) {
        paywallTitle.textContent = title;
        paywallText.textContent = text;
        
        if (buttonText && buttonUrl) {
            paywallBtn.textContent = buttonText;
            paywallBtn.href = buttonUrl;
            paywallBtn.style.display = "inline-flex";
        } else {
            paywallBtn.style.display = "none";
        }
        
        paywallModal.classList.add("show");
        document.body.classList.add("lock");
    }

    document.getElementById("paywallX").addEventListener("click", closePaywall);
    document.getElementById("paywallCloseBtn").addEventListener("click", closePaywall);
    paywallModal.addEventListener("click", function(e) { if(e.target === paywallModal) closePaywall(); });
    
    function closePaywall() {
        paywallModal.classList.remove("show");
        document.body.classList.remove("lock");
    }

    /* ================= КЛИК НА СГЕНЕРИРОВАТЬ ДИЗАЙН ================= */
    genBtn.addEventListener("click", function() {
        
        // 1. ПРОВЕРКА ЗАПОЛНЕНИЯ ФОРМЫ (Ваша новая фича)
        if (!uploadedFile) {
            showErrorModal("Фото не загружено", "Пожалуйста, перетащите или выберите фотографию вашего интерьера, чтобы ИИ мог с ней работать.", "Понятно", null);
            return;
        }

        var hasNotes = notesInput && notesInput.value.trim().length > 0;


        if (!hasNotes) {
            if (!roomTypeSelect.value) {
                showErrorModal("Выберите тип комнаты", "Укажите, какое именно помещение изображено на фото (например, гостиная или спальня), чтобы нейросеть применила правильные правила дизайна.", "Понятно", null);
                return;
            }
            if (!selectedStyle) {
                showErrorModal("Выберите стиль дизайна", "Пожалуйста, выберите один из предложенных стилей интерьера (например, Скандинавский или Минимализм).", "Понятно", null);
                return;
            }
        }

        // 2. ПРОВЕРКА АВТОРИЗАЦИИ
        if (!isUserAuthorized) {
            showErrorModal(
                "Требуется авторизация", 
                "Чтобы использовать нейросеть ArchiColor AI и сохранять готовые дизайны в личном кабинете, пожалуйста, войдите на сайт.",
                "Войти на сайт",
                "/auth/"
            );
            return;
        }

        // Если все проверки пройдены — запускаем экран загрузки
        genForm.hidden = true;
        genProgress.hidden = false;
        
        var progress = 0;
        var statuses = [
            "Анализируем геометрию помещения...",
            "Определяем границы стен, пола и потолка...",
            "Нейросеть подбирает текстуры и маски...",
            "Финализируем цветовые слои нового дизайна...",
            "Сохраняем проект в вашем личном кабинете..."
        ];
        
        var statusIdx = 0;
        genFill.style.width = "0%";
        genStatus.textContent = statuses[statusIdx];

        mockInterval = setInterval(function() {
            progress += 1.5;
            if (progress > 95) progress = 95; 
            genFill.style.width = progress + "%";

            if (Math.floor(progress) % 20 === 0 && statusIdx < statuses.length - 1) {
                statusIdx++;
                genStatus.textContent = statuses[statusIdx];
            }
        }, 150);

        var formData = new FormData();
        formData.append("image", uploadedFile);
        formData.append("room_type", roomTypeSelect.value);
        formData.append("style", selectedStyle);
        formData.append("notes", notesInput.value);
        if (window.BX && typeof BX.bitrix_sessid === "function") {
            formData.append("sessid", BX.bitrix_sessid());
        }

        $.ajax({
            url: '/ajax/ai_generation.php',
            method: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            dataType: 'json',
            success: function(response) {
                clearInterval(mockInterval);
                
                if (response && response.success && response.image_url) {
                    genFill.style.width = "100%";
                    
                    if (response.used_quota !== undefined) {
                        freeQuotaUsed = parseInt(response.used_quota);
                        updateQuotaDisplay();
                    }

                    setTimeout(function() {
                        displayAIResult(response.image_url, response.prompt_echo);
                    }, 400);
                } else {
                    if (response && response.error_code === "LOW_BALANCE") {
                        handleGenError(null);
                        showErrorModal(
                            "Недостаточно средств", 
                            "Ваши 3 бесплатные генерации закончились. Стоимость последующих — 20 ₽. Пожалуйста, пополните баланс в личном кабинете.",
                            "Пополнить баланс",
                            "/personal/profile/account/"
                        );
                    } else {
                        handleGenError(response.error || "Ошибка генерации на стороне ИИ-сервера");
                    }
                }
            },
            error: function(xhr) {
                clearInterval(mockInterval);
                handleGenError("Не удалось связаться с сервером.");
                
                if (xhr.status === 401) {
                    showErrorModal("Сессия истекла", "Пожалуйста, авторизуйтесь заново.", "Войти", "/auth/");
                } else if (xhr.status === 402) {
                    showErrorModal("Баланс исчерпан", "Пополните счет для платной генерации.", "Пополнить баланс", "/personal/profile/account/");
                }
            }
        });
    });

    function hex2rgb(h){
        if(!h || typeof h !== 'string') return; // Если цвета нет, вернем белый по умолчанию
        h=h.replace("#","");
        return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
    }
    function rgb2hex(r,g,b){
        function q(v){v=Math.max(0,Math.min(255,Math.round(v)));return (v<16?"0":"")+v.toString(16);}
        return ("#"+q(r)+q(g)+q(b)).toUpperCase();
    }
    function clampNum(v,a,b){return Math.max(a,Math.min(b,v));}
    function clamp255(v){return Math.round(clampNum(v,0,255));}
    function rgb2lab(rgb){
        function lin(v){v/=255;return v>0.04045?Math.pow((v+0.055)/1.055,2.4):v/12.92;}
        var r=lin(rgb[0]),g=lin(rgb[1]),b=lin(rgb[2]);
        var X=(0.4124564*r+0.3575761*g+0.1804375*b)/0.95047;
        var Y=(0.2126729*r+0.7151522*g+0.0721750*b);
        var Z=(0.0193339*r+0.1191920*g+0.9503041*b)/1.08883;
        function f(t){return t>0.008856?Math.cbrt(t):7.787*t+16/116;}
        X=f(X);Y=f(Y);Z=f(Z);
        return [116*Y-16,500*(X-Y),200*(Y-Z)];
    }
    function lab2rgb(lab){
        var L=lab[0],a=lab[1],b=lab[2];
        var fy=(L+16)/116, fx=fy+a/500, fz=fy-b/200;
        function finv(t){ return t>6/29 ? t*t*t : 3*(6/29)*(6/29)*(t-4/29); }
        var X=finv(fx)*0.95047, Y=finv(fy)*1.0, Z=finv(fz)*1.08883;
        var r=X*3.2404542+Y*-1.5371385+Z*-0.4985314;
        var g=X*-0.9692660+Y*1.8760108+Z*0.0415560;
        var bl=X*0.0556434+Y*-0.2040259+Z*1.0572252;
        function gam(c){ return c<=0.0031308 ? 12.92*c : 1.055*Math.pow(c,1/2.4)-0.055; }
        return [clamp255(gam(r)*255),clamp255(gam(g)*255),clamp255(gam(bl)*255)];
    }
    function deltaE(l1,l2){ /* CIEDE2000 */
        var L1=l1[0],a1=l1[1],b1=l1[2],L2=l2[0],a2=l2[1],b2=l2[2];
        var C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cb=(C1+C2)/2;
        var p25=Math.pow(25,7),Cb7=Math.pow(Cb,7);
        var G=0.5*(1-Math.sqrt(Cb7/(Cb7+p25)));
        var a1p=a1*(1+G),a2p=a2*(1+G);
        var C1p=Math.hypot(a1p,b1),C2p=Math.hypot(a2p,b2);
        var h1p=Math.atan2(b1,a1p)/RAD; if(h1p<0)h1p+=360;
        var h2p=Math.atan2(b2,a2p)/RAD; if(h2p<0)h2p+=360;
        var dLp=L2-L1,dCp=C2p-C1p,dhp=0;
        if(C1p*C2p!==0){dhp=h2p-h1p; if(dhp>180)dhp-=360; else if(dhp<-180)dhp+=360;}
        var dHp=2*Math.sqrt(C1p*C2p)*Math.sin(dhp*RAD/2);
        var Lbp=(L1+L2)/2,Cbp=(C1p+C2p)/2,hbp=h1p+h2p;
        if(C1p*C2p!==0){
            if(Math.abs(h1p-h2p)<=180)hbp=(h1p+h2p)/2;
            else if(h1p+h2p<360)hbp=(h1p+h2p+360)/2;
            else hbp=(h1p+h2p-360)/2;
        }
        var T=1-0.17*Math.cos((hbp-30)*RAD)+0.24*Math.cos(2*hbp*RAD)+0.32*Math.cos((3*hbp+6)*RAD)-0.20*Math.cos((4*hbp-63)*RAD);
        var dTh=30*Math.exp(-Math.pow((hbp-275)/25,2));
        var Cbp7=Math.pow(Cbp,7),RC=2*Math.sqrt(Cbp7/(Cbp7+p25));
        var SL=1+0.015*Math.pow(Lbp-50,2)/Math.sqrt(20+Math.pow(Lbp-50,2));
        var SC=1+0.045*Cbp,SH=1+0.015*Cbp*T;
        var RT=-Math.sin(2*dTh*RAD)*RC;
        return Math.sqrt(Math.pow(dLp/SL,2)+Math.pow(dCp/SC,2)+Math.pow(dHp/SH,2)+RT*(dCp/SC)*(dHp/SH));
    }
    function rgb2hsl(r,g,b){
        r/=255;g/=255;b/=255;
        var max=Math.max(r,g,b),min=Math.min(r,g,b),h=0,s=0,l=(max+min)/2,d=max-min;
        if(d!==0){
            s=l>0.5?d/(2-max-min):d/(max+min);
            if(max===r)h=(g-b)/d+(g<b?6:0);
            else if(max===g)h=(b-r)/d+2;
            else h=(r-g)/d+4;
            h*=60;
        }
        return {h:h,s:s,l:l};
    }
    function hsl2rgb(h,s,l){
        h=((h%360)+360)%360;
        var c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2, r,g,b;
        if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
        else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
        return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
    }

    var SCHEMES = [
        {id:"complementary",name:"Комплиментарная",angles:[0,180],desc:"Двоичная схема: два цвета напротив друг друга (180°). Максимальный контраст и энергия — для ярких акцентных интерьеров."},
        {id:"analogous",name:"Аналоговая",angles:[-30,0,30],desc:"Три соседних цвета (шаг 30°). Спокойное, природное сочетание без резких контрастов."},
        {id:"triadic",name:"Троичная (триада)",angles:[0,120,240],desc:"Три цвета через 120°. Ровный баланс при богатой, насыщенной гамме."},
        {id:"split",name:"Раздельно-комплиментарная",angles:[0,150,210],desc:"База и два цвета по сторонам от её комплиментарного. Контраст мягче, чем у двоичной схемы."},
        {id:"square",name:"Квадрат (тетрада)",angles:[0,90,180,270],desc:"Четыре цвета через 90°. Богатая палитра для смелых решений."}
    ];

    function isHexToken(s){
        var t=s.replace(/#/g,"").replace(/\s+/g,"");
        return /^[0-9a-fA-F]{3}$/.test(t) || /^[0-9a-fA-F]{6}$/.test(t);
    }
    function normalizeHex(s){
        var t=s.replace(/#/g,"").replace(/\s+/g,"");
        if(/^[0-9a-fA-F]{3}$/.test(t)) t=t.split("").map(function(c){return c+c;}).join("");
        if(!/^[0-9a-fA-F]{6}$/.test(t)) return null;
        return "#"+t.toUpperCase();
    }
    function extractNums(s){
        var m=s.match(/-?\d+(\.\d+)?/g);
        return m?m.map(Number):null;
    }
    function parseColorInput(raw,forced){
        var s=(raw||"").trim();
        if(!s) return null;
        forced=forced||"auto";
        if(forced==="hex" || (forced==="auto" && isHexToken(s))){
            var hx=normalizeHex(s);
            if(!hx) return {error:"hex"};
            var rgbH=hex2rgb(hx);
            return {mode:"hex",hex:hx,rgb:rgbH,lab:rgb2lab(rgbH)};
        }
        var nums=extractNums(s);
        if(!nums||nums.length<3) return {error:"need3"};
        nums=nums.slice(0,3);
        var mode=forced;
        if(mode==="auto"){
            var lower=s.toLowerCase();
            if(/lab/.test(lower)) mode="lab";
            else if(/rgb/.test(lower)) mode="rgb";
            else if(nums.some(function(n){return n<0;})) mode="lab";
            else if(nums.some(function(n){return n % 1 !== 0;})) mode="lab";
            else if(nums.some(function(n){return n>100;})) mode="rgb";
            else mode="rgb";
        }
        if(mode==="rgb"){
            var rgb2=[clamp255(nums[0]),clamp255(nums[1]),clamp255(nums[2])];
            return {mode:"rgb",rgb:rgb2,hex:rgb2hex(rgb2[0],rgb2[1],rgb2[2]),lab:rgb2lab(rgb2)};
        }
        var lab2=[clampNum(nums[0],0,100),nums[1],nums[2]];
        var rgbFromLab=lab2rgb(lab2);
        return {mode:"lab",lab:lab2,rgb:rgbFromLab,hex:rgb2hex(rgbFromLab[0],rgbFromLab[1],rgbFromLab[2])};
    }
     
    /* ================= ТОЧНОЕ ИЗВЛЕЧЕНИЕ ПАЛИТРЫ =================
       median cut (8 зёрен) → k-means в CIE Lab → дедупликация → top-4 */
    function channelRange(px){
        var minr=255,maxr=0,ming=255,maxg=0,minb=255,maxb=0;
        for(var i=0;i<px.length;i++){var p=px[i];
            if(p[0]<minr)minr=p[0]; if(p[0]>maxr)maxr=p[0];
            if(p[1]<ming)ming=p[1]; if(p[1]>maxg)maxg=p[1];
            if(p[2]<minb)minb=p[2]; if(p[2]>maxb)maxb=p[2];}
        return {r:maxr-minr,g:maxg-ming,b:maxb-minb};
    }
    function medianCut(pixels,count){
        var boxes=[pixels.slice()];
        while(boxes.length<count){
            var bestIdx=-1,bestScore=-1;
            for(var i=0;i<boxes.length;i++){
                if(boxes[i].length<2)continue;
                var rg=channelRange(boxes[i]);
                var score=Math.max(rg.r,rg.g,rg.b);
                if(score>bestScore){bestScore=score;bestIdx=i;}
            }
            if(bestIdx===-1)break;
            var box=boxes.splice(bestIdx,1)[0];
            var r2=channelRange(box);
            var ch=(r2.r>=r2.g&&r2.r>=r2.b)?0:(r2.g>=r2.b?1:2);
            box.sort(function(a,b){return a[ch]-b[ch];});
            var mid=box.length>>1;
            boxes.push(box.slice(0,mid),box.slice(mid));
        }
        return boxes.map(function(b){
            var r=0,g=0,bl=0;
            for(var i=0;i<b.length;i++){r+=b[i][0];g+=b[i][1];bl+=b[i][2];}
            var n=b.length||1;
            return {r:Math.round(r/n),g:Math.round(g/n),b:Math.round(bl/n),count:b.length};
        });
    }
    function kmeansLab(ptsLab,ptsRGB,seeds,iters){
        var k=seeds.length,n=ptsLab.length;
        var cent=seeds.map(function(s){return s.slice();});
        var assign=new Int32Array(n);
        function doAssign(){
            for(var i=0;i<n;i++){
                var p=ptsLab[i],best=0,bd=Infinity;
                for(var c=0;c<k;c++){
                    var dl=p[0]-cent[c][0],da=p[1]-cent[c][1],db=p[2]-cent[c][2];
                    var d=dl*dl+da*da+db*db;
                    if(d<bd){bd=d;best=c;}
                }
                assign[i]=best;
            }
        }
        for(var it=0;it<iters;it++){
            doAssign();
            var sl=new Float64Array(k),sa=new Float64Array(k),sb=new Float64Array(k),cn=new Int32Array(k);
            for(var j=0;j<n;j++){var c2=assign[j],q=ptsLab[j];sl[c2]+=q[0];sa[c2]+=q[1];sb[c2]+=q[2];cn[c2]++;}
            for(var c=0;c<k;c++){ if(cn[c]>0)cent[c]=[sl[c]/cn[c],sa[c]/cn[c],sb[c]/cn[c]]; }
        }
        doAssign(); /* финальное назначение для точных сумм */
        var out=[];
        for(var c3=0;c3<k;c3++)out.push({lab:cent[c3],count:0,r:0,g:0,b:0});
        for(var m=0;m<n;m++){var o=out[assign[m]],rgb=ptsRGB[m];o.count++;o.r+=rgb[0];o.g+=rgb[1];o.b+=rgb[2];}
        var res=[];
        out.forEach(function(o2){
            if(o2.count>0)res.push({lab:o2.lab,count:o2.count,rgb:[Math.round(o2.r/o2.count),Math.round(o2.g/o2.count),Math.round(o2.b/o2.count)]});
        });
        return res;
    }
     
    function deClass(de){return de<=1.5?"de-good":(de<=3.5?"de-mid":"de-poor");}
    function deLabel(de){
        if(de<1)return "незаметное различие";
        if(de<2)return "почти точное совпадение";
        if(de<3.5)return "лёгкое отличие";
        if(de<6)return "заметная разница";
        return "цвета различаются";
    }
    function textColorFor(hex){var c=hex2rgb(hex);return (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])>150?"#20241F":"#FFFFFF";}

    function handleGenError(msg) {
        if (msg) showErrorModal("Внимание", msg, null, null);
        genProgress.hidden = true;
        genForm.hidden = false;
    }

    function analyzeSource(src,w,h){
        var MAXD=320, scale=Math.min(1,MAXD/Math.max(w,h));
        var cw=Math.max(1,Math.round(w*scale)), chh=Math.max(1,Math.round(h*scale));
        var cv=document.createElement("canvas"); cv.width=cw; cv.height=chh;
        var cx=cv.getContext("2d",{willReadFrequently:true});
        cx.drawImage(src,0,0,cw,chh);
        var data=cx.getImageData(0,0,cw,chh).data; /* бросает SecurityError при tainted canvas */
        var step=Math.max(1,Math.floor((cw*chh)/26000));
        var ptsRGB=[],ptsLab=[];
        for(var i=0;i<data.length;i+=4*step){
            if(data[i+3]>125){
                var rgb=[data[i],data[i+1],data[i+2]];
                ptsRGB.push(rgb); ptsLab.push(rgb2lab(rgb));
            }
        }
        if(!ptsRGB.length)throw new Error("empty");
        var boxes=medianCut(ptsRGB,8);
        var seeds=boxes.map(function(b){return rgb2lab([b.r,b.g,b.b]);});
        var clusters=kmeansLab(ptsLab,ptsRGB,seeds,8);
        clusters.sort(function(a,b){return b.count-a.count;});
        var kept=[];
        for(var k2=0;k2<clusters.length&&kept.length<4;k2++){
            var cl=clusters[k2],dup=false;
            for(var j=0;j<kept.length;j++){ if(deltaE(cl.lab,kept[j].lab)<3){dup=true;break;} }
            if(!dup)kept.push(cl);
        }
        var nTotal=ptsRGB.length;
        var rows=kept.map(function(cl){
            return {hex:rgb2hex(cl.rgb[0],cl.rgb[1],cl.rgb[2]),rgb:cl.rgb,lab:cl.lab,pct:Math.max(1,Math.round(100*cl.count/nTotal))};
        });
        return {rows:rows,canvas:cv,ctx:cx};
    }

    $('.gen-compare').magnificPopup({
        delegate: 'a.gen-zoom-link', // Перехватываем клик только по нашим ссылкам-обертками
        type: 'image',
        gallery: {
            enabled: true,            // ВКЛЮЧАЕМ ГАЛЕРЕЮ (чтобы картинки листались стрелками)
            navigateByImgClick: true, // Листание по клику на саму картинку
            preload: [0, 1]           // Предзагрузка следующей картинки
        },
        image: {
            tError: 'Не удалось загрузить <a href="%url%">изображение</a>.'
        },
        callbacks: {
            beforeOpen: function() {
                // Если включена пипетка — отключаем её при зуме картинки, чтобы не мешала
                if (pickerActive) return false;

            }
        }
    });

    function displayAIResult(imageUrl, promptEcho) {
        genProgress.hidden = true;
        genResult.hidden = false;
        
        afterImg.src = imageUrl;
        btnDownload.href = imageUrl;
        genPromptEcho.innerHTML = "<b>ИИ-промпт:</b> " + (promptEcho || "Перерисовка интерьера в выбранном стиле.");

        var beforeImgLink = document.getElementById("beforeImgLink");
        var afterImgLink = document.getElementById("afterImgLink");
        
        if (beforeImgLink) beforeImgLink.href = beforeImg.src; // Путь к исходному фото
        if (afterImgLink) afterImgLink.href = imageUrl; 

        var im = new Image();
        im.crossOrigin = "Anonymous";
        im.onload = function() {
            if (typeof analyzeSource === "function") {
                try {
                    var analysis = analyzeSource(im, im.naturalWidth, im.naturalHeight);
                    var topThreeColors = analysis.rows;
                    pickCtx = analysis.ctx; 
                    currentRows=topThreeColors;
                    renderAICandidates(topThreeColors);
                    renderHarmony();
                } catch(e) {
                    console.error("Ошибка сбора пикселей холста: ", e);
                    fallbackColorExtractor(im);
                }
            } else {
                fallbackColorExtractor(im);
            }
        };
        im.src = imageUrl;
    }

    function buildWheel(size){
        var off=document.createElement("canvas"); off.width=size; off.height=size;
        var ox=off.getContext("2d");
        var img=ox.createImageData(size,size);
        var R=size/2;
        for(var y=0;y<size;y++){
            for(var x=0;x<size;x++){
            var dx=x-R+0.5, dy=y-R+0.5, r=Math.sqrt(dx*dx+dy*dy);
            var idx=(y*size+x)*4;
            if(r>R){img.data[idx+3]=0;continue;}
            var hue=Math.atan2(-dy,dx)/RAD; if(hue<0)hue+=360;
            var sat=Math.min(1,r/R);
            var rgb=hsl2rgb(hue,sat,0.5);
            img.data[idx]=rgb[0]; img.data[idx+1]=rgb[1]; img.data[idx+2]=rgb[2];
            img.data[idx+3]=r>R-1.5?Math.max(0,Math.round(255*(R-r)/1.5)):255;
            }
        }
        ox.putImageData(img,0,0);
        return off;
    }

    function drawWheelScheme(hsl,angles){
        if(!wheelImg)wheelImg=buildWheel(240);
        var size=240, dpr=Math.min(2,window.devicePixelRatio||1);
        wheelCanvas.width=size*dpr; wheelCanvas.height=size*dpr;
        var ctx=wheelCanvas.getContext("2d");
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.clearRect(0,0,size,size);
        ctx.drawImage(wheelImg,0,0,size,size);
        var R=size/2, mr=R*0.8, baseIdx=angles.indexOf(0);
        var pts=angles.map(function(a){
            var h=((hsl.h+a)%360+360)%360;
            return {x:R+mr*Math.cos(h*RAD),y:R-mr*Math.sin(h*RAD),h:h};
        });
        ctx.beginPath();
        pts.forEach(function(p,i){if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.closePath();
        ctx.fillStyle="rgba(255,255,255,.30)"; ctx.fill();
        ctx.setLineDash([5,4]); ctx.strokeStyle="rgba(32,36,31,.6)"; ctx.lineWidth=1.6; ctx.stroke(); ctx.setLineDash([]);
        pts.forEach(function(p,i){
            var rgb=hsl2rgb(p.h,hsl.s,hsl.l);
            ctx.beginPath(); ctx.arc(p.x,p.y,i===baseIdx?11:8.5,0,7);
            ctx.fillStyle="rgb("+rgb.join(",")+")"; ctx.fill();
            ctx.lineWidth=i===baseIdx?3.5:2.5; ctx.strokeStyle="#fff"; ctx.stroke();
            if(i===baseIdx){ctx.beginPath();ctx.arc(p.x,p.y,14.5,0,7);ctx.lineWidth=1.6;ctx.strokeStyle="rgba(32,36,31,.65)";ctx.stroke();}
        });
    }

    function renderAICandidates(colors) {
        candidatesCard.hidden = false;
        candIntro.textContent = "Алгоритм проанализировал сгенерированные ИИ стены и потолки, перевел доминирующие оттенки в пространство LAB и подобрал 3 ближайших цвета в каталоге Битрикс по CIEDE2000:";
        
        candGrid.innerHTML = '<div class="cat-cell-skeleton"></div><div class="cat-cell-skeleton"></div><div class="cat-cell-skeleton"></div>';

        var colorsToRequest = {};
        colors.forEach(function(row, idx) {
            colorsToRequest['ai_color_' + idx] = { l: row.lab[0], a: row.lab[1], b: row.lab[2] };
        });

        if (pickedColor) {
            colorsToRequest['picked_color'] = { l: pickedColor.lab[0], a: pickedColor.lab[1], b: pickedColor.lab[2] };
        }

        $.ajax({
            url: '/ajax/color_service.php',
            method: 'POST',
            data: { colors: JSON.stringify(colorsToRequest) },
            dataType: 'json',
            success: function(response) {
                if (!response || response.error) {
                    candGrid.innerHTML = "<p style='padding:20px;'>Ошибка подбора красок по базе данных</p>";
                    return;
                }

                var PIP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M17.5 3.2a2.6 2.6 0 0 1 3.7 3.7l-1.9 1.9-3.7-3.7z"/><path d="M15.6 5.1 7 13.7a3.2 3.2 0 0 0-.9 1.5L5 20l4.8-1.1a3.2 3.2 0 0 0 1.5-.9l8.6-8.6"/></svg>';

                // 3. Формируем 5-й слот (Пипетка) в едином стиле с вашей сеткой
                var pipetteHtml = '';
                
                if (pickedColor && response['picked_color'] && response['picked_color'].length) {
                    // Если цвет выбран, и Битрикс НАШЕЛ под него реальный товар
                    var m = response['picked_color'][0]; 
                    var dClass = typeof window.deClass === "function" ? window.deClass(m.de) : "de-good";
   
                    pipetteHtml = '<div class="cand-item-wrap pick-row">' +
                        '<div class="cand-source-sw" title="Ваш выбор пипеткой">Ваш выбор: ' + pickedColor.hex + '</div>' +
                        '<button class="hs-card" data-id="' + (m ? m.id : '') + '" data-de="' + (m ? m.de.toFixed(2) : '') + '" data-src="' + pickedColor.hex + '" data-hex="' + (m ? m.h : pickedColor.hex) + '" data-name="' + (m ? m.n : 'Цвет из пипетки') + '" data-code="' + (m ? m.code : '') + '">' +
                            '<span class="hs-sw" style="background:' + (m ? m.h : pickedColor.hex) + '"></span>' +
                            '<span class="hs-meta">' +
                                '<span class="hs-name">' + (m ? m.n : 'Ваш выбор') + '</span>' +
                                '<span class="hs-code">' + (m ? m.code : 'пипетка') + '</span>' +
                                (m ? '<span class="hs-de"><span class="de ' + dClass + '">ΔE ' + m.de.toFixed(2) + '</span></span>' : '') +
                                '<span class="hs-order">' + PIP_SVG + ' Выбрать и открыть карточку →</span>' +
                            '</span>' +
                        '</button>' +
                    '</div>';
                } else {
                    // ЕСЛИ ЦВЕТ НЕ ВЫБРАН: создаем фейковую dashed-карточку, которая встанет ровно 5-й в ряд
                    pipetteHtml = '<div class="cand-item-wrap crow pick-row empty" style="animation-delay: 280ms; min-height: 200px; display: flex; flex-direction: column; justify-content: space-between; border: 2px dashed var(--tan); border-radius: 12px; padding: 12px; background: transparent;">' +
        
                        // Верхняя часть: текст и описание слота
                        '<div class="crow-info" style="flex-grow: 1;">' +
                            '<b style="font-size: 14px; display: block; font-weight: 800; margin-bottom: 4px;">Пипетка</b>' +
                            '<small style="color: var(--muted); font-size: 11px; display: block; line-height: 1.3;">Пятый цвет выбираете вы</small>' +
                        '</div>' +
                        
                        // Нижняя часть: Ваша пунктирная плашка из CSS
                        '<div class="crow-sw dashed" style="height: 64px; width: 100%; margin: 12px 0; border-radius: 6px;"></div>' +
                        
                        // Кнопка действия: Строго внизу на отдельной строке. Активна только она!
                        '<div class="crow-matches" style="margin-top: auto; display: block; width: 100%;">' +
                            '<button class="btn btn-ghost" id="btnInlinePicker" style="width: 100%; font-size: 12px; padding: 8px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">' + 
                                PIP_SVG + 'Снять цвет с фото' + 
                            '</button>' +
                        '</div>' +
                    '</div>';
                }
                candGrid.innerHTML = colors.map(function(row, idx) {
                    var matches = response['ai_color_' + idx];
                    if (!matches || !matches.length) return '';
                    
                    var m = matches[0]; 
                    var dClass = typeof window.deClass === "function" ? window.deClass(m.de) : "de-good";

                    return '<div class="cand-item-wrap">' +
                        '<div class="cand-source-sw" title="Исходный цвет на ИИ-фото">Исходный: ' + row.hex + '</div>' +
                        '<button class="hs-card" data-id="' + m.id + '" data-de="' + m.de.toFixed(2) + '" data-src="' + row.hex + '" data-hex="' + m.h + '" data-name="' + m.n + '" data-code="' + m.code + '">' +
                            '<span class="hs-sw" style="background:' + m.h + '"></span>' +
                            '<span class="hs-meta">' +
                                '<span class="hs-name">' + m.n + '</span>' +
                                '<span class="hs-code">' + m.code + '</span>' +
                                '<span class="hs-de"><span class="de ' + dClass + '">ΔE ' + m.de.toFixed(2) + '</span></span>' +
                                '<span class="hs-order">Выбрать и открыть карточку →</span>' +
                            '</span>' +
                        '</button>' +
                    '</div>';
                }).join("");

                candGrid.innerHTML += pipetteHtml;

                if (candidatesCard) {
                    candidatesCard.scrollIntoView({ 
                        behavior: 'smooth', // Делает прокрутку плавной анимацией
                        block: 'start'      // Докручивает так, чтобы верх карточки встал вровень с верхом экрана
                    });
                }

                if (harmonyCard) {
                    // Показываем блоки гармонии, убираем заглушку
                    var harmonyBody = document.getElementById("harmonyBody");
                    var harmonyEmpty = document.getElementById("harmonyEmpty");
                    if (harmonyBody) harmonyBody.hidden = false;
                    if (harmonyEmpty) harmonyEmpty.hidden = true;
                    harmonyCard.hidden = false;
                }
        
                // Задаем базовый цвет по умолчанию (берем HEX первого доминирующего цвета)
                if (currentRows && currentRows.length > 0) {
                    selectedBaseHex = currentRows[0].hex;
                }
        
                // Запускаем отрисовку круга и подбор красок для гармоний
                renderHarmony();
            },
            error: function() {
                candGrid.innerHTML = "<p style='padding:20px;color:var(--poor)'>Не удалось связаться с базой данных цветов</p>";
            }
        });
    }

    candGrid.addEventListener("click", function(e) {
        var pickerBtn = e.target.closest("#btnInlinePicker") || e.target.closest(".repick") || e.target.closest(".pick-cta");
        if (pickerBtn) {
            if(!pickCtx){toast("Сначала загрузите изображение");return;}
            
            e.preventDefault();
            e.stopPropagation();

            // ЕСЛИ УЖЕ АКТИВНА — ВЫКЛЮЧАЕМ (Отмена режима)
            if (pickerActive) {
                setPicker(false);
                toast("Режим пипетки отменён");
            } else {
                // ЕСЛИ БЫЛА ВЫКЛЮЧЕНА — ВКЛЮЧАЕМ
                setPicker(true);
                toast("Наведите на фото — лупа покажет цвет, клик — снять");
            }
            return; 
        }

        var card = e.target.closest(".hs-card");
        if (!card) {
            return;
        }

        openCard(
            card.dataset.id, 
            parseFloat(card.dataset.de), 
            card.dataset.src, 
            "ИИ Дизайн", 
            card.dataset.hex, 
            card.dataset.name, 
            card.dataset.code
        );

        // Оставшаяся часть логики (гармонии)...
        if (harmonyCard) {
            harmonyCard.hidden = false;
            var harmonyBody = document.getElementById("harmonyBody");
            var harmonyEmpty = document.getElementById("harmonyEmpty");
            if (harmonyBody) harmonyBody.hidden = false;
            if (harmonyEmpty) harmonyEmpty.hidden = true;
        }

        selectedBaseHex = card.dataset.hex;
        renderHarmony();
    });

    btnRegenerate.addEventListener("click", function() {
        genResult.hidden = true;
        genForm.hidden = false;
        candidatesCard.hidden = true;
        harmonyCard.hidden = true;
    });

    function buildRow(hex, sub, lab, delay, matches) {
        var el = document.createElement("div");
        el.className = "crow"; 
        el.style.animationDelay = delay + "ms";
        
        var matchesHtml = '';
        if (!matches) {
            matchesHtml = '<div class="chip-skeleton-wrap">' +
                '<div class="chip-skeleton"></div>' +
                '<div class="chip-skeleton"></div>' +
                '<div class="chip-skeleton"></div>' +
            '</div>';
        } else {
            matchesHtml = matches.map(function(m) {
                return '<button class="chip" data-id="' + m.id + '" data-de="' + m.de.toFixed(2) + '" data-src="' + hex + '" data-hex="' + m.h + '" data-name="' + m.n + '" data-code="' + m.code + '" title="' + deLabel(m.de) + ' · ' + m.code + '">' +
                    '<span class="chip-sq" style="background:' + m.h + '"></span>' +
                    '<span class="chip-txt"><b>' + m.n + '</b><small>' + m.code + '</small></span>' +
                    '<span class="de ' + deClass(m.de) + '">ΔE ' + m.de.toFixed(2) + '</span></button>';
            }).join('');
        }
    
        el.innerHTML = '<div class="crow-sw" style="background:' + hex + '"></div>' +
            '<div class="crow-info"><b>' + hex + '</b><small>' + sub + '</small></div>' +
            '<div class="crow-matches">' + matchesHtml + '</div>';
        return el;
    }

    function resetView(){
        if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null;}
        pvHolder.innerHTML="";
        dropSection.hidden=false; previewSection.hidden=true;
        resultsEl.innerHTML=EMPTY_HTML;
        fileNameNote.textContent="";
        currentRows=[]; pickedColor=null; pickCanvas=null; pickCtx=null; lastPick=null;
        setPicker(false); pickDot.hidden=true;
        selectedBaseHex=null; renderHarmony();
    }
    function runAnalysis(src,w,h){
        try{ afterAnalysis(analyzeSource(src,w,h)); }
        catch(err){ toast("Не удалось прочитать пиксели изображения"); }
    }

    function showPreview(node){
        pvHolder.innerHTML="";
        node.className="pv-node";
        pvHolder.appendChild(node);
        dropSection.hidden=true; previewSection.hidden=false;
    }
    function afterAnalysis(res){
        pickCanvas=res.canvas; pickCtx=res.ctx;
        currentRows=res.rows; pickedColor=null; lastPick=null;
        setPicker(false); pickDot.hidden=true;
        renderResultRows();
        selectedBaseHex=currentRows.length?currentRows[0].hex:null;
        renderHarmony();
        toast("Палитра извлечена: "+currentRows.length+" цвета + слот пипетки · поиск среди 48 000 цветов");
    }

    function renderResultRows(){
        if (!currentRows.length) { resultsEl.innerHTML = EMPTY_HTML; return; }
        resultsEl.innerHTML = "";
        
        var head = document.createElement("p");
        head.className = "res-head";
        head.textContent = "4 доминирующих цвета (k-means в Lab) + пятый слот (пипетка) · подбор по каталогу Битрикс";
        resultsEl.appendChild(head);
    
        // 1. Сначала мгновенно выводим строки со скелетонами
        currentRows.forEach(function(row, idx) {
            resultsEl.appendChild(buildRow(row.hex, row.pct + "% изображения", row.lab, idx * 70, null));
        });
    
        if (pickedColor) {
            var el = buildRow(pickedColor.hex, "ваш выбор · пипетка", pickedColor.lab, 280, null);
            el.classList.add("pick-row");
            var rp = document.createElement("button");
            rp.className = "repick"; rp.title = "Выбрать другой цвет пипеткой"; rp.innerHTML = PIP_SVG;
            el.querySelector(".crow-matches").prepend(rp);
            resultsEl.appendChild(el);
        } else {
            var pe = document.createElement("div");
            pe.className = "crow pick-row empty"; pe.style.animationDelay = "280ms";
            pe.innerHTML = '<div class="crow-sw dashed"></div>' +
            '<div class="crow-info"><b>Пипетка</b><small>пятый цвет выбираете вы</small></div>' +
            '<div class="crow-matches"><button class="btn btn-ghost pick-cta">' + PIP_SVG + 'Снять цвет с фото</button></div>';
            resultsEl.appendChild(pe);
        }
    
        // 2. Формируем пакетный запрос для Битрикса
        var colorsToRequest = {};
        currentRows.forEach(function(row, idx) {
            colorsToRequest['color_' + idx] = { l: row.lab[0], a: row.lab[1], b: row.lab[2] };
        });
        if (pickedColor) {
            colorsToRequest['color_picked'] = { l: pickedColor.lab[0], a: pickedColor.lab[1], b: pickedColor.lab[2] };
        }
    
        // 3. Отправляем AJAX запрос на ваш новый адрес
        $.ajax({
            url: '/ajax/color_service.php',
            method: 'POST',
            data: { colors: JSON.stringify(colorsToRequest) },
            dataType: 'json',
            success: function(response) {
                if (!response || response.error) {
                    toast("Ошибка поиска цветов в Битриксе");
                    return;
                }
                
                // Получили данные — плавно заменяем скелетоны на реальные кнопки
                var rowsElements = resultsEl.querySelectorAll(".crow:not(.empty)");
                
                currentRows.forEach(function(row, idx) {
                    var matchesData = response['color_' + idx];
                    if (matchesData && rowsElements[idx]) {
                        var freshRow = buildRow(row.hex, row.pct + "% изображения", row.lab, 0, matchesData);
                        rowsElements[idx].querySelector(".crow-matches").innerHTML = freshRow.querySelector(".crow-matches").innerHTML;
                    }
                });
    
                if (pickedColor && response['color_picked'] && rowsElements[currentRows.length]) {
                    var freshPickedRow = buildRow(pickedColor.hex, "ваш выбор · пипетка", pickedColor.lab, 0, response['color_picked']);
                    var targetMatches = rowsElements[currentRows.length].querySelector(".crow-matches");
                    targetMatches.innerHTML = freshPickedRow.querySelector(".crow-matches").innerHTML;
                    
                    // Возвращаем иконку пипетки в начало строки
                    var rp = document.createElement("button");
                    rp.className = "repick"; rp.title = "Выбрать другой цвет пипеткой"; rp.innerHTML = PIP_SVG;
                    targetMatches.prepend(rp);
                }
            },
            error: function() {
                toast("Не удалось связаться с базой данных цветов");
            }
        });
    }

    function renderHarmony() {
        var list = getBaseList();

        if (!list.length) { harmonyBody.hidden = true; harmonyEmpty.hidden = false; return; }
        harmonyEmpty.hidden = false; harmonyBody.hidden = true; // Скрываем, пока не выберем базу
        
        var exists = list.some(function(b) { return b.hex === selectedBaseHex; });
        if (!selectedBaseHex || !exists) selectedBaseHex = list[0].hex;
        
        var base = null;
        list.forEach(function(b) { if (b.hex === selectedBaseHex) base = b; });
        
        var hsl = rgb2hsl(base.rgb[0], base.rgb[1], base.rgb[2]);
        var scheme = null;
        SCHEMES.forEach(function(s) { if (s.id === selectedScheme) scheme = s; });
        
        Array.prototype.forEach.call(schemeTabs.children, function(t) {
            t.classList.toggle("active", t.dataset.id === selectedScheme);
        });
        
        baseRow.innerHTML = '<span>Базовый цвет:</span>' + list.map(function(b) {
            return '<button class="base-chip' + (b.hex === selectedBaseHex ? " active" : "") + '" data-hex="' + b.hex + '" title="' + b.label + ' · ' + b.hex + '" style="background:' + b.hex + '"></button>';
        }).join('') + '<span class="base-hex">' + base.hex + '</span>';
        
        baseRow.addEventListener("click",function(e){
            var c=e.target.closest(".base-chip");
            if(c){selectedBaseHex=c.dataset.hex;renderHarmony();}
        });

        hsGrid.addEventListener("click", function(e) {
            var c = e.target.closest(".hs-card");
            if (!c) return;
            openCard(
                c.dataset.id, 
                parseFloat(c.dataset.de), 
                c.dataset.src, 
                "цвет схемы", 
                c.dataset.hex, 
                c.dataset.name, 
                c.dataset.code
            );
        });

        schemeDesc.innerHTML = '<b>' + scheme.name + '</b> · ' + scheme.angles.length + ' цвета(ов). ' + scheme.desc + ' База схемы — ' + base.hex + ' (' + base.label.toLowerCase() + ').';
        
        // Рисуем схему на круге
        drawWheelScheme(hsl, scheme.angles);
        harmonyEmpty.hidden = true; harmonyBody.hidden = false;
    
        // 1. Генерируем теоретические цвета схемы и сразу строим под них скелетоны в сетке
        var colorsToRequest = {};
        var skeletonsHtml = '';
    
        scheme.angles.forEach(function(a, idx) {
            var th = ((hsl.h + a) % 360 + 360) % 360;
            var rgb = hsl2rgb(th, hsl.s, hsl.l);
            var hex = rgb2hex(rgb[0], rgb[1], rgb[2]);
            
            // Ключ для AJAX
            var computedLab = rgb2lab(rgb); // JS сам считает Lab для гармонии
            colorsToRequest['angle_' + idx] = { l: computedLab[0], a: computedLab[1], b: computedLab[2], hex: hex, angle: a };
            
            // Временный скелетон для этой ячейки
            skeletonsHtml += '<div class="hs-card-skeleton-wrap">' +
                '<div class="hs-sw" style="background:' + hex + '">' + (a === 0 ? '<span class="hs-base">база</span>' : '') + '</div>' +
                '<div class="hs-meta-skeleton"></div>' +
            '</div>';
        });
    
        hsGrid.innerHTML = skeletonsHtml;
    
        // 2. Отправляем запрос в Битрикс за ближайшими реальными красками для всей схемы
        $.ajax({
            url: '/ajax/color_service.php',
            method: 'POST',
            data: { colors: JSON.stringify(colorsToRequest) },
            dataType: 'json',
            success: function(response) {
                if (!response || response.error) { return; }
                
                // Заменяем скелетоны на реальные результаты из Битрикса
                var htmlResults = scheme.angles.map(function(a, idx) {
                    var reqInfo = colorsToRequest['angle_' + idx];
                    // Беру самый первый (самый точный) цвет из предложенных трех
                    var m = response['angle_' + idx] ? response['angle_' + idx][0] : null;
                    
                    if (!m) return '';
    
                    return '<button class="hs-card" data-id="' + m.id + '" data-de="' + m.de.toFixed(2) + '" data-src="' + reqInfo.hex + '" data-hex="' + m.h + '" data-name="' + m.n + '" data-code="' + m.code + '" title="' + m.n + ' · ' + m.code + '">' +
                    '<span class="hs-sw" style="background:' + m.h + '">' +
                        (a === 0 ? '<span class="hs-base">база</span>' : '') +
                        '<span class="hs-dot" style="background:' + reqInfo.hex + '" title="Теоретический цвет схемы: ' + reqInfo.hex + '"></span></span>' +
                    '<span class="hs-meta"><span class="hs-name">' + m.n + '</span><span class="hs-code">' + m.code + '</span>' +
                    '<span class="hs-de"><span class="de ' + deClass(m.de) + '">ΔE ' + m.de.toFixed(2) + '</span><small>к цвету схемы</small></span>' +
                    '<span class="hs-order">Заказать →</span></span></button>';
                }).join("");
                
                hsGrid.innerHTML = htmlResults;
            }
        });
    }

    function schemeIcon(angles){
        var dots=angles.map(function(a){
            var x=(10+7*Math.cos(a*RAD)).toFixed(1), y=(10-7*Math.sin(a*RAD)).toFixed(1);
            return '<circle cx="'+x+'" cy="'+y+'" r="2.6" fill="currentColor"/>';
        }).join("");
        return '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" opacity=".3"/>'+dots+'</svg>';
    }
    schemeTabs.innerHTML=SCHEMES.map(function(s){
        return '<button class="scheme-tab'+(s.id===selectedScheme?" active":"")+'" data-id="'+s.id+'">'+schemeIcon(s.angles)+s.name+'</button>';
    }).join("");
    schemeTabs.addEventListener("click",function(e){
        var t=e.target.closest(".scheme-tab");
        if(t){selectedScheme=t.dataset.id;renderHarmony();}
    });

    function getBaseList(){
        var list=currentRows.map(function(r,i){return {hex:r.hex,rgb:r.rgb,lab:r.lab,label:"Доминанта "+(i+1)};});
        if(pickedColor)list.push({hex:pickedColor.hex,rgb:pickedColor.rgb,lab:pickedColor.lab,label:"Ваш выбор (пипетка)"});
        return list;
    }

    renderHarmony();

    function fallbackColorExtractor(img) {
        var mockColors = [
            { hex: "#7A8272", lab: [52, -7, 10] }, 
            { hex: "#D6C4B0", lab: [78, 4, 13] },  
            { hex: "#4A525A", lab: [35, -1, -5] }  
        ];
        renderAICandidates(mockColors);
    }

    window.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
            closePaywall();
        }
    });

    var cardBack = document.getElementById("cardBack");
    var cardX = document.getElementById("cardX");
    var catX = document.getElementById("catX");
    
    mOpts.addEventListener("click", function(e) {
        var b = e.target.closest(".opt-add");
        if (!b) return;
        
        // Собираем полный комплект ID, который требует ваша корзина и get_price
        var mainProductId = b.dataset.mainId;     // ID основного товара красок (или служебного)
        var currentOfferId = b.dataset.bitrixId;  // ID торгового предложения (или служебного товара)
        var currentColorId = cardBack.dataset.colorId; // ID выбранного цвета из базы Битрикса
        // Вызываем нашу функцию добавления в корзину Intec
        sendColorToBitrixCart(mainProductId, currentOfferId, currentColorId);
    });
    cardX.addEventListener("click", function() { hideBack(cardBack); });
    cardBack.addEventListener("click", function(e) {
        if (e.target === cardBack) hideBack(cardBack);
    });

    // Закрытие каталога при клике на крестик или мимо окна (на подложку)
    catX.addEventListener("click", function() { hideBack(catBack); });
    catBack.addEventListener("click", function(e) {
        if (e.target === catBack) hideBack(catBack);
    });

    // Закрытие поиска по координатам при клике на крестик или мимо окна (на подложку)
    coordX.addEventListener("click", function() { hideBack(coordBack); });
    coordBack.addEventListener("click", function(e) {
        if (e.target === coordBack) hideBack(coordBack);
    });

    function sendColorToBitrixCart(mainProductId, currentOfferId, currentColorId) {
        toast("Добавление товара в корзину...");
        var body = new URLSearchParams();
        body.set("id", String(currentOfferId));
        body.set("color_id", String(currentColorId));
        body.set("quantity", "1");
        if (window.BX && typeof window.BX.bitrix_sessid === "function") body.set("sessid", window.BX.bitrix_sessid());
        fetch("/ajax/add_to_basket_v3.php", {
            method: "POST",
            credentials: "same-origin",
            headers: {"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded; charset=UTF-8"},
            body: body.toString()
        }).then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function(data){
              if (!data || data.status !== "success") throw new Error((data && data.error) || "basket_error");
              if (window.BX && typeof window.BX.onCustomEvent === "function") window.BX.onCustomEvent("OnBasketChange");
              hideBack(cardBack);
              toast("Товар добавлен в корзину" + (data.color_article ? " · " + data.color_article : ""));
          }).catch(function(){ toast("Не удалось добавить товар. Попробуйте ещё раз."); });
    }

});
