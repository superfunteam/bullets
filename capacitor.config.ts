import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'team.superfun.bullets',
  appName: 'Bullets',
  webDir: 'dist',
  server: {
    // The WebView serves from https://localhost/, a real origin, so the History
    // API works normally and no special routing handling is needed.
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#f7f5f2',
  },
};

export default config;
