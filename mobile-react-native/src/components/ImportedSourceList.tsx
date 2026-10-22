import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SourceSetting } from '../domain/types';
import { useLayout } from '../state/LayoutContext';
import { useTheme } from '../theme';
import { sourceDisplayName } from '../services/sourcePolicy';

type RowLayout = { y: number; height: number };
type Drag = {
  id: string;
  index: number;
  target: number;
  ids: string[];
  rows: RowLayout[];
  startPageY: number;
  pageY: number;
  scrollDistance: number;
  delta: number;
};

/** Settings-only drag preview; the persisted order changes once, on release. */
export function ImportedSourceList({
  sources,
  disabled,
  onReorder,
  onDraggingChange,
  scrollDuringDrag,
  renderSource,
}: {
  sources: SourceSetting[];
  disabled: boolean;
  onReorder: (ids: string[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  scrollDuringDrag: (pageY: number) => number;
  renderSource: (
    source: SourceSetting,
    handle: React.ReactNode,
  ) => React.ReactNode;
}) {
  const { scale } = useLayout();
  const theme = useTheme();
  const layouts = useRef<Record<string, RowLayout>>({});
  const drag = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const callbacks = useRef({ onReorder, onDraggingChange, scrollDuringDrag });
  callbacks.current = { onReorder, onDraggingChange, scrollDuringDrag };
  const signature = sources.map(source => source.id).join('\n');

  const clearDrag = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    drag.current = null;
    setPreview(null);
    callbacks.current.onDraggingChange(false);
  };
  useEffect(() => {
    if (drag.current) clearDrag();
    // An import or deletion cancels an old gesture instead of saving stale IDs.
  }, [signature, scale]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (drag.current) callbacks.current.onDraggingChange(false);
    },
    [],
  );

  const updateDrag = (pageY: number) => {
    const active = drag.current;
    if (!active || !Number.isFinite(pageY)) return;
    active.pageY = pageY;
    const origin = active.rows[active.index]!;
    const originCenter = origin.y + origin.height / 2;
    const first = active.rows[0]!;
    const last = active.rows[active.rows.length - 1]!;
    const delta = (pageY - active.startPageY) / scale + active.scrollDistance;
    active.delta = Math.max(
      first.y + first.height / 2 - originCenter,
      Math.min(last.y + last.height / 2 - originCenter, delta),
    );
    const center = originCenter + active.delta;
    active.target = active.index;
    active.rows.forEach((row, index) => {
      const rowCenter = row.y + row.height / 2;
      if (index < active.index && center <= rowCenter)
        active.target = Math.min(active.target, index);
      if (index > active.index && center >= rowCenter)
        active.target = Math.max(active.target, index);
    });
    setPreview({ ...active });
  };
  const beginDrag = (id: string, pageY: number) => {
    if (disabled || sources.length < 2 || !Number.isFinite(pageY)) return;
    const rows = sources.map(source => layouts.current[source.id]);
    if (rows.some(row => !row || row.height <= 0)) return;
    clearDrag();
    const index = sources.findIndex(source => source.id === id);
    if (index < 0) return;
    drag.current = {
      id,
      index,
      target: index,
      ids: sources.map(source => source.id),
      rows: rows as RowLayout[],
      startPageY: pageY,
      pageY,
      scrollDistance: 0,
      delta: 0,
    };
    setPreview({ ...drag.current });
    callbacks.current.onDraggingChange(true);
    timer.current = setInterval(() => {
      const active = drag.current;
      if (!active) return;
      const moved = callbacks.current.scrollDuringDrag(active.pageY);
      if (moved) {
        active.scrollDistance += moved;
        updateDrag(active.pageY);
      }
    }, 60);
  };
  const finishDrag = () => {
    const active = drag.current;
    if (!active) return;
    clearDrag();
    if (active.index === active.target || active.ids.join('\n') !== signature)
      return;
    const ids = [...active.ids];
    ids.splice(active.index, 1);
    ids.splice(active.target, 0, active.id);
    callbacks.current.onReorder(ids);
  };

  return (
    <View testID="imported-source-list">
      {sources.map((source, index) => {
        let translateY = 0;
        if (preview) {
          const height = preview.rows[preview.index]!.height;
          if (index === preview.index) translateY = preview.delta;
          else if (index > preview.index && index <= preview.target)
            translateY = -height;
          else if (index < preview.index && index >= preview.target)
            translateY = height;
        }
        const active = preview?.id === source.id;
        const handle = (
          <Pressable
            testID={`drag-source-${source.id}`}
            accessibilityRole="button"
            accessibilityLabel={`拖动${sourceDisplayName(source)}排序`}
            accessibilityHint="长按后上下拖动，松手保存顺序"
            disabled={disabled || sources.length < 2}
            delayLongPress={250}
            onLongPress={event => beginDrag(source.id, event.nativeEvent.pageY)}
            style={styles.handle}
          >
            <Text style={[styles.handleText, { color: theme.muted }]}>≡</Text>
          </Pressable>
        );
        return (
          <View
            key={source.id}
            testID="imported-source"
            onLayout={event => {
              layouts.current[source.id] = event.nativeEvent.layout;
            }}
            onTouchMove={event => updateDrag(event.nativeEvent.pageY)}
            onTouchEnd={finishDrag}
            onTouchCancel={() => {
              if (drag.current) clearDrag();
            }}
            style={[
              styles.row,
              { transform: [{ translateY }] },
              active && [styles.draggingRow, { backgroundColor: theme.panel }],
            ]}
          >
            {renderSource(source, handle)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { zIndex: 0 },
  draggingRow: { zIndex: 1, borderRadius: 10 },
  handle: {
    // Keep the grip inside the content canvas, clear of the shell's back gesture.
    marginLeft: 16,
    width: 28,
    minHeight: 40,
    justifyContent: 'center',
  },
  handleText: { fontSize: 23 },
});
