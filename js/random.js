'use strict';

/* BastionBit — криптографически стойкая случайность.
   Используем только crypto.getRandomValues — никогда Math.random.

   randomInt(n) возвращает целое число от 0 до n − 1, причём все значения
   равновероятны. Обычный остаток x % n дал бы перекос: если 2³² не делится
   на n, первые значения выпадали бы чуть чаще. Поэтому числа из «неполного
   хвоста» диапазона отбрасываются и берутся заново (rejection sampling).

   fromBytes(bytes) делает то же самое, но берёт 32-битные числа не из
   crypto.getRandomValues, а из готового массива байтов. Одни и те же байты
   всегда дают одни и те же числа — так работает пароль из ключевого слова
   (этап 1.2): байты для него вычисляют PBKDF2 и HKDF. */

const BBRandom = (() => {
  const RANGE = 2 ** 32;            // Uint32 даёт числа от 0 до 2³² − 1

  // Байты закончились раньше, чем удалось выбрать все символы.
  class BytesExhausted extends Error {
    constructor() {
      super('Байты закончились');
      this.name = 'BytesExhausted';
    }
  }

  // Общий метод отбора для любого источника 32-битных чисел.
  function makeSource(nextUint32) {
    function randomInt(n) {
      if (!Number.isInteger(n) || n < 1 || n > RANGE) {
        throw new RangeError('randomInt: n должно быть целым числом от 1 до 2^32');
      }
      const limit = RANGE - (RANGE % n); // самое большое кратное n в диапазоне
      let x;
      do {
        x = nextUint32();
      } while (x >= limit);
      return x % n;
    }

    function pick(items) {
      return items[randomInt(items.length)];
    }

    return { randomInt, pick };
  }

  const buffer = new Uint32Array(1);
  const secure = makeSource(() => {
    crypto.getRandomValues(buffer);
    return buffer[0];
  });

  function fromBytes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    return makeSource(() => {
      if (offset + 4 > bytes.byteLength) throw new BytesExhausted();
      const x = view.getUint32(offset);  // 4 байта, старший — первый
      offset += 4;
      return x;
    });
  }

  return { randomInt: secure.randomInt, pick: secure.pick, fromBytes, BytesExhausted };
})();
