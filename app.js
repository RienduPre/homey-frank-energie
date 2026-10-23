'use strict';

const Homey = require('homey');
const P = require('./lib/prices');
const { FrankEnergieApi } = require('./lib/FrankEnergieApi');

const TRIGGERS = [
  'price_changed', 'price_below', 'price_above',
  'lowest_price_started', 'highest_price_started',
  'cheapest_block_started', 'tomorrow_available',
];

/** Drivers whose devices use the Frank account login. */
const ACCOUNT_DRIVERS = ['account', 'battery', 'ev', 'pv'];

/** Drivers whose devices track prices (and can feed the dashboard widgets). */
const PRICE_DRIVERS = ['prices', 'account'];

/** Dashboard widgets; each has a `device` autocomplete setting. */
const WIDGETS = ['price_now', 'price_forecast', 'price_chart'];

/**
 * Price flow cards are app-wide and work for both the "Dynamic prices"
 * and the "Frank account" devices (device argument filter in the card).
 *
 * The app holds the one Frank login (tokens) that all account devices share,
 * so a token renewal by one device never invalidates another.
 */
class FrankEnergieApp extends Homey.App {

  async onInit() {
    this.api = new FrankEnergieApi({
      tokens: this.homey.settings.get('tokens'),
      onTokens: (tokens) => this.homey.settings.set('tokens', tokens),
    });

    this.registerPriceCards();
    this.registerEvCards();
    this.registerBatteryCards();
    this.registerWidgets();
    this.log('Frank Energie app started');
  }

  // ------------------------------------------------------------------ login

  /** New tokens after a login (pairing or repair): store and wake all devices. */
  async setTokens(tokens) {
    this.homey.settings.set('tokens', tokens);
    this.api.setTokens(tokens);
    for (const device of this.accountDevices()) {
      if (typeof device.onReauthenticated === 'function') {
        await device.onReauthenticated().catch((e) => this.error(e));
      }
    }
  }

  /** Migration from v0.2.0, where tokens lived in the account device store. */
  adoptTokens(tokens) {
    if (this.api.isAuthenticated || !tokens || !tokens.authToken) return;
    this.homey.settings.set('tokens', tokens);
    this.api.setTokens(tokens);
  }

  accountDevices() {
    const devices = [];
    for (const id of ACCOUNT_DRIVERS) {
      try {
        devices.push(...this.homey.drivers.getDriver(id).getDevices());
      } catch (err) {
        // driver not ready yet
      }
    }
    return devices;
  }

  // ---------------------------------------------------------------- widgets

  priceDevices() {
    const devices = [];
    for (const id of PRICE_DRIVERS) {
      try {
        devices.push(...this.homey.drivers.getDriver(id).getDevices());
      } catch (err) {
        // driver not ready yet
      }
    }
    return devices.filter((d) => typeof d.widgetData === 'function');
  }

  registerWidgets() {
    for (const id of WIDGETS) {
      try {
        this.homey.dashboards.getWidget(id)
          .registerSettingAutocompleteListener('device', async (query) => {
            const q = String(query || '').toLowerCase();
            return this.priceDevices()
              .map((d) => ({
                name: d.getName(),
                description: this.homey.__(`widget.source_${d.driver.id}`),
                key: d.widgetKey,
              }))
              .filter((item) => item.name.toLowerCase().includes(q));
          });
      } catch (err) {
        this.error(`Widget ${id} not available:`, err.message);
      }
    }
  }

  /**
   * Payload for a dashboard widget. `key` is the device picked in the widget's
   * settings; without it (or when it is gone) the first price device is used.
   */
  getWidgetData(key) {
    const devices = this.priceDevices();
    if (!devices.length) {
      const err = new Error(this.homey.__('widget.no_device'));
      err.code = 'no_device';
      throw err;
    }
    const device = (key && devices.find((d) => d.widgetKey === key)) || devices[0];
    return device.widgetData();
  }

  // ------------------------------------------------------------ price cards

  registerPriceCards() {
    this.triggers = {};
    for (const id of TRIGGERS) this.triggers[id] = this.homey.flow.getDeviceTriggerCard(id);

    // Crossing logic: only fire when the threshold is actually crossed.
    this.triggers.price_below.registerRunListener(async (args, state) => {
      return state.previous >= args.threshold && state.price < args.threshold;
    });
    this.triggers.price_above.registerRunListener(async (args, state) => {
      return state.previous <= args.threshold && state.price > args.threshold;
    });
    // trigger() fires this card once per distinct `hours` value whose block starts now.
    this.triggers.cheapest_block_started.registerRunListener(async (args, state) => {
      return Number(args.hours) === state.hours;
    });

    this.homey.flow.getConditionCard('price_compare')
      .registerRunListener(async ({ device, threshold }) => device.currentPrice() < threshold);
    this.homey.flow.getConditionCard('among_cheapest')
      .registerRunListener(async ({ device, hours }) => device.isAmongCheapest(hours));
    this.homey.flow.getConditionCard('among_most_expensive')
      .registerRunListener(async ({ device, hours }) => device.isAmongMostExpensive(hours));
    this.homey.flow.getConditionCard('below_average')
      .registerRunListener(async ({ device }) => device.isBelowAverage());
    this.homey.flow.getConditionCard('in_cheapest_block')
      .registerRunListener(async ({ device, hours }) => device.isInCheapestBlock(hours));

    this.homey.flow.getActionCard('refresh')
      .registerRunListener(async ({ device }) => device.refresh());
  }

  // --------------------------------------------------------------- EV cards

  registerEvCards() {
    for (const id of ['ev_charging_started', 'ev_charging_stopped', 'ev_plugged_in', 'ev_unplugged']) {
      this.triggers[id] = this.homey.flow.getDeviceTriggerCard(id);
    }
    this.homey.flow.getConditionCard('ev_is_charging')
      .registerRunListener(async ({ device }) => device.getCapabilityValue('frank_ev_charging') === true);
    this.homey.flow.getConditionCard('ev_is_plugged_in')
      .registerRunListener(async ({ device }) => device.getCapabilityValue('frank_ev_plugged_in') === true);
    this.homey.flow.getConditionCard('ev_smart_charging_on')
      .registerRunListener(async ({ device }) => device.getCapabilityValue('frank_smart_charging') === true);
    this.homey.flow.getActionCard('ev_set_smart_charging')
      .registerRunListener(async ({ device, state }) => device.setSmartCharging(state === 'on'));
    this.homey.flow.getActionCard('ev_set_solar_charging')
      .registerRunListener(async ({ device, state }) => device.setSolarCharging(state === 'on'));
    this.homey.flow.getActionCard('ev_set_max_charge_limit')
      .registerRunListener(async ({ device, percent }) => device.setChargeLimit('max', percent));
    this.homey.flow.getActionCard('ev_set_min_charge_limit')
      .registerRunListener(async ({ device, percent }) => device.setChargeLimit('min', percent));
    this.homey.flow.getActionCard('ev_set_deadline')
      .registerRunListener(async ({ device, time }) => device.setDeadline(time));
  }

  // ---------------------------------------------------------- battery cards

  registerBatteryCards() {
    this.homey.flow.getActionCard('battery_set_mode')
      .registerRunListener(async ({ device, mode }) => device.updateSettings({ batteryMode: mode }));
    this.homey.flow.getActionCard('battery_set_strategy')
      .registerRunListener(async ({ device, strategy }) => device.updateSettings({ imbalanceTradingStrategy: strategy }));
  }

  /**
   * Fire a device trigger card. cheapest_block_started has argument-dependent
   * tokens, so it is triggered once per distinct `hours` value in use.
   */
  async trigger(id, device, tokens, state) {
    const card = this.triggers[id];
    if (!card) return;
    if (id === 'cheapest_block_started') {
      const argValues = await card.getArgumentValues(device).catch(() => []);
      const seen = new Set();
      for (const args of argValues) {
        const hours = Number(args.hours);
        if (!hours || seen.has(hours)) continue;
        seen.add(hours);
        const block = device.cheapestBlockToday(hours);
        if (!block || block.from.getTime() !== state.from.getTime()) continue;
        await card.trigger(device, {
          average: block.avg,
          until: P.localTime(block.till, device.tz),
        }, { ...state, hours });
      }
      return;
    }
    await card.trigger(device, tokens, state);
  }

}

module.exports = FrankEnergieApp;
