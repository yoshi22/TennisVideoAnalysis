import { type CoachingTip, type PracticeDrill, type WeaknessPattern } from '@/types';
import { generateId } from '@/utils/id';

export interface CoachingRule {
  tips: CoachingTip[];
  drills: PracticeDrill[];
}

export const coachingRules: Record<WeaknessPattern, CoachingRule> = {
  highDoubleFault: {
    tips: [
      {
        id: generateId(),
        weakness: 'highDoubleFault',
        title: 'セカンドサーブの安全域を広げる',
        description:
          'ダブルフォルトが多い日は、球速よりも回転量とネット上の通過高さを優先してください。',
        priority: 'high',
      },
      {
        id: generateId(),
        weakness: 'highDoubleFault',
        title: 'トス位置を固定する',
        description:
          'フォルトが続く場面では、打点の前後差を小さくするためにトスの頂点を毎回確認します。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'highDoubleFault',
        name: 'セカンドサーブ20本連続イン',
        description:
          'スピードを落として回転をかけ、20本中16本以上をサービスボックスに入れることを目標にします。',
        durationMin: 15,
      },
    ],
  },
  lowFirstServeIn: {
    tips: [
      {
        id: generateId(),
        weakness: 'lowFirstServeIn',
        title: 'ファーストの狙いを広くする',
        description:
          '厳しいコースだけを狙わず、センターとボディを混ぜて初球から入る確率を上げます。',
        priority: 'high',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'lowFirstServeIn',
        name: '3コース打ち分けサーブ',
        description: 'ワイド、ボディ、センターを各10本ずつ打ち、成功率とミス方向を記録します。',
        durationMin: 20,
      },
      {
        id: generateId(),
        weakness: 'lowFirstServeIn',
        name: '70%スピードサーブ',
        description: '最大出力を抑えてフォームを一定にし、ファーストサーブの再現性を高めます。',
        durationMin: 10,
      },
    ],
  },
  shortRally: {
    tips: [
      {
        id: generateId(),
        weakness: 'shortRally',
        title: '最初の3球を深く返す',
        description:
          'ラリーが短い場合は、決め急がずにベースライン深くへ返して失点リスクを下げます。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'shortRally',
        name: 'クロス10往復ラリー',
        description: '強打を禁止し、クロス方向に10往復続けることを優先して安定した軌道を作ります。',
        durationMin: 15,
      },
    ],
  },
  weakBackhand: {
    tips: [
      {
        id: generateId(),
        weakness: 'weakBackhand',
        title: 'バック側の準備を早める',
        description:
          'バックハンドのミスが多い時は、相手の打球直後に肩を入れて打点を前に確保します。',
        priority: 'high',
      },
      {
        id: generateId(),
        weakness: 'weakBackhand',
        title: '無理な方向転換を減らす',
        description: '深いボールはストレートへ切り返さず、まずクロスへ深く返して体勢を戻します。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'weakBackhand',
        name: 'バッククロス深さ練習',
        description: 'バックハンドをクロスに30球打ち、サービスラインより奥へ入った本数を数えます。',
        durationMin: 20,
      },
    ],
  },
  weakVolley: {
    tips: [
      {
        id: generateId(),
        weakness: 'weakVolley',
        title: 'ボレーは面を作って前に運ぶ',
        description: '大きく振らず、足を一歩入れてラケット面を保ちながら相手コートへ押し込みます。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'weakVolley',
        name: '足元ボレー反復',
        description: 'サービスライン付近で低い球を受け、深いクロスと短いアングルを交互に打ちます。',
        durationMin: 15,
      },
    ],
  },
  frequentUnforcedError: {
    tips: [
      {
        id: generateId(),
        weakness: 'frequentUnforcedError',
        title: '狙うエリアを大きくする',
        description:
          '凡ミスが多い場面ではライン際を避け、コート中央寄りの安全なターゲットへ変更します。',
        priority: 'high',
      },
      {
        id: generateId(),
        weakness: 'frequentUnforcedError',
        title: '失点直後のテンポを落とす',
        description: '連続ミスを防ぐため、次のポイント前に呼吸を整えて最初の一球を丁寧に入れます。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'frequentUnforcedError',
        name: 'ミス方向メモ付きラリー',
        description:
          '10分間ラリーを行い、ネット、アウト、サイドアウトのどれが多いかを毎回記録します。',
        durationMin: 10,
      },
    ],
  },
  poorNetApproach: {
    tips: [
      {
        id: generateId(),
        weakness: 'poorNetApproach',
        title: '浅い返球だけで前へ出る',
        description:
          'ネットへ出る判断を早めすぎず、相手の返球が短くなった時に深いアプローチを打って詰めます。',
        priority: 'medium',
      },
    ],
    drills: [
      {
        id: generateId(),
        weakness: 'poorNetApproach',
        name: 'アプローチからファーストボレー',
        description: '短い球を深く打って前進し、次のボレーをクロス深くへ運ぶ流れを反復します。',
        durationMin: 20,
      },
      {
        id: generateId(),
        weakness: 'poorNetApproach',
        name: '判断付きネットプレー',
        description: '球出しの深さを見て、浅い球だけアプローチしてネットに出る判断を練習します。',
        durationMin: 15,
      },
    ],
  },
};
