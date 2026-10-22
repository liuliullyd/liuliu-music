import React from 'react';
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  type NativeScrollEvent,
} from 'react-native';
import { useTheme } from '../theme';

export const reachedListBottom = (event: NativeScrollEvent) =>
  event.contentOffset.y > 0 &&
  event.layoutMeasurement.height + event.contentOffset.y >=
    event.contentSize.height - 24;

export const nearListBottom = (event: NativeScrollEvent, threshold = 120) =>
  event.contentOffset.y >= 0 &&
  event.layoutMeasurement.height + event.contentOffset.y >=
    event.contentSize.height - threshold;

/** Start pagination early enough that the next page is ready before release. */
export const prefetchListBottom = (event: NativeScrollEvent) =>
  nearListBottom(event, Math.max(640, event.layoutMeasurement.height * 1.5));

export const reachedListEnd = (event: NativeScrollEvent) =>
  event.contentOffset.x > 0 &&
  event.layoutMeasurement.width + event.contentOffset.x >=
    event.contentSize.width - 24;

export function ListPagingFooter({
  loading,
  hasMore,
  error,
  onRetry,
}: {
  loading: boolean;
  hasMore: boolean;
  error: string;
  onRetry: () => Promise<void>;
}) {
  const c = useTheme();
  return (
    <View style={s.footer}>
      {error ? (
        <Pressable
          testID="list-page-retry"
          accessibilityRole="button"
          onPress={onRetry}
          style={s.retry}
        >
          <Text style={{ color: c.blue }}>加载失败，点击重试</Text>
        </Pressable>
      ) : (
        <Text style={[s.text, { color: c.muted }]}>
          {loading ? '加载中…' : hasMore ? '上滑加载更多' : '已加载全部'}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  footer: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  retry: { minHeight: 44, justifyContent: 'center' },
  text: { fontSize: 12 },
});
