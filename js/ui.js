'use strict';

/* BastionBit — общие помощники интерфейса (этап 3).

   Ими пользуются app.js (вкладки, генератор, анализатор) и trainer-ui.js
   (тренажёр): кнопки «Копировать» и «Показать», подсветка цифр
   и символов, загрузка скриптов по требованию. */

const BBUI = (() => {
  const $ = (id) => document.getElementById(id);

  // Уровень стойкости 0–4 задаёт цвет индикатора и подписи (style.css).
  function setLevel(element, level) {
    element.dataset.level = String(level);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Запасной способ для старых браузеров и локально открытых файлов
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
      return ok;
    }
  }

  // Кнопка «Копировать» с подтверждением. Возвращает функцию сброса надписи.
  function bindCopy(button, getText) {
    const label = button.querySelector('.button-label');
    let timer = 0;
    function reset() {
      clearTimeout(timer);
      button.classList.remove('is-done');
      label.textContent = 'Копировать';
    }
    button.addEventListener('click', async () => {
      const ok = await copyText(getText());
      button.classList.toggle('is-done', ok);
      label.textContent = ok ? 'Скопировано' : 'Не получилось';
      if (ok) BBMotion.pop(button.querySelector('.icon-check'));
      clearTimeout(timer);
      timer = setTimeout(reset, 1800);
    });
    return reset;
  }

  // Кнопка с глазом: показать или скрыть содержимое поля.
  // Возвращает функцию set(show) — переключить из кода, без анимации.
  function bindToggle(button, input, showLabel, hideLabel, onToggle) {
    function set(show) {
      input.type = show ? 'text' : 'password';
      button.classList.toggle('is-visible', show);
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? hideLabel : showLabel);
    }
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      set(show);
      BBMotion.pop(button.querySelector(show ? '.icon-eye-off' : '.icon-eye'));
      if (onToggle) onToggle();
    });
    return set;
  }

  // Цифры и символы подсвечиваются цветом — так их легче различать.
  function renderPassword(element, password) {
    const spans = Array.from(password, (ch) => {
      const span = document.createElement('span');
      span.textContent = ch;
      if (/[0-9]/.test(ch)) span.className = 'd';
      else if (!/[\p{L}\s]/u.test(ch)) span.className = 's';
      return span;
    });
    element.replaceChildren(...spans);
  }

  // Скрипты, которые нужны не сразу, загружаются один раз по требованию.
  const scripts = new Map();

  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Не загрузился ${src}`));
        document.head.append(script);
      }));
    }
    return scripts.get(src);
  }

  const idle = (fn) => ('requestIdleCallback' in window
    ? requestIdleCallback(fn, { timeout: 400 })
    : setTimeout(fn, 1));

  // Словари детектора хитростей (≈ 2,2 МБ) нужны анализатору и тренажёру.
  let dictionaries = null;

  function loadDictionaries() {
    if (!dictionaries) {
      dictionaries = Promise.all(['data/top-passwords.js', 'data/dict-ru.js', 'data/dict-en.js', 'data/dict-names.js'].map(loadScript))
        .then(() => new Promise((resolve) => idle(() => {
          BBPatterns.prepare();   // строит словари поиска заранее (≈ 0,1 с)
          resolve();
        })));
    }
    return dictionaries;
  }

  return { $, setLevel, copyText, bindCopy, bindToggle, renderPassword, loadScript, loadDictionaries };
})();
