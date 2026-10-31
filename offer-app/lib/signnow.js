'use strict';

// Minimal SignNow REST client. Endpoints match SignNow's official API
// (the same ones its own client library and MCP connector use).
//
// Credentials, from environment variables (server only):
//   SIGNNOW_API_BASE      https://api.signnow.com (production, default)
//                         or https://api-eval.signnow.com (sandbox)
//   Either:
//     SIGNNOW_API_KEY     a long-lived API key / access token
//   Or the password grant:
//     SIGNNOW_BASIC_TOKEN the app's "Basic Authorization Token"
//     SIGNNOW_USERNAME    the SignNow login email that owns the template
//     SIGNNOW_PASSWORD    that login's password

class SignNowError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SignNowError';
    this.status = status;
    this.body = body;
  }
}

class SignNowClient {
  constructor(env = process.env) {
    this.base = (env.SIGNNOW_API_BASE || 'https://api.signnow.com').replace(/\/+$/, '');
    this.apiKey = env.SIGNNOW_API_KEY || '';
    this.basicToken = env.SIGNNOW_BASIC_TOKEN || '';
    this.username = env.SIGNNOW_USERNAME || '';
    this.password = env.SIGNNOW_PASSWORD || '';
    this.token = null;
    this.tokenExpires = 0;
  }

  isConfigured() {
    return Boolean(this.apiKey || (this.basicToken && this.username && this.password));
  }

  async getToken(force = false) {
    if (this.apiKey) return this.apiKey;
    if (!force && this.token && Date.now() < this.tokenExpires) return this.token;
    if (!this.isConfigured()) throw new SignNowError('SignNow credentials are not set on the server', 500);

    const res = await fetch(`${this.base}/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.basicToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: this.username,
        password: this.password,
        scope: '*',
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new SignNowError(`SignNow login failed: ${errorText(body) || res.status}`, res.status, body);
    }
    this.token = body.access_token;
    // Renew five minutes before SignNow says it expires.
    this.tokenExpires = Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 300) * 1000;
    return this.token;
  }

  async request(method, path, body, { retried = false } = {}) {
    const token = await this.getToken(retried);
    const res = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    // A cached token can expire early; log in again once.
    if (res.status === 401 && !retried && !this.apiKey) {
      return this.request(method, path, body, { retried: true });
    }

    const text = await res.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch { data = { text }; }
    }
    if (!res.ok) {
      throw new SignNowError(`SignNow ${method} ${path.split('?')[0]} failed (${res.status}): ${errorText(data)}`, res.status, data);
    }
    return data;
  }

  // ---- Template groups / document groups ----

  getTemplateGroup(templateGroupId) {
    return this.request('GET', `/documentgroup/template/${templateGroupId}`);
  }

  // Returns the new document group ID.
  async createGroupFromTemplateGroup(templateGroupId, groupName) {
    const res = await this.request('POST', `/v2/document-group-templates/${templateGroupId}/document-group`, {
      group_name: groupName,
    });
    const d = res.data || res;
    const id = d.unique_id || d.id || d.group_id;
    if (!id) throw new SignNowError('SignNow created the document group but did not return its ID', 502, res);
    return id;
  }

  async getDocumentGroup(groupId) {
    const res = await this.request('GET', `/v2/document-groups/${groupId}`);
    return res.data || res;
  }

  // ---- Documents ----

  getDocument(documentId) {
    return this.request('GET', `/document/${documentId}`);
  }

  // fields: { "Field Name": "value" }
  prefillTexts(documentId, fields) {
    return this.request('PUT', `/v2/documents/${documentId}/prefill-texts`, {
      fields: Object.entries(fields).map(([field_name, prefilled_text]) => ({ field_name, prefilled_text })),
    });
  }

  // ---- Embedded signing (document groups) ----

  async createGroupEmbeddedInvite(groupId, { email, firstName, lastName, documents }) {
    const res = await this.request('POST', `/v2/document-groups/${groupId}/embedded-invites`, {
      invites: [{
        order: 1,
        signers: [{
          email,
          auth_method: 'none',
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          documents, // [{ id, role, action: 'sign' }]
        }],
      }],
    });
    const id = res.data && res.data.id;
    if (!id) throw new SignNowError('SignNow created the invite but did not return its ID', 502, res);
    return id;
  }

  // Signing links last 15-45 minutes. We ask for the maximum.
  async createGroupEmbeddedLink(groupId, inviteId, email) {
    const res = await this.request('POST', `/v2/document-groups/${groupId}/embedded-invites/${inviteId}/link`, {
      email,
      auth_method: 'none',
      link_expiration: 45,
    });
    const link = res.data && res.data.link;
    if (!link) throw new SignNowError('SignNow did not return a signing link', 502, res);
    return link;
  }

  deleteGroupEmbeddedInvites(groupId) {
    return this.request('DELETE', `/v2/document-groups/${groupId}/embedded-invites`);
  }
}

function errorText(body) {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.error === 'string') return body.error;
  if (Array.isArray(body.errors) && body.errors.length) {
    return body.errors.map((e) => e.message || e.error || JSON.stringify(e)).join('; ');
  }
  if (body.message) return body.message;
  if (body.text) return String(body.text).slice(0, 200);
  return JSON.stringify(body).slice(0, 200);
}

// Text fields from GET /document/{id}, as { name, value }.
// The current value of a text field lives in json_attributes.prefilled_text.
function textFields(document) {
  return (document.fields || [])
    .filter((f) => f.type === 'text')
    .map((f) => ({
      name: (f.json_attributes && f.json_attributes.name) || f.name || '',
      value: (f.json_attributes && f.json_attributes.prefilled_text) ?? '',
    }));
}

module.exports = { SignNowClient, SignNowError, textFields };
