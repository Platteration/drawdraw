import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { releaseCapture } from 'react-native-view-shot';

/** Keep a captured portrait only until its save/share operation completes. */
export function offerExport(uri, name) {
  return new Promise((resolve, reject) => {
    let selected = false;
    const choose = (action) => async () => {
      if (selected) return;
      selected = true;
      try {
        await action();
      } finally {
        try {
          releaseCapture(uri);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    };
    const cancel = choose(async () => {});
    try {
      Alert.alert(name, 'Where do you want it?', [
        {
          text: 'Save to Photos',
          onPress: choose(async () => {
            try {
              // Saving an export does not need to read the user's media library.
              const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
              if (!permission.granted) {
                Alert.alert('Permission needed', 'Allow saving photos to save exports.');
                return;
              }
              await MediaLibrary.saveToLibraryAsync(uri);
              Alert.alert('Saved', `${name} was saved to your photo library.`);
            } catch (error) {
              Alert.alert('Save failed', String(error?.message ?? error));
            }
          }),
        },
        {
          text: 'Share...',
          onPress: choose(async () => {
            try {
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'image/png' });
              } else {
                Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
              }
            } catch (error) {
              Alert.alert('Share failed', String(error?.message ?? error));
            }
          }),
        },
        { text: 'Cancel', style: 'cancel', onPress: cancel },
      ], { cancelable: true, onDismiss: cancel });
    } catch (error) {
      releaseCapture(uri);
      reject(error);
    }
  });
}
