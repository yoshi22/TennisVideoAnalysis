import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { CONSENT_VERSION } from '@/stores/betaStore';
import { buildSubmissionManifest } from '@/services/submission/manifest';
import { type TennisSession } from '@/types/session';
import { type PointRecord } from '@/types/point';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.1.0' } },
}));

const VALID_BETA = {
  participantId: 'test-participant-abc',
  consentVersion: CONSENT_VERSION,
  consentAcceptedAt: '2026-05-25T10:00:00.000Z',
};

function makePoint(overrides: Partial<PointRecord> = {}): PointRecord {
  return {
    id: 'p1',
    sessionId: 'session-1',
    outcome: 'won',
    shotType: 'forehand',
    resultReason: 'winner',
    rallyCount: 3,
    timestamp: '2026-05-25T10:00:00.000Z',
    source: 'manual',
    ...overrides,
  };
}

function makeSession(overrides: Partial<TennisSession> = {}): TennisSession {
  return {
    id: 'session-1',
    title: 'テスト試合',
    sessionType: 'match',
    sport: 'tennis',
    matchFormat: 'singles',
    videoUri: 'file:///videos/test.mp4',
    videoDurationSec: 3600,
    points: [],
    startedAt: '2026-05-25T10:00:00.000Z',
    createdAt: '2026-05-25T10:00:00.000Z',
    updatedAt: '2026-05-25T10:00:00.000Z',
    ...overrides,
  } as TennisSession;
}

describe('buildSubmissionManifest', () => {
  describe('null cases', () => {
    it('returns null when videoUri is missing', () => {
      const point = makePoint({ rallyStartSec: 10, rallyEndSec: 30 });
      const s = makeSession({ videoUri: undefined, points: [point] });
      expect(buildSubmissionManifest(s, VALID_BETA)).toBeNull();
    });

    it('returns null when consent version is wrong', () => {
      const session = makeSession({
        points: [makePoint({ rallyStartSec: 10, rallyEndSec: 30 })],
      });
      const beta = { ...VALID_BETA, consentVersion: CONSENT_VERSION - 1 };
      expect(buildSubmissionManifest(session, beta)).toBeNull();
    });

    it('returns null when consentAcceptedAt is missing', () => {
      const session = makeSession({
        points: [makePoint({ rallyStartSec: 10, rallyEndSec: 30 })],
      });
      const beta = { ...VALID_BETA, consentAcceptedAt: undefined };
      expect(buildSubmissionManifest(session, beta)).toBeNull();
    });

    it('returns null for match session with no rally intervals', () => {
      const session = makeSession({
        points: [makePoint()],
      });
      expect(buildSubmissionManifest(session, VALID_BETA)).toBeNull();
    });
  });

  describe('match session', () => {
    const confirmedPoint = makePoint({ rallyStartSec: 5, rallyEndSec: 20 });
    const draftPoint = makePoint({
      rallyStartSec: 25,
      rallyEndSec: 40,
      reviewStatus: 'draft',
    });

    it('builds manifest with rally intervals from confirmed points only', () => {
      const session = makeSession({ points: [confirmedPoint, draftPoint] });
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      expect(manifest).not.toBeNull();
      expect(manifest!.rallies).toHaveLength(1);
      expect(manifest!.rallies[0]).toEqual({ startSec: 5, endSec: 20 });
    });

    it('excludes invalid rally intervals (endSec <= startSec)', () => {
      const badPoint = makePoint({ rallyStartSec: 30, rallyEndSec: 20 });
      const session = makeSession({ points: [confirmedPoint, badPoint] });
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      expect(manifest!.rallies).toHaveLength(1);
    });

    it('populates manifest metadata correctly', () => {
      const session = makeSession({ points: [confirmedPoint] });
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      expect(manifest!.schemaVersion).toBe(1);
      expect(manifest!.participantId).toBe(VALID_BETA.participantId);
      expect(manifest!.appVersion).toBe('1.1.0');
      expect(manifest!.sport).toBe('tennis');
      expect(manifest!.sessionType).toBe('match');
      expect(manifest!.video.sha256).toBe('');
      expect(manifest!.video.fps).toBe(30);
      expect(manifest!.consent.version).toBe(CONSENT_VERSION);
      expect(manifest!.consent.acceptedAt).toBe(VALID_BETA.consentAcceptedAt);
    });

    it('maps point fields to SubmissionPointLabel', () => {
      const point = makePoint({
        rallyStartSec: 5,
        rallyEndSec: 20,
        shotLocation: { x: 0.5, y: 0.7 },
        targetLocation: { x: 0.3, y: 0.9 },
        serveResult: 'firstIn',
        videoTimestamp: 15,
      });
      const session = makeSession({ points: [point] });
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      const p = manifest!.points[0];
      expect(p.outcome).toBe('won');
      expect(p.shotType).toBe('forehand');
      expect(p.serveResult).toBe('firstIn');
      expect(p.shotLocation).toEqual({ x: 0.5, y: 0.7 });
      expect(p.targetLocation).toEqual({ x: 0.3, y: 0.9 });
      expect(p.videoTimestamp).toBe(15);
    });
  });

  describe('serveTraining session', () => {
    it('succeeds with confirmed points even when no rally intervals', () => {
      const session = makeSession({
        sessionType: 'serveTraining',
        points: [makePoint({ serveResult: 'firstIn' })],
      });
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      expect(manifest).not.toBeNull();
      expect(manifest!.rallies).toHaveLength(0);
      expect(manifest!.points).toHaveLength(1);
    });

    it('returns null when zero confirmed points', () => {
      const session = makeSession({
        sessionType: 'serveTraining',
        points: [makePoint({ reviewStatus: 'draft' })],
      });
      expect(buildSubmissionManifest(session, VALID_BETA)).toBeNull();
    });
  });

  describe('softTennis session', () => {
    it('includes position when sport is softTennis', () => {
      const session = {
        ...makeSession({ points: [makePoint({ rallyStartSec: 1, rallyEndSec: 10 })] }),
        sport: 'softTennis' as const,
        position: 'forehand' as const,
      };
      const manifest = buildSubmissionManifest(session, VALID_BETA);

      expect(manifest!.sport).toBe('softTennis');
      expect(manifest!.position).toBe('forehand');
    });

    it('omits position for tennis sessions', () => {
      const session = makeSession({
        sport: 'tennis',
        points: [makePoint({ rallyStartSec: 1, rallyEndSec: 10 })],
      });
      const manifest = buildSubmissionManifest(session, VALID_BETA);
      expect(manifest!.position).toBeUndefined();
    });
  });
});
