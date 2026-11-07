// Браузерные тесты этапов 0–2: генератор, анализатор, «Теория», телефон и тёмная тема.
// Запуск из папки bastionbit: node tests/browser-test.js (нужен Playwright, см. README)
const { chromium } = require('playwright');
const path = require('path');
const url = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const shots = path.join(__dirname, 'shots');
require('fs').mkdirSync(shots, { recursive: true });
const CONTROL = '|Vq:_o6v^G2Y9\\H*';

let failed = 0, passed = 0;
const check = (name, cond, extra = '') => { if (cond) passed++; else { failed++; console.log('FAIL', name, extra); } };

async function fillKeyword(page) {
  await page.click('label.mode-option:has-text("Из слова")');
  await page.fill('#kw-site', 'https://www.VK.com/feed');
  await page.fill('#kw-word', 'кот');
  await page.fill('#kw-master', 'фиолетовый ёж продал чайник');
}

// Проверки работы — без анимаций: результат не зависит от того, успела ли анимация
// закончиться. Сами анимации проверяются в конце, отдельно.
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

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  /* ---------- Компьютер, светлая тема ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  await noMotion(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);

  check('random password 16', (await page.textContent('#gen-password')).length === 16);
  check('analyzer libraries are lazy', await page.evaluate(() =>
    typeof BB_DICT_RU === 'undefined' && typeof BB_TOP_PASSWORDS === 'undefined' && typeof zxcvbn === 'undefined' && typeof Chart === 'undefined'));
  check('keyword panel hidden at start', await page.isHidden('#mode-keyword'));
  check('phrase enabled', await page.isEnabled('input[value="phrase"]'));
  check('phrase panel hidden at start', await page.isHidden('#mode-phrase'));

  await page.click('label.mode-option:has-text("Из слова")');
  check('keyword panel visible', await page.isVisible('#mode-keyword'));
  check('random panel hidden', await page.isHidden('#mode-random'));
  check('lead changed', (await page.textContent('#gen-lead')).startsWith('Пароль из того'));

  await page.click('#kw-submit');
  check('error: site', (await page.textContent('#kw-error')).includes('Укажите сайт'));
  await page.fill('#kw-site', 'https://www.VK.com/feed');
  check('site hint', (await page.textContent('#kw-site-hint')) === 'Пароль для: vk.com', await page.textContent('#kw-site-hint'));
  await page.click('#kw-submit');
  check('error: secret', (await page.textContent('#kw-error')).includes('ключевое слово'));

  await page.fill('#kw-word', 'кот');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '00-keyword-empty.png'), fullPage: true });
  await page.click('#kw-submit');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  check('keyword only: very weak', (await page.textContent('#kw-strength')) === 'Очень слабый');
  check('advice shown without master', (await page.isVisible('#kw-advice')) && (await page.textContent('#kw-advice')).includes('Без мастер-фразы'));

  await page.fill('#kw-master', 'фиолетовый ёж продал чайник');
  check('result hidden after edit', await page.isHidden('#kw-result'));
  await page.click('#kw-submit');
  check('busy state', (await page.textContent('#kw-submit .button-label')) === 'Считаю…');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  const pw = await page.textContent('#kw-password');
  check('control example in browser', pw === CONTROL, pw);
  check('strength strong', (await page.textContent('#kw-strength')) === 'Сильный', await page.textContent('#kw-strength'));
  check('advice hidden when strong', await page.isHidden('#kw-advice'));
  check('3 scenarios', (await page.locator('#kw-times li').count()) === 3);
  check('PBKDF2 note', (await page.textContent('#kw-times')).includes('тормозит PBKDF2'));
  check('formula', (await page.textContent('#kw-formula')).startsWith('H = min('), await page.textContent('#kw-formula'));
  check('slowdown note', (await page.textContent('#kw-slowdown')).replace(/\s/g, ' ').includes('600 000'));
  console.log('formula:', await page.textContent('#kw-formula'));
  console.log('times:', (await page.locator('#kw-times li').allTextContents()).join(' | '));
  console.log('slowdown:', await page.textContent('#kw-slowdown'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '01-keyword-desktop.png'), fullPage: true });

  // Копирование
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('#kw-copy');
  await page.waitForTimeout(150);
  check('copy label', (await page.textContent('#kw-copy .button-label')) === 'Скопировано', await page.textContent('#kw-copy .button-label'));

  // Версия +1 и Enter
  await page.click('#kw-version-up');
  check('version 2', (await page.inputValue('#kw-version')) === '2');
  check('hidden after version', await page.isHidden('#kw-result'));
  await page.press('#kw-master', 'Enter');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  const pw2 = await page.textContent('#kw-password');
  check('version changes password', pw2 !== CONTROL && pw2.length === 16, pw2);
  await page.click('#kw-version-down');
  await page.click('#kw-version-down');
  check('version min 1', (await page.inputValue('#kw-version')) === '1');

  // Требования сайта
  await page.click('.requirements summary');
  check('requirements open', await page.isVisible('#kw-length'));
  await page.fill('#kw-length', '20');
  await page.uncheck('#kw-symbols');
  check('summary text', (await page.textContent('#kw-req-summary')) === '20 символов · a–z A–Z 0–9', await page.textContent('#kw-req-summary'));
  await page.click('#kw-submit');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  const pw3 = await page.textContent('#kw-password');
  check('requirements respected', pw3.length === 20 && /^[A-Za-z0-9]+$/.test(pw3), pw3);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '02-keyword-requirements.png'), fullPage: true });

  /* --- Фраза (1.3) --- */
  await page.click('label.mode-option:has-text("Фраза")');
  check('phrase panel visible', await page.isVisible('#mode-phrase'));
  check('keyword panel hidden in phrase mode', await page.isHidden('#mode-keyword'));
  check('phrase lead', (await page.textContent('#gen-lead')).startsWith('Случайная фраза'));
  const words = () => page.locator('#ph-phrase .phrase-text').allTextContents();
  let w = await words();
  check('6 words by default', w.length === 6, w.join(' '));
  check('roles under words', (await page.locator('#ph-phrase .phrase-role').count()) === 6);
  check('number highlighted', /^\d+$/.test(await page.textContent('#ph-phrase .is-number .phrase-text')));
  check('bits 6', (await page.textContent('#ph-bits')) === '52,8 бита энтропии', await page.textContent('#ph-bits'));
  check('strength 6', (await page.textContent('#ph-strength')) === 'Средний', await page.textContent('#ph-strength'));
  check('breakdown 6+1 rows', (await page.locator('#ph-breakdown > div').count()) === 7);
  check('breakdown count text', (await page.textContent('#ph-breakdown')).includes('100 чисел'), await page.textContent('#ph-breakdown'));
  check('phrase formula', (await page.textContent('#ph-formula')).startsWith('H = log₂(622 · 645 · 274 · 100 · 622 · 1124)'), await page.textContent('#ph-formula'));
  check('phrase scenarios', (await page.locator('#ph-times li').count()) === 3);
  check('master note', (await page.textContent('#ph-master-note')).includes('PBKDF2'));
  const phraseText = w.join(' ');
  const layoutText = await page.textContent('#ph-layout');
  check('layout = phrase in QWERTY', layoutText === await page.evaluate((t) => BBPhrase.toEnglishLayout(t), phraseText), layoutText);
  check('no ё in phrase', !/ё/i.test(phraseText));
  console.log('phrase:', phraseText, '|', layoutText);
  console.log('phrase times:', (await page.locator('#ph-times li').allTextContents()).join(' | '));
  console.log('master note:', await page.textContent('#ph-master-note'));

  await page.click('#ph-copy');
  await page.waitForTimeout(150);
  check('phrase copy label', (await page.textContent('#ph-copy .button-label')) === 'Скопировано');
  check('phrase copied', (await page.evaluate(() => navigator.clipboard.readText())) === phraseText);
  await page.click('#ph-copy-layout');
  await page.waitForTimeout(150);
  check('layout copied', (await page.evaluate(() => navigator.clipboard.readText())) === layoutText);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '07-phrase-desktop.png'), fullPage: true });

  await page.click('#ph-refresh');
  const w2 = await words();
  check('refresh changes phrase', w2.join(' ') !== phraseText && w2.length === 6, w2.join(' '));
  check('copy label reset on refresh', (await page.textContent('#ph-copy .button-label')) === 'Копировать');

  await page.click('label.mode-option:has-text("5 слов")');
  const w5 = await words();
  check('5 words', w5.length === 5, w5.join(' '));
  check('bits 5', (await page.textContent('#ph-bits')) === '43,5 бита энтропии', await page.textContent('#ph-bits'));
  check('breakdown 5+1 rows', (await page.locator('#ph-breakdown > div').count()) === 6);
  check('formula 5', (await page.textContent('#ph-formula')).startsWith('H = log₂(622 · 645 · 274 · 100 · 1124)'));

  // Фраза из 5 слов → мастер-фраза: совет взять 6 слов
  await page.click('#ph-use');
  check('use → keyword mode', await page.isVisible('#mode-keyword') && await page.isHidden('#mode-phrase'));
  check('use → radio checked', await page.isChecked('input[name="gen-mode"][value="keyword"]'));
  check('use → master filled', (await page.inputValue('#kw-master')) === w5.join(' '));
  check('use → focus on keyword', await page.evaluate(() => document.activeElement.id) === 'kw-word');
  await page.fill('#kw-word', '');
  await page.click('#kw-submit');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  check('master label from generator', (await page.textContent('#kw-master-bits', { strict: false }).then(() => page.evaluate(() => document.getElementById('kw-master-bits').previousElementSibling.textContent))) === 'Мастер-фраза из генератора');
  check('master bits 43,5', (await page.textContent('#kw-master-bits')) === '43,5 бита', await page.textContent('#kw-master-bits'));
  check('advice: take 6 words', (await page.textContent('#kw-advice')).includes('6 слов'), await page.textContent('#kw-advice'));
  check('model mentions generator', (await page.textContent('#kw-model')).includes('собрана генератором'), await page.textContent('#kw-model'));
  console.log('advice 5:', await page.textContent('#kw-advice'));

  // Фраза из 6 слов + ключевое слово
  await page.click('label.mode-option:has-text("Фраза")');
  await page.click('label.mode-option:has-text("6 слов")');
  const w6 = await words();
  await page.click('#ph-use');
  await page.fill('#kw-word', 'кот');
  await page.click('#kw-submit');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  check('master bits 52,8', (await page.textContent('#kw-master-bits')) === '52,8 бита');
  check('6 words + keyword strong', (await page.textContent('#kw-strength')) === 'Сильный', await page.textContent('#kw-strength'));
  check('no advice when strong', await page.isHidden('#kw-advice'));
  console.log('model 6:', await page.textContent('#kw-model'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '08-phrase-as-master.png'), fullPage: true });
  await page.fill('#kw-master', 'фиолетовый ёж продал чайник');
  await page.click('#kw-submit');
  await page.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  check('ordinary master label', await page.evaluate(() => document.getElementById('kw-master-bits').previousElementSibling.textContent) === 'Мастер-фраза');

  // Остальные вкладки не сломались
  await page.click('label.mode-option:has-text("Случайный")');
  check('back to random', await page.isVisible('#mode-random'));
  await page.click('#gen-analyze');
  check('analyze opens analyzer', await page.isVisible('#panel-analyzer'));
  await page.waitForFunction(() => document.getElementById('an-status').hidden &&
    typeof zxcvbn === 'function' && typeof Chart === 'function', null, { timeout: 20000 });
  check('libraries loaded on analyzer open', await page.evaluate(() => typeof BB_DICT_RU === 'string' && typeof BB_DICT_EN === 'string'));
  const an = () => page.evaluate(() => ({
    verdict: document.getElementById('an-verdict').textContent,
    bits: document.getElementById('an-bits').textContent,
    caption: document.getElementById('an-caption').textContent,
    compare: document.getElementById('an-compare-line').textContent,
    titles: Array.from(document.querySelectorAll('#an-chunks .chunk-title')).map((e) => e.textContent),
    details: Array.from(document.querySelectorAll('#an-chunks .chunk-detail')).map((e) => e.textContent),
    chunkBits: Array.from(document.querySelectorAll('#an-chunks .chunk-bits')).map((e) => e.textContent),
    preview: document.getElementById('an-preview').textContent,
    nothing: !document.getElementById('an-nothing').hidden,
    formula: document.getElementById('an-real-formula').textContent,
    advice: document.getElementById('an-advice').textContent,
    expiry: Array.from(document.querySelectorAll('#an-expiry li')).map((li) => [li.querySelector('.value').textContent, li.querySelector('small').textContent]),
    quantum: document.getElementById('an-quantum').textContent,
    zx: document.getElementById('an-zxcvbn').textContent,
    times: document.querySelectorAll('#an-times li').length,
    naive: document.getElementById('an-formula').textContent,
  }));

  await page.fill('#an-input', 'Password1!');
  let a = await an();
  check('Password1!: very weak', a.verdict === 'Очень слабый', a.verdict);
  check('Password1!: 15,8 bits', a.bits === '15,8 бита', a.bits);
  check('caption with tricks', a.caption === 'Оценка с учётом хитростей', a.caption);
  check('compare line', a.compare === 'По формуле — 65,5 бита · zxcvbn — 14,2 бита', a.compare);
  check('two chunks', a.titles.length === 2 && a.titles[0] === 'Популярный пароль' && a.titles[1] === 'Случайные символы', a.titles.join(' | '));
  check('hidden: no token in preview', !a.preview.includes('Password') && a.preview.includes('••••••••'), a.preview);
  check('hidden: no rank in details', !a.details.join(' ').includes('№'), a.details.join(' | '));
  check('real formula', a.formula === 'H = 2 + 10,8 + 3 · 1 ≈ 15,8 бита', a.formula);
  check('advice popular', a.advice.includes('Популярные пароли'), a.advice);
  check('expiry: already now', a.expiry.length === 2 && a.expiry.every(([v]) => v === 'уже сейчас'), JSON.stringify(a.expiry));
  check('quantum note', a.quantum.includes('до 7,9 бита'), a.quantum);
  check('zxcvbn warning translated', a.zx.includes('Её подсказка: это похоже на популярный пароль.'), a.zx);
  check('scenarios real', a.times === 3 && (await page.textContent('#an-times')).includes('меньше секунды'));
  check('naive formula kept', a.naive === 'H = L · log₂ N = 10 · log₂ 94 ≈ 65,5 бита', a.naive);
  await page.waitForTimeout(100);
  const chartData = await page.evaluate(() => ({
    compare: Chart.getChart(document.getElementById('an-compare-chart')).data.datasets[0].data.map((v) => Math.round(v * 10) / 10),
    expiry: Chart.getChart(document.getElementById('an-expiry-chart')).data.datasets.length,
    label: document.getElementById('an-compare-chart').getAttribute('aria-label'),
  }));
  check('compare chart data', JSON.stringify(chartData.compare) === '[65.5,15.8,14.2]', JSON.stringify(chartData.compare));
  check('expiry chart: 2 lines + limit', chartData.expiry === 3, String(chartData.expiry));
  check('chart aria-label', chartData.label.includes('BastionBit 15,8 бита'), chartData.label);

  await page.click('#an-toggle');
  a = await an();
  check('reveal: token in preview', a.preview.startsWith('Password') && a.preview.includes('1!'), a.preview);
  check('reveal: token in title', a.titles[0] === 'Популярный пароль Password', a.titles[0]);
  check('reveal: rank shown', a.details[0].startsWith('№ 2 в списке 10 000 популярных паролей'), a.details[0]);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '12-analyzer-detector.png'), fullPage: true });

  await page.fill('#an-input', 'gfhjkm');
  a = await an();
  check('gfhjkm alias', a.details[0].includes('это «пароль» в английской раскладке'), a.details[0]);
  await page.fill('#an-input', 'Кот15051998qwerty');
  a = await an();
  check('mix: word, date, password', JSON.stringify(a.titles) === JSON.stringify(['Русское слово Кот', 'Дата 15051998', 'Популярный пароль qwerty']), a.titles.join(' | '));
  check('mix: formula', a.formula === 'H = 13 + 14,9 + 2 + 3 · 2 ≈ 35,8 бита', a.formula);
  check('mix: bcrypt expiry year', /^в \d{4} году$/.test(a.expiry[1][0]) && a.expiry[1][1] === 'через ≈ 1,6 года', JSON.stringify(a.expiry));
  const expectYear = await page.evaluate(() => {
    const now = new Date();
    const y = now.getFullYear() + (now - new Date(now.getFullYear(), 0, 1)) / (365.25 * 864e5);
    return `в ${Math.floor(y + BBEntropy.expiryYears(BBPatterns.analyze('Кот15051998qwerty').bits, 2e5))} году`;
  });
  check('mix: expiry year value', a.expiry[1][0] === expectYear, a.expiry[1][0] + ' vs ' + expectYear);
  await page.fill('#an-input', 'x7#Kq9!mZ2$vL8@nR4');
  a = await an();
  check('random: nothing found', a.nothing && a.titles.length === 0, JSON.stringify(a.titles));
  check('random: zxcvbn cautious note', a.zx.includes('по 10 вариантов на символ'), a.zx);
  check('random: expiry after 100 years', a.expiry.every(([v, n]) => v.startsWith('после ') && n === 'больше чем через 100 лет'), JSON.stringify(a.expiry));
  await page.fill('#an-input', w6.join(' '));
  a = await an();
  check('phrase chunk', a.titles.length === 1 && a.titles[0].startsWith('Фраза генератора BastionBit'), a.titles.join(' | '));
  check('phrase bits 52,8', a.bits === '52,8 бита' && a.verdict === 'Средний', a.bits + ' ' + a.verdict);
  check('phrase advice → master', a.advice.includes('мастер-фразой'), a.advice);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '09-analyzer-phrase.png'), fullPage: true });
  await page.fill('#an-input', await page.evaluate((t) => BBPhrase.toEnglishLayout(t), w6.join(' ')));
  a = await an();
  check('layout phrase', a.titles[0].startsWith('Фраза генератора BastionBit') && a.details[0].includes('в английской раскладке'), a.details.join(' | '));
  await page.fill('#an-input', w6.join(' ') + ' 1987');
  a = await an();
  check('phrase + year', a.titles.length === 3 && a.titles[2].startsWith('Год'), a.titles.join(' | '));
  await page.fill('#an-input', 'Пароль'.repeat(30));
  a = await an();
  check('long password: zxcvbn cut note', a.zx.includes('первые 100 символов'), a.zx);
  const sums = await page.evaluate(() => ['Password1!', 'Кот15051998qwerty', 'p@$$w0rd2024', 'qwerty123456', 'Ghbdtn2024!', 'aaaaaa1234'].map((pw) => {
    const r = BBPatterns.analyze(pw);
    const sum = r.chunks.reduce((t, c) => t + c.bits, 0) + BBPatterns.JOIN_BITS * (r.chunks.length - 1);
    return [pw, r.found, Math.abs(sum - r.bits) < 1e-9];
  }));
  check('bits = Σ chunks + joins', sums.every(([, found, ok]) => found && ok), JSON.stringify(sums));
  await page.fill('#an-input', '');
  check('empty hides result', await page.isHidden('#an-result') && await page.isVisible('#an-empty'));
  await page.click('#tab-theory');
  check('theory has section 6', (await page.textContent('#panel-theory')).includes('6. Стойкость пароля из ключевого слова'));
  check('theory has section 7', (await page.textContent('#panel-theory')).includes('7. Фраза из слов'));
  check('theory has section 8', (await page.textContent('#panel-theory')).includes('8. Чего не видит формула'));
  for (const title of ['9. Детектор хитростей', '10. Срок годности пароля', '11. Сравнение с zxcvbn', '12. Интервальные повторения',
    '13. Как тренажёр проверяет пароль, не храня его', '14. «Взломай сам»: биты и подсказки',
    '15. Ментальное правило и устойчивость к утечке', '16. Личные данные', '17. Проверка утечек: k-анонимность',
    '18. Похожие пароли: расстояние Левенштейна', '19. Проверка на миллионе настоящих паролей', '20. Источники данных']) {
    check('theory: ' + title, (await page.textContent('#panel-theory')).includes(title));
  }
  check('theory numbers filled', (await page.textContent('[data-phrase="objects"]')).replace(/\s/g, ' ') === '1 124' &&
    (await page.textContent('[data-phrase="bits6"]')) === '52,8 бита', await page.textContent('[data-phrase="objects"]'));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, '03-theory-desktop.png'), fullPage: true });
  check('no console errors', errors.length === 0, errors.join('\n'));
  await ctx.close();

  /* ---------- Телефон, светлая тема ---------- */
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
  await noMotion(m);
  const mp = await m.newPage();
  await mp.goto(url);
  check('mobile random overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  const sw = await mp.evaluate(() => { const r = document.querySelector('.mode-switch').getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
  check('mode switch fits', sw[0] >= 0 && sw[1] <= sw[2], sw.join(','));
  await fillKeyword(mp);
  await mp.click('.requirements summary');
  check('mobile keyword overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await mp.evaluate(() => window.scrollTo(0, 0)); await mp.screenshot({ path: path.join(shots, '04-keyword-mobile-form.png'), fullPage: true });
  await mp.click('.requirements summary');
  await mp.click('#kw-submit');
  await mp.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  check('mobile control example', (await mp.textContent('#kw-password')) === CONTROL);
  check('mobile result overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await mp.evaluate(() => window.scrollTo(0, 0)); await mp.screenshot({ path: path.join(shots, '05-keyword-mobile-result.png'), fullPage: true });
  await mp.click('label.mode-option:has-text("Фраза")');
  check('mobile phrase visible', await mp.isVisible('#mode-phrase'));
  check('mobile phrase overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  const tb = await mp.evaluate(() => Array.from(document.querySelectorAll('#mode-phrase .phrase-toolbar > *')).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
  check('mobile phrase toolbar fits', tb.every(([l, r]) => l >= 0 && r <= 390), JSON.stringify(tb));
  await mp.evaluate(() => window.scrollTo(0, 0)); await mp.screenshot({ path: path.join(shots, '10-phrase-mobile.png'), fullPage: true });
  await mp.click('#tab-theory');
  check('mobile theory overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await mp.click('#tab-analyzer');
  await mp.fill('#an-input', 'Ghbdtn2024!');
  await mp.click('#an-toggle');
  await mp.waitForFunction(() => document.getElementById('an-status').hidden && typeof Chart === 'function', null, { timeout: 20000 });
  await mp.waitForTimeout(900);   // графики дорисовываются (анимация 650 мс)
  check('mobile analyzer overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await mp.evaluate(() => window.scrollTo(0, 0)); await mp.screenshot({ path: path.join(shots, '14-analyzer-mobile.png'), fullPage: true });
  await m.close();

  /* ---------- Тёмная тема ---------- */
  const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await noMotion(d);
  const dp = await d.newPage();
  await dp.goto(url);
  await fillKeyword(dp);
  await dp.click('#kw-submit');
  await dp.waitForSelector('#kw-result:not([hidden])', { timeout: 20000 });
  await dp.evaluate(() => window.scrollTo(0, 0)); await dp.screenshot({ path: path.join(shots, '06-keyword-dark.png'), fullPage: true });
  await dp.click('label.mode-option:has-text("Фраза")');
  await dp.evaluate(() => window.scrollTo(0, 0)); await dp.screenshot({ path: path.join(shots, '11-phrase-dark.png'), fullPage: true });
  await dp.click('#tab-analyzer');
  await dp.fill('#an-input', 'Кот15051998qwerty');
  await dp.waitForFunction(() => document.getElementById('an-status').hidden && typeof Chart === 'function', null, { timeout: 20000 });
  await dp.waitForTimeout(900);
  const darkBar = await dp.evaluate(() => Chart.getChart(document.getElementById('an-compare-chart')).data.datasets[0].backgroundColor[1]);
  check('dark chart colors', darkBar.toUpperCase() === '#8DA2FF', darkBar);
  await dp.evaluate(() => window.scrollTo(0, 0)); await dp.screenshot({ path: path.join(shots, '13-analyzer-dark.png'), fullPage: true });
  await d.close();

  /* ---------- Анимации ---------- */
  const mo = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const mv = await mo.newPage();
  const motionErrors = [];
  mv.on('console', (msg) => { if (msg.type() === 'error') motionErrors.push(msg.text()); });
  mv.on('pageerror', (e) => motionErrors.push(String(e)));
  await mv.goto(url);
  const near = (x, y) => Math.abs(x - y) < 1;
  const indicator = () => mv.evaluate(() => {
    const bar = document.querySelector('.tab-indicator').getBoundingClientRect();
    const tab = document.querySelector('.tab[aria-selected="true"]').getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(document.querySelector('.tabs')).getPropertyValue('--tab-inset'));
    return { left: bar.left, width: bar.width, tabLeft: tab.left + inset, tabWidth: tab.width - 2 * inset };
  });
  let ind = await indicator();
  check('indicator under first tab', near(ind.left, ind.tabLeft) && near(ind.width, ind.tabWidth), JSON.stringify(ind));
  await mv.click('#tab-theory');
  await mv.waitForTimeout(60);
  ind = await indicator();
  check('indicator slides', !near(ind.left, ind.tabLeft), JSON.stringify(ind));
  check('panel slides in', await mv.evaluate(() => document.getElementById('panel-theory').getAnimations().length === 1));
  await mv.waitForTimeout(700);
  ind = await indicator();
  check('indicator reaches tab', near(ind.left, ind.tabLeft) && near(ind.width, ind.tabWidth), JSON.stringify(ind));
  await mv.click('#tab-generator');
  await mv.waitForTimeout(700);
  const thumb = (id) => mv.evaluate((sel) => {
    const t = document.querySelector(sel + ' .segment-thumb').getBoundingClientRect();
    const o = document.querySelector(sel + ' input:checked').closest('.mode-option').getBoundingClientRect();
    return { t: [t.left, t.width, t.height], o: [o.left, o.width, o.height] };
  }, id);
  let th = await thumb('#gen-modes');
  check('mode thumb on checked', th.t.every((v, i) => near(v, th.o[i])), JSON.stringify(th));
  await mv.click('label.mode-option:has-text("Фраза")');
  await mv.waitForTimeout(60);
  th = await thumb('#gen-modes');
  check('mode thumb slides', !near(th.t[0], th.o[0]), JSON.stringify(th));
  await mv.waitForTimeout(700);
  th = await thumb('#gen-modes');
  check('mode thumb arrives', th.t.every((v, i) => near(v, th.o[i])), JSON.stringify(th));
  th = await thumb('#ph-words-switch');
  check('words thumb placed after show', th.t.every((v, i) => near(v, th.o[i])), JSON.stringify(th));
  await mv.click('#ph-refresh');
  check('phrase words wave', await mv.evaluate(() => Array.from(document.querySelectorAll('#ph-phrase .phrase-word')).every((w) => w.getAnimations().length === 1)));
  check('refresh icon spins', await mv.evaluate(() => document.querySelector('#ph-refresh svg').getAnimations().length === 1));
  await mv.click('label.mode-option:has-text("Из слова")');
  await mv.waitForTimeout(500);
  await mv.click('.requirements summary');
  await mv.waitForTimeout(80);
  let det = await mv.evaluate(() => { const e = document.querySelector('.requirements'); return [e.open, e.getAnimations().length, e.getBoundingClientRect().height]; });
  check('details opening animated', det[0] === true && det[1] === 1, JSON.stringify(det));
  await mv.waitForTimeout(500);
  const openHeight = await mv.evaluate(() => document.querySelector('.requirements').getBoundingClientRect().height);
  check('details opened fully', openHeight > det[2] && openHeight > 300, String(openHeight));
  await mv.click('.requirements summary');
  await mv.waitForTimeout(80);
  det = await mv.evaluate(() => { const e = document.querySelector('.requirements'); return [e.open, e.classList.contains('is-closing')]; });
  check('details closing animated', det[0] === true && det[1] === true, JSON.stringify(det));
  await mv.waitForTimeout(500);
  det = await mv.evaluate(() => { const e = document.querySelector('.requirements'); return [e.open, e.classList.contains('is-closing'), e.style.overflow]; });
  check('details closed', det[0] === false && det[1] === false && det[2] === '', JSON.stringify(det));
  await mv.click('label.mode-option:has-text("Случайный")');
  await mv.waitForTimeout(500);
  await mv.click('#gen-refresh');
  check('password chars wave', await mv.evaluate(() => Array.from(document.querySelectorAll('#gen-password span')).every((s) => s.getAnimations().length === 1)));
  await mv.waitForTimeout(600);
  await mv.fill('#gen-length', '40');
  await mv.waitForTimeout(60);
  const tweenMid = await mv.textContent('#gen-bits');
  await mv.waitForTimeout(700);
  const tweenEnd = await mv.textContent('#gen-bits');
  const exact = await mv.evaluate(() => `${BBEntropy.formatBits(BBGenerator.exactEntropy({ length: 40, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false }).bits)} энтропии`);
  check('bits tween', tweenMid !== tweenEnd && tweenEnd === exact, `${tweenMid} → ${tweenEnd} / ${exact}`);
  check('no errors with motion', motionErrors.length === 0, motionErrors.join('\n'));
  await mo.close();

  // «Уменьшать движение» в системе: анимации всё равно работают
  const rm = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  await rp.goto(url);
  check('reduced motion is on', await rp.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  await rp.click('#gen-refresh');
  check('reduced motion: password wave runs', await rp.evaluate(() =>
    Array.from(document.querySelectorAll('#gen-password span')).every((s) => s.getAnimations().length === 1)));
  await rp.click('#tab-theory');
  // Вкладка переключается по событию hashchange — оно приходит чуть позже клика
  await rp.waitForFunction(() => !document.getElementById('panel-theory').hidden);
  check('reduced motion: panel slides in', await rp.evaluate(() => document.getElementById('panel-theory').getAnimations().length === 1));
  check('reduced motion: CSS transitions kept', await rp.evaluate(() =>
    getComputedStyle(document.querySelector('.tab-indicator')).transitionDuration !== '0s' &&
    getComputedStyle(document.querySelector('.button')).transitionDuration !== '0s'));
  await rp.click('#tab-analyzer');
  await rp.fill('#an-input', 'Password1!');
  await rp.waitForFunction(() => typeof Chart === 'function' && Chart.getChart(document.getElementById('an-compare-chart')), null, { timeout: 20000 });
  check('reduced motion: charts grow', await rp.evaluate(() =>
    Chart.getChart(document.getElementById('an-compare-chart')).options.animation.duration === 650));
  await rm.close();

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
