'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const templates = require('./templates');
const { validateForm } = require('./lib/validate');
const { SignNowClient } = require('./lib/signnow');
const { Store } = require('./lib/store');
const { createOffer, regenerateLink, getStatus, VerificationError } = require('./lib/offers');
const { parsePins, findUserByPin, makeSession, readSession, parseCookies, RateLimiter, SESSION_HOURS } = require('./lib/auth');

const COOKIE = 'offer_session';

function createApp({ env = process.env, signnow = new SignNowClient(env), store } = {}) {
  const users = parsePins(env.ACCESS_PINS);
  const admins = new Set(String(env.ADMIN_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));
  const secret = env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const secureCookie = env.NODE_ENV === 'production';
  store = store || new Store(env.DATA_DIR || path.join(__dirname, 'data'));

  const loginLimiter = new RateLimiter(5, 15 * 60 * 1000); // 5 wrong PINs per 15 min per IP
  const globalLoginLimiter = new RateLimiter(30, 15 * 60 * 1000); // 30 wrong PINs per 15 min total
  const offerLimiter = new RateLimiter(Number(env.OFFERS_PER_HOUR) || 30, 60 * 60 * 1000);
  const linkLimiter = new RateLimiter(60, 60 * 60 * 1000);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render / Vercel put one proxy in front

  app.use((req, res, next) => {
    res.set({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
  app.use('/api', express.json({ limit: '20kb' }), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Only accept API calls made from this site's own page.
    if (req.method !== 'GET') {
      const origin = req.get('origin');
      if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
        return res.status(403).json({ error: 'Bad origin' });
      }
    }
    next();
  });

  function currentUser(req) {
    return readSession(secret, parseCookies(req.headers.cookie)[COOKIE], users);
  }

  function requireUser(req, res, next) {
    const name = currentUser(req);
    if (!name) return res.status(401).json({ error: 'Please enter your PIN' });
    req.user = name;
    next();
  }

  function tooMany(res, seconds) {
    res.set('Retry-After', String(seconds));
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` });
  }

  // ---- Login ----

  app.post('/api/login', (req, res) => {
    // While locked out, don't even check the PIN, so guessing can't continue.
    const locked = loginLimiter.blocked(req.ip) || globalLoginLimiter.blocked('all');
    if (locked) return tooMany(res, locked);

    const pin = String((req.body && req.body.pin) || '');
    const user = pin && users.length ? findUserByPin(users, pin) : null;
    if (!user) {
      const wait = loginLimiter.hit(req.ip) || globalLoginLimiter.hit('all');
      store.log({ action: 'login_failed', ip: req.ip });
      if (wait) return tooMany(res, wait);
      return res.status(401).json({ error: users.length ? 'Wrong PIN' : 'No PINs are set up on the server (ACCESS_PINS)' });
    }
    store.log({ action: 'login', user: user.name, ip: req.ip });
    res.cookie(COOKIE, makeSession(secret, user.name), {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      maxAge: SESSION_HOURS * 3600 * 1000,
    });
    res.json({ name: user.name });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/me', requireUser, (req, res) => {
    res.json({
      name: req.user,
      isAdmin: admins.has(req.user),
      signnowConfigured: signnow.isConfigured(),
      templates: templates.publicList(),
    });
  });

  // ---- Offers ----

  app.post('/api/offers', requireUser, async (req, res) => {
    const template = templates.get(req.body && req.body.templateId);
    if (!template) return res.status(400).json({ error: 'Pick a document type' });

    const { values, errors } = validateForm(template.formFields, req.body.values);
    if (!errors.length) errors.push(...template.crossValidate(values));
    if (errors.length) return res.status(400).json({ error: 'Please fix the form', problems: errors });

    const wait = offerLimiter.hit(req.user);
    if (wait) return tooMany(res, wait);

    const summary = template.summary(values);
    const signer = template.signer(values);
    const logBase = { user: req.user, ip: req.ip, template: template.id, ...summary, signerEmail: signer.email };

    try {
      const result = await createOffer(signnow, template, values);
      const offer = store.addOffer({
        templateId: template.id,
        templateName: template.name,
        createdBy: req.user,
        ...summary,
        signerName: signer.name,
        signerEmail: signer.email,
        groupId: result.groupId,
        documentId: result.documentId,
        inviteId: result.inviteId,
        status: 'Link sent, not signed yet',
        values,
      });
      store.log({ action: 'offer_created', ...logBase, offerId: offer.id, groupId: result.groupId, fieldsVerified: result.fieldCount });
      res.json({ offer: publicOffer(offer), link: result.link, fieldsVerified: result.fieldCount });
    } catch (e) {
      if (e instanceof VerificationError) {
        if (e.groupId) {
          store.addOffer({
            templateId: template.id, templateName: template.name, createdBy: req.user, ...summary,
            signerName: signer.name, signerEmail: signer.email, groupId: e.groupId,
            status: 'Failed field check, not sent', failed: true, values,
          });
        }
        store.log({ action: 'offer_failed_check', ...logBase, groupId: e.groupId, problems: e.problems });
        return res.status(422).json({
          error: 'The document did not fill correctly, so no link was created. Do not send anything to the seller. Tell Matt.',
          problems: e.problems,
        });
      }
      store.log({ action: 'offer_error', ...logBase, error: e.message });
      console.error('Offer failed:', e.message, e.body ? JSON.stringify(e.body) : '');
      res.status(502).json({ error: 'SignNow returned an error. No link was created.', problems: [e.message] });
    }
  });

  app.get('/api/offers', requireUser, async (req, res) => {
    const offers = store.recentOffers(50);
    // Refresh status from SignNow for recent offers that are still open.
    const toCheck = offers.filter((o) => o.inviteId && !o.failed && o.status !== 'Signed').slice(0, 15);
    await Promise.all(toCheck.map(async (o) => {
      try {
        const s = await getStatus(signnow, o.groupId);
        if (s.label !== o.status) store.updateOffer(o.id, { status: s.label });
      } catch {
        // Leave the last known status if SignNow is slow or unreachable.
      }
    }));
    res.json({ offers: store.recentOffers(50).map(publicOffer) });
  });

  app.post('/api/offers/:id/link', requireUser, async (req, res) => {
    const offer = store.getOffer(req.params.id);
    if (!offer || offer.failed || !offer.documentId) return res.status(404).json({ error: 'Offer not found' });
    const template = templates.get(offer.templateId);

    const wait = linkLimiter.hit(req.user);
    if (wait) return tooMany(res, wait);

    try {
      const { inviteId, link } = await regenerateLink(signnow, template, offer);
      if (inviteId !== offer.inviteId) store.updateOffer(offer.id, { inviteId });
      store.log({ action: 'link_regenerated', user: req.user, ip: req.ip, offerId: offer.id, groupId: offer.groupId });
      res.json({ link });
    } catch (e) {
      store.log({ action: 'link_error', user: req.user, offerId: offer.id, error: e.message });
      res.status(502).json({ error: e.message });
    }
  });

  app.get('/api/activity', requireUser, (req, res) => {
    if (!admins.has(req.user)) return res.status(403).json({ error: 'Only admins can see the activity log' });
    res.json({ entries: store.readLog(300) });
  });

  return app;
}

// What the browser sees in the history list. No internal IDs beyond our own.
function publicOffer(o) {
  return {
    id: o.id,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
    templateName: o.templateName,
    seller: o.seller,
    address: o.address,
    price: o.price,
    status: o.status,
    canRegenerate: Boolean(o.documentId && !o.failed && o.status !== 'Signed'),
  };
}

if (require.main === module) {
  const env = process.env;
  if (!env.SESSION_SECRET) console.warn('SESSION_SECRET is not set: everyone will be logged out on every restart.');
  if (!parsePins(env.ACCESS_PINS).length) console.warn('ACCESS_PINS is not set: nobody can log in.');
  const signnow = new SignNowClient(env);
  if (!signnow.isConfigured()) console.warn('SignNow credentials are not set: offers will fail.');
  const port = Number(env.PORT) || 3000;
  createApp({ env, signnow }).listen(port, () => console.log(`Offer app listening on port ${port}`));
}

module.exports = { createApp };
