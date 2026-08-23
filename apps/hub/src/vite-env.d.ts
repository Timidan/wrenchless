/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAILBOX_URL?: string;
  readonly VITE_PAIRING_ORIGIN?: string;
  readonly VITE_SPONSOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
