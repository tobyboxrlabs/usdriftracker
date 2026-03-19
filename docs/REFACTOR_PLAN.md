# Codebase Refactoring Plan

**Scope:** Improve modularisation and abstraction without changing features or security.

**Constraint:** No alteration of feature behaviour or security aspects.

---

## Progress

| Item | Status | Date |
|------|--------|------|
| **Item 1** (amount.ts, exportExcel.ts, api/shared.ts) | ✅ Done | 2026-01-24 |
| **Item 2** (Blockscout, RPC) | ✅ Done | 2026-01-24 |
| **Item 3** (MetricDisplay, ContractAddressTable) | ✅ Done | 2026-01-24 |
| **Item 4** (useTokenData, MetricsPage, slim App) | ✅ Done | 2026-01-24 |
| **Item 5** (AnalyserShell) | ✅ Done | 2026-01-24 |
| Item 6+ | Pending | |

---

## 1. Duplicated Utilities – Extract to Shared Modules

### 1.1 Amount Formatting ✅

**Was:** `formatAmount` / `formatAmountDisplay` duplicated in:
- `App.tsx` (formatAmount only, slightly different signature)
- `MintRedeemAnalyser.tsx`
- `VaultDepositWithdrawAnalyser.tsx`
- `BTCVaultAnalyser.tsx`

**Done:** `src/utils/amount.ts` created with `formatAmount` and `formatAmountDisplay`. All four consumers updated.

---

### 1.2 Blockscout Rate Limiter ✅

**Was:** Nearly identical `BlockscoutRateLimiter` / `BlockscoutV2RateLimiter` in:
- `MintRedeemAnalyser.tsx` (API v1)
- `VaultDepositWithdrawAnalyser.tsx` (API v2)
- `BTCVaultAnalyser.tsx` (API v2)

**Done:** `src/api/blockscout.ts` created with shared rate limiter, `fetchLogsV1`, `fetchLogsV2`. All three analysers updated.

---

### 1.3 RPC Client ✅

**Was:** Almost identical `makeRpcCall` in:
- `MintRedeemAnalyser.tsx` (~60 lines)
- `VaultDepositWithdrawAnalyser.tsx` (~60 lines)

Same logic: primary + fallback endpoints, proxy vs direct, retries.

**Done:** `src/utils/rpc.ts` created with `rpcCall<T>(method, params)`. MintRedeemAnalyser and VaultDepositWithdrawAnalyser updated. (BTCVaultAnalyser uses direct fetch to testnet RPC for block number.)

---

### Item 3 – Component Extraction ✅ (2026-01-24)

**Done:** Extracted components from `App.tsx`:

- **`src/components/MetricDisplay.tsx`**
  - `MetricDisplay` – metric card with label, value, unit, optional history graph and help tooltip
  - `Tooltip` – portal-rendered tooltip with positioning
  - `formatNumericValue` – locale-aware numeric formatting helper
  - Exports `MetricDisplay` and `formatNumericValue`

- **`src/components/ContractAddressTable.tsx`**
  - Footer table with contract names and Blockscout links
  - Uses `CONFIG` for addresses (stRIF, USDRIF, RIFPRO, MoC V2 Core, RIF Price Feed)
  - RIF Token address hardcoded (not in CONFIG)

**App.tsx:** ~200 lines removed. Build and tests pass. No behavioural changes.

---

### Item 4 – useTokenData, MetricsPage, Slim App ✅ (2026-01-24)

**Done:** Extracted token data logic and home page UI:

- **`src/hooks/useTokenData.ts`**
  - `TokenData` interface and `useTokenData()` hook
  - `ProxyJsonRpcProvider` – RPC proxy via `/api/rpc`
  - `getWorkingProvider` – multi-endpoint fallback, caches provider
  - `queryOptionalMetric` – safe contract reads
  - `fetchTokenData` – full metrics fetch (supplies, prices, collateral, mintable)
  - Returns: `tokenData`, `refreshingMetrics`, `history`, `isClientOutdated`, `fetchTokenData`
  - Handles polling, mount checks, and OUTDATED_CLIENT (410)

- **`src/pages/MetricsPage.tsx`**
  - Home route UI: header, RIF Metrics card, MetricDisplay grid, refresh, ContractAddressTable
  - Uses `useTokenData` for all metrics state
  - Error and outdated-client handling
  - Accepts `deploymentCount` prop from App

- **`src/App.tsx`** (slim)
  - Routes only: `/`, `/game`, `/tools`→`/analytics`, `/analytics`
  - `fetchDeploymentCount` on mount (prod only)
  - Passes `deploymentCount` to `MetricsPage`
  - ~80 lines (down from ~900)

**Verification:** Build and tests pass. No behavioural changes.

---

### Item 5 – AnalyserShell ✅ (2026-01-24)

**Done:** Shared analyser shell for collapsible layout:

- **`src/components/AnalyserShell.tsx`**
  - Props: `title`, `networkBadge` (mainnet/testnet), `isCollapsed`, `onToggleCollapse`, `controls`, `error`, `loading`, `loadingProgress?`, `isEmpty`, `emptyMessage`, `children`
  - Header: h2, RootstockLogo badge, collapse toggle
  - When expanded: controls slot, then error / loading (with optional progress bar) / empty / children
  - Reuses `MintRedeemAnalyser.css` (same class names)

- **Refactored analysers**
  - **MintRedeemAnalyser:** Uses AnalyserShell; filter buttons, days, Refresh, XLS in controls; table content includes filter-empty state
  - **VaultDepositWithdrawAnalyser:** Uses AnalyserShell; days, Refresh, XLS; passes `loadingProgress`
  - **BTCVaultAnalyser:** Uses AnalyserShell; days, Refresh, XLS

**Verification:** Build and tests pass. No behavioural changes.

---

## 2. App.tsx – Split by Responsibility

**Current:** ~1,150 lines. Contains:
- TokenData interface and state
- `formatAmount`, `formatNumericValue`
- `Tooltip` component (~50 lines)
- `MetricDisplay` component (~150 lines)
- `ProxyJsonRpcProvider` (class, ~60 lines)
- `getWorkingProvider` (~70 lines)
- `queryOptionalMetric`
- `fetchTokenData` (~250 lines)
- `fetchDeploymentCount`
- Metrics dashboard layout
- Contract addresses footer table
- Outdated-client handling

**Plan:**

| Extract To | Contents | Est. Lines |
|------------|----------|------------|
| `src/components/MetricDisplay.tsx` | MetricDisplay, Tooltip, formatNumericValue | ~200 |
| `src/components/ContractAddressTable.tsx` | Footer table with address links | ~100 |
| `src/hooks/useTokenData.ts` | tokenData state, fetchTokenData, getWorkingProvider, ProxyJsonRpcProvider, queryOptionalMetric | ~400 |
| `src/pages/MetricsPage.tsx` | Home route UI: header, card, MetricDisplay grid, refresh, error/outdated handling | ~250 |
| `src/App.tsx` | Routes, layout shell, fetchDeploymentCount, isClientOutdated | ~150 |

Result: App.tsx becomes a thin router + layout; logic moves to hooks and components.

---

## 3. Blockscout API – Centralise Fetch Logic ✅

**Was:** Three separate implementations:
- `MintRedeemAnalyser`: `fetchLogsFromBlockscout` (API v1, topic0 filter)
- `VaultDepositWithdrawAnalyser`: `fetchLogsFromBlockscoutV2` (API v2, paginated)
- `BTCVaultAnalyser`: `fetchLogsFromBlockscoutV2` (API v2, nearly same code as Vault)

**Done:** Implemented in `src/api/blockscout.ts`. `fetchLogsV2` accepts `baseUrl` for mainnet vs testnet.

---

## 4. Analyser Components – Shared Shell

**Current:** MintRedeemAnalyser, VaultDepositWithdrawAnalyser, BTCVaultAnalyser share:
- Collapsible header with h2, network badge, collapse toggle
- Controls: days select, Refresh, XLS export
- Loading / error / empty / table layout
- Same CSS (`MintRedeemAnalyser.css`)

**Plan:** Add `src/components/AnalyserShell.tsx`:
- Props: `title`, `networkBadge`, `controls` (slot), `children`
- Handles: collapse state, header structure, loading/error/empty states
- Each analyser passes `controls` (days, refresh, export) and table content as children

Reduces ~150 lines of repeated JSX per analyser. Export logic stays in each analyser (data shapes differ).

---

## 5. API Layer – Shared Boilerplate

### 5.1 Client Version ✅

**Was:** `EXPECTED_CLIENT_VERSION` duplicated in:
- `api/rpc.ts`
- `api/analytics.ts`
- `api/scores.ts`

**Done:** `api/shared.ts` created with `getExpectedClientVersion()` and `isClientOutdated(req)`. All three API handlers updated.

---

### 5.2 Request Handler Pattern

**Current:** Each API repeats:
- CORS + security headers
- Client version check (sometimes)
- Method check
- Rate limit
- Error handling

**Plan:** Add `api/withApiHandler.ts` (or middleware-style wrapper):
```ts
withApiHandler(req, res, {
  method: 'GET' | 'POST',
  rateLimit: { requests: 60, windowMs: 60000 },
  handler: async () => { /* ... */ }
})
```

Keeps security semantics; reduces boilerplate. Apply incrementally.

---

## 6. Config – Minor Cleanup

**Current:** `config.ts` mixes:
- Contract addresses
- ABIs (some analyser-specific, e.g. MOC_ABI in MintRedeemAnalyser)

**Plan:**
- Keep CONFIG, ERC20_ABI, MOC_*, PRICE_FEED_ABI in `config.ts`
- Move analyser-specific ABIs (MOC mint/redeem events, vault events, etc.) to respective modules or `src/abis/` if shared
- Add `BLOCKSCOUT_API`, `BLOCKSCOUT_API_V2` to CONFIG (currently hardcoded in analysers)

---

## 7. Excel Export – Shared Helpers ✅

**Was:** Each analyser had its own `exportToExcel` with repeated:
- XLSX setup
- Filename pattern (`*_txs_yyyymmdd.xlsx`)
- Error handling (`alert('Failed to export...')`)

**Done:** `src/utils/exportExcel.ts` created with `generateDateFilename()`, `generateTimestampFilename()`, and `writeExcelWorkbook()`. All three analysers use these helpers.

---

## 8. Suggested Implementation Order

1. **Low risk, high reuse** ✅
   - `src/utils/amount.ts` ✅
   - `src/utils/exportExcel.ts` ✅
   - `api/shared.ts` ✅

2. **Shared API layer** ✅
   - `src/api/blockscout.ts` ✅
   - `src/utils/rpc.ts` ✅

3. **Component extraction** ✅
   - `MetricDisplay`, `Tooltip`, `formatNumericValue` → `src/components/MetricDisplay.tsx` ✅
   - `ContractAddressTable` → `src/components/ContractAddressTable.tsx` ✅

4. **App.tsx split** ✅
   - `useTokenData` hook → `src/hooks/useTokenData.ts` ✅
   - `MetricsPage` component → `src/pages/MetricsPage.tsx` ✅
   - Slim `App.tsx` (~80 lines) ✅

5. **Analyser shell** ✅
   - `AnalyserShell` component → `src/components/AnalyserShell.tsx` ✅
   - All three analysers refactored to use it ✅

6. **API handler wrapper** (optional)
   - `withApiHandler` and migrate endpoints

---

## 9. Files to Create

| File | Purpose | Status |
|------|---------|--------|
| `src/utils/amount.ts` | formatAmount, formatAmountDisplay | ✅ |
| `src/utils/exportExcel.ts` | generateDateFilename, generateTimestampFilename, writeExcelWorkbook | ✅ |
| `api/shared.ts` | getExpectedClientVersion, isClientOutdated | ✅ |
| `src/api/blockscout.ts` | Rate limiter, fetchLogsV1, fetchLogsV2 | ✅ |
| `src/utils/rpc.ts` | rpcCall for analysers | ✅ |
| `src/components/MetricDisplay.tsx` | MetricDisplay + Tooltip + formatNumericValue | ✅ |
| `src/components/ContractAddressTable.tsx` | Footer address table | ✅ |
| `src/hooks/useTokenData.ts` | Token data state + fetch logic | ✅ |
| `src/pages/MetricsPage.tsx` | Home page UI | ✅ |
| `src/components/AnalyserShell.tsx` | Collapsible analyser layout | ✅ |

---

## 10. Expected Outcome

- **App.tsx:** ~1,150 → ~150 lines
- **MintRedeemAnalyser.tsx:** ~1,450 → ~800 lines (shared shell + API)
- **VaultDepositWithdrawAnalyser.tsx:** ~956 → ~500 lines
- **BTCVaultAnalyser.tsx:** ~514 → ~350 lines
- **New shared modules:** ~600 lines total
- **Net:** Similar total lines, but clearer structure, less duplication, easier maintenance
