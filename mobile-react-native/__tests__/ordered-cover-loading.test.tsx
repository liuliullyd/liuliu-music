import React from 'react';
import { Image, NativeModules } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import {
  OrderedRemoteCover,
  OrderedCoverScope,
  OrderedCoverBatch,
  OrderedCoverQueue,
} from '../src/components/OrderedRemoteCover';
import { covers } from '../src/assets/covers';
import {
  COVER_REQUEST_TIMEOUT_MS,
  loadDecodedCover,
} from '../src/services/coverLoading';
import { Cover } from '../src/components/UI';
import { ResilientHomeCover } from '../src/components/ResilientHomeCover';
import { coverCandidates } from '../src/services/onlineCatalog';

type Request = {
  uri: string;
  id: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};
const native = NativeModules.LiuliuCover;
let requests: Request[] = [];
let caseId = 0;
const uri = (id: number) =>
  'https://img.test/case-' + caseId + '-' + id + '.jpg';
const image = (r: Renderer.ReactTestRenderer, id: string) =>
  r.root.findAllByType(Image).find(node => node.props.testID === id);
const decoded = async (request: Request) =>
  act(async () =>
    request.resolve({ uri: request.uri, width: 256, height: 256 }),
  );
const failed = async (request: Request) =>
  act(async () => request.reject(new Error('HTTP 503')));
beforeEach(() => {
  caseId++;
  requests = [];
  native.load.mockImplementation(
    (url: string, id: string) =>
      new Promise((resolve, reject) =>
        requests.push({ uri: url, id, resolve, reject }),
      ),
  );
  native.cancel.mockClear();
  native.cancel.mockImplementation((id: string) => {
    requests.find(request => request.id === id)?.reject(new Error('cancelled'));
  });
});

test('downloads and decodes six covers without any Image mount or native display callbacks; a seventh follows the first decode', async () => {
  let r!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(
        <OrderedCoverScope generationKey="page">
          <OrderedCoverBatch
            candidates={Array.from({ length: 9 }, (_, i) => [uri(i)])}
            moduleKey="page"
          />
          <Cover uri={uri(0)} coverKey="cat" testID="first" />
        </OrderedCoverScope>,
      );
    });
    expect(requests.map(x => x.uri)).toEqual(
      Array.from({ length: 6 }, (_, i) => uri(i)),
    );
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    await decoded(requests[0]!);
    expect(requests[6]!.uri).toBe(uri(6));
    expect(image(r, 'first-remote')!.props.source).toEqual({
      uri: uri(0),
      cache: 'force-cache',
    });
    expect(image(r, 'first-fallback')).toBeUndefined();
    expect(
      native.load.mock.calls.filter((x: any[]) => x[0] === uri(0)),
    ).toHaveLength(1);
  } finally {
    await act(async () => r?.unmount());
  }
});

test('a failed head releases later initial covers before retry and bundled artwork remains absent until real failure exhaustion', async () => {
  let r!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <Cover key={i} uri={uri(i)} coverKey="cat" testID={'cover-' + i} />
          ))}
        </>,
      );
    });
    await failed(requests[0]!);
    expect(requests[6]!.uri).toBe(uri(6));
    expect(image(r, 'cover-0-fallback')).toBeUndefined();
    for (let i = 1; i <= 7; i++) await decoded(requests[i]!);
    const retry = requests.find((x, i) => i > 0 && x.uri === uri(0))!;
    expect(retry).toBeDefined();
    expect(image(r, 'cover-0-fallback')).toBeUndefined();
    await failed(retry);
    expect(image(r, 'cover-0-fallback')!.props.source).toEqual(covers.cat);
    expect(
      r.root.findAllByType(Image).filter(x => x.props.source?.uri),
    ).toHaveLength(7);
  } finally {
    await act(async () => r?.unmount());
  }
});

test.each(['netease', 'qq', 'kugou', 'kuwo', 'migu'] as const)(
  '%s candidates keep HTTP alternatives and show fallback only after each candidate and retry fail',
  async provider => {
    const values =
      provider === 'kuwo'
        ? coverCandidates(
            provider,
            'http://img1.kuwo.cn/case-' + caseId + '.jpg',
          )
        : provider === 'migu'
        ? coverCandidates(
            provider,
            'https://d.musicapp.migu.cn/case-' + caseId + '.jpg',
          )
        : [uri(0), uri(1)];
    let r!: Renderer.ReactTestRenderer;
    try {
      await act(async () => {
        r = Renderer.create(
          <ResilientHomeCover
            uri={values[0]}
            uris={values.slice(1)}
            fallback={covers.cat}
            testID="protocol"
            style={{ width: 40, height: 40 }}
          />,
        );
      });
      let i = 0;
      for (const value of values) {
        for (let attempt = 0; attempt < 2; attempt++) {
          expect(requests[i]!.uri).toBe(value);
          expect(image(r, 'protocol-fallback')).toBeUndefined();
          await failed(requests[i++]!);
        }
      }
      expect(image(r, 'protocol-fallback')).toBeDefined();
    } finally {
      await act(async () => r?.unmount());
    }
  },
);

test('queued work consumes no timeout, active request is cancelled on timeout, and failure does not depend on View callbacks', async () => {
  jest.useFakeTimers();
  let r!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <Cover
              key={i}
              uri={uri(i)}
              coverKey="cat"
              testID={'timeout-' + i}
            />
          ))}
        </>,
      );
    });
    await act(async () =>
      jest.advanceTimersByTime(COVER_REQUEST_TIMEOUT_MS - 1),
    );
    expect(requests).toHaveLength(6);
    expect(native.cancel).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(native.cancel).toHaveBeenCalledTimes(6);
    expect(requests[6]!.uri).toBe(uri(6));
    expect(image(r, 'timeout-6-fallback')).toBeUndefined();
    expect(image(r, 'timeout-0-fallback')).toBeUndefined();
  } finally {
    await act(async () => r?.unmount());
    jest.useRealTimers();
  }
});

test('stale native completion cannot paint a replacement; unmount cancels its real request', async () => {
  let r!: Renderer.ReactTestRenderer;
  const loaded = jest.fn();
  try {
    const element = (id: number) => (
      <OrderedRemoteCover
        uris={[uri(id)]}
        fallback={covers.cat}
        testID="switch"
        style={{ width: 40, height: 40 }}
        onLoadedUri={loaded}
      />
    );
    await act(async () => {
      r = Renderer.create(element(0));
    });
    const stale = requests[0]!;
    await act(async () => r.update(element(1)));
    expect(native.cancel).toHaveBeenCalledWith(stale.id);
    await decoded(stale);
    expect(image(r, 'switch-remote')).toBeUndefined();
    await decoded(requests[1]!);
    expect(image(r, 'switch-remote')!.props.source.uri).toBe(uri(1));
    expect(loaded).not.toHaveBeenCalled();
    await act(async () => image(r, 'switch-remote')!.props.onLoad());
    expect(loaded).toHaveBeenCalledWith(uri(1));
  } finally {
    await act(async () => r?.unmount());
  }
});

test('successful artwork survives pause, rerender and append; native decode cache is reused after remount', async () => {
  let r!: Renderer.ReactTestRenderer;
  const element = (count: number, active = true) => (
    <OrderedCoverScope generationKey="keep" active={active}>
      {Array.from({ length: count }, (_, i) => (
        <Cover key={i} uri={uri(i)} coverKey="cat" testID={'keep-' + i} />
      ))}
    </OrderedCoverScope>
  );
  try {
    await act(async () => {
      r = Renderer.create(element(2));
    });
    await decoded(requests[0]!);
    const first = image(r, 'keep-0-remote')!;
    await act(async () => first.props.onLoad());
    await act(async () => r.update(element(4)));
    expect(image(r, 'keep-0-remote')).toBe(first);
    expect(requests.map(x => x.uri)).toEqual([uri(0), uri(1), uri(2), uri(3)]);
    await act(async () => r.update(element(4, false)));
    expect(image(r, 'keep-0-remote')).toBe(first);
    await act(async () => r.unmount());
    await act(async () => {
      r = Renderer.create(element(1));
    });
    expect(image(r, 'keep-0-remote')!.props.source.uri).toBe(uri(0));
    expect(requests.filter(x => x.uri === uri(0))).toHaveLength(1);
  } finally {
    await act(async () => r?.unmount());
  }
});

test('a presentation decode error retries its own cover and preserves successful neighbouring artwork', async () => {
  let r!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(
        <>
          <Cover uri={uri(0)} coverKey="cat" testID="decode" />
          <Cover uri={uri(1)} coverKey="cat" testID="neighbour" />
        </>,
      );
    });
    await decoded(requests[0]!);
    await decoded(requests[1]!);
    const neighbour = image(r, 'neighbour-remote')!;
    await act(async () => image(r, 'decode-remote')!.props.onError());
    expect(image(r, 'decode-fallback')).toBeUndefined();
    expect(requests[2]!.uri).toBe(uri(0));
    await failed(requests[2]!);
    expect(image(r, 'decode-fallback')).toBeDefined();
    expect(image(r, 'neighbour-remote')).toBe(neighbour);
  } finally {
    await act(async () => r?.unmount());
  }
});

test('pending metadata stays neutral and missing metadata alone uses local artwork', async () => {
  let r!: Renderer.ReactTestRenderer;
  try {
    await act(async () => {
      r = Renderer.create(
        <ResilientHomeCover
          remotePending
          fallback={covers.cat}
          testID="metadata"
          style={{ width: 40, height: 40 }}
        />,
      );
    });
    expect(r.root.findAllByType(Image)).toHaveLength(0);
    await act(async () =>
      r.update(
        <ResilientHomeCover
          fallback={covers.cat}
          testID="metadata"
          style={{ width: 40, height: 40 }}
        />,
      ),
    );
    expect(image(r, 'metadata-fallback')).toBeDefined();
    expect(requests).toHaveLength(0);
  } finally {
    await act(async () => r?.unmount());
  }
});

test('coalesced observers cancel only after the last consumer releases and corrupt decoded dimensions are rejected', async () => {
  const a = loadDecodedCover(uri(0)),
    b = loadDecodedCover(uri(0));
  const errors = [a.promise.catch(x => x), b.promise.catch(x => x)];
  expect(requests).toHaveLength(1);
  a.release();
  expect(native.cancel).not.toHaveBeenCalled();
  b.release();
  expect(native.cancel).toHaveBeenCalledWith(requests[0]!.id);
  requests[0]!.reject(new Error('cancelled'));
  await Promise.all(errors);
  const bad = loadDecodedCover(uri(1));
  const result = bad.promise.catch(x => x);
  requests[1]!.resolve({ uri: uri(1), width: 0, height: 0 });
  expect(await result).toBeInstanceOf(Error);
  bad.release();
});

test('all scopes share six request slots and current artwork retains its independent slot; popup pauses and resumes page requests', async () => {
  const page = new OrderedCoverQueue(true),
    popup = new OrderedCoverQueue(false, 'popup', true);
  const events: string[] = [];
  const enqueue = (
    q: OrderedCoverQueue,
    id: number,
    priority: 'visible' | 'player' = 'visible',
  ) =>
    q.enqueue(id, {
      moduleKey: String(id),
      priority,
      start: () => events.push('start-' + id),
      pause: () => events.push('pause-' + id),
    });
  try {
    for (let i = 0; i < 9; i++) enqueue(page, i);
    await Promise.resolve();
    expect(events).toEqual([0, 1, 2, 3, 4, 5].map(i => 'start-' + i));
    enqueue(popup, 20);
    popup.setActive(true);
    enqueue(page, 30, 'player');
    await Promise.resolve();
    expect(events).toContain('start-20');
    expect(events).toContain('start-30');
    expect(events).not.toContain('start-6');
    popup.dispose();
    await Promise.resolve();
    expect(events.slice(-6)).toEqual([0, 1, 2, 3, 4, 5].map(i => 'start-' + i));
    page.complete(0);
    page.complete(0);
    await Promise.resolve();
    expect(events.at(-1)).toBe('start-6');
    expect(events).not.toContain('start-7');
  } finally {
    page.dispose();
    popup.dispose();
  }
});

test('Kuwo lookup displays and caches the decoded artwork URI; bundled cover stays absent during lookup', async () => {
  let r!: Renderer.ReactTestRenderer;
  const lookup =
    'http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=url&size=500&rid=918273';
  const result = 'https://img1.kuwo.cn/star/albumcover/actual.jpg';
  const loaded = jest.fn();
  try {
    await act(async () => {
      r = Renderer.create(
        <OrderedRemoteCover
          uris={[lookup]}
          style={{ width: 64, height: 64 }}
          fallback={covers.cat}
          testID="lookup"
          onLoadedUri={loaded}
        />,
      );
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.uri).toBe(lookup);
    expect(image(r, 'lookup-fallback')).toBeUndefined();
    await act(async () =>
      requests[0]!.resolve({ uri: result, width: 500, height: 500 }),
    );
    expect(image(r, 'lookup-remote')!.props.source).toEqual({
      uri: result,
      cache: 'force-cache',
    });
    await act(async () => image(r, 'lookup-remote')!.props.onLoad());
    expect(loaded).toHaveBeenCalledWith(result);
    await act(async () => r.unmount());
    await act(async () => {
      r = Renderer.create(
        <OrderedRemoteCover
          uris={[lookup]}
          style={{ width: 64, height: 64 }}
          fallback={covers.cat}
          testID="lookup"
        />,
      );
    });
    expect(requests).toHaveLength(1);
    expect(image(r, 'lookup-remote')!.props.source.uri).toBe(result);
    expect(image(r, 'lookup-fallback')).toBeUndefined();
  } finally {
    await act(async () => r?.unmount());
  }
});

test('ten refreshes interrupted by entering a retained catalog cancel old artwork and allow returning Home to decode new covers', async () => {
  let r!: Renderer.ReactTestRenderer;
  const catalogUri = uri(999);
  const scene = (round: number, catalog: boolean) => (
    <>
      {!catalog && (
        <OrderedCoverScope generationKey={'refresh:' + round}>
          <OrderedCoverBatch
            candidates={Array.from({ length: 8 }, (_, i) => [
              uri(round * 10 + i),
            ])}
            moduleKey="home"
          />
          <Cover uri={uri(round * 10)} coverKey="cat" testID="return-home" />
        </OrderedCoverScope>
      )}
      <OrderedCoverScope active={catalog} generationKey="retained-catalog">
        <Cover uri={catalogUri} coverKey="train" testID="catalog" />
      </OrderedCoverScope>
    </>
  );
  try {
    await act(async () => {
      r = Renderer.create(scene(0, false));
    });
    for (let round = 0; round < 10; round++) {
      await act(async () => r.update(scene(round * 2, false)));
      const abandoned = requests.filter(x => x.uri === uri(round * 20));
      await act(async () => r.update(scene(round, true)));
      expect(native.cancel).toHaveBeenCalledWith(abandoned.at(-1)!.id);
      const catalogRequest = requests.find(x => x.uri === catalogUri)!;
      await decoded(catalogRequest);
      await act(async () => r.update(scene(round * 2 + 1, false)));
      const resumed = requests
        .filter(x => x.uri === uri((round * 2 + 1) * 10))
        .at(-1)!;
      expect(resumed).toBeDefined();
      expect(image(r, 'return-home-fallback')).toBeUndefined();
      await decoded(resumed);
      expect(image(r, 'return-home-remote')!.props.source.uri).toBe(
        uri((round * 2 + 1) * 10),
      );
    }
    expect(requests.filter(x => x.uri === catalogUri)).toHaveLength(1);
  } finally {
    await act(async () => r?.unmount());
  }
});

test('pending covers start in page-section and item order with six slots while active work is preserved and retries stay behind first attempts', async () => {
  const queue = new OrderedCoverQueue(true);
  const started: number[] = [],
    paused: number[] = [];
  const add = (id: number, section: number, item: number, retry = false) =>
    queue.enqueue(id, {
      moduleKey: String(id),
      visualOrder: [section, item],
      retry,
      start: () => started.push(id),
      pause: () => paused.push(id),
    });
  try {
    add(80, 8, 0);
    for (let index = 5; index >= 0; index--) add(index, 0, index);
    add(11, 1, 1);
    add(10, 1, 0);
    add(90, 0, 0, true);
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    queue.updateOrder(2, [9, 9]);
    queue.complete(0);
    queue.complete(1);
    await Promise.resolve();
    expect(started.slice(-2)).toEqual([10, 11]);
    expect(paused).toEqual([]);
    queue.complete(2);
    queue.complete(3);
    await Promise.resolve();
    expect(started.slice(-2)).toEqual([80, 90]);
  } finally {
    queue.dispose();
  }
});
