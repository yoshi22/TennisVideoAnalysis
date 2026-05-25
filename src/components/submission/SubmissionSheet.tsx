import { useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Button } from '@/components/common/Button';
import { SESSION_TYPE_LABELS } from '@/constants/labels';
import { buildSubmissionManifest, createUploader } from '@/services/submission';
import { hasValidConsent, useBetaStore } from '@/stores/betaStore';
import { useTheme } from '@/theme';
import { type TennisSession } from '@/types/session';
import { pushRoute } from '@/utils/navigation';
import { getConfirmedPoints } from '@/utils/pointDetails';

interface SubmissionSheetProps {
  session: TennisSession;
  onClose: () => void;
  router: Parameters<typeof pushRoute>[0];
}

const BETA_CATEGORIES: TennisSession['sessionType'][] = ['match', 'serveTraining'];

export function SubmissionSheet({ session, onClose, router }: SubmissionSheetProps) {
  const { colors } = useTheme();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const betaState = useBetaStore((s) => ({
    participantId: s.participantId,
    consentVersion: s.consentVersion,
    consentAcceptedAt: s.consentAcceptedAt,
  }));
  const consented = hasValidConsent(betaState);

  const uploader = createUploader();
  // Compute manifest once at mount so submissionId is stable across retries.
  // If video upload succeeds but manifest upload fails, retry reuses the same
  // submissionId so the orphan video can be overwritten.
  const manifestRef = useRef(consented ? buildSubmissionManifest(session, betaState) : null);
  const manifest = manifestRef.current;

  const confirmedPointCount = getConfirmedPoints(session.points).length;
  const rallyCount = manifest?.rallies.length ?? 0;
  const isRecommendedCategory = BETA_CATEGORIES.includes(session.sessionType);

  const handleSubmit = async () => {
    if (!manifest || !uploader || !session.videoUri) return;
    setUploading(true);
    setProgress(0);
    try {
      await uploader.upload({
        videoUri: session.videoUri,
        manifest,
        onProgress: (r) => setProgress(r),
      });
      onClose();
      Alert.alert('提出完了', 'ありがとうございます。データはモデル改善に活用されます。');
    } catch (err) {
      Alert.alert(
        '提出に失敗しました',
        err instanceof Error ? err.message : '時間をおいてもう一度お試しください。'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.modalRoot}>
        <TouchableOpacity
          accessibilityLabel="閉じる"
          accessibilityRole="button"
          activeOpacity={1}
          disabled={uploading}
          onPress={onClose}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]}
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>ベータに提供</Text>

          {!consented ? (
            <>
              <Text style={[styles.desc, { color: colors.textSub }]}>
                データを提供するにはベータへの参加（同意）が必要です。
              </Text>
              <View style={styles.actions}>
                <Button
                  full
                  label="同意して参加する"
                  onPress={() => {
                    onClose();
                    pushRoute(router, '/beta-consent');
                  }}
                  size="l"
                />
                <Button full label="キャンセル" onPress={onClose} variant="ghost" />
              </View>
            </>
          ) : !uploader ? (
            <>
              <Text style={[styles.desc, { color: colors.textSub }]}>
                回収先が設定されていません（app.extra.submission が未設定）。
              </Text>
              <View style={styles.actions}>
                <Button full label="閉じる" onPress={onClose} variant="ghost" />
              </View>
            </>
          ) : !manifest ? (
            <>
              <Text style={[styles.desc, { color: colors.textSub }]}>
                {!session.videoUri
                  ? '動画が記録されていません。動画タブから動画を設定してください。'
                  : session.sessionType === 'serveTraining'
                    ? '提出可能なポイント記録がありません。'
                    : '提出可能なラリー区間記録がありません。動画タブでラリー区間をマークしてください。'}
              </Text>
              <View style={styles.actions}>
                <Button full label="閉じる" onPress={onClose} variant="ghost" />
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.desc, { color: colors.textSub }]}>
                以下の内容を回収サーバーにアップロードします。
              </Text>

              {!isRecommendedCategory && (
                <View style={[styles.noteBox, { backgroundColor: colors.primaryLo }]}>
                  <Text style={[styles.noteText, { color: colors.primary }]}>
                    現在のベータ優先カテゴリは「試合」「サーブ練習」です。このセッション（
                    {SESSION_TYPE_LABELS[session.sessionType]}
                    ）も提出できますが、活用優先度は低めです。
                  </Text>
                </View>
              )}

              <View style={[styles.summaryBox, { borderColor: colors.border }]}>
                <SummaryRow
                  colors={colors}
                  label="カテゴリ"
                  value={SESSION_TYPE_LABELS[session.sessionType]}
                />
                <SummaryRow
                  colors={colors}
                  label="ポイント数"
                  value={`${confirmedPointCount} 件`}
                />
                {rallyCount > 0 && (
                  <SummaryRow
                    colors={colors}
                    label="ラリー区間"
                    value={`${rallyCount} 件`}
                    isLast
                  />
                )}
                {rallyCount === 0 && (
                  <SummaryRow colors={colors} label="動画" value="あり" isLast />
                )}
              </View>

              {uploading && (
                <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        backgroundColor: colors.primary,
                        width: `${Math.round(progress * 100)}%`,
                      },
                    ]}
                  />
                </View>
              )}

              <View style={styles.actions}>
                <Button
                  disabled={uploading}
                  full
                  label={uploading ? `アップロード中 ${Math.round(progress * 100)}%` : '提供する'}
                  loading={uploading}
                  onPress={() => void handleSubmit()}
                  size="l"
                />
                <Button
                  disabled={uploading}
                  full
                  label="キャンセル"
                  onPress={onClose}
                  variant="ghost"
                />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({
  label,
  value,
  isLast = false,
  colors,
}: {
  label: string;
  value: string;
  isLast?: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View
      style={[
        styles.summaryRow,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: colors.textSub }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    borderRadius: 999,
    height: 4,
    marginBottom: 18,
    width: 40,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  noteBox: {
    borderRadius: 8,
    marginTop: 12,
    padding: 12,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 18,
  },
  summaryBox: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryLabel: {
    fontSize: 13,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressBar: {
    borderRadius: 4,
    height: 6,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  actions: {
    gap: 10,
    marginTop: 20,
  },
});
