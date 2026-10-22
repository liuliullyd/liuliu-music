import { NativeModules } from 'react-native';

export type DecodedCover = { uri: string; width: number; height: number };
type NativeCover = {
  load: (uri: string, id: string) => Promise<DecodedCover>;
  cancel: (id: string) => void;
};
const native = NativeModules.LiuliuCover as NativeCover | undefined;
const pending = new Map<
  string,
  { promise: Promise<DecodedCover>; id: string; users: number }
>();
const success = new Map<string, DecodedCover>();
let cacheGeneration = 0;
const listeners = new Map<string, Set<(cover: DecodedCover) => void>>();
let nextId = 1;
export const COVER_REQUEST_TIMEOUT_MS = 12000;

export const getDecodedCover = (uri: string) => success.get(uri);

/** Coalesces only artwork; it never resolves audio or touches the player. */
export function loadDecodedCover(uri: string) {
  const cached = success.get(uri);
  if (cached)
    return { promise: Promise.resolve(cached), release: () => undefined };
  let entry = pending.get(uri);
  if (!entry) {
    const generation = cacheGeneration;
    const id = String(nextId++);
    let timer: ReturnType<typeof setTimeout>;
    const request = native
      ? native.load(uri, id)
      : Promise.reject(new Error('Native artwork loader unavailable'));
    const timeout = new Promise<DecodedCover>((_, reject) => {
      timer = setTimeout(() => {
        native?.cancel(id);
        reject(new Error('Artwork request timed out'));
      }, COVER_REQUEST_TIMEOUT_MS);
    });
    const promise = Promise.race([request, timeout])
      .then(result => {
        if (result.width <= 0 || result.height <= 0)
          throw new Error('Artwork has no decoded pixels');
        if (generation === cacheGeneration) success.set(uri, result);
        if (success.size > 256) success.delete(success.keys().next().value!);
        listeners.get(uri)?.forEach(listener => listener(result));
        return result;
      })
      .finally(() => {
        clearTimeout(timer!);
        if (pending.get(uri)?.id === id) pending.delete(uri);
      });
    entry = { promise, id, users: 0 };
    pending.set(uri, entry);
  }
  const current = entry;
  current.users++;
  let released = false;
  return {
    promise: current.promise,
    release: () => {
      if (released) return;
      released = true;
      current.users--;
      if (current.users === 0 && pending.get(uri) === current) {
        pending.delete(uri);
        native?.cancel(current.id);
      }
    },
  };
}

export function invalidateDecodedCover(uri: string) {
  success.delete(uri);
}

/** Clear decoded artwork values without cancelling views that are loading now. */
export function clearDecodedCoverCache() {
  cacheGeneration += 1;
  success.clear();
}

/** A visible view can consume a batch request immediately without waiting for its own queue turn. */
export function subscribeDecodedCover(
  uri: string,
  callback: (cover: DecodedCover) => void,
) {
  const group = listeners.get(uri) ?? new Set();
  group.add(callback);
  listeners.set(uri, group);
  let active = true;
  const cached = success.get(uri);
  if (cached)
    Promise.resolve().then(() => {
      if (active) callback(cached);
    });
  return () => {
    active = false;
    group.delete(callback);
    if (!group.size) listeners.delete(uri);
  };
}
