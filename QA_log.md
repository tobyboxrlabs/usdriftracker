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

