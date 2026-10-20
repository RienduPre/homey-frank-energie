'use strict';

const PriceDevice = require('../../lib/PriceDevice');
const { FrankEnergieAuthError } = require('../../lib/FrankEnergieApi');
const P = require('../../lib/prices');
const { syncCapabilities } = require('../../lib/FrankDevice');

const ACCOUNT_REFRESH_MS = 60 * 60 * 1000; // account data changes at most daily

/**
 * A Frank Energie delivery site: customer prices plus costs, usage and invoices.
 */
class AccountDevice extends PriceDevice {

  async onInit() {
    this.authFailed = false;
    await syncCapabilities(this);
    await super.onInit();
    await this.refreshAccount().catch((err) => this.error('Account refresh failed:', err.message));
    this.accountTimer = this.homey.setInterval(
      () => this.refreshAccount().catch((err) => this.error('Account refresh failed:', err.message)),
      ACCOUNT_REFRESH_MS,
    );
  }

  async onUninit() {
    await super.onUninit();
    if (this.accountTimer) this.homey.clearInterval(this.accountTimer);
  }

  get siteReference() {
    return this.getData().id;
  }

  /** The login is shared app-wide; v0.2.0 kept it in this device's store. */
  createApi() {
    const app = this.homey.app;
    app.adoptTokens(this.getStoreValue('tokens'));
    return app.api;
  }

  /** Called by the app after a new login (pairing or repair). */
  async onReauthenticated() {
    this.authFailed = false;
    await this.setAvailable().catch(() => {});
    await this.refresh().catch((e) => this.error(e));
    await this.refreshAccount().catch((e) => this.error(e));
  }

  async fetchPrices(date) {
    return this.api.customerPrices(date, this.siteReference);
  }

  async refresh() {
    if (this.authFailed) return;
    try {
      await super.refresh();
    } catch (err) {
      await this.handleError(err);
      throw err;
    }
  }

  async handleError(err) {
    if (err instanceof FrankEnergieAuthError) {
      this.authFailed = true;
      await this.setUnavailable(this.homey.__('error.reauth')).catch(() => {});
    }
  }

  async refreshAccount() {
    if (this.authFailed) return;
    const ref = this.siteReference;
    const yesterday = P.addDays(P.localDate(new Date(), this.tz), -1);
    const set = (cap, value) => this.setCapabilityValue(cap, value).catch((e) => this.error(cap, e.message));
    const money = (v) => (Number.isFinite(Number(v)) && v !== null ? Math.round(Number(v) * 100) / 100 : null);

    // Each call is independent: one missing feature must not blank the others.
    const results = await Promise.allSettled([
      this.api.monthSummary(ref),
      this.api.periodUsageAndCosts(ref, yesterday),
      this.api.invoices(ref),
      this.api.smartHvacStatus(),
    ]);

    const authErr = results.find((r) => r.status === 'rejected' && r.reason instanceof FrankEnergieAuthError);
    if (authErr) {
      await this.handleError(authErr.reason);
      return;
    }

    const [summary, usage, invoices, hvac] = results.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
    results.forEach((r, i) => {
      const name = ['monthSummary', 'periodUsageAndCosts', 'invoices', 'smartHvac'][i];
      if (r.status === 'rejected') this.log(name, 'failed:', r.reason.message);
      else if (!r.value) this.log(name, 'returned no data for', ref);
    });

    if (summary) {
      await set('frank_costs_month', money(summary.actualCostsUntilLastMeterReadingDate));
      await set('frank_costs_month_expected', money(summary.expectedCostsUntilLastMeterReadingDate));
      await set('frank_costs_month_forecast', money(summary.expectedCosts));
      await set('frank_last_reading', summary.lastMeterReadingDate ? String(summary.lastMeterReadingDate).slice(0, 10) : null);
    }

    if (usage) {
      const part = (o, key) => (o && Number.isFinite(Number(o[key])) ? Math.round(Number(o[key]) * 100) / 100 : null);
      await set('frank_usage_elec_yesterday', part(usage.electricity, 'usageTotal'));
      await set('frank_costs_elec_yesterday', part(usage.electricity, 'costsTotal'));
      await set('frank_usage_feedin_yesterday', part(usage.feedIn, 'usageTotal'));
      await set('frank_costs_feedin_yesterday', part(usage.feedIn, 'costsTotal'));
      await set('frank_usage_gas_yesterday', part(usage.gas, 'usageTotal'));
      await set('frank_costs_gas_yesterday', part(usage.gas, 'costsTotal'));
    }

    if (hvac) await set('frank_smart_hvac', hvac.isActivated === true);

    if (invoices) {
      await set('frank_invoice_previous', money(invoices.previousPeriodInvoice && invoices.previousPeriodInvoice.totalAmount));
      await set('frank_invoice_current', money(invoices.currentPeriodInvoice && invoices.currentPeriodInvoice.totalAmount));
    }
  }

}

module.exports = AccountDevice;
