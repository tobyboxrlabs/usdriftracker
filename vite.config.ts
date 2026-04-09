import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { devRpcProxyPlugin } from './vite/devRpcProxyPlugin'

/**
 * Get git commit hash
 * Vercel-safe: Uses VERCEL_GIT_COMMIT_SHA if available (Vercel provides this)
 * Falls back to git command, then 'unknown' if git is unavailable
 */
function getGitCommitHash(): string {
  // Vercel provides commit SHA as environment variable during build
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7)
  }
  
  // Fallback to git command (works in local dev, may fail in some CI/CD)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    // During Vercel build, if git is unavailable, return build timestamp
    return process.env.VERCEL ? 'vercel-build' : 'unknown'
  }
}

export default defineConfig({
  plugins: [
    devRpcProxyPlugin(),
    react(),
    {
      name: 'inject-git-hash',
      configResolved(config) {
        const hash = getGitCommitHash()
        // Inject as environment variable
        process.env.VITE_GIT_COMMIT_HASH = hash
      },
    },
  ],
  define: {
    'import.meta.env.VITE_GIT_COMMIT_HASH': JSON.stringify(getGitCommitHash()),
  },
  // Same-origin /api/rpc during `npm run dev` is implemented by devRpcProxyPlugin (CORS-safe).
  // `vercel dev` still serves api/rpc.ts for `/api/rpc`.
  // @ts-expect-error - vitest extends vite config with test property
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
