'use strict';

/* BastionBit — личные данные в анализаторе (этап 4).

   Взломщик, который вас знает, первым делом пробует имя, фамилию, дату
   рождения, кличку питомца и город — и не только как есть, но и латиницей,
   в другой раскладке и задом наперёд. Этот модуль превращает то, что вы
   указали, в список форм, а детектор (js/patterns.js) ищет их в пароле.

   Цена найденного куска:
        H = log₂ K + форма + регистр,
   где K — сколько записей о вас указано (имя, дата, кличка… — каждая
   отдельно). Форма слова: как есть — 0 бит, латиницей, в другой раскладке
   или задом наперёд — +1 бит, как у слов из словаря. Дату пишут по-разному
   (15052008, 15.05.08, 2008…), поэтому форма даты стоит log₂ F, где F —
   число вариантов записи.

   Данные живут только в памяти открытой страницы: их не сохраняем
   и никуда не отправляем. */

const BBPersonal = (() => {
  const FIELDS = [
    { id: 'name', label: 'Имя' },
    { id: 'surname', label: 'Фамилия' },
    { id: 'birth', label: 'Дата рождения', date: true },
    { id: 'pet', label: 'Кличка питомца' },
    { id: 'city', label: 'Город' },
    { id: 'other', label: 'Другое', list: true },
  ];
  const MIN_LENGTH = 3;          // записи короче трёх символов не ищем
  const MAX_ITEMS = 24;
  const MAX_TRANSLIT = 16;       // вариантов транслита на одно слово
  const log2 = Math.log2;

  /* ---------- Транслит: Марковицкий → markovitskiy, markovickij… ---------- */

  const BASE = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e',
    ю: 'yu', я: 'ya',
  };
  // Первый вариант — самый частый.
  const OPTIONS = {
    ё: ['e', 'yo'], ж: ['zh', 'j'], й: ['y', 'i', 'j'], х: ['h', 'kh', 'x'], ц: ['ts', 'c', 'tz'],
    щ: ['sch', 'shch', 'sh'], ы: ['y', 'i'], ю: ['yu', 'iu', 'ju'], я: ['ya', 'ia', 'ja'],
  };

  // Слово → список «звуков», у каждого свои варианты записи.
  function units(word) {
    const chars = Array.from(word);
    const list = [];
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k];
      const next = chars[k + 1];
      if (ch === 'к' && next === 'с') {                                    // Ксения → xenia
        list.push(['ks', 'x']);
        k++;
      } else if (ch === 'и' && next === 'я') {                             // Мария → maria, mariya
        list.push(['iya', 'ia', 'iia', 'ija']);
        k++;
      } else if ((ch === 'и' || ch === 'ы') && next === 'й' && k + 2 === chars.length) {
        list.push(ch === 'и' ? ['iy', 'y', 'ij', 'ii'] : ['y', 'iy', 'yj']);   // Дмитрий, Красный
        k++;
      } else if (ch === 'е' && (k === 0 || /[аеёиоуыэюяъь]/.test(chars[k - 1]))) {
        list.push(['e', 'ye']);                                            // Елена → yelena
      } else {
        list.push(OPTIONS[ch] || [BASE[ch] ?? ch]);
      }
    }
    return list;
  }

  function translitVariants(word) {
    let variants = [''];
    for (const options of units(word)) {
      const next = [];
      for (const start of variants) {
        for (const option of options) next.push(start + option);
      }
      variants = next.slice(0, MAX_TRANSLIT);
    }
    return [...new Set(variants)];
  }

  /* ---------- Формы записи ---------- */

  const reverse = (text) => Array.from(text).reverse().join('');
  const plainE = (text) => text.replace(/ё/g, 'е');

  function wordForms(value) {
    const lower = plainE(value.toLowerCase());
    const forms = new Map();
    const add = (text, extra, how) => {
      if (Array.from(text).length < MIN_LENGTH) return;
      const known = forms.get(text);
      if (!known || known.extra > extra) forms.set(text, { text, extra, how });
    };
    add(lower, 0, '');
    const cyrillic = /[а-яё]/.test(value.toLowerCase());
    const latin = /[a-z]/.test(lower);
    if (cyrillic) {
      const variants = translitVariants(value.toLowerCase());
      variants.forEach((latinText) => add(latinText, 1, 'латиницей'));
      add(BBPhrase.toEnglishLayout(lower), 1, 'в английской раскладке');
      add(reverse(variants[0]), 2, 'латиницей задом наперёд');
    }
    if (latin) add(BBPhrase.fromEnglishLayout(lower), 1, 'в русской раскладке');
    add(reverse(lower), 1, 'задом наперёд');
    return [...forms.values()];
  }

  // Дата из поля type="date" (ГГГГ-ММ-ДД) → все привычные записи.
  function dateForms(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (!match) return null;
    const [, y4, m2, d2] = match;
    const y2 = y4.slice(2);
    const d = String(Number(d2));
    const m = String(Number(m2));
    const list = [
      [d2 + m2 + y4, 'ДДММГГГГ'], [d2 + m2 + y2, 'ДДММГГ'], [d2 + m2, 'ДДММ'], [y4, 'ГГГГ'],
      [y4 + m2 + d2, 'ГГГГММДД'], [`${d2}.${m2}.${y4}`, 'ДД.ММ.ГГГГ'], [`${d2}.${m2}.${y2}`, 'ДД.ММ.ГГ'],
      [`${d2}-${m2}-${y4}`, 'ДД-ММ-ГГГГ'], [`${d2}/${m2}/${y4}`, 'ДД/ММ/ГГГГ'],
      [d + m + y4, 'ДМГГГГ'], [d + m + y2, 'ДМГГ'], [`${d}.${m}.${y4}`, 'Д.М.ГГГГ'],
    ];
    const forms = new Map();
    for (const [text, format] of list) {
      if (text.length >= 4 && !forms.has(text)) forms.set(text, { text, extra: 0, how: `в виде ${format}` });
    }
    return [...forms.values()];
  }

  function formatDate(value) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }

  /* ---------- Набор для детектора ---------- */

  // Значения полей → { size: K, itemBits, items, inputs }.
  // inputs — те же данные для zxcvbn (её «пользовательский словарь»).
  function prepare(values = {}) {
    const items = [];
    const seen = new Set();
    for (const field of FIELDS) {
      const raw = String(values[field.id] ?? '').normalize('NFC').trim();
      if (!raw) continue;
      if (field.date) {
        const forms = dateForms(raw);
        if (forms && !seen.has(raw)) {
          seen.add(raw);
          items.push({ field: field.id, label: field.label, shown: formatDate(raw), kind: 'date', forms, formBits: log2(forms.length) });
        }
        continue;
      }
      const words = raw.split(field.list ? /[,;\s]+/ : /\s+/);
      for (const word of words) {
        const clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        const key = plainE(clean.toLowerCase());
        if (Array.from(clean).length < MIN_LENGTH || seen.has(key)) continue;
        seen.add(key);
        items.push({ field: field.id, label: field.label, shown: clean, kind: 'word', forms: wordForms(clean), formBits: 0 });
      }
    }
    const list = items.slice(0, MAX_ITEMS);
    const inputs = [];
    list.forEach((item) => item.forms.forEach((form) => {
      if (!form.extra || form.how === 'латиницей') inputs.push(form.text);
    }));
    return {
      size: list.length,
      itemBits: list.length ? Math.max(1, log2(list.length)) : 0,
      items: list,
      inputs: [...new Set(inputs)],
    };
  }

  return { FIELDS, MIN_LENGTH, MAX_ITEMS, translitVariants, wordForms, dateForms, prepare };
})();
