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
import { Chip, Divider, PrimaryButton, SectionLabel, SliderRow } from '../components/ui';
import { colors, GUIDE_COLORS, type } from '../theme';
import {
  DEFAULT_ELEMENTS,
  DEFAULT_PROPORTIONS,
  ELEMENTS,
  PROPORTION_PRESETS,
} from '../lib/headModel';

const THIRDS = [1 / 3, 2 / 3];
const MAX_EXPORT_DIMENSION = 4096;

const DEFAULT_HEAD = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };
const VIEW_PRESETS = [
  { label: 'Front', yaw: 0, pitch: 0 },
  { label: '¾', yaw: 40, pitch: 0 },
  { label: 'Profile', yaw: 90, pitch: 0 },
  { label: 'Above', yaw: 25, pitch: 22 },
  { label: 'Below', yaw: 25, pitch: -22 },
];

export default function EditorScreen({ image, onClose }) {
  // 3D thirds head: chin→nose, nose→brow, brow→crown segment rings on a
  // rotatable head, positioned over the portrait.
  const [showHead, setShowHead] = useState(true);
  const [headTransform, setHeadTransform] = useState(DEFAULT_HEAD);
  const [mode, setMode] = useState('rotate'); // 'rotate' | 'move' | 'lines'

  // Which construction lines are drawn, and the head's proportions.
  const [elements, setElements] = useState(DEFAULT_ELEMENTS);
  const [proportions, setProportions] = useState(DEFAULT_PROPORTIONS);

  // Optional flat 2D guide lines (fractions of the image), draggable.
  const [hGuides, setHGuides] = useState(THIRDS);
  const [vGuides, setVGuides] = useState(THIRDS);
  const [showHorizontal, setShowHorizontal] = useState(false);
  const [showVertical, setShowVertical] = useState(false);
  const [showCenter, setShowCenter] = useState(false);

  const [guideColor, setGuideColor] = useState(GUIDE_COLORS[0].value);
  const [lineWeight, setLineWeight] = useState(2);
  const [tracingOpacity, setTracingOpacity] = useState(0.3);
  const [panel, setPanel] = useState('guide'); // 'guide' | 'build' | 'style'

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
    setProportions(DEFAULT_PROPORTIONS);
    setHGuides(THIRDS);
    setVGuides(THIRDS);
  };

  const toggleElement = (key) => setElements((prev) => ({ ...prev, [key]: !prev[key] }));
  const setProportion = (key, value) => setProportions((prev) => ({ ...prev, [key]: value }));

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
          thickness={lineWeight}
        />
      )}
      {showHead && (
        <HeadGuide
          width={displayW}
          height={displayH}
          transform={headTransform}
          elements={elements}
          proportions={proportions}
          color={guideColor}
          thickness={lineWeight}
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
        <Text style={type.title}>Three-segment head</Text>
        <Pressable onPress={resetAll} hitSlop={12}>
          <Text style={styles.headerAction}>Reset</Text>
        </Pressable>
      </View>

      <View
        style={styles.canvasArea}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setViewport({ width: width - 20, height: height - 20 });
        }}
      >
        {ready && (
          <View style={[styles.canvas, { width: displayW, height: displayH }]}>
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
        <View style={styles.tabs}>
          <Chip label="Guide" active={panel === 'guide'} onPress={() => setPanel('guide')} />
          <Chip label="Build" active={panel === 'build'} onPress={() => setPanel('build')} />
          <Chip label="Style" active={panel === 'style'} onPress={() => setPanel('style')} />
        </View>

        {panel === 'guide' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Chip label="Rotate" active={mode === 'rotate'} onPress={() => setMode('rotate')} />
              <Chip label="Move" active={mode === 'move'} onPress={() => setMode('move')} />
              {anyLines && (
                <Chip label="Lines" active={mode === 'lines'} onPress={() => setMode('lines')} />
              )}
              <Divider />
              {VIEW_PRESETS.map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  onPress={() =>
                    setHeadTransform((t) => ({ ...t, yaw: preset.yaw, pitch: preset.pitch, roll: 0 }))
                  }
                />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
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
            </ScrollView>
          </>
        ) : panel === 'build' ? (
          <>
            <SectionLabel>Construction lines</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {ELEMENTS.filter((el) => !el.always).map((el) => (
                <Chip
                  key={el.key}
                  label={el.label}
                  active={!!elements[el.key]}
                  onPress={() => toggleElement(el.key)}
                />
              ))}
            </ScrollView>
            <SectionLabel>Proportions</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {PROPORTION_PRESETS.map((preset) => (
                <Chip
                  key={preset.key}
                  label={preset.label}
                  onPress={() => setProportions(preset.values)}
                />
              ))}
            </ScrollView>
            <SliderRow
              label="Brow line"
              value={proportions.browY}
              min={0}
              max={0.9}
              step={0.02}
              onChange={(v) => setProportion('browY', v)}
              format={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Nose line"
              value={proportions.noseY}
              min={-0.9}
              max={-0.1}
              step={0.02}
              onChange={(v) => setProportion('noseY', v)}
              format={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Width"
              value={proportions.width}
              min={0.8}
              max={1.25}
              step={0.01}
              onChange={(v) => setProportion('width', v)}
              format={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Depth"
              value={proportions.depth}
              min={0.8}
              max={1.25}
              step={0.01}
              onChange={(v) => setProportion('depth', v)}
              format={(v) => v.toFixed(2)}
            />
          </>
        ) : (
          <>
            <SectionLabel>Guide color</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {GUIDE_COLORS.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setGuideColor(c.value)}
                  style={[
                    styles.swatch,
                    { backgroundColor: c.value },
                    c.value === guideColor && styles.swatchActive,
                  ]}
                />
              ))}
            </ScrollView>
            <SliderRow
              label="Line weight"
              value={lineWeight}
              min={1}
              max={6}
              step={0.5}
              onChange={setLineWeight}
              format={(v) => `${v.toFixed(1)}px`}
            />
            <SliderRow
              label="Tracing"
              value={tracingOpacity}
              min={0.05}
              max={0.85}
              step={0.05}
              onChange={setTracingOpacity}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </>
        )}

        <SectionLabel>Export · PNG at full resolution</SectionLabel>
        <View style={styles.exportRow}>
          <PrimaryButton
            label={'Photo\n+ guide'}
            tone="quiet"
            disabled={busy || !ready}
            onPress={() => exportView(combinedRef, 'Photo with guide')}
          />
          <PrimaryButton
            label={'Guide only\ntransparent'}
            disabled={busy || !ready}
            onPress={() => exportView(guidesOnlyRef, 'Transparent guide')}
          />
          <PrimaryButton
            label={'Tracing\nlayer'}
            tone="quiet"
            disabled={busy || !ready}
            onPress={() => exportView(tracingRef, 'Tracing layer')}
          />
        </View>
      </View>

      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.paper} />
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
              style={{ width: displayW, height: displayH, opacity: tracingOpacity }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerAction: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  canvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvasMat,
  },
  canvas: {
    backgroundColor: colors.paper,
  },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 8,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
  },
  row: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.paperEdge,
  },
  swatchActive: {
    borderColor: colors.graphite,
  },
  exportRow: {
    flexDirection: 'row',
    gap: 8,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46, 42, 38, 0.45)',
  },
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
  },
});
