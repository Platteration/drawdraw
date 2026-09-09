import { captureSize } from '../exportSize';

const MAX_EXPORT_DIMENSION = 4096; // the cap EditorScreen clamps exports to

/**
 * What react-native-view-shot does with the size it is handed, stated here
 * from its native code rather than from the module under test — otherwise a
 * broken conversion would be measured against itself and excuse itself.
 * iOS rasterises a point size at the screen scale
 * (UIGraphicsBeginImageContextWithOptions(size, NO, 0), RNViewShot.mm:112);
 * Android and web treat it as pixels.
 */
const delivered = (pixels, { platform, pixelRatio }) => {
  const size = captureSize(pixels, { platform, pixelRatio });
  const scale = platform === 'ios' ? pixelRatio : 1;
  return { width: size.width * scale, height: size.height * scale };
};

describe('captureSize', () => {
  it('hands iOS points, not pixels, so the screen scale cannot multiply the export', () => {
    // react-native-view-shot opens the drawing context with
    // UIGraphicsBeginImageContextWithOptions(size, NO, 0): scale 0 means the
    // main screen's, so a pixel count passed straight through comes back
    // multiplied by it.
    const photo = { width: 4032, height: 3024 };
    expect(captureSize(photo, { platform: 'ios', pixelRatio: 3 })).toEqual({
      width: 1344,
      height: 1008,
    });
    expect(captureSize(photo, { platform: 'ios', pixelRatio: 2 })).toEqual({
      width: 2016,
      height: 1512,
    });
    expect(captureSize(photo, { platform: 'ios', pixelRatio: 1 })).toEqual(photo);
  });

  it('asks Android and web for the pixel size directly', () => {
    // Android scales the bitmap to exactly width x height pixels; the web
    // shim sizes a canvas the same way. Neither is affected by screen scale.
    for (const platform of ['android', 'web']) {
      for (const pixelRatio of [1, 2, 3, 3.5]) {
        expect(captureSize({ width: 4032, height: 3024 }, { platform, pixelRatio })).toEqual({
          width: 4032,
          height: 3024,
        });
      }
    }
  });

  it('delivers the pixels that were asked for on every platform and device scale', () => {
    // The bound comes from the request, not from the conversion: whatever
    // width goes in is the width that comes out.
    for (const platform of ['ios', 'android', 'web']) {
      for (const pixelRatio of [1, 2, 3, 3.5]) {
        for (const wanted of [
          { width: 4032, height: 3024 },
          { width: 4096, height: 2731 },
          { width: 1179, height: 2556 },
          { width: 2160, height: 1680 },
        ]) {
          const out = delivered(wanted, { platform, pixelRatio });
          expect(out.width).toBeCloseTo(wanted.width, 6);
          expect(out.height).toBeCloseTo(wanted.height, 6);
        }
      }
    }
  });

  it('keeps a capped export inside the cap on a retina phone', () => {
    // The regression this exists for: a 12MP photo on a 3x device used to be
    // rendered at 12096 x 9072 — about 110 megapixels, roughly 440 MB of
    // backing store — and MAX_EXPORT_DIMENSION stopped being a cap.
    const source = { width: 4032, height: 3024 };
    const scale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(source.width, source.height));
    const wanted = {
      width: Math.round(source.width * scale),
      height: Math.round(source.height * scale),
    };
    for (const pixelRatio of [1, 2, 3]) {
      const out = delivered(wanted, { platform: 'ios', pixelRatio });
      expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_EXPORT_DIMENSION);
      expect((out.width * out.height) / 1e6).toBeLessThan(13); // megapixels
    }
  });

  it('gives the turnaround sheet the same pixel size on every device', () => {
    const sheet = { width: 2160, height: 1680 }; // SHEET_SIZE x TURNAROUND_SCALE
    const sizes = [1, 2, 3].map((pixelRatio) =>
      delivered(sheet, { platform: 'ios', pixelRatio })
    );
    for (const size of sizes) expect(size).toEqual(sheet);
  });

  it('treats a missing or nonsense device scale as 1', () => {
    const photo = { width: 1000, height: 800 };
    for (const pixelRatio of [undefined, 0, -2, NaN, Infinity, '3']) {
      expect(captureSize(photo, { platform: 'ios', pixelRatio })).toEqual(photo);
    }
    expect(captureSize(photo, {})).toEqual(photo);
    expect(captureSize(photo)).toEqual(photo);
  });

  it('rounds pixel platforms to whole pixels', () => {
    // A canvas dimension truncates, and a bitmap cannot be 3.5 pixels wide.
    expect(captureSize({ width: 1000.4, height: 800.6 }, { platform: 'android' })).toEqual({
      width: 1000,
      height: 801,
    });
  });

  it('passes a size it cannot use through untouched', () => {
    // view-shot validates its own options; inventing a size here would
    // silently export something nobody asked for.
    for (const bad of [{ width: 0, height: 100 }, { width: -5, height: 5 }, {}]) {
      expect(captureSize(bad, { platform: 'ios', pixelRatio: 3 })).toEqual({
        width: bad.width,
        height: bad.height,
      });
    }
    expect(captureSize(undefined, { platform: 'ios', pixelRatio: 3 })).toEqual({
      width: undefined,
      height: undefined,
    });
  });
});
