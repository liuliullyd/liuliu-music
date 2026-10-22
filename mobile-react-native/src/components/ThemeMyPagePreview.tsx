import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ThemeArtwork } from './ThemeBackground';
import { paletteForTheme, type ThemePalette } from '../theme';
import { themeOptions } from '../themeCatalog';

export const THEME_PREVIEW_ASPECT_RATIO = 873 / 1800;
const DESIGN_WIDTH = 420;
const sections = [
  ['外观主题', '个性化界面'],
  ['播放设置', '播放与音质'],
  ['音源', '管理与导入'],
  ['数据管理', '备份与清理'],
] as const;
const settings = [
  ['自动播放下一首', '当前歌曲结束后继续播放队列', true],
  ['启动时自动播放', '首页显露后开始播放启动推荐', true],
  ['音量标准化', '减小歌曲之间的响度差异', false],
] as const;
const sampleThemes = themeOptions.slice(0, 4).map(option => ({
  option,
  palette: paletteForTheme(option.id),
}));

/** A local visual sample: no app context, setting handlers or nested page. */
export const ThemeMyPagePreview = memo(function MyPagePreview({
  theme,
  width,
  height,
  testID,
}: {
  theme: ThemePalette;
  width: number;
  height: number;
  testID: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = width / DESIGN_WIDTH;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}
    >
      <View
        testID={`${testID}-canvas`}
        style={[
          styles.canvas,
          { height: height / scale, transform: [{ scale }] },
        ]}
      >
        <View style={styles.status}>
          <Text style={styles.time}>9:41</Text>
          <View style={styles.statusIcons}>
            {[7, 10, 13, 16].map(barHeight => (
              <View
                key={barHeight}
                style={[styles.signal, { height: barHeight }]}
              />
            ))}
            <View style={styles.battery}>
              <View style={styles.batteryFill} />
            </View>
          </View>
        </View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text testID={`${testID}-title`} style={styles.title}>
              我的
            </Text>
          </View>
          <View style={styles.intro}>
            <Text style={styles.introTitle}>{'在音乐里\n遇见更好的自己'}</Text>
            <View style={styles.introFooter}>
              <Text style={styles.script}>{'Good\nMusic'}</Text>
              <Text style={styles.introCopy}>
                {'让每一首歌\n陪你度过每一个日常'}
              </Text>
            </View>
          </View>
          <View testID={`${testID}-sections`} style={styles.sections}>
            {sections.map(([title, copy], index) => (
              <View key={title} style={styles.section}>
                <Text
                  style={[
                    styles.sectionTitle,
                    index === 0 && styles.activeText,
                  ]}
                >
                  {title}
                </Text>
                <Text style={styles.sectionCopy}>{copy}</Text>
                {index === 0 ? <View style={styles.indicator} /> : null}
              </View>
            ))}
          </View>
          <View style={styles.themeHeading}>
            <Text style={styles.themeCopy}>选择你喜欢的视觉风格</Text>
            <Text style={styles.viewAll}>查看全部 ›</Text>
          </View>
          <View style={styles.themeRail}>
            {sampleThemes.map(({ option, palette }) => (
              <View key={option.id} style={styles.sampleCard}>
                <View
                  style={[
                    styles.sampleArtwork,
                    { backgroundColor: palette.bg },
                    theme.id === option.id && styles.sampleSelected,
                  ]}
                >
                  <ThemeArtwork
                    theme={palette}
                    resizeMode="contain"
                    artworkTestID={`${testID}-sample-${option.id}`}
                  />
                  <View style={styles.sampleUi}>
                    {[26, 37, 20].map((lineWidth, index) => (
                      <View
                        key={index}
                        style={[
                          styles.sampleLine,
                          { width: lineWidth, backgroundColor: palette.text },
                        ]}
                      />
                    ))}
                    <View
                      style={[
                        styles.sampleButton,
                        { backgroundColor: palette.accent },
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.sampleLabel}>{option.label}</Text>
              </View>
            ))}
          </View>
          <View testID={`${testID}-settings`} style={styles.settings}>
            {settings.map(([title, copy, enabled]) => (
              <View key={title} style={styles.setting}>
                <View style={styles.settingCopy}>
                  <Text style={styles.settingTitle}>{title}</Text>
                  <Text style={styles.settingDescription}>{copy}</Text>
                </View>
                <View style={[styles.toggle, enabled && styles.toggleOn]}>
                  <View style={[styles.knob, enabled && styles.knobOn]} />
                </View>
              </View>
            ))}
          </View>
        </View>
        <View testID={`${testID}-navigation`} style={styles.navigation}>
          {['首页', '探索', '播放', '漫游', '我的'].map(label => (
            <View key={label} style={styles.navItem}>
              {label === '播放' ? (
                <View style={styles.playerButton}>
                  <View style={styles.playIcon} />
                </View>
              ) : (
                <Text
                  style={[
                    styles.navLabel,
                    label === '我的' && styles.activeText,
                  ]}
                >
                  {label}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});

const createStyles = (theme: ThemePalette) =>
  StyleSheet.create({
    root: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: 'hidden',
    },
    canvas: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: DESIGN_WIDTH,
      transformOrigin: 'top left',
    },
    status: {
      height: 28,
      paddingHorizontal: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    time: { fontSize: 12, fontWeight: '600', color: theme.text },
    statusIcons: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
    signal: { width: 3, borderRadius: 1, backgroundColor: theme.text },
    battery: {
      width: 22,
      height: 12,
      borderRadius: 3,
      borderWidth: 1,
      borderColor: theme.text,
      padding: 2,
      marginLeft: 7,
      marginBottom: 2,
    },
    batteryFill: { flex: 1, borderRadius: 1, backgroundColor: theme.text },
    content: {
      flex: 1,
      paddingHorizontal: 14,
      paddingTop: 6,
      overflow: 'hidden',
    },
    header: { height: 56, justifyContent: 'center' },
    title: { fontSize: 26, fontWeight: '500', color: theme.text },
    intro: { height: 140, width: '48%', paddingTop: 8, marginTop: 44 },
    introTitle: {
      fontSize: 22,
      lineHeight: 29,
      fontWeight: '700',
      color: theme.text,
    },
    introFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 9,
      gap: 8,
    },
    script: {
      color: theme.muted,
      fontFamily: 'cursive',
      fontSize: 23,
      lineHeight: 24,
      width: 57,
      transform: [{ rotate: '-12deg' }],
    },
    introCopy: { flex: 1, color: theme.muted, fontSize: 9, lineHeight: 14 },
    sections: { height: 64, flexDirection: 'row', marginTop: 22 },
    section: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    sectionTitle: { fontSize: 15, color: theme.text },
    activeText: { color: theme.accent, fontWeight: '600' },
    sectionCopy: { fontSize: 12, color: theme.muted, marginTop: 2 },
    indicator: {
      position: 'absolute',
      bottom: 0,
      width: 27,
      height: 2,
      borderRadius: 2,
      backgroundColor: theme.accent,
    },
    themeHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 44,
      marginTop: 24,
    },
    themeCopy: { flex: 1, fontSize: 14, color: theme.muted },
    viewAll: { fontSize: 13, fontWeight: '500', color: theme.accent },
    themeRail: { flexDirection: 'row', gap: 8, marginTop: 14 },
    sampleCard: { width: 84, alignItems: 'center' },
    sampleArtwork: {
      width: 78,
      height: 161,
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: 10,
      overflow: 'hidden',
    },
    sampleSelected: { borderColor: theme.accent },
    sampleUi: { position: 'absolute', top: 18, left: 7, gap: 7 },
    sampleLine: { height: 2, opacity: 0.6, borderRadius: 1 },
    sampleButton: { width: 15, height: 8, borderRadius: 4, marginTop: 26 },
    sampleLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.text,
      marginTop: 7,
    },
    settings: { marginTop: 16 },
    setting: {
      minHeight: 58,
      paddingVertical: 6,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
    },
    settingCopy: { flex: 1, paddingRight: 12 },
    settingTitle: { color: theme.text, fontSize: 15 },
    settingDescription: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 3,
    },
    toggle: {
      width: 52,
      height: 30,
      borderRadius: 15,
      padding: 3,
      backgroundColor: theme.line,
    },
    toggleOn: { backgroundColor: theme.accent },
    knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
    knobOn: { alignSelf: 'flex-end' },
    navigation: {
      height: 88,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line,
      backgroundColor: theme.bg,
    },
    navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    navLabel: { fontSize: 20, color: theme.muted },
    playerButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: '#B17CFA',
      alignItems: 'center',
      justifyContent: 'center',
    },
    playIcon: {
      width: 0,
      height: 0,
      marginLeft: 4,
      borderTopWidth: 9,
      borderBottomWidth: 9,
      borderLeftWidth: 14,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: '#fff',
    },
  });
