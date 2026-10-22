import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

/** Keep the scroll extent stable; mount a lower Home section only after scrolling near it. */
export function DeferredHomeSection({
  children,
  height,
  edge,
  testID,
}: {
  children: React.ReactNode;
  height: number;
  edge: number | null;
  testID: string;
}) {
  const [top, setTop] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (edge !== null && top !== null && edge >= top) setLoaded(true);
  }, [edge, top]);
  return (
    <View
      testID={testID}
      onLayout={event => setTop(event.nativeEvent.layout.y)}
      style={loaded ? undefined : { height }}
    >
      {loaded ? children : null}
    </View>
  );
}
