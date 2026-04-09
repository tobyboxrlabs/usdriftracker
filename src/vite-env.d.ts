/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV?: boolean
  /** True when running under Vitest (keeps RPC direct in tests). */
  readonly VITEST?: boolean
  readonly MODE?: string
  readonly PROD?: boolean
  readonly SSR?: boolean
  readonly VITE_ROOTSTOCK_RPC?: string
  readonly VITE_STRIF_ADDRESS?: string
  readonly VITE_USDRIF_ADDRESS?: string
  readonly VITE_VUSD_ADDRESS?: string
  readonly VITE_RIFPRO_ADDRESS?: string
  readonly VITE_MOC_STATE_ADDRESS?: string
  readonly VITE_GIT_COMMIT_HASH?: string
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

