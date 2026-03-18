#!/usr/bin/env python3
"""
Explore MODA Parameter Query from RIF On-Chain Contracts
Tests different methods to query MODA (Maximum Operational Difference Allowed) parameter
"""

import json
import sys
from typing import Optional, Dict, Any
import requests

# Configuration
ROOTSTOCK_RPC = "https://public-node.rsk.co"
MOC_V2_CORE = "0xA27024Ed70035E46dba712609fc2Afa1c97aA36A"

# Expected MODA value: 200,000 RIF = 200000 * 10^18
EXPECTED_MODA_RAW = 200000 * 10**18  # 200000000000000000000000
EXPECTED_MODA_DISPLAY = "200,000 RIF"

# Create session
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "moda-explorer/1.0"})
SESSION.proxies = {"http": None, "https": None}


def eth_call(contract_address: str, data: str, block: str = "latest") -> Optional[str]:
    """
    Make eth_call RPC request to query contract function
    
    Args:
        contract_address: Contract address (checksummed or lowercase)
        data: Function selector + encoded parameters (hex string with 0x prefix)
        block: Block number or "latest"
    
    Returns:
        Hex string result or None if error
    """
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_call",
        "params": [
            {
                "to": contract_address,
                "data": data
            },
            block
        ],
        "id": 1
    }
    
    try:
        response = SESSION.post(ROOTSTOCK_RPC, json=payload, timeout=15)
        response.raise_for_status()
        
        result = response.json()
        if "error" in result:
            print(f"  ❌ RPC Error: {result['error']}")
            return None
        
        return result.get("result")
    except Exception as e:
        print(f"  ❌ Request failed: {e}")
        return None


def get_function_selector(function_signature: str) -> str:
    """
    Calculate function selector (first 4 bytes of keccak256 hash)
    For testing purposes - in production, use proper keccak256 implementation
    
    Common selectors (manually calculated):
    - moda() = 0x... (need to calculate)
    - getModa() = 0x... (need to calculate)
    """
    # Note: This is a placeholder - actual implementation would use keccak256
    # For now, we'll try common patterns or use ethers.js/web3.py to calculate
    print(f"  ⚠️  Function selector calculation needed for: {function_signature}")
    return "0x00000000"  # Placeholder


def try_query_moda(contract_address: str, function_name: str, function_selector: str) -> Dict[str, Any]:
    """
    Try to query MODA using a specific function selector
    
    Returns:
        Dict with result information
    """
    print(f"\n🔍 Trying: {function_name}()")
    print(f"   Contract: {contract_address}")
    print(f"   Selector: {function_selector}")
    
    result_hex = eth_call(contract_address, function_selector)
    
    if not result_hex or result_hex == "0x":
        return {
            "success": False,
            "function": function_name,
            "error": "No result or empty response"
        }
    
    try:
        # Parse hex result to integer
        result_int = int(result_hex, 16)
        
        # Convert to RIF units (divide by 10^18)
        result_rif = result_int / 10**18
        
        # Check if it matches expected value
        matches_expected = result_int == EXPECTED_MODA_RAW
        
        return {
            "success": True,
            "function": function_name,
            "raw_hex": result_hex,
            "raw_int": result_int,
            "rif_value": result_rif,
            "formatted": f"{result_rif:,.0f} RIF",
            "matches_expected": matches_expected
        }
    except ValueError as e:
        return {
            "success": False,
            "function": function_name,
            "error": f"Failed to parse result: {e}",
            "raw_hex": result_hex
        }


def get_contract_abi_from_blockscout(contract_address: str) -> Optional[Dict]:
    """
    Fetch contract ABI from Blockscout API
    
    Args:
        contract_address: Contract address
    
    Returns:
        ABI dict or None
    """
    url = f"https://rootstock.blockscout.com/api?module=contract&action=getabi&address={contract_address}"
    
    try:
        response = SESSION.get(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        if data.get("status") == "1" and data.get("result"):
            abi_json = data["result"]
            if isinstance(abi_json, str):
                return json.loads(abi_json)
            return abi_json
        else:
            print(f"  ⚠️  Blockscout API error: {data.get('message', 'Unknown error')}")
            return None
    except Exception as e:
        print(f"  ❌ Failed to fetch ABI: {e}")
        return None


def find_moda_functions_in_abi(abi: list) -> list:
    """
    Search ABI for MODA-related functions
    
    Returns:
        List of function definitions that might be MODA
    """
    moda_functions = []
    
    for item in abi:
        if item.get("type") == "function":
            name = item.get("name", "").lower()
            
            # Check if function name contains "moda"
            if "moda" in name:
                moda_functions.append(item)
            
            # Also check for Flux Capacitor related functions
            if any(keyword in name for keyword in ["flux", "capacitor", "amta", "df", "decay"]):
                moda_functions.append(item)
    
    return moda_functions


def calculate_function_selector(function_signature: str) -> str:
    """
    Calculate keccak256 hash and take first 4 bytes for function selector
    Note: This requires a proper keccak256 implementation
    """
    # For now, return placeholder - would need pycryptodome or similar
    # In practice, you'd use: keccak256(function_signature.encode())[:4]
    print(f"  ⚠️  Need keccak256 implementation to calculate selector for: {function_signature}")
    return "0x00000000"


def main():
    """Main exploration function"""
    print("=" * 80)
    print("MODA Parameter Query Explorer")
    print("=" * 80)
    print(f"\nTarget Contract: {MOC_V2_CORE}")
    print(f"Expected MODA Value: {EXPECTED_MODA_DISPLAY} ({EXPECTED_MODA_RAW:,})")
    print(f"RPC Endpoint: {ROOTSTOCK_RPC}")
    
    # Step 1: Try to fetch contract ABI from Blockscout
    print("\n" + "=" * 80)
    print("STEP 1: Fetching Contract ABI from Blockscout")
    print("=" * 80)
    
    abi = get_contract_abi_from_blockscout(MOC_V2_CORE)
    
    if abi:
        print(f"✅ Successfully fetched ABI ({len(abi)} items)")
        
        # Search for MODA-related functions
        print("\n🔍 Searching ABI for MODA-related functions...")
        moda_functions = find_moda_functions_in_abi(abi)
        
        if moda_functions:
            print(f"\n✅ Found {len(moda_functions)} potential MODA function(s):")
            for func in moda_functions:
                name = func.get("name", "unknown")
                inputs = func.get("inputs", [])
                outputs = func.get("outputs", [])
                print(f"\n  Function: {name}")
                print(f"    Inputs: {inputs}")
                print(f"    Outputs: {outputs}")
                print(f"    Type: {func.get('stateMutability', 'unknown')}")
        else:
            print("  ⚠️  No MODA-related functions found in ABI")
            print("  💡 Searching for all view/pure functions...")
            
            # List all view/pure functions
            view_functions = [
                item for item in abi 
                if item.get("type") == "function" 
                and item.get("stateMutability") in ["view", "pure"]
            ]
            
            print(f"\n  Found {len(view_functions)} view/pure functions:")
            for func in view_functions[:20]:  # Show first 20
                name = func.get("name", "unknown")
                outputs = func.get("outputs", [])
                print(f"    - {name}() -> {outputs}")
            
            if len(view_functions) > 20:
                print(f"    ... and {len(view_functions) - 20} more")
    else:
        print("❌ Failed to fetch ABI from Blockscout")
        print("  Will try direct function calls with common selectors")
    
    # Step 2: Try common function signatures
    print("\n" + "=" * 80)
    print("STEP 2: Testing Common Function Signatures")
    print("=" * 80)
    print("\n⚠️  Note: Function selectors need to be calculated using keccak256")
    print("   This script shows the approach - actual selectors should be calculated")
    print("   using web3.py, eth_utils, or similar library")
    
    # Common function signatures to try
    # Note: These selectors are placeholders - need actual keccak256 calculation
    test_functions = [
        ("moda()", "0x00000000"),  # Placeholder - needs actual selector
        ("getModa()", "0x00000000"),
        ("getMODA()", "0x00000000"),
        ("MODA()", "0x00000000"),
        ("fluxCapacitorModa()", "0x00000000"),
    ]
    
    print("\n💡 To calculate actual selectors, use:")
    print("   from eth_utils import keccak")
    print("   selector = '0x' + keccak(function_signature.encode())[:4].hex()")
    
    # Step 3: Try direct storage slot access (if we know the slot)
    print("\n" + "=" * 80)
    print("STEP 3: Storage Slot Access (If Known)")
    print("=" * 80)
    print("\n💡 If MODA is a public variable, we can access it via storage slot")
    print("   However, we need to know the storage slot number from contract source")
    print("   This would use eth_getStorageAt RPC call")
    
    # Step 4: Summary and recommendations
    print("\n" + "=" * 80)
    print("SUMMARY & RECOMMENDATIONS")
    print("=" * 80)
    
    print("\n✅ Next Steps:")
    print("1. Install required libraries:")
    print("   pip install web3 eth-utils")
    print()
    print("2. Calculate actual function selectors:")
    print("   from web3 import Web3")
    print("   selector = Web3.keccak(text='moda()')[:4].hex()")
    print()
    print("3. Try querying with actual selectors:")
    print("   result = eth_call(MOC_V2_CORE, '0x' + selector)")
    print()
    print("4. If ABI is available, use it directly:")
    print("   from web3 import Web3")
    print("   w3 = Web3(Web3.HTTPProvider(ROOTSTOCK_RPC))")
    print("   contract = w3.eth.contract(address=MOC_V2_CORE, abi=abi)")
    print("   moda_value = contract.functions.moda().call()")
    print()
    print("5. Verify result matches expected:")
    print(f"   Expected: {EXPECTED_MODA_RAW:,}")
    print("   Actual: <from contract call>")
    print("   Match: <compare values>")
    
    print("\n" + "=" * 80)
    print("Exploration Complete")
    print("=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
