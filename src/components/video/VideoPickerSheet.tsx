import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/common';
import { pickVideoFromLibrary } from '@/services/video';
import { colors, spacing, typography } from '@/theme';

import { VideoRecorder } from './VideoRecorder';

interface VideoPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onVideoSelected: (uri: string) => void;
}

export function VideoPickerSheet({ visible, onDismiss, onVideoSelected }: VideoPickerSheetProps) {
  const [recordingVisible, setRecordingVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRecordingVisible(false);
    }
  }, [visible]);

  const handleLibraryPress = async () => {
    const uri = await pickVideoFromLibrary();

    if (uri) {
      onVideoSelected(uri);
      onDismiss();
    }
  };

  const handleRecorded = (uri: string) => {
    setRecordingVisible(false);
    onVideoSelected(uri);
    onDismiss();
  };

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} transparent visible={visible}>
      {recordingVisible ? (
        <VideoRecorder onCancel={() => setRecordingVisible(false)} onRecorded={handleRecorded} />
      ) : (
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>動画を追加</Text>
            <Button
              accessibilityLabel="動画を撮影"
              label="動画を撮影"
              onPress={() => setRecordingVisible(true)}
            />
            <Button
              accessibilityLabel="ライブラリから動画を選択"
              label="ライブラリから選択"
              onPress={handleLibraryPress}
              variant="secondary"
            />
            <Button
              accessibilityLabel="動画選択をキャンセル"
              label="キャンセル"
              onPress={onDismiss}
              variant="secondary"
            />
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  title: {
    ...typography.h3,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});
