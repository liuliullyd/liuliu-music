import React from 'react';
import type { ScrollViewProps } from 'react-native';
import type { CoverKey } from '../domain/types';
import { useApp } from '../state/AppContext';
import { HomePlaylistDetail } from './HomePlaylistDetail';

/** History retains its filters/pagination/actions inside the actual Home frame. */
export function RecentPlaybackDetail({
  title,
  count,
  cover,
  coverCandidates = [],
  coverKey = 'vinyl',
  actions,
  filters,
  children,
  onScrollOffset,
  onScroll,
  onLayout,
  onControlsLayout,
  onTrackListLayout,
  identity = 'recent-playback-detail',
}: {
  title: string;
  count: string;
  cover?: string;
  coverCandidates?: string[];
  coverKey?: CoverKey;
  actions: React.ReactNode;
  filters: React.ReactNode;
  children: React.ReactNode;
  onScrollOffset?: (offset: number) => void;
  onScroll?: ScrollViewProps['onScroll'];
  onLayout?: ScrollViewProps['onLayout'];
  onControlsLayout?: ScrollViewProps['onLayout'];
  onTrackListLayout?: ScrollViewProps['onLayout'];
  identity?: string;
}) {
  const app = useApp();
  return (
    <HomePlaylistDetail
      identity={identity}
      rootTestID="recent-playback-detail"
      scrollTestID="library-history"
      coverTestID="recent-playback-cover"
      titleTestID="recent-playback-title"
      controlsTestID="library-list-controls"
      title={title}
      subtitle={count}
      cover={cover}
      coverCandidates={coverCandidates}
      coverKey={coverKey}
      libraryArtwork
      insetList
      onBack={app.back}
      actions={actions}
      filters={filters}
      onScrollOffset={onScrollOffset}
      onScroll={onScroll}
      onLayout={onLayout}
      onControlsLayout={onControlsLayout}
      onTrackListLayout={onTrackListLayout}
    >
      {children}
    </HomePlaylistDetail>
  );
}
