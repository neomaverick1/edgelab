import { Download, Share, Smartphone, SquarePlus } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { isNative } from '../lib/data/core';
import { Modal } from './ui';

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const installed =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Android gets the APK straight away; iPhone and desktop open the install steps. Hidden inside an installed app. */
export function GetApp() {
  const [open, setOpen] = useState(false);
  if (isNative() || installed) return null;
  if (isAndroid)
    return (
      <a className="get-app" href="./Edgelab.apk" download="Edgelab.apk" title="Download the Android app">
        <Smartphone />
        <span>Android app</span>
      </a>
    );
  return (
    <>
      <button className="get-app" onClick={() => setOpen(true)}>
        <Smartphone />
        <span>{isIos ? 'iPhone app' : 'Get the app'}</span>
      </button>
      {open
        ? createPortal(
            <Modal title="Get the app" onClose={() => setOpen(false)}>
              <div className="modal-body get-app-body">
                <section>
                  <h3>iPhone and iPad</h3>
                  <ol>
                    <li>
                      Open <b>neomaverick1.github.io/edgelab</b> in Safari.
                    </li>
                    <li>
                      Tap <Share className="inline" aria-label="Share" /> Share.
                    </li>
                    <li>
                      Tap <SquarePlus className="inline" aria-label="Add" /> <b>Add to Home Screen</b>, then Add.
                    </li>
                  </ol>
                  <p className="muted">
                    Edgelab opens full screen from its own icon and keeps working offline with the markets you have loaded.
                  </p>
                </section>
                {isIos ? null : (
                  <section>
                    <h3>Android</h3>
                    <a className="btn primary" href="./Edgelab.apk" download="Edgelab.apk">
                      <Download /> Download Edgelab.apk
                    </a>
                    <p className="muted">
                      Open the file on your phone and allow the install when asked. The Android app loads any stock, ETF, forex pair or
                      future live.
                    </p>
                  </section>
                )}
              </div>
            </Modal>,
            document.body,
          )
        : null}
    </>
  );
}
