import React, { useCallback, useEffect, useState } from 'react';
import { Modal, SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { useEntitlements } from './src/lib/pro';
import { loadSettings, persistSettings } from './src/lib/settingsStore';
import { colors } from './src/theme';

export default function App() {
  // project: null | { id, image: { uri, width, height }, settings }
  const [project, setProject] = useState(null);
  const [settings, setSettings] = useState(null); // null while loading
  const [replayingIntro, setReplayingIntro] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const { pro, ready: entitlementsRead, purchase, restore } = useEntitlements();

  // Nothing is rendered until both the settings (which carry the onboarding
  // flag) and the stored entitlement have been read. `pro` starts false, so
  // rendering earlier shows a paying customer the free build for a frame — the
  // guide visibly loses its Pro construction lines and then gains them back,
  // and the home screen offers to sell them something they already own.
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSettings(next).catch(() => {});
      return next;
    });
  }, []);

  // Replaying the intro from the home screen is a thing this session does,
  // not a change to what has been seen: closing the app mid-replay does not
  // bring the intro back on the next launch.
  const finishOnboarding = () => {
    setReplayingIntro(false);
    if (!settings.seenIntro) updateSettings({ seenIntro: true });
  };

  return (
    // React Native's SafeAreaView only insets on iOS. Android is kept out from
    // under the status and gesture bars by the system instead, which is why
    // `android.edgeToEdgeEnabled` is false in app.json: turning it back on
    // would draw the header and the export row under the system bars, and
    // nothing in the tree supplies insets to compensate.
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {settings === null || !entitlementsRead ? null : !settings.seenIntro || replayingIntro ? (
        <OnboardingScreen onDone={finishOnboarding} />
      ) : project ? (
        <EditorScreen
          project={project}
          pro={pro}
          onRequestPro={() => setPaywall(true)}
          onClose={() => setProject(null)}
        />
      ) : (
        <HomeScreen
          onOpenProject={setProject}
          pro={pro}
          onRequestPro={() => setPaywall(true)}
          onReplayIntro={() => setReplayingIntro(true)}
        />
      )}

      <Modal visible={paywall} animationType="slide" onRequestClose={() => setPaywall(false)}>
        <PaywallScreen
          onClose={() => setPaywall(false)}
          onPurchase={purchase}
          onRestore={restore}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
