'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../server');
const { Store } = require('../lib/store');
const { FakeSignNow } = require('./fake-signnow');

const FORM = {
  sellerName: 'John Q Testseller', sellerEmail: 'test.seller@example.com',
  street: '123 Test St', city: 'Chicago', state: 'IL', zip: '60601',
  price: '150000', emd: '1000', closingDays: '30', inspectionDays: '10',
  personalProperty: 'LEAVE', occupancy: 'VACANT',
};

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offer-app-'));
  const store = new Store(dir);
  const signnow = new FakeSignNow();
  const app = createApp({
    env: { ACCESS_PINS: 'Matt:111111,Mike:222222', ADMIN_USERS: 'Matt', SESSION_SECRET: 'test-secret' },
    signnow,
    store,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { server, call, store, signnow, dir, logout: () => { cookie = ''; } };
}

test('PIN gate, offer creation, history, regenerate, log', async (t) => {
  const { server, call, store, logout } = await startApp();
  t.after(() => server.close());

  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/offers', { templateId: 'offer-to-purchase', values: FORM })).status, 401);
  assert.equal((await call('POST', '/api/login', { pin: '999999' })).status, 401);

  const login = await call('POST', '/api/login', { pin: '222222' });
  assert.equal(login.status, 200);
  assert.equal(login.body.name, 'Mike');

  const me = await call('GET', '/api/me');
  assert.equal(me.body.isAdmin, false);
  assert.equal(me.body.templates[0].id, 'offer-to-purchase');
  assert.ok(!JSON.stringify(me.body).includes('335ba194'), 'template ID stays on the server');

  const bad = await call('POST', '/api/offers', { templateId: 'offer-to-purchase', values: { ...FORM, price: '' } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.problems, ['Purchase price is required']);

  const ok = await call('POST', '/api/offers', { templateId: 'offer-to-purchase', values: FORM });
  assert.equal(ok.status, 200);
  assert.match(ok.body.link, /signnow\.com/);
  assert.equal(ok.body.fieldsVerified, 26);
  assert.equal(ok.body.offer.price, '$150,000.00');

  const hist = await call('GET', '/api/offers');
  assert.equal(hist.body.offers.length, 1);
  assert.equal(hist.body.offers[0].createdBy, 'Mike');
  assert.equal(hist.body.offers[0].canRegenerate, true);
  assert.ok(!('groupId' in hist.body.offers[0]));

  const regen = await call('POST', `/api/offers/${ok.body.offer.id}/link`);
  assert.equal(regen.status, 200);
  assert.match(regen.body.link, /signnow\.com/);

  assert.equal((await call('GET', '/api/activity')).status, 403);
  logout();
  await call('POST', '/api/login', { pin: '111111' });
  const log = await call('GET', '/api/activity');
  assert.equal(log.status, 200);
  const actions = log.body.entries.map((e) => e.action);
  assert.ok(actions.includes('offer_created') && actions.includes('link_regenerated') && actions.includes('login_failed'));
  const created = log.body.entries.find((e) => e.action === 'offer_created');
  assert.equal(created.user, 'Mike');
  assert.equal(created.price, '$150,000.00');

  // Signing links work like passwords; they must never be written to disk.
  const onDisk = fs.readFileSync(store.logFile, 'utf8') + fs.readFileSync(store.offersFile, 'utf8');
  assert.ok(!onDisk.includes('access_token'));
});

test('wrong PINs are rate limited', async (t) => {
  const { server, call } = await startApp();
  t.after(() => server.close());
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { pin: '0000' })).status, 401);
  assert.equal((await call('POST', '/api/login', { pin: '0000' })).status, 429);
  // While locked out, even the right PIN is refused, so guessing can't continue.
  assert.equal((await call('POST', '/api/login', { pin: '111111' })).status, 429);
});

test('cross-site POSTs are refused', async (t) => {
  const { server } = await startApp();
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ pin: '111111' }),
  });
  assert.equal(res.status, 403);
});
