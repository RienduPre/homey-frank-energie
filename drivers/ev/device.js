'use strict';

const { FrankDevice, num } = require('../../lib/FrankDevice');
const { FrankEnergieError } = require('../../lib/FrankEnergieApi');
const P = require('../../lib/prices');

/** Capabilities a wall charger does not report. */
const VEHICLE_ONLY = ['measure_battery', 'frank_ev_range'];

/** A car or wall charger under Frank Slim Laden. */
class EvDevice extends FrankDevice {

  static POLL_MS = 5 * 60 * 1000;

  get kind() {
    return this.getStoreValue('kind') === 'charger' ? 'charger' : 'vehicle';
  }

  get tz() {
    return this.homey.clock.getTimezone() || 'Europe/Amsterdam';
  }

  excludedCapabilities() {
    return this.kind === 'charger' ? VEHICLE_ONLY : [];
  }

  async onFrankInit() {
    this.chargeSettings = null;
    this.registerCapabilityListener('frank_smart_charging', (value) => this.setSmartCharging(value));
    this.registerCapabilityListener('frank_solar_charging', (value) => this.setSolarCharging(value));
  }

  async poll() {
    const id = this.getData().id;
    const list = this.kind === 'charger' ? await this.api.enodeChargers() : await this.api.enodeVehicles();
    const item = list.find((x) => x && x.id === id);
    if (!item) throw new FrankEnergieError('Device not in account', 'not-found');

    this.chargeSettings = item.chargeSettings || null;
    const cs = this.chargeSettings || {};
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
    await this.set('frank_smart_charging', cs.isSmartChargingEnabled === true);
    await this.set('frank_solar_charging', cs.isSolarChargingEnabled === true);
    await this.set('frank_ev_max_charge_limit', num(cs.maxChargeLimit));
    await this.set('frank_ev_min_charge_limit', num(cs.minChargeLimit));
    await this.set('frank_ev_ready_by', this.formatDeadline(cs.calculatedDeadline || cs.deadline));

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

  /** "07:00", "morgen 07:00" or "2026-11-03 07:00". */
  formatDeadline(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const today = P.localDate(new Date(), this.tz);
    const day = P.localDate(d, this.tz);
    const time = P.localTime(d, this.tz);
    if (day === today) return time;
    if (day === P.addDays(today, 1)) return `${this.homey.__('tomorrow')} ${time}`;
    return `${day} ${time}`;
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

  // ---------------------------------------------------------------- settings

  /** Send changed charge settings (the API wants the full set every time). */
  async updateSettings(overrides) {
    if (!this.chargeSettings) await this.poll();
    try {
      await this.api.updateChargeSettings(this.kind, this.chargeSettings, overrides);
    } catch (err) {
      this.error('Charge settings update failed:', err.message);
      await this.handleError(err);
      throw new Error(this.homey.__('error.charge_settings_failed'));
    }
    this.chargeSettings = { ...this.chargeSettings, ...overrides };
    this.homey.setTimeout(() => this.update(), 10 * 1000);
  }

  async setSmartCharging(on) {
    await this.updateSettings({ isSmartChargingEnabled: !!on });
    await this.set('frank_smart_charging', !!on);
  }

  async setSolarCharging(on) {
    await this.updateSettings({ isSolarChargingEnabled: !!on });
    await this.set('frank_solar_charging', !!on);
  }

  /** @param {'max'|'min'} which */
  async setChargeLimit(which, percent) {
    const value = Math.round(Number(percent) / 5) * 5;
    if (!this.chargeSettings) await this.poll();
    const cs = this.chargeSettings || {};
    const min = which === 'min' ? value : num(cs.minChargeLimit);
    const max = which === 'max' ? value : num(cs.maxChargeLimit);
    if (which === 'max' && (value < 50 || value > 100)) throw new Error(this.homey.__('error.max_limit_range'));
    if (which === 'min' && (value < 0 || value > 100)) throw new Error(this.homey.__('error.min_limit_range'));
    if (min !== null && max !== null && min > max) throw new Error(this.homey.__('error.min_above_max'));
    await this.updateSettings(which === 'max' ? { maxChargeLimit: value } : { minChargeLimit: value });
    await this.set(which === 'max' ? 'frank_ev_max_charge_limit' : 'frank_ev_min_charge_limit', value);
  }

  /** Ready-by time "HH:MM": the next moment that time comes around. */
  async setDeadline(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) throw new Error(this.homey.__('error.invalid_time'));
    const deadline = nextLocalTime(Number(m[1]), Number(m[2]), this.tz);
    await this.updateSettings({ deadline: deadline.toISOString() });
    await this.set('frank_ev_ready_by', this.formatDeadline(deadline));
  }

}

/** The next Date (after now) at local HH:MM in the given time zone. */
function nextLocalTime(hours, minutes, tz, now = new Date()) {
  for (let offset = 0; offset < 3; offset++) {
    const ymd = P.addDays(P.localDate(now, tz), offset);
    const midnight = P.startOfLocalDay(new Date(`${ymd}T12:00:00Z`), tz);
    // step from local midnight; re-check the wall clock so DST days stay right
    let t = new Date(midnight.getTime() + (hours * 60 + minutes) * 60000);
    const [h] = P.localTime(t, tz).split(':').map(Number);
    if (h !== hours) t = new Date(t.getTime() + (hours - h) * 3600000);
    if (t > now) return t;
  }
  return new Date(now.getTime() + 86400000);
}

EvDevice.nextLocalTime = nextLocalTime;

module.exports = EvDevice;
