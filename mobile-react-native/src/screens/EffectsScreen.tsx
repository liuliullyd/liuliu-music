import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { useLayout } from '../state/LayoutContext';
import { Glyph } from '../components/UI';
import { useTheme } from '../theme';
import {
  EqualizerEditor,
  SavedEqualizerList,
} from '../components/EqualizerEditor';
import { AdvancedEffectsEditor } from '../components/AdvancedEffectsEditor';
import { EffectEditSessionProvider } from '../components/EffectEditSession';
import { HeadphoneEffects } from '../components/HeadphoneEffects';
import { useEffectsBottomInset } from '../components/EffectsChromeContext';
import { zeusScenes, gtoScenes } from '../services/effectScenes';
import type { EffectScene } from '../services/effectScenes';
import { SvgXml } from 'react-native-svg';
import artwork from '../assets/effects/presets/artwork.json';

function scenesWithFirst(scenes: EffectScene[], firstId: string) {
  const first = scenes.find(scene => scene.id === firstId);
  return first ? [first, ...scenes.filter(scene => scene !== first)] : scenes;
}

const zeusDisplayScenes = scenesWithFirst(zeusScenes, 'Zeus:低音量补偿');
const gtoDisplayScenes = scenesWithFirst(gtoScenes, 'GTO:原声直通');

function SceneArt({ id }: { id: string }) {
  return (
    <SvgXml
      xml={(artwork as Record<string, string>)[id]}
      width="100%"
      height="100%"
    />
  );
}
function SceneCard({ scene }: { scene: EffectScene }) {
  const app = useApp(),
    theme = useTheme();
  const active = app.state.settings.effectSceneId === scene.id;
  return (
    <Pressable
      testID={'player-effect-' + scene.id}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={async () => {
        if (
          await app.applyCustomEqualizer(scene.gains, undefined, {
            advanced: scene.advanced,
            sceneId: scene.id,
          })
        )
          app.setSetting('effectSceneId', scene.id);
      }}
      style={[
        styles.scene,
        {
          borderColor: active ? theme.gold : theme.line,
          backgroundColor: theme.panel,
        },
      ]}
    >
      <View style={styles.sceneImage}>
        <SceneArt id={scene.art} />
      </View>
      <View
        testID={'effect-check-' + scene.id}
        style={[
          styles.check,
          {
            borderColor: active ? theme.gold : theme.line,
            backgroundColor: active ? theme.selectedSurface : theme.panel,
          },
        ]}
      >
        <Text style={{ color: theme.text, fontWeight: '700' }}>
          {active ? '✓' : ''}
        </Text>
      </View>
      <View style={styles.sceneText}>
        <View testID={'effect-title-' + scene.id} style={styles.sceneTitleRow}>
          <Text style={[styles.sceneName, { color: theme.text }]}>
            {scene.name}
          </Text>
          <Text style={[styles.sceneMeta, { color: theme.muted }]}>
            {scene.scene}
          </Text>
        </View>
        <Text style={[styles.sceneCopy, { color: theme.muted }]}>
          {scene.description}
        </Text>
      </View>
    </Pressable>
  );
}
export function EffectsScreen() {
  const app = useApp(),
    theme = useTheme();
  const bottomInset = useEffectsBottomInset();
  const layout = useLayout();
  const { scale } = layout;
  const backSize = 48 / scale;
  const headerHeight = Math.max(layout.playerHeaderHeight, backSize);
  const [tab, setTab] = useState(0),
    [editor, setEditor] = useState<'eq' | 'advanced'>('eq'),
    [locked, setLocked] = useState(false);
  const fg = { primary: theme.text, secondary: theme.muted };
  const flush = app.flushEqualizerUpdates;
  useEffect(() => {
    setLocked(false);
    flush();
  }, [tab, editor, flush]);
  const card = { backgroundColor: theme.panelSoft, borderColor: theme.line };
  return (
    <View
      testID="effects-view"
      style={[styles.root, { backgroundColor: theme.bg }]}
    >
      <View style={[styles.tabs, {
        height: headerHeight,
        paddingLeft: layout.playerHeaderHorizontalPadding +
          (layout.playerHeaderButtonSize - backSize) / 2,
      }]}>
        <Pressable
          testID="effects-back"
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={app.back}
          style={[styles.back, { width: backSize, height: backSize }]}
        >
          <View testID="effects-back-glyph" style={{
            transform: [{ translateY: (layout.playerHeaderHeight - headerHeight) / 2 }],
          }}>
            <Glyph color={theme.text} size={32}>‹</Glyph>
          </View>
        </Pressable>
        {['宙斯音效', 'GTO 音效', '均衡器', '耳机音效'].map((title, i) => (
          <Pressable
            key={title}
            testID={`effects-tab-${i}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === i }}
            onPress={() => setTab(i)}
            style={[styles.tab, tab === i && { borderBottomColor: theme.gold }]}
          >
            <Text
              style={{
                color: theme.text,
                fontSize: 14,
                fontWeight: tab === i ? '700' : '400',
              }}
            >
              {title}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 3 ? (
        <View
          testID="headphone-layout"
          style={{ flex: 1, marginBottom: bottomInset }}
        >
          <HeadphoneEffects />
        </View>
      ) : (
        <ScrollView
          testID="effects-scroll"
          scrollEnabled={!locked}
          showsVerticalScrollIndicator={false}
          style={{ marginBottom: bottomInset }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsHorizontalScrollIndicator={false}
        >
          {tab === 0 ? (
            <>
              <View
                style={[
                  styles.banner,
                  { backgroundColor: theme.panel, borderColor: theme.line },
                ]}
              >
                <View style={styles.bannerImage}>
                  <SceneArt id="zeus-original" />
                </View>
                <Text style={[styles.bannerTitle, { color: theme.text }]}>
                  宙斯音效
                </Text>
                <Text style={[styles.bannerCopy, { color: theme.muted }]}>
                  让每一种声音，都更动听
                </Text>
                <Text style={[styles.bannerBadge, { color: theme.muted }]}>
                  24 种场景 · 随心切换
                </Text>
              </View>
              <Text style={[styles.heading, { color: theme.text }]}>
                音效场景
              </Text>
              <View style={styles.grid}>
                {zeusDisplayScenes.map(scene => (
                  <SceneCard key={scene.id} scene={scene} />
                ))}
              </View>
              <Text style={{ color: theme.muted, fontSize: 11, marginTop: 12 }}>
                场景音效为应用内聆听偏好调校；专业耳机校准见耳机音效页。
              </Text>
              <SavedEqualizerList
                foreground={fg}
                presets={app.state.settings.customEqualizerPresets ?? []}
                category="银河音效"
              />
            </>
          ) : tab === 1 ? (
            <>
              <View
                style={[
                  styles.banner,
                  { backgroundColor: theme.panel, borderColor: theme.line },
                ]}
              >
                <View style={styles.bannerImage}>
                  <SceneArt id="gto-panorama" />
                </View>
                <Text style={[styles.bannerTitle, { color: theme.text }]}>
                  GTO 音效
                </Text>
                <Text style={[styles.bannerCopy, { color: theme.muted }]}>
                  深度调音，感受音乐的力量
                </Text>
                <Text style={[styles.bannerBadge, { color: theme.muted }]}>
                  12 种场景 · 空间与动态
                </Text>
              </View>
              <Text style={[styles.heading, { color: theme.text }]}>
                音效场景
              </Text>
              <View style={styles.grid}>
                {gtoDisplayScenes.map(scene => (
                  <SceneCard key={scene.id} scene={scene} />
                ))}
              </View>
              <SavedEqualizerList
                foreground={fg}
                presets={app.state.settings.customEqualizerPresets ?? []}
                category="DTS 音效"
              />
            </>
          ) : tab === 2 ? (
            <EffectEditSessionProvider onEditorChange={setEditor}>
              <View style={[styles.editorTabs, card]}>
                {(
                  [
                    ['eq', '均衡器'],
                    ['advanced', '高级设置'],
                  ] as const
                ).map(([key, title]) => (
                  <Pressable
                    key={key}
                    testID={`effects-editor-${key}`}
                    accessibilityState={{ selected: editor === key }}
                    onPress={() => setEditor(key)}
                    style={[
                      styles.editorTab,
                      {
                        backgroundColor:
                          editor === key
                            ? theme.selectedSurface
                            : theme.panelSoft,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.text,
                        fontSize: 16,
                        fontWeight: '600',
                      }}
                    >
                      {key === 'eq' ? '♬　' : '☷　'}
                      {title}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {editor === 'eq' ? (
                <View style={[styles.equalizer, card]}>
                  <EqualizerEditor
                    foreground={fg}
                    onScrollLockChange={setLocked}
                  />
                </View>
              ) : (
                <AdvancedEffectsEditor onScrollLockChange={setLocked} />
              )}
            </EffectEditSessionProvider>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  bannerImage: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '43%',
    overflow: 'hidden',
  },
  sceneImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 64,
    overflow: 'hidden',
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  back: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  content: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 12 },
  banner: {
    minHeight: 108,
    padding: 16,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,200,99,.3)',
  },
  bannerTitle: { fontSize: 24, fontWeight: '700' },
  bannerCopy: { fontSize: 13, marginTop: 5 },
  bannerBadge: { color: '#F7E9DD', fontSize: 11, marginTop: 10 },
  heading: { fontSize: 17, fontWeight: '600', marginTop: 16, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scene: {
    width: '48%',
    minHeight: 128,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 1,
    padding: 0,
    justifyContent: 'flex-start',
  },
  sceneText: { padding: 8, paddingTop: 70 },
  sceneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sceneName: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 0,
    flexShrink: 1,
  },
  sceneCopy: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  sceneMeta: { fontSize: 10, lineHeight: 13, maxWidth: '42%', flexShrink: 0 },
  check: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorTabs: {
    flexDirection: 'row',
    borderRadius: 28,
    borderWidth: 1,
    padding: 3,
    marginBottom: 12,
  },
  editorTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 25,
    alignItems: 'center',
  },
  equalizer: {
    paddingHorizontal: 10,
    paddingTop: 16,
    paddingBottom: 12,
    borderRadius: 22,
    borderWidth: 1,
  },
});
