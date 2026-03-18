# Plan: Query MODA Parameter from RIF On-Chain Codebase

**Date**: January 24, 2026  
**Status**: Planning Phase (No Code Changes)

---

## 📋 Overview

This document outlines a plan to query the MODA parameter from the RIF (Rootstock Infrastructure Framework) on-chain codebase. 

**MODA (Maximum Operational Difference Allowed)** is one of three core Flux Capacitor parameters:
- **MODA**: Maximum Operational Difference Allowed - **200,000 RIF**
  - Caps how much a user can switch direction (mint ↔ redeem) within a window
  - Prevents rapid mint–redeem round trips
  - Expressed in **RIF units** (likely 18 decimals)

**Related Parameters**:
- **AMTA**: Absolute Maximum Transaction Allowed - 1,000,000 RIF
- **DF**: Decay Factor - 3512 blocks

These parameters are global configuration settings enforced using internal accumulators that track recent activity over time.

---

## 🔍 Current Codebase Analysis

### **Existing Contract Query Patterns**

The codebase already has established patterns for querying contract parameters:

1. **Contract Instance Creation** (`App.tsx`):
   ```typescript
   const contract = new ethers.Contract(
     getChecksummedAddress(CONFIG.CONTRACT_ADDRESS),
     ABI,
     provider
   )
   ```

2. **Optional Metric Query Helper** (`App.tsx`, line 487-504):
   ```typescript
   const queryOptionalMetric = async (
     provider: ethers.Provider,
     address: string,
     abi: readonly string[],
     queryFn: (contract: ethers.Contract) => Promise<bigint>,
     decimals: number = STANDARD_DECIMALS
   ): Promise<{ raw: bigint; formatted: string } | null>
   ```

3. **RPC Call Pattern** (`MintRedeemAnalyser.tsx`, `VaultDepositWithdrawAnalyser.tsx`):
   - Uses `makeRpcCall()` helper for direct JSON-RPC calls
   - Supports proxy endpoints for CORS handling
   - Has fallback endpoint logic

### **Relevant Contracts in Codebase**

From `config.ts` and `App.tsx`, the following RIF-related contracts are already configured:

- **RIF Token**: `0x2acc95758f8b5f583470ba265eb685a8f45fc9d5`
- **MoC V2 Core (RoC)**: `0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
- **RIF Price Feed (RLabs)**: `0xbed51d83cc4676660e3fc3819dfad8238549b975`
- **RIF Price Feed (MoC)**: `0x461750b4824b14c3d9b7702bc6fbb82469082b23`

---

## 🎯 MODA Parameter Investigation Plan

### **Step 1: Identify MODA Contract Location**

**Hypothesis**: MODA is a Flux Capacitor parameter, so it's likely stored in:

1. **MoC V2 Core Contract** (Most Likely - "Flux Capacitor" is part of MoC system)
   - Already queried for `calcCtargemaCA()`, `getTotalACavailable()`, `getLckAC()`
   - Contract: `0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
   - Flux Capacitor parameters (AMTA, MODA, DF) are likely stored here
   - May have functions like `moda()`, `getModa()`, `AMTA()`, `DF()`, or `fluxCapacitorParams()`

2. **MoC State Contract** (Possible)
   - Already has ABI defined (`MOC_STATE_ABI`)
   - Contains minting-related parameters
   - May have Flux Capacitor configuration

3. **Separate Flux Capacitor Contract** (Possible)
   - May be a dedicated contract managing these parameters
   - Would need to identify contract address

**Action Items**:
- [ ] Check MoC V2 Core contract on Blockscout: `https://rootstock.blockscout.com/address/0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
- [ ] Search contract ABI for Flux Capacitor related functions:
  - `moda()`, `getModa()`, `MODA()`
  - `amta()`, `getAMTA()`, `AMTA()`
  - `df()`, `getDF()`, `decayFactor()`
  - `fluxCapacitorParams()` (may return struct with all three)
- [ ] Review contract source code if verified
- [ ] Verify if MODA is a global value (single uint256) or per-address mapping
- [ ] Check if there's a separate Flux Capacitor contract address

### **Step 2: Determine MODA Function Signature**

**Possible Function Signatures**:

1. **Public Variable (Auto-generated getter)**:
   ```solidity
   uint256 public moda; // Value: 200000 * 10^18 (200,000 RIF with 18 decimals)
   ```
   - Would be accessible as: `contract.moda()`
   - Returns: `uint256` (200000000000000000000000 = 200,000 RIF)

2. **Explicit Getter Function**:
   ```solidity
   function getModa() public view returns (uint256);
   function moda() public view returns (uint256);
   function getMODA() public view returns (uint256);
   function fluxCapacitorModa() public view returns (uint256);
   ```

3. **Struct Return (All Flux Capacitor Parameters)**:
   ```solidity
   struct FluxCapacitorParams {
     uint256 amta;
     uint256 moda;
     uint256 df;
   }
   function fluxCapacitorParams() public view returns (FluxCapacitorParams);
   ```
   - Would return all three parameters at once
   - MODA would be: `result.moda`

4. **Mapping (Per-address, less likely for global config)**:
   ```solidity
   mapping(address => uint256) public moda;
   ```
   - Would require address parameter: `contract.moda(address)`

5. **Storage Slot Access** (If no public getter):
   - Would need to use `eth_getStorageAt` RPC call
   - Requires knowing the storage slot number

**Action Items**:
- [ ] Inspect contract ABI on Blockscout
- [ ] Check contract source code for MODA definition
- [ ] Test different function name variations
- [ ] If no public getter exists, identify storage slot location

### **Step 3: Determine MODA Data Type and Decimals**

**Possible Data Types**:
- `uint256` (most likely for parameters)
- `int256` (if can be negative)
- `uint128`, `uint64`, etc. (smaller types)
- `address` (if MODA is an address parameter)

**Decimals Handling**:
- **Confirmed**: MODA is expressed in **RIF units**
- RIF token uses **18 decimals** (standard ERC20)
- Expected value: `200000 * 10^18 = 200000000000000000000000` (200,000 RIF)
- When formatting for display: divide by `10^18` to get human-readable value

**Action Items**:
- [x] MODA type confirmed: `uint256` (RIF units, 18 decimals)
- [x] Expected value confirmed: 200,000 RIF = `200000000000000000000000`
- [ ] Verify by querying contract and comparing result
- [ ] Test querying and format display correctly (divide by 10^18)

---

## 📐 Implementation Plan (When Ready)

### **Option A: Using Existing `queryOptionalMetric` Pattern**

**Location**: `src/App.tsx`

**Steps**:
1. Add MODA (and optionally AMTA, DF) to `MOC_CORE_ABI`:
   ```typescript
   export const MOC_CORE_ABI = [
     'function getTotalACavailable() view returns (uint256)',
     'function getLckAC() view returns (uint256)',
     'function acToken() view returns (address)',
     'function calcCtargemaCA() view returns (uint256)',
     'function getCglb() view returns (uint256)',
     // Flux Capacitor Parameters
     'function moda() view returns (uint256)',  // MODA: 200,000 RIF
     'function amta() view returns (uint256)',  // AMTA: 1,000,000 RIF (optional)
     'function df() view returns (uint256)',    // DF: 3512 blocks (optional)
   ] as const
   ```
   
   **Alternative**: If all parameters are returned together:
   ```typescript
   'function fluxCapacitorParams() view returns (uint256 amta, uint256 moda, uint256 df)',
   ```

2. Add MODA to `CONFIG` if contract address differs:
   ```typescript
   MODA_CONTRACT: '0xA27024Ed70035E46dba712609fc2Afa1c97aA36A', // or separate address
   ```

3. Query MODA in `fetchTokenData()`:
   ```typescript
   // Query MODA parameter (200,000 RIF)
   const modaResult = await queryOptionalMetric(
     provider,
     CONFIG.MOC_V2_CORE,
     MOC_CORE_ABI,
     async (contract) => await contract.moda(), // Returns uint256 in RIF units (18 decimals)
     STANDARD_DECIMALS // 18 decimals (RIF standard)
   )
   
   // Expected raw value: 200000000000000000000000n (200,000 RIF)
   // Expected formatted: "200000" (after dividing by 10^18)
   ```
   
   **If using struct return**:
   ```typescript
   const fluxParams = await contract.fluxCapacitorParams()
   const modaValue = fluxParams.moda // Extract MODA from struct
   ```

4. Add to `TokenData` interface:
   ```typescript
   moda: string | null
   formattedModa: string | null
   ```

5. Store in state and display as metric

### **Option B: Using Direct RPC Call Pattern**

**Location**: `src/MintRedeemAnalyser.tsx` or new component

**Steps**:
1. Use `makeRpcCall()` helper:
   ```typescript
   const modaHex = await makeRpcCall('eth_call', [{
     to: CONFIG.MOC_V2_CORE,
     data: '0x...' // Function selector for moda()
   }, 'latest'])
   ```

2. Decode result:
   ```typescript
   const modaValue = BigInt(modaHex)
   ```

**Note**: Requires calculating function selector manually or using `ethers.Interface`

### **Option C: Storage Slot Access (If No Public Getter)**

**Steps**:
1. Identify storage slot:
   - Check contract source code for variable position
   - Use storage layout analysis tools
   - May require contract deployment bytecode analysis

2. Query storage:
   ```typescript
   const storageSlot = '0x...' // MODA storage slot (hex, zero-padded)
   const modaHex = await makeRpcCall('eth_getStorageAt', [
     CONFIG.MOC_V2_CORE,
     storageSlot,
     'latest'
   ])
   ```

3. Decode result:
   ```typescript
   const modaValue = BigInt(modaHex)
   ```

---

## 🔧 Required Configuration

### **1. Contract Address**
- **Primary Candidate**: `CONFIG.MOC_V2_CORE` (`0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`)
- **Alternative**: May need separate contract address if MODA is in different contract

### **2. ABI Entry**
Add to `src/config.ts`:
```typescript
// MoC Core V2 ABI (for RIF collateral + MODA)
export const MOC_CORE_ABI = [
  'function getTotalACavailable() view returns (uint256)',
  'function getLckAC() view returns (uint256)',
  'function acToken() view returns (address)',
  'function calcCtargemaCA() view returns (uint256)',
  'function getCglb() view returns (uint256)',
  'function moda() view returns (uint256)', // ADD MODA
] as const
```

### **3. State Management**
Add to `TokenData` interface in `src/App.tsx`:
```typescript
interface TokenData {
  // ... existing fields
  moda: string | null
  formattedModa: string | null
}
```

### **4. Metric Key**
Add to `src/history.ts`:
```typescript
export const METRIC_KEYS = {
  // ... existing keys
  MODA: 'moda',
} as const
```

---

## 🧪 Testing Strategy

### **Phase 1: Discovery**
1. Query Blockscout API for contract ABI
2. Search ABI for MODA-related functions
3. Test function calls using ethers.js in browser console
4. Verify return type and value format

### **Phase 2: Integration**
1. Add MODA query to existing `fetchTokenData()` function
2. Handle errors gracefully (use `queryOptionalMetric` pattern)
3. Log results for verification
4. Verify value matches expected: `200000000000000000000000` (200,000 RIF)
5. Format display: Show as "200,000 RIF" (divide raw value by 10^18)

### **Phase 3: Display**
1. Add MODA metric display component
2. Format value appropriately:
   - Raw: `200000000000000000000000` (BigInt)
   - Formatted: `"200000"` (divide by 10^18)
   - Display: `"200,000 RIF"` (with locale formatting + unit)
3. Add help text:
   ```
   "MODA (Maximum Operational Difference Allowed): Caps how much a user can 
   switch direction (mint ↔ redeem) within a window. Prevents rapid mint–redeem 
   round trips. Current value: 200,000 RIF."
   ```
4. Add to history tracking if needed (optional - may be constant)

---

## 📊 Expected Implementation Pattern

Based on existing code patterns, the implementation would follow this structure:

```typescript
// In fetchTokenData() function:

// Query MODA parameter (Flux Capacitor: Maximum Operational Difference Allowed)
// Expected value: 200,000 RIF = 200000000000000000000000 (18 decimals)
const modaResult = await queryOptionalMetric(
  provider,
  CONFIG.MOC_V2_CORE, // MoC V2 Core contract
  MOC_CORE_ABI, // ABI with moda() function
  async (contract) => await contract.moda(), // Query function
  STANDARD_DECIMALS // 18 decimals (RIF standard)
)

// Verify expected value (for debugging)
if (modaResult?.raw) {
  const expectedValue = 200000n * 10n**18n // 200,000 RIF
  if (modaResult.raw === expectedValue) {
    console.log('✅ MODA value matches expected: 200,000 RIF')
  } else {
    console.warn(`⚠️ MODA value differs: ${modaResult.raw} (expected: ${expectedValue})`)
  }
}

// Add to state
setTokenData(prev => ({
  ...prev,
  moda: modaResult?.raw?.toString() ?? null,
  formattedModa: modaResult?.formatted ?? null, // "200000" (already divided by 10^18)
}))
```

---

## 🔍 Research Required

Before implementation, the following information needs to be gathered:

1. **Contract Location**:
   - [ ] Which contract contains MODA?
   - [ ] What is the contract address?
   - [ ] Is it the same as MoC V2 Core or different?

2. **Function Details**:
   - [ ] Exact function name (`moda()`, `getModa()`, `MODA()`, etc.)
   - [ ] Function signature (parameters, return type)
   - [ ] Is it a view/pure function?

3. **Data Format**:
   - [ ] What data type is MODA? (uint256, int256, address, etc.)
   - [ ] What decimal precision does it use?
   - [ ] What are the expected value ranges?

4. **Purpose**:
   - [x] **MODA** = Maximum Operational Difference Allowed
   - [x] Caps how much a user can switch direction (mint ↔ redeem) within a window
   - [x] Prevents rapid mint–redeem round trips
   - [x] Value: **200,000 RIF** (global configuration)
   - [ ] Does it change over time or is it constant? (Likely constant, but verify)

---

## 📝 Next Steps

1. **Investigation**:
   - Check MoC V2 Core contract on Blockscout: `https://rootstock.blockscout.com/address/0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
   - Review contract ABI for MODA-related functions
   - Check contract source code if verified

2. **Verification**:
   - Test querying MODA using ethers.js in browser console
   - Verify return value format and decimals
   - Document findings

3. **Implementation** (After investigation):
   - Follow Option A pattern (using `queryOptionalMetric`)
   - Add MODA to config, state, and display
   - Test thoroughly

---

## 🎯 Success Criteria

- [ ] MODA parameter successfully queried from on-chain contract
- [ ] Value matches expected: `200000000000000000000000` (200,000 RIF)
- [ ] Value displayed correctly: "200,000 RIF" (formatted with locale)
- [ ] Error handling implemented (graceful failure if query fails)
- [ ] Help text explains MODA purpose and current value
- [ ] Follows existing codebase patterns and conventions
- [ ] No breaking changes to existing functionality

## 📊 Expected Results

**Raw Value**: `200000000000000000000000n` (BigInt)  
**Formatted Value**: `"200000"` (string, after dividing by 10^18)  
**Display Value**: `"200,000 RIF"` (with locale formatting and unit)  
**Help Text**: Explains MODA caps mint↔redeem direction switches to prevent rapid round trips

---

**Note**: This is a planning document. No code changes should be made until the investigation phase is complete and MODA's exact location and format are confirmed.
