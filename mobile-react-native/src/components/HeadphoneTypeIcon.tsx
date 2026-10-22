import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import type { HeadphoneType } from '../services/headphones';

export const headphoneTypeLabel = (type: HeadphoneType) =>
  type === 'over-ear' || type === 'open' ? '头戴式' : type === 'earbud' ? '平头式' : '入耳式';
export function HeadphoneTypeIcon({ type, modelId }: { type: HeadphoneType; modelId: string }) {
  const theme = useTheme();
  const kind = type === 'open' ? 'over-ear' : type;
  return (
    <Svg testID={`headphone-type-icon-${modelId}`} accessibilityLabel={`${headphoneTypeLabel(type)}图标`}
      width={36} height={36} viewBox="0 0 48 48">
      {kind === 'over-ear' ? <>
        <Path d="M9 30V22a15 15 0 0 1 30 0v8M14 22a10 10 0 0 1 20 0" fill="none"
          stroke={theme.gold} strokeWidth={3} strokeLinecap="round" />
        <Rect x={6} y={26} width={9} height={15} rx={4} fill={theme.panelSoft} stroke={theme.gold} strokeWidth={2.5} />
        <Rect x={33} y={26} width={9} height={15} rx={4} fill={theme.panelSoft} stroke={theme.gold} strokeWidth={2.5} />
      </> : kind === 'earbud' ? <>
        <Circle cx={23} cy={17} r={10} fill={theme.panelSoft} stroke={theme.gold} strokeWidth={2.5} />
        <Circle cx={23} cy={17} r={6} fill="none" stroke={theme.gold} strokeWidth={1.5} />
        <Path d="M18 26v13a4 4 0 0 0 8 0V26M20 14h6M20 18h6M23 11v12" fill="none"
          stroke={theme.gold} strokeWidth={2} strokeLinecap="round" />
      </> : <>
        <Path d="M16 12c-6 1-10 6-9 12s7 9 13 8l10-5c4-2 5-7 2-10l-8-5c-3-2-5-1-8 0Z"
          fill={theme.panelSoft} stroke={theme.gold} strokeWidth={2.5} strokeLinejoin="round" />
        <Path d="m31 17 7-5 4 6-8 5M18 32l6 10M12 20c2-3 5-4 8-3" fill="none"
          stroke={theme.gold} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </Svg>
  );
}
