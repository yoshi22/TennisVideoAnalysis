import { type RefObject } from 'react';
import { CameraView } from 'expo-camera';

const activeRecordings = new WeakMap<CameraView, Promise<string | null>>();

export async function startRecording(cameraRef: RefObject<CameraView | null>): Promise<void> {
  const camera = cameraRef.current;

  if (!camera || activeRecordings.has(camera)) {
    return;
  }

  const recording = camera
    .recordAsync()
    .then((result) => result?.uri ?? null)
    .finally(() => {
      activeRecordings.delete(camera);
    });

  activeRecordings.set(camera, recording);
  void recording.catch(() => undefined);
}

export async function stopRecording(
  cameraRef: RefObject<CameraView | null>
): Promise<string | null> {
  const camera = cameraRef.current;

  if (!camera) {
    return null;
  }

  const recording = activeRecordings.get(camera);

  if (!recording) {
    return null;
  }

  camera.stopRecording();

  try {
    return await recording;
  } catch {
    return null;
  } finally {
    activeRecordings.delete(camera);
  }
}
