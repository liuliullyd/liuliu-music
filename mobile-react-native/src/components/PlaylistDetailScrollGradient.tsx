import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { PlaylistInformationTopGradient } from './PlaylistInformationSurface';

/** The New Releases detail contract: viewport before sticking, toolbar after. */
export function usePlaylistDetailScrollGradient(identity: string) {
  const geometry = useRef({ identity, threshold: null as number | null, offset: 0 });
  const [phase, setPhase] = useState({ identity, stuck: false });
  if (geometry.current.identity !== identity)
    geometry.current = { identity, threshold: null, offset: 0 };
  const update = useCallback(() => {
    const current = geometry.current;
    const stuck = current.threshold !== null && current.offset >= current.threshold;
    setPhase(previous => previous.identity === current.identity && previous.stuck === stuck
      ? previous : { identity: current.identity, stuck });
  }, []);
  const onStickyLayout = useCallback((event: LayoutChangeEvent) => {
    if (geometry.current.identity !== identity) return;
    geometry.current.threshold = event.nativeEvent.layout.y;
    update();
  }, [identity, update]);
  const onScroll = useCallback((offset: number) => {
    if (geometry.current.identity !== identity) return;
    geometry.current.offset = Math.max(0, offset);
    update();
  }, [identity, update]);
  return { stuck: phase.identity === identity && phase.stuck, onStickyLayout, onScroll };
}

export function PlaylistDetailGradientViewport({ stuck }: { stuck: boolean }) {
  return (
    <View testID="playlist-detail-top-gradient-viewport" pointerEvents="none"
      style={[s.viewport, stuck && s.hidden]}>
      <PlaylistInformationTopGradient />
    </View>
  );
}
const s = StyleSheet.create({
  viewport: { position: 'absolute', top: 0, left: 0, right: 0, height: 80, zIndex: 10, elevation: 1 },
  hidden: { opacity: 0 },
});
