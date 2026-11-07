# Независимая реализация пароля из ключевого слова (этап 1.2) на Python —
# для сверки с js/keyword.js. Вход: JSON-список случаев (уже нормализованных).
import hashlib, hmac, json, struct, sys

TAG = 'BastionBit v1'
SETS = {
    'lower': 'abcdefghijklmnopqrstuvwxyz',
    'upper': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'digits': '0123456789',
    'symbols': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
}
SIMILAR = 'Il1O0|'

def hkdf(ikm, salt, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, t, i = b'', b'', 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        out += t
        i += 1
    return out[:length]

class Exhausted(Exception):
    pass

def render(stream, length, classes):
    pos = 0
    pool = [c for cls in classes for c in cls]
    n = len(pool)
    limit = 2**32 - (2**32 % n)
    def nxt():
        nonlocal pos
        if pos + 4 > len(stream):
            raise Exhausted()
        x = struct.unpack('>I', stream[pos:pos + 4])[0]
        pos += 4
        return x
    while True:
        chars = []
        for _ in range(length):
            x = nxt()
            while x >= limit:
                x = nxt()
            chars.append(pool[x % n])
        if all(any(c in cls for c in chars) for cls in classes):
            return ''.join(chars)

def derive(case):
    keys = [k for k in SETS if case['options'][k]]
    avoid = case['options']['avoidSimilar']
    classes = [[c for c in SETS[k] if not (avoid and c in SIMILAR)] for k in keys]
    pw = case['master'].encode() + b'\0' + case['keyword'].encode()
    salt = TAG.encode() + b'\0' + case['site'].encode() + b'\0' + str(case['version']).encode()
    key = hashlib.pbkdf2_hmac('sha256', pw, salt, case['iterations'], 32)
    skey = 'length=%d;sets=%s;avoid-similar=%d' % (case['options']['length'], ','.join(keys), 1 if avoid else 0)
    stream = b''
    for block in range(1, 5):
        info = ('%s\0password\0%s\0%d' % (TAG, skey, block)).encode()
        stream += hkdf(key, TAG.encode(), info, 8160)
        try:
            return render(stream, case['options']['length'], classes)
        except Exhausted:
            pass
    raise RuntimeError('exhausted')

if __name__ == '__main__':
    cases = json.load(sys.stdin)
    print(json.dumps([derive(c) for c in cases], ensure_ascii=False))
