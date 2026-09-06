# DrawDraw

A small iOS + Android app (built with [Expo](https://expo.dev) / React Native) for portrait
drawing practice.

Load a portrait photo and DrawDraw automatically overlays a **thirds segmentation** — the
classic proportion grid used when drawing portraits. The guide lines are seeded at exact
thirds and can be dragged to line up with the face (hairline, brow line, base of the nose),
and you can toggle horizontal thirds, vertical thirds, and a center line, plus pick a line
color that reads well against your photo.

You can then export three things, each as a PNG at the photo's resolution, ready to layer
in whatever drawing app you prefer (Procreate, Ibis Paint, Clip Studio, Photoshop, …):

1. **Photo + guides** — the portrait with the thirds overlay baked in, for reference.
2. **Guides only (transparent)** — just the guide lines on a fully transparent background,
   to drop over your canvas as its own layer.
3. **Tracing layer (faded photo)** — the portrait at 30% opacity on a transparent
   background, to draw on top of.

Each export can be saved to the photo library or sent through the system share sheet.

## Running it

```bash
npm install
npx expo start
```

Then scan the QR code with [Expo Go](https://expo.dev/go) on an iOS or Android device
(exports and the share sheet need a real device; the guides also render on web/simulator
for quick iteration).

## Building standalone apps

The project is a standard Expo app, so store builds work with
[EAS Build](https://docs.expo.dev/build/introduction/):

```bash
npm install -g eas-cli
eas build --platform ios
eas build --platform android
```

Photo library / camera permission strings are configured in `app.json`.

## Project layout

```
App.js                        Root — switches between picker and editor
src/screens/HomeScreen.js     Pick a portrait from the library or camera
src/screens/EditorScreen.js   Overlay editor + the three PNG exports
src/components/GuideOverlay.js    Renders the guide lines (screen + export)
src/components/DraggableGuide.js  Drag handles for nudging each guide line
```

Exports are produced with `react-native-view-shot` by capturing off-screen views that
mirror the on-screen overlay exactly, scaled up to the source image's resolution (capped
at 4096px on the long edge). The transparent exports capture views with no background, so
the PNGs keep their alpha channel.
