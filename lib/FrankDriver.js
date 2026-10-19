'use strict';

const Homey = require('homey');
const { FrankEnergieApi, FrankEnergieAuthError } = require('./FrankEnergieApi');

/**
 * Base driver for everything behind the Frank account login.
 *
 * Pairing skips the login screen when the app already holds a working login,
 * so adding a battery or car after the account does not ask for the password
 * again. The password itself is never stored, only Frank's tokens.
 *
 * Subclasses implement listFrankDevices(api) and may override validateRepair().
 */
class FrankDriver extends Homey.Driver {

  async onPair(session) {
    const app = this.homey.app;
    let loggedIn = false;

    session.setHandler('showView', async (view) => {
      if (view !== 'login_credentials' || loggedIn || !app.api.isAuthenticated) return;
      try {
        await app.api.userSites(); // proves the stored login still works
        loggedIn = true;
        await session.showView('list_devices');
      } catch (err) {
        this.log('Stored login not usable, asking for credentials:', err.message);
      }
    });

    session.setHandler('login', async ({ username, password }) => {
      const api = new FrankEnergieApi();
      try {
        await api.login(String(username || '').trim(), password);
      } catch (err) {
        throw new Error(this.loginErrorMessage(err));
      }
      await app.setTokens(api.tokens);
      loggedIn = true;
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!app.api.isAuthenticated) throw new Error(this.homey.__('error.not_logged_in'));
      const devices = await this.listFrankDevices(app.api);
      if (!devices.length) throw new Error(this.homey.__(this.noItemsMessage || 'error.no_items'));
      return devices;
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const api = new FrankEnergieApi();
      try {
        await api.login(String(username || '').trim(), password);
      } catch (err) {
        throw new Error(this.loginErrorMessage(err));
      }
      await this.validateRepair(api, device);
      await this.homey.app.setTokens(api.tokens);
      return true;
    });
  }

  /** @abstract */
  async listFrankDevices(api) { // eslint-disable-line no-unused-vars
    return [];
  }

  /** Throw when the new login cannot see this device. */
  async validateRepair(api, device) {} // eslint-disable-line no-unused-vars

  loginErrorMessage(err) {
    if (err instanceof FrankEnergieAuthError) return this.homey.__('error.login_failed');
    return `${this.homey.__('error.connection')} (${err.message})`;
  }

}

module.exports = FrankDriver;
