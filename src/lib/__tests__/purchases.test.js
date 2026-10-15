import { PRODUCTS, purchases, setPurchaseProvider } from '../purchases';

const productId = PRODUCTS.pro.id;

function store(overrides = {}) {
  const provider = {
    configured: true,
    getProducts: jest.fn(async () => [{ id: productId, price: '€8.99' }]),
    purchase: jest.fn(async () => ({ pro: true })),
    restore: jest.fn(async () => ({ pro: true })),
    ...overrides,
  };
  setPurchaseProvider(provider);
  return provider;
}

afterEach(() => setPurchaseProvider(null));

describe('purchase provider boundary', () => {
  it('does not advertise a price or accept purchases without a store', async () => {
    expect(purchases.configured).toBe(false);
    expect(PRODUCTS.pro.price).toBeUndefined();
    await expect(purchases.getProducts()).resolves.toEqual([]);
    await expect(purchases.purchase(productId)).rejects.toMatchObject({ code: 'not_configured' });
    await expect(purchases.restore()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('rejects an unknown product before sending a store transaction', async () => {
    const provider = store();
    await expect(purchases.purchase('another-product')).rejects.toMatchObject({ code: 'unknown_product' });
    expect(provider.purchase).not.toHaveBeenCalled();
  });

  it.each([undefined, null, {}, { pro: false }, { pro: 'true' }, { status: 'pending' }])(
    'does not treat an unconfirmed store result %p as a paid unlock', async (result) => {
      store({ purchase: async () => result });
      await expect(purchases.purchase(productId)).rejects.toMatchObject({ code: 'purchase_not_completed' });
    }
  );

  it('accepts explicit store entitlement confirmation', async () => {
    store();
    await expect(purchases.purchase(productId)).resolves.toEqual({ pro: true });
  });

  it('preserves cancellation and store errors', async () => {
    const error = Object.assign(new Error('Canceled'), { code: 'canceled' });
    store({ purchase: async () => { throw error; } });
    await expect(purchases.purchase(productId)).rejects.toBe(error);
  });

  it('returns only known products with a store-provided localized price', async () => {
    store({ getProducts: async () => [
      null, { id: productId }, { id: 'another-product', price: '$1.00' },
      { id: productId, price: '€8.99' },
    ] });
    await expect(purchases.getProducts()).resolves.toEqual([{ id: productId, price: '€8.99' }]);
  });

  it('requires an explicit restore result, including confirmed absence', async () => {
    store({ restore: async () => ({ pro: false }) });
    await expect(purchases.restore()).resolves.toEqual({ pro: false });
    store({ restore: async () => ({ pro: 'true' }) });
    await expect(purchases.restore()).rejects.toMatchObject({ code: 'invalid_entitlements' });
  });
});
