// Исследование этапа 5: насколько точно оценивают настоящие пароли
// формула L · log₂ N, детектор хитростей BastionBit и zxcvbn.
//
// Данные — 1 000 000 самых популярных паролей из коллекции Xato (SecLists),
// по убыванию популярности. Взломщик, который перебирает пароли в этом порядке,
// найдёт пароль на месте r за r попыток. Значит, настоящая стойкость такого
// пароля не больше T = log₂ r бит. Хорошая оценка должна быть близка к T.
//
// Контроль — пароли, у которых стойкость известна точно: случайные пароли,
// фразы и ментальные правила BastionBit.
//
// Запуск из папки bastionbit (Node 18+):
//   curl -o tools/sources/xato-net-10-million-passwords-1000000.txt \
//     https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt
//   python tools/select_russian.py      # русские слова в английской раскладке (нужен pymorphy3)
//   node tools/evaluate.js              # итог — tools/results/evaluation.json
//   node tools/evaluate.js --hibp       # ещё и проверка примеров по Pwned Passwords (нужен интернет)
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(__dirname, 'sources', 'xato-net-10-million-passwords-1000000.txt');
const RUSSIAN = path.join(__dirname, 'results', 'russian-layout.tsv');
const OUT = path.join(__dirname, 'results', 'evaluation.json');
const HIBP = path.join(__dirname, 'results', 'hibp.json');

/* ---------- Модули сайта ---------- */
const FILES = ['js/random.js', 'js/entropy.js', 'js/generator.js', 'data/words-ru.js', 'js/phrase.js',
  'data/top-passwords.js', 'data/dict-ru.js', 'data/dict-en.js', 'data/dict-names.js', 'js/patterns.js', 'js/rule.js']
  .filter((f) => fs.existsSync(path.join(ROOT, f)));   // словаря имён до этапа 5 не было
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const [E, G, P, D, R] = ['BBEntropy', 'BBGenerator', 'BBPhrase', 'BBPatterns', 'BBRule'].map((n) => vm.runInContext(n, ctx));
const zxcvbn = require(path.join(ROOT, 'vendor', 'zxcvbn.js'));

const NAMES = ['formula', 'bastionbit', 'zxcvbn'];
const LOG2_10 = Math.log2(10);

// Оценка тремя способами — так же, как на сайте
function estimate(password) {
  const t0 = performance.now();
  const r = D.analyze(password);
  const t1 = performance.now();
  const z = zxcvbn([...password].slice(0, D.MAX_LENGTH).join(''));
  const t2 = performance.now();
  const bbKnows = r.chunks.length === 1 && r.chunks[0].type === 'dictionary' && r.chunks[0].dictionary === 'passwords';
  const zxKnows = z.sequence.length === 1 && z.sequence[0].pattern === 'dictionary' && z.sequence[0].dictionary_name === 'passwords';
  return { bits: [r.naiveBits, r.bits, z.guesses_log10 * LOG2_10], found: r.found, bbKnows, zxKnows, ms: [t1 - t0, t2 - t1] };
}

/* ---------- Статистика ---------- */
const level = (bits) => E.strength(bits).level;   // 0 — очень слабый … 4 — очень сильный
const LEVEL_NAMES = [0, 1, 2, 3, 4].map((k) => E.LEVELS[k].label);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function ranks(values) {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]] = avg;
    i = j + 1;
  }
  return out;
}

// Ранговая корреляция Спирмена: насколько оценка упорядочивает пароли так же, как реальность
function spearman(x, y) {
  if (x.length < 3) return null;
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  const mean = (n + 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mean;
    const b = ry[i] - mean;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

const round = (x, digits = 2) => (x === null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

class Group {
  constructor(title) {
    this.title = title;
    this.truth = [];
    this.bits = NAMES.map(() => []);
    this.bbKnows = 0;
    this.zxKnows = 0;
    this.found = 0;
  }

  add(truth, e) {
    this.truth.push(truth);
    e.bits.forEach((b, k) => this.bits[k].push(b));
    this.bbKnows += e.bbKnows;
    this.zxKnows += e.zxKnows;
    this.found += e.found;
  }

  summary({ correlation = true } = {}) {
    const n = this.truth.length;
    const truthSorted = Float64Array.from(this.truth).sort();
    const out = {
      title: this.title, n,
      truth: { median: round(quantile(truthSorted, 0.5)), min: round(truthSorted[0]), max: round(truthSorted[n - 1]) },
      knownWhole: { bastionbit: round(this.bbKnows / n, 4), zxcvbn: round(this.zxKnows / n, 4) },
      detectorFound: round(this.found / n, 4),
      estimators: {},
    };
    NAMES.forEach((name, k) => {
      const bits = this.bits[k];
      const sorted = Float64Array.from(bits).sort();
      const errors = Float64Array.from(bits, (b, i) => b - this.truth[i]).sort();
      const levels = [0, 0, 0, 0, 0];
      let over10 = 0, under10 = 0, absSum = 0;
      for (let i = 0; i < n; i++) {
        levels[level(bits[i])]++;
        const d = bits[i] - this.truth[i];
        if (d >= 10) over10++;
        if (d <= -10) under10++;
        absSum += Math.abs(d);
      }
      out.estimators[name] = {
        median: round(quantile(sorted, 0.5)), p25: round(quantile(sorted, 0.25)), p75: round(quantile(sorted, 0.75)),
        p10: round(quantile(sorted, 0.1)), p90: round(quantile(sorted, 0.9)),
        medianError: round(quantile(errors, 0.5)), meanAbsError: round(absSum / n),
        over10: round(over10 / n, 4), under10: round(under10 / n, 4),
        levels: levels.map((c) => round(c / n, 4)),
        spearman: correlation ? round(spearman(bits, this.truth), 3) : null,
      };
    });
    return out;
  }
}

/* ---------- Воспроизводимый случайный источник для контрольных паролей ---------- */
function seeded(seed) {
  let s = seed >>> 0;
  const next = () => {   // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
  const randomInt = (n) => {
    const limit = Math.floor(2 ** 32 / n) * n;
    let x;
    do x = next(); while (x >= limit);
    return x % n;
  };
  return { randomInt, pick: (items) => items[randomInt(items.length)] };
}

/* ---------- 1. Миллион паролей Xato ---------- */
if (!fs.existsSync(SOURCE)) {
  console.error(`Нет файла ${path.relative(ROOT, SOURCE)} — скачайте его командой из шапки скрипта.`);
  process.exit(1);
}
const list = fs.readFileSync(SOURCE, 'utf8').split('\n');
if (list[list.length - 1] === '') list.pop();
const russian = new Set();
if (fs.existsSync(RUSSIAN)) {
  for (const line of fs.readFileSync(RUSSIAN, 'utf8').split('\n').slice(1)) if (line) russian.add(Number(line.split('\t')[0]));
}

const SEGMENTS = [
  { id: 'top10k', title: 'места 1–10 000', from: 1, to: 10000 },
  { id: 'to100k', title: 'места 10 001–100 000', from: 10001, to: 100000 },
  { id: 'to1m', title: 'места 100 001–1 000 000', from: 100001, to: 1000000 },
];
const groups = {
  all: new Group('весь миллион'),
  ...Object.fromEntries(SEGMENTS.map((s) => [s.id, new Group(s.title)])),
  russian: new Group('русские слова в английской раскладке'),
  russianTop10k: new Group('русские слова в раскладке, места 1–10 000'),
  russianRest: new Group('русские слова в раскладке, места 10 001–1 000 000'),
};
const decades = [1, 2, 3, 4, 5, 6].map((d) => ({ from: d === 1 ? 1 : 10 ** (d - 1) + 1, to: 10 ** d, group: new Group(`до ${10 ** d}`) }));
const msDetector = new Float32Array(list.length);
const msZxcvbn = new Float32Array(list.length);
const examples = [];

D.analyze('разогрев');
const started = Date.now();
for (let i = 0; i < list.length; i++) {
  const rank = i + 1;
  const password = list[i];
  const truth = Math.log2(rank);
  const e = estimate(password);
  msDetector[i] = e.ms[0];
  msZxcvbn[i] = e.ms[1];
  groups.all.add(truth, e);
  groups[SEGMENTS.find((s) => rank <= s.to).id].add(truth, e);
  decades[Math.max(0, Math.ceil(Math.log10(rank)) - 1)].group.add(truth, e);
  if (russian.has(rank)) {
    groups.russian.add(truth, e);
    groups[rank <= 10000 ? 'russianTop10k' : 'russianRest'].add(truth, e);
  }
  if ([1, 112, 242, 1999, 10001, 50000, 123456, 500000, 999999].includes(rank)) {
    examples.push({ rank, password, truth: round(truth), bits: e.bits.map((b) => round(b, 1)) });
  }
  if (rank % 100000 === 0) console.error(`… ${rank / 1000} тыс. паролей, ${((Date.now() - started) / 1000).toFixed(0)} с`);
}

/* ---------- 2. Контроль: пароли с точно известной стойкостью ---------- */
const rng = seeded(2026);
const N = 2000;
const SITES = ['vk.com', 'yandex.ru', 'mail.ru', 'gosuslugi.ru', 'ozon.ru', 'wildberries.ru', 'steam.com', 'github.com', 'google.com', 'telegram.org'];
const randomOptions = (length) => ({ length, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false });
const CONTROL = [
  { id: 'random8', title: 'случайный, 8 символов', truth: G.exactEntropy(randomOptions(8)).bits, make: () => G.generate(randomOptions(8), rng) },
  { id: 'random12', title: 'случайный, 12 символов', truth: G.exactEntropy(randomOptions(12)).bits, make: () => G.generate(randomOptions(12), rng) },
  { id: 'random16', title: 'случайный, 16 символов', truth: G.exactEntropy(randomOptions(16)).bits, make: () => G.generate(randomOptions(16), rng) },
  { id: 'phrase6', title: 'фраза из 6 слов', truth: P.bits(6), make: () => P.generate({ words: 6 }, rng).text },
  { id: 'phrase6layout', title: 'фраза из 6 слов в английской раскладке', truth: P.bits(6), make: () => P.generate({ words: 6 }, rng).layout },
  { id: 'rule', title: 'ментальное правило (до утечек)', truth: R.TOTAL_BITS, make: () => R.password(R.random(rng), rng.pick(SITES)) },
];
const control = {};
for (const c of CONTROL) {
  const group = new Group(c.title);
  const samples = [];
  for (let k = 0; k < N; k++) {
    const password = c.make();
    group.add(c.truth, estimate(password));
    if (k < 3) samples.push(password);
  }
  control[c.id] = { ...group.summary({ correlation: false }), exact: round(c.truth), samples };
}

/* ---------- 3. Ложные срабатывания детектора на случайных паролях ---------- */
const falsePositives = {};
for (const length of [8, 12, 16, 20]) {
  const M = 20000;
  let found = 0;
  const losses = [];
  for (let k = 0; k < M; k++) {
    const r = D.analyze(G.generate(randomOptions(length), rng));
    if (r.found) { found++; losses.push(r.naiveBits - r.bits); }
  }
  losses.sort((a, b) => a - b);
  falsePositives[length] = { n: M, share: round(found / M, 4), medianLoss: round(quantile(losses, 0.5)), maxLoss: round(losses[losses.length - 1]) };
}

/* ---------- 4. Скорость ---------- */
const speed = (arr) => {
  const sorted = Float32Array.from(arr).sort();
  return { median: round(quantile(sorted, 0.5), 3), p99: round(quantile(sorted, 0.99), 3), max: round(sorted[sorted.length - 1], 1) };
};

/* ---------- 5. Проверка примеров по Pwned Passwords (по флагу --hibp) ---------- */
const CASES = ['123456', 'qwerty123', 'gfhjkm', 'ghbdtn', 'vfrcbv', 'nfnmzyf1985', 'privet123', 'Ilya2008!', 'Barsik2024!',
  'Rhfcyjzhcr24', 'Abjktnjdfzkbcf47!WL2', 'correcthorsebatterystaple', 'k#9Lw!2zQpX7mN4v',
  'Сливочная уборщица перерисовала 76 позолоченных передников'];

async function checkHibp() {
  const cases = [];
  for (const password of CASES) {
    const hash = nodeCrypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
      { headers: { 'Add-Padding': 'true', 'User-Agent': 'BastionBit-school-research' } });
    if (!response.ok) throw new Error(`Pwned Passwords: HTTP ${response.status}`);
    const lines = (await response.text()).trim().split(/\r?\n/).map((l) => l.split(':'));
    const real = lines.filter(([, count]) => Number(count) > 0);
    const hit = real.find(([suffix]) => suffix === hash.slice(5));
    cases.push({ password, prefix: hash.slice(0, 5), bucket: real.length, count: hit ? Number(hit[1]) : 0 });
  }
  return { checked: new Date().toISOString().slice(0, 10), cases };
}

(async () => {
  let hibp = fs.existsSync(HIBP) ? JSON.parse(fs.readFileSync(HIBP, 'utf8')) : null;
  if (process.argv.includes('--hibp')) {
    hibp = await checkHibp();
    fs.writeFileSync(HIBP, JSON.stringify(hibp, null, 2) + '\n');
  }
  if (hibp) {
    for (const c of hibp.cases) c.bits = estimate(c.password).bits.map((b) => round(b, 1));
  }

  const result = {
    about: 'BastionBit, этап 5: сравнение оценок стойкости на настоящих паролях',
    source: 'SecLists, Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
    truth: 'T = log2(место в списке) — столько бит нужно взломщику, который перебирает пароли по популярности',
    estimators: { formula: 'L · log2 N', bastionbit: 'детектор хитростей BastionBit', zxcvbn: 'zxcvbn 4.4.2, log2(guesses)' },
    levels: LEVEL_NAMES,
    groups: Object.fromEntries(Object.entries(groups).map(([id, g]) => [id, g.summary()])),
    decades: decades.map((d) => ({ from: d.from, to: d.to, ...d.group.summary({ correlation: false }) })),
    examples,
    control,
    falsePositives,
    speedMs: { bastionbit: speed(msDetector), zxcvbn: speed(msZxcvbn) },
    hibp,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');

  // Короткий отчёт в консоль
  const pct = (x) => `${(100 * x).toFixed(1)} %`;
  const row = (title, s) => console.log(`${title.padEnd(52)} T≈${String(s.truth.median).padStart(5)} | ` +
    NAMES.map((n) => `${n} ${String(s.estimators[n].median).padStart(6)} (оч.слабый ${pct(s.estimators[n].levels[0]).padStart(7)}, ≥средний ${pct(s.estimators[n].levels.slice(2).reduce((a, b) => a + b, 0)).padStart(7)}, ρ ${s.estimators[n].spearman})`).join(' | '));
  for (const s of Object.values(result.groups)) row(`${s.title} (${s.n})`, s);
  for (const s of Object.values(control)) {
    console.log(`${s.title.padEnd(52)} точно ${s.exact} | ` + NAMES.map((n) => `${n} ${s.estimators[n].median}`).join(' | '));
  }
  console.log('Ложные срабатывания:', JSON.stringify(falsePositives));
  console.log('Скорость, мс:', JSON.stringify(result.speedMs));
  if (hibp) for (const c of hibp.cases) console.log(`HIBP ${c.password.padEnd(60)} ${String(c.count).padStart(10)}  ${c.bits.join(' / ')}`);
  console.log(`Готово за ${result.seconds} с → ${path.relative(ROOT, OUT)}`);
})().catch((error) => { console.error(error); process.exit(1); });
