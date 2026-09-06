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
import HeadGuide from '../components/HeadGuide';
import HeadGestureLayer from '../components/HeadGestureLayer';

const THIRDS = [1 / 3, 2 / 3];
const GUIDE_COLORS = ['#ff3b6b', '#4f7cff', '#2bd97c', '#111114', '#ffffff'];
const LINE_THICKNESS = 2;
const TRACING_OPACITY = 0.3;
const MAX_EXPORT_DIMENSION = 4096;

const DEFAULT_HEAD = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };
const VIEW_PRESETS = [
  { label: 'Front', yaw: 0 },
  { label: '¾ view', yaw: 40 },
  { label: 'Profile', yaw: 90 },
];

export default function EditorScreen({ image, onClose }) {
  // 3D thirds head: chin→nose, nose→brow, brow→crown segment rings on a
  // rotatable head, positioned over the portrait.
  const [showHead, setShowHead] = useState(true);
  const [headTransform, setHeadTransform] = useState(DEFAULT_HEAD);
  const [mode, setMode] = useState('rotate'); // 'rotate' | 'move' | 'lines'

  // Optional flat 2D guide lines (fractions of the image), draggable.
  const [hGuides, setHGuides] = useState(THIRDS);
  const [vGuides, setVGuides] = useState(THIRDS);
  const [showHorizontal, setShowHorizontal] = useState(false);
  const [showVertical, setShowVertical] = useState(false);
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
  const anyLines = guides.horizontal.length > 0 || guides.vertical.length > 0;

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

  const resetAll = () => {
    setHeadTransform(DEFAULT_HEAD);
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
  const headInteractive = showHead && mode !== 'lines';

  // Everything that goes on top of the photo, mirrored 1:1 in the exports.
  const renderGuides = () => (
    <>
      {anyLines && (
        <GuideOverlay
          width={displayW}
          height={displayH}
          guides={guides}
          color={guideColor}
          thickness={LINE_THICKNESS}
        />
      )}
      {showHead && (
        <HeadGuide
          width={displayW}
          height={displayH}
          transform={headTransform}
          color={guideColor}
          thickness={LINE_THICKNESS}
        />
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.headerAction}>‹ New photo</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Thirds guide</Text>
        <Pressable onPress={resetAll} hitSlop={12}>
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
            {renderGuides()}
            {!headInteractive &&
              showHorizontal &&
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
            {!headInteractive &&
              showVertical &&
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
            {headInteractive && (
              <HeadGestureLayer
                mode={mode}
                transform={headTransform}
                onChange={setHeadTransform}
                width={displayW}
                height={displayH}
              />
            )}
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {showHead && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toggleRow}
          >
            <Chip label="Rotate" active={mode === 'rotate'} onPress={() => setMode('rotate')} />
            <Chip label="Move" active={mode === 'move'} onPress={() => setMode('move')} />
            {anyLines && (
              <Chip label="Edit lines" active={mode === 'lines'} onPress={() => setMode('lines')} />
            )}
            <View style={styles.divider} />
            {VIEW_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                onPress={() =>
                  setHeadTransform((t) => ({ ...t, yaw: preset.yaw, pitch: 0, roll: 0 }))
                }
              />
            ))}
          </ScrollView>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toggleRow}
        >
          <Chip label="3D head" active={showHead} onPress={() => setShowHead(!showHead)} />
          <Chip
            label="H lines"
            active={showHorizontal}
            onPress={() => setShowHorizontal(!showHorizontal)}
          />
          <Chip
            label="V lines"
            active={showVertical}
            onPress={() => setShowVertical(!showVertical)}
          />
          <Chip label="Center" active={showCenter} onPress={() => setShowCenter(!showCenter)} />
          <View style={styles.divider} />
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
          Drag to turn the head, pinch to size it, twist two fingers to tilt it, then line it up
          with the portrait. PNG exports keep transparency for layering in your drawing app.
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
            {renderGuides()}
          </View>
          <View
            ref={guidesOnlyRef}
            collapsable={false}
            style={{ width: displayW, height: displayH, backgroundColor: 'transparent' }}
          >
            {renderGuides()}
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

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, active && styles.toggleActive]}>
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
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
    paddingVertical: 6,
    gap: 8,
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: '#3a3a42',
    marginHorizontal: 4,
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
    marginTop: 6,
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
