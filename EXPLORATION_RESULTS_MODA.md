# MODA Parameter Exploration Results

**Date**: January 24, 2026  
**Status**: Exploration Complete - MODA Not Found in Expected Locations

---

## 🔍 Exploration Summary

### **Contracts Checked**

1. **MoC V2 Core (Proxy)**: `0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
   - ✅ Found proxy pattern
   - ✅ Implementation: `0x8d168070fc3acf9b8491623917ecb17e764208cf`
   - ❌ ABI has only 6 items (proxy functions only)

2. **MoC V2 Core (Implementation)**: `0x8d168070fc3acf9b8491623917ecb17e764208cf`
   - ✅ Fetched full ABI (181 items, 138 functions)
   - ✅ Found 69 view functions
   - ❌ MODA not found in direct function calls

3. **MoC State**: `0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257`
   - ✅ Fetched ABI (9 items)
   - ❌ Only proxy/admin functions, no MODA

---

## 📋 Functions Found Related to Flux Capacitor

### **In MoC V2 Core Implementation:**

1. **`decayBlockSpan()`** - Returns `uint256`
   - ✅ Found and queried
   - ❌ Returns `0` (expected DF = 3512 blocks)
   - **Note**: This is likely DF (Decay Factor), but returns 0

2. **`maxOpDiffProvider()`** - Returns `address`
   - ✅ Found
   - ❌ Returns `0x0000...0000` (zero address - not set)
   - **Purpose**: Provider contract for MODA (Maximum Operational Difference)

3. **`maxAbsoluteOpProvider()`** - Returns `address`
   - ✅ Found
   - ❌ Returns `0x0000...0000` (zero address - not set)
   - **Purpose**: Provider contract for AMTA (Absolute Maximum Transaction Allowed)

4. **`maxQACToMintTP()`** - Returns `uint256`
   - ✅ Found
   - ❌ Reverts with division by zero error
   - **Note**: Might be related but requires contract to be initialized

5. **`maxQACToRedeemTP()`** - Returns `uint256`
   - ✅ Found
   - ❌ Reverts with division by zero error

---

## 🎯 Key Findings

### **MODA Not Found As:**
- ❌ Direct public variable (`moda()`, `getModa()`, `MODA()`)
- ❌ Function returning single uint256 value
- ❌ Stored in MoC State contract
- ❌ Accessible through provider contracts (providers are zero addresses)

### **Possible Explanations:**

1. **Provider Pattern Not Initialized**
   - `maxOpDiffProvider()` returns zero address
   - MODA might be stored in a provider contract that hasn't been set yet
   - **Action**: Check if providers need to be initialized or if MODA is stored elsewhere

2. **Separate Flux Capacitor Contract**
   - MODA/AMTA/DF might be in a dedicated Flux Capacitor contract
   - **Action**: Search for Flux Capacitor contract address

3. **Storage Slot Access**
   - MODA might be stored but not exposed as a public getter
   - **Action**: Analyze contract source code to find storage slot

4. **Different Contract Address**
   - MODA might be in a different contract (not MoC V2 Core)
   - **Action**: Search documentation/source code for Flux Capacitor contract address

5. **Dynamic/Calculated Value**
   - MODA might be calculated dynamically rather than stored
   - **Action**: Review contract logic for MODA calculation

---

## 📊 Functions Queried

**Total Parameter Functions Checked**: 37  
**Functions Returning Non-Zero Values**: 2
- `getCglb()` = Very large value (likely max uint256)
- `getPTCac()` = 1 RIF

**Functions Related to Flux Capacitor**: 8
- `decayBlockSpan()` ✅ (but returns 0)
- `maxOpDiffProvider()` ✅ (returns zero address)
- `maxAbsoluteOpProvider()` ✅ (returns zero address)
- `maxQACToMintTP()` ✅ (reverts)
- `maxQACToRedeemTP()` ✅ (reverts)
- `setDecayBlockSpan()` (setter, not queryable)
- `setMaxOpDiffProviderAddress()` (setter, not queryable)
- `setMaxAbsoluteOpProviderAddress()` (setter, not queryable)

---

## 🔧 Next Steps to Find MODA

### **1. Check Contract Source Code**
- [ ] Review MoC V2 Core source code on Blockscout
- [ ] Search for "MODA", "moda", "Maximum Operational Difference"
- [ ] Check storage variable declarations
- [ ] Find storage slot if MODA is a private variable

### **2. Search for Flux Capacitor Contract**
- [ ] Look for separate Flux Capacitor contract address
- [ ] Check if MODA is in a different contract
- [ ] Review protocol documentation for contract addresses

### **3. Query Storage Slots Directly**
- [ ] If source code available, identify MODA storage slot
- [ ] Use `eth_getStorageAt` to read storage directly
- [ ] Check common storage slot patterns

### **4. Check Provider Contract Pattern**
- [ ] Wait for `maxOpDiffProvider()` to be set (if not initialized)
- [ ] Query provider contract once address is known
- [ ] Provider contract might have `moda()`, `getModa()`, or `value()` function

### **5. Review Events/Logs**
- [ ] Search for events that might contain MODA values
- [ ] Check if MODA is emitted in events when set/changed
- [ ] Look for "FluxCapacitor" or "MODA" in event names

---

## 💡 Implementation Approach (Once MODA Found)

Based on exploration, when MODA is located, use this pattern:

### **If MODA is a Direct Function:**
```typescript
// Add to MOC_CORE_ABI in config.ts
'function moda() view returns (uint256)',

// Query in App.tsx
const modaResult = await queryOptionalMetric(
  provider,
  CONFIG.MOC_V2_CORE, // or implementation address
  MOC_CORE_ABI,
  async (contract) => await contract.moda(),
  STANDARD_DECIMALS
)
```

### **If MODA is via Provider Contract:**
```typescript
// 1. Get provider address
const providerAddress = await contract.maxOpDiffProvider()

// 2. Query provider contract
const providerContract = new ethers.Contract(
  providerAddress,
  ['function moda() view returns (uint256)'], // or appropriate function
  provider
)
const modaValue = await providerContract.moda()
```

### **If MODA is via Storage Slot:**
```typescript
// Use makeRpcCall pattern
const storageSlot = '0x...' // MODA storage slot
const modaHex = await makeRpcCall('eth_getStorageAt', [
  CONFIG.MOC_V2_CORE,
  storageSlot,
  'latest'
])
const modaValue = BigInt(modaHex)
```

---

## 📝 Scripts Created

1. **`scripts/query_moda.py`** - Main exploration script
   - Fetches ABIs from Blockscout
   - Tries multiple function signatures
   - Checks proxy patterns
   - Queries provider contracts

2. **`scripts/list_all_functions.py`** - Lists all contract functions
   - Shows all view functions
   - Filters by relevant keywords

3. **`scripts/query_all_parameters.py`** - Queries all parameter-like functions
   - Checks all view functions returning uint256
   - Compares against expected values

4. **`scripts/explore_mappings.py`** - Explores mappings and multi-return functions
   - Checks functions with address parameters
   - Queries provider contracts

---

## 🎯 Conclusion

**MODA parameter was not found** in the expected locations (MoC V2 Core, MoC State). The exploration suggests:

1. MODA might be in a **separate Flux Capacitor contract** (address unknown)
2. MODA might use the **provider pattern** but providers are not initialized
3. MODA might be stored in **private storage** requiring storage slot access
4. MODA might be **calculated dynamically** rather than stored

**Recommended Next Action**: Review contract source code or protocol documentation to identify the exact location and access method for MODA parameter.

---

**Exploration Date**: January 24, 2026  
**Scripts Used**: `query_moda.py`, `list_all_functions.py`, `query_all_parameters.py`, `explore_mappings.py`
