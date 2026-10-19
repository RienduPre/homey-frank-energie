'use strict';

const { FrankDevice, num } = require('../../lib/FrankDevice');
const { FrankEnergieError } = require('../../lib/FrankEnergieApi');

/** Capabilities a wall charger does not report. */
const VEHICLE_ONLY = ['measure_battery', 'frank_ev_range'];

/** A car or wall charger under Frank Slim Laden. */
class EvDevice extends FrankDevice {

  static POLL_MS = 5 * 60 * 1000;

  get kind() {
    return this.getStoreValue('kind') === 'charger' ? 'charger' : 'vehicle';
  }

  async onFrankInit() {
    if (this.kind === 'charger') {
      for (const cap of VEHICLE_ONLY) {
        if (this.hasCapability(cap)) await this.removeCapability(cap).catch((e) => this.error(e));
      }
    }
    this.chargeSettings = null;
    this.registerCapabilityListener('frank_smart_charging', (value) => this.setSmartCharging(value));
  }

  async poll() {
    const id = this.getData().id;
    const list = this.kind === 'charger' ? await this.api.enodeChargers() : await this.api.enodeVehicles();
    const item = list.find((x) => x && x.id === id);
    if (!item) throw new FrankEnergieError('Device not in account', 'not-found');

    this.chargeSettings = item.chargeSettings || null;
    const state = item.chargeState || {};
    const before = {
      charging: this.getCapabilityValue('frank_ev_charging'),
      plugged: this.getCapabilityValue('frank_ev_plugged_in'),
    };

    const rate = num(state.chargeRate); // kW
    const charging = state.isCharging === true;
    const plugged = state.isPluggedIn === true;

    await this.set('measure_battery', num(state.batteryLevel));
    await this.set('frank_ev_charging', charging);
    await this.set('frank_ev_plugged_in', plugged);
    await this.set('measure_power', rate === null ? null : Math.round(rate * 1000));
    await this.set('frank_ev_range', num(state.range));
    await this.set('frank_ev_charge_limit', num(state.chargeLimit));
    await this.set('frank_ev_time_remaining', num(state.chargeTimeRemaining));
    await this.set('frank_smart_charging', !!(this.chargeSettings && this.chargeSettings.isSmartChargingEnabled));

    const intervention = (item.interventions || []).find((i) => i && (i.title || i.description));
    if (item.isReachable === false) {
      await this.setWarning(this.homey.__('error.unreachable')).catch(() => {});
    } else if (intervention) {
      await this.setWarning(intervention.title || intervention.description).catch(() => {});
    } else {
      await this.unsetWarning().catch(() => {});
    }

    await this.fireTransitions(before, { charging, plugged });
  }

  /** Flow triggers on changes between two polls (not on the first poll). */
  async fireTransitions(before, now) {
    const app = this.homey.app;
    const fire = (id) => app.trigger(id, this, { battery: this.getCapabilityValue('measure_battery') || 0 }, {})
      .catch((e) => this.error(e));
    if (typeof before.charging === 'boolean' && before.charging !== now.charging) {
      await fire(now.charging ? 'ev_charging_started' : 'ev_charging_stopped');
    }
    if (typeof before.plugged === 'boolean' && before.plugged !== now.plugged) {
      await fire(now.plugged ? 'ev_plugged_in' : 'ev_unplugged');
    }
  }

  /** Switch Frank smart charging on or off (capability toggle and flow action). */
  async setSmartCharging(on) {
    if (!this.chargeSettings) await this.poll();
    try {
      await this.api.updateChargeSettings(this.kind, this.chargeSettings, { isSmartChargingEnabled: !!on });
    } catch (err) {
      this.error('Smart charging update failed:', err.message);
      await this.handleError(err);
      throw new Error(this.homey.__('error.smart_charging_failed'));
    }
    this.chargeSettings = { ...this.chargeSettings, isSmartChargingEnabled: !!on };
    await this.set('frank_smart_charging', !!on);
    this.homey.setTimeout(() => this.update(), 10 * 1000);
  }

}

module.exports = EvDevice;
