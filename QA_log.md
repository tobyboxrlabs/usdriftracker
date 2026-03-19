# QA Log

## Status Update (Latest)

### Resolved
- `history.ts`: type safety fix, quota handling, SSR guard, JSON validation
- `MiniLineGraph.tsx`: y-offset fix, `useId` for gradients, placeholder state, min/max optimization
- `App.tsx`: history key constants (`METRIC_KEYS`), BigInt mintable math, 0n handling, removed `MOC_STATE_ABI` usage
- `vite.config.ts`: vitest config typing issue resolved
- `vercel.json`: SPA rewrite verified

### Open (Recommendations)
- Accessibility improvements (ARIA labels, keyboard hints)
- Retry/backoff for API failures
- Skeleton loaders
- Add error tracking
- E2E tests
- Env var validation
- Consider websocket updates

### Test Fix Applied
- **Vitest mock updated for `ethers.id`**
  - Added `ethers.id` to test mock in `src/App.test.tsx`.
  - `npm test` now passes (13/13).

### New Issue (Tests)
- **Vitest failing due to missing `ethers.id` mock**
  - **Error:** `TypeError: ethers.id is not a function` from `src/BTCVaultAnalyser.tsx`
  - **Cause:** `src/App.test.tsx` mocks `ethers` but doesn’t include `id`, while `Analytics` (imported by `App`) imports `BTCVaultAnalyser` which uses `ethers.id`.
  - **Fix:** Extend the test mock to include `id` (e.g. `id: vi.fn(() => '0x...')`) or switch to partial mocking that preserves `ethers.id`.

### New Findings (MintRedeemAnalyser Review)
- **RPC proxy whitelist mismatch**
  - Production uses `/api/rpc?target=...` with `ROOTSTOCK_RPC_ALTERNATIVES`.
  - `api/rpc.ts` only allows `public-node.rsk.co` and `rsk.publicnode.com`.
  - Any other endpoint will 400 in production.
  - **Fix:** keep `ROOTSTOCK_RPC_ALTERNATIVES` aligned with proxy whitelist.
- **Duplicate `isDev` declaration inside loop**
  - Redundant `isDev` inside `makeRpcCall` loop.
  - **Fix:** remove inner `isDev`.
- **Blockscout rate limiting risk**
  - Large volume of requests without adaptive backoff.
  - **Fix:** add exponential backoff / centralized rate limiter.
- **Silent Blockscout failures**
  - `status !== '1'` returns empty array without surfacing error.
  - **Fix:** bubble warning or UI error for non‑success responses.

### New Issue (Vercel Build)
- **TypeScript JSX typings missing on Vercel build**
  - **Error:** `JSX element implicitly has type 'any'` and `Could not find a declaration file for module 'react/jsx-runtime'`
  - **Cause:** Vercel installs only `dependencies` by default; `@types/react` and `@types/react-dom` are in `devDependencies`, so `tsc` runs without JSX typings.
  - **Fix Options:**
    1. Move `@types/react` and `@types/react-dom` to `dependencies` (preferred for Vercel builds).
    2. Set Vercel env `VERCEL_USE_NODE_ENV=development` to install devDependencies during build.
    3. If using custom build script, run `npm install --include=dev`.
  - **Recommendation:** Move `@types/react` and `@types/react-dom` to `dependencies` to keep builds deterministic on Vercel.

---

## Code Review Summary - USDRIF Tracker (Resolved Items)

- useEffect dependency warning (fixed)
- async state update after unmount (fixed)
- refresh interval text hardcoded (fixed)
- missing error boundary (fixed)
- formatAmount edge cases (fixed)
- NaN handling in display (fixed)
- test suite added (vitest + RTL)

---

## Complete Code Review - USDRIF Tracker (Resolved Items)

- Unused `MOC_STATE_ABI` (resolved)
- Missing maxMintable implementation (resolved)
- Repeated address checksumming (resolved)
- Tests out of date (resolved)
- Unused config values (resolved)

---

## Vercel Deployment Review (Resolved Items)

- localStorage SSR safety (guarded access)
- git commit hash uses Vercel env when available
- history data validation improvements
- `vercel.json` SPA rewrites verified

