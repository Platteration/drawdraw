/**
 * Exports in a browser.
 *
 * On iOS and Android `react-native-view-shot` rasterises an off-screen export
 * view at the export size. Its web capture is html2canvas, which is no use to
 * the website twice over: it draws the view at its size on screen and
 * stretches that to the size asked for, so a 4096-pixel export was a blurred
 * enlargement of a 361-pixel view; and it builds its copy of the page with
 * `document.write`, which the site's Trusted Types policy refuses
 * (`require-trusted-types-for 'script'`), so under the policy it exported
 * nothing at all.
 *
 * An export view holds four kinds of thing, all drawn by `renderGuides()` or
 * the turnaround sheet: the portrait (react-native-web draws an `<img>` as a
 * background behind a transparent copy of it), the flat guide lines (boxes
 * with a background colour), the head (`<svg>`) and the turnaround sheet's
 * labels (text). This paints exactly those onto a canvas of the export size,
 * in document order: the photo from its own full-resolution source, and every
 * `<svg>` re-rendered as a vector at the export size, so a browser's export is
 * as sharp as a device's. Anything else in a view would be left out, which is
 * why the e2e reads the exported pixels back rather than trusting this.
 *
 * Browser-only: nothing here runs on a device, and nothing here builds markup
 * from a string.
 */

export interface PixelSize {
  width: number;
  height: number;
}

/** The DOM element behind a react-native-web ref, or null anywhere else. */
export function domElement(node: unknown): HTMLElement | null {
  return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null;
}

/** The file name an export downloads as: fixed words, never anything from the photo. */
export function exportFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `drawdraw-${slug || 'export'}.png`;
}

/** The product of the computed opacities from `from` up to and including `root`. */
function opacityUpTo(from: Element | null, root: Element): number {
  let alpha = 1;
  for (let node = from; node; node = node.parentElement) {
    const own = Number.parseFloat(getComputedStyle(node).opacity);
    alpha *= Number.isFinite(own) ? own : 1;
    if (node === root) break;
  }
  return alpha;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A picture in the export could not be read.'));
    image.src = src;
  });
}

/** `svg` as an image at `width` x `height` pixels: a vector redrawn at that size, not a stretch. */
async function svgImage(svg: SVGSVGElement, box: DOMRect, width: number, height: number): Promise<HTMLImageElement> {
  const copy = svg.cloneNode(true);
  if (!(copy instanceof SVGSVGElement)) throw new Error('The guide could not be copied.');
  if (!copy.getAttribute('viewBox')) copy.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  // Layout classes and styles belong to the page; a standalone image has neither.
  copy.removeAttribute('class');
  copy.removeAttribute('style');
  const markup = new XMLSerializer().serializeToString(copy);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The portrait as react-native-web lays it out: `cover`, its default resize
 * mode, centred in the box. The visible copy is a CSS background; the `<img>`
 * beside it is the same picture at opacity 0, which is why its own opacity is
 * left out and its parent's (the `Image` style, the tracing fade) is not.
 */
function drawPhoto(ctx: CanvasRenderingContext2D, image: HTMLImageElement, box: DOMRect, x: number, y: number) {
  const nw = image.naturalWidth;
  const nh = image.naturalHeight;
  if (!nw || !nh || !box.width || !box.height) return;
  const scale = Math.max(box.width / nw, box.height / nh);
  const sw = box.width / scale;
  const sh = box.height / scale;
  ctx.drawImage(image, (nw - sw) / 2, (nh - sh) / 2, sw, sh, x, y, box.width, box.height);
}

function hasOwnText(element: Element): Text[] {
  const texts: Text[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child instanceof Text && child.data.trim()) texts.push(child);
  }
  return texts;
}

/** Paint `root` and everything in it onto a transparent canvas of `size` pixels, as a PNG. */
export async function renderPng(root: HTMLElement, size: PixelSize): Promise<Blob> {
  const frame = root.getBoundingClientRect();
  if (!frame.width || !frame.height) throw new Error('Nothing to export yet.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width);
  canvas.height = Math.round(size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the export.');
  const sx = canvas.width / frame.width;
  const sy = canvas.height / frame.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Everything is drawn in the view's own CSS pixels, scaled once to the export size.
  const at = (box: DOMRect) => ({ x: box.left - frame.left, y: box.top - frame.top });
  const draw = (alpha: number, paint: () => void) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.globalAlpha = alpha;
    paint();
    ctx.restore();
  };

  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (element instanceof SVGElement && !(element instanceof SVGSVGElement)) continue; // drawn with its <svg>
    if (element instanceof SVGSVGElement && element.ownerSVGElement) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const { x, y } = at(box);

    if (element instanceof HTMLImageElement) {
      const source = element.complete && element.naturalWidth ? element : await loadImage(element.currentSrc || element.src);
      draw(opacityUpTo(element.parentElement, root), () => drawPhoto(ctx, source, box, x, y));
      continue;
    }
    if (element instanceof SVGSVGElement) {
      const image = await svgImage(element, box, Math.round(box.width * sx), Math.round(box.height * sy));
      draw(opacityUpTo(element, root), () => ctx.drawImage(image, x, y, box.width, box.height));
      continue;
    }

    const background = style.backgroundColor;
    if (style.backgroundImage === 'none' && background && background !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(background)) {
      draw(opacityUpTo(element, root), () => {
        ctx.fillStyle = background;
        ctx.fillRect(x, y, box.width, box.height);
      });
    }
    for (const text of hasOwnText(element)) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = range.getBoundingClientRect();
      range.detach();
      if (!line.width) continue;
      draw(opacityUpTo(element, root), () => {
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        if ('letterSpacing' in ctx && style.letterSpacing !== 'normal') ctx.letterSpacing = style.letterSpacing;
        ctx.fillStyle = style.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(text.data, line.left - frame.left, line.top - frame.top + line.height / 2);
      });
    }
  }

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The export could not be encoded.'))), 'image/png');
    } catch {
      // A picture the browser will draw but not hand back: an SVG portrait carrying a
      // foreignObject taints the canvas, and toBlob refuses it with a SecurityError.
      reject(new Error('This picture can be shown but not exported in a browser. Choose a PNG or JPEG copy of it.'));
    }
  });
}

/** Hand `blob` to the browser as a download. */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has its own copy once it starts; a minute is ample for a slow disk.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
