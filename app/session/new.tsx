import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, SectionHeader, SegmentedControl } from '@/components/common';
import { VideoPickerSheet, VideoThumbnail } from '@/components/video';
import { useSessionStore } from '@/stores/sessionStore';
import { useTheme } from '@/theme';
import { type MatchFormat, type SessionType, type SportType, type TennisSession } from '@/types';
import { generateId } from '@/utils/id';

const SPORT_OPTIONS: { label: string; value: SportType }[] = [
  { label: '硬式テニス', value: 'tennis' },
  { label: 'ソフトテニス', value: 'softTennis' },
];

const SESSION_TYPE_OPTIONS: { label: string; value: SessionType }[] = [
  { label: '試合', value: 'match' },
  { label: 'サーブ練習', value: 'serveTraining' },
  { label: 'ストローク練習', value: 'strokeTraining' },
  { label: 'ボレー練習', value: 'volleyTraining' },
  { label: '自由練習', value: 'freeTraining' },
];

const MATCH_FORMAT_OPTIONS: { label: string; value: MatchFormat }[] = [
  { label: 'シングルス', value: 'singles' },
  { label: 'ダブルス', value: 'doubles' },
];

export default function NewSessionScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const addSession = useSessionStore((state) => state.addSession);
  const [title, setTitle] = useState('');
  const [sport, setSport] = useState<SportType>('tennis');
  const [sessionType, setSessionType] = useState<SessionType>('match');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('singles');
  const [opponentName, setOpponentName] = useState('');
  const [videoUri, setVideoUri] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  const [videoPickerVisible, setVideoPickerVisible] = useState(false);
  const canStart = title.trim().length > 0;

  const startSession = () => {
    if (!canStart) return;

    const id = generateId();
    const now = new Date().toISOString();
    const baseSession = {
      id,
      title: title.trim(),
      sessionType,
      matchFormat,
      opponentName: opponentName.trim() || undefined,
      videoUri,
      points: [],
      note: note.trim() || undefined,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const session: TennisSession =
      sport === 'softTennis'
        ? { ...baseSession, sport: 'softTennis' }
        : { ...baseSession, sport: 'tennis' };

    addSession(session);
    router.replace(`../${id}/log`);
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '新しいセッション',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.surface,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Video drop zone */}
        <View
          style={[
            styles.videoDrop,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {videoUri ? (
            <VideoThumbnail
              height={180}
              onPress={() => setVideoPickerVisible(true)}
              uri={videoUri}
              width={320}
            />
          ) : (
            <>
              <View style={[styles.videoIconBg, { backgroundColor: colors.primaryLo }]}>
                <Text style={[styles.videoIconText, { color: colors.primary }]}>▶</Text>
              </View>
              <Text style={[styles.videoDropTitle, { color: colors.text }]}>動画を追加</Text>
              <Text style={[styles.videoDropSub, { color: colors.textMuted }]}>
                ライブ撮影 / カメラロールから選択
              </Text>
              <Button
                label={videoUri ? '変更' : '選択'}
                onPress={() => setVideoPickerVisible(true)}
                variant="secondary"
                size="s"
              />
            </>
          )}
        </View>

        {/* Title */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>タイトル</Text>
          <TextInput
            onChangeText={setTitle}
            placeholder="例: 練習試合 vs 佐藤"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={title}
          />
        </View>

        {/* Sport */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>競技</Text>
          <SegmentedControl
            accessibilityLabel="競技選択"
            onSelect={setSport}
            options={SPORT_OPTIONS}
            selected={sport}
          />
        </View>

        {/* Session type */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>セッション種別</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.sessionTypeControl}>
              <SegmentedControl
                accessibilityLabel="セッション種別"
                onSelect={setSessionType}
                options={SESSION_TYPE_OPTIONS}
                selected={sessionType}
              />
            </View>
          </ScrollView>
        </View>

        {/* Match format */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>形式</Text>
          <SegmentedControl
            accessibilityLabel="形式"
            onSelect={setMatchFormat}
            options={MATCH_FORMAT_OPTIONS}
            selected={matchFormat}
          />
        </View>

        {/* Opponent */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>対戦相手</Text>
          <TextInput
            onChangeText={setOpponentName}
            placeholder="任意"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={opponentName}
          />
        </View>

        {/* Video (if selected, show change option) */}
        {videoUri && (
          <View style={styles.field}>
            <SectionHeader
              action={{ label: '変更', onPress: () => setVideoPickerVisible(true) }}
              title="動画"
            />
          </View>
        )}

        {/* Note */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSub }]}>メモ</Text>
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="今日のテーマ・対戦相手・コンディションなど"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.textArea,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            textAlignVertical="top"
            value={note}
          />
        </View>

        <Button disabled={!canStart} label="セッション開始" onPress={startSession} />
      </ScrollView>

      <VideoPickerSheet
        onDismiss={() => setVideoPickerVisible(false)}
        onVideoSelected={setVideoUri}
        visible={videoPickerVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 20,
  },
  videoDrop: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  videoIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIconText: {
    fontSize: 22,
  },
  videoDropTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  videoDropSub: {
    fontSize: 12,
    textAlign: 'center',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.02,
  },
  input: {
    minHeight: 48,
    borderWidth: 0.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: {
    minHeight: 112,
    borderWidth: 0.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  sessionTypeControl: {
    width: 720,
  },
});
