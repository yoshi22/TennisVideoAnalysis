import { Redirect } from 'expo-router';

// This tab route exists only so the tab bar slot is registered.
// The CustomTabBar intercepts the press and pushes /session/new instead.
export default function NewTab() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Redirect href={'/session/new' as any} />;
}
