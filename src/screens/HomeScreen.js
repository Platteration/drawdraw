import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '../theme';
import { buildHeadWireframe, HEAD_HEIGHT_UNITS } from '../lib/headModel';

/** Small static ¾-view head, drawn with the real model, as the app's mark. */
function HeadMark({ size = 132 }) {
  const wire = buildHeadWireframe(38, 8, 0);
  const ppu = (size * 0.86) / HEAD_HEIGHT_UNITS;
  const toPath = ({ points, closed }) =>
    points
      .map((p, i) => `${i ? 'L' : 'M'}${(size / 2 + p.x * ppu).toFixed(1)} ${(size / 2 - p.y * ppu).toFixed(1)}`)
      .join('') + (closed ? 'Z' : '');
  return (
    <Svg width={size} height={size}>
      {wire.back.map((p, i) => (
        <Path
          key={`b${i}`}
          d={toPath(p)}
          stroke={colors.accent}
          strokeOpacity={0.3}
          strokeWidth={1.6}
          strokeDasharray="4 4"
          fill="none"
        />
      ))}
      <Path d={toPath(wire.outline)} stroke={colors.accent} strokeWidth={1.9} fill="none" />
      {wire.front.map((p, i) => (
        <Path key={`f${i}`} d={toPath(p)} stroke={colors.accent} strokeWidth={1.9} fill="none" />
      ))}
    </Svg>
  );
}

export default function HomeScreen({ onImagePicked }) {
  const [busy, setBusy] = useState(false);

  const handleResult = (result) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.width || !asset.height) {
      Alert.alert('Unsupported image', 'Could not read the dimensions of that image.');
      return;
    }
    onImagePicked({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to pick a portrait.');
        return;
      }
      handleResult(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow camera access to take a portrait.');
        return;
      }
      handleResult(await ImagePicker.launchCameraAsync({ quality: 1 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <HeadMark />
      <Text style={styles.logo}>DrawDraw</Text>
      <Text style={styles.tagline}>
        The three-segment head — chin to nose, nose to brow, brow to crown — in three dimensions,
        laid over your portrait and turnable through a full circle.
      </Text>

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.primary]} onPress={pickFromLibrary} disabled={busy}>
          <Text style={styles.buttonText}>Choose a portrait</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={takePhoto} disabled={busy}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Take a photo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    backgroundColor: colors.paper,
  },
  logo: {
    color: colors.graphite,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  tagline: {
    color: colors.graphiteSoft,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 36,
  },
  buttons: {
    alignSelf: 'stretch',
    gap: 12,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.paperEdge,
  },
  buttonText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryText: {
    color: colors.graphite,
  },
});
