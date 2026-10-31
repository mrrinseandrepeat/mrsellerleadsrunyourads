'use strict';

const { BLANK, formatMoney, textOrBlank } = require('../lib/format');

const OCCUPANCY_PREFIX = 'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY ';
const OCCUPANCY_FIELDS = {
  VACANT: OCCUPANCY_PREFIX + 'IS VACANT',
  TENANT_TO_VACANT: OCCUPANCY_PREFIX + 'IS TENANT OCCUPIED AND WILL BE VACANT',
  OCCUPIED_TO_VACANT: OCCUPANCY_PREFIX + 'IS OCCUPIED AND WILL BE VACANT',
  OCCUPIED_TO_OCCUPIED: OCCUPANCY_PREFIX + 'IS OCCUPIED AND WILL BE OCCUPIED',
};

const PERSONAL_PROPERTY_FIELDS = {
  LEAVE: 'SELLER MAY LEAVE ANY PERSONAL PROPERTY WHICH CONVEYS TO BUYER AT COE',
  REMOVE: 'SELLER SHALL REMOVE PERSONAL PROPERTY',
};

// Put "X" in the chosen field and a single space in every other field of the group.
function choiceGroup(fieldsByOption, chosen) {
  const out = {};
  for (const [option, fieldName] of Object.entries(fieldsByOption)) {
    out[fieldName] = option === chosen ? 'X' : BLANK;
  }
  return out;
}

function moneyOrBlank(cents) {
  return cents === null ? BLANK : formatMoney(cents);
}

module.exports = {
  id: 'offer-to-purchase',
  name: 'Offer To Purchase Agreement',
  kind: 'template_group',
  templateId: '335ba194761243f7a8bebf3cf71cdd69bfe4dc6a',
  signerRole: 'Recipient 1',

  // Template fields SignNow fills at signing. Never touched, never checked.
  ignoreFields: [/^Date and Time \d+$/],

  formFields: [
    { key: 'sellerName', label: 'Seller name', type: 'text', required: true, maxLength: 80 },
    { key: 'sellerName2', label: 'Second seller name', type: 'text', maxLength: 80, hint: 'Optional' },
    { key: 'sellerEmail', label: 'Seller email', type: 'email', required: true, maxLength: 120 },
    { key: 'street', label: 'Street address', type: 'text', required: true, maxLength: 100, section: 'Property' },
    { key: 'city', label: 'City', type: 'text', required: true, maxLength: 60 },
    { key: 'state', label: 'State', type: 'text', required: true, maxLength: 2, uppercase: true,
      pattern: '^[A-Za-z]{2}$', patternMessage: 'must be 2 letters, like IL' },
    { key: 'zip', label: 'ZIP', type: 'text', required: true, maxLength: 10, inputmode: 'numeric',
      pattern: '^\\d{5}(-\\d{4})?$', patternMessage: 'must be 5 digits' },
    { key: 'price', label: 'Purchase price', type: 'money', required: true, section: 'Terms' },
    { key: 'emd', label: 'EMD', type: 'money', hint: 'Leave empty for none' },
    { key: 'closingDays', label: 'Closing (business days)', type: 'int', required: true, min: 1 },
    { key: 'inspectionDays', label: 'Inspection period (business days)', type: 'int', required: true, min: 0 },
    { key: 'personalProperty', label: 'Personal property', type: 'select', required: true,
      options: [
        { value: 'LEAVE', label: 'LEAVE' },
        { value: 'REMOVE', label: 'REMOVE' },
      ] },
    { key: 'ppDeduction', label: 'Personal property deduction $', type: 'money', hint: 'Leave empty for none' },
    { key: 'occupancy', label: 'Occupancy', type: 'select', required: true,
      options: [
        { value: 'VACANT', label: 'VACANT' },
        { value: 'TENANT_TO_VACANT', label: 'TENANT TO VACANT' },
        { value: 'OCCUPIED_TO_VACANT', label: 'OCCUPIED TO VACANT' },
        { value: 'OCCUPIED_TO_OCCUPIED', label: 'OCCUPIED TO OCCUPIED' },
      ] },
    { key: 'terms1', label: 'Additional terms line 1', type: 'text', maxLength: 150, hint: 'Optional', section: 'Additional terms' },
    { key: 'terms2', label: 'Additional terms line 2', type: 'text', maxLength: 150, hint: 'Optional' },
  ],

  // Checks that span more than one field. Return a list of error messages.
  crossValidate(v) {
    const errors = [];
    if (v.emd !== null && v.price !== null && v.emd > v.price) errors.push('EMD cannot be more than the purchase price');
    return errors;
  },

  signer(v) {
    return { email: v.sellerEmail, name: v.sellerName };
  },

  documentName(v) {
    const last = v.sellerName.trim().split(/\s+/).pop();
    return `Offer To Purchase - ${v.street} - ${last}`;
  },

  // Shown in the history list.
  summary(v) {
    return {
      seller: v.sellerName2 ? `${v.sellerName} & ${v.sellerName2}` : v.sellerName,
      address: this.address(v),
      price: formatMoney(v.price),
    };
  },

  address(v) {
    return `${v.street}, ${v.city}, ${v.state} ${v.zip}`;
  },

  // Form values -> { "SignNow field name": "value" } for every per-deal field.
  buildFields(v, { today }) {
    const address = this.address(v);
    const price = formatMoney(v.price);
    const cashAtClose = formatMoney(v.price - (v.emd || 0));

    return {
      'SELLER': v.sellerName,
      'AUTHORIZATION TO SIGN-SELLER': v.sellerName,
      'NOVATION INDEMNIFCATION-SELLER': v.sellerName,
      'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 1': v.sellerName,
      'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 2': textOrBlank(v.sellerName2),

      'PROPERTY ADDRESS': address,
      'AUTHORIZATION TO SIGN-PROPERTY ADDRESS': address,
      'NOVATION INDEMNIFCATION-PROPERTY ADDRESS': address,

      'PURCHASE PRICE': price,
      'NOVATION INDEMNIFCATION-PURCHASE PRICE': price,
      'NOVATION INDEMNIFCATION-NET PROCEEDS AMOUNT (PSA PURCHASE PRICE)': price,
      'EARNEST MONEY DEPOSIT': moneyOrBlank(v.emd),
      'CASH AT CLOSE OF ESCROW (COE)': cashAtClose,

      'CLOSE OF ESCROW BUSINESS DAYS': String(v.closingDays),
      'INSPECTION PERIOD BUSINESS DAYS': String(v.inspectionDays),

      ...choiceGroup(PERSONAL_PROPERTY_FIELDS, v.personalProperty),
      'PERSONAL PROPERTY SELLER DEDUCTION': moneyOrBlank(v.ppDeduction),

      ...choiceGroup(OCCUPANCY_FIELDS, v.occupancy),

      'ADDITIONAL TERMS 1': textOrBlank(v.terms1),
      'ADDITIONAL TERMS 2': textOrBlank(v.terms2),

      'NOVATION INDEMNIFCATION-DATE': today,
      'NOVATION INDEMNIFCATION-DATE OF PSA': today,
    };
  },
};
