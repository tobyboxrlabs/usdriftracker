# MODA Query Exploration Scripts

Scripts to explore and query the MODA (Maximum Operational Difference Allowed) parameter from the MoC V2 Core contract on Rootstock.

## Scripts

### 1. `query_moda.py` (Recommended)
**Full-featured script using web3.py**

- ✅ Calculates function selectors automatically
- ✅ Fetches contract ABI from Blockscout
- ✅ Tries multiple function signatures
- ✅ Verifies results against expected value (200,000 RIF)

**Prerequisites:**
```bash
pip install web3 requests
```

**Usage:**
```bash
python3 scripts/query_moda.py
```

**What it does:**
1. Connects to Rootstock RPC endpoint
2. Fetches contract ABI from Blockscout
3. Tries querying MODA using ABI (most reliable)
4. Falls back to direct function calls with calculated selectors
5. Reports which function works and the result

### 2. `explore_moda_query.py`
**Basic exploration script (educational)**

- Shows the approach without web3.py dependency
- Demonstrates the concept
- Needs manual function selector calculation

**Usage:**
```bash
python3 scripts/explore_moda_query.py
```

## Expected Results

**MODA Parameter:**
- **Value**: 200,000 RIF
- **Raw (on-chain)**: `200000000000000000000000` (200,000 * 10^18)
- **Formatted**: "200,000 RIF"

## Function Signatures Tested

The scripts try these function names:
- `moda()`
- `getModa()`
- `getMODA()`
- `MODA()`
- `fluxCapacitorModa()`
- `fluxCapacitorParams()` (may return all three: AMTA, MODA, DF)

## Example Output

```
================================================================================
MODA Parameter Query Tool
================================================================================

Target Contract: 0xA27024Ed70035E46dba712609fc2Afa1c97aA36A
Expected MODA Value: 200,000 RIF (200000000000000000000000)
RPC Endpoint: https://public-node.rsk.co

🔌 Connecting to Rootstock RPC...
✅ Connected to Rootstock
📦 Latest block: 6,123,456

================================================================================
METHOD 1: Query using Contract ABI
================================================================================
✅ Fetched ABI (245 items)

🎉 SUCCESS! Found MODA parameter:
   Function: moda
   Raw Value: 200,000,000,000,000,000,000,000
   Formatted: 200,000 RIF
   ✅ Value matches expected MODA (200,000 RIF)
```

## Next Steps

Once you identify the working function:

1. **Add to config.ts:**
   ```typescript
   export const MOC_CORE_ABI = [
     // ... existing functions
     'function moda() view returns (uint256)', // Add this
   ] as const
   ```

2. **Query in App.tsx:**
   ```typescript
   const modaResult = await queryOptionalMetric(
     provider,
     CONFIG.MOC_V2_CORE,
     MOC_CORE_ABI,
     async (contract) => await contract.moda(),
     STANDARD_DECIMALS
   )
   ```

## Troubleshooting

**Error: "web3 library not installed"**
```bash
pip install web3 requests
```

**Error: "Failed to connect to Rootstock RPC"**
- Check internet connection
- Verify RPC endpoint is accessible
- Try alternative endpoint: `https://rsk.publicnode.com`

**Error: "Could not fetch ABI"**
- Contract may not be verified on Blockscout
- Try direct function calls (Method 2)
- Check contract address is correct

**No functions found:**
- Verify contract address: `0xA27024Ed70035E46dba712609fc2Afa1c97aA36A`
- Check if contract source code is available
- MODA might be in a different contract
