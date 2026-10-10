/** Debounce edits, but let navigation and app backgrounding await the latest write. */
export function createAutosave({ initialValue, save, onError, delay = 600 }) {
  let latest = initialValue;
  let revision = 0;
  let savedRevision = 0;
  let timer = null;
  let inFlight = null;

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function flush() {
    cancelTimer();
    if (inFlight) return inFlight;
    if (savedRevision === revision) return Promise.resolve();

    inFlight = (async () => {
      try {
        // Never let an older, slower write finish after the newest edit.
        while (savedRevision !== revision) {
          const writingRevision = revision;
          const value = latest;
          await save(value);
          savedRevision = writingRevision;
        }
        cancelTimer();
        onError(null);
      } catch (error) {
        // Retain the unsaved revision so Retry saves the same work.
        onError(error);
        throw error;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function update(value) {
    if (value === latest) return;
    latest = value;
    revision += 1;
    cancelTimer();
    timer = setTimeout(() => {
      // The UI receives the failure via onError; background saves have no caller.
      flush().catch(() => {});
    }, delay);
  }

  return { update, flush };
}
