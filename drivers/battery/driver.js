'use strict';

const FrankDriver = require('../../lib/FrankDriver');

/** Home batteries under Frank Smart Trading. */
class BatteryDriver extends FrankDriver {

  get noItemsMessage() {
    return 'error.no_batteries';
  }

  async listFrankDevices(api) {
    const batteries = await api.smartBatteries();
    return batteries.map((b) => {
      const name = [b.brand, b.capacity ? `${b.capacity} kWh` : null].filter(Boolean).join(' ');
      return {
        name: `Frank Smart Trading ${name || b.id}`.trim(),
        data: { id: b.id },
      };
    });
  }

}

module.exports = BatteryDriver;
