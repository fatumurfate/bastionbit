'use strict';

/* BastionBit — интерфейс: вкладки, генератор (случайный пароль, пароль
   из ключевого слова и фраза) и анализатор с детектором хитростей.
   Тренажёр — в trainer-ui.js, режим «Правило» — в rule-ui.js, личные
   данные, утечки и похожесть — в extras-ui.js, общие помощники — в ui.js,
   анимации — в motion.js, графики — в charts.js. */

(() => {
  const { $, setLevel, bindCopy, bindToggle, renderPassword, loadScript, loadDictionaries } = BBUI;

  /* ---------- Вкладки ---------- */

  const TABS = ['generator', 'analyzer', 'trainer', 'theory'];
  const tabButtons = TABS.map((name) => $('tab-' + name));

  const moveTabIndicator = BBMotion.indicator(document.querySelector('.tabs'), tabButtons);
  let currentTab = null;

  // Новая вкладка выезжает с той стороны, где стоит её кнопка.
  function showTab(name) {
    const previous = currentTab;
    currentTab = name;
    TABS.forEach((tab, i) => {
      const selected = tab === name;
      tabButtons[i].setAttribute('aria-selected', String(selected));
      tabButtons[i].tabIndex = selected ? 0 : -1;
      $('panel-' + tab).hidden = !selected;
    });
    const index = TABS.indexOf(name);
    moveTabIndicator(tabButtons[index], !previous);
    if (previous && previous !== name) {
      const shift = index > TABS.indexOf(previous) ? 28 : -28;
      BBMotion.enter($('panel-' + name), { x: shift, y: 0, duration: 420 });
    }
    if (name === 'analyzer') loadAnalyzer();
    if (name === 'trainer') BBTrainerUI.show();
  }

  function openTab(name, { focusTab = false } = {}) {
    if (location.hash !== '#' + name) location.hash = name; // вызовет hashchange
    else showTab(name);
    window.scrollTo(0, 0);
    if (focusTab) tabButtons[TABS.indexOf(name)].focus();
  }

  tabButtons.forEach((button, i) => {
    button.addEventListener('click', () => openTab(TABS[i]));
    button.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      const next = (moves[event.key] + TABS.length) % TABS.length;
      openTab(TABS[next], { focusTab: true });
    });
  });

  // Полоса вкладок получает фон, только когда прилипает к верху экрана.
  const tabsBar = document.querySelector('.tabs-bar');
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      tabsBar.classList.toggle('is-stuck', !entry.isIntersecting);
    }).observe(document.querySelector('.site-header'));
  }

  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (TABS.includes(name)) showTab(name);
  });

  /* ---------- Общие помощники ---------- */

  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nfSeconds = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 2 });
  const LG_DAY = Math.log10(86400);
  const LG_YEAR = Math.log10(365.25 * 86400);

  // Строка «сценарий — скорость — время подбора».
  function scenarioItem(label, speedHtml, lg) {
    const duration = BBEntropy.formatDuration(lg);

    const item = document.createElement('li');
    const text = document.createElement('div');
    const name = document.createElement('p');
    const speed = document.createElement('p');
    const time = document.createElement('p');

    name.className = 'scenario-name';
    name.textContent = label;
    speed.className = 'scenario-speed';
    speed.innerHTML = speedHtml;
    time.className = 'scenario-time';
    time.dataset.risk = lg < LG_DAY ? 'high' : lg < LG_YEAR ? 'mid' : 'low';
    time.innerHTML = `<span class="value">${duration.html}</span>` +
      (duration.beyondUniverse ? '<small>дольше возраста Вселенной</small>' : '');

    text.append(name, speed);
    item.append(text, time);
    return item;
  }

  // Длина и наборы символов. Одинаковая разметка у случайного пароля (gen-…)
  // и у пароля из ключевого слова (kw-…), но настройки у них свои.
  function createSettings(prefix, onChange) {
    const length = $(prefix + '-length');
    const lengthValue = $(prefix + '-length-value');
    const similar = $(prefix + '-similar');
    const hint = $(prefix + '-hint');
    const sets = {
      lower: $(prefix + '-lower'),
      upper: $(prefix + '-upper'),
      digits: $(prefix + '-digits'),
      symbols: $(prefix + '-symbols'),
    };

    function read() {
      return {
        length: Number(length.value),
        lower: sets.lower.checked,
        upper: sets.upper.checked,
        digits: sets.digits.checked,
        symbols: sets.symbols.checked,
        avoidSimilar: similar.checked,
      };
    }

    function syncLength() {
      const min = Number(length.min);
      const max = Number(length.max);
      const value = Number(length.value);
      lengthValue.textContent = String(value);
      length.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
    }

    length.addEventListener('input', () => {
      syncLength();
      onChange('length');
    });

    Object.values(sets).forEach((box) => {
      box.addEventListener('change', () => {
        BBMotion.pop(box);
        if (!Object.values(sets).some((b) => b.checked)) {
          box.checked = true;
          hint.textContent = 'Нужен хотя бы один набор символов.';
          return;
        }
        hint.textContent = '';
        onChange('sets');
      });
    });

    similar.addEventListener('change', () => {
      BBMotion.pop(similar);
      onChange('sets');
    });
    syncLength();
    return { read };
  }

  /* ---------- Генератор: выбор способа ---------- */

  const LEADS = {
    random: 'Случайный пароль, который невозможно угадать. Создаётся прямо в вашем браузере.',
    keyword: 'Пароль из того, что вы помните. Те же данные всегда дают тот же пароль, поэтому его не нужно хранить.',
    phrase: 'Случайная фраза, которую легко запомнить: персонаж, действие, число и предметы.',
    rule: 'Одна основа и метка от названия сайта: пароли везде разные, а помнить нужно одно правило. Но сколько утечек оно выдержит?',
  };
  const MODES = ['random', 'keyword', 'phrase', 'rule'];
  const modeLead = $('gen-lead');
  const modeRadios = Array.from(document.querySelectorAll('input[name="gen-mode"]'));
  const placeModeThumb = BBMotion.segmented($('gen-modes'));
  let currentMode = null;

  function showMode(mode) {
    const previous = currentMode;
    currentMode = mode;
    MODES.forEach((name) => { $('mode-' + name).hidden = name !== mode; });
    modeLead.textContent = LEADS[mode];
    placeModeThumb();
    if (previous && previous !== mode) {
      const shift = MODES.indexOf(mode) > MODES.indexOf(previous) ? 20 : -20;
      BBMotion.enter($('mode-' + mode), { x: shift, y: 0, duration: 380 });
      BBMotion.enter(modeLead, { y: 4, duration: 300 });
      if (mode === 'rule') BBRuleUI.show();
    }
  }

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) showMode(radio.value);
    });
  });

  /* ---------- Генератор: случайный пароль (1.1) ---------- */

  const gen = {
    password: $('gen-password'),
    refresh: $('gen-refresh'),
    copy: $('gen-copy'),
    strengthBox: $('gen-strength-box'),
    strength: $('gen-strength'),
    bits: $('gen-bits'),
    time: $('gen-time'),
    analyze: $('gen-analyze'),
  };

  const MD5 = BBEntropy.SCENARIOS.find((s) => s.id === 'md5');
  let currentPassword = '';
  const resetGenCopy = bindCopy(gen.copy, () => currentPassword);
  // Двигаем ползунок длины — символы меняются без анимации, иначе рябит.
  const genSettings = createSettings('gen', (source) => regenerate({ animate: source !== 'length' }));
  const bitsText = (bits) => `${BBEntropy.formatBits(bits)} энтропии`;

  function regenerate({ animate = false } = {}) {
    const options = genSettings.read();
    currentPassword = BBGenerator.generate(options);
    renderPassword(gen.password, currentPassword);
    if (animate) BBMotion.stagger(gen.password.children, { step: 14, max: 260, y: 8 });

    const { bits } = BBGenerator.exactEntropy(options);
    const level = BBEntropy.strength(bits);
    setLevel(gen.strengthBox, level.level);
    gen.strength.textContent = level.label;
    BBMotion.tween(gen.bits, bits, bitsText);
    gen.time.innerHTML = BBEntropy.formatDuration(BBEntropy.crackTimeLog10(bits, MD5.speed)).html;
    resetGenCopy();
  }

  gen.refresh.addEventListener('click', () => {
    BBMotion.spin(gen.refresh);
    regenerate({ animate: true });
  });

  gen.analyze.addEventListener('click', () => {
    an.input.value = currentPassword;
    analyzeInput();
    openTab('analyzer');
  });

  /* ---------- Генератор: пароль из ключевого слова (1.2) ---------- */

  const kw = {
    site: $('kw-site'),
    siteHint: $('kw-site-hint'),
    word: $('kw-word'),
    master: $('kw-master'),
    masterToggle: $('kw-master-toggle'),
    version: $('kw-version'),
    versionDown: $('kw-version-down'),
    versionUp: $('kw-version-up'),
    requirements: $('kw-req-summary'),
    submit: $('kw-submit'),
    submitLabel: $('kw-submit').querySelector('.button-label'),
    error: $('kw-error'),
    result: $('kw-result'),
    password: $('kw-password'),
    copy: $('kw-copy'),
    strengthBox: $('kw-strength-box'),
    strength: $('kw-strength'),
    bits: $('kw-bits'),
    advice: $('kw-advice'),
    details: $('kw-details'),
    wordBits: $('kw-word-bits'),
    masterBits: $('kw-master-bits'),
    totalBits: $('kw-total-bits'),
    formula: $('kw-formula'),
    model: $('kw-model'),
    times: $('kw-times'),
    slowdown: $('kw-slowdown'),
  };

  const SITE_HINT = kw.siteHint.textContent;
  const SET_SAMPLES = { lower: 'a–z', upper: 'A–Z', digits: '0–9', symbols: '!@#' };
  let kwPassword = '';
  let kwRequest = 0;   // номер последнего расчёта: устаревшие результаты отбрасываем
  let kwBusy = false;
  const resetKwCopy = bindCopy(kw.copy, () => kwPassword);
  const kwSettings = createSettings('kw', () => {
    updateRequirements();
    invalidate();
  });

  function readInputs() {
    return {
      site: kw.site.value,
      keyword: kw.word.value,
      master: kw.master.value,
      version: kw.version.value,
    };
  }

  function setBusy(busy) {
    kwBusy = busy;
    kw.submit.disabled = busy;
    kw.submit.classList.toggle('is-busy', busy);
    kw.submitLabel.textContent = busy ? 'Считаю…' : 'Получить пароль';
  }

  // Любое изменение прячет старый пароль: он больше не соответствует полям.
  function invalidate() {
    kwRequest++;
    setBusy(false);
    kwPassword = '';
    kw.result.hidden = true;
    kw.details.hidden = true;
    kw.advice.hidden = true;
    kw.error.textContent = '';
  }

  function updateSiteHint() {
    const site = BBKeyword.normalizeSite(kw.site.value);
    if (!site) {
      kw.siteHint.textContent = SITE_HINT;
      return;
    }
    const name = document.createElement('b');
    name.textContent = site;
    kw.siteHint.replaceChildren('Пароль для: ', name);
  }

  function updateRequirements() {
    const o = kwSettings.read();
    const sets = Object.keys(SET_SAMPLES).filter((key) => o[key]).map((key) => SET_SAMPLES[key]);
    const length = `${o.length} ${BBEntropy.plural(o.length, ['символ', 'символа', 'символов'])}`;
    kw.requirements.textContent = [length, sets.join(' '), o.avoidSimilar ? 'без похожих' : '']
      .filter(Boolean).join(' · ');
  }

  function stepVersion(delta) {
    const next = String(BBKeyword.normalizeVersion(Number(kw.version.value) + delta));
    if (next !== kw.version.value) {
      kw.version.value = next;
      invalidate();
    }
  }

  function showError(message, field) {
    kw.error.textContent = message;
    if (field) field.focus();
  }

  const f1 = (bits) => nf1.format(Math.round(bits * 10) / 10);

  function showResult(password, est, ms) {
    kwPassword = password;
    renderPassword(kw.password, password);
    resetKwCopy();

    const level = BBEntropy.strength(est.bits);
    setLevel(kw.strengthBox, level.level);
    kw.strength.textContent = level.label;
    kw.bits.textContent = `${BBEntropy.formatBits(est.bits)} энтропии`;

    // Совет, если пароль можно усилить
    let advice = '';
    if (est.masterBits === 0) {
      advice = 'Без мастер-фразы взломщику достаточно перебрать слова из словаря. Добавьте мастер-фразу из 4–5 слов.';
    } else if (est.passwordBits < est.guessBits && est.passwordBits < BBEntropy.LEVELS[3].min) {
      advice = 'Пароль получается слабее ваших слов. Если сайт разрешает, увеличьте длину или добавьте наборы символов в требованиях.';
    } else if (est.bits < BBEntropy.LEVELS[3].min && est.masterPhrase && est.masterPhrase.words === 5) {
      advice = 'Возьмите в генераторе фразу из 6 слов: второе прилагательное прибавит ' +
        `${f1(Math.log2(BBPhrase.SIZES.adjectives))} бита.`;
    } else if (est.bits < BBEntropy.LEVELS[3].min && est.masterPhrase && est.keywordBits === 0) {
      advice = `Добавьте ключевое слово: оно прибавит до ${f1(BBKeyword.WORD_BITS)} бита.`;
    } else if (est.bits < BBEntropy.LEVELS[3].min) {
      advice = `Добавьте в мастер-фразу ещё слово-другое: каждое слово прибавляет до ${f1(BBKeyword.WORD_BITS)} бита.`;
    }
    kw.advice.innerHTML = advice ? '<strong>Совет.</strong> ' : '';
    kw.advice.append(advice);
    if (advice) BBMotion.show(kw.advice, { y: 10, delay: 60 });
    else kw.advice.hidden = true;

    // Что нужно угадать
    const phrase = est.masterPhrase;
    kw.masterBits.previousElementSibling.textContent = phrase ? 'Мастер-фраза из генератора' : 'Мастер-фраза';
    kw.wordBits.textContent = est.keywordBits ? BBEntropy.formatBits(est.keywordBits) : 'нет';
    kw.masterBits.textContent = est.masterBits ? BBEntropy.formatBits(est.masterBits) : 'нет';
    kw.totalBits.textContent = BBEntropy.formatBits(est.guessBits);
    kw.formula.textContent =
      `H = min(${f1(est.passwordBits)}; ${f1(est.keywordBits)} + ${f1(est.masterBits)}) ≈ ${BBEntropy.formatBits(est.bits)}`;
    kw.model.textContent = phrase
      ? 'Взломщик может знать, как работает BastionBit, и название сайта — угадывать ему нужно только ваши слова. ' +
        `Мастер-фраза собрана генератором BastionBit из ${phrase.words} слов, поэтому для неё взята точная стойкость ` +
        `по словарям: ${BBEntropy.formatBits(phrase.bits)}${phrase.rest ? ' и ещё дописанное после неё' : ''}. ` +
        `Остальные слова — до ${f1(BBKeyword.WORD_BITS)} бита каждое (словарь на 50 000 слов), ` +
        `но всего не больше, чем у самого пароля: ${BBEntropy.formatBits(est.passwordBits)}.`
      : 'Взломщик может знать, как работает BastionBit, и название сайта — угадывать ему нужно только ваши слова. ' +
        `Каждое слово даёт до ${f1(BBKeyword.WORD_BITS)} бита (словарь на 50 000 слов), ` +
        `но не больше, чем у самого пароля: ${BBEntropy.formatBits(est.passwordBits)}.`;

    // Сколько займёт подбор
    kw.times.replaceChildren(...BBEntropy.SCENARIOS.map((scenario) => {
      const t = BBKeyword.crackTime(est, scenario);
      let speed = BBEntropy.formatSpeed(t.speed);
      if (t.slowed) speed += ' — тормозит PBKDF2';
      else if (t.target === 'password') speed += ' — подбор самого пароля';
      return scenarioItem(scenario.label, speed, t.lg);
    }));
    kw.slowdown.textContent =
      `Каждая попытка — это ${nf0.format(BBKeyword.ITERATIONS)} повторов хеш-функции, ` +
      `примерно +${f1(est.slowdownBits)} бита к стойкости. ` +
      `Вашему устройству на это понадобилось ${nfSeconds.format(ms / 1000)} с.`;

    BBMotion.show(kw.result, { y: 12 });
    if (kw.details.hidden) {
      kw.details.hidden = false;
      BBMotion.stagger(kw.details.children, { step: 80, y: 14, duration: 460 });
    }
  }

  async function submit() {
    if (kwBusy) return;
    const inputs = readInputs();
    const options = kwSettings.read();
    const issue = BBKeyword.problem(BBKeyword.normalizeInputs(inputs));
    if (issue === 'site') {
      showError('Укажите сайт, для которого нужен пароль.', kw.site);
      return;
    }
    if (issue === 'secret') {
      showError('Введите ключевое слово или мастер-фразу.', kw.word);
      return;
    }

    invalidate();
    const request = kwRequest;
    setBusy(true);
    try {
      const { password, ms } = await BBKeyword.derive(inputs, options);
      if (request !== kwRequest) return;   // пока считали, ввод изменился
      showResult(password, BBKeyword.estimate(inputs, options), ms);
    } catch (error) {
      if (request === kwRequest) showError('Не получилось вычислить пароль. Попробуйте ещё раз.');
      console.error(error);
    } finally {
      if (request === kwRequest) setBusy(false);
    }
  }

  [kw.site, kw.word, kw.master, kw.version].forEach((input) => {
    input.addEventListener('input', invalidate);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
  });
  kw.site.addEventListener('input', updateSiteHint);
  kw.version.addEventListener('change', () => {
    kw.version.value = String(BBKeyword.normalizeVersion(kw.version.value));
  });
  kw.versionDown.addEventListener('click', () => stepVersion(-1));
  kw.versionUp.addEventListener('click', () => stepVersion(1));
  kw.submit.addEventListener('click', submit);
  bindToggle(kw.masterToggle, kw.master, 'Показать мастер-фразу', 'Скрыть мастер-фразу');
  BBMotion.details(document.querySelector('.requirements'));

  /* ---------- Генератор: русская фраза (1.3) ---------- */

  const ph = {
    words: Array.from(document.querySelectorAll('input[name="ph-words"]')),
    refresh: $('ph-refresh'),
    copy: $('ph-copy'),
    phrase: $('ph-phrase'),
    strengthBox: $('ph-strength-box'),
    strength: $('ph-strength'),
    bits: $('ph-bits'),
    layout: $('ph-layout'),
    copyLayout: $('ph-copy-layout'),
    use: $('ph-use'),
    learn: $('ph-learn'),
    breakdown: $('ph-breakdown'),
    formula: $('ph-formula'),
    times: $('ph-times'),
    masterNote: $('ph-master-note'),
  };

  const UNITS = { word: ['слово', 'слова', 'слов'], number: ['число', 'числа', 'чисел'] };
  let phrase = null;
  const resetPhCopy = bindCopy(ph.copy, () => phrase.text);
  const resetPhCopyLayout = bindCopy(ph.copyLayout, () => phrase.layout);

  function phraseWords() {
    const checked = ph.words.find((radio) => radio.checked);
    return checked ? Number(checked.value) : 6;
  }

  // Под каждым словом — подсказка, какое место шаблона оно занимает.
  function renderPhrase(parts) {
    const nodes = [];
    parts.forEach((part, i) => {
      if (i) nodes.push(document.createTextNode(' '));
      const word = document.createElement('span');
      const text = document.createElement('span');
      const role = document.createElement('span');
      word.className = part.role === 'сколько' ? 'phrase-word is-number' : 'phrase-word';
      text.className = 'phrase-text';
      text.textContent = part.text;
      role.className = 'phrase-role';
      role.textContent = part.role;
      role.setAttribute('aria-hidden', 'true');
      word.append(text, role);
      nodes.push(word);
    });
    ph.phrase.replaceChildren(...nodes);
  }

  function newPhrase({ animate = false } = {}) {
    phrase = BBPhrase.generate({ words: phraseWords() });
    renderPhrase(phrase.parts);
    renderPassword(ph.layout, phrase.layout);
    if (animate) {
      BBMotion.stagger(ph.phrase.querySelectorAll('.phrase-word'), { step: 45, max: 300, y: 10, duration: 420 });
      BBMotion.stagger(ph.layout.children, { step: 6, max: 300, y: 4, duration: 300 });
    }
    resetPhCopy();
    resetPhCopyLayout();
  }

  function breakdownRow(label, count, value, className) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    if (className) row.className = className;
    dt.textContent = label;
    if (count) {
      const small = document.createElement('span');
      small.className = 'breakdown-count';
      small.textContent = count;
      dt.append(' ', small);
    }
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }

  // Стойкость зависит только от числа слов, а не от выпавшей фразы.
  function renderPhraseStats() {
    const words = phraseWords();
    const rows = BBPhrase.breakdown(words);
    const bits = BBPhrase.bits(words);
    const level = BBEntropy.strength(bits);

    setLevel(ph.strengthBox, level.level);
    ph.strength.textContent = level.label;
    BBMotion.tween(ph.bits, bits, bitsText);

    ph.breakdown.replaceChildren(
      ...rows.map((row) => breakdownRow(
        row.role,
        `${nf0.format(row.count)} ${BBEntropy.plural(row.count, UNITS[row.unit])}`,
        BBEntropy.formatBits(row.bits))),
      breakdownRow('Вместе', '', BBEntropy.formatBits(bits), 'breakdown-total'));
    ph.formula.textContent =
      `H = log₂(${rows.map((row) => row.count).join(' · ')}) ≈ ${BBEntropy.formatBits(bits)}`;

    ph.times.replaceChildren(...BBEntropy.SCENARIOS.map((s) => scenarioItem(
      s.label, BBEntropy.formatSpeed(s.speed), BBEntropy.crackTimeLog10(bits, s.speed))));
    const asMaster = BBEntropy.formatDuration(BBEntropy.crackTimeLog10(bits, BBEntropy.KDF.speed));
    ph.masterNote.innerHTML =
      'Так фраза держится, если ввести её прямо как пароль. Надёжнее сделать её мастер-фразой ' +
      'в режиме «Из ключевого слова»: каждая попытка взломщика проходит через PBKDF2, и подбор ' +
      `даже при утечке базы займёт около ${asMaster.html} — ещё без учёта ключевого слова.`;
  }

  BBMotion.segmented($('ph-words-switch'));
  ph.words.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      newPhrase({ animate: true });
      renderPhraseStats();
    });
  });
  ph.refresh.addEventListener('click', () => {
    BBMotion.spin(ph.refresh);
    newPhrase({ animate: true });
  });

  // Фраза уходит в поле мастер-фразы режима «Из ключевого слова».
  ph.use.addEventListener('click', () => {
    kw.master.value = phrase.text;
    const keywordRadio = modeRadios.find((radio) => radio.value === 'keyword');
    keywordRadio.checked = true;
    showMode('keyword');
    invalidate();
    (kw.site.value.trim() ? kw.word : kw.site).focus();
  });

  // Фразу можно сразу выучить в тренажёре.
  ph.learn.addEventListener('click', () => {
    openTab('trainer');
    showTab('trainer');   // не дожидаясь hashchange: форма должна быть видна
    BBTrainerUI.learn(phrase.text, 'Фраза');
  });

  /* ---------- Анализатор ---------- */

  const an = {
    input: $('an-input'),
    toggle: $('an-toggle'),
    empty: $('an-empty'),
    result: $('an-result'),
    strengthBox: $('an-strength-box'),
    caption: $('an-caption'),
    verdict: $('an-verdict'),
    bits: $('an-bits'),
    compareLine: $('an-compare-line'),
    status: $('an-status'),
    preview: $('an-preview'),
    chunks: $('an-chunks'),
    nothing: $('an-nothing'),
    realBox: $('an-real-box'),
    realFormula: $('an-real-formula'),
    advice: $('an-advice'),
    times: $('an-times'),
    expiry: $('an-expiry'),
    expiryBox: $('an-expiry-box'),
    expiryChart: $('an-expiry-chart'),
    quantum: $('an-quantum'),
    length: $('an-length'),
    pool: $('an-pool'),
    classes: $('an-classes'),
    formula: $('an-formula'),
    compareBox: $('an-compare-box'),
    compareChart: $('an-compare-chart'),
    zxcvbn: $('an-zxcvbn'),
  };

  // Словари (≈ 2,2 МБ), zxcvbn (≈ 800 КБ) и Chart.js (≈ 200 КБ) нужны только
  // анализатору, поэтому загружаются, когда его открывают (BBUI.loadScript).
  // Состояние загрузки: loading → ready или failed.
  const deps = { dictionaries: 'idle', zxcvbn: 'idle', charts: 'idle' };
  let analyzerLoading = false;

  function track(key, promise, after) {
    deps[key] = 'loading';
    promise
      .then(() => { deps[key] = 'ready'; }, (error) => {
        deps[key] = 'failed';
        console.warn(error.message);
      })
      .then(after);
  }

  function loadAnalyzer() {
    if (analyzerLoading) return;
    analyzerLoading = true;
    track('dictionaries', loadDictionaries(), analyzeInput);
    track('charts', loadScript('vendor/chart.umd.min.js'), renderCharts);
    track('zxcvbn', loadScript('vendor/zxcvbn.js'), analyzeInput);
  }

  /* Сравнение с zxcvbn — открытой библиотекой Dropbox. Она знает только
     английские словари; её число попыток переводим в биты: log₂ попыток. */
  const ZXCVBN_WARNINGS = {
    'Straight rows of keys are easy to guess': 'ряды клавиш подряд легко угадать',
    'Short keyboard patterns are easy to guess': 'короткие клавиатурные узоры легко угадать',
    'Repeats like "aaa" are easy to guess': 'повторы вроде «aaa» легко угадать',
    'Repeats like "abcabcabc" are only slightly harder to guess than "abc"': 'повторы вроде «abcabcabc» угадать лишь чуть труднее, чем «abc»',
    'Sequences like abc or 6543 are easy to guess': 'последовательности вроде abc или 6543 легко угадать',
    'Recent years are easy to guess': 'недавние годы легко угадать',
    'Dates are often easy to guess': 'даты часто легко угадать',
    'This is a top-10 common password': 'это один из 10 самых популярных паролей',
    'This is a top-100 common password': 'это один из 100 самых популярных паролей',
    'This is a very common password': 'это очень популярный пароль',
    'This is similar to a commonly used password': 'это похоже на популярный пароль',
    'A word by itself is easy to guess': 'одно слово легко угадать',
    'Names and surnames by themselves are easy to guess': 'имена и фамилии сами по себе легко угадать',
    'Common names and surnames are easy to guess': 'частые имена и фамилии легко угадать',
  };

  // inputs — личные данные: zxcvbn тоже умеет искать их в пароле.
  function zxcvbnResult(password, inputs = []) {
    if (typeof zxcvbn !== 'function') return null;
    const chars = Array.from(password);
    const result = zxcvbn(chars.slice(0, BBPatterns.MAX_LENGTH).join(''), inputs);
    return {
      bits: result.guesses_log10 / Math.log10(2),
      warning: ZXCVBN_WARNINGS[result.feedback.warning] || '',
      cut: chars.length > BBPatterns.MAX_LENGTH,
    };
  }

  // Цвет куска: популярный пароль выделяем отдельно от обычных слов.
  const chunkKind = (chunk) => (chunk.type === 'dictionary' && chunk.dictionary === 'passwords' ? 'password' : chunk.type);
  const JOIN_TEXT = nf0.format(BBPatterns.JOIN_BITS);

  // Пароль, раскрашенный по кускам. Если пароль скрыт — вместо символов точки.
  function renderPreview(chunks, reveal) {
    an.preview.replaceChildren(...chunks.map((chunk) => {
      const part = document.createElement('span');
      const text = document.createElement('span');
      const tag = document.createElement('span');
      part.className = 'chunk';
      part.dataset.kind = chunkKind(chunk);
      text.className = 'chunk-text';
      text.textContent = reveal ? chunk.token : '•'.repeat(Array.from(chunk.token).length);
      tag.className = 'chunk-tag';
      tag.textContent = BBPatterns.describe(chunk, { reveal }).tag;
      part.append(text, tag);
      return part;
    }));
  }

  /* Список находок. Строки привязаны к месту куска в пароле: пока вы
     печатаете в конце, прежние строки остаются на месте, а новые плавно
     появляются. Ключи хранятся только в памяти, не в разметке. */
  const chunkItems = new Map();

  function chunkItem() {
    const item = document.createElement('li');
    item.className = 'chunk-item';
    item.innerHTML = '<span class="chunk-mark" aria-hidden="true"></span>' +
      '<div class="chunk-body"><p class="chunk-title"></p><p class="chunk-detail"></p></div>' +
      '<p class="chunk-bits"></p>';
    return item;
  }

  function renderChunks(chunks, reveal) {
    const next = new Map();
    const fresh = [];
    const items = chunks.map((chunk) => {
      const key = `${chunk.start}:${chunkKind(chunk)}`;
      let item = chunkItems.get(key);
      if (!item) {
        item = chunkItem();
        fresh.push(item);
      }
      next.set(key, item);
      const info = BBPatterns.describe(chunk, { reveal });
      const title = item.querySelector('.chunk-title');
      title.textContent = info.title;
      if (reveal) {
        const token = document.createElement('code');
        token.className = 'chunk-token';
        token.textContent = chunk.token;
        title.append(' ', token);
      }
      item.dataset.kind = chunkKind(chunk);
      item.querySelector('.chunk-detail').textContent = info.detail;
      item.querySelector('.chunk-bits').textContent = BBEntropy.formatBits(chunk.bits);
      return item;
    });
    chunkItems.clear();
    next.forEach((item, key) => chunkItems.set(key, item));
    an.chunks.replaceChildren(...items);
    fresh.forEach((item, i) => BBMotion.enter(item, { y: 6, duration: 340, delay: i * 40 }));
  }

  // H = H₁ + H₂ + … + 3 · (k − 1)
  function realFormula(result) {
    const k = result.chunks.length;
    if (k === 1) return `H ≈ ${BBEntropy.formatBits(result.bits)}`;
    const parts = result.chunks.map((chunk) => f1(chunk.bits)).join(' + ');
    const joins = k > 1 ? ` + ${JOIN_TEXT} · ${k - 1}` : '';
    return `H = ${parts}${joins} ≈ ${BBEntropy.formatBits(result.bits)}`;
  }

  function renderDetector(result, reveal) {
    const state = deps.dictionaries;
    an.status.textContent = state === 'failed'
      ? 'Словари не загрузились: слова и популярные пароли не проверены.'
      : state === 'ready' ? '' : 'Загружаю словари популярных паролей и слов…';
    an.status.hidden = state === 'ready';
    an.status.dataset.state = state;
    an.caption.textContent = state === 'ready' ? 'Оценка с учётом хитростей'
      : state === 'failed' ? 'Оценка без словарей' : 'Предварительная оценка';

    const { found } = result;
    an.preview.hidden = !found;
    an.chunks.hidden = !found;
    an.realBox.hidden = !found;
    if (found) {
      an.nothing.hidden = true;
      renderPreview(result.chunks, reveal);
      renderChunks(result.chunks, reveal);
      an.realFormula.textContent = realFormula(result);
    } else {
      chunkItems.clear();
      an.chunks.replaceChildren();
      an.preview.replaceChildren();
      an.realFormula.textContent = '';
      BBMotion.show(an.nothing, { y: 6 });
    }

    const tips = BBPatterns.advice(result);
    an.advice.replaceChildren(...tips.map((tip) => {
      const li = document.createElement('li');
      li.textContent = tip;
      return li;
    }));
    an.advice.hidden = !tips.length;
  }

  // Через сколько лет пароль подберут быстрее чем за сутки: видеокарты
  // ускоряются вдвое каждые 2 года.
  const EXPIRY = [
    { id: 'md5', label: 'Утечка базы с MD5', short: 'MD5', speed: MD5.speed },
    { id: 'bcrypt', label: 'Утечка базы с bcrypt', short: 'bcrypt', speed: BBEntropy.SCENARIOS.find((s) => s.id === 'bcrypt').speed },
  ];

  // Нынешний год с долей: 5 ноября 2026 года ≈ 2026,85.
  function yearNow() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return now.getFullYear() + (now - start) / (365.25 * 86400 * 1000);
  }

  function yearsText(t) {
    const rounded = Math.round(t * 10) / 10;
    const word = Number.isInteger(rounded) ? BBEntropy.plural(rounded, ['год', 'года', 'лет']) : 'года';
    return `${nf1.format(rounded)} ${word}`;
  }

  let expirySummary = '';   // тот же срок годности словами — для подписи графика

  function expiryItem(scenario, bits, now) {
    const t = BBEntropy.expiryYears(bits, scenario.speed);
    let value;
    let note;
    if (t <= 0) {
      value = 'уже сейчас';
      note = 'подбор быстрее суток';
    } else if (t > 100) {
      value = `после ${Math.floor(now + 100)} года`;
      note = 'больше чем через 100 лет';
    } else {
      value = `в ${Math.floor(now + t)} году`;
      const months = Math.max(1, Math.round(t * 12));
      note = t < 1 ? `через ${months} ${BBEntropy.plural(months, ['месяц', 'месяца', 'месяцев'])}` : `через ≈ ${yearsText(t)}`;
    }
    expirySummary += `${expirySummary ? ', ' : ''}${scenario.label.toLowerCase()} — ${value}`;
    const item = document.createElement('li');
    const name = document.createElement('p');
    const time = document.createElement('p');
    const small = document.createElement('small');
    name.className = 'scenario-name';
    name.textContent = scenario.label;
    time.className = 'scenario-time';
    time.dataset.risk = t <= 0 ? 'high' : t <= 20 ? 'mid' : 'low';
    time.innerHTML = '<span class="value"></span>';
    time.firstChild.textContent = value;
    small.textContent = note;
    time.append(small);
    item.append(name, time);
    return item;
  }

  function renderExpiry(bits) {
    const now = yearNow();
    expirySummary = '';
    an.expiry.replaceChildren(...EXPIRY.map((scenario) => expiryItem(scenario, bits, now)));
    const quantum = BBEntropy.quantumBits(bits);
    an.quantum.textContent =
      `Квантовый компьютер с алгоритмом Гровера уменьшил бы стойкость вдвое — до ${BBEntropy.formatBits(quantum)}. ` +
      (quantum >= BBEntropy.LEVELS[3].min
        ? 'Даже так пароль останется сильным.'
        : 'Таких компьютеров пока нет, но для защиты на десятилетия вперёд советуют от 128 бит.');
  }

  // Старая оценка по формуле: каждый символ считается случайным.
  function renderFormula(naive) {
    an.length.textContent = String(naive.length);
    an.pool.textContent = String(naive.pool);
    an.classes.replaceChildren(...naive.classes.map((cls) => {
      const chip = document.createElement('li');
      const size = document.createElement('b');
      size.textContent = String(cls.size);
      chip.append(cls.label, size);
      return chip;
    }));
    an.formula.textContent =
      `H = L · log₂ N = ${naive.length} · log₂ ${naive.pool} ≈ ${BBEntropy.formatBits(naive.bits)}`;
  }

  function renderZxcvbn(result, zx) {
    if (deps.zxcvbn === 'failed') {
      an.zxcvbn.textContent = 'zxcvbn не загрузилась — сравнение только с формулой.';
      return;
    }
    if (!zx) {
      an.zxcvbn.textContent = 'Загружаю zxcvbn…';
      return;
    }
    const parts = ['zxcvbn — открытая библиотека Dropbox. Она знает английские слова, имена и популярные пароли, но не русский язык и раскладку ЙЦУКЕН.'];
    if (zx.warning) parts.push(`Её подсказка: ${zx.warning}.`);
    if (result.found && zx.bits > result.bits + 5) parts.push('Здесь BastionBit нашёл больше хитростей.');
    else if (!result.found && zx.bits < result.bits - 10) {
      parts.push('Случайные символы zxcvbn оценивает осторожно — по 10 вариантов на символ, поэтому её оценка ниже.');
    }
    if (zx.cut) parts.push(`zxcvbn проверила первые ${BBPatterns.MAX_LENGTH} символов.`);
    an.zxcvbn.textContent = parts.join(' ');
  }

  function compareText(naiveBits, zx) {
    const parts = [`По формуле — ${BBEntropy.formatBits(naiveBits)}`];
    if (zx) parts.push(`zxcvbn — ${BBEntropy.formatBits(zx.bits)}`);
    else if (deps.zxcvbn !== 'failed') parts.push('zxcvbn — загружается…');
    return parts.join(' · ');
  }

  // Графики перерисовываем не чаще раза за кадр.
  let lastAnalysis = null;
  let chartFrame = 0;

  function renderCharts() {
    chartFrame = 0;
    const failed = deps.charts === 'failed';
    an.compareBox.hidden = failed;
    an.expiryBox.hidden = failed;
    if (!lastAnalysis || !BBCharts.ready()) return;
    const { result, zx } = lastAnalysis;
    const zxText = zx ? BBEntropy.formatBits(zx.bits) : (deps.zxcvbn === 'failed' ? 'нет данных' : 'загружается…');
    BBCharts.compare(an.compareChart, [
      { kind: 'formula', label: 'По формуле', bits: result.naiveBits, text: BBEntropy.formatBits(result.naiveBits) },
      { kind: 'real', label: 'BastionBit', bits: result.bits, text: BBEntropy.formatBits(result.bits) },
      { kind: 'zxcvbn', label: 'zxcvbn', bits: zx ? zx.bits : null, text: zxText },
    ]);
    an.compareChart.setAttribute('aria-label',
      `Сравнение оценок: по формуле ${BBEntropy.formatBits(result.naiveBits)}, BastionBit ${BBEntropy.formatBits(result.bits)}, zxcvbn ${zxText}.`);

    const now = yearNow();
    BBCharts.expiry(an.expiryChart, {
      bits: result.bits, year: Math.floor(now), years: 40,
      scenarios: EXPIRY.map((s) => ({ id: s.id, label: s.short, speed: s.speed })),
    });
    an.expiryChart.setAttribute('aria-label', `Время подбора на 40 лет вперёд. Пароль просрочен: ${expirySummary}.`);
  }

  function scheduleCharts() {
    if (!chartFrame) chartFrame = requestAnimationFrame(renderCharts);
  }

  function analyzeInput() {
    const password = an.input.value;
    if (!password) {
      an.result.hidden = true;
      an.empty.hidden = false;
      chunkItems.clear();
      an.chunks.replaceChildren();
      an.preview.replaceChildren();
      lastAnalysis = null;
      BBExtrasUI.update({ password: '' });
      return;
    }
    loadAnalyzer();

    const reveal = an.input.type === 'text';
    const personal = BBExtrasUI.personal();
    const result = BBPatterns.analyze(password, { personal });
    const zx = zxcvbnResult(password, personal.inputs);
    const level = BBEntropy.strength(result.bits);
    lastAnalysis = { result, zx };

    an.empty.hidden = true;
    BBMotion.show(an.result, { y: 10 });
    setLevel(an.strengthBox, level.level);
    an.verdict.textContent = level.label;
    BBMotion.tween(an.bits, result.bits, BBEntropy.formatBits);
    an.compareLine.textContent = compareText(result.naiveBits, zx);

    renderDetector(result, reveal);
    an.times.replaceChildren(...BBEntropy.SCENARIOS.map((s) => scenarioItem(
      s.label, BBEntropy.formatSpeed(s.speed), BBEntropy.crackTimeLog10(result.bits, s.speed))));
    renderExpiry(result.bits);
    renderFormula(result.naive);
    renderZxcvbn(result, zx);
    scheduleCharts();
    BBExtrasUI.update({ password, reveal, bits: result.bits });
  }

  an.input.addEventListener('input', analyzeInput);
  BBExtrasUI.onPersonalChange(analyzeInput);
  an.input.addEventListener('focus', loadAnalyzer);
  bindToggle(an.toggle, an.input, 'Показать пароль', 'Скрыть пароль', analyzeInput);

  /* ---------- Запуск ---------- */

  regenerate();
  newPhrase();
  renderPhraseStats();
  document.querySelectorAll('[data-phrase]').forEach((span) => {
    const key = span.dataset.phrase;
    span.textContent = key.startsWith('bits')
      ? BBEntropy.formatBits(BBPhrase.bits(Number(key.slice(4))))
      : nf0.format(BBPhrase.SIZES[key]);
  });
  analyzeInput();
  updateRequirements();
  updateSiteHint();
  const checkedMode = modeRadios.find((radio) => radio.checked);
  showMode(checkedMode ? checkedMode.value : 'random');
  const startTab = location.hash.slice(1);
  showTab(TABS.includes(startTab) ? startTab : 'generator');
})();
