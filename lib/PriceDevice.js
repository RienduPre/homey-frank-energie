'use strict';

const Homey = require('homey');
const { FrankEnergieApi } = require('./FrankEnergieApi');
const P = require('./prices');

const TICK_MS = 30 * 1000; // check for a new price slot every 30 s
const FETCH_MS = 60 * 60 * 1000; // normal refresh: hourly
const FETCH_WAIT_TOMORROW_MS = 15 * 60 * 1000; // after 12:00 until tomorrow is known

/**
 * Base device for everything that tracks Frank Energie prices.
 * Subclasses can override createApi() and fetchPrices().
 */
class PriceDevice extends Homey.Device {

  async onInit() {
    this.api = this.createApi();
    this.elec = []; // normalized electricity entries (today + tomorrow)
    this.gas = [];
    this.rawElec = [];
    this.rawGas = [];
    this.currentFrom = null;
    this.lastPrice = null;
    this.tomorrowNotifiedFor = this.getStoreValue('tomorrowNotifiedFor') || null;

    await this.refresh().catch((err) => this.error('Initial refresh failed:', err.message));

    this.tickTimer = this.homey.setInterval(() => this.tick().catch((e) => this.error(e)), TICK_MS);
    this.scheduleFetch();
  }

  async onUninit() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    if (this.fetchTimer) this.homey.clearTimeout(this.fetchTimer);
  }

  async onDeleted() {
    await this.onUninit();
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('resolution') || changedKeys.includes('country')) {
      this.homey.setTimeout(() => this.refresh().catch((e) => this.error(e)), 500);
    } else {
      this.homey.setTimeout(() => this.renormalize().catch((e) => this.error(e)), 500);
    }
  }

  createApi() {
    return new FrankEnergieApi();
  }

  /** Prices for one local date. Override for customer prices. */
  async fetchPrices(date) {
    const resolution = this.getSetting('resolution') || 'PT15M';
    return this.api.marketPrices(date, resolution, this.getSetting('country') || 'NL');
  }

  get tz() {
    return this.homey.clock.getTimezone() || 'Europe/Amsterdam';
  }

  // ---------------------------------------------------------------- fetching

  scheduleFetch() {
    if (this.fetchTimer) this.homey.clearTimeout(this.fetchTimer);
    const delay = this.hasTomorrow() || this.localHour() < 12 ? FETCH_MS : FETCH_WAIT_TOMORROW_MS;
    this.fetchTimer = this.homey.setTimeout(async () => {
      await this.refresh().catch((err) => this.error('Refresh failed:', err.message));
      this.scheduleFetch();
    }, delay);
  }

  localHour() {
    return Number(P.localTime(new Date(), this.tz).slice(0, 2));
  }

  async refresh() {
    const today = P.localDate(new Date(), this.tz);
    const tomorrow = P.addDays(today, 1);

    let todayData;
    try {
      todayData = await this.fetchPrices(today);
    } catch (err) {
      if (this.elec.length) {
        await this.setWarning(this.homey.__('warning.fetch_failed')).catch(() => {});
      } else {
        await this.setUnavailable(this.homey.__('warning.fetch_failed')).catch(() => {});
      }
      throw err;
    }

    let tomorrowData = { electricity: [], gas: [] };
    try {
      tomorrowData = await this.fetchPrices(tomorrow);
    } catch (err) {
      this.log('Tomorrow not available yet:', err.message);
    }

    this.rawElec = [...todayData.electricity, ...tomorrowData.electricity];
    this.rawGas = [...todayData.gas, ...tomorrowData.gas];
    await this.renormalize();

    if (!this.elec.length) {
      await this.setUnavailable(this.homey.__('warning.no_prices')).catch(() => {});
      return;
    }
    await this.setAvailable().catch(() => {});
    await this.unsetWarning().catch(() => {});

    await this.checkTomorrowAvailable(tomorrow);
  }

  async renormalize() {
    const priceType = this.getSetting('price_type') || 'allInPrice';
    this.elec = P.normalize(this.rawElec, priceType);
    this.gas = P.normalize(this.rawGas, priceType);
    this.currentFrom = null; // force a full update
    await this.tick().catch((e) => this.error(e));
  }

  // ------------------------------------------------------------- day helpers

  dayRange(offsetDays = 0) {
    const start = P.startOfLocalDay(new Date(), this.tz);
    const s = P.startOfLocalDay(new Date(start.getTime() + (offsetDays * 24 + 12) * 3600 * 1000), this.tz);
    const e = P.startOfLocalDay(new Date(s.getTime() + 36 * 3600 * 1000), this.tz);
    return [s, e];
  }

  todayEntries() {
    const [s, e] = this.dayRange(0);
    return P.between(this.elec, s, e);
  }

  tomorrowEntries() {
    const [s, e] = this.dayRange(1);
    return P.between(this.elec, s, e);
  }

  hasTomorrow() {
    return this.tomorrowEntries().length > 0;
  }

  // ----------------------------------------------------------------- updates

  async tick() {
    if (!this.elec.length) return;
    const now = new Date();
    const cur = P.currentEntry(this.elec, now);
    if (!cur) return;
    const slotChanged = !this.currentFrom || this.currentFrom.getTime() !== cur.from.getTime();
    if (!slotChanged) return;
    this.currentFrom = cur.from;

    await this.updateCapabilities(now, cur);
    await this.fireSlotTriggers(now, cur);
    this.lastPrice = cur.price;
  }

  async updateCapabilities(now, cur) {
    const tz = this.tz;
    const next = P.nextEntry(this.elec, now);
    const today = P.stats(this.todayEntries());
    const tomorrow = P.stats(this.tomorrowEntries());
    const gas = P.currentEntry(this.gas, now);

    const blockHours = Number(this.getSetting('block_hours')) || 2;
    const upcoming = this.elec.filter((e) => e.till > now);
    const block = P.cheapestBlock(upcoming, blockHours * 60);

    const set = (cap, value) => this.setCapabilityValue(cap, value).catch((e) => this.error(cap, e.message));
    const round = (v) => (v === null || v === undefined ? null : Math.round(v * 10000) / 10000);

    await set('frank_price_now', round(cur.price));
    await set('frank_price_next', next ? round(next.price) : null);
    await set('frank_price_min_today', today ? round(today.min.price) : null);
    await set('frank_time_min_today', today ? P.localTime(today.min.from, tz) : null);
    await set('frank_price_max_today', today ? round(today.max.price) : null);
    await set('frank_time_max_today', today ? P.localTime(today.max.from, tz) : null);
    await set('frank_price_avg_today', today ? round(today.avg) : null);
    await set('frank_price_avg_tomorrow', tomorrow ? round(tomorrow.avg) : null);
    await set('frank_gas_price_now', gas ? round(gas.price) : null);
    await set('frank_cheapest_block', block ? this.formatBlock(block, now) : null);
  }

  formatBlock(block, now) {
    const tz = this.tz;
    const sameDay = P.localDate(block.from, tz) === P.localDate(now, tz);
    const prefix = sameDay ? '' : `${this.homey.__('tomorrow')} `;
    return `${prefix}${P.localTime(block.from, tz)}–${P.localTime(block.till, tz)}`;
  }

  async fireSlotTriggers(now, cur) {
    const next = P.nextEntry(this.elec, now);
    const app = this.homey.app;
    const today = this.todayEntries();
    const stats = P.stats(today);

    await app.trigger('price_changed', this,
      { price: cur.price, price_next: next ? next.price : 0 }, {}).catch((e) => this.error(e));

    if (this.lastPrice !== null) {
      const state = { price: cur.price, previous: this.lastPrice };
      await app.trigger('price_below', this, { price: cur.price }, state).catch((e) => this.error(e));
      await app.trigger('price_above', this, { price: cur.price }, state).catch((e) => this.error(e));
    }

    if (stats && stats.min.from.getTime() === cur.from.getTime()) {
      await app.trigger('lowest_price_started', this, { price: cur.price }, {}).catch((e) => this.error(e));
    }
    if (stats && stats.max.from.getTime() === cur.from.getTime()) {
      await app.trigger('highest_price_started', this, { price: cur.price }, {}).catch((e) => this.error(e));
    }

    await app.trigger('cheapest_block_started', this, {}, { now, from: cur.from }).catch((e) => this.error(e));
  }

  async checkTomorrowAvailable(tomorrowYmd) {
    const entries = this.tomorrowEntries();
    if (!entries.length || this.tomorrowNotifiedFor === tomorrowYmd) return;
    this.tomorrowNotifiedFor = tomorrowYmd;
    await this.setStoreValue('tomorrowNotifiedFor', tomorrowYmd).catch(() => {});
    const s = P.stats(entries);
    await this.homey.app.trigger('tomorrow_available', this, {
      average: s.avg,
      lowest: s.min.price,
      lowest_time: P.localTime(s.min.from, this.tz),
      highest: s.max.price,
    }, {}).catch((e) => this.error(e));
  }

  // ------------------------------------------------------- flow card helpers

  currentPrice() {
    const cur = P.currentEntry(this.elec, new Date());
    if (!cur) throw new Error(this.homey.__('warning.no_prices'));
    return cur.price;
  }

  isAmongCheapest(hours) {
    return P.isAmongCheapest(this.todayEntries(), new Date(), hours);
  }

  isAmongMostExpensive(hours) {
    return P.isAmongMostExpensive(this.todayEntries(), new Date(), hours);
  }

  isBelowAverage() {
    const s = P.stats(this.todayEntries());
    if (!s) throw new Error(this.homey.__('warning.no_prices'));
    return this.currentPrice() < s.avg;
  }

  cheapestBlockToday(hours) {
    return P.cheapestBlock(this.todayEntries(), hours * 60);
  }

  isInCheapestBlock(hours) {
    const block = this.cheapestBlockToday(hours);
    if (!block) return false;
    const t = Date.now();
    return block.from.getTime() <= t && t < block.till.getTime();
  }

}

module.exports = PriceDevice;
