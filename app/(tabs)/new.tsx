import { Redirect } from 'expo-router';

import { asHref } from '@/utils/navigation';

// This tab route exists only so the tab bar slot is registered.
// The CustomTabBar intercepts the press and pushes /session/new instead.
export default function NewTab() {
  return <Redirect href={asHref('/session/new')} />;
}
