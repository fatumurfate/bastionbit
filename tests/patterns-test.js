// Тесты этапа 2: детектор хитростей, срок годности, сравнение с zxcvbn.
// Запуск: node tests/patterns-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..');
const CORE = ['js/random.js', 'js/entropy.js', 'js/generator.js', 'data/words-ru.js', 'js/phrase.js'];
const DICTS = ['data/top-passwords.js', 'data/dict-ru.js', 'data/dict-en.js', 'data/dict-names.js'];

function load(files) {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx, { filename: f });
  return (name) => vm.runInContext(name, ctx);
}

// С словарями и без них (чтобы проверять дорожки, даты и повторы отдельно)
const full = load([...CORE, ...DICTS, 'js/patterns.js']);
const bare = load([...CORE, 'js/patterns.js']);
const [E, G, P, D] = ['BBEntropy', 'BBGenerator', 'BBPhrase', 'BBPatterns'].map(full);
const B = bare('BBPatterns');
// zxcvbn 4.4.2: сама библиотека — из vendor/, внутренние формулы — из tests/zxcvbn-lib/
const zxcvbn = require(path.join(base, 'vendor', 'zxcvbn.js'));
const zxGraphs = require('./zxcvbn-lib/adjacency_graphs.js');
const zxScoring = require('./zxcvbn-lib/scoring.js');

let failed = 0;
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) passed++;
  else { failed++; if (failed < 40) console.log('FAIL', name, extra); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const types = (r) => r.chunks.map((c) => c.type).join(',');
const show = (r) => r.chunks.map((c) => `${c.token}:${c.type}:${c.bits.toFixed(2)}`).join(' | ');

/* ---------- Готовность словарей ---------- */
check('dictionaries ready', D.ready() && D.prepare());
check('bare: no dictionaries', !B.ready());

/* ---------- Клавиатура совпадает с zxcvbn ---------- */
for (const name of ['qwerty', 'keypad']) {
  const mine = D.KEYBOARDS[name].graph;
  const theirs = zxGraphs[name];
  const keys = Object.keys(theirs);
  check(`${name}: same keys`, keys.length === Object.keys(mine).length && keys.every((k) => k in mine));
  check(`${name}: same neighbours`, keys.every((k) => JSON.stringify(mine[k]) === JSON.stringify(theirs[k])));
}
check('qwerty starts/degree', D.KEYBOARDS.qwerty.starts === 94 && near(D.KEYBOARDS.qwerty.degree, 4.595744680851064));
check('keypad starts/degree', D.KEYBOARDS.keypad.starts === 15 && near(D.KEYBOARDS.keypad.degree, 5.066666666666666));

// Формула дорожки совпадает с zxcvbn
for (const [token, turns, shifted, graph] of [['qwerty', 1, 0, 'qwerty'], ['qazxsw', 3, 0, 'qwerty'], ['QWErty', 1, 3, 'qwerty'], ['!@#$', 1, 4, 'qwerty'], ['7896', 2, 0, 'keypad'], ['zxcvbnm,./', 1, 0, 'qwerty']]) {
  const theirs = Math.log2(zxScoring.spatial_guesses({ graph, token, turns, shifted_count: shifted }));
  const mine = D.walkBits(token.length, turns, shifted, D.KEYBOARDS[graph]);
  check(`walk bits ${token}`, near(mine, theirs, 1e-9), `${mine} vs ${theirs}`);
}

// Регистр букв совпадает с zxcvbn там, где правила одинаковые
for (const token of ['password', 'Password', 'PASSWORD', 'PaSsWoRd', 'passWORDs', 'PASSWORd']) {
  const theirs = Math.log2(zxScoring.uppercase_variations({ token }));
  check(`case bits ${token}`, near(D.caseBits(Array.from(token)), theirs, 1e-9), `${D.caseBits(Array.from(token))} vs ${theirs}`);
}
check('short mixed case is not a word', D.caseBits(Array.from('kGB')) === null && D.caseBits(Array.from('nOW')) === null);
check('Cyrillic case', D.caseBits(Array.from('Пароль')) === 1 && D.caseBits(Array.from('ПАРОЛЬ')) === 1);

/* ---------- Отдельные хитрости (без словарей) ---------- */
function only(pw, type, bits, analyzer = B) {
  const r = analyzer.analyze(pw);
  const ok = r.found && r.chunks.length === 1 && r.chunks[0].type === type && (bits === undefined || near(r.bits, bits, 1e-6));
  check(`${pw} → ${type}${bits !== undefined ? ' ' + bits.toFixed(2) : ''}`, ok, show(r) + ' = ' + r.bits);
  return r;
}
const L2 = Math.log2;
only('qwerty', 'keyboard', L2(5 * 94 * 4.595744680851064));
only('asdfghjkl', 'keyboard');
only('zaq1', 'keyboard');
const qaz = B.analyze('qazwsx');
check('qazwsx → qaz + wsx', types(qaz) === 'keyboard,keyboard', show(qaz));
only('йцукен', 'keyboard', L2(5 * 94 * 4.595744680851064) + 1);
only('7896', 'keyboard', L2(zxScoring.spatial_guesses({ graph: 'keypad', token: '7896', turns: 2, shifted_count: 0 })));
check('147258369 → popular password', D.analyze('147258369').chunks[0].dictionary === 'passwords');
const walk2 = B.analyze('1qaz2wsx');
check('1qaz2wsx → two walks', types(walk2) === 'keyboard,keyboard' && near(walk2.bits, 2 * L2(3 * 94 * 4.595744680851064) + 3), show(walk2));
only('15051998', 'date', L2(365 * 81));
only('19980515', 'date', L2(365 * 81));
only('150598', 'date', L2(365 * 100));
only('15.05.1998', 'date', L2(365 * 81) + 2);
only('1998-05-15', 'date', L2(365 * 81) + 2);
only('15/05', 'date', L2(366) + 2);
only('1505', 'date', L2(366));
only('1998', 'year', L2(81));
only('2030', 'year', L2(81));
check('1949 is not a year', !B.analyze('1949').chunks.some((c) => c.type === 'year'));
check('31.02.1998 is not a date', !B.analyze('31.02.1998').chunks.some((c) => c.type === 'date' && c.token === '31.02.1998'));
only('aaaa', 'repeat', L2(26) + 2);
only('abcabcabc', 'repeat', L2(4 * 3) + L2(3));
only('abcd', 'sequence', L2(4 * 4));
only('9876', 'sequence', L2(4 * 4 * 2));
only('1357', 'sequence', L2(4 * 4));
only('bcdef', 'sequence', L2(26 * 5));
only('абвгд', 'sequence', L2(4 * 5));
check('step 3 is not a sequence', !B.analyze('adgj').chunks.some((c) => c.type === 'sequence'));
const mixed = B.analyze('aaaa1998');
check('aaaa1998 → repeat + year', types(mixed) === 'repeat,year' && near(mixed.bits, L2(26) + 2 + L2(81) + 3), show(mixed));

/* ---------- Словари ---------- */
const pw1 = D.analyze('Password1!');
check('Password1! → popular password + random', types(pw1) === 'dictionary,random' && pw1.chunks[0].dictionary === 'passwords', show(pw1));
check('Password1! ≈ 15,8 бита', near(pw1.bits, 1 + 1 + 2 * L2(42) + 3, 1e-9), pw1.bits);
check('Password1! naive 65,5', near(pw1.naiveBits, 10 * L2(94)));

function hit(pw, test, name) {
  const r = D.analyze(pw);
  check(`${pw}: ${name}`, r.found && r.chunks.some(test), show(r));
  return r;
}
hit('password', (c) => c.dictionary === 'passwords' && c.rank === 2, 'rank 2');
hit('dragon', (c) => c.dictionary === 'passwords' && c.token === 'dragon', 'popular');
hit('p@$$w0rd', (c) => c.variant.leet && c.variant.leet.length === 3, 'l33t');
hit('P4ssw0rd', (c) => c.variant.leet && c.caseBits === 1, 'l33t + capital');
hit('drowssap', (c) => c.variant.reversed && c.word === 'password', 'reversed');
hit('ghbdtn', (c) => c.variant.layout === 'ru' && c.word === 'привет', 'layout ru');
hit('Ghbdtn2024!', (c) => c.variant.layout === 'ru' && c.caseBits === 1, 'layout capital');
hit('йцукен', (c) => c.variant.layout === 'en' && c.word === 'qwerty', 'layout en');
hit('privet123', (c) => c.variant.translit && c.word === 'привет', 'translit');
hit('kotik', (c) => c.variant.translit && c.word === 'котик', 'translit kotik');
hit('Кот2010', (c) => c.dictionary === 'ru' && c.word === 'кот', 'short Russian word');
hit('correcthorsebatterystaple', (c) => c.word === 'battery', 'english words');
hit('синий чайник поёт ночью', (c) => c.word === 'чайник', 'russian words');
const gf = D.analyze('gfhjkm');
check('gfhjkm described as пароль in English layout', D.describe(gf.chunks[0]).detail.includes('это «пароль» в английской раскладке'), D.describe(gf.chunks[0]).detail);
check('hidden detail has no word', !/gfhjkm|пароль|№/.test(D.describe(gf.chunks[0], { reveal: false }).detail));
check('hidden repeat has no unit', !D.describe(D.analyze('qweqweqwe').chunks[0], { reveal: false }).detail.includes('qwe'));
check('hidden date has no digits', !/\d{2}\.\d{2}/.test(D.describe(D.analyze('15051998').chunks[0], { reveal: false }).detail));
check('advice for Password1!', D.advice(pw1).length >= 1 && D.advice(pw1).length <= 3);

/* ---------- Фраза BastionBit ---------- */
for (const words of [5, 6]) {
  for (let k = 0; k < 20; k++) {
    const phrase = P.generate({ words });
    const r = D.analyze(phrase.text);
    check(`phrase ${words}`, r.chunks.length === 1 && r.chunks[0].type === 'phrase' && near(r.bits, P.bits(words)), phrase.text + ' → ' + show(r));
    const layout = D.analyze(phrase.layout);
    check(`phrase ${words} in layout`, layout.chunks[0] && layout.chunks[0].type === 'phrase' && layout.chunks[0].layout, phrase.layout + ' → ' + show(layout));
    const plus = D.analyze(phrase.text + ' 1987!');
    check(`phrase ${words} + suffix`, plus.chunks[0].type === 'phrase' && plus.chunks.length >= 2 && plus.bits > P.bits(words), show(plus));
  }
}

/* ---------- Случайные пароли: детектор молчит ---------- */
const settings = [
  { length: 16, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false },
  { length: 12, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: true },
  { length: 20, lower: true, upper: false, digits: false, symbols: false, avoidSimilar: false },
];
for (const options of settings) {
  let found = 0;
  const N = 600;
  for (let k = 0; k < N; k++) {
    const pw = G.generate(options);
    const r = D.analyze(pw);
    if (r.found) found++;
    // Проверяется каждый пароль, поэтому число проверок не зависит от случая: если детектор молчит,
    // оценка равна формуле; если нашёл ложную «хитрость» — в пароле есть такой кусок и оценка ниже формулы.
    check('random: estimate consistent', r.found ? r.chunks.some((c) => c.type !== 'random') && r.bits < r.naiveBits
      : near(r.bits, r.naiveBits) && r.chunks.length === 0, pw);
  }
  // На 20 000 паролей ложных срабатываний 0,3–1,2 % (tools/evaluate.js); порог 3 %
  // с запасом: при N = 600 случайный разброс иначе иногда даёт «провал».
  check(`random ${options.length}: false positives < 3%`, found / N < 0.03, `${found}/${N}`);
}

/* ---------- Оценка никогда не выше формулы ---------- */
const samples = ['Tr0ub4dor&3', 'Ivan1985', 'qwertyuiop123', 'x7#Kq9!mZ2$vL8@n', 'Hq7$dragon!Kp2&', 'iloveyou', 'monkey12345',
  'ЙЦУКЕН123', 'Марсианский бобер', '🙂🙂🙂🙂', 'a', 'ab', '   ', 'пароль', 'ПАРОЛЬ', '01.01.2000', '!@#$%^&*'];
for (const pw of samples) {
  const r = D.analyze(pw);
  check(`${pw}: bits ≤ naive`, r.bits <= r.naiveBits + 1e-9, `${r.bits} > ${r.naiveBits}`);
  check(`${pw}: chunks cover password`, !r.found || r.chunks.map((c) => c.token).join('') === pw);
}
const empty = D.analyze('');
check('empty password', !empty.found && empty.bits === 0);
const long = 'Password1!'.repeat(15);
const longResult = D.analyze(long);
check('150 chars: tail by formula', longResult.found && longResult.chunks[longResult.chunks.length - 1].tail === true, show(longResult).slice(0, 200));
let t = performance.now();
for (let k = 0; k < 20; k++) D.analyze(G.generate({ length: 100, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false }));
const ms = (performance.now() - t) / 20;
check('100 random chars < 40 ms', ms < 40, ms.toFixed(1) + ' ms');
console.log(`analyze 100 random chars: ${ms.toFixed(1)} ms`);

/* ---------- Срок годности (2.4) ---------- */
const md5 = E.SCENARIOS.find((s) => s.id === 'md5');
const years60 = E.expiryYears(60, md5.speed);
check('expiry H=60 MD5 ≈ 10,8 года', Math.abs(years60 - 10.8) < 0.05, years60);
check('expiry formula', near(years60, 2 * (60 - 1 - L2(1.6e11) - L2(86400))));
check('after expiry crack time = 1 day', near(E.crackTimeLog10At(60, md5.speed, years60), Math.log10(86400), 1e-9));
check('weak password already expired', E.expiryYears(20, md5.speed) < 0);
check('quantum H/2', E.quantumBits(60) === 30);

/* ---------- Сравнение с zxcvbn ---------- */
const zxBits = (pw) => zxcvbn(pw).guesses_log10 / Math.log10(2);
console.log('\nпароль                          формула  BastionBit  zxcvbn');
for (const pw of ['Password1!', 'p@$$w0rd', 'qwerty', 'dragon', 'gfhjkm', 'ghbdtn', 'привет123', 'Ghbdtn2024!', 'parol2010',
  'correcthorsebatterystaple', 'синий чайник поёт ночью', 'x7#Kq9!mZ2$vL8@n']) {
  const r = D.analyze(pw);
  console.log(pw.padEnd(32), r.naiveBits.toFixed(1).padStart(7), r.bits.toFixed(1).padStart(11), zxBits(pw).toFixed(1).padStart(7));
}
check('zxcvbn: Password1! weak in both', D.analyze('Password1!').bits < 20 && zxBits('Password1!') < 20);
check('Russian in layout: BastionBit lower than zxcvbn', D.analyze('Ghbdtn2024!').bits < zxBits('Ghbdtn2024!'));
check('Russian words: BastionBit lower than zxcvbn', D.analyze('привет123').bits < zxBits('привет123'));
check('random: BastionBit = formula', near(D.analyze('x7#Kq9!mZ2$vL8@n').bits, E.analyze('x7#Kq9!mZ2$vL8@n').bits));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
