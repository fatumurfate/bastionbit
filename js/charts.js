'use strict';

/* BastionBit — графики анализатора (этап 2) на Chart.js.

   Chart.js (vendor/chart.umd.min.js) загружается, только когда открыт
   анализатор. Цвета берутся из CSS-переменных, поэтому графики сами
   перекрашиваются при смене светлой и тёмной темы. Столбцы и линии
   вырастают плавно — всегда, как и остальные анимации сайта. */

const BBCharts = (() => {
  const LG_MINUTE = Math.log10(60);
  const LG_HOUR = Math.log10(3600);
  const LG_DAY = Math.log10(86400);
  const LG_YEAR = Math.log10(365.25 * 86400);
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  const sup = (n) => String(n).replace(/[0-9-]/g, (c) => SUP[c]);
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const charts = [];
  const axes = new WeakMap();   // холст → подписи осей срока годности

  const ready = () => typeof Chart !== 'undefined';
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const animation = () => ({ duration: 650, easing: 'easeOutQuart' });

  // «2,4·10<sup>15</sup> лет» → «2,4·10¹⁵ лет»: подписи на холсте — без HTML.
  function plain(html) {
    return html.replace(/<sup>(.*?)<\/sup>/g, (_, power) => sup(power)).replace(/<[^>]+>/g, '');
  }
  const duration = (lg) => plain(BBEntropy.formatDuration(lg).html);

  function palette() {
    return {
      text: css('--text'),
      muted: css('--muted'),
      grid: css('--border'),
      formula: css('--chart-formula'),
      real: css('--chart-real'),
      zxcvbn: css('--chart-zxcvbn'),
      md5: css('--chart-md5'),
      bcrypt: css('--chart-bcrypt'),
      limit: css('--chart-limit'),
    };
  }

  let configured = false;
  function configure() {
    if (configured) return;
    configured = true;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 13;
  }

  const LABEL_ROOM = 84;   // место справа от столбиков для подписей

  // Подпись значения у конца столбика: «15,8 бита».
  const valueLabels = {
    id: 'bbValueLabels',
    afterDatasetsDraw(chart, _args, options) {
      const labels = options.labels || [];
      const { ctx } = chart;
      const zero = chart.scales.x.getPixelForValue(0);
      ctx.save();
      ctx.font = `600 13px ${Chart.defaults.font.family}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const text = labels[i];
        if (!text) return;
        const value = chart.data.datasets[0].data[i];
        ctx.fillStyle = value == null ? options.muted : options.color;
        ctx.fillText(text, (value == null ? zero : bar.x) + 8, bar.y);
      });
      ctx.restore();
    },
  };

  // Фон — шкала оценок: от «очень слабого» (красный) до «очень сильного».
  const levelBands = {
    id: 'bbLevelBands',
    beforeDatasetsDraw(chart, _args, options) {
      const { ctx, chartArea } = chart;
      const x = chart.scales.x;
      const bounds = BBEntropy.LEVELS.map((level) => level.min).concat(Infinity);
      ctx.save();
      ctx.globalAlpha = options.alpha;
      BBEntropy.LEVELS.forEach((_level, i) => {
        const from = Math.max(chartArea.left, x.getPixelForValue(bounds[i]));
        const to = Math.min(chartArea.right, x.getPixelForValue(Math.min(bounds[i + 1], x.max)));
        if (to <= from) return;
        ctx.fillStyle = options.colors[i];
        ctx.fillRect(from, chartArea.top, to - from, chartArea.bottom - chartArea.top);
      });
      ctx.restore();
    },
  };

  /* ---------- Сравнение оценок: формула, BastionBit, zxcvbn ---------- */

  // Круглая граница оси и шаг подписей: не больше 5 делений.
  function niceAxis(value) {
    const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => Math.ceil(value / s) <= 5) || 1000;
    return { top: Math.max(30, Math.ceil(value / step) * step), step };
  }

  // rows: [{ kind: 'formula' | 'real' | 'zxcvbn', label, bits, text }]
  // bits = null — значение ещё считается, вместо столбика только подпись text.
  function compare(canvas, rows) {
    if (!ready()) return null;
    configure();
    const data = rows.map((row) => (row.bits == null ? null : Math.max(0, row.bits)));
    const { top, step } = niceAxis(Math.max(0, ...data.filter((v) => v != null)) * 1.05);
    const kinds = rows.map((row) => row.kind);
    const labels = rows.map((row) => row.text);
    let chart = Chart.getChart(canvas);

    if (chart) {
      chart.options.animation = animation();
      chart.data.labels = rows.map((row) => row.label);
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].bbKinds = kinds;
      chart.options.scales.x.max = top;
      chart.options.scales.x.ticks.stepSize = step;
      chart.options.plugins.bbValueLabels.labels = labels;
      paintCompare(chart);
      chart.update();
      return chart;
    }

    const config = {
      type: 'bar',
      data: {
        labels: rows.map((row) => row.label),
        datasets: [{ data, bbKinds: kinds, borderRadius: 6, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.9 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: animation(),
        layout: { padding: { right: LABEL_ROOM } },
        scales: {
          x: {
            min: 0, max: top,
            grid: {}, border: { display: false },
            ticks: { stepSize: step, callback: (value) => String(value) },
            title: { display: true, text: 'бит' },
          },
          y: {
            grid: { display: false }, border: { display: false },
            ticks: { font: { weight: '600' } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          bbValueLabels: { labels },
          bbLevelBands: { alpha: 1, colors: [] },
        },
      },
      plugins: [levelBands, valueLabels],
    };
    paintCompare(config);
    chart = new Chart(canvas, config);
    chart.$bbPaint = paintCompare;
    charts.push(chart);
    return chart;
  }

  // target — готовый график или его настройки до создания.
  function paintCompare(target) {
    const c = palette();
    const dataset = target.data.datasets[0];
    const { x, y } = target.options.scales;
    dataset.backgroundColor = dataset.bbKinds.map((kind) => c[kind]);
    x.grid.color = c.grid;
    x.ticks.color = c.muted;
    x.title.color = c.muted;
    y.ticks.color = c.text;
    target.options.plugins.bbValueLabels.color = c.text;
    target.options.plugins.bbValueLabels.muted = c.muted;
    target.options.plugins.bbLevelBands.colors = [0, 1, 2, 3, 4].map((i) => css(`--bar-${i}`));
    target.options.plugins.bbLevelBands.alpha = darkQuery.matches ? 0.16 : 0.1;
  }

  /* ---------- Срок годности: время подбора по годам ---------- */

  const NAMED_TICKS = [
    { value: -3, label: '1 мс' },
    { value: 0, label: '1 с' },
    { value: LG_MINUTE, label: '1 мин' },
    { value: LG_HOUR, label: '1 час' },
    { value: LG_DAY, label: 'сутки' },
    { value: LG_YEAR, label: '1 год' },
    { value: LG_YEAR + 2, label: '100 лет' },
    { value: LG_YEAR + 3, label: '1000 лет' },
  ];

  // Подписи оси времени: «сутки» всегда, остальные — не теснее 1/7 высоты.
  function timeTicks(min, max) {
    const candidates = NAMED_TICKS.slice();
    for (let k = 4; LG_YEAR + k <= max; k++) candidates.push({ value: LG_YEAR + k, label: `10${sup(k)} лет` });
    const inside = candidates.filter((t) => t.value >= min && t.value <= max);
    const gap = (max - min) / 7;
    const kept = inside.filter((t) => t.value === LG_DAY);
    inside.forEach((t) => {
      if (kept.every((k) => Math.abs(k.value - t.value) >= gap)) kept.push(t);
    });
    return kept.sort((a, b) => a.value - b.value);
  }

  // scenarios: [{ id: 'md5' | 'bcrypt', label, speed }]; years — на сколько лет вперёд.
  function expiry(canvas, { bits, year, years = 40, scenarios }) {
    if (!ready()) return null;
    configure();
    const series = scenarios.map((s) => {
      const points = [];
      for (let t = 0; t <= years; t++) points.push({ x: t, lg: BBEntropy.crackTimeLog10At(bits, s.speed, t) });
      return points;
    });
    const values = series.flat().map((p) => p.lg).concat(LG_DAY);
    const min = Math.max(-3, Math.floor(Math.min(...values) - 0.5));
    const max = Math.max(LG_DAY + 2, Math.ceil(Math.max(...values) + 0.5));
    const ticks = timeTicks(min, max);
    const labelOf = new Map(ticks.map((t) => [t.value, t.label]));

    const datasets = scenarios.map((s, i) => ({
      label: s.label,
      bbKind: s.id,
      data: series[i].map((p) => ({ x: p.x, y: Math.max(min, p.lg), lg: p.lg })),
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
    }));
    datasets.push({
      label: 'граница — сутки',
      bbKind: 'limit',
      data: [{ x: 0, y: LG_DAY }, { x: years, y: LG_DAY }],
      borderWidth: 1.5,
      borderDash: [6, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
    });
    // Точки «просрочки»: где линия пересекает границу.
    scenarios.forEach((s) => {
      const t = BBEntropy.expiryYears(bits, s.speed);
      if (t > 0 && t <= years) {
        datasets.push({ label: '', bbKind: s.id, bbMarker: true, showLine: false,
          data: [{ x: t, y: LG_DAY }], pointRadius: 5, pointHoverRadius: 5, pointBorderWidth: 2 });
      }
    });

    axes.set(canvas, { year, ticks, labels: labelOf });
    let chart = Chart.getChart(canvas);
    if (chart) {
      chart.options.animation = animation();
      chart.data.datasets = datasets;
      chart.options.scales.x.max = years;
      chart.options.scales.y.min = min;
      chart.options.scales.y.max = max;
      paintExpiry(chart);
      chart.update();
      return chart;
    }

    const axis = (scale) => axes.get(scale.chart.canvas);
    const config = {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animation(),
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'linear', min: 0, max: years,
            grid: {}, border: { display: false },
            afterBuildTicks: (scale) => {
              scale.ticks = [0, 10, 20, 30, 40].filter((v) => v <= scale.max).map((value) => ({ value }));
            },
            ticks: {
              callback(value) { return String(axis(this).year + value); },
            },
          },
          y: {
            type: 'linear', min, max,
            grid: {}, border: { display: false },
            afterBuildTicks: (scale) => { scale.ticks = axis(scale).ticks.map((t) => ({ value: t.value })); },
            ticks: {
              callback(value) { return axis(this).labels.get(value) || ''; },
            },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true, pointStyle: 'line', boxWidth: 28,
              filter: (item, data) => !data.datasets[item.datasetIndex].bbMarker,
            },
          },
          tooltip: {
            filter: (item) => !item.dataset.bbMarker && item.dataset.bbKind !== 'limit',
            callbacks: {
              title: (items) => (items.length
                ? `${axes.get(items[0].chart.canvas).year + Math.round(items[0].parsed.x)} год` : ''),
              label: (item) => `${item.dataset.label}: ${duration(item.raw.lg)}`,
            },
          },
        },
      },
    };
    paintExpiry(config);
    chart = new Chart(canvas, config);
    chart.$bbPaint = paintExpiry;
    charts.push(chart);
    return chart;
  }

  function paintExpiry(target) {
    const c = palette();
    const surface = css('--surface');
    target.data.datasets.forEach((d) => {
      const color = c[d.bbKind];
      d.borderColor = color;
      d.backgroundColor = d.bbMarker ? surface : color;
      d.pointBackgroundColor = d.bbMarker ? surface : color;
      d.pointBorderColor = color;
    });
    const { x, y } = target.options.scales;
    x.grid.color = c.grid;
    x.ticks.color = c.muted;
    y.grid.color = c.grid;
    y.ticks.color = c.muted;
    target.options.plugins.legend.labels.color = c.text;
  }

  // Тема сменилась — перекрашиваем все графики без анимации.
  darkQuery.addEventListener('change', () => {
    charts.forEach((chart) => {
      chart.$bbPaint(chart);
      chart.update('none');
    });
  });

  return { ready, compare, expiry, plain, timeTicks, LG_DAY, LG_YEAR };
})();
