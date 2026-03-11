#!/usr/bin/env python3
"""
Bitcoin Block Scanner for Rootstock Merged-Mining Tags
Scans the last N blocks for RSKBLOCK: tags in coinbase transactions
"""

import json
import sys
import time
from dataclasses import dataclass, asdict
from typing import Optional
import requests

# SECURITY NOTE: This URL is hardcoded to prevent SSRF attacks.
# DO NOT modify this script to accept user-provided URLs without
# implementing proper URL validation and allowlisting.
BASE_URL = "https://mempool.space"
TAG = b"RSKBLOCK:"  # Rootstock merged-mining tag

# Create session with user agent and disable proxy
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "rsk-block-scanner/1.0"})
# Disable proxy usage to avoid proxy-related connection issues
SESSION.proxies = {
    "http": None,
    "https": None,
}


@dataclass
class BlockScanResult:
    """Result of scanning a single block for RSK tag"""
    height: int
    block_hash: str
    timestamp: int
    coinbase_txid: str
    has_rsk_tag: bool
    tag_offset: Optional[int] = None
    payload_preview_hex: Optional[str] = None


def http_get(path: str, timeout: float = 15.0) -> requests.Response:
    """Make HTTP GET request with retry logic for rate limiting"""
    url = BASE_URL.rstrip("/") + path
    
    for attempt in range(5):
        try:
            r = SESSION.get(url, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                sleep_s = 0.5 * (2 ** attempt)
                print(f"  Rate limited or server error ({r.status_code}), retrying in {sleep_s:.1f}s...", file=sys.stderr)
                time.sleep(sleep_s)
                continue
            r.raise_for_status()
            return r
        except requests.exceptions.RequestException as e:
            if attempt == 4:
                raise
            sleep_s = 0.5 * (2 ** attempt)
            print(f"  Request error, retrying in {sleep_s:.1f}s...", file=sys.stderr)
            time.sleep(sleep_s)
    
    r.raise_for_status()
    return r


# Rate limiting delay between API calls (ms)
API_CALL_DELAY = 0.2  # 200ms delay between calls

def get_tip_height() -> int:
    """Get the current Bitcoin blockchain tip height"""
    result = int(http_get("/api/blocks/tip/height").text.strip())
    time.sleep(API_CALL_DELAY)
    return result


def get_block_hash(height: int) -> str:
    """Get block hash for a given height"""
    result = http_get(f"/api/block-height/{height}").text.strip()
    time.sleep(API_CALL_DELAY)
    return result


def get_block_info(block_hash: str) -> dict:
    """Get block metadata (includes timestamp)"""
    result = http_get(f"/api/block/{block_hash}").json()
    time.sleep(API_CALL_DELAY)
    return result

def get_block_txid(block_hash: str, index: int) -> str:
    """Get transaction ID at given index in block (0 = coinbase)"""
    result = http_get(f"/api/block/{block_hash}/txid/{index}").text.strip()
    time.sleep(API_CALL_DELAY)
    return result


def get_tx_json(txid: str) -> dict:
    """Get transaction JSON data"""
    result = http_get(f"/api/tx/{txid}").json()
    time.sleep(API_CALL_DELAY)
    return result


def validate_hex_string(hex_str: str, expected_length: Optional[int] = None) -> bool:
    """
    Validate hex string format to prevent injection attacks
    
    Args:
        hex_str: String to validate
        expected_length: Optional expected length (without '0x' prefix)
    
    Returns:
        True if valid hex string, False otherwise
    """
    if not hex_str or not isinstance(hex_str, str):
        return False
    # Remove '0x' prefix if present
    clean_hex = hex_str[2:] if hex_str.startswith('0x') else hex_str
    # Check if all characters are valid hex digits
    if not all(c in '0123456789abcdefABCDEF' for c in clean_hex):
        return False
    # Check length if specified
    if expected_length and len(clean_hex) != expected_length:
        return False
    return True


def validate_block_number(block_num: int) -> bool:
    """
    Validate block number is reasonable to prevent DoS attacks
    
    Args:
        block_num: Block number to validate
    
    Returns:
        True if valid, False otherwise
    """
    return isinstance(block_num, int) and 0 <= block_num <= 10_000_000  # Reasonable upper bound


def find_rsk_tag_in_hex(hex_str: str, tag: bytes = TAG) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Search for RSKBLOCK: tag in hex-encoded scriptSig
    
    Returns:
        (found: bool, offset: Optional[int], preview_hex: Optional[str])
    """
    if not hex_str:
        return False, None, None
    
    # Validate hex string format
    if not validate_hex_string(hex_str.replace('0x', '')):
        return False, None, None
    
    try:
        raw_bytes = bytes.fromhex(hex_str.replace('0x', ''))
    except ValueError:
        return False, None, None
    
    # Search for the tag
    idx = raw_bytes.find(tag)
    if idx == -1:
        return False, None, None
    
    # Extract preview of next 64 bytes after the tag
    after_start = idx + len(tag)
    after_end = min(after_start + 64, len(raw_bytes))
    preview = raw_bytes[after_start:after_end]
    
    return True, idx, preview.hex()


def scan_block(height: int) -> BlockScanResult:
    """Scan a single block for RSK merged-mining tag"""
    # Validate block height
    if not validate_block_number(height):
        raise ValueError(f"Invalid block height: {height}")
    
    # Get block hash
    block_hash = get_block_hash(height)
    
    # Validate block hash format (should be 64 hex characters)
    if not validate_hex_string(block_hash, expected_length=64):
        raise ValueError(f"Invalid block hash format: {block_hash}")
    
    # Get block info (includes timestamp)
    block_info = get_block_info(block_hash)
    timestamp = block_info.get("timestamp", 0)
    
    # Get coinbase transaction ID (index 0)
    coinbase_txid = get_block_txid(block_hash, 0)
    
    # Get coinbase transaction
    tx = get_tx_json(coinbase_txid)
    
    # Extract coinbase scriptSig from vin[0]
    vin = tx.get("vin", [])
    if not vin:
        raise ValueError(f"Transaction {coinbase_txid} has no inputs")
    
    vin0 = vin[0]
    if not vin0.get("is_coinbase", False):
        raise ValueError(f"First input of {coinbase_txid} is not coinbase")
    
    # Get scriptSig (Esplora API uses "scriptsig" field)
    scriptsig_hex = vin0.get("scriptsig", "")
    if not scriptsig_hex:
        # Try alternative field name
        scriptsig_hex = vin0.get("scriptSig", {}).get("hex", "")
    
    # Search for RSK tag
    has_tag, offset, preview_hex = find_rsk_tag_in_hex(scriptsig_hex, TAG)
    
    return BlockScanResult(
        height=height,
        block_hash=block_hash,
        timestamp=timestamp,
        coinbase_txid=coinbase_txid,
        has_rsk_tag=has_tag,
        tag_offset=offset,
        payload_preview_hex=preview_hex,
    )


def scan_last_n_blocks(n: int = 5) -> list[BlockScanResult]:
    """Scan the last N blocks for RSK tags"""
    print(f"Fetching tip height...")
    tip_height = get_tip_height()
    print(f"Current tip height: {tip_height}\n")
    
    start_height = max(0, tip_height - n + 1)
    results = []
    
    print(f"Scanning blocks {start_height} to {tip_height} for RSKBLOCK: tags...\n")
    
    for height in range(start_height, tip_height + 1):
        try:
            print(f"Scanning block {height}...", end=" ", flush=True)
            result = scan_block(height)
            results.append(result)
            
            if result.has_rsk_tag:
                print(f"✓ RSK TAG FOUND at offset {result.tag_offset}")
                print(f"  Block hash: {result.block_hash}")
                print(f"  Coinbase txid: {result.coinbase_txid}")
                print(f"  Payload preview: {result.payload_preview_hex}")
            else:
                print("✗ No RSK tag")
            
            # Additional delay after processing each block (already have delays in API calls)
            # This ensures we don't hit rate limits even with multiple API calls per block
            
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            # Continue with next block even if one fails
            continue
    
    return results


def main():
    """Main entry point"""
    num_blocks = 5
    MAX_BLOCKS = 1000  # Maximum blocks to prevent DoS attacks
    
    # Allow override via command line argument
    if len(sys.argv) > 1:
        try:
            num_blocks = int(sys.argv[1])
            # Validate bounds to prevent DoS attacks
            if num_blocks < 1:
                print(f"Error: num_blocks must be >= 1", file=sys.stderr)
                print(f"Usage: {sys.argv[0]} [num_blocks]", file=sys.stderr)
                print(f"  num_blocks: Number of blocks to scan (default: 5, max: {MAX_BLOCKS})", file=sys.stderr)
                sys.exit(1)
            if num_blocks > MAX_BLOCKS:
                print(f"Error: num_blocks exceeds maximum of {MAX_BLOCKS}", file=sys.stderr)
                print(f"Usage: {sys.argv[0]} [num_blocks]", file=sys.stderr)
                print(f"  num_blocks: Number of blocks to scan (default: 5, max: {MAX_BLOCKS})", file=sys.stderr)
                sys.exit(1)
        except ValueError:
            print(f"Usage: {sys.argv[0]} [num_blocks]", file=sys.stderr)
            print(f"  num_blocks: Number of blocks to scan (default: 5, max: {MAX_BLOCKS})", file=sys.stderr)
            sys.exit(1)
    
    try:
        results = scan_last_n_blocks(num_blocks)
        
        # Summary
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)
        
        total = len(results)
        hits = sum(1 for r in results if r.has_rsk_tag)
        
        print(f"Blocks scanned: {total}")
        print(f"Blocks with RSK tag: {hits}")
        print(f"Percentage: {(hits/total*100):.2f}%" if total > 0 else "N/A")
        
        if hits > 0:
            print("\nBlocks with RSK tags:")
            for r in results:
                if r.has_rsk_tag:
                    print(f"  Height {r.height}: {r.block_hash}")
                    print(f"    Coinbase: {r.coinbase_txid}")
                    print(f"    Tag offset: {r.tag_offset}")
                    print(f"    Payload: {r.payload_preview_hex}")
        
        # Output JSON for programmatic use
        print("\n" + "="*60)
        print("JSON OUTPUT")
        print("="*60)
        print(json.dumps([asdict(r) for r in results], indent=2))
        
    except KeyboardInterrupt:
        print("\n\nInterrupted by user", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nFatal error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
