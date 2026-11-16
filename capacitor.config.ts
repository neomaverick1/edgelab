import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neomaverick.edgelab',
  appName: 'Edgelab',
  webDir: 'dist',
  backgroundColor: '#f4f5f8',
  android: {
    backgroundColor: '#f4f5f8',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
    },
  },
};

export default config;
