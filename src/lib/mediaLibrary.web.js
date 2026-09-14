export async function requestPermissionsAsync() {
  return { granted: false, status: 'denied', canAskAgain: false };
}

export async function saveToLibraryAsync() {
  throw new Error('Saving to the photo library is only available on iOS and Android.');
}
