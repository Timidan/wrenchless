/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_SPONSOR_URL?: string;
  readonly VITE_TRAVEL_SAFE_V3_HELPER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
