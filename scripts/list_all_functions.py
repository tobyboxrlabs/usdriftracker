#!/usr/bin/env python3
"""
List all functions from MoC V2 Core implementation contract
to help identify MODA/AMTA/DF functions
"""

import sys
from web3 import Web3

ROOTSTOCK_RPC = "https://public-node.rsk.co"
MOC_V2_CORE_IMPL = "0x8d168070fc3acf9b8491623917ecb17e764208cf"  # Implementation address

def fetch_contract_abi(w3, contract_address):
    """Fetch contract ABI from Blockscout"""
    import requests
    url = f"https://rootstock.blockscout.com/api?module=contract&action=getabi&address={contract_address}"
    try:
        response = requests.get(url, timeout=15)
        data = response.json()
        if data.get("status") == "1" and data.get("result"):
            import json
            abi_json = data["result"]
            if isinstance(abi_json, str):
                return json.loads(abi_json)
            return abi_json
    except Exception:
        pass
    return None

def main():
    w3 = Web3(Web3.HTTPProvider(ROOTSTOCK_RPC))
    
    if not w3.is_connected():
        print("❌ Failed to connect")
        sys.exit(1)
    
    print("Fetching ABI from implementation contract...")
    abi = fetch_contract_abi(w3, MOC_V2_CORE_IMPL)
    
    if not abi:
        print("❌ Failed to fetch ABI")
        sys.exit(1)
    
    functions = [item for item in abi if item.get("type") == "function"]
    
    # Group by type
    view_functions = [f for f in functions if f.get("stateMutability") == "view"]
    pure_functions = [f for f in functions if f.get("stateMutability") == "pure"]
    payable_functions = [f for f in functions if f.get("stateMutability") == "payable"]
    nonpayable_functions = [f for f in functions if f.get("stateMutability") == "nonpayable"]
    
    print(f"\nTotal functions: {len(functions)}")
    print(f"  View: {len(view_functions)}")
    print(f"  Pure: {len(pure_functions)}")
    print(f"  Payable: {len(payable_functions)}")
    print(f"  Nonpayable: {len(nonpayable_functions)}")
    
    # Show all view functions that return uint256 with no inputs (likely parameters)
    print("\n" + "=" * 80)
    print("VIEW FUNCTIONS (no inputs, returns uint256) - Potential Parameters:")
    print("=" * 80)
    
    param_functions = [f for f in view_functions 
                      if len(f.get("inputs", [])) == 0
                      and len(f.get("outputs", [])) == 1
                      and f.get("outputs", [{}])[0].get("type") == "uint256"]
    
    for func in param_functions:
        name = func.get("name", "unknown")
        print(f"  - {name}()")
    
    # Show functions with "max", "op", "diff", "moda", "amta" in name
    print("\n" + "=" * 80)
    print("FUNCTIONS WITH RELEVANT KEYWORDS:")
    print("=" * 80)
    
    keywords = ["max", "op", "diff", "moda", "amta", "flux", "capacitor", "decay", "df", "absolute", "operational", "difference", "allowed", "transaction"]
    relevant = [f for f in functions if any(kw in f.get("name", "").lower() for kw in keywords)]
    
    for func in relevant:
        name = func.get("name", "unknown")
        state = func.get("stateMutability", "")
        inputs = func.get("inputs", [])
        outputs = func.get("outputs", [])
        print(f"  {name}({', '.join([i.get('name', '') + ': ' + i.get('type', '') for i in inputs])}) [{state}] -> {outputs}")

if __name__ == "__main__":
    main()
