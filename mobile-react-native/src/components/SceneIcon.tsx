import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/** Scene symbols use no device font or icon font. */
const paths: Readonly<Record<string, string>> = {
  phonk: 'M3 12h3l2-7 4 14 3-10 2 3h4M4 5v2m16 10v2',
  '80s':
    'M3 6h18v12H3ZM7 9a2 2 0 1 0 0 4a2 2 0 1 0 0-4m10 0a2 2 0 1 0 0 4a2 2 0 1 0 0-4M7 18l2-3h6l2 3',
  '90s':
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18m0 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4M5 9a8 8 0 0 1 4-4m6 14a8 8 0 0 0 4-4',
  'deep-emo': 'M15 3a9 9 0 1 0 6 13A8 8 0 0 1 15 3ZM7 13l-2 3a2 2 0 0 0 4 0Z',
  sleep:
    'M3 17h18M3 11v10m18-9v9M3 12h5V8H3Zm5 0h11a2 2 0 0 1 2 2v3M13 4h4l-4 4h4',
  'dynamic-dj':
    'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v6h4v-6Zm14 0h4v6h-4ZM9 14a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  commute:
    'M6 3h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM4 11h16M7 14h1m8 0h1M8 18l-3 3m11-3 3 3M9 3v8',
  happy: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M7 9h1m8 0h1M7 14q5 6 10 0',
  ktv: 'M16 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8ZM13 9 4 18l2 2 9-9M5 19l-2 2M14 5l4 4',
  jay: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-4 0h8M17 3l2 2 2-2',
  nostalgia: 'M12 3a9 9 0 1 0 9 9M12 6v6l-4 3M16 3h5v5m0-5-6 6',
  cantonese: 'M4 3h16v13H9l-5 5ZM8 7h8m-8 4h5m2-4v7a2 2 0 1 1-2-2',
  'chinese-style': 'M3 9q9-11 18 0l-9 12ZM12 21V4m0 17L6 6m6 15 6-15',
  workout: 'M3 8h3v8H3Zm3 3h12M18 8h3v8h-3ZM1 10v4m22-4v4M8 7v10m8-10v10',
  focus:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18m0 5a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 1v4m0 14v4M1 12h4m14 0h4',
  city: 'M3 21V8h6v13M9 21V3h6v18m0 0V11h6v10M1 21h22M5 11h2m4-4h2m-2 4h2m-2 4h2m4 0h2',
  ost: 'M3 9h18v12H3ZM3 5l17-3 1 5L4 10Zm3-1 3 4m3-5 3 4m-5 5 6 3-6 3Z',
  defjam:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18m0 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6M7 6 5 9m12 6-2 3',
  slacking: 'M4 12q7-9 14 0q-7 9-14 0Zm14 0 4-4v8ZM8 11h.1M10 6l3 2m-3 8 3 2',
  faye: 'M10 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3ZM4 12a6 6 0 0 0 12 0M10 18v3m-4 0h8M19 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z',
  rock: 'M17 3l4 4-8 8c1 4-3 7-6 5-5-1-5-7-1-9 1-2 4-2 6-1ZM8 14l2 2M15 6l3 3M18 2l4 4',
  rnb: 'M3 15q3-8 6 0t6 0t6 0M3 8q3-5 6 0t6 0t6 0M6 20h12',
  relax:
    'M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5M4 10a2 2 0 0 0-2 2v6h20v-6a2 2 0 0 0-4 0v3H6v-3a2 2 0 0 0-2-2ZM5 18v3m14-3v3',
  children:
    'M12 3c-9 0-8 12 0 14 8-2 9-14 0-14ZM10 18h4m-2-1v4q-4-2-5 1M8 7q0-2 3-2',
  kpop: 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1ZM10 11v4m4-4v4',
  western:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3q-8 9 0 18q8-9 0-18M5 7h14M5 17h14',
  jpop: 'M12 3c-3-4-7 0-4 4-5-2-8 4-3 6-3 5 2 8 5 5-1 5 5 5 6 0 4 2 8-3 4-6 4-4 0-8-4-5 2-5-3-8-4-4ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  electronic: 'M14 2 4 14h7l-1 8L21 9h-8Z',
  rap: 'M8 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM2 11v1a6 6 0 0 0 12 0v-1M8 18v3m-4 0h8M17 7v10m4-7v4',
  travel: 'M22 3 2 10l8 3 3 8ZM10 13 22 3M5 18l-3 3m5-1-1 2',
  shower:
    'M5 21V6a3 3 0 0 1 6 0v1M8 10h9l-2-3h-5ZM9 13v2m4-2v2m4-2v2m-6 3v2m4-2v2',
  classical:
    'M13 3c-5 2-5 7 0 10s3 8-1 8c-3 0-4-3-2-5 3-3 8 0 6 3M12 3l2 18M8 16c-5-3-2-8 3-10s5-5 2-5',
  night: 'M15 3a9 9 0 1 0 6 13A8 8 0 0 1 15 3ZM19 3v4m-2-2h4M5 3v2M3 4h4',
  healing: 'M12 20 4 12c-5-5 2-12 8-5 6-7 13 0 8 5ZM4 12h4l2-4 3 8 2-4h5',
  'light-music':
    'M10 17V5l10-2v12M10 7l10-2M10 17c-1-4-9-2-8 2s8 2 8-2Zm10-2c-1-4-9-2-8 2s8 2 8-2Z',
  bistro: 'M6 3h12v5a6 6 0 0 1-12 0ZM6 7h12M12 14v7m-5 0h10',
  romance: 'M12 20 4 12C-2 6 7 0 12 7c5-7 14-1 8 5ZM18 2v4m-2-2h4',
  zen: 'M12 20c-5 0-9-3-10-7 4-1 7 0 10 4 3-4 6-5 10-4-1 4-5 7-10 7ZM12 17C6 12 8 6 12 3c4 3 6 9 0 14Z',
  rain: 'M5 13a4 4 0 1 1 2-7 6 6 0 0 1 11 2 3 3 0 0 1 0 6H5M7 17l-1 3m6-3-1 3m6-3-1 3',
  beach:
    'M3 19q3-3 6 0t6 0t6 0M13 17l3-11M16 6q-4-5-8 0 5-1 8 0q4-5 7 0-4-1-7 0q3 1 5 5-1-5-5-5M3 4v4m-2-2h4',
  country: 'M3 21V9l9-6 9 6v12ZM8 21v-8h8v8M8 13l8 8m0-8-8 8M3 9h18M10 7h4',
  breakup: 'M11 5c-6-7-15 1-7 8l8 8 8-8c8-7-1-15-7-8l-3 4 4 4-3 3',
  game: 'M6 7h12c4 0 6 12 2 13-2 0-4-4-5-4H9c-1 0-3 4-5 4-4-1-2-13 2-13ZM7 10v6m-3-3h6m6-2h.1m3 3h.1M12 7V3',
  campus: 'M2 8l10-5 10 5-10 5ZM6 10v7q6 5 12 0v-7m4-2v9',
  wakeup:
    'M12 5a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 8v5l3 2M3 5l3-3m12 0 3 3M6 20l-2 2m14-2 2 2',
};

export function SceneIcon({
  id,
  size,
  color,
  loading = false,
}: {
  id: string;
  size: number;
  color: string;
  loading?: boolean;
}) {
  return (
    <Svg
      testID={`scene-icon-${id}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
    >
      {loading ? (
        [6, 12, 18].map(cx => (
          <Circle key={cx} cx={cx} cy={12} r={1.5} fill={color} />
        ))
      ) : (
        <Path
          d={paths[id.replace(/^scene-/, '')] ?? paths['light-music']}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
