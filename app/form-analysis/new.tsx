import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHero, SectionHeader, SegmentedControl } from '@/components/common';
import { FORM_ANALYSIS_SHOT_OPTIONS, getShotTypeLabel } from '@/components/pose';
import { useTheme } from '@/theme';
import { type ShotType } from '@/types';
import { pushRoute } from '@/utils/navigation';

interface SourceCardProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  onPress: () => void;
}

function SourceCard({ icon, title, onPress }: SourceCardProps) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      accessibilityLabel={title}
      accessibilityRole="button"
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.sourceCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.sourceIcon, { backgroundColor: colors.primaryLo }]}>
        <Ionicons color={colors.primary} name={icon} size={26} />
      </View>
      <Text style={[styles.sourceTitle, { color: colors.text }]}>{title}</Text>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
    </TouchableOpacity>
  );
}

export default function NewFormAnalysisScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [shotType, setShotType] = useState<ShotType>('forehand');

  const openCapture = () => {
    pushRoute(router, { pathname: '/form-analysis/capture', params: { shotType } });
  };

  const openSelect = () => {
    pushRoute(router, { pathname: '/form-analysis/select', params: { shotType } });
  };

  return (
    <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'フォーム分析',
          headerStyle: { backgroundColor: colors.hero },
          headerTintColor: colors.onHero,
          headerTitleStyle: { color: colors.onHero, fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackVisible: false,
          headerLeft: () => (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons color={colors.onHero} name="chevron-back" size={26} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroPad}>
          <ScreenHero
            eyebrow="FORM ANALYSIS"
            subtitle={getShotTypeLabel(shotType)}
            title="フォーム分析"
            topInset={false}
          />
        </View>

        <View>
          <SectionHeader title="ソース選択" />
          <View style={styles.sectionBody}>
            <SourceCard icon="camera-outline" onPress={openCapture} title="スイングを撮影" />
            <SourceCard
              icon="videocam-outline"
              onPress={openSelect}
              title="セッション動画から選択"
            />
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

        <Text style={[styles.note, { color: colors.textMuted }]}>
          フォーム分析は参考値です。専門コーチの指導を組み合わせることをお勧めします。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: 16,
    paddingBottom: 48,
    paddingTop: 20,
  },
  heroPad: {
    paddingHorizontal: 20,
  },
  sectionBody: {
    gap: 10,
    paddingHorizontal: 20,
  },
  sourceCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    padding: 16,
  },
  sourceIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  sourceTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  segmentWrap: {
    paddingHorizontal: 20,
    width: 540,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
});
