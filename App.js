import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';
import { colors } from './src/theme';

export default function App() {
  // project: null | { id, image: { uri, width, height }, settings }
  const [project, setProject] = useState(null);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {project ? (
        <EditorScreen project={project} onClose={() => setProject(null)} />
      ) : (
        <HomeScreen onOpenProject={setProject} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
