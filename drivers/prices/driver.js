'use strict';

const Homey = require('homey');
const P = require('../../lib/prices');

class PricesDriver extends Homey.Driver {

  async onInit() {
    this.triggers = {};
    for (const id of [
      'price_changed', 'price_below', 'price_above',
      'lowest_price_started', 'highest_price_started',
      'cheapest_block_started', 'tomorrow_available',
    ]) {
      this.triggers[id] = this.homey.flow.getDeviceTriggerCard(id);
    }

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

  /**
   * Fire a device trigger card. For cheapest_block_started the tokens are
   * argument dependent, so that card is triggered per matching flow below.
   */
  async trigger(id, device, tokens, state) {
    const card = this.triggers[id];
    if (!card) return;
    if (id === 'cheapest_block_started') {
      // Evaluate each flow's argument; trigger with the tokens for that block.
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

  async onPairListDevices() {
    return [
      {
        name: this.homey.__('pair.device_name'),
        data: { id: `frank-prices-${Date.now().toString(36)}` },
      },
    ];
  }

}

module.exports = PricesDriver;
