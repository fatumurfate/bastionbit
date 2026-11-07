// Тесты этапов 4–5: правило, личные данные, утечки, похожие пароли,
// словарь имён и результаты исследования.
// Запуск: node tests/stage45-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const nodeCrypto = require('crypto');

const base = path.join(__dirname, '..');
const FILES = ['js/random.js', 'js/entropy.js', 'js/generator.js', 'data/words-ru.js', 'js/phrase.js',
  'data/top-passwords.js', 'data/dict-ru.js', 'data/dict-en.js', 'data/dict-names.js',
  'js/patterns.js', 'js/rule.js', 'js/personal.js', 'js/similar.js', 'js/breach.js'];
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx, { filename: f });
const [E, G, D, R, PD, S, B] = ['BBEntropy', 'BBGenerator', 'BBPatterns', 'BBRule', 'BBPersonal', 'BBSimilar', 'BBBreach']
  .map((n) => vm.runInContext(n, ctx));

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) passed++;
  else { failed++; console.log('FAIL', name, extra); }
}
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps;
const types = (r) => r.chunks.map((c) => c.type + (c.dictionary ? ':' + c.dictionary : '')).join('+');

(async () => {
  /* ---------- Ментальное правило ---------- */
  check('rule: 3 840 structures', R.STRUCTURES.length === 3840, R.STRUCTURES.length);
  check('rule: core 25,1 bits', near(R.CORE_BITS, 25.1), R.CORE_BITS);
  check('rule: structure 11,9 bits', near(R.STRUCTURE_BITS, 11.9), R.STRUCTURE_BITS);
  check('rule: total 37,0 bits', near(R.TOTAL_BITS, 37.0), R.TOTAL_BITS);
  for (let k = 0; k < 30; k++) {
    const rule = R.random();
    const a = R.password(rule, 'vk.com');
    check('rule: same password twice', a === R.password(rule, 'vk.com'));
    const leak = R.leaks(rule, ['vk.com', 'yandex.ru', 'mail.ru', 'ozon.ru']);
    check('rule: leaks never lose the true rule', leak.steps.length > 0 && leak.remaining >= 1, JSON.stringify(leak.remaining));
  }

  /* ---------- Личные данные ---------- */
  const me = PD.prepare({ name: 'Илья', birth: '2008-05-15', pet: 'Барсик', city: 'Красноярск' });
  check('personal: K = 4', me.size === 4, me.size);
  check('personal: 12 date forms', me.items.find((i) => i.kind === 'date').forms.length === 12);
  const ilya = D.analyze('Ilya2008!', { personal: me });
  check('personal: Ilya2008! = 20,6 bits', near(ilya.bits, 20.6, 0.06), `${ilya.bits} ${types(ilya)}`);
  check('personal: without data Ilya2008! is stronger', D.analyze('Ilya2008!').bits > ilya.bits + 5);
  const barsik = D.analyze(',fhcbr2008', { personal: me });
  check('personal: ,fhcbr in layout', barsik.chunks.some((c) => c.type === 'personal'), types(barsik));
  check('personal: reversed', D.analyze('кисраб', { personal: me }).chunks.some((c) => c.type === 'personal'));
  D.analyze('reset');   // без личных данных

  /* ---------- Похожие пароли ---------- */
  const sim = S.compare('Barsik2023!', 'Barsik2024!');
  check('similar: distance 1', sim.distance === 1, sim.distance);
  check('similar: 11,1 bits', near(sim.near, Math.log2(23 * 94), 0.01) && near(sim.near, 11.1), sim.near);
  check('similar: limited by detector', S.compare('Barsik2023!', 'Barsik2024!', 5).bits === 5);
  check('similar: levenshtein kitten/sitting', S.distance ? S.distance('kitten', 'sitting') === 3 : S.edit('kitten', 'sitting').distance === 3);

  /* ---------- Проверка утечек (без сети) ---------- */
  const sha = (t) => nodeCrypto.createHash('sha1').update(t, 'utf8').digest('hex').toUpperCase();
  check('breach: sha1 matches Node', (await B.sha1('Ilya2008!')) === sha('Ilya2008!'));
  check('breach: prefix 5', B.PREFIX === 5 && B.API === 'https://api.pwnedpasswords.com/range/');
  const hash = sha('Ilya2008!');
  const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', `${hash.slice(5)}:19`, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0', 'FFFFF6E8FA6EECAD2A3AA415EEC418D38EC:0'].join('\r\n');
  let request = null;
  const res = await B.check('Ilya2008!', { fetch: async (url, init) => { request = { url, init }; return { ok: true, text: async () => body }; } });
  check('breach: only prefix sent', request.url === B.API + hash.slice(0, 5) && !request.url.includes(hash.slice(5)), request.url);
  check('breach: padding header, no cookies, no referrer', request.init.headers['Add-Padding'] === 'true' &&
    request.init.credentials === 'omit' && request.init.referrerPolicy === 'no-referrer');
  check('breach: count 19, padding skipped', res.count === 19 && res.entries === 2 && res.padding === 2, JSON.stringify(res));
  const clean = await B.check('k#9Lw!2zQpX7mN4v', { fetch: async () => ({ ok: true, text: async () => body }) });
  check('breach: clean password → 0', clean.count === 0);

  /* ---------- Словари этапа 5 ---------- */
  const words = (file, name) => fs.readFileSync(path.join(base, 'data', file), 'utf8').split('`')[1].split(' ');
  const ru = words('dict-ru.js');
  const names = words('dict-names.js');
  const en = words('dict-en.js');
  check('dict: ru > 45 000 unique', ru.length > 45000 && new Set(ru).size === ru.length, ru.length);
  check('dict: en > 45 000 unique', en.length > 45000 && new Set(en).size === en.length, en.length);
  check('dict: names > 50 000 unique', names.length > 50000 && new Set(names).size === names.length, names.length);
  const ruSet = new Set(ru);
  check('dict: names do not repeat ru', names.every((w) => !ruSet.has(w)));
  check('dict: only lowercase Cyrillic', [...ru, ...names].every((w) => /^[а-я]{3,}$/.test(w)));
  const N = names.length;
  const cases = [
    ['yfcnz123', 'настя'], ['Rjycnfynby', 'константин'], ['natasha1985', 'наташа'], ['vfhufhbnf777', 'маргарита'],
    ['ufkbyf', 'галина'], ['gjyjvfhtdf', 'пономарева'], ['rhfcyjzhcr', 'красноярск'], ['dfkthmtdbx', 'валерьевич'],
  ];
  for (const [pw, word] of cases) {
    const r = D.analyze(pw);
    // Многие имена уже есть в списке популярных паролей (vfhufhbnf) — это тоже верная находка
    const hit = r.chunks.find((c) => c.type === 'dictionary' && (c.word === word || c.dictionary === 'passwords'));
    check(`names: ${pw} → ${word}`, hit && r.bits < r.naiveBits - 8, `${r.bits.toFixed(1)} ${types(r)}`);
    if (hit && hit.dictionary === 'names') check(`names: ${word} costs log2 N + 1`, near(hit.bits, Math.log2(N) + 1 + hit.caseBits, 0.01), hit.bits);
  }
  for (const pw of ['gjyjvfhtdf', 'krasnoyarsk', 'yfcnz123']) {
    check(`names: ${pw} found in names`, D.analyze(pw).chunks.some((c) => c.dictionary === 'names'), types(D.analyze(pw)));
  }
  const shown = D.describe ? D.describe(D.analyze('gjyjvfhtdf').chunks[0], { reveal: true }) : null;
  check('names: description', !shown || JSON.stringify(shown).includes('русских имён'), JSON.stringify(shown));
  // Старые примеры не изменились
  for (const [pw, bits] of [['Password1!', 15.8], ['gfhjkm', 6.8], ['привет123', 12.6], ['Ghbdtn2024!', 25.4], ['correcthorsebatterystaple', 55.1]]) {
    check(`old example ${pw}`, near(D.analyze(pw).bits, bits, 0.06), D.analyze(pw).bits);
  }
  // Случайные пароли детектор почти не трогает
  for (const length of [12, 16]) {
    let found = 0;
    const M = 4000;
    for (let k = 0; k < M; k++) if (D.analyze(G.generate({ length, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: true })).found) found++;
    check(`random ${length}: false positives < 2,5 %`, found / M < 0.025, `${found}/${M}`);
  }

  /* ---------- Результаты исследования ---------- */
  const resultsFile = path.join(base, 'tools', 'results', 'evaluation.json');
  if (fs.existsSync(resultsFile)) {
    const res = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    check('evaluation: million', res.groups.all.n === 1000000, res.groups.all.n);
    check('evaluation: 6 decades', res.decades.length === 6 && res.decades[5].to === 1000000);
    const g = res.groups.all.estimators;
    check('evaluation: BastionBit below formula', g.bastionbit.median < g.formula.median);
    check('evaluation: random 16 exact', near(res.control.random16.estimators.bastionbit.median, res.control.random16.exact, 0.5));
    check('evaluation: phrase exact', near(res.control.phrase6.estimators.bastionbit.median, res.control.phrase6.exact, 0.01));
  } else check('evaluation file exists', false);

  console.log(`\nstage45: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
