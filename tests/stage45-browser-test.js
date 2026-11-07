// Браузерная проверка этапов 4–5: режим «Правило», личные данные, проверка
// утечек (ответ сервера подменён), похожие пароли, словарь имён, раздел 19.
// Запуск из папки bastionbit: node tests/stage45-browser-test.js (нужен Playwright, см. README)
const { chromium } = require('playwright');
const crypto = require('crypto');
const path = require('path');
const url = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const shots = path.join(__dirname, 'shots');
require('fs').mkdirSync(shots, { recursive: true });

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
const shot = async (page, name) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(shots, name), fullPage: true }); };

// Подменённый ответ Pwned Passwords: хеш Ilya2008! встречается 19 раз.
function sha1(s) { return crypto.createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase(); }
const requests = [];
async function fakeHibp(context) {
  await context.route('https://api.pwnedpasswords.com/range/*', (route) => {
    const prefix = route.request().url().split('/').pop().slice(0, 5).toUpperCase();
    requests.push(route.request().url());
    const target = sha1('Ilya2008!');
    const lines = [];
    for (let i = 0; i < 30; i++) lines.push(crypto.createHash('sha1').update('x' + i).digest('hex').toUpperCase().slice(5) + ':' + (i + 1));
    if (target.startsWith(prefix)) lines.push(target.slice(5) + ':19');
    lines.push('0000000000000000000000000000000000A:0');
    route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: lines.join('\r\n') });
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--lang=ru-RU'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', locale: 'ru-RU' });
  await noMotion(ctx);
  await fakeHibp(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);

  /* ---------- Режим «Правило» ---------- */
  await page.click('label.mode-option:has-text("Правило")');
  check('rule panel visible', await page.isVisible('#mode-rule'));
  check('random panel hidden', await page.isHidden('#mode-random'));
  await page.waitForFunction(() => document.getElementById('rl-password').textContent.length > 8, null, { timeout: 10000 });
  const rule = await page.evaluate(() => ({
    password: document.getElementById('rl-password').textContent,
    bits: document.getElementById('rl-bits').textContent,
    steps: document.querySelectorAll('#rl-steps li').length,
    chain: document.querySelectorAll('#rl-chain li').length,
    ladder: document.querySelectorAll('#rl-ladder li').length,
  }));
  check('rule password', rule.password.length >= 10, rule.password);
  const ruleBits = parseFloat(rule.bits.replace(',', '.'));
  check('rule bits plausible', /^\d+,\d бита?, пока нет утечек$/.test(rule.bits) && ruleBits >= 28 && ruleBits <= 48, rule.bits);
  check('rule steps shown', rule.steps >= 3, String(rule.steps));
  check('rule chain shown', rule.chain >= 2, String(rule.chain));
  check('ladder: one row per site + start', rule.ladder >= 5, String(rule.ladder));
  await page.fill('#rl-site', 'ozon.ru');
  await page.waitForTimeout(150);
  const other = await page.textContent('#rl-password');
  check('rule depends on site', other !== rule.password, other + ' / ' + rule.password);
  await page.click('#rl-new');
  await page.waitForTimeout(150);
  check('new rule changes password', (await page.textContent('#rl-password')) !== other);
  await page.fill('#rl-site', 'vk.com');
  await shot(page, '23-rule-desktop.png');

  /* ---------- Анализатор: словарь имён ---------- */
  await page.click('#tab-analyzer');
  await page.waitForFunction(() => document.getElementById('an-status').hidden && typeof zxcvbn === 'function', null, { timeout: 20000 });
  check('names dictionary loaded', await page.evaluate(() => typeof BB_DICT_NAMES === 'string' && BB_DICT_NAMES.length > 500000));
  const titles = () => page.evaluate(() => Array.from(document.querySelectorAll('#an-chunks .chunk-title')).map((e) => e.textContent));
  const details = () => page.evaluate(() => Array.from(document.querySelectorAll('#an-chunks .chunk-detail')).map((e) => e.textContent));
  await page.fill('#an-input', 'gjyjvfhtdf');
  check('names: chunk title', (await titles())[0] === 'Имя или название', (await titles()).join(' | '));
  check('names: layout note', (await details()).join(' ').includes('английской раскладке'), (await details()).join(' | '));
  check('names: 16,8 bits', (await page.textContent('#an-bits')) === '16,8 бита', await page.textContent('#an-bits'));
  await page.fill('#an-input', 'krasnoyarsk');
  check('city: 16,8 bits', (await page.textContent('#an-bits')) === '16,8 бита', await page.textContent('#an-bits'));
  await page.fill('#an-input', 'Rhfcyjzhcr24');
  check('city in layout: 27,4 bits', (await page.textContent('#an-bits')) === '27,4 бита', await page.textContent('#an-bits'));

  /* ---------- Личные данные ---------- */
  await page.click('#pd-box summary');
  check('personal box opened', await page.isVisible('#pd-name'));
  await page.fill('#an-input', 'Ilya2008!');
  const before = await page.textContent('#an-bits');
  await page.fill('#pd-name', 'Илья');
  await page.fill('#pd-birth', '2008-05-15');
  await page.fill('#pd-pet', 'Барсик');
  await page.fill('#pd-city', 'Красноярск');
  await page.waitForTimeout(150);
  const after = await page.textContent('#an-bits');
  check('personal: bits drop', parseFloat(before.replace(',', '.')) > parseFloat(after.replace(',', '.')), before + ' → ' + after);
  check('personal: 20,6 bits', after === '20,6 бита', after);
  check('personal: summary counts', (await page.textContent('#pd-summary')).startsWith('4 '), await page.textContent('#pd-summary'));
  check('personal: chunk title', (await titles()).some((t) => t.startsWith('Личные данные')), (await titles()).join(' | '));

  /* ---------- Проверка утечек ---------- */
  check('no request before click', requests.length === 0, String(requests.length));
  await page.click('#an-breach-check');
  await page.waitForFunction(() => document.getElementById('an-breach-box').dataset.state !== 'loading' &&
    document.getElementById('an-breach-box').dataset.state !== 'idle', null, { timeout: 10000 });
  const breachText = await page.textContent('#an-breach-text');
  check('breach: found 19', breachText.includes('Найден в утечках: 19 раз'), breachText);
  check('breach: only prefix sent', requests.length === 1 && /\/range\/[0-9A-F]{5}$/.test(requests[0]) && requests[0].endsWith(sha1('Ilya2008!').slice(0, 5)), requests.join(' '));
  check('breach: hash hidden', !(await page.textContent('#an-breach-hash')).includes(sha1('Ilya2008!').slice(5, 15)));
  check('breach: meta explains padding', (await page.textContent('#an-breach-meta')).includes('пустыш'), await page.textContent('#an-breach-meta'));
  await page.fill('#an-input', 'Ilya2008!x');
  await page.waitForTimeout(100);
  check('breach: reset after edit', (await page.getAttribute('#an-breach-box', 'data-state')) === 'idle');
  await page.fill('#an-input', 'Ilya2008!');
  await page.click('#an-breach-check');
  await page.waitForFunction(() => document.getElementById('an-breach-box').dataset.state === 'found', null, { timeout: 10000 });
  await page.click('#pd-clear');
  await page.waitForTimeout(100);
  check('personal cleared', (await page.textContent('#pd-summary')) === 'не указаны');
  await shot(page, '24-analyzer-breach.png');

  /* ---------- Похожие пароли ---------- */
  await page.fill('#an-input', 'Barsik2024!');
  await page.click('#an-similar-add');
  await page.fill('.similar-input', 'Barsik2023!');
  await page.waitForTimeout(150);
  const sim = await page.evaluate(() => ({
    bits: document.querySelector('.similar-bits').textContent,
    verdict: document.querySelector('.similar-verdict').textContent,
    ops: document.querySelector('.similar-ops').textContent,
    visible: !document.querySelector('.similar-result').hidden,
  }));
  check('similar visible', sim.visible);
  check('similar 11,1 bits', sim.bits === '11,1 бита', sim.bits);
  check('similar: edits hidden while password hidden', sim.ops === '' && await page.isHidden('.similar-ops'), sim.ops);
  check('similar verdict', sim.verdict === 'Почти такой же: 1 правка', sim.verdict);
  await page.click('#an-toggle');
  await page.waitForTimeout(100);
  const ops = await page.textContent('.similar-ops');
  check('similar: edits shown after reveal', ops.startsWith('Правки:') && ops.includes('4'), ops);
  await page.click('#an-toggle');
  await page.fill('.similar-input', 'Barsik2024!');
  await page.waitForTimeout(100);
  check('similar same: 0 bits', (await page.textContent('.similar-bits')) === '0 бит', await page.textContent('.similar-bits'));
  await page.fill('.similar-input', 'Barsik2023!');
  await shot(page, '25-analyzer-similar.png');

  /* ---------- Теория: раздел 19 ---------- */
  await page.click('#tab-theory');
  await page.waitForFunction(() => !document.getElementById('panel-theory').hidden);
  const th = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('#panel-theory h2')).find((e) => e.textContent.startsWith('19.'));
    const sec = h.closest('section');
    return {
      title: h.textContent,
      rows: sec.querySelectorAll('tbody tr').length,
      cells: sec.querySelectorAll('tbody tr:first-child td').length,
      text: sec.textContent,
      last: Array.from(document.querySelectorAll('#panel-theory h2')).pop().textContent,
    };
  });
  check('theory 19 title', th.title === '19. Проверка на миллионе настоящих паролей', th.title);
  check('theory 19 table 7 rows', th.rows === 7, String(th.rows));
  check('theory 19 table 4+ columns', th.cells >= 4, String(th.cells));
  check('theory 19 mentions zxcvbn and Hunspell', th.text.includes('zxcvbn') && th.text.includes('Hunspell'));
  check('theory last section 20', th.last === '20. Источники данных', th.last);
  check('theory sources: OpenCorpora', (await page.textContent('#panel-theory')).includes('OpenCorpora'));
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('#panel-theory h2')).find((e) => e.textContent.startsWith('19.'));
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 64);
  });
  await page.screenshot({ path: path.join(shots, '26-theory-19.png') });
  check('footer present', (await page.textContent('footer')).includes('BastionBit'));

  /* ---------- Телефон 390 px ---------- */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await noMotion(mctx);
  await fakeHibp(mctx);
  const mp = await mctx.newPage();
  mp.on('pageerror', (e) => errors.push('mobile: ' + String(e)));
  mp.on('console', (m) => { if (m.type() === 'error') errors.push('mobile: ' + m.text()); });
  await mp.goto(url);
  await mp.click('label.mode-option:has-text("Правило")');
  await mp.waitForTimeout(150);
  check('mobile rule: no overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await shot(mp, '27-rule-mobile.png');
  await mp.click('#tab-analyzer');
  await mp.waitForFunction(() => document.getElementById('an-status').hidden && typeof zxcvbn === 'function', null, { timeout: 20000 });
  await mp.click('#pd-box summary');
  await mp.fill('#pd-name', 'Илья');
  await mp.fill('#an-input', 'Ilya2008!');
  await mp.click('#an-similar-add');
  await mp.fill('.similar-input', 'Ilya2007!');
  await mp.waitForTimeout(150);
  check('mobile analyzer: no overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  await mp.click('#tab-theory');
  await mp.waitForTimeout(100);
  check('mobile theory: no overflow', (await overflow(mp)) <= 0, String(await overflow(mp)));
  const tableFits = await mp.evaluate(() => {
    const h = Array.from(document.querySelectorAll('#panel-theory h2')).find((e) => e.textContent.startsWith('19.'));
    const wrap = h.closest('section').querySelector('.table-wrap');
    return wrap.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5;
  });
  check('mobile theory 19 table inside screen', tableFits);

  check('no console errors', errors.length === 0, errors.join('\n'));
  await browser.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
