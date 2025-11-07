import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Get git commit hash
function getGitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [
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
  // Note: When using 'vercel dev', it handles API routes automatically
  // This proxy is only needed if using 'vite dev' separately
  // server: {
  //   proxy: {
  //     '/api': {
  //       target: 'http://localhost:3000',
  //       changeOrigin: true,
  //       secure: false,
  //     },
  //   },
  // },
  // @ts-expect-error - vitest extends vite config with test property
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
