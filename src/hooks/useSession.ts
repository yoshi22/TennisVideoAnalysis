import { useGlobalSearchParams } from 'expo-router';

import { useSessionStore } from '@/stores/sessionStore';
import { getParamId } from '@/utils/sessionParams';

export function useSession() {
  const { id } = useGlobalSearchParams();
  const sessionId = getParamId(id);
  const session = useSessionStore((state) => state.sessions.find((s) => s.id === sessionId));
  return { session, sessionId };
}
