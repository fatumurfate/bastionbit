// Тесты этапа 1.2 (и проверка, что этап 0 не сломался). Запуск: node tests/keyword-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', 'js');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
for (const f of ['random', 'entropy', 'generator', 'keyword']) {
  vm.runInContext(fs.readFileSync(path.join(root, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const [R, E, G, K] = ['BBRandom', 'BBEntropy', 'BBGenerator', 'BBKeyword'].map((n) => vm.runInContext(n, ctx));

// Сверка с независимой реализацией на Python (tests/reference.py). Если Python не установлен,
// берутся её ответы, сохранённые в fixtures/keyword-python.json (обновить: node tests/keyword-test.js --save-python).
const PY_SAVED = path.join(__dirname, 'fixtures', 'keyword-python.json');
function runPython(input) {
  for (const [cmd, ...pre] of [['python3'], ['python'], ['py', '-3']]) {
    let out;
    try {
      out = execFileSync(cmd, [...pre, path.join(__dirname, 'reference.py')], { input: JSON.stringify(input), stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) { continue; }
    const res = JSON.parse(out.toString());
    if (process.argv.includes('--save-python')) fs.writeFileSync(PY_SAVED, JSON.stringify(res) + '\n');
    return res;
  }
  console.log('ПРИМЕЧАНИЕ: Python не найден — сверка с сохранёнными ответами reference.py (tests/fixtures/keyword-python.json)');
  return JSON.parse(fs.readFileSync(PY_SAVED, 'utf8'));
}

let failed = 0;
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) passed++;
  else { failed++; console.log('FAIL', name, extra); }
}
const hex = (u8) => Buffer.from(u8).toString('hex');
const enc = (s) => new TextEncoder().encode(s);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const DEFAULT = { length: 16, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false };

// Простой детерминированный генератор для случайных тестовых входов
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const WORDS = ['кот', 'Ёжик', 'синий чайник', 'Mail', 'дом 42', 'p@ss', 'лес', 'Москва-река', 'zebra', '7'];
const SITES = ['vk.com', 'mail.ru', 'gosuslugi.ru', 'github.com', 'президент.рф', 'example.org'];

(async () => {
  /* --- Эталонные примеры из стандартов --- */
  const p1 = await K.pbkdf2(enc('passwd'), enc('salt'), 1, 64);
  check('RFC 7914 PBKDF2 #1', hex(p1) === '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783', hex(p1));
  const p2 = await K.pbkdf2(enc('Password'), enc('NaCl'), 80000, 64);
  check('RFC 7914 PBKDF2 #2', hex(p2) === '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d', hex(p2));
  const h1 = await K.hkdf(new Uint8Array(22).fill(0x0b), Uint8Array.from({ length: 13 }, (_, i) => i),
    Uint8Array.from({ length: 10 }, (_, i) => 0xf0 + i), 42);
  check('RFC 5869 HKDF #1', hex(h1) === '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865', hex(h1));

  /* --- Приведение к одному виду --- */
  const sites = ['https://www.VK.com/feed', 'vk.com', ' VK.COM ', 'http://vk.com:443/?a=1#x', 'ivan@vk.com', 'www.vk.com.', 'vk .com'];
  sites.forEach((s) => check('site ' + JSON.stringify(s), K.normalizeSite(s) === 'vk.com', K.normalizeSite(s)));
  check('site cyrillic', K.normalizeSite('https://Президент.РФ/') === 'президент.рф');
  check('site empty', K.normalizeSite('https://') === '');
  check('text ё/case/spaces', K.normalizeText('  Ёжик   В\tТумане\u200b ') === 'ежик в тумане', K.normalizeText('  Ёжик   В\tТумане\u200b '));
  check('text NFC', K.normalizeText('и\u0306') === K.normalizeText('й'));
  check('version', K.normalizeVersion('') === 1 && K.normalizeVersion('0') === 1 && K.normalizeVersion('3.7') === 3 && K.normalizeVersion('5000') === 999 && K.normalizeVersion('abc') === 1);
  check('problem site', K.problem(K.normalizeInputs({ site: ' ', keyword: 'кот', master: '', version: 1 })) === 'site');
  check('problem secret', K.problem(K.normalizeInputs({ site: 'vk.com', keyword: ' ', master: '', version: 1 })) === 'secret');

  /* --- Детерминизм и независимость --- */
  const base = { site: 'vk.com', keyword: 'кот', master: 'фиолетовый ёж продал чайник', version: 1 };
  const a = await K.derive(base, DEFAULT);
  const b = await K.derive({ ...base, site: 'https://www.VK.com/', keyword: 'КОТ', master: '  Фиолетовый еж  продал чайник' }, DEFAULT);
  check('same input → same password', a.password === b.password, a.password + ' / ' + b.password);
  check('full 600k length', a.password.length === 16);
  console.log('Контрольный пример (vk.com / кот / фиолетовый ёж продал чайник / версия 1 / 16 символов):', a.password, `(${Math.round(a.ms)} мс)`);
  const variants = [
    { ...base, version: 2 }, { ...base, site: 'mail.ru' }, { ...base, keyword: 'кошка' }, { ...base, master: 'фиолетовый ёж продал чайники' },
  ];
  for (const v of variants) {
    const r = await K.derive(v, DEFAULT, 1000);
    check('change gives new password ' + JSON.stringify(v), r.password !== (await K.derive(base, DEFAULT, 1000)).password);
  }
  const long = await K.derive(base, { ...DEFAULT, length: 20 }, 1000);
  const short = await K.derive(base, DEFAULT, 1000);
  check('length change is independent (no common prefix)', !long.password.startsWith(short.password.slice(0, 8)), short.password + ' / ' + long.password);

  /* --- Свойства на многих входах + сверка с Python --- */
  const cases = [];
  for (let i = 0; i < 120; i++) {
    const keys = ['lower', 'upper', 'digits', 'symbols'];
    const options = { length: 8 + rnd(57), avoidSimilar: rnd(2) === 1 };
    keys.forEach((k) => { options[k] = rnd(3) > 0; });
    if (!keys.some((k) => options[k])) options.lower = true;
    if (i < 10) Object.assign(options, { length: 8, lower: true, upper: true, digits: true, symbols: true });
    const inputs = { site: SITES[rnd(SITES.length)], keyword: WORDS[rnd(WORDS.length)], master: rnd(4) ? WORDS[rnd(WORDS.length)] + ' ' + WORDS[rnd(WORDS.length)] : '', version: 1 + rnd(5) };
    cases.push({ inputs, options });
  }
  const jsResults = [];
  for (const c of cases) {
    const r = await K.derive(c.inputs, c.options, 1000);
    jsResults.push(r.password);
    const classes = G.buildClasses(c.options);
    const pool = classes.flatMap((x) => x.chars);
    const pw = Array.from(r.password);
    check('length', pw.length === c.options.length, JSON.stringify(c));
    check('only allowed chars', pw.every((ch) => pool.includes(ch)), r.password);
    check('every class present', classes.every((cl) => pw.some((ch) => cl.chars.includes(ch))), r.password);
    if (c.options.avoidSimilar) check('no similar', pw.every((ch) => !G.SIMILAR.includes(ch)), r.password);
  }
  const pyInput = cases.map((c) => ({ ...K.normalizeInputs(c.inputs), options: c.options, iterations: 1000 }));
  pyInput.push({ ...K.normalizeInputs(base), options: DEFAULT, iterations: 600000 });
  const py = runPython(pyInput);
  const mismatches = jsResults.filter((p, i) => p !== py[i]).length;
  check('JS = Python on 120 cases', mismatches === 0, `${mismatches} mismatches`);
  check('JS = Python on control example (600 000)', py[py.length - 1] === a.password, py[py.length - 1]);

  /* --- Оценка стойкости --- */
  const W = Math.log2(50000);
  check('secret кот', near(K.secretBits('кот'), 3 * Math.log2(33)));
  check('secret long word capped', near(K.secretBits('фиолетовый'), W));
  check('secret two words', near(K.secretBits('синий чайник'), 2 * W));
  check('secret word+digits', near(K.secretBits('кот2024'), 3 * Math.log2(33) + 4 * Math.log2(10)));
  check('secret empty', K.secretBits('   ') === 0);
  const est = K.estimate({ site: 'vk.com', keyword: 'кот', master: 'синий чайник', version: 1 }, DEFAULT);
  check('estimate sum', near(est.guessBits, 3 * Math.log2(33) + 2 * W) && near(est.bits, est.guessBits));
  check('estimate capped by password', near(K.estimate({ ...base, master: 'один два три четыре пять шесть семь восемь' }, { ...DEFAULT, length: 8, symbols: false }).bits, G.exactEntropy({ ...DEFAULT, length: 8, symbols: false }).bits));
  check('slowdown bits', near(est.slowdownBits, Math.log2(600000)));
  const md5 = E.SCENARIOS.find((s) => s.id === 'md5');
  const online = E.SCENARIOS.find((s) => s.id === 'online');
  const t1 = K.crackTime(K.estimate({ site: 'vk.com', keyword: 'кот', master: '', version: 1 }, DEFAULT), md5);
  check('md5 via PBKDF2', t1.target === 'words' && t1.slowed && t1.speed === 1.5e4, JSON.stringify(t1));
  check('кот alone ≈ 1 s', Math.abs(10 ** t1.lg - 2 ** (3 * Math.log2(33)) / 3e4) < 1e-6, String(10 ** t1.lg));
  const t2 = K.crackTime(est, online);
  check('online not slowed', !t2.slowed && t2.speed === 10);
  const weak = K.estimate({ ...base, master: 'один два три четыре пять шесть семь восемь' }, { length: 8, lower: false, upper: false, digits: true, symbols: false, avoidSimilar: false });
  check('short digits → password path', K.crackTime(weak, md5).target === 'password');

  /* --- Этап 0 не сломался --- */
  check('Password1! = 65,5', near(E.analyze('Password1!').bits, 10 * Math.log2(94)));
  const tiny = { length: 3, lower: false, upper: false, digits: true, symbols: false, avoidSimilar: false };
  check('countValid digits', G.countValid([10], 3) === 1000n);
  check('countValid 2 sets brute', G.countValid([2, 3], 3) === 5n ** 3n - 2n ** 3n - 3n ** 3n);
  check('random generate', G.generate(DEFAULT).length === 16 && G.generate(tiny).length === 3);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) counts[R.randomInt(10)]++;
  check('randomInt roughly uniform', counts.every((c) => c > 1800 && c < 2200), counts.join(','));
  const fixed = R.fromBytes(Uint8Array.of(0, 0, 0, 5, 255, 255, 255, 255, 0, 0, 0, 7));
  check('fromBytes reads big-endian', fixed.randomInt(10) === 5);
  check('fromBytes rejects tail', fixed.randomInt(10) === 7);
  let exhausted = false;
  try { fixed.randomInt(10); } catch (e) { exhausted = e instanceof R.BytesExhausted; }
  check('fromBytes exhausted', exhausted);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
