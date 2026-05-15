import * as ImagePicker from 'expo-image-picker';

export async function pickVideoFromLibrary(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled) {
    return null;
  }

  return result.assets[0]?.uri ?? null;
}
