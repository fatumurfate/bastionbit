// Запуск всех автоматических тестов BastionBit (из папки проекта):
//   node tests/run.js            — все наборы (браузерные — если установлен Playwright)
//   node tests/run.js --node     — только модули: нужен лишь Node.js 20+, ничего ставить не надо
//   node tests/run.js --browser  — только проверки страницы в браузере (нужен Playwright)
//   node tests/run.js --verbose  — полный вывод каждого набора
// То же из папки tests: npm test, npm run test:node, npm run test:browser.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const SUITES = [
  { file: 'keyword-test.js', title: 'Генератор и пароль из ключевого слова (этапы 0, 1.2)' },
  { file: 'phrase-test.js', title: 'Русская фраза (этап 1.3)' },
  { file: 'patterns-test.js', title: 'Детектор хитростей и сравнение с zxcvbn (этап 2)' },
  { file: 'trainer-test.js', title: 'Тренажёр запоминания (этап 3)' },
  { file: 'game-test.js', title: 'Игра «Взломай сам» (этап 3)' },
  { file: 'stage45-test.js', title: 'Правило, личные данные, утечки, имена (этапы 4–5)' },
  { file: 'browser-test.js', title: 'Браузер: генератор, анализатор, теория (этапы 0–2)', browser: true },
  { file: 'trainer-browser-test.js', title: 'Браузер: тренажёр и игра (этап 3)', browser: true },
  { file: 'stage45-browser-test.js', title: 'Браузер: этапы 4–5', browser: true },
];

const args = process.argv.slice(2);
const known = ['--node', '--browser', '--verbose', '-v'];
const unknown = args.filter((a) => !known.includes(a));
if (unknown.length) {
  console.log(`Неизвестный параметр: ${unknown.join(' ')}. Можно: --node, --browser, --verbose`);
  process.exit(2);
}
const verbose = args.includes('--verbose') || args.includes('-v');
const onlyNode = args.includes('--node') && !args.includes('--browser');
const onlyBrowser = args.includes('--browser') && !args.includes('--node');

if (Number(process.versions.node.split('.')[0]) < 20) {
  console.log(`Нужен Node.js 20 или новее, а установлен ${process.version}. Скачать: https://nodejs.org`);
  process.exit(1);
}
let hasPlaywright = true;
try { require.resolve('playwright'); } catch (e) { hasPlaywright = false; }

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, one, few, many) => {
  const a = n % 100, b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const checks = (n) => `${num(n)} ${plural(n, 'проверка', 'проверки', 'проверок')}`;
const secs = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

function run(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, suite.file)], { cwd: path.join(__dirname, '..') });
    let out = '';
    const onData = (d) => { out += d; if (verbose) process.stdout.write(d); };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { out += '\nНабор не уложился в 15 минут и остановлен'; child.kill(); }, 15 * 60 * 1000);
    child.on('error', (e) => { out += `\n${e.message}`; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - started }); });
  });
}

(async () => {
  const selected = SUITES.filter((s) => (onlyNode ? !s.browser : onlyBrowser ? s.browser : true));
  const width = Math.max(...selected.map((s) => s.title.length));
  const notes = new Set();
  const started = Date.now();
  let total = 0, failedChecks = 0, broken = 0, skipped = 0, browserRan = false;
  console.log(`BastionBit — автоматические тесты (Node.js ${process.version})\n`);

  for (const s of selected) {
    const label = `  ${s.title.padEnd(width)}  `;
    if (s.browser && !hasPlaywright) { console.log(`${label}— пропущен: нет Playwright`); skipped++; continue; }
    if (verbose) console.log(`\n=== ${s.title} — tests/${s.file} ===`);
    else process.stdout.write(label);
    const r = await run(s);
    browserRan = browserRan || Boolean(s.browser);
    const m = [...r.out.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
    const passed = m ? Number(m[1]) : 0;
    const failed = m ? Number(m[2]) : 0;
    const ok = r.code === 0 && Boolean(m) && failed === 0;
    total += passed + failed;
    failedChecks += failed;
    if (!ok && !failed) broken++;
    r.out.split('\n').filter((l) => l.startsWith('ПРИМЕЧАНИЕ:')).forEach((l) => notes.add(l.slice(11).trim()));
    if (!ok && s.browser && /playwright install|Executable doesn't exist/i.test(r.out)) {
      notes.add('Playwright установлен, но браузер для него не скачан: в папке tests выполните «npx playwright install chromium» ' +
        'или укажите путь к своему Chromium в переменной CHROMIUM_PATH.');
    }
    const status = ok ? `✓ ${checks(passed)}` : failed ? `✗ ошибок: ${failed} из ${checks(passed + failed)}` :
      `✗ набор не завершился (код ${r.code})`;
    console.log(verbose ? `--- ${status}, ${secs(r.ms)}` : `${status}  (${secs(r.ms)})`);
    if (!ok && !verbose) {
      const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL'));
      const shown = fails.length ? fails.slice(0, 20) : r.out.trim().split('\n').slice(-15);
      shown.forEach((l) => console.log(`      ${l}`));
      if (fails.length > 20) console.log(`      … и ещё ${fails.length - 20}`);
    }
  }

  console.log('');
  for (const n of notes) console.log(`Примечание: ${n}`);
  if (skipped) {
    console.log('Браузерные наборы пропущены: не найден Playwright. Чтобы запустить и их, выполните:\n' +
      '  cd tests\n  npm install\n  npx playwright install chromium\n  npm test');
  }
  if (browserRan) console.log('Снимки экрана из браузерных проверок: tests/shots');
  const bad = [failedChecks ? `ошибок: ${failedChecks}` : '', broken ? `не завершились наборы: ${broken}` : ''].filter(Boolean);
  console.log(`Итого: ${checks(total)}, ${bad.length ? bad.join('; ') : 'все прошли'} (${secs(Date.now() - started)}).`);
  process.exit(bad.length || (onlyBrowser && skipped) ? 1 : 0);
})();
