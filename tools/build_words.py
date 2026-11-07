"""
Сборка словарей для русской фразы BastionBit (этап 1.3).

Читает списки слов из tools/words/*.txt, проверяет каждое слово по словарю
OpenCorpora (через библиотеку pymorphy3), находит нужные формы и записывает
data/words-ru.js. Слова, которые не прошли проверку, выводятся с причиной.

Запуск (нужен Python 3 и pymorphy3):
    pip install pymorphy3 pymorphy3-dicts-ru
    python tools/build_words.py
"""

import json
import math
import sys
from pathlib import Path

import pymorphy3

ROOT = Path(__file__).resolve().parent.parent
WORDS = ROOT / 'tools' / 'words'
OUTPUT = ROOT / 'data' / 'words-ru.js'

# Имена, фамилии, названия, сокращения, «только множественное число», ошибки, жаргон
BAD_FLAGS = {'Name', 'Surn', 'Patr', 'Geox', 'Orgn', 'Trad', 'Abbr', 'Pltm', 'Erro', 'Dist', 'Slng', 'Arch', 'Litr'}
# Игрушки, которые грамматически одушевлённые; в женском роде нужные формы от этого не меняются
ANIMATE_TOYS = {'кукла', 'матрёшка', 'неваляшка'}
GENDERS = {'masc': 'm', 'femn': 'f', 'neut': 'n'}

morph = pymorphy3.MorphAnalyzer()
problems = []
warnings = []


def read_list(name):
    words, seen = [], set()
    for line in (WORDS / f'{name}.txt').read_text(encoding='utf-8').splitlines():
        for word in line.split('#')[0].split():
            word = word.lower()
            if word in seen:
                problems.append((name, word, 'повтор'))
                continue
            seen.add(word)
            words.append(word)
    return words


def inflect(parse, grammemes):
    form = parse.inflect(set(grammemes))
    return form.word if form else None


# ---------- Правила, которые повторяет js/phrase.js ----------

def adjective_rule(word):
    """Формы прилагательного по его мужскому роду: ж. р., ср. р., ж. р. вин. п., мн. ч. им. п., мн. ч. род. п."""
    stem, ending = word[:-2], word[-2:]
    last = stem[-1]
    if ending == 'ий' and last not in 'гкхжшчщ':          # мягкое: синий
        return [stem + 'яя', stem + 'ее', stem + 'юю', stem + 'ие', stem + 'их']
    if ending == 'ий' and last in 'жшчщ':                 # шипящая: хороший
        return [stem + 'ая', stem + 'ее', stem + 'ую', stem + 'ие', stem + 'их']
    soft_plural = last in 'гкхжшчщ'                       # русский, большой, дорогой
    return [stem + 'ая', stem + 'ое', stem + 'ую',
            stem + ('ие' if soft_plural else 'ые'), stem + ('их' if soft_plural else 'ых')]


# ---------- Части речи ----------

def build_adjectives(words):
    result = []
    for word in words:
        parses = [p for p in morph.parse(word)
                  if p.tag.POS in ('ADJF', 'PRTF') and p.word == word
                  and {'masc', 'sing', 'nomn'} <= p.tag.grammemes]
        if not parses:
            problems.append(('adjectives', word, 'не найдено как прилагательное м. р.'))
            continue
        p = parses[0]
        if p.tag.grammemes & ({'Apro', 'Anum', 'Poss'} | BAD_FLAGS):
            problems.append(('adjectives', word, f'помета {p.tag}'))
            continue
        if word[-2:] not in ('ый', 'ий', 'ой'):
            problems.append(('adjectives', word, 'необычное окончание'))
            continue
        forms = [inflect(p, g) for g in (
            {'femn', 'sing', 'nomn'}, {'neut', 'sing', 'nomn'}, {'femn', 'sing', 'accs'},
            {'plur', 'nomn'}, {'plur', 'gent'})]
        if forms != adjective_rule(word):
            problems.append(('adjectives', word, f'правило не совпало: {forms}'))
            continue
        result.append({'word': word, 'forms': forms})
    return result


def plain(text):
    return text.replace('ё', 'е')


def noun_parses(word):
    # Разборы-имена («Лев», «Роза») и сокращения не считаем
    return [p for p in morph.parse(word)
            if p.tag.POS == 'NOUN' and plain(p.normal_form) == plain(word)
            and {'sing', 'nomn'} <= p.tag.grammemes and not p.tag.grammemes & BAD_FLAGS]


def build_subjects(words):
    result = []
    for word in words:
        parses = noun_parses(word)
        if not parses:
            problems.append(('subjects', word, 'не найдено как существительное'))
            continue
        genders = {p.tag.gender for p in parses}
        if len(genders) != 1 or not genders <= set(GENDERS):
            problems.append(('subjects', word, f'род неоднозначен: {genders}'))
            continue
        p = next((q for q in parses if 'anim' in q.tag), parses[0])
        result.append({'word': word, 'gender': GENDERS[p.tag.gender], 'anim': 'anim' in p.tag})
    return result


def build_objects(words):
    result = []
    for word in words:
        parses = noun_parses(word)
        inan = [p for p in parses if 'inan' in p.tag or word in ANIMATE_TOYS]
        if not inan:
            problems.append(('objects', word, 'не найдено как неодушевлённое существительное'))
            continue
        p = inan[0]
        if len({q.tag.gender for q in inan}) != 1 or p.tag.gender not in GENDERS:
            problems.append(('objects', word, f'род неоднозначен'))
            continue
        # У мужского рода «1 …» зависит от одушевлённости: «купил конструктор», но «увидел конструктора»
        if p.tag.gender == 'masc' and any('anim' in q.tag for q in parses):
            warnings.append(('objects', word, 'есть одушевлённое значение, взяты формы неодушевлённого'))
        if 'Sgtm' in p.tag:
            problems.append(('objects', word, f'помета {p.tag}'))
            continue
        accs = p.inflect({'sing', 'accs'})
        if not accs:
            problems.append(('objects', word, 'нет винительного падежа'))
            continue
        # Формы «1 …», «2 …», «5 …» — согласование с числом по pymorphy3
        forms = [accs.make_agree_with_number(n) for n in (1, 2, 5)]
        if not all(forms):
            problems.append(('objects', word, 'нет формы после числа'))
            continue
        result.append({'word': word, 'gender': GENDERS[p.tag.gender], 'forms': [f.word for f in forms]})
    return result


def build_verbs(words):
    result = []
    for word in words:
        parses = [p for p in morph.parse(word)
                  if p.tag.POS == 'VERB' and p.word == word
                  and {'past', 'masc', 'sing'} <= p.tag.grammemes]
        if not parses:
            problems.append(('verbs', word, 'не найдено как глагол прошедшего времени м. р.'))
            continue
        p = next((q for q in parses if 'tran' in q.tag), None)
        if p is None:
            problems.append(('verbs', word, 'непереходный'))
            continue
        fem, neut = inflect(p, {'femn', 'sing', 'past'}), inflect(p, {'neut', 'sing', 'past'})
        if not fem or not neut or neut != fem[:-1] + 'о':
            problems.append(('verbs', word, f'формы {fem}, {neut}'))
            continue
        result.append({'word': word, 'forms': [fem, neut], 'aspect': p.tag.aspect})
    return result


# ---------- Запись data/words-ru.js ----------

def wrap(items, width=96, indent='    '):
    lines, line = [], ''
    for item in items:
        if line and len(line) + 1 + len(item) > width:
            lines.append(indent + line)
            line = item
        else:
            line = f'{line} {item}' if line else item
    if line:
        lines.append(indent + line)
    return '\n'.join(lines)


def block(items):
    return '`\n' + wrap(items) + '\n  `'


def by_gender(items, render):
    parts = []
    for code in ('m', 'f', 'n'):
        group = [render(x) for x in items if x['gender'] == code]
        parts.append(f'    {code}: `\n' + wrap(group, indent='      ') + '\n    `,')
    return '{\n' + '\n'.join(parts) + '\n  }'


def write_js(adjectives, subjects, verbs, objects):
    verb_items = [v['word'] if v['forms'][0] == v['word'] + 'а' else f"{v['word']}/{v['forms'][0]}" for v in verbs]
    text = f"""/*
  BastionBit — словари для русской фразы (этап 1.3).

  Файл собран скриптом tools/build_words.py из списков tools/words/*.txt.
  Каждое слово и его формы проверены по словарю OpenCorpora (opencorpora.org,
  лицензия CC BY-SA) с помощью библиотеки pymorphy3. Вручную файл не правят:
  измените список и запустите сборку заново.

  adjectives — какой: мужской род. Остальные формы строит js/phrase.js по правилам.
  subjects   — кто: по родам (m — мужской, f — женский, n — средний).
  verbs      — что сделал: мужской род. Через «/» — женский род, если он
               получается не простым добавлением «а».
  objects    — что: по родам. Три формы после числа через запятую:
               «1 чайник», «2 чайника», «5 чайников».
*/

const BB_WORDS_RU = {{
  adjectives: {block([a['word'] for a in adjectives])},
  subjects: {by_gender(subjects, lambda s: s['word'])},
  verbs: {block(verb_items)},
  objects: {by_gender(objects, lambda o: ','.join(o['forms']))},
}};
"""
    OUTPUT.parent.mkdir(exist_ok=True)
    OUTPUT.write_text(text, encoding='utf-8')


def main():
    adjectives = build_adjectives(read_list('adjectives'))
    subjects = build_subjects(read_list('subjects'))
    verbs = build_verbs(read_list('verbs'))
    objects = build_objects(read_list('objects'))
    write_js(adjectives, subjects, verbs, objects)

    for name, word, reason in problems:
        print(f'  пропущено [{name}] {word}: {reason}')
    for name, word, reason in warnings:
        print(f'  проверить [{name}] {word}: {reason}')
    sizes = {'прилагательных': len(adjectives), 'кто': len(subjects), 'глаголов': len(verbs), 'предметов': len(objects)}
    bits = math.log2(len(adjectives) * len(subjects) * len(verbs) * 100 * len(objects))
    print('Готово:', ', '.join(f'{k} {v}' for k, v in sizes.items()))
    print(f'Энтропия фразы: {bits:.2f} бита, с прилагательным к предмету: {bits + math.log2(len(adjectives)):.2f} бита')

    # Эталон для тестов: python tools/build_words.py --reference путь.json
    if '--reference' in sys.argv:
        path = Path(sys.argv[sys.argv.index('--reference') + 1])
        path.write_text(json.dumps({'adjectives': adjectives, 'subjects': subjects, 'verbs': verbs,
                                    'objects': objects}, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
