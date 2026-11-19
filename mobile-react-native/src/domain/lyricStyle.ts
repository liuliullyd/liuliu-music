export const lyricStyleIds = ['default', 'art', 'vinyl', 'rock', 'ink', 'flow'] as const;
export type LyricStyle = typeof lyricStyleIds[number];

export function normalizeLyricStyle(value: unknown): LyricStyle {
  return lyricStyleIds.includes(value as LyricStyle) ? value as LyricStyle : 'default';
}
