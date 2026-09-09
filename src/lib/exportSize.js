/**
 * Turning a wanted export size in pixels into the options
 * `react-native-view-shot` actually wants.
 *
 * Its `width`/`height` options do not mean the same thing on every platform:
 *
 * - Android scales the captured bitmap to exactly `width` x `height` PIXELS
 *   (`Bitmap.createScaledBitmap(bitmap, width, height, true)` in
 *   `android/src/main/java/fr/greweb/reactnativeviewshot/ViewShot.java`).
 * - Web draws into a canvas sized `width` x `height` PIXELS
 *   (`src/RNViewShot.web.js`).
 * - iOS reads them as a `CGSize` in POINTS and opens the drawing context with
 *   `UIGraphicsBeginImageContextWithOptions(size, NO, 0)`
 *   (`ios/RNViewShot.mm:112`). A scale of 0 means "use the main screen's
 *   scale", so the image that comes back is `width * scale` by `height * scale`
 *   PIXELS.
 *
 * Handing iOS a pixel count therefore multiplies the export by the device
 * scale: a 4032 x 3024 photo on a 3x phone renders 12096 x 9072 — around 110
 * megapixels and some 440 MB of backing store before PNG encoding — which is a
 * jetsam-class allocation, and it means the export cap is not a cap at all.
 * Converting to points first is what makes the delivered file exactly the pixel
 * size that was asked for, on every platform and on every device scale.
 *
 * Pure and dependency-free on purpose: the caller passes `Platform.OS` and
 * `PixelRatio.get()` in, so the conversion can be tested without a device.
 */

/** Platforms whose capture size is a point size rather than a pixel size. */
const POINT_SIZED_PLATFORMS = ['ios'];

const isPositiveFinite = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Capture options for a wanted export of `width` x `height` PIXELS.
 *
 * @param {{width: number, height: number}} pixels wanted output size in pixels
 * @param {{platform?: string, pixelRatio?: number}} device `Platform.OS` and `PixelRatio.get()`
 * @returns {{width: number, height: number}} the `captureRef` size options
 */
export function captureSize(pixels, { platform, pixelRatio = 1 } = {}) {
  const width = pixels?.width;
  const height = pixels?.height;
  // Nonsense in, nonsense out: leave it to view-shot's own option validation
  // rather than inventing a size the caller did not ask for.
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return { width, height };

  if (!POINT_SIZED_PLATFORMS.includes(platform)) {
    // Pixels are pixels; keep them whole (a canvas dimension truncates).
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = isPositiveFinite(pixelRatio) ? pixelRatio : 1;
  // Points, so that points x screen scale lands back on the wanted pixels.
  // Fractions are fine here — the context is rasterised at the screen scale.
  return { width: width / scale, height: height / scale };
}
