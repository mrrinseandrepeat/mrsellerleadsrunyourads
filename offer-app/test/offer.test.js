'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const template = require('../templates/offer-to-purchase');
const { validateForm } = require('../lib/validate');
const { parseMoney, formatMoney, todayCentral } = require('../lib/format');
const { createOffer, regenerateLink, getStatus, VerificationError } = require('../lib/offers');
const { FakeSignNow, TEMPLATE_TEXT_FIELDS } = require('./fake-signnow');

const DUMMY = {
  sellerName: 'John Q Testseller',
  sellerName2: '',
  sellerEmail: 'Test.Seller@example.com',
  street: '123 Test St',
  city: 'Chicago',
  state: 'il',
  zip: '60601',
  price: '150000',
  emd: '$1,000',
  closingDays: '30',
  inspectionDays: '10',
  personalProperty: 'LEAVE',
  ppDeduction: '',
  occupancy: 'VACANT',
  terms1: 'TEST DOCUMENT - DO NOT SIGN',
  terms2: '',
};

function values(overrides = {}) {
  const { values: v, errors } = validateForm(template.formFields, { ...DUMMY, ...overrides });
  assert.deepEqual(errors, []);
  return v;
}

test('money parsing and formatting', () => {
  assert.equal(parseMoney('150000'), 15000000);
  assert.equal(parseMoney('$150,000.5'), 15000050);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('none'), null);
  assert.equal(parseMoney('0'), null);
  assert.throws(() => parseMoney('150k'));
  assert.throws(() => parseMoney('1.234'));
  assert.equal(formatMoney(15000000), '$150,000.00');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(123456789), '$1,234,567.89');
});

test('date is US Central', () => {
  // 03:00 UTC on Nov 1 is still Oct 31 in Chicago.
  assert.equal(todayCentral(new Date('2026-11-01T03:00:00Z')), '10/31/2026');
  assert.equal(todayCentral(new Date('2026-01-05T18:00:00Z')), '01/05/2026');
});

test('field map produces exactly what was verified live in SignNow', () => {
  const fields = template.buildFields(values(), { today: '10/31/2026' });
  // This is the exact set that was written to and read back from the real template.
  assert.deepEqual(fields, {
    'SELLER': 'John Q Testseller',
    'AUTHORIZATION TO SIGN-SELLER': 'John Q Testseller',
    'NOVATION INDEMNIFCATION-SELLER': 'John Q Testseller',
    'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 1': 'John Q Testseller',
    'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 2': ' ',
    'PROPERTY ADDRESS': '123 Test St, Chicago, IL 60601',
    'AUTHORIZATION TO SIGN-PROPERTY ADDRESS': '123 Test St, Chicago, IL 60601',
    'NOVATION INDEMNIFCATION-PROPERTY ADDRESS': '123 Test St, Chicago, IL 60601',
    'PURCHASE PRICE': '$150,000.00',
    'NOVATION INDEMNIFCATION-PURCHASE PRICE': '$150,000.00',
    'NOVATION INDEMNIFCATION-NET PROCEEDS AMOUNT (PSA PURCHASE PRICE)': '$150,000.00',
    'EARNEST MONEY DEPOSIT': '$1,000.00',
    'CASH AT CLOSE OF ESCROW (COE)': '$149,000.00',
    'CLOSE OF ESCROW BUSINESS DAYS': '30',
    'INSPECTION PERIOD BUSINESS DAYS': '10',
    'SELLER MAY LEAVE ANY PERSONAL PROPERTY WHICH CONVEYS TO BUYER AT COE': 'X',
    'SELLER SHALL REMOVE PERSONAL PROPERTY': ' ',
    'PERSONAL PROPERTY SELLER DEDUCTION': ' ',
    'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS VACANT': 'X',
    'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS TENANT OCCUPIED AND WILL BE VACANT': ' ',
    'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS OCCUPIED AND WILL BE VACANT': ' ',
    'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS OCCUPIED AND WILL BE OCCUPIED': ' ',
    'ADDITIONAL TERMS 1': 'TEST DOCUMENT - DO NOT SIGN',
    'ADDITIONAL TERMS 2': ' ',
    'NOVATION INDEMNIFCATION-DATE': '10/31/2026',
    'NOVATION INDEMNIFCATION-DATE OF PSA': '10/31/2026',
  });
});

test('field map covers every per-deal text field in the template', () => {
  const mapped = Object.keys(template.buildFields(values(), { today: '01/01/2026' })).sort();
  const perDeal = TEMPLATE_TEXT_FIELDS.filter((n) => !/^Date and Time/.test(n)).sort();
  assert.deepEqual(mapped, perDeal);
  assert.equal(mapped.length, 26);
});

test('no EMD: blank EMD, full price at close; other choices', () => {
  const f = template.buildFields(values({
    emd: '', sellerName2: 'Jane Testseller', personalProperty: 'REMOVE', ppDeduction: '2500',
    occupancy: 'OCCUPIED_TO_OCCUPIED', terms2: 'Seller to keep fridge',
  }), { today: '01/01/2026' });
  assert.equal(f['EARNEST MONEY DEPOSIT'], ' ');
  assert.equal(f['CASH AT CLOSE OF ESCROW (COE)'], '$150,000.00');
  assert.equal(f['AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 2'], 'Jane Testseller');
  assert.equal(f['SELLER MAY LEAVE ANY PERSONAL PROPERTY WHICH CONVEYS TO BUYER AT COE'], ' ');
  assert.equal(f['SELLER SHALL REMOVE PERSONAL PROPERTY'], 'X');
  assert.equal(f['PERSONAL PROPERTY SELLER DEDUCTION'], '$2,500.00');
  assert.equal(f['SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS VACANT'], ' ');
  assert.equal(f['SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS OCCUPIED AND WILL BE OCCUPIED'], 'X');
  assert.equal(f['ADDITIONAL TERMS 2'], 'Seller to keep fridge');
  for (const v of Object.values(f)) {
    assert.notEqual(v, '');
    assert.notEqual(v, '-');
  }
});

test('form validation catches bad input', () => {
  const { errors } = validateForm(template.formFields, {
    ...DUMMY, sellerName: '', sellerEmail: 'nope', zip: '606', price: 'abc', closingDays: '-3', occupancy: 'MAYBE',
  });
  assert.equal(errors.length, 6);
  const v = values({ emd: '200000' });
  assert.deepEqual(template.crossValidate(v), ['EMD cannot be more than the purchase price']);
});

test('createOffer: create, fill, verify, then invite + link', async () => {
  const sn = new FakeSignNow();
  const r = await createOffer(sn, template, values(), { now: new Date('2026-10-31T15:00:00Z') });
  assert.equal(r.fieldCount, 26);
  assert.match(r.link, /^https:\/\/app\.signnow\.com\//);
  assert.deepEqual(sn.calls.map((c) => c[0]), ['createGroup', 'prefill', 'invite', 'link']);
  assert.equal(sn.calls[0][1], '335ba194761243f7a8bebf3cf71cdd69bfe4dc6a');
  assert.equal(sn.calls[0][2], 'Offer To Purchase - 123 Test St - Testseller');
  const invite = sn.calls[2][2];
  assert.deepEqual(invite, {
    email: 'test.seller@example.com', firstName: 'John Q', lastName: 'Testseller',
    documents: [{ id: r.documentId, role: 'Recipient 1', action: 'sign' }],
  });
});

test('createOffer: a field that did not land stops the link', async () => {
  const sn = new FakeSignNow({ dropField: 'PURCHASE PRICE' });
  await assert.rejects(createOffer(sn, template, values()), (e) => {
    assert.ok(e instanceof VerificationError);
    assert.match(e.problems[0], /PURCHASE PRICE.*"-"/);
    return true;
  });
  assert.ok(!sn.calls.some((c) => c[0] === 'invite' || c[0] === 'link'));
});

test('createOffer: a new template field left at "-" stops the link', async () => {
  const sn = new FakeSignNow({ extraFields: ['NEW FIELD'] });
  await assert.rejects(createOffer(sn, template, values()), /NEW FIELD/);
  assert.ok(!sn.calls.some((c) => c[0] === 'invite'));
});

test('createOffer: a renamed template field stops before writing', async () => {
  const sn = new FakeSignNow();
  const orig = sn.createGroupFromTemplateGroup.bind(sn);
  sn.createGroupFromTemplateGroup = async (...a) => {
    const id = await orig(...a);
    const doc = sn.docs.get(sn.groups.get(id).documents[0].id);
    doc.fields.find((f) => f.json_attributes.name === 'SELLER').json_attributes.name = 'SELLER NAME';
    return id;
  };
  await assert.rejects(createOffer(sn, template, values()), /"SELLER" is missing/);
  assert.ok(!sn.calls.some((c) => c[0] === 'prefill'));
});

test('regenerate link, recreate invite if needed, refuse when signed', async () => {
  const sn = new FakeSignNow();
  const r = await createOffer(sn, template, values());
  const offer = { ...r, signerEmail: 'test.seller@example.com', signerName: 'John Q Testseller' };

  const again = await regenerateLink(sn, template, offer);
  assert.equal(again.inviteId, r.inviteId);
  assert.notEqual(again.link, r.link);

  sn.failNextLink = true;
  const recreated = await regenerateLink(sn, template, offer);
  assert.notEqual(recreated.inviteId, r.inviteId);
  assert.ok(sn.calls.some((c) => c[0] === 'deleteInvites'));

  assert.equal((await getStatus(sn, r.groupId)).label, 'Link sent, not signed yet');
  sn.markSigned(r.groupId);
  assert.equal((await getStatus(sn, r.groupId)).label, 'Signed');
  await assert.rejects(regenerateLink(sn, template, offer), /already signed/);
});
