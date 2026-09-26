/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

interface ImportMetaEnv {
  /** Deployed relay URL, e.g. https://redcoast-relay.example.workers.dev */
  readonly VITE_RELAY_URL?: string;
}
