import type { ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Secrets live in the environment, never in this file — the repository is
 * public. Locally they come from `.env.local` (git-ignored, loaded by the Expo
 * CLI); on EAS they come from the environment variables declared in
 * `eas.json`'s build profile. See `.env.example` for the full list.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SENTRY_DSN = process.env.SENTRY_DSN ?? '';
const SENTRY_ORG = process.env.SENTRY_ORG ?? '';
const SENTRY_PROJECT = process.env.SENTRY_PROJECT ?? '';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

const plugins: PluginEntry[] = [
  'expo-router',
  'expo-camera',
  [
    'expo-image-picker',
    {
      photosPermission: '撮影済みの動画をライブラリから選択するために使用します',
      cameraPermission: '試合や練習の動画を撮影するために使用します',
    },
  ],
  'expo-font',
  'expo-file-system',
  [
    'react-native-fast-tflite',
    {
      enableCoreMLDelegate: true,
    },
  ],
];

// The Sentry plugin runs `sentry-cli` at build time to upload source maps.
// Without a real org/project it either no-ops or fails the build, so it is only
// registered once both are supplied.
if (SENTRY_ORG && SENTRY_PROJECT) {
  plugins.push([
    '@sentry/react-native/expo',
    {
      organization: SENTRY_ORG,
      project: SENTRY_PROJECT,
    },
  ]);
}

const config: ExpoConfig = {
  name: 'CourtLens',
  slug: 'courtlens',
  scheme: 'courtlens',
  version: '1.2.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#1F6F4A',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.courtlens.app',
    infoPlist: {
      NSCameraUsageDescription: '試合や練習の動画を撮影するために使用します',
      NSMicrophoneUsageDescription: '動画録画時に音声を収録するために使用します',
      NSPhotoLibraryUsageDescription: '撮影済みの動画をライブラリから選択するために使用します',
      ITSAppUsesNonExemptEncryption: false,
    },
    buildNumber: '4',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#1F6F4A',
    },
    package: 'com.courtlens.app',
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },
  plugins,
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: 'a9495214-cd2f-40ae-a32e-ba7e8d517b58',
    },
    submission: {
      provider: 'supabase',
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      bucket: 'beta-submissions',
    },
    // Public Modal endpoints — no secret, safe to commit.
    cloudAnalysis: {
      submitUrl: 'https://yoshi22--tennis-ball-submit.modal.run',
      resultUrl: 'https://yoshi22--tennis-ball-result.modal.run',
    },
    sentryDsn: SENTRY_DSN,
  },
  owner: 'yoshi22',
};

export default config;
