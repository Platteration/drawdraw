/**
 * A synthetic portrait laid out on exact thirds, so the fit solver has a known
 * right answer to be measured against end to end.
 */
import { writeFileSync } from 'node:fs';

import { encodePng } from '../tools/png.mjs';

export const PORTRAIT = {
  width: 700,
  height: 900,
  centerX: 350,
  crown: 230,
  chin: 630,
  get brow() {
    return this.crown + (this.chin - this.crown) / 3;
  },
  get nose() {
    return this.crown + (2 * (this.chin - this.crown)) / 3;
  },
};

export function writePortrait(path) {
  const { width: W, height: H, centerX, crown, chin, brow, nose } = PORTRAIT;
  const pixels = Buffer.alloc(W * H * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 208 - y * 0.04, 210, 214);

  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, ...color);
      }
    }
  };

  ellipse(centerX, (crown + chin) / 2, 150, (chin - crown) / 2, [226, 197, 176]); // face
  ellipse(centerX, chin + 150, 190, 170, [120, 130, 150]); // shoulders
  ellipse(centerX - 62, brow + 34, 26, 13, [70, 60, 55]); // eyes
  ellipse(centerX + 62, brow + 34, 26, 13, [70, 60, 55]);
  ellipse(centerX - 62, brow, 34, 6, [90, 70, 58]); // brows
  ellipse(centerX + 62, brow, 34, 6, [90, 70, 58]);
  ellipse(centerX, nose, 22, 8, [196, 165, 146]); // base of nose
  ellipse(centerX, nose + (chin - nose) * 0.42, 40, 9, [176, 118, 108]); // mouth

  writeFileSync(path, encodePng(W, H, pixels));
  return path;
}
