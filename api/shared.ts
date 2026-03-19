import type { VercelRequest } from '@vercel/node'

/**
 * Expected client version (git commit hash from build).
 * Matches VITE_GIT_COMMIT_HASH from the frontend build.
 * Vercel provides VERCEL_GIT_COMMIT_SHA at runtime.
 * Takes first 7 characters to match the short hash format used in vite.config.ts.
 */
export function getExpectedClientVersion(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) ||
    process.env.VITE_GIT_COMMIT_HASH ||
    process.env.GIT_COMMIT_HASH ||
    'unknown'
  )
}

/**
 * Check if the client making the request is outdated (version mismatch).
 */
export function isClientOutdated(req: VercelRequest): boolean {
  const clientVersion = req.headers['x-client-version'] as string | undefined
  const expected = getExpectedClientVersion()
  return !clientVersion || clientVersion !== expected
}
