'use strict';

const Homey = require('homey');
const { FrankEnergieApi, FrankEnergieAuthError } = require('../../lib/FrankEnergieApi');

/**
 * Frank Energie account. Credentials are only used to log in; the app keeps
 * the auth/refresh tokens in the device store, never the password.
 */
class AccountDriver extends Homey.Driver {

  async onPair(session) {
    let api = null;

    session.setHandler('login', async ({ username, password }) => {
      api = new FrankEnergieApi();
      try {
        await api.login(username.trim(), password);
        return true;
      } catch (err) {
        throw new Error(this.loginErrorMessage(err));
      }
    });

    session.setHandler('list_devices', async () => {
      if (!api || !api.isAuthenticated) throw new Error(this.homey.__('error.not_logged_in'));
      const sites = await api.userSites();
      if (!sites.length) throw new Error(this.homey.__('error.no_sites'));
      return sites.map((site) => ({
        name: this.siteName(site),
        data: { id: site.reference },
        store: { tokens: api.tokens },
        settings: {
          site_reference: site.reference,
          address: (site.address && site.address.addressFormatted) || '',
        },
      }));
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const api = new FrankEnergieApi();
      try {
        await api.login(username.trim(), password);
      } catch (err) {
        throw new Error(this.loginErrorMessage(err));
      }
      const sites = await api.userSites();
      const ref = device.getData().id;
      if (!sites.some((s) => s.reference === ref)) {
        throw new Error(this.homey.__('error.site_not_in_account'));
      }
      await device.setTokens(api.tokens);
      return true;
    });
  }

  siteName(site) {
    const addr = site.address && site.address.addressFormatted;
    return addr ? `Frank ${addr}` : `Frank ${site.reference}`;
  }

  loginErrorMessage(err) {
    if (err instanceof FrankEnergieAuthError) return this.homey.__('error.login_failed');
    return `${this.homey.__('error.connection')} (${err.message})`;
  }

}

module.exports = AccountDriver;
