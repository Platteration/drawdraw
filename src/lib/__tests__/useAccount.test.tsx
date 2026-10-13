/**
 * The website's account, as App.tsx sees it. In the phone app it is off from
 * the first frame and asks nothing. On the web it asks the site's api/config
 * once; anything but a sign-in that is on leaves it off for good, and an API
 * that does not answer cannot hold the first frame for longer than its limit.
 */
import React, { useEffect } from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { ACCOUNT_OFF, NO_LANDING, SIGNED_OUT, type AccountClient, type AccountState, type ApiConfig, type Landing, type Me } from '../account';
import { useAccount, type UseAccountOptions } from '../useAccount';

const PRO = { id: 'pro', name: 'DrawDraw Pro', description: 'Everything.', price: { unitAmount: 799, currency: 'usd' } };
const SHOP: ApiConfig = { signIn: true, pro: PRO };
const ADA: Me = { user: { email: 'ada@example.com' }, entitlements: [] };

/** A client whose answers the test sets, and which records what it was asked. */
function fakeClient(over: Partial<AccountClient> = {}): AccountClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    web: true,
    config: jest.fn(async () => {
      calls.push('config');
      return SHOP as ApiConfig | null;
    }),
    me: jest.fn(async () => {
      calls.push('me');
      return ADA as Me | null;
    }),
    signIn: jest.fn(() => void calls.push('signIn')),
    signOut: jest.fn(async () => {
      calls.push('signOut');
      return true;
    }),
    deleteAccount: jest.fn(async () => {
      calls.push('deleteAccount');
      return true;
    }),
    checkout: jest.fn(async () => {
      calls.push('checkout');
      return 'redirecting' as const;
    }),
    takeLanding: jest.fn((): Landing => {
      calls.push('takeLanding');
      return NO_LANDING;
    }),
    ...over,
  };
  return Object.assign(client, { calls });
}

let state: AccountState | undefined;
let tree: ReactTestRenderer | undefined;
const current = () => {
  if (!state) throw new Error('the hook has not rendered');
  return state;
};

function Probe({ options }: { options: UseAccountOptions }) {
  const value = useAccount(options);
  useEffect(() => {
    state = value;
  }, [value]);
  return null;
}

async function mount(options: UseAccountOptions) {
  await act(async () => {
    tree = renderer.create(<Probe options={options} />);
  });
}

/** A clock the test moves: every wait resolves at once and is counted. */
const instant = () => {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => void waits.push(ms) };
};

afterEach(async () => {
  const mounted = tree;
  if (mounted) await act(async () => mounted.unmount());
  tree = undefined;
  state = undefined;
  jest.useRealTimers();
});

it('is off from the first frame in the phone app, and asks nothing', async () => {
  const client = fakeClient({ web: false });
  await mount({ client });
  expect(current()).toBe(ACCOUNT_OFF);
  expect(client.calls).toEqual([]);
});

it('holds the first frame on the web until api/config has answered', async () => {
  let answer: (config: ApiConfig | null) => void = () => {};
  const client = fakeClient({ config: jest.fn(() => new Promise<ApiConfig | null>((resolve) => (answer = resolve))) });
  await mount({ client });
  expect(current().settled).toBe(false);
  expect(current().signInOn).toBe(false);
  await act(async () => answer(null));
  expect(current()).toBe(ACCOUNT_OFF);
});

it('is off for good when api/config is absent: no landing taken, no api/me, nothing again', async () => {
  const client = fakeClient({ config: jest.fn(async () => null) });
  await mount({ client });
  expect(current()).toBe(ACCOUNT_OFF);
  await act(async () => {});
  expect(client.config).toHaveBeenCalledTimes(1);
  expect(client.me).not.toHaveBeenCalled();
  expect(client.takeLanding).not.toHaveBeenCalled();
});

it('draws the site without an account when the API does not answer in time', async () => {
  jest.useFakeTimers();
  const client = fakeClient({ config: jest.fn(() => new Promise<ApiConfig | null>(() => {})) });
  await mount({ client, limitMs: 5000 });
  expect(current().settled).toBe(false);
  await act(async () => jest.advanceTimersByTime(4999));
  expect(current().settled).toBe(false);
  await act(async () => jest.advanceTimersByTime(1));
  expect(current()).toBe(ACCOUNT_OFF);
});

it('keeps to that once the limit has passed, whatever answers late', async () => {
  jest.useFakeTimers();
  let answer: (config: ApiConfig | null) => void = () => {};
  const client = fakeClient({ config: jest.fn(() => new Promise<ApiConfig | null>((resolve) => (answer = resolve))) });
  await mount({ client, limitMs: 5000 });
  await act(async () => jest.advanceTimersByTime(5000));
  expect(current()).toBe(ACCOUNT_OFF);
  await act(async () => answer(SHOP));
  expect(current()).toBe(ACCOUNT_OFF);
  expect(client.takeLanding).not.toHaveBeenCalled();
  expect(client.me).not.toHaveBeenCalled();
});

it('draws the site without an account when api/me does not answer in time either, and keeps to that', async () => {
  jest.useFakeTimers();
  let answer: (me: Me | null) => void = () => {};
  const client = fakeClient({ me: jest.fn(() => new Promise<Me | null>((resolve) => (answer = resolve))) });
  await mount({ client, limitMs: 5000 });
  await act(async () => jest.advanceTimersByTime(5000));
  expect(current()).toBe(ACCOUNT_OFF);
  await act(async () => answer({ ...ADA, entitlements: ['pro'] }));
  expect(current()).toBe(ACCOUNT_OFF);
});

it('is on with sign-in and Pro for sale, as the site says', async () => {
  const client = fakeClient();
  await mount({ client });
  expect(current()).toMatchObject({ settled: true, signInOn: true, shop: PRO, user: ADA.user, entitlements: [], notice: null });
  expect(client.calls).toEqual(['config', 'takeLanding', 'me']);
});

it('has sign-in without a shop when Pro is not sold', async () => {
  const client = fakeClient({ config: jest.fn(async () => ({ signIn: true as const, pro: null })) });
  await mount({ client });
  expect(current()).toMatchObject({ settled: true, signInOn: true, shop: null });
});

it('reads an unreadable api/me as signed out', async () => {
  const client = fakeClient({ me: jest.fn(async () => null) });
  await mount({ client });
  expect(current()).toMatchObject({ signInOn: true, user: null, entitlements: [] });
});

it("says once that a sign-in didn't complete", async () => {
  const client = fakeClient({ takeLanding: jest.fn(() => ({ signIn: 'failed' as const, purchase: null })), me: jest.fn(async () => SIGNED_OUT) });
  await mount({ client });
  expect(current().notice).toBe("Sign-in didn't complete.");
  await act(async () => current().dismissNotice());
  expect(current().notice).toBeNull();
});

describe('back from Checkout', () => {
  const landing = (purchase: Landing['purchase']) => jest.fn((): Landing => ({ signIn: null, purchase }));

  it('thanks the visitor at once when the purchase is already on record', async () => {
    const clock = instant();
    const client = fakeClient({ takeLanding: landing('success'), me: jest.fn(async () => ({ ...ADA, entitlements: ['pro'] })) });
    await mount({ client, wait: clock.wait });
    expect(current().notice).toBe('Thank you — DrawDraw Pro is unlocked.');
    expect(clock.waits).toEqual([]);
  });

  it('asks api/me until the webhook has granted it, then thanks the visitor', async () => {
    const clock = instant();
    const answers: Me[] = [ADA, ADA, ADA, { ...ADA, entitlements: ['pro'] }];
    const client = fakeClient({ takeLanding: landing('success'), me: jest.fn(async () => answers.shift() ?? ADA) });
    await mount({ client, wait: clock.wait });
    await act(async () => {});
    expect(current().notice).toBe('Thank you — DrawDraw Pro is unlocked.');
    expect(current().entitlements).toEqual(['pro']);
    expect(clock.waits).toEqual([3000, 3000, 3000]);
  });

  it('says the payment is on its way when five answers over fifteen seconds do not show it', async () => {
    const clock = instant();
    const client = fakeClient({ takeLanding: landing('success') });
    await mount({ client, wait: clock.wait });
    await act(async () => {});
    expect(current().notice).toBe('Payment received. It can take a minute to appear — reload to check.');
    expect(client.me).toHaveBeenCalledTimes(6);
    expect(clock.waits).toEqual([3000, 3000, 3000, 3000, 3000]);
  });

  it('says nothing for a cancelled Checkout', async () => {
    const clock = instant();
    const client = fakeClient({ takeLanding: landing('cancelled') });
    await mount({ client, wait: clock.wait });
    await act(async () => {});
    expect(current().notice).toBeNull();
    expect(client.me).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a purchase on a site that sells nothing', async () => {
    const clock = instant();
    const client = fakeClient({ takeLanding: landing('success'), config: jest.fn(async () => ({ signIn: true as const, pro: null })) });
    await mount({ client, wait: clock.wait });
    await act(async () => {});
    expect(current().notice).toBeNull();
    expect(clock.waits).toEqual([]);
  });
});

describe('actions', () => {
  it('signs in by leaving for Google', async () => {
    const client = fakeClient();
    await mount({ client });
    current().signIn();
    expect(client.signIn).toHaveBeenCalledTimes(1);
  });

  it('signs out and reads who is signed in again; says so when it could not', async () => {
    const client = fakeClient();
    await mount({ client });
    jest.mocked(client.me).mockResolvedValue(SIGNED_OUT);
    let note: string | null = 'unset';
    await act(async () => {
      note = await current().signOut();
    });
    expect(note).toBeNull();
    expect(current().user).toBeNull();
    jest.mocked(client.signOut).mockResolvedValue(false);
    await act(async () => {
      note = await current().signOut();
    });
    expect(note).toBe('Could not sign out. Try again.');
  });

  it('deletes the account and reads the page afresh; says so when it could not', async () => {
    const client = fakeClient({ me: jest.fn(async () => ({ ...ADA, entitlements: ['pro'] })) });
    await mount({ client });
    expect(current().entitlements).toEqual(['pro']);
    jest.mocked(client.me).mockResolvedValue(SIGNED_OUT);
    let note: string | null = 'unset';
    await act(async () => {
      note = await current().deleteAccount();
    });
    expect(note).toBeNull();
    expect(current().entitlements).toEqual([]);
    jest.mocked(client.deleteAccount).mockResolvedValue(false);
    await act(async () => {
      note = await current().deleteAccount();
    });
    expect(note).toBe('The account could not be deleted. Try again.');
  });

  it('buys Pro: leaves for Checkout, or reads the page afresh, or says why not', async () => {
    const client = fakeClient();
    await mount({ client });
    const buy = async () => {
      let note: string | null = 'unset';
      await act(async () => {
        note = await current().buyPro();
      });
      return note;
    };
    expect(await buy()).toBeNull();
    expect(client.checkout).toHaveBeenLastCalledWith('pro');
    jest.mocked(client.checkout).mockResolvedValueOnce('owned');
    jest.mocked(client.me).mockResolvedValueOnce({ ...ADA, entitlements: ['pro'] });
    expect(await buy()).toBeNull();
    expect(current().entitlements).toEqual(['pro']);
    jest.mocked(client.checkout).mockResolvedValueOnce('signin');
    jest.mocked(client.me).mockResolvedValueOnce(SIGNED_OUT);
    expect(await buy()).toBeNull();
    expect(current().user).toBeNull();
    jest.mocked(client.checkout).mockResolvedValueOnce('unavailable');
    expect(await buy()).toBe('DrawDraw Pro is not on sale right now.');
    jest.mocked(client.checkout).mockResolvedValueOnce('busy');
    expect(await buy()).toBe('Too many tries for now. Try again in a while.');
    jest.mocked(client.checkout).mockResolvedValueOnce('failed');
    expect(await buy()).toBe('The shop could not be reached. Try again.');
  });
});
