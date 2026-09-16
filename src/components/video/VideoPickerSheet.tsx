import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/common';
import { pickVideoFromLibrary } from '@/services/video';
import { spacing, typography, useTheme } from '@/theme';

import { VideoRecorder } from './VideoRecorder';

interface VideoPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onVideoSelected: (uri: string) => void;
}

export function VideoPickerSheet({ visible, onDismiss, onVideoSelected }: VideoPickerSheetProps) {
  const { colors } = useTheme();
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
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[styles.title, { color: colors.text }]}>動画を追加</Text>
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
  },
  sheet: {
    gap: spacing.md,
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
