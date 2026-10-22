import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

export type TrackActionKind = 'favorite' | 'playlist' | 'download';

/** One icon family for track and collection actions, independent of layout. */
export function TrackActionIcon({
  kind,
  active = false,
  size,
  color,
  testID,
}: {
  kind: TrackActionKind;
  active?: boolean;
  size: number;
  color: string;
  testID?: string;
}) {
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 42 42">
      {kind === 'favorite' ? (
        <Path
          d="M21 35.2 6.4 21.1A8.8 8.8 0 0 1 18.8 8.7L21 10.9l2.2-2.2a8.8 8.8 0 0 1 12.4 12.4Z"
          fill={active ? color : 'none'}
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      ) : kind === 'playlist' ? (
        <>
          <Path
            d="M6 11h19M6 18h14M6 25h10"
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <Circle
            cx={30}
            cy={27}
            r={7}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
          />
          {active ? (
            <Path
              d="m26.5 27 2.5 2.5 4.5-5"
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <>
              <Line
                x1={30}
                y1={23}
                x2={30}
                y2={31}
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
              <Line
                x1={26}
                y1={27}
                x2={34}
                y2={27}
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </>
          )}
        </>
      ) : (
        <Path
          d={
            active
              ? 'm11 19 7 7L31 10M8 30v5h26v-5'
              : 'M21 6v21M13 20l8 8 8-8M8 30v5h26v-5'
          }
          fill="none"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
