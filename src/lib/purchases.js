/**
 * Seam for the store SDK.
 *
 * Entitlements are deliberately kept behind this interface so the app can be
 * built, run and reviewed without a billing SDK configured. Wiring a real
 * store means implementing these three calls against StoreKit / Play Billing
 * (directly, or through a service such as RevenueCat) and swapping the
 * provider below. The provider must validate transactions with the store and
 * return { pro: true } only for an active, completed Pro entitlement. Pending
 * payments and cancellations must never be reported as active entitlements.
 * getProducts supplies the store's localized price; restore returns { pro: false }
 * when the store confirms that there is no active purchase. A production store
 * integration must also refresh entitlements for refunds and revocations.
 *
 * The app deliberately has no ads, no consumable currency, and no
 * subscription: a single one-time unlock, plus optional content packs.
 */

export const PRODUCTS = {
  pro: {
    id: 'com.platteration.drawdraw.pro',
    title: 'DrawDraw Pro',
    blurb: 'The full construction head, proportion packs, turnaround sheets and the step-by-step lessons.',
    kind: 'one-time',
  },
};

class NotConfiguredProvider {
  get configured() {
    return false;
  }

  async getProducts() {
    return [];
  }

  async purchase() {
    throw storeError('not_configured', 'Pro purchases are not available in this build.');
  }

  async restore() {
    throw storeError('not_configured', 'Purchase restoration is not available in this build.');
  }
}

let provider = new NotConfiguredProvider();

function storeError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Install a real store implementation at app startup; null resets the stub. */
export function setPurchaseProvider(next) {
  provider = next ?? new NotConfiguredProvider();
}

export const purchases = {
  get configured() {
    return provider.configured === true;
  },
  async getProducts() {
    if (!purchases.configured) return [];
    const products = await provider.getProducts();
    return Array.isArray(products) ? products.filter((product) =>
      product?.id === PRODUCTS.pro.id && typeof product.price === 'string' && product.price.trim()
    ) : [];
  },
  async purchase(productId) {
    if (productId !== PRODUCTS.pro.id) {
      throw storeError('unknown_product', 'This product is not available.');
    }
    if (!purchases.configured) {
      throw storeError('not_configured', 'Pro purchases are not available in this build.');
    }
    const result = await provider.purchase(productId);
    if (result?.pro !== true) {
      throw storeError('purchase_not_completed', 'The store has not confirmed a completed Pro purchase.');
    }
    return result;
  },
  async restore() {
    if (!purchases.configured) {
      throw storeError('not_configured', 'Purchase restoration is not available in this build.');
    }
    const result = await provider.restore();
    if (typeof result?.pro !== 'boolean') {
      throw storeError('invalid_entitlements', 'The store could not confirm your purchases. Please try again.');
    }
    return result;
  },
};
