import { useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { buildPointsCSV, buildSessionReport, shareTextFile } from '@/services/export';
import { useTheme } from '@/theme';
import { type MatchScore, type TennisAnalysisResult, type TennisSession } from '@/types';

import { Button } from './Button';

interface ExportMenuProps {
  session: TennisSession;
  matchScore?: MatchScore;
  analysis?: TennisAnalysisResult;
  onClose: () => void;
}

type ExportKind = 'csv' | 'markdown';

export function ExportMenu({ session, matchScore, analysis, onClose }: ExportMenuProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState<ExportKind | null>(null);

  const handleExport = async (kind: ExportKind) => {
    setLoading(kind);

    try {
      if (kind === 'csv') {
        const csv = buildPointsCSV(session);
        await shareTextFile(csv, `${session.title}.csv`);
      } else {
        const markdown = buildSessionReport(session, analysis, matchScore);
        await shareTextFile(markdown, `${session.title}_report.md`);
      }

      onClose();
    } catch (error) {
      Alert.alert(
        'エクスポートに失敗しました',
        error instanceof Error ? error.message : '時間をおいてもう一度お試しください。'
      );
    } finally {
      setLoading(null);
    }
  };

  const isBusy = loading !== null;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.modalRoot}>
        <TouchableOpacity
          accessibilityLabel="エクスポートメニューを閉じる"
          accessibilityRole="button"
          activeOpacity={1}
          disabled={isBusy}
          onPress={onClose}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }]}
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>エクスポート</Text>
          <Text style={[styles.description, { color: colors.textSub }]}>
            セッションの記録をファイルとして共有します。
          </Text>
          <View style={styles.actions}>
            <Button
              accessibilityLabel="CSVでエクスポート"
              disabled={isBusy && loading !== 'csv'}
              full
              label="CSV でエクスポート"
              loading={loading === 'csv'}
              onPress={() => void handleExport('csv')}
              size="l"
            />
            <Button
              accessibilityLabel="Markdownレポートをエクスポート"
              disabled={isBusy && loading !== 'markdown'}
              full
              label="レポート (Markdown)"
              loading={loading === 'markdown'}
              onPress={() => void handleExport('markdown')}
              size="l"
              variant="secondary"
            />
            <Button
              accessibilityLabel="キャンセル"
              disabled={isBusy}
              full
              label="キャンセル"
              onPress={onClose}
              variant="ghost"
            />
          </View>
        </View>
      </View>
    </Modal>
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
  description: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  actions: {
    gap: 10,
    marginTop: 20,
  },
});
