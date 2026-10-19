'use strict';

const { FrankEnergieAuthError } = require('../../lib/FrankEnergieApi');
const { FrankDevice, money, num } = require('../../lib/FrankDevice');
const P = require('../../lib/prices');

/** A home battery traded by Frank Smart Trading. */
class BatteryDevice extends FrankDevice {

  static POLL_MS = 15 * 60 * 1000;

  get tz() {
    return this.homey.clock.getTimezone() || 'Europe/Amsterdam';
  }

  async poll() {
    const id = this.getData().id;
    const today = P.localDate(new Date(), this.tz);
    const monthStart = `${today.slice(0, 8)}01`;
    const tomorrow = P.addDays(today, 1);
    const yesterday = P.addDays(today, -1);

    const [details, sessions] = await Promise.all([
      this.api.smartBattery(id),
      // until tomorrow, so today's (not yet final) result is included
      this.api.smartBatterySessions(id, monthStart, tomorrow).catch((err) => {
        if (err instanceof FrankEnergieAuthError) throw err;
        this.log('Sessions failed:', err.message);
        return null;
      }),
    ]);

    const summary = details.summary || {};
    const settings = (details.battery && details.battery.settings) || {};
    const status = summary.lastKnownStatus;
    const unreliable = String(status || '').toLowerCase() === 'status_unreliable_data';

    const soc = num(summary.lastKnownStateOfCharge);
    await this.set('measure_battery', soc === null || unreliable ? null : Math.max(0, Math.min(100, Math.round(soc))));
    await this.set('frank_battery_status', this.statusLabel(status));
    await this.set('frank_battery_mode', this.statusLabel(settings.batteryMode));
    await this.set('frank_trading_result_total', money(summary.totalResult));
    await this.set('frank_battery_last_update', summary.lastUpdate ? P.localTime(new Date(summary.lastUpdate), this.tz) : null);

    if (sessions) {
      const day = (s) => (String(s.date).length === 10 ? s.date : P.localDate(new Date(s.date), this.tz));
      const sumFor = (ymd) => {
        const list = (sessions.sessions || []).filter((s) => s && s.date && day(s) === ymd);
        return list.length ? money(list.reduce((acc, s) => acc + (num(s.result) || 0), 0)) : null;
      };
      await this.set('frank_trading_result_today', sumFor(today));
      await this.set('frank_trading_result_yesterday', sumFor(yesterday));
      await this.set('frank_trading_result_month', money(sessions.periodTotalResult));
    }
  }

}

module.exports = BatteryDevice;
