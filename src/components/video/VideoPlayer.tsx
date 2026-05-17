import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

export interface VideoPlayerRef {
  seekTo(sec: number): void;
  play(): void;
  pause(): void;
  getCurrentTime(): number;
  getDuration(): number;
}

interface VideoPlayerProps {
  uri: string;
  initialTimeSec?: number;
  style?: ViewStyle;
  onTimeUpdate?: (sec: number) => void;
  onDurationLoaded?: (sec: number) => void;
  autoPlay?: boolean;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(
  { uri, initialTimeSec = 0, style, onTimeUpdate, onDurationLoaded, autoPlay = false },
  ref
) {
  const { colors } = useTheme();
  const [isReady, setIsReady] = useState(false);
  const initialSeekDoneRef = useRef(false);

  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.5;
    if (!autoPlay) {
      p.pause();
    }
  });

  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const timeUpdatePayload = useEvent(player, 'timeUpdate', {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const currentTime = timeUpdatePayload?.currentTime ?? 0;
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: autoPlay });

  useEffect(() => {
    if (status === 'readyToPlay' && !isReady) {
      setIsReady(true);
      onDurationLoaded?.(player.duration);
      if (initialTimeSec > 0 && !initialSeekDoneRef.current) {
        initialSeekDoneRef.current = true;
        player.currentTime = initialTimeSec;
      }
    }
  }, [status, isReady, player, initialTimeSec, onDurationLoaded]);

  useEffect(() => {
    onTimeUpdate?.(currentTime);
  }, [currentTime, onTimeUpdate]);

  useImperativeHandle(ref, () => ({
    seekTo: (sec: number) => {
      player.currentTime = sec;
    },
    play: () => player.play(),
    pause: () => player.pause(),
    getCurrentTime: () => player.currentTime,
    getDuration: () => player.duration,
  }));

  const duration = player.duration;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  return (
    <View style={[styles.container, style]}>
      <VideoView contentFit="contain" nativeControls={false} player={player} style={styles.video} />

      {!isReady ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.surface} size="large" />
        </View>
      ) : null}

      <View style={[styles.controls, { backgroundColor: colors.text + 'CC' }]}>
        <TouchableOpacity
          accessibilityLabel={isPlaying ? '一時停止' : '再生'}
          accessibilityRole="button"
          onPress={() => (isPlaying ? player.pause() : player.play())}
          style={styles.playButton}
        >
          <Ionicons color={colors.surface} name={isPlaying ? 'pause' : 'play'} size={22} />
        </TouchableOpacity>

        <View style={styles.progressArea}>
          <View style={[styles.progressTrack, { backgroundColor: colors.surface + '44' }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: colors.primary, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: colors.surface }]}>
              {formatTime(currentTime)}
            </Text>
            <Text style={[styles.timeText, { color: colors.surface + 'AA' }]}>
              {formatTime(duration)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#00000088',
    justifyContent: 'center',
  },
  controls: {
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
  },
  playButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  progressArea: {
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  progressTrack: {
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 2,
    height: '100%',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
