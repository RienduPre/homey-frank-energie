'use strict';

const FrankDriver = require('../../lib/FrankDriver');

/** Solar installations steered by Frank (smart feed-in / Smart PV). */
class PvDriver extends FrankDriver {

  get noItemsMessage() {
    return 'error.no_pv';
  }

  async listFrankDevices(api) {
    const systems = await api.smartPvSystems();
    return systems.map((s) => ({
      name: `Frank ${s.displayName || [s.brand, s.model].filter(Boolean).join(' ') || 'PV'}`,
      data: { id: s.id },
    }));
  }

}

module.exports = PvDriver;
