# BTC Vault Analysers - Architecture Plan

**Date**: January 24, 2026  
**Status**: Planning Complete, Ready for Implementation  
**Network**: RSK Testnet  
**Reference**: `coder_log.md` for full implementation context

---

## Executive Summary

Build a **single** BTC Vault Transactions Analyser component for RSK Testnet. It fetches events from `RBTCAsyncVaultProxy` via Blockscout API v2, decodes them into a unified format, and displays them in a collapsible table with Excel export. Pattern: mirror `VaultDepositWithdrawAnalyser`; data source: testnet Blockscout only.

---

## 🎯 Objective

Create a new analyser for the BTC Vault system that:
- Shows consolidated user-facing operations (deposits, withdrawals, yields, cancellations)
- Points exclusively to **RSK Testnet**
- Uses Blockscout API v2 for event fetching
- Matches existing analyser UX (collapsible, Excel export, amount formatting)
- Keeps scope tight: one component, one contract, on-demand fetch (no polling)

---

## 📋 BTC Vault Contract Architecture

The BTC Vault consists of multiple contracts working together:

### **Core Contracts**

1. **RBTCAsyncVault**
   - Proxy: `0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1`
   - Implementation: `0x08B43Ed82Eb069C6545ecD5b74Bb43bAdD58C6ED`
   - **Purpose**: Main vault contract for BTC deposits/withdrawals

2. **Buffer**
   - Proxy: `0xF7930654CE9ef043B1FA2Fd51b4A2B1C8b4f6F9a`
   - Implementation: `0x1c769e16c0E9a801DF79ACaaA33B9DeE2d092705`
   - **Purpose**: Buffer management for BTC operations

3. **PermissionsManager**
   - Proxy: `0xFA4F19443ec119dBC8fD913aE0902e924fb4266E`
   - Implementation: `0x549945384AefB50E4Fc8A16068870dad05Ab02f9`
   - **Purpose**: Access control and permissions

4. **SyntheticYield**
   - Proxy: `0x85f9204F1A0317Eb398918f553205e1558d15Cb9`
   - Implementation: `0xf7A8AC8e005cdD62462a899910a5a7F0A8e79bBe`
   - **Purpose**: Synthetic yield generation

---

## 🔍 Discovery Phase ✅ Complete

### **Step 1: Contract Interrogation**
- [x] Create Python script to fetch ABIs from Blockscout (testnet)
- [x] Analyze all events emitted by each contract
- [x] Identify event signatures and parameters
- [x] Map relationships between contracts
- [x] Document key functions (see `btc_vault_contracts_analysis.json`)

### **Step 2: Event Analysis**
- [x] Identify deposit events (DepositRequest, NativeDepositRequested, DepositClaimed)
- [x] Identify withdrawal events (RedeemRequest, RedeemClaimed)
- [x] Identify yield events (SyntheticYieldApplied)
- [x] Identify cancellation events (DepositRequestCancelled, NativeDepositRequestCancelled, RedeemRequestCancelled)
- [x] Identify buffer/epoch events (deferred for future analysers)

### **Step 3: Data Structure Design**
- [x] Unified interface: `BTCVaultTransaction` (see coder_log)
- [x] Amount fields: `amount`, `shares` (18 decimals; RBTC matches ETH)
- [x] Timestamps: `log.block_timestamp` from Blockscout (ISO string)
- [x] User/receiver: from event `user`, `receiver` params

---

## 🏗️ Architecture Design

### **Analyser Components**

#### **1. BTC Vault Transactions Analyser** (Primary — Current Scope)
- **Purpose**: Consolidated user-facing operations (deposits, withdrawals, yields, cancellations)
- **Data Source**: **RBTCAsyncVaultProxy only** — no Buffer/SyntheticYield in v1
- **Display Format**: Match `VaultDepositWithdrawAnalyser` (table, collapsible, Excel export)
- **Columns**: Timestamp | Tx Hash | Type | Status | User | Receiver | Amount (RBTC) | Shares | Epoch ID | Block

#### **2. Buffer Operations Analyser** (Future)
- **Purpose**: BufferCredited, BufferDrawn, BufferWithdrawn
- **Data Source**: BufferProxy
- **Defer**: Out of v1 scope

#### **3. Yield Operations Analyser** (Future)
- **Purpose**: SyntheticYieldApplied, Funded, Withdrawn
- **Data Source**: SyntheticYieldProxy
- **Defer**: Out of v1 scope

---

## 🔧 Technical Implementation Plan

### **Phase 1: Discovery & Setup**

1. **Contract Interrogation Script**
   - Fetch ABIs from Blockscout testnet
   - Analyze events and functions
   - Generate event signature mappings
   - Document contract relationships

2. **Configuration Updates**
   - Add BTC Vault contract addresses to `config.ts`
   - Create BTC Vault ABIs
   - Add testnet RPC endpoint configuration
   - Add network detection logic

### **Phase 2: Core Analyser Component**

1. **BTCVaultAnalyser Component**
   - Single file `src/BTCVaultAnalyser.tsx` (target ~400 lines; split into hooks if >500)
   - One contract: `RBTCAsyncVaultProxy`
   - Reuse `MintRedeemAnalyser.css` (class `mint-redeem-analyser`)

2. **Event Fetching Logic**
   - Blockscout API v2: `GET /api/v2/addresses/{address}/logs`
   - Base URL: `RSK_TESTNET.blockscoutApiV2`
   - Pagination: `next_page_params.index`, `next_page_params.items_count`
   - **No** `filter[from_block]` / `filter[to_block]` — filter client-side by `block_number`
   - Rate limiter: 200ms min delay, 5s max (adaptive on 429)
   - Retry: 3 attempts, exponential backoff on network/429

3. **Event Decoding**
   - Use `log.decoded.parameters` (Blockscout pre-decodes)
   - Identify event by `log.topics[0]` vs precomputed keccak256 hashes
   - Normalize to `BTCVaultTransaction` (see coder_log)

### **Phase 3: UI Integration**

1. **Analytics Page Integration**
   - Add BTC Vault Analyser section
   - Make collapsible (default collapsed)
   - Add network indicator (testnet badge)
   - Responsive design support

2. **Styling**
   - Reuse existing analyser styles
   - Add BTC-specific styling if needed
   - Ensure mobile responsiveness

---

## 📊 Data Flow

```
Blockscout API v2 (Testnet) → /addresses/{vault}/logs
    ↓
fetchLogsFromBlockscoutV2 (paginate, filter by block)
    ↓
decodeEvent (topic match → BTCVaultTransaction)
    ↓
Sort by time desc → Table display
    ↓
Excel export (XLSX.writeFile)
```

---

## ⚠️ Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Blockscout testnet API rate limits | Fetch fails, user sees error | Rate limiter (200ms), retry 3x, adaptive backoff |
| API v2 pagination schema differs from mainnet | Incomplete or stuck fetch | Validate `next_page_params` structure; fallback to single-page if malformed |
| Decoded params missing (unverified contract) | Amounts/user show as zero | Guard: `if (!log.decoded) return null`; log warnings |
| Testnet has few/no events | Empty table, poor UX | Empty state message: "No transactions in range. Try expanding block range." |
| CORS on testnet Blockscout | Fetch fails in browser | Same as mainnet: no CORS issues expected; if so, proxy via backend |
| Topic hash mismatch (signature change) | Events not decoded | Use exact signatures from discovery; add unit test for topic hashes |

---

## 🔐 Network Configuration

### **Testnet Setup**

```typescript
RSK_TESTNET = {
  chainId: 31,
  name: 'RSK Testnet',
  rpcUrl: 'https://public-node.testnet.rsk.co',
  blockscoutApi: 'https://rootstock-testnet.blockscout.com/api',
  blockscoutApiV2: 'https://rootstock-testnet.blockscout.com/api/v2',
}
```

**Usage**: BTC Vault analyser uses `RSK_TESTNET.blockscoutApiV2` exclusively. No mainnet RPC or Blockscout for this component.

### **Network Badge**
- Show "Testnet" badge in analyser header (orange/amber styling)
- No network switching logic — testnet-only for v1

---

## 📝 Event Types to Investigate

### **Expected Event Categories**

1. **Deposit Events**
   - User deposits BTC/RBTC
   - Buffer receives BTC
   - Vault balance increases

2. **Withdrawal Events**
   - User requests withdrawal
   - Buffer releases BTC
   - Vault balance decreases

3. **Yield Events**
   - Synthetic yield generated
   - Yield distributed
   - Yield claimed

4. **Buffer Events**
   - Buffer threshold reached
   - Buffer rebalanced
   - Buffer state changed

5. **Permission Events**
   - Access granted/revoked
   - Role changes
   - Admin actions

---

## 🎨 UI/UX Considerations

1. **Collapsible Sections**
   - Default: Collapsed
   - Show title and expand/collapse toggle
   - No queries when collapsed

2. **Network Indicator**
   - Show "Testnet" badge
   - Different styling for testnet
   - Clear indication of network

3. **Event Type Badges**
   - Color-coded event types
   - Icons for different operations
   - Clear visual distinction

4. **Amount Formatting**
   - RBTC: **18 decimals** (same as ETH; use `formatAmount(amount, 18)`)
   - Display: 8 decimal places for RBTC in table/Excel

5. **Responsive Design**
   - Mobile-friendly table
   - Horizontal scroll on mobile
   - Touch-friendly controls

---

## 🚀 Implementation Steps

### **Step 1: Discovery** ✅
- [x] Create interrogation script
- [x] Run interrogation script
- [x] Analyze results
- [x] Document findings (coder_log, BTC_VAULT_DISCOVERY_SUMMARY)

### **Step 2: Configuration** ⏳
- [ ] Add `BTC_VAULT_CONTRACTS`, `RSK_TESTNET`, `BTC_VAULT_ABI` to `config.ts`
- [ ] No network detection needed: testnet-only for now

### **Step 3: Core Component** ⏳
- [ ] Create `src/BTCVaultAnalyser.tsx`
- [ ] Copy `BlockscoutV2RateLimiter`, `fetchLogsFromBlockscoutV2` (use testnet URL)
- [ ] Implement `decodeEvent` for 9 event types (including 3 cancellation events)
- [ ] Implement `formatAmount`, `formatAmountDisplay`
- [ ] Collapsible header, days selector, Refresh, Export
- [ ] Table: sort by time desc; empty state message

### **Step 4: Integration** ⏳
- [ ] Import and render `BTCVaultAnalyser` in `Analytics.tsx`
- [ ] Verify collapsible behavior (no fetch when collapsed)
- [ ] Manual test: expand, set 7 days, click Refresh

### **Step 5: Polish** ⏳
- [ ] Testnet badge in header
- [ ] Loading spinner, error message display
- [ ] Excel export with TX hash links (testnet explorer)
- [ ] Responsive table (reuse MintRedeemAnalyser.css breakpoints)

---

## 📁 Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `src/config.ts` — add BTC_VAULT_CONTRACTS, RSK_TESTNET, BTC_VAULT_ABI |
| Create | `src/BTCVaultAnalyser.tsx` — main component |
| Modify | `src/Analytics.tsx` — import and render BTCVaultAnalyser |
| Reuse | `src/MintRedeemAnalyser.css` — no changes |

---

## 📚 References

| Asset | Purpose |
|-------|---------|
| `src/VaultDepositWithdrawAnalyser.tsx` | Primary reference — Blockscout v2, rate limiter, decoding |
| `src/MintRedeemAnalyser.tsx` | Table layout, days selector, export pattern |
| `src/config.ts` | Add new exports here |
| `src/MintRedeemAnalyser.css` | Reuse `.mint-redeem-analyser`, `.collapsed` |
| `coder_log.md` | Full code patterns, interfaces, checklist |

---

## ❓ Resolved Questions

| Question | Resolution |
|---------|------------|
| Which events for primary analyser? | 6 lifecycle + 3 cancellation (see table above) |
| Show all or filter? | Filter: only the 9 events listed; ignore ERC4626 Deposit/Withdraw (redundant with Claimed) |
| Multiple contracts? | Single contract (RBTCAsyncVaultProxy) for v1 |
| Primary use case? | User-facing deposit/withdraw/yield/cancel lifecycle |
| Real-time vs on-demand? | On-demand (user clicks Refresh) — same as existing analysers |

---

## 📋 Next Actions

1. ✅ Discovery complete
2. ⏳ Config: add `BTC_VAULT_CONTRACTS`, `RSK_TESTNET`, `BTC_VAULT_ABI`
3. ⏳ Component: implement `BTCVaultAnalyser.tsx` per coder_log patterns
4. ⏳ Integrate into `Analytics.tsx`
5. ⏳ Manual test on testnet

---

## 🔍 Discovery Results

### **Contract Analysis Summary**

**All 8 contracts successfully analyzed!**

| Contract | Events | Functions | Key Purpose |
|----------|--------|-----------|-------------|
| RBTCAsyncVaultProxy | 28 | 87 | Main vault (use proxy) |
| RBTCAsyncVaultImpl | 28 | 87 | Main vault implementation |
| BufferProxy | 7 | 16 | Buffer management (use proxy) |
| BufferImpl | 7 | 16 | Buffer implementation |
| SyntheticYieldProxy | 6 | 22 | Yield generation (use proxy) |
| SyntheticYieldImpl | 6 | 22 | Yield implementation |
| PermissionsManagerProxy | 9 | 25 | Access control (use proxy) |
| PermissionsManagerImpl | 9 | 25 | Permissions implementation |

### **Key Events for Analyser**

#### **RBTCAsyncVault (Primary Contract)**

**Deposit Events:**
- `DepositRequest(address indexed user, address indexed receiver, uint256 amount, address indexed token, uint256 shares)`
- `NativeDepositRequested(address indexed user, address indexed receiver, uint256 amount, uint256 shares)`
- `DepositClaimed(address indexed user, address indexed receiver, address indexed token, uint256 amount, uint256 shares, uint256 epochId)`
- `Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)` (ERC4626)

**Withdrawal Events:**
- `RedeemRequest(address indexed user, address indexed receiver, uint256 shares, address indexed token, uint256 amount)`
- `RedeemClaimed(address indexed user, address indexed receiver, address indexed token, uint256 shares, address indexed assetToken, uint256 amount, uint256 epochId)`
- `Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)` (ERC4626)

**Yield Events:**
- `SyntheticYieldApplied(uint256 indexed epochId, address indexed caller, uint256 amount)`

**Buffer Events:**
- `BufferCredited(address indexed creditTo, uint256 amount, uint256 bufferBalance)`
- `BufferDrawn(address indexed to, uint256 amount, uint256 bufferBalance)`
- `BufferWithdrawn(address indexed caller, uint256 amount, uint256 bufferBalance)`

**Epoch Events:**
- `EpochSettled(uint256 indexed epochId, uint256 totalAssets, uint256 totalShares, uint256 totalDebt, uint64 timestamp)`
- `EpochFundingProgress(uint256 indexed epochId, uint256 fundedAmount, uint256 totalAmount, bool isFullyFunded)`

### **Event Categories Summary**

- **Deposit**: 14 events
- **Withdrawal**: 14 events
- **Buffer**: 10 events
- **Yield**: 6 events
- **Permission**: 6 events
- **Transfer**: 6 events
- **Upgrade**: 8 events
- **Admin**: 4 events
- **Approval**: 2 events
- **Other**: 30 events

### **Recommended Primary Analyser Events**

For the **BTC Vault Transactions Analyser**, track these events from **RBTCAsyncVaultProxy**:

| Event | Type | Status | Include |
|-------|------|--------|---------|
| DepositRequest | Deposit Request | Requested | ✅ |
| NativeDepositRequested | Deposit Request | Requested | ✅ |
| DepositClaimed | Deposit Claimed | Claimed | ✅ |
| DepositRequestCancelled | Deposit Request | Cancelled | ✅ |
| NativeDepositRequestCancelled | Deposit Request | Cancelled | ✅ |
| RedeemRequest | Redeem Request | Requested | ✅ |
| RedeemClaimed | Redeem Claimed | Claimed | ✅ |
| RedeemRequestCancelled | Redeem Request | Cancelled | ✅ |
| SyntheticYieldApplied | Yield Applied | Claimed | ✅ |

**Cancellation event signatures:**
- `DepositRequestCancelled(address indexed user, address indexed receiver, uint256 amount, uint256 shares)`
- `NativeDepositRequestCancelled(address indexed user, address indexed receiver, uint256 amount, uint256 shares)`
- `RedeemRequestCancelled(address indexed user, address indexed receiver, uint256 shares, uint256 amount)`

**Deferred (future analysers):** BufferCredited, BufferDrawn, EpochSettled, CapitalDeployed

### **Event Data Structure**

**DepositRequest:**
```typescript
{
  user: address (indexed)
  receiver: address (indexed)
  amount: uint256
  token: address (indexed)
  shares: uint256
}
```

**RedeemRequest:**
```typescript
{
  user: address (indexed)
  receiver: address (indexed)
  shares: uint256
  token: address (indexed)
  amount: uint256
}
```

**DepositClaimed:**
```typescript
{
  user: address (indexed)
  receiver: address (indexed)
  token: address (indexed)
  amount: uint256
  shares: uint256
  epochId: uint256 (indexed)
}
```

**RedeemClaimed:**
```typescript
{
  user: address (indexed)
  receiver: address (indexed)
  token: address (indexed)
  shares: uint256
  assetToken: address
  amount: uint256
  epochId: uint256 (indexed)
}
```

---

---

## ✅ Validation & Acceptance Criteria

Before considering the work complete:

- [ ] Expand analyser → no fetch occurs until Refresh clicked
- [ ] Refresh with 1/7/30/90 days → events load (or empty state if none)
- [ ] Table shows: Timestamp, Tx Hash (link), Type, Status, User, Receiver, Amount, Shares, Epoch ID
- [ ] Amounts display with 8 decimals (RBTC)
- [ ] Testnet badge visible
- [ ] Excel export produces valid .xlsx with correct columns
- [ ] Error message shown on fetch failure (e.g. network error)
- [ ] No console errors; no `any` types
- [ ] Mobile: table scrolls horizontally; controls stack

---

**Last Updated**: January 24, 2026
