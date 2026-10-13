/**
 * The account and shop in the phone app: not configured. The website's
 * sign-in and Pro are its own (accountClient.web.ts, which Metro bundles into
 * the web build alone); the phone apps keep their no-network posture, with
 * INTERNET blocked in the shipped manifest, and sell through the store seam in
 * purchases.ts, which the App Store and Google Play require for a digital
 * unlock. So this twin answers everything with "nothing here" and opens
 * nothing: __tests__/appConfig.test.ts holds it to that, and to being the
 * module a native build resolves.
 */
import { NO_LANDING, type AccountClient } from './account';

export const accountClient: AccountClient = {
  web: false,
  config: async () => null,
  me: async () => null,
  signIn: () => {},
  signOut: async () => false,
  deleteAccount: async () => false,
  checkout: async () => 'unavailable',
  takeLanding: () => NO_LANDING,
};
