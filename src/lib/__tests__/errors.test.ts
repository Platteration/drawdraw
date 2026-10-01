/**
 * The screens' alerts read two things off a caught value, the way they always
 * have: `err?.message ?? err` for the text and `err?.code` for which alert.
 * These are those reads for a value whose type is unknown, held here to what
 * the expressions they replaced gave for everything that can be thrown.
 */
import { errorCode, errorText } from '../errors';

describe('errorText', () => {
  it('is the message of anything that has one', () => {
    expect(errorText(new Error('disk full'))).toBe('disk full');
    expect(errorText(Object.assign(new Error('not configured'), { code: 'not_configured' }))).toBe('not configured');
    expect(errorText({ message: 'from a native module' })).toBe('from a native module');
    expect(errorText({ message: 7 })).toBe('7');
  });

  it('is the value itself when it has no message, or a null one', () => {
    for (const value of ['boom', 42, true, null, undefined, {}, { message: null }, { message: undefined }]) {
      expect(errorText(value)).toBe(String(value));
    }
  });
});

describe('errorCode', () => {
  it('is the code of anything that has one', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'not_configured' }))).toBe('not_configured');
    expect(errorCode({ code: 404 })).toBe(404);
  });

  it('is undefined for anything without one', () => {
    for (const value of [new Error('x'), 'not_configured', 42, null, undefined, {}]) {
      expect(errorCode(value)).toBeUndefined();
    }
  });
});
