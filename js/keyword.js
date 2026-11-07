'use strict';

/* BastionBit — пароль из ключевого слова (этап 1.2).

   Пароль нигде не хранится: он каждый раз заново вычисляется из того, что
   помнит человек. Одинаковый ввод даёт одинаковый пароль на любом устройстве.

   1. Ввод приводится к одному виду (normalizeInputs).
   2. PBKDF2-HMAC-SHA-256, 600 000 повторов:
        пароль = мастер-фраза ‖ 0x00 ‖ ключевое слово
        соль   = «BastionBit v1» ‖ 0x00 ‖ сайт ‖ 0x00 ‖ версия
      Получается ключ из 32 байтов. Повторы делают каждую попытку
      взломщика дорогой.
   3. HKDF-SHA-256 растягивает ключ в поток байтов. В его параметр info
      записаны требования сайта, поэтому разные требования дают независимые
      пароли.
   4. Из потока байтов символы выбираются тем же методом отбора, что и в
      случайном генераторе (BBGenerator.generate).

   Всё считает Web Crypto API браузера (crypto.subtle). */

const BBKeyword = (() => {
  const TAG = 'BastionBit v1';
  const ITERATIONS = BBEntropy.KDF.iterations;
  const KEY_BYTES = 32;
  const HKDF_MAX_BYTES = 255 * 32;     // больше HKDF-SHA-256 за один вызов не выдаёт
  const MAX_BLOCKS = 4;
  const MAX_VERSION = 999;
  const WORD_BITS = Math.log2(50000);  // ≈ 15,6 бита: слово из словаря на 50 000 слов
  const SET_KEYS = ['lower', 'upper', 'digits', 'symbols'];

  const encoder = new TextEncoder();
  const utf8 = (text) => encoder.encode(text);
  const SEPARATOR = Uint8Array.of(0);  // байт 0x00 нельзя ввести с клавиатуры

  /* ---------- 1. Ввод в одном виде ---------- */

  // Маленькие буквы, ё → е, одиночные пробелы, без невидимых символов.
  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\p{Cf}/gu, '')            // невидимые символы нулевой ширины
      .replace(/[\s\p{Cc}]+/gu, ' ')      // пробелы, табуляции, переводы строк
      .trim();
  }

  // От адреса остаётся только домен: «https://www.VK.com/feed» → «vk.com».
  function normalizeSite(value) {
    return normalizeText(value)
      .replace(/ /g, '')
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')  // https://
      .replace(/^[^/?#]*@/, '')                // логин@
      .replace(/[/?#].*$/, '')                 // путь и параметры
      .replace(/:\d*$/, '')                    // порт
      .replace(/^www\d*\./, '')                // www.
      .replace(/\.+$/, '');                    // точка в конце
  }

  function normalizeVersion(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, MAX_VERSION);
  }

  function normalizeInputs({ site, keyword, master, version }) {
    return {
      site: normalizeSite(site),
      keyword: normalizeText(keyword),
      master: normalizeText(master),
      version: normalizeVersion(version),
    };
  }

  // Чего не хватает для расчёта: null — всё в порядке.
  function problem(normalized) {
    if (!normalized.site) return 'site';
    if (!normalized.keyword && !normalized.master) return 'secret';
    return null;
  }

  // Требования сайта одной строкой — участвуют в расчёте через HKDF.
  function settingsKey(options) {
    const sets = SET_KEYS.filter((key) => options[key]).join(',');
    return `length=${options.length};sets=${sets};avoid-similar=${options.avoidSimilar ? 1 : 0}`;
  }

  /* ---------- 2–3. PBKDF2 и HKDF ---------- */

  function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async function pbkdf2(password, salt, iterations, bytes) {
    const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8);
    return new Uint8Array(bits);
  }

  async function hkdf(ikm, salt, info, bytes) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8);
    return new Uint8Array(bits);
  }

  /* ---------- 4. Пароль ---------- */

  // iterations можно уменьшить только в тестах — на сайте всегда 600 000.
  async function derive(inputs, options, iterations = ITERATIONS) {
    const n = normalizeInputs(inputs);
    const issue = problem(n);
    if (issue) throw new Error(`BBKeyword: не заполнено (${issue})`);

    const password = concatBytes(utf8(n.master), SEPARATOR, utf8(n.keyword));
    const salt = concatBytes(utf8(TAG), SEPARATOR, utf8(n.site), SEPARATOR, utf8(String(n.version)));

    const started = performance.now();
    const key = await pbkdf2(password, salt, iterations, KEY_BYTES);
    const ms = performance.now() - started;

    // Байтов почти всегда хватает с первого раза; если нет — берём ещё блок.
    let stream = new Uint8Array(0);
    for (let block = 1; block <= MAX_BLOCKS; block++) {
      const info = utf8(`${TAG}\u0000password\u0000${settingsKey(options)}\u0000${block}`);
      stream = concatBytes(stream, await hkdf(key, utf8(TAG), info, HKDF_MAX_BYTES));
      try {
        return { password: BBGenerator.generate(options, BBRandom.fromBytes(stream)), normalized: n, ms };
      } catch (error) {
        if (!(error instanceof BBRandom.BytesExhausted)) throw error;
      }
    }
    throw new Error('BBKeyword: не хватило байтов');
  }

  /* ---------- Стойкость ---------- */

  // Сколько бит придётся угадать. Слово (буквы подряд) — не больше
  // log₂ 50 000 ≈ 15,6 бита, как слово из словаря; цифры и символы — по
  // формуле L · log₂ N.
  function secretBits(text) {
    const parts = normalizeText(text).match(/\p{L}+|[^\p{L}\s]+/gu) || [];
    return parts.reduce((sum, part) => {
      const { bits } = BBEntropy.analyze(part);
      return sum + (/^\p{L}+$/u.test(part) ? Math.min(bits, WORD_BITS) : bits);
    }, 0);
  }

  // Взломщик знает, как работает BastionBit, и название сайта, поэтому
  // стойкость не больше, чем у ключевого слова с мастер-фразой:
  // H = min(H пароля, H слова + H фразы).
  // Фразу из генератора BastionBit (js/phrase.js) взломщик может перебрать
  // по словарям, поэтому для неё берётся точная стойкость фразы.
  function masterEstimate(text) {
    const naive = secretBits(text);
    const phrase = typeof BBPhrase === 'undefined' ? null : BBPhrase.recognize(text);
    const bits = phrase ? phrase.bits + secretBits(phrase.rest) : Infinity;
    return bits < naive ? { bits, phrase } : { bits: naive, phrase: null };
  }

  function estimate(inputs, options) {
    const n = normalizeInputs(inputs);
    const keywordBits = secretBits(n.keyword);
    const master = masterEstimate(n.master);
    const masterBits = master.bits;
    const guessBits = keywordBits + masterBits;
    const passwordBits = BBGenerator.exactEntropy(options).bits;
    return {
      keywordBits,
      masterBits,
      masterPhrase: master.phrase,
      guessBits,
      passwordBits,
      bits: Math.min(guessBits, passwordBits),
      slowdownBits: Math.log2(ITERATIONS),
    };
  }

  // Время подбора в сценарии. Взломщик выберет, что быстрее: перебирать
  // ключевое слово и мастер-фразу (каждая попытка проходит через PBKDF2)
  // или сам готовый пароль.
  function crackTime(est, scenario) {
    const kdfSpeed = Math.min(scenario.speed, BBEntropy.KDF.speed);
    const viaWords = BBEntropy.crackTimeLog10(est.guessBits, kdfSpeed);
    const viaPassword = BBEntropy.crackTimeLog10(est.passwordBits, scenario.speed);
    if (viaWords <= viaPassword) {
      return { lg: viaWords, speed: kdfSpeed, slowed: scenario.speed > kdfSpeed, target: 'words' };
    }
    return { lg: viaPassword, speed: scenario.speed, slowed: false, target: 'password' };
  }

  return {
    TAG, ITERATIONS, WORD_BITS, MAX_VERSION,
    normalizeText, normalizeSite, normalizeVersion, normalizeInputs, problem, settingsKey,
    pbkdf2, hkdf, derive, secretBits, estimate, crackTime,
  };
})();
