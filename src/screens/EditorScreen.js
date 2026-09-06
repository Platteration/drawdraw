import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import GuideOverlay from '../components/GuideOverlay';
import DraggableGuide from '../components/DraggableGuide';

const THIRDS = [1 / 3, 2 / 3];
const GUIDE_COLORS = ['#ff3b6b', '#4f7cff', '#2bd97c', '#111114', '#ffffff'];
const LINE_THICKNESS = 2;
const TRACING_OPACITY = 0.3;
const MAX_EXPORT_DIMENSION = 4096;

export default function EditorScreen({ image, onClose }) {
  // Guide positions as fractions of the image, seeded automatically at thirds
  // and adjustable by dragging (e.g. to line up with hairline / brow / nose).
  const [hGuides, setHGuides] = useState(THIRDS);
  const [vGuides, setVGuides] = useState(THIRDS);
  const [showHorizontal, setShowHorizontal] = useState(true);
  const [showVertical, setShowVertical] = useState(true);
  const [showCenter, setShowCenter] = useState(false);
  const [guideColor, setGuideColor] = useState(GUIDE_COLORS[0]);
  const [viewport, setViewport] = useState(null); // area available for the image
  const [busy, setBusy] = useState(false);

  const combinedRef = useRef(null); // photo + guides
  const guidesOnlyRef = useRef(null); // guides on transparency
  const tracingRef = useRef(null); // faded photo on transparency

  const guides = {
    horizontal: showHorizontal ? hGuides : [],
    vertical: [...(showVertical ? vGuides : []), ...(showCenter ? [0.5] : [])],
  };

  // Fit the image inside the measured viewport, preserving aspect ratio.
  let displayW = 0;
  let displayH = 0;
  if (viewport) {
    const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
    displayW = Math.floor(image.width * scale);
    displayH = Math.floor(image.height * scale);
  }

  // Export at the source resolution (capped so huge photos don't blow memory).
  const exportScale = Math.min(1, MAX_EXPORT_DIMENSION / Math.max(image.width, image.height));
  const exportW = Math.round(image.width * exportScale);
  const exportH = Math.round(image.height * exportScale);

  const updateGuide = (setter) => (index, fraction) =>
    setter((prev) => prev.map((f, i) => (i === index ? fraction : f)));
  const updateH = updateGuide(setHGuides);
  const updateV = updateGuide(setVGuides);

  const resetGuides = () => {
    setHGuides(THIRDS);
    setVGuides(THIRDS);
  };

  const exportView = async (ref, name) => {
    if (busy || !ref.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, {
        format: 'png',
        quality: 1,
        width: exportW,
        height: exportH,
      });

      Alert.alert(name, 'Where do you want it?', [
        {
          text: 'Save to Photos',
          onPress: async () => {
            try {
              const permission = await MediaLibrary.requestPermissionsAsync();
              if (!permission.granted) {
                Alert.alert('Permission needed', 'Allow photo library access to save exports.');
                return;
              }
              await MediaLibrary.saveToLibraryAsync(uri);
              Alert.alert('Saved', `${name} was saved to your photo library.`);
            } catch (err) {
              Alert.alert('Save failed', String(err?.message ?? err));
            }
          },
        },
        {
          text: 'Share…',
          onPress: async () => {
            try {
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'image/png' });
              } else {
                Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
              }
            } catch (err) {
              Alert.alert('Share failed', String(err?.message ?? err));
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } catch (err) {
      Alert.alert('Export failed', String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const ready = viewport && displayW > 0 && displayH > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.headerAction}>‹ New photo</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Guides</Text>
        <Pressable onPress={resetGuides} hitSlop={12}>
          <Text style={styles.headerAction}>Reset</Text>
        </Pressable>
      </View>

      <View
        style={styles.canvasArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setViewport({ width: width - 16, height: height - 16 });
        }}
      >
        {ready && (
          <View style={{ width: displayW, height: displayH }}>
            <Image source={{ uri: image.uri }} style={{ width: displayW, height: displayH }} />
            <GuideOverlay
              width={displayW}
              height={displayH}
              guides={guides}
              color={guideColor}
              thickness={LINE_THICKNESS}
            />
            {showHorizontal &&
              hGuides.map((fraction, i) => (
                <DraggableGuide
                  key={`h-${i}`}
                  orientation="horizontal"
                  fraction={fraction}
                  width={displayW}
                  height={displayH}
                  onChange={(f) => updateH(i, f)}
                />
              ))}
            {showVertical &&
              vGuides.map((fraction, i) => (
                <DraggableGuide
                  key={`v-${i}`}
                  orientation="vertical"
                  fraction={fraction}
                  width={displayW}
                  height={displayH}
                  onChange={(f) => updateV(i, f)}
                />
              ))}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toggleRow}>
          <Toggle label="Horizontal thirds" value={showHorizontal} onToggle={setShowHorizontal} />
          <Toggle label="Vertical thirds" value={showVertical} onToggle={setShowVertical} />
          <Toggle label="Center line" value={showCenter} onToggle={setShowCenter} />
          {GUIDE_COLORS.map((color) => (
            <Pressable
              key={color}
              onPress={() => setGuideColor(color)}
              style={[
                styles.swatch,
                { backgroundColor: color },
                color === guideColor && styles.swatchActive,
              ]}
            />
          ))}
        </ScrollView>

        <Text style={styles.exportHint}>
          Drag lines to line up with the face, then export. PNG exports keep transparency so they can
          be dropped straight into a drawing app as layers.
        </Text>

        <View style={styles.exportRow}>
          <ExportButton
            label={'Photo\n+ guides'}
            disabled={busy || !ready}
            onPress={() => exportView(combinedRef, 'Photo with guides')}
          />
          <ExportButton
            label={'Guides only\n(transparent)'}
            disabled={busy || !ready}
            onPress={() => exportView(guidesOnlyRef, 'Transparent guides')}
          />
          <ExportButton
            label={'Tracing layer\n(faded photo)'}
            disabled={busy || !ready}
            onPress={() => exportView(tracingRef, 'Tracing layer')}
          />
        </View>
      </View>

      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#f5f5f7" />
        </View>
      )}

      {/* Off-screen views captured for export. They mirror the on-screen
          overlay exactly and are scaled up to the source resolution. */}
      {ready && (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={combinedRef} collapsable={false} style={{ width: displayW, height: displayH }}>
            <Image source={{ uri: image.uri }} style={{ width: displayW, height: displayH }} />
            <GuideOverlay
              width={displayW}
              height={displayH}
              guides={guides}
              color={guideColor}
              thickness={LINE_THICKNESS}
            />
          </View>
          <View
            ref={guidesOnlyRef}
            collapsable={false}
            style={{ width: displayW, height: displayH, backgroundColor: 'transparent' }}
          >
            <GuideOverlay
              width={displayW}
              height={displayH}
              guides={guides}
              color={guideColor}
              thickness={LINE_THICKNESS}
            />
          </View>
          <View
            ref={tracingRef}
            collapsable={false}
            style={{ width: displayW, height: displayH, backgroundColor: 'transparent' }}
          >
            <Image
              source={{ uri: image.uri }}
              style={{ width: displayW, height: displayH, opacity: TRACING_OPACITY }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Toggle({ label, value, onToggle }) {
  return (
    <Pressable
      onPress={() => onToggle(!value)}
      style={[styles.toggle, value && styles.toggleActive]}
    >
      <Text style={[styles.toggleText, value && styles.toggleTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ExportButton({ label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.exportButton, disabled && styles.exportButtonDisabled]}
    >
      <Text style={styles.exportButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#f5f5f7',
    fontSize: 17,
    fontWeight: '700',
  },
  headerAction: {
    color: '#4f7cff',
    fontSize: 15,
    fontWeight: '600',
  },
  canvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  toggleRow: {
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  toggle: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#2a2a31',
  },
  toggleActive: {
    backgroundColor: '#4f7cff',
  },
  toggleText: {
    color: '#9a9aa5',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#f5f5f7',
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#3a3a42',
  },
  swatchActive: {
    borderColor: '#f5f5f7',
  },
  exportHint: {
    color: '#9a9aa5',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  exportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportButton: {
    flex: 1,
    backgroundColor: '#2a2a31',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  exportButtonDisabled: {
    opacity: 0.5,
  },
  exportButtonText: {
    color: '#f5f5f7',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 17,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 17, 20, 0.5)',
  },
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
});
