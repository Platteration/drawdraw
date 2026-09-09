/**
 * Onboarding is the first thing an Android user sees, and Back is the first
 * thing they press. Without a subscriber it closes the app.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BackHandler, Platform } from 'react-native';

import OnboardingScreen from '../OnboardingScreen';

const realOS = Platform.OS;
let backHandlers = [];

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

const latest = () => backHandlers[backHandlers.length - 1].handler;

async function mount({ platform = 'android' } = {}) {
  Platform.OS = platform;
  const onDone = jest.fn();
  let tree;
  await act(async () => {
    tree = renderer.create(<OnboardingScreen onDone={onDone} />, {
      createNodeMock: () => ({ scrollTo: () => {} }),
    });
  });
  /** The footer's forward button, by the label it is showing. */
  const pressNext = async () => {
    const button = tree.root
      .findAll((n) => n.props && typeof n.props.onPress === 'function')
      .find((n) =>
        n
          .findAllByType('Text')
          .some((t) => t.props.children === 'Next' || t.props.children === 'Start drawing')
      );
    await act(async () => {
      button.props.onPress();
    });
  };
  return { tree, onDone, pressNext };
}

describe('Android hardware back during onboarding', () => {
  it('steps back a page instead of closing the app', async () => {
    const { onDone, pressNext } = await mount();
    await pressNext(); // now on page 2 of 3

    let handled;
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
    let handled;
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
