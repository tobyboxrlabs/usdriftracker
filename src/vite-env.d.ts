/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROOTSTOCK_RPC?: string
  readonly VITE_USDRIF_ADDRESS?: string
  readonly VITE_USDRIF_OLD_ADDRESS?: string
  readonly VITE_RIFPRO_ADDRESS?: string
  readonly VITE_MOC_STATE_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

