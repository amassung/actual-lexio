import type { CapacitorConfig } from '@capacitor/cli';

// ─── Capacitor config — native iOS shell for Lexio ───────────────────────────
// Web assets are BUNDLED into the app (webDir: 'dist') rather than loaded from
// a remote URL. Two reasons:
//   1. Apple rejects thin web-view wrappers under App Store Review Guideline
//      4.2 (Minimum Functionality). A bundled app with local assets, offline
//      capability, and native audio reads as a real app.
//   2. Kids use this on iPads with flaky school/clinic wifi. Local assets mean
//      the UI always loads; only TTS needs the network.
//
// Tradeoff: content and voice fixes now require a new build + App Store review
// to reach TestFlight testers (~24-48h), instead of an instant Vercel push.
// The web build at actual-lexio.vercel.app stays live for fast iteration.
//
// NOTE: because assets are local, the app's origin is capacitor://localhost —
// relative API paths like `/api/summarize-student` no longer resolve to Vercel.
// See VITE_API_BASE_URL handling in src/services/teacherApi.ts.
const config: CapacitorConfig = {
  appId: 'app.lexio.reading',
  appName: 'Lexio',
  webDir: 'dist',
  ios: {
    // Let the web layer own the full screen; the app handles its own safe areas.
    contentInset: 'never',
    // Kids tap fast and repeatedly — bounce scrolling on a fixed-layout game
    // grid reads as jank, not feedback.
    scrollEnabled: true,
    backgroundColor: '#FFFDF7',
  },
  server: {
    // Required so fetch() to Supabase / ElevenLabs isn't treated as mixed content.
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
