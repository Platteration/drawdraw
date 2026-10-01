/**
 * The bundled provider cannot sell anything, and the public web build ships
 * it. Whatever it reports as a price is what the paywall's button says, so it
 * must not be a currency amount: "$7.99" on a button that takes no payment
 * misrepresents what the tap does.
 */
import { NOT_CONFIGURED_PRICE, PRODUCTS, purchases } from '../purchases';

const CURRENCY = /[$£€¥]|\d+[.,]\d\d/;

it('reports no currency amount from the unconfigured provider', async () => {
  expect(purchases.configured).toBe(false);
  const products = await purchases.getProducts();
  expect(products.map((p) => p.id)).toEqual([PRODUCTS.pro.id]);
  for (const p of products) {
    expect(p.price).toBe(NOT_CONFIGURED_PRICE);
    expect(p.price).not.toMatch(CURRENCY);
  }
  expect(NOT_CONFIGURED_PRICE).not.toMatch(/free/i); // purchase() refuses, so it is not free either
});

it('keeps the intended store price on the listing, for the provider that can charge it', () => {
  // The listing is what a real provider is configured from; it is not what
  // the paywall reads.
  expect(PRODUCTS.pro.price).toMatch(CURRENCY);
});

it('refuses to sell rather than resolving without an entitlement', async () => {
  await expect(purchases.purchase(PRODUCTS.pro.id)).rejects.toMatchObject({ code: 'not_configured' });
  await expect(purchases.restore()).rejects.toMatchObject({ code: 'not_configured' });
});
