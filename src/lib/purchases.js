/**
 * Seam for the store SDK.
 *
 * Entitlements are deliberately kept behind this interface so the app can be
 * built, run and reviewed without a billing SDK configured. Wiring a real
 * store means implementing these three calls against StoreKit / Play Billing
 * (directly, or through a service such as RevenueCat) and swapping the
 * provider below — nothing else in the app needs to change.
 *
 * The app deliberately has no ads, no consumable currency, and no
 * subscription: a single one-time unlock, plus optional content packs.
 */

export const PRODUCTS = {
  pro: {
    id: 'com.platteration.drawdraw.pro',
    title: 'DrawDraw Pro',
    blurb: 'The full construction head, proportion packs, turnaround sheets and the step-by-step lessons.',
    price: '$7.99',
    kind: 'one-time',
  },
};

class NotConfiguredProvider {
  get configured() {
    return false;
  }

  async getProducts() {
    return Object.values(PRODUCTS);
  }

  async purchase() {
    const error = new Error(
      'In-app purchases are not configured in this build. Add a store provider in src/lib/purchases.js.'
    );
    error.code = 'not_configured';
    throw error;
  }

  async restore() {
    const error = new Error(
      'In-app purchases are not configured in this build. Add a store provider in src/lib/purchases.js.'
    );
    error.code = 'not_configured';
    throw error;
  }
}

let provider = new NotConfiguredProvider();

/** Install a real store implementation at app startup. */
export function setPurchaseProvider(next) {
  provider = next;
}

export const purchases = {
  get configured() {
    return provider.configured;
  },
  getProducts: (...args) => provider.getProducts(...args),
  purchase: (...args) => provider.purchase(...args),
  restore: (...args) => provider.restore(...args),
};
