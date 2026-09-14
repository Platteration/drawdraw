# Native release validation

The browser smoke test protects the shared React/UI path, but it cannot prove native integrations. Run this checklist on at least one current iOS device and one current Android device before a release build is promoted.

## Install and launch

- Install a clean preview/release build.
- Confirm the splash screen transitions directly to onboarding on first launch with no home-screen flash.
- Complete onboarding, terminate the app, relaunch it, and confirm onboarding stays dismissed.

## Portrait import and persistence

- Pick a portrait from the photo library and confirm it renders at the correct aspect ratio and orientation.
- Take a portrait with the camera and confirm it follows the same editor path.
- Background and terminate the app, relaunch, and reopen the project. Confirm the image and guide state survive.
- Delete or move the original source photo when practical and confirm the saved project still opens from DrawDraw's durable copy.

## Fit and gestures

- Fit the guide with chin, nose-base, and brow taps. Confirm the guide lands plausibly and no tap is ignored.
- Rotate with one finger, pinch to scale, twist with two fingers to roll, and use Move mode to reposition.
- Cross a yaw snap point and confirm one haptic tick occurs rather than repeated buzzing.
- Exercise the proportion sliders and presets, including a Pro-gated preset if an entitlement is available.

## Export and sharing

- Export Photo + guide, Guide only, and Tracing layer.
- Inspect each exported image at full resolution. Confirm framing matches the editor, transparency is preserved where promised, and no draft-quality geometry appears.
- Save an export to the photo library and confirm it is readable there.
- Share an export through the system share sheet and complete a share to at least one target app.
- If Pro is enabled, export a turnaround sheet and inspect all six views.

## Permissions and failure paths

- Deny photo-library permission once and confirm the app explains the failure without crashing.
- Deny camera permission once and confirm the app remains usable with library import.
- Cancel the image picker and share sheet and confirm the editor state is unchanged.
- Exercise low-connectivity/offline launch. Core editing and existing projects should remain usable because they do not require a network service.

## Accessibility and layout

- Enable a larger system text size and confirm primary controls remain reachable.
- Enable a screen reader and confirm buttons, sliders, and adjustable controls have useful labels/actions.
- Check both portrait orientations supported by the device configuration and verify the editor does not obscure the portrait behind its panels.

Record device model, OS version, build identifier, pass/fail, and any screenshots or recordings with the release notes.
