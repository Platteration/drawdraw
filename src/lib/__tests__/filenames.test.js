import { portraitExtension } from '../filenames';

describe('portraitExtension', () => {
  it('reads the extension from ordinary file URIs', () => {
    expect(portraitExtension('file:///data/user/0/cache/IMG_1234.jpg')).toBe('jpg');
    expect(portraitExtension('file:///var/mobile/A1B2/IMG_0001.HEIC')).toBe('heic');
    expect(portraitExtension('/tmp/photo.PNG')).toBe('png');
  });

  it('falls back for content URIs, which carry no filename at all', () => {
    // These are what Android's picker commonly returns; taking whatever follows
    // the last dot would have stored them as ".cont" or ".docu".
    expect(portraitExtension('content://media/external/images/media/38291')).toBe('jpg');
    expect(
      portraitExtension('content://com.android.providers.media.documents/document/image%3A1000')
    ).toBe('jpg');
  });

  it('is not fooled by dots outside the filename', () => {
    expect(portraitExtension('file:///Users/a.b.c/photos/portrait')).toBe('jpg');
    expect(portraitExtension('file:///v1.2/dir/shot.webp')).toBe('webp');
  });

  it('ignores query strings and unknown or empty extensions', () => {
    expect(portraitExtension('file:///cache/pic.png?width=100')).toBe('png');
    expect(portraitExtension('file:///cache/archive.zip')).toBe('jpg');
    expect(portraitExtension('file:///cache/trailing.')).toBe('jpg');
    expect(portraitExtension('file:///cache/.hidden')).toBe('jpg');
  });

  it('never throws on junk input', () => {
    expect(portraitExtension('')).toBe('jpg');
    expect(portraitExtension(null)).toBe('jpg');
    expect(portraitExtension(undefined)).toBe('jpg');
  });
});
