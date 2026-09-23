/**
 * What a caught value says about itself. Anything can be thrown or rejected
 * with, and the screens read two things off it the same way whatever it was:
 * `err?.message` for the alert's text, `err?.code` for which alert. These are
 * those two reads, for a value whose type is unknown.
 */

/** Its `message`, when it is an object that has one (an `Error` does). */
function messageOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'message' in err ? err.message : undefined;
}

/** The text an alert shows for a caught value: its message, else the value itself. */
export function errorText(err: unknown): string {
  return String(messageOf(err) ?? err);
}

/** Its `code`, when it is an object that has one (the purchase provider sets one). */
export function errorCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
}
