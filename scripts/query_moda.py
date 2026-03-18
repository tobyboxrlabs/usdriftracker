#!/usr/bin/env python3
"""
Query MODA Parameter from MoC V2 Core Contract
Uses web3.py for proper function selector calculation and contract interaction
"""

import sys
from typing import Optional

try:
    from web3 import Web3
    from web3.exceptions import ContractLogicError, BadFunctionCallOutput
except ImportError:
    print("❌ Error: web3 library not installed", file=sys.stderr)
    print("   Install with: pip install web3", file=sys.stderr)
    sys.exit(1)

# Configuration
ROOTSTOCK_RPC = "https://public-node.rsk.co"
MOC_V2_CORE = "0xA27024Ed70035E46dba712609fc2Afa1c97aA36A"
MOC_STATE = "0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257"  # MoC State contract

# Contracts to check for MODA
CONTRACTS_TO_CHECK = [
    ("MoC V2 Core", MOC_V2_CORE),
    ("MoC State", MOC_STATE),
]

# Expected MODA value: 200,000 RIF = 200000 * 10^18
EXPECTED_MODA_RAW = 200000 * 10**18  # 200000000000000000000000
EXPECTED_MODA_DISPLAY = "200,000 RIF"

# Function signatures to try
FUNCTION_SIGNATURES = [
    "moda()",
    "getModa()",
    "getMODA()",
    "MODA()",
    "fluxCapacitorModa()",
    "amta()",  # Also try AMTA for reference
    "getAMTA()",
    "df()",  # Also try DF (Decay Factor)
    "getDF()",
    "decayFactor()",
]


def try_query_function(w3: Web3, contract_address: str, function_signature: str) -> Optional[dict]:
    """
    Try to query a function from the contract
    
    Returns:
        Dict with result or None if function doesn't exist
    """
    try:
        # Calculate function selector
        function_selector = w3.keccak(text=function_signature)[:4]
        
        # Make eth_call
        result_hex = w3.eth.call({
            "to": Web3.to_checksum_address(contract_address),
            "data": "0x" + function_selector.hex()
        })
        
        # Parse result (assuming uint256 return)
        if len(result_hex) == 32:  # 32 bytes = 256 bits
            result_int = int.from_bytes(result_hex, byteorder='big')
            result_rif = result_int / 10**18
            
            return {
                "success": True,
                "function": function_signature,
                "selector": "0x" + function_selector.hex(),
                "raw_hex": "0x" + result_hex.hex(),
                "raw_int": result_int,
                "rif_value": result_rif,
                "formatted": f"{result_rif:,.0f} RIF",
                "matches_moda_expected": result_int == EXPECTED_MODA_RAW
            }
        else:
            return {
                "success": False,
                "function": function_signature,
                "error": f"Unexpected result length: {len(result_hex)} bytes (expected 32)"
            }
            
    except ContractLogicError as e:
        # Function doesn't exist or reverted
        return None
    except Exception as e:
        return {
            "success": False,
            "function": function_signature,
            "error": str(e)
        }


def fetch_contract_abi(w3: Web3, contract_address: str) -> Optional[list]:
    """
    Fetch contract ABI from Blockscout API
    """
    import requests
    
    url = f"https://rootstock.blockscout.com/api?module=contract&action=getabi&address={contract_address}"
    
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        
        data = response.json()
        if data.get("status") == "1" and data.get("result"):
            import json
            abi_json = data["result"]
            if isinstance(abi_json, str):
                return json.loads(abi_json)
            return abi_json
    except Exception as e:
        print(f"  ⚠️  Failed to fetch ABI: {e}")
    
    return None


def query_with_abi(w3: Web3, contract_address: str, abi: list) -> Optional[dict]:
    """
    Query MODA using contract ABI (most reliable method)
    """
    try:
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=abi
        )
        
        # Try different function names
        for func_name in ["moda", "getModa", "getMODA", "MODA", "fluxCapacitorModa"]:
            if hasattr(contract.functions, func_name):
                try:
                    func = getattr(contract.functions, func_name)
                    result = func().call()
                    
                    # Handle different return types
                    if isinstance(result, (int,)):
                        result_int = result
                    elif isinstance(result, (tuple, list)):
                        # If struct returned, try to find moda field
                        result_int = result[0] if len(result) > 0 else None
                    else:
                        continue
                    
                    if result_int is not None:
                        result_rif = result_int / 10**18
                        
                        return {
                            "success": True,
                            "method": "ABI",
                            "function": func_name,
                            "raw_int": result_int,
                            "rif_value": result_rif,
                            "formatted": f"{result_rif:,.0f} RIF",
                            "matches_moda_expected": result_int == EXPECTED_MODA_RAW
                        }
                except (ContractLogicError, BadFunctionCallOutput):
                    continue
                except Exception as e:
                    print(f"  ⚠️  Error calling {func_name}(): {e}")
                    continue
        
        # Also try fluxCapacitorParams() if it returns a struct
        if hasattr(contract.functions, "fluxCapacitorParams"):
            try:
                result = contract.functions.fluxCapacitorParams().call()
                # Result might be a tuple: (amta, moda, df)
                if isinstance(result, (tuple, list)) and len(result) >= 2:
                    moda_value = result[1]  # Second element should be MODA
                    moda_rif = moda_value / 10**18
                    
                    return {
                        "success": True,
                        "method": "ABI",
                        "function": "fluxCapacitorParams()",
                        "raw_int": moda_value,
                        "rif_value": moda_rif,
                        "formatted": f"{moda_rif:,.0f} RIF",
                        "matches_moda_expected": moda_value == EXPECTED_MODA_RAW,
                        "all_params": {
                            "amta": result[0] / 10**18 if len(result) > 0 else None,
                            "moda": moda_rif,
                            "df": result[2] if len(result) > 2 else None
                        }
                    }
            except Exception as e:
                print(f"  ⚠️  Error calling fluxCapacitorParams(): {e}")
    
    except Exception as e:
        print(f"  ❌ Error creating contract instance: {e}")
    
    return None


def check_proxy_implementation(w3: Web3, contract_address: str) -> Optional[str]:
    """
    Check if contract is a proxy and get implementation address
    Common proxy storage slots:
    - EIP-1967: keccak256("eip1967.proxy.implementation") - 1
    - OpenZeppelin: keccak256("org.zeppelinos.proxy.implementation")
    """
    # EIP-1967 implementation slot
    impl_slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    
    try:
        impl_address_hex = w3.eth.get_storage_at(
            Web3.to_checksum_address(contract_address),
            impl_slot
        )
        
        # Check if slot contains an address (last 20 bytes should be non-zero)
        if len(impl_address_hex) >= 32:
            # Extract address from last 20 bytes
            address_bytes = impl_address_hex[-20:]
            if address_bytes != b'\x00' * 20:
                impl_address = "0x" + address_bytes.hex()
                return impl_address
    except Exception as e:
        pass
    
    return None


def main():
    """Main query function"""
    print("=" * 80)
    print("MODA Parameter Query Tool")
    print("=" * 80)
    print(f"\nExpected MODA Value: {EXPECTED_MODA_DISPLAY} ({EXPECTED_MODA_RAW:,})")
    print(f"RPC Endpoint: {ROOTSTOCK_RPC}\n")
    
    # Connect to Rootstock
    print("🔌 Connecting to Rootstock RPC...")
    w3 = Web3(Web3.HTTPProvider(ROOTSTOCK_RPC))
    
    if not w3.is_connected():
        print("❌ Failed to connect to Rootstock RPC")
        sys.exit(1)
    
    print("✅ Connected to Rootstock")
    
    # Get latest block for reference
    try:
        latest_block = w3.eth.block_number
        print(f"📦 Latest block: {latest_block:,}")
    except Exception as e:
        print(f"⚠️  Could not get latest block: {e}")
    
    all_successful_results = []
    
    # Check each contract
    for contract_name, contract_address in CONTRACTS_TO_CHECK:
        print("\n" + "=" * 80)
        print(f"CHECKING: {contract_name}")
        print(f"Address: {contract_address}")
        print("=" * 80)
        
        # Check if it's a proxy
        print("\n🔍 Checking for proxy pattern...")
        impl_address = check_proxy_implementation(w3, contract_address)
        if impl_address:
            print(f"✅ Found proxy implementation: {impl_address}")
            print(f"   Will check both proxy and implementation")
            contracts_to_check = [(contract_name + " (Proxy)", contract_address),
                                 (contract_name + " (Implementation)", impl_address)]
        else:
            print("   Not a proxy (or using different pattern)")
            contracts_to_check = [(contract_name, contract_address)]
        
        for check_name, check_address in contracts_to_check:
            print(f"\n--- Checking {check_name} ---")
            
            # Method 1: Try with ABI
            print("\n📋 METHOD 1: Query using Contract ABI")
            abi = fetch_contract_abi(w3, check_address)
            
            if abi and len(abi) > 0:
                print(f"✅ Fetched ABI ({len(abi)} items)")
                
                # Debug: Show functions in ABI
                functions = [item for item in abi if item.get("type") == "function"]
                moda_related = []  # Initialize
                
                if functions:
                    print(f"\n   Found {len(functions)} function(s)")
                    
                    # Search for MODA/Flux Capacitor related functions
                    # Also search for "max", "operational", "difference", "allowed", "transaction" for AMTA/MODA
                    moda_related = [f for f in functions if any(
                        keyword in f.get("name", "").lower() 
                        for keyword in ["moda", "flux", "capacitor", "amta", "decay", "df", 
                                       "maxoperational", "maxoperationaldifference", "maxoperationaldifferenceallowed",
                                       "maxtransaction", "maxtransactionallowed", "absolutemaxtransaction",
                                       "max", "operational", "difference", "allowed"]
                    )]
                    
                    # Also search for functions that return uint256 and might be parameters
                    # Look for view functions with no parameters that return uint256
                    parameter_functions = [f for f in functions 
                                         if f.get("stateMutability") == "view"
                                         and len(f.get("inputs", [])) == 0
                                         and len(f.get("outputs", [])) == 1
                                         and f.get("outputs", [{}])[0].get("type") == "uint256"]
                    
                    if len(parameter_functions) > 0 and len(moda_related) == 0:
                        print(f"\n   💡 Found {len(parameter_functions)} parameter-like function(s) (view, no inputs, returns uint256):")
                        print(f"      These might include MODA/AMTA/DF:")
                        for func in parameter_functions[:30]:  # Show first 30
                            name = func.get("name", "unknown")
                            print(f"      - {name}()")
                        if len(parameter_functions) > 30:
                            print(f"      ... and {len(parameter_functions) - 30} more")
                    
                    if moda_related:
                        print(f"\n   🎯 Found {len(moda_related)} MODA/Flux Capacitor related function(s):")
                        for func in moda_related:
                            name = func.get("name", "unknown")
                            state = func.get("stateMutability", "")
                            outputs = func.get("outputs", [])
                            inputs = func.get("inputs", [])
                            print(f"      {name}({', '.join([i.get('name', '') + ': ' + i.get('type', '') for i in inputs])}) [{state}] -> {outputs}")
                    else:
                        print(f"\n   ⚠️  No MODA/Flux Capacitor functions found in ABI")
                        
                        # Show all view functions with no parameters that return uint256 (likely parameters)
                        view_uint256_functions = [f for f in functions 
                                                  if f.get("stateMutability") == "view"
                                                  and len(f.get("inputs", [])) == 0
                                                  and len(f.get("outputs", [])) == 1
                                                  and f.get("outputs", [{}])[0].get("type") == "uint256"]
                        
                        if view_uint256_functions:
                            print(f"\n   💡 Found {len(view_uint256_functions)} parameter-like function(s) (view, no inputs, returns uint256):")
                            print(f"      These might include MODA/AMTA/DF - querying them...")
                            
                            # Try querying these functions
                            try:
                                contract = w3.eth.contract(
                                    address=Web3.to_checksum_address(check_address),
                                    abi=abi
                                )
                                
                                for func in view_uint256_functions[:50]:  # Query first 50
                                    func_name = func.get("name", "")
                                    try:
                                        func_obj = getattr(contract.functions, func_name)
                                        result_value = func_obj().call()
                                        
                                        if isinstance(result_value, (int,)):
                                            result_int = result_value
                                            result_rif = result_int / 10**18
                                            
                                            # Check if it matches expected MODA (200,000 RIF)
                                            matches_moda = result_int == EXPECTED_MODA_RAW
                                            # Also check if it's close (within 10% of expected)
                                            close_to_moda = abs(result_int - EXPECTED_MODA_RAW) < (EXPECTED_MODA_RAW * 0.1)
                                            
                                            marker = "🎯" if matches_moda else ("💡" if close_to_moda else "  ")
                                            print(f"      {marker} {func_name}() = {result_int:,} ({result_rif:,.0f} RIF)")
                                            
                                            if matches_moda or close_to_moda:
                                                all_successful_results.append({
                                                    "success": True,
                                                    "function": func_name,
                                                    "contract": check_name,
                                                    "address": check_address,
                                                    "raw_int": result_int,
                                                    "rif_value": result_rif,
                                                    "formatted": f"{result_rif:,.0f} RIF",
                                                    "matches_moda_expected": matches_moda
                                                })
                                    except Exception:
                                        pass  # Skip functions that fail
                            except Exception as e:
                                print(f"      ⚠️  Could not query functions: {e}")
                        else:
                            print(f"   Showing first 20 functions:")
                            for func in functions[:20]:
                                name = func.get("name", "unknown")
                                state = func.get("stateMutability", "")
                                outputs = func.get("outputs", [])
                                print(f"      {name}() [{state}] -> {outputs}")
                            if len(functions) > 20:
                                print(f"      ... and {len(functions) - 20} more")
                
                # Try querying MODA-related functions found in ABI
                if moda_related:
                    print(f"\n   🔍 Trying to query MODA-related functions...")
                    provider_addresses = {}
                    
                    for func in moda_related:
                        func_name = func.get("name", "")
                        outputs = func.get("outputs", [])
                        return_type = outputs[0].get("type", "") if outputs else ""
                        
                        try:
                            contract = w3.eth.contract(
                                address=Web3.to_checksum_address(check_address),
                                abi=abi
                            )
                            func_obj = getattr(contract.functions, func_name)
                            result_value = func_obj().call()
                            
                            # Handle different return types
                            if isinstance(result_value, (int,)):
                                result_int = result_value
                                result_rif = result_int / 10**18
                                matches = result_int == EXPECTED_MODA_RAW
                                
                                print(f"      ✅ {func_name}() = {result_int:,} ({result_rif:,.0f} RIF)")
                                if matches:
                                    print(f"         🎯 MATCHES EXPECTED MODA!")
                                
                                all_successful_results.append({
                                    "success": True,
                                    "function": func_name,
                                    "contract": check_name,
                                    "address": check_address,
                                    "raw_int": result_int,
                                    "rif_value": result_rif,
                                    "formatted": f"{result_rif:,.0f} RIF",
                                    "matches_moda_expected": matches
                                })
                            elif "address" in return_type.lower() and isinstance(result_value, str):
                                # This is a provider address - store it to query later
                                provider_addresses[func_name] = result_value
                                print(f"      📍 {func_name}() = {result_value} (provider address)")
                        except Exception as e:
                            print(f"      ⚠️  {func_name}(): {str(e)[:100]}")
                    
                    # Query provider contracts if found
                    if provider_addresses:
                        print(f"\n   🔍 Found {len(provider_addresses)} provider address(es), querying them for MODA/AMTA...")
                        for provider_name, provider_addr in provider_addresses.items():
                            if provider_addr and provider_addr != "0x0000000000000000000000000000000000000000":
                                print(f"\n      Checking provider: {provider_name} -> {provider_addr}")
                                
                                # Fetch provider contract ABI
                                provider_abi = fetch_contract_abi(w3, provider_addr)
                                if provider_abi:
                                    print(f"         ✅ Fetched provider ABI ({len(provider_abi)} items)")
                                    
                                    # Try querying common function names on provider
                                    provider_functions = [item for item in provider_abi if item.get("type") == "function"]
                                    for pfunc in provider_functions:
                                        pfunc_name = pfunc.get("name", "").lower()
                                        if any(kw in pfunc_name for kw in ["moda", "amta", "df", "value", "get", "read"]):
                                            try:
                                                provider_contract = w3.eth.contract(
                                                    address=Web3.to_checksum_address(provider_addr),
                                                    abi=provider_abi
                                                )
                                                pfunc_obj = getattr(provider_contract.functions, pfunc.get("name"))
                                                presult = pfunc_obj().call()
                                                
                                                if isinstance(presult, (int,)):
                                                    prif = presult / 10**18
                                                    matches = presult == EXPECTED_MODA_RAW
                                                    print(f"         ✅ {pfunc.get('name')}() = {presult:,} ({prif:,.0f} RIF)")
                                                    if matches:
                                                        print(f"            🎯 MATCHES EXPECTED MODA!")
                                                    
                                                    all_successful_results.append({
                                                        "success": True,
                                                        "function": f"{provider_name}->{pfunc.get('name')}",
                                                        "contract": f"{check_name} (via {provider_name})",
                                                        "address": provider_addr,
                                                        "raw_int": presult,
                                                        "rif_value": prif,
                                                        "formatted": f"{prif:,.0f} RIF",
                                                        "matches_moda_expected": matches
                                                    })
                                            except Exception:
                                                pass
                                else:
                                    print(f"         ⚠️  Could not fetch provider ABI")
                
                result = query_with_abi(w3, check_address, abi)
                
                if result and result.get("success"):
                    all_successful_results.append({
                        **result,
                        "contract": check_name,
                        "address": check_address
                    })
                    print(f"\n🎉 SUCCESS! Found MODA parameter:")
                    print(f"   Contract: {check_name}")
                    print(f"   Function: {result['function']}")
                    print(f"   Raw Value: {result['raw_int']:,}")
                    print(f"   Formatted: {result['formatted']}")
                    
                    if result.get("matches_moda_expected"):
                        print("   ✅ Value matches expected MODA (200,000 RIF)")
                    else:
                        print(f"   ⚠️  Value differs from expected ({EXPECTED_MODA_DISPLAY})")
                    
                    if result.get("all_params"):
                        print("\n   All Flux Capacitor Parameters:")
                        params = result["all_params"]
                        if params.get("amta"):
                            print(f"     AMTA: {params['amta']:,.0f} RIF")
                        print(f"     MODA: {params['moda']:,.0f} RIF")
                        if params.get("df"):
                            print(f"     DF: {params['df']:,} blocks")
                elif not moda_related:
                    print("   ❌ Could not find MODA using ABI")
            else:
                print("   ⚠️  Could not fetch ABI or ABI is empty")
            
            # Method 2: Try direct function calls
            print(f"\n🔧 METHOD 2: Direct Function Calls")
            for func_sig in FUNCTION_SIGNATURES:
                result = try_query_function(w3, check_address, func_sig)
                
                if result and result.get("success"):
                    all_successful_results.append({
                        **result,
                        "contract": check_name,
                        "address": check_address
                    })
                    print(f"   ✅ {func_sig}:")
                    print(f"      Selector: {result['selector']}")
                    print(f"      Value: {result['formatted']}")
                    if result.get("matches_moda_expected"):
                        print(f"      🎯 MATCHES EXPECTED MODA!")
                elif result:
                    # Only show errors for functions that might be MODA
                    if "moda" in func_sig.lower():
                        print(f"   ⚠️  {func_sig}: {result.get('error', 'Unknown error')}")
    
    # Final summary
    print("\n" + "=" * 80)
    print("FINAL SUMMARY")
    print("=" * 80)
    
    if all_successful_results:
        print(f"\n✅ Found {len(all_successful_results)} successful result(s):")
        for result in all_successful_results:
            contract = result.get("contract", "Unknown")
            func = result.get("function", "unknown")
            value = result.get("formatted", "N/A")
            is_moda = result.get("matches_moda_expected", False)
            marker = "🎯 MODA" if is_moda else "   "
            print(f"{marker} {contract} -> {func}() = {value}")
        
        # Find MODA
        moda_result = next((r for r in all_successful_results if r.get('matches_moda_expected')), None)
        if moda_result:
            print(f"\n🎉 CONFIRMED: MODA found!")
            print(f"   Contract: {moda_result['contract']}")
            print(f"   Address: {moda_result.get('address', 'N/A')}")
            print(f"   Function: {moda_result['function']}()")
            if moda_result.get("selector"):
                print(f"   Selector: {moda_result['selector']}")
            print(f"\n   Implementation:")
            print(f"   ```typescript")
            print(f"   const modaResult = await queryOptionalMetric(")
            print(f"     provider,")
            print(f"     '{moda_result.get('address', 'CONTRACT_ADDRESS')}',")
            print(f"     MOC_CORE_ABI, // or appropriate ABI")
            print(f"     async (contract) => await contract.{moda_result['function']}(),")
            print(f"     STANDARD_DECIMALS")
            print(f"   )")
            print(f"   ```")
        else:
            print("\n⚠️  None of the results matched expected MODA value")
            print("   Check if the expected value is correct or if MODA has changed")
    else:
        print("\n❌ No functions returned successful results")
        print("\n💡 Recommendations:")
        print("   1. Verify contract addresses are correct")
        print("   2. Check if contracts are verified on Blockscout")
        print("   3. Review contract source code for exact function names")
        print("   4. MODA might be in a different contract (Flux Capacitor contract?)")
        print("   5. Try querying storage slots directly if function doesn't exist")
    
    print("\n" + "=" * 80)


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
