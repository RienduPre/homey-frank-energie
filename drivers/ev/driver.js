'use strict';

const FrankDriver = require('../../lib/FrankDriver');

/** Cars and wall chargers connected to Frank Slim Laden (via Enode). */
class EvDriver extends FrankDriver {

  get noItemsMessage() {
    return 'error.no_ev';
  }

  async listFrankDevices(api) {
    const [vehicles, chargers] = await Promise.all([api.enodeVehicles(), api.enodeChargers()]);
    const label = (item, fallback) => {
      const info = item.information || {};
      return [info.brand, info.model].filter(Boolean).join(' ') || fallback;
    };
    return [
      ...vehicles.map((v) => ({
        name: `Frank Slim Laden ${label(v, this.homey.__('ev.vehicle'))}`,
        data: { id: v.id },
        store: { kind: 'vehicle' },
      })),
      ...chargers.map((c) => ({
        name: `Frank Slim Laden ${label(c, this.homey.__('ev.charger'))}`,
        data: { id: c.id },
        store: { kind: 'charger' },
      })),
    ];
  }

}

module.exports = EvDriver;
