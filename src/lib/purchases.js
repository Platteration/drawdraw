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
 *
 * The contract, because getting it wrong is worth money:
 *
 * - `purchase(productId)` and `restore()` resolve with `{ pro: true }` only
 *   when the entitlement has actually been acquired and verified. Anything
 *   else — the user backing out of the payment sheet, a deferred or pending
 *   transaction awaiting parental approval, a restore that found nothing —
 *   resolves *without* `pro`, or rejects. Store SDKs commonly report a
 *   cancellation as a resolved result carrying `userCancelled`, so a provider
 *   that forwards its SDK's result unchanged will unlock Pro for free.
 * - `useEntitlements` grants on `result.pro` and nothing else, so a provider
 *   that respects this needs no changes anywhere in the app.
 *
 * Entitlements are stored locally as a plain flag with no receipt and no
 * server to check against. For a one-time cosmetic unlock with no backend
 * that is a deliberate trade: a determined user on a device they control can
 * set it, and building the infrastructure to stop them would cost more than
 * it recovers.
 */

/**
 * The store listing as the app intends it. `price` is what the store is asked
 * to charge; what the paywall *shows* is whatever the provider's product
 * says, because only a provider knows the localised price — and, until one is
 * configured, that nothing is for sale.
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

/** What the unconfigured provider says in place of a price. Not a currency amount, on purpose. */
export const NOT_CONFIGURED_PRICE = 'not available in this build';

class NotConfiguredProvider {
  get configured() {
    return false;
  }

  async getProducts() {
    // The public web build ships this provider, and a button reading "$7.99"
    // that takes no payment misrepresents what the tap does. `purchase`
    // below refuses, so the label says so rather than calling it free.
    return Object.values(PRODUCTS).map((p) => ({ ...p, price: NOT_CONFIGURED_PRICE }));
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

/** The provider a build runs with until `setPurchaseProvider` names a real one. */
export const notConfiguredProvider = new NotConfiguredProvider();

let provider = notConfiguredProvider;

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
