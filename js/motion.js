'use strict';

/* BastionBit — плавные анимации интерфейса (этапы 2–3).

   Наведение, нажатие и фокус оживляет CSS (раздел «Анимации» в style.css).
   Здесь — то, что одним CSS не сделать: бегунок под активной вкладкой
   и в переключателях, плавное открытие <details>, появление блоков
   с нужной стороны, «волна» символов и плавная смена чисел.

   Все анимации — через Web Animations API (element.animate): они ничего
   не меняют в разметке и сами исчезают по окончании. Анимации работают
   всегда, в том числе при системной настройке «Уменьшить движение».
   Только если браузер совсем не умеет element.animate, функции сразу
   показывают итог. */

const BBMotion = (() => {
  const unsupported = () => typeof Element.prototype.animate !== 'function';
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';   // быстрый старт, мягкая остановка

  function animate(element, keyframes, options = {}) {
    if (unsupported() || !element) return null;
    return element.animate(keyframes, { duration: 320, easing: EASE, ...options });
  }

  // Появление: блок проявляется и чуть сдвигается на место.
  // x > 0 — приезжает справа, x < 0 — слева, y > 0 — снизу.
  function enter(element, { x = 0, y = 8, duration = 420, delay = 0 } = {}) {
    return animate(element, [
      { opacity: 0, transform: `translate(${x}px, ${y}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration, delay, fill: 'backwards' });
  }

  // Показывает скрытый блок с анимацией. Уже видимый не трогает.
  function show(element, options) {
    if (!element.hidden) return false;
    element.hidden = false;
    enter(element, options);
    return true;
  }

  // Появление по очереди: символы пароля, слова фразы, строки списка.
  // Вся «волна» укладывается в max миллисекунд, как бы ни было много элементов.
  function stagger(elements, { step = 18, max = 320, x = 0, y = 6, duration = 360 } = {}) {
    if (unsupported()) return;
    const list = Array.from(elements);
    const each = list.length > 1 ? Math.min(step, max / (list.length - 1)) : 0;
    list.forEach((element, i) => enter(element, { x, y, duration, delay: i * each }));
  }

  // Иконка «обновить» делает оборот.
  function spin(button) {
    animate(button.querySelector('svg'), [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(360deg)' },
    ], { duration: 560 });
  }

  // Короткий «щелчок» — для галочек и подтверждений.
  function pop(element) {
    animate(element, [
      { transform: 'scale(.7)' },
      { transform: 'scale(1.12)', offset: 0.55 },
      { transform: 'scale(1)' },
    ], { duration: 320 });
  }

  // Короткая тряска — неверный ввод.
  function shake(element) {
    animate(element, [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)', offset: 0.2 },
      { transform: 'translateX(5px)', offset: 0.45 },
      { transform: 'translateX(-3px)', offset: 0.7 },
      { transform: 'translateX(0)' },
    ], { duration: 380, easing: 'ease-out' });
  }

  // Плавная смена числа: «37,4 бита» → «52,8 бита». Первое значение
  // ставится сразу; если число меняется на ходу, анимация продолжается
  // с того, что уже на экране.
  const tweens = new WeakMap();

  function tween(element, value, format, { duration = 450 } = {}) {
    const state = tweens.get(element);
    if (state && state.frame) cancelAnimationFrame(state.frame);
    const from = state ? state.value : value;
    if (unsupported() || !state || from === value || !Number.isFinite(from) || !Number.isFinite(value)) {
      tweens.set(element, { value, frame: 0 });
      element.textContent = format(value);
      return;
    }
    const next = { value: from, frame: 0 };
    tweens.set(element, next);
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      next.value = p < 1 ? from + (value - from) * (1 - (1 - p) ** 3) : value;
      element.textContent = format(next.value);
      next.frame = p < 1 ? requestAnimationFrame(step) : 0;
    };
    next.frame = requestAnimationFrame(step);
  }

  // Положение элемента внутри контейнера с точностью до долей пикселя
  // (offsetLeft и offsetWidth округляют до целых).
  function boxIn(container, element) {
    const outer = container.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    return {
      x: inner.left - outer.left - container.clientLeft + container.scrollLeft,
      y: inner.top - outer.top - container.clientTop + container.scrollTop,
      width: inner.width,
      height: inner.height,
    };
  }

  // Подложка, которая ездит за выбранным вариантом переключателя.
  // Возвращает функцию: её вызывают, если вариант выбран из кода.
  function segmented(group) {
    const thumb = document.createElement('span');
    thumb.className = 'segment-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    group.prepend(thumb);
    group.classList.add('has-thumb');
    const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
    let placed = false;

    function place(instant = false) {
      const radio = radios.find((r) => r.checked);
      const option = radio && radio.closest('.mode-option');
      if (!option || !option.offsetWidth) {   // группа скрыта — измерить нельзя
        placed = false;
        return;
      }
      const still = instant || !placed || unsupported();
      const box = boxIn(group, option);
      if (still) thumb.style.transition = 'none';
      thumb.style.width = `${box.width}px`;
      thumb.style.height = `${box.height}px`;
      thumb.style.transform = `translate(${box.x}px, ${box.y}px)`;
      if (still) {
        void thumb.offsetWidth;   // применить положение без анимации
        thumb.style.transition = '';
      }
      thumb.classList.add('is-placed');
      placed = true;
    }

    radios.forEach((radio) => radio.addEventListener('change', () => place()));
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => place(true));
      observer.observe(group);
      radios.forEach((radio) => observer.observe(radio.closest('.mode-option')));
    }
    place(true);
    return place;
  }

  // Полоска под активной вкладкой. Отступ от краёв вкладки — CSS-переменная --tab-inset.
  function indicator(container, tabs) {
    const bar = document.createElement('span');
    bar.className = 'tab-indicator';
    bar.setAttribute('aria-hidden', 'true');
    container.append(bar);
    container.classList.add('has-indicator');
    let current = null;
    let placed = false;

    function move(tab, instant = false) {
      if (tab) current = tab;
      if (!current || !current.offsetWidth) return;
      const inset = parseFloat(getComputedStyle(container).getPropertyValue('--tab-inset')) || 0;
      const still = instant || !placed || unsupported();
      const box = boxIn(container, current);
      if (still) bar.style.transition = 'none';
      bar.style.width = `${box.width - 2 * inset}px`;
      bar.style.transform = `translateX(${box.x + inset}px)`;
      if (still) {
        void bar.offsetWidth;
        bar.style.transition = '';
      }
      placed = true;
    }

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => move(null, true));
      tabs.forEach((tab) => observer.observe(tab));
    }
    return move;
  }

  // Плавное открытие и закрытие <details>: меняется высота, содержимое проявляется.
  function details(element) {
    const summary = element.querySelector('summary');
    const body = summary.nextElementSibling;
    let animation = null;
    let closing = false;

    function finish(open) {
      element.open = open;
      element.classList.remove('is-closing');
      element.style.overflow = '';
      animation = null;
      closing = false;
    }

    function resize(from, to, open) {
      animation = element.animate({ height: [`${from}px`, `${to}px`] }, { duration: 320, easing: EASE });
      animation.onfinish = () => finish(open);
    }

    summary.addEventListener('click', (event) => {
      if (unsupported()) return;   // обычное мгновенное открытие
      event.preventDefault();
      const start = element.offsetHeight;   // мерим до отмены прошлой анимации
      const frame = element.offsetHeight - element.clientHeight;   // рамка сверху и снизу
      if (animation) {
        animation.onfinish = null;
        animation.cancel();
      }
      element.style.overflow = 'hidden';
      if (element.open && !closing) {
        closing = true;
        element.classList.add('is-closing');
        resize(start, summary.offsetHeight + frame, false);
      } else {
        const wasClosed = !element.open;
        closing = false;
        element.classList.remove('is-closing');
        element.open = true;
        resize(start, summary.offsetHeight + body.offsetHeight + frame, true);
        if (wasClosed) enter(body, { y: -6, duration: 320 });
      }
    });
  }

  return { EASE, unsupported, animate, enter, show, stagger, spin, pop, shake, tween, segmented, indicator, details };
})();
