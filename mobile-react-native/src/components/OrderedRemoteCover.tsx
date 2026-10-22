import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  StyleSheet,
  View,
  type ImageProps,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { normalizeCoverUri, type CoverResolution } from './homeCover';
import { createHomeTimingTrace } from '../services/homeTiming';
import {
  loadDecodedCover,
  subscribeDecodedCover,
  invalidateDecodedCover,
  getDecodedCover,
  COVER_REQUEST_TIMEOUT_MS,
} from '../services/coverLoading';

type QueueEntry = {
  owner: OrderedCoverQueue;
  moduleKey: string;
  priority?: CoverPriority;
  retry?: boolean;
  visualOrder?: readonly [number, number];
  start: () => void;
  pause: () => void;
  started: boolean;
};

let nextCoverRequestId = 1;
export type CoverPriority = 'visible' | 'preload' | 'player';
export const PAGE_COVER_CONCURRENCY = 6;

/** One process-wide budget, including nested scopes and unscoped covers. */
class CoverScheduler {
  private entries = new Map<QueueEntry, { order: number; active: boolean }>();
  private exclusiveOwners = new Set<OrderedCoverQueue>();
  private order = 0;
  private pumpPending = false;

  register(entry: QueueEntry, active: boolean) {
    this.entries.set(entry, { order: this.order++, active });
    this.pump();
  }

  remove(entry: QueueEntry, pause = false) {
    if (!this.entries.delete(entry)) return;
    if (pause && entry.started) entry.pause();
    this.pump();
  }

  activate(entry: QueueEntry, active: boolean) {
    const state = this.entries.get(entry);
    if (!state) return;
    state.active = active;
    if ((!active || !this.canStart(entry)) && entry.started) {
      entry.started = false;
      entry.pause();
    }
  }

  private canStart(entry: QueueEntry) {
    const owner = [...this.exclusiveOwners].at(-1);
    return !owner || owner === entry.owner || entry.priority === 'player';
  }

  setExclusive(owner: OrderedCoverQueue, active: boolean) {
    if (active) this.exclusiveOwners.add(owner);
    else this.exclusiveOwners.delete(owner);
    for (const [entry, state] of this.entries)
      this.activate(entry, state.active);
    this.pump();
  }

  pump() {
    if (this.pumpPending) return;
    this.pumpPending = true;
    // Let the current React effect/cleanup batch finish before admission:
    // cancelled offscreen entries must not briefly start as siblings unmount.
    void Promise.resolve().then(() => {
      this.pumpPending = false;
      this.drain();
    });
  }

  private drain() {
    const all = [...this.entries.entries()];
    const rank = (entry: QueueEntry) => (entry.retry ? 1 : 0);
    for (const player of [true, false]) {
      const group = all.filter(
        ([entry]) => (entry.priority === 'player') === player,
      );
      let slots =
        (player ? 1 : PAGE_COVER_CONCURRENCY) -
        group.filter(([entry]) => entry.started).length;
      const pending = group
        .filter(
          ([entry, state]) =>
            state.active && !entry.started && this.canStart(entry),
        )
        .sort(
          ([a, sa], [b, sb]) =>
            rank(a) - rank(b) ||
            (a.visualOrder?.[0] ?? Number.MAX_SAFE_INTEGER) -
              (b.visualOrder?.[0] ?? Number.MAX_SAFE_INTEGER) ||
            (a.visualOrder?.[1] ?? 0) - (b.visualOrder?.[1] ?? 0) ||
            sa.order - sb.order,
        );
      for (const [entry] of pending) {
        if (slots-- <= 0) break;
        entry.started = true;
        entry.start();
      }
    }
  }
}

const sharedCoverScheduler = new CoverScheduler();

/** A stalled image connection must not hold a catalog card in a neutral state forever. */
export const ORDERED_COVER_ATTEMPT_TIMEOUT_MS = COVER_REQUEST_TIMEOUT_MS;

/**
 * A scope owns cancellation and generation, never its own concurrency budget.
 * Actual native image completion/cancellation releases a shared slot.
 */
export class OrderedCoverQueue {
  private active: boolean;
  private readonly entries = new Map<number, QueueEntry>();

  constructor(
    active = false,
    readonly generationKey: string | number = 'default',
    private readonly exclusive = false,
  ) {
    this.active = active;
  }

  enqueue(id: number, entry: Omit<QueueEntry, 'started' | 'owner'>) {
    this.unregister(id);
    const queued: QueueEntry = { ...entry, owner: this, started: false };
    this.entries.set(id, queued);
    sharedCoverScheduler.register(queued, this.active);
    return () => this.unregister(id);
  }

  complete(id: number) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (entry) sharedCoverScheduler.remove(entry);
  }

  unregister(id: number) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    sharedCoverScheduler.remove(entry, true);
  }

  updatePriority(id: number, priority: CoverPriority) {
    const entry = this.entries.get(id);
    if (entry) entry.priority = priority;
    sharedCoverScheduler.pump();
  }

  updateOrder(id: number, visualOrder?: readonly [number, number]) {
    const entry = this.entries.get(id);
    if (entry) entry.visualOrder = visualOrder;
    sharedCoverScheduler.pump();
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    for (const entry of this.entries.values())
      sharedCoverScheduler.activate(entry, active);
    if (this.exclusive) sharedCoverScheduler.setExclusive(this, active);
    sharedCoverScheduler.pump();
  }

  dispose() {
    this.active = false;
    for (const entry of this.entries.values())
      sharedCoverScheduler.activate(entry, false);
    for (const entry of this.entries.values())
      sharedCoverScheduler.remove(entry);
    this.entries.clear();
    if (this.exclusive) sharedCoverScheduler.setExclusive(this, false);
  }
}

const OrderedCoverQueueContext = createContext<OrderedCoverQueue | null>(null);

export function OrderedCoverScope({
  active = true,
  generationKey,
  exclusive = false,
  children,
}: {
  active?: boolean;
  generationKey: string | number;
  /** A presented queue pauses artwork work in the page underneath it. */
  exclusive?: boolean;
  children: React.ReactNode;
}) {
  const queue = useMemo(
    () => new OrderedCoverQueue(false, generationKey, exclusive),
    [exclusive, generationKey],
  );
  useEffect(() => {
    queue.setActive(active);
  }, [active, queue]);
  useEffect(() => () => queue.dispose(), [queue]);
  return (
    <OrderedCoverQueueContext.Provider value={queue}>
      {children}
    </OrderedCoverQueueContext.Provider>
  );
}

function useOrderedCoverStart(
  enabled: boolean,
  requestKey: string,
  moduleKey: string,
  priority: CoverPriority,
  retry: boolean,
  visualOrder?: readonly [number, number],
) {
  const scopedQueue = useContext(OrderedCoverQueueContext);
  const ownQueue = useMemo(() => new OrderedCoverQueue(true), []);
  const queue = scopedQueue ?? ownQueue;
  const id = useRef(nextCoverRequestId++).current;
  const [startedKey, setStartedKey] = useState('');
  const activation = useRef(0);
  const priorityRef = useRef(priority);
  priorityRef.current = priority;
  const orderRef = useRef(visualOrder);
  orderRef.current = visualOrder;
  useEffect(() => () => ownQueue.dispose(), [ownQueue]);
  useEffect(() => {
    setStartedKey('');
    if (!enabled) return undefined;
    return queue.enqueue(id, {
      moduleKey,
      priority: priorityRef.current,
      retry,
      visualOrder: orderRef.current,
      start: () => {
        activation.current += 1;
        setStartedKey(requestKey);
      },
      pause: () => {
        activation.current += 1;
        setStartedKey('');
      },
    });
  }, [enabled, id, moduleKey, queue, requestKey, retry]);
  useEffect(() => queue.updatePriority(id, priority), [id, priority, queue]);
  const sectionOrder = visualOrder?.[0],
    itemOrder = visualOrder?.[1];
  useEffect(
    () =>
      queue.updateOrder(
        id,
        sectionOrder === undefined ? undefined : [sectionOrder, itemOrder ?? 0],
      ),
    [id, queue, sectionOrder, itemOrder],
  );
  const complete = useCallback(() => queue.complete(id), [id, queue]);
  const token = activation.current;
  const isCurrent = useCallback(() => activation.current === token, [token]);
  return { started: startedKey === requestKey, complete, isCurrent };
}

type OrderedRemoteCoverProps = {
  uris: Array<string | undefined>;
  /** Optional bundled artwork. Omit it for surfaces that intentionally use a themed blank slot. */
  fallback?: ImageSourcePropType;
  testID?: string;
  moduleKey?: string;
  visualOrder?: readonly [number, number];
  style: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMethod?: ImageProps['resizeMethod'];
  onExhausted?: () => void;
  onLoadedUri?: (uri: string) => void;
  onDecodedUri?: (uri: string) => void;
  /** False while the caller is still waiting for the remote item metadata. */
  fallbackReady?: boolean;
  /** Player artwork keeps its bundled image visible while a remote image loads. */
  fallbackWhileLoading?: boolean;
  priority?: CoverPriority;
  resolution?: CoverResolution;
};

export function OrderedRemoteCover(props: OrderedRemoteCoverProps) {
  const candidates = useMemo(
    () =>
      Array.from(
        new Set(
          props.uris
            .map(value =>
              normalizeCoverUri(String(value ?? ''), props.resolution),
            )
            .filter(value => /^https?:\/\//i.test(value)),
        ),
      ),
    [props.uris, props.resolution],
  );
  // A candidate change owns a fresh request lifetime, including for Cover users.
  // Old native callbacks must never consume the new item's retries or metadata.
  return (
    <OrderedRemoteCoverRequest
      key={candidates.join('|') || 'no-cover'}
      {...props}
      candidates={candidates}
    />
  );
}

function OrderedRemoteCoverRequest({
  candidates,
  fallback,
  testID,
  moduleKey = testID ?? 'page',
  visualOrder,
  style,
  imageStyle,
  resizeMethod,
  onExhausted,
  onLoadedUri,
  onDecodedUri,
  fallbackReady = true,
  fallbackWhileLoading = false,
  priority = 'visible',
  renderImage = true,
}: OrderedRemoteCoverProps & {
  candidates: string[];
  renderImage?: boolean;
}) {
  const c = useTheme();
  const timingGeneration = useContext(OrderedCoverQueueContext)?.generationKey;
  const sectionOrder = visualOrder?.[0];
  const itemOrder = visualOrder?.[1];
  const timing = useMemo(
    () =>
      typeof timingGeneration === 'string' &&
      timingGeneration.startsWith('home:') &&
      ((testID === 'home-playlist-cover' &&
        itemOrder !== undefined &&
        itemOrder < 2) ||
        (testID === 'home-release-cover' &&
          itemOrder !== undefined &&
          itemOrder < 6))
        ? createHomeTimingTrace(
            timingGeneration.slice(5),
            sectionOrder === 0 ? 'playlists' : 'new-releases',
          )
        : undefined,
    [timingGeneration, testID, sectionOrder, itemOrder],
  );
  const cachedIndex = fallbackWhileLoading
    ? candidates.findIndex(uri => getDecodedCover(uri))
    : -1;
  const [candidateIndex, setCandidateIndex] = useState(
    Math.max(0, cachedIndex),
  );
  const [attempt, setAttempt] = useState(0);
  const [loadedUri, setLoadedUri] = useState('');
  const cached =
    cachedIndex >= 0 ? getDecodedCover(candidates[cachedIndex]!) : undefined;
  const [decodedUri, setDecodedUri] = useState(
    cached ? candidates[cachedIndex]! : '',
  );
  const [displayUri, setDisplayUri] = useState(cached?.uri ?? '');
  const [failed, setFailed] = useState(false);
  const settledImageKey = useRef('');
  const mounted = useRef(true);
  const currentImageKey = useRef('');
  const exhaustedCallback = useRef(onExhausted);
  exhaustedCallback.current = onExhausted;
  const loadedCallback = useRef(onLoadedUri);
  loadedCallback.current = onLoadedUri;
  const decodedCallback = useRef(onDecodedUri);
  decodedCallback.current = onDecodedUri;
  const activeUri = candidates[candidateIndex] ?? '';
  // The native pipeline proves decoded readiness independently of the view.
  const ready = Boolean(activeUri && decodedUri === activeUri);
  const imageKey = `${activeUri}:${candidateIndex}:${attempt}`;
  const { started, complete, isCurrent } = useOrderedCoverStart(
    Boolean(activeUri && !ready && !failed),
    imageKey,
    moduleKey,
    priority,
    attempt > 0 || candidateIndex > 0,
    visualOrder,
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  currentImageKey.current = imageKey;
  useEffect(() => {
    if (!activeUri || failed || ready) return undefined;
    return subscribeDecodedCover(activeUri, cover => {
      if (!mounted.current || currentImageKey.current !== imageKey) return;
      setDisplayUri(cover.uri);
      setDecodedUri(activeUri);
      timing?.('cover-ready', {
        item: itemOrder ?? -1,
        path: 'subscription',
        attempt,
        candidate: candidateIndex,
      });
      complete();
    });
  }, [
    activeUri,
    complete,
    failed,
    imageKey,
    ready,
    timing,
    itemOrder,
    attempt,
    candidateIndex,
  ]);
  const failCurrentImage = useCallback(() => {
    if (
      !mounted.current ||
      !isCurrent() ||
      currentImageKey.current !== imageKey ||
      !activeUri ||
      settledImageKey.current === imageKey
    )
      return;
    settledImageKey.current = imageKey;
    invalidateDecodedCover(activeUri);
    setDecodedUri('');
    setLoadedUri('');
    // A failed attempt releases its slot before the retry joins the back of
    // pending visible work. Queue waiting never consumes the attempt timeout.
    complete();
    if (attempt === 0) {
      setAttempt(1);
      return;
    }
    if (candidateIndex < candidates.length - 1) {
      setCandidateIndex(value => value + 1);
      setAttempt(0);
      return;
    }
    setFailed(true);
    exhaustedCallback.current?.();
  }, [
    activeUri,
    attempt,
    candidateIndex,
    candidates.length,
    complete,
    imageKey,
    isCurrent,
  ]);

  useEffect(() => {
    if (!activeUri || failed || ready || !started) return undefined;
    let cancelled = false;
    timing?.('cover-admitted', {
      item: itemOrder ?? -1,
      attempt,
      candidate: candidateIndex,
    });
    const request = loadDecodedCover(activeUri);
    request.promise
      .then(cover => {
        if (
          cancelled ||
          !mounted.current ||
          !isCurrent() ||
          currentImageKey.current !== imageKey
        )
          return;
        setDisplayUri(cover.uri);
        setDecodedUri(activeUri);
        timing?.('cover-ready', {
          item: itemOrder ?? -1,
          path: 'request',
          attempt,
          candidate: candidateIndex,
        });
        complete();
      })
      .catch(() => {
        if (!cancelled) failCurrentImage();
      });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [
    activeUri,
    failed,
    failCurrentImage,
    ready,
    started,
    complete,
    imageKey,
    isCurrent,
    timing,
    itemOrder,
    attempt,
    candidateIndex,
  ]);

  useEffect(() => {
    if (ready && displayUri) decodedCallback.current?.(displayUri);
  }, [ready, displayUri, imageKey]);

  if (!renderImage) return null;
  return (
    <View
      testID={testID}
      style={[style, { overflow: 'hidden', backgroundColor: c.panelSoft }]}
    >
      {/* Pending, queued and retrying remote candidates always keep a neutral slot. */}
      {fallback &&
        fallbackReady &&
        (!activeUri || failed || fallbackWhileLoading) && (
          <Image
            testID={testID ? `${testID}-fallback` : undefined}
            source={fallback}
            style={[StyleSheet.absoluteFill, imageStyle]}
            resizeMethod={resizeMethod}
            resizeMode="cover"
          />
        )}
      {activeUri && !failed && ready ? (
        <Image
          key={imageKey}
          testID={testID ? `${testID}-remote` : undefined}
          source={{ uri: displayUri, cache: 'force-cache' }}
          fadeDuration={0}
          style={[StyleSheet.absoluteFill, imageStyle]}
          resizeMethod={resizeMethod}
          resizeMode="cover"
          onLoad={() => {
            if (
              !mounted.current ||
              currentImageKey.current !== imageKey ||
              settledImageKey.current === imageKey ||
              loadedUri === displayUri
            )
              return;
            settledImageKey.current = imageKey;
            setLoadedUri(displayUri);
            timing?.('cover-displayed', {
              item: itemOrder ?? -1,
              attempt,
              candidate: candidateIndex,
            });
            loadedCallback.current?.(displayUri);
          }}
          onError={failCurrentImage}
        />
      ) : null}
    </View>
  );
}

/** Registers already-fetched metadata, including virtualized rows, without mounting extra image views. */
export function OrderedCoverBatch({
  candidates,
  moduleKey,
  sectionOrder,
  resolution,
  priority = 'visible',
  onDecodedUri,
}: {
  candidates: Array<Array<string | undefined>>;
  moduleKey: string;
  sectionOrder?: number;
  resolution?: CoverResolution;
  priority?: CoverPriority;
  onDecodedUri?: (uri: string) => void;
}) {
  const seen = new Set<string>();
  return (
    <>
      {candidates.map((values, index) => {
        const normalized = Array.from(
          new Set(
            values
              .map(value => normalizeCoverUri(value ?? '', resolution))
              .filter(value => /^https?:\/\//i.test(value)),
          ),
        );
        const key = normalized.join('|');
        if (!key || seen.has(key)) return null;
        seen.add(key);
        return (
          <OrderedRemoteCoverRequest
            key={key}
            candidates={normalized}
            uris={normalized}
            fallback={0}
            style={{}}
            moduleKey={`${moduleKey}:${index}`}
            priority={priority}
            visualOrder={
              sectionOrder === undefined ? undefined : [sectionOrder, index]
            }
            renderImage={false}
            onDecodedUri={onDecodedUri}
          />
        );
      })}
    </>
  );
}
