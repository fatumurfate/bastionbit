// Браузерные тесты этапа 3: тренажёр и «Взломай сам». Запуск: node tests/trainer-browser-test.js (нужен Playwright, см. README)
const { chromium } = require('playwright');
const path = require('path');
const url = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const shots = path.join(__dirname, 'shots');
require('fs').mkdirSync(shots, { recursive: true });
const PW = 'Correct-Horse-42';
const KEY = 'bastionbit-trainer';

let failed = 0, passed = 0;
const check = (name, cond, extra = '') => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra); } };

async function noMotion(context) {
  await context.addInitScript(() => {
    Element.prototype.animate = undefined;
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
      document.head.append(style);
    });
  });
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cardBy = (page, name) => page.locator('.memory-card', { has: page.locator('.memory-name', { hasText: new RegExp(`^${name}$`) }) });
const text = async (loc) => ((await loc.textContent()) || '').trim();
const readCards = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).cards, KEY);
const dayIn = (page, n) => page.evaluate((n) => BBTrainer.addDays(BBTrainer.dateKey(), n), n);

// Ввести ответ в карточке и дождаться проверки хеша
async function answer(card, value) {
  await card.locator('.memory-input').fill(value);
  await card.locator('.memory-input').press('Enter');
  const id = await card.getAttribute('data-id');
  await card.page().waitForFunction((id) => {
    const button = document.querySelector(`.memory-card[data-id="${id}"] .memory-submit`);
    return !button || !button.classList.contains('is-busy');
  }, id, { timeout: 20000 });
}

async function addCard(page, name, password) {
  await page.fill('#mem-name', name);
  await page.fill('#mem-password', password);
  await page.click('#mem-submit');
  await cardBy(page, name).waitFor({ timeout: 20000 });
  return cardBy(page, name);
}

async function learnFully(card, password) {
  for (let i = 0; i < 3; i++) await answer(card, password);
}

// Поменять карточки в localStorage (сдвиги дат — в днях от сегодня) и перезагрузить
async function patchCards(page, patches) {
  await page.evaluate(({ patches, key }) => {
    const T = BBTrainer;
    const today = T.dateKey();
    const data = JSON.parse(localStorage.getItem(key));
    data.cards = data.cards.map((card) => {
      const p = patches[card.name];
      if (!p) return card;
      const next = { ...card };
      if ('step' in p) next.step = p.step;
      if ('dueIn' in p) next.due = p.dueIn === null ? null : T.addDays(today, p.dueIn);
      if ('lastIn' in p) next.last = p.lastIn === null ? null : T.addDays(today, p.lastIn);
      return next;
    });
    localStorage.setItem(key, JSON.stringify(data));
  }, { patches, key: KEY });
  await page.reload();
}

async function guess(page, value) {
  await page.fill('#game-input', value);
  await page.press('#game-input', 'Enter');
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  /* ---------- Запоминание ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  await noMotion(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '#trainer');

  check('trainer tab open', await page.isVisible('#panel-trainer'));
  check('memory mode first', await page.isVisible('#tr-memory') && await page.isHidden('#tr-game'));
  check('empty: no list head, badge, stored', await page.isHidden('#mem-list-head') && await page.isHidden('.tab-badge') && await page.isHidden('#mem-stored'));
  const plan = await page.$$eval('#mem-plan li', (lis) => lis.map((li) => li.textContent));
  const planDates = await page.evaluate(() => BBTrainer.plan().map((d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(d + 'T00:00'))));
  check('plan: today + 5 dates', plan.length === 6 && plan[0] === 'Сегодня3 раза подряд' && plan[5].endsWith('+30 дней, выучен'), JSON.stringify(plan));
  check('plan: dates', planDates.every((d, i) => plan[i + 1].startsWith(d) && plan[i + 1].includes('+')), JSON.stringify(planDates));

  await page.click('#mem-submit');
  check('empty password error', (await text(page.locator('#mem-error'))).startsWith('Введите пароль'));
  await page.fill('#mem-password', 'qwerty123');
  check('error cleared on input', (await text(page.locator('#mem-error'))) === '');
  await page.waitForFunction(() => typeof BB_DICT_RU === 'string' && BBPatterns.ready() &&
    document.getElementById('mem-strength').textContent.includes('очень слабый'), null, { timeout: 20000 });
  check('weak password advice', (await text(page.locator('#mem-strength'))).includes('подберут быстро'));
  await page.fill('#mem-password', PW);
  const strength = await text(page.locator('#mem-strength'));
  check('strength of new password', strength.startsWith('Стойкость — ') && !strength.includes('подберут'), strength);

  await page.fill('#mem-name', 'Почта');
  await page.click('#mem-submit');
  check('busy while hashing', (await text(page.locator('#mem-submit .button-label'))) === 'Считаю хеш…');
  const mail = cardBy(page, 'Почта');
  await mail.waitFor({ timeout: 20000 });
  check('card: learning', (await text(mail.locator('.memory-state'))) === 'Заучивание');
  check('card: password shown', (await text(mail.locator('.memory-secret'))) === PW);
  check('form cleared', (await page.inputValue('#mem-password')) === '' && (await page.inputValue('#mem-name')) === '');
  check('form password hidden again', (await page.getAttribute('#mem-password', 'type')) === 'password');
  check('badge 1', (await text(page.locator('.tab-badge [aria-hidden="true"]'))) === '1');
  check('badge for screen readers', (await text(page.locator('.tab-badge .sr-only'))).includes('1'));
  check('summary', (await text(page.locator('#mem-summary'))) === '1 пароль · заучиваются: 1', await text(page.locator('#mem-summary')));
  let raw = await page.evaluate((key) => localStorage.getItem(key), KEY);
  check('storage: no plaintext', !raw.includes('Correct') && !raw.includes('Horse'));
  check('storage: salt and hash', (() => {
    const c = JSON.parse(raw).cards[0];
    return c.name === 'Почта' && atob(c.salt).length === 16 && atob(c.hash).length === 32 && c.iterations === 600000 && c.last === null;
  })());
  check('stored details = localStorage', JSON.stringify(JSON.parse(await page.textContent('#mem-stored-json'))) === raw);

  // Заучивание: ошибка, ввод закрывает пароль, подсказка сбрасывает серию
  await answer(mail, 'Correct-Horse-41');
  check('learn: wrong', (await text(mail.locator('.memory-message'))).startsWith('Не совпало. Посмотрите'));
  await mail.locator('.memory-input').fill('C');
  check('learn: typing covers password', (await mail.locator('.memory-secret').getAttribute('class')).includes('is-covered') &&
    /^•+$/.test(await text(mail.locator('.memory-secret'))));
  await answer(mail, PW);
  check('learn: 1 of 3', (await text(mail.locator('.memory-message'))) === 'Верно! Ещё 2 раза подряд.' &&
    (await mail.locator('.memory-streak .is-on').count()) === 1);
  check('learn: streak label', (await mail.locator('.memory-streak').getAttribute('aria-label')) === 'Верно подряд: 1 из 3');
  await mail.locator('.memory-peek').click();
  check('learn: peek resets streak', (await text(mail.locator('.memory-secret'))) === PW &&
    (await mail.locator('.memory-streak .is-on').count()) === 0 && (await text(mail.locator('.memory-message'))).startsWith('Подсмотрели'));
  await answer(mail, PW);
  await answer(mail, PW);
  check('learn: one more', (await text(mail.locator('.memory-message'))) === 'Верно! Ещё один раз.');
  await answer(mail, PW);
  const tomorrow = await dayIn(page, 1);
  check('learned: waiting', (await text(mail.locator('.memory-state'))) === 'Ждёт повторения');
  check('learned: message', (await text(mail.locator('.memory-message'))).startsWith('Готово, пароль заучен! Первое повторение — завтра'));
  check('learned: password gone from page', (await text(mail.locator('.memory-secret'))) === '' && !(await page.content()).includes(PW));
  check('learned: check closed, practice offered', await mail.locator('.memory-check').isHidden() && await mail.locator('.memory-practice').isVisible());
  check('learned: badge gone', await page.isHidden('.tab-badge'));
  check('learned: first step is next', (await mail.locator('.memory-steps li').nth(0).getAttribute('class')).includes('is-current'));
  let cards = await readCards(page);
  check('learned: saved', cards[0].last === await dayIn(page, 0) && cards[0].due === tomorrow && cards[0].step === 0);

  // После перезагрузки
  await page.reload();
  check('reload: card kept', (await text(mail.locator('.memory-state'))) === 'Ждёт повторения' &&
    (await text(mail.locator('.memory-when'))).startsWith('Следующее повторение — завтра'));

  // Тренировка не меняет расписание
  raw = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await mail.locator('.memory-practice').click();
  check('practice: open', await mail.locator('.memory-check').isVisible() && (await text(mail.locator('.memory-practice'))) === 'Закрыть');
  await answer(mail, 'nope-1');
  check('practice: wrong', (await text(mail.locator('.memory-message'))) === 'Не совпало. Попробуйте ещё раз.');
  await answer(mail, 'nope-2');
  await answer(mail, 'nope-3');
  check('practice: forgot help', (await text(mail.locator('.memory-message'))).includes('хранит только хеш'));
  await answer(mail, PW);
  check('practice: right', (await text(mail.locator('.memory-message'))).startsWith('Верно! Расписание не меняется'));
  check('practice: schedule same', raw === await page.evaluate((key) => localStorage.getItem(key), KEY));
  check('practice: closed', await mail.locator('.memory-check').isHidden());

  // Пора повторить: верно с первой попытки — шаг вперёд
  await patchCards(page, { Почта: { dueIn: -2, lastIn: -3 } });
  check('due: chip', (await text(mail.locator('.memory-state'))) === 'Пора повторить');
  check('due: overdue text', (await text(mail.locator('.memory-when'))).startsWith('Пора повторить — срок был'));
  check('due: badge', (await text(page.locator('.tab-badge [aria-hidden="true"]'))) === '1');
  check('due: input open', await mail.locator('.memory-check').isVisible() && await mail.locator('.memory-practice').isHidden());
  // Playwright не передаёт состояние Caps Lock, поэтому событие создаём сами.
  const capsEvent = (on) => mail.locator('.memory-input').evaluate((input, on) =>
    input.dispatchEvent(new KeyboardEvent('keyup', { key: on ? 'A' : 'a', modifierCapsLock: on, bubbles: true })), on);
  await capsEvent(true);
  check('caps lock hint', await mail.locator('.memory-caps').isVisible());
  await capsEvent(false);
  check('caps lock hint hidden', await mail.locator('.memory-caps').isHidden());
  await answer(mail, PW);
  check('review ok: message', (await text(mail.locator('.memory-message'))).startsWith('Верно с первой попытки! Следующее повторение — через 3 дня'),
    await text(mail.locator('.memory-message')));
  cards = await readCards(page);
  check('review ok: saved', cards[0].step === 1 && cards[0].due === await dayIn(page, 3) && cards[0].reviews === 1 && cards[0].lapses === 0);
  check('review ok: steps', (await mail.locator('.memory-steps li').nth(0).getAttribute('class')).includes('is-done') &&
    (await mail.locator('.memory-steps li').nth(1).getAttribute('class')).includes('is-current'));
  check('review ok: steps label', (await mail.locator('.memory-steps').getAttribute('aria-label')) === 'Пройдено повторений: 1 из 5');

  // Ошибка с первой попытки — шаг назад, дальше тренировка
  await patchCards(page, { Почта: { dueIn: 0 } });
  await answer(mail, 'Correct-Horse-24');
  check('review fail: message', (await text(mail.locator('.memory-message'))).startsWith('Не совпало. Шаг назад: следующее повторение — завтра'),
    await text(mail.locator('.memory-message')));
  cards = await readCards(page);
  check('review fail: saved', cards[0].step === 0 && cards[0].due === tomorrow && cards[0].lapses === 1 && cards[0].reviews === 2);
  check('review fail: practice open', await mail.locator('.memory-check').isVisible() && (await text(mail.locator('.memory-practice'))) === 'Закрыть');
  await answer(mail, PW);
  check('review fail: then right', (await text(mail.locator('.memory-message'))).includes('Расписание не меняется'));
  check('review fail: schedule same', (await readCards(page))[0].step === 0);

  // Пятое повторение — выучен
  await patchCards(page, { Почта: { step: 4, dueIn: 0 } });
  await answer(mail, PW);
  check('learned all: message', (await text(mail.locator('.memory-message'))).includes('пароль выучен'));
  check('learned all: chip', (await text(mail.locator('.memory-state'))) === 'Выучен');
  check('learned all: saved', (await readCards(page))[0].due === null && (await readCards(page))[0].step === 5);
  check('learned all: 5 bars', (await mail.locator('.memory-steps li.is-done').count()) === 5);

  // Второй пароль; порядок: сначала то, что пора повторить
  const bank = await addCard(page, 'Банк', 'Тигр-и-ночь 7');
  await learnFully(bank, 'Тигр-и-ночь 7');
  await patchCards(page, { Почта: { step: 2, dueIn: 5 }, Банк: { step: 1, dueIn: -1 } });
  check('order: due first', (await text(page.locator('.memory-card .memory-name').first())) === 'Банк');
  await patchCards(page, { Почта: { dueIn: 0 }, Банк: { dueIn: 3 } });
  check('order: resorted', (await text(page.locator('.memory-card .memory-name').first())) === 'Почта');
  check('summary: 2 cards', (await text(page.locator('#mem-summary'))) === '2 пароля · пора повторить: 1', await text(page.locator('#mem-summary')));

  // Перезагрузка во время заучивания: пароль больше не показать, проверка — по хешу
  await addCard(page, 'Черновик', 'zebra-77');
  await page.reload();
  const draft = cardBy(page, 'Черновик');
  check('reload while learning: hidden password', await draft.locator('.memory-learn').isHidden() &&
    (await text(draft.locator('.memory-when'))).includes('показать его снова нельзя'));
  await answer(draft, 'zebra-78');
  check('reload while learning: wrong', (await text(draft.locator('.memory-message'))) === 'Не совпало — серия начинается сначала.');
  await learnFully(draft, 'zebra-77');
  check('reload while learning: done by hash', (await text(draft.locator('.memory-state'))) === 'Ждёт повторения');

  // Удаление в два шага
  await draft.locator('.memory-delete').click();
  check('delete: confirm', (await text(draft.locator('.memory-delete'))) === 'Точно удалить?');
  await draft.locator('.memory-delete').click();
  await page.waitForTimeout(100);
  check('delete: removed', (await page.locator('.memory-card').count()) === 2 && (await readCards(page)).length === 2);

  // Вторая вкладка видит изменения сразу
  const page2 = await ctx.newPage();
  await page2.goto(url + '#trainer');
  await cardBy(page2, 'Банк').locator('.memory-delete').click();
  await cardBy(page2, 'Банк').locator('.memory-delete').click();
  await page.waitForTimeout(300);
  check('storage event: other tab synced', (await page.locator('.memory-card').count()) === 1, String(await page.locator('.memory-card').count()));
  await page2.close();

  // Испорченные данные
  await page.evaluate((key) => localStorage.setItem(key, '{oops'), KEY);
  await page.reload();
  check('broken: notice', await page.isVisible('#mem-storage') && (await text(page.locator('#mem-storage'))).includes('повреждена'));
  check('broken: no cards', (await page.locator('.memory-card').count()) === 0);
  await addCard(page, 'Новая', 'abc-def-123');
  check('broken: overwritten by next save', await page.isHidden('#mem-storage') && (await readCards(page)).length === 1);

  // Не больше 20 паролей
  await page.evaluate(async (key) => {
    const cards = [];
    for (let i = 0; i < 20; i++) cards.push(await BBTrainer.createCard(`Карточка ${i + 1}`, `pw-${i}`, BBTrainer.dateKey(), 1000));
    localStorage.setItem(key, JSON.stringify({ version: 1, cards: cards.map((c) => BBTrainer.finishLearning(c)) }));
  }, KEY);
  await page.reload();
  check('20 cards shown', (await page.locator('.memory-card').count()) === 20 && (await text(page.locator('#mem-add-lead'))).startsWith('Это максимум'));
  await page.fill('#mem-password', 'one-more');
  await page.click('#mem-submit');
  check('limit 20', (await text(page.locator('#mem-error'))).includes('до 20 паролей'));
  await page.evaluate((key) => localStorage.removeItem(key), KEY);
  await page.reload();
  await page.fill('#mem-password', '');

  // Фраза из генератора → «Выучить»
  await page.click('#tab-generator');
  await page.click('label.mode-option:has-text("Фраза")');
  const phrase = await page.$$eval('#ph-phrase .phrase-text', (els) => els.map((e) => e.textContent).join(' '));
  await page.click('#ph-learn');
  await page.waitForTimeout(200);
  check('learn phrase: trainer open', await page.isVisible('#panel-trainer') && await page.isVisible('#tr-memory'));
  check('learn phrase: in form, visible', (await page.inputValue('#mem-password')) === phrase && (await page.getAttribute('#mem-password', 'type')) === 'text', phrase);
  check('learn phrase: name', (await page.inputValue('#mem-name')) === 'Фраза' && await page.evaluate(() => document.activeElement.id === 'mem-name'));
  await page.click('#mem-submit');
  const phraseCard = cardBy(page, 'Фраза');
  await phraseCard.waitFor({ timeout: 20000 });
  check('learn phrase: card', (await text(phraseCard.locator('.memory-secret'))) === phrase);

  // Скриншот с карточками в разных состояниях
  await addCard(page, 'Госуслуги', 'Lamp+Violet+93');
  await learnFully(cardBy(page, 'Госуслуги'), 'Lamp+Violet+93');
  await addCard(page, 'Почта', PW);
  await learnFully(cardBy(page, 'Почта'), PW);
  await addCard(page, 'Банк', 'Тигр-и-ночь 7');
  await learnFully(cardBy(page, 'Банк'), 'Тигр-и-ночь 7');
  await page.evaluate((key) => {   // состояния без перезагрузки: заучивание фразы остаётся на экране
    const T = BBTrainer;
    const today = T.dateKey();
    const data = JSON.parse(localStorage.getItem(key));
    const set = { Госуслуги: { step: 5, due: null }, Почта: { step: 2, due: today }, Банк: { step: 3, due: T.addDays(today, 9) } };
    data.cards = data.cards.map((c) => (set[c.name] ? { ...c, ...set[c.name], reviews: set[c.name].step, last: T.addDays(today, -7) } : c));
    localStorage.setItem(key, JSON.stringify(data));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, KEY);
  await page.click('#tab-generator');
  await page.click('#tab-trainer');   // открытие вкладки пересортировывает карточки
  await page.waitForTimeout(100);
  const names = await page.$$eval('.memory-card .memory-name', (els) => els.map((e) => e.textContent));
  check('screenshot states order', JSON.stringify(names) === JSON.stringify(['Фраза', 'Почта', 'Банк', 'Госуслуги']), JSON.stringify(names));
  check('badge counts due + learning', (await text(page.locator('.tab-badge [aria-hidden="true"]'))) === '2');
  check('external change clears old messages', (await page.$$eval('.memory-card .memory-message', (els) => els.map((e) => e.textContent))).join('') === '');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(shots, '15-trainer-memory.png'), fullPage: true });

  /* ---------- Взломай сам ---------- */
  await page.click('label.mode-option:has-text("Взломай сам")');
  check('game: panel', await page.isVisible('#tr-game') && await page.isHidden('#tr-memory') && await page.isVisible('#game-intro'));
  check('game: lead', (await text(page.locator('#tr-lead'))).startsWith('Угадайте четыре пароля'));
  await page.evaluate(() => {
    window.__rng = { randomInt: BBRandom.randomInt, pick: BBRandom.pick };
    BBRandom.randomInt = () => 0;
    BBRandom.pick = (items) => items[0];
  });
  await page.click('#game-start');
  check('level 1', (await text(page.locator('#game-level'))) === 'Уровень 1 из 4' && (await text(page.locator('#game-title'))) === 'Популярный пароль');
  check('level 1: 10 attempts', (await text(page.locator('#game-attempts'))) === 'Попыток осталось: 10 из 10' && (await page.locator('#game-pips span').count()) === 10);
  check('level 1: 20 variants', (await text(page.locator('#game-space-count'))) === '20');
  check('level 1: step current', (await page.getAttribute('#game-steps li:nth-child(1)', 'class')).includes('is-current'));
  await guess(page, 'dragon');
  check('wrong guess', (await text(page.locator('#game-feedback'))) === 'Не угадали.' && (await text(page.locator('#game-attempts'))).includes('9 из 10'));
  await guess(page, '   ');
  check('empty guess not counted', (await text(page.locator('#game-feedback'))) === 'Введите догадку' && (await text(page.locator('#game-attempts'))).includes('9 из 10'));
  await guess(page, 'DRAGON');
  check('repeat not counted', (await text(page.locator('#game-feedback'))).includes('уже пробовали') && (await page.locator('#game-guesses li').count()) === 1);
  await guess(page, 'qwerty');
  await guess(page, 'monkey');
  const hint = await text(page.locator('#game-hints li').first());
  check('hint after 3 attempts', hint.startsWith('Подсказка: в нём только цифры.') && hint.includes('−') && hint.includes('было 17 вариантов'), hint);
  check('space shrinks', Number(await text(page.locator('#game-space-count'))) < 17);
  await guess(page, '123456');
  await page.waitForTimeout(150);
  check('level 1 solved', (await text(page.locator('#game-verdict'))) === 'Угадали за 4 попытки!' && await page.isHidden('#game-play'));
  check('level 1 answer', (await text(page.locator('#game-secret'))) === '123456');
  check('level 1 machine', (await text(page.locator('#game-machine-try'))) === '123456' &&
    (await text(page.locator('#game-machine-count'))) === 'Нашла с 1-й попытки: проверяет пароли от самых популярных.', await text(page.locator('#game-machine-count')));
  check('level 1 lesson', (await text(page.locator('#game-lesson'))).includes('популярных паролей'));
  check('level 1 done step', (await page.getAttribute('#game-steps li:nth-child(1)', 'class')).includes('is-done'));
  await page.click('#game-next');

  check('level 2: PIN', (await text(page.locator('#game-title'))) === 'PIN-код' && (await page.getAttribute('#game-input', 'inputmode')) === 'numeric');
  check('level 2: 14 attempts', (await page.locator('#game-pips span').count()) === 14);
  await guess(page, '5000');
  check('PIN lower', (await text(page.locator('#game-feedback'))) === 'Загаданное число меньше 5000.');
  check('PIN range', (await text(page.locator('#game-space-note'))).startsWith('От 0000 до 4999.'));
  check('PIN mark', (await text(page.locator('#game-guesses li').first())).startsWith('5000↓'));
  await guess(page, '12');
  check('PIN invalid', (await text(page.locator('#game-feedback'))).startsWith('PIN-код — это 4 цифры'));
  await guess(page, '0000');
  await page.waitForTimeout(150);
  check('PIN solved', (await text(page.locator('#game-verdict'))) === 'Угадали за 2 попытки!');
  check('PIN solved: 1 variant', (await text(page.locator('#game-space-count'))) === '1' &&
    (await text(page.locator('#game-space-note'))).startsWith('Это 0 бит: пароль найден'));
  check('PIN machine', (await text(page.locator('#game-machine-count'))).startsWith('Перебор по порядку: 1 попытка'), await text(page.locator('#game-machine-count')));
  check('PIN lesson', (await text(page.locator('#game-lesson'))).includes('14 попыток хватает всегда'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(shots, '17-game-result.png'), fullPage: true });
  await page.click('#game-next');

  check('level 3: profile', await page.isVisible('#game-profile') && (await text(page.locator('#game-person'))) === 'Маша');
  const facts = await page.$$eval('#game-facts li', (els) => els.map((e) => e.textContent));
  check('level 3: facts', JSON.stringify(facts) === JSON.stringify(['Живёт в Красноярске', 'Родилась 1 января 1995 года', 'Болеет за «Спартак»',
    'Её кот Барсик — на каждой второй фотографии']), JSON.stringify(facts));
  await guess(page, 'барсик1995');
  check('level 3: Cyrillic', (await text(page.locator('#game-feedback'))).includes('латиницей') && (await text(page.locator('#game-attempts'))).includes('10 из 10'));
  for (const g of ['masha1995', 'spartak1995', 'krasnoyarsk1995']) await guess(page, g);
  check('level 3: hint', (await text(page.locator('#game-hints li').first())).includes('кличка питомца'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(shots, '16-game-personal.png'), fullPage: true });
  await guess(page, 'BARSIK1995');
  await page.waitForTimeout(150);
  check('level 3: solved', (await text(page.locator('#game-verdict'))) === 'Угадали за 4 попытки!' &&
    (await text(page.locator('#game-machine-count'))) === 'Нашла с 1-й попытки из 22.');
  check('level 3: lesson', (await text(page.locator('#game-lesson'))).includes('22 варианта'));
  await page.evaluate(() => Object.assign(BBRandom, window.__rng));
  await page.click('#game-next');

  check('level 4: random', (await text(page.locator('#game-title'))) === 'Случайный пароль');
  await guess(page, 'abc');
  check('level 4: length check', (await text(page.locator('#game-feedback'))).includes('ровно 8 символов'));
  await page.click('#game-giveup');
  await page.waitForTimeout(200);
  check('level 4: gave up', (await text(page.locator('#game-verdict'))).startsWith('Вы сдались — и правильно'));
  check('level 4: secret 8 chars', (await text(page.locator('#game-secret'))).length === 8);
  check('level 4: brute force', (await text(page.locator('#game-machine-count'))).includes('% от всех'), await text(page.locator('#game-machine-count')));
  const lesson4 = await text(page.locator('#game-lesson'));
  check('level 4: lesson', lesson4.includes('MD5') && lesson4.includes('млн лет') && lesson4.includes('16 случайных символов'), lesson4);
  check('level 4: summary button', (await text(page.locator('#game-next .button-label'))) === 'Посмотреть итоги');
  await page.click('#game-next');
  check('summary shown', await page.isVisible('#game-summary') && await page.isHidden('#game-card'));
  const rows = await page.$$eval('#game-table tr', (trs) => trs.map((tr) => Array.from(tr.cells, (c) => c.textContent.replace(/[\u00a0\u202f]/g, ' '))));
  check('summary rows', rows.length === 4 && rows[0][0] === 'Популярный пароль' && rows[0][1] === '20' && rows[0][2] === '4,3 бита' &&
    rows[0][3] === 'за 4 попытки' && rows[0][4] === 'с 1-й попытки' && rows[1][1] === '10 000' && rows[2][2] === '4,5 бита' &&
    rows[3][1] === '2,8·1015' && rows[3][2] === '51,3 бита' && rows[3][3] === 'сдались' && rows[3][4].endsWith('(MD5)'), JSON.stringify(rows));
  check('summary steps', (await page.$$eval('#game-steps li', (lis) => lis.map((li) => li.className))).join() ===
    'game-step is-done,game-step is-done,game-step is-done,game-step is-failed');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(shots, '18-game-summary.png'), fullPage: true });
  await page.click('#game-restart');
  check('restart', await page.isVisible('#game-card') && (await text(page.locator('#game-level'))) === 'Уровень 1 из 4' &&
    (await page.locator('#game-guesses li').count()) === 0 && await page.isHidden('#game-summary'));
  check('no console errors', errors.length === 0, errors.join('\n'));
  await ctx.close();

  /* ---------- Телефон ---------- */
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
  await noMotion(m);
  const mp = await m.newPage();
  await mp.goto(url + '#trainer');
  check('mobile trainer overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await addCard(mp, 'Почта', 'Очень длинная фраза из шести слов 42');
  check('mobile learning overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  const fits = await mp.evaluate(() => Array.from(document.querySelectorAll('.memory-card *')).every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5));
  check('mobile card fits', fits);
  await mp.evaluate(() => window.scrollTo(0, 0));
  await mp.screenshot({ path: path.join(shots, '19-trainer-mobile.png'), fullPage: true });
  await mp.click('label.mode-option:has-text("Взломай сам")');
  // Загадан 123456 (первый из списка), иначе пароль случаен и догадка ниже могла бы его угадать
  await mp.evaluate(() => { BBRandom.randomInt = () => 0; BBRandom.pick = (items) => items[0]; });
  await mp.click('#game-start');
  await guess(mp, 'qwerty');
  await guess(mp, 'dragon');
  await guess(mp, 'monkey');
  check('mobile game overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  const inputHeight = await mp.$eval('#game-input', (el) => el.getBoundingClientRect().height);
  check('mobile game input height', inputHeight >= 50, String(inputHeight));
  await mp.evaluate(() => window.scrollTo(0, 0));
  await mp.screenshot({ path: path.join(shots, '20-game-mobile.png'), fullPage: true });
  await mp.click('#game-giveup');
  await mp.waitForTimeout(150);
  check('mobile result overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await m.close();

  /* ---------- Тёмная тема ---------- */
  const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await noMotion(d);
  const dp = await d.newPage();
  await dp.goto(url + '#trainer');
  const dc = await addCard(dp, 'Почта', PW);
  await answer(dc, PW);
  await dp.evaluate(() => window.scrollTo(0, 0));
  await dp.screenshot({ path: path.join(shots, '21-trainer-dark.png'), fullPage: true });
  await dp.click('label.mode-option:has-text("Взломай сам")');
  await dp.click('#game-start');
  await guess(dp, 'qwerty');
  await dp.click('#game-giveup');
  await dp.waitForTimeout(150);
  await dp.evaluate(() => window.scrollTo(0, 0));
  await dp.screenshot({ path: path.join(shots, '22-game-dark.png'), fullPage: true });
  await d.close();

  /* ---------- Анимации (и при «Уменьшать движение») ---------- */
  const mo = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  const mv = await mo.newPage();
  const motionErrors = [];
  mv.on('pageerror', (e) => motionErrors.push(String(e)));
  await mv.goto(url + '#trainer');
  await mv.click('label.mode-option:has-text("Взломай сам")');
  check('motion: mode slides', await mv.evaluate(() => document.getElementById('tr-game').getAnimations().length === 1));
  await mv.waitForTimeout(500);
  await mv.click('#game-start');
  check('motion: level enters', await mv.evaluate(() => document.getElementById('game-card').getAnimations().length >= 1));
  await mv.fill('#game-input', 'qwerty1');
  await mv.press('#game-input', 'Enter');
  check('motion: wrong guess shakes', await mv.evaluate(() => document.getElementById('game-input').getAnimations().length >= 1));
  await mv.click('#game-giveup');
  await mv.waitForTimeout(100);
  const replay = await text(mv.locator('#game-machine-count'));
  check('motion: machine replays', replay.startsWith('Попытка'), replay);
  await mv.waitForTimeout(2600);
  check('motion: machine finishes', (await text(mv.locator('#game-machine-count'))).startsWith('Нашла с'));
  await mv.click('label.mode-option:has-text("Запоминание")');
  await mv.waitForTimeout(450);
  await mv.fill('#mem-name', 'Почта');
  await mv.fill('#mem-password', PW);
  await mv.click('#mem-submit');
  await cardBy(mv, 'Почта').waitFor({ timeout: 20000 });
  check('motion: card enters', await mv.evaluate(() => document.querySelector('.memory-card').getAnimations().length >= 1));
  await mv.waitForTimeout(500);
  const mc = cardBy(mv, 'Почта');
  await mc.locator('.memory-input').fill('wrong');
  await mc.locator('.memory-input').press('Enter');
  check('motion: wrong answer shakes', await mv.evaluate(() => document.querySelector('.memory-input').getAnimations().length >= 1));
  check('motion: bars pulse or fill (CSS)', await mv.evaluate(() => getComputedStyle(document.querySelector('.memory-bar'), '::after').transitionDuration !== '0s'));
  await mc.locator('.memory-delete').click();
  await mc.locator('.memory-delete').click();
  check('motion: delete collapses', await mv.evaluate(() => {
    const leaving = document.querySelector('.memory-card.is-leaving');
    return Boolean(leaving) && leaving.getAnimations().length === 1;
  }));
  await mv.waitForTimeout(500);
  check('motion: removed after collapse', (await mv.locator('.memory-card').count()) === 0);
  check('no errors with motion', motionErrors.length === 0, motionErrors.join('\n'));
  await mo.close();

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
