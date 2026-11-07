'use strict';

/* BastionBit — генератор паролей (этап 0, используется и в этапе 1.2).

   Пароль выбирается равновероятно среди ВСЕХ строк нужной длины, в которых
   есть хотя бы один символ из каждого выбранного набора: генерируем строку
   и, если какого-то набора в ней нет, генерируем заново.

   Точная энтропия такого генератора — log₂ |A|, где |A| — число допустимых
   строк. Его считаем по формуле включений-исключений:
   |A| = Σ по подмножествам S наборов: (−1)^|S| · (N − N_S)^L

   Источник случайности rng можно подменить: по умолчанию это
   crypto.getRandomValues (BBRandom), а для пароля из ключевого слова —
   поток байтов из PBKDF2 и HKDF (BBRandom.fromBytes). */

const BBGenerator = (() => {
  const SETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: BBEntropy.SYMBOLS,
  };
  const SIMILAR = 'Il1O0|';   // символы, которые легко перепутать

  function buildClasses(options) {
    const classes = [];
    for (const key of Object.keys(SETS)) {
      if (!options[key]) continue;
      let chars = Array.from(SETS[key]);
      if (options.avoidSimilar) chars = chars.filter((c) => !SIMILAR.includes(c));
      classes.push({ key, chars });
    }
    return classes;
  }

  function generate(options, rng = BBRandom) {
    const classes = buildClasses(options);
    if (classes.length === 0) throw new Error('Нужен хотя бы один набор символов');
    if (options.length < classes.length) throw new Error('Пароль слишком короткий для выбранных наборов');

    const pool = classes.flatMap((c) => c.chars);
    for (;;) {
      const chars = Array.from({ length: options.length }, () => rng.pick(pool));
      const hasEveryClass = classes.every((c) => chars.some((ch) => c.chars.includes(ch)));
      if (hasEveryClass) return chars.join('');
    }
  }

  // log₂ для очень больших целых чисел BigInt
  function log2BigInt(x) {
    if (x <= 0n) return 0;
    const bin = x.toString(2);
    if (bin.length <= 53) return Math.log2(Number(x));
    return Math.log2(Number(BigInt('0b' + bin.slice(0, 53)))) + (bin.length - 53);
  }

  function countValid(sizes, length) {
    const total = sizes.reduce((a, b) => a + b, 0);
    const L = BigInt(length);
    let result = 0n;
    for (let mask = 0; mask < 1 << sizes.length; mask++) {
      let excluded = 0;
      let picked = 0;
      sizes.forEach((size, i) => {
        if (mask & (1 << i)) { excluded += size; picked++; }
      });
      const term = BigInt(total - excluded) ** L;
      result += picked % 2 === 0 ? term : -term;
    }
    return result;
  }

  function exactEntropy(options) {
    const sizes = buildClasses(options).map((c) => c.chars.length);
    const pool = sizes.reduce((a, b) => a + b, 0);
    return {
      pool,
      bits: log2BigInt(countValid(sizes, options.length)),
      naiveBits: options.length * Math.log2(pool),
    };
  }

  return { SETS, SIMILAR, buildClasses, generate, countValid, exactEntropy };
})();
