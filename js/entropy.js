'use strict';

/* BastionBit — оценка стойкости пароля «по формуле» (этап 0)
   и срок годности пароля (этап 2).

   Энтропия:        H = L · log₂ N   (L — длина пароля, N — размер алфавита)
   Время подбора:   T = 2^H / (2V)   (в среднем, V — попыток в секунду)
   Срок годности:   t = 2 · (H − 1 − log₂ V − log₂ 86 400) лет —
                    через столько лет подбор займёт меньше суток, если
                    скорость перебора удваивается каждые 2 года.

   Большие числа (2^H бывает больше 10^300) считаем через десятичный
   логарифм, чтобы не выйти за пределы чисел JavaScript. */

const BBEntropy = (() => {
  const SYMBOLS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'; // 32 символа ASCII

  // Наборы символов, которые распознаёт анализатор.
  const CLASSES = [
    { id: 'lower',    label: 'строчные латинские',  size: 26, test: (c) => c >= 'a' && c <= 'z' },
    { id: 'upper',    label: 'заглавные латинские', size: 26, test: (c) => c >= 'A' && c <= 'Z' },
    { id: 'digits',   label: 'цифры',               size: 10, test: (c) => c >= '0' && c <= '9' },
    { id: 'symbols',  label: 'символы',             size: SYMBOLS.length, test: (c) => SYMBOLS.includes(c) },
    { id: 'space',    label: 'пробел',              size: 1,  test: (c) => c === ' ' },
    { id: 'cyrLower', label: 'строчные русские',    size: 33, test: (c) => (c >= 'а' && c <= 'я') || c === 'ё' },
    { id: 'cyrUpper', label: 'заглавные русские',   size: 33, test: (c) => (c >= 'А' && c <= 'Я') || c === 'Ё' },
  ];

  // Для остальных символов Юникода (эмодзи, другие алфавиты) размер алфавита
  // неизвестен — используем условную оценку.
  const OTHER = { id: 'other', label: 'другие символы (условно)', size: 100 };

  // Скорость перебора V — ориентиры для одной видеокарты RTX 4090 (тесты hashcat).
  const SCENARIOS = [
    { id: 'online', label: 'Подбор через форму входа на сайте', speed: 10 },
    { id: 'bcrypt', label: 'Утечка базы, пароли защищены bcrypt', speed: 2e5 },
    { id: 'md5',    label: 'Утечка базы, пароли защищены MD5', speed: 1.6e11 },
  ];

  // Пароль из ключевого слова (этап 1.2): одна попытка взломщика — это
  // 600 000 повторов HMAC-SHA-256 (PBKDF2). hashcat на RTX 4090 считает
  // PBKDF2-SHA-256 с 999 повторами ≈ 8,8·10⁶ раз в секунду (режим 10900),
  // значит, с 600 000 повторами ≈ 8,8·10⁶ · 999 / 600 000 ≈ 1,5·10⁴.
  const KDF = { iterations: 600000, speed: 1.5e4 };

  // Срок годности (этап 2): скорость видеокарт удваивается примерно
  // каждые 2 года, V(t) = V₀ · 2^(t/2). Пароль «просрочен», когда его
  // подбирают быстрее чем за сутки.
  const GROWTH = { doublingYears: 2, limitSeconds: 86400 };

  // Шкала оценок по энтропии (в битах).
  const LEVELS = [
    { min: 0,   label: 'Очень слабый' },
    { min: 28,  label: 'Слабый' },
    { min: 36,  label: 'Средний' },
    { min: 60,  label: 'Сильный' },
    { min: 128, label: 'Очень сильный' },
  ];

  const LG2 = Math.log10(2);
  const MINUTE = 60;
  const HOUR = 3600;
  const DAY = 86400;
  const YEAR = 365.25 * DAY;
  const UNIVERSE_AGE_YEARS = 1.38e10;

  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

  /* ---------- Расчёты ---------- */

  function analyze(password) {
    const chars = Array.from(password);           // учитываем эмодзи как один символ
    const used = new Set();
    for (const ch of chars) {
      used.add(CLASSES.find((c) => c.test(ch)) || OTHER);
    }
    const classes = [...CLASSES, OTHER]
      .filter((c) => used.has(c))
      .map(({ id, label, size }) => ({ id, label, size }));
    const pool = classes.reduce((sum, c) => sum + c.size, 0);
    const length = chars.length;
    const bits = length > 0 && pool > 1 ? length * Math.log2(pool) : 0;
    return { length, pool, classes, bits };
  }

  function strength(bits) {
    let level = 0;
    LEVELS.forEach((item, i) => { if (bits >= item.min) level = i; });
    return { level, label: LEVELS[level].label };
  }

  // Десятичный логарифм среднего времени подбора в секундах:
  // lg T = lg(2^H) − lg(2V) = H · lg 2 − lg(2V)
  function crackTimeLog10(bits, speed) {
    return bits * LG2 - Math.log10(2 * speed);
  }

  // Через сколько лет подбор займёт меньше limit секунд:
  // 2^H / (2 · V₀ · 2^(t/2)) = limit  ⇒  t = 2 · (H − 1 − log₂ V₀ − log₂ limit).
  // Ноль или меньше — пароль уже сейчас подбирают быстрее.
  function expiryYears(bits, speed, limit = GROWTH.limitSeconds) {
    return GROWTH.doublingYears * (bits - 1 - Math.log2(speed) - Math.log2(limit));
  }

  // Время подбора через years лет: скорость выросла в 2^(years/2) раз.
  function crackTimeLog10At(bits, speed, years) {
    return crackTimeLog10(bits, speed) - (years / GROWTH.doublingYears) * LG2;
  }

  // Квантовый перебор (алгоритм Гровера) находит пароль примерно за √(2^H)
  // шагов, то есть стойкость падает вдвое.
  function quantumBits(bits) {
    return bits / 2;
  }

  /* ---------- Оформление чисел по-русски ---------- */

  function plural(n, [one, few, many]) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function formatBits(bits) {
    const rounded = Math.round(bits * 10) / 10;
    const word = Number.isInteger(rounded) ? plural(rounded, ['бит', 'бита', 'бит']) : 'бита';
    return `${nf1.format(rounded)} ${word}`;
  }

  // 10^lg → «m·10^e» (HTML с верхним индексом)
  function scientific(lg) {
    let e = Math.floor(lg);
    let m = Math.round(10 ** (lg - e) * 10) / 10;
    if (m >= 10) { m = 1; e += 1; }
    return `${nf1.format(m)}·10<sup>${e}</sup>`;
  }

  function formatSpeed(speed) {
    const value = speed < 1e4 ? nf0.format(speed) : scientific(Math.log10(speed));
    const word = speed < 1e4 ? plural(Math.round(speed), ['попытка', 'попытки', 'попыток']) : 'попыток';
    return `${value} ${word} в секунду`;
  }

  function count(value, forms) {
    const n = Math.max(1, Math.round(value));
    return `${nf0.format(n)} ${plural(n, forms)}`;
  }

  // Переводит lg T (секунды) в понятный текст: «3 часа», «12 лет», «2,4·10¹⁵ лет».
  function formatDuration(lg) {
    if (!Number.isFinite(lg) || lg < 0) {
      return { html: 'меньше секунды', beyondUniverse: false };
    }
    const lgYears = lg - Math.log10(YEAR);
    const beyondUniverse = lgYears > Math.log10(UNIVERSE_AGE_YEARS);
    let html;

    if (lgYears >= 12) {
      html = `${scientific(lgYears)} лет`;
    } else {
      const s = 10 ** lg;
      const years = s / YEAR;
      if (s < 59.5) html = count(s, ['секунда', 'секунды', 'секунд']);
      else if (s < 59.5 * MINUTE) html = count(s / MINUTE, ['минута', 'минуты', 'минут']);
      else if (s < 23.5 * HOUR) html = count(s / HOUR, ['час', 'часа', 'часов']);
      else if (s < YEAR - DAY / 2) html = count(s / DAY, ['день', 'дня', 'дней']);
      else if (years < 999999.5) html = count(years, ['год', 'года', 'лет']);
      else if (years < 999.95e6) html = `${nf1.format(years / 1e6)} млн лет`;
      else html = `${nf1.format(years / 1e9)} млрд лет`;
    }
    return { html, beyondUniverse };
  }

  return {
    SYMBOLS, CLASSES, OTHER, SCENARIOS, LEVELS, KDF, GROWTH,
    analyze, strength, crackTimeLog10, crackTimeLog10At, expiryYears, quantumBits,
    plural, formatBits, formatSpeed, formatDuration,
  };
})();
