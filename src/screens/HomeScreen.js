import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '../theme';
import { buildHeadWireframe, HEAD_HEIGHT_UNITS } from '../lib/headModel';
import { createProject, deleteProject, listProjects } from '../lib/storage';

/** Small static ¾-view head, drawn with the real model, as the app's mark. */
function HeadMark({ size = 118 }) {
  const wire = buildHeadWireframe(38, 8, 0, { elements: { center: true, eyeLine: true } });
  const ppu = (size * 0.86) / HEAD_HEIGHT_UNITS;
  const toPath = ({ points, closed }) =>
    points
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${(size / 2 + p.x * ppu).toFixed(1)} ${(size / 2 - p.y * ppu).toFixed(1)}`
      )
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

export default function HomeScreen({ onOpenProject, pro = false, onRequestPro = () => {}, onReplayIntro = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState([]);

  const refresh = useCallback(() => {
    listProjects().then(setRecents);
  }, []);

  useEffect(refresh, [refresh]);

  const openAsset = async (result) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.width || !asset.height) {
      Alert.alert('Unsupported image', 'Could not read the dimensions of that image.');
      return;
    }
    const project = await createProject(asset);
    if (project.ephemeral) {
      // The durable copy failed, so this portrait only lasts as long as the
      // system keeps the picker's own file. Better to say so than to leave a
      // Recent thumbnail that goes blank later with no way to repair it.
      Alert.alert(
        'Opened, but not saved',
        'This portrait could not be copied into DrawDraw, so it will not appear under Recent. Your guide setup will not be kept either.'
      );
    }
    onOpenProject(project);
  };

  // No library permission is requested: the picker runs out of process
  // (PHPickerViewController on iOS, PickVisualMedia on Android) and hands back
  // only the one image the user chose. Asking would grant read access to the
  // whole camera roll for nothing, and a refusal would lock the user out of the
  // app's main entry point with no way back from inside it.
  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openAsset(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
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
      await openAsset(await ImagePicker.launchCameraAsync({ quality: 1 }));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (project) => {
    Alert.alert('Remove drawing?', 'This removes the saved portrait and its guide setup.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteProject(project.id);
          refresh();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <HeadMark />
        <Text style={styles.logo}>DrawDraw</Text>
        <Text style={styles.tagline}>
          The three-segment head — chin to nose, nose to brow, brow to crown — in three dimensions,
          laid over your portrait and turnable through a full circle.
        </Text>
      </View>

      <View style={styles.buttons}>
        <Pressable style={[styles.button, styles.primary]} onPress={pickFromLibrary} disabled={busy}>
          <Text style={styles.buttonText}>Choose a portrait</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondary]} onPress={takePhoto} disabled={busy}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Take a photo</Text>
        </Pressable>
      </View>

      {recents.length > 0 && (
        <View style={styles.recentsBlock}>
          <Text style={styles.recentsLabel}>Recent</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentsRow}>
            {recents.map((project) => (
              <Pressable
                key={project.id}
                onPress={() => onOpenProject(project)}
                onLongPress={() => confirmDelete(project)}
                style={styles.thumb}
              >
                <Image source={{ uri: project.image.uri }} style={styles.thumbImage} />
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.recentsHint}>Tap to reopen · hold to remove</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Pressable onPress={onReplayIntro} hitSlop={8}>
          <Text style={styles.footerLink}>How it works</Text>
        </Pressable>
        {!pro && (
          <>
            <Text style={styles.footerDot}>·</Text>
            <Pressable onPress={onRequestPro} hitSlop={8}>
              <Text style={[styles.footerLink, styles.footerLinkAccent]}>Unlock Pro</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
    backgroundColor: colors.paper,
  },
  hero: {
    alignItems: 'center',
  },
  logo: {
    color: colors.graphite,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  tagline: {
    color: colors.graphiteSoft,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 30,
  },
  buttons: {
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
  recentsBlock: {
    marginTop: 34,
  },
  recentsLabel: {
    color: colors.graphiteFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  recentsRow: {
    gap: 10,
  },
  thumb: {
    width: 62,
    height: 62,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.paperDeep,
    borderWidth: 1,
    borderColor: colors.paperEdge,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 26,
  },
  footerLink: {
    color: colors.graphiteSoft,
    fontSize: 13,
    fontWeight: '600',
  },
  footerLinkAccent: {
    color: colors.accent,
  },
  footerDot: {
    color: colors.graphiteFaint,
  },
  recentsHint: {
    color: colors.graphiteFaint,
    fontSize: 11,
    marginTop: 8,
  },
});
