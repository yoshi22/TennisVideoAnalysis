import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Button } from '@/components/common';
import { spacing, typography, useTheme } from '@/theme';
import { startRecording, stopRecording } from '@/services/video';

interface VideoRecorderProps {
  onRecorded: (uri: string) => void;
  onCancel: () => void;
}

export function VideoRecorder({ onRecorded, onCancel }: VideoRecorderProps) {
  const { colors } = useTheme();
  const cameraRef = useRef<CameraView | null>(null);
  const mountedRef = useRef(true);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  useEffect(() => {
    if (cameraPermission === null) {
      void requestCameraPermission();
    }

    if (microphonePermission === null) {
      void requestMicrophonePermission();
    }
  }, [
    cameraPermission,
    microphonePermission,
    requestCameraPermission,
    requestMicrophonePermission,
  ]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      void stopRecording(cameraRef);

      const camera = cameraRef.current;
      if (camera) {
        void camera.pausePreview().catch(() => undefined);
      }
    };
  }, []);

  const handleRequestPermissions = useCallback(() => {
    void Promise.all([requestCameraPermission(), requestMicrophonePermission()]);
  }, [requestCameraPermission, requestMicrophonePermission]);

  const handleStartRecording = useCallback(async () => {
    if (!cameraRef.current || isRecording) {
      return;
    }

    setIsRecording(true);
    await startRecording(cameraRef);
  }, [isRecording]);

  const handleStopRecording = useCallback(async () => {
    if (!isRecording) {
      return;
    }

    const uri = await stopRecording(cameraRef);

    if (mountedRef.current) {
      setIsRecording(false);
    }

    if (uri) {
      onRecorded(uri);
    }
  }, [isRecording, onRecorded]);

  const handleCancel = useCallback(() => {
    void stopRecording(cameraRef);
    onCancel();
  }, [onCancel]);

  const hasPermission =
    cameraPermission?.granted === true && microphonePermission?.granted === true;

  if (!hasPermission) {
    return (
      <View style={[styles.permissionContainer, { backgroundColor: colors.bg }]}>
        <Text style={styles.permissionTitle}>カメラとマイクの権限が必要です</Text>
        <Text style={[styles.permissionDescription, { color: colors.textSub }]}>
          動画を撮影するには、カメラとマイクへのアクセスを許可してください。
        </Text>
        <View style={styles.permissionActions}>
          <Button label="権限を許可" onPress={handleRequestPermissions} />
          <Button label="キャンセル" onPress={onCancel} variant="secondary" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.text }]}>
      <CameraView active facing="back" mode="video" ref={cameraRef} style={styles.camera} />
      <View style={styles.controls}>
        <TouchableOpacity
          accessibilityLabel="録画をキャンセル"
          accessibilityRole="button"
          activeOpacity={0.8}
          onPress={handleCancel}
          style={[styles.secondaryControl, { backgroundColor: colors.overlay }]}
        >
          <Ionicons color={colors.surface} name="close" size={28} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={isRecording ? '録画を停止' : '録画を開始'}
          accessibilityRole="button"
          accessibilityState={{ selected: isRecording }}
          activeOpacity={0.8}
          onPress={isRecording ? handleStopRecording : handleStartRecording}
          style={[
            styles.recordControl,
            {
              borderColor: isRecording ? colors.danger : colors.surface,
              backgroundColor: colors.overlay,
            },
          ]}
        >
          <View
            style={[
              styles.recordIcon,
              isRecording && styles.stopIcon,
              { backgroundColor: colors.danger },
            ]}
          />
        </TouchableOpacity>
        <View style={[styles.secondaryControl, { backgroundColor: colors.overlay }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  controls: {
    position: 'absolute',
    right: 0,
    bottom: spacing.xxxl,
    left: 0,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
  },
  secondaryControl: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  recordControl: {
    minHeight: 76,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 38,
    borderWidth: 4,
  },
  recordIcon: {
    height: 52,
    width: 52,
    borderRadius: 26,
  },
  stopIcon: {
    height: 28,
    width: 28,
    borderRadius: 5,
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  permissionTitle: {
    ...typography.h3,
    textAlign: 'center',
  },
  permissionDescription: {
    ...typography.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  permissionActions: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xxl,
  },
});
