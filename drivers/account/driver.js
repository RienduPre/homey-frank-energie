'use strict';

const FrankDriver = require('../../lib/FrankDriver');

/** One device per Frank Energie delivery address. */
class AccountDriver extends FrankDriver {

  get noItemsMessage() {
    return 'error.no_sites';
  }

  async listFrankDevices(api) {
    const sites = await api.userSites();
    return sites.map((site) => ({
      name: this.siteName(site),
      data: { id: site.reference },
      settings: {
        site_reference: site.reference,
        address: (site.address && site.address.addressFormatted) || '',
      },
    }));
  }

  async validateRepair(api, device) {
    const sites = await api.userSites();
    const ref = device.getData().id;
    if (!sites.some((s) => s.reference === ref)) {
      throw new Error(this.homey.__('error.site_not_in_account'));
    }
  }

  siteName(site) {
    const addr = site.address && site.address.addressFormatted;
    return addr ? `Frank ${addr}` : `Frank ${site.reference}`;
  }

}

module.exports = AccountDriver;
