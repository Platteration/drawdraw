/** Keep a captured file alive until the selected native operation has finished. */
export async function presentCapturedExport({ uri, present, save, share, release }) {
  let retainCapture = false;
  try {
    await new Promise((resolve, reject) => {
      let selected = false;
      const choose = (action) => {
        if (selected) return;
        selected = true;
        Promise.resolve().then(action).then(resolve, reject);
      };
      present({
        onSave: () => choose(() => save(uri)),
        onShare: () => choose(async () => {
          const result = await share(uri);
          retainCapture = result?.retainCapture === true;
        }),
        onCancel: () => choose(() => {}),
        // Android dismisses the choice dialog before an async share/save finishes.
        onDismiss: () => {
          if (!selected) choose(() => {});
        },
      });
    });
  } finally {
    if (!retainCapture) release(uri);
  }
}
