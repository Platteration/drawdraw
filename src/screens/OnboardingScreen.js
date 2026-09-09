import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, radius } from '../theme';
import { buildHeadWireframe, HEAD_HEIGHT_UNITS } from '../lib/headModel';

/**
 * Three pages that teach the method rather than tour the UI: what the three
 * segments are, why they have to be three-dimensional, and what you get out
 * at the end.
 */
const PAGES = [
  {
    title: 'Three segments',
    body:
      'A head divides into three: chin to the base of the nose, nose to the brow, brow to the top of the skull. Get those right and a portrait is already most of the way there.',
    view: { yaw: 0, pitch: 0, elements: {} },
  },
  {
    title: 'Turn it with the face',
    body:
      'Flat thirds only work head-on. Here the divisions wrap around a real head, so they stay true when the face turns, tips or tilts — and you can see where they run behind it.',
    view: { yaw: 45, pitch: 12, elements: { center: true, eyeLine: true } },
  },
  {
    title: 'Draw on top',
    body:
      'Fit the head to your photo with three taps, then export the guide on transparency, or the photo faded back as a tracing layer, and draw over it wherever you like.',
    view: { yaw: 22, pitch: 0, elements: { center: true, eyeLine: true, jaw: true, ears: true } },
  },
];

function PageArt({ yaw, pitch, elements, size }) {
  const wire = buildHeadWireframe(yaw, pitch, 0, { elements });
  const ppu = (size * 0.8) / HEAD_HEIGHT_UNITS;
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
          strokeDasharray="5 5"
          fill="none"
        />
      ))}
      <Path d={toPath(wire.outline)} stroke={colors.accent} strokeWidth={2.2} fill="none" />
      {wire.front.map((p, i) => (
        <Path key={`f${i}`} d={toPath(p)} stroke={colors.accent} strokeWidth={2.2} fill="none" />
      ))}
    </Svg>
  );
}

export default function OnboardingScreen({ onDone }) {
  const width = Dimensions.get('window').width;
  const [page, setPage] = useState(0);
  const scroller = useRef(null);

  const goTo = (next) => {
    if (next >= PAGES.length) {
      onDone();
      return;
    }
    scroller.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };

  // Android Back steps back through the pages rather than closing the app.
  // On the first page there is nowhere to go, so the system handles it.
  // Android only: the handler is a no-op stub on iOS and logs an error on
  // react-native-web.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page <= 0) return false;
      goTo(page - 1);
      return true;
    });
    return () => sub.remove();
  }, [page]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) =>
          setPage(Math.round(e.nativeEvent.contentOffset.x / width))
        }
      >
        {PAGES.map((p) => (
          <View key={p.title} style={[styles.page, { width }]}>
            <PageArt {...p.view} size={Math.min(width * 0.62, 260)} />
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <View key={p.title} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        <Pressable style={styles.next} onPress={() => goTo(page + 1)}>
          <Text style={styles.nextText}>
            {page === PAGES.length - 1 ? 'Start drawing' : 'Next'}
          </Text>
        </Pressable>
        <Pressable onPress={onDone} hitSlop={10}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },
  title: {
    color: colors.graphite,
    fontSize: 26,
    fontWeight: '800',
    marginTop: 18,
    textAlign: 'center',
  },
  body: {
    color: colors.graphiteSoft,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
  },
  footer: {
    paddingHorizontal: 34,
    paddingBottom: 24,
    gap: 14,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.paperEdge,
  },
  dotActive: {
    backgroundColor: colors.accent,
  },
  next: {
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  nextText: {
    color: colors.paper,
    fontSize: 15,
    fontWeight: '700',
  },
  skip: {
    color: colors.graphiteFaint,
    fontSize: 13,
    fontWeight: '600',
  },
});
