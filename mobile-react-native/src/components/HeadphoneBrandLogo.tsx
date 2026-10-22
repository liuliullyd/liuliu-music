import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
export function HeadphoneBrandLogo({ brandId, name }: { brandId: string; name: string }) {
  return <View testID={`headphone-brand-logo-${brandId}`} accessibilityLabel={`${name} 文字标识`} style={styles.logo}>
    <Text testID={`headphone-brand-wordmark-${brandId}`} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.55} style={styles.wordmark}>{name}</Text>
  </View>;
}
const styles = StyleSheet.create({
  logo: { width: 56, height: 34, borderRadius: 6, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  wordmark: { fontSize: 11, fontWeight: '700', color: '#000000', textAlign: 'center', paddingHorizontal: 3 },
});
