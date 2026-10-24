import React, { createContext, useContext } from 'react';
import type { AppSettings } from './domain/types';

export type ThemeId = AppSettings['theme'];

export interface ThemePalette {
  id: ThemeId;
  bg: string;
  panel: string;
  panelSoft: string;
  selectedSurface: string;
  text: string;
  muted: string;
  line: string;
  gold: string;
  accent: string;
  red: string;
  green: string;
  blue: string;
  shadow: string;
  dark: boolean;
}

const parseHexColor = (value: string): [number, number, number] | null => {
  const source = value.trim().replace(/^#/, '');
  const expanded =
    source.length === 3
      ? source
          .split('')
          .map(part => `${part}${part}`)
          .join('')
      : source;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map(index =>
    parseInt(expanded.slice(index, index + 2), 16),
  ) as [number, number, number];
};

const blendHexColors = (
  background: string,
  foreground: string,
  foregroundRatio: number,
) => {
  const base = parseHexColor(background);
  const tint = parseHexColor(foreground);
  if (!base || !tint) return background;
  const ratio = Math.max(0, Math.min(1, foregroundRatio));
  return `#${base
    .map((channel, index) =>
      Math.round(channel * (1 - ratio) + tint[index]! * ratio)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
};

const systemLight: ThemePalette = {
  id: 'white',
  bg: '#F5F7FB',
  panel: '#FFFFFF',
  panelSoft: '#EEF3FA',
  selectedSurface: blendHexColors('#EEF3FA', '#0878FF', 0.14),
  text: '#11141B',
  muted: '#758096',
  line: '#E5EAF2',
  gold: '#FFB400',
  accent: '#0878FF',
  red: '#FF3B5C',
  green: '#26B987',
  blue: '#0878FF',
  shadow: '#17305F',
  dark: false,
};

/** Complete tokens for the additional themes; the retained original palettes stay intact. */
const additionalPalette = (
  id: ThemeId,
  bg: string,
  accent: string,
  dark: boolean,
): ThemePalette => {
  const text = dark ? '#F4F7FB' : blendHexColors(bg, '#101823', 0.9);
  const panel = blendHexColors(bg, '#FFFFFF', dark ? 0.045 : 0.65);
  const panelSoft = blendHexColors(bg, accent, dark ? 0.11 : 0.08);
  return {
    id,
    bg,
    panel,
    panelSoft,
    selectedSurface: blendHexColors(panelSoft, accent, dark ? 0.18 : 0.14),
    text,
    muted: blendHexColors(bg, text, dark ? 0.67 : 0.65),
    line: blendHexColors(bg, text, dark ? 0.17 : 0.14),
    gold: dark ? '#E4BA75' : '#9D6B21',
    accent,
    red: dark ? '#FF8B9B' : '#BA4058',
    green: dark ? '#76D6A9' : '#26774F',
    blue: accent,
    shadow: dark ? '#060A12' : blendHexColors(bg, '#142437', 0.65),
    dark,
  };
};

const additionalPalettes = {
  'anime-school': additionalPalette(
    'anime-school',
    '#FFF2F5',
    '#BB496D',
    false,
  ),
  'anime-voyage': additionalPalette(
    'anime-voyage',
    '#EFF7FC',
    '#236D9C',
    false,
  ),
  'anime-ninja': additionalPalette('anime-ninja', '#121B2C', '#AD9DE9', true),
  'anime-train': additionalPalette('anime-train', '#F1F8EB', '#568239', false),
  'sport-basketball': additionalPalette(
    'sport-basketball',
    '#3F628F',
    '#FFE3B1',
    true,
  ),
  'sport-football': additionalPalette(
    'sport-football',
    '#154729',
    '#C6E997',
    true,
  ),
  'sport-tennis': additionalPalette(
    'sport-tennis',
    '#DEE4A1',
    '#52631D',
    false,
  ),
  'sport-swimming': additionalPalette(
    'sport-swimming',
    '#EAF8FB',
    '#197891',
    false,
  ),
  'film-space': additionalPalette('film-space', '#544A61', '#EDDDFF', true),
  'film-cyber': additionalPalette('film-cyber', '#DFC6D2', '#842A65', false),
  'film-wuxia': additionalPalette('film-wuxia', '#EDF5F0', '#3D7960', false),
  'film-romance': additionalPalette(
    'film-romance',
    '#FFF1F1',
    '#B95E70',
    false,
  ),
  'curated-dunhuang': additionalPalette(
    'curated-dunhuang',
    '#FEF6E5',
    '#A56835',
    false,
  ),
  'curated-deer': additionalPalette(
    'curated-deer',
    '#F1F6F2',
    '#386C60',
    false,
  ),
  'curated-butterfly': additionalPalette(
    'curated-butterfly',
    '#574424',
    '#F8D78E',
    true,
  ),
  'curated-rose': additionalPalette('curated-rose', '#681E37', '#FFB6D5', true),
};

const palettes: Record<ThemeId, ThemePalette> = {
  white: systemLight,
  sunset: {
    id: 'sunset',
    bg: '#FFF7F0',
    panel: '#FFFCF8',
    panelSoft: '#FBE9DA',
    selectedSurface: blendHexColors('#FBE9DA', '#E97845', 0.14),
    text: '#2B2521',
    muted: '#8A6F63',
    line: '#EEDFD3',
    gold: '#D99018',
    accent: '#E97845',
    red: '#D9535F',
    green: '#3B9B72',
    blue: '#E97845',
    shadow: '#7B4932',
    dark: false,
  },
  night: {
    id: 'night',
    bg: '#0E1726',
    panel: '#172235',
    panelSoft: '#202E45',
    selectedSurface: blendHexColors('#202E45', '#8B7CFF', 0.18),
    text: '#F6F8FC',
    muted: '#9AA9C1',
    line: '#2C3B52',
    gold: '#F2BD58',
    accent: '#8B7CFF',
    red: '#FF7188',
    green: '#55C99B',
    blue: '#8B7CFF',
    shadow: '#050A12',
    dark: true,
  },
  nature: {
    id: 'nature',
    bg: '#F2F7F2',
    panel: '#FCFFFC',
    panelSoft: '#E4F0E7',
    selectedSurface: blendHexColors('#E4F0E7', '#2B986D', 0.14),
    text: '#18241C',
    muted: '#687B6E',
    line: '#D6E5D9',
    gold: '#D49A27',
    accent: '#2B986D',
    red: '#D85868',
    green: '#2B986D',
    blue: '#2B986D',
    shadow: '#284C39',
    dark: false,
  },
  mist: {
    id: 'mist',
    bg: '#EEF8F1',
    panel: '#FAFFFB',
    panelSoft: '#E1F1E7',
    selectedSurface: blendHexColors('#E1F1E7', '#3D9A73', 0.14),
    text: '#1A2A22',
    muted: '#6D8477',
    line: '#D3E6D9',
    gold: '#C79639',
    accent: '#3D9A73',
    red: '#D85D70',
    green: '#3D9A73',
    blue: '#62B78D',
    shadow: '#315A45',
    dark: false,
  },
  ocean: {
    id: 'ocean',
    bg: '#EFF6FB',
    panel: '#FAFDFF',
    panelSoft: '#E0EEF7',
    selectedSurface: blendHexColors('#E0EEF7', '#2587B8', 0.14),
    text: '#172B3A',
    muted: '#69879A',
    line: '#D2E3EE',
    gold: '#D29A36',
    accent: '#2587B8',
    red: '#D85F72',
    green: '#3D9C83',
    blue: '#2587B8',
    shadow: '#2D526C',
    dark: false,
  },
  lavender: {
    id: 'lavender',
    bg: '#F5F0FC',
    panel: '#FCFAFF',
    panelSoft: '#ECE3F8',
    selectedSurface: blendHexColors('#ECE3F8', '#8B6FD3', 0.14),
    text: '#2A2240',
    muted: '#80759A',
    line: '#E0D6EF',
    gold: '#C79836',
    accent: '#8B6FD3',
    red: '#D66582',
    green: '#55A38C',
    blue: '#8B6FD3',
    shadow: '#55467B',
    dark: false,
  },
  sakura: {
    id: 'sakura',
    bg: '#FFF1F5',
    panel: '#FFF9FB',
    panelSoft: '#F9E1E9',
    selectedSurface: blendHexColors('#F9E1E9', '#D96B88', 0.14),
    text: '#38232C',
    muted: '#9A7480',
    line: '#F0D4DE',
    gold: '#C9973C',
    accent: '#D96B88',
    red: '#D85F72',
    green: '#6C9F82',
    blue: '#7A99B6',
    shadow: '#74495A',
    dark: false,
  },
  ...additionalPalettes,
};

export const themeDefaultAccents = Object.fromEntries(
  Object.entries(palettes).map(([id, palette]) => [id, palette.accent]),
) as Record<ThemeId, string>;

let activePalette = systemLight;
const ThemeContext = createContext<ThemePalette>(systemLight);

export const paletteForTheme = (id: ThemeId, accent?: string): ThemePalette => {
  const base = palettes[id] ?? palettes.white;
  const selectedAccent = accent?.trim() || base.accent;
  return {
    ...base,
    accent: selectedAccent,
    blue: selectedAccent,
    selectedSurface: blendHexColors(
      base.panelSoft,
      selectedAccent,
      base.dark ? 0.18 : 0.14,
    ),
  };
};

export function ThemeProvider({
  id,
  accent,
  children,
}: {
  id: ThemeId;
  accent?: string;
  children: React.ReactNode;
}) {
  activePalette = paletteForTheme(id, accent);
  return React.createElement(
    ThemeContext.Provider,
    { value: activePalette },
    children,
  );
}

export const useTheme = () => useContext(ThemeContext);

const dynamicPalette = new Proxy(systemLight, {
  get(_target, property: keyof ThemePalette) {
    return activePalette[property];
  },
}) as ThemePalette;

// Existing screens keep their accepted structure while both aliases now resolve
// to the selected palette instead of a fixed white color set.
export const dark = dynamicPalette;
export const light = dynamicPalette;
export const colors = dynamicPalette;

const colorMap = new Map(
  Object.entries(systemLight).flatMap(([key, value]) =>
    typeof value === 'string' && value.startsWith('#')
      ? [[value.toUpperCase(), key as keyof ThemePalette] as const]
      : [],
  ),
);

const recolor = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const key = colorMap.get(value.toUpperCase());
    return key ? activePalette[key] : value;
  }
  if (Array.isArray(value)) return value.map(recolor);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        recolor(entry),
      ]),
    );
  return value;
};

/** Resolve baseline theme tokens when a style record is read at render time. */
export const createThemedStyles = <T extends Record<string, unknown>>(
  styles: T,
): T =>
  new Proxy(styles, {
    get(target, property: string | symbol) {
      return recolor(Reflect.get(target, property));
    },
  });

export const radius = { sm: 12, md: 18, lg: 24, pill: 999 };
export const serif = 'sans-serif';
