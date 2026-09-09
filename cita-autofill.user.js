// ==UserScript==
// @name         Cita Por Favor — huellas + tarjetas (Barcelona, вся провинция)
// @namespace    cita-catcher.local
// @version      9.20
// @description  Cita Por Favor проверяет ситы по провинции Барселона («Cualquier oficina» — вся провинция, или конкретный офис из списка на панели): вкладка сама проверяет наличие сит на toma de huellas и/или expedición de tarjetas, при находке заполняет форму и зовёт голосом компьютера — за человеком только SMS-код и Confirmar. Ритм задаётся отдельными пресетами для часовых окон и интервального режима; свои пресеты можно сохранять. Без обхода защиты: реальный браузер, человеческий темп, backoff при блокировке. Личные данные вводятся через панель (кнопка «Изменить мои данные») и хранятся только в Tampermonkey.
// @match        https://icp.administracionelectronica.gob.es/*
// @match        https://pasarela.clave.gob.es/*
// @match        https://*.clave.gob.es/*
// @noframes
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  // Версия берётся из шапки (@version) и видна на панели в приписке внизу —
  // чтобы одним взглядом проверять, какая версия реально стоит в Tampermonkey.
  const SCRIPT_VER =
    (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';

  // ============ ЛИЧНЫЕ ДАННЫЕ ============
  // В коде их НЕТ: заполняются один раз через кнопку «👤 Изменить мои данные» на панели
  // и хранятся в хранилище Tampermonkey (переживают обновления скрипта).
  const DATA_DEFAULTS = {
    docType: 'NIE',             // 'NIE' или 'PASSPORT'
    docNumber: '',
    fullName: '',
    birthYear: '',
    country: 'RUSIA',           // точное название из списка на сайте
    phone: '',
    email: '',
    tramites: ['huellas'],      // какие услуги проверять (ключи из TRAMITES)
    office: '',                 // какой офис проверять ('' = вся провинция; ключи из OFFICES)
    useClave: false,            // вход через Cl@ve: скрипт зовёт человека авторизоваться
    claveCert: false,           // Cl@ve через сертификат (eIdentifier) — авто-клик плитки
  };
  const store = {
    get: (k, d) => (typeof GM_getValue === 'function')
      ? GM_getValue(k, d) : (localStorage.getItem('gm_' + k) ?? d),
    set: (k, v) => (typeof GM_setValue === 'function')
      ? GM_setValue(k, v) : localStorage.setItem('gm_' + k, v),
  };
  let DATA = { ...DATA_DEFAULTS };
  try { DATA = Object.assign({}, DATA_DEFAULTS, JSON.parse(store.get('ck_data', '{}'))); } catch (e) {}
  if (!DATA.useClave) DATA.claveCert = false; // сертификат существует только внутри Cl@ve
  const dataReady = () => !!(DATA.docNumber && DATA.fullName && DATA.phone && DATA.email);

  // Офисы провинции Барселона — список снят с сайта citar?p=8 (02.09.2026):
  // 24 комиссариа провинции + 4 офиса собственно Барселоны. По умолчанию ''
  // («Cualquier oficina») — слоты всей провинции, прежнее поведение.
  // key — ключ поиска опции в #sede/#idSede (findOption ищет подстроку в
  // верхнем регистре). Ключи подобраны так, чтобы не совпасть с улицей чужого
  // офиса: у Руби улица называется TERRASSA, поэтому Terrassa ищем как
  // «COMISARIA TERRASSA», Vic — «COMISARIA VIC». short — метка для журнала
  // (бюджет строки ~40 символов, см. CLAUDE.md).
  const OFFICES = [
    { key: '', short: '', label: 'Вся провинция (Cualquier oficina)' },
    { key: 'BADALONA', short: 'BADALONA', label: 'Badalona' },
    { key: 'CASTELLDEFELS', short: 'CASTELLDEFELS', label: 'Castelldefels' },
    { key: 'CERDANYOLA', short: 'CERDANYOLA', label: 'Cerdanyola del Vallès' },
    { key: 'CORNELLA', short: 'CORNELLA', label: 'Cornellà de Llobregat' },
    { key: 'PRAT DE LLOBREGAT', short: 'PRAT', label: 'El Prat de Llobregat' },
    { key: 'GRANOLLERS', short: 'GRANOLLERS', label: 'Granollers' },
    { key: 'IGUALADA', short: 'IGUALADA', label: 'Igualada' },
    { key: 'HOSPITALET', short: 'HOSPITALET', label: "L'Hospitalet de Llobregat" },
    { key: 'MANRESA', short: 'MANRESA', label: 'Manresa' },
    { key: 'MATARO', short: 'MATARÓ', label: 'Mataró' },
    { key: 'MONTCADA', short: 'MONTCADA', label: 'Montcada i Reixac' },
    { key: 'RIPOLLET', short: 'RIPOLLET', label: 'Ripollet' },
    { key: 'RUBI', short: 'RUBÍ', label: 'Rubí' },
    { key: 'SABADELL', short: 'SABADELL', label: 'Sabadell' },
    { key: 'SANT ADRIA', short: 'SANT ADRIA', label: 'Sant Adrià del Besòs' },
    { key: 'SANT BOI', short: 'SANT BOI', label: 'Sant Boi de Llobregat' },
    { key: 'SANT CUGAT', short: 'SANT CUGAT', label: 'Sant Cugat del Vallès' },
    { key: 'SANT FELIU', short: 'SANT FELIU', label: 'Sant Feliu de Llobregat' },
    { key: 'SANTA COLOMA', short: 'SANTA COLOMA', label: 'Santa Coloma de Gramenet' },
    { key: 'COMISARIA TERRASSA', short: 'TERRASSA', label: 'Terrassa' },
    { key: 'COMISARIA VIC', short: 'VIC', label: 'Vic' },
    { key: 'VILADECANS', short: 'VILADECANS', label: 'Viladecans' },
    { key: 'VILAFRANCA', short: 'VILAFRANCA', label: 'Vilafranca del Penedès' },
    { key: 'VILANOVA', short: 'VILANOVA', label: 'Vilanova i la Geltrú' },
    { key: 'GUADALAJARA', short: 'BCN-GUADALAJARA', label: 'Barcelona · Guadalajara 1' },
    { key: 'MALLORCA GRANADOS', short: 'BCN-MALLORCA', label: 'Barcelona · Mallorca 213 (Granados)' },
    { key: 'PSJ', short: 'BCN-PSJ', label: 'Barcelona · Passeig Sant Joan 189' },
    { key: 'RAMBLA GUIPUSCOA', short: 'BCN-RAMBLA', label: 'Barcelona · Rambla Guipúscoa 74' },
  ];
  function currentOffice() {
    return OFFICES.find((o) => o.key === DATA.office) || OFFICES[0];
  }
  // Услуги, которые умеем ловить. Галочки — в «🔎 Настройки поиска».
  // Если отмечено несколько, чекер чередует их по кругу (нагрузка не растёт).
  const TRAMITES = [
    { key: 'huellas',
      label: 'TOMA DE HUELLAS (expedición de tarjeta)',
      keyword: 'TOMA DE HUELLAS' },
    { key: 'tarjetas',
      label: 'EXPEDICIÓN DE TARJETAS (Dirección General de Gestión Migratoria)',
      keyword: 'GESTIÓN MIGRATORIA' },
  ];
  function activeTramites() {
    const sel = TRAMITES.filter((t) => (DATA.tramites || []).includes(t.key));
    return sel.length ? sel : [TRAMITES[0]];
  }
  // текущая услуга цикла: без активной проверки — первая отмеченная, в проверке — по кругу
  function currentTramite() {
    const list = activeTramites();
    if (!driving()) return list[0];
    const i = parseInt(SS.get('tramIdx') || '0', 10) % list.length;
    return list[i];
  }
  function nextTramite() {
    SS.set('tramIdx', String(parseInt(SS.get('tramIdx') || '0', 10) + 1));
  }
  // подписи для журнала: [значок, текст]. ⚠️ — только настоящие ошибки.
  const LOG_LABELS = {
    NO_SLOTS:          ['·', 'сит нет'],
    SLOTS_FOUND:       ['🎉', 'СИТЫ найдены'],
    SLOTS_CAPTCHA:     ['🎉', 'СИТЫ — введи капчу'],
    SLOTS_FOUND_FINAL: ['🎉', 'СИТЫ — финал, SMS+Confirmar'],
    CONFIG:            ['⚙️', 'старт'],
    RESUMED:           ['🔄', 'ожил после заморозки'],
    CLAVE_NEEDED:      ['🔐', 'Cl@ve: нужен вход'],
    CLAVE_AUTH_WAIT:   ['🔐', 'Cl@ve: авторизация'],
    SLOTS_LOST:        ['⚠️', 'слоты сорвались'],
    WAF_BLOCKED:       ['⚠️', 'блок сайта'],
    CODE_BLOCK:        ['⚠️', 'бот-блок'],
    UNKNOWN:           ['⚠️', 'незнакомая страница'],
    SITE_ERROR:        ['⚠️', 'ошибка сайта'],
    SITE_MAINTENANCE:  ['🛠️', 'обслуживание сайта'],
    TRAMITE_MISSING:   ['⚠️', 'услуга недоступна'],
    OFFICE_MISSING:    ['⚠️', 'офиса нет'],
    SESSION_LOOP:      ['⚠️', 'сессия не восстанавливается'],
  };

  // короткая сводка активных настроек — для журнала и панели.
  // v9.2: офис показываем только в журнале (withOffice) — на панели офис и так
  // выбран селектором выше; пресет ритма тоже не выносим сюда — он виден в
  // списке пресетов «Настроить ритм проверки», к ритму и относится.
  function settingsSummary(withOffice = true) { // журнал — с офисом; панель просит без
    const parts = [(DATA.tramites || []).join('+') || 'huellas'];
    if (DATA.useClave) parts.push(DATA.claveCert ? 'Cl@ve-серт' : 'Cl@ve-моб');
    else parts.push('аноним');
    if (withOffice) {
      const office = currentOffice();
      if (office.key) parts.push('офис ' + office.short);
    }
    return parts.join(' · ');
  }

  // ============ НАСТРОЙКИ ЧЕКЕРА ============
  // РИТМ ПРОВЕРОК (окна/интервалы, потолок окна, перепроверка после срыва слотов)
  // с v8.0 НЕ здесь: он редактируется
  // на панели (кнопка «⚙️ Настроить ритм проверки») и хранится в Tampermonkey — см. RUN
  // и BUILTIN_PRESETS ниже. Здесь остаётся поведение, пресетами не меняемое.
  const CONFIG = {
    // Человеческий ввод данных (шаг 3, форма заявителя): поля NIE/имя/год/страна
    // заполняем ПО ОЧЕРЕДИ с паузами, иначе сайт даёт код 0017 «слишком быстрый
    // ввод» и ложно показывает «нет сит». Эту форму чекер печатает В ЛЮБОМ режиме
    // (и Cl@ve/сертификат, и аноним) — сертификат даёт авторизацию, но данные
    // заявителя сайт всё равно просит ввести. Отсюда 0017 даже по сертификату.
    humanFillMinSec: 0.9,        // пауза между полями при вводе, сек (случайно 0.9–1.9)
    humanFillMaxSec: 1.9,
    // Форма заявителя (шаг 3, NIE/имя/год/страна) — экран, на котором ситы
    // сгорают чаще всего (замер Екатерины 03.09: ~9 из 10 находок умирают
    // после него). После «Copiar» из Cl@ve нашей печати там почти нет
    // (радиокнопка, иногда год, страна) — паузы personalFill* короче базовых,
    // а остаток полей и страна делаются ОДНИМ шагом: весь экран ~3 с вместо ~6.
    // 0017 раньше давала мгновенная ПЕЧАТЬ полей — её больше нет; но следим:
    // «бот-блок 0017» в журнале = вернуть 0.9/1.9. Анонимный режим (без
    // «Copiar») печатает сам — для него шаги остаются раздельными, как раньше.
    personalFillMinSec: 0.7,
    personalFillMaxSec: 1.3,
    // Экран телефона/почты (шаг 5) — быстрее формы заявителя: код 0018 ловился
    // только на мгновенном (<1 с на всё) заполнении. Паузы 0.5–1.0 с: весь ввод
    // ~3 с вместо ~6. Контроль: в журнале появился «бот-блок 0018» — вернуть
    // 0.9/1.9 (как в v7.24) и сказать ИИ-сессии.
    contactFillMinSec: 0.5,
    contactFillMaxSec: 1.0,
    maxConsecutiveBlocks: 5,     // после стольких WAF-блоков (близких по времени) — полная остановка
    blockDecayMin: 60,           // блоки в пределах N мин считаются подряд (backoff растёт);
                                 // после чистого промежутка >N мин счётчик обнуляется
    // Паузы после блоков, минут (дальше — последнее значение). Замер по journal.log
    // за 28–30.07: после 20 мин первый запрос снова ловил блок (успех 1 из 3),
    // после 40+ мин — успех 4 из 4. Значит наказание за 429 длится дольше 20 мин.
    // Ставим 30 как ЗАМЕР границы: если после 30 мин запрос проходит — этого хватает;
    // если снова блок — граница выше 30, ставить 40 (известно рабочее). Второй шаг 60
    // заведомо выше рабочего 40, чтобы после неудачной тридцатки точно расцепиться.
    backoffMin: [30, 60, 120, 120],
    alertServer: 'http://127.0.0.1:8765', // голосовой хелпер alert-server.py
    alertRepeatSec: 80,          // повторять голосовой алерт, пока не нажато «Я тут»
    unknownAfterSec: 75,         // незнакомая страница дольше N секунд = UNKNOWN
                                 // (с запасом: на заблокированном экране таймеры реже, страницы грузятся дольше)
    unknownRetryMin: 7,          // после случайного UNKNOWN — повторить через N минут
    maxConsecutiveUnknown: 3,    // столько UNKNOWN подряд = вёрстка правда поменялась, стоп
    stallAfterSec: 45,           // нет прогресса после находки дольше N секунд = зови на помощь
    saveFoundHtml: true,         // при находке сохранять HTML-снимок страницы (доказательство: ситы, не ошибка)
    FORCE_FOUND: false,          // debug: вести себя так, будто ситы найдены
  };
  const DEFAULT_START = 'https://icp.administracionelectronica.gob.es/icpplustieb/citar?p=8&locale=es';

  // ============ РИТМ ПРОВЕРОК — RUN (редактируется на панели, v8.0) ============
  // Всё, что раньше было зашито в CONFIG: стратегии ритма, потолок окна и
  // перепроверка после срыва слотов. Форсаж — отдельная ручная настройка.
  // Значения живут
  // в Tampermonkey (ck_run) и переживают обновления скрипта. Пресеты —
  // готовые наборы для каждого режима (не удаляются) + свои,
  // сохранённые кнопкой «💾 Сохранить как пресет» (ck_presets).
  const RUN_DEFAULTS = {
    mode: 'hourly',              // основной понятный режим: серия в начале часа
    hourlyWindowMin: 10,         // первые N минут каждого часа
    hourlyChecks: 5,             // ровно столько автоматических проверок в окне
    // Базовый темп — ровный. Ускорение можно включить только для часов,
    // которые пользователь подтвердил собственными наблюдениями.
    intervalMinMin: 7,            // спокойный интервал, мин (случайный между min и max)
    intervalMaxMin: 10,
    hotHours: '',                  // пусто = ускорения по часам нет
    hotIntervalMinSec: 60,        // интервал в горячие часы, сек (в среднем ~120 с →
    hotIntervalMaxSec: 180,       // ~5 проверок за ~11 мин, вразброс; потолок сверху)
    // ЖЁСТКИЙ ПОТОЛОК + СЛУЧАЙНЫЙ РАЗБРОС (главная защита и стратегия).
    // Данные 22–23.07: 5 проверок за скользящие ~11 мин сайт терпит, 6-я =
    // WAF-бан. Держим ≤maxPerWindow за windowMin: упёрлись — ждём, пока
    // старейшая проверка выпадет из окна (гарантия «≤N/окно»). Проверки идут
    // ВРАЗБРОС — разброс лучше пар по покрытию всплеска и человечнее.
    maxPerWindow: 5,
    windowMin: 11,                // 5 за 11 мин (не 10) — запас от порога WAF
    activeFrom: 6,                // работать с часа (0 = ночью не спать)
    activeTo: 23,                 // …до часа (24 = ночью не спать)
    boostSec: 60,                 // форсаж (галочка на панели): интервал проверки, сек (±15%)
    lostRetryMinSec: 5,           // слоты сорвались (SLOTS_LOST): сорванная бронь часто
    lostRetryMaxSec: 12,          // СРАЗУ возвращается — перепроверяем почти мгновенно, а не
                                  // по обычному ритму. Потолок windowMin обходим сознательно:
                                  // ловим уже существовавший слот (+ проход формы ~15–25 с)
  };
  // Каждый встроенный пресет содержит только параметры своей стратегии;
  // общие пределы хранятся с ним, форсаж — всегда отдельно.
  const BUILTIN_PRESETS = {
    'Рекомендованные часовые окна': {
      mode: 'hourly',
      hourlyWindowMin: 10,
      hourlyChecks: 5,
      maxPerWindow: 5,
      windowMin: 11,
      lostRetryMinSec: 5,
      lostRetryMaxSec: 12,
    },
    'Рекомендованный интервальный ритм': {
      mode: 'interval',
      intervalMinMin: 7,
      intervalMaxMin: 10,
      hotHours: '',
      hotIntervalMinSec: 60,
      hotIntervalMaxSec: 180,
      activeFrom: 6,
      activeTo: 23,
      maxPerWindow: 5,
      windowMin: 11,
      lostRetryMinSec: 5,
      lostRetryMaxSec: 12,
    },
  };
  // v9.3: интервал форсажа — НЕ часть пресета: настройка отдельная, живёт в
  // RUN сама по себе. Пресетом не меняется, правка поля пресет не сбрасывает.
  for (const p of Object.values(BUILTIN_PRESETS)) delete p.boostSec;
  // разбор «6-13, 19-23» → [[6,13],[19,23]]; null = формат неверный
  function parseHotHours(text) {
    const out = [];
    for (const part of String(text || '').split(',')) {
      const m = part.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (!m) return null;
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b || b > 24) return null;
      out.push([a, b]);
    }
    return out.length ? out : null;
  }
  // «7» = точный интервал, «7–10» / «7-10» = случайный диапазон минут.
  function parseIntervalRange(text, lo = 0.1, hi = 720) {
    const m = String(text || '').trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const a = parseFloat(m[1]), b = parseFloat(m[2] || m[1]);
    if (!isFinite(a) || !isFinite(b) || a < lo || b > hi) return null;
    return a <= b ? [a, b] : [b, a];
  }
  const formatIntervalRange = (a, b) => a === b ? String(a) : a + '–' + b;
  function readCustomPresets() {
    try { return JSON.parse(store.get('ck_presets', '{}')) || {}; } catch (e) { return {}; }
  }
  function writeCustomPresets(obj) { store.set('ck_presets', JSON.stringify(obj)); }
  function applyPreset(name) {
    const raw = Object.assign({}, BUILTIN_PRESETS, readCustomPresets())[name];
    const p = raw && (raw.mode ? raw : Object.assign({ mode: 'interval' }, raw));
    if (!p) return false;
    // v9.3: интервал форсажа пресетом не трогаем — он стоит в merge последним
    // и перекрывает boostSec даже из пресетов, сохранённых до v9.2
    RUN = Object.assign({}, RUN_DEFAULTS, p, { preset: name, boostSec: RUN.boostSec });
    SS.del('boostUntil'); // v9.0: авто-форсаж ушёл, ключ от него протух — подчистить
    store.set('ck_run', JSON.stringify(RUN));
    return true;
  }
  let RUN = { preset: 'Рекомендованные часовые окна', ...RUN_DEFAULTS };
  try {
    const saved = JSON.parse(store.get('ck_run', 'null'));
    if (saved) {
      // Старые настройки были только интервальными: не меняем их молча.
      RUN = Object.assign({ preset: 'Рекомендованные часовые окна' }, RUN_DEFAULTS, saved);
      if (!saved.mode) RUN.mode = 'interval';
    }
  } catch (e) {}
  delete RUN.boost; delete RUN.boostMin; // v9.0: авто-форсаж ушёл — не тащить ключи в новые сохранения
  // ==========================================

  // ---------- состояние ----------
  // sessionStorage — живёт в пределах вкладки, переживает переходы по шагам формы
  const SS = {
    get: (k) => sessionStorage.getItem('ck_' + k),
    set: (k, v) => sessionStorage.setItem('ck_' + k, v),
    del: (k) => sessionStorage.removeItem('ck_' + k),
  };
  // v9.0: понятие «чекер» (вкл/выкл) ушло из интерфейса. Две сущности (v9.3):
  // «Запустить проверку» — БЕСКОНЕЧНЫЙ цикл (on). Галочка форсажа (boost +
  // boostRun) подменяет его темп: ритм игнорируется, проверки каждые boostSec
  // сек. «Проверить сейчас» — РАЗОВАЯ проверка (once): ровно один цикл до
  // вердикта, цикл никогда не запускает (даже с галочкой). driving() = машина
  // активно ведёт проверки хоть одним из них.
  const rhythmOn = () => SS.get('on') === '1';
  const boostMode = () => SS.get('boost') === '1';
  const boostRun = () => boostMode() && (SS.get('boostRun') === '1' || rhythmOn());
  const onceMode = () => SS.get('once') === '1';
  const onceOnly = () => onceMode() && !rhythmOn() && !boostRun();
  const driving = () => (rhythmOn() && !boostMode()) || boostRun() || onceMode();
  const foundMode = () => SS.get('found') === '1' || CONFIG.FORCE_FOUND;

  // v9.4: браузерный перевод страницы (Chrome «перевести на русский»)
  // переписывает испанские надписи — скрипт перестаёт узнавать экраны
  // («no hay citas», кнопки по тексту) и кликает наугад, даже выключенный.
  // Переведённую страницу Chrome помечает классом translated-ltr/rtl на <html>.
  const pageTranslated = () =>
    document.documentElement.classList.contains('translated-ltr') ||
    document.documentElement.classList.contains('translated-rtl');

  // localStorage — журнал и счётчик блоков (общие для сайта)
  function readLog() {
    try { return JSON.parse(localStorage.getItem('ck_log') || '[]'); } catch (e) { return []; }
  }
  function recordResult(state, extra) {
    const log = readLog();
    const entry = { t: Date.now(), s: state, x: extra || undefined };
    log.push(entry);
    while (log.length > 300) log.shift();
    localStorage.setItem('ck_log', JSON.stringify(log));
    sendJournal(entry); // дублируем запись в файл через хелпер (полная история на диске)
    renderStats();
  }
  // служебные записи журнала — НЕ проверки, в счётчик «сегодня» не идут
  // (SLOTS_CAPTCHA/FINAL — продолжение уже посчитанной находки, не новая проверка)
  const META_STATES = ['CONFIG', 'RESUMED', 'CLAVE_NEEDED', 'CLAVE_AUTH_WAIT',
    'SLOTS_CAPTCHA', 'SLOTS_FOUND_FINAL', 'SITE_MAINTENANCE'];
  function todayCount() {
    const day = new Date().toDateString();
    return readLog().filter((e) =>
      new Date(e.t).toDateString() === day && !META_STATES.includes(e.s)).length;
  }
  function lastResult() {
    const log = readLog();
    return log.length ? log[log.length - 1] : null;
  }
  const getBlocks = () => parseInt(localStorage.getItem('ck_blocks') || '0', 10);
  const setBlocks = (n) => localStorage.setItem('ck_blocks', String(n));
  const getUnknowns = () => parseInt(localStorage.getItem('ck_unknowns') || '0', 10);
  const setUnknowns = (n) => localStorage.setItem('ck_unknowns', String(n));
  const getLastBlockAt = () => parseInt(localStorage.getItem('ck_lastBlockAt') || '0', 10);
  const setLastBlockAt = (t) => localStorage.setItem('ck_lastBlockAt', String(t));
  // «блоков» в строке статистики — блоки ЗА СЕГОДНЯ (v9.1). Прежний показатель
  // (ck_blocks) — это цепочка блоков подряд для бэкоффа: она обнуляется после
  // паузы blockDecayMin, поэтому при сотнях проверок статистика писала «0».
  // Журнал ck_log ограничен 300 записями и при форсаже вытесняет старое —
  // поэтому ведём отдельный дневной счётчик (ключ с датой, в полночь сам = 0).
  function todayBlocks() {
    try {
      const d = JSON.parse(localStorage.getItem('ck_blocksDay') || 'null');
      return d && d.day === new Date().toDateString() ? d.n : 0;
    } catch (e) { return 0; }
  }
  function bumpTodayBlocks() {
    const day = new Date().toDateString();
    let n = 1;
    try {
      const d = JSON.parse(localStorage.getItem('ck_blocksDay') || 'null');
      if (d && d.day === day) n = d.n + 1;
    } catch (e) {}
    localStorage.setItem('ck_blocksDay', JSON.stringify({ day: day, n: n }));
  }
  function resetErrors() { setBlocks(0); setUnknowns(0); SS.del('siteerr'); }
  // На успешной проверке гасим только сиюминутные ошибки (незнакомая страница,
  // ошибка сайта). Счётчик WAF-блоков НЕ трогаем: иначе один успех между банами
  // обнуляет его и backoff не растёт (баг до v7.10 — ты крутишься в блоках весь
  // час). Блоки обнуляются сами по времени: если с последнего прошло >blockDecayMin.
  function resetTransient() {
    setUnknowns(0); SS.del('siteerr');
    if (getBlocks() && Date.now() - getLastBlockAt() > CONFIG.blockDecayMin * 60000) setBlocks(0);
  }

  // ---------- скользящий лимит проверок (главная защита от WAF) ----------
  // ck_hits — метки времени последних обращений к сайту (проверка = 1 запись).
  // Держим ≤ maxPerWindow за windowMin минут (порог WAF по данным 22–23.07).
  const readHits = () => { try { return JSON.parse(localStorage.getItem('ck_hits') || '[]'); } catch (e) { return []; } };
  function recordHit() {
    const cut = Date.now() - RUN.windowMin * 60000;
    const hits = readHits().filter((t) => t > cut);
    hits.push(Date.now());
    localStorage.setItem('ck_hits', JSON.stringify(hits));
  }
  const hitsInWindow = () => { const cut = Date.now() - RUN.windowMin * 60000; return readHits().filter((t) => t > cut).length; };
  function oldestHitInWindow() {
    const cut = Date.now() - RUN.windowMin * 60000;
    const w = readHits().filter((t) => t > cut);
    return w.length ? Math.min.apply(null, w) : Date.now();
  }

  // Пошаговый режим ПЕРЕЖИВАЕТ перезагрузку (sessionStorage) — иначе скрипт
  // снова захватывал форму после ручного перехода на главную. Он замораживает
  // ритм (как и форсаж): авто-навигации нет, каждый экран — по кнопке.
  // v9.0: ✋-пауза («не трогай страницу») ушла — её роль играет пошаговый режим.
  const stepMode = () => SS.get('step') === '1';
  let forcingStep = false; // кнопка «Сделать шаг» пропускает паузы на один тик
  let stopped = false;
  let waiting = false; // чекер ждёт следующую проверку — автофилл-автомат молчит
  let wasTranslated = false; // v9.4: страница сейчас переведена (для heartbeat)

  // ---------- голосовые алерты ----------
  const FALLBACK_TEXT = {
    found: 'Ситы пойманы, всё заполнено! Введи SMS-код и нажми Confirmar!',
    help: 'Ситы есть, но нужна твоя помощь! Подойди к компьютеру!',
    stopped: 'Проверка сит остановилась. Посмотри, когда будет минутка.',
    unknown: 'Проверка сит увидела незнакомую страницу и остановилась.',
    clave: 'Нужна авторизация Cl@ve — подтверди вход в приложении на телефоне.',
    test: 'Проверка связи. Голос работает.',
  };

  function gmGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('no GM')); return; }
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: timeoutMs || 4000,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r) : reject(new Error('http ' + r.status))),
        onerror: () => reject(new Error('net')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  function gmPost(url, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('no GM')); return; }
      GM_xmlhttpRequest({
        method: 'POST', url, data: body, timeout: timeoutMs || 4000,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r) : reject(new Error('http ' + r.status))),
        onerror: () => reject(new Error('net')),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // Пишем каждую запись журнала в файл через хелпер — чтобы полная история
  // проверок жила на диске (ИИ-сессии могут её читать для контекста), а не
  // только в localStorage вкладки. Хелпер не запущен → тихо пропускаем.
  function sendJournal(entry) {
    try {
      const label = (LOG_LABELS[entry.s] && LOG_LABELS[entry.s][1]) || entry.s;
      const line = new Date(entry.t).toLocaleString('ru') + '\t' + label +
        (entry.x ? '\t' + entry.x : '');
      gmPost(CONFIG.alertServer + '/journal', line, 3000).catch(() => {});
    } catch (e) { /* журнал не критичен */ }
  }

  // ---------- «экраны»: снимки ключевых экранов хелперу (v7.30) ----------
  // После находки экраны меняются быстро, и по одному журналу не видно, что
  // на них было (эпизод 03.09 11:01: находка → капча → снова капча → срыв —
  // что там предлагалось?). На каждый ключевой экран отправляем хелперу текст
  // страницы: тот сохраняет его (и PNG-скриншот всего экрана, если у Terminal
  // есть право «Запись экрана») в snaps/ в папке проекта — ИИ-сессия читает
  // файлы и видит всю цепочку: что было доступно и где сгорели ситы.
  // Один снимок на kind за загрузку страницы (перезагрузка = новый экран,
  // он снимается заново — две капчи в 11:01:11 и 11:01:42 дадут два файла).
  const snapped = {};
  function snapOnce(kind, note) {
    if (snapped[kind]) return;
    snapped[kind] = true;
    try {
      const text = (document.body ? document.body.innerText : '').trim().slice(0, 40000);
      const q = '/snap?kind=' + encodeURIComponent(kind) +
        '&url=' + encodeURIComponent(location.href.slice(0, 250)) +
        (note ? '&note=' + encodeURIComponent(String(note).slice(0, 200)) : '');
      gmPost(CONFIG.alertServer + q, text, 5000)
        .then(() => { helperOk = true; })
        .catch(() => { helperOk = false; });
    } catch (e) { /* снимок не критичен */ }
  }

  let helperOk = null; // null = не проверяли, true/false
  function pingHelper() {
    return gmGet(CONFIG.alertServer + '/ping', 2500)
      .then(() => { helperOk = true; renderStats(); return true; })
      .catch(() => { helperOk = false; renderStats(); return false; });
  }

  // Пульс сторожу: хелпер знает, когда должна быть следующая проверка,
  // и голосом зовёт человека, если чекер замолчал (вкладку заморозили/закрыли).
  function sendBeat() {
    const on = driving() ? 1 : 0;
    const nextAt = parseInt(SS.get('nextAt') || '0', 10);
    const due = on ? (nextAt || (Date.now() + RUN.intervalMaxMin * 60000)) : 0;
    gmGet(CONFIG.alertServer + '/beat?on=' + on + '&due=' + due, 3000)
      .then(() => { helperOk = true; renderStats(); })
      .catch(() => { helperOk = false; renderStats(); });
  }

  function browserFallbackAlert(kind) {
    const text = FALLBACK_TEXT[kind] || FALLBACK_TEXT.test;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU'; u.rate = 0.95; u.volume = 1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) {}
    try { // писк через WebAudio (может молчать без клика по вкладке — политика Chrome)
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.3;
      o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 700);
    } catch (e) {}
  }

  async function fireAlert(kind, msg) {
    const q = '/alert?kind=' + encodeURIComponent(kind) +
      (msg ? '&msg=' + encodeURIComponent(msg) : '');
    for (let i = 0; i < 3; i++) {
      try {
        await gmGet(CONFIG.alertServer + q, 5000);
        helperOk = true; renderStats(); return;
      } catch (e) { await new Promise((r) => setTimeout(r, 2000)); }
    }
    helperOk = false; renderStats();
    if (kind !== 'error') browserFallbackAlert(kind); // ошибки без хелпера не озвучиваем
  }

  let alertTimer = null;
  let titleTimer = null;
  let baseTitle = null;
  function startAlertLoop(kind) {
    if (alertTimer) return;
    fireAlert(kind);
    alertTimer = setInterval(() => fireAlert(kind), CONFIG.alertRepeatSec * 1000);
    baseTitle = document.title.replace(/^([✅⚠️🔔] )+/, '');
    let flip = false;
    titleTimer = setInterval(() => {
      document.title = (flip ? '🔔 ' : (kind === 'found' ? '✅ ' : '⚠️ ')) + baseTitle;
      flip = !flip;
    }, 900);
    if (imHereBtn) imHereBtn.style.display = 'block';
  }
  function stopAlertLoop() {
    if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
    if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
    if (baseTitle !== null) { document.title = '✅ ' + baseTitle; baseTitle = null; }
    if (imHereBtn) imHereBtn.style.display = 'none';
  }

  // ---------- планировщик проверок ----------
  // Форсаж (v9.0): галочка «Форсаж» на панели (под «Запустить проверку») —
  // ускоренный ТЕМП бесконечного цикла: каждые boostSec секунд (интервал —
  // поле в настройках ритма), пока галочка стоит; ритм игнорируется.
  // «Проверить сейчас» форсаж не запускает — та всегда одна проверка.
  // Включается ТОЛЬКО руками: авто-форсажа после находки/срыва нет (после
  // срыва — отдельная настройка lostRetry*). Пока форсаж ведёт проверки,
  // ритмичная проверка стоит «на паузе из-за режима форсаж».
  const inHotHours = () => {
    const h = new Date().getHours();
    return (parseHotHours(RUN.hotHours) || []).some(([a, b]) => h >= a && h < b);
  };
  function jitteredDelayMs() {
    if (boostRun()) return RUN.boostSec * 1000 * (0.85 + Math.random() * 0.3);

    // ЖЁСТКИЙ ПОТОЛОК: не больше maxPerWindow проверок за скользящее окно
    // windowMin. Проверяется первым. Если бюджет исчерпан — ждём, пока самая
    // старая проверка выпадет из окна (+джиттер). Гарантирует «≤N за окно».
    if (hitsInWindow() >= RUN.maxPerWindow) {
      SS.set('lastGap', 'лимит окна');
      const freeAt = oldestHitInWindow() + RUN.windowMin * 60000;
      const wait = freeAt - Date.now();
      return Math.max(wait, 30000) + Math.random() * 30000;
    }
    SS.del('lastGap');

    if (RUN.mode === 'hourly') return hourlyDelayMs();
    const hot = inHotHours();

    // Горячий час: проверки ВРАЗБРОС — случайный интервал (в среднем
    // ~maxPerWindow за окно). Не пары: лучше временнóе покрытие всплеска и
    // человечнее. Потолок выше держит суммарно ≤maxPerWindow за окно.
    if (hot) {
      const min = RUN.hotIntervalMinSec * 1000;
      const max = RUN.hotIntervalMaxSec * 1000;
      return min + Math.random() * (max - min);
    }
    // не горячий час — спокойный базовый интервал
    const min = RUN.intervalMinMin * 60000;
    const max = RUN.intervalMaxMin * 60000;
    return min + Math.random() * (max - min);
  }
  // Следующее место в серии «первые N минут часа». Уже завершённые проверки
  // считаются по ck_hits, поэтому первый ручной старт внутри окна входит в N.
  function hourlyDelayMs() {
    const now = Date.now();
    const start = new Date();
    start.setMinutes(0, 0, 0);
    const windowStart = start.getTime();
    const windowEnd = windowStart + RUN.hourlyWindowMin * 60000;
    const hits = readHits().filter((t) => t >= windowStart && t < windowEnd).length;
    if (now < windowEnd && hits < RUN.hourlyChecks) {
      const left = RUN.hourlyChecks - hits;
      const slice = (windowEnd - now) / left;
      // Вразброс, но оставляем время на остальные проверки этой серии.
      return Math.max(15000, Math.min(slice * (0.55 + Math.random() * 0.35), windowEnd - now - 5000));
    }
    const next = new Date(start); next.setHours(next.getHours() + 1);
    return next.getTime() - now + 15000 + Math.random() * 45000;
  }
  // если момент попадает вне активных часов — сдвинуть на ближайшее «утро» + джиттер
  // (пресет с 0/24 не сдвигает никогда: ночная работа разрешена)
  function clampToActiveHours(ts) {
    const d = new Date(ts);
    const h = d.getHours();
    if (h >= RUN.activeFrom && h < RUN.activeTo) return ts;
    const next = new Date(d);
    if (h >= RUN.activeTo) next.setDate(next.getDate() + 1);
    next.setHours(RUN.activeFrom, 0, 0, 0);
    return next.getTime() + Math.random() * 10 * 60000;
  }
  function scheduleNext(delayMs, why) {
    // форсаж НЕ сдвигаем на «утро»: ночной форсаж = долбим сейчас
    const at = (boostRun() || RUN.mode === 'hourly')
      ? (Date.now() + delayMs) : clampToActiveHours(Date.now() + delayMs);
    SS.set('nextAt', String(at));
    SS.set('why', why || 'Сит нет');
    waiting = true;
    status('⏳ ' + (why || 'Жду следующую проверку'), '#ffd27f');
  }
  // v9.4: «назад» во время отсчёта паузы. Chrome часто отдаёт прошлую страницу
  // из кэша (bfcache): без перезагрузки boot() не выполняется, и страница
  // продолжает жить со старым состоянием (waiting=false — проверка шла) — tick
  // начинал прокликивать форму посреди, например, 30-минутной паузы после
  // блока. Поэтому паузу сверяем не с флагом страницы, а с самим расписанием.
  function schedulePending() {
    return parseInt(SS.get('nextAt') || '0', 10) > Date.now();
  }
  function checkerStop(reason, alertKind) {
    // полная остановка (v9.0): ритм, форсаж и разовая проверка гасятся разом —
    // «Остановить проверку» должна делать вкладку тихой, чем бы она ни была занята
    SS.del('on'); SS.del('nextAt'); SS.del('once'); SS.del('boostRun');
    SS.del('deepFill'); // v9.5: маркер глубины не должен переживать стоп
    SS.del('clavePending'); // не тащить флаг Cl@ve в выключенное состояние (v7.27)
    localStorage.removeItem('ck_claveResume'); // не воскрешать проверку после ручного стопа
    waiting = false; stopped = true;
    status(reason, '#ff8888');
    renderStats();
    sendBeat(); // сказать сторожу «я выключен осознанно», чтобы он не звал зря
    if (alertKind) fireAlert(alertKind); // одно спокойное сообщение, без лупа
  }

  // Видимая ошибка страницы (нет опции офиса, нет услуги): не молчим и не
  // зацикливаемся — повтор через unknownRetryMin, три подряд = стоп с голосом.
  function softFail(code, why) {
    snapOnce('fail', code + ' ' + why); // видимая ошибка страницы — снимок для разбора
    if (!driving()) {
      status('⚠️ ' + why + ' — посмотри страницу', '#ffcc66');
      stopped = true;
      return;
    }
    // разовая проверка встретила препятствие — честно останавливаемся:
    // повтор через N минут никто не просил
    if (onceOnly()) { SS.del('once'); checkerStop('⚠️ ' + why + ' — разовая проверка остановлена'); return; }
    recordResult(code, currentTramite().key);
    const unknowns = getUnknowns() + 1;
    setUnknowns(unknowns);
    if (unknowns >= CONFIG.maxConsecutiveUnknown) {
      checkerStop('⚠️ ' + why + ' (' + unknowns + ' раз подряд) — проверка остановлена', 'unknown');
    } else {
      stopped = true;
      scheduleNext(CONFIG.unknownRetryMin * 60000, why + ' (№' + unknowns + ')');
      fireAlert('error', why + ' (№' + unknowns + '), повтор через ' + CONFIG.unknownRetryMin + ' мин');
    }
  }

  // Начать следующую проверку. Если текущий экран — часть потока проверки
  // (экран провинции, форма #sede, развилка Cl@ve, экран заявителя без
  // вердикта) — ОСТАЁМСЯ на месте (v8.2–8.3): tick сам поведёт проверку
  // ВПЕРЁД. Раньше и отсюда жал Volver/replace и уводил с таких экранов
  // НАЗАД, к форме/провинции — и требовалось второе нажатие. На экране
  // «нет сит» приоритет — возврат кнопкой Volver (та же сессия сайта; см.
  // комментарий у findVolverBtn); Volver недоступен — обычный перезаход
  // страницей. Вызывается из heartbeat, onWake и кнопки «Сделать шаг».
  // viaVolver — метка для журнала следующего вердикта (↩), volverAt —
  // детектор «клик не перезагрузил страницу» (жив только если boot() не
  // выполнился; nocitas-ветка тогда перепробует кнопку и уйдёт в перезаход).
  // forceNow (v8.3) — метка «сюда пришли осознанно, веди форму сразу»:
  // boot() на новой странице съедает её и стирает nextAt, иначе расписание
  // прошлой проверки запрело бы tick через waiting — и после Volver форма
  // стояла бы без движения до второго нажатия.
  function startNewCheck() {
    const onForm = !!document.querySelector('#sede');
    const onProvince = !onForm && !!document.body &&
      /provincias disponibles/i.test(document.body.innerText);
    const verdict = onNoCitasVerdict(); // вердикт важнее потока: проверка уже закончена
    const onFork = !onForm && !onProvince && !verdict && hasClaveChoice();
    const onDatos = !onForm && !onProvince && !onFork && !verdict &&
      !!document.querySelector('#txtIdCitado, #txtTelefonoCitado');
    SS.del('deepFill'); // v9.5: новый цикл — глубина считается заново (ШАГ 3
                        // поставит флаг, если цикл опять дойдёт до заявителя)
    if (onForm || onProvince || onFork || onDatos) {
      // остаёмся: важно снять waiting/stopped, иначе tick останется заперт и
      // проверка не начнётся (nextAt кнопкой уже стёрт, таймеров больше нет).
      // Следующий тик (≤1 с) поведёт экран дальше по потоку.
      SS.del('viaVolver');
      waiting = false; stopped = false;
      status(onForm ? '▶️ Проверяю прямо с этой формы…'
        : onProvince ? '▶️ Проверяю с экрана провинции…'
        : onFork ? '▶️ Проверяю с развилки Cl@ve…'
        : '▶️ Продолжаю заполнение заявителя…');
      return;
    }
    if (driving() && !recently('volver', 4000) && verdict) {
      const v = findVolverBtn();
      if (v) {
        status('↩️ Возвращаюсь к поиску сит (Volver)…');
        SS.set('viaVolver', '1');
        SS.set('volverAt', String(Date.now()));
        SS.set('forceNow', '1'); // новая страница поведёт форму сразу, без ритма
        v.click();
        return;
      }
      // вердикт на экране, а кнопку не нашли — перезаход; в журнале будет ↪,
      // чтобы причина была видна без смотреть на экран
      SS.set('volverMiss', '1');
      status('↩️ Volver не нашёл на этом экране — перезаход страницей…', '#ffd27f');
    }
    SS.del('viaVolver');
    SS.set('forceNow', '1'); // и после перезахода — вести форму без ожидания ритма
    location.replace(SS.get('startUrl') || DEFAULT_START);
  }

  // секундный пульс: обратный отсчёт и рестарт цикла.
  // Троттлинг фоновых вкладок (тик раз в минуту) не мешает: сравниваем с абсолютным временем.
  function heartbeat() {
    // v9.4: пока страница переведена — автомат молчит (tick тоже, см. там),
    // а строка статуса занята жёлтым «выключи перевод»: испанские надписи
    // скрипт всё равно не читает. Выключат перевод — статусы вернутся сами.
    if (pageTranslated()) {
      status('🌐 Перевод страницы включён — выключи его: скрипт читает испанские надписи', '#ffd27f');
      wasTranslated = true;
      return;
    }
    if (wasTranslated) {
      wasTranslated = false;
      status('🌐 Перевод выключен — снова вижу экраны сайта', '#8fd498');
    }
    if (!driving()) return;
    const nextAt = parseInt(SS.get('nextAt') || '0', 10);
    if (!nextAt) return;
    if (stepMode()) return; // пошаговый замораживает ритм — не перезагружать самим
    const left = nextAt - Date.now();
    if (left <= 0) {
      // nextAt НЕ удаляем и waiting НЕ снимаем до реальной перезагрузки:
      // если Volver/replace не сработал (Chrome заморозил вкладку и т.п.) —
      // пробуем снова каждые 10 секунд, пока страница не перезагрузится.
      // Новая загрузка страницы сама очистит устаревший nextAt (см. boot).
      if (!recently('cycleReload', 10000)) {
        status('🔄 Начинаю следующую проверку…');
        startNewCheck();
      }
      return;
    }
    if (left > 90 * 60000) {
      // долгая пауза (ночь) — показываем время, а не пугающий отсчёт
      const at = new Date(nextAt);
      const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
      status('💤 Ночная пауза. Следующая проверка в ' + hhmm, '#ffd27f');
      document.title = '💤 до ' + hhmm + ' — cita checker';
      return;
    }
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    const t = mm + ':' + String(ss).padStart(2, '0');
    status('⏳ ' + (SS.get('why') || 'Сит нет') + '. Следующая проверка через ' + t, '#ffd27f');
    document.title = '⏳ ' + t + ' — cita checker';
  }

  // ---------- панель ----------
  let stateEl = null, statusEl = null, statsEl = null, settingsLineEl = null;
  let runBtn = null, boostCapEl = null, boostLabelEl = null;
  let stepToggle = null, stepGoBtn = null, imHereBtn = null;
  function status(msg, color) {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || '#fff'; }
  }
  // строка режима (●): v9.2 — живёт в секции «Ритмичная проверка», рядом с
  // кнопкой старт/стоп; наверху панели осталась только строка активности
  function renderState() {
    if (stateEl) {
      let txt, color;
      if (foundMode()) { txt = '● СИТЫ НАЙДЕНЫ — доделываем вместе'; color = '#7CFC00'; }
      else if (stepMode()) { txt = '● Пошаговый режим — ритм заморожен'; color = '#e67e22'; }
      else if (boostRun()) { txt = '● Форсаж: каждые ' + RUN.boostSec + ' сек'; color = '#e67e22'; }
      else if (rhythmOn()) { txt = '● Ритмичная проверка идёт'; color = '#7CFC00'; }
      else if (onceMode()) { txt = '● Разовая проверка…'; color = '#2980b9'; }
      else { txt = '● Проверка выключена'; color = '#ff8888'; }
      stateEl.textContent = txt;
      stateEl.style.color = color;
    }
    if (runBtn) {
      const on = rhythmOn() || boostRun(); // v9.3: стоп виден и когда цикл идёт форсажным темпом
      runBtn.textContent = on ? 'Остановить проверку' : 'Запустить проверку';
      runBtn.style.background = on ? '#a93226' : '#2980b9';
    }
    if (boostCapEl) boostCapEl.style.display = (rhythmOn() && boostMode()) ? 'block' : 'none';
    if (boostLabelEl)
      boostLabelEl.textContent = 'Форсаж — ускоренная проверка каждые ' + RUN.boostSec + ' сек (интервал — в настройках форсажа)';
    if (stepToggle) {
      const s = stepMode();
      stepToggle.textContent = s ? 'Выключить пошаговый режим' : 'Включить пошаговый режим';
      stepToggle.style.background = s ? '#a93226' : '#2980b9';
      if (stepGoBtn) stepGoBtn.style.display = s ? 'block' : 'none';
    }
  }
  function renderStats() {
    if (statsEl) {
      const last = lastResult();
      const lastTxt = last
        ? new Date(last.t).toTimeString().slice(0, 5) + ' ' + (LOG_LABELS[last.s] ? LOG_LABELS[last.s][1] : last.s)
        : '—';
      statsEl.textContent =
        'сегодня: ' + todayCount() + ' (блоков: ' + todayBlocks() + ') | последняя: ' + lastTxt;
    }
    if (settingsLineEl) {
      const helper = helperOk === null ? '⚪️' : helperOk ? '🟢' : '🔴';
      // v9.2: без офиса (выбран селектором выше), без версии (переехала в
      // приписку внизу) и без «форсаж» (виден строкой режима и галочкой)
      settingsLineEl.textContent = settingsSummary(false) + ' · голос: ' + helper;
    }
    renderState();
  }
  function mkBtn(label, bg) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'width:100%;padding:6px;border:0;border-radius:6px;cursor:pointer;' +
      'font-weight:600;color:#fff;margin-top:5px;background:' + bg;
    return b;
  }
  // v9.3: гашение кнопок сохранения — активны, только когда есть что сохранить
  // (изменила значения / ввела имя). off=true: полупрозрачная и не кликается.
  function setDim(btn, off) {
    btn.disabled = off;
    btn.style.opacity = off ? '.45' : '1';
    btn.style.cursor = off ? 'default' : 'pointer';
  }
  // Общий стиль чекбокс-строк панели (label). CSS сайта стилизует тег label
  // под свои формы (сжимает по ширине) — панель живёт внутри той же страницы,
  // поэтому глушим чужую ширину и ставим свою: строка на всю ширину панели.
  const checkRowCss = 'display:flex;gap:6px;align-items:flex-start;margin-top:4px;' +
    'font-size:11px;line-height:1.3;cursor:pointer;' +
    'width:100%;max-width:none;float:none;box-sizing:border-box';
  function panel() {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:2147483647;background:#111;color:#fff;' +
      'font:13px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:8px;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.5);max-width:330px;' + // шире, чтобы строка журнала «ДД.ММ ЧЧ:ММ · сит нет: huellas, форма» влезала без переноса
      'max-height:92vh;overflow-y:auto'; // прокрутка — чтобы «Сохранить» всегда был виден
    // v9.2: наверху — строка активности (бывшая «вторая») и статистика;
    // приписка «кто что делает» с версией — внизу панели (как до 9.2).
    // Строка режима (●) живёт в секции «Ритмичная проверка».
    statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-weight:600;margin-bottom:4px';
    box.appendChild(statusEl);
    statsEl = document.createElement('div');
    statsEl.style.cssText = 'font-size:11px;color:#fff;margin-bottom:2px;white-space:pre-line';
    box.appendChild(statsEl);

    // заголовок секции панели (макет v9.0: «Офис…», «Ритмичная проверка», «Общие»)
    function sectionTitle(text) {
      const d = document.createElement('div');
      d.style.cssText = 'margin-top:8px;padding-top:6px;border-top:1px solid #333;' +
        'font-size:10px;letter-spacing:.4px;text-transform:uppercase;opacity:.55';
      d.textContent = text;
      return d;
    }

    // сворачиваемые разделы: открыт один — остальные закрыты
    const collapsibles = [];
    function openOnly(form) {
      for (const f of collapsibles) f.style.display = 'none';
      if (form) form.style.display = 'block';
    }
    function toggleSettings(form) {
      const wasOpen = form.style.display !== 'none';
      openOnly(null);
      if (!wasOpen) form.style.display = 'block';
    }

    // v9.2 (аккордеон): каждая форма живёт сразу под СВОЕЙ кнопкой, а не одним
    // блоком внизу панели. Контейнеры объявляем заранее — они вставляются в DOM
    // раньше, чем заполняются полями ниже по коду. Верхней полосы у форм нет —
    // серые разделители стоят только там, где делят смысловые блоки.
    const settingsForm = document.createElement('div'); // «Мои данные»
    const searchForm = document.createElement('div');   // «Настройки поиска»
    const rhythmForm = document.createElement('div');   // «Настроить ритм»
    const boostForm = document.createElement('div');    // «Настройки форсажа»
    settingsForm.style.cssText = 'display:none;margin-top:2px';
    searchForm.style.cssText = 'display:none;margin-top:2px';
    rhythmForm.style.cssText = 'display:none;margin-top:2px';
    boostForm.style.cssText = 'display:none;margin-top:2px';
    // серый разделитель внутри формы
    function formDivider() {
      const d = document.createElement('div');
      d.style.cssText = 'border-top:1px solid #333;margin-top:8px';
      return d;
    }

    // ---- секция «Офис, который проверяем» ----
    box.appendChild(sectionTitle('Офис, который проверяем'));

    // Офис на главной панели (переехал из «Настроек поиска»): выбор применяется
    // к СЛЕДУЮЩЕЙ проверке — уже открытую форму сайта он не меняет
    const mainOfficeSel = document.createElement('select');
    mainOfficeSel.style.cssText = 'width:100%;margin-top:4px;padding:5px 6px;border:1px solid #444;' +
      'border-radius:5px;background:#222;color:#fff;font:12px system-ui,sans-serif;box-sizing:border-box';
    for (const o of OFFICES) {
      const op = document.createElement('option');
      op.value = o.key;
      op.textContent = o.label;
      mainOfficeSel.appendChild(op);
    }
    mainOfficeSel.value = currentOffice().key;
    mainOfficeSel.onchange = () => {
      DATA.office = mainOfficeSel.value;
      store.set('ck_data', JSON.stringify(DATA));
      SS.del('tramIdx'); // начать чередование услуг заново
      const o = currentOffice();
      status('🏥 Офис: ' + (o.key ? o.label : 'вся провинция') + ' — проверю со следующего захода', '#7CFC00');
      renderStats();
    };
    box.appendChild(mainOfficeSel);

    // «Проверить сейчас» (v9.0 — имя снова честное): ровно ОДИН цикл до
    // вердикта, цикл НЕ включает — даже если стоит галочка форсажа (v9.3:
    // галочка задаёт темп только «Запустить проверку»). Цикл уже идёт — это
    // внеочередная проверка, дальше цикл продолжит своим темпом; всё выключено
    // — после вердикта машина замолчит сама. УМНАЯ (v8.2–8.3): с экранов потока (форма,
    // провинция, развилка Cl@ve, заявитель) не уходит — ведёт проверку прямо
    // там; с экрана «нет сит» возвращается кнопкой Volver (та же сессия —
    // блоков нет), страница после Volver ведёт форму сразу (forceNow).
    // Нажатие — явное «работай сейчас»: снимаем пошаговый режим,
    // иначе tick остался бы заперт и кнопка молча не делала бы ничего.
    const nowBtn = mkBtn('Проверить сейчас', '#16a085');
    nowBtn.onclick = () => {
      if (!dataReady()) {
        status('⚙️ Сначала заполни свои данные', '#ffcc66');
        openOnly(settingsForm);
        return;
      }
      const start = SS.get('startUrl') ||
        (/\/citar\?p=/.test(location.href) ? location.href : DEFAULT_START);
      SS.set('startUrl', start);
      SS.del('nextAt'); SS.del('found');
      SS.del('step');
      waiting = false; stopped = false;
      // v9.3: «Проверить сейчас» — ВСЕГДА одна проверка, никогда не запускает
      // бесконечный цикл (галочка форсажа тут ни при чём: она задаёт темп
      // только циклу от «Запустить проверку»). Цикл уже идёт — это внеочередная
      // проверка, дальше цикл продолжит своим темпом (ритм или форсаж).
      if (rhythmOn() || boostRun()) SS.del('once');
      else SS.set('once', '1'); // ничего не идёт: ровно один цикл до вердикта
      renderState();
      startNewCheck();
    };
    box.appendChild(nowBtn);

    // ---- секция «Ритмичная проверка» ----
    box.appendChild(sectionTitle('Ритмичная проверка'));
    // v9.2: строка режима (●) живёт тут — над кнопкой старт/стоп. Выжимки
    // настроек темпа больше нет: всё читается в «Настроить ритм».
    stateEl = document.createElement('div');
    stateEl.style.cssText = 'font-size:11px;font-weight:600;margin-top:2px';
    box.appendChild(stateEl);
    runBtn = mkBtn('Запустить проверку', '#2980b9');
    runBtn.onclick = () => {
      // v9.3: останавливает ЛЮБОЙ бесконечный цикл — ритм или форсаж
      if (rhythmOn() || boostRun()) {
        checkerStop('⏹ Проверка остановлена'); // полная тишина: ритм, форсаж, разовая
        stopAlertLoop();
      } else if (!dataReady()) {
        status('⚙️ Сначала заполни свои данные', '#ffcc66');
        openOnly(settingsForm);
      } else {
        const start = /\/citar\?p=/.test(location.href) ? location.href : DEFAULT_START;
        SS.set('on', '1'); SS.set('startUrl', start);
        SS.del('nextAt'); SS.del('found'); SS.del('once');
        SS.del('step');
        if (boostMode()) SS.set('boostRun', '1'); // галочка стоит — старт сразу в форсаже
        resetErrors();
        // версия в записи CONFIG — по журналу видно, какая версия работала в отрезок
        recordResult('CONFIG', 'v' + SCRIPT_VER + ' · ' + settingsSummary());
        location.replace(start); // чистый старт цикла
      }
      renderStats();
    };
    box.appendChild(runBtn);

    // Галочка форсажа (v9.2 — под «Запустить проверку», к режиму темпа):
    // задаёт темп БЕСКОНЕЧНОМУ циклу от «Запустить проверку» — ритм
    // игнорируется, проверки идут каждые boostSec сек. На «Проверить сейчас»
    // не влияет: та всегда одна проверка. Интервал — в отдельном блоке форсажа.
    const boostRow = document.createElement('label');
    boostRow.style.cssText = checkRowCss + ';margin-top:6px;color:#fff';
    const boostCb = document.createElement('input');
    boostCb.type = 'checkbox';
    boostCb.checked = boostMode();
    boostCb.style.cssText = 'margin:1px 0 0;flex:none';
    boostRow.appendChild(boostCb);
    boostLabelEl = document.createElement('span');
    boostLabelEl.style.cssText = 'margin:0';
    boostRow.appendChild(boostLabelEl);
    boostCb.onchange = () => {
      if (boostCb.checked) {
        SS.set('boost', '1');
        if (rhythmOn()) { // ритм шёл — переключаем его темп на форсаж сразу
          SS.set('boostRun', '1');
          SS.del('nextAt');
          waiting = false; stopped = false;
          status('🔥 Форсаж: проверяю каждые ' + RUN.boostSec + ' сек (ритм на паузе)', '#ffd27f');
        } else {
          status('🔥 Форсаж: каждые ' + RUN.boostSec + ' сек — так будет ходить «Запустить проверку»', '#ffd27f');
        }
      } else {
        SS.del('boost'); SS.del('boostRun');
        if (rhythmOn() && (waiting || stopped)) // ритм возвращается к своему темпу
          scheduleNext(jitteredDelayMs(), 'Ритм возобновлён');
      }
      renderState();
    };
    box.appendChild(boostRow);

    // подпись: ритм формально идёт, но его темп подменён форсажем
    boostCapEl = document.createElement('div');
    boostCapEl.style.cssText = 'display:none;margin-top:4px;font-size:11px;color:#ffd27f';
    boostCapEl.textContent = 'Ритмичная проверка на паузе из-за режима форсаж';
    box.appendChild(boostCapEl);

    const boostOpenBtn = mkBtn('Настройки форсажа', '#7f8c8d');
    boostOpenBtn.onclick = () => toggleSettings(boostForm);
    box.appendChild(boostOpenBtn);
    box.appendChild(boostForm);

    const rhythmOpenBtn = mkBtn('Настроить ритм проверки', '#7f8c8d');
    rhythmOpenBtn.onclick = () => { fillRhythmInputs(); toggleSettings(rhythmForm); };
    box.appendChild(rhythmOpenBtn);
    box.appendChild(rhythmForm); // v9.2: форма открывается прямо под своей кнопкой

    // ---- секция «Общие настройки» ----
    box.appendChild(sectionTitle('Общие настройки'));
    settingsLineEl = document.createElement('div');
    settingsLineEl.style.cssText = 'font-size:11px;color:#fff;margin-bottom:2px;white-space:pre-line'; // v9.2: явный белый, не серый
    box.appendChild(settingsLineEl);

    const searchBtn = mkBtn('Изменить настройки поиска', '#7f8c8d');
    searchBtn.onclick = () => toggleSettings(searchForm);
    box.appendChild(searchBtn);
    box.appendChild(searchForm); // v9.2: аккордеон — форма под своей кнопкой
    const dataBtn = mkBtn('Изменить мои данные', '#7f8c8d');
    dataBtn.onclick = () => toggleSettings(settingsForm);
    box.appendChild(dataBtn);
    box.appendChild(settingsForm); // v9.2: аккордеон — форма под своей кнопкой

    // Пошаговый режим (v9.0 — с главной панели): замораживает ритм, как форсаж;
    // ✋-паузы больше нет — «не трогай сайт» это и есть пошаговый
    stepToggle = mkBtn('Включить пошаговый режим', '#2980b9');
    stepToggle.onclick = () => {
      if (stepMode()) SS.del('step');
      else { SS.set('step', '1'); status('👣 Пошагово: ритм заморожен — жми «Следующий шаг»', '#ffd27f'); }
      renderState();
    };
    box.appendChild(stepToggle);
    stepGoBtn = mkBtn('Следующий шаг', '#e67e22');
    stepGoBtn.onclick = () => {
      stopped = false; waiting = false;
      const nextAt = parseInt(SS.get('nextAt') || '0', 10);
      if (nextAt) { SS.del('nextAt'); startNewCheck(); return; }
      forcingStep = true;
      try { tick(); } finally { forcingStep = false; }
    };
    box.appendChild(stepGoBtn);

    // На страницу выбора офиса: смена офиса/услуги руками (настройки действуют
    // на НОВУЮ проверку, уже открытую форму они не меняют)
    const firstBtn = mkBtn('Перейти на страницу выбора офиса', '#16a085');
    firstBtn.onclick = () => {
      location.replace(SS.get('startUrl') || DEFAULT_START);
    };
    box.appendChild(firstBtn);

    const testBtn = mkBtn('Проверить голосовое оповещение', '#b9770e');
    testBtn.onclick = () => fireAlert('test');
    box.appendChild(testBtn);

    // ---- «Мои данные» и «Настройки поиска»: два раздела (v7.31) ----
    // Раньше всё было одной длинной формой — панель приходилось листать.
    // v9.2: формы открываются каждая под своей кнопкой (аккордеон), у каждого
    // поля — видимая подпись (серый placeholder нечитаем). Хранение прежнее:
    // Tampermonkey, переживает обновления.
    // Поле с подписью: label над input'ом, оба на всю ширину панели
    const inputCss = 'width:100%;margin-top:4px;padding:4px 6px;border:1px solid #444;' +
      'border-radius:5px;background:#222;color:#fff;font:12px system-ui,sans-serif;box-sizing:border-box';
    function mkField(form, labelText, value) {
      const lab = document.createElement('div');
      lab.style.cssText = 'margin-top:6px;font-size:11px;color:#fff';
      lab.textContent = labelText;
      form.appendChild(lab);
      const inp = document.createElement('input');
      inp.value = value;
      inp.style.cssText = inputCss;
      form.appendChild(inp);
      return inp;
    }
    const fields = [
      ['docType', 'Документ: NIE или PASSPORT'],
      ['docNumber', 'Номер документа (NIE)'],
      ['fullName', 'Имя и фамилия как в документе'],
      ['birthYear', 'Год рождения'],
      ['country', 'Страна (как в списке сайта)'],
      ['phone', 'Телефон (без +34)'],
      ['email', 'Email'],
    ];
    const inputs = {};
    for (const [key, label] of fields) {
      inputs[key] = mkField(settingsForm, label, DATA[key] || ''); // v9.2: подпись над полем
    }
    const saveDataBtn = mkBtn('Сохранить данные', '#27ae60');
    // v9.3: активна, только когда хоть одно поле разошлось с сохранёнными
    // данными (docType сравниваем в той же нормализации, что и сохранение)
    const normDocType = (v) => ((v || 'NIE').toUpperCase() === 'PASSPORT' ? 'PASSPORT' : 'NIE');
    function dataDirty() {
      for (const [key] of fields) {
        let v = String(inputs[key].value).trim();
        if (key === 'docType') v = normDocType(v);
        if (v !== String(key === 'docType' ? normDocType(DATA[key]) : (DATA[key] || ''))) return true;
      }
      return false;
    }
    function updateSaveDataBtn() { setDim(saveDataBtn, !dataDirty()); }
    for (const [key] of fields) inputs[key].addEventListener('input', updateSaveDataBtn);
    updateSaveDataBtn(); // при создании: ничего не меняли — погашена
    saveDataBtn.onclick = () => {
      for (const [key] of fields) DATA[key] = inputs[key].value.trim();
      DATA.docType = (DATA.docType || 'NIE').toUpperCase() === 'PASSPORT' ? 'PASSPORT' : 'NIE';
      store.set('ck_data', JSON.stringify(DATA));
      updateSaveDataBtn(); // поля = данные → кнопка гаснет
      settingsForm.style.display = 'none';
      status(dataReady() ? '✅ Данные сохранены' : '⚙️ Не все поля заполнены', dataReady() ? '#7CFC00' : '#ffcc66');
      renderStats();
    };
    settingsForm.appendChild(saveDataBtn);
    settingsForm.appendChild(formDivider()); // делит «Сохранить данные» и «Пошаговый режим» (v9.2)

    // какие услуги проверять (раздел «Настройки поиска»)
    const tramTitle = document.createElement('div');
    tramTitle.style.cssText = 'margin-top:7px;font-size:11px;color:#fff';
    tramTitle.textContent = 'Какие услуги проверять:';
    searchForm.appendChild(tramTitle);
    const tramChecks = {};
    for (const t of TRAMITES) {
      const row = document.createElement('label');
      row.style.cssText = checkRowCss + ';color:#fff';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (DATA.tramites || []).includes(t.key);
      cb.style.cssText = 'margin:1px 0 0';
      tramChecks[t.key] = cb;
      row.appendChild(cb);
      row.appendChild(document.createTextNode(t.label));
      searchForm.appendChild(row);
    }

    // офис проверять переехал на главную панель (v9.0) — тут только услуги и Cl@ve

    // Способ входа — взаимоисключающий выбор. Сертификат возможен только
    // внутри Cl@ve, поэтому отдельного состояния «сертификат без Cl@ve» нет.
    const sinClaveRow = document.createElement('label');
    sinClaveRow.style.cssText = checkRowCss + ';margin-top:6px;border-top:1px solid #333;padding-top:6px;color:#fff';
    const sinClaveRadio = document.createElement('input');
    sinClaveRadio.type = 'radio';
    sinClaveRadio.name = 'ck-clave-mode';
    sinClaveRadio.checked = !DATA.useClave;
    sinClaveRadio.style.cssText = 'margin:1px 0 0';
    sinClaveRow.appendChild(sinClaveRadio);
    sinClaveRow.appendChild(document.createTextNode('Без Cl@ve'));
    searchForm.appendChild(sinClaveRow);

    const claveRow = document.createElement('label');
    claveRow.style.cssText = checkRowCss + ';margin-top:4px;color:#fff';
    const claveRadio = document.createElement('input');
    claveRadio.type = 'radio';
    claveRadio.name = 'ck-clave-mode';
    claveRadio.checked = !!DATA.useClave;
    claveRadio.style.cssText = 'margin:1px 0 0';
    claveRow.appendChild(claveRadio);
    claveRow.appendChild(document.createTextNode('Через Cl@ve (сайт обещает лучший доступ)'));
    searchForm.appendChild(claveRow);

    const certRow = document.createElement('label');
    certRow.style.cssText = checkRowCss + ';margin-top:4px;color:#fff';
    const certCb = document.createElement('input');
    certCb.type = 'checkbox';
    certCb.checked = !!DATA.claveCert;
    certCb.style.cssText = 'margin:1px 0 0';
    certRow.appendChild(certCb);
    certRow.appendChild(document.createTextNode('Сертификатом в Chrome (eIdentifier)'));
    searchForm.appendChild(certRow);
    const certHint = document.createElement('div');
    certHint.style.cssText = 'margin:2px 0 0;font-size:10px;line-height:1.3;color:#fff';
    certHint.textContent = 'Сняли галочку — другой способ появится после завершения сессии Chrome.';
    searchForm.appendChild(certHint);
    function renderClaveControls() {
      const usingClave = claveRadio.checked;
      certRow.style.display = usingClave ? 'flex' : 'none';
      certHint.style.display = usingClave ? 'block' : 'none';
      if (!usingClave) certCb.checked = false;
    }
    renderClaveControls();

    const saveSearchBtn = mkBtn('Сохранить настройки', '#27ae60');
    // v9.3: активна, только когда хоть одна галочка разошлась с сохранёнными
    function searchDirty() {
      for (const t of TRAMITES)
        if (tramChecks[t.key].checked !== (DATA.tramites || []).includes(t.key)) return true;
      if (claveRadio.checked !== !!DATA.useClave) return true;
      if (claveRadio.checked && certCb.checked !== !!DATA.claveCert) return true;
      return false;
    }
    function updateSaveSearchBtn() { setDim(saveSearchBtn, !searchDirty()); }
    for (const t of TRAMITES) tramChecks[t.key].addEventListener('change', updateSaveSearchBtn);
    sinClaveRadio.addEventListener('change', () => { renderClaveControls(); updateSaveSearchBtn(); });
    claveRadio.addEventListener('change', () => { renderClaveControls(); updateSaveSearchBtn(); });
    certCb.addEventListener('change', updateSaveSearchBtn);
    updateSaveSearchBtn(); // при создании: ничего не меняли — погашена
    saveSearchBtn.onclick = () => {
      DATA.tramites = TRAMITES.filter((t) => tramChecks[t.key].checked).map((t) => t.key);
      DATA.useClave = claveRadio.checked;
      DATA.claveCert = DATA.useClave && certCb.checked;
      if (!DATA.tramites.length) { DATA.tramites = ['huellas']; tramChecks.huellas.checked = true; }
      store.set('ck_data', JSON.stringify(DATA));
      updateSaveSearchBtn(); // галочки = данные → кнопка гаснет
      SS.del('tramIdx'); // начать чередование с первой отмеченной
      searchForm.style.display = 'none';
      status('✅ Настройки поиска сохранены', '#7CFC00');
      renderStats();
    };
    searchForm.appendChild(saveSearchBtn);
    searchForm.appendChild(formDivider()); // делит «Сохранить настройки» и «Изменить мои данные» (v9.2)

    // ---- «Настроить ритм проверки» (v8.0): то, что раньше было зашито в коде ----
    // Интервалы, горячие часы, ночная пауза и потолок окна редактируются
    // полями; готовые наборы — пресетами выбранного режима. Свои варианты
    // сохраняются кнопкой и живут в Tampermonkey рядом с данными. Форсаж
    // настраивается отдельно ниже.
    // v9.2: контейнер rhythmForm и inputCss объявлены выше (аккордеон).
    // Выбор пресета в списке применяется СРАЗУ (кнопки «Применить пресет»
    // больше нет); правка любого поля, расходящаяся с пресетом, переводит
    // список на «(свои значения)».

    const rhythmInputs = {};
    const modeTitle = document.createElement('div');
    modeTitle.style.cssText = 'margin-top:6px;font-size:11px;color:#fff';
    modeTitle.textContent = 'Способ планировать проверки:';
    rhythmForm.appendChild(modeTitle);
    const modeSel = document.createElement('select');
    modeSel.style.cssText = inputCss;
    for (const [value, text] of [['interval', 'Интервальный ритм'], ['hourly', 'Часовые окна']]) {
      const op = document.createElement('option'); op.value = value; op.textContent = text; modeSel.appendChild(op);
    }
    rhythmForm.appendChild(modeSel);

    const presetTitle = document.createElement('div');
    presetTitle.style.cssText = 'margin-top:6px;font-size:11px;color:#fff';
    presetTitle.textContent = 'Пресет ритма (выбор применяется сразу):';
    rhythmForm.appendChild(presetTitle);
    const presetSel = document.createElement('select');
    presetSel.style.cssText = inputCss;
    rhythmForm.appendChild(presetSel);
    rhythmForm.appendChild(formDivider()); // граница «пресет | цифры»
    function renderPresetSel() {
      while (presetSel.firstChild) presetSel.removeChild(presetSel.firstChild);
      const allPresets = Object.assign({}, BUILTIN_PRESETS, readCustomPresets());
      for (const name of Object.keys(allPresets)) {
        const p = allPresets[name];
        if ((p.mode || 'interval') !== modeSel.value) continue;
        const op = document.createElement('option');
        op.value = name;
        op.textContent = (BUILTIN_PRESETS[name] ? '★ ' : '') + name;
        presetSel.appendChild(op);
      }
      const own = document.createElement('option');
      own.value = '(свои)';
      own.textContent = '✎ (свои значения)';
      presetSel.appendChild(own);
      presetSel.value = RUN.preset || '(свои)';
      if (presetSel.value !== (RUN.preset || '(свои)')) presetSel.value = '(свои)';
    }
    presetSel.onchange = () => {
      if (presetSel.value === '(свои)') {
        status('✎ Свои значения — правь поля ниже и нажми «Сохранить изменения»', '#bbb');
        return;
      }
      if (applyPreset(presetSel.value)) {
        fillRhythmInputs(); // цифры полей = пресет
        status('✅ Пресет «' + RUN.preset + '» включён', '#7CFC00');
        renderStats();
      }
    };

    // Поля активной стратегии показываются, остальные скрываются.
    const RHYTHM_FIELDS = [
      ['hourlyWindowMin', 'Часовое окно, мин (1–55)'],
      ['hourlyChecks', 'Проверок в окне (1–20; хаотично)'],
      ['intervalRange', 'Интервал, мин (напр. 7 или 7–10)'],
      ['hotHours', 'Горячие часы (необязательно, напр. 6-13)'],
      ['hotIntervalRange', 'Интервал горячих часов, сек (напр. 60 или 60–180)'],
      ['activeHoursRange', 'Время работы проверки (0–24 = всё время)'],
      ['maxPerWindow', 'Макс. проверок за окно'],
      ['windowMin', 'Длина окна, мин'],
      ['lostRetryRange', 'После срыва слотов — перепроверка, сек (напр. 5 или 5–12)'],
    ];
    function mkRhythmField(form, labelText, value) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:5px;width:100%;box-sizing:border-box';
      const inp = document.createElement('input');
      inp.value = value;
      inp.style.cssText = inputCss + ';width:100px;flex:none;margin-top:0'; // время — слева
      row.appendChild(inp);
      const lab = document.createElement('div');
      lab.style.cssText = 'flex:1;font-size:11px;line-height:1.3;color:#fff';
      lab.textContent = labelText;
      row.appendChild(lab);
      form.appendChild(row);
      inp._row = row;
      return inp;
    }
    for (const [key, label] of RHYTHM_FIELDS) {
      if (key === 'maxPerWindow') {
        const protectionTitle = document.createElement('div');
        protectionTitle.style.cssText = 'margin-top:10px;padding-top:7px;border-top:1px solid #333;font-size:11px;color:#fff';
        protectionTitle.textContent = 'Темп и паузы';
        rhythmForm.appendChild(protectionTitle);
      }
      rhythmInputs[key] = mkRhythmField(rhythmForm, label, String(RUN[key]));
    }
    const hourlyKeys = new Set(['hourlyWindowMin', 'hourlyChecks']);
    const intervalKeys = new Set(['intervalRange', 'hotHours', 'hotIntervalRange', 'activeHoursRange']);
    function renderRhythmMode() {
      const hourly = modeSel.value === 'hourly';
      for (const [key] of RHYTHM_FIELDS) {
        if (hourlyKeys.has(key)) rhythmInputs[key]._row.style.display = hourly ? 'flex' : 'none';
        if (intervalKeys.has(key)) rhythmInputs[key]._row.style.display = hourly ? 'none' : 'flex';
      }
    }
    modeSel.onchange = () => { renderPresetSel(); renderRhythmMode(); updateSaveRhythmBtn(); };

    // совпадают ли поля с выбранным пресетом? (v9.2: числа сравниваем как
    // числа — «0,4» и «0.4» одно и то же; горячие часы — как написаны)
    function matchesSelectedPreset() {
      const name = presetSel.value;
      if (name === '(свои)') return true;
      const p = Object.assign({}, BUILTIN_PRESETS, readCustomPresets())[name];
      if (!p) return true;
      if ((p.mode || 'interval') !== modeSel.value) return false;
      for (const [key] of RHYTHM_FIELDS) {
        if (hourlyKeys.has(key) && modeSel.value !== 'hourly') continue;
        if (intervalKeys.has(key) && modeSel.value !== 'interval') continue;
        if (key === 'hotIntervalRange' && !String(p.hotHours || '').trim()) continue;
        if (key === 'intervalRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(p.intervalMinMin, p.intervalMaxMin)) return false;
          continue;
        }
        if (key === 'hotIntervalRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(p.hotIntervalMinSec, p.hotIntervalMaxSec)) return false;
          continue;
        }
        if (key === 'activeHoursRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(p.activeFrom, p.activeTo)) return false;
          continue;
        }
        if (key === 'lostRetryRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(p.lostRetryMinSec, p.lostRetryMaxSec)) return false;
          continue;
        }
        if (key === 'hotHours') {
          if (String(rhythmInputs[key].value).trim() !== String(p[key])) return false;
        } else {
          const x = parseFloat(String(rhythmInputs[key].value).replace(',', '.'));
          const y = parseFloat(String(p[key]).replace(',', '.'));
          if (!(isFinite(x) && isFinite(y) && x === y)) return false;
        }
      }
      return true;
    }
    // правка поля, расходящаяся с пресетом, → список сам показывает «(свои)»
    for (const key of Object.keys(rhythmInputs)) {
      rhythmInputs[key].addEventListener('input', () => {
        if (!matchesSelectedPreset()) presetSel.value = '(свои)';
        updateSaveRhythmBtn(); // есть изменения — «Сохранить изменения» оживает
      });
    }

    // поля → объект с проверкой; null = что-то заполнено неверно
    function collectRhythm() {
      const v = {};
      const num = (key, lo, hi) => {
        const x = parseFloat(String(rhythmInputs[key].value).replace(',', '.'));
        if (!isFinite(x) || x < lo || x > hi) return false;
        v[key] = x;
        return true;
      };
      v.mode = modeSel.value;
      if (v.mode === 'hourly') {
        if (!num('hourlyWindowMin', 1, 55) || !num('hourlyChecks', 1, 20)) return null;
        v.hourlyWindowMin = Math.round(v.hourlyWindowMin); v.hourlyChecks = Math.round(v.hourlyChecks);
      } else {
        const range = parseIntervalRange(rhythmInputs.intervalRange.value, 0.1, 720);
        if (!range) return null;
        v.intervalMinMin = range[0]; v.intervalMaxMin = range[1];
        v.hotHours = rhythmInputs.hotHours.value.trim();
        if (v.hotHours) {
          const hotRange = parseIntervalRange(rhythmInputs.hotIntervalRange.value, 5, 3600);
          if (!hotRange || !parseHotHours(v.hotHours)) return null;
          v.hotIntervalMinSec = hotRange[0]; v.hotIntervalMaxSec = hotRange[1];
        }
        const activeRange = parseIntervalRange(rhythmInputs.activeHoursRange.value, 0, 24);
        if (!activeRange) return null;
        v.activeFrom = Math.round(activeRange[0]); v.activeTo = Math.round(activeRange[1]);
      }
      if (!num('maxPerWindow', 1, 60) || !num('windowMin', 1, 240)) return null;
      v.maxPerWindow = Math.round(v.maxPerWindow);
      const retryRange = parseIntervalRange(rhythmInputs.lostRetryRange.value, 2, 600);
      if (!retryRange) return null;
      v.lostRetryMinSec = retryRange[0]; v.lostRetryMaxSec = retryRange[1];
      return v;
    }
    function fillRhythmInputs() {
      for (const [key] of RHYTHM_FIELDS) {
        rhythmInputs[key].value = key === 'intervalRange'
          ? formatIntervalRange(RUN.intervalMinMin, RUN.intervalMaxMin)
          : key === 'hotIntervalRange'
            ? !String(RUN.hotHours || '').trim()
              ? '' : formatIntervalRange(RUN.hotIntervalMinSec, RUN.hotIntervalMaxSec)
            : key === 'activeHoursRange'
              ? formatIntervalRange(RUN.activeFrom, RUN.activeTo)
              : key === 'lostRetryRange'
                ? formatIntervalRange(RUN.lostRetryMinSec, RUN.lostRetryMaxSec) : String(RUN[key]);
      }
      modeSel.value = RUN.mode || 'interval';
      renderRhythmMode();
      renderPresetSel();
      renderState(); // в подписи галочки форсажа — интервал из RUN.boostSec
      updateSaveRhythmBtn(); // поля = текущий ритм → «Сохранить изменения» гаснет
    }

    // v9.2: «Сохранить изменения» (бывш. «Сохранить ритм»): активна только
    // когда хоть одно поле разошлось с текущим ритмом (RUN) — жать нечего,
    // пока ничего не менялось. Погашена — полупрозрачная и не кликается.
    const saveRhythmBtn = mkBtn('Сохранить изменения', '#27ae60');
    function rhythmDirty() {
      if (modeSel.value !== RUN.mode) return true;
      for (const [key] of RHYTHM_FIELDS) {
        if (key === 'intervalRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(RUN.intervalMinMin, RUN.intervalMaxMin)) return true;
          continue;
        }
        if (key === 'hotIntervalRange') {
          if (!String(RUN.hotHours || '').trim()) {
            if (String(rhythmInputs[key].value).trim()) return true;
            continue;
          }
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(RUN.hotIntervalMinSec, RUN.hotIntervalMaxSec)) return true;
          continue;
        }
        if (key === 'activeHoursRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(RUN.activeFrom, RUN.activeTo)) return true;
          continue;
        }
        if (key === 'lostRetryRange') {
          if (String(rhythmInputs[key].value).trim() !== formatIntervalRange(RUN.lostRetryMinSec, RUN.lostRetryMaxSec)) return true;
          continue;
        }
        if (key === 'hotHours') {
          if (String(rhythmInputs[key].value).trim() !== String(RUN[key])) return true;
        } else {
          const x = parseFloat(String(rhythmInputs[key].value).replace(',', '.'));
          if (!(isFinite(x) && x === RUN[key])) return true;
        }
      }
      return false;
    }
    function updateSaveRhythmBtn() {
      setDim(saveRhythmBtn, !rhythmDirty());
    }
    updateSaveRhythmBtn(); // при создании: поля ещё не меняли — погашены
    // общая команда для верхней (под форсажем) и нижней кнопки сохранения
    function saveRhythmChanges() {
      const v = collectRhythm();
      if (!v) { status('⚠️ Проверь поля ритма (часы пишут как «6-13, 19-23»)', '#ff8888'); return; }
      // v9.2: пресет в списке ещё выбран и цифры ему соответствуют — сохраняем
      // с его именем; любая правка отвалилась на «(свои)» — так и пишем
      const keep = (presetSel.value !== '(свои)' && matchesSelectedPreset()) ? presetSel.value : '(свои)';
      RUN = Object.assign({}, RUN, v, { preset: keep });
      SS.del('boostUntil'); // v9.0: ключ авто-форсажа протух — подчистить
      store.set('ck_run', JSON.stringify(RUN));
      fillRhythmInputs();
      status(keep !== '(свои)' ? '✅ Изменения сохранены — пресет «' + keep + '»' : '✅ Изменения сохранены (свои значения)', '#7CFC00');
      renderStats();
    }
    saveRhythmBtn.onclick = saveRhythmChanges;
    rhythmForm.appendChild(saveRhythmBtn);
    rhythmForm.appendChild(formDivider()); // делит «Сохранить изменения» и блок своего пресета

    const presetNameInp = mkField(rhythmForm, 'Имя для своего пресета', ''); // v9.2: подпись над полем
    const savePresetBtn = mkBtn('Сохранить как пресет', '#27ae60');
    // v9.3: активна, только когда введено имя (цифры могут и совпадать — новое
    // имя и есть то, что сохраняем)
    function updateSavePresetBtn() { setDim(savePresetBtn, !presetNameInp.value.trim()); }
    presetNameInp.addEventListener('input', updateSavePresetBtn);
    updateSavePresetBtn(); // при создании: имя пустое — погашена
    savePresetBtn.onclick = () => {
      const v = collectRhythm();
      if (!v) { status('⚠️ Проверь поля ритма (часы пишут как «6-13, 19-23»)', '#ff8888'); return; }
      const name = presetNameInp.value.trim();
      if (!name) { status('⚠️ Введи имя пресета', '#ff8888'); return; }
      if (BUILTIN_PRESETS[name]) { status('⚠️ Имя занято встроенным пресетом', '#ff8888'); return; }
      const customs = readCustomPresets();
      // v9.3: интервал форсажа — не часть пресета; в RUN он из v попадает
      // (остаётся настройкой), а в сам пресет не записывается
      const presetVals = { ...v };
      customs[name] = presetVals;
      writeCustomPresets(customs);
      RUN = Object.assign({}, RUN, v, { preset: name });
      SS.del('boostUntil');
      store.set('ck_run', JSON.stringify(RUN));
      presetNameInp.value = '';
      updateSavePresetBtn(); // имя очищено → кнопка гаснет
      fillRhythmInputs();
      status('✅ Пресет «' + name + '» сохранён и включён', '#7CFC00');
      renderStats();
    };
    rhythmForm.appendChild(savePresetBtn);
    const delPresetBtn = mkBtn('Удалить свой пресет', '#c0392b');
    delPresetBtn.onclick = () => {
      const name = presetSel.value;
      if (BUILTIN_PRESETS[name] || name === '(свои)') { status('⚠️ Встроенные пресеты не удаляются', '#ff8888'); return; }
      const customs = readCustomPresets();
      if (!customs[name]) return;
      delete customs[name];
      writeCustomPresets(customs);
      if (RUN.preset === name) {
        RUN.preset = '(свои)';
        store.set('ck_run', JSON.stringify(RUN));
      }
      fillRhythmInputs();
      status('🗑 Пресет «' + name + '» удалён', '#bbb');
    };
    rhythmForm.appendChild(delPresetBtn);

    // (пошаговый режим, «Следующий шаг» и проверка голоса переехали на главную
    // панель в «Общие настройки» — v9.0; отдельного раздела отладки больше нет)

    // v9.2: в DOM формы уже вставлены под своими кнопками (аккордеон);
    // здесь только регистрируем их в списке «открыт один — прочие закрыты»
    const boostInput = mkRhythmField(boostForm, 'Форсаж: интервал, сек (10–3600)', String(RUN.boostSec));
    const saveBoostBtn = mkBtn('Сохранить интервал форсажа', '#27ae60');
    function boostDirty() {
      const sec = parseFloat(String(boostInput.value).replace(',', '.'));
      return !(isFinite(sec) && sec === RUN.boostSec);
    }
    function updateSaveBoostBtn() { setDim(saveBoostBtn, !boostDirty()); }
    boostInput.addEventListener('input', updateSaveBoostBtn);
    updateSaveBoostBtn();
    saveBoostBtn.onclick = () => {
      const sec = parseFloat(String(boostInput.value).replace(',', '.'));
      if (!isFinite(sec) || sec < 10 || sec > 3600) { status('⚠️ Интервал форсажа: 10–3600 сек', '#ff8888'); return; }
      RUN.boostSec = sec;
      store.set('ck_run', JSON.stringify(RUN));
      updateSaveBoostBtn();
      renderState();
      status('✅ Интервал форсажа сохранён', '#7CFC00');
    };
    boostForm.appendChild(saveBoostBtn);

    collapsibles.push(settingsForm, searchForm, rhythmForm, boostForm);

    // журнал последних проверок и ошибок
    const logBox = document.createElement('pre');
    logBox.style.cssText =
      'display:none;margin:6px 0 0;padding:6px 8px;max-height:190px;overflow:auto;' +
      'background:#000;border-radius:6px;font:10px/1.6 ui-monospace,Menlo,monospace;' +
      'white-space:pre-wrap;color:#ccc';
    const logBtn = mkBtn('Показать журнал', '#34495e');
    logBtn.onclick = () => {
      if (logBox.style.display === 'none') {
        // формат «ДД.ММ ЧЧ:ММ значок подпись: доп», напр.
        // «29.07 09:07 · сит нет: huellas, сразу, BCN-RAMBLA». Держим ≤~40 символов
        // плашки (см. правило в CLAUDE.md); не режем — длиннее перенесётся (сигнал
        // сократить). Полная история — в journal.log.
        const fmt = (t) => {
          const d = new Date(t);
          return String(d.getDate()).padStart(2, '0') + '.' +
            String(d.getMonth() + 1).padStart(2, '0') + ' ' + d.toTimeString().slice(0, 5);
        };
        const rows = readLog().slice(-25).reverse().map((e) => {
          const [mark, label] = LOG_LABELS[e.s] || ['·', e.s];
          const extra = (e.x && e.s !== 'UNKNOWN') ? ': ' + e.x : '';
          return fmt(e.t) + ' ' + mark + ' ' + label + extra;
        });
        logBox.textContent = rows.join('\n') || 'Журнал пуст';
        logBox.style.display = 'block';
        logBtn.textContent = 'Скрыть журнал';
      } else {
        logBox.style.display = 'none';
        logBtn.textContent = 'Показать журнал';
      }
    };
    box.appendChild(logBtn);
    box.appendChild(logBox);

    imHereBtn = mkBtn('Я тут — хватит звать', '#27ae60');
    imHereBtn.style.display = 'none';
    imHereBtn.onclick = () => stopAlertLoop();
    box.appendChild(imHereBtn);

    // приписка «кто что делает» + версия (v9.2: версия переехала сюда из
    // строки «Общих настроек» — как в старых версиях, в самом низу; текст
    // служебный — серый, как до 9.2)
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:7px;font-size:11px;color:#999';
    hint.textContent = 'Слоты/телефон заполнит само. SMS-код и Confirmar — за тобой. v' + SCRIPT_VER;
    box.appendChild(hint);
    document.body.appendChild(box);
    renderStats();
  }

  // ---------- утилиты формы (как в v3) ----------
  function tooManyP1Submits() {
    const now = Date.now();
    let arr = [];
    try { arr = JSON.parse(sessionStorage.getItem('p1submits') || '[]'); } catch (e) {}
    arr = arr.filter((t) => now - t < 25000);
    sessionStorage.setItem('p1submits', JSON.stringify(arr));
    return arr.length >= 3;
  }
  function noteP1Submit() {
    let arr = [];
    try { arr = JSON.parse(sessionStorage.getItem('p1submits') || '[]'); } catch (e) {}
    arr.push(Date.now());
    sessionStorage.setItem('p1submits', JSON.stringify(arr));
  }
  const lastAction = {};
  function recently(name, ms) {
    const t = lastAction[name] || 0;
    if (Date.now() - t < ms) return true;
    lastAction[name] = Date.now();
    return false;
  }
  function findOption(sel, keywords) {
    if (!sel) return null;
    for (const o of sel.options) {
      const up = (o.text || '').toUpperCase();
      for (const kw of keywords) if (up.includes(kw.toUpperCase())) return o;
    }
    return null;
  }
  function selectOption(sel, opt) {
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function findTramite(keyword) {
    for (const s of document.querySelectorAll('select[id^="tramiteGrupo"]')) {
      for (const o of s.options) {
        if ((o.text || '').toUpperCase().includes(keyword.toUpperCase())) return { sel: s, opt: o };
      }
    }
    return null;
  }
  function setSelectByText(sel, text) {
    if (!sel) return false;
    const t = text.trim().toUpperCase();
    for (const o of sel.options)
      if (o.text.trim().toUpperCase() === t) { sel.value = o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return true; }
    for (const o of sel.options)
      if (o.text.trim().toUpperCase().startsWith(t)) { sel.value = o.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return true; }
    return false;
  }
  function fill(el, val) {
    if (!el) return false;
    el.focus(); el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  // HTML-снимок найденной страницы: доказательство, что это ситы, а не ошибка.
  // <base> добавляем, чтобы стили/картинки подтянулись при открытии онлайн.
  // v7.30: сначала отправляем страницу хелперу — он кладёт файл в snaps/
  // в папке проекта (ИИ-сессия видит находку целиком, не только журнал).
  // Хелпер молчит — по-старому скачиваем в Downloads.
  function buildFoundSnapshot() {
    try {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
      const name = 'cita-found_' + stamp + '.html';
      const head = '<!-- cita-catcher: находка ' + d.toLocaleString('ru') +
        ' — ' + location.href + ' -->\n<base href="' + location.origin + '/">\n';
      return { name: name, html: head + document.documentElement.outerHTML };
    } catch (e) { return null; }
  }
  function downloadSnapshot(s) {
    const blob = new Blob([s.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = s.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  function sendFoundSnapshot() {
    const s = buildFoundSnapshot();
    if (!s) return null;
    gmPost(CONFIG.alertServer + '/htmlsnap?name=' + encodeURIComponent(s.name), s.html, 8000)
      .then(() => { helperOk = true; })
      .catch(() => { helperOk = false; downloadSnapshot(s); }); // хелпер молчит — в Downloads
    return s.name;
  }
  // Человеческое заполнение формы: поля по очереди с паузами, потом действие
  // (обычно отправка). Сайт меряет скорость ввода и при мгновенном заполнении даёт
  // коды «слишком быстрый ввод»: 0017 на форме заявителя, 0018 на телефоне/почте —
  // и ситу мы теряем. Возвращает, сколько миллисекунд займёт весь ввод.
  function fillHumanly(steps, done, minSec, maxSec) {
    // minSec/maxSec — свои паузы для конкретного экрана (телефон быстрее, v7.30);
    // без них — обычный человеческий темп humanFill*
    const lo = (minSec != null) ? minSec : CONFIG.humanFillMinSec;
    const hi = (maxSec != null) ? maxSec : CONFIG.humanFillMaxSec;
    const gap = () => (lo + Math.random() * (hi - lo)) * 1000;
    let t = gap();
    for (const step of steps) {
      const at = t;
      setTimeout(() => { if (!stepMode()) step(); }, at);
      t += gap();
    }
    setTimeout(() => { if (!stepMode()) done(); }, t + gap());
    return t;
  }
  function clickBtn(...candidates) {
    for (const c of candidates) {
      let el = null;
      if (c.startsWith('#')) el = document.querySelector(c);
      else el = [...document.querySelectorAll('input[type=submit],input[type=button],button,a')]
        .find((b) => ((b.value || b.textContent || '').trim().toLowerCase()).includes(c.toLowerCase()));
      if (el) { el.click(); return true; }
    }
    return false;
  }
  function isBlocked() {
    const t = document.body ? document.body.innerText.toLowerCase() : '';
    return t.includes('requested url was rejected') || t.includes('support id') ||
           t.includes('too many request');
  }
  // какой именно блок — короткая метка для журнала (полностью — в README):
  // F5 = «requested URL was rejected», 429 = «too many requests»
  function blockKind() {
    const t = document.body ? document.body.innerText.toLowerCase() : '';
    if (t.includes('too many request')) return '429';
    if (t.includes('requested url was rejected') || t.includes('support id')) return 'F5';
    return '';
  }
  // ближайший кликабельный предок (ссылка/кнопка/onclick), иначе сам элемент
  function clickableAncestor(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const tag = n.tagName;
      if (tag === 'A' || tag === 'BUTTON') return n;
      if (n.getAttribute && (n.getAttribute('onclick') || n.getAttribute('role') === 'button')) return n;
    }
    return el;
  }
  // кликнуть по САМОМУ КОМПАКТНОМУ элементу с текстом reInclude (и без reExclude) —
  // блоки «Presentación con/sin Cl@ve» это не <button>, а кликабельные div/ссылки
  function clickByText(reInclude, reExclude) {
    let best = null, bestLen = 1e9;
    for (const el of document.querySelectorAll('a,button,input[type=submit],input[type=button],div,td,li,span,p')) {
      const t = (el.innerText || el.value || '').trim();
      if (!t || t.length > 200) continue;
      if (!reInclude.test(t)) continue;
      if (reExclude && reExclude.test(t)) continue;
      if (t.length < bestLen) { best = el; bestLen = t.length; }
    }
    if (!best) return false;
    clickableAncestor(best).click();
    return true;
  }
  const hasClaveChoice = () => /presentaci[oó]n\s+sin\s+cl@ve/i.test(
    document.body ? document.body.innerText : '');

  // ---------- возврат через Volver (гипотеза 02.09) ----------
  // Ручной замер Екатерины 01.09: 20 проверок подряд через кнопку Volver
  // (разные офисы, ~10 минут) — ни одного блока, тогда как чекер на перезаходах
  // страницей ловит F5 даже на скромном темпе. Похоже, блоки считает вход в
  // НОВУЮ сессию (полная загрузка стартовой страницы), а не сами проверки:
  // Volver возвращает в поиск сит в той же сессии. Поэтому следующая проверка
  // начинается кликом Volver с экрана-вердикта «нет сит», а перезаход —
  // только если Volver нет (не тот экран / сессия протухла / вёрстка сменилась).
  // Кнопку ищем по надписи, НАЧИНАЮЩЕЙСЯ с «volver» (не подстрокой — «Devolver»
  // и прочее не трогаем). v7.29: сайт рисует кнопки не только input[submit/button]
  // и button/a — бывает input[type=image] (надпись в alt/value) и div-кнопки
  // ([role=button]); раньше такие не находились, и при ВИДИМОЙ кнопке чекер
  // делал полный перезаход (журнал 02.09 16:08: три «сит нет» подряд без ↩).
  // Невидимые элементы пропускаем, настоящие кнопки предпочитаем ссылкам.
  function findVolverBtn() {
    const isVolver = (b) =>
      /^volver\b/i.test((b.value || b.alt || b.title || b.textContent || '').trim());
    const cands = [...document.querySelectorAll(
      'input[type=submit],input[type=button],input[type=image],button,a,[role=button]'
    )].filter(isVolver);
    const visible = cands.filter((b) => b.getClientRects().length);
    const pool = visible.length ? visible : cands;
    return pool.find((b) => b.tagName === 'INPUT' || b.tagName === 'BUTTON') || pool[0];
  }
  function onNoCitasVerdict() {
    const t = document.body ? document.body.innerText.toLowerCase() : '';
    return t.includes('no hay citas disponibles') || t.includes('no hay suficientes citas');
  }

  // ---------- watchdog'и: незнакомая страница и застрявшая доводка ----------
  const pageLoadedAt = Date.now();
  let recognizedOnce = false;   // хоть один известный шаг узнан на этой странице
  let lastKnownStep = '';
  let lastProgressAt = Date.now();
  function noteStep(name) {
    recognizedOnce = true;
    if (name !== lastKnownStep) { lastKnownStep = name; lastProgressAt = Date.now(); }
  }
  function watchdog() {
    if (!driving() || waiting || stopped || alertTimer) return;
    const age = (Date.now() - pageLoadedAt) / 1000;
    if (!recognizedOnce && age > CONFIG.unknownAfterSec) {
      // незнакомая страница (недогрузилась? капча? новая вёрстка?) — fail-safe
      snapOnce('unknown'); // страница целиком в снимки, не 500 символов
      recordResult('UNKNOWN', (document.body ? document.body.innerText : '').slice(0, 500));
      if (foundMode()) {
        status('⚠️ ЦИТЫ ЕСТЬ, но страница незнакомая — доделай вручную!', '#ffcc66');
        stopped = true;
        startAlertLoop('help');
        return;
      }
      if (onceOnly()) { // разовая проверка не просила ретраев незнакомых страниц
        SS.del('once');
        checkerStop('⚠️ Незнакомая страница — разовая проверка остановлена');
        return;
      }
      // сайт бывает флейковым: одиночный сбой — не повод бросать вахту
      const unknowns = getUnknowns() + 1;
      setUnknowns(unknowns);
      if (unknowns >= CONFIG.maxConsecutiveUnknown) {
        checkerStop('⚠️ ' + unknowns + ' незнакомые страницы подряд — проверка остановлена', 'unknown');
      } else {
        stopped = true; // не трогать эту страницу, ждать перезагрузки по таймеру
        scheduleNext(CONFIG.unknownRetryMin * 60000,
          'Незнакомая страница №' + unknowns + ', попробую снова');
        fireAlert('error', 'Незнакомая страница №' + unknowns + ', повтор через ' + CONFIG.unknownRetryMin + ' мин');
      }
      return;
    }
    if (foundMode() && recognizedOnce &&
        (Date.now() - lastProgressAt) / 1000 > CONFIG.stallAfterSec &&
        lastKnownStep !== 'final') {
      status('⚠️ ЦИТЫ ЕСТЬ, но автозаполнение застряло — доделай вручную!', '#ffcc66');
      stopped = true;
      startAlertLoop('help');
    }
  }

  // -------- главный пошаговый автомат: один шаг за тик --------
  let tramMissingSince = 0; // ждём перестройку списка услуг после выбора офиса
  let claveWaitSince = 0;   // с какого момента висим на экране авторизации Cl@ve
  function tick() {
    if (!document.body) return;
    // v9.4: страница переведена — испанские маркеры переписаны, любой клик
    // будет наугад. Автомат молчит, пока перевод не выключат (жёлтая строка
    // в heartbeat). См. pageTranslated.
    if (pageTranslated()) return;
    // v9.4: schedulePending — пауза из самого расписания (см. комментарий
    // там): «назад» из кэша больше не обходит отсчёт после блока/вердикта.
    if (!forcingStep && (stopped || waiting || schedulePending())) return;

    if (isBlocked()) {
      noteStep('blocked');
      if (onceOnly()) { // разовая проверка упёрлась в блок — останавливаемся честно
        SS.del('once');
        checkerStop('⛔️ Блокировка сайта — разовая проверка остановлена');
        return;
      }
      if (driving()) {
        // близко к прошлому блоку (< blockDecayMin) — эскалируем; иначе свежий счёт
        const now = Date.now();
        const chained = getLastBlockAt() && (now - getLastBlockAt() < CONFIG.blockDecayMin * 60000);
        const blocks = chained ? getBlocks() + 1 : 1;
        setBlocks(blocks);
        setLastBlockAt(now);
        recordResult('WAF_BLOCKED', blockKind()); // помечаем тип: F5 WAF или 429 «too many requests»
        bumpTodayBlocks(); // статистика «блоков за сегодня» (v9.1)
        recordHit(); // блокированная попытка тоже обращение к сайту — учитываем в окне
        if (blocks >= CONFIG.maxConsecutiveBlocks) {
          checkerStop('⛔️ ' + blocks + ' блокировок подряд — проверка остановлена', 'stopped');
        } else {
          const idx = Math.min(blocks - 1, CONFIG.backoffMin.length - 1);
          scheduleNext(CONFIG.backoffMin[idx] * 60000,
            'WAF-блок №' + blocks + ', пауза ' + CONFIG.backoffMin[idx] + ' мин');
          fireAlert('error', 'WAF-блок №' + blocks + ', пауза ' + CONFIG.backoffMin[idx] + ' мин');
        }
      } else {
        status('⛔️ Блокировка сайта (WAF). Жми «назад» и пробуй снова.', '#ff8888');
        stopped = true;
      }
      return;
    }

    // Сессия сайта протухла между проверками («Su sesión ha caducado») —
    // это не поломка: просто начинаем проверку с первой страницы
    const earlyText = document.body.innerText.toLowerCase();
    if (earlyText.includes('sesión ha caducado') || earlyText.includes('sesion ha caducado')) {
      noteStep('caducada');
      if (!driving()) {
        // v8.1: проверка не идёт — не кликаем сами; раньше молча жал Aceptar
        if (!recently('caducada', 5000)) status('Сессия протухла — нажми Aceptar сама (проверка выключена)', '#ffcc66');
        return;
      }
      const n = parseInt(SS.get('caducada') || '0', 10) + 1;
      SS.set('caducada', String(n));
      if (n > 3) {
        // рестарт не помогает — не зацикливаемся, пробуем позже
        if (onceOnly()) { SS.del('once'); checkerStop('⚠️ Сессия не восстанавливается — разовая проверка остановлена'); return; }
        recordResult('SESSION_LOOP');
        scheduleNext(CONFIG.unknownRetryMin * 60000, 'Сессия не восстанавливается');
        fireAlert('error', 'Сессия сайта не восстанавливается, повтор через ' + CONFIG.unknownRetryMin + ' мин');
        return;
      }
      if (!recently('caducadaReload', 15000)) {
        status('Сессия сайта протухла — начинаю проверку заново…');
        location.replace(SS.get('startUrl') || DEFAULT_START);
      }
      return;
    }

    // Плановое обслуживание сайта («servicio de cita previa interrumpido /
    // tareas de mantenimiento / no estará disponible unos minutos»). Это НЕ блок,
    // НЕ экран входа Cl@ve и НЕ поломка вёрстки — сайт временно недоступен. Раньше
    // чекер в режиме Cl@ve принимал этот незнакомый экран за экран авторизации и
    // звал зря. Теперь: ждём и пробуем позже, человека не зовём.
    if (driving() && (earlyText.includes('tareas de mantenimiento') ||
        earlyText.includes('cita previa interrumpido') ||
        earlyText.includes('no estará disponible') ||
        earlyText.includes('no estara disponible'))) {
      noteStep('mantenimiento');
      if (onceOnly()) { SS.del('once'); checkerStop('🛠️ Обслуживание сайта — разовая проверка остановлена, повторишь позже'); return; }
      resetTransient();
      claveWaitSince = 0; SS.del('clavePending'); // сбрасываем ложное «жду Cl@ve»
      recordResult('SITE_MAINTENANCE');
      recordHit();
      scheduleNext(CONFIG.unknownRetryMin * 60000,
        'Обслуживание сайта, повтор через ' + CONFIG.unknownRetryMin + ' мин');
      return;
    }

    // Внутренняя ошибка сайта («Se ha producido un error inesperado… inicia
    // de nuevo el proceso», а с сентября — «error en el sistema… inténtelo
    // de nuevo») — сайт сам просит начать заново.
    // Лесенка: мгновенный рестарт ×3 → повторы раз в 7 мин ×3 → стоп с голосом.
    if (earlyText.includes('error inesperado') ||
        earlyText.includes('error en el sistema') ||
        earlyText.includes('inténtelo de nuevo') ||
        earlyText.includes('intentelo de nuevo')) {
      noteStep('siteerror');
      if (!driving()) {
        if (!recently('siteerr', 5000)) status('⚠️ Сайт: внутренняя ошибка — нажми Aceptar', '#ffcc66');
        return;
      }
      const n = parseInt(SS.get('siteerr') || '0', 10) + 1;
      SS.set('siteerr', String(n));
      if (n > 3) {
        softFail('SITE_ERROR', 'Сайт: внутренняя ошибка не уходит');
        return;
      }
      recordResult('SITE_ERROR', 'мгновенный рестарт №' + n);
      if (n === 1) fireAlert('error', 'Сайт: внутренняя ошибка, перезапускаюсь');
      if (!recently('siteerrReload', 15000)) {
        status('Сайт: внутренняя ошибка — начинаю заново (№' + n + ')…');
        location.replace(SS.get('startUrl') || DEFAULT_START);
      }
      return;
    }

    // Страница выбора провинции («PROVINCIAS DISPONIBLES», index.html). Сюда
    // можно вывалиться кнопкой Volver с экрана-вердикта или возвратом из Cl@ve:
    // на ней нет ни #sede, ни вердикта — раньше она считалась «незнакомой» и в
    // режиме Cl@ve вешала чекер на «жду авторизацию». Теперь сами выбираем
    // BARCELONA и жмём Acepto — сессия сохраняется, перезаход страницей не нужен.
    if (driving() && /provincias disponibles/i.test(earlyText)) {
      noteStep('province');
      claveWaitSince = 0; SS.del('clavePending'); // это не экран авторизации
      const pb = parseInt(SS.get('provBounce') || '0', 10);
      if (pb > 4) { softFail('UNKNOWN', 'зациклился выбор провинции'); return; }
      const sel = document.querySelector('select');
      if (sel && setSelectByText(sel, 'BARCELONA')) {
        if (recently('provinceSel', 60000)) {
          // выбор сделан прошлым тиком — теперь жмём Acepto (отдельный тик,
          // чтобы сайт успел переварить выбор); счётчик отскоков +1 за попытку
          if (!recently('provinceGo', 8000)) {
            SS.set('provBounce', String(pb + 1));
            status('Выбор провинции — жму Acepto и продолжаю…');
            clickBtn('aceptar', 'acepto');
          }
        } else status('Экран выбора провинции — выбираю BARCELONA…');
        return;
      }
      // селекта нет или BARCELONA в нём нет — перезаход страницей (тоже отскок)
      if (!recently('provinceReload', 60000)) {
        SS.set('provBounce', String(pb + 1));
        location.replace(SS.get('startUrl') || DEFAULT_START);
      }
      return;
    }

    // ШАГ 1 — выбор офиса и услуги
    const sede = document.querySelector('#sede');
    if (sede) {
      // v8.1/v9.0: проверка НЕ идёт — первую страницу не ведём. Раньше скрипт
      // сам начинал проверку (офис → услуга → Aceptar → …до вердикта) при любом
      // открытии стартовой страницы — выглядело как «проверка сама включилась».
      // Автозаполнение глубоких экранов (NIE/телефон, если дошла сама) остаётся.
      // «Следующий шаг» (пошаговая отладка) по-прежнему работает по кнопке.
      if (!driving() && !foundMode() && !forcingStep) {
        status('📡 Проверка выключена — страницу не трогаю', '#bbb');
        return;
      }
      noteStep('step1');
      SS.del('caducada'); // форма открылась — рестарты после протухшей сессии обнуляем
      SS.del('provBounce'); // прошли выбор провинции — счётчик отскоков чист
      if (tooManyP1Submits()) {
        status('⚠️ Первый экран не пропускает. Проверь данные/выбери вручную, я на паузе.', '#ffcc66');
        stopped = true;
        if (driving()) checkerStop('⚠️ Первый экран зациклился — проверка остановлена', 'unknown');
        return;
      }
      const office = currentOffice();
      const wantOffice = findOption(sede, office.key ? [office.key] : ['CUALQUIER']);
      if (!wantOffice) {
        softFail('OFFICE_MISSING', office.short || 'CUALQUIER');
        return;
      }
      if (sede.value !== wantOffice.value) {
        status('Выбираю офис: ' + (office.key ? office.label : 'Cualquier oficina'));
        selectOption(sede, wantOffice);
        return; // следующий тик проверит список услуг
      }
      const tram = findTramite(currentTramite().keyword);
      if (!tram) {
        // список услуг перестраивается после выбора офиса — даём ему до 8 секунд
        if (!tramMissingSince) { tramMissingSince = Date.now(); return; }
        if (Date.now() - tramMissingSince < 8000) return;
        // услуги нет и после ожидания — это ошибка, о которой надо знать
        softFail('TRAMITE_MISSING', 'Услуга «' + currentTramite().key + '» не найдена в списке');
        return;
      }
      tramMissingSince = 0;
      if (tram.sel.value !== tram.opt.value) {
        status('Выбираю услугу (' + currentTramite().key + ')…');
        selectOption(tram.sel, tram.opt);
        return; // дать сайту «устаканиться» перед сабмитом
      }
      if (tram && tram.sel.value === tram.opt.value) {
        if (!recently('aceptar', 5000)) {
          status('Жму «Aceptar»…');
          noteP1Submit();
          clickBtn('#btnAceptar', 'aceptar');
        }
      }
      return;
    }

    // Слотов нет. «no hay citas disponibles» — это ВЕРДИКТ сайта, слотов нет,
    // независимо от того, есть на странице форма или нет. На авторизованной
    // Cl@ve-странице сайт пишет «no hay citas» И показывает форму, НО подпись у неё
    // «Si desea consultar o anular una cita, rellene…» — это форма посмотреть/
    // отменить СУЩЕСТВУЮЩУЮ запись, а не получить новую. Раньше тут стояло
    // `&& !#txtIdCitado`, из-за чего на этом экране чекер зря лез заполнять форму
    // и получал 0017. Теперь: увидели «no hay citas» → «сит нет», форму не трогаем.
    const bodyText = document.body.innerText.toLowerCase();
    if (bodyText.includes('no hay citas disponibles') ||
        bodyText.includes('no hay suficientes citas')) {
      noteStep('nocitas');
      if (foundMode() && driving()) {
        // слоты были и испарились на полпути: окно часто возвращается
        // (сорванные брони отпадают) — продолжаем охоту на той же услуге,
        // а человека зовём один раз, чтобы был рядом к капче
        snapOnce('lost', currentTramite().key); // на каком экране сгорели ситы
        recordResult('SLOTS_LOST', currentTramite().key);
        recordHit();
        SS.del('found');
        SS.del('clavePending'); // проверка завершена — флаг Cl@ve не переживает её (v7.27)
        fireAlert('help');
        // мгновенная перепроверка: сорванный слот часто тут же возвращается,
        // ждать обычный ритм — упустить окно возврата (интервал — в настройках ритма)
        const lostRetry = (RUN.lostRetryMinSec +
          Math.random() * (RUN.lostRetryMaxSec - RUN.lostRetryMinSec)) * 1000;
        scheduleNext(lostRetry, 'Слоты сорвались (' + currentTramite().key + ') · 🔁 сразу перепроверяю');
        return;
      }
      if (driving()) {
        // Клик Volver не перезагрузил страницу? (volverAt жив ТОЛЬКО если boot()
        // не выполнялся — при реальной навигации boot() его сносит.) Даём странице
        // 2.5 с на выгрузку, потом перепробуем кнопку (до 3 раз) и уходим в
        // обычный перезаход. Без этого зависший Volver молча сжигал бы проверки.
        const vAt = parseInt(SS.get('volverAt') || '0', 10);
        if (vAt) {
          if (Date.now() - vAt < 2500) return; // страница ещё может выгружаться
          const n = parseInt(SS.get('volverTries') || '0', 10) + 1;
          const btn = findVolverBtn();
          if (n <= 3 && btn) {
            status('↩️ Volver не сработал, пробую снова (№' + n + ')…', '#ffd27f');
            SS.set('volverTries', String(n));
            SS.set('volverAt', String(Date.now()));
            btn.click();
          } else { // кнопки нет или 3 попытки впустую — полный перезаход
            SS.del('volverAt'); SS.del('volverTries'); SS.del('viaVolver');
            SS.set('volverMiss', '1'); // в журнале следующего вердикта будет ↪
            location.replace(SS.get('startUrl') || DEFAULT_START);
          }
          return;
        }
        resetTransient(); // гасим сиюминутные ошибки; счётчик WAF-блоков — по времени
        SS.del('clavePending'); // проверка завершена — флаг Cl@ve не переживает её (v7.27)
        // Различаем настоящий «нет сит» и кодовый бот-блок. Настоящий — пишет
        // «En breve, la Oficina pondrá…» без 4-значного кода; блок — с кодом перед
        // «Cod. Oper.» (0017 = слишком быстрый ввод, сайт ложно пишет «нет сит»).
        // scr — на каком из двух экранов: форма заявителя или вердикт с Salir
        // (нужно бот-блоку: где показан код).
        // v9.5: глубину «сит нет» меряем НЕ страницей вердикта, а фактом захода
        // на экран заявителя (ШАГ 3 ставит deepFill): «после данных» = скрипт
        // реально заполнял имя/NIE/страну и только потом получил «En breve»,
        // «сразу» = вердикт до этого экрана. Старый маркер forma/Salir мерил
        // страницу вердикта — поля формы могли остаться в её DOM, и «глубина»
        // выходила завышенной (заметила Екатерина, 04.09).
        // ↩ перед услугой = проверка началась кнопкой Volver (та же сессия);
        // ↪ = хотели через Volver, но кнопки не нашли или клик не сработал
        // (перезаход — в статистику гипотезы не идёт).
        // v9.5: после глубины пишем и офис проверки (панель → currentOffice());
        // «провинция» = Cualquier oficina. Анализ «какие офисы давали сит нет»
        // теперь читается из каждой записи, а не только из «старт» (заметила
        // Екатерина, 04.09: в «старт» офис есть только с 03.09 и только один
        // на серию).
        const numM = document.body.innerText.match(/(\d{4})\s+Cod\.?\s*Oper/i);
        const scr = document.querySelector('#txtIdCitado') ? 'форма' : 'Salir';
        const depth = SS.get('deepFill') ? 'после данных' : 'сразу'; // v9.5
        const co = currentOffice(); // v9.5: офис этой проверки
        const where = co.key ? co.short : 'провинция';
        const via = SS.get('viaVolver') ? '↩' : (SS.get('volverMiss') ? '↪' : '');
        SS.del('viaVolver'); SS.del('volverMiss');
        recordHit(); // учли обращение к сайту в скользящем окне лимита
        if (numM) { // 4-значный код = бот-блок, «нет сит» тут ложное
          snapOnce('codeblock', numM[1] + ' ' + scr); // экран с кодом — в снимки
          recordResult('CODE_BLOCK', numM[1] + ', ' + scr);
        } else { // чистый «нет сит»
          recordResult('NO_SLOTS', via + currentTramite().key + ', ' + depth + ', ' + where);
        }
        SS.del('deepFill'); // v9.5: вердикт записан — глубина израсходована
        nextTramite(); // следующий цикл — следующая отмеченная услуга
        if (rhythmOn() || boostRun()) {
          const delay = jitteredDelayMs(); // выставляет SS.lastGap, если это шаг серии
          const why = 'Сит нет (' + currentTramite().key + ')' +
            (boostRun() ? ' · 🔥 форсаж' : SS.get('lastGap') ? ' · ' + SS.get('lastGap') : '');
          scheduleNext(delay, why);
        } else {
          // v9.0: «Проверить сейчас» обещал ОДИН цикл — вердикт получен, машина молчит
          SS.del('once');
          waiting = false; stopped = true;
          status('✅ Разовая проверка завершена: ' + (numM ? 'бот-блок ' + numM[1] : 'сит нет'), '#7CFC00');
          renderState();
        }
      } else {
        status('🔁 Сейчас сит нет — жми «Проверить сейчас» или запусти ритм', '#ffd27f');
        stopped = true;
      }
      return;
    }

    // ШАГ 2 — развилка «Presentación con/sin Cl@ve» (сайт сам пишет, что через
    // Cl@ve/сертификат доступ к записи лучше). Выбор пути — по галочке useClave.
    if (hasClaveChoice()) {
      // проверка не идёт — путь выбираешь сама (кроме явного «Следующий шаг»)
      if (!driving() && !foundMode() && !forcingStep) return;
      if (DATA.useClave) {
        noteStep('claveChoice');
        if (!recently('conClave', 5000)) {
          status('🔐 Иду путём Cl@ve (лучший доступ)…', '#7CFC00');
          SS.set('clavePending', String(Date.now()));
          // Cl@ve уводит на clave.gob.es — sessionStorage там теряется.
          // Дублируем состояние в localStorage, чтобы возобновиться по возврату.
          localStorage.setItem('ck_claveResume', JSON.stringify({
            startUrl: SS.get('startUrl') || DEFAULT_START,
            tramIdx: SS.get('tramIdx') || '0', ts: Date.now(),
            driver: onceOnly() ? 'once' : 'rhythm', // v9.0: чем вернуться — разовой или ритмом
          }));
          // флаг для скрипта на pasarela.clave.gob.es (GM-хранилище — общее для доменов)
          store.set('ck_claveFlow', String(Date.now()));
          // «con Cl@ve», но не «sin Cl@ve»
          clickByText(/con\s+cl@ve/i, /sin\s+cl@ve/i);
        }
      } else {
        noteStep('sinClave');
        if (!recently('sinClave', 5000)) {
          status('Иду без Cl@ve (быстрое заполнение)…');
          clickByText(/sin\s+cl@ve/i, null);
        }
      }
      return;
    }

    // Режим Cl@ve: после «con Cl@ve» идёт экран авторизации (сертификат/Cl@ve).
    // Если сертификат установлен — браузер проходит сам, и мы попадём на
    // известный шаг. Если нужен человек — экран незнакомый: зовём голосом,
    // авторизуется только человек, скрипт ждёт и подхватит следующий шаг.
    // Переходные страницы Cl@ve живут секунды: пишем в журнал и зовём голосом
    // только если ожидание НАСТОЯЩЕЕ (дольше 25 с), иначе это шум от редиректа.
    if (DATA.useClave && SS.get('clavePending')) {
      // Меню действий (Solicitar Cita / Consultar / Anular / Salir) = авторизация
      // УЖЕ пройдена (v7.27: раньше не распознавалось — чекер застревал тут с
      // вечным голосом «авторизуйся», баг 02.09 13:23).
      const cpAt = parseInt(SS.get('clavePending') || '0', 10);
      const known = document.querySelector('#sede, #txtIdCitado, #txtTelefonoCitado, select#idSede') ||
        /no hay citas|no hay suficientes|libre|ocupado/i.test(document.body.innerText) ||
        [...document.querySelectorAll('input[type=submit],input[type=button],button,a')]
          .some((b) => /solicitar\s+cita|anular\s+cita/i.test(b.value || b.textContent || ''));
      // Клапан протухания (v7.27): clavePending переживает перезагрузки
      // (sessionStorage) и мог остаться с ПРОШЛОЙ проверки. Реальная
      // авторизация живёт секунды-минуту; ждали 4+ минуты — флаг протух,
      // снимаем и идём дальше по шагам, а не стоим вечно с голосом.
      if (!known && cpAt && Date.now() - cpAt > 4 * 60000) {
        claveWaitSince = 0;
        SS.del('clavePending');
        localStorage.removeItem('ck_claveResume');
        status('🔐 Cl@ve-ожидание снято по таймауту — продолжаю обычные шаги…', '#ffd27f');
      } else if (!known) {
        noteStep('claveAuth'); // считаем известным шагом — не UNKNOWN
        if (!claveWaitSince) claveWaitSince = Date.now();
        if (Date.now() - claveWaitSince < 25000) {
          status('🔐 Прохожу авторизацию Cl@ve…');
        } else if (!recently('claveAuthCall', 90000)) {
          status('🔐 Авторизуйся через Cl@ve (приложение/сертификат) — я жду и продолжу', '#ffcc66');
          recordResult('CLAVE_AUTH_WAIT');
          fireAlert('clave'); // отдельное сообщение, НЕ «ситы есть»
        }
        return;
      } else {
        claveWaitSince = 0;
        SS.del('clavePending'); // авторизация прошла, дальше обычные шаги
        localStorage.removeItem('ck_claveResume');
      }
    }

    // ШАГ 2b — старый вариант: простая инфо-страница → Entrar
    if (document.querySelector('#btnEntrar') ||
        [...document.querySelectorAll('input,button,a')].some((b) => /entrar/i.test(b.value || b.textContent || ''))) {
      noteStep('step2');
      if (!recently('entrar', 5000)) {
        status('Перехожу дальше (Entrar)…');
        clickBtn('#btnEntrar', 'entrar');
      }
      return;
    }

    // ШАГ 3 — личные данные
    const idField = document.querySelector('#txtIdCitado');
    if (idField) {
      noteStep('step3');
      SS.set('deepFill', '1'); // v9.5: дошли до экрана заявителя (имя/NIE/страна,
                               // заполняется после Cl@ve) — вердикт будет «после
                               // данных». Ставим по факту экрана: чекер идёт или
                               // нет, данные готовы или нет — экран достигнут.
      if (!dataReady()) {
        status('⚙️ Заполни данные (кнопка «👤 Изменить мои данные») — без них дальше нельзя', '#ffcc66');
        stopped = true;
        if (driving()) checkerStop('⚙️ Нет личных данных — проверка остановлена');
        return;
      }
      // guard длиннее всего человеческого заполнения (~6–9 с), иначе tick через
      // 5 с повторно войдёт и начнёт печатать заново поверх недозаполненного
      if (!recently('fillpersonal', 20000)) {
        // Как делает человек: жмём «Copiar a datos solicitante» — сайт сам
        // подставляет NIE/имя из личности Cl@ve, печатать ничего не надо (это и
        // защищает от кода 0017 «слишком быстрый ввод»). Кнопка НЕ подставляет
        // страну — её выбираем сами. Что кнопка не заполнила (или её нет —
        // анонимный режим) — дописываем как раньше, по-человечески с паузами.
        status('Копирую данные из Cl@ve (как человек)…');
        const copyBtn = [...document.querySelectorAll('input[type=button],input[type=submit],button,a')]
          .find((b) => /copiar\s+a\s+datos|copiar.*solicitante/i.test(b.value || b.textContent || ''));
        const radio = DATA.docType === 'PASSPORT'
          ? document.querySelector('#rdbTipoDocPas, input[name="rdbTipoDoc"][value*="PAS"]')
          : document.querySelector('#rdbTipoDocNie, input[name="rdbTipoDoc"][value*="N.I.E"]');
        const yr = document.querySelector('#txtAnnoCitado');
        const pais = document.querySelector('#txtPaisNac');
        // страховка: дописываем только то, что осталось пустым после «Copiar»
        const fillRemainder = () => {
          if (radio && !radio.checked) {
            radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (!idField.value) fill(idField, DATA.docNumber);
          const nm = document.querySelector('#txtDesCitado');
          if (nm && !nm.value) fill(nm, DATA.fullName);
          if (yr && !yr.value && DATA.birthYear) fill(yr, DATA.birthYear);
        };
        // v7.31: после «Copiar» печати почти нет (радиокнопка, иногда год,
        // страна) — остаток и страна ОДНИМ шагом, паузы personalFill*:
        // весь экран ~3 с вместо ~6 (именно на нём ситы сгорают чаще всего).
        // Анонимно «Copiar» нет — печатаем сами, шаги раздельные, как раньше.
        const steps = [];
        if (copyBtn) {
          steps.push(() => copyBtn.click());
          steps.push(() => { fillRemainder(); if (pais) setSelectByText(pais, DATA.country); });
        } else {
          steps.push(fillRemainder);
          if (pais) steps.push(() => setSelectByText(pais, DATA.country));
        }
        fillHumanly(steps, () => {
          status('Отправляю данные…');
          clickBtn('#btnEnviar', 'aceptar', 'solicitar');
        }, CONFIG.personalFillMinSec, CONFIG.personalFillMaxSec);
      }
      return;
    }

    // ШАГ 3.4 — меню действий после личных данных → «Solicitar Cita»
    // (кнопки: Solicitar Cita / Consultar Citas … / Anular Cita / Salir)
    const solicitarBtn = [...document.querySelectorAll('input[type=submit],input[type=button],button,a')]
      .find((b) => /solicitar\s+cita/i.test(b.value || b.textContent || ''));
    if (solicitarBtn) {
      noteStep('actions');
      if (!recently('solicitar', 5000)) {
        status('Запрашиваю ситы (Solicitar Cita)…');
        solicitarBtn.click();
      }
      return;
    }

    // ШАГ 3.5 — сайт предлагает офисы со свободными слотами (позитивный признак сит!)
    const idSede = document.querySelector('select#idSede');
    if (idSede) {
      noteStep('office2');
      markFound();
      if (!recently('office2', 5000)) {
        // Берём ВТОРОЙ офис из списка, а не первый: за первый конкурируют все,
        // кто ловит ситы, — шанс, что слот уже занят, выше. Второго нет (список
        // из одного офиса) — берём первый. Опции без value — это placeholder
        // вроде «Selecciona oficina», их пропускаем.
        // Исключение: закреплён конкретный офис (список на главной панели) и
        // сайт его предложил — берём именно его.
        const opts = [...idSede.options].filter((o) => o.value);
        const chosen = currentOffice().key ? findOption(idSede, [currentOffice().key]) : null;
        const opt = chosen || opts[1] || opts[0];
        if (opt) {
          status('🎉 Ситы есть! Беру ' + (chosen ? 'выбранный' : opts[1] ? 'второй' : 'первый') +
            ' офис из ' + opts.length + '…', '#7CFC00');
          selectOption(idSede, opt);
        }
        setTimeout(() => { if (!stepMode()) clickBtn('#btnSiguiente', 'siguiente'); }, 700);
      }
      return;
    }

    // ШАГ 3.8 — новый экран слотов: календарь LIBRE/OCUPADO + КАПЧА
    // (вёрстка июля 2026). Капчу решает только человек — зовём немедленно,
    // а всё, что можно, делаем сами: выбираем первый LIBRE, фокусируем поле.
    const bodyLow = document.body.innerText.toLowerCase();
    if (bodyLow.includes('captcha') &&
        (bodyLow.includes('citas disponibles') || /\blibre\b/i.test(document.body.innerText))) {
      noteStep('slotsCaptcha');
      markFound();
      // один раз на загрузку страницы: дальше человек вводит капчу, не мешаем
      if (!recently('slotsCaptcha', 600000)) {
        // все LIBRE-даты: подсветить зелёной рамкой (выбирать глазами быстрее),
        // первую нажать самому; список доступных дат — в снимок экрана
        try {
          let first = null;
          const dates = [];
          for (const el of document.querySelectorAll('td, a, input[type=button], button, div, span')) {
            if (((el.textContent || el.value || '').trim().toUpperCase()) !== 'LIBRE') continue;
            el.style.outline = '2px solid #7CFC00';
            if (!first) first = el;
            const cell = el.closest('td, li, div');
            const t = ((cell ? cell.innerText : el.textContent) || '').trim()
              .replace(/\s+/g, ' ').slice(0, 40);
            if (t && !dates.includes(t)) dates.push(t);
          }
          if (first) first.click();
          snapOnce('captcha', 'LIBRE: ' + (dates.join(' | ') || '—'));
        } catch (e) {}
        const cap = [...document.querySelectorAll('input[type=text]')]
          .find((i) => /texto|captcha|codigo/i.test(
            (i.placeholder || '') + ' ' + (i.id || '') + ' ' + (i.name || '')));
        if (cap) { cap.focus(); cap.style.outline = '3px solid #e74c3c'; }
        status('🎉 СИТЫ НА ЭКРАНЕ! Введи капчу и жми дальше!', '#7CFC00');
        recordResult('SLOTS_CAPTCHA', currentTramite().key);
        startAlertLoop('help');
      }
      return;
    }

    // ШАГ 4 — выбор слота (главный позитивный признак: слоты реально предложены)
    const slot = document.querySelector('input[type=radio][id^="rdbCita"]');
    if (slot) {
      noteStep('step4');
      markFound();
      if (!recently('slot', 5000)) {
        const lbl = slot.closest('label, tr, td');
        const st = ((lbl ? lbl.innerText : '') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        status('🎉 Есть слот! Выбираю первый…', '#7CFC00');
        snapOnce('slot', st); // выбранный слот — в снимки (что именно взяли)
        slot.checked = true;
        slot.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => { if (!stepMode()) clickBtn('#btnSiguiente', 'siguiente'); }, 700);
      }
      return;
    }

    // ШАГ 5 — телефон + email
    const tel = document.querySelector('#txtTelefonoCitado');
    if (tel) {
      noteStep('step5');
      // guard длиннее всего заполнения (~6–9 с), иначе tick войдёт повторно
      if (!recently('contact', 20000)) {
        // по одному полю с паузами: мгновенное заполнение телефона и двух email
        // за <1 с давало код 0018 «слишком быстрый ввод» и теряло уже пойманную ситу.
        // Паузы для этого экрана свои (contactFill*, v7.30): быстрее формы
        // заявителя — слоты уже почти в руках, каждая секунда на счету
        snapOnce('telefono');
        status('Вписываю телефон и email по-человечески…');
        fillHumanly([
          () => fill(tel, DATA.phone),
          () => fill(document.querySelector('#emailUNO'), DATA.email),
          () => fill(document.querySelector('#emailDOS'), DATA.email),
        ], () => {
          status('Отправляю контакты…');
          clickBtn('#btnSiguiente', 'siguiente');
        }, CONFIG.contactFillMinSec, CONFIG.contactFillMaxSec);
      }
      return;
    }

    // ФИНАЛ — отметить согласие, но НЕ подтверждать. Дальше только человек.
    const smsField = document.querySelector('input[id*="sms" i], input[name*="sms" i], input[id*="codigo" i]');
    const confirmBtn = [...document.querySelectorAll('input[type=submit],input[type=button],button')]
      .find((b) => /confirmar/i.test(b.value || b.textContent || ''));
    if (smsField || confirmBtn) {
      noteStep('final');
      snapOnce('final'); // экран финала — в снимки: видно, что именно осталось человеку
      const chk = document.querySelector('#chkTotal, input[type=checkbox]');
      if (chk && !chk.checked) {
        chk.checked = true;
        chk.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (smsField) status('✅ ВВЕДИ SMS-КОД И НАЖМИ CONFIRMAR', '#7CFC00');
      else status('✅ Всё заполнено — проверь экран и нажми Confirmar', '#7CFC00');
      if (foundMode() && !alertTimer && !recently('finalalert', 60000)) {
        recordResult('SLOTS_FOUND_FINAL');
        startAlertLoop('found'); // голос зовёт, пока не нажато «Я тут»
      }
      return;
    }
    // ничего не узнали — молчим, watchdog разберётся (UNKNOWN)
  }

  function markFound() {
    if (SS.get('found') !== '1') {
      SS.set('found', '1');
      SS.del('viaVolver'); SS.del('volverMiss'); // метки ↩/↪ нужны только «сит нет»
      resetErrors();
      snapOnce('found', currentTramite().key); // первый экран находки — в снимки
      // снимок страницы с ситами (раз на находку) — доказательство, что это ситы
      const snap = CONFIG.saveFoundHtml ? sendFoundSnapshot() : null;
      recordResult('SLOTS_FOUND', currentTramite().key + (snap ? ' · снимок: ' + snap : ''));
    }
  }

  // Возврат с авторизации Cl@ve (clave.gob.es теряет sessionStorage) —
  // восстанавливаем состояние проверки из localStorage, если оно свежее.
  function restoreClaveSession() {
    if (driving() || !DATA.useClave) return;
    let r = null;
    try { r = JSON.parse(localStorage.getItem('ck_claveResume') || 'null'); } catch (e) {}
    if (r && Date.now() - r.ts < 15 * 60000) {
      // v9.0: возобновляем тем же водителем, с которым ушли на Cl@ve
      if (r.driver === 'once') SS.set('once', '1'); else SS.set('on', '1');
      if (r.startUrl) SS.set('startUrl', r.startUrl);
      SS.set('tramIdx', r.tramIdx || '0');
      SS.set('clavePending', String(Date.now()));
    } else if (r) {
      localStorage.removeItem('ck_claveResume'); // протухло
    }
  }

  // ---- платформа Cl@ve (pasarela.clave.gob.es): авто-клик «Access eIdentifier» ----
  const onClavePlatform = /(^|\.)clave\.gob\.es$/i.test(location.hostname);
  function clickClaveTile(reInclude) {
    // сперва среди кликабельных (кнопка/ссылка) с нужным текстом
    const clk = [...document.querySelectorAll('a,button,input[type=submit],input[type=button]')]
      .find((b) => reInclude.test((b.value || b.textContent || '').trim()));
    if (clk) { clk.click(); return true; }
    return clickByText(reInclude, null); // иначе — по тексту с подъёмом к предку
  }
  // маленькая плашка на платформе Cl@ve — видно, что скрипт тут работает
  function claveBadge(msg, color) {
    let b = document.getElementById('ck-clave-badge');
    if (!b) {
      b = document.createElement('div');
      b.id = 'ck-clave-badge';
      b.style.cssText =
        'position:fixed;top:8px;right:8px;z-index:2147483647;background:#111;color:#fff;' +
        'font:12px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:8px;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.5);max-width:240px';
      (document.body || document.documentElement).appendChild(b);
    }
    b.textContent = '🔐 cita: ' + msg;
    b.style.color = color || '#fff';
  }
  function clavePlatformFlow() {
    if (!DATA.useClave) return; // не наш случай — молчим
    if (!DATA.claveCert) { claveBadge('выбери способ входа вручную', '#ffd27f'); return; }
    // антидребезг: не жать чаще раза в 15 с (чтобы не зациклить при таймауте сервера),
    // но и не «один раз навсегда» — если вернулись на выбор, поможем снова
    const last = parseInt(store.get('ck_claveClicked', '0'), 10);
    if (Date.now() - last < 15000) { claveBadge('только что нажала eIdentifier, жду…', '#7CFC00'); return; }
    claveBadge('ищу кнопку eIdentifier…', '#ffd27f');
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      // «Access eIdentifier» / «Acceder eIdentificador» — сертификатный путь
      if (clickClaveTile(/eidentifier|eidentificador|certificad/i)) {
        store.set('ck_claveClicked', String(Date.now()));
        claveBadge('нажала eIdentifier ✓ — Chrome подтянет сертификат', '#7CFC00');
        clearInterval(timer);
      } else if (tries > 40) { // ~20 секунд ожидания медленной страницы
        claveBadge('кнопку eIdentifier не нашла — выбери вручную', '#ff8888');
        clearInterval(timer);
      }
    }, 500);
  }

  function boot() {
    // на домене Cl@ve полный чекер не нужен — только выбрать сертификатный путь
    if (onClavePlatform) { clavePlatformFlow(); return; }
    panel();
    // страница перезагрузилась — значит прошлый клик Volver (если был) сработал:
    // сносим его служебные метки. viaVolver НЕ трогаем: она нужна nocitas-ветке
    // на этой же цепочке проверок (метка ↩ в журнале).
    SS.del('volverAt'); SS.del('volverTries');
    // v9.0: ✋-пауза ушла. Если страница пришла с паузой — проверка не идёт:
    // молча продолжать ритм нельзя. Заодно сносим протухшие ключи старых версий.
    if (SS.get('paused') === '1') SS.del('on');
    SS.del('paused'); SS.del('boostUntil');
    // v9.1: грейс-пауза после ручной загрузки удалена (в v9.0 автозапуска нет —
    // каждый заход в проверку начинается кнопкой, ⏹ всегда под рукой). Её ключ
    // и метку autoNav сносим как протухшие.
    SS.del('graceUntil'); SS.del('autoNav');
    restoreClaveSession();
    if (CONFIG.FORCE_FOUND && driving()) SS.set('found', '1');
    // v8.3: сюда дошли осознанно (кнопка «Проверить сейчас» ушла отсюда
    // Volver'ом или перезаходом) — ведём форму сразу, не ждём расписания
    // ритма: nextAt от прошлой проверки запер бы tick через waiting. Метку
    // едим безусловно — с выключенным чекером она просто не должна жить.
    if (SS.get('forceNow')) { SS.del('forceNow'); SS.del('nextAt'); }
    if (driving()) {
      pingHelper();
      const nextAt = parseInt(SS.get('nextAt') || '0', 10);
      if (nextAt > Date.now()) waiting = true; // мы на паузе между проверками
      else if (nextAt) SS.del('nextAt'); // расписание исполнено этой загрузкой
      sendBeat();
      setInterval(sendBeat, 60000); // пульс сторожу раз в минуту
    }
    setInterval(() => { if (!stepMode()) tick(); }, 600); // в пошаговом режиме — только по кнопке
    setInterval(heartbeat, 1000);
    setInterval(watchdog, 3000);
    // клик/фокус мгновенно оживляют вкладку после заморозки Chrome:
    // если проверка просрочена (вкладку морозили) — сразу открываем форму заново
    function onWake() {
      if (!driving() || stepMode()) return;
      const nextAt = parseInt(SS.get('nextAt') || '0', 10);
      if (nextAt && Date.now() >= nextAt && !recently('wakeReload', 5000)) {
        SS.del('nextAt'); waiting = false;
        recordResult('RESUMED'); // видно в журнале, что вкладку морозило
        status('🔄 Вкладка ожила — начинаю следующую проверку…');
        startNewCheck();
      } else {
        heartbeat();
      }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onWake(); });
    window.addEventListener('focus', onWake);
    // v9.4: «назад» из кэша (bfcache): boot() не выполняется, состояние
    // страницы протухло (waiting=false с тех пор, как проверка шла).
    // Пересобираем паузу из расписания и показываем честный отсчёт;
    // tick дополнительно сам сверяется с расписанием (schedulePending).
    window.addEventListener('pageshow', (ev) => {
      if (!ev.persisted) return; // обычная загрузка — boot() всё сделал сам
      if (schedulePending()) { waiting = true; stopped = false; heartbeat(); }
    });
    if (!stepMode()) tick(); // в пошаговом режиме первый шаг — тоже по кнопке
    heartbeat();
  }
  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
