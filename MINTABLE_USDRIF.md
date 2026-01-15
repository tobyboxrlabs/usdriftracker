# MINTABLE USDRIF Calculation

## Business Concept

**MINTABLE USDRIF** represents the maximum amount of USDRIF that can be minted given current collateral and protocol parameters. It shows available minting capacity.

## Calculation Formula (7 Steps)

---

### **Step 1: Total RIF Collateral** (~212M RIF)

**Business Value**: Total RIF tokens locked as collateral in the Money on Chain protocol

**Contract Call**:
```typescript
// MoC V2 Core: 0xA27024Ed70035E46dba712609fc2Afa1c97aA36A
// Function: getTotalACavailable() → uint256

const rifCollateralResult = await queryOptionalMetric(
  provider,
  CONFIG.MOC_V2_CORE,
  MOC_CORE_ABI,
  async (contract) => await contract.getTotalACavailable(),
  18
)
```

**Technical References**:
- Contract instantiation: `src/App.tsx:482-488`
- Contract address: `src/config.ts:39`
- ABI definition: `src/config.ts:75-81` (MOC_CORE_ABI)
- Returns: `bigint` value in wei (18 decimals), formatted as string

---

### **Step 2: Coverage Ratio** (~5.5)

**Business Value**: Target coverage ratio (EMA) used to determine how much collateral is required per unit of stablecoin

**Contract Call**:
```typescript
// MoC V2 Core: 0xA27024Ed70035E46dba712609fc2Afa1c97aA36A
// Function: calcCtargemaCA() → uint256

const targetCoverageResult = await queryOptionalMetric(
  provider,
  CONFIG.MOC_V2_CORE,
  MOC_CORE_ABI,
  async (contract) => await contract.calcCtargemaCA(),
  18
)
```

**Technical References**:
- Contract call: `src/App.tsx:500-507`
- ABI definition: `src/config.ts:79` (within MOC_CORE_ABI)
- Returns: `bigint` value representing coverage ratio (e.g., 5500000000000000000 = 5.5)

---

### **Step 3: Ratio'd RIF** (~38M RIF)

**Business Value**: Effective RIF amount after applying the coverage ratio safety buffer

**Calculation**:
```typescript
// Step 3: Ratio'd RIF = Total RIF Collateral / Coverage Ratio
const ratioDRif = totalRifCollateral / coverageRatio
// Example: 212,057,756 / 5.5 = ~38,556,864
```

**Technical References**:
- Calculation: `src/App.tsx:517`
- Uses values from Steps 1 and 2

---

### **Step 4: RIF/USD Price** (~$0.0413)

**Business Value**: Current RIF token price in USD (from MoC's price oracle)

**Contract Call**:
```typescript
// MoC Price Feed Oracle: 0x461750b4824b14c3d9b7702bc6fbb82469082b23
// Function: read() → uint256

const rifPriceMocResult = await queryOptionalMetric(
  provider,
  CONFIG.RIF_PRICE_FEED_MOC,
  PRICE_FEED_ABI,
  async (contract) => await contract.read(),
  18
)
```

**Technical References**:
- Contract call: `src/App.tsx:473-480`
- Contract address: `src/config.ts:33`
- ABI definition: `src/config.ts:69-72` (PRICE_FEED_ABI)
- **Note**: Uses MoC price feed (not RLabs) for mintable calculation consistency
- Returns: `bigint` value in wei (18 decimals), e.g., 41300000000000000 = $0.0413

---

### **Step 5: USD Equivalent of Ratio'd RIF** (~$1.59M)

**Business Value**: Maximum USD value that can be backed by the current collateral

**Calculation**:
```typescript
// Step 5: USD Equiv Ratio'd RIF = Ratio'd RIF × RIF Price
const usdEquivRatioDRif = ratioDRif * rifPrice
// Example: 38,556,864 × 0.0413 = ~1,592,398 USD
```

**Technical References**:
- Calculation: `src/App.tsx:523`
- Uses values from Steps 3 and 4

---

### **Step 6: Already Minted USDRIF** (~$1.51M)

**Business Value**: Total amount of USDRIF tokens currently in circulation

**Contract Call**:
```typescript
// USDRIF Token: 0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37
// Function: totalSupply() → uint256

const usdrifContract = new ethers.Contract(
  getChecksummedAddress(CONFIG.USDRIF_ADDRESS),
  ERC20_ABI,
  provider
)

const USDRIFSupply = await usdrifContract.totalSupply()
const formattedMinted = formatAmount(USDRIFSupply, USDRIFDecimals)
```

**Technical References**:
- Contract instantiation: `src/App.tsx:422-426`
- Contract call: `src/App.tsx:443` (within Promise.all)
- Contract address: `src/config.ts:18`
- ABI definition: `src/config.ts:46-52` (ERC20_ABI)
- Formatting: `src/App.tsx:462`
- Returns: `bigint` value in wei (18 decimals), formatted as string

---

### **Step 7: MINTABLE USDRIF** (~$99K)

**Business Value**: Available minting capacity remaining

**Calculation**:
```typescript
// Step 7: Mintable USDRIF = USD Equiv Ratio'd RIF - Already Minted
const mintableUsdrif = usdEquivRatioDRif - mintedUsdrif

// Only set if mintable is positive
if (mintableUsdrif > 0) {
  const mintableBigInt = BigInt(Math.floor(mintableUsdrif * 1e18))
  maxMintable = mintableBigInt
  formattedMaxMintable = Math.floor(mintableUsdrif).toString()
} else {
  maxMintable = 0n
  formattedMaxMintable = '0'
}
```

**Technical References**:
- Calculation: `src/App.tsx:528-540`
- Uses values from Steps 5 and 6
- **Business Rule**: Only displays positive values (shows `0` if negative or zero)

---

## Complete Contract Call Flow

**All contract calls are made via ethers.js**:
```typescript
// Provider setup (handles CORS via proxy in production)
const provider = await getWorkingProvider()  // src/App.tsx:406

// Contract instantiation pattern:
const contract = new ethers.Contract(
  getChecksummedAddress(address),  // Checksummed Ethereum address
  ABI,                            // Contract ABI array
  provider                         // ethers.js provider
)

// Function call pattern:
const result = await contract.functionName()  // Returns bigint for uint256
```

**Helper function** (`queryOptionalMetric`) wraps contract calls:
```typescript
// src/App.tsx:368-385
const queryOptionalMetric = async (
  provider: ethers.Provider,
  address: string,
  abi: readonly string[],
  queryFn: (contract: ethers.Contract) => Promise<bigint>,
  decimals: number = 18
): Promise<{ raw: bigint; formatted: string } | null>
```

## Technical Implementation Summary

**Code Location**: `src/App.tsx:490-545`

**Key Contracts & Calls**:
1. **MoC V2 Core** (`0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`)
   - `getTotalACavailable()` → Total RIF collateral
   - `calcCtargemaCA()` → Coverage ratio

2. **MoC Price Feed** (`0x461750b4824b14c3d9b7702bc6fbb82469082b23`)
   - `read()` → RIF/USD price

3. **USDRIF Token** (`0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37`)
   - `totalSupply()` → Already minted USDRIF

**UI Display**: `src/App.tsx:802-809` — Shows "USDRIF Mintable" with help text explaining the formula

**Refresh Interval**: Updates every 60 seconds (`src/config.ts:42`)

## Business Implications

- **Dynamic Capacity**: Mintable capacity updates in real-time as collateral, prices, and minted amounts change
- **Price Source**: Uses MoC price feed (not RLabs) for consistency with protocol calculations
- **Safety Buffer**: Coverage ratio acts as a safety buffer - higher ratio = lower mintable capacity
- **Zero Handling**: If mintable is zero or negative, the system shows `0`, indicating no capacity

This implementation calculates mintable capacity in real-time using on-chain data from the Money on Chain protocol contracts, with all contract calls made via ethers.js through the Rootstock RPC endpoint.
