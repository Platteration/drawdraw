import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

import GuideOverlay from '../components/GuideOverlay';
import DraggableGuide from '../components/DraggableGuide';
import HeadGuide from '../components/HeadGuide';
import HeadGestureLayer from '../components/HeadGestureLayer';
import TurnaroundSheet, { SHEET_SIZE } from '../components/TurnaroundSheet';
import FitOverlay from '../components/FitOverlay';
import { Chip, Divider, PrimaryButton, SectionLabel, SliderRow } from '../components/ui';
import { colors, GUIDE_COLORS, type } from '../theme';
import {
  DEFAULT_ELEMENTS,
  DEFAULT_PROPORTIONS,
  ELEMENTS,
  PROPORTION_PRESETS,
} from '../lib/headModel';
import { captureSize } from '../lib/exportSize';
import { saveSettings } from '../lib/storage';
import { FIT_STEPS, solveHeadFromTaps } from '../lib/fitSolver';

const THIRDS = [1 / 3, 2 / 3];
const MAX_EXPORT_DIMENSION = 4096;
const TURNAROUND_SCALE = 3; // sheet is laid out small and captured at 3×
const STEP_INTERVAL = 1100;

const DEFAULT_HEAD = { yaw: 0, pitch: 0, roll: 0, x: 0.5, y: 0.45, scale: 0.6 };
const VIEW_PRESETS = [
  { label: 'Front', yaw: 0, pitch: 0 },
  { label: '¾', yaw: 40, pitch: 0 },
  { label: 'Profile', yaw: 90, pitch: 0 },
  { label: 'Above', yaw: 25, pitch: 22 },
  { label: 'Below', yaw: 25, pitch: -22 },
];

/** Construction order used by step-by-step reveal. */
const BUILD_ORDER = ELEMENTS.map((el) => el.key);

export default function EditorScreen({ project, onClose, pro = false, onRequestPro = () => {} }) {
  const image = project.image;
  const saved = project.settings || {};

  // 3D thirds head: chin→nose, nose→brow, brow→crown segment rings on a
  // rotatable head, positioned over the portrait.
  const [showHead, setShowHead] = useState(saved.showHead ?? true);
  const [headTransform, setHeadTransform] = useState(saved.headTransform ?? DEFAULT_HEAD);
  const [mode, setMode] = useState('rotate'); // 'rotate' | 'move' | 'lines' | 'fit'
  const [fitTaps, setFitTaps] = useState([]);
  const [interacting, setInteracting] = useState(false); // a gesture is in flight

  // Which construction lines are drawn, and the head's proportions.
  const [elements, setElements] = useState(saved.elements ?? DEFAULT_ELEMENTS);
  const [proportions, setProportions] = useState(saved.proportions ?? DEFAULT_PROPORTIONS);

  // Optional flat 2D guide lines (fractions of the image), draggable.
  const [hGuides, setHGuides] = useState(saved.hGuides ?? THIRDS);
  const [vGuides, setVGuides] = useState(saved.vGuides ?? THIRDS);
  const [showHorizontal, setShowHorizontal] = useState(saved.showHorizontal ?? false);
  const [showVertical, setShowVertical] = useState(saved.showVertical ?? false);
  const [showCenter, setShowCenter] = useState(saved.showCenter ?? false);

  const [guideColor, setGuideColor] = useState(saved.guideColor ?? GUIDE_COLORS[0].value);
  const [lineWeight, setLineWeight] = useState(saved.lineWeight ?? 2);
  const [tracingOpacity, setTracingOpacity] = useState(saved.tracingOpacity ?? 0.3);
  const [panel, setPanel] = useState('guide'); // 'guide' | 'build' | 'style'

  // Practice mode hides the photo so you draw from the guide alone.
  const [practice, setPractice] = useState(false);
  const [peeking, setPeeking] = useState(false);

  // Step-by-step reveal: null when off, otherwise how far through the
  // construction order we are.
  const [step, setStep] = useState(null);
  const [playing, setPlaying] = useState(false);

  const [viewport, setViewport] = useState(null); // area available for the image
  const [busy, setBusy] = useState(false);

  const combinedRef = useRef(null); // photo + guides
  const guidesOnlyRef = useRef(null); // guides on transparency
  const tracingRef = useRef(null); // faded photo on transparency
  const turnaroundRef = useRef(null); // six-view contact sheet

  // Elements actually drawn: the step sequence overrides manual toggles.
  const activeElements = useMemo(() => {
    const chosen = {};
    if (step === null) {
      Object.assign(chosen, elements);
    } else {
      for (let i = 0; i <= step && i < BUILD_ORDER.length; i++) chosen[BUILD_ORDER[i]] = true;
    }
    if (pro) return chosen;
    const free = {};
    for (const el of ELEMENTS) if (!el.pro && chosen[el.key]) free[el.key] = true;
    return free;
  }, [step, elements, pro]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setStep((s) => {
        if (s === null || s >= BUILD_ORDER.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, STEP_INTERVAL);
    return () => clearInterval(id);
  }, [playing]);

  // Persist the setup so reopening the portrait resumes exactly as left.
  const settings = useMemo(
    () => ({
      showHead,
      headTransform,
      elements,
      proportions,
      hGuides,
      vGuides,
      showHorizontal,
      showVertical,
      showCenter,
      guideColor,
      lineWeight,
      tracingOpacity,
    }),
    [
      showHead,
      headTransform,
      elements,
      proportions,
      hGuides,
      vGuides,
      showHorizontal,
      showVertical,
      showCenter,
      guideColor,
      lineWeight,
      tracingOpacity,
    ]
  );

  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings(project.id, settings).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [project.id, settings]);

  // Android's hardware/gesture Back. Without a subscriber it falls through to
  // the default handler and closes the app instead of leaving the editor. The
  // editor has its own shallow stack: a fit in progress is backed out of first,
  // so three-tap fits are not silently discarded. Android only: the handler is
  // a no-op stub on iOS and logs an error on react-native-web.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'fit') {
        setFitTaps([]);
        setMode('rotate');
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mode, onClose]);

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
    setStep(null);
    setPlaying(false);
  };

  const toggleElement = (key) => setElements((prev) => ({ ...prev, [key]: !prev[key] }));
  const setProportion = (key, value) => setProportions((prev) => ({ ...prev, [key]: value }));

  const startFit = () => {
    setFitTaps([]);
    setMode('fit');
    setShowHead(true);
  };

  const handleFitTap = (point) => {
    const taps = [...fitTaps, point];
    if (taps.length < FIT_STEPS.length) {
      setFitTaps(taps);
      Haptics.selectionAsync().catch(() => {});
      return;
    }
    const solved = solveHeadFromTaps(taps, { width: displayW, height: displayH }, proportions);
    setFitTaps([]);
    setMode('rotate');
    if (solved) {
      setHeadTransform(solved);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Alert.alert(
        'Could not fit',
        'Those three points were too close together to read a pose. Try again, tapping the chin, the base of the nose, and the brow.'
      );
    }
  };

  // `size` is the wanted output in PIXELS; captureSize turns it into whatever
  // unit this platform's view-shot expects (see src/lib/exportSize.js).
  const exportView = async (ref, name, size) => {
    if (busy || !ref.current) return;
    setBusy(true);
    try {
      const uri = await captureRef(ref, {
        format: 'png',
        quality: 1,
        ...captureSize(size, { platform: Platform.OS, pixelRatio: PixelRatio.get() }),
      });

      Alert.alert(name, 'Where do you want it?', [
        {
          text: 'Save to Photos',
          onPress: async () => {
            try {
              // Add-only: the app never reads or enumerates the library, so
              // it asks for the write scope alone (no 'All Photos' grant, and
              // no runtime prompt at all on Android 13+).
              const permission = await MediaLibrary.requestPermissionsAsync(true);
              if (!permission.granted) {
                Alert.alert(
                  'Permission needed',
                  'Allow DrawDraw to add photos to your library to save exports.'
                );
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

  const photoSize = { width: exportW, height: exportH };
  const ready = viewport && displayW > 0 && displayH > 0;
  const headInteractive = showHead && mode !== 'lines' && mode !== 'fit';
  const linesEditable = mode === 'lines';
  const photoVisible = !practice || peeking;

  // Everything that goes on top of the photo, mirrored 1:1 in the exports.
  const renderGuides = ({ draft = false } = {}) => (
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
          elements={activeElements}
          proportions={proportions}
          color={guideColor}
          thickness={lineWeight}
          draft={draft}
        />
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.headerAction}>‹ Portraits</Text>
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
            <Image
              source={{ uri: image.uri }}
              style={{ width: displayW, height: displayH, opacity: photoVisible ? 1 : 0 }}
            />
            {renderGuides({ draft: interacting })}
            {linesEditable &&
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
            {linesEditable &&
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
            {mode === 'fit' && (
              <FitOverlay
                width={displayW}
                height={displayH}
                taps={fitTaps}
                onTap={handleFitTap}
                color={guideColor}
              />
            )}
            {headInteractive && (
              <HeadGestureLayer
                mode={mode}
                transform={headTransform}
                onChange={setHeadTransform}
                onInteractingChange={setInteracting}
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

        <ScrollView
          style={styles.panel}
          contentContainerStyle={styles.panelContent}
          showsVerticalScrollIndicator={false}
        >
        {panel === 'guide' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Chip label="Fit to face" active={mode === 'fit'} onPress={startFit} />
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
              <Divider />
              <Chip label="Practice" active={practice} onPress={() => setPractice(!practice)} />
              {practice && (
                <Pressable
                  onPressIn={() => setPeeking(true)}
                  onPressOut={() => setPeeking(false)}
                  style={[styles.peek, peeking && styles.peekActive]}
                >
                  <Text style={[styles.peekText, peeking && styles.peekTextActive]}>
                    Hold to peek
                  </Text>
                </Pressable>
              )}
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
                  active={!!activeElements[el.key]}
                  locked={el.pro && !pro}
                  disabled={step !== null}
                  onPress={() => (el.pro && !pro ? onRequestPro() : toggleElement(el.key))}
                />
              ))}
            </ScrollView>

            <SectionLabel>Build it up step by step</SectionLabel>
            <View style={styles.row}>
              <Chip
                label={step === null ? 'Start' : 'Exit'}
                active={step !== null}
                locked={!pro}
                onPress={() => {
                  if (!pro) {
                    onRequestPro();
                    return;
                  }
                  setStep(step === null ? 0 : null);
                  setPlaying(false);
                }}
              />
              {step !== null && (
                <>
                  <Chip label="‹" onPress={() => setStep((s) => Math.max(0, s - 1))} />
                  <Chip
                    label="›"
                    onPress={() => setStep((s) => Math.min(BUILD_ORDER.length - 1, s + 1))}
                  />
                  <Chip
                    label={playing ? 'Pause' : 'Play'}
                    active={playing}
                    onPress={() => setPlaying((p) => !p)}
                  />
                  <Text style={styles.stepLabel}>
                    {step + 1}/{BUILD_ORDER.length} · {ELEMENTS[step].label}
                  </Text>
                </>
              )}
            </View>

            <SectionLabel>Proportions</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {PROPORTION_PRESETS.map((preset) => (
                <Chip
                  key={preset.key}
                  label={preset.label}
                  locked={preset.pro && !pro}
                  onPress={() =>
                    preset.pro && !pro ? onRequestPro() : setProportions(preset.values)
                  }
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

        </ScrollView>

        <SectionLabel>Export · PNG at full resolution</SectionLabel>
        <View style={styles.exportRow}>
          <PrimaryButton
            label={'Photo\n+ guide'}
            tone="quiet"
            disabled={busy || !ready}
            onPress={() => exportView(combinedRef, 'Photo with guide', photoSize)}
          />
          <PrimaryButton
            label={'Guide only\ntransparent'}
            disabled={busy || !ready}
            onPress={() => exportView(guidesOnlyRef, 'Transparent guide', photoSize)}
          />
        </View>
        <View style={styles.exportRow}>
          <PrimaryButton
            label={'Tracing\nlayer'}
            tone="quiet"
            disabled={busy || !ready}
            onPress={() => exportView(tracingRef, 'Tracing layer', photoSize)}
          />
          <PrimaryButton
            label={pro ? 'Turnaround\nsix views' : 'Turnaround\nsix views ✦'}
            tone="quiet"
            disabled={busy}
            onPress={() =>
              !pro
                ? onRequestPro()
                : exportView(turnaroundRef, 'Turnaround sheet', {
                    width: SHEET_SIZE.width * TURNAROUND_SCALE,
                    height: SHEET_SIZE.height * TURNAROUND_SCALE,
                  })
            }
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
      <View style={styles.offscreen} pointerEvents="none">
        {ready && (
          <>
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
          </>
        )}
        {pro && (
          <View ref={turnaroundRef} collapsable={false}>
            <TurnaroundSheet
              elements={activeElements}
              proportions={proportions}
              color={guideColor}
              thickness={lineWeight}
            />
          </View>
        )}
      </View>
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
  // Cap the panel so a tall tab scrolls rather than squeezing the photo.
  panel: {
    maxHeight: 190,
  },
  panelContent: {
    gap: 8,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  stepLabel: {
    color: colors.graphiteSoft,
    fontSize: 12,
    fontWeight: '600',
  },
  peek: {
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
  },
  peekActive: {
    backgroundColor: colors.accent,
  },
  peekText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  peekTextActive: {
    color: colors.paper,
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
