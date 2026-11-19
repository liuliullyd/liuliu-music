import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LyricStyle } from '../domain/lyricStyle';
export type { LyricStyle } from '../domain/lyricStyle';

export const lyricStyles = [
  { id: 'default', label: '默认', mark: '词', hint: '自然滚动' },
  { id: 'art', label: '艺术风格', mark: 'Aa', hint: '错落诗行' },
  { id: 'vinyl', label: '黑胶唱片机', mark: '◎', hint: '环形唱片' },
  { id: 'rock', label: '节奏摇滚', mark: 'ϟ', hint: '重拍冲击' },
  { id: 'ink', label: '古风书法', mark: '墨', hint: '纵横落墨' },
  { id: 'flow', label: '简约流光', mark: '≋', hint: '霓虹光潮' },
] as const;
type Foreground = { primary: string; secondary: string; icon: string };

export function useLyricMotionEnabled(playing: boolean) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  return playing && foreground;
}

export function LyricStyleButton({ open, onPress, foreground }: {
  open: boolean; onPress: () => void; foreground: Foreground;
}) {
  return <Pressable testID="lyrics-style-button" accessibilityRole="button" accessibilityLabel="歌词样式，选择歌词显示效果"
    hitSlop={8} accessibilityHint="展开默认样式和五种动效歌词" accessibilityState={{ expanded: open }} onPress={onPress}
    style={[s.styleButton, open && s.styleButtonOpen, { borderColor: foreground.secondary }]}>
    <Text style={[s.styleButtonLabel, { color: foreground.icon }]}>歌词样式</Text>
  </Pressable>;
}

// The entire horizontal picker belongs to the page, beyond the dock's touch bounds.
export function LyricStylePicker({ value, onChange, tone, foreground, top }: {
  value: LyricStyle; onChange: (value: LyricStyle) => void; tone: string;
  foreground: Foreground; top: number;
}) {
  return <View testID="lyrics-style-picker" style={[s.picker, { top, backgroundColor: tone }]}>
    <Text style={[s.pickerHeading, { color: foreground.primary }]}>选择歌词样式 · 原文与译文同步</Text>
    <View style={s.options}>{lyricStyles.map(option => <Pressable key={option.id} testID={'lyrics-style-' + option.id}
      accessibilityRole="button" accessibilityLabel={option.label + '，' + option.hint} accessibilityState={{ selected: value === option.id }}
      onPress={() => onChange(option.id)} style={[s.option, value === option.id && s.selected]}>
      <Text style={[s.optionMark, option.id === 'ink' && s.calligraphy, { color: foreground.primary },
        option.id === 'rock' && s.previewRock]}>{option.mark}</Text>
      <Text style={[s.optionLabel, { color: foreground.primary }]}>{option.label}</Text>
      <Text style={[s.optionHint, { color: foreground.secondary }]}>{option.hint}</Text>
      <Text style={[s.optionCheck, { color: foreground.primary }]}>{value === option.id ? '●' : '○'}</Text>
    </Pressable>)}</View>
  </View>;
}

// Preserve combining marks and joined emoji on Hermes versions without Intl.Segmenter.
export function lyricGraphemes(text: string) {
  const result: string[] = [];
  for (const char of Array.from(text)) {
    if (result.length && (/^[\p{Mark}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]$/u.test(char) || result[result.length - 1].endsWith('\u200D'))) {
      result[result.length - 1] += char;
    } else result.push(char);
  }
  return result;
}
export function inkColumns(text: string) {
  const chars = lyricGraphemes(text), rows = Math.min(6, Math.max(4, Math.ceil(chars.length / 3)));
  const columns: string[][] = [];
  for (let i = 0; i < chars.length; i += rows) columns.push(chars.slice(i, i + rows));
  return columns;
}
type EffectStyle = Exclude<LyricStyle, 'default'>;
type CueLine = { time: number; text: string; translation?: string };
type CueProps = { text: string; translation?: string; playing: boolean; cueDuration?: number };
type PerformanceProps = CueProps & { phase: Animated.Value };
const palette = {
  art: ['#FFF0DE', '#F4A8C1'], vinyl: ['#FFE2AA', '#EDD5B5'],
  rock: ['#FFF06A', '#9DF5ED'], ink: ['#F7EBD3', '#D9BD97'], flow: ['#B8FFF5', '#F6C4FF'],
};
const range = (phase: Animated.Value, start = 0, end = 1) => phase.interpolate({
  inputRange: [start, end], outputRange: [0, 1], extrapolate: 'clamp',
});
const interpolate = (phase: Animated.AnimatedInterpolation<number>, values: number[]) => phase.interpolate({
  inputRange: values.length === 3 ? [0, .72, 1] : [0, 1], outputRange: values,
});
const glyphId = (translation: boolean) => translation ? 'lyrics-translation-glyph' : 'lyrics-active-glyph';
const scriptId = (translation: boolean) => translation ? 'lyrics-active-translation' : 'lyrics-original-typesetting';
const chunks = (text: string, width: number) => {
  if (/\s/u.test(text)) return text.match(/\S+\s*|\s+/gu) ?? [text];
  const chars = lyricGraphemes(text), result: string[] = [];
  for (let i = 0; i < chars.length; i += width) result.push(chars.slice(i, i + width).join(''));
  return result;
};

// One cue clock coordinates the two languages. It does not imply word timestamps.
function PerformanceCue({ styleId, maxHeight, ...props }: CueProps & { styleId: EffectStyle; maxHeight?: number }) {
  const phase = useRef(new Animated.Value(props.playing ? 0 : 1)).current;
  const [contentHeight, setContentHeight] = useState(0);
  const scale = maxHeight && contentHeight > maxHeight ? maxHeight / contentHeight : 1;
  useEffect(() => {
    phase.setValue(props.playing ? 0 : 1);
    if (!props.playing) return;
    const animation = Animated.timing(phase, { toValue: 1,
      duration: Math.max(1200, Math.min(5600, (props.cueDuration ?? 3) * 850)),
      easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [phase, props.playing, props.cueDuration]);
  const Component = { art: ArtPerformance, vinyl: VinylPerformance, rock: RockPerformance,
    ink: InkPerformance, flow: FlowPerformance }[styleId];
  return <View testID="lyrics-active-line" style={scale < 1 ? { height: maxHeight } : undefined}>
    <View testID="lyrics-cue-content" onLayout={event => setContentHeight(event.nativeEvent.layout.height)}
      style={scale < 1 ? [s.fittedCue, { transform: [{ scale }], transformOrigin: 'top center' }] : undefined}>
      <Component {...props} phase={phase}/>
    </View>
  </View>;
}

function ArtPerformance({ text, translation, phase }: PerformanceProps) {
  const typeset = (value: string, translated: boolean) => {
    const words = chunks(value, translated ? 4 : 3);
    return <View testID={scriptId(translated)} style={[s.artPoem, translated && s.artPoemTranslation]}>
      {words.map((word, index) => {
        const p = range(phase, index / words.length * .6, .4 + index / words.length * .6);
        return <Animated.Text key={index} testID={index === 0 ? glyphId(translated) : undefined}
          style={[s.artWord, index % 3 === 0 ? s.artHeadline : s.artWhisper,
            translated && s.artTranslatedWord, index % 2 ? s.alignTrailing : s.alignLeading,
            { color: palette.art[translated ? 1 : 0], opacity: interpolate(p, [.15, 1]), transform: [
                { translateX: interpolate(p, [translated ? 65 : -65, 0]) },
                { rotate: p.interpolate({ inputRange: [0, 1], outputRange: [index % 2 ? '9deg' : '-9deg', index % 2 ? '2deg' : '-2deg'] }) },
              ] }]}>{word}</Animated.Text>;
      })}
    </View>;
  };
  return <View testID="lyrics-art-typesetting" style={s.artComposition}>
    <Text testID="lyrics-art-ornament" accessible={false} style={s.artQuote}>“</Text>
    {typeset(text, false)}{translation ? typeset(translation, true) : null}
  </View>;
}

function VinylPerformance({ text, translation, phase, playing }: PerformanceProps) {
  const orbit = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) return;
    orbit.setValue(0);
    const animation = Animated.loop(Animated.timing(orbit, { toValue: 1, duration: 20000,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    animation.start();
    return () => animation.stop();
  }, [orbit, playing]);
  return <View testID="lyrics-vinyl-typesetting" style={s.vinylComposition}>
    <View testID="lyrics-vinyl-ornament" pointerEvents="none" style={s.turntable}>
      <Animated.View testID="lyrics-vinyl-orbit" style={[s.record, { transform: [{ rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        {[232, 212, 190, 168, 146].map(size => <View key={size} style={[s.groove, { width: size, height: size, borderRadius: size / 2 }]}/>)}
        <View style={s.recordLabel}><Text style={s.recordLabelText}>LIULIU{ '\n' }SIDE A</Text><View style={s.spindle}/></View>
      </Animated.View><View style={s.toneArm}/>
    </View>
    <View style={s.recordSleeve}>
      <Text style={s.sideLabel}>NOW ON THE RECORD</Text>
      <View testID={scriptId(false)}><Animated.Text testID={glyphId(false)} style={[s.vinylTitle, {
        opacity: interpolate(range(phase), [.2, 1]), transform: [{ translateY: interpolate(range(phase), [30, 0]) }],
      }]}>{text}</Animated.Text></View>
      {translation ? <View testID={scriptId(true)}><Animated.Text testID={glyphId(true)} style={[s.vinylTranslation, {
        opacity: interpolate(range(phase), [.2, 1]), transform: [{ translateY: interpolate(range(phase), [-30, 0]) }],
      }]}>{translation}</Animated.Text></View> : null}
    </View>
  </View>;
}

function RockPerformance({ text, translation, phase }: PerformanceProps) {
  const typeset = (value: string, translated: boolean) => {
    const words = chunks(value, 2);
    return <View testID={scriptId(translated)} style={[s.rockWords, translated && s.rockTranslatedWords]}>
      {words.map((word, index) => {
        const p = range(phase, index / words.length * .7, .26 + index / words.length * .7);
        return <Animated.Text key={index} testID={index === 0 ? glyphId(translated) : undefined}
          style={[s.rockWord, translated && s.rockTranslation, { color: palette.rock[translated ? 1 : 0],
            opacity: interpolate(p, [0, 1]), transform: [
              { translateX: interpolate(p, [translated ? 24 : -24, -3, 0]) },
              { scale: interpolate(p, [.86, 1.04, 1]) }, { rotate: translated ? '3deg' : '-4deg' },
            ] }]}>{word}</Animated.Text>;
      })}
    </View>;
  };
  return <View testID="lyrics-rock-typesetting" style={s.rockComposition}>
    <Text testID="lyrics-rock-ornament" accessible={false} style={s.rockFlash}>ϟ</Text>
    <View style={s.rockSlash}/>{typeset(text, false)}{translation ? typeset(translation, true) : null}
  </View>;
}

function InkPerformance({ text, translation, phase }: PerformanceProps) {
  const typeset = (value: string, translated: boolean) => {
    const vertical = !translated && /[\u3400-\u9fff]/u.test(value);
    const glyphs = lyricGraphemes(value);
    const brush = /[\u3400-\u9fff]/u.test(value);
    const groups = vertical ? inkColumns(value) : [brush ? glyphs : chunks(value, 12)];
    let offset = 0;
    return <View testID={scriptId(translated)} style={[s.inkScript, vertical ? s.inkColumns : s.inkHorizontal,
      translated && s.inkTranslation]}>
      {groups.map((group, column) => {
        const start = offset;
        offset += group.length;
        const letters = group.map((letter, index) => {
          const ordinal = start + index;
          const count = vertical || brush ? glyphs.length : groups[0].length;
          const p = range(phase, ordinal / count * .62, .38 + ordinal / count * .62);
          return <Animated.Text key={index} testID={ordinal === 0 ? glyphId(translated) : undefined}
            style={[s.brush, !brush && s.brushLatin, translated && s.brushTranslation,
              { color: palette.ink[translated ? 1 : 0], opacity: interpolate(p, [.16, 1]), transform: [
                { translateX: interpolate(p, [translated ? -12 : 18, 0]) },
                { translateY: interpolate(p, [-16, 0]) }, { scale: interpolate(p, [1.18, 1]) },
                { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['6deg', ordinal % 3 === 0 ? '-3deg' : '0deg'] }) },
              ] }]}>{letter}</Animated.Text>;
        });
        return vertical ? <View key={column} testID="lyrics-ink-column" style={[s.inkColumn,
          column % 2 ? s.inkColumnLowered : s.inkColumnLeading]}>{letters}</View> : letters;
      })}
    </View>;
  };
  return <View testID="lyrics-ink-typesetting" style={s.inkComposition}>
    <View testID="lyrics-ink-ornament" pointerEvents="none" style={s.inkWash}>
      <View style={s.inkWashStroke}/><View style={s.inkWashTail}/>
    </View>
    {typeset(text, false)}
    <Animated.View pointerEvents="none" style={[s.inkRule, { opacity: interpolate(range(phase), [.1, .65]),
      transform: [{ scaleX: interpolate(range(phase), [.03, 1]) }, { rotate: '-3deg' }] }]}/>
    {translation ? typeset(translation, true) : null}
    <View style={s.inkSeal}><Text style={s.sealText}>听{ '\n' }音</Text></View>
  </View>;
}

function FlowPerformance({ text, translation, phase }: PerformanceProps) {
  const ribbon = (value: string, translated: boolean) => <View testID={scriptId(translated)} style={s.flowRibbon}>
    {lyricGraphemes(value).map((char, index, chars) => {
      const p = range(phase, index / chars.length * .55, .45 + index / chars.length * .55);
      const height = Math.sin(index * .58) * (translated ? -12 : 18);
      return <Animated.Text key={index} testID={index === 0 ? glyphId(translated) : undefined}
        style={[s.flowGlyph, translated && s.flowTranslation, { color: palette.flow[translated ? 1 : 0],
          opacity: interpolate(p, [.12, 1]), transform: [
            { translateY: interpolate(p, [height + (translated ? -32 : 42), height]) },
            { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', Math.cos(index * .58) * (translated ? -6 : 9) + 'deg'] }) },
          ] }]}>{char}</Animated.Text>;
    })}
  </View>;
  return <View testID="lyrics-flow-typesetting" style={s.flowComposition}>
    <Animated.View testID="lyrics-flow-ornament" pointerEvents="none" style={[s.flowBeam, {
      opacity: phase.interpolate({ inputRange: [0, .5, 1], outputRange: [.15, .8, .3] }),
      transform: [{ scaleX: interpolate(range(phase), [.05, 1]) }, { rotate: '-8deg' }],
    }]}/>{ribbon(text, false)}{translation ? ribbon(translation, true) : null}
  </View>;
}

export const StyledLyricLine = React.memo(function LyricLine({ styleId, active, color, distance = 0, ...props }: CueProps & {
  styleId: LyricStyle; active: boolean; color: string; distance?: number;
}) {
  if (styleId !== 'default') return active ? <PerformanceCue key={JSON.stringify([styleId, props.text, props.translation])} styleId={styleId} {...props}/> :
    null;
  const opacity = active ? 1 : Math.max(.26, .62 - Math.abs(distance) * .12);
  return <View testID={active ? 'lyrics-active-line' : undefined} style={[s.defaultLine, { opacity }]}>
    <Text testID={active ? 'lyrics-default-original' : undefined} style={[active ? s.defaultOriginal : s.context, { color }]}>{props.text}</Text>
    {props.translation ? <Text testID={active ? 'lyrics-active-translation' : undefined} style={[s.defaultTranslation, { color }]}>{props.translation}</Text> : null}
  </View>;
});

export function LyricPerformanceStage({ styleId, lines, activeIndex, playing, duration, style, onSeek }: {
  styleId: LyricStyle; lines: CueLine[]; activeIndex: number; playing: boolean; duration: number;
  style?: StyleProp<ViewStyle>;
  onSeek: (seconds: number) => void;
}) {
  const effect = styleId === 'default' ? 'art' : styleId;
  const index = Math.max(0, Math.min(lines.length - 1, activeIndex));
  const current = lines[index];
  const motion = useLyricMotionEnabled(playing);
  const cueKey = JSON.stringify([effect, index, current?.text, current?.translation]);
  const [viewportHeight, setViewportHeight] = useState(0);
  return <View testID="lyrics-performance-stage" accessibilityLabel={'歌词显示：' + styleId} style={style}>
    <View testID={'lyrics-stage-' + effect} style={[s.stageBody, effect === 'rock' && s.rockStage]}
      onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}>
      {current ? <Pressable
        key={cueKey}
        testID="lyrics-stage-current"
        accessibilityRole="button"
        accessibilityLabel={`跳转到 ${current.text}${current.translation ? `，${current.translation}` : ''}`}
        onPress={() => onSeek(current.time)}
      >
        <PerformanceCue styleId={effect} maxHeight={Math.max(0, viewportHeight - 32)}
          text={current.text} translation={current.translation} playing={motion}
          cueDuration={Math.max(1, (lines[index + 1]?.time ?? duration) - current.time)}/>
      </Pressable> : null}
    </View>
  </View>;
}

const s = StyleSheet.create({
  fittedCue: { position: 'absolute', top: 0, left: 0, right: 0 },
  styleButton: { minWidth: 92, minHeight: 48, paddingHorizontal: 14, marginRight: 6, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.08)' },
  styleButtonOpen: { backgroundColor: 'rgba(255,255,255,.24)', borderWidth: 2 }, styleButtonLabel: { fontSize: 14, fontWeight: '700', letterSpacing: .5 },
  picker: { position: 'absolute', left: 12, right: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,.24)', zIndex: 8, elevation: 12, padding: 8 },
  pickerHeading: { fontSize: 13, fontWeight: '700', margin: 6, marginBottom: 12 }, options: { flexDirection: 'row' },
  option: { flex: 1, minWidth: 0, paddingVertical: 8, alignItems: 'center', borderRadius: 12 }, selected: { backgroundColor: 'rgba(255,255,255,.18)' },
  optionMark: { fontSize: 28, lineHeight: 40, fontWeight: '700' }, previewRock: { transform: [{ rotate: '-12deg' }] },
  optionLabel: { fontSize: 10, marginTop: 7, fontWeight: '600', textAlign: 'center' }, optionHint: { fontSize: 9, marginTop: 5, textAlign: 'center' }, optionCheck: { fontSize: 11, marginTop: 7 },
  calligraphy: { fontFamily: 'MaShanZheng-Regular' },
  defaultLine: { paddingVertical: 18 }, defaultOriginal: { fontSize: 30, lineHeight: 44, fontWeight: '700' },
  defaultTranslation: { fontSize: 18, lineHeight: 30, opacity: .78, marginTop: 12 }, context: { fontSize: 21, lineHeight: 34 },
  alignLeading: { alignSelf: 'flex-start' }, alignTrailing: { alignSelf: 'flex-end' },
  stageBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 16 },
  rockStage: { paddingHorizontal: 30 },
  artComposition: { paddingVertical: 22, paddingHorizontal: 5 }, artQuote: { position: 'absolute', right: 0, top: -38, fontSize: 160, fontFamily: 'serif', color: '#F4A8C1', opacity: .14 },
  artPoem: { gap: 10 }, artPoemTranslation: { marginTop: 30, paddingLeft: 12 }, artWord: { fontFamily: 'serif', includeFontPadding: false, maxWidth: '100%' },
  artHeadline: { fontSize: 55, lineHeight: 70, fontWeight: '900' }, artWhisper: { fontSize: 33, lineHeight: 46, fontStyle: 'italic' }, artTranslatedWord: { fontSize: 26, lineHeight: 40 },
  vinylComposition: { alignItems: 'center', paddingVertical: 12 }, turntable: { width: 260, height: 260, marginVertical: 12 },
  record: { width: 260, height: 260, borderRadius: 130, backgroundColor: '#121212', borderWidth: 2, borderColor: '#51483D', alignItems: 'center', justifyContent: 'center' },
  groove: { position: 'absolute', borderWidth: 1, borderColor: '#37312B' }, recordLabel: { width: 114, height: 114, borderRadius: 57, backgroundColor: '#AA623E', alignItems: 'center', justifyContent: 'center', gap: 9 },
  recordLabelText: { fontFamily: 'serif', fontSize: 13, letterSpacing: 2, textAlign: 'center', color: '#FFE2AA' }, spindle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#161616' },
  toneArm: { position: 'absolute', right: 1, top: 0, width: 6, height: 130, borderRadius: 4, backgroundColor: '#C5BDAA', transform: [{ rotate: '-27deg' }] },
  recordSleeve: { width: '100%', paddingTop: 25, alignItems: 'center', gap: 16 }, sideLabel: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 3, color: '#D9AA67' },
  vinylTitle: { fontFamily: 'serif', fontSize: 30, lineHeight: 43, textAlign: 'center', color: '#FFE2AA' }, vinylTranslation: { fontFamily: 'monospace', fontSize: 18, lineHeight: 30, textAlign: 'center', color: '#EDD5B5' },
  rockComposition: { paddingVertical: 35, paddingHorizontal: 16 },
  rockWords: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  rockTranslatedWords: { justifyContent: 'flex-end', marginTop: 32 },
  rockWord: { fontFamily: 'sans-serif-condensed', fontSize: 56, lineHeight: 72, fontWeight: '900', fontStyle: 'italic', maxWidth: '100%', textShadowColor: '#C92D64', textShadowOffset: { width: 3, height: 3 }, textShadowRadius: 1 },
  rockTranslation: { fontSize: 28, lineHeight: 43 }, rockFlash: { position: 'absolute', right: -8, top: 0, fontSize: 230, color: '#FFF06A', opacity: .1 },
  rockSlash: { width: 65, height: 6, backgroundColor: '#C92D64', marginBottom: 25, transform: [{ rotate: '-12deg' }] },
  inkComposition: { paddingTop: 30, paddingBottom: 24, paddingHorizontal: 12 },
  inkScript: { width: '100%', minWidth: 0 },
  inkColumns: { flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'center', columnGap: 22, rowGap: 18 },
  inkColumn: { alignItems: 'center' },
  inkColumnLowered: { paddingTop: 28 }, inkColumnLeading: { paddingTop: 0 },
  inkHorizontal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline' },
  inkTranslation: { paddingHorizontal: 4, marginTop: 22 },
  brush: { fontFamily: 'MaShanZheng-Regular', fontSize: 48, lineHeight: 63, maxWidth: '100%', includeFontPadding: false },
  brushLatin: { fontFamily: 'serif', fontStyle: 'italic', fontSize: 34, lineHeight: 50 },
  brushTranslation: { fontSize: 28, lineHeight: 44 },
  inkWash: { position: 'absolute', left: 6, right: 6, top: '36%', height: 70, opacity: .08, transform: [{ rotate: '-12deg' }] },
  inkWashStroke: { width: '88%', height: 22, borderRadius: 12, backgroundColor: '#D9BD97' },
  inkWashTail: { width: '65%', height: 4, marginTop: 9, alignSelf: 'flex-end', backgroundColor: '#D9BD97' },
  inkRule: { alignSelf: 'center', width: '74%', height: 2, marginTop: 26, backgroundColor: '#D9BD97' },
  inkSeal: { alignSelf: 'flex-end', borderWidth: 1.5, borderColor: '#C86558', padding: 5, marginTop: 24, marginRight: 12, transform: [{ rotate: '-6deg' }] },
  sealText: { color: '#C86558', fontFamily: 'MaShanZheng-Regular', fontSize: 18, lineHeight: 21 },
  flowComposition: { paddingVertical: 35, gap: 45 }, flowRibbon: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingVertical: 18 },
  flowGlyph: { fontSize: 35, lineHeight: 58, fontWeight: '200', includeFontPadding: false, textShadowColor: '#50C9D5', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  flowTranslation: { fontSize: 23, lineHeight: 43, textShadowColor: '#D582F0' }, flowBeam: { position: 'absolute', height: 2, left: 10, right: 10, top: '48%', backgroundColor: '#B8FFF5' },
});
