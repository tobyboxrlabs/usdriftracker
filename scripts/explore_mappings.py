#!/usr/bin/env python3
"""
Explore mappings and functions with parameters that might contain MODA
"""

import sys
from web3 import Web3

ROOTSTOCK_RPC = "https://public-node.rsk.co"
MOC_V2_CORE_IMPL = "0x8d168070fc3acf9b8491623917ecb17e764208cf"

EXPECTED_MODA_RAW = 200000 * 10**18

def fetch_contract_abi(w3, contract_address):
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
    
    abi = fetch_contract_abi(w3, MOC_V2_CORE_IMPL)
    if not abi:
        print("❌ Failed to fetch ABI")
        sys.exit(1)
    
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(MOC_V2_CORE_IMPL),
        abi=abi
    )
    
    print("=" * 80)
    print("Exploring Functions That Might Return MODA/AMTA/DF")
    print("=" * 80)
    
    # Check maxQACToMintTP and maxQACToRedeemTP
    print("\n1. Checking maxQAC functions...")
    try:
        max_mint = contract.functions.maxQACToMintTP().call()
        max_redeem = contract.functions.maxQACToRedeemTP().call()
        print(f"   maxQACToMintTP() = {max_mint:,} ({max_mint / 10**18:,.0f} RIF)")
        print(f"   maxQACToRedeemTP() = {max_redeem:,} ({max_redeem / 10**18:,.0f} RIF)")
    except Exception as e:
        print(f"   Error: {e}")
    
    # Check if there are functions that return structs/tuples
    print("\n2. Checking for functions that return multiple values...")
    functions = [item for item in abi if item.get("type") == "function"]
    multi_return = [f for f in functions 
                   if f.get("stateMutability") == "view"
                   and len(f.get("outputs", [])) > 1]
    
    print(f"   Found {len(multi_return)} function(s) returning multiple values")
    for func in multi_return[:10]:
        name = func.get("name", "")
        outputs = func.get("outputs", [])
        print(f"   - {name}() -> {len(outputs)} values: {[o.get('type') for o in outputs]}")
    
    # Check mappings - look for public mappings
    print("\n3. Checking for public mappings (might need address parameter)...")
    mappings = [f for f in functions 
               if f.get("stateMutability") == "view"
               and len(f.get("inputs", [])) == 1
               and f.get("inputs", [{}])[0].get("type") == "address"]
    
    print(f"   Found {len(mappings)} function(s) taking address parameter")
    for mapping in mappings[:10]:
        name = mapping.get("name", "")
        outputs = mapping.get("outputs", [])
        print(f"   - {name}(address) -> {outputs}")
    
    # Try querying with zero address to see if MODA is stored per-address
    print("\n4. Trying mappings with zero address...")
    zero_addr = "0x0000000000000000000000000000000000000000"
    for mapping in mappings[:5]:
        name = mapping.get("name", "")
        try:
            func_obj = getattr(contract.functions, name)
            result = func_obj(zero_addr).call()
            if isinstance(result, (int,)) and result > 0:
                print(f"   {name}({zero_addr}) = {result:,}")
        except Exception:
            pass
    
    # Check provider addresses and see if they point to contracts with MODA
    print("\n5. Checking provider addresses...")
    try:
        max_abs_provider = contract.functions.maxAbsoluteOpProvider().call()
        max_op_diff_provider = contract.functions.maxOpDiffProvider().call()
        
        print(f"   maxAbsoluteOpProvider() = {max_abs_provider}")
        print(f"   maxOpDiffProvider() = {max_op_diff_provider}")
        
        # If providers are set, query them
        if max_op_diff_provider and max_op_diff_provider != "0x0000000000000000000000000000000000000000":
            print(f"\n   Querying maxOpDiffProvider contract for MODA...")
            provider_abi = fetch_contract_abi(w3, max_op_diff_provider)
            if provider_abi:
                provider_contract = w3.eth.contract(
                    address=Web3.to_checksum_address(max_op_diff_provider),
                    abi=provider_abi
                )
                # Try common function names
                for func_name in ["moda", "getModa", "value", "getValue", "read"]:
                    if hasattr(provider_contract.functions, func_name):
                        try:
                            result = getattr(provider_contract.functions, func_name)().call()
                            if isinstance(result, (int,)):
                                print(f"      {func_name}() = {result:,} ({result / 10**18:,.0f} RIF)")
                                if result == EXPECTED_MODA_RAW:
                                    print(f"         🎯 MATCHES MODA!")
                        except Exception:
                            pass
    except Exception as e:
        print(f"   Error: {e}")

if __name__ == "__main__":
    main()
