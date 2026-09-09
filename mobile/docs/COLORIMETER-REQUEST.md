# Запрос производителю колориметра (CHNSpec ColorMeter Pro)

Что нужно получить, чтобы прибор заработал с приложением «Арчи». Публичного
SDK и описания протокола у CHNSpec нет — всё ниже запрашивается напрямую
у производителя или дистрибьютора, обычно под NDA.

Каждый пункт привязан к тому, что в коде придётся заполнить:
`mobile/src/services/ble/protocol.ts` (UUID и разбор кадра) и
`RealBleColorimeterService.ts` (сканирование, подключение, команды).

## Блокеры — без этого интеграции не будет

**1. Тип радиоканала.** BLE (GATT) или классический Bluetooth SPP?
Это первый вопрос, потому что он может закрыть проект целиком: **SPP на iOS
требует сертификации MFi**, и без неё приложение под iPhone не сможет
говорить с прибором в принципе. Если SPP — спрашиваем, есть ли у прибора
MFi-чип и готовы ли они дать MFi-совместимую версию. Если BLE — идём дальше.

**2. UUID сервиса и характеристик.** Какая характеристика отдаёт измерение
(notify/indicate), какая принимает команды (write / write-without-response),
какие есть на чтение. Плюс: по чему фильтровать прибор при сканировании —
имя в эфире, service UUID в advertising, manufacturer data.

**3. Формат кадра измерения.** Байт-порядок, тип чисел, масштабные
коэффициенты, знак для `a*`/`b*`, контрольная сумма, признак конца пакета.
Нужен пример: сырой кадр в hex и то, что он означает.

**4. Что именно отдаёт прибор.** Спектр отражения, XYZ или только Lab?
**Нам предпочтителен спектр** (укажите диапазон и шаг, обычно 400–700 нм
через 10 нм): по спектру мы сами пересчитаем цвет под любой источник света —
на сайте ArchiPaint уже есть предпросмотр при семи источниках, и хочется,
чтобы прибор это поддерживал, а не только выдавал Lab под одним D65.

**5. Команда «сделать замер»** и её ответ: байты команды, время отклика,
что приходит при ошибке.

**6. Калибровка.** По белому и чёрному эталону: как инициируется командой,
что возвращает, как часто требуется, как из данных прибора понять, что
калибровка просрочена. Без этого мы не сможем показать пользователю
«прибор нужно откалибровать» и получим претензии по неверному подбору.

**7. Сопряжение и безопасность.** Нужен ли bonding, PIN, шифрование
характеристик; сколько устройств прибор держит одновременно; как ведёт себя
при обрыве связи и переподключении.

## Важно, но не блокирует старт

**8. Настройки измерения по протоколу:** источник и наблюдатель (D65/D50,
2°/10°), SCI/SCE — можно ли переключать командой и как узнать текущий режим.

**9. Служебные данные:** заряд батареи, серийный номер, версия прошивки,
коды ошибок с расшифровкой.

**10. Память прибора:** можно ли вычитать сохранённые в нём замеры и в каком
формате (замеры, сделанные без телефона).

**11. MTU и фрагментация:** максимальный размер пакета, как собирается
длинный кадр (особенно если отдаёте спектр).

**12. Версии прошивки:** отличается ли протокол между версиями, как
обновляется прошивка и не ломает ли обновление совместимость.

**13. Готовый SDK.** Спросить прямо: есть ли библиотека под Android (`.aar`)
и iOS (`.framework` / Swift Package), с исходниками или без, по какой
лицензии и можно ли использовать её в коммерческом приложении под нашим
брендом. Если SDK есть — интеграция сокращается до дней. Просить и его,
и описание протокола: SDK может не покрыть нужное.

**14. Демо-приложение с исходниками** — самый быстрый способ сверить наш
разбор кадра с эталонным.

## Метрология — это пойдёт в претензии клиентов

**15. Повторяемость** (ΔE*ab на белом эталоне, при скольких замерах),
**межприборная согласованность** (inter-instrument agreement) — насколько
разойдутся два прибора в разных магазинах на одной выкраске. Апертура,
геометрия (D/8), время замера, ресурс лампы.

**16. Сертификат калибровки** на каждый экземпляр, срок действия,
где и как делать рекалибровку (есть ли сервис в России).

## Коммерческие вопросы

**17. Два образца прибора + белый эталон** на время интеграции.
**18. Цена от объёма, срок поставки, гарантия.**
**19. OEM-брендирование** — можно ли выпустить прибор под маркой ArchiPaint.
**20. EAC / ТР ТС** и документы для ввоза в РФ.
**21. NDA** — производитель почти наверняка попросит его первым; имеет смысл
предложить самим, чтобы не терять неделю.

## Как проверим, что всё работает

Приёмка после получения документации и образцов:

1. Наш `parseReading()` разбирает кадр и даёт тот же Lab, что показывает
   их фирменное приложение на том же замере — расхождение ΔE₀₀ < 0,5.
2. Десять выкрасок ArchiPaint: пять замеров каждой, повторяемость
   укладывается в заявленную производителем.
3. Два прибора на одной выкраске расходятся не больше заявленного IIA.
4. Полный цикл в приложении: сканирование → подключение → калибровка по
   белому → замер → `/api/palette/nearest` → показ ближайшего оттенка ARCHI.

## Письмо (можно отправлять как есть)

> **Subject:** ColorMeter Pro — BLE protocol / SDK request for integration into our retail app
>
> Dear CHNSpec team,
>
> We are ArchiPaint (archipaint.ru), a paint retail chain in Russia. We are
> building our own iOS/Android application for our customers and stores, and
> we are evaluating ColorMeter Pro as the measuring device: the customer
> measures a surface, and our app matches it against the ArchiPaint colour
> database and lets them order the tinted paint.
>
> To integrate the device we need the following. We are ready to sign an NDA
> first — please send us your standard form.
>
> **Connectivity**
> 1. Does the device use Bluetooth Low Energy (GATT) or Bluetooth Classic
>    (SPP)? If SPP — is the device MFi-certified for iOS?
> 2. Is pairing/bonding, a PIN or link-layer encryption required?
> 3. How should our app identify the device while scanning: advertised name,
>    service UUID, manufacturer data?
>
> **GATT profile and framing**
> 4. UUIDs of the service and of all characteristics, with their properties
>    (notify / indicate / read / write / write-without-response).
> 5. Frame format of a measurement: byte order, data types, scaling factors,
>    sign handling for a*/b*, checksum, end-of-packet marker. Please include
>    at least one raw hex example with its decoded meaning.
> 6. Maximum MTU and how long frames are fragmented and reassembled.
>
> **Measurement data**
> 7. What does the device return: spectral reflectance, XYZ, or Lab only?
>    If spectral data is available, please specify the wavelength range and
>    step. Spectral output is strongly preferred — we need to recompute
>    colour under several illuminants on our side.
> 8. Can the illuminant and observer (D65/D50, 2°/10°) and SCI/SCE mode be
>    selected over the protocol? How do we read the current setting?
>
> **Commands**
> 9. The "take a measurement" command, its response and typical timing.
> 10. White and black calibration: commands, responses, how often calibration
>     is required, and how the app can detect that calibration has expired.
> 11. Service data: battery level, serial number, firmware version, and the
>     full list of error codes with their meaning.
> 12. Can measurements stored in the device memory be read out, and in what
>     format?
> 13. Do different firmware versions use different protocols? How is firmware
>     updated, and does an update affect protocol compatibility?
>
> **SDK**
> 14. Do you provide an SDK for Android (.aar) and iOS (.framework / Swift
>     Package)? With or without sources, under which licence, and may it be
>     used in a commercial application published under our own brand?
> 15. Is a demo application with source code available?
>
> **Metrology**
> 16. Repeatability (ΔE*ab on the white standard, number of measurements)
>     and inter-instrument agreement between units.
> 17. Measuring aperture, geometry, measurement time.
> 18. Is a calibration certificate supplied with each unit? What is its
>     validity period, and where can units be re-calibrated (is there a
>     service partner in Russia)?
>
> **Commercial**
> 19. We would like to purchase two sample units with white calibration tiles
>     for the integration work.
> 20. Price depending on volume, lead time and warranty terms.
> 21. Is OEM branding possible — units supplied under the ArchiPaint brand?
> 22. Do you provide EAC / TR CU documentation for import into Russia?
>
> Thank you in advance. We are happy to arrange a call with your engineering
> team if that is faster.
>
> Best regards,
> [имя], ArchiPaint
> [телефон, email, сайт]

## Если протокол не дадут

Вариант «Б» — оставить сценарий колориметра на приборе другого
производителя, у которого SDK открыт, и это стоит проверить **до** закупки
партии. Реверс-инжиниринг собственного купленного прибора технически
возможен (BLE-снифферы, логи HCI на Android), но перед этим нужно смотреть
условия продажи и лицензию их приложения — и в любом случае это хрупкая
основа для розничной сети: прошивка обновится, и всё сломается.

Архитектура приложения к обоим вариантам готова: протокол изолирован
в `protocol.ts`, экраны и подбор по палитре от него не зависят.
