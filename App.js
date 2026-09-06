import React, { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';

export default function App() {
  // image: null | { uri, width, height }
  const [image, setImage] = useState(null);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {image ? (
        <EditorScreen image={image} onClose={() => setImage(null)} />
      ) : (
        <HomeScreen onImagePicked={setImage} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111114',
  },
});
