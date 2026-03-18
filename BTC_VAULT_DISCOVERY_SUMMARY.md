# BTC Vault Contracts Discovery Summary

**Date**: January 24, 2026  
**Network**: RSK Testnet  
**Status**: Discovery Complete ✅

---

## 📊 Contract Analysis Results

### **Successfully Analyzed: 8/8 Contracts**

| Contract | Type | Events | Functions | Primary Use |
|----------|------|--------|-----------|-------------|
| **RBTCAsyncVaultProxy** | Proxy | 28 | 87 | **Main Vault** (use this) |
| RBTCAsyncVaultImpl | Implementation | 28 | 87 | Vault implementation |
| **BufferProxy** | Proxy | 7 | 16 | **Buffer Management** (use this) |
| BufferImpl | Implementation | 7 | 16 | Buffer implementation |
| **SyntheticYieldProxy** | Proxy | 6 | 22 | **Yield Generation** (use this) |
| SyntheticYieldImpl | Implementation | 6 | 22 | Yield implementation |
| **PermissionsManagerProxy** | Proxy | 9 | 25 | **Access Control** (use this) |
| PermissionsManagerImpl | Implementation | 9 | 25 | Permissions implementation |

**Key Insight**: Use **Proxy contracts** for event queries (they forward events from implementation).

---

## 🎯 Primary Analyser: Recommended Events

### **RBTCAsyncVaultProxy** (`0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1`)

This is the **main contract** for the BTC Vault analyser. It emits 28 events covering the full lifecycle of deposits, withdrawals, and yield operations.

#### **Core User-Facing Events:**

1. **`DepositRequest`** ⭐ **PRIMARY**
   ```
   DepositRequest(
     address indexed user,
     address indexed receiver,
     uint256 amount,
     address indexed token,
     uint256 shares
   )
   ```
   - **When**: User requests a deposit
   - **Use**: Track deposit requests

2. **`NativeDepositRequested`** ⭐ **PRIMARY**
   ```
   NativeDepositRequested(
     address indexed user,
     address indexed receiver,
     uint256 amount,
     uint256 shares
   )
   ```
   - **When**: Native RBTC deposit requested
   - **Use**: Track native RBTC deposits

3. **`DepositClaimed`** ⭐ **PRIMARY**
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
   - **When**: Deposit is completed/claimed
   - **Use**: Track completed deposits (includes epochId)

4. **`RedeemRequest`** ⭐ **PRIMARY**
   ```
   RedeemRequest(
     address indexed user,
     address indexed receiver,
     uint256 shares,
     address indexed token,
     uint256 amount
   )
   ```
   - **When**: User requests withdrawal/redeem
   - **Use**: Track withdrawal requests

5. **`RedeemClaimed`** ⭐ **PRIMARY**
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
   - **When**: Withdrawal/redeem is completed
   - **Use**: Track completed withdrawals (includes epochId)

6. **`SyntheticYieldApplied`** ⭐ **SECONDARY**
   ```
   SyntheticYieldApplied(
     uint256 indexed epochId,
     address indexed caller,
     uint256 amount
   )
   ```
   - **When**: Synthetic yield is applied to an epoch
   - **Use**: Track yield generation

#### **ERC4626 Standard Events:**

7. **`Deposit`** (ERC4626)
   ```
   Deposit(
     address indexed sender,
     address indexed owner,
     uint256 assets,
     uint256 shares
   )
   ```

8. **`Withdraw`** (ERC4626)
   ```
   Withdraw(
     address indexed sender,
     address indexed receiver,
     address indexed owner,
     uint256 assets,
     uint256 shares
   )
   ```

#### **Supporting Events (Optional):**

- `EpochSettled` - Epoch settlement information
- `EpochFundingProgress` - Funding progress for epochs
- `BufferCredited` / `BufferDrawn` - Buffer operations
- `CapitalDeployed` / `CapitalReturned` - Capital management

---

## 📋 Event Categories Summary

| Category | Count | Key Events |
|----------|-------|------------|
| **Deposit** | 14 | DepositRequest, NativeDepositRequested, DepositClaimed, Deposit |
| **Withdrawal** | 14 | RedeemRequest, RedeemClaimed, Withdraw |
| **Buffer** | 10 | BufferCredited, BufferDrawn, BufferWithdrawn |
| **Yield** | 6 | SyntheticYieldApplied |
| **Epoch** | 4 | EpochSettled, EpochFundingProgress |
| **Transfer** | 6 | Transfer (ERC20) |
| **Permission** | 6 | RoleGranted, RoleRevoked |
| **Admin** | 4 | OperatorSet, BufferSet |
| **Upgrade** | 8 | Upgraded |
| **Other** | 30 | Initialized, Approval, etc. |

---

## 🏗️ Recommended Analyser Architecture

### **Analyser 1: BTC Vault Transactions** (Primary)

**Purpose**: Show consolidated user-facing operations

**Events to Track** (from RBTCAsyncVaultProxy):
- `DepositRequest`
- `NativeDepositRequested`
- `DepositClaimed`
- `RedeemRequest`
- `RedeemClaimed`
- `SyntheticYieldApplied` (optional)

**Display Columns**:
- Timestamp
- Transaction Hash
- Type (Deposit Request / Deposit Claimed / Redeem Request / Redeem Claimed / Yield)
- User Address
- Receiver Address
- Amount (RBTC/BTC)
- Shares
- Epoch ID (if applicable)
- Status (Requested / Claimed)

**Data Source**: Blockscout API v2 (testnet)

---

## 🔧 Implementation Details

### **Contract Addresses (Testnet)**

```typescript
// BTC Vault Contracts (RSK Testnet)
export const BTC_VAULT_CONTRACTS = {
  RBTC_ASYNC_VAULT_PROXY: '0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1',
  BUFFER_PROXY: '0xF7930654CE9ef043B1FA2Fd51b4A2B1C8b4f6F9a',
  SYNTHETIC_YIELD_PROXY: '0x85f9204F1A0317Eb398918f553205e1558d15Cb9',
  PERMISSIONS_MANAGER_PROXY: '0xFA4F19443ec119dBC8fD913aE0902e924fb4266E',
} as const
```

### **Event Signatures (Topic Hashes)**

```typescript
// Calculate using: ethers.utils.id('EventName(type1,type2,...)')
const DEPOSIT_REQUEST_TOPIC = ethers.utils.id('DepositRequest(address,address,uint256,address,uint256)')
const NATIVE_DEPOSIT_REQUESTED_TOPIC = ethers.utils.id('NativeDepositRequested(address,address,uint256,uint256)')
const DEPOSIT_CLAIMED_TOPIC = ethers.utils.id('DepositClaimed(address,address,address,uint256,uint256,uint256)')
const REDEEM_REQUEST_TOPIC = ethers.utils.id('RedeemRequest(address,address,uint256,address,uint256)')
const REDEEM_CLAIMED_TOPIC = ethers.utils.id('RedeemClaimed(address,address,address,uint256,address,uint256,uint256)')
const SYNTHETIC_YIELD_APPLIED_TOPIC = ethers.utils.id('SyntheticYieldApplied(uint256,address,uint256)')
```

### **ABI Fragments**

```typescript
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

### **Network Configuration**

```typescript
// RSK Testnet
export const RSK_TESTNET = {
  chainId: 31,
  name: 'RSK Testnet',
  rpcUrl: 'https://public-node.testnet.rsk.co',
  blockscoutApi: 'https://rootstock-testnet.blockscout.com/api',
  blockscoutApiV2: 'https://rootstock-testnet.blockscout.com/api/v2',
} as const
```

---

## 📊 Unified Transaction Interface

```typescript
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
```

---

## 🎨 UI Considerations

1. **Network Badge**: Show "Testnet" badge prominently
2. **Event Type Badges**: Color-code by type (Deposit/Withdraw/Yield)
3. **Status Indicators**: Show Requested vs Claimed status
4. **Epoch Linking**: Link epochId to epoch details (if available)
5. **Amount Formatting**: Format RBTC amounts (18 decimals → BTC display)
6. **Collapsible**: Default collapsed, expand to load data

---

## 🚀 Next Steps

1. ✅ **Discovery Complete** - Contracts analyzed
2. ⏳ **Design Data Structure** - Unified transaction interface
3. ⏳ **Update Config** - Add BTC Vault addresses and ABIs
4. ⏳ **Create Component** - `BTCVaultAnalyser.tsx`
5. ⏳ **Implement Fetching** - Blockscout API v2 integration
6. ⏳ **Event Decoding** - Decode and normalize events
7. ⏳ **UI Integration** - Add to Analytics page
8. ⏳ **Testing** - Test on RSK Testnet

---

## 📚 Files Created

1. **`scripts/interrogate_btc_vault_contracts.py`** - Contract interrogation script
2. **`btc_vault_contracts_analysis.json`** - Detailed analysis results
3. **`PLAN_BTC_VAULT_ANALYSERS.md`** - Architecture plan
4. **`BTC_VAULT_DISCOVERY_SUMMARY.md`** - This summary document

---

## 💡 Key Insights

1. **Use Proxy Contracts**: All events are available through proxy contracts
2. **Primary Contract**: `RBTCAsyncVaultProxy` has the most relevant events (28 events)
3. **Two-Phase Operations**: Deposits/Withdrawals have Request → Claimed lifecycle
4. **Epoch-Based**: Operations are tied to epochs (important for tracking)
5. **ERC4626 Compatible**: Standard Deposit/Withdraw events also available
6. **Multiple Token Support**: Events include token addresses for multi-token support

---

**Last Updated**: January 24, 2026
