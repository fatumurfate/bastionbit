'use strict';

/* BastionBit — дополнения анализатора (этап 4): личные данные,
   проверка по базе утечек и похожесть на другие ваши пароли.

   app.js спрашивает personal() перед каждым анализом и сообщает
   результат через update(). Всё, что вы вводите здесь, живёт только
   в памяти страницы; в сеть уходят лишь 5 символов хеша — и только
   после нажатия «Проверить». */

const BBExtrasUI = (() => {
  const { $ } = BBUI;
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  const MAX_SIMILAR = 5;

  /* ---------- Личные данные ---------- */

  const pd = {
    box: $('pd-box'),
    summary: $('pd-summary'),
    clear: $('pd-clear'),
    fields: Object.fromEntries(BBPersonal.FIELDS.map((field) => [field.id, $('pd-' + field.id)])),
  };
  let personal = BBPersonal.prepare({});
  const listeners = [];

  function readPersonal() {
    const values = {};
    Object.entries(pd.fields).forEach(([id, input]) => { values[id] = input.value; });
    personal = BBPersonal.prepare(values);
    const k = personal.size;
    pd.summary.textContent = k ? `${k} ${BBEntropy.plural(k, ['запись', 'записи', 'записей'])}` : 'не указаны';
    pd.box.classList.toggle('has-data', k > 0);
    listeners.forEach((fn) => fn());
  }

  Object.values(pd.fields).forEach((input) => input.addEventListener('input', readPersonal));
  pd.clear.addEventListener('click', () => {
    Object.values(pd.fields).forEach((input) => { input.value = ''; });
    readPersonal();
    pd.fields.name.focus();
  });
  BBMotion.details(pd.box);

  /* ---------- Проверка утечек ---------- */

  const br = {
    box: $('an-breach-box'),
    text: $('an-breach-text'),
    button: $('an-breach-check'),
    label: $('an-breach-check').querySelector('.button-label'),
    hash: $('an-breach-hash'),
    meta: $('an-breach-meta'),
  };
  let password = '';
  let reveal = false;
  let detectorBits = 0;
  let breach = null;           // { password, result } последней проверки
  let request = null;          // AbortController текущего запроса

  function setBreach(state, html) {
    br.box.dataset.state = state;
    br.text.innerHTML = html;
    const busy = state === 'loading';
    br.button.disabled = busy;
    br.button.classList.toggle('is-busy', busy);
    br.label.textContent = busy ? 'Проверяю…' : state === 'idle' ? 'Проверить' : 'Проверить снова';
  }

  // Хеш: первые 5 символов (ушли на сервер) выделены, остальное — только
  // если пароль показан на экране.
  function renderHash(result) {
    if (!result) {
      br.hash.hidden = true;
      br.meta.textContent = '';
      return;
    }
    br.hash.hidden = false;
    const sent = document.createElement('mark');
    sent.textContent = result.prefix;
    br.hash.replaceChildren(sent, reveal ? result.suffix : '•'.repeat(result.suffix.length));
    br.meta.textContent = `На сервер ушли только выделенные 5 символов. В ответе ${nf0.format(result.entries)} ` +
      `${BBEntropy.plural(result.entries, ['хеш', 'хеша', 'хешей'])} с таким же началом и ${nf0.format(result.padding)} ` +
      `${BBEntropy.plural(result.padding, ['пустышка', 'пустышки', 'пустышек'])} для маскировки — свой хеш браузер нашёл сам.`;
  }

  function idleBreach() {
    if (request) request.abort();
    request = null;
    breach = null;
    setBreach('idle', 'Сам пароль не отправляется — только первые 5 символов его хеша.');
    renderHash(null);
  }

  function showBreach(result) {
    if (result.count > 0) {
      const times = BBEntropy.plural(result.count, ['раз', 'раза', 'раз']);
      setBreach('found', `<strong>Найден в утечках: ${nf0.format(result.count)} ${times}.</strong> ` +
        'Такие пароли взломщики проверяют первыми. Не используйте его нигде.');
    } else {
      setBreach('clean', '<strong>В известных утечках не найден.</strong> ' +
        (detectorBits < BBEntropy.LEVELS[3].min
          ? 'Но это ещё не значит, что он стойкий: посмотрите оценку выше.'
          : 'Хороший знак — и оценка выше тоже высокая.'));
    }
    renderHash(result);
  }

  async function checkBreach() {
    if (!password) return;
    if (request) request.abort();
    const controller = new AbortController();
    request = controller;
    const checked = password;
    setBreach('loading', 'Считаю хеш и спрашиваю сервис…');
    renderHash(null);
    try {
      const result = await BBBreach.check(checked, { signal: controller.signal });
      if (request !== controller) return;           // пароль успели поменять
      request = null;
      breach = { password: checked, result };
      showBreach(result);
    } catch (error) {
      if (request !== controller) return;
      request = null;
      setBreach('error', '<strong>Не получилось проверить.</strong> Нет связи с сервисом — проверьте интернет и попробуйте ещё раз.');
      console.warn(error.message);
    }
  }

  br.button.addEventListener('click', checkBreach);

  /* ---------- Похожесть ---------- */

  const sm = {
    list: $('an-similar-list'),
    add: $('an-similar-add'),
  };
  const rows = [];

  // «с первой попытки», «за ≈ 1 786 попыток», «за ≈ 2,1·10^9 попыток»
  function attemptsText(bits) {
    const n = 2 ** bits;
    if (n < 1.5) return 'с первой попытки';
    if (n < 1e6) {
      const count = Math.round(n);
      return `за ≈ ${nf0.format(count)} ${BBEntropy.plural(count, ['попытку', 'попытки', 'попыток'])}`;
    }
    const e = Math.floor(Math.log10(n));
    return `за ≈ ${nf1.format(Math.round((n / 10 ** e) * 10) / 10)}·10^${e} попыток`;
  }

  function opsText(ops) {
    const q = (ch) => `«${ch}»`;
    return ops.slice(0, 4).map((op) => {
      if (op.type === 'replace') return `${q(op.from)} → ${q(op.to)}`;
      if (op.type === 'insert') return `+ ${q(op.to)}`;
      return `− ${q(op.from)}`;
    }).join(', ') + (ops.length > 4 ? ` и ещё ${ops.length - 4}` : '');
  }

  function renderRow(row) {
    const other = row.input.value;
    row.result.hidden = !other || !password;
    row.ops.hidden = true;
    if (row.result.hidden) return;
    const c = BBSimilar.compare(other, password, detectorBits);
    const level = BBEntropy.strength(c.bits).level;
    row.result.dataset.level = String(level);
    let verdict;
    if (c.distance === 0) verdict = 'Тот же самый пароль';
    else if (c.distance <= 2) verdict = `Почти такой же: ${c.distance} ${BBEntropy.plural(c.distance, ['правка', 'правки', 'правок'])}`;
    else if (c.similarity >= 0.5) verdict = `Похож: ${c.distance} ${BBEntropy.plural(c.distance, ['правка', 'правки', 'правок'])}`;
    else verdict = `Непохож: ${c.distance} ${BBEntropy.plural(c.distance, ['правка', 'правки', 'правок'])}`;
    row.verdict.textContent = verdict;
    row.bits.textContent = c.distance === 0 ? '0 бит' : BBEntropy.formatBits(c.bits);
    if (c.distance === 0) row.note.textContent = 'Если один из них утечёт, второй уже известен.';
    else if (c.near > detectorBits + 0.05) {
      row.note.textContent = `Похожесть тут не главное: проверяемый пароль и без подсказки подбирается ${attemptsText(detectorBits)}.`;
    } else row.note.textContent = `Зная этот пароль, взломщик найдёт проверяемый ${attemptsText(c.bits)}.`;
    if (reveal && c.ops.length) {
      row.ops.hidden = false;
      row.ops.textContent = `Правки: ${opsText(c.ops)}`;
    }
  }

  function addRow(focus = false) {
    if (rows.length >= MAX_SIMILAR) return;
    const item = document.createElement('li');
    item.className = 'similar-item';
    item.innerHTML =
      '<div class="similar-row">' +
        '<input class="input similar-input" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Другой ваш пароль">' +
        '<button class="icon-button similar-remove" type="button" aria-label="Убрать пароль" title="Убрать">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="similar-result" hidden>' +
        '<p class="similar-head"><span class="similar-verdict"></span><span class="similar-bits"></span></p>' +
        '<p class="similar-note"></p>' +
        '<p class="similar-ops" hidden></p>' +
      '</div>';
    const row = {
      item,
      input: item.querySelector('.similar-input'),
      remove: item.querySelector('.similar-remove'),
      result: item.querySelector('.similar-result'),
      verdict: item.querySelector('.similar-verdict'),
      bits: item.querySelector('.similar-bits'),
      note: item.querySelector('.similar-note'),
      ops: item.querySelector('.similar-ops'),
    };
    row.input.type = reveal ? 'text' : 'password';
    row.input.addEventListener('input', () => renderRow(row));
    row.remove.addEventListener('click', () => {
      const index = rows.indexOf(row);
      if (rows.length === 1) {
        row.input.value = '';
        renderRow(row);
        row.input.focus();
        return;
      }
      rows.splice(index, 1);
      item.remove();
      syncRows();
      rows[Math.min(index, rows.length - 1)].input.focus();
    });
    rows.push(row);
    sm.list.append(item);
    syncRows();
    BBMotion.enter(item, { y: 6, duration: 320 });
    if (focus) row.input.focus();
  }

  function syncRows() {
    rows.forEach((row, i) => row.input.setAttribute('aria-label', `Другой пароль ${i + 1}`));
    sm.add.hidden = rows.length >= MAX_SIMILAR;
  }

  sm.add.addEventListener('click', () => addRow(true));
  addRow();

  /* ---------- Связь с анализатором ---------- */

  // Новый пароль, режим показа или оценка детектора.
  function update(state) {
    const changed = state.password !== password;
    password = state.password;
    reveal = Boolean(state.reveal);
    detectorBits = state.bits || 0;
    if (changed || !password) idleBreach();
    else if (breach) showBreach(breach.result);    // перерисовать хеш при показе/скрытии
    rows.forEach((row) => {
      row.input.type = reveal ? 'text' : 'password';
      renderRow(row);
    });
  }

  return {
    personal: () => personal,
    onPersonalChange: (fn) => listeners.push(fn),
    update,
  };
})();
