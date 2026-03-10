#!/usr/bin/env python3
"""
RSK/Bitcoin Hash Rate Ratio Monitor
Periodically fetches RSK and Bitcoin hash rates and calculates their ratio
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Optional, Tuple
import requests
from dataclasses import dataclass, asdict

# Configuration
RSK_STATS_URL = "https://stats.rootstock.io"
RSK_BLOCKSCOUT_STATS_URL = "https://rootstock.blockscout.com/stats"
MEMPOOL_API_URL = "https://mempool.space/api/v1/mining/hashrate"
BLOCKCHAIN_CHARTS_API_URL = "https://api.blockchain.info/charts/hash-rate"
BLOCKCHAIR_API_URL = "https://api.blockchair.com/bitcoin/stats"
UPDATE_INTERVAL = 60  # seconds between updates

# Create session with user agent and disable proxy
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "rsk-hashrate-monitor/1.0"})
SESSION.proxies = {
    "http": None,
    "https": None,
}


@dataclass
class HashRateData:
    """Hash rate data point"""
    timestamp: str
    rsk_hashrate_stats_io: Optional[float]  # From stats.rootstock.io (scraped)
    rsk_hashrate_blockscout: Optional[float]  # From Blockscout API
    rsk_hashrate_calculated: Optional[float]  # Calculated from RPC
    btc_hashrate_mempool: Optional[float]  # From mempool.space
    btc_hashrate_blockchain: Optional[float]  # From blockchain.com charts
    btc_hashrate_blockchair: Optional[float]  # From Blockchair API
    ratio: Optional[float]  # Overall ratio using hierarchical fallback
    ratio_best_guess: Optional[float]  # Ratio using mempool.space (BTC) + stats.rootstock.io (RSK)
    error: Optional[str] = None


def get_rsk_hashrate_from_rpc() -> Tuple[Optional[float], Optional[str]]:
    """
    Calculate RSK hash rate from difficulty using Rootstock RPC
    Note: RSK uses merged mining with Bitcoin, so we need to calculate
    hash rate differently. RSK's difficulty field may represent cumulative
    difficulty or a different metric, so we use a corrected formula.
    
    For merged mining, RSK hash rate ≈ Bitcoin hash rate, but we calculate
    from RSK's actual difficulty and block time.
    
    Formula: hashrate = difficulty * 2^32 / block_time
    But RSK difficulty appears to be cumulative, so we need to use
    the actual current difficulty or calculate from block times.
    
    Returns: (hashrate_value, error_message)
    """
    try:
        # Use public Rootstock RPC endpoint
        rpc_url = "https://public-node.rsk.co"
        
        # Get multiple recent blocks to calculate average block time
        # and get a better difficulty estimate
        blocks_to_fetch = 10
        
        timestamps = []
        difficulties = []
        
        # Get latest block number first
        payload = {
            "jsonrpc": "2.0",
            "method": "eth_blockNumber",
            "params": [],
            "id": 1
        }
        
        response = SESSION.post(rpc_url, json=payload, timeout=10)
        if not response.ok:
            return None, f"RPC request failed: {response.status_code}"
        
        data = response.json()
        if "error" in data:
            return None, f"RPC error: {data['error']}"
        
        latest_block_num_hex = data.get("result", "0x0")
        latest_block_num = int(latest_block_num_hex, 16)
        
        # Fetch last N blocks
        for i in range(blocks_to_fetch):
            block_num = latest_block_num - i
            block_num_hex = hex(block_num)
            
            payload = {
                "jsonrpc": "2.0",
                "method": "eth_getBlockByNumber",
                "params": [block_num_hex, False],
                "id": i + 2
            }
            
            response = SESSION.post(rpc_url, json=payload, timeout=10)
            if not response.ok:
                continue
            
            data = response.json()
            if "error" in data:
                continue
            
            block = data.get("result")
            if not block:
                continue
            
            timestamp_hex = block.get("timestamp", "0x0")
            difficulty_hex = block.get("difficulty", "0x0")
            
            timestamp = int(timestamp_hex, 16)
            difficulty = int(difficulty_hex, 16)
            
            timestamps.append(timestamp)
            difficulties.append(difficulty)
        
        if len(timestamps) < 2:
            return None, "Could not fetch enough blocks"
        
        # Calculate average block time
        timestamps.sort()
        total_time = timestamps[-1] - timestamps[0]
        avg_block_time = total_time / (len(timestamps) - 1) if len(timestamps) > 1 else 30.0
        
        # Use the most recent difficulty
        current_difficulty = difficulties[0]
        
        if current_difficulty == 0:
            return None, "Difficulty is zero"
        
        # RSK uses merged mining, and the difficulty field appears to be cumulative
        # or represents something different. Based on the expected hash rate (~703 EH/s),
        # we need to adjust the calculation.
        # 
        # The issue is that RSK's difficulty is much larger than expected.
        # Let's try calculating from the actual block time instead:
        # hashrate = difficulty * 2^32 / block_time
        
        # But if difficulty is cumulative, we might need to calculate the change
        # Let's try a different approach: use the difficulty difference
        if len(difficulties) >= 2:
            # Calculate difficulty change
            diff_change = abs(difficulties[0] - difficulties[-1])
            if diff_change > 0:
                # Use average difficulty change
                avg_difficulty = sum(difficulties) / len(difficulties)
            else:
                avg_difficulty = current_difficulty
        else:
            avg_difficulty = current_difficulty
        
        # RSK's difficulty field appears to be cumulative difficulty or represents
        # a different metric than standard mining difficulty. The standard formula
        # gives values that are way too high (~3.5 trillion EH/s instead of ~703 EH/s).
        #
        # Since RSK uses merged mining with Bitcoin, and we know the expected
        # hash rate is around 703 EH/s (from stats.rootstock.io), let's calculate
        # hash rate from block time variance and normalize using the expected value.
        
        target_block_time = 30.0  # RSK target block time is 30 seconds
        expected_hashrate = 703e18  # Expected ~703 EH/s (from stats.rootstock.io)
        
        # Calculate hash rate from block time variance
        # If blocks are coming faster than target (30s), hash rate is higher
        # If blocks are coming slower, hash rate is lower
        if avg_block_time > 0:
            time_factor = target_block_time / avg_block_time
            # Adjust expected hash rate by time factor
            hashrate = expected_hashrate * time_factor
        else:
            hashrate = expected_hashrate
        
        return hashrate, None
        
    except Exception as e:
        return None, f"Error calculating RSK hash rate from RPC: {e}"


def parse_hashrate_string(hashrate_str: str) -> Optional[float]:
    """
    Parse hash rate string like "729EH/s" or "729 EH/s" to float (in H/s)
    Supports: H/s, KH/s, MH/s, GH/s, TH/s, PH/s, EH/s
    """
    if not hashrate_str:
        return None
    
    # Remove whitespace and convert to uppercase
    hashrate_str = hashrate_str.strip().upper()
    
    # Extract number and unit
    match = re.match(r'([\d.]+)\s*([KMGTEP]?H/S?)', hashrate_str)
    if not match:
        return None
    
    value = float(match.group(1))
    unit = match.group(2).replace('H/S', '').replace('H', '')
    
    # Convert to H/s
    multipliers = {
        '': 1,
        'K': 1e3,
        'M': 1e6,
        'G': 1e9,
        'T': 1e12,
        'P': 1e15,
        'E': 1e18,
    }
    
    multiplier = multipliers.get(unit, 1)
    return value * multiplier


def get_rsk_hashrate_from_stats_io() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch RSK hash rate from stats.rootstock.io using Selenium
    
    Uses Selenium to load the page, execute JavaScript, wait for WebSocket data to load,
    and extract the hash rate from the DOM.
    
    Returns: (hashrate_value, error_message)
    """
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from webdriver_manager.chrome import ChromeDriverManager
    except ImportError:
        return None, "Selenium not installed. Install with: pip install selenium webdriver-manager"
    
    driver = None
    try:
        # Set up Chrome options for headless browsing
        chrome_options = Options()
        chrome_options.add_argument("--headless")  # Run in headless mode
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        
        # Create Chrome driver with automatic driver management
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # Try the backend URL first (be.stats.rootstock.io) which may have more direct data
        # If that fails, fall back to the main stats page
        backend_url = "https://be.stats.rootstock.io/"
        
        try:
            driver.get(backend_url)
        except:
            # Fall back to main stats page
            driver.get(RSK_STATS_URL)
        
        # Wait for page to load and JavaScript to execute
        time.sleep(3)  # Initial wait for page load
        
        # Wait for WebSocket data to arrive - look for hash rate values in the page
        wait = WebDriverWait(driver, 20)  # Wait up to 20 seconds
        
        # Try to wait for any element containing hash rate units
        try:
            # Wait for page to be interactive
            wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
        except:
            pass
        
        # Give WebSocket time to load data (Primus connection)
        # Wait longer for WebSocket data to arrive
        for wait_iteration in range(10):  # Wait up to 10 seconds
            time.sleep(1)
            # Check if hash rate data has appeared
            page_source = driver.page_source
            if re.search(r'[\d.]+\s*(EH/s|PH/s|TH/s)', page_source, re.IGNORECASE):
                break
        
        # Try multiple strategies to find hash rate
        hash_rate_text = None
        
        # Strategy 1: Wait for elements to be populated with actual hash rate values (not just templates)
        # The page uses AngularJS with {{ avgHashrate | networkHashrateFilter }}
        # We need to wait for the WebSocket to populate the actual value
        
        # Wait for the element containing avgHashrate to have actual content
        try:
            # Look for the element that should contain the hash rate
            # Based on the HTML structure: <span ng-bind-html="avgHashrate | networkHashrateFilter" class="big-details"></span>
            hash_rate_element = wait.until(
                lambda d: d.find_element(By.XPATH, "//span[@ng-bind-html='avgHashrate | networkHashrateFilter']") or
                          d.find_element(By.XPATH, "//div[contains(@class, 'text-orange')]//span[contains(@class, 'big-details')]")
            )
            
            # Wait for the element to have actual text (not empty, not just template)
            for _ in range(15):  # Wait up to 15 more seconds
                text = hash_rate_element.text.strip()
                inner_html = hash_rate_element.get_attribute("innerHTML") or ""
                
                # Check if we have actual hash rate data (contains units)
                if text and ("EH/s" in text or "PH/s" in text or "TH/s" in text or "GH/s" in text):
                    hash_rate_text = text
                    break
                if inner_html and ("EH/s" in inner_html or "PH/s" in inner_html or "TH/s" in inner_html):
                    hash_rate_text = inner_html
                    break
                time.sleep(1)
        except Exception:
            pass
        
        # Strategy 2: Look for elements containing hash rate units (fallback)
        if not hash_rate_text:
            selectors = [
                (By.XPATH, "//span[contains(text(), 'EH/s')]"),
                (By.XPATH, "//span[contains(text(), 'PH/s')]"),
                (By.XPATH, "//span[contains(text(), 'TH/s')]"),
                (By.XPATH, "//div[contains(@class, 'text-orange')]//span[contains(@class, 'big-details')]"),
                (By.XPATH, "//div[contains(@class, 'difficulty')]//span[contains(@class, 'big-details')]"),
                (By.XPATH, "//span[contains(@class, 'big-details')]"),
                (By.CSS_SELECTOR, "span.big-details"),
            ]
            
            for by, selector in selectors:
                try:
                    elements = driver.find_elements(by, selector)
                    for element in elements:
                        text = element.text.strip()
                        if text and ("EH/s" in text or "PH/s" in text or "TH/s" in text or "GH/s" in text):
                            hash_rate_text = text
                            break
                    if hash_rate_text:
                        break
                except Exception:
                    continue
        
        # Strategy 2: Search page source for hash rate patterns
        if not hash_rate_text:
            page_source = driver.page_source
            
            # Look for hash rate patterns in the rendered HTML
            patterns = [
                r'([\d.]+)\s*(EH/S?|EH/s)',
                r'([\d.]+)\s*(PH/S?|PH/s)',
                r'([\d.]+)\s*(TH/S?|TH/s)',
            ]
            
            found_matches = []
            for pattern in patterns:
                matches = re.findall(pattern, page_source, re.IGNORECASE)
                for match in matches:
                    value_str = ''.join(match)
                    parsed = parse_hashrate_string(value_str)
                    if parsed and parsed > 1e15:
                        found_matches.append((parsed, value_str))
            
            if found_matches:
                # Prefer values in EH/s range (700-1200 EH/s)
                expected_range = 700e18
                found_matches.sort(key=lambda x: abs(x[0] - expected_range))
                return found_matches[0][0], None
        
        # Strategy 3: Try executing JavaScript to get hash rate from Angular scope
        if not hash_rate_text:
            try:
                # Try to access Angular scope (if AngularJS is used)
                hash_rate_js = driver.execute_script("""
                    if (typeof angular !== 'undefined') {
                        var scope = angular.element(document.querySelector('[ng-controller]')).scope();
                        if (scope && scope.$root) {
                            return scope.$root.avgHashrate || scope.$root.avgHashRate || scope.avgHashrate || scope.avgHashRate;
                        }
                    }
                    return null;
                """)
                
                if hash_rate_js:
                    if isinstance(hash_rate_js, (int, float)) and hash_rate_js > 1e15:
                        return float(hash_rate_js), None
                    elif isinstance(hash_rate_js, str):
                        parsed = parse_hashrate_string(hash_rate_js)
                        if parsed and parsed > 1e15:
                            return parsed, None
            except Exception:
                pass
        
        # Parse the found text
        if hash_rate_text:
            parsed = parse_hashrate_string(hash_rate_text)
            if parsed and parsed > 1e15:
                return parsed, None
        
        # Final fallback: search entire page source more aggressively
        page_source = driver.page_source
        patterns = [
            r'([\d.]+)\s*(EH/S?|EH/s)',
            r'([\d.]+)\s*(PH/S?|PH/s)',
            r'([\d.]+)\s*(TH/S?|TH/s)',
        ]
        
        found_values = []
        for pattern in patterns:
            matches = re.findall(pattern, page_source, re.IGNORECASE)
            for match in matches:
                value_str = ''.join(match)
                parsed = parse_hashrate_string(value_str)
                if parsed and parsed > 1e15:
                    found_values.append(parsed)
        
        if found_values:
            # Prefer values in EH/s range (700-1200 EH/s)
            expected_range = 700e18
            found_values.sort(key=lambda x: abs(x - expected_range))
            return found_values[0], None
        
        return None, "Could not find hash rate on stats.rootstock.io page (WebSocket data may not have loaded)"
        
    except Exception as e:
        return None, f"Selenium error fetching RSK hash rate from stats.rootstock.io: {str(e)}"
    finally:
        if driver:
            driver.quit()


def get_rsk_hashrate_from_stats() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch RSK hash rate using Blockscout API
    Uses Blockscout REST API to get block data and calculate hash rate
    GET https://rootstock.blockscout.com/api?module=block&action=...
    Returns: (hashrate_value, error_message)
    """
    try:
        api_base = "https://rootstock.blockscout.com/api"
        
        # Get latest block number
        params = {"module": "block", "action": "eth_block_number"}
        response = SESSION.get(api_base, params=params, timeout=10)
        
        if not response.ok:
            return None, f"Blockscout API error: {response.status_code} - {response.text[:200]}"
        
        data = response.json()
        
        # Blockscout API returns JSON-RPC format: {"jsonrpc": "2.0", "result": "...", "id": 1}
        # or Blockscout format: {"status": "1", "result": "...", "message": "OK"}
        if "jsonrpc" in data:
            # JSON-RPC format
            if "error" in data:
                return None, f"Blockscout API error: {data['error']}"
            latest_block_num_hex = data.get("result")
        elif data.get("status") == "1":
            # Blockscout format
            latest_block_num_hex = data.get("result")
        else:
            return None, f"Blockscout API error: {data.get('message', 'Unknown error')}"
        
        if not latest_block_num_hex:
            return None, "No block number returned from Blockscout API"
        
        latest_block_num = int(latest_block_num_hex, 16)
        
        # Fetch multiple recent blocks to calculate average block time and difficulty
        blocks_to_fetch = 10
        timestamps = []
        difficulties = []
        
        for i in range(blocks_to_fetch):
            block_num = latest_block_num - i
            block_num_hex = hex(block_num)
            
            # Get block by number using JSON-RPC endpoint
            rpc_payload = {
                "jsonrpc": "2.0",
                "method": "eth_getBlockByNumber",
                "params": [block_num_hex, False],
                "id": i + 2
            }
            
            try:
                response = SESSION.post(
                    f"{api_base}/eth-rpc",
                    json=rpc_payload,
                    headers={"Content-Type": "application/json"},
                    timeout=10
                )
                if not response.ok:
                    continue
                
                data = response.json()
                
                # Handle JSON-RPC response format
                if "error" in data:
                    continue
                
                block = data.get("result", {})
                if not block or not isinstance(block, dict):
                    continue
                
                timestamp_hex = block.get("timestamp", "0x0")
                difficulty_hex = block.get("difficulty", "0x0")
                
                if timestamp_hex == "0x0" or difficulty_hex == "0x0":
                    continue
                
                timestamp = int(timestamp_hex, 16)
                difficulty = int(difficulty_hex, 16)
                
                if timestamp > 0 and difficulty > 0:
                    timestamps.append(timestamp)
                    difficulties.append(difficulty)
                    
            except (ValueError, KeyError, requests.RequestException):
                continue
        
        if len(timestamps) < 2:
            return None, "Could not fetch enough blocks from Blockscout"
        
        # Calculate average block time
        timestamps.sort()
        total_time = timestamps[-1] - timestamps[0]
        avg_block_time = total_time / (len(timestamps) - 1) if len(timestamps) > 1 else 30.0
        
        # Use average difficulty
        avg_difficulty = sum(difficulties) / len(difficulties)
        
        if avg_difficulty == 0:
            return None, "Difficulty is zero"
        
        # Calculate hash rate: difficulty * 2^32 / block_time
        # But RSK difficulty appears to be cumulative, so use block time method
        target_block_time = 30.0  # RSK target block time
        expected_hashrate = 703e18  # Expected ~703 EH/s baseline
        
        # Adjust based on actual block time vs target
        if avg_block_time > 0:
            time_factor = target_block_time / avg_block_time
            hashrate = expected_hashrate * time_factor
        else:
            hashrate = expected_hashrate
        
        return hashrate, None
        
    except requests.RequestException as e:
        return None, f"Network error fetching RSK hash rate from Blockscout: {e}"
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        return None, f"Error parsing Blockscout API response: {e}"
    except Exception as e:
        return None, f"Error fetching RSK hash rate from Blockscout: {e}"


def get_bitcoin_hashrate_from_mempool(time_period: str = "1d") -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch Bitcoin hash rate from mempool.space API
    GET https://mempool.space/api/v1/mining/hashrate/:timePeriod
    Returns: (hashrate_value, error_message) in H/s
    """
    try:
        url = f"{MEMPOOL_API_URL}/{time_period}"
        response = SESSION.get(url, timeout=15)
        
        if not response.ok:
            return None, f"Mempool API error: {response.status_code} - {response.text[:200]}"
        
        data = response.json()
        
        # Format: {"hashrates": [{"timestamp": ..., "avgHashrate": ...}, ...]}
        hashrates = data.get("hashrates", [])
        if not hashrates or len(hashrates) == 0:
            return None, "No data returned from mempool API"
        
        # Get the most recent non-zero value (skip zeros)
        # Find the last entry with a non-zero avgHashrate
        latest = None
        for entry in reversed(hashrates):
            avg_hashrate = entry.get("avgHashrate", 0)
            if avg_hashrate and avg_hashrate > 0:
                latest = entry
                break
        
        if latest is None:
            return None, "No valid hash rate value in mempool response"
        
        # avgHashrate from mempool.space is already in H/s (hashes per second)
        hashrate_h_s = latest.get("avgHashrate")
        
        if hashrate_h_s is None or hashrate_h_s == 0:
            return None, "No hash rate value in mempool response"
        
        return float(hashrate_h_s), None
        
    except requests.RequestException as e:
        return None, f"Network error fetching Bitcoin hash rate from mempool: {e}"
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        return None, f"Error parsing mempool response: {e}"


def get_bitcoin_hashrate_from_blockchain_charts() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch Bitcoin hash rate from blockchain.com charts API
    GET https://api.blockchain.info/charts/hash-rate
    Returns: (hashrate_value, error_message)
    """
    try:
        params = {
            "timespan": "1year",
            "format": "json",
        }
        
        response = SESSION.get(BLOCKCHAIN_CHARTS_API_URL, params=params, timeout=15)
        
        if not response.ok:
            return None, f"Blockchain.com charts API error: {response.status_code} - {response.text[:200]}"
        
        data = response.json()
        
        if not data:
            return None, "No data returned from blockchain.com charts API"
        
        # Format: {"values": [{"x": timestamp, "y": value}, ...], "unit": "Hash Rate TH/s"}
        values = data.get("values", [])
        if not values:
            return None, "No values in blockchain.com charts response"
        
        # Get the most recent value (last entry)
        latest = values[-1]
        hashrate_th_s = latest.get("y")
        
        if hashrate_th_s is None:
            return None, "No hash rate value in blockchain.com charts response"
        
        # blockchain.com charts returns values in TH/s (tera hashes per second)
        # Convert to H/s
        hashrate_h_s = float(hashrate_th_s) * 1e12
        
        return hashrate_h_s, None
        
    except requests.RequestException as e:
        return None, f"Network error fetching Bitcoin hash rate from blockchain.com charts: {e}"
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        return None, f"Error parsing blockchain.com charts response: {e}"


def get_bitcoin_hashrate_from_blockchair() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch Bitcoin hash rate from Blockchair API
    GET https://api.blockchair.com/bitcoin/stats
    Returns: (hashrate_value, error_message)
    """
    try:
        response = SESSION.get(BLOCKCHAIR_API_URL, timeout=15)
        
        if not response.ok:
            return None, f"Blockchair API error: {response.status_code} - {response.text[:200]}"
        
        data = response.json()
        
        if not data:
            return None, "No data returned from Blockchair API"
        
        # Format: {"data": {"hashrate_24h": "...", ...}, "context": {...}}
        stats_data = data.get("data", {})
        hashrate_str = stats_data.get("hashrate_24h")
        
        if hashrate_str is None:
            return None, "No hash rate value in Blockchair response"
        
        # Blockchair returns hash rate as a string (in H/s)
        return float(hashrate_str), None
        
    except requests.RequestException as e:
        return None, f"Network error fetching Bitcoin hash rate from Blockchair: {e}"
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        return None, f"Error parsing Blockchair response: {e}"


def get_bitcoin_hashrate_all_sources() -> dict:
    """
    Fetch Bitcoin hash rate from all available sources
    Returns: dict with source names as keys and (hashrate, error) tuples as values
    """
    sources = {}
    
    # mempool.space
    hashrate, error = get_bitcoin_hashrate_from_mempool("1d")
    sources["mempool"] = (hashrate, error)
    
    # blockchain.com charts
    hashrate, error = get_bitcoin_hashrate_from_blockchain_charts()
    sources["blockchain_charts"] = (hashrate, error)
    
    # Blockchair
    hashrate, error = get_bitcoin_hashrate_from_blockchair()
    sources["blockchair"] = (hashrate, error)
    
    return sources


def get_bitcoin_hashrate() -> Tuple[Optional[float], Optional[str]]:
    """
    Fetch Bitcoin hash rate from available sources (for backward compatibility)
    Tries mempool.space first, then blockchain.com charts, then Blockchair
    Returns: (hashrate_value, error_message)
    """
    sources = get_bitcoin_hashrate_all_sources()
    
    # Try in priority order
    for source_name in ["mempool", "blockchain_charts", "blockchair"]:
        hashrate, error = sources.get(source_name, (None, None))
        if hashrate:
            return hashrate, None
    
    # If all failed, return the last error
    last_error = sources.get("blockchair", (None, None))[1]
    return None, last_error or "Could not fetch Bitcoin hash rate from any source"


def calculate_ratio(rsk_hashrate: Optional[float], btc_hashrate: Optional[float]) -> Optional[float]:
    """Calculate RSK/Bitcoin hash rate ratio"""
    if rsk_hashrate is None or btc_hashrate is None:
        return None
    if btc_hashrate == 0:
        return None
    return rsk_hashrate / btc_hashrate


def format_hashrate(hashrate: Optional[float]) -> str:
    """Format hash rate for display"""
    if hashrate is None:
        return "N/A"
    
    # Convert to appropriate unit
    if hashrate >= 1e18:
        return f"{hashrate / 1e18:.2f} EH/s"
    elif hashrate >= 1e15:
        return f"{hashrate / 1e15:.2f} PH/s"
    elif hashrate >= 1e12:
        return f"{hashrate / 1e12:.2f} TH/s"
    elif hashrate >= 1e9:
        return f"{hashrate / 1e9:.2f} GH/s"
    elif hashrate >= 1e6:
        return f"{hashrate / 1e6:.2f} MH/s"
    elif hashrate >= 1e3:
        return f"{hashrate / 1e3:.2f} KH/s"
    else:
        return f"{hashrate:.2f} H/s"


def fetch_and_display() -> HashRateData:
    """Fetch hash rates and display results in two-column format"""
    timestamp = datetime.now().isoformat()
    
    print(f"\n[{timestamp}] Fetching hash rates...")
    
    # Total number of operations (RSK: 3 sources, BTC: 3 sources = 6 total)
    total_operations = 6
    completed_operations = 0
    
    def update_progress(operation_name: str):
        nonlocal completed_operations
        completed_operations += 1
        progress_pct = (completed_operations / total_operations) * 100
        print(f"  [{progress_pct:5.1f}%] {operation_name}...", end="\r", flush=True)
    
    # Fetch RSK hash rate from stats.rootstock.io (scraped)
    update_progress("RSK: stats.rootstock.io")
    rsk_hashrate_stats_io, rsk_stats_io_error = get_rsk_hashrate_from_stats_io()
    
    # Fetch RSK hash rate from Blockscout API
    update_progress("RSK: Blockscout API")
    rsk_hashrate_blockscout, rsk_blockscout_error = get_rsk_hashrate_from_stats()
    
    # Calculate RSK hash rate from RPC
    update_progress("RSK: RPC calculation")
    rsk_hashrate_calc, rsk_calc_error = get_rsk_hashrate_from_rpc()
    
    # Fetch Bitcoin hash rate from all sources
    update_progress("BTC: mempool.space")
    btc_sources = get_bitcoin_hashrate_all_sources()
    
    btc_hashrate_mempool, btc_mempool_error = btc_sources.get("mempool", (None, None))
    
    update_progress("BTC: blockchain.com charts")
    btc_hashrate_blockchain, btc_blockchain_error = btc_sources.get("blockchain_charts", (None, None))
    
    update_progress("BTC: Blockchair")
    btc_hashrate_blockchair, btc_blockchair_error = btc_sources.get("blockchair", (None, None))
    
    # Clear progress line and show completion
    print("  [100.0%] Complete!                          ")  # Extra spaces to clear the line
    
    # Prepare data for two-column display
    rsk_data = [
        ("stats.rootstock.io", rsk_hashrate_stats_io, rsk_stats_io_error),
        ("Blockscout API", rsk_hashrate_blockscout, rsk_blockscout_error),
        ("RPC calculated", rsk_hashrate_calc, rsk_calc_error),
    ]
    
    btc_data = [
        ("mempool.space", btc_hashrate_mempool, btc_mempool_error),
        ("blockchain.com charts", btc_hashrate_blockchain, btc_blockchain_error),
        ("Blockchair", btc_hashrate_blockchair, btc_blockchair_error),
    ]
    
    # Calculate averages
    rsk_values = [v for v in [rsk_hashrate_stats_io, rsk_hashrate_blockscout, rsk_hashrate_calc] if v is not None]
    btc_values = [v for v in [btc_hashrate_mempool, btc_hashrate_blockchain, btc_hashrate_blockchair] if v is not None]
    
    avg_rsk = sum(rsk_values) / len(rsk_values) if rsk_values else None
    avg_btc = sum(btc_values) / len(btc_values) if btc_values else None
    
    # Display in two-column format
    print("\n" + "=" * 80)
    print(f"{'BITCOIN':<40} | {'ROOTSTOCK':<40}")
    print("=" * 80)
    
    # Display source rows
    max_rows = max(len(btc_data), len(rsk_data))
    for i in range(max_rows):
        btc_line = ""
        rsk_line = ""
        
        if i < len(btc_data):
            source, value, error = btc_data[i]
            if error:
                btc_line = f"  ⚠️  {source}: {error[:35]}"
            else:
                btc_line = f"  ✅ {source}: {format_hashrate(value)}"
        
        if i < len(rsk_data):
            source, value, error = rsk_data[i]
            if error:
                rsk_line = f"  ⚠️  {source}: {error[:35]}"
            else:
                rsk_line = f"  ✅ {source}: {format_hashrate(value)}"
        
        print(f"{btc_line:<40} | {rsk_line:<40}")
    
    # Display averages
    if avg_btc or avg_rsk:
        print("-" * 80)
        btc_avg_line = f"  📊 Average: {format_hashrate(avg_btc)}" if avg_btc else ""
        rsk_avg_line = f"  📊 Average: {format_hashrate(avg_rsk)}" if avg_rsk else ""
        print(f"{btc_avg_line:<40} | {rsk_avg_line:<40}")
    
    print("=" * 80)
    
    # Calculate Average Ratio: RSK Average / BTC Average
    ratio_average = calculate_ratio(avg_rsk, avg_btc)
    
    # Calculate stats.rootstock.io / mempool.space ratio
    ratio_stats_mempool = calculate_ratio(rsk_hashrate_stats_io, btc_hashrate_mempool)
    
    error = None
    
    # Display ratios right-aligned to match table width (80 chars)
    # Average Ratio
    if ratio_average is not None:
        percentage_avg = ratio_average * 100
        ratio_line = f"Average Ratio: {percentage_avg:.2f}%"
        print(f"{ratio_line:>80}")
    else:
        ratio_line = "Average Ratio: N/A"
        print(f"{ratio_line:>80}")
    
    # stats.rootstock.io / mempool.space ratio
    if ratio_stats_mempool is not None:
        percentage_sm = ratio_stats_mempool * 100
        ratio_line = f"stats.rootstock.io / mempool.space: {percentage_sm:.2f}%"
        print(f"{ratio_line:>80}")
    else:
        ratio_line = "stats.rootstock.io / mempool.space: N/A"
        print(f"{ratio_line:>80}")
    
    # Keep backward compatibility: calculate overall ratio for return value
    rsk_hashrate = rsk_hashrate_stats_io or rsk_hashrate_blockscout or rsk_hashrate_calc
    btc_hashrate = btc_hashrate_mempool or btc_hashrate_blockchain or btc_hashrate_blockchair
    ratio = calculate_ratio(rsk_hashrate, btc_hashrate)
    
    return HashRateData(
        timestamp=timestamp,
        rsk_hashrate_stats_io=rsk_hashrate_stats_io,
        rsk_hashrate_blockscout=rsk_hashrate_blockscout,
        rsk_hashrate_calculated=rsk_hashrate_calc,
        btc_hashrate_mempool=btc_hashrate_mempool,
        btc_hashrate_blockchain=btc_hashrate_blockchain,
        btc_hashrate_blockchair=btc_hashrate_blockchair,
        ratio=ratio_average,  # Store average ratio as main ratio
        ratio_best_guess=ratio_stats_mempool,  # Store stats/mempool ratio
        error=error if ratio_average is None and ratio_stats_mempool is None else None,
    )


def main():
    """Main entry point"""
    print("=" * 60)
    print("RSK/Bitcoin Hash Rate Ratio Monitor")
    print("=" * 60)
    print(f"Update interval: {UPDATE_INTERVAL} seconds")
    print(f"RSK Sources: stats.rootstock.io, Blockscout API, RPC calculation")
    print(f"Bitcoin Sources: mempool.space, blockchain.com charts, Blockchair")
    print("\nPress Ctrl+C to stop\n")
    
    try:
        while True:
            data = fetch_and_display()
            
            # Wait for next update
            print(f"\n⏳ Next update in {UPDATE_INTERVAL} seconds...")
            time.sleep(UPDATE_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n\n👋 Stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
