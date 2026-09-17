# Sentry Phase 1: crash observability

Phase 1 adds Sentry wiring and a friendly themed error fallback without sending events until production credentials are available.

## Current wiring

- `@sentry/react-native` is installed with the Expo SDK-compatible version.
- `app/_layout.tsx` initializes Sentry with `enabled: !__DEV__ && Boolean(dsn)`, so local development and an empty DSN are safe no-ops.
- The root stack is wrapped in `Sentry.ErrorBoundary` inside `ThemeProvider`.
- `src/components/common/ErrorFallback.tsx` shows a Japanese fallback with a retry button.
- Handled auto-score analysis failures now call `Sentry.captureException(error)` alongside the existing alerts.

## Before Phase 3 builds

Fill in the placeholders before the TestFlight build that should upload sourcemaps and deliver events:

- Set `expo.extra.sentryDsn` in `app.json`.
- Replace the Sentry config plugin `organization` and `project` values.
- Provide `SENTRY_AUTH_TOKEN` in the build environment for sourcemap upload.

The Sentry Expo config plugin runs at build time, so these placeholders do not affect `expo start` or a local dev client.
