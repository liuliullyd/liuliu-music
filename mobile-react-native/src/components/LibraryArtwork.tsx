import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { ResilientHomeCover } from './ResilientHomeCover';

/** Device artwork is decoded locally; remote artwork retains the shared loader. */
export function LibraryArtwork(
  props: React.ComponentProps<typeof ResilientHomeCover>,
) {
  const [failedUri, setFailedUri] = useState('');
  if (!/^(file|content):\/\//i.test(props.uri ?? ''))
    return <ResilientHomeCover {...props} />;
  const uri = props.uri!;
  return (
    <View
      testID={props.testID}
      collapsable={false}
      style={[
        props.style,
        props.clipToImageStyle && props.imageStyle,
        { position: 'relative', overflow: 'hidden' },
      ]}
    >
      <Image
        source={props.fallback}
        style={[StyleSheet.absoluteFill, props.imageStyle]}
        resizeMode="cover"
        fadeDuration={0}
      />
      {failedUri !== uri ? (
        <Image
          testID={`${props.testID}-local`}
          source={{ uri }}
          style={[StyleSheet.absoluteFill, props.imageStyle]}
          resizeMethod={props.resizeMethod}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={() => props.onLoadedUri?.(uri)}
          onError={() => setFailedUri(uri)}
        />
      ) : null}
    </View>
  );
}
