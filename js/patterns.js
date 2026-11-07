'use strict';

/* BastionBit — детектор хитростей (этап 2, личные данные — этап 4).

   Формула H = L · log₂ N считает каждый символ случайным. Но люди собирают
   пароли из слов, дат и клавиатурных дорожек, и взломщик перебирает именно
   их. Детектор считает «реальную» энтропию:

   1. Ищет в пароле куски-хитрости: популярные пароли и частые слова (в том
      числе с заменами @ → a, задом наперёд, в другой раскладке и транслитом),
      даты и годы, клавиатурные дорожки, повторы, последовательности,
      фразы генератора BastionBit и личные данные, если их указали
      (этап 4, js/personal.js).
   2. Каждому куску даёт цену в битах — log₂ числа вариантов, которые
      взломщику нужно перебрать для такого куска. Слово из словаря стоит
      log₂ r бит, где r — его место (ранг) в словаре.
   3. Остальные символы считает по формуле L · log₂ N, где N — алфавит
      только этих символов.
   4. Выбирает разбиение пароля с наименьшей суммой (динамическое
      программирование):
         H = H₁ + H₂ + … + Hₖ + 3 · (k − 1).
      3 бита за каждый стык — плата за то, что взломщик не знает,
      из каких кусков и в каком порядке собран пароль.

   Итог никогда не больше оценки по формуле. Подход похож на библиотеку
   zxcvbn (Dropbox), но детектор знает русский язык и раскладку ЙЦУКЕН.

   Словари (data/*.js) загружаются отдельно. Пока их нет, детектор
   работает без них. */

const BBPatterns = (() => {
  const MAX_LENGTH = 100;   // разбираем первые 100 символов, остальное — по формуле
  const JOIN_BITS = 3;      // плата за каждый стык между кусками
  // Находки засчитываются, если снижают оценку хотя бы на 10 % и на 8 бит
  // (на 2 бита, если занимают не меньше 3/4 пароля). Меньшая экономия —
  // случайное совпадение: в случайном пароле тоже попадаются «abc» и «love».
  const MIN_SHARE = 0.1;
  const MIN_SAVING = 8;
  const MIN_COVERAGE = 0.75;
  const MIN_SAVING_COVERED = 2;
  const MIN_WORD = 4;       // слова из словарей с переделками — от четырёх букв,
  const SHORT_WORD = 3;     // как есть и популярные пароли — от трёх
  const MAX_WORD = 24;
  const FREE_CASE = 6;      // любой регистр букв — только у слов от шести букв
  const MAX_UNIT = 16;      // самый длинный повторяющийся кусок
  const YEAR_FROM = 1950;
  const YEAR_TO = 2030;
  const YEARS = YEAR_TO - YEAR_FROM + 1;   // 81 год

  const log2 = Math.log2;
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const hasPhrase = () => typeof BBPhrase !== 'undefined';

  /* ---------- Словари ---------- */

  const DICTIONARIES = {
    passwords: {
      text: () => (typeof BB_TOP_PASSWORDS === 'string' ? BB_TOP_PASSWORDS : null),
      about: 'в списке 10 000 популярных паролей',
    },
    ru: {
      text: () => (typeof BB_DICT_RU === 'string' ? BB_DICT_RU : null),
      what: 'частых русских слов',
    },
    en: {
      text: () => (typeof BB_DICT_EN === 'string' ? BB_DICT_EN : null),
      what: 'частых английских слов',
    },
    // Имена, фамилии, отчества и названия мест из OpenCorpora (этап 5).
    // Частот у них нет, поэтому каждое стоит одинаково: log₂ N бит.
    names: {
      text: () => (typeof BB_DICT_NAMES === 'string' ? BB_DICT_NAMES : null),
      what: 'русских имён, фамилий, отчеств и названий мест',
      uniform: true,
    },
  };
  const ALL = ['passwords', 'en', 'ru', 'names'];
  const RUSSIAN = ['ru', 'names'];
  const LATIN = ['passwords', 'en'];
  const WORDS = ['en', 'ru'];
  const ranks = {};
  const shortWords = {};   // сколько в словаре слов из трёх букв

  // Слово → место в словаре (1 — самое частое). Строится один раз.
  function rankMap(id) {
    if (ranks[id]) return ranks[id];
    const text = DICTIONARIES[id].text();
    if (!text) return null;
    const map = new Map();
    const words = text.split(' ');
    let short = 0;
    words.forEach((word, i) => {
      if (word && !map.has(word)) map.set(word, DICTIONARIES[id].uniform ? words.length : i + 1);
      if (word.length === SHORT_WORD) short++;
    });
    ranks[id] = map;
    shortWords[id] = short;
    return map;
  }

  // Слово из трёх букв стоит не меньше log₂ числа всех таких слов
  // (≈ 11 бит): иначе случайный пароль часто «содержал бы» слова вроде «the».
  function shortWordBits() {
    const total = WORDS.reduce((sum, id) => sum + (rankMap(id) ? shortWords[id] : 0), 0);
    return total > 1 ? log2(total) : 0;
  }

  function ready() {
    return Object.values(DICTIONARIES).every((dictionary) => dictionary.text() !== null);
  }

  // Самый частый вариант слова среди нескольких словарей.
  function lookup(word, ids) {
    let best = null;
    for (const id of ids) {
      const map = rankMap(id);
      const rank = map && map.get(word);
      if (rank && (!best || rank < best.rank)) best = { id, rank, word };
    }
    return best;
  }

  /* ---------- Транслит: parol → пароль ---------- */

  const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'yu', я: 'ya',
  };
  // Люди пишут транслитом по-разному: «й» — y, j или i, «х» — h, kh или x…
  const TRANSLIT_VARIANTS = [
    {},
    { й: 'j', х: 'kh', ц: 'ts', щ: 'shch', ю: 'ju', я: 'ja' },
    { й: 'i', ж: 'j', х: 'x', ы: 'i', ю: 'iu', я: 'ia' },
  ];
  const TRANSLIT_TABLES = TRANSLIT_VARIANTS.map((variant) => ({ ...TRANSLIT, ...variant }));

  // Обычный транслит: «госуслуги» → «gosuslugi». Нужен правилу (js/rule.js).
  function translitText(text) {
    return Array.from(String(text).toLowerCase().replace(/ё/g, 'е'), (ch) => TRANSLIT[ch] ?? ch).join('');
  }
  let translit = null;

  // Латинская запись → русское слово или имя: { id, rank, word }.
  function translitMap() {
    if (translit) return translit;
    if (!RUSSIAN.every((id) => DICTIONARIES[id].text())) return null;
    translit = new Map();
    for (const id of RUSSIAN) {
      for (const [word, rank] of rankMap(id)) {
        for (const table of TRANSLIT_TABLES) {
          let latin = '';
          for (let k = 0; k < word.length; k++) {
            const sound = table[word[k]];
            latin += sound === undefined ? word[k] : sound;
          }
          if (latin.length < MIN_WORD) continue;
          const old = translit.get(latin);
          if (!old || rank < old.rank) translit.set(latin, { id, rank, word });
        }
      }
    }
    return translit;
  }

  // Готовит словари заранее, чтобы первая проверка не тормозила.
  function prepare() {
    Object.keys(DICTIONARIES).forEach(rankMap);
    translitMap();
    return ready();
  }

  /* ---------- Заглавные буквы и замены символов ---------- */

  const isUpper = (ch) => ch !== ch.toLowerCase();
  const isLower = (ch) => ch !== ch.toUpperCase();

  function nCk(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - i + 1)) / i;
    return r;
  }

  // Как в zxcvbn: все буквы заглавные или заглавная только первая — +1 бит;
  // иначе log₂ числа способов расставить заглавные. Короткое слово
  // с заглавными вперемешку (kGB, nOW) скорее случайное совпадение,
  // поэтому для слов короче FREE_CASE букв такой регистр не считается
  // словом: функция возвращает null.
  function caseBits(chars) {
    const letters = chars.filter((ch) => isUpper(ch) || isLower(ch));
    const upper = letters.filter(isUpper).length;
    const lower = letters.length - upper;
    if (upper === 0) return 0;
    if (lower === 0) return 1;
    if (upper === 1 && isUpper(letters[0])) return 1;
    if (letters.length < FREE_CASE) return null;
    let variants = 0;
    for (let i = 1; i <= Math.min(upper, lower); i++) variants += nCk(upper + lower, i);
    return log2(variants);
  }

  // Замены, которые знает любой взломщик: p@$$w0rd → password.
  const LEET = { a: '4@', b: '8', c: '({[<', e: '3', g: '69', i: '1!|', l: '1|7', o: '0', s: '$5', t: '+7', x: '%', z: '2' };
  const UNLEET = {};
  Object.entries(LEET).forEach(([letter, subs]) => {
    for (const ch of subs) (UNLEET[ch] = UNLEET[ch] || []).push(letter);
  });
  const MAX_LEET_VARIANTS = 16;

  // Все способы прочитать замены: «1» может быть i или l.
  function leetVariants(lower) {
    const present = [...new Set(lower.filter((ch) => UNLEET[ch]))];
    if (!present.length) return [];
    let variants = [{}];
    for (const ch of present) {
      const next = [];
      for (const variant of variants) {
        for (const letter of UNLEET[ch]) next.push({ ...variant, [ch]: letter });
      }
      variants = next.slice(0, MAX_LEET_VARIANTS);
    }
    return variants;
  }

  /* ---------- Клавиатура ---------- */

  // Ряды QWERTY сдвинуты относительно друг друга. Соседи клавиши — слева,
  // справа и по две сверху и снизу (как в zxcvbn). На цифровом блоке
  // ряды ровные, соседей до восьми.
  const QWERTY_ROWS = [
    '`~ 1! 2@ 3# 4$ 5% 6^ 7& 8* 9( 0) -_ =+',
    'qQ wW eE rR tT yY uU iI oO pP [{ ]} \\|',
    'aA sS dD fF gG hH jJ kK lL ;: \'"',
    'zZ xX cC vV bB nN mM ,< .> /?',
  ].map((row) => row.split(' '));
  const KEYPAD_ROWS = [
    [null, '/', '*', '-'],
    ['7', '8', '9', '+'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    [null, '0', '.'],
  ];
  const SLANTED = [[-1, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1]];
  const ALIGNED = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];

  function buildKeyboard(rows, slanted) {
    const at = new Map();
    rows.forEach((row, y) => row.forEach((key, x) => {
      if (key) at.set(`${x + (slanted && y > 0 ? 1 : 0)},${y}`, key);
    }));
    const graph = {};
    let keys = 0;
    let degree = 0;
    at.forEach((key, position) => {
      const [x, y] = position.split(',').map(Number);
      const near = (slanted ? SLANTED : ALIGNED).map(([dx, dy]) => at.get(`${x + dx},${y + dy}`) || null);
      for (const ch of key) {
        graph[ch] = near;
        keys++;
        degree += near.filter(Boolean).length;
      }
    });
    // starts — сколько клавиш, degree — сколько в среднем соседей
    return { graph, starts: keys, degree: degree / keys };
  }

  const KEYBOARDS = {
    qwerty: buildKeyboard(QWERTY_ROWS, true),
    keypad: buildKeyboard(KEYPAD_ROWS, false),
  };
  const SHIFTED = /[~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?]/;

  // Число дорожек длиной до L с t поворотами и меньше (формула zxcvbn):
  // Σ (i = 2…L) Σ (j = 1…min(t, i − 1)) C(i − 1, j − 1) · s · d^j.
  function walkBits(length, turns, shifted, keyboard) {
    let guesses = 0;
    for (let i = 2; i <= length; i++) {
      for (let j = 1; j <= Math.min(turns, i - 1); j++) {
        guesses += nCk(i - 1, j - 1) * keyboard.starts * keyboard.degree ** j;
      }
    }
    if (shifted) {
      const unshifted = length - shifted;
      if (unshifted === 0) guesses *= 2;
      else {
        let variants = 0;
        for (let i = 1; i <= Math.min(shifted, unshifted); i++) variants += nCk(length, i);
        guesses *= variants;
      }
    }
    return log2(guesses);
  }

  /* ---------- Даты ---------- */

  const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Без разделителей узнаём только даты с двумя цифрами дня и месяца:
  // 1505, 150598, 15051998 (и порядки «месяц, день» и «год, месяц, день»).
  const DATE_FORMATS = {
    4: ['DDMM', 'MMDD'],
    6: ['DDMMYY', 'MMDDYY', 'YYMMDD'],
    8: ['DDMMYYYY', 'MMDDYYYY', 'YYYYMMDD'],
  };
  const DATE_WITH_SEPARATOR = /^(\d{1,4})([ .\/\\_-])(\d{1,2})(?:\2(\d{1,4}))?$/;

  const validDay = (day, month) => month >= 1 && month <= 12 && day >= 1 && day <= DAYS[month - 1];

  // Сколько лет мог выбрать человек: 2 цифры — 100, 4 цифры — 1950…2030.
  function yearChoices(text) {
    if (text.length === 2) return 100;
    const year = Number(text);
    return text.length === 4 && year >= YEAR_FROM && year <= YEAR_TO ? YEARS : 0;
  }

  function makeDate(day, month, year) {
    if (!validDay(day, month)) return null;
    if (year === undefined) return { day, month, years: 0 };
    const years = yearChoices(year);
    return years ? { day, month, year, years } : null;
  }

  function parseDigits(digits) {
    for (const format of DATE_FORMATS[digits.length] || []) {
      const parts = { D: '', M: '', Y: '' };
      for (let k = 0; k < format.length; k++) parts[format[k]] += digits[k];
      const date = makeDate(Number(parts.D), Number(parts.M), parts.Y || undefined);
      if (date) return date;
    }
    return null;
  }

  function parseSeparated(text) {
    const m = DATE_WITH_SEPARATOR.exec(text);
    if (!m) return null;
    const [, a, separator, b, c] = m;
    let date = null;
    if (c === undefined) {
      if (a.length === 2 && b.length === 2) date = makeDate(Number(a), Number(b)) || makeDate(Number(b), Number(a));
    } else if (a.length === 4) {
      if (c.length <= 2) date = makeDate(Number(c), Number(b), a);
    } else if (a.length <= 2 && (c.length === 2 || c.length === 4)) {
      date = makeDate(Number(a), Number(b), c) || makeDate(Number(b), Number(a), c);
    }
    return date && { ...date, separator };
  }

  // День и месяц — 366 вариантов, с годом — 365 · число лет.
  // Разделитель (точка, дефис…) взломщик тоже перебирает: +2 бита.
  function dateBits(date) {
    return log2(date.years ? 365 * date.years : 366) + (date.separator ? 2 : 0);
  }

  /* ---------- Поиск кусков ---------- */

  // Перебирает куски от min до MAX_WORD символов: fn(начало, конец, текст).
  function scan(seq, fn, min = MIN_WORD) {
    const n = seq.length;
    for (let i = 0; i < n; i++) {
      let word = '';
      const end = Math.min(n, i + MAX_WORD);
      for (let j = i; j < end; j++) {
        word += seq[j];
        if (j - i + 1 >= min) fn(i, j + 1, word);
      }
    }
  }

  // prefix[i] — сколько символов из первых i подходят под test
  function prefixCount(chars, test) {
    const prefix = new Uint16Array(chars.length + 1);
    chars.forEach((ch, i) => { prefix[i + 1] = prefix[i] + (test(ch) ? 1 : 0); });
    return (i, j) => prefix[j] - prefix[i];
  }

  function wordMatch(chars, i, j, hit, variant = {}) {
    const upper = caseBits(chars.slice(i, j));
    if (upper === null) return null;
    // У переделанного слова (замены, раскладка, транслит) — только обычный регистр
    if (upper > 1 && (variant.leet || variant.layout || variant.translit || variant.reversed)) return null;
    const extra = (variant.leet ? variant.leet.length : 0)
      + (variant.reversed ? 1 : 0) + (variant.layout ? 1 : 0) + (variant.translit ? 1 : 0);
    let rankBits = Math.max(1, log2(hit.rank));
    if (hit.id !== 'passwords' && j - i === SHORT_WORD) rankBits = Math.max(rankBits, shortWordBits());
    return {
      i, j, type: 'dictionary', dictionary: hit.id, rank: hit.rank, word: hit.word,
      variant, caseBits: upper, bits: rankBits + upper + extra,
    };
  }

  function dictionaryMatches(chars, norm, push) {
    const add = (m) => { if (m) push(m); };
    const n = chars.length;
    const text = chars.join('');
    const latinLetters = prefixCount(chars, (ch) => /[a-z]/i.test(ch));
    const cyrillic = prefixCount(chars, (ch) => /[а-яё]/i.test(ch));

    // Как есть — от трёх символов
    scan(norm, (i, j, word) => {
      const hit = lookup(word, ALL);
      if (hit) add(wordMatch(chars, i, j, hit));
    }, SHORT_WORD);

    // Задом наперёд: drowssap
    const reversed = norm.slice().reverse();
    scan(reversed, (a, b, word) => {
      const hit = lookup(word, ALL);
      if (hit) add(wordMatch(chars, n - b, n - a, hit, { reversed: true }));
    });

    // Замены символов: p@$$w0rd. Настоящих букв должно быть не меньше
    // двух и не меньше, чем замен, а слово из четырёх символов должно быть
    // популярным паролем (l0v3) — иначе это скорее случайные символы.
    for (const variant of leetVariants(norm)) {
      const mapped = norm.map((ch) => variant[ch] || ch);
      scan(mapped, (i, j, word) => {
        const hit = lookup(word, j - i > MIN_WORD ? LATIN : ['passwords']);
        if (!hit) return;
        const letters = latinLetters(i, j);
        const used = new Map();
        let subs = 0;
        for (let k = i; k < j; k++) {
          if (variant[norm[k]]) {
            used.set(norm[k], variant[norm[k]]);
            subs++;
          }
        }
        if (used.size && letters >= 2 && letters >= subs) add(wordMatch(chars, i, j, hit, { leet: [...used] }));
      });
    }

    if (!hasPhrase()) return;

    // Русское слово в английской раскладке: gfhjkm → пароль
    if (cyrillic(0, n) < n) {
      const ru = Array.from(BBPhrase.fromEnglishLayout(text).toLowerCase().replace(/ё/g, 'е'));
      if (ru.length === n) {
        scan(ru, (i, j, word) => {
          if (cyrillic(i, j) || !/^[а-я]+$/.test(word)) return;
          const hit = lookup(word, RUSSIAN);
          if (hit) add(wordMatch(chars, i, j, hit, { layout: 'ru', typed: norm.slice(i, j).join('') }));
        });
      }
    }

    // Английское слово или пароль в русской раскладке: йцукен → qwerty
    if (cyrillic(0, n) > 0) {
      const en = Array.from(BBPhrase.toEnglishLayout(text).toLowerCase());
      if (en.length === n) {
        scan(en, (i, j, word) => {
          if (cyrillic(i, j) !== j - i) return;
          const hit = lookup(word, LATIN);
          if (hit) add(wordMatch(chars, i, j, hit, { layout: 'en', typed: norm.slice(i, j).join('') }));
        });
      }
    }

    // Транслит: parol → пароль
    const map = latinLetters(0, n) >= MIN_WORD ? translitMap() : null;
    if (map) {
      scan(norm, (i, j, word) => {
        if (latinLetters(i, j) !== j - i) return;
        const hit = map.get(word);
        if (hit) add(wordMatch(chars, i, j, hit, { translit: true }));
      });
    }
  }

  function dateMatches(chars, add) {
    const n = chars.length;
    const digits = prefixCount(chars, (ch) => ch >= '0' && ch <= '9');
    for (let i = 0; i < n; i++) {
      if (!digits(i, i + 1)) continue;
      for (let j = i + 3; j <= Math.min(n, i + 10); j++) {
        const text = chars.slice(i, j).join('');
        if (digits(i, j) === j - i) {
          const year = Number(text);
          if (j - i === 4 && year >= YEAR_FROM && year <= YEAR_TO) {
            add({ i, j, type: 'year', year: text, bits: log2(YEARS) });
          }
          const date = parseDigits(text);
          if (date) add({ i, j, type: 'date', date, bits: dateBits(date) });
        } else {
          const date = parseSeparated(text);
          if (date) add({ i, j, type: 'date', date, bits: dateBits(date) });
        }
      }
    }
  }

  function walkMatches(keys, keyboardName, add, layout) {
    const keyboard = KEYBOARDS[keyboardName];
    const n = keys.length;
    for (let i = 0; i + 2 < n; i++) {
      if (!keyboard.graph[keys[i]]) continue;
      let turns = 0;
      let last = -1;
      let shifted = keyboardName === 'qwerty' && SHIFTED.test(keys[i]) ? 1 : 0;
      for (let j = i + 1; j < n; j++) {
        const near = keyboard.graph[keys[j - 1]];
        const direction = near.findIndex((key) => key && key.includes(keys[j]));
        if (direction < 0) break;
        if (near[direction].indexOf(keys[j]) === 1) shifted++;
        if (direction !== last) {
          turns++;
          last = direction;
        }
        const length = j + 1 - i;
        // Зигзаг с частыми поворотами — уже не дорожка: поворотов не больше
        // половины клавиш. Дорожка из трёх клавиш — только прямая и без Shift.
        const straight = length > 3 ? turns <= Math.floor(length / 2) : turns === 1 && !shifted;
        if (length >= 3 && straight) {
          add({
            i, j: j + 1, type: 'keyboard', keyboard: keyboardName, turns, shifted, layout,
            bits: walkBits(length, turns, shifted, keyboard) + (layout ? 1 : 0),
          });
        }
      }
    }
  }

  function keyboardMatches(chars, add) {
    walkMatches(chars, 'qwerty', add, false);
    walkMatches(chars, 'keypad', add, false);
    // Дорожка на русской раскладке — те же клавиши: йцукен = qwerty
    if (hasPhrase() && chars.some((ch) => /[а-яё]/i.test(ch))) {
      const text = chars.join('').replace(/ё/g, '`').replace(/Ё/g, '~');
      const keys = Array.from(BBPhrase.toEnglishLayout(text));
      if (keys.length === chars.length) {
        walkMatches(keys, 'qwerty', (m) => {
          if (chars.slice(m.i, m.j).some((ch) => /[а-яё]/i.test(ch))) add(m);
        }, true);
      }
    }
  }

  function repeatMatches(chars, add, unitBits) {
    const n = chars.length;
    const same = (a, b, length) => {
      for (let k = 0; k < length; k++) if (chars[a + k] !== chars[b + k]) return false;
      return true;
    };
    for (let i = 0; i < n; i++) {
      for (let unit = 1; unit <= MAX_UNIT && i + 2 * unit <= n; unit++) {
        let count = 1;
        while (i + (count + 1) * unit <= n && same(i, i + count * unit, unit)) count++;
        if (count < 2 || unit * count < 3) continue;
        const piece = chars.slice(i, i + unit);
        const bits = unitBits(piece);
        for (let c = 2; c <= count; c++) {
          if (unit * c >= 3) {
            add({ i, j: i + unit * c, type: 'repeat', unit: piece.join(''), count: c, bits: bits + log2(c) });
          }
        }
      }
    }
  }

  const SEQUENCES = [
    { test: (ch) => ch >= '0' && ch <= '9', size: 10 },
    { test: (ch) => ch >= 'a' && ch <= 'z', size: 26 },
    { test: (ch) => ch >= 'A' && ch <= 'Z', size: 26 },
    { test: (ch) => ch >= 'а' && ch <= 'я', size: 33 },
    { test: (ch) => ch >= 'А' && ch <= 'Я', size: 33 },
  ];
  const OBVIOUS_STARTS = 'aAzZ019аАяЯ';

  // abcd, 9876, 2468: одинаковый шаг внутри одного алфавита —
  // у букв шаг 1, у цифр 1 или 2.
  // Число вариантов (как в zxcvbn): начало × длина × 2, если шаг назад.
  function sequenceMatches(chars, add) {
    const n = chars.length;
    const code = (k) => chars[k].codePointAt(0);
    for (let i = 0; i + 2 < n; i++) {
      const kind = SEQUENCES.find((s) => s.test(chars[i]));
      if (!kind || !kind.test(chars[i + 1])) continue;
      const delta = code(i + 1) - code(i);
      if (!delta || Math.abs(delta) > (kind.size === 10 ? 2 : 1)) continue;
      let j = i + 2;
      while (j < n && kind.test(chars[j]) && code(j) - code(j - 1) === delta) j++;
      const start = OBVIOUS_STARTS.includes(chars[i]) ? 4 : kind.size;
      for (let end = i + 3; end <= j; end++) {
        add({ i, j: end, type: 'sequence', delta, bits: log2(start * (end - i) * (delta < 0 ? 2 : 1)) });
      }
    }
  }

  function phraseMatch(chars, add) {
    if (!hasPhrase()) return;
    const text = chars.join('');
    const found = BBPhrase.recognize(text);
    if (!found || !found.end) return;
    const j = Array.from(text.slice(0, found.end)).length;
    add({ i: 0, j, type: 'phrase', words: found.words, layout: found.layout, bits: found.bits });
  }

  /* ---------- Личные данные (этап 4) ---------- */

  // Набор от BBPersonal.prepare(): имя, даты, кличка… во всех формах.
  // Задаётся на время одного вызова analyze().
  let personal = null;

  // Кусок пароля совпал с формой личных данных: «ilya», «15.05.2008».
  // Цена: log₂ K (какая из K записей) + форма + регистр.
  function personalMatches(chars, norm, add) {
    if (!personal) return;
    const text = norm.join('');
    const at = new Map();            // смещение в строке → номер символа
    let offset = 0;
    norm.forEach((ch, i) => { at.set(offset, i); offset += ch.length; });
    at.set(offset, norm.length);
    for (const item of personal.items) {
      for (const form of item.forms) {
        for (let from = text.indexOf(form.text); from !== -1; from = text.indexOf(form.text, from + 1)) {
          const i = at.get(from);
          const j = at.get(from + form.text.length);
          if (i === undefined || j === undefined) continue;
          const upper = caseBits(chars.slice(i, j));
          if (upper === null || (upper > 1 && form.extra)) continue;
          add({
            i, j, type: 'personal', field: item.field, label: item.label, shown: item.shown,
            how: form.how, items: personal.size, caseBits: upper,
            bits: personal.itemBits + item.formBits + form.extra + upper,
          });
        }
      }
    }
  }

  /* ---------- Случайные символы: L · log₂ N ---------- */

  const SIZES = [...BBEntropy.CLASSES.map((c) => c.size), BBEntropy.OTHER.size];

  function classIndex(ch) {
    const i = BBEntropy.CLASSES.findIndex((c) => c.test(ch));
    return i >= 0 ? i : SIZES.length - 1;
  }

  // Алфавит куска — только те наборы символов, что в нём встречаются.
  function bruteforce(chars) {
    const counts = SIZES.map(() => new Uint16Array(chars.length + 1));
    chars.forEach((ch, i) => {
      const k = classIndex(ch);
      counts.forEach((row, r) => { row[i + 1] = row[i] + (r === k ? 1 : 0); });
    });
    return (i, j) => {
      let pool = 0;
      counts.forEach((row, k) => { if (row[j] > row[i]) pool += SIZES[k]; });
      return { bits: pool > 1 ? (j - i) * log2(pool) : 0, pool };
    };
  }

  /* ---------- Лучшее разбиение ---------- */

  const unitMemo = new Map();

  // Стойкость повторяющегося куска — тем же детектором (без фраз).
  function unitBits(chars) {
    const key = chars.join('');
    if (!unitMemo.has(key)) {
      const naive = BBEntropy.analyze(key).bits;
      unitMemo.set(key, Math.min(naive, solve(chars, false).bits));
    }
    return unitMemo.get(key);
  }

  function findMatches(chars, withPhrase) {
    const matches = [];
    const add = (m) => matches.push(m);
    const norm = chars.map((ch) => ch.toLowerCase().replace('ё', 'е'));
    dictionaryMatches(chars, norm, add);
    dateMatches(chars, add);
    keyboardMatches(chars, add);
    repeatMatches(chars, add, unitBits);
    sequenceMatches(chars, add);
    personalMatches(chars, norm, add);
    if (withPhrase) phraseMatch(chars, add);
    return matches;
  }

  // Динамическое программирование по позициям пароля. Два состояния:
  // последний кусок — хитрость (0) или случайные символы (1). Два куска
  // случайных символов подряд не ставим: это один кусок.
  function solve(chars, withPhrase) {
    const n = chars.length;
    if (!n) return { bits: 0, chunks: [] };
    const starts = Array.from({ length: n }, () => []);
    findMatches(chars, withPhrase).forEach((m) => starts[m.i].push(m));
    const random = bruteforce(chars);
    const cost = [new Float64Array(n + 1).fill(Infinity), new Float64Array(n + 1).fill(Infinity)];
    const from = [[], []];
    cost[0][0] = 0;

    for (let i = 0; i < n; i++) {
      for (let state = 0; state < 2; state++) {
        const base = cost[state][i];
        if (base === Infinity) continue;
        const join = i > 0 ? JOIN_BITS : 0;
        for (const m of starts[i]) {
          const total = base + join + m.bits;
          if (total < cost[0][m.j] - 1e-9) {
            cost[0][m.j] = total;
            from[0][m.j] = { state, chunk: m };
          }
        }
        if (state === 1) continue;
        for (let j = i + 1; j <= n; j++) {
          const r = random(i, j);
          const total = base + join + r.bits;
          if (total < cost[1][j] - 1e-9) {
            cost[1][j] = total;
            from[1][j] = { state, chunk: { i, j, type: 'random', bits: r.bits, pool: r.pool } };
          }
        }
      }
    }

    let state = cost[0][n] <= cost[1][n] ? 0 : 1;
    const bits = cost[state][n];
    const chunks = [];
    for (let k = n; k > 0;) {
      const step = from[state][k];
      chunks.unshift(step.chunk);
      state = step.state;
      k = step.chunk.i;
    }
    return { bits, chunks };
  }

  /* ---------- Итог ---------- */

  // options.personal — личные данные от BBPersonal.prepare() (этап 4).
  function analyze(password, options = {}) {
    const next = options.personal && options.personal.size ? options.personal : null;
    if (next !== personal) unitMemo.clear();   // стоимость повторов зависела от прежних данных
    personal = next;
    const value = String(password ?? '');
    const chars = Array.from(value);
    const naive = BBEntropy.analyze(value);
    const empty = { bits: naive.bits, naiveBits: naive.bits, naive, found: false, saving: 0, chunks: [], dictionaries: ready() };
    if (!chars.length) return empty;

    const head = chars.slice(0, MAX_LENGTH);
    const best = solve(head, true);
    let bits = best.bits;
    const chunks = best.chunks.slice();
    if (chars.length > MAX_LENGTH) {
      const tail = chars.slice(MAX_LENGTH);
      const r = bruteforce(tail)(0, tail.length);
      bits += JOIN_BITS + r.bits;
      chunks.push({ i: MAX_LENGTH, j: chars.length, type: 'random', bits: r.bits, pool: r.pool, tail: true });
    }

    const saving = naive.bits - bits;
    const covered = chunks.reduce((sum, c) => sum + (c.type === 'random' ? 0 : c.j - c.i), 0);
    const minimum = covered >= MIN_COVERAGE * chars.length ? MIN_SAVING_COVERED : MIN_SAVING;
    const found = covered > 0 && saving >= Math.max(minimum, MIN_SHARE * naive.bits);
    if (!found) return empty;
    return {
      bits, naiveBits: naive.bits, naive, found, saving, dictionaries: ready(),
      chunks: chunks.map((c) => ({ ...c, start: c.i, end: c.j, token: chars.slice(c.i, c.j).join('') })),
    };
  }

  /* ---------- Объяснения по-русски ---------- */

  const TAGS = {
    dictionary: 'слово', date: 'дата', year: 'год', keyboard: 'клавиши',
    repeat: 'повтор', sequence: 'ряд', phrase: 'фраза', personal: 'о вас', random: 'случайно',
  };
  const plural = (n, forms) => `${nf0.format(n)} ${BBEntropy.plural(n, forms)}`;
  const pad = (n) => String(n).padStart(2, '0');

  // Популярный пароль, за которым стоит русское слово: gfhjkm, parol.
  function aliasOf(token) {
    const lower = token.toLowerCase();
    if (hasPhrase() && /^[a-z;',.[\]`]+$/.test(lower)) {
      const word = BBPhrase.fromEnglishLayout(lower).replace(/ё/g, 'е');
      if (/^[а-я]+$/.test(word) && lookup(word, RUSSIAN)) return { word, how: 'в английской раскладке' };
    }
    const map = /^[a-z]+$/.test(lower) ? translitMap() : null;
    const hit = map && map.get(lower);
    return hit ? { word: hit.word, how: 'латиницей' } : null;
  }

  // Заголовок и пояснение куска. reveal = false — пароль скрыт на экране,
  // поэтому не показываем ни сам кусок, ни найденное слово.
  function describe(chunk, { reveal = true } = {}) {
    const quote = (text) => (reveal ? `«${text}»` : '');
    const length = Array.from(chunk.token || '').length;
    const notes = [];
    let title = '';
    let tag = TAGS[chunk.type];

    switch (chunk.type) {
      case 'dictionary': {
        const v = chunk.variant || {};
        if (chunk.dictionary === 'passwords') {
          title = 'Популярный пароль';
          tag = 'пароль';
        } else {
          title = { ru: 'Русское слово', en: 'Английское слово', names: 'Имя или название' }[chunk.dictionary];
        }
        const dictionary = DICTIONARIES[chunk.dictionary];
        const about = dictionary.about || `среди ${nf0.format(rankMap(chunk.dictionary).size)} ${dictionary.what}`;
        if (dictionary.uniform) notes.push(`одно из ${nf0.format(chunk.rank)} ${dictionary.what}`);
        else notes.push(reveal ? `№ ${nf0.format(chunk.rank)} ${about}` : `есть ${about}`);
        const alias = chunk.dictionary === 'passwords' && !Object.keys(v).length ? aliasOf(chunk.token || '') : null;
        if (alias) notes.push(reveal ? `это «${alias.word}» ${alias.how}` : `русское слово ${alias.how}`);
        if (v.layout === 'ru') notes.push(reveal ? `в английской раскладке: ${v.typed} → ${chunk.word}` : 'в английской раскладке');
        if (v.layout === 'en') notes.push(reveal ? `в русской раскладке: ${v.typed} → ${chunk.word}` : 'в русской раскладке');
        if (v.translit) notes.push(reveal ? `латиницей: ${chunk.word}` : 'латиницей (транслит)');
        if (v.reversed) notes.push(reveal ? `задом наперёд: ${chunk.word}` : 'задом наперёд');
        if (v.leet) {
          notes.push(reveal
            ? `замены ${v.leet.map(([from, to]) => `${from} → ${to}`).join(', ')}`
            : `замены символов: ${plural(v.leet.length, ['вид', 'вида', 'видов'])}`);
        }
        if (chunk.caseBits) notes.push('заглавные буквы');
        break;
      }
      case 'date': {
        const d = chunk.date;
        title = d.years ? 'Дата' : 'День и месяц';
        if (reveal) notes.push(d.years ? `${pad(d.day)}.${pad(d.month)}.${d.year}` : `${pad(d.day)}.${pad(d.month)}`);
        notes.push(d.years
          ? (d.years === YEARS ? `годы с ${YEAR_FROM} по ${YEAR_TO}` : 'год из двух цифр')
          : '366 вариантов');
        if (d.separator) notes.push('с разделителем');
        break;
      }
      case 'year':
        title = 'Год';
        notes.push(`годы с ${YEAR_FROM} по ${YEAR_TO}: ${plural(YEARS, ['вариант', 'варианта', 'вариантов'])}`);
        break;
      case 'keyboard':
        title = chunk.keyboard === 'keypad' ? 'Дорожка на цифровом блоке' : 'Клавиатурная дорожка';
        notes.push(`${plural(length, ['клавиша', 'клавиши', 'клавиш'])} подряд`);
        notes.push(chunk.turns > 1 ? plural(chunk.turns - 1, ['поворот', 'поворота', 'поворотов']) : 'без поворотов');
        if (chunk.shifted) notes.push('с Shift');
        if (chunk.layout) notes.push('в русской раскладке');
        break;
      case 'repeat': {
        title = 'Повтор';
        const unitLength = Array.from(chunk.unit).length;
        notes.push(reveal
          ? `${quote(chunk.unit)} × ${chunk.count}`
          : `кусок из ${plural(unitLength, ['символа', 'символов', 'символов'])} × ${chunk.count}`);
        break;
      }
      case 'sequence':
        title = 'Последовательность';
        notes.push(`шаг ${chunk.delta > 0 ? '+' : '−'}${Math.abs(chunk.delta)}`);
        notes.push(plural(length, ['символ', 'символа', 'символов']));
        break;
      case 'personal':
        title = 'Личные данные';
        notes.push(reveal ? `${chunk.label.toLowerCase()} «${chunk.shown}»` : chunk.label.toLowerCase());
        if (chunk.how) notes.push(chunk.how);
        if (chunk.caseBits) notes.push('заглавные буквы');
        notes.push(chunk.items > 1 ? `одна из ${plural(chunk.items, ['записи', 'записей', 'записей'])} о вас` : 'единственная запись о вас');
        break;
      case 'phrase':
        title = 'Фраза генератора BastionBit';
        notes.push(`${plural(chunk.words, ['слово', 'слова', 'слов'])} по шаблону`);
        if (chunk.layout) notes.push('в английской раскладке');
        break;
      default:
        title = 'Случайные символы';
        notes.push(`${plural(length, ['символ', 'символа', 'символов'])} из ${nf0.format(chunk.pool)}: ` +
          `${length} · log₂ ${chunk.pool}`);
    }
    return { title, tag, detail: notes.join(', ') };
  }

  // Советы по найденным хитростям — не больше трёх.
  function advice(result) {
    const tips = [];
    const add = (text) => { if (!tips.includes(text)) tips.push(text); };
    const has = (test) => result.chunks.some(test);
    if (has((c) => c.type === 'personal')) {
      add('Имя, даты и клички взломщик, который вас знает, проверит первыми — и латиницей, и в другой раскладке.');
    }
    if (has((c) => c.type === 'dictionary' && c.dictionary === 'passwords')) {
      add('Популярные пароли взломщики проверяют первыми — даже с цифрой или знаком в конце.');
    }
    if (has((c) => c.type === 'dictionary' && c.variant && (c.variant.leet || c.variant.layout || c.variant.translit || c.variant.reversed))) {
      add('Замены вроде @ вместо a, другая раскладка, транслит и запись задом наперёд почти не прибавляют стойкости: взломщик проверяет и их.');
    }
    if (has((c) => c.type === 'dictionary' && c.dictionary !== 'passwords')) {
      add('Одно-два слова угадать легко. Надёжнее фраза из нескольких случайных слов — её даст генератор.');
    }
    if (has((c) => c.type === 'date' || c.type === 'year')) add('Даты и годы легко угадать, особенно если они связаны с вами.');
    if (has((c) => c.type === 'keyboard')) add('Клавиатурные дорожки вроде qwerty и 1qaz2wsx есть во всех словарях взломщиков.');
    if (has((c) => c.type === 'repeat' || c.type === 'sequence')) add('Повторы и последовательности вроде aaaa и 1234 почти не прибавляют стойкости.');
    if (has((c) => c.type === 'phrase')) {
      add('Фразу из генератора надёжнее сделать мастер-фразой в режиме «Из слова»: там каждую попытку взломщика тормозит PBKDF2.');
    }
    if (result.bits < BBEntropy.LEVELS[3].min) add('Самый надёжный вариант — случайный пароль из генератора.');
    return tips.slice(0, 3);
  }

  return {
    MAX_LENGTH, JOIN_BITS, MIN_SHARE, MIN_SAVING, MIN_COVERAGE, MIN_SAVING_COVERED,
    YEAR_FROM, YEAR_TO, KEYBOARDS,
    ready, prepare, analyze, describe, advice, caseBits, walkBits, translit: translitText,
  };
})();
