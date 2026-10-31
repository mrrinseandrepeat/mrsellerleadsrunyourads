'use strict';

const { parseMoney } = require('./format');

// Validate and normalize a submitted form against a template's form field list.
// Returns { values, errors }. Money fields become integer cents (or null),
// int fields become numbers, everything else a trimmed string.
function validateForm(formFields, body) {
  const values = {};
  const errors = [];
  const input = body && typeof body === 'object' ? body : {};

  for (const field of formFields) {
    const raw = input[field.key];
    const str = raw === undefined || raw === null ? '' : String(raw).trim();

    if (str.length > (field.maxLength || 200)) {
      errors.push(`${field.label} is too long (max ${field.maxLength || 200} characters)`);
      continue;
    }

    if (field.type === 'money') {
      try {
        values[field.key] = parseMoney(str);
      } catch (e) {
        errors.push(`${field.label} ${e.message}`);
        continue;
      }
      if (field.required && values[field.key] === null) errors.push(`${field.label} is required`);
      continue;
    }

    if (str === '') {
      if (field.required) errors.push(`${field.label} is required`);
      values[field.key] = field.type === 'int' ? null : '';
      continue;
    }

    switch (field.type) {
      case 'int': {
        if (!/^\d{1,4}$/.test(str)) {
          errors.push(`${field.label} must be a whole number`);
          break;
        }
        const n = Number(str);
        if (field.min !== undefined && n < field.min) errors.push(`${field.label} must be at least ${field.min}`);
        values[field.key] = n;
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) errors.push(`${field.label} is not a valid email`);
        values[field.key] = str.toLowerCase();
        break;
      case 'select': {
        const match = field.options.find((o) => o.value === str);
        if (!match) errors.push(`${field.label}: pick one of the options`);
        values[field.key] = str;
        break;
      }
      default:
        if (field.pattern && !new RegExp(field.pattern).test(str)) {
          errors.push(`${field.label} ${field.patternMessage || 'is not valid'}`);
        }
        values[field.key] = field.uppercase ? str.toUpperCase() : str;
    }
  }

  return { values, errors };
}

module.exports = { validateForm };
