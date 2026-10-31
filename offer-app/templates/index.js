'use strict';

// Every document type the team can send. To add one (Mortgage Takeover, Addendum,
// Seller Disclosure, Assignment...), copy offer-to-purchase.js, change the
// template ID, form fields and field map, and add it to this list.
const templates = [
  require('./offer-to-purchase'),
];

const byId = new Map(templates.map((t) => [t.id, t]));

// What the browser needs to draw the picker and the form. No server-only details.
function publicList() {
  return templates.map((t) => ({ id: t.id, name: t.name, formFields: t.formFields }));
}

module.exports = { templates, get: (id) => byId.get(id), publicList };
