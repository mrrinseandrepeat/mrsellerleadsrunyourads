'use strict';

// In-memory stand-in for SignNow, shaped like the real API responses.
// Field names are copied from the live Offer To Purchase template.

const TEMPLATE_TEXT_FIELDS = [
  'SELLER', 'PROPERTY ADDRESS',
  'SELLER MAY LEAVE ANY PERSONAL PROPERTY WHICH CONVEYS TO BUYER AT COE', 'SELLER SHALL REMOVE PERSONAL PROPERTY',
  'PERSONAL PROPERTY SELLER DEDUCTION', 'PURCHASE PRICE', 'EARNEST MONEY DEPOSIT', 'CASH AT CLOSE OF ESCROW (COE)',
  'CLOSE OF ESCROW BUSINESS DAYS', 'INSPECTION PERIOD BUSINESS DAYS',
  'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS VACANT',
  'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS TENANT OCCUPIED AND WILL BE VACANT',
  'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS OCCUPIED AND WILL BE VACANT',
  'SELLER ACKNOWLEDGES AND AGREES THE PROPERTY IS OCCUPIED AND WILL BE OCCUPIED',
  'ADDITIONAL TERMS 1', 'ADDITIONAL TERMS 2', 'Date and Time 2', 'Date and Time 3',
  'AUTHORIZATION TO SIGN-SELLER', 'AUTHORIZATION TO SIGN-PROPERTY ADDRESS', 'Date and Time 4',
  'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 1', 'Date and Time 5', 'AUTHORIZATION TO SIGN - SIGNATURE-PRINT NAME 2',
  'NOVATION INDEMNIFCATION-DATE', 'NOVATION INDEMNIFCATION-SELLER', 'NOVATION INDEMNIFCATION-DATE OF PSA',
  'NOVATION INDEMNIFCATION-PROPERTY ADDRESS', 'NOVATION INDEMNIFCATION-PURCHASE PRICE',
  'NOVATION INDEMNIFCATION-NET PROCEEDS AMOUNT (PSA PURCHASE PRICE)',
];

class FakeSignNow {
  constructor({ extraFields = [], dropField = null } = {}) {
    this.extraFields = extraFields;
    this.dropField = dropField; // simulate SignNow silently ignoring one field
    this.groups = new Map();
    this.docs = new Map();
    this.calls = [];
    this.n = 0;
  }

  isConfigured() { return true; }

  async createGroupFromTemplateGroup(templateGroupId, name) {
    this.calls.push(['createGroup', templateGroupId, name]);
    const groupId = `group${++this.n}`;
    const docId = `doc${this.n}`;
    const fields = [...TEMPLATE_TEXT_FIELDS, ...this.extraFields].map((name) => ({
      type: 'text',
      json_attributes: { name, prefilled_text: name.startsWith('Date and Time') ? '' : '-' },
    }));
    fields.push({ type: 'signature', json_attributes: { name: 'Signature 2' } });
    this.docs.set(docId, { id: docId, fields, roles: [{ name: 'Recipient 1' }] });
    this.groups.set(groupId, { id: groupId, name, state: 'created', documents: [{ id: docId, roles: ['Recipient 1'], field_invites: [] }] });
    return groupId;
  }

  async getDocumentGroup(id) { return structuredClone(this.groups.get(id)); }

  async getDocument(id) { return structuredClone(this.docs.get(id)); }

  async prefillTexts(docId, fields) {
    this.calls.push(['prefill', docId, fields]);
    const doc = this.docs.get(docId);
    for (const [name, value] of Object.entries(fields)) {
      if (name === this.dropField) continue;
      const f = doc.fields.find((x) => x.json_attributes.name === name);
      if (!f) throw Object.assign(new Error(`field ${name} not found`), { status: 400 });
      f.json_attributes.prefilled_text = value;
    }
  }

  async createGroupEmbeddedInvite(groupId, signer) {
    this.calls.push(['invite', groupId, signer]);
    const g = this.groups.get(groupId);
    g.state = 'pending';
    g.documents[0].field_invites = [{ status: 'pending' }];
    return `invite-${groupId}-${this.calls.length}`;
  }

  async createGroupEmbeddedLink(groupId, inviteId, email) {
    this.calls.push(['link', groupId, inviteId, email]);
    if (this.failNextLink) {
      this.failNextLink = false;
      throw Object.assign(new Error('invite not found'), { status: 404 });
    }
    return `https://app.signnow.com/webapp/documentgroup/signing?document_group_id=${groupId}&access_token=t${this.calls.length}`;
  }

  async deleteGroupEmbeddedInvites(groupId) { this.calls.push(['deleteInvites', groupId]); }

  markSigned(groupId) {
    const g = this.groups.get(groupId);
    g.state = 'completed';
    g.documents[0].field_invites = [{ status: 'fulfilled' }];
  }
}

module.exports = { FakeSignNow, TEMPLATE_TEXT_FIELDS };
