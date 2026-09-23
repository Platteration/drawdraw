import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { setHapticsEnabled } from './src/lib/feedback';
import { useEntitlements } from './src/lib/pro';
import { resetSettings } from './src/lib/settings';
import { loadSettings, persistSettings } from './src/lib/settingsStore';
import { colors } from './src/theme';

export default function App() {
  // project: null | { id, image: { uri, width, height }, settings }
  const [project, setProject] = useState(null);
  const [settings, setSettings] = useState(null); // null while loading
  const [replayingIntro, setReplayingIntro] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // The Vibration switch gates every haptic through one module flag; nothing
  // else in the app reads the setting.
  useEffect(() => {
    if (settings) setHapticsEnabled(settings.haptics);
  }, [settings]);

  // Replaying the intro from the home screen is a thing this session does,
  // not a change to what has been seen: closing the app mid-replay does not
  // bring the intro back on the next launch.
  const finishOnboarding = () => {
    setReplayingIntro(false);
    if (!settings.seenIntro) updateSettings({ seenIntro: true });
  };

  return (
    // Android draws every app edge to edge from SDK 54 on, so the insets come
    // from react-native-safe-area-context on both platforms: React Native's
    // own SafeAreaView only ever inset on iOS, which left the header and the
    // export row under Android's status and gesture bars. A Modal is a window
    // of its own, drawn edge to edge as well, so each one insets its content
    // again rather than inheriting this view's padding.
    <SafeAreaProvider>
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
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {settings && (
          <Modal
            visible={settingsOpen}
            animationType="slide"
            onRequestClose={() => setSettingsOpen(false)}
          >
            <SafeAreaView style={styles.root}>
              <SettingsScreen
                settings={settings}
                onChange={updateSettings}
                onReset={() => updateSettings(resetSettings(settings))}
                onClose={() => setSettingsOpen(false)}
              />
            </SafeAreaView>
          </Modal>
        )}

        <Modal visible={paywall} animationType="slide" onRequestClose={() => setPaywall(false)}>
          <SafeAreaView style={styles.root}>
            <PaywallScreen
              onClose={() => setPaywall(false)}
              onPurchase={purchase}
              onRestore={restore}
            />
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
