'use strict';

/* BastionBit — интерфейс тренажёра (этап 3).

   «Запоминание» — карточки паролей. Новый пароль сначала вводят по памяти
   3 раза подряд, потом повторяют через 1, 3, 7, 14 и 30 дней. Расписание,
   хеши и хранение — в trainer.js. Открытый текст пароля есть только
   в памяти страницы, пока его заучивают, и забывается после третьего
   верного ввода.

   «Взломай сам» — четыре уровня из game.js. После каждого уровня
   «программа-взломщик» показывает, за сколько попыток нашла бы тот же
   пароль. */

const BBTrainerUI = (() => {
  const { $, bindToggle, renderPassword, loadDictionaries } = BBUI;
  const T = BBTrainer;
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 2 });
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

  const count = (n, forms) => `${nf0.format(n)} ${BBEntropy.plural(n, forms)}`;
  const bits = (value) => BBEntropy.formatBits(value);
  const DAYS = ['день', 'дня', 'дней'];
  const TIMES = ['раз', 'раза', 'раз'];
  const PASSWORDS = ['пароль', 'пароля', 'паролей'];
  const ATTEMPTS = ['попытка', 'попытки', 'попыток'];
  const ATTEMPTS_FOR = ['попытку', 'попытки', 'попыток'];   // «за 1 попытку»
  const VARIANTS = ['вариант', 'варианта', 'вариантов'];

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  /* ---------- Даты по-русски ---------- */

  function toDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  const formatDate = (key) => dayMonth.format(toDate(key));

  function relative(days) {
    if (days <= 0) return 'сегодня';
    if (days === 1) return 'завтра';
    if (days === 2) return 'послезавтра';
    return `через ${count(days, DAYS)}`;
  }

  // «завтра, 6 ноября», «через 3 дня, 9 ноября»
  const whenDue = (key, today) => `${relative(T.daysBetween(today, key))}, ${formatDate(key)}`;

  /* ---------- Переключатель «Запоминание» / «Взломай сам» ---------- */

  const MODES = ['memory', 'game'];
  const LEADS = {
    memory: 'Выучите пароль наизусть по расписанию повторений. Сам пароль нигде не сохраняется.',
    game: 'Угадайте четыре пароля и посмотрите, почему одни взламывают за секунды, а другие — никогда.',
  };
  const lead = $('tr-lead');
  const modeRadios = Array.from(document.querySelectorAll('input[name="tr-mode"]'));
  const placeThumb = BBMotion.segmented($('tr-modes'));
  let mode = null;

  function showMode(next) {
    const previous = mode;
    mode = next;
    MODES.forEach((name) => { $('tr-' + name).hidden = name !== next; });
    lead.textContent = LEADS[next];
    placeThumb();
    if (previous && previous !== next) {
      const shift = MODES.indexOf(next) > MODES.indexOf(previous) ? 20 : -20;
      BBMotion.enter($('tr-' + next), { x: shift, y: 0, duration: 380 });
      BBMotion.enter(lead, { y: 4, duration: 300 });
    }
    if (next === 'game') loadDictionaries().catch(() => {});   // детектор для разбора уровней
  }

  function selectMode(next) {
    modeRadios.forEach((radio) => { radio.checked = radio.value === next; });
    showMode(next);
  }

  modeRadios.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.checked) showMode(radio.value);
  }));

  /* ---------- Запоминание: данные ---------- */

  const mem = {
    storage: $('mem-storage'),
    head: $('mem-list-head'),
    summary: $('mem-summary'),
    list: $('mem-list'),
    add: $('mem-add'),
    addLead: $('mem-add-lead'),
    name: $('mem-name'),
    password: $('mem-password'),
    toggle: $('mem-toggle'),
    strength: $('mem-strength'),
    submit: $('mem-submit'),
    submitLabel: $('mem-submit').querySelector('.button-label'),
    phrase: $('mem-phrase'),
    error: $('mem-error'),
    plan: $('mem-plan'),
    stored: $('mem-stored'),
    storedJson: $('mem-stored-json'),
  };
  const template = $('mem-card-template');

  let cards = [];
  let available = true;     // можно ли сохранять в localStorage
  let broken = false;       // часть сохранённых данных испорчена
  let saveFailed = false;
  let order = [];           // порядок карточек на экране
  const views = new Map();  // id → карточка на экране
  const secrets = new Map();   // id → пароль, только пока его заучивают

  const cardOf = (id) => cards.find((card) => card.id === id);

  function replaceCard(next) {
    cards = cards.map((card) => (card.id === next.id ? next : card));
  }

  function loadCards() {
    const data = T.load();
    cards = data.cards;
    available = data.available;
    broken = data.broken;
    saveFailed = false;
  }

  function persist() {
    if (available) {
      saveFailed = !T.save(cards);
      if (!saveFailed) broken = false;   // испорченные записи перезаписаны
    }
    renderStorage();
    renderStored();
  }

  function renderStorage() {
    let text = '';
    if (!available) {
      text = 'Браузер не разрешает этой странице сохранять данные. Пароли можно учить, но после закрытия страницы карточки пропадут.';
    } else if (saveFailed) {
      text = 'Не получилось сохранить изменения: хранилище браузера переполнено или запрещено. После закрытия страницы они пропадут.';
    } else if (broken) {
      text = 'Часть сохранённых данных тренажёра повреждена — такие карточки пропущены.';
    }
    mem.storage.textContent = text;
    mem.storage.hidden = !text;
  }

  // Ровно то, что лежит в localStorage: видно, что пароля там нет.
  function renderStored() {
    mem.stored.hidden = cards.length === 0;
    let text = '';
    try {
      const raw = available ? localStorage.getItem(T.STORAGE_KEY) : null;
      if (raw) text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      text = '';
    }
    mem.storedJson.textContent = text || JSON.stringify({ version: T.VERSION, cards }, null, 2);
  }

  /* ---------- Запоминание: карточки ---------- */

  const CHIPS = { learning: 'Заучивание', due: 'Пора повторить', waiting: 'Ждёт повторения', learned: 'Выучен' };
  const RANK = { learning: 0, due: 1, waiting: 2, learned: 3 };
  const FORGOT = 'Не совпало. Если пароль забыт, тренажёр его не подскажет — он хранит только хеш. '
    + 'Найдите пароль там, где он записан, или удалите карточку и добавьте его заново.';

  // Сверху — то, что нужно сделать сейчас. Порядок меняется только при открытии
  // вкладки, чтобы карточки не прыгали, пока с ними работают.
  function sortOrder(today) {
    order = cards.slice().sort((a, b) => {
      const sa = T.status(a, today).state;
      const sb = T.status(b, today).state;
      return RANK[sa] - RANK[sb] || (a.due && b.due ? a.due.localeCompare(b.due) : 0);
    }).map((card) => card.id);
  }

  function whenText(card, st, today) {
    if (st.state === 'learning') {
      return secrets.has(card.id)
        ? `Прочитайте пароль, а потом введите его по памяти ${T.LEARN_STREAK} раза подряд.`
        : `Заучивание не закончено. Пароль нигде не сохранён, поэтому показать его снова нельзя — введите его по памяти ${T.LEARN_STREAK} раза подряд.`;
    }
    if (st.state === 'due') {
      return st.overdue
        ? `Пора повторить — срок был ${formatDate(card.due)}. Ничего страшного: введите пароль по памяти.`
        : 'Пора повторить: введите пароль по памяти.';
    }
    if (st.state === 'waiting') return `Следующее повторение — ${whenDue(card.due, today)}.`;
    return card.lapses
      ? `Все ${T.INTERVALS.length} повторений пройдены. Ошибок по пути: ${card.lapses}.`
      : `Все ${T.INTERVALS.length} повторений пройдены без единой ошибки.`;
  }

  // Пароль текстом: цифры и символы подсвечены, строка переносится по пробелам.
  function renderSecretText(target, text) {
    const parts = [];
    let plain = '';
    const flush = () => {
      if (plain) parts.push(document.createTextNode(plain));
      plain = '';
    };
    Array.from(text).forEach((ch) => {
      const kind = /[0-9]/.test(ch) ? 'd' : /[\p{L}\s]/u.test(ch) ? '' : 's';
      if (!kind) {
        plain += ch;
        return;
      }
      flush();
      parts.push(node('span', kind, ch));
    });
    flush();
    target.replaceChildren(...parts);
  }

  function renderSecret(view) {
    const password = secrets.get(view.id) || '';
    if (view.covered) {
      view.secret.textContent = '•'.repeat(Math.min(Array.from(password).length, 24));
    } else {
      renderSecretText(view.secret, password);
    }
    view.secret.classList.toggle('is-covered', view.covered);
    view.peek.textContent = view.covered ? 'Показать' : 'Скрыть';
  }

  function cover(view, covered) {
    view.covered = covered;
    renderSecret(view);
    if (!covered) BBMotion.enter(view.secret, { y: 4, duration: 280 });
  }

  function renderStreak(view) {
    Array.from(view.streak.children).forEach((dot, i) => dot.classList.toggle('is-on', i < view.run));
    view.streak.setAttribute('aria-label', `Верно подряд: ${view.run} из ${T.LEARN_STREAK}`);
  }

  function tell(view, text, tone = 'info') {
    view.message.textContent = text;
    view.message.dataset.tone = tone;
    if (text) BBMotion.enter(view.message, { y: -3, duration: 260 });
  }

  function reveal(target, show, animate) {
    if (show && animate) BBMotion.show(target, { y: -4, duration: 300 });
    else target.hidden = !show;
  }

  function createView(id) {
    const item = template.content.firstElementChild.cloneNode(true);
    const q = (selector) => item.querySelector(selector);
    const view = {
      id,
      node: item,
      name: q('.memory-name'),
      chip: q('.memory-state'),
      stepsList: q('.memory-steps'),
      steps: Array.from(item.querySelectorAll('.memory-steps li')),
      when: q('.memory-when'),
      learn: q('.memory-learn'),
      secret: q('.memory-secret'),
      peek: q('.memory-peek'),
      check: q('.memory-check'),
      input: q('.memory-input'),
      toggle: q('.memory-toggle'),
      submit: q('.memory-submit'),
      submitLabel: q('.memory-submit .button-label'),
      caps: q('.memory-caps'),
      streak: q('.memory-streak'),
      message: q('.memory-message'),
      practice: q('.memory-practice'),
      remove: q('.memory-delete'),
      mode: null,        // learn — заучивание, review — повторение по расписанию, practice — тренировка
      run: 0,            // верно подряд при заучивании
      fails: 0,          // ошибок подряд
      covered: false,    // пароль при заучивании закрыт точками
      busy: false,
      confirming: false,
      confirmTimer: 0,
    };
    item.dataset.id = id;

    bindToggle(view.toggle, view.input, 'Показать введённое', 'Скрыть введённое');
    view.submit.addEventListener('click', () => submitView(view));
    view.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitView(view);
    });
    // Начали вводить — пароль закрывается, чтобы вводить по памяти.
    view.input.addEventListener('input', () => {
      if (view.mode === 'learn' && view.input.value && !view.covered && secrets.has(view.id)) cover(view, true);
    });
    ['keydown', 'keyup'].forEach((type) => view.input.addEventListener(type, (event) => {
      if (typeof event.getModifierState === 'function') view.caps.hidden = !event.getModifierState('CapsLock');
    }));
    view.input.addEventListener('blur', () => { view.caps.hidden = true; });
    view.peek.addEventListener('click', () => peek(view));
    view.practice.addEventListener('click', () => togglePractice(view));
    view.remove.addEventListener('click', () => removeCard(view));
    view.remove.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') resetRemove(view);
    });
    return view;
  }

  function updateView(view, today = T.dateKey(), animate = false) {
    const card = cardOf(view.id);
    if (!card) return;
    const st = T.status(card, today);
    if (st.state !== 'learning') secrets.delete(card.id);
    if (st.state === 'learning') view.mode = 'learn';
    else if (st.state === 'due') view.mode = 'review';
    else if (view.mode !== 'practice') view.mode = null;

    view.node.dataset.state = st.state;
    view.name.textContent = card.name;
    view.chip.textContent = CHIPS[st.state];
    view.chip.dataset.state = st.state;
    view.steps.forEach((step, i) => {
      step.classList.toggle('is-done', i < card.step);
      step.classList.toggle('is-current', i === card.step && (st.state === 'due' || st.state === 'waiting'));
    });
    view.stepsList.setAttribute('aria-label', `Пройдено повторений: ${card.step} из ${T.INTERVALS.length}`);
    view.when.textContent = whenText(card, st, today);
    // Состояние сменилось без ответа на этой странице (другая вкладка, новый день) — старое сообщение уже неверно.
    // После своих ответов сообщение пишется уже после updateView, поэтому не теряется.
    const stateKey = `${st.state}|${card.step}|${card.due}`;
    if (view.stateKey !== undefined && view.stateKey !== stateKey) tell(view, '');
    view.stateKey = stateKey;

    const showSecret = view.mode === 'learn' && secrets.has(card.id);
    reveal(view.learn, showSecret, animate);
    if (showSecret) renderSecret(view);
    else view.secret.replaceChildren();   // открытый текст не остаётся даже в скрытой разметке
    reveal(view.check, Boolean(view.mode), animate);
    view.streak.hidden = view.mode !== 'learn';
    renderStreak(view);
    view.practice.hidden = !(st.state === 'waiting' || st.state === 'learned');
    view.practice.textContent = view.mode === 'practice' ? 'Закрыть' : 'Потренироваться';
  }

  function renderList({ resort = false } = {}) {
    const today = T.dateKey();
    const ids = new Set(cards.map((card) => card.id));
    secrets.forEach((_, id) => { if (!ids.has(id)) secrets.delete(id); });
    order = order.filter((id) => ids.has(id));
    cards.forEach((card) => { if (!order.includes(card.id)) order.unshift(card.id); });   // новые — сверху
    if (resort) sortOrder(today);

    views.forEach((view, id) => {
      if (ids.has(id)) return;
      view.node.remove();
      views.delete(id);
    });

    let anchor = mem.list.firstElementChild;
    order.forEach((id) => {
      let view = views.get(id);
      if (!view) {
        view = createView(id);
        views.set(id, view);
      }
      while (anchor && anchor.classList.contains('is-leaving')) anchor = anchor.nextElementSibling;
      if (anchor === view.node) anchor = anchor.nextElementSibling;
      else mem.list.insertBefore(view.node, anchor);
      updateView(view, today);
    });
    renderSummary(today);
  }

  const badge = node('span', 'tab-badge');
  badge.hidden = true;
  $('tab-trainer').append(badge);

  function renderSummary(today = T.dateKey()) {
    const states = cards.map((card) => T.status(card, today).state);
    const learning = states.filter((s) => s === 'learning').length;
    const due = states.filter((s) => s === 'due').length;
    const learned = states.filter((s) => s === 'learned').length;

    mem.head.hidden = cards.length === 0;
    const parts = [count(cards.length, PASSWORDS)];
    if (due) parts.push(`пора повторить: ${due}`);
    if (learning) parts.push(`заучиваются: ${learning}`);
    if (learned) parts.push(`выучено: ${learned}`);
    mem.summary.textContent = parts.join(' · ');

    // Число на вкладке — сколько карточек ждут ввода прямо сейчас.
    const waiting = due + learning;
    badge.hidden = waiting === 0;
    badge.replaceChildren(node('span', '', String(waiting)), node('span', 'sr-only', `, ждут повторения: ${waiting}`));
    badge.firstChild.setAttribute('aria-hidden', 'true');

    const full = cards.length >= T.MAX_CARDS;
    mem.addLead.textContent = full
      ? `Это максимум — ${count(T.MAX_CARDS, PASSWORDS)}. Удалите выученные, чтобы добавить новые.`
      : 'Добавьте пароль или фразу, которую хотите помнить наизусть.';
    renderStored();
  }

  function focusCard(view) {
    view.node.focus({ preventScroll: true });
  }

  /* ---------- Запоминание: ввод по памяти ---------- */

  function setViewBusy(view, busy) {
    view.busy = busy;
    view.submit.disabled = busy;
    view.submit.classList.toggle('is-busy', busy);
    view.submitLabel.textContent = busy ? 'Проверяю…' : 'Проверить';
    view.input.readOnly = busy;
  }

  async function submitView(view) {
    if (view.busy || !view.mode || !cardOf(view.id)) return;
    const attempt = view.input.value;
    if (!attempt) {
      tell(view, 'Введите пароль по памяти.', 'warn');
      BBMotion.shake(view.input);
      view.input.focus();
      return;
    }
    let ok;
    if (view.mode === 'learn' && secrets.has(view.id)) {
      ok = T.same(attempt, secrets.get(view.id));   // пароль ещё в памяти — хеш не нужен
    } else {
      setViewBusy(view, true);
      try {
        ok = await T.verify(cardOf(view.id), attempt);
      } catch {
        ok = null;
      }
      setViewBusy(view, false);
      if (!cardOf(view.id)) return;   // карточку удалили, пока шла проверка
      if (ok === null) {
        tell(view, 'Не получилось проверить: браузер не поддерживает Web Crypto. Откройте страницу по https.', 'error');
        return;
      }
    }
    const today = T.dateKey();
    if (view.mode === 'learn') learnStep(view, ok, today);
    else if (view.mode === 'review') reviewStep(view, ok, today);
    else practiceStep(view, ok, today);
  }

  function wrong(view) {
    BBMotion.shake(view.input);
    view.input.focus();
    view.input.select();
  }

  // Заучивание: 3 раза подряд без ошибок. Ошибка или подсказка — серия заново.
  function learnStep(view, ok, today) {
    if (!ok) {
      view.run = 0;
      view.fails += 1;
      renderStreak(view);
      if (secrets.has(view.id)) {
        cover(view, false);
        tell(view, 'Не совпало. Посмотрите на пароль ещё раз и введите заново — серия начинается сначала.', 'error');
      } else {
        tell(view, view.fails >= 3
          ? 'Не совпало. Если пароль не вспоминается, удалите карточку и добавьте его заново — тогда тренажёр снова его покажет.'
          : 'Не совпало — серия начинается сначала.', 'error');
      }
      wrong(view);
      return;
    }
    view.run += 1;
    view.fails = 0;
    view.input.value = '';
    if (view.run < T.LEARN_STREAK) {
      renderStreak(view);
      BBMotion.pop(view.streak.children[view.run - 1]);
      const left = T.LEARN_STREAK - view.run;
      tell(view, left === 1 ? 'Верно! Ещё один раз.' : `Верно! Ещё ${count(left, TIMES)} подряд.`, 'success');
      view.input.focus();
      return;
    }
    const card = T.finishLearning(cardOf(view.id), today);
    replaceCard(card);
    secrets.delete(card.id);   // открытый текст больше не нужен
    view.run = 0;
    view.covered = false;
    view.mode = null;
    persist();
    updateView(view, today, true);
    renderSummary(today);
    tell(view, `Готово, пароль заучен! Первое повторение — ${whenDue(card.due, today)}.`, 'success');
    BBMotion.pop(view.chip);
    focusCard(view);
  }

  // Повторение по расписанию: решает первая попытка.
  function reviewStep(view, ok, today) {
    const before = cardOf(view.id);
    const card = T.review(before, ok, today);
    replaceCard(card);
    persist();
    if (ok) {
      view.mode = null;
      view.fails = 0;
      view.input.value = '';
      updateView(view, today, true);
      tell(view, card.due === null
        ? `Верно! Все ${T.INTERVALS.length} повторений пройдены — пароль выучен.`
        : `Верно с первой попытки! Следующее повторение — ${whenDue(card.due, today)}.`, 'success');
      BBMotion.pop(view.chip);
      focusCard(view);
    } else {
      view.mode = 'practice';
      view.fails = 1;
      updateView(view, today, true);
      const back = before.step > 0 ? 'Шаг назад: следующее' : 'Следующее';
      tell(view, `Не совпало. ${back} повторение — ${whenDue(card.due, today)}. `
        + 'Попробуйте ещё раз — эти попытки расписание уже не меняют.', 'error');
      wrong(view);
    }
    renderSummary(today);
  }

  // Тренировка вне расписания: ничего не меняет.
  function practiceStep(view, ok, today) {
    const card = cardOf(view.id);
    if (!ok) {
      view.fails += 1;
      tell(view, view.fails >= 3 ? FORGOT : 'Не совпало. Попробуйте ещё раз.', 'error');
      wrong(view);
      return;
    }
    view.mode = null;
    view.fails = 0;
    view.input.value = '';
    updateView(view, today, true);
    tell(view, card.due === null
      ? 'Верно! Пароль по-прежнему в памяти.'
      : `Верно! Расписание не меняется: следующее повторение — ${whenDue(card.due, today)}.`, 'success');
    focusCard(view);
  }

  function peek(view) {
    if (!view.covered) {
      cover(view, true);
      view.input.focus();
      return;
    }
    cover(view, false);
    view.input.value = '';
    if (view.run > 0) {
      view.run = 0;
      renderStreak(view);
      tell(view, 'Подсмотрели — серия начинается заново.', 'info');
    }
    view.input.focus();
  }

  function togglePractice(view) {
    const open = view.mode !== 'practice';
    view.mode = open ? 'practice' : null;
    view.fails = 0;
    view.input.value = '';
    tell(view, '');
    updateView(view, T.dateKey(), true);
    if (open) view.input.focus();
    else view.practice.focus();
  }

  /* ---------- Запоминание: удаление ---------- */

  function resetRemove(view) {
    clearTimeout(view.confirmTimer);
    view.confirming = false;
    view.remove.textContent = 'Удалить';
    view.remove.classList.remove('is-danger');
  }

  // Карточка плавно схлопывается, соседние подъезжают на её место.
  function collapse(item) {
    item.classList.add('is-leaving');
    const style = getComputedStyle(item);
    const gap = parseFloat(getComputedStyle(mem.list).rowGap) || 0;
    item.style.overflow = 'hidden';
    const animation = BBMotion.animate(item, [
      {
        height: `${item.offsetHeight}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
        borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth,
        marginBottom: '0px', opacity: 1, transform: 'none',
      },
      {
        height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
        marginBottom: `${-gap}px`, opacity: 0, transform: 'scale(.98)',
      },
    ], { duration: 320 });
    if (animation) animation.onfinish = () => item.remove();
    else item.remove();
  }

  function removeCard(view) {
    if (!view.confirming) {
      view.confirming = true;
      view.remove.textContent = 'Точно удалить?';
      view.remove.classList.add('is-danger');
      BBMotion.pop(view.remove);
      clearTimeout(view.confirmTimer);
      view.confirmTimer = setTimeout(() => resetRemove(view), 4000);
      return;
    }
    resetRemove(view);
    const index = order.indexOf(view.id);
    cards = cards.filter((card) => card.id !== view.id);
    secrets.delete(view.id);
    views.delete(view.id);
    order = order.filter((id) => id !== view.id);
    persist();
    collapse(view.node);
    renderSummary();
    const nextId = order[index] || order[index - 1];
    if (nextId) focusCard(views.get(nextId));
    else mem.name.focus({ preventScroll: true });
  }

  /* ---------- Запоминание: новый пароль ---------- */

  const setPasswordVisible = bindToggle(mem.toggle, mem.password, 'Показать пароль', 'Скрыть пароль');
  let addBusy = false;
  let dictionariesAsked = false;

  function nextName(base) {
    const names = new Set(cards.map((card) => card.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  function showAddError(text) {
    mem.error.textContent = text;
  }

  // Оценка детектора хитростей: слабый пароль учить незачем.
  function renderStrength() {
    const password = mem.password.value;
    if (!password) {
      mem.strength.replaceChildren();
      delete mem.strength.dataset.level;
      return;
    }
    if (!dictionariesAsked) {
      dictionariesAsked = true;
      loadDictionaries().then(renderStrength, () => {});
    }
    const result = BBPatterns.analyze(password);
    const level = BBEntropy.strength(result.bits);
    BBUI.setLevel(mem.strength, level.level);
    const parts = ['Стойкость — ', node('b', '', level.label.toLowerCase()), `, ${bits(result.bits)}.`];
    if (level.level <= 1) parts.push(' Такой пароль подберут быстро — лучше выучить случайный из генератора или фразу.');
    mem.strength.replaceChildren(...parts);
  }

  function setAddBusy(busy) {
    addBusy = busy;
    mem.submit.disabled = busy;
    mem.submit.classList.toggle('is-busy', busy);
    mem.submitLabel.textContent = busy ? 'Считаю хеш…' : 'Начать учить';
    mem.password.readOnly = busy;
  }

  async function addCard() {
    if (addBusy) return;
    const password = mem.password.value;
    showAddError('');
    if (!password) {
      showAddError('Введите пароль или нажмите «Придумать фразу».');
      BBMotion.shake(mem.password);
      mem.password.focus();
      return;
    }
    if (cards.length >= T.MAX_CARDS) {
      showAddError(`Одновременно можно учить до ${count(T.MAX_CARDS, PASSWORDS)}. Удалите выученные.`);
      return;
    }
    const name = T.cleanName(mem.name.value) || nextName(/\S\s+\S/.test(password) ? 'Фраза' : 'Пароль');
    setAddBusy(true);
    let card;
    try {
      card = await T.createCard(name, password);
    } catch {
      setAddBusy(false);
      showAddError('Не получилось: браузер не поддерживает Web Crypto. Откройте страницу по https.');
      return;
    }
    setAddBusy(false);

    cards.push(card);
    secrets.set(card.id, password);
    order.unshift(card.id);
    mem.password.value = '';
    mem.name.value = '';
    setPasswordVisible(false);
    renderStrength();
    persist();
    renderList();

    const view = views.get(card.id);
    BBMotion.enter(view.node, { y: 14, duration: 440 });
    view.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    view.input.focus({ preventScroll: true });
  }

  function fillForm(text, name) {
    mem.password.value = text;
    setPasswordVisible(true);
    if (!mem.name.value.trim()) mem.name.value = nextName(name);
    showAddError('');
    renderStrength();
  }

  mem.submit.addEventListener('click', addCard);
  [mem.name, mem.password].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addCard();
  }));
  mem.password.addEventListener('input', () => {
    showAddError('');
    renderStrength();
  });
  mem.phrase.addEventListener('click', () => {
    fillForm(BBPhrase.generate({ words: 6 }).text, 'Фраза');
    BBMotion.enter(mem.password, { y: 4, duration: 300 });
  });

  /* ---------- Запоминание: расписание «если начать сегодня» ---------- */

  function renderPlan(today = T.dateKey()) {
    const dates = T.plan(today);
    const items = [['Сегодня', `${T.LEARN_STREAK} раза подряд`]];
    dates.forEach((date, i) => {
      const gap = `+${count(T.INTERVALS[i], DAYS)}`;
      items.push([formatDate(date), i === dates.length - 1 ? `${gap}, выучен` : gap]);
    });
    mem.plan.replaceChildren(...items.map(([date, note]) => {
      const item = node('li');
      item.append(node('b', 'timeline-date', date), node('span', 'timeline-note', note));
      return item;
    }));
  }

  /* ---------- Запоминание: обновление ---------- */

  function refresh() {
    renderPlan();
    renderList();
  }

  // Другая вкладка с BastionBit изменила карточки.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== T.STORAGE_KEY) return;
    loadCards();
    renderStorage();
    renderList();
  });

  // Вернулись на страницу или наступил новый день — сроки могли подойти.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  function scheduleMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => {
      refresh();
      scheduleMidnight();
    }, next - now);
  }

  /* ---------- Взломай сам ---------- */

  const gm = {
    steps: Array.from($('game-steps').children),
    intro: $('game-intro'),
    start: $('game-start'),
    card: $('game-card'),
    level: $('game-level'),
    title: $('game-title'),
    attempts: $('game-attempts'),
    pips: $('game-pips'),
    task: $('game-task'),
    profile: $('game-profile'),
    avatar: $('game-avatar'),
    person: $('game-person'),
    facts: $('game-facts'),
    spaceCount: $('game-space-count'),
    spaceFill: $('game-space-fill'),
    spaceNote: $('game-space-note'),
    play: $('game-play'),
    input: $('game-input'),
    guess: $('game-guess'),
    feedback: $('game-feedback'),
    hints: $('game-hints'),
    guesses: $('game-guesses'),
    giveup: $('game-giveup'),
    result: $('game-result'),
    verdict: $('game-verdict'),
    secret: $('game-secret'),
    machineTry: $('game-machine-try'),
    machineCount: $('game-machine-count'),
    lesson: $('game-lesson'),
    next: $('game-next'),
    nextLabel: $('game-next').querySelector('.button-label'),
    summary: $('game-summary'),
    table: $('game-table'),
    restart: $('game-restart'),
  };

  const ONLINE = BBEntropy.SCENARIOS.find((s) => s.id === 'online');
  const MD5 = BBEntropy.SCENARIOS.find((s) => s.id === 'md5');
  const POOL = 26 + 26 + 10 + BBEntropy.SYMBOLS.length;   // все наборы генератора
  const BRUTE_MS = 2000;   // сколько показывать перебор случайного пароля

  const TASKS = {
    popular: 'Владелец взял один из двадцати самых популярных паролей в мире. Угадайте его за 10 попыток.',
    pin: 'Загадан PIN-код: 4 цифры, от 0000 до 9999. После каждой попытки вы узнаете, больше загаданное число или меньше.',
    personal: 'Пароль собран из того, что владелец рассказал о себе. Набран латиницей, маленькими буквами: кличка Барсик — это barsik.',
    random: 'Пароль из 8 случайных символов: строчные и заглавные буквы, цифры и знаки. Попыток — 10.',
  };
  const PLACEHOLDERS = {
    popular: 'например, qwerty',
    pin: '4 цифры',
    personal: 'латиницей, без пробелов',
    random: '8 символов',
  };

  let game = null;      // текущий уровень (BBGame.start)
  let results = [];     // итоги пройденных уровней
  let replay = 0;       // кадр анимации «программы-взломщика»

  // 10 000 → «10 000», 2,8·10¹⁵ → «2,8·10<sup>15</sup>» (HTML)
  function formatCount(n) {
    if (n < 1e6) return nf0.format(Math.round(n));
    let e = Math.floor(Math.log10(n));
    let m = Math.round((n / 10 ** e) * 10) / 10;
    if (m >= 10) {
      m = 1;
      e += 1;
    }
    return `${nf1.format(m)}·10<sup>${e}</sup>`;
  }

  const timeText = (seconds) => BBEntropy.formatDuration(Math.log10(seconds)).html;
  const crackText = (value, speed) => BBEntropy.formatDuration(BBEntropy.crackTimeLog10(value, speed)).html;

  function feedback(text, tone) {
    gm.feedback.textContent = text;
    gm.feedback.dataset.tone = tone;
    if (text) BBMotion.enter(gm.feedback, { y: -3, duration: 240 });
  }

  function renderSteps() {
    gm.steps.forEach((step, i) => {
      const result = results[i];
      const current = Boolean(game) && game.index === i;
      step.classList.toggle('is-current', current);
      step.classList.toggle('is-done', Boolean(result) && result.solved);
      step.classList.toggle('is-failed', Boolean(result) && !result.solved);
      if (current) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  function renderProfile(profile) {
    const own = profile.female ? 'Её' : 'Его';
    const facts = [
      `Живёт ${profile.city}`,
      `${profile.female ? 'Родилась' : 'Родился'} ${profile.birthday}`,
      `Болеет за «${profile.team}»`,
      `${own} ${profile.pet.animal.toLowerCase()} ${profile.pet.name} — на каждой второй фотографии`,
    ];
    gm.avatar.textContent = profile.name[0];
    gm.person.textContent = profile.name;
    gm.facts.replaceChildren(...facts.map((fact) => node('li', '', fact)));
  }

  function renderAttempts() {
    const left = game.maxAttempts - game.used;
    gm.attempts.textContent = `Попыток осталось: ${left} из ${game.maxAttempts}`;
    if (gm.pips.children.length !== game.maxAttempts) {
      gm.pips.replaceChildren(...Array.from({ length: game.maxAttempts }, () => node('span')));
    }
    Array.from(gm.pips.children).forEach((pip, i) => pip.classList.toggle('is-used', i < game.used));
  }

  function renderSpace() {
    const left = BBGame.variants(game);
    gm.spaceCount.innerHTML = formatCount(left);
    gm.spaceFill.style.transform = `scaleX(${Math.max(left / game.total, 0.004)})`;
    const range = game.id === 'pin'
      ? `От ${String(game.lo).padStart(4, '0')} до ${String(game.hi).padStart(4, '0')}. `
      : '';
    const sense = game.id === 'random'
      ? ' — вручную столько не перебрать.'
      : ': столько вопросов «да или нет» нужно, чтобы найти пароль.';
    gm.spaceNote.textContent = game.solved
      ? 'Это 0 бит: пароль найден, спрашивать больше нечего.'
      : `${range}Это ${bits(Math.log2(left))}${sense}`;
  }

  function addHint(hint) {
    const item = node('li', 'game-hint');
    const lost = Math.log2(hint.before / hint.after);
    item.append(
      node('span', 'game-hint-text', `Подсказка: ${hint.text}.`),
      node('b', 'game-hint-bits', `−${bits(lost)}`),
      node('span', 'game-hint-note', `было ${count(hint.before, VARIANTS)}, стало ${nf0.format(hint.after)}`),
    );
    gm.hints.append(item);
    BBMotion.enter(item, { y: 6, duration: 320 });
  }

  function addGuess(out) {
    const item = node('li', `game-guess is-${out.status}`);
    item.append(node('span', 'game-guess-text', out.text));
    if (out.status === 'higher' || out.status === 'lower') {
      const mark = node('span', 'game-guess-mark', out.status === 'higher' ? '↑' : '↓');
      mark.setAttribute('aria-hidden', 'true');
      item.append(mark, node('span', 'sr-only', out.status === 'higher' ? ', загаданное больше' : ', загаданное меньше'));
    }
    gm.guesses.append(item);
    BBMotion.enter(item, { y: 4, duration: 260 });
  }

  function startLevel(index) {
    cancelAnimationFrame(replay);
    game = BBGame.start(BBGame.LEVELS[index].id);
    gm.intro.hidden = true;
    gm.summary.hidden = true;
    gm.card.hidden = false;
    gm.result.hidden = true;
    gm.play.hidden = false;
    gm.level.textContent = `Уровень ${index + 1} из ${BBGame.LEVELS.length}`;
    gm.title.textContent = game.title;
    gm.task.textContent = TASKS[game.id];
    gm.profile.hidden = game.id !== 'personal';
    if (game.id === 'personal') renderProfile(game.profile);
    gm.input.value = '';
    gm.input.placeholder = PLACEHOLDERS[game.id];
    gm.input.inputMode = game.id === 'pin' ? 'numeric' : 'text';
    gm.input.maxLength = game.id === 'pin' ? 4 : 32;
    feedback('', 'info');
    gm.hints.replaceChildren();
    gm.guesses.replaceChildren();
    gm.machineTry.classList.remove('is-found');
    renderAttempts();
    renderSpace();
    renderSteps();
    BBMotion.enter(gm.card, { x: 20, y: 0, duration: 380 });
    const top = gm.card.getBoundingClientRect().top;
    if (top < 72) window.scrollBy({ top: top - 72, behavior: 'smooth' });   // под прилипшими вкладками
    gm.input.focus({ preventScroll: true });
  }

  function submitGuess() {
    if (!game || game.done) return;
    const out = BBGame.guess(game, gm.input.value);
    if (out.status === 'invalid' || out.status === 'repeat') {
      feedback(out.message, 'warn');
      BBMotion.shake(gm.input);
      gm.input.focus();
      gm.input.select();
      return;
    }
    gm.input.value = '';
    addGuess(out);
    renderAttempts();
    renderSpace();
    if (out.hint) addHint(out.hint);
    if (out.status === 'correct') {
      finishLevel();
      return;
    }
    if (out.status === 'wrong') {
      feedback('Не угадали.', 'error');
      BBMotion.shake(gm.input);
    } else {
      feedback(`Загаданное число ${out.status === 'higher' ? 'больше' : 'меньше'} ${out.text}.`, 'info');
    }
    if (game.done) finishLevel();
    else gm.input.focus();
  }

  function verdictText(state) {
    if (state.solved) {
      return state.id === 'random'
        ? `Невероятно: угадали за ${count(state.used, ATTEMPTS_FOR)}!`
        : `Угадали за ${count(state.used, ATTEMPTS_FOR)}!`;
    }
    if (state.id === 'random') return state.gaveUp ? 'Вы сдались — и правильно: такой пароль не угадать.' : 'Не угадали — и никто бы не угадал.';
    return state.gaveUp ? 'Вы сдались.' : 'Попытки кончились.';
  }

  // Детектор хитростей знает словари, только когда они загружены.
  function detector(secret) {
    const result = BBPatterns.analyze(secret);
    return { formula: bits(result.naiveBits), real: bits(result.bits), found: result.found && BBPatterns.ready() };
  }

  function lessonFor(state) {
    const m = state.machine;
    if (state.id === 'popular') {
      const d = detector(state.secret);
      return `По формуле «длина × набор символов» у этого пароля ${d.formula}. Но взломщик не перебирает всё подряд: `
        + `он начинает со списков популярных паролей, а <b>${state.secret}</b> в них ${m.attempts}-й. `
        + (d.found ? `Детектор хитростей BastionBit даёт ему ${d.real}.` : 'Такие пароли подбирают первыми.');
    }
    if (state.id === 'pin') {
      return `10 000 вариантов — это ${bits(Math.log2(BBGame.PIN_TOTAL))}. Ответ «больше» или «меньше» — это 1 бит: `
        + 'он отсекает половину оставшихся вариантов. Поэтому 14 попыток хватает всегда: '
        + '2<sup>14</sup> = 16&nbsp;384 больше 10&nbsp;000. Без подсказок перебирать пришлось бы в среднем 5&nbsp;000 PIN-кодов — '
        + 'поэтому банковская карта и блокируется после трёх ошибок.';
    }
    if (state.id === 'personal') {
      const d = detector(state.secret);
      return `По формуле у этого пароля ${d.formula} — как у неплохого. Но взломщик, который прочитал профиль, `
        + `соберёт из кличек, имён, команды и дат всего ${count(state.total, VARIANTS)} — это ${bits(Math.log2(state.total))}. `
        + 'Личные данные знают друзья и находят поисковики, поэтому в пароль их не берут.';
    }
    return `${bits(state.bits)} — это ${formatCount(2 ** state.bits)} вариантов, вручную не угадать. `
      + `Через форму входа (10 попыток в секунду) перебор займёт ${crackText(state.bits, ONLINE.speed)}. `
      + `Но если база сайта утечёт, а пароли в ней защищены быстрым MD5, видеокарта справится за ${crackText(state.bits, MD5.speed)}. `
      + `16 случайных символов — уже ${crackText(16 * Math.log2(POOL), MD5.speed)}.`;
  }

  // «Программа-взломщик» перебирает свой список с начала.
  function runMachine(state) {
    cancelAnimationFrame(replay);
    if (state.id === 'random') {
      runBrute(state);
      return;
    }
    const m = state.machine;
    const label = (k) => (state.id === 'pin' ? String(k - 1).padStart(4, '0') : m.list[k - 1]);
    const duration = state.id === 'pin' ? 1800 : Math.min(2200, 110 * m.attempts);
    const started = performance.now();
    const frame = (now) => {
      const p = BBMotion.unsupported() ? 1 : Math.min(1, (now - started) / duration);
      const k = Math.max(1, Math.round(p * m.attempts));
      gm.machineTry.textContent = label(k);
      gm.machineCount.textContent = `Попытка ${nf0.format(k)}`;
      if (p < 1) {
        replay = requestAnimationFrame(frame);
        return;
      }
      gm.machineTry.classList.add('is-found');
      BBMotion.pop(gm.machineTry);
      gm.machineCount.innerHTML = state.id === 'pin'
        ? `Перебор по порядку: ${count(m.attempts, ATTEMPTS)}. Через форму входа — ${timeText(m.attempts / ONLINE.speed)}.`
        : state.id === 'popular'
          ? `Нашла с ${nf0.format(m.attempts)}-й попытки: проверяет пароли от самых популярных.`
          : `Нашла с ${nf0.format(m.attempts)}-й попытки из ${m.list.length}.`;
    };
    replay = requestAnimationFrame(frame);
  }

  // Случайный пароль: 2 секунды перебора со скоростью видеокарты (MD5).
  function runBrute(state) {
    const total = 2 ** state.bits;
    const started = performance.now();
    let shown = 0;
    const frame = (now) => {
      const elapsed = BBMotion.unsupported() ? BRUTE_MS : Math.min(BRUTE_MS, now - started);
      if (now - shown > 60 || elapsed >= BRUTE_MS) {
        gm.machineTry.textContent = BBGenerator.generate(BBGame.RANDOM_OPTIONS);
        shown = now;
      }
      const tried = (MD5.speed * elapsed) / 1000;
      gm.machineCount.innerHTML = `Перебрано ${formatCount(tried)} ${tried < 1e6 ? BBEntropy.plural(Math.round(tried), VARIANTS) : 'вариантов'}`;
      if (elapsed < BRUTE_MS) {
        replay = requestAnimationFrame(frame);
        return;
      }
      gm.machineTry.textContent = '…';
      gm.machineCount.innerHTML = `За 2 секунды видеокарта перебрала ${formatCount(tried)} вариантов — `
        + `${nf2.format((tried / total) * 100)}&nbsp;% от всех.`;
    };
    replay = requestAnimationFrame(frame);
  }

  function finishLevel() {
    const state = game;
    gm.play.hidden = true;
    results[state.index] = {
      title: state.title, id: state.id, total: state.total, solved: state.solved, gaveUp: state.gaveUp,
      used: state.used, machine: state.machine, bits: state.id === 'random' ? state.bits : Math.log2(state.total),
    };
    renderSteps();
    gm.verdict.textContent = verdictText(state);
    gm.verdict.dataset.tone = state.solved ? 'success' : 'error';
    renderPassword(gm.secret, state.secret);
    gm.lesson.innerHTML = lessonFor(state);
    gm.nextLabel.textContent = state.index === BBGame.LEVELS.length - 1 ? 'Посмотреть итоги' : 'Следующий уровень';
    BBMotion.show(gm.result, { y: 10 });
    BBMotion.stagger(gm.secret.children, { step: 30, y: 6 });
    runMachine(state);
    gm.next.focus({ preventScroll: true });
  }

  function renderTable() {
    gm.table.replaceChildren(...results.map((r) => {
      const row = node('tr');
      const you = r.solved ? `за ${count(r.used, ATTEMPTS_FOR)}` : r.gaveUp ? 'сдались' : 'не угадали';
      const machine = r.id === 'random'
        ? `${crackText(r.bits, MD5.speed)} (MD5)`
        : `с ${nf0.format(r.machine.attempts)}-й попытки`;
      const cells = [
        ['', r.title, false], ['num', formatCount(r.total), true], ['num', bits(r.bits), false],
        ['', you, false], ['', machine, true],
      ];
      cells.forEach(([className, value, html]) => {
        const cell = node('td', className);
        if (html) cell.innerHTML = value;
        else cell.textContent = value;
        row.append(cell);
      });
      return row;
    }));
  }

  function showSummary() {
    cancelAnimationFrame(replay);
    game = null;
    gm.card.hidden = true;
    renderSteps();
    renderTable();
    BBMotion.show(gm.summary, { y: 10 });
    BBMotion.stagger(gm.table.children, { step: 70, y: 6, duration: 380 });
    const top = gm.summary.getBoundingClientRect().top;
    if (top < 72) window.scrollBy({ top: top - 72, behavior: 'smooth' });
    gm.restart.focus({ preventScroll: true });
  }

  function newGame() {
    results = [];
    loadDictionaries().catch(() => {});
    startLevel(0);
  }

  gm.start.addEventListener('click', newGame);
  gm.restart.addEventListener('click', newGame);
  gm.guess.addEventListener('click', submitGuess);
  gm.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitGuess();
  });
  gm.giveup.addEventListener('click', () => {
    if (!game || game.done) return;
    BBGame.giveUp(game);
    finishLevel();
  });
  gm.next.addEventListener('click', () => {
    if (!game) return;
    const next = game.index + 1;
    if (next < BBGame.LEVELS.length) startLevel(next);
    else showSummary();
  });

  /* ---------- Запуск ---------- */

  BBMotion.details(mem.stored);
  loadCards();
  renderStorage();
  renderPlan();
  renderList({ resort: true });
  scheduleMidnight();
  const checked = modeRadios.find((radio) => radio.checked);
  showMode(checked ? checked.value : 'memory');

  // Вкладку «Тренажёр» открыли: обновить сроки и порядок карточек.
  function show() {
    renderPlan();
    renderList({ resort: true });
    placeThumb();
  }

  // Фраза из генератора: подставить в форму, чтобы начать её учить.
  function learn(text, name = 'Фраза') {
    selectMode('memory');
    fillForm(text, name);
    requestAnimationFrame(() => {
      mem.add.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mem.name.focus({ preventScroll: true });
      mem.name.select();
    });
  }

  return { show, learn };
})();
