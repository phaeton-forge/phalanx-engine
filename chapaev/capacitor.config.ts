import type { CapacitorConfig } from '@capacitor/cli';

const isDev = process.env['CAPACITOR_DEV'] === 'true';

const config: CapacitorConfig = {
  appId: 'com.phalanx.chapaev',
  appName: 'Chapaev',
  webDir: 'dist',
  server: {
    androidScheme: isDev ? 'http' : 'https',
    iosScheme: isDev ? 'http' : 'https',
    ...(isDev && {
      url: `http://${process.env['CAPACITOR_SERVER_HOST'] ?? 'localhost'}:5174`,
      cleartext: true,
    }),
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  ios: {
    scheme: 'App',
  },
};

export default config;
