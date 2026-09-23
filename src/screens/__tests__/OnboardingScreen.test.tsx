/**
 * Onboarding is the first thing an Android user sees, and Back is the first
 * thing they press. Without a subscriber it closes the app.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler, Platform, Text } from 'react-native';

import OnboardingScreen from '../OnboardingScreen';

const realOS = Platform.OS;
/** What Android hands a back handler; onboarding's reads none of it. */
const BACK_PRESS = { type: 'hardwareBackPress', timeStamp: 0 };
let backHandlers: {
  event: string;
  handler: (event: typeof BACK_PRESS) => boolean | null | undefined;
}[] = [];

/** `value`, which the test needs to be there: a missing one fails the test here, by name. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

beforeEach(() => {
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
    backHandlers.push({ event, handler });
    return { remove: () => {} };
  });
});

afterEach(() => {
  Platform.OS = realOS;
  jest.restoreAllMocks();
});

const latest = () => {
  const { handler } = found(backHandlers.at(-1), 'a back handler');
  return () => handler(BACK_PRESS);
};

async function mount({ platform = 'android' }: { platform?: typeof Platform.OS } = {}) {
  Platform.OS = platform;
  const onDone = jest.fn();
  let rendered: ReactTestRenderer | undefined;
  await act(async () => {
    rendered = renderer.create(<OnboardingScreen onDone={onDone} />, {
      createNodeMock: () => ({ scrollTo: () => {} }),
    });
  });
  const tree = found(rendered, 'the rendered onboarding');
  /** The footer's forward button, by the label it is showing. */
  const pressNext = async () => {
    const button = tree.root
      .findAll((n) => n.props && typeof n.props.onPress === 'function')
      .find((n) =>
        n
          .findAllByType(Text)
          .some((t) => t.props.children === 'Next' || t.props.children === 'Start drawing')
      );
    await act(async () => {
      found(button, 'the forward button').props.onPress();
    });
  };
  return { tree, onDone, pressNext };
}

describe('Android hardware back during onboarding', () => {
  it('steps back a page instead of closing the app', async () => {
    const { onDone, pressNext } = await mount();
    await pressNext(); // now on page 2 of 3

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = latest()();
    });
    expect(handled).toBe(true); // swallowed: the app stays open
    expect(onDone).not.toHaveBeenCalled();

    // Back on the first page again, so the next press falls through.
    await act(async () => {
      handled = latest()();
    });
    expect(handled).toBe(false);
  });

  it('lets the system handle back on the first page', async () => {
    const { onDone } = await mount();
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = latest()();
    });
    // Nothing to go back to, so the app is allowed to close.
    expect(handled).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('subscribes on Android only', async () => {
    await mount({ platform: 'ios' });
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  });
});
