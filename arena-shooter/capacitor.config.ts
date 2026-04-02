import type { CapacitorConfig } from '@capacitor/cli';

const isDev = process.env['CAPACITOR_DEV'] === 'true';

const config: CapacitorConfig = {
  appId: 'com.phalanx.arenashooter',
  appName: 'Arena Shooter',
  webDir: 'dist',
  server: {
    androidScheme: isDev ? 'http' : 'https',
    ...(isDev && {
      url: `http://${process.env['CAPACITOR_SERVER_HOST'] ?? '10.0.2.2'}:5174`,
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
};

export default config;
