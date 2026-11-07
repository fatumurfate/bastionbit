"""Графики исследования этапа 5 по tools/results/evaluation.json.

Запуск из папки bastionbit после node tools/evaluate.js:

    pip install matplotlib
    python tools/plot_results.py
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

RESULTS = Path(__file__).resolve().parent / 'results'
DATA = json.loads((RESULTS / 'evaluation.json').read_text(encoding='utf-8'))

plt.rcParams.update({
    'font.family': ['Arial', 'Liberation Sans', 'DejaVu Sans'],
    'font.size': 11, 'axes.titlesize': 13, 'axes.titleweight': 'bold',
    'axes.edgecolor': '#C9CDE0', 'axes.labelcolor': '#1A1D3A', 'xtick.color': '#5B6185', 'ytick.color': '#5B6185',
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.grid': True, 'grid.color': '#E7E9F4', 'grid.linewidth': 0.8,
    'legend.frameon': False, 'savefig.dpi': 200, 'savefig.bbox': 'tight',
})
TEXT = '#1A1D3A'
COLORS = {'formula': '#9AA1C4', 'bastionbit': '#4F46E5', 'zxcvbn': '#12A594', 'truth': '#E5484D'}
LABELS = {'formula': 'Формула L·log₂N', 'bastionbit': 'BastionBit', 'zxcvbn': 'zxcvbn'}
LEVEL_COLORS = ['#E5484D', '#F08C2E', '#E2B203', '#30A46C', '#1F8A5B']
NAMES = ['formula', 'bastionbit', 'zxcvbn']


def fmt(n):
    return f'{n:,}'.replace(',', '\u202f')


def decades():
    rows = DATA['decades']
    x = list(range(len(rows)))
    fig, ax = plt.subplots(figsize=(9, 5.2))
    for name in NAMES:
        med = [r['estimators'][name]['median'] for r in rows]
        lo = [r['estimators'][name]['p25'] for r in rows]
        hi = [r['estimators'][name]['p75'] for r in rows]
        ax.fill_between(x, lo, hi, color=COLORS[name], alpha=0.13, linewidth=0)
        ax.plot(x, med, marker='o', color=COLORS[name], linewidth=2.4, label=LABELS[name])
    truth = [r['truth']['median'] for r in rows]
    ax.plot(x, truth, color=COLORS['truth'], linestyle='--', linewidth=2.2, marker='s', label='Настоящая стойкость log₂(место)')
    ax.axhspan(0, 28, color='#E5484D', alpha=0.05, linewidth=0)
    ax.text(2.5, 25.5, '«очень слабый» — ниже 28 бит', ha='center', va='top', fontsize=9.5, color='#C8372D')
    ax.set_xticks(x, [f"{fmt(r['from'])}–\n{fmt(r['to'])}" for r in rows], fontsize=9.5)
    ax.set_xlabel('Место пароля в списке популярности (Xato, 1 млн паролей)')
    ax.set_ylabel('Оценка стойкости, бит\n(линия — медиана, полоса — половина паролей)')
    ax.set_ylim(0, max(r['estimators']['formula']['p75'] for r in rows) + 6)
    ax.set_title('Чем популярнее пароль, тем он слабее. Кто это видит?', color=TEXT, loc='left')
    ax.legend(loc='upper left', ncol=2, fontsize=10, bbox_to_anchor=(0.0, 0.93))
    fig.savefig(RESULTS / 'chart-decades.png')
    plt.close(fig)


def levels():
    groups = [('all', 'Миллион паролей Xato'), ('russian', 'Русские слова в английской раскладке')]
    level_names = DATA['levels']
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 3.6), sharey=True)
    for ax, (gid, title) in zip(axes, groups):
        g = DATA['groups'][gid]
        for row, name in enumerate(reversed(NAMES)):
            left = 0
            for k, share in enumerate(g['estimators'][name]['levels']):
                ax.barh(row, share, left=left, color=LEVEL_COLORS[k], height=0.62, edgecolor='white', linewidth=0.8)
                if share >= 0.07:
                    ax.text(left + share / 2, row, f'{round(100 * share)} %', ha='center', va='center',
                            color='white', fontsize=9.5, fontweight='bold')
                left += share
        ax.set_yticks(range(3), [LABELS[n] for n in reversed(NAMES)])
        ax.set_xlim(0, 1)
        ax.xaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
        ax.grid(False)
        ax.set_title(f"{title}\n({fmt(g['n'])} паролей, настоящая стойкость ≤ 20 бит)", fontsize=11, color=TEXT)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in LEVEL_COLORS]
    fig.legend(handles, level_names, loc='lower center', ncol=5, bbox_to_anchor=(0.5, -0.08), fontsize=10)
    fig.suptitle('Какую оценку получили пароли из утечки', x=0.02, ha='left', fontsize=13, fontweight='bold', color=TEXT)
    fig.tight_layout()
    fig.savefig(RESULTS / 'chart-levels.png')
    plt.close(fig)


def control():
    ids = ['random8', 'random16', 'phrase6', 'phrase6layout', 'rule']
    titles = ['Случайный\n8 символов', 'Случайный\n16 символов', 'Фраза\nиз 6 слов', 'Фраза\nв англ. раскладке', 'Ментальное\nправило']
    fig, ax = plt.subplots(figsize=(9.5, 5))
    width = 0.2
    for k, name in enumerate(['truth'] + NAMES):
        values = [DATA['control'][i]['exact'] if name == 'truth' else DATA['control'][i]['estimators'][name]['median'] for i in ids]
        bars = ax.bar([x + (k - 1.5) * width for x in range(len(ids))], values, width,
                      color=COLORS[name], label='Точная стойкость' if name == 'truth' else LABELS[name])
        for b, v in zip(bars, values):
            ax.text(b.get_x() + b.get_width() / 2, v + 2, f'{v:.0f}', ha='center', va='bottom', fontsize=8.5, color='#5B6185')
    ax.set_xticks(range(len(ids)), titles)
    ax.set_ylabel('бит (медиана по 2 000 паролей)')
    ax.set_title('Пароли с точно известной стойкостью', color=TEXT, loc='left')
    ax.legend(ncol=4, loc='upper left', fontsize=10)
    ax.set_ylim(0, max(DATA['control'][i]['estimators']['formula']['median'] for i in ids) * 1.15)
    fig.savefig(RESULTS / 'chart-control.png')
    plt.close(fig)


def improvement():
    """До и после доработки словарей (этап 4 → этап 5), если есть evaluation-stage4.json."""
    path = RESULTS / 'evaluation-stage4.json'
    if not path.exists():
        return
    old = json.loads(path.read_text(encoding='utf-8'))
    groups = [('all', 'Миллион паролей Xato'), ('russian', 'Русские слова в английской раскладке')]
    series = [('formula', DATA, 'Формула', COLORS['formula']), ('bastionbit', old, 'BastionBit, этап 4', '#A5A0F0'),
              ('bastionbit', DATA, 'BastionBit, этап 5', COLORS['bastionbit']), ('zxcvbn', DATA, 'zxcvbn', COLORS['zxcvbn'])]
    fig, axes = plt.subplots(1, 2, figsize=(10.5, 4.2), sharey=True)
    width = 0.2
    for ax, (gid, title) in zip(axes, groups):
        for k, (name, source, label, color) in enumerate(series):
            levels_share = source['groups'][gid]['estimators'][name]['levels']
            values = [levels_share[0], sum(levels_share[2:])]
            bars = ax.bar([x + (k - 1.5) * width for x in range(2)], values, width, color=color, label=label)
            for b, v in zip(bars, values):
                ax.text(b.get_x() + b.get_width() / 2, v + 0.015, f'{round(100 * v)}', ha='center', va='bottom', fontsize=8.5, color='#5B6185')
        ax.set_xticks(range(2), ['назвали «очень слабым»\n(правильно)', 'назвали «средним» и выше\n(опасная ошибка)'])
        ax.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
        ax.set_ylim(0, 1.08)
        ax.set_title(f"{title} ({fmt(DATA['groups'][gid]['n'])})", fontsize=11, color=TEXT)
    axes[0].legend(loc='upper right', fontsize=9.5)
    fig.suptitle('Что дала доработка словарей', x=0.02, ha='left', fontsize=13, fontweight='bold', color=TEXT)
    fig.tight_layout()
    fig.savefig(RESULTS / 'chart-improvement.png')
    plt.close(fig)


if __name__ == '__main__':
    decades()
    levels()
    control()
    improvement()
    print('Графики сохранены в', RESULTS)
