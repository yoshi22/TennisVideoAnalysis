import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { CONSENT_VERSION, hasValidConsent, useBetaStore } from '@/stores/betaStore';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

describe('useBetaStore', () => {
  afterEach(() => {
    useBetaStore.setState({
      participantId: useBetaStore.getState().participantId,
      consentVersion: undefined,
      consentAcceptedAt: undefined,
    });
  });

  it('participantId is generated and stable across resets', () => {
    const id1 = useBetaStore.getState().participantId;
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);

    useBetaStore.getState().revokeConsent();
    const id2 = useBetaStore.getState().participantId;
    expect(id2).toBe(id1);
  });

  it('giveConsent sets consentVersion and acceptedAt', () => {
    useBetaStore.getState().giveConsent();
    const state = useBetaStore.getState();
    expect(state.consentVersion).toBe(CONSENT_VERSION);
    expect(typeof state.consentAcceptedAt).toBe('string');
    expect(new Date(state.consentAcceptedAt!).getTime()).not.toBeNaN();
  });

  it('revokeConsent clears consent but keeps participantId', () => {
    useBetaStore.getState().giveConsent();
    const idBefore = useBetaStore.getState().participantId;

    useBetaStore.getState().revokeConsent();
    const state = useBetaStore.getState();
    expect(state.consentVersion).toBeUndefined();
    expect(state.consentAcceptedAt).toBeUndefined();
    expect(state.participantId).toBe(idBefore);
  });

  it('hasValidConsent returns true only when consentVersion matches CONSENT_VERSION', () => {
    expect(hasValidConsent({ consentVersion: undefined })).toBe(false);
    expect(hasValidConsent({ consentVersion: CONSENT_VERSION - 1 })).toBe(false);
    expect(hasValidConsent({ consentVersion: CONSENT_VERSION })).toBe(true);
  });
});
