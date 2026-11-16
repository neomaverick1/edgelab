import '@fontsource-variable/manrope';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { isNative } from './lib/data/core';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets the site install to the home screen (iPhone: Share, then Add to Home Screen) and open offline.
if (import.meta.env.PROD && !isNative() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
