import React, { useEffect, useState } from 'react';
import { Modal, SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { useEntitlements } from './src/lib/pro';
import { colors } from './src/theme';

const ONBOARDED_KEY = 'drawdraw.onboarded.v1';

export default function App() {
  // project: null | { id, image: { uri, width, height }, settings }
  const [project, setProject] = useState(null);
  const [onboarded, setOnboarded] = useState(null); // null while loading
  const [paywall, setPaywall] = useState(false);
  const { pro, purchase, restore } = useEntitlements();

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((v) => setOnboarded(v === '1'))
      .catch(() => setOnboarded(true));
  }, []);

  const finishOnboarding = () => {
    setOnboarded(true);
    AsyncStorage.setItem(ONBOARDED_KEY, '1').catch(() => {});
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {onboarded === null ? null : onboarded === false ? (
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
          onReplayIntro={() => setOnboarded(false)}
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
