'use strict';

/* BastionBit — похож ли пароль на другие ваши пароли (этап 4).

   Если старый пароль утёк, взломщик сначала пробует его небольшие
   изменения: Barsik2023! → Barsik2024!. Насколько пароли похожи, мерит
   расстояние Левенштейна d — наименьшее число правок (вставить, удалить
   или заменить символ), чтобы из одного получить другой. Считаем его
   динамическим программированием:
        D[i][j] = min(D[i−1][j] + 1, D[i][j−1] + 1, D[i−1][j−1] + [aᵢ ≠ bⱼ]).

   Сколько вариантов перебрать взломщику, который знает старый пароль
   длины L: у каждой правки не больше 2L + 1 мест (L символов и L + 1
   промежутков) и N символов, порядок d правок неважен:
        H ≈ d · log₂((2L + 1) · N) − log₂ d!
   Итог — не больше оценки детектора: если новый пароль и сам по себе
   слабый, похожесть ему уже не навредит. */

const BBSimilar = (() => {
  // Расстояние и сами правки (по символам, эмодзи — один символ).
  function edit(a, b) {
    const x = Array.from(a);
    const y = Array.from(b);
    const n = x.length;
    const m = y.length;
    const d = Array.from({ length: n + 1 }, (_, i) => {
      const row = new Uint16Array(m + 1);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
    }
    // Обратный ход: какие именно правки
    const ops = [];
    for (let i = n, j = m; i > 0 || j > 0;) {
      if (i > 0 && j > 0 && x[i - 1] === y[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        i--; j--;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
        ops.unshift({ type: 'replace', at: i - 1, from: x[i - 1], to: y[j - 1] });
        i--; j--;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ops.unshift({ type: 'delete', at: i - 1, from: x[i - 1] });
        i--;
      } else {
        ops.unshift({ type: 'insert', at: i, to: y[j - 1] });
        j--;
      }
    }
    return { distance: d[n][m], ops };
  }

  const distance = (a, b) => edit(a, b).distance;

  function log2Factorial(k) {
    let sum = 0;
    for (let i = 2; i <= k; i++) sum += Math.log2(i);
    return sum;
  }

  // H ≈ d · log₂((2L + 1) · N) − log₂ d!
  function nearBits(length, pool, d) {
    if (d <= 0) return 0;
    return Math.max(0, d * Math.log2((2 * length + 1) * pool) - log2Factorial(d));
  }

  // known — пароль, который мог утечь; target — проверяемый.
  // limit — оценка детектора для target (итог не больше неё).
  function compare(known, target, limit = Infinity) {
    const { distance: d, ops } = edit(known, target);
    const length = Array.from(known).length;
    const pool = Math.max(2, BBEntropy.analyze(known + target).pool);
    const near = nearBits(length, pool, d);
    const longest = Math.max(length, Array.from(target).length) || 1;
    return {
      distance: d, ops, length, pool, near,
      bits: Math.min(near, limit),
      similarity: 1 - d / longest,
    };
  }

  return { edit, distance, nearBits, compare };
})();
