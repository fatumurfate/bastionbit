"""Отбирает из списка Xato пароли из русских слов в английской раскладке (этап 5).

Слово проверяется по орфографическому словарю Hunspell ru_RU (А. Лебедев,
словарь из LibreOffice) через библиотеку spylls. Это другой источник,
чем у BastionBit (FrequencyWords и OpenCorpora) и у zxcvbn, поэтому отбор
не подыгрывает ни одной из оценок.

Пароль попадает в выборку, если самый длинный кусок из букв и клавиш
, . ; ' [ ] ` в раскладке ЙЦУКЕН — известное русское слово или имя
(gfhjkm → пароль, yfnfif → Наташа). Кусок — от 5 символов, не короче
половины пароля и не английское слово (частотный список FrequencyWords).

Транслит (privet → привет) не отбираем: схем транслита много, и в выборку
попадают бренды и чужие слова (toshiba, juventus).

Запуск из папки bastionbit:

    pip install spylls
    python tools/select_russian.py
"""
import re
import urllib.request
from pathlib import Path

from spylls.hunspell import Dictionary

ROOT = Path(__file__).resolve().parent
SOURCES = ROOT / 'sources'
SOURCE = SOURCES / 'xato-net-10-million-passwords-1000000.txt'
ENGLISH = SOURCES / 'en_50k.txt'
OUT = ROOT / 'results' / 'russian-layout.tsv'
HUNSPELL = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/ru_RU/'

QWERTY = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
JCUKEN = 'йцукенгшщзхъфывапролджэячсмитьбюё'
SHIFTED = {'{': '[', '}': ']', ':': ';', '"': "'", '<': ',', '>': '.', '~': '`'}
LAYOUT = dict(zip(QWERTY, JCUKEN))
RUN = re.compile(r"[a-zA-Z\[\]{};:'\",<>.`~]+")


def hunspell():
    for name in ('ru_RU.aff', 'ru_RU.dic'):
        path = SOURCES / name
        if not path.exists():
            print('Скачиваю', HUNSPELL + name)
            urllib.request.urlretrieve(HUNSPELL + name, path)
    return Dictionary.from_files(str(SOURCES / 'ru_RU'))


def main():
    dictionary = hunspell()
    english = {line.split(' ')[0] for line in ENGLISH.read_text(encoding='utf-8').splitlines()}

    def known(word):
        forms = {word, word.replace('ё', 'е')}
        return any(dictionary.lookup(w) or dictionary.lookup(w.capitalize()) for w in forms)

    found = []
    with SOURCE.open(encoding='utf-8', errors='replace') as source:
        for rank, line in enumerate(source, 1):
            password = line.rstrip('\n')
            runs = RUN.findall(password)
            if not runs:
                continue
            run = max(runs, key=len)
            if len(run) < 5 or 2 * len(run) < len(password):
                continue
            if re.sub(r'[^a-z]', '', run.lower()) in english:
                continue
            word = ''.join(LAYOUT[SHIFTED.get(ch, ch)] for ch in run.lower())
            if known(word):
                found.append(f'{rank}\t{password}\t{word}')
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text('\n'.join(['место\tпароль\tслово'] + found) + '\n', encoding='utf-8')
    print(f'Русские слова в английской раскладке: {len(found)} → {OUT.relative_to(ROOT.parent)}')


if __name__ == '__main__':
    main()
