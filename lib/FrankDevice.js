'use strict';

const Homey = require('homey');
const { FrankEnergieAuthError } = require('./FrankEnergieApi');

/**
 * Base device for Frank account features that are polled (battery, EV, PV).
 * Subclasses implement poll() and set static POLL_MS.
 */
class FrankDevice extends Homey.Device {

  static POLL_MS = 15 * 60 * 1000;

  async onInit() {
    this.api = this.homey.app.api;
    this.authFailed = false;
    await syncCapabilities(this, this.excludedCapabilities());
    await this.onFrankInit();
    await this.update();
    this.pollTimer = this.homey.setInterval(() => this.update(), this.constructor.POLL_MS);
  }

  async onFrankInit() {}

  /** Manifest capabilities this particular device should not have. */
  excludedCapabilities() {
    return [];
  }

  async onUninit() {
    if (this.pollTimer) this.homey.clearInterval(this.pollTimer);
  }

  async onDeleted() {
    await this.onUninit();
  }

  /** Poll once; never throws. */
  async update() {
    if (this.authFailed) return;
    try {
      await this.poll();
      await this.setAvailable().catch(() => {});
    } catch (err) {
      await this.handleError(err);
    }
  }

  async handleError(err) {
    if (err instanceof FrankEnergieAuthError) {
      this.authFailed = true;
      await this.setUnavailable(this.homey.__('error.reauth')).catch(() => {});
    } else if (err.code === 'not-found' || err.code === 'not-enabled') {
      await this.setUnavailable(this.homey.__('error.not_found')).catch(() => {});
    } else {
      // network hiccup or API error: keep the last values
      this.error('Update failed:', err.message);
    }
  }

  /** Called by the app after a new login (pairing or repair). */
  async onReauthenticated() {
    this.authFailed = false;
    await this.setAvailable().catch(() => {});
    await this.update();
  }

  /** Set a capability if the device has it; errors are logged, not thrown. */
  async set(cap, value) {
    if (!this.hasCapability(cap)) return;
    await this.setCapabilityValue(cap, value === undefined ? null : value)
      .catch((e) => this.error(cap, e.message));
  }

  /** Human label for an API status value (falls back to the raw value). */
  statusLabel(value) {
    if (value === null || value === undefined || value === '') return null;
    const key = String(value).toLowerCase();
    const label = this.homey.__(`status.${key}`);
    return label && label !== `status.${key}` ? label : String(value);
  }

}

/**
 * Bring a device's capabilities in line with its driver manifest, so devices
 * paired with an older version get capabilities added in an update.
 */
async function syncCapabilities(device, exclude = []) {
  const wanted = ((device.driver && device.driver.manifest && device.driver.manifest.capabilities) || [])
    .filter((c) => !exclude.includes(c));
  for (const cap of wanted) {
    if (!device.hasCapability(cap)) await device.addCapability(cap).catch((e) => device.error(cap, e.message));
  }
  for (const cap of exclude) {
    if (device.hasCapability(cap)) await device.removeCapability(cap).catch((e) => device.error(cap, e.message));
  }
}

/** Round to 2 decimals, null for anything that is not a finite number. */
function money(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Finite number or null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  FrankDevice, syncCapabilities, money, num,
};
