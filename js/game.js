'use strict';

/* BastionBit — игра «Взломай сам» (этап 3).

   Игрок — взломщик. Четыре уровня, попыток мало — как на настоящем сайте.
   Каждый уровень показывает одну мысль из теории:

   1. Популярный пароль: 20 вариантов, log₂ 20 ≈ 4,3 бита. Программа,
      которая перебирает пароли по популярности, находит его за пару
      десятков попыток.
   2. PIN-код с подсказками «больше» и «меньше». Каждая подсказка
      отсекает половину вариантов — это ровно 1 бит. 10 000 вариантов —
      13,3 бита, поэтому хватает ⌈log₂ 10 000⌉ = 14 попыток.
   3. Пароль из личных данных. Формула даёт ему больше 30 бит, а взломщику,
      который читал страницу владельца, хватает 22 вариантов (4,5 бита).
   4. Случайный пароль из 8 символов: ≈ 2⁵² вариантов, угадать нельзя.

   Подсказки после неудачных попыток — тоже информация: каждая сокращает
   число вариантов N и отнимает log₂(N до / N после) бит.

   Загаданное выбирается через BBRandom, то есть crypto.getRandomValues. */

const BBGame = (() => {
  const plural = (n, forms) => BBEntropy.plural(n, forms);
  const pad = (n, size) => String(n).padStart(size, '0');

  /* ---------- 1. Популярный пароль ---------- */

  // Первые 21 пароль из data/top-passwords.js (база Xato на 10 млн паролей).
  // «696969» в игру не берём. Место в списке — номер попытки, на которой
  // пароль нашла бы программа, перебирающая пароли по популярности.
  const XATO_TOP = ['123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111',
    '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein', '696969',
    'shadow', 'master', '666666', 'qwertyuiop'];
  const POPULAR = XATO_TOP.filter((p) => p !== '696969');

  const kindOf = (text) => (/^\d+$/.test(text) ? 'digits' : /^[a-z]+$/.test(text) ? 'letters' : 'mixed');
  const KIND_TEXT = {
    digits: 'в нём только цифры',
    letters: 'в нём только буквы',
    mixed: 'в нём есть и буквы, и цифры',
  };

  function popular(rng) {
    const secret = rng.pick(POPULAR);
    const length = secret.length;
    return {
      secret,
      candidates: POPULAR.map((text) => ({ text })),
      hints: [
        { after: 3, text: KIND_TEXT[kindOf(secret)], test: (c) => kindOf(c.text) === kindOf(secret) },
        { after: 6, text: `в нём ${length} ${plural(length, ['символ', 'символа', 'символов'])}`,
          test: (c) => c.text.length === length },
      ],
      machine: { attempts: XATO_TOP.indexOf(secret) + 1, list: XATO_TOP },
    };
  }

  /* ---------- 2. PIN-код ---------- */

  const PIN_TOTAL = 10000;

  function pin(rng) {
    const secret = pad(rng.randomInt(PIN_TOTAL), 4);
    return { secret, lo: 0, hi: PIN_TOTAL - 1, hints: [], machine: { attempts: Number(secret) + 1 } };
  }

  /* ---------- 3. Личные данные ---------- */

  // Имена, клички и команды пишутся латиницей одним способом — без «я», «й», «х».
  const PEOPLE = [
    ['Маша', 'masha', true], ['Даша', 'dasha', true], ['Лиза', 'liza', true], ['Вика', 'vika', true],
    ['Полина', 'polina', true], ['Алина', 'alina', true], ['Лена', 'lena', true], ['Марина', 'marina', true],
    ['Вера', 'vera', true], ['Кира', 'kira', true], ['Дима', 'dima', false], ['Миша', 'misha', false],
    ['Паша', 'pasha', false], ['Никита', 'nikita', false], ['Рома', 'roma', false], ['Денис', 'denis', false],
    ['Кирилл', 'kirill', false], ['Антон', 'anton', false], ['Глеб', 'gleb', false], ['Олег', 'oleg', false],
  ].map(([name, latin, female]) => ({ name, latin, female }));
  const PETS = [
    ['Кот', 'Барсик', 'barsik'], ['Кошка', 'Мурка', 'murka'], ['Пёс', 'Шарик', 'sharik'],
    ['Кот', 'Персик', 'persik'], ['Пёс', 'Тузик', 'tuzik'], ['Попугай', 'Кеша', 'kesha'],
    ['Кот', 'Пушок', 'pushok'], ['Хомяк', 'Пончик', 'ponchik'], ['Кот', 'Симба', 'simba'],
    ['Пёс', 'Граф', 'graf'], ['Кошка', 'Сима', 'sima'], ['Кот', 'Марсик', 'marsik'],
    ['Кошка', 'Луна', 'luna'], ['Пёс', 'Лорд', 'lord'],
  ].map(([animal, name, latin]) => ({ animal, name, latin }));
  const TEAMS = [
    ['Спартак', 'spartak'], ['Зенит', 'zenit'], ['Динамо', 'dinamo'], ['Локомотив', 'lokomotiv'],
    ['ЦСКА', 'cska'], ['Рубин', 'rubin'], ['Ростов', 'rostov'], ['Краснодар', 'krasnodar'],
  ].map(([name, latin]) => ({ name, latin }));
  const CITIES = [
    ['в Красноярске', 'krasnoyarsk'], ['в Москве', 'moskva'], ['в Омске', 'omsk'], ['в Томске', 'tomsk'],
    ['в Самаре', 'samara'], ['в Сочи', 'sochi'], ['в Туле', 'tula'], ['в Уфе', 'ufa'],
  ].map(([where, latin]) => ({ where, latin }));
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const TOKENS = ['pet', 'name', 'team', 'city'];
  const SUFFIXES = ['year', 'ddmm', '123', 'yy', 'none'];
  // Так часто собирают пароли из личных данных; загаданный — один из этих шаблонов.
  const TEMPLATES = [['pet', 'year'], ['name', 'year'], ['pet', 'ddmm'], ['name', 'ddmm'],
    ['team', 'year'], ['pet', '123'], ['name', '123'], [null, 'date']];
  const TOKEN_HINT = {
    pet: 'в пароле есть кличка питомца',
    name: 'в пароле есть имя',
    team: 'в пароле есть любимая команда',
    null: 'в пароле только цифры',
  };
  const SUFFIX_HINT = {
    year: 'после слова — год рождения',
    ddmm: 'после слова — день и месяц рождения',
    123: 'после слова — 123',
    date: 'это дата рождения: день, месяц и год',
  };

  function person(rng) {
    const who = rng.pick(PEOPLE);
    const pet = rng.pick(PETS);
    const team = rng.pick(TEAMS);
    const city = rng.pick(CITIES);
    const year = 1995 + rng.randomInt(18);   // 1995–2012
    const month = 1 + rng.randomInt(12);
    const day = 1 + rng.randomInt(28);
    const ddmm = pad(day, 2) + pad(month, 2);
    const yy = pad(year % 100, 2);
    const words = { pet: pet.latin, name: who.latin, team: team.latin, city: city.latin };
    const endings = { year: String(year), ddmm, 123: '123', yy, none: '' };

    // Список программы-взломщика: слово + окончание, потом даты целиком.
    const candidates = [];
    SUFFIXES.forEach((suffix) => TOKENS.forEach((token) => {
      candidates.push({ text: words[token] + endings[suffix], token, suffix });
    }));
    candidates.push({ text: ddmm + year, token: null, suffix: 'date' });
    candidates.push({ text: ddmm + yy, token: null, suffix: 'date6' });

    return {
      profile: {
        name: who.name, female: who.female, pet, team: team.name, city: city.where,
        birthday: `${day} ${MONTHS[month - 1]} ${year} года`,
      },
      candidates,
    };
  }

  function personal(rng) {
    let data;
    // Совпадения вроде «2010» = 20 октября и 2010 год путают подсказки — выбираем заново.
    do data = person(rng);
    while (new Set(data.candidates.map((c) => c.text)).size !== data.candidates.length);
    const [token, suffix] = rng.pick(TEMPLATES);
    const index = data.candidates.findIndex((c) => c.token === token && c.suffix === suffix);
    const target = data.candidates[index];
    return {
      secret: target.text,
      profile: data.profile,
      candidates: data.candidates,
      hints: [
        { after: 3, text: TOKEN_HINT[token], test: (c) => c.token === token },
        { after: 6, text: SUFFIX_HINT[suffix], test: (c) => c.suffix === suffix },
      ],
      machine: { attempts: index + 1, list: data.candidates.map((c) => c.text) },
    };
  }

  /* ---------- 4. Случайный пароль ---------- */

  const RANDOM_OPTIONS = { length: 8, lower: true, upper: true, digits: true, symbols: true, avoidSimilar: false };

  function random(rng) {
    const bits = BBGenerator.exactEntropy(RANDOM_OPTIONS).bits;
    return { secret: BBGenerator.generate(RANDOM_OPTIONS, rng), bits, hints: [], machine: { bits } };
  }

  /* ---------- Уровни ---------- */

  const latinOnly = (text) => {
    if (!text) return 'Введите догадку';
    if (/[а-яё]/i.test(text)) return 'Пароль набран латиницей: «барсик» — это barsik. Попытка не засчитана';
    if (/\s/.test(text)) return 'В пароле нет пробелов — попытка не засчитана';
    return '';
  };

  const LEVELS = [
    { id: 'popular', title: 'Популярный пароль', short: 'Популярный', attempts: 10, create: popular,
      normalize: (text) => text.trim().toLowerCase(), problem: (text) => (text ? '' : 'Введите догадку') },
    { id: 'pin', title: 'PIN-код', short: 'PIN-код', attempts: 14, create: pin,
      normalize: (text) => text.trim(),
      problem: (text) => (/^\d{4}$/.test(text) ? '' : 'PIN-код — это 4 цифры, например 0420') },
    { id: 'personal', title: 'Личные данные', short: 'Личные данные', attempts: 10, create: personal,
      normalize: (text) => text.trim().toLowerCase(), problem: latinOnly },
    { id: 'random', title: 'Случайный пароль', short: 'Случайный', attempts: 10, create: random,
      normalize: (text) => text.trim(),
      problem: (text) => (!text ? 'Введите догадку'
        : Array.from(text).length !== RANDOM_OPTIONS.length ? 'В этом пароле ровно 8 символов — попытка не засчитана' : '') },
  ];
  const byId = Object.fromEntries(LEVELS.map((level) => [level.id, level]));

  function start(id, rng = BBRandom) {
    const level = byId[id];
    const data = level.create(rng);
    const state = {
      id, index: LEVELS.indexOf(level), title: level.title, maxAttempts: level.attempts,
      used: 0, guesses: [], tried: new Set(), shown: [], done: false, solved: false, gaveUp: false,
      ...data,
    };
    state.total = variants(state);
    return state;
  }

  // Сколько вариантов осталось с учётом ответов и подсказок.
  function variants(state) {
    if (state.solved) return 1;   // пароль найден — других вариантов нет
    if (state.id === 'pin') return state.hi - state.lo + 1;
    if (state.id === 'random') return 2 ** state.bits - state.guesses.filter((g) => g.verdict === 'wrong').length;
    return state.candidates.filter((c) => !state.tried.has(c.text) && state.shown.every((h) => h.test(c))).length;
  }

  // status: invalid или repeat — попытка не засчитана; wrong, higher, lower, correct — засчитана.
  function guess(state, raw) {
    if (state.done) return { status: 'done' };
    const level = byId[state.id];
    const text = level.normalize(String(raw ?? ''));
    const problem = level.problem(text);
    if (problem) return { status: 'invalid', message: problem };
    if (state.tried.has(text)) return { status: 'repeat', message: 'Этот вариант вы уже пробовали' };

    state.tried.add(text);
    state.used += 1;
    let verdict = 'wrong';
    if (text === state.secret) {
      verdict = 'correct';
    } else if (state.id === 'pin') {
      const value = Number(text);
      if (Number(state.secret) > value) {
        verdict = 'higher';
        state.lo = Math.max(state.lo, value + 1);
      } else {
        verdict = 'lower';
        state.hi = Math.min(state.hi, value - 1);
      }
    }
    state.guesses.push({ text, verdict });

    let hint = null;
    if (verdict === 'correct') {
      state.done = true;
      state.solved = true;
    } else {
      const next = state.hints.find((h) => h.after === state.used);
      if (next) {
        const before = variants(state);
        state.shown.push(next);
        hint = { text: next.text, before, after: variants(state) };
      }
      if (state.used >= state.maxAttempts) state.done = true;
    }
    return { status: verdict, text, hint, left: variants(state) };
  }

  function giveUp(state) {
    if (state.done) return;
    state.done = true;
    state.gaveUp = true;
  }

  return { LEVELS, XATO_TOP, POPULAR, PIN_TOTAL, RANDOM_OPTIONS, TEMPLATES, start, guess, giveUp, variants };
})();
