#!/usr/bin/env python3
"""
Query all parameter-like functions from MoC V2 Core to find MODA/AMTA/DF
"""

import sys
from web3 import Web3

ROOTSTOCK_RPC = "https://public-node.rsk.co"
MOC_V2_CORE_IMPL = "0x8d168070fc3acf9b8491623917ecb17e764208cf"

EXPECTED_MODA_RAW = 200000 * 10**18  # 200,000 RIF
EXPECTED_AMTA_RAW = 1000000 * 10**18  # 1,000,000 RIF
EXPECTED_DF_RAW = 3512  # blocks (no decimals)

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
    
    print("Fetching ABI...")
    abi = fetch_contract_abi(w3, MOC_V2_CORE_IMPL)
    
    if not abi:
        print("❌ Failed to fetch ABI")
        sys.exit(1)
    
    functions = [item for item in abi if item.get("type") == "function"]
    
    # Get all view functions with no inputs that return uint256
    param_functions = [f for f in functions 
                      if f.get("stateMutability") == "view"
                      and len(f.get("inputs", [])) == 0
                      and len(f.get("outputs", [])) == 1
                      and f.get("outputs", [{}])[0].get("type") == "uint256"]
    
    print(f"\nQuerying {len(param_functions)} parameter functions...")
    print("=" * 80)
    
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(MOC_V2_CORE_IMPL),
        abi=abi
    )
    
    results = []
    
    for func in param_functions:
        func_name = func.get("name", "")
        try:
            func_obj = getattr(contract.functions, func_name)
            result_value = func_obj().call()
            
            if isinstance(result_value, (int,)):
                # Check if it matches MODA, AMTA, or DF
                matches_moda = result_value == EXPECTED_MODA_RAW
                matches_amta = result_value == EXPECTED_AMTA_RAW
                matches_df = result_value == EXPECTED_DF_RAW
                
                # Format display
                if result_value >= 10**15:  # Likely RIF value (has decimals)
                    display_value = f"{result_value / 10**18:,.0f} RIF"
                else:
                    display_value = f"{result_value:,}"
                
                marker = ""
                if matches_moda:
                    marker = "🎯 MODA!"
                elif matches_amta:
                    marker = "🎯 AMTA!"
                elif matches_df:
                    marker = "🎯 DF!"
                elif 150000 * 10**18 <= result_value <= 250000 * 10**18:
                    marker = "💡 Close to MODA?"
                elif 800000 * 10**18 <= result_value <= 1200000 * 10**18:
                    marker = "💡 Close to AMTA?"
                elif 3000 <= result_value <= 4000:
                    marker = "💡 Close to DF?"
                
                results.append({
                    "name": func_name,
                    "value": result_value,
                    "display": display_value,
                    "matches_moda": matches_moda,
                    "matches_amta": matches_amta,
                    "matches_df": matches_df
                })
                
                print(f"{marker:12} {func_name:40} = {display_value}")
        except Exception as e:
            pass
    
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    moda_found = [r for r in results if r["matches_moda"]]
    amta_found = [r for r in results if r["matches_amta"]]
    df_found = [r for r in results if r["matches_df"]]
    
    if moda_found:
        print(f"\n🎉 MODA FOUND: {moda_found[0]['name']}() = {moda_found[0]['display']}")
    else:
        print("\n❌ MODA not found in parameter functions")
    
    if amta_found:
        print(f"🎉 AMTA FOUND: {amta_found[0]['name']}() = {amta_found[0]['display']}")
    else:
        print("❌ AMTA not found in parameter functions")
    
    if df_found:
        print(f"🎉 DF FOUND: {df_found[0]['name']}() = {df_found[0]['display']}")
    else:
        print("❌ DF not found in parameter functions")
    
    # Show close matches
    close_matches = [r for r in results if "💡" in r.get("display", "")]
    if close_matches:
        print(f"\n💡 Close matches (might be worth investigating):")
        for r in close_matches[:10]:
            print(f"   {r['name']}() = {r['display']}")

if __name__ == "__main__":
    main()
