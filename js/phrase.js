/*
  BastionBit — русская фраза с грамматикой (этап 1.3).

  Шаблон: какой + кто + что сделал + сколько + [какой] + что:
  «Фиолетовый еж продал 47 зеленых чайников».

  Каждое слово выбирается равновероятно из своего словаря (data/words-ru.js)
  криптографическим генератором из js/random.js, число — от 1 до 100.
  Формы слов однозначно определяются выбранными словами и числом, поэтому
  энтропия равна log₂ количества всех возможных фраз:
    H = log₂(A · S · V · 100 · P)        — 5 слов;
    H = log₂(A · S · V · 100 · A · P)    — 6 слов.
*/

const BBPhrase = (() => {
  const NUMBERS = 100;                    // числа от 1 до 100
  const GENDERS = ['m', 'f', 'n'];
  const HUSHING = /[жшчщ]$/;              // шипящие
  const VELAR_OR_HUSHING = /[гкхжшчщ]$/;  // после них пишется «и», а не «ы»

  /* ---------- Словари ---------- */

  const list = (text) => text.trim().split(/\s+/);

  const adjectives = list(BB_WORDS_RU.adjectives);
  const subjects = GENDERS.flatMap((gender) =>
    list(BB_WORDS_RU.subjects[gender]).map((word) => ({ word, gender })));
  const verbs = list(BB_WORDS_RU.verbs).map((item) => {
    const [m, f = m + 'а'] = item.split('/');
    return { m, f, n: f.slice(0, -1) + 'о' };
  });
  const objects = GENDERS.flatMap((gender) =>
    list(BB_WORDS_RU.objects[gender]).map((item) => {
      const [one, few, many] = item.split(',');
      return { gender, one, few, many };
    }));

  const SIZES = {
    adjectives: adjectives.length,
    subjects: subjects.length,
    verbs: verbs.length,
    numbers: NUMBERS,
    objects: objects.length,
  };

  /* ---------- Грамматика ---------- */

  // Форма существительного после числа: 1 чайник, 2 чайника, 5 чайников.
  // 11–14 — исключение: 11 чайников, хотя 1 чайник.
  function countForm(n) {
    const lastTwo = n % 100;
    const last = n % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return 'many';
    if (last === 1) return 'one';
    if (last >= 2 && last <= 4) return 'few';
    return 'many';
  }

  // Формы прилагательного по мужскому роду: синий → синяя, синее, синюю, синие, синих.
  function adjectiveForms(m) {
    const stem = m.slice(0, -2);
    const soft = m.endsWith('ий');
    if (soft && !VELAR_OR_HUSHING.test(stem)) {
      return { m, f: stem + 'яя', n: stem + 'ее', fAcc: stem + 'юю', pl: stem + 'ие', plGen: stem + 'их' };
    }
    const i = VELAR_OR_HUSHING.test(stem);  // русские, хорошие — но голубые
    return {
      m,
      f: stem + 'ая',
      n: stem + (soft && HUSHING.test(stem) ? 'ее' : 'ое'),
      fAcc: stem + 'ую',
      pl: stem + (i ? 'ие' : 'ые'),
      plGen: stem + (i ? 'их' : 'ых'),
    };
  }

  // Прилагательное при предмете после числа:
  // 1 зеленый чайник / зеленую книгу / зеленое окно, 2 зеленых чайника,
  // но 2 зеленые книги, 5 зеленых чайников.
  function objectAdjective(forms, gender, form) {
    if (form === 'one') return gender === 'm' ? forms.m : gender === 'f' ? forms.fAcc : forms.n;
    if (form === 'few' && gender === 'f') return forms.pl;
    return forms.plGen;
  }

  const plainE = (text) => text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');

  /* ---------- Генерация ---------- */

  function generate({ words = 6 } = {}, rng = BBRandom) {
    const adjective = adjectiveForms(rng.pick(adjectives));
    const subject = rng.pick(subjects);
    const verb = rng.pick(verbs);
    const number = rng.randomInt(NUMBERS) + 1;
    const object = rng.pick(objects);
    const form = countForm(number);

    const parts = [
      { role: 'какой', text: adjective[subject.gender] },
      { role: 'кто', text: subject.word },
      { role: 'что сделал', text: verb[subject.gender] },
      { role: 'сколько', text: String(number) },
    ];
    if (words === 6) {
      const second = adjectiveForms(rng.pick(adjectives));
      parts.push({ role: 'какой', text: objectAdjective(second, object.gender, form) });
    }
    parts.push({ role: 'что', text: object[form] });

    // Буква ё пишется как е: так фразу проще набрать на любой клавиатуре
    parts.forEach((part) => { part.text = plainE(part.text); });
    parts[0].text = parts[0].text[0].toUpperCase() + parts[0].text.slice(1);

    const text = parts.map((part) => part.text).join(' ');
    return { parts, text, layout: toEnglishLayout(text), words };
  }

  /* ---------- Стойкость ---------- */

  // Сколько слов в каждом словаре и сколько бит даёт каждое место фразы
  function breakdown(words = 6) {
    const rows = [
      { role: 'Какой', count: SIZES.adjectives, unit: 'word' },
      { role: 'Кто', count: SIZES.subjects, unit: 'word' },
      { role: 'Что сделал', count: SIZES.verbs, unit: 'word' },
      { role: 'Сколько', count: SIZES.numbers, unit: 'number' },
    ];
    if (words === 6) rows.push({ role: 'Какой', count: SIZES.adjectives, unit: 'word' });
    rows.push({ role: 'Что', count: SIZES.objects, unit: 'word' });
    return rows.map((row) => ({ ...row, bits: Math.log2(row.count) }));
  }

  function bits(words = 6) {
    return breakdown(words).reduce((sum, row) => sum + row.bits, 0);
  }

  /* ---------- Английская раскладка ---------- */

  // Те же клавиши на раскладке ЙЦУКЕН и QWERTY
  const RU = 'йцукенгшщзхъфывапролджэячсмитьбюёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮЁ';
  const EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`QWERTYUIOP{}ASDFGHJKL:"ZXCVBNM<>~';

  function convert(text, from, to) {
    return Array.from(text, (ch) => {
      const i = from.indexOf(ch);
      return i >= 0 ? to[i] : ch;
    }).join('');
  }

  const toEnglishLayout = (text) => convert(plainE(text), RU, EN);
  const fromEnglishLayout = (text) => convert(text, EN, RU);

  /* ---------- Узнать фразу BastionBit ---------- */

  // Взломщик знает шаблон и словари, поэтому для фразы, собранной по
  // шаблону, честная стойкость — log₂ числа всех фраз, а не оценка по буквам.
  let index = null;

  function buildIndex() {
    const norm = (word) => plainE(word.toLowerCase());
    const set = (items) => new Set(items.map(norm));
    const adjForms = adjectives.map(adjectiveForms);
    return {
      first: set(adjForms.flatMap((a) => [a.m, a.f, a.n])),
      second: set(adjForms.flatMap((a) => [a.m, a.n, a.fAcc, a.pl, a.plGen])),
      subjects: set(subjects.map((s) => s.word)),
      verbs: set(verbs.flatMap((v) => [v.m, v.f, v.n])),
      objects: set(objects.flatMap((o) => [o.one, o.few, o.many])),
    };
  }

  // Если текст начинается с фразы BastionBit, возвращает её стойкость,
  // то, что осталось после неё (например, дописанное своё слово),
  // набрана ли она в английской раскладке и где в тексте она кончается (end).
  function recognize(text) {
    index = index || buildIndex();
    const source = String(text);
    const offset = source.length - source.trimStart().length;
    let value = source.trim();
    const layout = !/[а-яё]/i.test(value);   // набрано в английской раскладке
    if (layout) value = fromEnglishLayout(value);
    const normalized = plainE(value.toLowerCase());
    const found = Array.from(normalized.matchAll(/[а-я]+|\d+|[^\sа-я\d]+/g));
    const t = found.map((match) => match[0]);
    const number = Number(t[3]);
    const start = t.length >= 5 && index.first.has(t[0]) && index.subjects.has(t[1])
      && index.verbs.has(t[2]) && /^\d{1,3}$/.test(t[3]) && number >= 1 && number <= NUMBERS;
    if (!start) return null;
    for (const words of [6, 5]) {
      if (t.length >= words && (words === 5 || index.second.has(t[4])) && index.objects.has(t[words - 1])) {
        const last = found[words - 1];
        // Позиция совпадает с исходным текстом, если длина строки не менялась
        const end = normalized.length === value.length ? offset + last.index + last[0].length : null;
        return { words, bits: bits(words), rest: t.slice(words).join(' '), layout, end };
      }
    }
    return null;
  }

  return {
    NUMBERS, SIZES,
    countForm, adjectiveForms, objectAdjective,
    generate, breakdown, bits,
    toEnglishLayout, fromEnglishLayout, recognize,
  };
})();
