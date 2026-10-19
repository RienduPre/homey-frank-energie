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
