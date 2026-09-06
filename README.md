# DrawDraw

A small iOS + Android app (built with [Expo](https://expo.dev) / React Native) for portrait
drawing practice.

Load a portrait photo and DrawDraw overlays a **3D thirds-segmentation head** — the classic
method of dividing the face into three equal segments: chin→nose, nose→eyebrows, and
eyebrows→top of the head. The guide is a rotatable Loomis-style wireframe head: the nose
line and brow line wrap around it as true 3D rings (with a center symmetry line), so the
segmentation stays proportionally accurate through the full 360° — front, ¾ view, profile,
tilted, from below, from behind. Ring portions on the far side of the head render dashed
and faded.

Controls:

- **One-finger drag** turns the head (yaw/pitch); switch to **Move** mode to reposition it.
- **Pinch** scales it, **two-finger twist** rolls it — so it can be matched to the exact
  pose of the head in the photo.
- **Front / ¾ / Profile** presets snap to standard views.
- Optional flat 2D guide lines (horizontal/vertical thirds, center line) can be toggled on
  and dragged, and the guide color is selectable so it reads well against your photo.

You can then export three things, each as a PNG at the photo's resolution, ready to layer
in whatever drawing app you prefer (Procreate, Ibis Paint, Clip Studio, Photoshop, …):

1. **Photo + guides** — the portrait with the thirds head overlay baked in, for reference.
2. **Guides only (transparent)** — just the guide on a fully transparent background,
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
src/lib/headModel.js          3D math: ellipsoid head, segment rings, rotation,
                              orthographic projection, hidden-line splitting
src/components/HeadGuide.js       SVG rendering of the 3D head (screen + export)
src/components/HeadGestureLayer.js  Rotate/move/pinch/twist gestures for the head
src/components/GuideOverlay.js    Renders the flat 2D guide lines (screen + export)
src/components/DraggableGuide.js  Drag handles for nudging each 2D guide line
```

The 3D guide has no GL/engine dependency: `src/lib/headModel.js` rotates and
orthographically projects the head analytically (the silhouette is the projected quadric of
the rotated ellipsoid) and the result is drawn with `react-native-svg`, which keeps it
crisp at export resolution and fully capturable in the transparent PNGs.

Exports are produced with `react-native-view-shot` by capturing off-screen views that
mirror the on-screen overlay exactly, scaled up to the source image's resolution (capped
at 4096px on the long edge). The transparent exports capture views with no background, so
the PNGs keep their alpha channel.
