"""
Пересоздаёт эталоны для tests/phrase-test.js (нужен Python 3 и pymorphy3):
    pip install pymorphy3 pymorphy3-dicts-ru
    python tests/fixtures/make_fixtures.py

  pymorphy3-agree.json  — формы «1 чайник, 2 чайника, 5 чайников…» для чисел 1…100
                          по словарю OpenCorpora (make_agree_with_number);
  words-reference.json  — словари фразы, собранные tools/build_words.py
                          (заодно пересобирается data/words-ru.js из tools/words/*.txt).

Запускать после изменения списков слов в tools/words/.
"""

import json
import subprocess
import sys
from pathlib import Path

import pymorphy3

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

morph = pymorphy3.MorphAnalyzer()
agree = {}
for word in ['чайник', 'книга', 'окно']:
    parse = next(p for p in morph.parse(word) if p.tag.POS == 'NOUN' and 'nomn' in p.tag)
    acc = parse.inflect({'accs'})
    agree[word] = [acc.make_agree_with_number(n).word for n in range(1, 101)]
(HERE / 'pymorphy3-agree.json').write_text(json.dumps(agree, ensure_ascii=False) + '\n', encoding='utf-8')
print('Записан pymorphy3-agree.json')

subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_words.py'),
                '--reference', str(HERE / 'words-reference.json')], check=True)
print('Записан words-reference.json')
