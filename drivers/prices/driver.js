'use strict';

const Homey = require('homey');

class PricesDriver extends Homey.Driver {

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
