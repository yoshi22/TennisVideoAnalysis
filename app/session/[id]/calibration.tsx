import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, SectionHeader } from '@/components/common';
import { CalibrationCanvas } from '@/components/court';
import { buildCalibration, validateCalibration } from '@/services/court';
import { extractStillFrame, type StillFrame } from '@/services/pose/frameSampler';
import { useSessionStore } from '@/stores';
import { useTheme } from '@/theme';
import { type ImagePoint, type TennisSession } from '@/types';

type CalibrationCorners = [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

const CANVAS_WIDTH = Dimensions.get('window').width;
const CANVAS_HEIGHT = CANVAS_WIDTH * 0.75;

function getParamId(id: string | string[] | undefined): string {
  return Array.isArray(id) ? (id[0] ?? '') : (id ?? '');
}

function makeInitialCorners(): CalibrationCorners {
  return [
    { x: 0.15, y: 0.8 },
    { x: 0.85, y: 0.8 },
    { x: 0.85, y: 0.2 },
    { x: 0.15, y: 0.2 },
  ];
}

function getVideoDurationSec(session: TennisSession | undefined): number {
  const duration = (session as { videoDuration?: unknown } | undefined)?.videoDuration;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 10;
}

export default function CourtCalibrationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === sessionId));
  const setCourtCalibration = useSessionStore((state) => state.setCourtCalibration);
  const [corners, setCorners] = useState<CalibrationCorners>(() => makeInitialCorners());
  const [referenceFrame, setReferenceFrame] = useState<StillFrame | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const videoDuration = getVideoDurationSec(session);

  const loadReferenceFrame = useCallback(async () => {
    if (!session?.videoUri) {
      return;
    }

    setIsLoading(true);
    setLoadFailed(false);
    setReferenceFrame(null);

    try {
      const frame = await extractStillFrame(session.videoUri, videoDuration / 2);
      setReferenceFrame(frame);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [session?.videoUri, videoDuration]);

  useEffect(() => {
    void loadReferenceFrame();
  }, [loadReferenceFrame]);

  const handleSave = () => {
    if (!referenceFrame) {
      return;
    }

    const calibration = buildCalibration(corners, referenceFrame.timeSec, referenceFrame.uri);
    const validationError = validateCalibration(calibration);

    if (validationError) {
      Alert.alert('較正を確認してください', validationError);
      return;
    }

    setCourtCalibration(sessionId, calibration);
    router.back();
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'コート較正',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.surface} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      {!session?.videoUri ? (
        <View style={styles.emptyWrapper}>
          <EmptyState
            action={{ label: '戻る', onPress: () => router.back() }}
            description="コート較正にはセッション動画が必要です。"
            title="動画がありません"
          />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View>
              <SectionHeader title="基準フレーム" />
              <View
                style={[
                  styles.canvasFrame,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                {isLoading ? (
                  <View style={[styles.loadingFrame, { height: CANVAS_HEIGHT }]}>
                    <ActivityIndicator color={colors.primary} size="large" />
                    <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                      フレームを読み込み中...
                    </Text>
                  </View>
                ) : referenceFrame ? (
                  <CalibrationCanvas
                    corners={corners}
                    height={CANVAS_HEIGHT}
                    imageUri={referenceFrame.uri}
                    onCornersChange={setCorners}
                    width={CANVAS_WIDTH}
                  />
                ) : (
                  <View style={[styles.loadingFrame, { height: CANVAS_HEIGHT }]}>
                    <Text style={[styles.errorText, { color: colors.danger }]}>
                      フレームを取得できませんでした。
                    </Text>
                    {loadFailed ? (
                      <Button
                        accessibilityLabel="フレーム取得を再試行"
                        label="再試行"
                        onPress={() => void loadReferenceFrame()}
                        size="s"
                        variant="secondary"
                      />
                    ) : null}
                  </View>
                )}
              </View>
            </View>

            <View
              style={[
                styles.helpCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.helpText, { color: colors.textMuted }]}>
                コートの四隅にハンドルを合わせて保存してください。
              </Text>
            </View>
          </ScrollView>

          <View
            style={[
              styles.bottomBar,
              { backgroundColor: colors.bg, borderTopColor: colors.border },
            ]}
          >
            <Button
              accessibilityLabel="較正をやり直す"
              disabled={isLoading}
              label="やり直す"
              onPress={() => setCorners(makeInitialCorners())}
              style={styles.bottomButton}
              variant="secondary"
            />
            <Button
              accessibilityLabel="較正を保存"
              disabled={!referenceFrame || isLoading}
              label="保存"
              onPress={handleSave}
              style={styles.bottomButton}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    gap: 16,
    paddingBottom: 24,
    paddingTop: 20,
  },
  canvasFrame: {
    borderBottomWidth: 0.5,
    borderTopWidth: 0.5,
    overflow: 'hidden',
  },
  loadingFrame: {
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  helpCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    marginHorizontal: 20,
    padding: 14,
  },
  helpText: {
    fontSize: 13,
    lineHeight: 20,
  },
  bottomBar: {
    borderTopWidth: 0.5,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  bottomButton: {
    flex: 1,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
