import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, SectionHeader, SegmentedControl } from '@/components/common';
import { FORM_ANALYSIS_SHOT_OPTIONS, normalizeFormShotTypeParam } from '@/components/pose';
import { analyzeClip } from '@/services/pose';
import { useFormAnalysisStore, useSessionStore } from '@/stores';
import { useTheme } from '@/theme';
import { type ShotType, type TennisSession } from '@/types';

type SessionWithVideo = TennisSession & { videoUri: string };

function getStringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hasVideoUri(session: TennisSession): session is SessionWithVideo {
  return typeof session.videoUri === 'string' && session.videoUri.length > 0;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
}

function parseSecond(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized.length === 0) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parsed;
}

export default function SelectFormAnalysisVideoScreen() {
  const { colors, withAlpha } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialVideoUri = getStringParam(params.videoUri);
  const sessions = useSessionStore((state) => state.sessions);
  const [selectedVideoUri, setSelectedVideoUri] = useState<string | undefined>(initialVideoUri);
  const [shotType, setShotType] = useState<ShotType>(() =>
    normalizeFormShotTypeParam(params.shotType)
  );
  const [startText, setStartText] = useState('0');
  const [endText, setEndText] = useState('8');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  const sessionsWithVideo = useMemo(
    () =>
      sessions
        .filter(hasVideoUri)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [sessions]
  );

  const startSec = parseSecond(startText);
  const endSec = parseSecond(endText);
  const startInvalid = startSec === null;
  const endInvalid = endSec === null || (startSec !== null && endSec <= startSec);
  const canAnalyze = Boolean(selectedVideoUri) && !startInvalid && !endInvalid && !isAnalyzing;

  const runAnalysis = useCallback(
    async (videoUri: string, clipStartSec: number, clipEndSec: number, clipShotType: ShotType) => {
      setIsAnalyzing(true);
      setProgress(0);

      try {
        const result = await analyzeClip({
          videoUri,
          startSec: clipStartSec,
          endSec: clipEndSec,
          shotType: clipShotType,
          onProgress: (value) => setProgress(Math.max(0, Math.min(1, value))),
        });

        useFormAnalysisStore.getState().addAnalysis(result);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.replace({ pathname: '/form-analysis/[id]', params: { id: result.id } } as any);
      } catch {
        setIsAnalyzing(false);
        Alert.alert('解析に失敗しました', '範囲と動画を確認して、もう一度お試しください。', [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '再試行',
            onPress: () => void runAnalysis(videoUri, clipStartSec, clipEndSec, clipShotType),
          },
        ]);
      }
    },
    [router]
  );

  const handleStartAnalysis = () => {
    if (!selectedVideoUri || startSec === null || endSec === null || endSec <= startSec) {
      return;
    }

    void runAnalysis(selectedVideoUri, startSec, endSec, shotType);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '動画を選択',
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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {selectedVideoUri ? (
          <>
            <View>
              <SectionHeader title="選択中の動画" />
              <View
                style={[
                  styles.selectedCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.fieldLabel, { color: colors.textSub }]}>動画URI</Text>
                <Text style={[styles.videoUri, { color: colors.text }]} numberOfLines={2}>
                  {selectedVideoUri}
                </Text>
                <Button
                  accessibilityLabel="動画を変更"
                  label="動画を変更"
                  onPress={() => setSelectedVideoUri(undefined)}
                  size="s"
                  variant="secondary"
                />
              </View>
            </View>

            <View>
              <SectionHeader title="分析範囲" />
              <View
                style={[
                  styles.rangeCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={styles.rangeRow}>
                  <View style={styles.rangeField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSub }]}>開始</Text>
                    <TextInput
                      accessibilityLabel="開始秒"
                      keyboardType="decimal-pad"
                      onChangeText={setStartText}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.bg,
                          borderColor: startInvalid ? colors.danger : colors.border,
                          color: colors.text,
                        },
                      ]}
                      value={startText}
                    />
                  </View>
                  <View style={styles.rangeField}>
                    <Text style={[styles.fieldLabel, { color: colors.textSub }]}>終了</Text>
                    <TextInput
                      accessibilityLabel="終了秒"
                      keyboardType="decimal-pad"
                      onChangeText={setEndText}
                      placeholder="8"
                      placeholderTextColor={colors.textMuted}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.bg,
                          borderColor: endInvalid ? colors.danger : colors.border,
                          color: colors.text,
                        },
                      ]}
                      value={endText}
                    />
                  </View>
                </View>
                {startInvalid || endInvalid ? (
                  <Text style={[styles.errorText, { color: colors.danger }]}>
                    開始と終了を秒数で入力してください。
                  </Text>
                ) : (
                  <Text style={[styles.helpText, { color: colors.textMuted }]}>
                    解析したいスイングを含む範囲を秒数で指定します。
                  </Text>
                )}
              </View>
            </View>

            <View>
              <SectionHeader title="ショット種別" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.segmentWrap}>
                  <SegmentedControl
                    accessibilityLabel="ショット種別"
                    onSelect={setShotType}
                    options={FORM_ANALYSIS_SHOT_OPTIONS}
                    selected={shotType}
                  />
                </View>
              </ScrollView>
            </View>

            <View style={styles.actionWrap}>
              <Button
                accessibilityLabel="分析開始"
                disabled={!canAnalyze}
                label="分析開始"
                loading={isAnalyzing}
                onPress={handleStartAnalysis}
                size="l"
              />
            </View>
          </>
        ) : (
          <View>
            <SectionHeader title="セッション動画" />
            {sessionsWithVideo.length === 0 ? (
              <EmptyState
                description="動画を追加したセッションからフォーム分析を開始できます。"
                title="動画付きセッションがありません"
              />
            ) : (
              <View style={styles.sessionList}>
                {sessionsWithVideo.map((session) => (
                  <TouchableOpacity
                    accessibilityLabel={`${session.title}を選択`}
                    accessibilityRole="button"
                    activeOpacity={0.88}
                    key={session.id}
                    onPress={() => setSelectedVideoUri(session.videoUri)}
                    style={[
                      styles.sessionRow,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.sessionText}>
                      <Text style={[styles.sessionTitle, { color: colors.text }]} numberOfLines={1}>
                        {session.title}
                      </Text>
                      <Text style={[styles.sessionDate, { color: colors.textMuted }]}>
                        {formatDate(session.createdAt)}
                      </Text>
                    </View>
                    <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {isAnalyzing ? (
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <ActivityIndicator color={colors.surface} size="large" />
          <Text style={[styles.overlayTitle, { color: colors.surface }]}>解析中...</Text>
          <View
            accessibilityLabel="解析の進捗"
            style={[styles.progressTrack, { backgroundColor: withAlpha(colors.surface, 0.28) }]}
          >
            <View
              style={[
                styles.progressFill,
                { backgroundColor: colors.surface, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.progressText, { color: colors.surface }]}>
            {Math.round(progress * 100)}%
          </Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: 18,
    paddingBottom: 48,
    paddingTop: 20,
  },
  selectedCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 8,
    marginHorizontal: 20,
    padding: 14,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  videoUri: {
    fontSize: 12,
    lineHeight: 18,
  },
  rangeCard: {
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 10,
    marginHorizontal: 20,
    padding: 14,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rangeField: {
    flex: 1,
    gap: 6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 0.5,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  helpText: {
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  segmentWrap: {
    paddingHorizontal: 20,
    width: 540,
  },
  actionWrap: {
    paddingHorizontal: 20,
  },
  sessionList: {
    gap: 8,
    paddingHorizontal: 20,
  },
  sessionRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  sessionText: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sessionDate: {
    fontSize: 12,
    marginTop: 3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    gap: 14,
    justifyContent: 'center',
    padding: 28,
  },
  overlayTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  progressTrack: {
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressText: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
