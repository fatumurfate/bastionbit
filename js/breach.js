'use strict';

/* BastionBit — проверка пароля по базе утечек (этап 4).

   Сервис Pwned Passwords (Have I Been Pwned, Troy Hunt) знает около двух
   миллиардов паролей из реальных утечек. Сам пароль ему не отправляем —
   работает k-анонимность:
     1. Браузер считает SHA-1 пароля: 40 шестнадцатеричных символов.
     2. На сервер уходят только первые 5 из них. Такое же начало у одного
        из 16⁵ = 1 048 576 «корзин», в каждой около 2 000 хешей.
     3. Сервер возвращает все хеши корзины (без первых 5 символов)
        и сколько раз каждый встречался в утечках.
     4. Свой хеш ищем в ответе здесь, в браузере.
   Сервер не узнаёт ни пароль, ни даже его полный хеш. Заголовок
   Add-Padding просит добавить в ответ пустые строки со счётчиком 0,
   чтобы по размеру ответа нельзя было угадать корзину.

   Запрос уходит, только когда вы нажимаете «Проверить». */

const BBBreach = (() => {
  const API = 'https://api.pwnedpasswords.com/range/';
  const PREFIX = 5;

  async function sha1(text) {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Ответ сервера: строки «СУФФИКС:ЧИСЛО». Пустышки (число 0) не считаем.
  function parse(body, suffix) {
    let count = 0;
    let entries = 0;
    let padding = 0;
    for (const line of String(body).split('\n')) {
      const [hash, times] = line.trim().split(':');
      if (!hash || times === undefined) continue;
      const n = Number(times);
      if (!n) {
        padding++;
        continue;
      }
      entries++;
      if (hash.toUpperCase() === suffix) count = n;
    }
    return { count, entries, padding };
  }

  // options.fetch — для тестов; options.signal — чтобы отменить запрос.
  async function check(password, options = {}) {
    const request = options.fetch || ((url, init) => fetch(url, init));
    const hash = await sha1(password);
    const prefix = hash.slice(0, PREFIX);
    const suffix = hash.slice(PREFIX);
    const response = await request(API + prefix, {
      headers: { 'Add-Padding': 'true' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Сервис ответил кодом ${response.status}`);
    const body = await response.text();
    return { hash, prefix, suffix, ...parse(body, suffix) };
  }

  return { API, PREFIX, sha1, parse, check };
})();
