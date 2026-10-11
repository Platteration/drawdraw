# Account sign-in and Pro from the web

DrawDraw can sign in with the same Google account as Portrait Value Studio on the web. The
studio's shop sells **DrawDraw Pro** through Stripe; when the buyer signs in here with that
account, Pro unlocks on this device. Nothing else changes: the app keeps working without an
account, and without the configuration below the sign-in row is not shown at all.

The service both apps talk to lives in the `art-project` repository under `server/`. Its
own set-up is in `art-project/docs/sso-setup.md`; do that first, so there is an address to
point the app at.

## How it works

1. The paywall shows **Already have Pro on your account? Sign in with Google**.
2. `src/lib/account.js` opens the system browser (`expo-web-browser`) on
   `<service>/auth/google/start?client=app&redirect=<this app>&code_challenge=<PKCE>`.
   The service runs the Google flow; the app never sees a Google secret and needs no
   iOS or Android OAuth client of its own.
3. Google sends the browser back to the service, which redirects to the app
   (`drawdraw://auth?code=…`, or `exp://…/--/auth?code=…` in Expo Go) with a two-minute
   one-time code.
4. The app posts the code and its PKCE verifier to `/auth/exchange` and gets a bearer
   session, which it keeps in the keychain / keystore (`expo-secure-store`; local storage
   on the web test build).
5. `/me` answers with the account's entitlements. `drawdraw.pro` makes `pro` true in
   `useEntitlements()` (`src/lib/pro.js`). The last answer is cached, so Pro stays unlocked
   offline; a refused token signs the device out.

Everything the app does with the service is in `src/lib/accountApi.js` (pure, tested) and
`src/lib/account.js` (storage, browser, the `useAccount()` hook).

## Configure the app

The service address is read at **build time** from `EXPO_PUBLIC_ACCOUNT_API_BASE`. It is
the site's origin plus `/api`.

For local development, create `.env.local` in the repository root (ignored by git):

```sh
EXPO_PUBLIC_ACCOUNT_API_BASE=https://studio.example.com/api
```

While the service itself runs on your computer (`node server/dev.mjs` in art-project), a
phone on the same Wi-Fi reaches it at your computer's LAN address, e.g.
`http://192.168.1.20:8000/api`. Google only accepts `http://localhost` redirect URIs, not LAN
addresses, so for sign-in from a phone test against the deployed service, or run the
Expo web build on the same computer.

For EAS builds, set the variable in EAS (Project → Environment variables, or
`eas env:create`) or in `eas.json`:

```json
{
  "build": {
    "production": {
      "env": { "EXPO_PUBLIC_ACCOUNT_API_BASE": "https://studio.example.com/api" }
    }
  }
}
```

`app.json` now carries `"scheme": "drawdraw"`, which registers `drawdraw://` links on the
device. Expo Go ignores it and uses its own `exp://` scheme; a development build or a
release build needs to be made again after this change (`eas build`, or `npx expo prebuild`).

## Configure the service for the app

In `art-project/wrangler.jsonc`, `APP_REDIRECT_SCHEMES` lists where the service may send
the browser after sign-in. Production should list the app's scheme only:

```jsonc
"APP_REDIRECT_SCHEMES": "drawdraw"
```

For development with Expo Go add `exp`, and for the web build `http`
(`server/.dev.vars.example` does both). Never ship `http` in production: the PKCE check
still makes a captured code useless, but there is no reason to send anyone anywhere but
the app.

## Try it

1. `npx expo start`, open the app in Expo Go, open the paywall (**Unlock Pro** on the home
   screen) and tap **Sign in with Google**. The browser opens on Google's account chooser;
   pick an account; the browser closes and the row reads **Signed in as …**.
2. In the studio on the web, sign in with the same Google account and buy **DrawDraw Pro**
   in the shop (Stripe's test card `4242 4242 4242 4242` while in test mode).
3. Back in the app, tap **Restore purchase**. The paywall closes and the Pro features are
   on. If the webhook has not landed yet, wait a few seconds and tap again.
4. Kill the app, turn on airplane mode, open it: Pro is still on, from the cached
   entitlements. **Sign out** on the paywall removes the token, the cache and the
   account's Pro from this device.

## Store policy

- **Apple, guideline 3.1.3(b) (multiplatform services):** an app may unlock content bought
  on its web site only if the same thing is also sold as an in-app purchase. So Pro must
  also be purchasable in-app through StoreKit before release; that is the
  `src/lib/purchases.js` seam, still to be wired (directly or through RevenueCat). The app
  must not point people to the web shop: no link, no "cheaper on our site". The paywall
  copy here only offers sign-in for an existing purchase.
- **Apple, guideline 4.8 (login services):** an app that offers a third-party sign-in such
  as Google must also offer one that limits data collection, which in practice means
  adding **Sign in with Apple** before App Store submission. The service's provider layer
  (`art-project/server/google.js`) is where an Apple provider goes; the app side only needs
  a second button.
- **Google Play** has no equivalent login rule; its billing policy likewise requires
  in-app digital goods to be sold through Play Billing, with the same multiplatform
  allowance.

## What is stored on the device

| Key | Where | What |
| --- | --- | --- |
| `drawdraw.account.token.v1` | SecureStore (keychain / keystore); local storage on web | the bearer session |
| `drawdraw.account.profile.v1` | AsyncStorage | last known user (id, email, name, picture) and entitlements |
| `drawdraw.entitlements.v1` | AsyncStorage | the device-local unlock written by a store purchase (unchanged) |

## Troubleshooting

- **No sign-in row on the paywall.** `EXPO_PUBLIC_ACCOUNT_API_BASE` was not set when the
  bundle was built. Expo inlines `EXPO_PUBLIC_*` at bundle time; restart `expo start` after
  editing `.env.local`, and check EAS environment variables for store builds.
- **The service answers "redirect must use one of these schemes".** Add the scheme to
  `APP_REDIRECT_SCHEMES` on the service (`exp` for Expo Go).
- **The browser opens but never comes back.** On Android, `drawdraw://` only resolves in a
  build that includes the scheme (not Expo Go); on the web build, the popup must be
  allowed. Check the service's `/api/health` answers from the phone's network.
- **"The code does not belong to this app session".** The browser session was started by
  an older app process; tap sign-in again.
- **Signed in, but no Pro.** The purchase is on a different Google account, or the Stripe
  webhook has not reached the service yet (Stripe dashboard → Developers → Webhooks shows
  deliveries and lets you resend).
