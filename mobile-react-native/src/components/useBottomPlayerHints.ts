import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';

export const bottomPlayerHintBits = {
  hide: 1,
  show: 2,
  previous: 4,
  next: 8,
} as const;
export type BottomPlayerHint = keyof typeof bottomPlayerHintBits;
type HintStorage = {
  loadBottomPlayerHints: () => Promise<number>;
  learnBottomPlayerHint: (hint: BottomPlayerHint) => Promise<number>;
};
const storage = () => NativeModules.LiuliuStorage as HintStorage | undefined;
const validMask = (mask: number) => (Number.isInteger(mask) ? mask & 15 : 0);
const hintOrder: BottomPlayerHint[] = ['next', 'previous', 'hide', 'show'];

/** Installation-scoped tutorial flags are independent from music/user state. */
export function useBottomPlayerHints(
  trackIdentity: string | null,
  playing: boolean,
) {
  const [learnedMask, setLearnedMask] = useState<number | null>(null);
  const sessionMask = useRef(0);
  const mounted = useRef(true);
  const navigation = useRef<{
    hint: 'next' | 'previous';
    origin: string;
    complete: boolean;
  } | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const native = storage();
    const loading = native?.loadBottomPlayerHints
      ? native.loadBottomPlayerHints()
      : Promise.resolve(0);
    loading
      .then(mask => {
        if (active) setLearnedMask(validMask(mask) | sessionMask.current);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  const learn = useCallback((hint: BottomPlayerHint) => {
    const bit = bottomPlayerHintBits[hint];
    sessionMask.current |= bit;
    setLearnedMask(current => (current === null ? null : current | bit));
    const native = storage();
    if (native?.learnBottomPlayerHint) {
      void native
        .learnBottomPlayerHint(hint)
        .then(mask => {
          sessionMask.current |= validMask(mask);
          if (mounted.current)
            setLearnedMask(current =>
              current === null ? null : current | sessionMask.current,
            );
        })
        .catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const pending = navigation.current;
    if (!pending?.complete) return;
    navigation.current = null;
    // Public navigation may resolve on an empty queue or exhausted failures.
    // Observe its committed result, without selecting or resolving any song.
    if (trackIdentity && trackIdentity !== pending.origin && playing)
      learn(pending.hint);
  }, [trackIdentity, playing, navigationRevision, learn]);
  const navigate = (hint: 'next' | 'previous', action: () => Promise<void>) => {
    const pending = trackIdentity
      ? { hint, origin: trackIdentity, complete: false }
      : null;
    navigation.current = pending;
    void action()
      .then(() => {
        if (!mounted.current || !pending || navigation.current !== pending)
          return;
        pending.complete = true;
        setNavigationRevision(value => value + 1);
      })
      .catch(() => {
        if (navigation.current === pending) navigation.current = null;
      });
  };
  const currentHint =
    learnedMask === null
      ? null
      : hintOrder.find(hint => !(learnedMask & bottomPlayerHintBits[hint]));
  return {
    learn,
    navigate,
    visible: (hint: BottomPlayerHint) => currentHint === hint,
  };
}
