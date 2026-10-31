'use strict';

// Read-only check: does every field in each template's field map exist in SignNow,
// and is every per-deal text field in SignNow covered by the map?
// Creates nothing. Run with the same environment variables as the server:
//   npm run check-template

const templates = require('../templates');
const { SignNowClient, textFields } = require('../lib/signnow');
const { todayCentral } = require('../lib/format');

// Placeholder values that satisfy each form field type, just to get the map's field names.
function sampleValues(template) {
  const v = {};
  for (const f of template.formFields) {
    if (f.type === 'money') v[f.key] = f.required ? 100000 : null;
    else if (f.type === 'int') v[f.key] = 1;
    else if (f.type === 'select') v[f.key] = f.options[0].value;
    else v[f.key] = f.required ? 'x' : '';
  }
  return v;
}

async function main() {
  const signnow = new SignNowClient();
  if (!signnow.isConfigured()) throw new Error('Set SIGNNOW_API_KEY, or SIGNNOW_BASIC_TOKEN + SIGNNOW_USERNAME + SIGNNOW_PASSWORD');

  let ok = true;
  for (const t of templates.templates) {
    console.log(`\n== ${t.name} (${t.templateId})`);
    const group = await signnow.getTemplateGroup(t.templateId);
    const docs = group.templates || [];
    if (docs.length !== 1) {
      console.log(`  ! expected 1 template in the group, found ${docs.length}`);
      ok = false;
      continue;
    }
    const doc = await signnow.getDocument(docs[0].id);
    const inSignNow = new Map(textFields(doc).map((f) => [f.name, f.value]));
    const mapped = Object.keys(t.buildFields(sampleValues(t), { today: todayCentral() }));

    for (const name of mapped) {
      if (!inSignNow.has(name)) { console.log(`  ! missing in SignNow: "${name}"`); ok = false; }
    }
    for (const [name, value] of inSignNow) {
      if (mapped.includes(name) || t.ignoreFields.some((re) => re.test(name))) continue;
      console.log(`  ! in SignNow but not in the field map: "${name}" (placeholder ${JSON.stringify(value)})`);
      ok = false;
    }
    const roles = (doc.roles || []).map((r) => r.name);
    if (!roles.includes(t.signerRole)) { console.log(`  ! role "${t.signerRole}" not found (roles: ${roles.join(', ')})`); ok = false; }
    console.log(`  ${mapped.length} mapped fields checked against ${inSignNow.size} text fields in SignNow`);
  }
  console.log(ok ? '\nAll good.' : '\nProblems found (see above).');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
