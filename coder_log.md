# Coder Log - BTC Vault Analysers Implementation

**Last updated:** 2026-03-27 10:30 GMT  

---

## Running log (newest first)

---

**2026-03-27 10:30 GMT**

**BTC Vault analyser (`BTCVaultAnalyser.tsx`) — QA UI findings:** Combined Blockscout **`decoded.parameters`** with **`ethers.Interface.parseLog`** using **`BTC_VAULT_ABI`** (`buildParamMap`). **Amount:** `pickUint` aliases `amount` / `assets` / `value`. **User:** `pickAddr` order `user` → `owner` → `account` → `caller` → `sender`, then `receiver`; empty → **—** in table. **Shares:** new table column + Excel (order: Amount, Shares, USD, User, …). `QA_log.md` section marked addressed.

---

**2026-03-27 10:17 GMT**

**Tests — `useTokenData` + `blockscout`:** `src/hooks/useTokenData.test.ts` (`renderHook`: happy path with mocked `ethers` / `history` / long `REFRESH_INTERVAL`; RPC-unreachable path → user-facing error). `src/api/blockscout.test.ts` — `fetchLogsV1` validation, success JSON, “no logs” empty, API error, non-JSON; `fetchLogsV2` client block filter, empty page, HTTP error. **Suite:** 28 tests; `npm run build` OK. Note: Blockscout tests exercise shared rate limiter + real-ish delays (~3.2s file).

---

**2026-03-27 10:14 GMT**

**Complexity review** (`usdriftracker`, TS/TSX only; `agent-kit` excluded). Full picture: LOC sums + branch **proxy** (`rg` on leading `if` / `for` / `while` / `switch` / `catch` — **not** cyclomatic complexity; no ESLint `complexity` rule in repo).

| Area | Approx. LOC | Note |
|------|-------------|------|
| `src/` | ~5,330 | App, pipelines, hooks, components |
| `api/` | ~1,560 | Vercel/server routes |
| Repo root `*.ts` | ~3,330 | Maintenance scripts, `vite.config`, `middleware` |
| **Total** | **~10,230** | |

- **Tests:** 5 test files vs 33 non-test `src/` modules — tests cluster on `mintRedeem`, `vaultDepositWithdraw`, `config`, `App`, `ErrorBoundary`.
- **Top LOC:** `track-mint-redeem-enhanced.ts` (~798) → `fetchMintRedeemTransactions.ts` (~717) → `LightCycleGame.tsx` (~569) → `useTokenData.ts` (~460) → `api/scores.ts` (~443) → `blockscout.ts` (~349) → `api/rpc.ts` (~342) → `fetchVaultDepositWithdrawTransactions.ts` (~279).
- **Branch-proxy signal:** densest core modules → mint fetch, `useTokenData`, `blockscout`, vault fetch; `LightCycleGame` = many lines, fewer branch-like lines per 100 LOC.
- **Risks:** ~⅓ of codebase is **root scripts** (parallel semantics to app, drift); **Blockscout** hub couples v1/v2 + rate limit — high blast radius; **single huge** mint pipeline still hard to hold in head.

**Next (from review):** ESLint complexity + `max-lines-per-function`; folder or deprecate orphan scripts; **`BTCVaultAnalyser`** pipeline extract + Vitest; split mint fetch into named phase helpers; extend tests for `useTokenData` + `blockscout`.

---

**2026-03-27 10:13 GMT**

**Log updates:** Add new notes **here**, **above** the next `---` divider (prepend only — **do not** append to the end of the file). Each entry starts with **`YYYY-MM-DD HH:MM TZ`** in bold, then bullets or paragraphs. Separate **every** entry with a full-width horizontal rule **`---`** above and below the timestamp block so scans stay readable.

---

**Date** (planning baseline): January 24, 2026  
**Status**: Planning Complete, Ready for Implementation  
**Network**: RSK Testnet

---

## Refactor Progress Summary (2026-01-24)

**Completed:** Items 1–5 from `docs/REFACTOR_PLAN.md`

| Item | Deliverables | Status |
|------|--------------|--------|
| **Item 1** | amount.ts, exportExcel.ts, api/shared.ts | ✅ |
| **Item 2** | blockscout.ts, rpc.ts; analysers updated | ✅ |
| **Item 3** | MetricDisplay, ContractAddressTable components | ✅ |
| **Item 4** | useTokenData, MetricsPage, slim App.tsx | ✅ |
| **Item 5** | AnalyserShell component | ✅ |

**Lines removed:** ~700+ from analysers; ~820 from App.tsx (Items 3–4). **New modules:** ~350 from analysers, ~400 useTokenData, ~200 MetricsPage. App.tsx: ~900 → ~80 lines.

**Next:** Item 6 – API handler wrapper (optional).

---

## Mint/Redeem modularisation — findings & recap (2026-03-26)

### What shipped
- **`src/mintRedeem/`** packages the mint/redeem data pipeline separately from React:
  - **`types.ts`** — `MintRedeemTransaction` and related shapes used by the analyser and export.
  - **`constants.ts`** — USDRIF/RIFPRO addresses, ERC20 `Transfer` topic, MoC proxy addresses, block window helpers; single place for topic/address literals that were scattered in the component.
  - **`fetchMintRedeemTransactions.ts`** — async pipeline: Blockscout v1 logs via `fetchLogsV1`, RPC via `rpcCall`, MoC log enrichment, classification (mint/redeem flavours), time window filter. Exposes optional **`onProgress`** for UI progress only when there is work (`totalTxs > 0`).
- **`MintRedeemAnalyser.tsx`** — shell (`AnalyserShell`), filters, days/refresh, table, Excel export; calls `fetchMintRedeemTransactions(days, setLoadingProgress)` and maps errors through **`logger.mintRedeem`** (same pattern as other feature loggers in `src/utils/logger.ts`).

### Why it helps
- **Testability:** Core logic is importable without mounting React; mocks target `rpcCall`, `fetchLogsV1`, `fetch`, and logger.
- **Boundaries:** UI concerns (XLSX columns, filter state, collapse) stay out of the fetch module; networking/ABI/decoding stay out of trivial UI code.
- **Consistency:** Aligns with earlier refactors (shared `blockscout.ts`, `rpc.ts`, `AnalyserShell`).

### Tests
- **`src/mintRedeem/fetchMintRedeemTransactions.test.ts`** (Vitest): empty-log run (no `onProgress`, correct `currentBlock`/`fromBlock`); single **USDRIF Mint** path with stubbed Blockscout tx info + RPC. Run: `npm test -- --run src/mintRedeem/fetchMintRedeemTransactions.test.ts`.

### Follow-ups (optional, from broader modularisation backlog)
- **`docs/REFACTOR_PLAN.md` §5.2 / Item 6:** `withApiHandler` (or similar) for API route boilerplate — still pending.
- **§6 Config:** Move analyser-heavy ABIs to `src/abis/` or co-locate with `mintRedeem` if you want `config.ts` slimmer.
- **`track-mint-redeem.ts` (repo root):** Still a separate CLI-style script with overlapping semantics to the app pipeline; consider reusing `fetchMintRedeemTransactions` or documenting “script vs UI” duplication if both must stay.

---

## Modularisation — findings & forward plan (2026-03-26)

### Findings (current state)

| Area | Status | Notes |
|------|--------|--------|
| Shared utils / API | ✅ | `amount.ts`, `exportExcel.ts`, `api/shared.ts`, `blockscout.ts`, `rpc.ts` |
| App shell | ✅ | `useTokenData`, `MetricsPage`, slim `App.tsx` |
| Analyser UI shell | ✅ | `AnalyserShell` — header, collapse, loading/progress slots |
| Mint/redeem **data** pipeline | ✅ | `src/mintRedeem/` + `fetchMintRedeemTransactions.test.ts` |
| Vault vUSD **data** pipeline | ✅ | `src/vaultDepositWithdraw/` + `VaultDepositWithdrawAnalyser.tsx` ~252 lines (UI/export/shell) |
| BTC vault **data** pipeline | ⏳ | `BTCVaultAnalyser.tsx` ~317 lines — same pattern, testnet v2 |
| API route boilerplate | ⏳ | REFACTOR **Item 6** — `withApiHandler`-style wrapper not started |
| Config / ABIs | ⏳ | REFACTOR **§6** — heavy ABIs still in `config.ts` / co-located in analysers |
| Root script vs app | ⏳ | `track-mint-redeem.ts` duplicates mint/redeem semantics alongside UI pipeline |

**Split quality check:** `MintRedeemAnalyser.tsx` ~323 lines (mostly UI/table/export); `fetchMintRedeemTransactions.ts` ~717 lines (network + decode — acceptable “fat module” if tested). **Vault:** `fetchVaultDepositWithdrawTransactions.ts` ~279 lines + thin analyser ~252 lines; **BTC** vault analyser not yet split.

### Principles (apply to the next extractions)

1. **Pure pipeline module** — `fetch…(…, onProgress?) → { rows, metadata }` with no React imports; UI-only code stays in `*Analyser.tsx`.
2. **Co-locate** — `types.ts`, `constants.ts`, `fetch….ts`, `*.test.ts` under `src/<feature>/` (mirror `mintRedeem/`).
3. **No security drift** — same RPC proxy whitelist, Blockscout helpers, rate limiting; refactors are file layout, not new attack surface.
4. **Test at the boundary** — after each extraction, add Vitest with at least an **empty** run and **one happy path** (stub `fetchLogsV2`, `rpcCall`, `fetch` as needed).

### Phased plan

| Phase | Goal | Primary deliverables | Risk |
|-------|------|----------------------|------|
| **A** | API handler deduplication | Introduce `withApiHandler` (or equivalent); migrate **one** route, then roll forward | Low if each route keeps identical headers, rate limits, and version checks |
| **B** | Vault pipeline module | ✅ **Done (2026-03-26)** — `src/vaultDepositWithdraw/`; see summary below | — |
| **C** | BTC vault pipeline module | Same for `BTCVaultAnalyser` (testnet base URL, event decode); optional: isolate `fetchRbtcUsdPrice` | Medium |
| **D** | Config / ABIs | Move analyser-specific fragments to `src/abis/` or next to each feature module; slim `config.ts` | Low per step; many import touchpoints |
| **E** | Scripts alignment | Either import `fetchMintRedeemTransactions` from a small Node entry, or document why the CLI must stay standalone | Low (docs) to medium (shared TS build for script) |

**Suggested order:** **Phase B (vault)** complete. Next: **C** (BTC vault pipeline) or **A** (API wrapper). **D** opportunistically when editing ABIs. **E** when touching mint/redeem logic again.

### Per-phase checklist (before merge)

- [ ] No intentional behaviour or user-visible contract change.
- [ ] `npm run build` and `npm test` green.
- [ ] Update **`Last updated`** at the top of this log; update **`docs/REFACTOR_PLAN.md`** Progress table when a numbered item completes.

### Module inventory — LOC and complexity (2026-03-26)

**LOC** = physical lines (`wc -l`). Small boilerplate files (e.g. `main.tsx`, `vite-env.d.ts`, Vitest `setup`) omitted.

**Complexity (1–5)**

| Score | Meaning |
|------:|--------|
| **1** | Small, single concern, little branching |
| **2** | Small–medium helper or thin UI |
| **3** | Medium — async, several callers, or moderate UI/logic |
| **4** | Large — multi-step integration (RPC + explorer + state) or substantial API handler |
| **5** | Very large / heavy domain — long pipelines, many branches, decode + pagination |

#### `src/mintRedeem/`

| Module | LOC | Cx |
|--------|-----|:--:|
| `types.ts` | 13 | 1 |
| `constants.ts` | 44 | 1 |
| `fetchMintRedeemTransactions.ts` | 717 | **5** |
| `fetchMintRedeemTransactions.test.ts` | 131 | 2 |
| **Prod subtotal** (3 files) | **774** | **5** |

#### `src/vaultDepositWithdraw/`

| Module | LOC | Cx |
|--------|-----|:--:|
| `types.ts` | 11 | 1 |
| `constants.ts` | 27 | 1 |
| `fetchVaultDepositWithdrawTransactions.ts` | 279 | **4** |
| `fetchVaultDepositWithdrawTransactions.test.ts` | 119 | 2 |
| **Prod subtotal** (3 files) | **317** | **4** |

#### `src/api/` & `src/utils/`

| Module | LOC | Cx |
|--------|-----|:--:|
| `src/api/blockscout.ts` | 349 | 4 |
| `src/utils/rpc.ts` | 143 | 3 |
| `src/utils/asyncRetry.ts` | 71 | 2 |
| `src/utils/logger.ts` | 66 | 2 |
| `src/utils/exportExcel.ts` | 41 | 2 |
| `src/utils/amount.ts` | 39 | 1 |
| `src/utils/address.ts` | 32 | 1 |
| `src/utils/userFacingError.ts` | 22 | 1 |

#### `src/components/`

| Module | LOC | Cx |
|--------|-----|:--:|
| `MetricDisplay.tsx` | 181 | 3 |
| `AnalyserShell.tsx` | 111 | 2 |
| `ContractAddressTable.tsx` | 46 | 2 |

#### `src/hooks/` & `src/pages/`

| Module | LOC | Cx |
|--------|-----|:--:|
| `hooks/useTokenData.ts` | 460 | 4 |
| `pages/MetricsPage.tsx` | 195 | 3 |

#### Analysers & related `src/` routes

| Module | LOC | Cx |
|--------|-----|:--:|
| `VaultDepositWithdrawAnalyser.tsx` | 252 | 3 |
| `LightCycleGame.tsx` | 569 | 4 |
| `MintRedeemAnalyser.tsx` | 323 | 3 |
| `BTCVaultAnalyser.tsx` | 317 | 3 |
| `MiniLineGraph.tsx` | 102 | 3 |
| `config.ts` | 102 | 3 |
| `history.ts` | 136 | 3 |
| `App.tsx` | 83 | 2 |
| `ErrorBoundary.tsx` | 58 | 2 |
| `Analytics.tsx` | 57 | 1 |
| `RootstockLogo.tsx` | 11 | 1 |

#### `api/` (server)

| Module | LOC | Cx |
|--------|-----|:--:|
| `scores.ts` | 443 | 4 |
| `rpc.ts` | 342 | 4 |
| `security.ts` | 270 | 3 |
| `errorLogger.ts` | 215 | 3 |
| `analytics.ts` | 164 | 3 |
| `middleware.ts` | 134 | 3 |
| `export-excel.ts` | 103 | 3 |
| `shared.ts` | 25 | 1 |

#### Takeaways

- **Largest single modules:** `fetchMintRedeemTransactions.ts` (717), `LightCycleGame.tsx` (569), `useTokenData.ts` (460), `api/scores.ts` (443), `fetchVaultDepositWithdrawTransactions.ts` (279).
- **Cx 5:** mint/redeem fetch only. **Cx 4 pipelines:** Blockscout, `useTokenData`, vault fetch, scores/rpc handlers. **Next pipeline extraction:** `BTCVaultAnalyser` — see Phase **C** above.

### vUSD Vault pipeline extraction plan (2026-03-26)

Mirror **`src/mintRedeem/`**: move everything that is not React, XLSX column layout, or `AnalyserShell` wiring out of **`VaultDepositWithdrawAnalyser.tsx`**. ✅ **Implemented** — see **vUSD Vault extraction — implemented** below.

#### Goal

- **`fetchVaultDepositWithdrawTransactions(days, onProgress?)`** (name TBD) returns **`{ recentTxs, fromBlock, currentBlock }`** (and any other metadata the UI already needs).
- **`VaultDepositWithdrawAnalyser.tsx`** holds: state, `AnalyserShell`, controls, table, `exportToExcel`, `useEffect` / unmount cleanup — comparable to **`MintRedeemAnalyser`** after modularisation.

#### Non-goals (first PR)

- Changing Blockscout v2 pagination, **`MAX_PAGES`**, or the **100-tx** gettxinfo cap unless explicitly scoped (document current behaviour in module JSDoc).
- Replacing `formatAmount` in the pipeline vs UI — either keep formatting in the pipeline as today (parity) or document a follow-up to return bigint + decimals.

#### Proposed layout

```
src/vaultDepositWithdraw/
  types.ts          # VaultTransaction (move from analyser)
  constants.ts      # BLOCKSCOUT_API_V2, VAULT_ADDRESS, VAULT_ABI, blocksPerDay, batch sizes/delays, explorer base URL for gettxinfo
  fetchVaultDepositWithdrawTransactions.ts
  fetchVaultDepositWithdrawTransactions.test.ts
```

Optional: **`explorer.ts`** or **`fetchVaultTxSuccessFromExplorer`** colocated in the same folder if kept private to the pipeline.

#### What moves into the fetch module (inventory)

| Current location (analyser) | Destination |
|----------------------------|-------------|
| `fetchVaultTxSuccessFromExplorer` | Same file as fetch or `gettxinfo.ts` helper |
| `VaultTransaction` interface | `types.ts` |
| `VAULT_ABI`, topics via `ethers.Interface` | `constants.ts` or inside fetch next to ABI |
| `BLOCKSCOUT_API_V2`, `VAULT_ADDRESS` | `constants.ts` |
| RPC block range, `fetchLogsV2`, filter Deposit/Withdraw | `fetchVault…ts` |
| Block timestamp batching (`BLOCK_BATCH_SIZE` / delay) | `fetchVault…ts` |
| Tx status batching + gettxinfo loop (cap 100) | `fetchVault…ts` |
| Event → row decode (owner/receiver, assets BigInt, sort, time cutoff) | `fetchVault…ts` |
| `logger.vault.*` | Keep calls from fetch module (same as mint) |

#### `onProgress` contract

- Align phases with existing UX: **fetch events** → **block timestamps** → **tx details** → **processing** → **complete**.
- Use the same shape the UI already uses: `{ current, total, phase }` with **`total: 100`**-style progress, OR normalize to **`{ current, total, phase }`** where `total` is real step counts — pick one and match **MintRedeem** for consistency across analysers (follow-up in log if changed).
- When there are **zero** vault events, decide whether to skip progress updates (mint skips when `totalTxs === 0` for initial callback — align for vault if applicable).

#### Tests (Vitest)

1. **Empty:** `fetchLogsV2` returns `[]` → `recentTxs` empty, correct `fromBlock` / `currentBlock`, RPC `eth_blockNumber` mocked.
2. **One Deposit or one Withdraw:** stub **`BlockscoutV2Log`**-shaped object with `topics`, `decoded.parameters`, `block_number`, `transaction_hash`; stub `rpcCall` for `eth_getBlockByNumber`; stub `fetch` for gettxinfo if that path runs.
3. **Optional:** assert **`txDetailsLimit`** (100) does not break test when only one hash.

Mock **`../api/blockscout`**, **`../utils/rpc`**, **`globalThis.fetch`**, **`../utils/logger`**.

#### Implementation steps (suggested PR sequence)

1. **Scaffold** `src/vaultDepositWithdraw/` with `types.ts` + `constants.ts` (no behaviour change — re-export and import from analyser temporarily, or move + fix imports in one commit).
2. **Extract** `fetchVaultTxSuccessFromExplorer` + core `fetchVault…` body; wire analyser to call it inside existing `fetchTransactions` try/catch; **run build + manual smoke** on Analytics.
3. **Thin** analyser: delete inlined logic; keep `userFacingError`, progress timeout ref, collapse behaviour unchanged.
4. **Add** `fetchVaultDepositWithdrawTransactions.test.ts`; run `npm test`.
5. **Docs:** update this log + optional one line in **`docs/REFACTOR_PLAN.md`** Progress / Phase **B** when done.

#### Risks / watch list

- **`fetchLogsV2`** mainnet v2 + client-side block filter — behaviour must stay identical (paginate until out of range or `MAX_PAGES`).
- **React `setState` in loops** today becomes **sync `onProgress` from async pipeline** — ensure no stale closure issues (mint pattern already solves this by passing setter as callback).
- **100-transaction** status cap: document in module; changing it is a product decision.

#### Done when

- Analyser file is roughly **UI + export + shell** only (~150–250 LOC target; exact number secondary).
- **`npm run build`** and **`npm test`** pass; vault panel still shows deposits/withdrawals for 1/7/30/90 day toggles.

#### vUSD Vault extraction — implemented (2026-03-26)

- **New package:** `src/vaultDepositWithdraw/` — `types.ts` (`VaultTransaction`), `constants.ts` (v2 API, vUSD address from `CONFIG`, `VAULT_ABI`, block/batch/`VAULT_TX_STATUS_LOOKUP_MAX` = 100), `fetchVaultDepositWithdrawTransactions.ts` (gettxinfo helper inlined, same progress phases as pre-extraction), `fetchVaultDepositWithdrawTransactions.test.ts` (empty v2 run + one **Deposit** with mocked `fetchLogsV2` / `rpcCall` / `fetch`).
- **`VaultDepositWithdrawAnalyser.tsx`** (~252 lines): state, `AnalyserShell`, controls, table, Excel export, `userFacingError` + progress timeout — calls `fetchVaultDepositWithdrawTransactions(days, setLoadingProgress)`.
- **Parity:** No intentional change to v2 pagination, **100-tx** gettxinfo cap, or time/block math; `npm test` **17/17**, `npm run build` passes.

---

## API Rate Limiting (2026-02-11)

### Current Implementation
- In-memory rate limiting in `api/security.ts` via `checkRateLimit()`
- All endpoints protected: rpc (100/min), analytics (60/min), export-excel (30/min), scores (10/min)
- Per-IP limits; map cleanup when size > 1000

### Limitations
- Resets on serverless cold start
- Per-instance limits (no global limit across instances)

### Future Improvements (Optional)
1. Consider Redis/Vercel KV for shared rate limiting at scale
2. Add Retry-After header on 429 responses
3. Document rate limits in API docs

---

## Refactor Plan Item 3 – Completed (2026-01-24)

Extracted components from `App.tsx` into new files:

### 1. `src/components/MetricDisplay.tsx`
- **MetricDisplay** – Renders metric cards with label, value, unit; optional MiniLineGraph for history; optional help tooltip (? icon)
- **Tooltip** – Portal-rendered tooltip (createPortal to document.body) with scroll/resize-aware positioning
- **formatNumericValue** – Locale-aware numeric formatting; handles NaN by returning original string

### 2. `src/components/ContractAddressTable.tsx`
- Footer table with "Contract Addresses" heading
- Six rows: RIF Token, stRIF, USDRIF, RIFPRO, MoC V2 Core (RoC), RIF Price Feed (RLabs)
- Links to Blockscout internal_txns tab
- Uses CONFIG for addresses; RIF Token address hardcoded (not in CONFIG)

**App.tsx:** Removed ~200 lines (formatNumericValue, Tooltip, MetricDisplay, footer table). Imports MetricDisplay and ContractAddressTable. Removed createPortal and MiniLineGraph imports.

**Verification:** Build passes. No feature or security changes.

---

## Refactor Plan Item 4 – Completed (2026-01-24)

Extracted token data logic and home page UI:

### 1. `src/hooks/useTokenData.ts`
- **TokenData** interface – metric fields (stRIFSupply, vaultedUsdrif, rifproSupply, minted, rifPrice, rifCollateral, maxMintable), symbol, name, loading, error, lastUpdated
- **ProxyJsonRpcProvider** – extends ethers.JsonRpcProvider, proxies RPC via `/api/rpc`, handles 410 OUTDATED_CLIENT
- **getWorkingProvider** – tries proxy then direct endpoints, caches provider instance
- **queryOptionalMetric** – safe contract reads returning `{ raw, formatted }` or null
- **fetchTokenData** – fetches all metrics, saves history, handles OUTDATED_CLIENT (stops polling)
- Returns: `tokenData`, `refreshingMetrics`, `history`, `isClientOutdated`, `fetchTokenData`
- Sets up polling interval on mount; skips when `isClientOutdated`

### 2. `src/pages/MetricsPage.tsx`
- Header: "PUT RIF TO WORK", subtitle, git hash, deployment count, Analytics/Game links
- Card: RIF Metrics, last-updated time
- Outdated-client banner (red) with Refresh Page button
- Error state with Retry button
- Metrics grid: 7 MetricDisplay components + disclaimer
- Card footer: Refresh Now button, auto-refresh info
- ContractAddressTable
- Accepts `deploymentCount` prop from App

### 3. Slim `src/App.tsx`
- Routes: `/` (MetricsPage), `/game` (LightCycleGame), `/tools`→`/analytics`, `/analytics` (Analytics)
- `deploymentCount` state and `fetchDeploymentCount` on mount (skipped in dev)
- ~80 lines (down from ~900)

**Verification:** Build and tests pass. No feature or security changes.

---

## Refactor Plan Item 5 – Completed (2026-01-24)

Shared analyser shell for collapsible layout:

### 1. `src/components/AnalyserShell.tsx`
- Props: `title`, `networkBadge` ('mainnet'|'testnet'), `isCollapsed`, `onToggleCollapse`, `controls`, `error`, `loading`, `loadingProgress?`, `isEmpty`, `emptyMessage`, `children`
- Header: h2, RootstockLogo network badge, collapse toggle
- When expanded: controls slot; then error div, loading (with optional progress bar), empty-message div, or children
- Reuses `MintRedeemAnalyser.css` class names

### 2. Refactored analysers
- **MintRedeemAnalyser:** Uses AnalyserShell; controls include filter (All/USDRIF/RifPro), days select, Refresh, XLS; children = table container with filter-empty handling
- **VaultDepositWithdrawAnalyser:** Uses AnalyserShell; controls = days, Refresh, XLS; passes `loadingProgress`
- **BTCVaultAnalyser:** Uses AnalyserShell; controls = days, Refresh, XLS

**Verification:** Build and tests pass. No feature or security changes.

---

## Refactor Plan Item 1 – Completed (2026-01-24)

Implemented low-risk, high-reuse shared utilities from `docs/REFACTOR_PLAN.md`:

### 1. `src/utils/amount.ts`
- `formatAmount(amount, decimals?)` – BigInt to human-readable string
- `formatAmountDisplay(amount, decimals?)` – locale-aware display formatting
- Replaced 4 duplicated implementations in App.tsx, MintRedeemAnalyser, VaultDepositWithdrawAnalyser, BTCVaultAnalyser

### 2. `src/utils/exportExcel.ts`
- `generateDateFilename(prefix)` – `{prefix}_{YYYYMMDD}.xlsx`
- `generateTimestampFilename(prefix)` – `{prefix}-{ISO-timestamp}.xlsx`
- `writeExcelWorkbook(wb, filename)` – XLSX.writeFile with standard error handling
- MintRedeemAnalyser and VaultDepositWithdrawAnalyser use date filenames; BTCVaultAnalyser uses timestamp

### 3. `api/shared.ts`
- `getExpectedClientVersion()` – centralised client version from env
- `isClientOutdated(req)` – version check helper
- Replaced duplication in `api/rpc.ts`, `api/analytics.ts`, `api/scores.ts`

**Verification:** Build and tests pass. No feature or security changes.

---

## Refactor Plan Item 2 – Completed (2026-01-24)

Implemented shared API layer from `docs/REFACTOR_PLAN.md`:

### 1. `src/api/blockscout.ts`
- Shared `BlockscoutRateLimiter` (single instance across all calls)
- `fetchLogsV1(address, fromBlock, toBlock, topic0)` – Blockscout API v1 for MintRedeemAnalyser
- `fetchLogsV2(baseUrl, address, fromBlock, toBlock)` – Blockscout API v2 for VaultDepositWithdrawAnalyser (mainnet) and BTCVaultAnalyser (testnet)
- Exported types: `BlockscoutLog`, `BlockscoutV2Log`, `BlockscoutV2Response`

### 2. `src/utils/rpc.ts`
- `rpcCall<T>(method, params)` – generic JSON-RPC client with proxy/direct fallback
- MintRedeemAnalyser and VaultDepositWithdrawAnalyser use it for `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getTransactionByHash`
- BTCVaultAnalyser continues using direct fetch to testnet RPC for `eth_blockNumber`

### 3. Analyser updates
- **MintRedeemAnalyser:** Removed ~200 lines (rate limiter, fetchLogs, makeRpcCall). Uses fetchLogsV1, rpcCall.
- **VaultDepositWithdrawAnalyser:** Removed ~200 lines. Uses fetchLogsV2, rpcCall.
- **BTCVaultAnalyser:** Removed ~110 lines (rate limiter, fetchLogsV2). Uses fetchLogsV2 with testnet baseUrl.

**Verification:** Build and tests pass. No feature or security changes.

---

## 🚀 Quick Start Summary

**Task**: Create a new React/TypeScript analyser component for BTC Vault transactions on RSK Testnet.

**What to Build**:
- Component: `src/BTCVaultAnalyser.tsx` (similar to `VaultDepositWithdrawAnalyser.tsx`)
- Configuration: Add BTC Vault contracts and ABIs to `src/config.ts`
- Integration: Add component to `src/Analytics.tsx`

**Key Contract**: `RBTCAsyncVaultProxy` at `0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1` (RSK Testnet)

**Key Events to Track**:
- `DepositRequest`, `NativeDepositRequested`, `DepositClaimed`
- `RedeemRequest`, `RedeemClaimed`
- `SyntheticYieldApplied` (optional)

**API**: Use Blockscout API v2 (testnet): `https://rootstock-testnet.blockscout.com/api/v2`

**Pattern**: Copy patterns from `VaultDepositWithdrawAnalyser.tsx` - it uses the same Blockscout API v2 approach.

**See sections below for**: Complete code patterns, interfaces, event signatures, and implementation checklist.

---

## 📋 Project Context

This is a React/TypeScript web application (`usdriftracker`) that tracks USDRIF and related protocol metrics. The application already has two analyser components:
- `MintRedeemAnalyser` - Tracks USDRIF mint/redeem operations
- `VaultDepositWithdrawAnalyser` - Tracks vUSD vault deposits/withdrawals

**New Feature**: Create BTC Vault analysers to track BTC Vault operations on RSK Testnet.

---

## 🎯 Objective

Create a new set of analysers for the BTC Vault system, similar to existing analysers, but specifically for BTC Vault events and operations on RSK Testnet.

**Key Requirements**:
- At least 1 analyser initially (can expand later)
- Show consolidated events similar to existing analysers
- Point to RSK Testnet (not mainnet)
- Use Blockscout API for event fetching
- Support collapsible UI (default collapsed)
- Excel export functionality

---

## 🏗️ BTC Vault Contract Architecture

### **Contract Addresses (RSK Testnet)**

```typescript
// BTC Vault Contracts (RSK Testnet)
export const BTC_VAULT_CONTRACTS = {
  RBTC_ASYNC_VAULT_PROXY: '0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1',
  RBTC_ASYNC_VAULT_IMPL: '0x08B43Ed82Eb069C6545ecD5b74Bb43bAdD58C6ED',
  BUFFER_PROXY: '0xF7930654CE9ef043B1FA2Fd51b4A2B1C8b4f6F9a',
  BUFFER_IMPL: '0x1c769e16c0E9a801DF79ACaaA33B9DeE2d092705',
  SYNTHETIC_YIELD_PROXY: '0x85f9204F1A0317Eb398918f553205e1558d15Cb9',
  SYNTHETIC_YIELD_IMPL: '0xf7A8AC8e005cdD62462a899910a5a7F0A8e79bBe',
  PERMISSIONS_MANAGER_PROXY: '0xFA4F19443ec119dBC8fD913aE0902e924fb4266E',
  PERMISSIONS_MANAGER_IMPL: '0x549945384AefB50E4Fc8A16068870dad05Ab02f9',
} as const
```

**Key Insight**: Use **Proxy contracts** for event queries (they forward events from implementation).

### **Primary Contract: RBTCAsyncVaultProxy**

This is the main contract for the BTC Vault analyser. It emits 28 events covering:
- Deposit lifecycle (Request → Claimed)
- Withdrawal lifecycle (Request → Claimed)
- Yield operations
- Epoch management
- Buffer operations

---

## 📊 Discovery Results

### **Contract Analysis Summary**

All 8 contracts successfully analyzed via interrogation script (`scripts/interrogate_btc_vault_contracts.py`):

| Contract | Events | Functions | Primary Use |
|----------|--------|-----------|-------------|
| RBTCAsyncVaultProxy | 28 | 87 | **Main Vault** (use this) |
| BufferProxy | 7 | 16 | Buffer Management |
| SyntheticYieldProxy | 6 | 22 | Yield Generation |
| PermissionsManagerProxy | 9 | 25 | Access Control |

### **Recommended Events for Primary Analyser**

From **RBTCAsyncVaultProxy** (`0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1`):

#### **Primary Events:**

1. **`DepositRequest`**
   ```
   DepositRequest(
     address indexed user,
     address indexed receiver,
     uint256 amount,
     address indexed token,
     uint256 shares
   )
   ```
   - User requests a deposit
   - Track deposit requests

2. **`NativeDepositRequested`**
   ```
   NativeDepositRequested(
     address indexed user,
     address indexed receiver,
     uint256 amount,
     uint256 shares
   )
   ```
   - Native RBTC deposit requested
   - Track native RBTC deposits

3. **`DepositClaimed`**
   ```
   DepositClaimed(
     address indexed user,
     address indexed receiver,
     address indexed token,
     uint256 amount,
     uint256 shares,
     uint256 epochId
   )
   ```
   - Deposit is completed/claimed
   - Track completed deposits (includes epochId)

4. **`RedeemRequest`**
   ```
   RedeemRequest(
     address indexed user,
     address indexed receiver,
     uint256 shares,
     address indexed token,
     uint256 amount
   )
   ```
   - User requests withdrawal/redeem
   - Track withdrawal requests

5. **`RedeemClaimed`**
   ```
   RedeemClaimed(
     address indexed user,
     address indexed receiver,
     address indexed token,
     uint256 shares,
     address indexed assetToken,
     uint256 amount,
     uint256 epochId
   )
   ```
   - Withdrawal/redeem is completed
   - Track completed withdrawals (includes epochId)

6. **`SyntheticYieldApplied`** (Optional)
   ```
   SyntheticYieldApplied(
     uint256 indexed epochId,
     address indexed caller,
     uint256 amount
   )
   ```
   - Synthetic yield is applied to an epoch
   - Track yield generation

### **Event Categories**

- **Deposit**: 14 events
- **Withdrawal**: 14 events
- **Buffer**: 10 events
- **Yield**: 6 events
- **Epoch**: 4 events

---

## 🔧 Implementation Plan

### **Phase 1: Configuration Updates**

**File**: `src/config.ts`

Add BTC Vault configuration:

```typescript
// BTC Vault Contracts (RSK Testnet)
export const BTC_VAULT_CONTRACTS = {
  RBTC_ASYNC_VAULT_PROXY: '0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1',
  BUFFER_PROXY: '0xF7930654CE9ef043B1FA2Fd51b4A2B1C8b4f6F9a',
  SYNTHETIC_YIELD_PROXY: '0x85f9204F1A0317Eb398918f553205e1558d15Cb9',
  PERMISSIONS_MANAGER_PROXY: '0xFA4F19443ec119dBC8fD913aE0902e924fb4266E',
} as const

// RSK Testnet Configuration
export const RSK_TESTNET = {
  chainId: 31,
  name: 'RSK Testnet',
  rpcUrl: 'https://public-node.testnet.rsk.co',
  blockscoutApi: 'https://rootstock-testnet.blockscout.com/api',
  blockscoutApiV2: 'https://rootstock-testnet.blockscout.com/api/v2',
} as const

// BTC Vault ABI (event signatures)
export const BTC_VAULT_ABI = [
  // Deposit Events
  'event DepositRequest(address indexed user, address indexed receiver, uint256 amount, address indexed token, uint256 shares)',
  'event NativeDepositRequested(address indexed user, address indexed receiver, uint256 amount, uint256 shares)',
  'event DepositClaimed(address indexed user, address indexed receiver, address indexed token, uint256 amount, uint256 shares, uint256 epochId)',
  
  // Withdrawal Events
  'event RedeemRequest(address indexed user, address indexed receiver, uint256 shares, address indexed token, uint256 amount)',
  'event RedeemClaimed(address indexed user, address indexed receiver, address indexed token, uint256 shares, address indexed assetToken, uint256 amount, uint256 epochId)',
  
  // Yield Events
  'event SyntheticYieldApplied(uint256 indexed epochId, address indexed caller, uint256 amount)',
  
  // ERC4626 Events
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
] as const
```

### **Phase 2: Create BTCVaultAnalyser Component**

**File**: `src/BTCVaultAnalyser.tsx`

**Structure** (based on `VaultDepositWithdrawAnalyser.tsx`):

```typescript
import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { CONFIG, BTC_VAULT_CONTRACTS, BTC_VAULT_ABI, RSK_TESTNET } from './config'
import * as XLSX from 'xlsx'
import './MintRedeemAnalyser.css' // Reuse existing styles

interface BTCVaultTransaction {
  time: Date
  hash: string
  status: 'Requested' | 'Claimed' | 'Cancelled'
  type: 'Deposit Request' | 'Deposit Claimed' | 'Redeem Request' | 'Redeem Claimed' | 'Yield Applied'
  user: string
  receiver: string
  amount: string  // RBTC amount (18 decimals)
  shares: string   // Vault shares
  token: string    // Token address (if applicable)
  assetToken: string  // Asset token (for RedeemClaimed)
  epochId?: number    // Epoch ID (for claimed operations)
  blockNumber: number
}

// Use Blockscout API v2 for testnet
const BLOCKSCOUT_API_V2 = RSK_TESTNET.blockscoutApiV2
const VAULT_ADDRESS = BTC_VAULT_CONTRACTS.RBTC_ASYNC_VAULT_PROXY.toLowerCase()

// Rate limiter (same pattern as VaultDepositWithdrawAnalyser)
class BlockscoutV2RateLimiter {
  // ... (copy from VaultDepositWithdrawAnalyser.tsx)
}

// Event fetching function (similar to VaultDepositWithdrawAnalyser)
async function fetchLogsFromBlockscoutV2(
  address: string,
  fromBlock: number,
  toBlock: number,
  retryCount = 0
): Promise<BlockscoutV2Log[]> {
  // ... (similar pattern to VaultDepositWithdrawAnalyser.tsx)
  // Use RSK_TESTNET.blockscoutApiV2 instead of mainnet API
}

// Event decoding function
function decodeEvent(log: BlockscoutV2Log): BTCVaultTransaction | null {
  // Decode based on event topic
  // Handle DepositRequest, NativeDepositRequested, DepositClaimed, etc.
}

export default function BTCVaultAnalyser() {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [transactions, setTransactions] = useState<BTCVaultTransaction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // ... (similar structure to VaultDepositWithdrawAnalyser)
  
  return (
    <div className={`analyser-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header with collapse toggle */}
      {/* Controls (block range, fetch button) */}
      {/* Table display */}
      {/* Excel export button */}
    </div>
  )
}
```

**Key Implementation Points**:

1. **Event Topic Hashes**: Calculate using `ethers.utils.id('EventName(type1,type2,...)')`
   ```typescript
   const DEPOSIT_REQUEST_TOPIC = ethers.utils.id('DepositRequest(address,address,uint256,address,uint256)')
   const NATIVE_DEPOSIT_REQUESTED_TOPIC = ethers.utils.id('NativeDepositRequested(address,address,uint256,uint256)')
   const DEPOSIT_CLAIMED_TOPIC = ethers.utils.id('DepositClaimed(address,address,address,uint256,uint256,uint256)')
   const REDEEM_REQUEST_TOPIC = ethers.utils.id('RedeemRequest(address,address,uint256,address,uint256)')
   const REDEEM_CLAIMED_TOPIC = ethers.utils.id('RedeemClaimed(address,address,address,uint256,address,uint256,uint256)')
   const SYNTHETIC_YIELD_APPLIED_TOPIC = ethers.utils.id('SyntheticYieldApplied(uint256,address,uint256)')
   ```

2. **Event Decoding**: Use `decoded.parameters` from Blockscout API v2 response
   ```typescript
   // Example for DepositRequest
   if (log.topics[0] === DEPOSIT_REQUEST_TOPIC) {
     const params = log.decoded?.parameters || []
     return {
       type: 'Deposit Request',
       user: params.find(p => p.name === 'user')?.value || '',
       receiver: params.find(p => p.name === 'receiver')?.value || '',
       amount: params.find(p => p.name === 'amount')?.value || '0',
       shares: params.find(p => p.name === 'shares')?.value || '0',
       token: params.find(p => p.name === 'token')?.value || '',
       // ...
     }
   }
   ```

3. **Amount Formatting**: RBTC uses 18 decimals (same as ETH/RBTC)
   ```typescript
   function formatAmount(amount: bigint, decimals: number = 18): string {
     // Same as VaultDepositWithdrawAnalyser
   }
   ```

### **Phase 3: UI Integration**

**File**: `src/Analytics.tsx`

Add BTC Vault Analyser:

```typescript
import BTCVaultAnalyser from './BTCVaultAnalyser'

export default function Analytics() {
  return (
    <div className="analytics-page">
      {/* ... existing code ... */}
      <div className="analytics-container">
        <MintRedeemAnalyser />
        <VaultDepositWithdrawAnalyser />
        <BTCVaultAnalyser /> {/* Add new analyser */}
      </div>
    </div>
  )
}
```

---

## 📚 Reference Implementation Patterns

### **Existing Analyser: VaultDepositWithdrawAnalyser**

**Key Patterns to Follow**:

1. **Rate Limiting**: `BlockscoutV2RateLimiter` class
   - Adaptive throttling based on failures
   - Queue-based processing
   - MIN_DELAY: 200ms, MAX_DELAY: 5000ms

2. **Event Fetching**: `fetchLogsFromBlockscoutV2()`
   - Uses Blockscout API v2: `/api/v2/addresses/{address}/logs`
   - Handles pagination via `next_page_params`
   - Client-side filtering by block range (API doesn't support filter params)
   - Retry logic with exponential backoff
   - AbortController for 30s timeout

3. **Event Decoding**:
   - Uses `log.decoded.parameters` from Blockscout API v2
   - Identifies event type by `log.topics[0]` (event signature hash)
   - Parses BigInt values correctly

4. **Collapsible UI**:
   - `isCollapsed` state (default: `true`)
   - No queries when collapsed
   - Expand/collapse toggle in header

5. **Excel Export**:
   - Uses `XLSX` library
   - Formats data for Excel
   - Downloads as `.xlsx` file

### **Configuration Pattern**

**File**: `src/config.ts`

```typescript
export const CONFIG = {
  // Mainnet configs...
  ROOTSTOCK_RPC: 'https://public-node.rsk.co',
  // ...
}

// Add testnet configs
export const RSK_TESTNET = {
  chainId: 31,
  name: 'RSK Testnet',
  rpcUrl: 'https://public-node.testnet.rsk.co',
  blockscoutApi: 'https://rootstock-testnet.blockscout.com/api',
  blockscoutApiV2: 'https://rootstock-testnet.blockscout.com/api/v2',
} as const
```

---

## 🔍 Key Code Patterns

### **1. Blockscout API v2 Event Fetching**

**Required Interfaces:**

```typescript
interface BlockscoutV2Log {
  address: {
    hash: string
  }
  block_number: number
  block_timestamp: string
  data: string
  decoded: {
    method_call: string
    parameters: Array<{
      name: string
      type: string
      value: string
    }>
  } | null
  topics: (string | null)[]
  transaction_hash: string
  index: number
}

interface BlockscoutV2Response {
  items: BlockscoutV2Log[]
  next_page_params: {
    block_number?: number
    index?: number
    items_count?: number
  } | null
}
```

**Complete Fetching Function:**

```typescript
async function fetchLogsFromBlockscoutV2(
  address: string,
  fromBlock: number,
  toBlock: number,
  retryCount = 0
): Promise<BlockscoutV2Log[]> {
  await blockscoutV2RateLimiter.throttle()
  
  const allLogs: BlockscoutV2Log[] = []
  let nextPageParams: BlockscoutV2Response['next_page_params'] = null
  let pageCount = 0
  const MAX_PAGES = 100
  let hasMorePages = true
  const FETCH_TIMEOUT = 30000
  
  while (hasMorePages && pageCount < MAX_PAGES) {
    try {
      let url = `${BLOCKSCOUT_API_V2}/addresses/${address}/logs`
      const params = new URLSearchParams()
      
      // Add pagination params if available
      if (nextPageParams) {
        if (nextPageParams.index !== undefined) {
          params.append('index', nextPageParams.index.toString())
        }
        if (nextPageParams.items_count !== undefined) {
          params.append('items_count', nextPageParams.items_count.toString())
        }
      }
      
      if (params.toString()) {
        url += '?' + params.toString()
      }
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
      } catch (fetchError) {
        clearTimeout(timeoutId)
        
        if (fetchError instanceof Error) {
          const isTimeout = fetchError.name === 'AbortError' || fetchError.message.includes('timeout')
          const isNetworkError = fetchError.message.includes('Failed to fetch') || 
                                 fetchError.message.includes('network') ||
                                 fetchError.message.includes('ERR_CONNECTION') ||
                                 fetchError.message.includes('ERR_TIMED_OUT')
          
          if ((isTimeout || isNetworkError) && retryCount < 3) {
            blockscoutV2RateLimiter.recordFailure()
            const retryDelay = Math.min(2000 * Math.pow(2, retryCount), 10000)
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
          }
        }
        throw fetchError
      }
      
      if (response.status === 429) {
        blockscoutV2RateLimiter.recordFailure()
        if (retryCount < 3) {
          const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
        }
        throw new Error(`Blockscout API v2 rate limited. Too many requests.`)
      }
      
      if (!response.ok) {
        blockscoutV2RateLimiter.recordFailure()
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      blockscoutV2RateLimiter.recordSuccess()
      
      const text = await response.text()
      if (!text || text.trim().length === 0) {
        break
      }
      
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        blockscoutV2RateLimiter.recordFailure()
        throw new Error(`Blockscout API v2 returned non-JSON response`)
      }
      
      const data: BlockscoutV2Response = JSON.parse(text)
      
      if (data.items && data.items.length > 0) {
        // Filter logs by block range (API v2 doesn't support block range filters)
        const filteredItems = data.items.filter(log => {
          const blockNum = log.block_number
          return blockNum >= fromBlock && blockNum <= toBlock
        })
        allLogs.push(...filteredItems)
        
        // Check if we should stop paginating
        const minBlockInPage = Math.min(...data.items.map(log => log.block_number))
        const maxBlockInPage = Math.max(...data.items.map(log => log.block_number))
        
        if (maxBlockInPage < fromBlock) {
          hasMorePages = false
          break
        }
      } else {
        hasMorePages = false
        break
      }
      
      nextPageParams = data.next_page_params
      if (!nextPageParams) {
        hasMorePages = false
        break
      }
      
      pageCount++
      await new Promise(resolve => setTimeout(resolve, 100)) // Small delay between pages
      
    } catch (fetchError) {
      blockscoutV2RateLimiter.recordFailure()
      
      if (retryCount < 3 && fetchError instanceof Error) {
        const isNetworkError = fetchError.message.includes('Failed to fetch') || 
                               fetchError.message.includes('network') ||
                               fetchError.message.includes('ERR_CONNECTION') ||
                               fetchError.message.includes('ERR_TIMED_OUT') ||
                               fetchError.message.includes('timeout')
        
        if (isNetworkError) {
          const retryDelay = Math.min(2000 * Math.pow(2, retryCount), 10000)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          return fetchLogsFromBlockscoutV2(address, fromBlock, toBlock, retryCount + 1)
        }
      }
      
      throw fetchError
    }
  }
  
  return allLogs
}
```

### **2. Event Decoding Pattern**

**Event Topic Hash Constants:**

```typescript
import { ethers } from 'ethers'

// Calculate event topic hashes (keccak256 of event signature)
const DEPOSIT_REQUEST_TOPIC = ethers.utils.id('DepositRequest(address,address,uint256,address,uint256)')
const NATIVE_DEPOSIT_REQUESTED_TOPIC = ethers.utils.id('NativeDepositRequested(address,address,uint256,uint256)')
const DEPOSIT_CLAIMED_TOPIC = ethers.utils.id('DepositClaimed(address,address,address,uint256,uint256,uint256)')
const REDEEM_REQUEST_TOPIC = ethers.utils.id('RedeemRequest(address,address,uint256,address,uint256)')
const REDEEM_CLAIMED_TOPIC = ethers.utils.id('RedeemClaimed(address,address,address,uint256,address,uint256,uint256)')
const SYNTHETIC_YIELD_APPLIED_TOPIC = ethers.utils.id('SyntheticYieldApplied(uint256,address,uint256)')
```

**Complete Event Decoding Function:**

```typescript
function decodeEvent(log: BlockscoutV2Log): BTCVaultTransaction | null {
  if (!log.decoded || !log.topics[0]) return null
  
  const topic0 = log.topics[0].toLowerCase()
  const params = log.decoded.parameters || []
  
  // Helper to find parameter value
  const getParam = (name: string): string => {
    const param = params.find(p => p.name === name)
    return param?.value || '0'
  }
  
  // Parse BigInt values correctly
  const parseBigInt = (value: string): string => {
    try {
      return BigInt(value).toString()
    } catch {
      return value
    }
  }
  
  // DepositRequest
  if (topic0 === DEPOSIT_REQUEST_TOPIC.toLowerCase()) {
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Requested',
      type: 'Deposit Request',
      user: getParam('user'),
      receiver: getParam('receiver'),
      amount: parseBigInt(getParam('amount')),
      shares: parseBigInt(getParam('shares')),
      token: getParam('token'),
      assetToken: '',
      blockNumber: log.block_number,
    }
  }
  
  // NativeDepositRequested
  if (topic0 === NATIVE_DEPOSIT_REQUESTED_TOPIC.toLowerCase()) {
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Requested',
      type: 'Deposit Request',
      user: getParam('user'),
      receiver: getParam('receiver'),
      amount: parseBigInt(getParam('amount')),
      shares: parseBigInt(getParam('shares')),
      token: '0x0000000000000000000000000000000000000000', // Native RBTC
      assetToken: '',
      blockNumber: log.block_number,
    }
  }
  
  // DepositClaimed
  if (topic0 === DEPOSIT_CLAIMED_TOPIC.toLowerCase()) {
    const epochIdParam = getParam('epochId')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Claimed',
      type: 'Deposit Claimed',
      user: getParam('user'),
      receiver: getParam('receiver'),
      amount: parseBigInt(getParam('amount')),
      shares: parseBigInt(getParam('shares')),
      token: getParam('token'),
      assetToken: '',
      epochId: epochIdParam ? parseInt(epochIdParam, 10) : undefined,
      blockNumber: log.block_number,
    }
  }
  
  // RedeemRequest
  if (topic0 === REDEEM_REQUEST_TOPIC.toLowerCase()) {
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Requested',
      type: 'Redeem Request',
      user: getParam('user'),
      receiver: getParam('receiver'),
      amount: parseBigInt(getParam('amount')),
      shares: parseBigInt(getParam('shares')),
      token: getParam('token'),
      assetToken: '',
      blockNumber: log.block_number,
    }
  }
  
  // RedeemClaimed
  if (topic0 === REDEEM_CLAIMED_TOPIC.toLowerCase()) {
    const epochIdParam = getParam('epochId')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Claimed',
      type: 'Redeem Claimed',
      user: getParam('user'),
      receiver: getParam('receiver'),
      amount: parseBigInt(getParam('amount')),
      shares: parseBigInt(getParam('shares')),
      token: getParam('token'),
      assetToken: getParam('assetToken'),
      epochId: epochIdParam ? parseInt(epochIdParam, 10) : undefined,
      blockNumber: log.block_number,
    }
  }
  
  // SyntheticYieldApplied
  if (topic0 === SYNTHETIC_YIELD_APPLIED_TOPIC.toLowerCase()) {
    const epochIdParam = getParam('epochId')
    return {
      time: new Date(log.block_timestamp),
      hash: log.transaction_hash,
      status: 'Claimed',
      type: 'Yield Applied',
      user: getParam('caller'),
      receiver: '',
      amount: parseBigInt(getParam('amount')),
      shares: '0',
      token: '',
      assetToken: '',
      epochId: epochIdParam ? parseInt(epochIdParam, 10) : undefined,
      blockNumber: log.block_number,
    }
  }
  
  return null
}
```

**Note**: Blockscout API v2 provides decoded event parameters in `log.decoded.parameters` array. Each parameter has `name`, `type`, and `value` fields. Use the `value` field directly - it's already decoded from hex.

### **3. Amount Formatting**

```typescript
function formatAmount(amount: bigint, decimals: number = 18): string {
  if (amount === 0n) return '0'
  const factor = 10n ** BigInt(decimals)
  const whole = amount / factor
  const frac = amount % factor
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

function formatAmountDisplay(amount: string, decimals: number = 0): string {
  const numValue = parseFloat(amount)
  if (isNaN(numValue)) return amount
  return numValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
```

### **4. Collapsible UI Pattern**

```typescript
const [isCollapsed, setIsCollapsed] = useState(true)
const [transactions, setTransactions] = useState<BTCVaultTransaction[]>([])
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)

// Don't fetch when collapsed
useEffect(() => {
  if (isCollapsed) {
    return
  }
  // Component expanded - can fetch data if needed
}, [isCollapsed])

const handleFetch = useCallback(async () => {
  if (isCollapsed) return // Don't fetch when collapsed
  
  setLoading(true)
  setError(null)
  
  try {
    // Fetch logic here
    const logs = await fetchLogsFromBlockscoutV2(/* ... */)
    const decoded = logs.map(decodeEvent).filter(Boolean) as BTCVaultTransaction[]
    setTransactions(decoded)
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Unknown error')
  } finally {
    setLoading(false)
  }
}, [isCollapsed])

return (
  <div className={`analyser-panel ${isCollapsed ? 'collapsed' : ''}`}>
    <div className="analyser-header">
      <h2>BTC Vault Transactions</h2>
      <div className="analyser-header-actions">
        <span className="network-badge testnet">Testnet</span>
        <button
          className="collapse-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
      </div>
    </div>
    {!isCollapsed && (
      <>
        {/* Controls: block range inputs, fetch button */}
        {/* Loading state */}
        {/* Error display */}
        {/* Table with transactions */}
        {/* Excel export button */}
      </>
    )}
  </div>
)
```

**CSS Classes** (reuse from `MintRedeemAnalyser.css`):

```css
.analyser-panel.collapsed {
  /* Hide content when collapsed */
}

.analyser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.network-badge.testnet {
  background-color: #ff9800;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
}
```

### **5. Excel Export Pattern**

```typescript
const exportToExcel = useCallback(() => {
  if (transactions.length === 0) {
    alert('No transactions to export')
    return
  }
  
  // Prepare data for Excel
  const excelData = transactions.map(tx => ({
    'Timestamp': tx.time.toISOString(),
    'Transaction Hash': tx.hash,
    'Status': tx.status,
    'Type': tx.type,
    'User': tx.user,
    'Receiver': tx.receiver,
    'Amount (RBTC)': formatAmountDisplay(formatAmount(BigInt(tx.amount), 18), 8),
    'Shares': formatAmountDisplay(formatAmount(BigInt(tx.shares), 18), 8),
    'Token': tx.token || '',
    'Asset Token': tx.assetToken || '',
    'Epoch ID': tx.epochId || '',
    'Block Number': tx.blockNumber,
  }))
  
  // Create workbook and worksheet
  const ws = XLSX.utils.json_to_sheet(excelData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'BTC Vault Transactions')
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const filename = `btc-vault-transactions-${timestamp}.xlsx`
  
  // Download
  XLSX.writeFile(wb, filename)
}, [transactions])
```

**Usage in JSX:**

```typescript
<button
  onClick={exportToExcel}
  disabled={transactions.length === 0}
  className="export-button"
>
  Export to Excel
</button>
```

---

## 🎨 UI/UX Requirements

1. **Network Badge**: Show "Testnet" badge prominently (different styling)
2. **Collapsible**: Default collapsed, expand to load data
3. **Event Type Badges**: Color-code by type (Deposit/Withdraw/Yield)
4. **Status Indicators**: Show Requested vs Claimed status
5. **Epoch Display**: Show epochId for claimed operations
6. **Amount Formatting**: Format RBTC amounts (18 decimals → BTC display)
7. **Responsive Design**: Mobile-friendly table (reuse existing CSS)

---

## 📁 File Structure

```
src/
  ├── config.ts                    # Add BTC_VAULT_CONTRACTS, BTC_VAULT_ABI, RSK_TESTNET
  ├── BTCVaultAnalyser.tsx         # NEW: Main analyser component
  ├── Analytics.tsx                # Add BTCVaultAnalyser import and component
  ├── MintRedeemAnalyser.css       # Reuse existing styles
  └── VaultDepositWithdrawAnalyser.tsx  # Reference implementation

scripts/
  └── interrogate_btc_vault_contracts.py  # Discovery script (already created)

PLAN_BTC_VAULT_ANALYSERS.md        # Architecture plan
BTC_VAULT_DISCOVERY_SUMMARY.md     # Discovery summary
btc_vault_contracts_analysis.json  # Detailed contract analysis
```

---

## 🚀 Implementation Checklist

### **Step 1: Configuration** ⏳
- [ ] Add `BTC_VAULT_CONTRACTS` to `config.ts`
- [ ] Add `BTC_VAULT_ABI` to `config.ts`
- [ ] Add `RSK_TESTNET` config to `config.ts`

### **Step 2: Component Creation** ⏳
- [ ] Create `src/BTCVaultAnalyser.tsx`
- [ ] Implement `BlockscoutV2RateLimiter` class
- [ ] Implement `fetchLogsFromBlockscoutV2()` function
- [ ] Implement event topic hash constants
- [ ] Implement `decodeEvent()` function
- [ ] Implement transaction interface `BTCVaultTransaction`
- [ ] Implement amount formatting functions
- [ ] Implement collapsible UI
- [ ] Implement table display
- [ ] Implement Excel export

### **Step 3: Integration** ⏳
- [ ] Import `BTCVaultAnalyser` in `Analytics.tsx`
- [ ] Add component to Analytics page
- [ ] Test collapsible functionality
- [ ] Test event fetching on testnet
- [ ] Test event decoding
- [ ] Test Excel export

### **Step 4: Polish** ⏳
- [ ] Add network badge (Testnet indicator)
- [ ] Add error handling
- [ ] Add loading states
- [ ] Test responsive design
- [ ] Verify amount formatting
- [ ] Verify epoch display

---

## 🔐 Network Configuration

### **RSK Testnet**

- **Chain ID**: 31
- **RPC URL**: `https://public-node.testnet.rsk.co`
- **Blockscout API v1**: `https://rootstock-testnet.blockscout.com/api`
- **Blockscout API v2**: `https://rootstock-testnet.blockscout.com/api/v2`
- **Explorer**: `https://rootstock-testnet.blockscout.com`

**Important**: All BTC Vault analysers should use testnet endpoints, not mainnet.

---

## 📊 Data Structure

### **BTCVaultTransaction Interface**

```typescript
interface BTCVaultTransaction {
  time: Date
  hash: string
  status: 'Requested' | 'Claimed' | 'Cancelled'
  type: 'Deposit Request' | 'Deposit Claimed' | 'Redeem Request' | 'Redeem Claimed' | 'Yield Applied'
  user: string
  receiver: string
  amount: string  // RBTC amount (18 decimals, as BigInt string)
  shares: string   // Vault shares (18 decimals, as BigInt string)
  token: string    // Token address (if applicable)
  assetToken: string  // Asset token (for RedeemClaimed)
  epochId?: number    // Epoch ID (for claimed operations)
  blockNumber: number
}
```

### **Event Mapping**

| Event | Type | Status | Has EpochId |
|-------|------|--------|-------------|
| DepositRequest | 'Deposit Request' | 'Requested' | No |
| NativeDepositRequested | 'Deposit Request' | 'Requested' | No |
| DepositClaimed | 'Deposit Claimed' | 'Claimed' | Yes |
| RedeemRequest | 'Redeem Request' | 'Requested' | No |
| RedeemClaimed | 'Redeem Claimed' | 'Claimed' | Yes |
| SyntheticYieldApplied | 'Yield Applied' | 'Claimed' | Yes |

---

## 💡 Key Implementation Notes

1. **Use Proxy Contracts**: Always use proxy addresses for event queries (`RBTC_ASYNC_VAULT_PROXY`)
2. **Testnet Only**: All BTC Vault operations are on testnet initially - use `RSK_TESTNET.blockscoutApiV2`
3. **Event Topics**: Calculate topic hashes using `ethers.utils.id('EventName(type1,type2,...)')`
4. **BigInt Handling**: Parse amounts as BigInt strings, format for display using `formatAmount()`
5. **Pagination**: Blockscout API v2 uses pagination - handle `next_page_params` with `index` and `items_count`
6. **Client-Side Filtering**: API doesn't support `filter[from_block]` or `filter[to_block]` - filter client-side by `block_number`
7. **Rate Limiting**: Use `BlockscoutV2RateLimiter` class with adaptive throttling (MIN_DELAY: 200ms, MAX_DELAY: 5000ms)
8. **Error Handling**: Retry on network errors (3 attempts with exponential backoff), handle 429 rate limits gracefully
9. **Collapsible**: Don't fetch data when collapsed (use `isCollapsed` state check)
10. **Excel Export**: Use `XLSX` library - same pattern as `VaultDepositWithdrawAnalyser.tsx`
11. **Event Decoding**: Use `log.decoded.parameters` array from Blockscout API v2 response (already decoded)
12. **Block Timestamps**: Use `log.block_timestamp` (ISO string) - convert to `Date` object
13. **Topic Matching**: Compare `log.topics[0].toLowerCase()` with calculated topic hash (lowercase)
14. **Parameter Access**: Use `params.find(p => p.name === 'paramName')?.value` to get parameter values
15. **Network Badge**: Show "Testnet" badge in analyser header (different styling from mainnet)

---

## 📚 Reference Files

### **Existing Analysers** (Use as Reference)

1. **`src/VaultDepositWithdrawAnalyser.tsx`**
   - Blockscout API v2 integration
   - Event decoding pattern
   - Rate limiting
   - Collapsible UI
   - Excel export

2. **`src/MintRedeemAnalyser.tsx`**
   - Blockscout API v1 integration (alternative pattern)
   - Table display
   - Styling patterns

3. **`src/config.ts`**
   - Configuration structure
   - ABI definitions
   - Contract addresses

### **Discovery Files**

1. **`scripts/interrogate_btc_vault_contracts.py`**
   - Contract interrogation script
   - ABI fetching from Blockscout
   - Event analysis

2. **`btc_vault_contracts_analysis.json`**
   - Detailed contract analysis
   - All events and functions
   - Event signatures

3. **`PLAN_BTC_VAULT_ANALYSERS.md`**
   - Architecture plan
   - Implementation steps

4. **`BTC_VAULT_DISCOVERY_SUMMARY.md`**
   - Discovery summary
   - Recommended events
   - Implementation details

---

## 🎯 Success Criteria

1. ✅ BTC Vault analyser displays events from RBTCAsyncVaultProxy
2. ✅ Events are correctly decoded and displayed
3. ✅ Collapsible UI works (default collapsed)
4. ✅ Excel export works
5. ✅ Testnet badge is displayed
6. ✅ Amounts are correctly formatted (RBTC with 18 decimals)
7. ✅ Epoch IDs are displayed for claimed operations
8. ✅ Responsive design works on mobile
9. ✅ Error handling works (network errors, rate limits)
10. ✅ Loading states are shown during fetch

---

## 🔄 Next Steps for Implementation

1. **Start with Configuration**: Add BTC Vault contracts and ABIs to `config.ts`
2. **Create Component Shell**: Create `BTCVaultAnalyser.tsx` with basic structure
3. **Implement Event Fetching**: Copy and adapt `fetchLogsFromBlockscoutV2()` from `VaultDepositWithdrawAnalyser.tsx`
4. **Implement Event Decoding**: Create `decodeEvent()` function for each event type
5. **Implement UI**: Add table, controls, collapsible functionality
6. **Test on Testnet**: Verify events are fetched and decoded correctly
7. **Add Polish**: Network badge, error handling, loading states
8. **Integrate**: Add to Analytics page

---

**Last Updated** (footer — prefer **Running log** at top for session history): 2026-03-27 10:30 GMT  
**Status**: Ready for Implementation  
**Model**: composer-1
