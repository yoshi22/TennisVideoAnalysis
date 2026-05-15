import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { colors } from '@/theme';

interface VideoThumbnailProps {
  uri: string;
  width?: number;
  height?: number;
  onPress?: () => void;
}

export function VideoThumbnail({ uri, width = 160, height = 90, onPress }: VideoThumbnailProps) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.muted = true;
    videoPlayer.pause();
  });
  const content = (
    <>
      <VideoView
        allowsFullscreen={false}
        contentFit="cover"
        nativeControls={false}
        player={player}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.overlay}>
        <Ionicons color={colors.surface} name="play-circle" size={40} />
      </View>
    </>
  );
  const containerStyle = [styles.container, { width, height }];

  if (onPress) {
    return (
      <TouchableOpacity
        accessibilityLabel="動画を再生"
        accessibilityRole="button"
        activeOpacity={0.9}
        onPress={onPress}
        style={containerStyle}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    minWidth: 44,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.text,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
});
