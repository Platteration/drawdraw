import { Alert } from 'react-native';
// The function API this save was written against. Since SDK 56 the package
// root is the Asset/Album object API, and its saveToLibraryAsync is a stub
// that throws; the legacy entry point is still the native module it was.
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { releaseCapture } from 'react-native-view-shot';

import { errorText } from './errors';

/**
 * Offer a captured export to the photo library or the share sheet, on a
 * device. The web downloads its exports instead (src/lib/webExport.ts) and
 * never comes here.
 *
 * captureRef writes the PNG to a temporary file and hands over the only
 * reference to it. Nothing else deletes it on iOS, so without a release each
 * press of an export button leaves a full-resolution PNG behind for as long
 * as the OS keeps the temp directory. So the file is kept exactly until the
 * choice made in this dialog has finished with it, and then released, once:
 * the first of a button or Android's dismissal (a tap outside the dialog,
 * which fires no button at all) decides, and whatever reports after it is
 * ignored. A dismissal reported while a share sheet is still reading the file
 * therefore cannot release it from under the share.
 *
 * Resolves once the file has been released.
 */
export function offerExport(uri: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let chosen = false;
    const choose = (action: () => Promise<void>) => async () => {
      if (chosen) return;
      chosen = true;
      try {
        await action();
      } finally {
        // A release that throws must still let the dialog finish: the export
        // itself has been saved or shared by now.
        try {
          releaseCapture(uri);
        } catch {}
        resolve();
      }
    };
    const cancel = choose(async () => {});
    try {
      Alert.alert(
        name,
        'Where do you want it?',
        [
          {
            text: 'Save to Photos',
            onPress: choose(async () => {
              try {
                // Add-only: the app never reads or enumerates the library, so
                // it asks for the write scope alone (no 'All Photos' grant, and
                // no runtime prompt at all on Android 13+). No granular list:
                // with writeOnly Android requests none of them anyway, and on
                // Android inside Expo Go a list naming 'photo' throws.
                const permission = await MediaLibrary.requestPermissionsAsync(true);
                if (!permission.granted) {
                  Alert.alert('Permission needed', 'Allow DrawDraw to add photos to your library to save exports.');
                  return;
                }
                await MediaLibrary.saveToLibraryAsync(uri);
                Alert.alert('Saved', `${name} was saved to your photo library.`);
              } catch (err) {
                Alert.alert('Save failed', errorText(err));
              }
            }),
          },
          {
            text: 'Share…',
            onPress: choose(async () => {
              try {
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(uri, { mimeType: 'image/png' });
                } else {
                  Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
                }
              } catch (err) {
                Alert.alert('Share failed', errorText(err));
              }
            }),
          },
          { text: 'Cancel', style: 'cancel', onPress: cancel },
        ],
        // Android keeps an alert up against a tap outside it unless it is
        // cancelable; when it is, that tap fires onDismiss and no button.
        { cancelable: true, onDismiss: cancel }
      );
    } catch (error) {
      try {
        releaseCapture(uri);
      } catch {}
      reject(error);
    }
  });
}
