// Тесты этапа 3: игра «Взломай сам» (game.js). Запуск: node tests/game-test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..');
const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, performance, console });
for (const f of ['js/random.js', 'js/entropy.js', 'js/generator.js', 'js/game.js', 'data/top-passwords.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), ctx, { filename: f });
}
const [G, Gen, TOP] = ['BBGame', 'BBGenerator', 'BB_TOP_PASSWORDS'].map((n) => vm.runInContext(n, ctx));

let failed = 0;
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) passed++;
  else { failed++; if (failed < 40) console.log('FAIL', name, extra); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Детерминированный генератор для повторяемых тестов
function seeded(seed) {
  let x = seed >>> 0 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  const randomInt = (n) => next() % n;
  return { randomInt, pick: (a) => a[randomInt(a.length)] };
}
// Генератор, который выдаёт заданные числа по кругу
const fixed = (values) => {
  let i = 0;
  const randomInt = (n) => values[i++ % values.length] % n;
  return { randomInt, pick: (a) => a[randomInt(a.length)] };
};

/* ---------- Уровни ---------- */
check('4 levels', same(Array.from(G.LEVELS, (l) => l.id), ['popular', 'pin', 'personal', 'random']));
check('attempts', same(Array.from(G.LEVELS, (l) => l.attempts), [10, 14, 10, 10]));

/* ---------- 1. Популярный пароль ---------- */
const top = TOP.trim().split(/\s+/);
check('XATO_TOP = first 21 of data/top-passwords.js', same(Array.from(G.XATO_TOP), top.slice(0, 21)), JSON.stringify(top.slice(0, 21)));
check('POPULAR: 20 without 696969', G.POPULAR.length === 20 && !G.POPULAR.includes('696969') && new Set(G.POPULAR).size === 20);
G.POPULAR.forEach((secret, i) => {
  const s = G.start('popular', fixed([i]));
  check(`popular ${secret}: secret`, s.secret === secret && s.total === 20 && s.maxAttempts === 10);
  check(`popular ${secret}: machine rank`, s.machine.attempts === top.indexOf(secret) + 1 && s.machine.list[s.machine.attempts - 1] === secret);
  // Неверные догадки и подсказки никогда не исключают сам пароль
  const wrong = G.POPULAR.filter((p) => p !== secret);
  let ok = true;
  let lastLeft = 20;
  for (let k = 0; k < 9; k++) {
    const out = G.guess(s, wrong[(k * 7 + i) % wrong.length]);
    if (out.status === 'repeat') continue;
    if (out.status !== 'wrong' || out.left < 1 || out.left > lastLeft) ok = false;
    if (out.hint && !(out.hint.after <= out.hint.before && out.hint.after >= 1)) ok = false;
    lastLeft = out.left;
    if (!s.shown.every((h) => h.test({ text: secret }))) ok = false;
  }
  check(`popular ${secret}: hints keep secret`, ok && s.shown.length === 2);
  const final = G.guess(s, secret.toUpperCase() + ' ');
  check(`popular ${secret}: case-insensitive answer`, s.solved === (final.status === 'correct') && (final.status === 'correct' || s.done));
});
{
  const s = G.start('popular', fixed([0]));
  check('popular: empty invalid', G.guess(s, '   ').status === 'invalid' && s.used === 0);
  check('popular: wrong', G.guess(s, 'qwerty').status === 'wrong' && s.used === 1);
  check('popular: repeat not counted', G.guess(s, ' QWERTY').status === 'repeat' && s.used === 1);
  G.guess(s, 'dragon');
  const third = G.guess(s, 'monkey');
  check('popular: hint after 3', third.hint && third.hint.text === 'в нём только цифры' && third.hint.before === 17);
  check('popular: digits left', third.left === G.POPULAR.filter((p) => /^\d+$/.test(p)).length, String(third.left));
  check('popular: correct', G.guess(s, '123456').status === 'correct' && s.done && s.solved && s.used === 4);
  check('popular: done after win', G.guess(s, 'x').status === 'done');
}

/* ---------- 2. PIN-код ---------- */
let worst = 0;
let pinOk = true;
for (let secret = 0; secret < G.PIN_TOTAL; secret++) {
  const s = G.start('pin', fixed([secret]));
  if (s.secret !== String(secret).padStart(4, '0') || s.total !== 10000 || s.machine.attempts !== secret + 1) pinOk = false;
  let lo = 0;
  let hi = 9999;
  while (!s.done) {
    const mid = Math.floor((lo + hi) / 2);
    const out = G.guess(s, String(mid).padStart(4, '0'));
    if (out.status === 'higher') lo = mid + 1;
    else if (out.status === 'lower') hi = mid - 1;
    else if (out.status !== 'correct') { pinOk = false; break; }
    if (s.lo !== lo || s.hi !== hi || out.left !== (out.status === 'correct' ? 1 : s.hi - s.lo + 1)) pinOk = false;
    if (secret < s.lo || secret > s.hi) pinOk = false;
  }
  if (!s.solved) pinOk = false;
  worst = Math.max(worst, s.used);
}
check('PIN: every secret found by halving', pinOk);
check('PIN: at most 14 attempts', worst <= 14 && worst === 14, String(worst));
{
  const s = G.start('pin', fixed([4242]));
  for (const bad of ['', '123', '12345', 'abcd', '12 3', '١٢٣٤']) {
    check(`PIN invalid «${bad}»`, G.guess(s, bad).status === 'invalid');
  }
  check('PIN: invalid not counted', s.used === 0);
  check('PIN: higher', G.guess(s, '0420').status === 'higher' && s.lo === 421);
  check('PIN: lower', G.guess(s, '9000').status === 'lower' && s.hi === 8999);
  check('PIN: repeat', G.guess(s, '0420').status === 'repeat' && s.used === 2);
  for (let k = 0; k < 12; k++) G.guess(s, String(5000 + k));
  check('PIN: 14 attempts end the level', s.done && !s.solved && s.used === 14);
}

/* ---------- 3. Личные данные ---------- */
let personalOk = true;
const templates = new Map();
for (let seed = 1; seed <= 3000; seed++) {
  const s = G.start('personal', seeded(seed));
  const texts = s.candidates.map((c) => c.text);
  const p = s.profile;
  if (texts.length !== 22 || new Set(texts).size !== 22) personalOk = false;
  if (texts.indexOf(s.secret) !== s.machine.attempts - 1 || s.total !== 22) personalOk = false;
  if (!texts.every((t) => /^[a-z0-9]+$/.test(t))) personalOk = false;
  if (!/^\d{1,2} [а-я]+ (199[5-9]|200\d|201[0-2]) года$/.test(p.birthday) || !p.city.startsWith('в ')) personalOk = false;
  if (typeof p.female !== 'boolean' || !p.pet.name || !p.team) personalOk = false;
  const day = Number(p.birthday.split(' ')[0]);
  if (day < 1 || day > 28) personalOk = false;
  const c = s.candidates[s.machine.attempts - 1];
  templates.set(`${c.token}/${c.suffix}`, (templates.get(`${c.token}/${c.suffix}`) || 0) + 1);
  // 6 неверных догадок — после двух подсказок остаётся ровно один вариант
  const wrong = texts.filter((t) => t !== s.secret);
  let out;
  for (let k = 0; k < 6; k++) out = G.guess(s, wrong[(seed + k * 5) % wrong.length]);
  if (s.used !== 6 || s.shown.length !== 2 || out.left !== 1 || G.variants(s) !== 1) personalOk = false;
  if (G.guess(s, s.secret.toUpperCase()).status !== 'correct' || !s.solved) personalOk = false;
}
check('personal: 3000 games consistent', personalOk);
check('personal: all 8 templates used', templates.size === 8 && Array.from(templates.values()).every((n) => n > 250), JSON.stringify([...templates]));
{
  const s = G.start('personal', seeded(7));
  check('personal: Cyrillic not counted', G.guess(s, 'барсик2001').status === 'invalid' && s.used === 0);
  check('personal: spaces not counted', G.guess(s, 'barsik 2001').status === 'invalid' && s.used === 0);
  check('personal: 10 attempts', s.maxAttempts === 10);
  G.giveUp(s);
  check('personal: give up', s.done && s.gaveUp && !s.solved && G.guess(s, 'x').status === 'done');
}

/* ---------- 4. Случайный пароль ---------- */
const exact = Gen.exactEntropy(G.RANDOM_OPTIONS).bits;
check('random: ≈ 51,3 бита', Math.abs(exact - 51.3) < 0.05, String(exact));
for (let seed = 1; seed <= 200; seed++) {
  const s = G.start('random', seeded(seed));
  const ok = s.secret.length === 8 && /[a-z]/.test(s.secret) && /[A-Z]/.test(s.secret) && /\d/.test(s.secret)
    && /[^a-zA-Z0-9]/.test(s.secret) && s.bits === exact && s.total === 2 ** exact;
  if (!ok) { check(`random ${seed}`, false, s.secret); break; }
}
{
  const s = G.start('random', seeded(99));
  check('random: wrong length not counted', G.guess(s, 'abc').status === 'invalid' && G.guess(s, '123456789').status === 'invalid' && s.used === 0);
  for (let k = 0; k < 10; k++) G.guess(s, `Aa1!aaa${k}`);
  check('random: 10 attempts end the level', s.done && !s.solved && s.used === 10);
  check('random: space barely changes', G.variants(s) === 2 ** exact - 10);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
