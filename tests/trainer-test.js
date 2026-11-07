// Тесты этапа 3: тренажёр запоминания (trainer.js). Запуск: node tests/trainer-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const nodeCrypto = require('crypto');

const base = path.join(__dirname, '..');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, btoa, atob, console });
vm.runInContext(fs.readFileSync(path.join(base, 'js/trainer.js'), 'utf8'), ctx, { filename: 'trainer.js' });
const T = vm.runInContext('BBTrainer', ctx);

let failed = 0;
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) passed++;
  else { failed++; if (failed < 40) console.log('FAIL', name, extra); }
}
const plain = (x) => JSON.parse(JSON.stringify(x));   // объекты из vm → обычные
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

(async () => {
  /* ---------- Константы ---------- */
  check('intervals 1-3-7-14-30', same(plain(T.INTERVALS), [1, 3, 7, 14, 30]));
  check('learn streak 3', T.LEARN_STREAK === 3);
  check('600 000 iterations', T.ITERATIONS === 600000);
  check('max 20 cards, 40 chars', T.MAX_CARDS === 20 && T.MAX_NAME === 40);

  /* ---------- Даты в разных часовых поясах ---------- */
  for (const tz of ['Asia/Krasnoyarsk', 'Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia']) {
    process.env.TZ = tz;
    check(`${tz}: dateKey`, T.dateKey(new Date(2026, 10, 5, 23, 59)) === '2026-11-05');
    check(`${tz}: +1 day`, T.addDays('2026-11-05', 1) === '2026-11-06');
    check(`${tz}: year end`, T.addDays('2026-12-31', 1) === '2027-01-01');
    check(`${tz}: leap day`, T.addDays('2028-02-28', 1) === '2028-02-29' && T.addDays('2027-02-28', 1) === '2027-03-01');
    check(`${tz}: back`, T.addDays('2026-03-01', -1) === '2026-02-28');
    // Переходы на летнее время: в сутках 23 или 25 часов, но это всё равно один день
    let day = '2026-01-01';
    let ok = true;
    for (let i = 0; i < 800; i++) {
      const next = T.addDays(day, 1);
      if (T.daysBetween(day, next) !== 1 || next <= day) ok = false;
      day = next;
    }
    check(`${tz}: 800 days in a row`, ok && day === '2028-03-11', day);
    check(`${tz}: daysBetween long`, T.daysBetween('2026-01-01', '2028-03-11') === 800);
    check(`${tz}: daysBetween negative`, T.daysBetween('2026-11-05', '2026-11-01') === -4);
    check(`${tz}: plan`, same(plain(T.plan('2026-11-05')), ['2026-11-06', '2026-11-09', '2026-11-16', '2026-11-30', '2026-12-30']));
  }
  process.env.TZ = 'Asia/Krasnoyarsk';
  const today = '2026-11-05';
  const gaps = T.plan(today).map((d, i, all) => T.daysBetween(i ? all[i - 1] : today, d));
  check('plan gaps = intervals', same(gaps, [1, 3, 7, 14, 30]));
  check('learned after 55 days', T.daysBetween(today, T.plan(today)[4]) === 55);

  /* ---------- Хеш = PBKDF2-SHA-256 из Node ---------- */
  const salt = new Uint8Array(16).map((_, i) => i * 7 + 1);
  for (const [pw, n] of [['пароль', 1000], ['Correct-Horse-42', 5000], ['синий ёж продал чайник 42', 1000], ['😀 emoji', 2000]]) {
    const ours = Buffer.from(await T.hash(pw, salt, n)).toString('hex');
    const ref = nodeCrypto.pbkdf2Sync(Buffer.from(pw.normalize('NFC'), 'utf8'), Buffer.from(salt), n, 32, 'sha256').toString('hex');
    check(`pbkdf2 ${pw}`, ours === ref, `${ours} / ${ref}`);
  }
  const full = Buffer.from(await T.hash('Correct-Horse-42', salt)).toString('hex');
  check('pbkdf2 600 000 by default',
    full === nodeCrypto.pbkdf2Sync('Correct-Horse-42', Buffer.from(salt), 600000, 32, 'sha256').toString('hex'));
  const composed = '\u0439';             // й одним символом
  const decomposed = '\u0438\u0306';      // и + кратка
  check('NFC: й composed = decomposed', composed !== decomposed
    && Buffer.from(await T.hash(composed, salt, 1000)).equals(Buffer.from(await T.hash(decomposed, salt, 1000))));
  check('same() uses NFC', T.same(composed, decomposed) && !T.same('a', 'A'));
  check('base64 roundtrip', Buffer.from(T.fromBase64(T.toBase64(salt))).equals(Buffer.from(salt)));

  /* ---------- Карточка ---------- */
  const card = plain(await T.createCard('  Моя   почта  ', 'Correct-Horse-42', today, 1000));
  check('card fields', same(Object.keys(card), ['id', 'name', 'salt', 'hash', 'iterations', 'created', 'step', 'due', 'last', 'reviews', 'lapses']));
  check('card id 16 hex', /^[0-9a-f]{16}$/.test(card.id));
  check('card name cleaned', card.name === 'Моя почта');
  check('salt 16 bytes, hash 32 bytes', T.fromBase64(card.salt).length === 16 && T.fromBase64(card.hash).length === 32);
  check('hash matches salt', Buffer.from(T.fromBase64(card.hash)).equals(
    nodeCrypto.pbkdf2Sync('Correct-Horse-42', Buffer.from(T.fromBase64(card.salt)), 1000, 32, 'sha256')));
  check('new card state', card.step === 0 && card.due === today && card.last === null && card.reviews === 0 && card.lapses === 0);
  check('new card valid', T.valid(card));
  check('no plaintext in card', !JSON.stringify(card).includes('Correct') && !JSON.stringify(card).includes('Horse'));
  const twin = plain(await T.createCard('x', 'Correct-Horse-42', today, 1000));
  check('same password, different salt and hash', twin.salt !== card.salt && twin.hash !== card.hash && twin.id !== card.id);
  check('default name', plain(await T.createCard('   ', 'a', today, 1000)).name === 'Пароль');
  check('long name cut to 40', plain(await T.createCard('я'.repeat(60), 'a', today, 1000)).name.length === 40);
  check('default iterations 600 000', (await T.createCard('a', 'b')).iterations === 600000);
  let threw = false;
  try { await T.createCard('a', '', today, 1000); } catch { threw = true; }
  check('empty password rejected', threw);

  /* ---------- Проверка ответа ---------- */
  check('verify correct', await T.verify(card, 'Correct-Horse-42'));
  check('verify wrong', !(await T.verify(card, 'Correct-Horse-43')));
  check('verify case', !(await T.verify(card, 'correct-horse-42')));
  check('verify empty', !(await T.verify(card, '')) && !(await T.verify(card, null)));
  check('verify trailing space', !(await T.verify(card, 'Correct-Horse-42 ')));
  const yo = plain(await T.createCard('ё', 'ёжик й', today, 1000));
  check('verify NFC', await T.verify(yo, 'ёжик й'.normalize('NFD')) && 'ёжик й'.normalize('NFD') !== 'ёжик й'.normalize('NFC'));

  /* ---------- Состояния и расписание ---------- */
  check('learning', T.status(card, today).state === 'learning');
  const learned0 = plain(T.finishLearning(card, today));
  check('finish learning: due tomorrow', learned0.due === '2026-11-06' && learned0.last === today && learned0.step === 0);
  check('waiting 1 day', same(plain(T.status(learned0, today)), { state: 'waiting', days: 1, interval: 1 }));
  check('due tomorrow', same(plain(T.status(learned0, '2026-11-06')), { state: 'due', overdue: 0, interval: 1 }));
  check('overdue', same(plain(T.status(learned0, '2026-11-09')), { state: 'due', overdue: 3, interval: 1 }));

  // Всегда верно: даты совпадают с планом, после пятого повторения — выучен
  let c = learned0;
  const reviewDays = [];
  for (let i = 0; i < 5; i++) {
    const day = c.due;
    reviewDays.push(day);
    c = plain(T.review(c, true, day));
    check(`review ${i + 1}: step`, c.step === i + 1 && c.reviews === i + 1 && c.lapses === 0 && c.last === day);
    check(`review ${i + 1}: valid`, T.valid(c));
  }
  check('review days = plan', same(reviewDays, plain(T.plan(today))), JSON.stringify(reviewDays));
  check('learned', c.due === null && T.status(c, '2027-06-01').state === 'learned');

  // Ошибка — шаг назад, на нулевом шаге — снова завтра
  const s3 = { ...learned0, step: 3, due: today };
  const back = plain(T.review(s3, false, today));
  check('fail: step back', back.step === 2 && back.due === T.addDays(today, 7) && back.lapses === 1 && back.reviews === 1);
  const zero = plain(T.review({ ...learned0, due: today }, false, today));
  check('fail at step 0: tomorrow', zero.step === 0 && zero.due === '2026-11-06' && zero.lapses === 1);
  const s4 = plain(T.review({ ...learned0, step: 4, due: today }, true, today));
  check('step 4 ok: learned', s4.step === 5 && s4.due === null && T.valid(s4));
  check('learned review fail returns to 30 days', (() => {
    const r = plain(T.review(s4, false, today));
    return r.step === 4 && r.due === T.addDays(today, 30) && T.valid(r);
  })());

  /* ---------- Проверка данных из хранилища ---------- */
  const broken = [
    ['no id', { ...card, id: undefined }],
    ['short id', { ...card, id: 'abc' }],
    ['upper id', { ...card, id: card.id.toUpperCase().replace(/[0-9]/g, 'A') }],
    ['empty name', { ...card, name: '' }],
    ['double space name', { ...card, name: 'a  b' }],
    ['long name', { ...card, name: 'x'.repeat(41) }],
    ['salt length', { ...card, salt: T.toBase64(new Uint8Array(15)) }],
    ['hash length', { ...card, hash: T.toBase64(new Uint8Array(31)) }],
    ['bad base64', { ...card, hash: '@@@' }],
    ['few iterations', { ...card, iterations: 999 }],
    ['float iterations', { ...card, iterations: 1000.5 }],
    ['bad created', { ...card, created: '2026-02-30' }],
    ['created format', { ...card, created: '5.11.2026' }],
    ['step 6', { ...card, step: 6, due: null }],
    ['negative step', { ...card, step: -1 }],
    ['due null early', { ...card, due: null }],
    ['due when learned', { ...card, step: 5, due: today }],
    ['bad last', { ...card, last: 'вчера' }],
    ['negative reviews', { ...card, reviews: -1 }],
    ['string lapses', { ...card, lapses: '0' }],
  ];
  broken.forEach(([name, value]) => check(`invalid: ${name}`, !T.valid(plain(value))));
  check('valid learned', T.valid({ ...card, step: 5, due: null, last: today }));
  check('null is invalid', !T.valid(null) && !T.valid('card'));

  /* ---------- load и save ---------- */
  check('no storage', same(plain(T.load(null)), { cards: [], available: false, broken: false }));
  check('storage throws', same(plain(T.load({ getItem: () => { throw new Error('denied'); } })), { cards: [], available: false, broken: false }));
  const store = fakeStorage();
  check('empty storage', same(plain(T.load(store)), { cards: [], available: true, broken: false }));
  check('save ok', T.save([card, learned0.id === card.id ? twin : learned0], store));
  const raw = store.getItem(T.STORAGE_KEY);
  check('saved format', JSON.parse(raw).version === 1 && JSON.parse(raw).cards.length === 2);
  check('saved has no plaintext', !raw.includes('Correct') && !raw.includes('Horse'));
  const loaded = plain(T.load(store));
  check('roundtrip', loaded.available && !loaded.broken && same(loaded.cards, [card, twin]));
  check('broken JSON', same(plain(T.load(fakeStorage({ [T.STORAGE_KEY]: '{oops' }))), { cards: [], available: true, broken: true }));
  check('not an object', plain(T.load(fakeStorage({ [T.STORAGE_KEY]: '"text"' }))).broken === true);
  check('null JSON', plain(T.load(fakeStorage({ [T.STORAGE_KEY]: 'null' }))).broken === true);
  const mixed = plain(T.load(fakeStorage({ [T.STORAGE_KEY]: JSON.stringify({ version: 1, cards: [card, { ...twin, step: 9 }, 42, card] }) })));
  check('mixed: valid kept, duplicates dropped', mixed.broken && same(mixed.cards, [card]));
  const extra = plain(T.load(fakeStorage({ [T.STORAGE_KEY]: JSON.stringify({ version: 1, cards: [{ ...card, password: 'Correct-Horse-42' }] }) })));
  check('extra fields stripped', !extra.broken && same(extra.cards, [card]) && !('password' in extra.cards[0]));
  const many = [];
  for (let i = 0; i < 25; i++) many.push({ ...card, id: i.toString(16).padStart(16, '0') });
  const cut = plain(T.load(fakeStorage({ [T.STORAGE_KEY]: JSON.stringify({ version: 1, cards: many }) })));
  check('only 20 cards', cut.cards.length === 20 && cut.broken);
  check('save quota error', T.save([card], { setItem: () => { throw new Error('QuotaExceededError'); } }) === false);
  check('save without storage', T.save([card], null) === false);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
