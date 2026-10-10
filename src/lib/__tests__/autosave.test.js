import { createAutosave } from '../autosave';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('editor autosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not rewrite a portrait just because it was opened or closed', async () => {
    const initialValue = { yaw: 0 };
    const save = jest.fn();
    const autosave = createAutosave({ initialValue, save, onError: jest.fn() });
    autosave.update(initialValue);
    await jest.runAllTimersAsync();
    await autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('debounces repeated edits and persists only the latest settings', async () => {
    const save = jest.fn().mockResolvedValue();
    const autosave = createAutosave({ initialValue: {}, save, onError: jest.fn() });
    autosave.update({ yaw: 10 });
    await jest.advanceTimersByTimeAsync(400);
    autosave.update({ yaw: 20 });
    await jest.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ yaw: 20 });
  });

  it('flushes a quick close or background transition before the debounce expires', async () => {
    const write = deferred();
    const save = jest.fn(() => write.promise);
    const autosave = createAutosave({ initialValue: {}, save, onError: jest.fn() });
    autosave.update({ yaw: 90 });
    const closed = jest.fn();
    const closing = autosave.flush().then(closed);
    expect(save).toHaveBeenCalledWith({ yaw: 90 });
    expect(closed).not.toHaveBeenCalled();
    write.resolve();
    await closing;
    expect(closed).toHaveBeenCalledTimes(1);
    await jest.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('waits for edits made during a save and never overlaps writes', async () => {
    const first = deferred();
    const second = deferred();
    const save = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const autosave = createAutosave({ initialValue: {}, save, onError: jest.fn() });
    autosave.update({ yaw: 10 });
    const saving = autosave.flush();
    autosave.update({ yaw: 20 });
    autosave.update({ yaw: 30 });
    const closed = jest.fn();
    const closing = autosave.flush().then(closed);
    expect(autosave.flush()).toBe(saving);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ yaw: 30 });
    expect(closed).not.toHaveBeenCalled();
    second.resolve();
    await closing;
    expect(closed).toHaveBeenCalledTimes(1);
    await jest.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports background save failures and retries the retained edit', async () => {
    const error = new Error('Storage full');
    const save = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce();
    const onError = jest.fn();
    const autosave = createAutosave({ initialValue: {}, save, onError });
    autosave.update({ yaw: 90 });
    await jest.advanceTimersByTimeAsync(600);
    expect(onError).toHaveBeenLastCalledWith(error);
    await autosave.flush();
    expect(save.mock.calls).toEqual([[{ yaw: 90 }], [{ yaw: 90 }]]);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('refuses to close after a failed write and can save newer work on retry', async () => {
    const error = new Error('Storage unavailable');
    const save = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce();
    const onError = jest.fn();
    const autosave = createAutosave({ initialValue: {}, save, onError });
    autosave.update({ yaw: 10 });
    const closed = jest.fn();
    await expect(autosave.flush().then(closed)).rejects.toBe(error);
    expect(closed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith(error);
    autosave.update({ yaw: 30 });
    await autosave.flush().then(closed);
    expect(save).toHaveBeenLastCalledWith({ yaw: 30 });
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
