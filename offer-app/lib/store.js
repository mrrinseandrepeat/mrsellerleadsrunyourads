'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_OFFERS = 1000;

// History of offers (offers.json) plus an append-only activity log (activity.log).
// Lives in DATA_DIR, which must be a persistent disk in production.
class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.offersFile = path.join(dataDir, 'offers.json');
    this.logFile = path.join(dataDir, 'activity.log');
    this.offers = [];
    if (fs.existsSync(this.offersFile)) {
      this.offers = JSON.parse(fs.readFileSync(this.offersFile, 'utf8'));
    }
  }

  save() {
    const tmp = this.offersFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.offers, null, 1));
    fs.renameSync(tmp, this.offersFile);
  }

  addOffer(offer) {
    const record = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), ...offer };
    this.offers.unshift(record);
    if (this.offers.length > MAX_OFFERS) this.offers.length = MAX_OFFERS;
    this.save();
    return record;
  }

  updateOffer(id, changes) {
    const offer = this.getOffer(id);
    if (!offer) return null;
    Object.assign(offer, changes);
    this.save();
    return offer;
  }

  getOffer(id) {
    return this.offers.find((o) => o.id === id) || null;
  }

  recentOffers(limit = 50) {
    return this.offers.slice(0, limit);
  }

  // One JSON object per line. Never pass signing links here: they work as passwords.
  log(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(this.logFile, line);
  }

  readLog(limit = 200) {
    if (!fs.existsSync(this.logFile)) return [];
    const lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((l) => JSON.parse(l));
  }
}

module.exports = { Store };
