/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PROXY_TARGET?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short git SHA of the build, injected at compile time. */
declare const __BUILD_ID__: string;
