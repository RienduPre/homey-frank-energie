'use strict';

const Homey = require('homey');

class FrankEnergieApp extends Homey.App {

  async onInit() {
    this.log('Frank Energie app started');
  }

}

module.exports = FrankEnergieApp;
