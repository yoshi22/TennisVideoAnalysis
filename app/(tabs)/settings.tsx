import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, SegmentedControl, Tag } from '@/components/common';
import { usePlayerStore } from '@/stores/playerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { spacing, typography, useTheme, type ColorTokens } from '@/theme';
import { type PlayerProfile, type PlayStyle, type SportType } from '@/types';
import { generateId } from '@/utils/id';

const SPORT_OPTIONS: { label: string; value: SportType }[] = [
  { label: '硬式テニス', value: 'tennis' },
  { label: 'ソフトテニス', value: 'softTennis' },
];

const HAND_OPTIONS: { label: string; value: PlayerProfile['dominantHand'] }[] = [
  { label: '右', value: 'right' },
  { label: '左', value: 'left' },
];

const PLAY_STYLE_OPTIONS: { label: string; value: PlayStyle }[] = [
  { label: 'ベースライン', value: 'baseline' },
  { label: 'サーブ&ボレー', value: 'serve-volley' },
  { label: 'オールコート', value: 'allcourt' },
];

const SPORT_LABELS: Record<SportType, string> = {
  tennis: '硬式テニス',
  softTennis: 'ソフトテニス',
};

const HAND_LABELS: Record<PlayerProfile['dominantHand'], string> = {
  right: '右利き',
  left: '左利き',
};

const PLAY_STYLE_LABELS: Record<PlayStyle, string> = {
  baseline: 'ベースライン',
  'serve-volley': 'サーブ&ボレー',
  allcourt: 'オールコート',
};

function getInitials(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'CL';
  }

  const words = trimmed.split(/\s+/).filter(Boolean);

  if (words.length >= 2 && /^[A-Za-z]/.test(words[0]) && /^[A-Za-z]/.test(words[1])) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return Array.from(trimmed.replace(/\s+/g, '')).slice(0, 2).join('').toUpperCase();
}

interface SectionLabelProps {
  children: ReactNode;
  colors: ColorTokens;
}

function SectionLabel({ children, colors }: SectionLabelProps) {
  return <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>{children}</Text>;
}

interface FormRowProps {
  label: string;
  value: string;
  children: ReactNode;
  colors: ColorTokens;
  isLast?: boolean;
}

function FormRow({ label, value, children, colors, isLast }: FormRowProps) {
  return (
    <View
      style={[
        styles.formRow,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: isLast === true ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.formRowHeader}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.formRowValue, { color: colors.textSub }]}>
          {value}
        </Text>
      </View>
      {children}
    </View>
  );
}

interface SettingsRowProps {
  label: string;
  colors: ColorTokens;
  value?: string;
  danger?: boolean;
  isLast?: boolean;
  showChevron?: boolean;
  onPress?: () => void;
}

function SettingsRow({
  label,
  colors,
  value,
  danger,
  isLast,
  showChevron = true,
  onPress,
}: SettingsRowProps) {
  const content = (
    <>
      <Text style={[styles.rowLabel, { color: danger === true ? colors.danger : colors.text }]}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        {value ? (
          <Text numberOfLines={1} style={[styles.rowValue, { color: colors.textSub }]}>
            {value}
          </Text>
        ) : null}
        {showChevron ? (
          <Ionicons color={colors.textMuted} name="chevron-forward" size={16} />
        ) : null}
      </View>
    </>
  );
  const rowStyle = [
    styles.settingsRow,
    {
      borderBottomColor: colors.border,
      borderBottomWidth: isLast === true ? 0 : StyleSheet.hairlineWidth,
    },
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        accessibilityLabel={label}
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={onPress}
        style={rowStyle}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode } = useTheme();
  const profile = usePlayerStore((state) => state.profile);
  const setProfile = usePlayerStore((state) => state.setProfile);
  const updateProfile = usePlayerStore((state) => state.updateProfile);
  const clearAll = useSessionStore((state) => state.clearAll);
  const [name, setName] = useState(profile?.name ?? '');
  const [sport, setSport] = useState<SportType>(profile?.sport ?? 'tennis');
  const [dominantHand, setDominantHand] = useState<PlayerProfile['dominantHand']>(
    profile?.dominantHand ?? 'right'
  );
  const [playStyle, setPlayStyle] = useState<PlayStyle>(profile?.playStyle ?? 'baseline');

  useEffect(() => {
    if (profile === null) {
      return;
    }

    setName(profile.name);
    setSport(profile.sport);
    setDominantHand(profile.dominantHand);
    setPlayStyle(profile.playStyle);
  }, [profile]);

  const saveProfile = () => {
    const now = new Date().toISOString();
    const trimmedName = name.trim() || 'プレイヤー';

    if (profile === null) {
      setProfile({
        id: generateId(),
        name: trimmedName,
        sport,
        dominantHand,
        playStyle,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      updateProfile({
        name: trimmedName,
        sport,
        dominantHand,
        playStyle,
        updatedAt: now,
      });
    }

    Alert.alert('保存しました', 'プロフィールを更新しました');
  };

  const confirmClear = () => {
    Alert.alert('データを初期化', 'すべてのセッションデータを削除します。よろしいですか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '次へ',
        style: 'destructive',
        onPress: () => {
          Alert.alert('本当に削除しますか？', 'この操作は取り消せません。', [
            { text: 'キャンセル', style: 'cancel' },
            { text: '削除する', style: 'destructive', onPress: clearAll },
          ]);
        },
      },
    ]);
  };

  const displayName = name.trim() || profile?.name || 'プレイヤー';
  const initials = getInitials(displayName);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.container, { backgroundColor: colors.bg }]}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>設定</Text>
        </View>

        <View style={styles.profilePad}>
          <View
            style={[
              styles.profileCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: colors.primaryLo }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
            </View>
            <View style={styles.profileText}>
              <Text numberOfLines={1} style={[styles.profileName, { color: colors.text }]}>
                {displayName}
              </Text>
              <Text style={[styles.profileDescription, { color: colors.textSub }]}>
                {SPORT_LABELS[sport]} ・ 分析プロフィール
              </Text>
              <View style={styles.tagRow}>
                <Tag bg={`${colors.primary}1A`} color={colors.primary}>
                  {HAND_LABELS[dominantHand]}
                </Tag>
                <Tag bg={colors.surfaceAlt} color={colors.textSub}>
                  {PLAY_STYLE_LABELS[playStyle]}
                </Tag>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel colors={colors}>プロフィール</SectionLabel>
          <View
            style={[
              styles.groupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <FormRow colors={colors} label="名前" value={name.trim() || '未設定'}>
              <TextInput
                onChangeText={setName}
                placeholder="プレイヤー名"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={name}
              />
            </FormRow>

            <FormRow colors={colors} label="競技" value={SPORT_LABELS[sport]}>
              <SegmentedControl
                accessibilityLabel="競技選択"
                onSelect={setSport}
                options={SPORT_OPTIONS}
                selected={sport}
              />
            </FormRow>

            <FormRow colors={colors} label="利き手" value={HAND_LABELS[dominantHand]}>
              <SegmentedControl
                accessibilityLabel="利き手"
                onSelect={setDominantHand}
                options={HAND_OPTIONS}
                selected={dominantHand}
              />
            </FormRow>

            <FormRow
              colors={colors}
              isLast
              label="プレイスタイル"
              value={PLAY_STYLE_LABELS[playStyle]}
            >
              <SegmentedControl
                accessibilityLabel="プレイスタイル"
                onSelect={setPlayStyle}
                options={PLAY_STYLE_OPTIONS}
                selected={playStyle}
              />
            </FormRow>

            <View style={[styles.saveArea, { borderTopColor: colors.border }]}>
              <Button label="保存" onPress={saveProfile} />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel colors={colors}>アプリ</SectionLabel>
          <View
            style={[
              styles.groupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <SettingsRow colors={colors} label="通知" value="オン" />
            <SettingsRow colors={colors} label="単位 / 表示" value="日本語" />
            <SettingsRow
              colors={colors}
              label="テーマ"
              value={mode === 'dark' ? 'ダーク' : 'ライト'}
            />
            <SettingsRow
              colors={colors}
              label="使い方を見る"
              onPress={() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                router.push('/onboarding?replay=1' as any);
              }}
              showChevron
            />
            <SettingsRow
              colors={colors}
              isLast
              label="バージョン"
              showChevron={false}
              value="1.0.0"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel colors={colors}>ヘルプ</SectionLabel>
          <View
            style={[
              styles.groupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <SettingsRow
              colors={colors}
              label="使い方ガイド"
              onPress={() => {
                router.push('/help' as Parameters<typeof router.push>[0]);
              }}
              showChevron
            />
            <SettingsRow
              colors={colors}
              isLast
              label="撮影のコツ"
              onPress={() => {
                router.push('/recording-guide' as Parameters<typeof router.push>[0]);
              }}
              showChevron
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel colors={colors}>データ</SectionLabel>
          <View
            style={[
              styles.groupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <SettingsRow
              colors={colors}
              isLast
              label="エクスポート"
              onPress={() => {
                router.push('/help' as Parameters<typeof router.push>[0]);
              }}
              showChevron
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionLabel colors={colors}>データ管理</SectionLabel>
          <View
            style={[
              styles.groupCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <SettingsRow
              colors={colors}
              danger
              isLast
              label="データを初期化"
              onPress={confirmClear}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 104,
  },
  header: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  title: {
    ...typography.h1,
  },
  profilePad: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  profileCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 1,
    flexDirection: 'row',
    gap: 14,
    padding: spacing.lg,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  profileDescription: {
    ...typography.caption,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionLabel: {
    ...typography.label,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xl,
    textTransform: 'uppercase',
  },
  groupCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.xl,
    overflow: 'hidden',
  },
  formRow: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  formRowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  formRowValue: {
    ...typography.body,
    flexShrink: 1,
    textAlign: 'right',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  rowRight: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    justifyContent: 'flex-end',
  },
  rowValue: {
    ...typography.body,
    flexShrink: 1,
  },
  settingsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  input: {
    ...typography.body,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
});
