'use strict';

const { FrankEnergieAuthError } = require('../../lib/FrankEnergieApi');
const { FrankDevice, money } = require('../../lib/FrankDevice');

/** A solar installation steered by Frank. */
class PvDevice extends FrankDevice {

  static POLL_MS = 15 * 60 * 1000;

  async poll() {
    const id = this.getData().id;
    const [summary, feedIn] = await Promise.all([
      this.api.smartPvSystemSummary(id),
      this.api.userSmartFeedIn().catch((err) => {
        if (err instanceof FrankEnergieAuthError) throw err;
        return null;
      }),
    ]);

    if (summary) {
      await this.set('frank_pv_operational_status', this.statusLabel(summary.operationalStatus));
      await this.set('frank_pv_steering_status', this.statusLabel(summary.steeringStatus));
      await this.set('frank_pv_total_result', money(summary.totalResult));
      await this.set('frank_pv_total_bonus', money(summary.totalBonus));
    }
    if (feedIn) await this.set('frank_smart_feed_in', feedIn.isActivated === true);
  }

}

module.exports = PvDevice;
