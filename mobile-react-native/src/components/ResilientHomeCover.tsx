import React from 'react';
import {
  type ImageProps,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { OrderedRemoteCover, type CoverPriority } from './OrderedRemoteCover';

/** Load platform artwork first and reveal optional bundled artwork only on failure. */
export function ResilientHomeCover({
  uri,
  uris = [],
  fallback,
  testID,
  style,
  imageStyle,
  clipToImageStyle = false,
  resizeMethod,
  moduleKey,
  visualOrder,
  remotePending = false,
  priority = 'visible',
  onLoadedUri,
  onExhausted,
}: {
  uri?: string;
  uris?: string[];
  fallback?: ImageSourcePropType;
  testID: string;
  style: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  /** Apply the image's radius to the loading/fallback container as well. */
  clipToImageStyle?: boolean;
  resizeMethod?: ImageProps['resizeMethod'];
  moduleKey?: string;
  visualOrder?: readonly [number, number];
  /** Hide bundled artwork while the caller is still resolving the remote item. */
  remotePending?: boolean;
  priority?: CoverPriority;
  onLoadedUri?: (uri: string) => void;
  onExhausted?: () => void;
}) {
  return (
    <OrderedRemoteCover
      uris={[uri, ...uris]}
      fallback={fallback}
      testID={testID}
      moduleKey={moduleKey ?? testID}
      visualOrder={visualOrder}
      style={[
        style,
        clipToImageStyle ? (imageStyle as StyleProp<ViewStyle>) : null,
      ]}
      imageStyle={imageStyle}
      resizeMethod={resizeMethod}
      fallbackReady={!remotePending}
      priority={priority}
      onLoadedUri={onLoadedUri}
      onExhausted={onExhausted}
    />
  );
}
