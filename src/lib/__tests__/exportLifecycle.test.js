import { presentCapturedExport } from '../exportLifecycle';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(overrides = {}) {
  let choices;
  const options = {
    uri: 'file:///cache/export.png',
    present: (callbacks) => { choices = callbacks; },
    save: jest.fn().mockResolvedValue(),
    share: jest.fn().mockResolvedValue(),
    release: jest.fn(),
    ...overrides,
  };
  const completed = presentCapturedExport(options);
  return { options, choices, completed };
}

it.each(['Save', 'Share'])('retains the file until %s finishes, including dialog dismissal', async (action) => {
  const operation = deferred();
  const { options, choices, completed } = setup({ [action.toLowerCase()]: jest.fn(() => operation.promise) });
  expect(options.release).not.toHaveBeenCalled();
  choices[`on${action}`]();
  choices.onDismiss();
  choices.onCancel();
  await Promise.resolve();
  expect(options[action.toLowerCase()]).toHaveBeenCalledWith(options.uri);
  expect(options.release).not.toHaveBeenCalled();
  operation.resolve();
  await completed;
  expect(options.release).toHaveBeenCalledTimes(1);
  expect(options.release).toHaveBeenCalledWith(options.uri);
});

it.each(['onCancel', 'onDismiss'])('cleans a canceled export through %s without saving or sharing', async (action) => {
  const { options, choices, completed } = setup();
  choices[action]();
  choices.onCancel();
  choices.onDismiss();
  await completed;
  expect(options.save).not.toHaveBeenCalled();
  expect(options.share).not.toHaveBeenCalled();
  expect(options.release).toHaveBeenCalledTimes(1);
});

it('handles repeated taps as one selected operation', async () => {
  const { options, choices, completed } = setup();
  choices.onShare();
  choices.onShare();
  choices.onSave();
  await completed;
  expect(options.share).toHaveBeenCalledTimes(1);
  expect(options.save).not.toHaveBeenCalled();
  expect(options.release).toHaveBeenCalledTimes(1);
});

it.each(['Save', 'Share'])('cleans after a failed %s and reports the original failure', async (action) => {
  const failure = new Error('Native operation failed');
  const { options, choices, completed } = setup({ [action.toLowerCase()]: jest.fn().mockRejectedValue(failure) });
  choices[`on${action}`]();
  await expect(completed).rejects.toBe(failure);
  expect(options.release).toHaveBeenCalledTimes(1);
});

it('cleans after a denied permission leaves the export unsaved', async () => {
  const { options, choices, completed } = setup({ save: jest.fn().mockResolvedValue(false) });
  choices.onSave();
  await completed;
  expect(options.release).toHaveBeenCalledTimes(1);
});

it('cleans if showing the choices fails', async () => {
  const failure = new Error('Dialog unavailable');
  const release = jest.fn();
  await expect(presentCapturedExport({ uri: 'file:///cache/export.png', release, present: () => { throw failure; } })).rejects.toBe(failure);
  expect(release).toHaveBeenCalledTimes(1);
});

it('keeps a shared capture when the platform cannot confirm the recipient finished reading', async () => {
  const operation = deferred();
  const { options, choices, completed } = setup({ share: jest.fn(() => operation.promise) });
  choices.onShare();
  choices.onDismiss();
  await Promise.resolve();
  expect(options.release).not.toHaveBeenCalled();
  operation.resolve({ retainCapture: true });
  await completed;
  expect(options.release).not.toHaveBeenCalled();
});

it.each([false, 'true', undefined])('requires an explicit retention result, received %p', async (retainCapture) => {
  const { options, choices, completed } = setup({ share: jest.fn().mockResolvedValue({ retainCapture }) });
  choices.onShare();
  await completed;
  expect(options.release).toHaveBeenCalledTimes(1);
});
