/**
 * Append a short, consistent hint for recoverable failures (metrics / analysers).
 */
export function withNetworkHint(message: string): string {
  const t = message.trim()
  if (!t) return 'Request failed. Check your connection and use Refresh to try again.'
  if (
    /check your network|tap refresh|connection|try again later|please try again|outdated version|refresh the page/i.test(
      t
    )
  ) {
    return t
  }
  if (t.length > 280) return `${t.slice(0, 277)}… — Check your connection and use Refresh if needed.`
  return `${t} — Check your connection and use Refresh if needed.`
}

export function userFacingError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong'
  return withNetworkHint(msg)
}
