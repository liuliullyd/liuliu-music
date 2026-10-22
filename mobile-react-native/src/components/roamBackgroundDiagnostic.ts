import { TurboModuleRegistry, type Animated, type TurboModule } from 'react-native';
import type { ThemeId } from '../theme';

// Temporary, user-approved diagnosis of Library root/history background recovery.
// Reads existing nodes only: no listeners, node creation, animation stops or setters.
type ExistingAnimatedValue = Animated.Value & {
  __getValue: () => number;
  __nativeTag?: number;
  __isNative?: boolean;
};
type Scene = {
  page: 'root' | 'history';
  theme: ThemeId;
  visible: boolean;
  scrollScale: number;
  scrollY?: Animated.Value;
};
type NativeAnimatedReader = TurboModule & {
  getValue: (tag: number, callback: (value: number) => void) => void;
};

let scene: (Scene & { generation: number }) | null = null;
let generation = 0;
let sequence = 0;
let lastScrollSample = 0;

export function setRoamBackgroundDiagnosticScene(next: Scene | null) {
  scene = next ? { ...next, generation: ++generation } : null;
  lastScrollSample = 0;
}

export function traceRoamBackground(
  event: string,
  details: Record<string, unknown> = {},
  readNative = false,
) {
  const snapshot = scene;
  if (!snapshot) return;
  const value = snapshot.scrollY as ExistingAnimatedValue | undefined;
  const request = ++sequence;
  const record = {
    sequence: request,
    generation: snapshot.generation,
    page: snapshot.page,
    theme: snapshot.theme,
    visible: snapshot.visible,
    scrollScale: snapshot.scrollScale,
    jsScrollY: value?.__getValue(),
    nativeTag: value?.__nativeTag ?? null,
    isNative: value?.__isNative ?? false,
  };
  console.info('[RoamBackgroundDiagnostic]', JSON.stringify({ event, ...record, ...details }));
  if (!readNative || value?.__nativeTag == null) return;
  const native = TurboModuleRegistry.get<NativeAnimatedReader>('NativeAnimatedModule')
    ?? TurboModuleRegistry.get<NativeAnimatedReader>('NativeAnimatedTurboModule');
  if (!native?.getValue) return;
  try {
    native.getValue(value.__nativeTag, nativeScrollY => {
      console.info('[RoamBackgroundDiagnostic]', JSON.stringify({
        event: 'native-value',
        sampledFor: event,
        ...record,
        nativeScrollY,
        translatedY: -Math.max(0, nativeScrollY) * snapshot.scrollScale,
        stale: scene?.generation !== snapshot.generation,
      }));
    });
  } catch {
    console.info('[RoamBackgroundDiagnostic]', JSON.stringify({ event: 'native-read-unavailable', ...record }));
  }
}

export function traceRoamHistoryScroll(offset: number) {
  if (scene?.page !== 'history') return;
  const now = Date.now();
  if (offset !== 0 && now - lastScrollSample < 500) return;
  lastScrollSample = now;
  traceRoamBackground('history-scroll', { historyOffset: offset }, true);
}
