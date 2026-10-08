/**
 * The browser export's pure parts. Drawing itself needs a real canvas and a
 * laid-out page, so `npm run test:e2e` exports every free layer in Chromium
 * under the site's policy and reads the pixels back.
 */
import { domElement, exportFileName } from '../webExport';

describe('the file an export downloads as', () => {
  it.each([
    ['Photo with guide', 'drawdraw-photo-with-guide.png'],
    ['Transparent guide', 'drawdraw-transparent-guide.png'],
    ['Tracing layer', 'drawdraw-tracing-layer.png'],
    ['Turnaround sheet', 'drawdraw-turnaround-sheet.png'],
  ])('%s -> %s', (name, file) => {
    expect(exportFileName(name)).toBe(file);
  });

  it('is fixed words, whatever it is handed: no path, no markup, never empty', () => {
    expect(exportFileName('../../etc/passwd')).toBe('drawdraw-etc-passwd.png');
    expect(exportFileName('<img src=x onerror=alert(1)>')).toBe('drawdraw-img-src-x-onerror-alert-1.png');
    expect(exportFileName('')).toBe('drawdraw-export.png');
    expect(exportFileName('…')).toBe('drawdraw-export.png');
  });
});

describe('the element behind a ref', () => {
  it('is null for anything that is not a DOM element: every ref on a device', () => {
    for (const node of [null, undefined, {}, 'div', { nodeType: 1, tagName: 'DIV' }]) expect(domElement(node)).toBeNull();
  });
});
