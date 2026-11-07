// Тесты этапа 1.3: словари, грамматика, стойкость, распознавание фразы.
// Запуск: node tests/phrase-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
for (const f of ['js/random.js', 'js/entropy.js', 'js/generator.js', 'data/words-ru.js', 'js/phrase.js', 'js/keyword.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx, { filename: f });
}
const [R, E, W, P, K] = ['BBRandom', 'BBEntropy', 'BB_WORDS_RU', 'BBPhrase', 'BBKeyword'].map((n) => vm.runInContext(n, ctx));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'words-reference.json'), 'utf8'));

let failed = 0;
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) passed++;
  else { failed++; if (failed < 40) console.log('FAIL', name, extra); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const plain = (s) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const DEFAULT = { length: 16, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false };

/* ---------- Словари в том же порядке, что и в phrase.js ---------- */
const list = (t) => t.trim().split(/\s+/);
const G = ['m', 'f', 'n'];
const adjectives = list(W.adjectives);
const subjects = G.flatMap((g) => list(W.subjects[g]).map((word) => ({ word, gender: g })));
const verbs = list(W.verbs).map((item) => item.split('/')[0]);
const objects = G.flatMap((g) => list(W.objects[g]).map((item) => ({ gender: g, forms: item.split(',') })));

// Подставной генератор: выдаёт заранее заданные номера
function fixed(indices) {
  let i = 0;
  return { pick: (arr) => arr[indices[i++]], randomInt: () => indices[i++] };
}
const firstOf = (g) => subjects.findIndex((s) => s.gender === g);
const SUBJ = { m: firstOf('m'), f: firstOf('f'), n: firstOf('n') };

/* ---------- 1. Словари целы ---------- */
const CYR = /^[а-яё]+$/;
const dupes = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
check('sizes', P.SIZES.adjectives === adjectives.length && P.SIZES.subjects === subjects.length &&
  P.SIZES.verbs === verbs.length && P.SIZES.objects === objects.length && P.SIZES.numbers === 100, JSON.stringify(P.SIZES));
check('sizes = reference', adjectives.length === ref.adjectives.length && subjects.length === ref.subjects.length &&
  verbs.length === ref.verbs.length && objects.length === ref.objects.length);
check('all three genders of subjects', G.every((g) => SUBJ[g] >= 0));
const allWords = [...adjectives, ...subjects.map((s) => s.word), ...list(W.verbs).flatMap((v) => v.split('/')),
  ...objects.flatMap((o) => o.forms)];
check('only lowercase Cyrillic', allWords.every((w) => CYR.test(w)), allWords.filter((w) => !CYR.test(w)).join(' '));
check('objects have 3 forms', objects.every((o) => o.forms.length === 3));
// После замены ё → е разные слова не должны совпасть: иначе фраз меньше, чем по формуле
check('adjectives unique', dupes(adjectives.map(plain)).length === 0, dupes(adjectives.map(plain)).join(' '));
check('subjects unique', dupes(subjects.map((s) => plain(s.word))).length === 0, dupes(subjects.map((s) => plain(s.word))).join(' '));
check('verbs unique', dupes(verbs.map(plain)).length === 0, dupes(verbs.map(plain)).join(' '));
['m', 'f', 'n', 'fAcc', 'pl', 'plGen'].forEach((key) => {
  const forms = adjectives.map((a) => plain(P.adjectiveForms(a)[key]));
  check(`adjective form ${key} unique`, dupes(forms).length === 0, dupes(forms).join(' '));
});
const verbForms = list(W.verbs).map((v) => { const [m, f = m + 'а'] = v.split('/'); return [m, f, f.slice(0, -1) + 'о']; });
[0, 1, 2].forEach((k) => {
  const forms = verbForms.map((v) => plain(v[k]));
  check(`verb form ${k} unique`, dupes(forms).length === 0, dupes(forms).join(' '));
});
for (let k = 0; k < 3; k++) {
  const forms = objects.map((o) => plain(o.forms[k]));
  check(`object form ${k} unique`, dupes(forms).length === 0, dupes(forms).join(' '));
}

/* ---------- 2. Формы совпадают с OpenCorpora (pymorphy3) ---------- */
const refAdj = new Map(ref.adjectives.map((a) => [a.word, a.forms]));
let bad = adjectives.filter((a) => {
  const f = P.adjectiveForms(a);
  const r = refAdj.get(a);
  return !r || [f.f, f.n, f.fAcc, f.pl, f.plGen].join() !== r.join();
});
check('adjective forms = OpenCorpora', bad.length === 0, bad.slice(0, 10).join(' '));

const refSubj = new Set(ref.subjects.map((s) => s.gender + ':' + s.word));
bad = subjects.filter((s) => !refSubj.has(s.gender + ':' + s.word));
check('subjects and genders = OpenCorpora', bad.length === 0, bad.slice(0, 10).map((s) => s.word).join(' '));

const refObj = new Set(ref.objects.map((o) => o.gender + ':' + o.forms.join(',')));
bad = objects.filter((o) => !refObj.has(o.gender + ':' + o.forms.join(',')));
check('object forms = OpenCorpora', bad.length === 0, bad.slice(0, 10).map((o) => o.forms[0]).join(' '));

/* ---------- 3. Согласование в готовой фразе (перебор всех слов) ---------- */
// Прилагательное + кто: род подлежащего
bad = [];
adjectives.forEach((a, i) => G.forEach((g) => {
  const ph = P.generate({ words: 5 }, fixed([i, SUBJ[g], 0, 0, 0]));
  const r = refAdj.get(a);
  const want = cap(plain(g === 'm' ? a : g === 'f' ? r[0] : r[1]));
  if (ph.parts[0].text !== want) bad.push(`${ph.parts[0].text}≠${want}`);
}));
check('adjective agrees with subject (all × 3 genders)', bad.length === 0, bad.slice(0, 10).join(' '));

// Что сделал: род подлежащего
const refVerb = new Map(ref.verbs.map((v) => [v.word, v.forms]));
bad = [];
verbs.forEach((v, i) => G.forEach((g) => {
  const ph = P.generate({ words: 5 }, fixed([0, SUBJ[g], i, 0, 0]));
  const r = refVerb.get(v);
  const want = plain(g === 'm' ? v : g === 'f' ? r[0] : r[1]);
  if (!r || ph.parts[2].text !== want) bad.push(`${ph.parts[2].text}≠${want}`);
}));
check('verb agrees with subject (all × 3 genders)', bad.length === 0, bad.slice(0, 10).join(' '));

// Предмет и второе прилагательное: число
const expectForm = (n) => (n % 10 === 1 && n % 100 !== 11 ? 0
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2);
const NUMS = [1, 2, 3, 4, 5, 10, 11, 12, 14, 15, 20, 21, 22, 24, 25, 31, 42, 57, 91, 99, 100];
bad = [];
objects.forEach((o, i) => NUMS.forEach((n) => {
  const ph = P.generate({ words: 6 }, fixed([0, 0, 0, n - 1, i, 0]));
  const k = expectForm(n);
  const r = refAdj.get(adjectives[0]);
  const adj = k === 0 ? (o.gender === 'm' ? adjectives[0] : o.gender === 'f' ? r[2] : r[1])
    : k === 1 && o.gender === 'f' ? r[3] : r[4];
  if (ph.parts[3].text !== String(n) || ph.parts[5].text !== plain(o.forms[k]) || ph.parts[4].text !== plain(adj)) {
    bad.push(ph.parts.slice(3).map((p) => p.text).join(' '));
  }
}));
check('object and 2nd adjective agree with number', bad.length === 0, bad.slice(0, 10).join(' | '));

// Второе прилагательное — все слова, все рода и формы
bad = [];
const objOf = (g) => objects.findIndex((o) => o.gender === g);
adjectives.forEach((a, i) => G.forEach((g) => [1, 2, 5].forEach((n) => {
  const ph = P.generate({ words: 6 }, fixed([0, 0, 0, n - 1, objOf(g), i]));
  const r = refAdj.get(a);
  const k = expectForm(n);
  const want = plain(k === 0 ? (g === 'm' ? a : g === 'f' ? r[2] : r[1]) : k === 1 && g === 'f' ? r[3] : r[4]);
  if (ph.parts[4].text !== want) bad.push(`${ph.parts[4].text}≠${want}`);
})));
check('2nd adjective forms (all × 3 genders × 3 number forms)', bad.length === 0, bad.slice(0, 10).join(' '));

// countForm против pymorphy3 (make_agree_with_number) для 1…100.
// Ответы pymorphy3 сохранены в fixtures/pymorphy3-agree.json (пересоздать: python tests/fixtures/make_fixtures.py).
const agree = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pymorphy3-agree.json'), 'utf8'));
const ex = { 'чайник': objects.find((o) => o.forms[0] === 'чайник'), 'книга': objects.find((o) => o.forms[0] === 'книгу'),
  'окно': objects.find((o) => o.forms[0] === 'окно') };
Object.entries(agree).forEach(([word, forms]) => {
  const o = ex[word];
  check(`example ${word} in dictionary`, Boolean(o));
  if (!o) return;
  const mism = forms.map((f, i) => [i + 1, f]).filter(([n, f]) => o.forms[{ one: 0, few: 1, many: 2 }[P.countForm(n)]] !== f);
  check(`countForm = pymorphy3 for ${word} 1…100`, mism.length === 0, JSON.stringify(mism.slice(0, 5)));
});

/* ---------- 4. Внешний вид фразы ---------- */
let shapeBad = [];
for (let i = 0; i < 3000; i++) {
  const words = i % 2 ? 5 : 6;
  const ph = P.generate({ words });
  const n = Number(ph.parts[3].text);
  const okShape = ph.parts.length === words && ph.words === words && ph.text === ph.parts.map((p) => p.text).join(' ') &&
    !/[ёЁ]/.test(ph.text) && /^[А-Я]/.test(ph.text) && n >= 1 && n <= 100 && ph.text.split(' ').length === words &&
    ph.layout === P.toEnglishLayout(ph.text) && !/[а-яА-Я]/.test(ph.layout) &&
    ph.parts.map((p) => p.role).join() === (words === 6 ? 'какой,кто,что сделал,сколько,какой,что' : 'какой,кто,что сделал,сколько,что');
  if (!okShape) shapeBad.push(ph.text);
}
check('phrase shape (3000 phrases)', shapeBad.length === 0, shapeBad.slice(0, 5).join(' | '));
check('default is 6 words', P.generate().words === 6 && P.generate().parts.length === 6);

/* ---------- 5. Стойкость ---------- */
const S = P.SIZES;
check('bits(6) = log2(A·S·V·100·A·P)', near(P.bits(6), Math.log2(S.adjectives * S.subjects * S.verbs * 100 * S.adjectives * S.objects), 1e-9), P.bits(6));
check('bits(5) = log2(A·S·V·100·P)', near(P.bits(5), Math.log2(S.adjectives * S.subjects * S.verbs * 100 * S.objects), 1e-9), P.bits(5));
check('default bits = 6 words', P.bits() === P.bits(6));
check('breakdown rows', P.breakdown(6).length === 6 && P.breakdown(5).length === 5 &&
  P.breakdown(6).map((r) => r.count).join() === [S.adjectives, S.subjects, S.verbs, 100, S.adjectives, S.objects].join());
check('bits(6) ≥ 52', P.bits(6) >= 52, P.bits(6));
check('bits(5) ≥ 43', P.bits(5) >= 43, P.bits(5));
console.log(`bits: 6 слов ${P.bits(6).toFixed(2)}, 5 слов ${P.bits(5).toFixed(2)}; sizes ${JSON.stringify(S)}`);

/* ---------- 6. Равномерность выбора ---------- */
const N = 200000;
const numCount = new Array(100).fill(0);
const adjCount = new Map();
const genderCount = { m: 0, f: 0, n: 0 };
const subjGender = new Map(subjects.map((s) => [plain(s.word), s.gender]));
for (let i = 0; i < N; i++) {
  const ph = P.generate({ words: 5 });
  numCount[Number(ph.parts[3].text) - 1]++;
  const subj = ph.parts[1].text;
  genderCount[subjGender.get(subj)]++;
  const adj = ph.parts[0].text.toLowerCase();
  adjCount.set(adj, (adjCount.get(adj) || 0) + 1);
}
const chi = (counts, expected) => counts.reduce((s, c, i) => s + (c - expected[i]) ** 2 / expected[i], 0);
const chiNum = chi(numCount, numCount.map(() => N / 100));
check('numbers uniform (χ², 99 df)', chiNum < 160, chiNum.toFixed(1));
const gN = G.map((g) => subjects.filter((s) => s.gender === g).length);
const chiG = chi(G.map((g) => genderCount[g]), gN.map((c) => N * c / subjects.length));
check('subject gender ∝ dictionary (χ², 2 df)', chiG < 20, chiG.toFixed(1));
console.log(`χ²: числа ${chiNum.toFixed(1)} (99 ст. св.), род ${chiG.toFixed(2)} (2 ст. св.); прилагательных встретилось ${adjCount.size} из ${S.adjectives * 3} форм`);

/* ---------- 7. Английская раскладка ---------- */
check('пароль → gfhjkm', P.toEnglishLayout('пароль') === 'gfhjkm');
check('ё → е → t', P.toEnglishLayout('ёж') === 't;');
check('Синий чайник → Cbybq xfqybr', P.toEnglishLayout('Синий чайник') === 'Cbybq xfqybr', P.toEnglishLayout('Синий чайник'));
const alphabet = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
check('layout round trip (alphabet)', P.fromEnglishLayout(P.toEnglishLayout(alphabet)) === alphabet &&
  P.fromEnglishLayout(P.toEnglishLayout(alphabet.toUpperCase())) === alphabet.toUpperCase());
check('layout keeps digits and spaces', P.toEnglishLayout('кот 42') === 'rjn 42');

/* ---------- 8. Узнавание фразы ---------- */
let recBad = [];
for (let i = 0; i < 4000; i++) {
  const words = i % 2 ? 5 : 6;
  const ph = P.generate({ words });
  const variants = [
    [ph.text, ''], [ph.text.toLowerCase(), ''], [ph.text.toUpperCase(), ''], [`  ${ph.text}  `, ''],
    [ph.layout, ''], [ph.text + ' 2024', '2024'], [ph.text + '!', '!'], [ph.text + ' мой', 'мой'],
  ];
  for (const [text, rest] of variants) {
    const r = P.recognize(text);
    if (!r || r.words !== words || r.rest !== rest || !near(r.bits, P.bits(words)) || r.layout !== (text === ph.layout)) {
      recBad.push(`${text} → ${JSON.stringify(r)}`);
    }
  }
}
check('recognize generated phrases (4000 × 8 variants)', recBad.length === 0, recBad.slice(0, 5).join('\n'));
// С буквой ё фраза тоже узнаётся
const yo = P.generate({ words: 6 }, fixed([adjectives.indexOf('зелёный'), subjects.findIndex((s) => s.word === 'ёж'), 0, 46, 0, 0]));
check('phrase with ё typed back', adjectives.includes('зелёный') && P.recognize(yo.text.replace('Зеленый', 'Зелёный').replace(' еж ', ' ёж ')) !== null, yo.text);

const NEG = ['', 'пароль', 'Password1!', 'Я люблю тебя', 'синий кот', 'Синий кот нашел 5',
  'фиолетовый ёж продал чайник', 'qwerty123', 'Синий кот нашел 0 книг', 'Синий кот нашел 101 книгу',
  'Синий кот нашел пять книг', 'Синий кот 5 нашел книг', 'Кот синий нашел 5 книг', 'Синий кот нашел 5 абвгд'];
NEG.forEach((t) => check(`not a phrase: «${t}»`, P.recognize(t) === null, JSON.stringify(P.recognize(t))));
check('known 5-word example', (() => { const r = P.recognize('Синий кот нашел 5 книг'); return r && r.words === 5; })(),
  JSON.stringify(P.recognize('Синий кот нашел 5 книг')));

/* ---------- 9. Мастер-фраза в режиме «Из ключевого слова» ---------- */
const inputs = (master, keyword = 'кот') => ({ site: 'vk.com', keyword, master, version: '1' });
const ph6 = P.generate({ words: 6 });
const ph5 = P.generate({ words: 5 });
let est = K.estimate(inputs(ph6.text), DEFAULT);
check('estimate: 6-word phrase bits', near(est.masterBits, P.bits(6)) && est.masterPhrase && est.masterPhrase.words === 6, JSON.stringify(est));
check('estimate: guess = keyword + phrase', near(est.guessBits, K.secretBits('кот') + P.bits(6)));
est = K.estimate(inputs(ph5.text, ''), DEFAULT);
check('estimate: 5-word phrase without keyword', near(est.masterBits, P.bits(5)) && est.keywordBits === 0 && near(est.bits, P.bits(5)));
est = K.estimate(inputs(ph6.text + ' 2024'), DEFAULT);
check('estimate: phrase + digits', near(est.masterBits, P.bits(6) + K.secretBits('2024')), est.masterBits);
est = K.estimate(inputs(ph6.layout), DEFAULT);
check('estimate: phrase in English layout', near(est.masterBits, P.bits(6)) && est.masterPhrase.layout === true);
est = K.estimate(inputs('фиолетовый ёж продал чайник'), DEFAULT);
check('estimate: ordinary words unchanged', est.masterPhrase === null && near(est.masterBits, K.secretBits('фиолетовый ёж продал чайник')));
check('phrase lowers naive estimate', K.secretBits(ph6.text) > P.bits(6), K.secretBits(ph6.text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
