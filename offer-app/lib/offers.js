'use strict';

const { textFields } = require('./signnow');
const { splitName, todayCentral } = require('./format');

class VerificationError extends Error {
  constructor(problems, groupId) {
    super('Field check failed: ' + problems.join('; '));
    this.name = 'VerificationError';
    this.problems = problems;
    this.groupId = groupId;
  }
}

const isIgnored = (template, name) => template.ignoreFields.some((re) => re.test(name));

// Placeholders the template uses. None may remain on a sent document.
const PLACEHOLDERS = new Set(['-', 'NA', 'N/A']);

// Compare what SignNow holds against what we meant to put there.
// Returns a list of problems (empty means everything landed).
function checkFields(template, document, expected) {
  const problems = [];
  const actual = new Map();
  for (const f of textFields(document)) actual.set(f.name, f.value);

  for (const [name, want] of Object.entries(expected)) {
    if (!actual.has(name)) {
      problems.push(`field "${name}" is missing from the template`);
    } else if (actual.get(name) !== want) {
      problems.push(`"${name}" shows ${JSON.stringify(actual.get(name))}, expected ${JSON.stringify(want)}`);
    }
  }

  // A text field we don't fill that still holds a placeholder means the template
  // changed (a new field was added). Stop rather than send a "-" to the seller.
  for (const [name, value] of actual) {
    if (name in expected || isIgnored(template, name)) continue;
    if (PLACEHOLDERS.has(value.trim().toUpperCase())) {
      problems.push(`template field "${name}" is not in the field map and still shows ${JSON.stringify(value)}`);
    }
  }
  return problems;
}

// Every value we send must be real text, an "X", or a single space.
function checkExpected(expected) {
  const problems = [];
  for (const [name, value] of Object.entries(expected)) {
    if (typeof value !== 'string' || value === '' || value.trim() === '-') {
      problems.push(`"${name}" would be sent as ${JSON.stringify(value)}`);
    }
  }
  return problems;
}

async function getSingleDocument(signnow, groupId) {
  const group = await signnow.getDocumentGroup(groupId);
  const docs = group.documents || [];
  // The template groups in use hold one document. A multi-document template
  // will need a per-document field map in its config.
  if (docs.length !== 1) throw new Error(`Expected 1 document in the group, found ${docs.length}`);
  return { group, documentId: docs[0].id };
}

// Create, fill, verify, invite. Returns { groupId, documentId, inviteId, link }.
// If verification fails, throws VerificationError and no link is created.
async function createOffer(signnow, template, values, { now = new Date() } = {}) {
  if (template.kind !== 'template_group') throw new Error(`Template kind "${template.kind}" is not supported yet`);

  const expected = template.buildFields(values, { today: todayCentral(now) });
  const bad = checkExpected(expected);
  if (bad.length) throw new VerificationError(bad, null);

  const groupId = await signnow.createGroupFromTemplateGroup(template.templateId, template.documentName(values));
  const { documentId } = await getSingleDocument(signnow, groupId);

  // Make sure every mapped field exists before writing anything.
  const before = await signnow.getDocument(documentId);
  const names = new Set(textFields(before).map((f) => f.name));
  const missing = Object.keys(expected).filter((n) => !names.has(n));
  if (missing.length) {
    throw new VerificationError(missing.map((n) => `field "${n}" is missing from the template`), groupId);
  }

  await signnow.prefillTexts(documentId, expected);

  const after = await signnow.getDocument(documentId);
  const problems = checkFields(template, after, expected);
  if (problems.length) throw new VerificationError(problems, groupId);

  const signer = template.signer(values);
  const { first, last } = splitName(signer.name);
  const inviteId = await signnow.createGroupEmbeddedInvite(groupId, {
    email: signer.email,
    firstName: first,
    lastName: last,
    documents: [{ id: documentId, role: template.signerRole, action: 'sign' }],
  });
  const link = await signnow.createGroupEmbeddedLink(groupId, inviteId, signer.email);

  return { groupId, documentId, inviteId, link, fieldCount: Object.keys(expected).length };
}

// A fresh link for an offer already created. If the old invite is gone,
// replace it with a new one (the filled fields are untouched).
async function regenerateLink(signnow, template, offer) {
  const status = await getStatus(signnow, offer.groupId);
  if (status.signed) throw new Error('This offer is already signed. No new link needed.');

  try {
    return { inviteId: offer.inviteId, link: await signnow.createGroupEmbeddedLink(offer.groupId, offer.inviteId, offer.signerEmail) };
  } catch (e) {
    if (!e.status || e.status >= 500) throw e;
  }

  await signnow.deleteGroupEmbeddedInvites(offer.groupId).catch(() => {});
  const { first, last } = splitName(offer.signerName);
  const inviteId = await signnow.createGroupEmbeddedInvite(offer.groupId, {
    email: offer.signerEmail,
    firstName: first,
    lastName: last,
    documents: [{ id: offer.documentId, role: template.signerRole, action: 'sign' }],
  });
  return { inviteId, link: await signnow.createGroupEmbeddedLink(offer.groupId, inviteId, offer.signerEmail) };
}

// Plain-English status from GET /v2/document-groups/{id}.
async function getStatus(signnow, groupId) {
  const group = await signnow.getDocumentGroup(groupId);
  const state = String(group.state || '').toLowerCase();
  const invites = (group.documents || []).flatMap((d) => d.field_invites || []);
  const inviteStatus = invites.length ? String(invites[0].status || '').toLowerCase() : '';

  const signed = state === 'completed' || inviteStatus === 'fulfilled';
  let label = 'Link sent, not signed yet';
  if (signed) label = 'Signed';
  else if (inviteStatus === 'declined' || state === 'declined') label = 'Declined';
  else if (inviteStatus === 'expired' || state === 'expired') label = 'Expired';
  else if (!invites.length && (state === 'created' || state === '')) label = 'Not sent';

  return { signed, label, raw: { state, inviteStatus } };
}

module.exports = { createOffer, regenerateLink, getStatus, checkFields, checkExpected, VerificationError };
