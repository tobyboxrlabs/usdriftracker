#!/usr/bin/env python3
"""
Interrogate BTC Vault contracts to discover ABIs, events, and structure.
This script fetches ABIs from Blockscout testnet and analyzes contract structure.
"""

import sys
import json
import requests
from typing import Dict, List, Optional, Any
from collections import defaultdict

# BTC Vault Contracts (RSK Testnet)
BTC_VAULT_CONTRACTS = {
    "BufferImpl": "0x1c769e16c0E9a801DF79ACaaA33B9DeE2d092705",
    "BufferProxy": "0xF7930654CE9ef043B1FA2Fd51b4A2B1C8b4f6F9a",
    "PermissionsManagerImpl": "0x549945384AefB50E4Fc8A16068870dad05Ab02f9",
    "PermissionsManagerProxy": "0xFA4F19443ec119dBC8fD913aE0902e924fb4266E",
    "RBTCAsyncVaultImpl": "0x08B43Ed82Eb069C6545ecD5b74Bb43bAdD58C6ED",
    "RBTCAsyncVaultProxy": "0x7B7308f5147e80d23f58DaE2A01BCcAF8Aa0C4F1",
    "SyntheticYieldImpl": "0xf7A8AC8e005cdD62462a899910a5a7F0A8e79bBe",
    "SyntheticYieldProxy": "0x85f9204F1A0317Eb398918f553205e1558d15Cb9"
}

# Blockscout API endpoint for RSK Testnet
BLOCKSCOUT_API_BASE = "https://rootstock-testnet.blockscout.com/api"

# SECURITY NOTE: These URLs are hardcoded to prevent SSRF attacks.
# DO NOT modify this script to accept user-provided URLs without
# implementing proper URL validation and allowlisting.


def fetch_contract_abi(contract_address: str) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch contract ABI from Blockscout API
    
    Args:
        contract_address: Contract address to fetch ABI for
        
    Returns:
        ABI as list of dictionaries, or None if failed
    """
    url = f"{BLOCKSCOUT_API_BASE}?module=contract&action=getabi&address={contract_address}"
    
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        data = response.json()
        
        if data.get("status") == "1" and data.get("result"):
            abi_json = data["result"]
            if isinstance(abi_json, str):
                return json.loads(abi_json)
            return abi_json
        else:
            print(f"   ⚠️  API returned: {data.get('message', 'Unknown error')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Network error: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"   ❌ JSON decode error: {e}")
        return None
    except Exception as e:
        print(f"   ❌ Unexpected error: {e}")
        return None


def analyze_abi(abi: List[Dict[str, Any]], contract_name: str) -> Dict[str, Any]:
    """
    Analyze ABI to extract events, functions, and structure
    
    Args:
        abi: Contract ABI
        contract_name: Name of the contract
        
    Returns:
        Dictionary with analysis results
    """
    events = []
    functions = []
    functions_by_type = defaultdict(list)
    
    for item in abi:
        item_type = item.get("type", "")
        name = item.get("name", "")
        
        if item_type == "event":
            events.append(item)
        elif item_type == "function":
            functions.append(item)
            state_mutability = item.get("stateMutability", "unknown")
            functions_by_type[state_mutability].append(item)
    
    return {
        "contract_name": contract_name,
        "total_items": len(abi),
        "events": events,
        "functions": functions,
        "functions_by_type": dict(functions_by_type),
        "event_count": len(events),
        "function_count": len(functions)
    }


def calculate_event_signature(event: Dict[str, Any]) -> str:
    """
    Calculate event signature hash (topic0)
    
    Args:
        event: Event ABI item
        
    Returns:
        Event signature string (e.g., "Transfer(address,address,uint256)")
    """
    name = event.get("name", "")
    inputs = event.get("inputs", [])
    
    # Build signature: EventName(type1,type2,...)
    param_types = [inp.get("type", "") for inp in inputs]
    signature = f"{name}({','.join(param_types)})"
    
    return signature


def analyze_events(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyze events to categorize them
    
    Args:
        events: List of event ABI items
        
    Returns:
        Dictionary with categorized events
    """
    categorized = defaultdict(list)
    
    for event in events:
        name = name_lower = event.get("name", "").lower()
        signature = calculate_event_signature(event)
        inputs = event.get("inputs", [])
        
        # Categorize by keywords
        category = "Other"
        
        if any(kw in name_lower for kw in ["deposit", "deposited", "depositing"]):
            category = "Deposit"
        elif any(kw in name_lower for kw in ["withdraw", "withdrawn", "withdrawing", "redeem"]):
            category = "Withdrawal"
        elif any(kw in name_lower for kw in ["yield", "reward", "interest", "synthetic"]):
            category = "Yield"
        elif any(kw in name_lower for kw in ["buffer", "buffered"]):
            category = "Buffer"
        elif any(kw in name_lower for kw in ["transfer", "sent", "received"]):
            category = "Transfer"
        elif any(kw in name_lower for kw in ["approval", "approve", "allow"]):
            category = "Approval"
        elif any(kw in name_lower for kw in ["permission", "role", "access", "grant", "revoke"]):
            category = "Permission"
        elif any(kw in name_lower for kw in ["paused", "pause", "unpause"]):
            category = "Pause"
        elif any(kw in name_lower for kw in ["upgrade", "upgraded"]):
            category = "Upgrade"
        elif any(kw in name_lower for kw in ["admin", "owner", "governance"]):
            category = "Admin"
        
        categorized[category].append({
            "name": event.get("name", ""),
            "signature": signature,
            "inputs": inputs,
            "indexed": [inp.get("indexed", False) for inp in inputs]
        })
    
    return dict(categorized)


def print_analysis(analysis: Dict[str, Any], event_analysis: Dict[str, Any]):
    """
    Print formatted analysis results
    
    Args:
        analysis: Contract analysis results
        event_analysis: Event categorization results
    """
    contract_name = analysis["contract_name"]
    print(f"\n{'=' * 80}")
    print(f"Contract: {contract_name}")
    print(f"{'=' * 80}")
    
    print(f"\n📊 Summary:")
    print(f"   Total ABI Items: {analysis['total_items']}")
    print(f"   Events: {analysis['event_count']}")
    print(f"   Functions: {analysis['function_count']}")
    
    # Functions by type
    funcs_by_type = analysis["functions_by_type"]
    if funcs_by_type:
        print(f"\n🔧 Functions by Type:")
        for func_type, funcs in sorted(funcs_by_type.items()):
            print(f"   {func_type}: {len(funcs)}")
    
    # Events by category
    if event_analysis:
        print(f"\n📋 Events by Category:")
        for category, events in sorted(event_analysis.items()):
            print(f"   {category}: {len(events)}")
            for event in events[:5]:  # Show first 5
                indexed_count = sum(event["indexed"])
                inputs_count = len(event["inputs"])
                print(f"      - {event['name']} ({indexed_count} indexed, {inputs_count} params)")
            if len(events) > 5:
                print(f"      ... and {len(events) - 5} more")
    
    # Show all event signatures
    if analysis["events"]:
        print(f"\n📝 All Event Signatures:")
        for event in analysis["events"]:
            signature = calculate_event_signature(event)
            indexed_params = [inp for inp in event.get("inputs", []) if inp.get("indexed", False)]
            indexed_count = len(indexed_params)
            print(f"   {event.get('name', 'Unknown')}")
            print(f"      Signature: {signature}")
            print(f"      Indexed params: {indexed_count}")
            if indexed_params:
                print(f"      Indexed: {', '.join([inp.get('name', '') + ':' + inp.get('type', '') for inp in indexed_params])}")
            print()


def check_proxy_implementation(contract_address: str) -> Optional[str]:
    """
    Check if contract is a proxy and get implementation address
    Uses EIP-1967 storage slot
    
    Args:
        contract_address: Contract address to check
        
    Returns:
        Implementation address if proxy, None otherwise
    """
    # This would require web3 connection - skipping for now
    # Can be added if needed
    return None


def main():
    """Main interrogation function"""
    print("=" * 80)
    print("BTC Vault Contracts Interrogation")
    print("Network: RSK Testnet")
    print("=" * 80)
    
    print(f"\n📋 Contracts to analyze: {len(BTC_VAULT_CONTRACTS)}")
    for name, address in BTC_VAULT_CONTRACTS.items():
        print(f"   {name}: {address}")
    
    results = {}
    all_events = defaultdict(list)
    
    print(f"\n🔍 Fetching ABIs from Blockscout...")
    print(f"   API: {BLOCKSCOUT_API_BASE}")
    
    for contract_name, contract_address in BTC_VAULT_CONTRACTS.items():
        print(f"\n📦 {contract_name} ({contract_address})")
        print(f"   Fetching ABI...")
        
        abi = fetch_contract_abi(contract_address)
        
        if abi:
            print(f"   ✅ Fetched ABI ({len(abi)} items)")
            
            # Analyze ABI
            analysis = analyze_abi(abi, contract_name)
            event_analysis = analyze_events(analysis["events"])
            
            # Store results
            results[contract_name] = {
                "address": contract_address,
                "analysis": analysis,
                "event_analysis": event_analysis,
                "abi": abi  # Store full ABI for later use
            }
            
            # Collect all events
            for event in analysis["events"]:
                all_events[contract_name].append({
                    "name": event.get("name", ""),
                    "signature": calculate_event_signature(event),
                    "inputs": event.get("inputs", [])
                })
            
            # Print analysis
            print_analysis(analysis, event_analysis)
        else:
            print(f"   ❌ Failed to fetch ABI")
            results[contract_name] = {
                "address": contract_address,
                "error": "Failed to fetch ABI"
            }
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    successful = [name for name, data in results.items() if "analysis" in data]
    failed = [name for name, data in results.items() if "error" in data]
    
    print(f"\n✅ Successfully analyzed: {len(successful)}/{len(BTC_VAULT_CONTRACTS)}")
    for name in successful:
        event_count = results[name]["analysis"]["event_count"]
        func_count = results[name]["analysis"]["function_count"]
        print(f"   {name}: {event_count} events, {func_count} functions")
    
    if failed:
        print(f"\n❌ Failed: {len(failed)}")
        for name in failed:
            print(f"   {name}")
    
    # Event summary
    print(f"\n📊 Event Summary by Category:")
    category_counts = defaultdict(int)
    for contract_name, data in results.items():
        if "event_analysis" in data:
            for category, events in data["event_analysis"].items():
                category_counts[category] += len(events)
    
    for category, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"   {category}: {count} event(s)")
    
    # Save results to JSON
    output_file = "btc_vault_contracts_analysis.json"
    print(f"\n💾 Saving results to {output_file}...")
    
    # Prepare JSON-serializable results (remove ABI for now to keep file size manageable)
    json_results = {}
    for name, data in results.items():
        json_results[name] = {
            "address": data["address"],
            "analysis": data.get("analysis", {}),
            "event_analysis": data.get("event_analysis", {}),
            "error": data.get("error")
        }
        # Remove full ABI from JSON (too large)
        # Can be fetched again if needed
    
    try:
        with open(output_file, "w") as f:
            json.dump(json_results, f, indent=2)
        print(f"   ✅ Saved to {output_file}")
    except Exception as e:
        print(f"   ❌ Failed to save: {e}")
    
    # Generate TypeScript/JavaScript event signatures
    print(f"\n📝 Event Signatures for TypeScript:")
    print(f"   // Event topic hashes (keccak256 of signature)")
    print(f"   // Use ethers.utils.id('EventName(type1,type2)') to calculate")
    print()
    
    for contract_name, events in all_events.items():
        if events:
            print(f"   // {contract_name}")
            for event in events:
                print(f"   // {event['name']}: {event['signature']}")
            print()
    
    print("\n" + "=" * 80)
    print("Interrogation Complete")
    print("=" * 80)
    print("\n💡 Next Steps:")
    print("   1. Review the analysis above")
    print("   2. Check btc_vault_contracts_analysis.json for detailed data")
    print("   3. Identify which events are most relevant for analysers")
    print("   4. Design unified event data structure")
    print("   5. Implement analyser component")


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
