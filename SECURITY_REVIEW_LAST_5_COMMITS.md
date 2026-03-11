# Security Review - Last 5 Commits

**Review Date**: January 24, 2026  
**Commits Reviewed**: Last 5 commits (765f80a through e9fba11)

---

## 📋 Commits Reviewed

1. **765f80a** - Implement responsive design fixes (already reviewed ✅)
2. **0b37ad5** - Add new scripts for RSK hash rate monitoring and block scanning
3. **fb64a79** - Enhance Blockscout API integration with rate limiter
4. **0ae10f0** - Update links in MintRedeemAnalyser to BlockScout explorer
5. **e9fba11** - Update subtitle with emoji

---

## 🔒 Security Findings

### ✅ **COMMIT 1: 765f80a** - Responsive Design Fixes
**Status**: ✅ **CLEAN** (Already reviewed - no issues)

---

### ⚠️ **COMMIT 2: 0b37ad5** - Python Scripts

#### **Files Changed**:
- `scripts/scan_rsk_blocks.py` (new)
- `scripts/hashrate_ratio.py` (new)
- `src/VaultDepositWithdrawAnalyser.tsx` (new component)

#### **Security Assessment**: 🟡 **MEDIUM RISK** - Several concerns identified

#### **Issues Found**:

1. **Command-Line Argument Validation (scan_rsk_blocks.py)**
   - **Location**: Line 214-220
   - **Issue**: Uses `sys.argv[1]` with `int()` conversion but no bounds checking
   - **Risk**: Could allow DoS by requesting excessive number of blocks
   - **Severity**: 🟡 **MEDIUM**
   - **Current Code**:
     ```python
     if len(sys.argv) > 1:
         try:
             num_blocks = int(sys.argv[1])
         except ValueError:
             print(f"Usage: {sys.argv[0]} [num_blocks]", file=sys.stderr)
     ```
   - **Recommendation**: Add maximum limit (e.g., `max_blocks = 1000`) and validate range

2. **Selenium JavaScript Execution (hashrate_ratio.py)**
   - **Location**: Lines 378-386
   - **Issue**: Uses `driver.execute_script()` to execute JavaScript from external website
   - **Risk**: If external site is compromised, could execute malicious code
   - **Severity**: 🟡 **MEDIUM** (mitigated by headless browser isolation)
   - **Current Code**:
     ```python
     hash_rate_js = driver.execute_script("""
         if (typeof angular !== 'undefined') {
             var scope = angular.element(document.querySelector('[ng-controller]')).scope();
     ```
   - **Recommendation**: Document risk, ensure Selenium runs in isolated environment

3. **Hardcoded API URLs - SSRF Risk**
   - **Location**: Multiple locations in both scripts
   - **Issue**: URLs are hardcoded, but if scripts are modified to accept user input, SSRF risk exists
   - **Risk**: Low (currently hardcoded), but should be documented
   - **Severity**: 🟢 **LOW** (preventive)
   - **Recommendation**: Add comment warning against accepting user-provided URLs

4. **No Input Sanitization for Blockchain Data**
   - **Location**: Both scripts parse blockchain data without validation
   - **Issue**: If API returns malicious data, could cause parsing errors or DoS
   - **Risk**: 🟡 **MEDIUM** (mitigated by try/except blocks)
   - **Recommendation**: Add input validation for hex strings, block numbers, etc.

---

### ⚠️ **COMMIT 3: fb64a79** - Blockscout API Rate Limiter

#### **Files Changed**:
- `src/MintRedeemAnalyser.tsx`

#### **Security Assessment**: 🟡 **MEDIUM RISK** - URL injection concern

#### **Issues Found**:

1. **URL Construction Without Encoding**
   - **Location**: Line 153
   - **Issue**: URL parameters (`address`, `fromBlock`, `toBlock`, `topic0`) are inserted directly into URL string without encoding
   - **Risk**: If these values come from user input or compromised API, could allow URL injection
   - **Severity**: 🟡 **MEDIUM**
   - **Current Code**:
     ```typescript
     const url = `${BLOCKSCOUT_API}?module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic0}&page=1&offset=10000`
     ```
   - **Analysis**: 
     - `address` comes from `config.ts` (hardcoded contract address) ✅ Safe
     - `fromBlock`, `toBlock` are calculated from `days` state (user-controlled dropdown) ⚠️ Should validate
     - `topic0` is hardcoded event signature ✅ Safe
   - **Recommendation**: Use `URLSearchParams` or `encodeURIComponent` for all parameters, add validation for block numbers
   - **Note**: `VaultDepositWithdrawAnalyser.tsx` already uses `URLSearchParams` correctly (line 132) ✅

2. **Exponential Backoff Retry Logic**
   - **Location**: Lines 176-181, 194-199
   - **Issue**: Retries on network errors could be exploited for DoS
   - **Risk**: 🟢 **LOW** (client-side, limited impact)
   - **Recommendation**: Add maximum retry cap (already present: `retryCount < 3`) ✅

---

### ✅ **COMMIT 4: 0ae10f0** - Link Updates

#### **Files Changed**:
- `src/MintRedeemAnalyser.tsx` (2 lines)

#### **Security Assessment**: ✅ **LOW RISK** - Properly mitigated

#### **Issues Found**:

1. **External Link Construction**
   - **Location**: Lines 1334, 1352, 1362
   - **Issue**: Uses template literals with blockchain data (`tx.hash`, `tx.receiver`, `tx.blockNumber`)
   - **Risk**: If API is compromised, malicious values could create XSS/open redirect
   - **Severity**: 🟢 **LOW** (mitigated by `rel="noopener noreferrer"` and React's safe rendering)
   - **Current Code**:
     ```typescript
     href={`https://rootstock.blockscout.com/tx/${tx.hash}`}
     target="_blank"
     rel="noopener noreferrer"
     ```
   - **Analysis**: 
     - React escapes content in `href` attributes ✅
     - `rel="noopener noreferrer"` prevents window.opener attacks ✅
     - Blockchain hashes are hex strings (0-9a-f), low XSS risk ✅
   - **Recommendation**: Consider validating hash format (hex string, 64 chars) for defense in depth

---

### ✅ **COMMIT 5: e9fba11** - Emoji Addition

#### **Files Changed**:
- `src/Analytics.tsx` (1 line)

#### **Security Assessment**: ✅ **CLEAN** - No security concerns

#### **Issues Found**: None

---

## 📊 Summary of Security Issues

| Commit | Severity | Issues Found | Status |
|--------|----------|--------------|--------|
| 765f80a | 🟢 None | 0 | ✅ Clean |
| 0b37ad5 | 🟡 Medium | 4 | ⚠️ Needs fixes |
| fb64a79 | 🟡 Medium | 1 | ⚠️ Needs fixes |
| 0ae10f0 | 🟢 Low | 0 | ✅ Acceptable |
| e9fba11 | 🟢 None | 0 | ✅ Clean |

**Overall Risk Level**: 🟡 **MEDIUM** (2 commits need attention)

---

## 🛠️ Remediation Plan

### **Priority 1: High Impact Fixes** (Recommended within 1 week)

#### **Fix 1: URL Parameter Encoding (fb64a79)**
**File**: `src/MintRedeemAnalyser.tsx`  
**Line**: ~153

**Action**: Replace direct string interpolation with `URLSearchParams`:

```typescript
// BEFORE:
const url = `${BLOCKSCOUT_API}?module=logs&action=getLogs&address=${address}&fromBlock=${fromBlock}&toBlock=${toBlock}&topic0=${topic0}&page=1&offset=10000`

// AFTER:
const params = new URLSearchParams({
  module: 'logs',
  action: 'getLogs',
  address: address,
  fromBlock: fromBlock.toString(),
  toBlock: toBlock.toString(),
  topic0: topic0,
  page: '1',
  offset: '10000'
})
const url = `${BLOCKSCOUT_API}?${params.toString()}`
```

**Also apply to**: `VaultDepositWithdrawAnalyser.tsx` (if similar pattern exists)

---

#### **Fix 2: Block Number Validation (fb64a79)**
**File**: `src/MintRedeemAnalyser.tsx`  
**Location**: Before URL construction

**Action**: Add validation for block numbers:

```typescript
// Validate block numbers are positive integers
if (!Number.isInteger(fromBlock) || fromBlock < 0) {
  throw new Error('Invalid fromBlock')
}
if (!Number.isInteger(toBlock) || toBlock < 0) {
  throw new Error('Invalid toBlock')
}
if (toBlock < fromBlock) {
  throw new Error('toBlock must be >= fromBlock')
}
```

---

### **Priority 2: Medium Impact Fixes** (Recommended within 2 weeks)

#### **Fix 3: Command-Line Argument Bounds Checking (0b37ad5)**
**File**: `scripts/scan_rsk_blocks.py`  
**Line**: ~216

**Action**: Add maximum limit:

```python
if len(sys.argv) > 1:
    try:
        num_blocks = int(sys.argv[1])
        # Add bounds checking
        MAX_BLOCKS = 1000
        if num_blocks < 1:
            print(f"Error: num_blocks must be >= 1", file=sys.stderr)
            sys.exit(1)
        if num_blocks > MAX_BLOCKS:
            print(f"Error: num_blocks exceeds maximum of {MAX_BLOCKS}", file=sys.stderr)
            sys.exit(1)
    except ValueError:
        print(f"Usage: {sys.argv[0]} [num_blocks]", file=sys.stderr)
        sys.exit(1)
```

---

#### **Fix 4: Input Validation for Blockchain Data (0b37ad5)**
**Files**: `scripts/scan_rsk_blocks.py`, `scripts/hashrate_ratio.py`

**Action**: Add validation functions:

```python
def validate_hex_string(hex_str: str, expected_length: Optional[int] = None) -> bool:
    """Validate hex string format"""
    if not hex_str or not isinstance(hex_str, str):
        return False
    if not hex_str.startswith('0x'):
        return False
    if not all(c in '0123456789abcdefABCDEF' for c in hex_str[2:]):
        return False
    if expected_length and len(hex_str) != expected_length + 2:
        return False
    return True

def validate_block_number(block_num: int) -> bool:
    """Validate block number is reasonable"""
    return isinstance(block_num, int) and 0 <= block_num <= 10_000_000  # Reasonable upper bound
```

**Apply validation before parsing blockchain data**

---

### **Priority 3: Documentation & Defense in Depth** (Recommended within 1 month)

#### **Fix 5: Document Selenium Security Risk (0b37ad5)**
**File**: `scripts/hashrate_ratio.py`  
**Location**: Before `get_rsk_hashrate_from_stats_io()` function

**Action**: Add security comment:

```python
def get_rsk_hashrate_from_stats_io() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch RSK hash rate from stats.rootstock.io using Selenium
    
    SECURITY NOTE: This function executes JavaScript from an external website.
    The Selenium browser runs in a headless, isolated environment, but if the
    external site is compromised, malicious code could execute. This is a
    known risk of web scraping. Ensure this script runs in a sandboxed
    environment and monitor for unexpected behavior.
    
    Uses Selenium to load the page, execute JavaScript, wait for WebSocket data to load,
    and extract the hash rate from the DOM.
    
    Returns: (hashrate_value, error_message)
    """
```

---

#### **Fix 6: Add SSRF Prevention Comment (0b37ad5)**
**Files**: `scripts/scan_rsk_blocks.py`, `scripts/hashrate_ratio.py`

**Action**: Add comment near API URL constants:

```python
# SECURITY NOTE: These URLs are hardcoded to prevent SSRF attacks.
# DO NOT modify these scripts to accept user-provided URLs without
# implementing proper URL validation and allowlisting.
BASE_URL = "https://mempool.space"
```

---

#### **Fix 7: Validate Hash Format in Links (0ae10f0)**
**File**: `src/MintRedeemAnalyser.tsx`  
**Location**: Before rendering links

**Action**: Add validation helper (defense in depth):

```typescript
function isValidHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash)
}

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

// Use in render:
{isValidHash(tx.hash) && (
  <a href={`https://rootstock.blockscout.com/tx/${tx.hash}`} ...>
)}
```

---

## ✅ **Verification Checklist**

After implementing fixes, verify:

- [ ] URL parameters are properly encoded using `URLSearchParams`
- [ ] Block numbers are validated before use
- [ ] Command-line arguments have bounds checking
- [ ] Blockchain data is validated before parsing
- [ ] Security documentation is added for Selenium usage
- [ ] SSRF prevention comments are added
- [ ] Hash/address validation is implemented (defense in depth)

---

## 📝 **Risk Assessment**

### **Current State**:
- **Critical Issues**: 0
- **High Issues**: 0
- **Medium Issues**: 5
- **Low Issues**: 2

### **After Remediation**:
- **Critical Issues**: 0
- **High Issues**: 0
- **Medium Issues**: 0
- **Low Issues**: 0 (or acceptable low-risk documentation items)

---

## 🎯 **Recommendations**

1. **Immediate**: Implement Priority 1 fixes (URL encoding, block validation)
2. **Short-term**: Implement Priority 2 fixes (bounds checking, input validation)
3. **Long-term**: Add security documentation and defense-in-depth measures

**Overall Assessment**: The codebase is generally secure, but these fixes will improve robustness and prevent potential issues. None of the identified issues are critical, but addressing them will strengthen the security posture.

---

**Review Completed**: January 24, 2026  
**Next Review**: After remediation fixes are implemented
