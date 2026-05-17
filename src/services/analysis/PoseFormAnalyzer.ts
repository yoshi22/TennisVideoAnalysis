import { type ShotType } from '@/types';
import {
  type FormAnalysisResult,
  type Keypoint,
  type PoseFrame,
  type SwingMetric,
  type SwingRating,
} from '@/types/pose';
import { generateId } from '@/utils/id';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function angle(a: Keypoint, b: Keypoint, c: Keypoint): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const mag = Math.sqrt(v1x ** 2 + v1y ** 2) * Math.sqrt(v2x ** 2 + v2y ** 2);
  if (mag === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function dist(a: Keypoint, b: Keypoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function kp(frame: PoseFrame, name: Keypoint['name']): Keypoint {
  const k = frame.keypoints.find((k) => k.name === name);
  if (!k) throw new Error(`keypoint ${name} not found`);
  return k;
}

function confident(frame: PoseFrame, ...names: Keypoint['name'][]): boolean {
  return names.every((n) => {
    const k = frame.keypoints.find((k) => k.name === n);
    return k !== undefined && k.score > 0.25;
  });
}

function speed(frames: PoseFrame[], name: Keypoint['name']): number[] {
  const speeds: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].timeSec - frames[i - 1].timeSec;
    if (dt <= 0) {
      speeds.push(0);
      continue;
    }
    try {
      speeds.push(dist(kp(frames[i], name), kp(frames[i - 1], name)) / dt);
    } catch {
      speeds.push(0);
    }
  }
  return speeds;
}

// ---------------------------------------------------------------------------
// Impact frame detection
// ---------------------------------------------------------------------------

function detectImpactFrame(frames: PoseFrame[], dominant: 'left' | 'right' = 'right'): number {
  const wristName: Keypoint['name'] = dominant === 'right' ? 'right_wrist' : 'left_wrist';
  const wristSpeeds = speed(frames, wristName);
  let maxSpeed = 0;
  let impactIdx = Math.floor(frames.length / 2);
  for (let i = 0; i < wristSpeeds.length; i++) {
    if (wristSpeeds[i] > maxSpeed) {
      maxSpeed = wristSpeeds[i];
      impactIdx = i;
    }
  }
  return impactIdx;
}

// ---------------------------------------------------------------------------
// Rating helpers
// ---------------------------------------------------------------------------

function rateInRange(value: number, good: [number, number], fair: [number, number]): SwingRating {
  if (value >= good[0] && value <= good[1]) return 'good';
  if (value >= fair[0] && value <= fair[1]) return 'fair';
  return 'poor';
}

function metric(
  label: string,
  value: number,
  unit: string,
  rating: SwingRating,
  comment: string
): SwingMetric {
  return { id: generateId(), label, value, unit, rating, comment };
}

// ---------------------------------------------------------------------------
// Common metrics (all shot types)
// ---------------------------------------------------------------------------

function kneeBendMetric(frame: PoseFrame): SwingMetric | null {
  const side: [
    'left_hip' | 'right_hip',
    'left_knee' | 'right_knee',
    'left_ankle' | 'right_ankle',
  ][] = [
    ['left_hip', 'left_knee', 'left_ankle'],
    ['right_hip', 'right_knee', 'right_ankle'],
  ];
  const angles: number[] = [];
  for (const [h, k, a] of side) {
    if (confident(frame, h, k, a)) {
      angles.push(angle(kp(frame, h), kp(frame, k), kp(frame, a)));
    }
  }
  if (angles.length === 0) return null;
  const avg = angles.reduce((s, v) => s + v, 0) / angles.length;
  const rating = rateInRange(avg, [100, 150], [80, 170]);
  const comment =
    rating === 'good'
      ? '膝が適切に曲がっています。安定した体重移動ができています。'
      : rating === 'fair'
        ? '膝の曲げをもう少し意識しましょう。重心を低く保つと安定します。'
        : '膝の曲げが不十分か過剰です。120〜140°程度を目安にしてください。';
  return metric('膝の曲げ角度', Math.round(avg), '°', rating, comment);
}

function xFactorMetric(prepFrame: PoseFrame, impactFrame: PoseFrame): SwingMetric | null {
  const needed = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'] as const;
  if (!confident(prepFrame, ...needed) || !confident(impactFrame, ...needed)) return null;

  const shoulderAngle = (f: PoseFrame) => {
    const ls = kp(f, 'left_shoulder');
    const rs = kp(f, 'right_shoulder');
    return (Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI;
  };
  const hipAngle = (f: PoseFrame) => {
    const lh = kp(f, 'left_hip');
    const rh = kp(f, 'right_hip');
    return (Math.atan2(rh.y - lh.y, rh.x - lh.x) * 180) / Math.PI;
  };

  const xFactor = Math.abs(shoulderAngle(prepFrame) - hipAngle(prepFrame));
  const rating = rateInRange(xFactor, [35, 60], [20, 70]);
  const comment =
    rating === 'good'
      ? '肩と腰の捻転差が適切です（X-factor）。十分なパワーが得られています。'
      : rating === 'fair'
        ? '捻転差をもう少し増やすと、より大きなパワーが生まれます。'
        : '肩と腰の捻転差が不足または過剰です。バックスイングで肩を十分に回しましょう。';
  return metric('捻転角（X-factor）', Math.round(xFactor), '°', rating, comment);
}

function followThroughMetric(frames: PoseFrame[], impactIdx: number): SwingMetric | null {
  if (impactIdx >= frames.length - 1) return null;
  const postFrames = frames.slice(impactIdx, Math.min(impactIdx + 6, frames.length));
  const wristName: Keypoint['name'] = 'right_wrist';
  if (!postFrames.every((f) => confident(f, wristName))) return null;

  const first = kp(postFrames[0], wristName);
  const last = kp(postFrames[postFrames.length - 1], wristName);
  const movement = dist(first, last);
  // Normalize: 0.15+ in normalized coords is a good follow-through
  const movePct = Math.round(movement * 100);
  const rating = rateInRange(movement, [0.12, 1], [0.07, 1]);
  const comment =
    rating === 'good'
      ? 'フォロースルーが十分に取れています。スムーズな振り抜きができています。'
      : rating === 'fair'
        ? 'フォロースルーがやや短いです。打球後も振り抜ききりましょう。'
        : 'フォロースルーが不足しています。インパクト後も腕を振り続けましょう。';
  return metric('フォロースルー量', movePct, '%', rating, comment);
}

// ---------------------------------------------------------------------------
// Shot-specific metrics
// ---------------------------------------------------------------------------

function serveMetrics(frames: PoseFrame[], impactIdx: number): SwingMetric[] {
  const impact = frames[impactIdx];
  const metrics: SwingMetric[] = [];

  // Impact height: wrist y relative to head (lower y = higher in image)
  if (confident(impact, 'right_wrist', 'nose')) {
    const wrist = kp(impact, 'right_wrist');
    const nose = kp(impact, 'nose');
    const heightDiff = nose.y - wrist.y; // positive = wrist above nose
    const rating = rateInRange(heightDiff, [0.05, 1], [0, 1]);
    const comment =
      rating === 'good'
        ? '打点が十分に高い位置にあります。角度のあるサーブが打てます。'
        : '打点が低いです。ボールをより高い位置で打つよう意識しましょう。';
    metrics.push(metric('打点の高さ', Math.round(heightDiff * 100), '(頭部比)', rating, comment));
  }

  // Knee extension: compare knee angle before and at impact
  const prepIdx = Math.max(0, impactIdx - Math.floor(frames.length * 0.3));
  const prep = frames[prepIdx];
  const kneeBendPrep = kneeBendMetric(prep);
  if (kneeBendPrep) {
    const kneeBendImpact = kneeBendMetric(impact);
    if (kneeBendImpact && kneeBendPrep.value < kneeBendImpact.value) {
      const extension = kneeBendImpact.value - kneeBendPrep.value;
      const rating = rateInRange(extension, [20, 60], [10, 80]);
      metrics.push(
        metric(
          '膝の伸び上がり',
          Math.round(extension),
          '°',
          rating,
          rating === 'good'
            ? 'トスに合わせた膝の伸び上がりが適切です。脚力をパワーに変換できています。'
            : '膝をしっかり曲げてから伸び上がると、より大きなパワーが得られます。'
        )
      );
    }
  }

  // Toss arm extension
  if (confident(impact, 'left_shoulder', 'left_elbow', 'left_wrist')) {
    const tossAngle = angle(
      kp(impact, 'left_shoulder'),
      kp(impact, 'left_elbow'),
      kp(impact, 'left_wrist')
    );
    const rating = rateInRange(tossAngle, [140, 180], [110, 180]);
    metrics.push(
      metric(
        'トス腕の伸展',
        Math.round(tossAngle),
        '°',
        rating,
        rating === 'good'
          ? 'トス腕がしっかり伸びています。高く安定したトスができています。'
          : 'トス腕をより伸ばして、安定したトスを上げましょう。'
      )
    );
  }

  return metrics;
}

function groundstrokeMetrics(frames: PoseFrame[], impactIdx: number): SwingMetric[] {
  const impact = frames[impactIdx];
  const metrics: SwingMetric[] = [];

  // Contact point: wrist x relative to hips (in front of body)
  if (confident(impact, 'right_wrist', 'right_hip')) {
    const wrist = kp(impact, 'right_wrist');
    const hip = kp(impact, 'right_hip');
    const inFront = hip.x - wrist.x; // positive if wrist is ahead (lower x) of hip in typical forehand
    // Simplified: just check absolute separation
    const separation = Math.abs(wrist.x - hip.x);
    const rating = rateInRange(separation, [0.1, 0.35], [0.05, 0.45]);
    metrics.push(
      metric(
        '体の前での打点',
        Math.round(separation * 100),
        '%',
        rating,
        rating === 'good'
          ? '体の前でボールを捉えています。適切な打点位置です。'
          : inFront < 0
            ? 'ボールを打つのが遅れています。早めに準備してインパクトを前に取りましょう。'
            : 'ボールが体に近すぎます。適度な距離を保ちましょう。'
      )
    );
  }

  // Unit turn: shoulder rotation before impact
  const prepIdx = Math.max(0, impactIdx - Math.floor(frames.length * 0.4));
  const prep = frames[prepIdx];
  const xf = xFactorMetric(prep, impact);
  if (xf) metrics.push(xf);

  return metrics;
}

function volleyMetrics(frames: PoseFrame[], impactIdx: number): SwingMetric[] {
  const metrics: SwingMetric[] = [];

  // Compact swing: measure wrist travel across ALL frames (should be small)
  const rightWristSpeeds = speed(frames, 'right_wrist');
  const maxWristSpeed = Math.max(...rightWristSpeeds);
  const rating = rateInRange(maxWristSpeed, [0, 0.4], [0, 0.6]);
  metrics.push(
    metric(
      'スイングのコンパクトさ',
      Math.round(maxWristSpeed * 100),
      '',
      rating,
      rating === 'good'
        ? 'コンパクトなボレーができています。速い展開でも対応できます。'
        : 'スイングが大きすぎます。ボレーはコンパクトなテイクバックを意識しましょう。'
    )
  );

  // Contact point
  const impact = frames[impactIdx];
  if (confident(impact, 'right_wrist', 'right_shoulder')) {
    const wrist = kp(impact, 'right_wrist');
    const shoulder = kp(impact, 'right_shoulder');
    const inFront = shoulder.x - wrist.x;
    const rating2 = inFront > 0.05 ? 'good' : inFront > 0 ? 'fair' : 'poor';
    metrics.push(
      metric(
        '前での打点',
        Math.round(inFront * 100),
        '%',
        rating2,
        rating2 === 'good'
          ? '体の前でボールを捉えています。理想的な打点位置です。'
          : '打点が後ろすぎます。ネット際でより前でボールを捉えましょう。'
      )
    );
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeScore(metrics: SwingMetric[]): number {
  if (metrics.length === 0) return 50;
  const weights: Record<SwingRating, number> = { good: 100, fair: 60, poor: 20 };
  const total = metrics.reduce((sum, m) => sum + weights[m.rating], 0);
  return Math.round(total / metrics.length);
}

function buildSummary(score: number, shotType: ShotType): string {
  const shotLabel: Record<ShotType, string> = {
    serve: 'サーブ',
    forehand: 'フォアハンド',
    backhand: 'バックハンド',
    volley: 'ボレー',
    smash: 'スマッシュ',
    lob: 'ロブ',
    drop: 'ドロップショット',
  };
  const label = shotLabel[shotType];
  if (score >= 75)
    return `${label}のフォームは全体的に良好です。強みを活かしながら細部を磨きましょう。`;
  if (score >= 50)
    return `${label}のフォームに改善の余地があります。指標を参考に練習してみましょう。`;
  return `${label}のフォームにいくつか課題が見られます。基本動作から丁寧に取り組みましょう。`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function analyzeForm(frames: PoseFrame[], shotType: ShotType): FormAnalysisResult {
  if (frames.length === 0) {
    return {
      shotType,
      overallScore: 0,
      summary: '分析できるフレームが見つかりませんでした。',
      metrics: [],
      impactFrameIndex: 0,
    };
  }

  const impactIdx = detectImpactFrame(frames);
  const impact = frames[impactIdx];
  const metrics: SwingMetric[] = [];

  // Common metrics
  const kb = kneeBendMetric(impact);
  if (kb) metrics.push(kb);
  const ft = followThroughMetric(frames, impactIdx);
  if (ft) metrics.push(ft);

  // Shot-specific metrics
  if (shotType === 'serve' || shotType === 'smash') {
    metrics.push(...serveMetrics(frames, impactIdx));
  } else if (shotType === 'volley') {
    metrics.push(...volleyMetrics(frames, impactIdx));
  } else {
    // forehand, backhand, lob, drop
    metrics.push(...groundstrokeMetrics(frames, impactIdx));
  }

  const overallScore = computeScore(metrics);
  return {
    shotType,
    overallScore,
    summary: buildSummary(overallScore, shotType),
    metrics,
    impactFrameIndex: impactIdx,
  };
}
