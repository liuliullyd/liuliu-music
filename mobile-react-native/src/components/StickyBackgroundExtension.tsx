import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, PixelRatio, StyleSheet, View } from 'react-native';

type Opacity = number | Animated.Value | Animated.AnimatedInterpolation<number>;
type Background = {
  owner: object;
  scope: string;
  color: string;
  opacity: Opacity;
  drawer?: {
    translateX: Animated.Value;
    scale: number;
    width: `${number}%`;
    shade: string;
  };
};
type ContextValue = {
  scope: string;
  background: Background | null;
  enabled: boolean;
  publish: (background: Background) => void;
  release: (owner: object, scope: string) => void;
};
const Context = createContext<ContextValue>({
  scope: '',
  background: null,
  enabled: false,
  publish: () => undefined,
  release: () => undefined,
});

/** Only the visible page's existing sticky background can extend outside its scroller. */
export function StickyBackgroundProvider({
  scope,
  enabled = true,
  children,
}: {
  scope: string;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [background, setBackground] = useState<Background | null>(null);
  const publish = useCallback((next: Background) => {
    if (next.scope !== activeScope.current) return;
    setBackground(previous => {
      if (previous?.scope === next.scope && previous.drawer && !next.drawer)
        return previous;
      return previous?.owner === next.owner &&
        previous.scope === next.scope &&
        previous.color === next.color &&
        previous.opacity === next.opacity &&
        previous.drawer === next.drawer
        ? previous
        : next;
    });
  }, []);
  const release = useCallback((owner: object, previousScope: string) => {
    setBackground(previous =>
      previous?.owner === owner && previous.scope === previousScope
        ? null
        : previous,
    );
  }, []);
  const value = useMemo(
    () => ({ scope, enabled, background, publish, release }),
    [scope, enabled, background, publish, release],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function StickyBackgroundExtension({
  active,
  color,
  opacity = 1,
}: {
  active: boolean;
  color: string;
  opacity?: Opacity;
}) {
  const { scope, publish, release } = useContext(Context);
  const owner = useRef({}).current;
  useLayoutEffect(() => {
    if (!active) return;
    publish({ owner, scope, color, opacity });
    return () => release(owner, scope);
  }, [active, color, opacity, owner, scope, publish, release]);
  return null;
}

export function StickyBackgroundViewport({ inset }: { inset: number }) {
  const { background, scope, enabled } = useContext(Context);
  const drawer = background?.drawer;
  const translateX = useMemo(
    () => (drawer ? Animated.multiply(drawer.translateX, drawer.scale) : null),
    [drawer],
  );
  if (!enabled || inset <= 0 || !background || background.scope !== scope)
    return null;
  if (drawer && translateX)
    return (
      <View
        testID="home-menu-status-background"
        pointerEvents="none"
        accessible={false}
        style={[styles.extension, styles.menuExtension, { height: inset }]}
      >
        <Animated.View
          testID="home-menu-status-shade"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: drawer.shade, opacity: background.opacity },
          ]}
        />
        <Animated.View
          testID="home-menu-status-panel"
          pointerEvents="none"
          style={[
            styles.drawer,
            {
              // Join the scaled drawer by one physical pixel. Keep the scrim
              // at the inset so its translucent edge is never painted twice.
              bottom: -1 / PixelRatio.get(),
              width: drawer.width,
              backgroundColor: background.color,
              transform: [{ translateX }],
            },
          ]}
        />
      </View>
    );
  return (
    <Animated.View
      testID="sticky-background-extension"
      pointerEvents="none"
      accessible={false}
      style={[
        styles.extension,
        {
          height: inset,
          backgroundColor: background.color,
          opacity: background.opacity,
        },
      ]}
    />
  );
}

/** The drawer and its top extension share the exact same native animation nodes. */
export function MenuBackgroundExtension({
  color,
  shade,
  translateX,
  opacity,
  scale,
  width,
}: {
  color: string;
  shade: string;
  translateX: Animated.Value;
  opacity: Animated.Value;
  scale: number;
  width: `${number}%`;
}) {
  const { scope, publish, release } = useContext(Context);
  const owner = useRef({}).current;
  const drawer = useMemo(
    () => ({ translateX, scale, width, shade }),
    [translateX, scale, width, shade],
  );
  useLayoutEffect(() => {
    publish({ owner, scope, color, opacity, drawer });
    return () => release(owner, scope);
  }, [color, drawer, opacity, owner, scope, publish, release]);
  return null;
}

const styles = StyleSheet.create({
  extension: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  menuExtension: { overflow: 'visible' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
