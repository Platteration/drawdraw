/**
 * Naming for the durable copies of imported portraits.
 *
 * The image picker hands back wildly different URI shapes — a plain file path
 * on iOS, but often a `content://` provider URI on Android with no filename in
 * it at all — so the extension has to be derived defensively rather than by
 * taking whatever follows the last dot.
 */

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'avif'];
const FALLBACK = 'jpg';

/** File extension to store an imported portrait under, always a safe value. */
export function portraitExtension(uri) {
  if (typeof uri !== 'string') return FALLBACK;
  const path = uri.split(/[?#]/)[0]; // drop any query string or fragment
  const name = path.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return FALLBACK;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : FALLBACK;
}
