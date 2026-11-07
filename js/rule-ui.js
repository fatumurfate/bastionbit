'use strict';

/* BastionBit — режим «Правило» в генераторе (этап 4).

   Случайное ментальное правило (js/rule.js), пароль для выбранного сайта
   с разбором метки по шагам и «лестница утечек»: сколько бит остаётся
   взломщику после каждого утёкшего пароля. */

const BBRuleUI = (() => {
  const { $, setLevel, bindCopy, renderPassword } = BBUI;
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const MAX_SITES = 8;
  const MAX_GUESSES = 4;

  const el = {
    newRule: $('rl-new'),
    steps: $('rl-steps'),
    site: $('rl-site'),
    siteHint: $('rl-site-hint'),
    chain: $('rl-chain'),
    password: $('rl-password'),
    copy: $('rl-copy'),
    strengthBox: $('rl-strength-box'),
    strength: $('rl-strength'),
    bits: $('rl-bits'),
    sites: $('rl-sites'),
    sitesHint: $('rl-sites-hint'),
    ladder: $('rl-ladder'),
    verdict: $('rl-verdict'),
  };

  let rule = BBRule.random();
  let currentPassword = '';
  const resetCopy = bindCopy(el.copy, () => currentPassword);

  // Большие числа — как 6,1·10¹⁰ (HTML).
  function countHtml(n) {
    if (n < 1e6) return nf0.format(n);
    const e = Math.floor(Math.log10(n));
    return `${nf1.format(Math.round((n / 10 ** e) * 10) / 10)}·10<sup>${e}</sup>`;
  }

  const variantsWord = (n) => BBEntropy.plural(n < 1e6 ? n : 5, ['вариант', 'варианта', 'вариантов']);

  /* ---------- Правило ---------- */

  function renderSteps(animate) {
    el.steps.replaceChildren(...BBRule.describe(rule).map((segments, i) => {
      const item = document.createElement('li');
      const num = document.createElement('span');
      const text = document.createElement('p');
      item.className = 'rule-step';
      num.className = 'rule-step-num';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(i + 1);
      text.className = 'rule-step-text';
      segments.forEach((segment) => {
        if (segment.code === undefined) {
          text.append(segment.text);
        } else {
          const code = document.createElement('code');
          code.textContent = segment.code;
          text.append(code);
        }
      });
      item.append(num, text);
      return item;
    }));
    if (animate) BBMotion.stagger(el.steps.children, { step: 50, y: 6 });
  }

  /* ---------- Пароль для сайта ---------- */

  function renderSite(animate) {
    const name = BBRule.siteName(el.site.value);
    resetCopy();
    if (!name) {
      currentPassword = '';
      el.siteHint.textContent = el.site.value.trim() ? 'В адресе нет букв — метку не из чего сделать.' : 'Введите адрес сайта, например vk.com.';
      el.chain.replaceChildren();
      el.password.textContent = '—';
      el.copy.disabled = true;
      setLevel(el.strengthBox, 0);
      el.strength.textContent = '—';
      el.bits.textContent = '';
      return;
    }
    const info = BBRule.explain(rule, name);
    currentPassword = info.password;
    el.copy.disabled = false;
    el.siteHint.innerHTML = 'Название сайта для метки: <b></b>';
    el.siteHint.querySelector('b').textContent = name;

    el.chain.replaceChildren(...info.chain.map((step) => {
      const item = document.createElement('li');
      const inner = document.createElement('span');
      const value = document.createElement('code');
      const label = document.createElement('small');
      item.className = 'chain-step';
      inner.className = 'chain-inner';
      value.textContent = step.value;
      label.textContent = step.label;
      inner.append(value, label);
      item.append(inner);
      return item;
    }));

    // Метку в пароле подчёркиваем, чтобы было видно, что зависит от сайта
    renderPassword(el.password, info.password);
    const tagLength = Array.from(info.tag).length;
    const start = info.order === 'core' ? Array.from(info.core).length + 1 : 0;
    Array.from(el.password.children).forEach((span, i) => {
      if (i >= start && i < start + tagLength) span.classList.add('t');
    });
    if (animate) BBMotion.stagger(el.password.children, { step: 14, max: 260, y: 8 });

    const bits = BBRule.bitsWithoutLeaks(name);
    const level = BBEntropy.strength(bits);
    setLevel(el.strengthBox, level.level);
    el.strength.textContent = level.label;
    el.bits.textContent = `${BBEntropy.formatBits(bits)}, пока нет утечек`;
  }

  /* ---------- Лестница утечек ---------- */

  function parseSites(value) {
    const list = [];
    const seen = new Set();
    let bad = 0;
    for (const part of value.split(/[,;\s]+/)) {
      if (!part) continue;
      const name = BBRule.siteName(part);
      if (!name) {
        bad++;
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      list.push({ name, domain: BBKeyword.normalizeSite(part) });
    }
    return { list: list.slice(0, MAX_SITES), cut: list.length > MAX_SITES, bad };
  }

  function stepTitle(k, sites) {
    if (k === 0) return 'Утечек нет';
    return `${k === 1 ? 'Утёк пароль' : 'Утёк ещё пароль'} от ${sites[k - 1].domain}`;
  }

  function guessList(step) {
    const list = document.createElement('ul');
    list.className = 'leak-guesses';
    list.setAttribute('aria-label', 'Что попробует взломщик');
    const shown = step.guesses.slice(0, MAX_GUESSES);
    if (!shown.includes(step.password)) shown[shown.length - 1] = step.password;
    shown.forEach((guess) => {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = guess;
      item.append(code);
      if (guess === step.password) {
        item.className = 'is-hit';
        item.title = 'Настоящий пароль';
      }
      list.append(item);
    });
    if (step.guesses.length > shown.length) {
      const more = document.createElement('li');
      more.className = 'leak-more';
      more.textContent = `ещё ${step.guesses.length - shown.length}`;
      list.append(more);
    }
    return list;
  }

  function stepItem(step, k, sites) {
    const item = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('p');
    const target = document.createElement('p');
    const bar = document.createElement('div');
    const fill = document.createElement('span');
    const bits = document.createElement('p');

    const level = BBEntropy.strength(step.bits).level;
    const share = Math.max(0.015, Math.min(1, step.bits / BBRule.TOTAL_BITS));
    item.className = 'leak-step';
    item.dataset.level = String(level);
    item.style.setProperty('--fill', share.toFixed(3));
    info.className = 'leak-info';
    title.className = 'leak-title';
    title.textContent = stepTitle(k, sites);
    target.className = 'leak-target';
    target.innerHTML = step.variants === 1
      ? 'Пароль от <b></b> угадывается с первой попытки'
      : `Пароль от <b></b>: ${countHtml(step.variants)} ${variantsWord(step.variants)}`;
    target.querySelector('b').textContent = sites[k].domain;
    info.append(title, target);
    bar.className = 'leak-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.append(fill);
    bits.className = 'leak-bits';
    bits.textContent = BBEntropy.formatBits(step.bits);
    item.append(info, bits, bar);
    if (step.guesses) item.append(guessList(step));
    return { item, fill, share };
  }

  function renderLadder(animate) {
    const { list, cut, bad } = parseSites(el.sites.value);
    const notes = [];
    if (bad) notes.push(`${bad} ${BBEntropy.plural(bad, ['адрес', 'адреса', 'адресов'])} без букв пропущено.`);
    if (cut) notes.push(`Учтены первые ${MAX_SITES} сайтов.`);
    if (list.length < 2) {
      el.sitesHint.textContent = 'Нужно хотя бы два сайта — через запятую.';
      el.ladder.replaceChildren();
      el.verdict.textContent = '';
      el.verdict.hidden = true;
      return;
    }
    el.sitesHint.textContent = notes.length ? notes.join(' ') : `Через запятую, до ${MAX_SITES} сайтов. Первый — тот, что утёк первым.`;

    const result = BBRule.leaks(rule, list.map((s) => s.name));
    const rows = result.steps.map((step, k) => stepItem(step, k, list));
    el.ladder.replaceChildren(...rows.map((row) => row.item));
    if (animate) {
      rows.forEach((row, k) => {
        BBMotion.enter(row.item, { y: 8, duration: 380, delay: k * 70 });
        BBMotion.animate(row.fill, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${row.share})` }],
          { duration: 700, delay: 120 + k * 90, fill: 'backwards' });
      });
    }

    const first = result.steps[1];
    let text;
    if (result.revealedAt === 1) {
      text = 'Хватило одной утечки: правило раскрыто. Пароль от любого другого сайта взломщик угадает с первой попытки.';
    } else if (result.revealedAt) {
      text = `Правило раскрыто после ${result.revealedAt} утечек — дальше каждый пароль угадывается с первой попытки. ` +
        `Уже после первой утечки пароль от ${list[1].domain} — ${first.variants === 1 ? 'с первой попытки' : `не больше ${first.variants} попыток`}.`;
    } else {
      text = `После ${list.length} утечек подходят ещё ${result.remaining} ${BBEntropy.plural(result.remaining, ['правило', 'правила', 'правил'])} — ` +
        `для нового сайта это всего ${result.remaining} ${BBEntropy.plural(result.remaining, ['попытка', 'попытки', 'попыток'])}.`;
    }
    el.verdict.textContent = text;
    el.verdict.hidden = false;
  }

  /* ---------- События ---------- */

  function newRule() {
    rule = BBRule.random();
    renderSteps(true);
    renderSite(true);
    renderLadder(true);
  }

  el.newRule.addEventListener('click', () => {
    BBMotion.spin(el.newRule);
    newRule();
  });
  el.site.addEventListener('input', () => renderSite(false));
  el.sites.addEventListener('input', () => renderLadder(false));

  renderSteps(false);
  renderSite(false);
  renderLadder(false);

  // Вызывается при открытии режима: лестница «вырастает» заново.
  function show() {
    renderLadder(true);
  }

  return { show, current: () => ({ ...rule }) };
})();
