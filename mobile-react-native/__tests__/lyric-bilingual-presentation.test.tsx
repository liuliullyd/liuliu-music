import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, Text } from 'react-native';
import { StyledLyricLine, LyricPerformanceStage, LyricStyleButton, lyricStyles, lyricGraphemes } from '../src/components/LyricPresentation';

const original = '星光落在你眼中';
const translation = 'The stars shine in your eyes';
let renderer: Renderer.ReactTestRenderer;
const timing = jest.spyOn(Animated, 'timing');
beforeEach(() => timing.mockClear());
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
const collect = (node: Renderer.ReactTestInstance): string => node.findAllByType(Text)
  .filter(child => typeof child.props.children === 'string').map(child => child.props.children).join('').replace(/\n/g, '');
const flat = (id: string) => StyleSheet.flatten(renderer.root.findAllByProps({ testID: id })[0].props.style);
const rootClock = (value: any): any => value?._parent ? rootClock(value._parent) : value;
async function render(styleId: typeof lyricStyles[number]['id'], active = true, playing = true) {
  await act(async () => { renderer = Renderer.create(<StyledLyricLine styleId={styleId} active={active}
    playing={playing} color="#ffffff" text={original} translation={translation} cueDuration={4}/>); });
}

test('six choices include a default with full bilingual text and no animation', async () => {
  expect(lyricStyles.map(option => option.id)).toEqual(['default', 'art', 'vinyl', 'rock', 'ink', 'flow']);
  await render('default');
  expect(collect(renderer.root)).toContain(original + translation);
  expect(timing).not.toHaveBeenCalled();
});
test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s animates both complete scripts on the same native cue clock', async style => {
  await render(style);
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-original-typesetting' })[0])).toBe(original);
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-active-translation' })[0])).toBe(translation);
  expect(rootClock(flat('lyrics-active-glyph').opacity)).toBe(rootClock(flat('lyrics-translation-glyph').opacity));
  expect(timing.mock.calls.every(([, config]) => config.useNativeDriver && config.isInteraction === false)).toBe(true);
  expect(renderer.root.findAllByProps({ testID: `lyrics-${style}-typesetting` }).length).toBeGreaterThan(0);
  expect(flat(`lyrics-${style}-typesetting`).backgroundColor).toBeUndefined();
});
test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s omits inactive lines and never animates them', async style => {
  await render(style, false);
  expect(collect(renderer.root)).toBe('');
  expect(timing).not.toHaveBeenCalled();
});

test('five renderers differ in text grouping, composition and motion', async () => {
  const signatures: string[] = [];
  for (const style of ['art', 'vinyl', 'rock', 'ink', 'flow'] as const) {
    await render(style);
    const node = renderer.root.findAllByProps({ testID: 'lyrics-original-typesetting' })[0];
    const glyph = flat('lyrics-active-glyph');
    signatures.push(JSON.stringify({ text: node.findAllByType(Text).map(n => n.props.children),
      family: glyph.fontFamily, size: glyph.fontSize, transform: glyph.transform.map((t: object) => Object.keys(t)) }));
    await act(async () => renderer.unmount());
  }
  expect(new Set(signatures).size).toBe(5);
});
test('each new cue mounts a fresh clock while pausing does not run timing', async () => {
  await render('art');
  const before = rootClock(flat('lyrics-active-glyph').opacity);
  await act(async () => renderer.update(<StyledLyricLine styleId="art" active playing color="#fff" text="下一句" translation="Next line"/>));
  expect(rootClock(flat('lyrics-active-glyph').opacity)).not.toBe(before);
  timing.mockClear();
  await act(async () => renderer.update(<StyledLyricLine styleId="art" active playing={false} color="#fff" text="下一句" translation="Next line"/>));
  expect(timing).not.toHaveBeenCalled();
});
test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s preserves long bilingual Unicode lyrics', async styleId => {
  const text = '未演唱部分与正在演唱的文字都完整呈现'.repeat(4) + ' 👩🏽‍🎤e\u0301';
  const translated = 'A complete translation with long words and punctuation. '.repeat(5);
  await act(async () => { renderer = Renderer.create(<StyledLyricLine styleId={styleId} active playing={false}
    color="#fff" text={text} translation={translated}/>); });
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-original-typesetting' })[0])).toBe(text);
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-active-translation' })[0])).toBe(translated);
});
test('graphemes keep joined emoji and combining marks intact', () => {
  expect(lyricGraphemes('👩🏽‍🎤e\u0301')).toEqual(['👩🏽‍🎤', 'e\u0301']);
});
test('style button has a readable label, large touch target and no arrows', async () => {
  await act(async () => { renderer = Renderer.create(<LyricStyleButton open={false} onPress={() => {}}
    foreground={{ primary: '#fff', secondary: '#ccc', icon: '#fff' }}/>); });
  const button = renderer.root.findAllByProps({ testID: 'lyrics-style-button' })[0];
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(button.props.accessibilityLabel).toContain('歌词样式');
  expect(collect(button)).toBe('歌词样式');
});

test('rock packs short words across the available row before wrapping both scripts', async () => {
  await render('rock', true, false);
  for (const id of ['lyrics-original-typesetting', 'lyrics-active-translation']) {
    const style = flat(id);
    expect(style.flexDirection).toBe('row');
    expect(style.flexWrap).toBe('wrap');
  }
});

test('ink gives each language the full width with staggered brush columns and a wrapped translation', async () => {
  await render('ink', true, false);
  const originalStyle = flat('lyrics-original-typesetting');
  const translationStyle = flat('lyrics-active-translation');
  expect(originalStyle.width).toBe('100%');
  expect(originalStyle.flexDirection).toBe('row-reverse');
  expect(originalStyle.flex).toBeUndefined();
  expect(translationStyle.width).toBe('100%');
  expect(translationStyle.flexDirection).toBe('row');
  expect(translationStyle.flexWrap).toBe('wrap');
  expect(flat('lyrics-active-glyph').fontFamily).toBe('MaShanZheng-Regular');
  expect(renderer.root.findAllByProps({ testID: 'lyrics-ink-column' }).length).toBeGreaterThan(1);
  expect(renderer.root.findAllByProps({ testID: 'lyrics-ink-column' }).map(node => StyleSheet.flatten(node.props.style).paddingTop)).toContain(28);
});

test('ink uses independently revealed characters on one bilingual clock and keeps Latin words flowing', async () => {
  await act(async () => { renderer = Renderer.create(<StyledLyricLine styleId="ink" active playing
    color="#fff" text="A long original line with natural spacing" translation="长句译文也需要逐字落墨"/>); });
  const latin = renderer.root.findAllByProps({ testID: 'lyrics-original-typesetting' })[0];
  const chinese = renderer.root.findAllByProps({ testID: 'lyrics-active-translation' })[0];
  expect(flat('lyrics-original-typesetting').flexDirection).toBe('row');
  expect(flat('lyrics-active-glyph').fontFamily).toBe('serif');
  expect(latin.findAllByType(Text).every(node => !String(node.props.children).includes('\n'))).toBe(true);
  const letters = chinese.findAllByType(Text);
  expect(letters).toHaveLength(lyricGraphemes('长句译文也需要逐字落墨').length);
  expect(rootClock(flat('lyrics-translation-glyph').opacity)).toBe(rootClock(flat('lyrics-active-glyph').opacity));
  expect(letters.every(node => lyricGraphemes(String(node.props.children)).length === 1)).toBe(true);
});

const stageLines = [
  { time: 0, text: '上一句', translation: 'Previous cue' },
  { time: 5, text: original, translation },
  { time: 10, text: '下一句', translation: 'Next cue' },
];
const stage = (styleId: typeof lyricStyles[number]['id'], activeIndex = 1, onSeek = jest.fn()) =>
  <LyricPerformanceStage styleId={styleId} lines={stageLines} activeIndex={activeIndex}
    playing={false} duration={20} onSeek={onSeek}/>;
const layout = async (id: string, y: number, height: number) => {
  await act(async () => renderer.root.findAllByProps({ testID: id })[0].props.onLayout({
    nativeEvent: { layout: { x: 0, y, width: 360, height } },
  }));
};
test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s mounts only the current bilingual cue without context or transcript controls', async styleId => {
  await act(async () => { renderer = Renderer.create(stage(styleId)); });
  expect(collect(renderer.root)).toContain(original + translation);
  for (const text of ['上一句', '下一句', 'Previous cue', 'Next cue', '全部歌词', '返回动效']) expect(collect(renderer.root)).not.toContain(text);
  expect(renderer.root.findAllByProps({ testID: 'lyrics-transcript-toggle' })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ testID: 'lyrics-transcript' })).toHaveLength(0);
});

test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s seeks to the displayed cue on a single tap', async styleId => {
  const onSeek = jest.fn();
  await act(async () => { renderer = Renderer.create(stage(styleId, 1, onSeek)); });
  await act(async () => renderer.root.findAllByProps({ testID: 'lyrics-stage-current' })[0].props.onPress());
  await act(async () => renderer.update(stage(styleId, 2, onSeek)));
  await act(async () => renderer.root.findAllByProps({ testID: 'lyrics-stage-current' })[0].props.onPress());
  expect(onSeek.mock.calls).toEqual([[5], [10]]);
});

test('changing the current cue discards the outgoing composition and its fitted height', async () => {
  await act(async () => { renderer = Renderer.create(stage('rock')); });
  await layout('lyrics-stage-rock', 0, 500);
  await layout('lyrics-cue-content', 0, 1200);
  expect(flat('lyrics-active-line').height).toBe(468);
  await act(async () => renderer.update(stage('rock', 2)));
  expect(collect(renderer.root)).not.toContain(original);
  expect(collect(renderer.root)).toContain('下一句Next cue');
  expect(flat('lyrics-active-line')?.height).toBeUndefined();
});

test('the default style keeps inactive bilingual lines in the normal scrolling presentation', async () => {
  await render('default', false, false);
  expect(collect(renderer.root)).toContain(original + translation);
});

test.each(['art', 'vinyl', 'rock', 'ink', 'flow'] as const)('%s fits the entire long bilingual composition inside the viewport', async styleId => {
  await act(async () => { renderer = Renderer.create(stage(styleId)); });
  await layout('lyrics-stage-' + styleId, 44, 500);
  await layout('lyrics-cue-content', 0, 1200);
  expect(flat('lyrics-active-line').height).toBe(468);
  expect(flat('lyrics-cue-content').transform).toEqual([{ scale: .39 }]);
  expect(flat('lyrics-cue-content').transformOrigin).toBe('top center');
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-original-typesetting' })[0])).toBe(original);
  expect(collect(renderer.root.findAllByProps({ testID: 'lyrics-active-translation' })[0])).toBe(translation);
  await layout('lyrics-stage-' + styleId, 44, 700);
  expect(flat('lyrics-active-line').height).toBe(668);
});
