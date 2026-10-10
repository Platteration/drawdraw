# Native release validation

The browser smoke test protects the shared React/UI path, but it cannot prove native integrations. Run this checklist on at least one current iOS device and one current Android device before a release build is promoted.

## Install and launch

- Install a clean preview/release build.
- Confirm the sketchbook background and light controls stay readable with the device set to both light and dark appearance.
- Confirm the splash screen transitions directly to onboarding on first launch with no home-screen flash.
- Complete onboarding, terminate the app, relaunch it, and confirm onboarding stays dismissed.

## Portrait import and persistence

- Pick a portrait from the photo library and confirm it renders at the correct aspect ratio and orientation.
- Take a portrait with the camera and confirm it follows the same editor path.
- Background and terminate the app, relaunch, and reopen the project. Confirm the image and guide state survive.
- Delete or move the original source photo when practical and confirm the saved project still opens from DrawDraw's durable copy.
- In a test build with a partly damaged project index, confirm readable drawings remain available for export. Recover them, verify the original index is retained, and confirm pending edits save. Remove recovery copies separately and verify current drawings remain intact.
- Recover legacy drawings with colliding identifiers or a shared portrait file. Edit/remove one and confirm the other keeps its own settings and can still open its portrait.
- In a test build, remove a damaged record whose portrait URI names the portraits directory or a nested path. Confirm no folder or unrelated file is deleted. If a valid portrait filename actually names a directory, confirm removal reports the problem and preserves the index. Import with an occupied destination filename and confirm the existing portrait remains unchanged.
- Simulate a failed save or recovery write. Confirm the editor keeps the latest work open, shows the error, and permits export and retry.

## Fit and gestures

- Fit the guide with chin, nose-base, and brow taps. Confirm the guide lands plausibly and no tap is ignored.
- Rotate with one finger, pinch to scale, twist with two fingers to roll, and use Move mode to reposition.
- Cross a yaw snap point and confirm one haptic tick occurs rather than repeated buzzing.
- Exercise the proportion sliders and presets, including a Pro-gated preset if an entitlement is available.
- Toggle horizontal/vertical/center guides and drag both horizontal and vertical lines. Reopen the drawing and confirm their positions survive.
- Toggle construction lines, change guide color/weight and tracing opacity, and verify saved settings after reopening.
- Enter Practice with each guide color, including Chalk. Confirm the hidden photo leaves a visible guide, and holding/releasing Peek reveals/hides the portrait.
- If Pro is available, run every step manually and with Play/Pause, verify bounds at the first/last step, and use Exit and Reset.

## Export and sharing

- Export Photo + guide, Guide only, and Tracing layer.
- Inspect each exported image at full resolution. Confirm framing matches the editor, transparency is preserved where promised, and no draft-quality geometry appears.
- Save an export to the photo library and confirm it is readable there.
- Share an export through the system share sheet and complete a share to at least one target app.
- Cancel the export choice dialog and the share sheet. Confirm choice cancellation, completed photo saves and returned iOS sharing activities release their captures, while an in-progress operation can still read its capture. Android's chooser result does not confirm recipient completion: shared captures remain in cache for library/OS cleanup. Verify the receiving app can finish reading after the chooser returns.
- If Pro is enabled, export a turnaround sheet and inspect all six views.

## Permissions and failure paths

- Deny photo-library add/write permission once and confirm saving explains the failure without crashing.
- With photo-library read permission denied, confirm the system picker can still import a selected portrait and saving an export requests only add/write access where the OS requires it.
- Inspect the signed Android manifest for absence of draw-over-other-apps, microphone, and media read permissions. Confirm the app never asks to access audio or videos, and the iOS build has no microphone usage description.
- Deny camera permission once and confirm the app remains usable with library import.
- Cancel the image picker and share sheet and confirm the editor state is unchanged.
- Exercise low-connectivity/offline launch. Core editing and existing projects should remain usable because they do not require a network service.

## Billing (required before a paid launch)

The repository ships without a billing provider. This remains a paid-release blocker; a passing browser suite does not validate StoreKit or Play Billing.

- In the current build, open Pro and confirm it clearly says purchases are unavailable, shows no price, and offers no purchase or restore action.
- Before enabling purchases, configure the non-consumable product in both stores, connect a provider that validates transactions, and display each store's localized price.
- Test a completed purchase, cancellation, pending payment, failed payment, restore on reinstall, and an account with no purchase. Only a confirmed active Pro entitlement may unlock the paid tools.
- Implement and test entitlement refresh for refunds and revocations, including relaunch and return from the background. The local entitlement cache alone is not store verification.
- Test offline access after a confirmed purchase and verify the expected behavior after store validation reports that Pro is no longer active.
- Delay the initial cache read and entitlement writes while restoring a revoked purchase. Confirm the old cache cannot reactivate Pro, writes remain ordered, and a failed cache replacement falls back to removing the stale grant. If replacement and removal both fail, live access stays revoked and the error is visible; a future launch still requires store refresh because that cache could not be cleared.

## Store and privacy review

- Prepare the public privacy policy and support URLs and the App Store privacy / Play Data safety declarations from the final signed build and integrated SDKs. The current app edits portraits locally; recheck this when adding billing or any network SDK.
- Confirm the Expo/EAS project, signing credentials, store application records, identifiers, version/build numbers, screenshots, and review instructions are configured for the intended accounts.
- Review the final iOS privacy manifest aggregation and Android merged manifest. JavaScript exports and Expo configuration introspection do not substitute for signed native builds.

## Accessibility and layout

- Enable a larger system text size and confirm primary controls remain reachable.
- Enable a screen reader and confirm buttons, sliders, and adjustable controls have useful labels/actions.
- Open and remove a recent drawing using its named controls; cancel once before confirming removal. Long-press removal should use the same confirmation. Recovery portraits must remain openable while individual removal is disabled until recovery.
- On a small phone, scroll Home to reach saved drawings, removal actions, recovery controls, and How it works. Replay all three introduction pages and return to saved drawings.
- Check both portrait orientations supported by the device configuration and verify the editor does not obscure the portrait behind its panels.

Record device model, OS version, build identifier, pass/fail, and any screenshots or recordings with the release notes.
