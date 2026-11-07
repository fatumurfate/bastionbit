'use strict';

/* BastionBit — ментальное правило и устойчивость к утечке (этап 4).

   Многие придумывают «систему»: одна запоминающаяся основа и метка
   от названия сайта. Пароли на всех сайтах разные, но связаны правилом:
        «Фиолетовая лиса 47» + vk.com  →  Abjktnjdfzkbcf47!WL2

   Основа — прилагательное и существительное из словарей фраз и число
   от 10 до 99, набранные в английской раскладке без пробела:
   «Фиолетовая лиса 47» → Abjktnjdfzkbcf47. Вариантов основы
        A · S · 90 = 622 · 645 · 90 ≈ 3,6·10⁷   (25,1 бита).

   Метка зависит от названия сайта (vk.com → vk):
        какие буквы взять    первую, первые 2, первые 3, последнюю,
                             последние 2, первую и последнюю — 6 способов
        регистр              2 для одной буквы, 3 для нескольких
        сдвиг по алфавиту    0, +1, +2, +3, −1
        число в конце        нет, длина названия, число гласных a e i o u
        порядок              основа + метка или метка + основа
        разделитель          ! @ # $ % & * +
   Всего (2 · 2 + 4 · 3) · 5 · 3 · 2 · 8 = 3840 правил (11,9 бита).

   Взломщик знает, как устроены такие правила (принцип Керкгоффса:
   секретом может быть только выбор, а не способ). Утечка одного пароля
   открывает ему основу и отсекает правила, которые дали бы другую
   метку. Для следующего сайта остаётся перебрать только пароли
   оставшихся правил:
        Hₖ = log₂ (число разных паролей следующего сайта
                   у правил, согласных с k утечками). */

const BBRule = (() => {
  const NUMBER_FROM = 10;
  const NUMBER_COUNT = 90;                      // числа от 10 до 99
  const SEPARATORS = ['!', '@', '#', '$', '%', '&', '*', '+'];
  const VOWELS = /[aeiou]/g;

  const SELECTIONS = [
    { id: 'first1', single: true, pick: (n) => n.slice(0, 1), text: 'первую букву', short: 'первая буква' },
    { id: 'first2', pick: (n) => n.slice(0, 2), text: 'первые две буквы', short: 'первые 2 буквы' },
    { id: 'first3', pick: (n) => n.slice(0, 3), text: 'первые три буквы', short: 'первые 3 буквы' },
    { id: 'last1', single: true, pick: (n) => n.slice(-1), text: 'последнюю букву', short: 'последняя буква' },
    { id: 'last2', pick: (n) => n.slice(-2), text: 'последние две буквы', short: 'последние 2 буквы' },
    { id: 'edges', pick: (n) => (n.length > 1 ? n[0] + n[n.length - 1] : n), text: 'первую и последнюю буквы', short: 'первая и последняя' },
  ];
  const SHIFTS = [0, 1, 2, 3, -1];
  const NUMBERS = ['none', 'length', 'vowels'];
  const ORDERS = ['core', 'tag'];

  // Все 3840 правил. Номер правила — его место в этом списке.
  const STRUCTURES = [];
  SELECTIONS.forEach((selection) => {
    const cases = selection.single ? ['lower', 'upper'] : ['lower', 'first', 'upper'];
    for (const letterCase of cases) {
      for (const shift of SHIFTS) {
        for (const number of NUMBERS) {
          for (const order of ORDERS) {
            for (const separator of SEPARATORS) {
              STRUCTURES.push({ selection, letterCase, shift, number, order, separator });
            }
          }
        }
      }
    }
  });

  const CORE_COUNT = BBPhrase.SIZES.adjectives * BBPhrase.SIZES.subjects * NUMBER_COUNT;
  const CORE_BITS = Math.log2(CORE_COUNT);
  const STRUCTURE_BITS = Math.log2(STRUCTURES.length);
  const TOTAL_BITS = CORE_BITS + STRUCTURE_BITS;

  /* ---------- Название сайта ---------- */

  // Домены вида bbc.co.uk и site.msk.ru: название — уровнем выше.
  const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'msk', 'spb']);

  // «https://www.Mail.yandex.ru/inbox» → «yandex», «госуслуги.рф» → «gosuslugi».
  // Остаются только латинские буквы.
  function siteName(value) {
    const labels = BBKeyword.normalizeSite(value).split('.').filter(Boolean);
    let label = labels.length > 1 ? labels[labels.length - 2] : (labels[0] || '');
    if (labels.length > 2 && SECOND_LEVEL.has(label)) label = labels[labels.length - 3];
    return BBPatterns.translit(label).replace(/[^a-z]/g, '');
  }

  /* ---------- Метка и пароль ---------- */

  const shiftLetter = (ch, k) => String.fromCharCode(97 + ((((ch.charCodeAt(0) - 97 + k) % 26) + 26) % 26));

  function applyCase(text, letterCase) {
    if (letterCase === 'upper') return text.toUpperCase();
    if (letterCase === 'first') return text.charAt(0).toUpperCase() + text.slice(1);
    return text;
  }

  function numberFor(mode, name) {
    if (mode === 'length') return String(name.length);
    if (mode === 'vowels') return String((name.match(VOWELS) || []).length);
    return '';
  }

  // Метка по шагам: буквы → сдвиг → регистр → число.
  function tagSteps(structure, name) {
    const picked = structure.selection.pick(name);
    const shifted = Array.from(picked, (ch) => shiftLetter(ch, structure.shift)).join('');
    const cased = applyCase(shifted, structure.letterCase);
    return { picked, shifted, cased, tag: cased + numberFor(structure.number, name) };
  }

  const tagFor = (structure, name) => tagSteps(structure, name).tag;

  function assemble(structure, core, name) {
    const tag = tagFor(structure, name);
    return structure.order === 'core' ? core + structure.separator + tag : tag + structure.separator + core;
  }

  // Основа — буквы (без цифр и разделителей) и число от 10 до 99 в конце.
  const CORE = /^[^\d!@#$%&*+]{2,}[1-9]\d$/;

  /* ---------- Случайное правило ---------- */

  function random(rng = BBRandom) {
    const phrase = BBPhrase.generate({ words: 5 }, rng);
    const adjective = phrase.parts[0].text;           // уже с заглавной буквы
    const subject = phrase.parts[1].text;
    const number = NUMBER_FROM + rng.randomInt(NUMBER_COUNT);
    return {
      words: `${adjective} ${subject} ${number}`,
      core: BBPhrase.toEnglishLayout(adjective + subject) + number,
      structure: rng.randomInt(STRUCTURES.length),
    };
  }

  const password = (rule, name) => assemble(STRUCTURES[rule.structure], rule.core, name);

  /* ---------- Как объяснить правило ---------- */

  function shiftText(structure) {
    const k = structure.shift;
    const what = structure.selection.single ? 'букву' : 'каждую букву';
    if (k > 0) return `Сдвиньте ${what} на ${k} вперёд по алфавиту: a → ${shiftLetter('a', k)}, z → ${shiftLetter('z', k)}`;
    return `Сдвиньте ${what} на ${-k} назад по алфавиту: b → ${shiftLetter('b', k)}, a → ${shiftLetter('a', k)}`;
  }

  function caseText(structure) {
    if (structure.letterCase === 'upper') return structure.selection.single ? 'Сделайте букву заглавной' : 'Сделайте все буквы заглавными';
    if (structure.letterCase === 'first') return 'Сделайте первую букву заглавной';
    return '';
  }

  // Шаги правила для экрана. Шаг — список кусков: { text } — обычный
  // текст, { code } — то, что набирают на клавиатуре.
  function describe(rule) {
    const s = STRUCTURES[rule.structure];
    const steps = [
      [{ text: `Основа — «${rule.words}» в английской раскладке без пробела: ` }, { code: rule.core }],
      [{ text: `Метка: возьмите ${s.selection.text} названия сайта` }],
    ];
    if (s.shift) steps.push([{ text: shiftText(s) }]);
    const letterCase = caseText(s);
    if (letterCase) steps.push([{ text: letterCase }]);
    if (s.number === 'length') steps.push([{ text: 'Допишите, сколько букв в названии' }]);
    if (s.number === 'vowels') steps.push([{ text: 'Допишите, сколько в названии гласных a, e, i, o, u' }]);
    steps.push(s.order === 'core'
      ? [{ text: 'Пароль — основа, знак ' }, { code: s.separator }, { text: ' и метка' }]
      : [{ text: 'Пароль — метка, знак ' }, { code: s.separator }, { text: ' и основа' }]);
    return steps;
  }

  // Как получается метка для сайта: цепочка «значение — что сделали».
  function explain(rule, name) {
    const s = STRUCTURES[rule.structure];
    const t = tagSteps(s, name);
    const chain = [{ value: name, label: 'название' }, { value: t.picked, label: s.selection.short }];
    if (s.shift) chain.push({ value: t.shifted, label: `сдвиг ${s.shift > 0 ? '+' : '−'}${Math.abs(s.shift)}` });
    if (t.cased !== t.shifted) chain.push({ value: t.cased, label: s.letterCase === 'first' ? 'первая заглавная' : 'заглавные' });
    if (s.number !== 'none') chain.push({ value: t.tag, label: s.number === 'length' ? '+ длина' : '+ гласные' });
    return { chain, tag: t.tag, order: s.order, separator: s.separator, core: rule.core, password: password(rule, name) };
  }

  /* ---------- Утечки ---------- */

  // Сколько разных паролей дают все правила для этого названия
  // (у короткого названия часть правил совпадает: vk — и первые, и последние 2 буквы).
  function templates(name) {
    const seen = new Set();
    for (const s of STRUCTURES) seen.add(`${s.order}${s.separator}${tagFor(s, name)}`);
    return seen.size;
  }

  const bitsWithoutLeaks = (name) => Math.log2(CORE_COUNT * templates(name));

  // Правила (с основой), которые для сайта name дали бы именно этот пароль.
  function consistent(leaked, name) {
    const found = [];
    STRUCTURES.forEach((s, index) => {
      const tag = tagFor(s, name);
      let core = null;
      if (s.order === 'core' && leaked.endsWith(s.separator + tag)) core = leaked.slice(0, leaked.length - tag.length - 1);
      if (s.order === 'tag' && leaked.startsWith(tag + s.separator)) core = leaked.slice(tag.length + 1);
      if (core !== null && CORE.test(core)) found.push({ structure: index, core });
    });
    return found;
  }

  function predictions(candidates, name) {
    return [...new Set(candidates.map((c) => assemble(STRUCTURES[c.structure], c.core, name)))];
  }

  // Утечки по порядку: перед каждой — сколько вариантов пароля следующего
  // сайта остаётся взломщику. names — уже готовые названия сайтов.
  function leaks(rule, names) {
    const passwords = names.map((name) => password(rule, name));
    const steps = [];
    let candidates = null;          // null — утечек ещё не было
    let revealedAt = null;
    names.forEach((name, k) => {
      const target = passwords[k];
      if (!candidates) {
        const variants = CORE_COUNT * templates(name);
        steps.push({ leaked: 0, site: name, password: target, variants, bits: Math.log2(variants), guesses: null, rules: STRUCTURES.length });
      } else {
        const guesses = predictions(candidates, name);
        steps.push({
          leaked: k, site: name, password: target, variants: guesses.length, bits: Math.log2(guesses.length),
          guesses, rank: guesses.indexOf(target) + 1, rules: candidates.length,
        });
      }
      candidates = candidates ? candidates.filter((c) => assemble(STRUCTURES[c.structure], c.core, name) === target) : consistent(target, name);
      if (revealedAt === null && candidates.length === 1) revealedAt = k + 1;
    });
    return { names, passwords, steps, revealedAt, remaining: candidates ? candidates.length : STRUCTURES.length };
  }

  return {
    SEPARATORS, SELECTIONS, SHIFTS, NUMBERS, ORDERS, STRUCTURES,
    NUMBER_FROM, NUMBER_COUNT, CORE_COUNT, CORE_BITS, STRUCTURE_BITS, TOTAL_BITS,
    siteName, tagFor, assemble, random, password, describe, explain,
    templates, bitsWithoutLeaks, consistent, predictions, leaks,
  };
})();
