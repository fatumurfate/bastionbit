"""
Сборка словарей для детектора хитростей BastionBit (этапы 2 и 5).

Скачивает открытые списки (один раз, в папку tools/sources) и записывает:
  data/top-passwords.js — 10 000 самых популярных паролей из базы Xato на 10 млн
                          паролей (список из SecLists, лицензия MIT);
  data/dict-ru.js       — частые русские слова (FrequencyWords, CC BY-SA 4.0);
  data/dict-en.js       — частые английские слова (FrequencyWords, CC BY-SA 4.0);
  data/dict-names.js    — русские имена, фамилии, отчества и названия мест, которых
                          нет среди частых слов (OpenCorpora, CC BY-SA 3.0).
В частотных словарях слова идут по убыванию частоты: место в списке — это ранг r,
слово стоит log₂ r бит. У имён частот нет, поэтому каждое стоит log₂ N бит,
где N — размер словаря.

Запуск (нужен Python 3, для имён — pymorphy3 и словарь OpenCorpora):
    pip install pymorphy3 pymorphy3-dicts-ru
    python tools/build_dictionaries.py
"""

import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'tools' / 'sources'
DATA = ROOT / 'data'

PASSWORDS_URL = ('https://raw.githubusercontent.com/danielmiessler/SecLists/master/'
                 'Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt')
WORDS_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{lang}/{lang}_50k.txt'

WORDS_LIMIT = None    # берём все слова списков на 50 000 (этап 5; на этапе 2 было 30 000)
MIN_LENGTH = 3        # детектор ищет слова от трёх букв


def source(name, url):
    path = SOURCES / name
    if not path.exists():
        SOURCES.mkdir(parents=True, exist_ok=True)
        print('Скачиваю', url)
        urllib.request.urlretrieve(url, path)
    return path.read_text(encoding='utf-8').splitlines()


def unique(items):
    seen = set()
    return [x for x in items if not (x in seen or seen.add(x))]


def passwords():
    lines = [line.strip().lower() for line in source('xato-net-10-million-passwords-10000.txt', PASSWORDS_URL)]
    # ` \ и ${ сломали бы строку-шаблон JavaScript, в которую записан список.
    return unique(p for p in lines if len(p) >= MIN_LENGTH and re.fullmatch(r'[!-~]+', p)
                  and not any(bad in p for bad in ('`', '\\', '${')))


def words(lang, alphabet):
    lines = source(f'{lang}_50k.txt', WORDS_URL.format(lang=lang))
    result = []
    for line in lines:
        word = line.split(' ')[0].lower().replace('ё', 'е')
        if len(word) >= MIN_LENGTH and re.fullmatch(alphabet, word):
            result.append(word)
    return unique(result)[:WORDS_LIMIT]


def names(exclude):
    """Имена, фамилии, отчества и названия мест из OpenCorpora — в именительном падеже."""
    import pymorphy3
    morph = pymorphy3.MorphAnalyzer()
    found = set()
    for word, tag, *_ in morph.dictionary.iter_known_words(''):
        if 'nomn' not in tag or not any(g in tag for g in ('sing', 'Sgtm', 'Pltm')):
            continue
        if any(g in tag for g in ('Name', 'Surn', 'Patr', 'Geox')):
            word = word.replace('ё', 'е')
            if len(word) >= MIN_LENGTH and re.fullmatch(r'[а-я]+', word) and word not in exclude:
                found.add(word)
    return sorted(found)


def write(name, const, items, about, ranked=True):
    order = ('идут по убыванию частоты: место в списке —\n  ранг r' if ranked
             else 'идут по алфавиту')
    text = (f'/*\n  BastionBit — {about}\n\n'
            '  Файл собран скриптом tools/build_dictionaries.py. Вручную его не правят.\n'
            f'  Слова разделены пробелами и {order}. Всего: {len(items)}.\n*/\n\n'
            f'const {const} = `{" ".join(items)}`;\n')
    (DATA / name).write_text(text, encoding='utf-8')
    print(f'{name}: {len(items)} слов, {len(text.encode("utf-8")) // 1024} КБ')


if __name__ == '__main__':
    DATA.mkdir(exist_ok=True)
    write('top-passwords.js', 'BB_TOP_PASSWORDS', passwords(),
          'популярные пароли.\n\n  Источник: 10 000 самых частых паролей из базы Xato на 10 млн паролей\n'
          '  (Mark Burnett, 2015), список из SecLists (Daniel Miessler, лицензия MIT).')
    ru = words('ru', r'[а-я]+')
    write('dict-ru.js', 'BB_DICT_RU', ru,
          'частые русские слова (ё записана как е).\n\n  Источник: FrequencyWords (Hermit Dave), частоты по субтитрам\n'
          '  OpenSubtitles 2018. Лицензия списка — CC BY-SA 4.0.')
    write('dict-names.js', 'BB_DICT_NAMES', names(set(ru)),
          'русские имена, фамилии, отчества и названия мест (ё записана как е),\n'
          '  которых нет в data/dict-ru.js. Частот у них нет: каждое стоит log₂ N бит.\n\n'
          '  Источник: словарь OpenCorpora (opencorpora.org) через библиотеку pymorphy3.\n'
          '  Лицензия — CC BY-SA 3.0.', ranked=False)
    write('dict-en.js', 'BB_DICT_EN', words('en', r'[a-z]+'),
          'частые английские слова.\n\n  Источник: FrequencyWords (Hermit Dave), частоты по субтитрам\n'
          '  OpenSubtitles 2018. Лицензия списка — CC BY-SA 4.0.')
