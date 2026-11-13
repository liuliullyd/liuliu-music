import { UrlPrewarmScheduler } from '../src/services/urlPrewarmScheduler';

test('serial queue waits for failed-song removal before advancing', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2), order: string[] = [];
  scheduler.setQueueOrder(['one', 'two', 'three']);
  let finish!: () => void;
  const remove = jest.fn(async () => {
    order.push('remove');
    await new Promise<void>(resolve => { finish = resolve; });
  });
  const run = jest.fn(async () => {
    order.push('one');
    throw new Error('unavailable');
  });
  scheduler.enqueue('queue', 'one', run, undefined, remove);
  scheduler.enqueue('queue', 'two', async () => { order.push('two'); });
  scheduler.enqueue('queue', 'three', async () => { order.push('three'); });
  await flush(); await flush();
  expect(order).toEqual(['one', 'remove']);
  finish(); await scheduler.whenIdle();
  expect(order).toEqual(['one', 'remove', 'two', 'three']);
  expect(run).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('serial queue upgrades an active address task before advancing', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2), address = deferred(), validated = deferred();
  scheduler.setQueueOrder(['one', 'two']);
  const original = scheduler.enqueue('home-visible', 'one', () => address.promise);
  await flush();
  const validate = jest.fn(() => validated.promise), next = jest.fn(async () => undefined);
  const upgraded = scheduler.enqueue('queue', 'one', validate);
  scheduler.enqueue('queue', 'two', next);
  address.resolve(); await flush(); await flush();
  expect(validate).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  let published = false;
  void upgraded.then(() => { published = true; });
  await flush(); expect(published).toBe(false);
  validated.resolve();
  expect(await original).toBe('success');
  await scheduler.whenIdle(); expect(next).toHaveBeenCalledTimes(1);
});

test('a failed song reports failure without retry before a later hung song completes', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2), order: string[] = [];
  let release!: () => void;
  const failure = jest.fn();
  const bad = scheduler.enqueue('queue', 'bad', async () => { order.push('bad'); throw new Error('unavailable'); }, undefined, failure);
  const next = scheduler.enqueue('queue', 'next', async () => { order.push('next'); await new Promise<void>(resolve => { release = resolve; }); });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  expect(order).toEqual(['bad', 'next']);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(await bad).toBe('failed');
  release();
  expect(await next).toBe('success');
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

test('two page workers retain their concurrent slots independently of serial playlist validation', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2);
  const pending = Array.from({ length: 4 }, deferred);
  const started: number[] = [];
  const release = scheduler.hold();
  scheduler.setQueueOrder(['0', '1', '2', '3']);
  pending.forEach((task, index) => scheduler.enqueue('home-visible', String(index), async () => {
    started.push(index);
    await task.promise;
  }));
  release();
  await flush();
  expect(started).toEqual([0, 1]);
  expect(scheduler.snapshot().active).toBe(2);
  pending[1]!.resolve();
  await flush();
  expect(started).toEqual([0, 1, 2]);
  pending[0]!.resolve();
  await flush();
  expect(started).toEqual([0, 1, 2, 3]);
  pending[2]!.resolve();
  pending[3]!.resolve();
  await scheduler.whenIdle();
  expect(scheduler.snapshot().active).toBe(0);
});

test('leaving a detail cancels its active read and pending rows, waiting for cleanup before queue work', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const owner = {};
  const cleanup = deferred();
  const started: string[] = [];
  let signal!: AbortSignal;
  scheduler.enqueue('home-visible', 'detail-1', async value => {
    signal = value;
    started.push('detail-1');
    await cleanup.promise;
  }, owner);
  scheduler.enqueue('home-visible', 'detail-2', async () => { started.push('detail-2'); }, owner);
  await flush();
  scheduler.retainOwner(owner, []);
  scheduler.enqueue('queue', 'queue-1', async () => { started.push('queue-1'); });
  await flush();
  expect(signal.aborted).toBe(true);
  expect(started).toEqual(['detail-1']);
  cleanup.resolve();
  await scheduler.whenIdle();
  expect(started).toEqual(['detail-1', 'queue-1']);
});

test('a viewport retains overlapping rows and releasing it preserves a coalesced queue song', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const owner = {};
  const release = scheduler.hold();
  const started: string[] = [];
  for (const key of ['hidden', 'visible', 'shared']) scheduler.enqueue('home-visible', key, async () => { started.push(key); }, owner);
  scheduler.enqueue('queue', 'shared', async () => { started.push('shared-queue'); });
  scheduler.retainOwner(owner, ['visible']);
  release();
  await scheduler.whenIdle();
  expect(started).toEqual(['shared-queue', 'visible']);
});

test('two detail owners coalesce and closing one cannot cancel the other', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const first = {}, second = {};
  const release = scheduler.hold();
  const run = jest.fn(async () => undefined);
  scheduler.enqueue('home-visible', 'same', run, first);
  scheduler.enqueue('home-visible', 'same', run, second);
  scheduler.retainOwner(first, []);
  release();
  await scheduler.whenIdle();
  expect(run).toHaveBeenCalledTimes(1);
});

test('runs only the Home-visible URL-only lane with bounded concurrency', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2);
  const blockers = [deferred(), deferred(), deferred()];
  const started: string[] = [];
  const release = scheduler.hold();
  blockers.forEach((blocker, index) =>
    scheduler.enqueue('home-visible', `home-${index}`, async () => {
      started.push(`home-${index}`);
      await blocker.promise;
    }),
  );
  release();
  await flush();
  expect(started).toEqual(['home-0', 'home-1']);
  expect(scheduler.snapshot()).toMatchObject({
    active: 2,
    homeQueued: 1,
    pending: 3,
    paused: false,
  });
  blockers[0]!.resolve();
  await flush();
  expect(started).toEqual(['home-0', 'home-1', 'home-2']);
  blockers[1]!.resolve();
  blockers[2]!.resolve();
  await scheduler.whenIdle();
  expect(scheduler.snapshot()).toMatchObject({
    active: 0,
    homeQueued: 0,
    retryQueued: 0,
    pending: 0,
  });
});

test('the production prewarm lane can admit exactly one song in source order', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const first = deferred();
  const started: string[] = [];
  scheduler.enqueue('home-visible', 'song-1', async () => {
    started.push('song-1');
    await first.promise;
  });
  scheduler.enqueue('home-visible', 'song-2', async () => {
    started.push('song-2');
  });
  await flush();
  expect(started).toEqual(['song-1']);
  expect(scheduler.snapshot()).toMatchObject({ active: 1, homeQueued: 1 });
  first.resolve();
  await scheduler.whenIdle();
  expect(started).toEqual(['song-1', 'song-2']);
});

test('one initial playback release continuously drains twenty songs without another song-play event', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const release = scheduler.hold();
  const started: number[] = [];
  let active = 0, maximumActive = 0;
  for (let index = 1; index <= 20; index++) scheduler.enqueue('queue', `song-${index}`, async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    started.push(index);
    await Promise.resolve();
    active--;
  });
  await flush();
  expect(started).toEqual([]);
  release();
  await scheduler.whenIdle();
  expect(started).toEqual(Array.from({ length: 20 }, (_v, i) => i + 1));
  expect(maximumActive).toBe(1);
});

test('retries a failed Home-visible URL-only song before unrelated fresh work', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2);
  const started: string[] = [];
  let firstAttempts = 0;
  const release = scheduler.hold();
  scheduler.enqueue('home-visible', 'first', async () => {
    started.push('first');
    firstAttempts += 1;
    if (firstAttempts === 1) throw new Error('temporary');
  });
  scheduler.enqueue('home-visible', 'fresh', async () => {
    started.push('fresh');
  });
  release();
  await scheduler.whenIdle();
  expect(started).toEqual(['first', 'first', 'fresh']);
  expect(scheduler.snapshot()).toMatchObject({
    active: 0,
    pending: 0,
    retryQueued: 0,
  });
});

test('notifies queue removal after one failed attempt and waits for cleanup before queue idle', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2);
  const cleanup = deferred();
  const cleanupStarted = deferred();
  const run = jest.fn(async () => {
    throw new Error('resolution failed');
  });
  const remove = jest.fn(async () => {
    cleanupStarted.resolve();
    return cleanup.promise;
  });
  const release = scheduler.hold();
  const outcome = scheduler.enqueue('queue', 'failed-track', run, undefined, remove);
  let settled = false;
  outcome.then(() => { settled = true; });

  release();
  await cleanupStarted.promise;
  expect(run).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(settled).toBe(true);
  expect(scheduler.snapshot()).toMatchObject({ active: 1 });

  cleanup.resolve();
  await expect(outcome).resolves.toBe('failed');
  await scheduler.whenQueueIdle();
  expect(scheduler.snapshot()).toMatchObject({ active: 0, pending: 0 });
});

test('queue removal does not run for Home-visible failures or invalidated queue tasks', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 1);
  const remove = jest.fn();
  await scheduler.enqueue(
    'home-visible',
    'home-failure',
    async () => { throw new Error('home failure'); },
    undefined,
    remove,
  );
  expect(remove).not.toHaveBeenCalled();

  const stale = deferred();
  const outcome = scheduler.enqueue(
    'queue',
    'stale-queue-failure',
    async () => stale.promise,
    undefined,
    remove,
  );
  await flush();
  scheduler.setQueueOrder([]);
  stale.reject(new Error('stale failure'));
  await expect(outcome).resolves.toBe('cancelled');
  expect(remove).not.toHaveBeenCalled();
});

test('deduplicates the same Home-visible URL-only request', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2);
  const started: string[] = [];
  const release = scheduler.hold();
  scheduler.enqueue('home-visible', 'same', async () => {
    started.push('first');
  });
  scheduler.enqueue('home-visible', 'same', async () => {
    started.push('replacement');
  });
  release();
  await scheduler.whenIdle();
  expect(started).toEqual(['replacement']);
});

test('reports success and terminal failure only after the configured retry count', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2);
  const success = scheduler.enqueue('home-visible', 'success', async () => undefined);
  let attempts = 0;
  const failure = scheduler.enqueue('home-visible', 'failure', async () => {
    attempts += 1;
    throw new Error('unavailable');
  });
  await expect(success).resolves.toBe('success');
  await expect(failure).resolves.toBe('failed');
  expect(attempts).toBe(2);
});

test('reports an owner-released visible task as cancelled, not as a failed song', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2);
  const owner = {};
  const cleanup = deferred();
  let signal!: AbortSignal;
  const outcome = scheduler.enqueue('home-visible', 'visible', async value => {
    signal = value;
    await cleanup.promise;
  }, owner);
  await flush();
  scheduler.retainOwner(owner, []);
  await expect(outcome).resolves.toBe('cancelled');
  expect(signal.aborted).toBe(true);
  cleanup.resolve();
  await scheduler.whenIdle();
});

test('overlapping playback holds release independently', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2);
  const started: string[] = [];
  const releaseFirst = scheduler.hold();
  const releaseSecond = scheduler.hold();
  scheduler.enqueue('home-visible', 'home', async () => {
    started.push('home');
  });
  releaseFirst();
  await flush();
  expect(started).toEqual([]);
  expect(scheduler.snapshot().paused).toBe(true);
  releaseSecond();
  await scheduler.whenIdle();
  expect(started).toEqual(['home']);
});

test('holds queued URL-only work during navigation and resumes it afterward', async () => {
  const scheduler = new UrlPrewarmScheduler(1, 2);
  const blocker = deferred();
  const started: string[] = [];
  scheduler.enqueue('home-visible', 'active', async () => {
    started.push('active');
    await blocker.promise;
  });
  scheduler.enqueue('home-visible', 'queued', async () => {
    started.push('queued');
  });
  await flush();
  const release = scheduler.hold();
  blocker.resolve();
  await flush();
  expect(started).toEqual(['active']);
  release();
  await scheduler.whenIdle();
  expect(started).toEqual(['active', 'queued']);
  expect(scheduler.snapshot().pending).toBe(0);
});

test('playlist validation advances one song at a time in list order', async () => {
  const scheduler = new UrlPrewarmScheduler(2, 2);
  const first = deferred(), second = deferred(), started: string[] = [];
  const release = scheduler.hold();
  scheduler.setQueueOrder(['one', 'two', 'three', 'four', 'five']);
  for (const key of ['five', 'four', 'three', 'two', 'one']) scheduler.enqueue('queue', key, async () => {
    started.push(key);
    if (key === 'one') await first.promise;
    if (key === 'two') await second.promise;
  });
  release(); await flush();
  expect(started).toEqual(['one']);
  expect(scheduler.snapshot().active).toBe(1);
  first.resolve(); await flush(); await flush();
  expect(started).toEqual(['one', 'two']);
  second.resolve(); await scheduler.whenIdle();
  expect(started).toEqual(['one', 'two', 'three', 'four', 'five']);
});
