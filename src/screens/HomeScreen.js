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
import {
  clearRecoveryCopies, createProject, deleteProject, hasRecoveryCopies, inspectRecoverableProjects, listProjects, recoverProjects,
} from '../lib/storage';

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
  const [storageError, setStorageError] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryCopies, setRecoveryCopies] = useState(false);

  const refresh = useCallback(() => {
    listProjects().then(setRecents).catch(() => {
      Alert.alert('Could not load drawings', 'Saved storage could not be read. Your saved index has not been replaced. Try reopening the app.');
    });
  }, []);

  useEffect(refresh, [refresh]);

  const recoverDrawings = async () => {
    if (busy) return;
    setBusy(true);
    setRecovering(true);
    setRecoveryError(null);
    try {
      const recovered = await recoverProjects();
      setRecents(recovered.projects);
      setRecoveryCopies(true);
      setRecovery(null);
      setStorageError(false);
    } catch (error) {
      setRecoveryError(String(error?.message ?? error));
    } finally {
      setRecovering(false);
      setBusy(false);
    }
  };

  const openAsset = async (result) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.width || !asset.height) {
      Alert.alert('Unsupported image', 'Could not read the dimensions of that image.');
      return;
    }
    const project = await createProject(asset);
    if (project.persistenceWarning) Alert.alert('Portrait is temporary', project.persistenceWarning);
    onOpenProject(project);
  };

  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // The system picker grants access to the selected image, not the whole library.
      await openAsset(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
    } catch (error) {
      Alert.alert('Could not open portrait', String(error?.message ?? error));
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
      await openAsset(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }));
    } catch (error) {
      Alert.alert('Could not take photo', String(error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (project) => {
    if (busy || recovery) return;
    Alert.alert('Remove drawing?', 'This removes the saved portrait and its active guide setup. Any recovery copies can be removed separately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProject(project.id);
            refresh();
          } catch (error) {
            Alert.alert('Could not remove drawing', String(error?.message ?? error));
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      {storageError && (
        <View accessibilityRole="alert">
          <Text style={[styles.recentsHint, { color: colors.graphite }]}>
            {recovery
              ? `${recovery.skippedCount > 0 ? `${recovery.skippedCount} saved drawing${recovery.skippedCount === 1 ? '' : 's'} could not be read. ` : ''}${recovery.resetSettingsCount > 0 ? `${recovery.resetSettingsCount} drawing${recovery.resetSettingsCount === 1 ? ' has' : 's have'} damaged guide settings and ${recovery.resetSettingsCount === 1 ? 'is' : 'are'} shown with defaults. ` : ''}${recovery.renamedIdCount > 0 ? 'Some saved drawings need recovery to keep their guide settings separate. ' : ''}Readable portraits are available below for export. Saving is paused until recovery.`
              : 'Saved drawings could not be loaded. Your saved data has not been replaced.'}
          </Text>
          {recovery && (
            <>
              <Text style={[styles.recentsHint, { color: colors.graphite }]}>
                Recovery keeps a copy of the original saved data and restores the readable drawings.
              </Text>
              <Pressable onPress={recoverDrawings} disabled={busy} accessibilityRole="button">
                <Text style={styles.footerLink}>{recovering ? 'Recovering…' : 'Recover saved drawings'}</Text>
              </Pressable>
            </>
          )}
          {recoveryError && <Text style={[styles.recentsHint, { color: colors.graphite }]}>{recoveryError}</Text>}
          <Pressable onPress={refresh} accessibilityRole="button">
            <Text style={styles.footerLink}>Retry loading drawings</Text>
          </Pressable>
        </View>
      )}

      {recents.length > 0 && (
        <View style={styles.recentsBlock}>
          <Text style={styles.recentsLabel}>Recent</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentsRow}>
            {recents.map((project, index) => (
              <View key={project.id} style={styles.recentCard}>
                <Pressable
                  onPress={() => onOpenProject(recovery ? { ...project, recoveryRequired: true } : project)}
                  onLongPress={busy || recovery ? undefined : () => confirmDelete(project)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open drawing ${index + 1}`}
                  accessibilityHint="Reopen this portrait and its guides."
                  style={styles.thumb}
                >
                  <Image source={{ uri: project.image.uri }} style={styles.thumbImage} />
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(project)}
                  disabled={busy || !!recovery}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove drawing ${index + 1}`}
                  accessibilityState={{ disabled: busy || !!recovery }}
                  style={styles.removeRecent}
                >
                  <Text style={styles.removeRecentText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.recentsHint}>
            {recovery ? 'Recover saved drawings before removing them.' : 'Tap a portrait to reopen · hold or choose Remove to remove'}
          </Text>
        </View>
      )}

      {recoveryCopies && (
        <Pressable onPress={confirmClearRecovery} accessibilityRole="button">
          <Text style={styles.footerLink}>Remove recovery copies</Text>
        </Pressable>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 24,
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
  recentCard: {
    alignItems: 'center',
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
  removeRecent: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  removeRecentText: {
    color: colors.graphiteSoft,
    fontSize: 11,
    fontWeight: '600',
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
