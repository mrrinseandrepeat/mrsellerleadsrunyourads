'use strict';

const $ = (id) => document.getElementById(id);
let templates = [];

// ---- helpers ----

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    showLogin();
    throw new Error(data.error || 'Please log in');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.problems = data.problems || [];
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function show(view) {
  for (const id of ['login-view', 'form-view', 'result-view']) $(id).hidden = id !== view;
  window.scrollTo(0, 0);
}

function busy(text) {
  $('busy-text').textContent = text || '';
  $('busy').hidden = !text;
}

function showErrors(target, message, problems = []) {
  target.replaceChildren();
  if (!message) return;
  target.append(el('strong', { text: message }));
  if (problems.length) target.append(el('ul', {}, ...problems.map((p) => el('li', { text: p }))));
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older phones: select the text so a long-press copy works.
    const area = $('result-link');
    area.focus();
    area.select();
    document.execCommand('copy');
  }
  const old = button.textContent;
  button.textContent = 'Copied!';
  setTimeout(() => { button.textContent = old; }, 1800);
}

// ---- login ----

function showLogin() {
  $('who').textContent = '';
  $('logout').hidden = true;
  show('login-view');
  $('pin').value = '';
  $('pin').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('POST', '/api/login', { pin: $('pin').value });
    await start();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  showLogin();
});

// ---- form ----

function renderForm() {
  const template = templates.find((t) => t.id === $('template-picker').value);
  const box = $('fields');
  box.replaceChildren();
  for (const f of template.formFields) {
    if (f.section) box.append(el('h3', { class: 'section', text: f.section }));
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.key, required: f.required },
        el('option', { value: '', text: 'Choose...' }),
        ...f.options.map((o) => el('option', { value: o.value, text: o.label })));
    } else {
      const attrs = { name: f.key, required: f.required, maxlength: f.maxLength, autocomplete: 'off' };
      if (f.type === 'email') Object.assign(attrs, { type: 'email', inputmode: 'email', autocapitalize: 'off' });
      else if (f.type === 'money') Object.assign(attrs, { type: 'text', inputmode: 'decimal', placeholder: '$' });
      else if (f.type === 'int') Object.assign(attrs, { type: 'text', inputmode: 'numeric', pattern: '[0-9]*' });
      else Object.assign(attrs, { type: 'text', inputmode: f.inputmode, autocapitalize: f.uppercase ? 'characters' : 'words' });
      input = el('input', attrs);
    }
    box.append(el('label', {},
      document.createTextNode(f.label + ' '),
      f.required ? el('span', { class: 'req', text: '*' }) : null,
      f.hint ? el('span', { class: 'hint', text: `(${f.hint})` }) : null,
      input));
  }
}

$('template-picker').addEventListener('change', renderForm);
$('fields').addEventListener('input', (e) => e.target.classList.remove('invalid'));

$('offer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const template = templates.find((t) => t.id === $('template-picker').value);
  const values = {};
  for (const f of template.formFields) values[f.key] = form.elements[f.key].value;

  // Quick check on the phone; the server checks everything again.
  const missing = template.formFields.filter((f) => f.required && !values[f.key].trim());
  for (const f of template.formFields) form.elements[f.key].classList.toggle('invalid', missing.includes(f));
  if (missing.length) {
    showErrors($('form-errors'), 'Please fill in:', missing.map((f) => f.label));
    return;
  }
  showErrors($('form-errors'), '');

  $('submit').disabled = true;
  busy('Creating the document, filling it, and checking every field...');
  try {
    const res = await api('POST', '/api/offers', { templateId: template.id, values });
    showResult(res.link, `${res.offer.seller} · ${res.offer.address} · ${res.offer.price} · ${res.fieldsVerified} fields checked`);
    form.reset();
  } catch (err) {
    showErrors($('form-errors'), err.message, err.problems);
    $('form-errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    busy('');
    $('submit').disabled = false;
  }
});

// ---- result ----

function showResult(link, summary, title = 'Ready to sign') {
  $('result-title').textContent = title;
  $('result-summary').textContent = summary;
  $('result-link').value = link;
  $('sms-link').href = 'sms:?&body=' + encodeURIComponent('Here is the offer to review and sign: ' + link);
  show('result-view');
}

$('copy-link').addEventListener('click', (e) => copyText($('result-link').value, e.target));
$('back-to-form').addEventListener('click', () => { show('form-view'); selectTab('new'); });

// ---- tabs ----

function selectTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const n of ['new', 'history', 'activity']) $('tab-' + n).hidden = n !== name;
  if (name === 'history') loadHistory();
  if (name === 'activity') loadActivity();
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => selectTab(t.dataset.tab));
$('refresh-history').addEventListener('click', loadHistory);

const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

async function loadHistory() {
  const list = $('history-list');
  list.replaceChildren(el('p', { class: 'muted', text: 'Loading...' }));
  try {
    const { offers } = await api('GET', '/api/offers');
    list.replaceChildren();
    if (!offers.length) list.append(el('p', { class: 'muted', text: 'No offers yet.' }));
    for (const o of offers) list.append(renderOffer(o));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'error', text: err.message }));
  }
}

function renderOffer(o) {
  const badgeClass = o.status === 'Signed' ? 'badge signed' : /Failed|Declined|Expired/.test(o.status) ? 'badge bad' : 'badge';
  const row = el('div', { class: 'offer' },
    el('div', { class: 'top' }, el('span', { text: o.seller }), el('span', { text: o.price })),
    el('div', { text: o.address }),
    el('div', { class: 'meta', text: `${timeFmt.format(new Date(o.createdAt))} · by ${o.createdBy} · ${o.templateName}` }),
    el('span', { class: badgeClass, text: o.status }));
  if (o.canRegenerate) {
    const btn = el('button', { class: 'secondary', text: 'Regenerate link' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      busy('Getting a fresh signing link...');
      try {
        const { link } = await api('POST', `/api/offers/${o.id}/link`);
        showResult(link, `${o.seller} · ${o.address} · ${o.price}`, 'New signing link');
      } catch (err) {
        alert(err.message);
      } finally {
        busy('');
        btn.disabled = false;
      }
    });
    row.append(btn);
  }
  return row;
}

async function loadActivity() {
  const list = $('activity-list');
  try {
    const { entries } = await api('GET', '/api/activity');
    list.replaceChildren(...entries.map((e) => {
      const { at, action, user, ...rest } = e;
      const details = Object.entries(rest).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join(' · ');
      return el('div', { class: 'log-entry' },
        el('strong', { text: `${timeFmt.format(new Date(at))} · ${action}${user ? ' · ' + user : ''}` }),
        el('div', { class: 'muted', text: details }));
    }));
  } catch (err) {
    list.replaceChildren(el('p', { class: 'error', text: err.message }));
  }
}

// ---- start ----

async function start() {
  let me;
  try {
    me = await api('GET', '/api/me');
  } catch {
    return; // api() already showed the PIN screen
  }
  templates = me.templates;
  $('who').textContent = me.name;
  $('logout').hidden = false;
  $('activity-tab').hidden = !me.isAdmin;
  $('config-warning').hidden = me.signnowConfigured;
  const picker = $('template-picker');
  picker.replaceChildren(...templates.map((t) => el('option', { value: t.id, text: t.name })));
  renderForm();
  show('form-view');
  selectTab('new');
}

start();
