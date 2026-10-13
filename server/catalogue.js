// @ts-check
// What the website sells through server/kit (sign in with Google, Stripe Checkout and its
// webhook): DrawDraw Pro, the one-time unlock src/lib/purchases.ts already lists, and nothing
// else. Its Stripe Price id is STRIPE_PRICE_PRO; a paid checkout grants the entitlement `pro`,
// which `GET api/me` then reports and the web build's useEntitlements reads (src/lib/pro.ts,
// through src/lib/useAccount.ts). Free features are not sold and never watermarked. The native
// builds sell through the store seam in src/lib/purchases.ts and never reach this file.
//
// The kit checks this at start-up and throws on a malformed one (an unknown field included),
// and server/api.test.mjs holds it to what the app's own code expects.

export default {
  app: 'drawdraw',
  name: 'DrawDraw',
  products: [
    {
      id: 'pro',
      name: 'DrawDraw Pro',
      description: 'The full construction head, proportion packs, turnaround sheets and the step-by-step lessons.',
      mode: 'payment',
      grants: 'pro',
    },
  ],
};
