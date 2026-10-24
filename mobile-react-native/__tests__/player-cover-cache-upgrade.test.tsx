import React from 'react';
import { Image, NativeModules } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { OrderedRemoteCover } from '../src/components/OrderedRemoteCover';
import {
  clearDecodedCoverCache,
  loadDecodedCover,
} from '../src/services/coverLoading';
import { playerCoverCandidates } from '../src/services/onlineCatalog';
import type { Track } from '../src/domain/types';

type Request = {
  uri: string;
  id: string;
  resolve: (value: { uri: string; width: number; height: number }) => void;
  reject: (error: Error) => void;
};
const native = NativeModules.LiuliuCover;
let requests: Request[];
let renderer: Renderer.ReactTestRenderer | undefined;
const thumbnail = 'https://p1.music.126.net/album.jpg?param=256y256';
const original = { provider: 'netease', cover: thumbnail } as Track;
const candidates = playerCoverCandidates(original);
const remote = () =>
  renderer!.root
    .findAllByType(Image)
    .find(node => node.props.testID === 'song-cover-remote');

beforeEach(async () => {
  clearDecodedCoverCache();
  requests = [];
  native.load
    .mockReset()
    .mockImplementation(
      (uri: string, id: string) =>
        new Promise((resolve, reject) =>
          requests.push({ uri, id, resolve, reject }),
        ),
    );
  native.cancel
    .mockReset()
    .mockImplementation((id: string) =>
      requests
        .find(request => request.id === id)
        ?.reject(new Error('cancelled')),
    );
  const cached = loadDecodedCover(thumbnail);
  requests[0]!.resolve({ uri: thumbnail, width: 256, height: 256 });
  await cached.promise;
  cached.release();
  requests = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  clearDecodedCoverCache();
});

async function mount() {
  await act(async () => {
    renderer = Renderer.create(
      <OrderedRemoteCover
        uris={candidates}
        resolution="player"
        priority="player"
        fallbackWhileLoading
        testID="song-cover"
        style={{ width: 300, height: 300 }}
      />,
    );
  });
}

test('cached list thumbnail stays visible while the first player-size candidate loads and replaces it', async () => {
  await mount();
  expect(remote()!.props.source.uri).toBe(thumbnail);
  expect(requests.map(request => request.uri)).toEqual([candidates[0]]);
  await act(async () =>
    requests[0]!.resolve({ uri: candidates[0]!, width: 1000, height: 1000 }),
  );
  expect(remote()!.props.source.uri).toBe(candidates[0]);
});

test('cached preview display failure does not consume or cancel the pending high-resolution request', async () => {
  await mount();
  await act(async () => remote()!.props.onError());
  expect(requests.map(request => request.uri)).toEqual([candidates[0]]);
  expect(native.cancel).not.toHaveBeenCalled();
  await act(async () =>
    requests[0]!.resolve({ uri: candidates[0]!, width: 1000, height: 1000 }),
  );
  expect(remote()!.props.source.uri).toBe(candidates[0]);
});

test('failed large candidates retain the cached thumbnail as the final usable fallback', async () => {
  await mount();
  for (const candidate of candidates.slice(0, -1)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = requests.at(-1)!;
      expect(request.uri).toBe(candidate);
      await act(async () => request.reject(new Error('Artwork unavailable')));
    }
  }
  expect(remote()!.props.source.uri).toBe(thumbnail);
  expect(requests).toHaveLength((candidates.length - 1) * 2);
});

test('a late thumbnail display error cannot clear the high-resolution cover after it loads', async () => {
  await mount();
  const latePreviewError = remote()!.props.onError;
  await act(async () =>
    requests[0]!.resolve({ uri: candidates[0]!, width: 1000, height: 1000 }),
  );
  await act(async () => latePreviewError());
  expect(remote()!.props.source.uri).toBe(candidates[0]);
});

test('an already cached first player candidate does not trigger another network request', async () => {
  const cached = loadDecodedCover(candidates[0]!);
  requests[0]!.resolve({ uri: candidates[0]!, width: 1000, height: 1000 });
  await cached.promise;
  cached.release();
  requests = [];
  await mount();
  expect(remote()!.props.source.uri).toBe(candidates[0]);
  expect(requests).toHaveLength(0);
});

test('ordinary thumbnail surfaces retain their existing cache-first behavior', async () => {
  await act(async () => {
    renderer = Renderer.create(
      <OrderedRemoteCover
        uris={[candidates[0], thumbnail]}
        fallbackWhileLoading
        testID="song-cover"
        style={{ width: 52, height: 52 }}
      />,
    );
  });
  expect(remote()!.props.source.uri).toBe(thumbnail);
  expect(requests).toHaveLength(0);
});
