import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { platformLabel, sourceSettingsText } from '../services/platformPresentation';
import { ImportedSourceList } from '../components/ImportedSourceList';
import { DesktopLyricsSettings } from '../components/DesktopLyricsSettings';
import { StickyPressable } from '../components/StickyPressable';
import { StickyBackgroundExtension } from '../components/StickyBackgroundExtension';
import { useStableNativeScrollEvent } from '../components/useStableNativeScrollEvent';
import { ThemeBrowser } from '../components/ThemeBrowser';
import { ThemeChoiceCard } from '../components/ThemeChoiceCard';
import { themeOptions } from '../themeCatalog';
import { playbackQualityOptions } from '../domain/types';
import type { PlatformSetting, SourceSetting } from '../domain/types';
import type { PlatformHealthResult } from '../services/liveDiscovery';
import { isSourceEnabled, sourceDisplayName } from '../services/sourcePolicy';
import {
  allCacheCleanupParts,
  type CacheCleanupPart,
} from '../services/storage';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { themeDefaultAccents, useTheme, type ThemePalette } from '../theme';

type SettingsSection = 'appearance' | 'playback' | 'desktop-lyrics' | 'sources' | 'data';
const sectionOptions: Array<{
  id: SettingsSection;
  title: string;
  copy: string;
}> = [
  { id: 'appearance', title: '外观主题', copy: '个性化界面' },
  { id: 'playback', title: '播放设置', copy: '播放与音质' },
  { id: 'desktop-lyrics', title: '桌面歌词', copy: '显示与锁定' },
  { id: 'sources', title: '音源', copy: '管理与导入' },
  { id: 'data', title: '数据管理', copy: '备份与清理' },
];
const sourceKeyByPlatform: Record<PlatformSetting['id'], string> = {
  netease: 'wy',
  qq: 'tx',
  kugou: 'kg',
  kuwo: 'kw',
  migu: 'mg',
  qishui: 'qs',
};

type AppVersionBridge = {
  getAppVersion?: () => Promise<string>;
};

async function readAndroidAppVersion(): Promise<string | null> {
  try {
    const value = await (
      NativeModules.LiuliuStorage as AppVersionBridge | undefined
    )?.getAppVersion?.();
    const version = typeof value === 'string' ? value.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

type SourcePlatformState = {
  label: string;
  style: 'pass' | 'fail' | 'pending' | 'unsupported';
};

export function sourcePlatformState(
  source: SourceSetting,
  platform: PlatformSetting,
  startupHealth: PlatformHealthResult | null,
): SourcePlatformState {
  const key = sourceKeyByPlatform[platform.id];
  const declared =
    source.capabilities?.includes(key) ||
    Boolean(source.sourceCapabilities?.[key]);
  if (!declared) return { label: '未声明', style: 'unsupported' };
  if (!platform.enabled) return { label: '已停用', style: 'unsupported' };
  // A fresh launch result is authoritative. Persisted manual checks are only
  // a fallback before the current launch has produced a result; otherwise an
  // old manual failure can incorrectly mask a newly passing source binding.
  if (startupHealth) {
    const health = startupHealth.byProvider[platform.id];
    const check = health?.checks.find(item => item.sourceId === source.id);
    if (!check) return { label: '未参与', style: 'pending' };
    if (!check.passed) return { label: '未通过', style: 'fail' };
    return {
      label:
        health?.selectedSourceId === source.id ? '通过·已绑定' : '通过·未绑定',
      style: 'pass',
    };
  }
  const manual = source.manualPlatformHealth?.[key];
  if (manual)
    return manual.passed
      ? { label: '通过·手动', style: 'pass' }
      : { label: '未通过·手动', style: 'fail' };
  return { label: '未检测', style: 'pending' };
}

export function SettingsScreen({
  backgroundScrollY,
}: {
  backgroundScrollY?: Animated.Value;
}) {
  const s = useSettingsStyles();
  const app = useApp();
  const layout = useLayout();
  const localScrollY = useRef(new Animated.Value(0)).current;
  const settingsScrollY = backgroundScrollY ?? localScrollY;
  useEffect(() => {
    settingsScrollY.setValue(0);
  }, [settingsScrollY]);
  const initial = sectionOptions.some(item => item.id === app.page)
    ? (app.page as SettingsSection)
    : 'appearance';
  const [section, setSection] = useState<SettingsSection>(initial);
  const scrollView = useRef<ScrollView>(null);
  const [sourceDragging, setSourceDragging] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const scrollPosition = useRef(0);
  const settingsScrollEvent = useStableNativeScrollEvent(
    settingsScrollY,
    event => { scrollPosition.current = event.nativeEvent.contentOffset.y; },
  );
  const scrollHeight = useRef(0);
  const contentHeight = useRef(0);
  const viewport = useRef({ top: 0, height: windowHeight });
  const scrollDuringDrag = (pageY: number) => {
    const top = viewport.current.top + 60 * layout.scale;
    const bottom =
      viewport.current.top + viewport.current.height - 96 * layout.scale;
    const step = pageY < top ? -12 : pageY > bottom ? 12 : 0;
    const next = Math.max(
      0,
      Math.min(
        Math.max(0, contentHeight.current - scrollHeight.current),
        scrollPosition.current + step,
      ),
    );
    const moved = next - scrollPosition.current;
    if (moved) {
      scrollPosition.current = next;
      scrollView.current?.scrollTo({ y: next, animated: false });
    }
    return moved;
  };
  const sectionOffsets = useRef<Partial<Record<SettingsSection, number>>>({});
  const sectionTabsHeight = useRef<number | null>(null);
  const [sectionTabsY, setSectionTabsY] = useState<number | null>(null);
  const pendingScroll = useRef<{
    section: SettingsSection;
    animated: boolean;
  } | null>(
    initial === 'appearance' ? null : { section: initial, animated: false },
  );
  const flushPendingSectionScroll = () => {
    const request = pendingScroll.current;
    if (!request || sectionTabsHeight.current === null) return;
    const y = sectionOffsets.current[request.section];
    if (y !== undefined && scrollView.current) {
      scrollView.current.scrollTo({
        y: Math.max(0, y - sectionTabsHeight.current),
        animated: request.animated,
      });
      pendingScroll.current = null;
    }
  };
  const scrollToSection = (target: SettingsSection, animated = true) => {
    setSection(target);
    const request = {
      section: target,
      animated:
        animated &&
        app.state.settings.motion !== 'off' &&
        !app.state.settings.reducedMotion,
    };
    pendingScroll.current = request;
    flushPendingSectionScroll();
  };
  const sectionTabsOpacity = useMemo(
    () =>
      sectionTabsY === null
        ? 0
        : settingsScrollY.interpolate({
            inputRange: [
              Math.max(0, sectionTabsY - 1),
              Math.max(1, sectionTabsY),
            ],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
    [sectionTabsY, settingsScrollY],
  );
  return (
    <Animated.ScrollView
      ref={scrollView}
      testID="settings-home"
      style={s.root}
      stickyHeaderIndices={[3]}
      removeClippedSubviews={false}
      scrollEnabled={!sourceDragging}
      onLayout={event => {
        scrollHeight.current = event.nativeEvent.layout.height;
        scrollView.current
          ?.getNativeScrollRef?.()
          ?.measureInWindow((_x, y, _width, height) => {
            viewport.current = { top: y, height };
          });
      }}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
      }}
      onScroll={settingsScrollEvent}
      scrollEventThrottle={16}
      contentContainerStyle={[
        s.content,
        {
          paddingHorizontal: layout.pageHorizontalPadding,
          paddingTop: layout.pageTopPadding,
          paddingBottom: layout.scrollBottomPadding,
        },
      ]}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <View testID="settings-header" style={s.header}>
        <Text style={s.pageTitle}>我的</Text>
      </View>
      <View testID="settings-music-intro" style={s.settingsIntro}>
        <Text style={s.settingsIntroTitle}>{'在音乐里\n遇见更好的自己'}</Text>
        <View style={s.settingsIntroFooter}>
          <Text style={s.settingsIntroScript}>{'Good\nMusic'}</Text>
          <Text style={s.settingsIntroCopy}>
            {'让每一首歌\n陪你度过每一个日常'}
          </Text>
        </View>
      </View>
      <View
        testID="settings-section-tabs-spacing"
        style={s.sectionTabsSpacing}
      />
      <View
        testID="settings-section-tabs"
        style={s.sectionTabs}
        onLayout={event => {
          sectionTabsHeight.current = event.nativeEvent.layout.height;
          setSectionTabsY(event.nativeEvent.layout.y);
          flushPendingSectionScroll();
        }}
      >
        <View testID="settings-section-tabs-row" style={s.sectionTabsRow}>
          <StickyBackgroundExtension active={sectionTabsY !== null}
            color={s.sectionTabsBacking.backgroundColor} opacity={sectionTabsOpacity} />
          <Animated.View
            testID="settings-section-tabs-backing"
            pointerEvents="none"
            style={[s.sectionTabsBacking, { opacity: sectionTabsOpacity }]}
          />
          {sectionOptions.map(item => (
            <StickyPressable
              key={item.id}
              testID={`settings-${item.id}`}
              accessibilityRole="tab"
              accessibilityLabel={item.title}
              accessibilityState={{ selected: section === item.id }}
              onPress={() => scrollToSection(item.id)}
              style={s.sectionTab}
            >
              <Text
                style={[
                  s.sectionTabText,
                  section === item.id && s.sectionTabTextActive,
                ]}
              >
                {item.title}
              </Text>
              <Text style={s.sectionTabCopy}>{item.copy}</Text>
              {section === item.id ? (
                <View
                  testID={`settings-${item.id}-indicator`}
                  style={s.sectionIndicator}
                />
              ) : null}
            </StickyPressable>
          ))}
        </View>
      </View>
      {sectionOptions.map(item => (
        <View
          key={item.id}
          testID={`settings-section-${item.id}`}
          onLayout={event => {
            sectionOffsets.current[item.id] = event.nativeEvent.layout.y;
            const request = pendingScroll.current;
            if (request?.section === item.id) {
              flushPendingSectionScroll();
            }
          }}
        >
          {item.id === 'appearance' ? <AppearancePanel /> : null}
          {item.id === 'playback' ? <PlaybackPanel /> : null}
          {item.id === 'desktop-lyrics' ? (
            <View testID="settings-desktop-lyrics-panel"><DesktopLyricsSettings /></View>
          ) : null}
          {item.id === 'sources' ? (
            <SourcesPanel
              dragging={sourceDragging}
              onDraggingChange={setSourceDragging}
              scrollDuringDrag={scrollDuringDrag}
            />
          ) : null}
          {item.id === 'data' ? <DataPanel /> : null}
        </View>
      ))}
    </Animated.ScrollView>
  );
}

function AppearancePanel() {
  const s = useSettingsStyles();
  const app = useApp();
  const [browseThemes, setBrowseThemes] = useState(false);
  return (
    <View testID="settings-appearance-panel">
      <Panel
        copy="选择你喜欢的视觉风格"
        compact={false}
        action={
          <Pressable
            testID="settings-themes-all"
            accessibilityRole="button"
            accessibilityLabel="查看全部主题"
            onPress={() => setBrowseThemes(true)}
            style={s.themeAllButton}
          >
            <Text style={s.themeAllText}>查看全部</Text>
            <Text style={s.themeAllArrow}>›</Text>
          </Pressable>
        }
      >
        <FlatList
          testID="settings-theme-grid"
          horizontal
          data={themeOptions}
          keyExtractor={item => item.id}
          extraData={app.state.settings.theme}
          initialNumToRender={10}
          maxToRenderPerBatch={6}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.themeGrid}
          renderItem={({ item }) => (
            <ThemeChoiceCard
              option={item}
              selected={app.state.settings.theme === item.id}
              onSelect={() => {
                app.setSetting('theme', item.id);
                app.setSetting('accent', themeDefaultAccents[item.id]);
              }}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      </Panel>
      {browseThemes ? (
        <ThemeBrowser onClose={() => setBrowseThemes(false)} />
      ) : null}
    </View>
  );
}

function PlaybackPanel() {
  const s = useSettingsStyles();
  const app = useApp();
  const timerLabel =
    app.player.sleepMode === 'off'
      ? '未设置'
      : app.player.sleepMode === 'track'
      ? '本曲结束后'
      : `${Math.max(
          1,
          Math.ceil(((app.player.sleepDeadline ?? 0) - Date.now()) / 60000),
        )} 分钟后`;
  return (
    <View testID="settings-playback-panel">
      <Panel>
        <SwitchRow
          title="自动播放下一首"
          copy="当前歌曲结束后继续播放队列"
          value={app.state.settings.autoNext}
          onPress={() =>
            app.setSetting('autoNext', !app.state.settings.autoNext)
          }
        />
        <SwitchRow
          title="启动时自动播放"
          copy="首页显露后开始播放启动推荐"
          value={app.state.settings.startupAutoplay}
          onPress={() =>
            app.setSetting(
              'startupAutoplay',
              !app.state.settings.startupAutoplay,
            )
          }
        />
        <SwitchRow
          title="音量标准化"
          copy="减小歌曲之间的响度差异"
          value={app.state.settings.normalizeVolume}
          onPress={() =>
            app.setSetting(
              'normalizeVolume',
              !app.state.settings.normalizeVolume,
            )
          }
        />
        <SwitchRow
          testID="settings-interrupt-playback"
          title="中断播放"
          copy="开启后，当前播放不被其它应用自动打断"
          value={app.state.settings.interruptPlayback}
          onPress={() =>
            app.setSetting(
              'interruptPlayback',
              !app.state.settings.interruptPlayback,
            )
          }
        />
      </Panel>
      <Panel clipContent={false}>
        <Text testID="settings-timer-title" style={s.rowTitle}>
          定时
        </Text>
        <Text
          testID="settings-timer-status"
          style={[s.groupCopy, s.compactGroupCopy]}
        >
          {timerLabel}
        </Text>
        <View style={[s.chipRow, s.timerOptions]}>
          {[15, 30, 45, 60, 90].map(minutes => (
            <Pressable
              key={minutes}
              testID={`settings-timer-${minutes}`}
              onPress={() =>
                app.setSleepTimer('minutes', minutes).catch(() => undefined)
              }
              style={s.chip}
            >
              <Text style={s.chipText}>{minutes} 分钟</Text>
            </Pressable>
          ))}
          <Pressable
            testID="settings-timer-track"
            onPress={() => app.setSleepTimer('track').catch(() => undefined)}
            style={s.chip}
          >
            <Text style={s.chipText}>本曲结束</Text>
          </Pressable>
          {app.player.sleepMode !== 'off' ? (
            <Pressable
              testID="settings-timer-cancel"
              onPress={() => app.cancelSleepTimer()}
              style={[s.chip, s.dangerChip]}
            >
              <Text style={s.dangerText}>取消定时</Text>
            </Pressable>
          ) : null}
        </View>
      </Panel>
      <Panel clipContent={false}>
        {([
          { key: 'quality', title: '播放音质', copy: '非 Wi-Fi 网络播放时优先请求所选音质', testID: 'playback-quality' },
          { key: 'wifiQuality', title: '播放音质 · Wi-Fi', copy: 'Wi-Fi 网络播放时优先请求所选音质', testID: 'wifi-playback-quality' },
          { key: 'downloadQuality', title: '下载音质', copy: '非 Wi-Fi 网络下载时优先请求所选音质', testID: 'download-quality' },
          { key: 'wifiDownloadQuality', title: '下载音质 · Wi-Fi', copy: 'Wi-Fi 网络下载时优先请求所选音质', testID: 'wifi-download-quality' },
        ] as const).map(item => <Segment key={item.key} testID={item.testID} title={item.title} copy={item.copy}
          options={playbackQualityOptions.map(option => option.settingsLabel)}
          selected={playbackQualityOptions.findIndex(option => option.value ===
            (app.state.settings[item.key] ?? (item.key === 'wifiDownloadQuality' || item.key === 'downloadQuality'
              ? app.state.settings.downloadQuality ?? app.state.settings.quality : app.state.settings.quality)))}
          onSelect={index => { const option = playbackQualityOptions[index]; if (option) app.setSetting(item.key, option.value); }} />)}
      </Panel>
    </View>
  );
}

function SourcesPanel({
  dragging,
  onDraggingChange,
  scrollDuringDrag,
}: {
  dragging: boolean;
  onDraggingChange: (dragging: boolean) => void;
  scrollDuringDrag: (pageY: number) => number;
}) {
  const s = useSettingsStyles();
  const app = useApp();
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState('');
  const detectionFlight = useRef(false);
  const detectionGeneration = useRef(0);
  const [detectionResults, setDetectionResults] = useState<Array<{ id: string; name: string; passed: boolean }>>([]);
  useEffect(() => () => { detectionGeneration.current++; }, []);
  const [deleting, setDeleting] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const deletableSources = app.state.sources;
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStatus = (value: string, persistent = false) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(sourceSettingsText(value));
    if (value && !persistent) {
      statusTimer.current = setTimeout(() => {
        setStatus('');
        statusTimer.current = null;
      }, 1800);
    }
  };
  useEffect(() => () => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
  });
  const importSource = async () => {
    if (working) return;
    setWorking('import');
    setStatus('');
    try {
      const imported = await app.importSource();
      showStatus(imported ? '音源已导入并保存' : '已取消导入');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : '音源导入失败');
    } finally {
      setWorking('');
    }
  };
  const testEnabledSources = async () => {
    if (working || dragging || detectionFlight.current) return;
    const sources = app.state.sources.filter(isSourceEnabled);
    if (!sources.length) { showStatus('没有已启用且可检测的音源', true); return; }
    detectionFlight.current = true;
    const generation = ++detectionGeneration.current;
    setWorking('batch-test'); setDetectionResults([]);
    showStatus('正在检测 0/' + sources.length, true);
    const results: Array<{ id: string; name: string; passed: boolean }> = [];
    try {
      for (const source of sources) {
        if (generation !== detectionGeneration.current) return;
        let passed = false;
        try { passed = (await app.testSource(source.id)) === '检测通过'; } catch { passed = false; }
        if (generation !== detectionGeneration.current) return;
        results.push({ id: source.id, name: sourceDisplayName(source), passed });
        setDetectionResults([...results]);
        showStatus('正在检测 ' + results.length + '/' + sources.length, true);
      }
      const passed = results.filter(result => result.passed).length;
      showStatus('检测完成：通过 ' + passed + ' 个，未通过 ' + (results.length - passed) + ' 个', true);
    } finally {
      detectionFlight.current = false;
      if (generation === detectionGeneration.current) setWorking('');
    }
  };
  return (
    <View testID="settings-sources-panel">
      <Panel title="音源" titleTestID="settings-sources-title">
        <View testID="platform-controls-row" style={s.platformControlsRow}>
        {app.state.platforms.map(platform => {
          const health = app.startupHealth?.byProvider?.[platform.id];
          const elapsed =
            platform.enabled && health?.passed ? health.elapsedMs : undefined;
          return (
            <View
              key={platform.id}
              testID={`platform-${platform.id}`}
              style={s.platformCard}
            >
              <View testID={`platform-heading-${platform.id}`} style={s.platformHeading}>
                <Text numberOfLines={1} style={s.platformName}>
                  {platformLabel(platform.id)}
                </Text>
                <Text
                  testID={`platform-delay-${platform.id}`}
                  style={s.platformDelay}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {elapsed !== undefined &&
                  Number.isFinite(elapsed) &&
                  elapsed >= 0
                    ? `${Math.round(elapsed)} ms`
                    : '—'}
                </Text>
              </View>
              <View style={s.platformSwitchSlot}>
                <Toggle
                  testID={`platform-toggle-${platform.id}`}
                  accessibilityLabel={`${platformLabel(platform.id)}平台`}
                  compact
                  value={platform.enabled}
                  onPress={() => app.togglePlatform(platform.id)}
                />
              </View>
            </View>
          );
        })}
        </View>
      </Panel>
      <View style={s.groupHead}>
        <Pressable
          testID="delete-source-button"
          accessibilityRole="button"
          disabled={Boolean(working) || dragging || !deletableSources.length}
          onPress={() => {
            setSelectedSources([]);
            setDeleting(true);
          }}
          style={[
            s.sourceOperation,
            s.sourceDangerOperation,
            (Boolean(working) || dragging || !deletableSources.length) && s.disabledButton,
          ]}
          android_ripple={{ color: s.sourceDangerOperation.borderColor }}
        >
          <Text style={s.dangerText}>删除</Text>
        </Pressable>
        <Pressable
          testID="import-source-button"
          disabled={Boolean(working) || dragging}
          onPress={importSource}
          style={s.importButton}
        >
          <Text style={s.importButtonText}>
            {working === 'import' ? '正在读取…' : '＋ 导入音源'}
          </Text>
        </Pressable>
      </View>
      <SwitchRow
        testID="multi-source-detection"
        title="多音源检测"
        copy=""
        disabled={Boolean(working) || dragging}
        action={<Pressable testID="test-enabled-sources" accessibilityRole="button" disabled={Boolean(working) || dragging}
          android_ripple={{ color: s.sourceOperation.borderColor }}
          onPress={testEnabledSources} style={[s.sourceOperation, (Boolean(working) || dragging) && s.disabledButton]}>
          <Text style={s.actionButtonText}>{working === 'batch-test' ? '检测中…' : '检测'}</Text>
        </Pressable>}
        value={Boolean(app.state.settings.multiSourceDetection)}
        onPress={() =>
          app.setSetting(
            'multiSourceDetection',
            !app.state.settings.multiSourceDetection,
          )
        }
      />
      {status ? (
        <Text testID="source-import-status" style={s.status}>
          {sourceSettingsText(status)}
        </Text>
      ) : null}
      {detectionResults.length ? <View testID="source-detection-results" style={{ marginVertical: 8 }}>
        {detectionResults.map(result => <Text key={result.id} testID={'source-manual-result-' + result.id} style={s.rowCopy}>
          {result.name + '：' + (result.passed ? '检测通过' : '检测未通过')}
        </Text>)}
      </View> : null}
      <View style={[s.panelBody, s.compactPanelBody, s.sourceListBody]}>
        {app.state.sources.length ? (
          <ImportedSourceList
            sources={app.state.sources}
            disabled={Boolean(working) || deleting}
            onReorder={app.reorderSources}
            onDraggingChange={onDraggingChange}
            scrollDuringDrag={scrollDuringDrag}
            renderSource={(source, handle) => (
              <View style={s.sourceBlock}>
                <View style={s.sourceMain}>
                  {handle}
                  <View style={s.sourceCopy}>
                    <Text style={s.rowTitle}>{sourceDisplayName(source)}</Text>
                  </View>
                  <Toggle
                    value={source.enabled}
                    disabled={Boolean(working) || dragging}
                    onPress={() => app.toggleSource(source.id)}
                  />
                </View>
                <View
                  testID={`source-platform-statuses-${source.id}`}
                  style={s.sourcePlatformGrid}
                >
                  {app.state.platforms.map(platform => {
                    const state = sourcePlatformState(
                      source,
                      platform,
                      app.startupHealth,
                    );
                    const bound = state.label === '通过·已绑定';
                    return (
                      <View
                        key={platform.id}
                        testID={`source-platform-status-${source.id}-${platform.id}`}
                        style={[
                          s.sourcePlatformChip,
                          bound && s.sourcePlatformChipBound,
                          state.style === 'pending' &&
                            s.sourcePlatformChipPending,
                          state.style === 'unsupported' &&
                            s.sourcePlatformChipUnsupported,
                        ]}
                      >
                        <Text style={s.sourcePlatformName}>
                          {platformLabel(platform.id)}
                        </Text>
                        <Text style={[s.sourcePlatformState, bound && s.sourcePlatformStateBound]}>{state.label}</Text>
                      </View>
                    );
                  })}
                </View>

              </View>
            )}
          />
        ) : (
          <Text testID="source-empty-state" style={s.emptyCopy}>
            还没有导入音源。导入兼容的 LX 2.0 音源后，平台会显示对应支持关系。
          </Text>
        )}
      </View>
      {deleting ? (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => setDeleting(false)}
        >
          <View style={s.modalBackdrop}>
            <View
              testID="delete-source-dialog"
              accessibilityViewIsModal
              style={s.deleteDialog}
            >
              <Text style={s.rowTitle}>删除音源</Text>
              <ScrollView style={s.deleteChoices}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                {deletableSources.map(source => (
                  <Pressable
                    key={source.id}
                    testID={`select-delete-source-${source.id}`}
                    accessibilityRole="checkbox"
                    accessibilityLabel={sourceDisplayName(source)}
                    accessibilityState={{
                      checked: selectedSources.includes(source.id),
                    }}
                    onPress={() =>
                      setSelectedSources(ids =>
                        ids.includes(source.id)
                          ? ids.filter(id => id !== source.id)
                          : [...ids, source.id],
                      )
                    }
                    style={s.deleteChoice}
                  >
                    <Text style={s.deleteChoiceName}>{sourceDisplayName(source)}</Text>
                    <Text style={s.deleteCheck}>
                      {selectedSources.includes(source.id) ? '✓' : '○'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={s.deleteActions}>
                <Pressable
                  testID="cancel-delete-source"
                  onPress={() => setDeleting(false)}
                  style={s.actionButton}
                >
                  <Text style={s.actionButtonText}>取消</Text>
                </Pressable>
                <Pressable
                  testID="confirm-delete-source"
                  disabled={!selectedSources.length}
                  onPress={async () => {
                    if (working) return;
                    setWorking('delete');
                    try {
                      await app.removeSources(selectedSources);
                      setDeleting(false);
                      showStatus('音源已删除');
                    } catch (error) { showStatus(error instanceof Error ? error.message : '删除保存失败，请重试'); }
                    finally { setWorking(''); }
                  }}
                  style={[
                    s.deleteButton,
                    !selectedSources.length && s.disabledButton,
                  ]}
                >
                  <Text style={s.dangerText}>删除</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function DataPanel() {
  const s = useSettingsStyles();
  const app = useApp();
  const [androidAppVersion, setAndroidAppVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    readAndroidAppVersion().then(version => {
      if (active) setAndroidAppVersion(version);
    });
    return () => {
      active = false;
    };
  }, []);
  const [status, setStatus] = useState('');
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
  const [selectedCacheParts, setSelectedCacheParts] =
    useState<CacheCleanupPart[]>(() => [...allCacheCleanupParts]);
  const [clearingCache, setClearingCache] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setStatus('');
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '操作失败');
    }
  };
  const openCacheDialog = () => {
    if (clearingCache) return;
    setSelectedCacheParts([...allCacheCleanupParts]);
    setCacheDialogOpen(true);
  };
  const confirmCacheCleanup = async () => {
    if (clearingCache || !selectedCacheParts.length) return;
    setClearingCache(true);
    setStatus('');
    try {
      await app.clearCache(selectedCacheParts);
      setCacheDialogOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '操作失败');
    } finally {
      setClearingCache(false);
    }
  };
  const cacheOptions: Array<{
    id: CacheCleanupPart;
    title: string;
    copy: string;
  }> = [
    {
      id: 'network',
      title: '网络、网页与图片临时缓存',
      copy: '清除网页存储、网络临时文件和图片落盘缓存',
    },
    {
      id: 'runtime',
      title: '运行时解析、歌词、封面与取色缓存',
      copy: '清除本次运行的临时结果，不停止当前歌曲',
    },
    {
      id: 'local-artwork',
      title: '本地封面文件',
      copy: '删除从本地音频生成的封面，下次查看时重新生成',
    },
  ];
  return (
    <View testID="settings-data-panel">
      <Panel title="数据管理" titleTestID="settings-data-title" copy="管理下载、缓存、历史与备份">
        <ActionRow
          icon="▰"
          title="下载目录"
          copy="选择 Android 音乐文件保存位置"
          action="选择目录"
          onPress={() => run(app.chooseDownloadDirectory)}
        />
        <ActionRow
          icon="♨"
          title="清理缓存"
          copy="清除封面与搜索临时数据"
          action={clearingCache ? '清理中…' : '立即清理'}
          onPress={openCacheDialog}
          testID="settings-clear-cache"
        />
        <ActionRow
          icon="◷"
          title="清空听歌历史"
          copy={`${app.state.history.length} 条独立设备记录`}
          action="清空"
          onPress={() => app.clearHistory()}
        />
        <ActionRow
          icon="☁"
          title="备份数据"
          copy="备份收藏、歌单、设置与画像"
          action="立即备份"
          onPress={() => run(app.backupData)}
        />
        <ActionRow
          icon="⇩"
          title="恢复数据"
          copy="从备份文件恢复数据"
          action="选择文件"
          onPress={() => run(app.restoreData)}
        />
      </Panel>
      <Panel>
        <ActionRow
          icon="▣"
          title="媒体通知与锁屏控制"
          copy="由 Android MediaSession 在播放时自动提供"
        />
        <ActionRow
          icon="◉"
          title="耳机控制"
          copy="支持播放、暂停、上一首和下一首"
        />
        <ActionRow
          icon="ⓘ"
          title="关于六六Music"
          copy={androidAppVersion ? `v${androidAppVersion.replace(/^v/i, '')}` : 'Android'}
          testID="settings-about"
        />
      </Panel>
      {cacheDialogOpen ? (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => {
            if (!clearingCache) setCacheDialogOpen(false);
          }}
        >
          <View style={s.modalBackdrop}>
            <View
              testID="clear-cache-dialog"
              accessibilityViewIsModal
              style={s.deleteDialog}
            >
              <Text style={s.rowTitle}>选择要清理的内容</Text>
              <Text style={s.rowCopy}>
                不会删除收藏、歌单、历史、设置、音源、本地音乐或下载文件
              </Text>
              <ScrollView style={s.deleteChoices}
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                {cacheOptions.map(option => {
                  const checked = selectedCacheParts.includes(option.id);
                  return (
                    <Pressable
                      key={option.id}
                      testID={`clear-cache-option-${option.id}`}
                      accessibilityRole="checkbox"
                      accessibilityLabel={option.title}
                      accessibilityState={{ checked }}
                      disabled={clearingCache}
                      onPress={() =>
                        setSelectedCacheParts(parts =>
                          parts.includes(option.id)
                            ? parts.filter(part => part !== option.id)
                            : [...parts, option.id],
                        )
                      }
                      style={[s.deleteChoice, clearingCache && s.disabledChoice]}
                    >
                      <View style={s.cacheChoiceCopy}>
                        <Text style={s.deleteChoiceName}>{option.title}</Text>
                        <Text style={s.cacheChoiceDescription}>{option.copy}</Text>
                      </View>
                      <Text style={s.deleteCheck}>{checked ? '✓' : '○'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={s.deleteActions}>
                <Pressable
                  testID="cancel-clear-cache"
                  disabled={clearingCache}
                  onPress={() => setCacheDialogOpen(false)}
                  style={[s.actionButton, clearingCache && s.disabledButton]}
                >
                  <Text style={s.actionButtonText}>取消</Text>
                </Pressable>
                <Pressable
                  testID="confirm-clear-cache"
                  disabled={clearingCache || !selectedCacheParts.length}
                  onPress={() => void confirmCacheCleanup()}
                  style={[
                    s.deleteButton,
                    (clearingCache || !selectedCacheParts.length) &&
                      s.disabledButton,
                  ]}
                >
                  <Text style={s.dangerText}>
                    {clearingCache ? '清理中…' : '确认清理'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {status ? <Text style={s.status}>{sourceSettingsText(status)}</Text> : null}
    </View>
  );
}

function Panel({
  title,
  titleTestID,
  copy,
  action,
  children,
  compact = true,
  clipContent = true,
}: {
  title?: string;
  titleTestID?: string;
  copy?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
  clipContent?: boolean;
}) {
  const s = useSettingsStyles();
  return (
    <View testID="settings-group" style={[s.panel, compact && s.compactPanel]}>
      {title ? <Text testID={titleTestID} style={s.rowTitle}>{title}</Text> : null}
      {copy ? (
        action ? (
          <View testID="settings-theme-heading" style={s.themeHeading}>
            <Text style={[s.groupCopy, s.themeHeadingCopy]}>{copy}</Text>
            {action}
          </View>
        ) : (
          <Text style={[s.groupCopy, compact && s.compactGroupCopy]}>
            {copy}
          </Text>
        )
      ) : null}
      <View
        testID="settings-group-body"
        style={[s.panelBody, compact && s.compactPanelBody, !clipContent && { overflow: 'visible' }]}
      >
        {children}
      </View>
    </View>
  );
}
function SwitchRow({
  title,
  copy,
  value,
  onPress,
  testID,
  action,
  disabled = false,
}: {
  title: string;
  copy: string;
  value: boolean;
  onPress: () => void;
  testID?: string;
  action?: React.ReactNode;
  disabled?: boolean;
}) {
  const s = useSettingsStyles();
  return (
    <View testID={testID} style={s.settingRow}>
      <View style={s.rowCopyBlock}>
        <Text style={s.rowTitle}>{title}</Text>
        {copy ? <Text style={s.rowCopy}>{copy}</Text> : null}
      </View>
      {action ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{action}<Toggle value={value} onPress={onPress} disabled={disabled} /></View>
        : <Toggle value={value} onPress={onPress} disabled={disabled} />}
    </View>
  );
}
function Toggle({ value, onPress, disabled = false, compact = false, testID, accessibilityLabel }: {
  value: boolean;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const s = useSettingsStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? { top: 12, bottom: 12, left: 5, right: 5 } : undefined}
      style={[s.toggle, value && s.toggleOn, compact && s.toggleCompact]}
    >
      <View style={[s.knob, value && s.knobOn, compact && s.knobCompact, compact && value && s.knobCompactOn]} />
    </Pressable>
  );
}
function Segment({
  testID,
  title,
  copy,
  options,
  selected,
  onSelect,
}: {
  testID?: string;
  title: string;
  copy: string;
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const s = useSettingsStyles();
  return (
    <View testID={testID} style={s.segmentBlock}>
      <Text style={s.rowTitle}>{title}</Text>
      <Text style={s.rowCopy}>{copy}</Text>
      <View style={s.segment}>
        {options.map((item, index) => (
          <Pressable
            key={item}
            onPress={() => onSelect(index)}
            style={[s.segmentItem, selected === index && s.segmentItemActive]}
          >
            <Text
              style={[s.segmentText, selected === index && s.segmentTextActive]}
            >
              {item}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
function ActionRow({
  icon,
  title,
  copy,
  action,
  onPress,
  testID,
}: {
  icon: string;
  title: string;
  copy: string;
  action?: string;
  onPress?: () => void;
  testID?: string;
}) {
  const s = useSettingsStyles();
  return (
    <View testID={testID} style={s.actionRow}>
      <Text style={s.actionIcon}>{icon}</Text>
      <View style={s.sourceCopy}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowCopy}>{copy}</Text>
      </View>
      {action ? (
        <Pressable
          testID={testID ? `${testID}-action` : undefined}
          onPress={onPress}
          style={s.actionButton}
        >
          <Text style={s.actionButtonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function useSettingsStyles() {
  const theme = useTheme();
  return useMemo(() => settingsStyles(theme), [theme]);
}

const settingsStyles = (theme: ThemePalette) =>
  ({
    root: { flex: 1, backgroundColor: 'transparent' },
    content: { paddingHorizontal: 14, paddingTop: 6 },
    header: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    pageTitle: { flex: 1, color: theme.text, fontSize: 26, fontWeight: '500' },
    // Keep the intro gap outside the sticky header so it vanishes on pinning.
    sectionTabsSpacing: { height: 22 },
    sectionTabs: {
      flexDirection: 'row',
      height: 64,
      backgroundColor: 'transparent',
    },
    // ScrollView transfers the sticky child's style to its native wrapper.
    // Retain the horizontal layout on an inner row that it cannot overwrite.
    sectionTabsRow: { flex: 1, flexDirection: 'row' },
    sectionTabsBacking: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: theme.bg,
    },
    sectionTab: {
      flex: 1,
      minHeight: 64,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionTabText: { color: theme.text, fontSize: 15, fontWeight: '700' },
    sectionTabTextActive: { color: theme.accent },
    sectionTabCopy: { color: theme.muted, fontSize: 12, marginTop: 2 },
    sectionIndicator: {
      position: 'absolute',
      bottom: 0,
      width: 27,
      height: 2,
      borderRadius: 2,
      backgroundColor: theme.accent,
    },
    settingsIntro: {
      height: 140,
      width: '48%',
      paddingTop: 8,
      // Reserve the same 44dp row that precedes the music intro in Library.
      marginTop: 44,
      backgroundColor: 'transparent',
    },
    settingsIntroTitle: {
      color: theme.text,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: '700',
    },
    settingsIntroFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 9,
      gap: 8,
    },
    settingsIntroScript: {
      color: theme.muted,
      fontFamily: 'cursive',
      fontSize: 23,
      lineHeight: 24,
      transform: [{ rotate: '-12deg' }],
      width: 57,
    },
    settingsIntroCopy: {
      color: theme.muted,
      fontSize: 9,
      lineHeight: 14,
      flex: 1,
    },
    panel: {
      marginTop: 24,
      backgroundColor: 'transparent',
      padding: 0,
    },
    groupCopy: { color: theme.muted, fontSize: 14, marginTop: 4 },
    panelBody: {
      marginTop: 14,
      borderRadius: 16,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    },
    compactPanel: { marginTop: 16 },
    compactGroupCopy: { fontSize: 12, lineHeight: 18, marginTop: 2 },
    compactPanelBody: { marginTop: 8 },
    themeGrid: {
      flexDirection: 'row',
      gap: 8,
      paddingRight: 16,
    },
    themeHeading: { flexDirection: 'row', alignItems: 'center' },
    themeHeadingCopy: { flex: 1 },
    themeAllButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    themeAllText: { color: theme.accent, fontSize: 13, fontWeight: '500' },
    themeAllArrow: { color: theme.accent, fontSize: 24, lineHeight: 28 },
    settingRow: {
      minHeight: 58,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    rowCopyBlock: { flex: 1, paddingRight: 12 },
    rowTitle: { color: theme.text, fontSize: 15, fontWeight: '400' },
    rowCopy: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
    timerOptions: { marginTop: 8 },
    toggle: {
      width: 52,
      height: 30,
      borderRadius: 15,
      padding: 3,
      backgroundColor: theme.line,
    },
    toggleOn: { backgroundColor: theme.accent },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
    knobOn: { transform: [{ translateX: 22 }] },
    toggleCompact: { width: 34, height: 20, borderRadius: 10, padding: 2 },
    knobCompact: { width: 16, height: 16, borderRadius: 8 },
    knobCompactOn: { transform: [{ translateX: 14 }] },
    segmentBlock: {
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    segment: {
      height: 40,
      marginTop: 8,
      borderRadius: 10,
      backgroundColor: theme.panelSoft,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    segmentItem: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentItemActive: {
      backgroundColor: theme.selectedSurface,
    },
    segmentText: { color: theme.muted, fontSize: 13, fontWeight: '400' },
    segmentTextActive: { color: theme.accent },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    chip: {
      paddingHorizontal: 12,
      minHeight: 35,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: { color: theme.text, fontSize: 12 },
    dangerChip: { backgroundColor: `${theme.red}18` },
    dangerText: { color: theme.red, fontSize: 12, fontWeight: '400' },
    sourceBlock: {
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    sourceMain: { flexDirection: 'row', alignItems: 'center' },
    sourceCopy: { flex: 1, minWidth: 0, paddingRight: 10 },
    sourcePlatformGrid: {
      marginTop: 6,
      flexDirection: 'row',
      flexWrap: 'nowrap',
      gap: 6,
    },
    sourcePlatformChip: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 4,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
    },
    sourcePlatformChipPending: { opacity: 0.78 },
    sourcePlatformChipUnsupported: { opacity: 0.55 },
    sourcePlatformChipBound: { backgroundColor: theme.selectedSurface, borderColor: theme.accent },
    sourcePlatformName: { color: theme.text, fontSize: 11 },
    sourcePlatformState: {
      color: theme.muted,
      fontSize: 10,
      lineHeight: 14,
      marginTop: 2,
    },
    sourcePlatformStateBound: { color: theme.accent },
    platformControlsRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6 },
    platformCard: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 4,
      paddingTop: 8,
      paddingBottom: 4,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      backgroundColor: theme.panelSoft,
    },
    platformHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 16 },
    platformName: { color: theme.text, fontSize: 11 },
    platformDelay: { color: theme.muted, fontSize: 9, flexShrink: 1 },
    platformSwitchSlot: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    sourceListBody: { overflow: 'visible' },
    sourceOperation: {
      minHeight: 36,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.selectedSurface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    sourceDangerOperation: { borderColor: theme.red, backgroundColor: `${theme.red}18` },
    groupHead: {
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
    },
    deleteButton: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 13,
      backgroundColor: `${theme.red}18`,
    },
    disabledButton: { opacity: 0.4 },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      backgroundColor: 'rgba(0,0,0,.45)',
    },
    deleteDialog: {
      backgroundColor: theme.panel,
      padding: 18,
      borderRadius: 18,
    },
    deleteChoices: { maxHeight: 280, marginTop: 12 },
    deleteChoice: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    deleteChoiceName: { flex: 1, color: theme.text, fontSize: 15 },
    deleteCheck: { color: theme.accent, fontSize: 20, paddingHorizontal: 12 },
    cacheChoiceCopy: { flex: 1, paddingVertical: 8, paddingRight: 8 },
    cacheChoiceDescription: {
      color: theme.muted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 2,
    },
    disabledChoice: { opacity: 0.5 },
    deleteActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
      marginTop: 12,
    },
    importButton: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 13,
      backgroundColor: theme.accent,
    },
    importButtonText: { color: '#fff', fontSize: 12, fontWeight: '400' },
    status: {
      color: theme.accent,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 10,
    },
    emptyCopy: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
      padding: 12,
    },
    actionRow: {
      minHeight: 60,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    actionIcon: {
      width: 34,
      color: theme.accent,
      fontSize: 23,
      fontWeight: '400',
    },
    actionButton: { paddingHorizontal: 10, paddingVertical: 8 },
    actionButtonText: { color: theme.accent, fontSize: 12, fontWeight: '400' },
  } as const);
