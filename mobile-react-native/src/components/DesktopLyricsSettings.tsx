import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { useTheme } from '../theme';
import { desktopLyrics, desktopLyricStyles, type DesktopLyricStyle } from '../services/desktopLyrics';

const styleCardWidth = 180;
const styleCardGap = 10;

export function DesktopLyricsSettings() {
  const app = useApp();
  const setSetting = app.setSetting;
  const theme = useTheme();
  const pending = useRef(false);
  const styleList = useRef<ScrollView>(null);
  const [styleViewportWidth, setStyleViewportWidth] = useState(0);
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const enabled = app.state.settings.desktopLyricsEnabled === true;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => {
      if (status !== 'active' || !pending.current) return;
      void desktopLyrics.canDraw().then(granted => {
        pending.current = false;
        if (granted) { setSetting('desktopLyricsEnabled', true); setNotice(''); }
        else setNotice('尚未授予悬浮权限，可再次点击开启');
      });
    });
    return () => { pending.current = false; subscription.remove(); };
  }, [setSetting]);
  const toggle = async () => {
    if (working) return;
    if (enabled) { pending.current = false; app.setSetting('desktopLyricsEnabled', false); setNotice(''); return; }
    setWorking(true);
    try {
      if (await desktopLyrics.canDraw()) { app.setSetting('desktopLyricsEnabled', true); setNotice(''); }
      else {
        pending.current = true;
        setNotice('请允许显示在其他应用上层，返回后启用桌面歌词');
        await desktopLyrics.requestPermission();
      }
    } catch (error) { pending.current = false; setNotice(error instanceof Error ? error.message : '桌面歌词开启失败'); }
    finally { setWorking(false); }
  };
  return <View testID="desktop-lyrics-settings" style={s.root}>
    <View style={s.heading}>
      <View style={s.copy}>
        <Text style={[s.title, { color: theme.text }]}>桌面歌词</Text>
        <Text style={[s.description, { color: theme.muted }]}>在桌面和其它应用上显示，锁屏媒体卡片同步歌词；本软件内隐藏</Text>
      </View>
      <Pressable testID="desktop-lyrics-toggle" accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled: working }} disabled={working}
        onPress={toggle} style={[s.toggle, { backgroundColor: enabled ? theme.accent : theme.line }]}>
        <View style={[s.knob, enabled && s.knobOn]} />
      </Pressable>
    </View>
    {notice ? <Text accessibilityRole="alert" style={[s.notice, { color: theme.muted }]}>{notice}</Text> : null}
    <Text style={[s.description, { color: theme.muted }]}>未锁定时可拖动调整位置，右侧可锁定或直接关闭</Text>
    <ScrollView ref={styleList} testID="desktop-lyrics-styles-list" horizontal
      nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}
      onLayout={event => setStyleViewportWidth(event.nativeEvent.layout.width)}
      style={s.styleList} contentContainerStyle={[s.styleRow, { paddingRight: Math.max(0, styleViewportWidth - styleCardWidth) }]}>
      {desktopLyricStyles.map((item, index) => <Pressable key={item.id} testID={`desktop-lyrics-style-${item.id}`}
        accessibilityRole="radio" accessibilityState={{ checked: (app.state.settings.desktopLyricsStyle ?? 'center') === item.id }}
        onPress={() => {
          app.setSetting('desktopLyricsStyle', item.id);
          styleList.current?.scrollTo({
            x: index * (styleCardWidth + styleCardGap),
            animated: app.state.settings.motion !== 'off' && !app.state.settings.reducedMotion,
          });
        }}
        style={[s.card, { borderColor: (app.state.settings.desktopLyricsStyle ?? 'center') === item.id ? theme.accent : theme.line }]}>
        <LyricStylePreview style={item.id} accent={theme.accent} text={theme.text} soft={theme.panelSoft} />
        <Text style={[s.styleTitle, { color: theme.text }]}>{item.label}</Text>
        <Text style={[s.styleCopy, { color: theme.muted }]}>{item.copy}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

function LyricStylePreview({ style, accent, text, soft }: { style: DesktopLyricStyle; accent: string; text: string; soft: string }) {
  const line = <Text numberOfLines={1} style={{ color: accent, fontSize: 12, fontWeight: '600' }}>让每一首歌陪你</Text>;
  const next = <Text numberOfLines={1} style={{ color: text, fontSize: 10, marginTop: 4 }}>度过每一个日常</Text>;
  const cover = <View style={[s.previewCover, { backgroundColor: accent }]}><Text style={{ color: '#fff' }}>♪</Text></View>;
  return <View style={[s.preview, { backgroundColor: soft }]}>
    {style === 'capsule' || style === 'bottom' ? <View style={[s.capsule, { borderColor: accent }]}>{cover}<View style={{ flex: 1 }}>{line}{next}</View></View>
      : style === 'card' ? <View style={s.previewCard}><View style={s.previewHeader}>{cover}<Text style={{ color: text, fontSize: 10 }}>六六Music</Text></View>{line}{next}<View style={[s.progress, { backgroundColor: accent }]} /><Text style={{ color: text, textAlign: 'center' }}>◀ Ⅱ ▶</Text></View>
      : style === 'vertical' ? <View><Text style={{ color: text, opacity: .35, fontSize: 10 }}>在音乐里</Text>{line}{next}<Text style={{ color: text, opacity: .35, fontSize: 10, marginTop: 4 }}>遇见更好的自己</Text></View>
      : <View style={{ alignItems: 'center' }}>{line}{next}<View style={s.wave}>{[3, 7, 13, 9, 19, 12, 6, 11, 4].map((height, i) => <View key={i} style={{ width: 3, height: style === 'wave' ? height : height / 2, backgroundColor: accent, borderRadius: 2 }} />)}</View></View>}
  </View>;
}
const s = StyleSheet.create({
  root: { marginTop: 16 }, heading: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingVertical: 6 },
  copy: { flex: 1, paddingRight: 12 }, title: { fontSize: 15 }, description: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  toggle: { width: 52, height: 30, padding: 3, borderRadius: 15 }, knob: { width: 24, height: 24, backgroundColor: '#fff', borderRadius: 12 }, knobOn: { transform: [{ translateX: 22 }] },
  notice: { fontSize: 12, lineHeight: 18, marginVertical: 6 },
  styleList: { marginTop: 12 }, styleRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: styleCardGap },
  card: { width: styleCardWidth, flexShrink: 0, padding: 9, borderWidth: 1, borderRadius: 12 }, preview: { height: 106, borderRadius: 9, justifyContent: 'center', padding: 8 },
  styleTitle: { fontSize: 13, marginTop: 8 }, styleCopy: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 18, padding: 6 },
  previewCover: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  previewCard: { gap: 1 }, previewHeader: { flexDirection: 'row', gap: 7, alignItems: 'center', marginBottom: 4 },
  progress: { height: 2, width: '70%', marginTop: 6 }, wave: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 23, marginTop: 10 },
});
