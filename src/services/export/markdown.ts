import { type TennisAnalysisResult, type WeaknessPattern } from '@/types/analysis';
import { type MatchScore } from '@/types/matchScore';
import { type TennisSession } from '@/types/session';
import { formatSetScoreLine } from '@/services/scoring/matchState';

const SESSION_TYPE_LABELS: Record<string, string> = {
  match: '試合',
  serveTraining: 'サーブ練習',
  strokeTraining: 'ストローク練習',
  volleyTraining: 'ボレー練習',
  freeTraining: '自由練習',
};

const SHOT_TYPE_LABELS: Record<string, string> = {
  serve: 'サーブ',
  forehand: 'フォアハンド',
  backhand: 'バックハンド',
  volley: 'ボレー',
  smash: 'スマッシュ',
  lob: 'ロブ',
  drop: 'ドロップ',
};

const WEAKNESS_LABELS: Record<WeaknessPattern, string> = {
  highDoubleFault: 'ダブルフォルト多発',
  lowFirstServeIn: 'ファーストサーブ成功率低下',
  shortRally: 'ラリーが短い',
  weakBackhand: 'バックハンドの弱さ',
  weakVolley: 'ボレーの弱さ',
  frequentUnforcedError: 'アンフォースドエラー多発',
  poorNetApproach: 'ネットアプローチの課題',
};

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildSessionReport(
  session: TennisSession,
  analysis?: TennisAnalysisResult | null,
  matchScore?: MatchScore | null
): string {
  const lines: string[] = [];
  const sport = session.sport === 'softTennis' ? 'ソフトテニス' : '硬式テニス';
  const sessionType = SESSION_TYPE_LABELS[session.sessionType] ?? session.sessionType;

  lines.push('# CourtLens セッションレポート');
  lines.push('');
  lines.push('## セッション情報');
  lines.push('');
  lines.push(`- **タイトル**: ${session.title}`);
  lines.push(`- **競技**: ${sport}`);
  lines.push(`- **種別**: ${sessionType}`);
  if (session.opponentName) {
    lines.push(`- **対戦相手**: ${session.opponentName}`);
  }
  lines.push(`- **開始**: ${formatDate(session.startedAt)}`);
  if (session.endedAt) {
    lines.push(`- **終了**: ${formatDate(session.endedAt)}`);
  }
  lines.push(`- **ポイント数**: ${session.points.length}`);

  if (matchScore && session.points.length > 0) {
    lines.push('');
    lines.push('## 試合スコア');
    lines.push('');
    const setLine = formatSetScoreLine(matchScore.sets);
    if (setLine) {
      lines.push(`**セット**: ${setLine}`);
    }
    if (matchScore.matchWinner) {
      const winner = matchScore.matchWinner === 'player' ? 'プレイヤー勝利' : '対戦相手勝利';
      lines.push(`**結果**: ${winner}`);
    }
  }

  if (session.points.length > 0) {
    const wonCount = session.points.filter((p) => p.outcome === 'won').length;
    const lostCount = session.points.length - wonCount;
    const winRate = ((wonCount / session.points.length) * 100).toFixed(1);

    lines.push('');
    lines.push('## 統計');
    lines.push('');
    lines.push(`- **得点**: ${wonCount}`);
    lines.push(`- **失点**: ${lostCount}`);
    lines.push(`- **得点率**: ${winRate}%`);

    const shotMap: Record<string, { won: number; lost: number }> = {};
    for (const p of session.points) {
      if (!shotMap[p.shotType]) {
        shotMap[p.shotType] = { won: 0, lost: 0 };
      }
      if (p.outcome === 'won') {
        shotMap[p.shotType].won++;
      } else {
        shotMap[p.shotType].lost++;
      }
    }

    lines.push('');
    lines.push('### ショット別');
    lines.push('');
    lines.push('| ショット | 得点 | 失点 | 得点率 |');
    lines.push('|---|---|---|---|');
    for (const [shotType, counts] of Object.entries(shotMap)) {
      const total = counts.won + counts.lost;
      const rate = ((counts.won / total) * 100).toFixed(0);
      const label = SHOT_TYPE_LABELS[shotType] ?? shotType;
      lines.push(`| ${label} | ${counts.won} | ${counts.lost} | ${rate}% |`);
    }
  }

  if (analysis?.weaknesses && analysis.weaknesses.length > 0) {
    lines.push('');
    lines.push('## 弱点分析');
    lines.push('');
    for (const weakness of analysis.weaknesses) {
      const label = WEAKNESS_LABELS[weakness] ?? weakness;
      lines.push(`- ${label}`);
    }
  }

  if (analysis?.tips && analysis.tips.length > 0) {
    lines.push('');
    lines.push('## コーチングアドバイス');
    lines.push('');
    for (const tip of analysis.tips) {
      lines.push(`### ${tip.title}`);
      lines.push('');
      lines.push(tip.description);
      lines.push('');
    }
  }

  if (session.note) {
    lines.push('## メモ');
    lines.push('');
    lines.push(session.note);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*CourtLens で生成 — ${formatDate(new Date().toISOString())}*`);

  return lines.join('\n');
}
