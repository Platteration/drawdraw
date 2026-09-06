import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export default function HomeScreen({ onImagePicked }) {
  const [busy, setBusy] = useState(false);

  const handleResult = (result) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.width || !asset.height) {
      Alert.alert('Unsupported image', 'Could not read the dimensions of that image.');
      return;
    }
    onImagePicked({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const pickFromLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow photo access to pick a portrait.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      handleResult(result);
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow camera access to take a portrait.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 1 });
      handleResult(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>DrawDraw</Text>
      <Text style={styles.tagline}>
        Load a portrait, get thirds guides laid over it automatically, then export the guides — with
        the photo, on their own as a transparent layer, or as a faded tracing layer — to draw over in
        any drawing app.
      </Text>

      <Pressable style={[styles.button, styles.primary]} onPress={pickFromLibrary} disabled={busy}>
        <Text style={styles.buttonText}>Choose a portrait</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.secondary]} onPress={takePhoto} disabled={busy}>
        <Text style={styles.buttonText}>Take a photo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    color: '#f5f5f7',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 16,
  },
  tagline: {
    color: '#9a9aa5',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 40,
  },
  button: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  primary: {
    backgroundColor: '#4f7cff',
  },
  secondary: {
    backgroundColor: '#2a2a31',
  },
  buttonText: {
    color: '#f5f5f7',
    fontSize: 16,
    fontWeight: '600',
  },
});
