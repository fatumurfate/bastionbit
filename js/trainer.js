'use strict';

/* BastionBit — тренажёр запоминания (этап 3).

   Пароль учат интервальными повторениями. Сразу после добавления его
   вводят по памяти 3 раза подряд, потом повторяют через 1, 3, 7, 14
   и 30 дней: каждый следующий перерыв в 2–3 раза длиннее, и память
   успевает закрепиться. Верно с первой попытки — шаг вперёд, ошибка —
   шаг назад (как в системе Лейтнера). После пяти повторений пароль
   выучен.

   Сам пароль нигде не хранится. В localStorage браузера лежат только
   название, случайная соль и хеш
       h = PBKDF2-SHA-256(пароль, соль, 600 000 повторов).
   Чтобы проверить ответ, тренажёр считает такой же хеш от введённого
   и сравнивает его с сохранённым. По хешу пароль не восстановить —
   только перебирать, а 600 000 повторов делают каждую попытку дорогой. */

const BBTrainer = (() => {
  const INTERVALS = [1, 3, 7, 14, 30];   // через сколько дней повторить
  const LEARN_STREAK = 3;                // при добавлении — 3 раза подряд без ошибок
  const ITERATIONS = 600000;             // как у пароля из ключевого слова
  const SALT_BYTES = 16;
  const HASH_BYTES = 32;
  const MAX_CARDS = 20;
  const MAX_NAME = 40;
  const STORAGE_KEY = 'bastionbit-trainer';
  const VERSION = 1;

  /* ---------- Даты: календарные дни по местному времени ---------- */

  const pad = (n) => String(n).padStart(2, '0');

  // «2026-11-05». Повторить «через 1 день» — значит завтра в любое время.
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(key, days) {
    const date = parseKey(key);
    date.setDate(date.getDate() + days);
    return dateKey(date);
  }

  // Дней от a до b. Округление убирает час перехода на летнее время.
  function daysBetween(a, b) {
    return Math.round((parseKey(b) - parseKey(a)) / 86400000);
  }

  const isKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dateKey(parseKey(value)) === value;

  // Даты всех повторений, если заучить пароль сегодня.
  function plan(today = dateKey()) {
    let day = today;
    return INTERVALS.map((interval) => (day = addDays(day, interval)));
  }

  /* ---------- Хеш ---------- */

  const encoder = new TextEncoder();
  // Буква, набранная одним символом или буквой со знаком (й = и + ˘), даёт одни и те же байты.
  const bytesOf = (password) => encoder.encode(String(password).normalize('NFC'));

  async function hash(password, salt, iterations = ITERATIONS) {
    const key = await crypto.subtle.importKey('raw', bytesOf(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
    return new Uint8Array(bits);
  }

  function toBase64(bytes) {
    let text = '';
    bytes.forEach((b) => { text += String.fromCharCode(b); });
    return btoa(text);
  }

  function fromBase64(text) {
    return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
  }

  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Сравнение без раннего выхода: время не зависит от того, где первое отличие.
  function equal(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  // Пока страница открыта, введённое можно сравнить с паролем напрямую.
  const same = (a, b) => String(a).normalize('NFC') === String(b).normalize('NFC');

  /* ---------- Карточки ---------- */

  const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

  // Новая карточка. Пароль превращается в хеш и дальше не нужен.
  // iterations можно уменьшить только в тестах.
  async function createCard(name, password, today = dateKey(), iterations = ITERATIONS) {
    if (!String(password ?? '')) throw new Error('BBTrainer: пустой пароль');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const digest = await hash(password, salt, iterations);
    return {
      id: toHex(crypto.getRandomValues(new Uint8Array(8))),
      name: cleanName(name) || 'Пароль',
      salt: toBase64(salt),
      hash: toBase64(digest),
      iterations,
      created: today,
      step: 0,         // сколько повторений по расписанию уже пройдено (0–5)
      due: today,      // когда повторить; null — выучен
      last: null,      // последнее повторение; null — ещё не заучен при добавлении
      reviews: 0,
      lapses: 0,       // ошибок с первой попытки
    };
  }

  async function verify(card, attempt) {
    if (!String(attempt ?? '')) return false;
    const digest = await hash(attempt, fromBase64(card.salt), card.iterations);
    return equal(digest, fromBase64(card.hash));
  }

  // learning — ещё не введён 3 раза подряд при добавлении;
  // due — пора повторить; waiting — ждём; learned — выучен.
  function status(card, today = dateKey()) {
    if (card.step >= INTERVALS.length) return { state: 'learned' };
    if (!card.last) return { state: 'learning' };
    const days = daysBetween(today, card.due);
    const interval = INTERVALS[card.step];
    return days <= 0 ? { state: 'due', overdue: Math.max(0, -days), interval } : { state: 'waiting', days, interval };
  }

  // Заучивание при добавлении закончено: первое повторение — завтра.
  function finishLearning(card, today = dateKey()) {
    return { ...card, due: addDays(today, INTERVALS[0]), last: today };
  }

  // Повторение по расписанию; ok — верно ли с первой попытки.
  function review(card, ok, today = dateKey()) {
    const step = ok ? card.step + 1 : Math.max(0, card.step - 1);
    const learned = step >= INTERVALS.length;
    return {
      ...card,
      step,
      due: learned ? null : addDays(today, INTERVALS[step]),
      last: today,
      reviews: card.reviews + 1,
      lapses: card.lapses + (ok ? 0 : 1),
    };
  }

  /* ---------- Хранение ---------- */

  const FIELDS = ['id', 'name', 'salt', 'hash', 'iterations', 'created', 'step', 'due', 'last', 'reviews', 'lapses'];
  const count = (n) => Number.isInteger(n) && n >= 0;

  function base64Bytes(text, length) {
    try {
      return typeof text === 'string' && fromBase64(text).length === length;
    } catch {
      return false;
    }
  }

  function valid(card) {
    if (!card || typeof card !== 'object') return false;
    const learned = card.step >= INTERVALS.length;
    return typeof card.id === 'string' && /^[0-9a-f]{16}$/.test(card.id)
      && typeof card.name === 'string' && cleanName(card.name) === card.name && card.name !== ''
      && base64Bytes(card.salt, SALT_BYTES) && base64Bytes(card.hash, HASH_BYTES)
      && Number.isInteger(card.iterations) && card.iterations >= 1000 && card.iterations <= 1e7
      && isKey(card.created) && count(card.step) && card.step <= INTERVALS.length
      && (learned ? card.due === null : isKey(card.due))
      && (card.last === null || isKey(card.last))
      && count(card.reviews) && count(card.lapses);
  }

  function defaultStorage() {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;   // хранилище запрещено настройками браузера
    }
  }

  // { cards, available — можно ли сохранять, broken — часть данных испорчена }
  function load(storage = defaultStorage()) {
    if (!storage) return { cards: [], available: false, broken: false };
    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch {
      return { cards: [], available: false, broken: false };
    }
    if (raw === null) return { cards: [], available: true, broken: false };
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data && data.cards) ? data.cards : [];
      const ids = new Set();
      const cards = list.filter((card) => valid(card) && !ids.has(card.id) && ids.add(card.id))
        .slice(0, MAX_CARDS)
        .map((card) => Object.fromEntries(FIELDS.map((key) => [key, card[key]])));
      return { cards, available: true, broken: cards.length !== list.length || !Array.isArray(data.cards) };
    } catch {
      return { cards: [], available: true, broken: true };
    }
  }

  function save(cards, storage = defaultStorage()) {
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, cards }));
      return true;
    } catch {
      return false;   // нет места или хранилище запрещено
    }
  }

  return {
    INTERVALS, LEARN_STREAK, ITERATIONS, MAX_CARDS, MAX_NAME, STORAGE_KEY, VERSION,
    dateKey, addDays, daysBetween, plan,
    hash, toBase64, fromBase64, same, cleanName,
    createCard, verify, status, finishLearning, review, valid, load, save,
  };
})();
