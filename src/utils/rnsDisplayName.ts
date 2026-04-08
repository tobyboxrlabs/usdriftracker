/**
 * Hardening for reverse-resolved / BENS names shown in the UI (text + title).
 * Rejects control chars, HTML-sensitive characters, oversize strings, and non–.rsk-shaped labels.
 */

const MAX_LEN = 128
const INVALID_CHARS = /[\x00-\x1f\x7f<>"'&]/

/** RNS-style hostnames: LDH labels, must end with .rsk (case-insensitive). */
const RNS_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.rsk$/i

/**
 * Return a safe display string or null if the value must not be shown as a name.
 */
export function sanitizeRnsDisplayName(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.length > MAX_LEN) return null
  if (INVALID_CHARS.test(t)) return null
  if (!RNS_PATTERN.test(t)) return null
  return t
}
