/**
 * Dev-aware logger for local development.
 * - debug/info: only in dev (import.meta.env.DEV)
 * - warn/error: always
 * - Consistent prefixes, optional grouping
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  /** Component tag for log prefix, e.g. "Vault" -> "[Vault]" */
  tag?: string
  /** Enable verbose debug logs (default: true in dev) */
  verbose?: boolean
}

function createLogger(tag: string, verbose = true) {
  const prefix = tag ? `[${tag}]` : ''
  const shouldLog = isDev && verbose

  return {
    debug(...args: unknown[]) {
      if (shouldLog) {
        console.log(prefix, ...args)
      }
    },
    info(...args: unknown[]) {
      if (shouldLog) {
        console.info(prefix, ...args)
      }
    },
    warn(...args: unknown[]) {
      console.warn(prefix, ...args)
    },
    error(...args: unknown[]) {
      console.error(prefix, ...args)
    },
    /** Log a grouped section (collapsed in devtools) */
    group(label: string, fn: () => void) {
      if (shouldLog && console.groupCollapsed) {
        console.groupCollapsed(prefix, label)
        fn()
        console.groupEnd()
      }
    },
    /** Log a table for arrays/objects */
    table(data: unknown) {
      if (shouldLog && console.table) {
        console.log(prefix)
        console.table(data)
      }
    },
  }
}

export const logger = {
  vault: createLogger('Vault'),
  mintRedeem: createLogger('MintRedeem'),
  tokenData: createLogger('TokenData'),
  blockscout: createLogger('Blockscout'),
  app: createLogger('App'),
  lightCycle: createLogger('LightCycle'),
  rpc: createLogger('RPC'),
}
