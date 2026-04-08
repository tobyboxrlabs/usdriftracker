#!/usr/bin/env python3
"""
Debug NFT metadata on Rootstock testnet: call collection URIs (contractURI, baseURI),
tokenURI / uri, resolve IPFS→HTTP, fetch JSON.

  pip install web3 eth_abi requests

contractURI() and baseURI() are optional on many contracts; eth_call will fail if missing.

Examples:
  python3 scripts/debug_nft_testnet.py
  python3 scripts/debug_nft_testnet.py --contract 0x... --token-id 42
  python3 scripts/debug_nft_testnet.py --audit-collection
  python3 scripts/debug_nft_testnet.py --audit-collection --token-ids 1,2,3,4,5
  python3 scripts/debug_nft_testnet.py --http-timeout 30 --rpc-timeout 30  # defaults are 3s; raise for slow IPFS
  python3 scripts/debug_nft_testnet.py --single-gateway --ipfs-gateway https://cf-ipfs.com/ipfs/

Public IPFS gateways vary by region/CID; 504 often means the content is not on the public DHT.
If HTTP gateways all fail, the script can try the local `ipfs` CLI (Kubo) when installed.

Blockscout: --audit-collection calls GET /api/v2/tokens/{contract}/instances (and per-id as needed),
then compares to on-chain tokenURI JSON and verifies retrieval via https://dweb.link/ipfs/ only.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import warnings
from dataclasses import dataclass, field
from typing import Any

# Before requests/urllib3: macOS system Python often uses LibreSSL; urllib3 warns on import.
warnings.filterwarnings(
    "ignore",
    message=r"urllib3 v2 only supports OpenSSL.*",
    category=Warning,
)

import requests
from eth_abi import decode
from web3 import Web3

DEFAULT_RPC = "https://public-node.testnet.rsk.co"
DEFAULT_CONTRACT = "0x1eea464C8632A71a2e9b364725DA6e09Aaed2dDC"
DEFAULT_TOKEN_ID = 1
DEFAULT_IPFS_GATEWAY = "https://dweb.link/ipfs/"

# Tried in order after --ipfs-gateway. cf-ipfs.com may fail DNS on some networks; Pinata often still resolves.
IPFS_GATEWAY_FALLBACKS: tuple[str, ...] = (
    "https://dweb.link/ipfs/",
    "https://gateway.pinata.cloud/ipfs/",
    "https://nftstorage.link/ipfs/",
    "https://w3s.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://cf-ipfs.com/ipfs/",
    "https://ipfs.4everland.io/ipfs/",
)

DEFAULT_RPC_TIMEOUT = 3.0
DEFAULT_HTTP_TIMEOUT = 3.0
# tokenURI JSON via dweb (audit-only); separate knob from --http-timeout.
DEFAULT_AUDIT_META_READ_TIMEOUT = 3.0

DEFAULT_BLOCKSCOUT_BASE = "https://rootstock-testnet.blockscout.com"
DWEB_VERIFY_PREFIX = "https://dweb.link/ipfs/"


@dataclass
class DwebFetchResult:
    ok: bool
    url: str
    status: int | None = None
    byte_len: int | None = None
    content_type: str | None = None
    is_json_ok: bool = False
    err: str | None = None


@dataclass
class TokenAuditRow:
    token_id: int
    blockscout_ok: bool = False
    blockscout_err: str | None = None
    bs_name: str | None = None
    bs_meta_keys: list[str] = field(default_factory=list)
    chain_uri: str | None = None
    chain_err: str | None = None
    meta_dweb_ok: bool = False
    meta_dweb_note: str = ""
    meta_matches_bs: bool | None = None
    image_uri: str | None = None
    image_dweb_ok: bool = False
    image_bytes: int | None = None
    image_note: str = ""


def uri_to_dweb_url(uri: str) -> str | None:
    """If URI can be verified via dweb.link gateway, return that URL."""
    u = uri.strip()
    if u.startswith("ipfs://"):
        return DWEB_VERIFY_PREFIX + u[len("ipfs://") :].lstrip("/").split("?", 1)[0]
    low = u.lower()
    if low.startswith("https://dweb.link/ipfs/") or low.startswith("http://dweb.link/ipfs/"):
        return "https://" + u.split("://", 1)[1].split("?", 1)[0]
    return None


def dweb_verify_get(url: str, http_timeout: float, *, expect_json: bool) -> DwebFetchResult:
    to = http_get_timeout(http_timeout)
    try:
        r = requests.get(url, timeout=to, allow_redirects=True)
        blen = len(r.content)
        ct = r.headers.get("Content-Type", "")
        ok_http = r.status_code == 200 and blen > 0
        is_j = False
        err = None
        if ok_http and expect_json:
            try:
                json.loads(r.content.decode("utf-8", errors="replace"))
                is_j = True
            except json.JSONDecodeError as e:
                is_j = False
                err = f"not valid JSON: {e}"
        elif not ok_http:
            err = f"HTTP {r.status_code}, {blen} bytes"
        return DwebFetchResult(
            ok=ok_http and (not expect_json or is_j),
            url=url,
            status=r.status_code,
            byte_len=blen,
            content_type=ct,
            is_json_ok=is_j,
            err=err,
        )
    except Exception as e:  # noqa: BLE001
        return DwebFetchResult(ok=False, url=url, err=str(e))


def _http_error_detail(status: int, body: bytes) -> str:
    if status in (502, 504) and b"DOCTYPE" in body[:400]:
        return f"HTTP {status}, {len(body)} bytes (gateway error HTML, not JSON)"
    return f"HTTP {status}, {len(body)} bytes"


def fetch_json_from_token_uri_for_audit(
    uri: str,
    *,
    dweb_read_timeout: float,
    http_timeout: float,
) -> tuple[dict[str, Any] | None, str]:
    """
    Load metadata JSON from token URI. Prefer dweb.link for ipfs://; use direct GET for http(s).
    dweb_read_timeout: read budget for ipfs→dweb (often needs to exceed --http-timeout).
    Returns (obj, note).
    """
    durl = uri_to_dweb_url(uri)
    if durl:
        try:
            r = requests.get(durl, timeout=http_get_timeout(dweb_read_timeout), allow_redirects=True)
            if r.status_code != 200 or not r.content:
                return None, _http_error_detail(r.status_code, r.content)
            try:
                obj = r.json()
            except json.JSONDecodeError as e:
                return None, f"dweb returned non-JSON (HTTP {r.status_code}): {e}"
            return obj, "via dweb.link"
        except Exception as e:  # noqa: BLE001
            return None, f"dweb metadata fetch failed: {e}"
    if uri.startswith("http://") or uri.startswith("https://"):
        try:
            r = requests.get(uri, timeout=http_get_timeout(http_timeout))
            r.raise_for_status()
            return r.json(), "via tokenURI URL"
        except Exception as e:  # noqa: BLE001
            return None, str(e)
    return None, "unsupported tokenURI scheme"


def metadata_dict_equal(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def fetch_blockscout_token_instances(
    blockscout_base: str,
    contract_address: str,
    http_timeout: float,
) -> list[dict[str, Any]]:
    base = blockscout_base.rstrip("/")
    addr = Web3.to_checksum_address(contract_address)
    items: list[dict[str, Any]] = []
    url = f"{base}/api/v2/tokens/{addr}/instances"
    next_params: dict[str, Any] | None = None
    for _ in range(50):
        to = http_get_timeout(http_timeout)
        r = requests.get(url, params=next_params or {}, timeout=to)
        r.raise_for_status()
        data = r.json()
        batch = data.get("items") or []
        items.extend(batch)
        nxt = data.get("next_page_params")
        if not nxt:
            break
        next_params = {str(k): v for k, v in nxt.items() if v is not None}
    return items


def fetch_blockscout_instance(
    blockscout_base: str,
    contract_address: str,
    token_id: int,
    http_timeout: float,
) -> dict[str, Any]:
    base = blockscout_base.rstrip("/")
    addr = Web3.to_checksum_address(contract_address)
    to = http_get_timeout(http_timeout)
    r = requests.get(f"{base}/api/v2/tokens/{addr}/instances/{token_id}", timeout=to)
    r.raise_for_status()
    return r.json()


def image_uri_from_metadata(meta: dict[str, Any] | None) -> str | None:
    if not meta:
        return None
    v = meta.get("image") or meta.get("image_url") or meta.get("imageUri")
    return str(v) if v is not None else None


def verify_image_on_dweb(image_uri: str | None, http_timeout: float) -> tuple[bool, int | None, str]:
    if not image_uri:
        return False, None, "no image in metadata"
    durl = uri_to_dweb_url(image_uri)
    if not durl:
        return False, None, f"cannot map to dweb: {image_uri[:80]!r}"
    res = dweb_verify_get(durl, http_timeout, expect_json=False)
    if res.ok:
        return True, res.byte_len, f"OK {res.byte_len} bytes"
    return False, res.byte_len, res.err or f"HTTP {res.status}"


def run_collection_audit(
    w3: Web3,
    contract: str,
    blockscout_base: str,
    http_timeout: float,
    audit_meta_read_timeout: float,
    token_ids_filter: list[int] | None,
    verbose: bool,
) -> list[TokenAuditRow]:
    rows: list[TokenAuditRow] = []
    print("\n========== Blockscout: list token instances ==========")
    try:
        inst = fetch_blockscout_token_instances(blockscout_base, contract, http_timeout)
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"Blockscout /instances failed: {e}") from e

    by_id: dict[int, dict[str, Any]] = {}
    for it in inst:
        tid = int(it["id"])
        by_id[tid] = it

    if token_ids_filter is not None:
        ids = sorted(set(token_ids_filter))
    else:
        ids = sorted(by_id.keys())

    print(f"Blockscout returned {len(inst)} instance(s); auditing token id(s): {ids}")
    print(f"Audit: tokenURI JSON fetch via dweb.link read timeout = {audit_meta_read_timeout:g}s (see --audit-meta-read-timeout)")
    if inst:
        tok = inst[0].get("token") or {}
        print(
            "Collection (Blockscout index):",
            tok.get("name"),
            f"[{tok.get('symbol')}]",
            "|",
            tok.get("type"),
            "| holders:",
            tok.get("holders_count"),
            "| total_supply:",
            tok.get("total_supply"),
        )

    for tid in ids:
        row = TokenAuditRow(token_id=tid)
        bs_obj: dict[str, Any] | None = by_id.get(tid)
        if bs_obj is None:
            try:
                bs_obj = fetch_blockscout_instance(blockscout_base, contract, tid, http_timeout)
                by_id[tid] = bs_obj
            except Exception as e:  # noqa: BLE001
                row.blockscout_ok = False
                row.blockscout_err = str(e)
                rows.append(row)
                continue

        meta_bs = bs_obj.get("metadata")
        if isinstance(meta_bs, dict):
            row.blockscout_ok = True
            row.bs_meta_keys = sorted(meta_bs.keys())
            row.bs_name = str(meta_bs.get("name", "")) or None
        else:
            row.bs_meta_keys = []
            row.blockscout_err = "missing metadata object"

        if verbose:
            print(f"\n--- Blockscout instance {tid} ---")
            print(json.dumps(bs_obj, indent=2, default=str)[:8000])

        try:
            row.chain_uri = None
            for sig in ("tokenURI(uint256)", "uri(uint256)"):
                try:
                    row.chain_uri = call_string_fn(w3, contract, sig, tid)
                    break
                except Exception:  # noqa: BLE001
                    continue
            if row.chain_uri is None:
                row.chain_err = "tokenURI and uri both failed"
        except Exception as e:  # noqa: BLE001
            row.chain_err = str(e)

        onchain_meta: dict[str, Any] | None = None
        if row.chain_uri:
            onchain_meta, note = fetch_json_from_token_uri_for_audit(
                row.chain_uri,
                dweb_read_timeout=audit_meta_read_timeout,
                http_timeout=http_timeout,
            )
            row.meta_dweb_ok = onchain_meta is not None and note == "via dweb.link"
            if onchain_meta is None and row.chain_uri.startswith("ipfs://"):
                row.meta_dweb_note = note
            elif onchain_meta is None:
                row.meta_dweb_note = note
            else:
                row.meta_dweb_note = note
                if isinstance(meta_bs, dict):
                    row.meta_matches_bs = metadata_dict_equal(meta_bs, onchain_meta)

        img_uri = None
        if isinstance(meta_bs, dict):
            img_uri = image_uri_from_metadata(meta_bs)
        if img_uri is None and onchain_meta:
            img_uri = image_uri_from_metadata(onchain_meta)
        row.image_uri = img_uri
        ok_i, nbytes, inote = verify_image_on_dweb(img_uri, http_timeout)
        row.image_dweb_ok = ok_i
        row.image_bytes = nbytes
        row.image_note = inote

        rows.append(row)

    return rows


def print_collection_audit_summary(rows: list[TokenAuditRow], audit_meta_read_timeout: float) -> None:
    print("\n========== Summary ==========")
    all_bs = all(r.blockscout_ok for r in rows)
    all_chain = all(r.chain_uri and not r.chain_err for r in rows)
    meta_dweb = sum(1 for r in rows if r.meta_dweb_ok)
    meta_match = sum(1 for r in rows if r.meta_matches_bs is True)
    meta_mismatch = sum(1 for r in rows if r.meta_matches_bs is False)
    img_ok = sum(1 for r in rows if r.image_dweb_ok)
    print(
        f"tokens={len(rows)} | blockscout_ok={all_bs} | chain_tokenURI_ok={all_chain} | "
        f"metadata_JSON_via_dweb={meta_dweb}/{len(rows)} | "
        f"blockscout_vs_onchain_JSON={meta_match} match, {meta_mismatch} mismatch, "
        f"{len(rows) - meta_match - meta_mismatch} n/a (needs both BS + fetched JSON) | "
        f"image_via_dweb={img_ok}/{len(rows)}"
    )
    print(
        "\n(JSON at tokenURI and `image` are different CIDs: gateways may return 504 for one and 200 for the other.)"
    )
    key_union: set[str] = set()
    for r in rows:
        key_union.update(r.bs_meta_keys)
    if key_union:
        print("Union of `metadata` keys (from Blockscout):", ", ".join(sorted(key_union)))
    print("\nid | BS | chain tokenURI (clip) | meta@dweb | JSON≡BS | img@dweb")
    print("-" * 104)
    for r in rows:
        bs = "ok" if r.blockscout_ok else ("fail: " + (r.blockscout_err or ""))[:28]
        uri = (r.chain_uri[:44] + "…") if r.chain_uri and len(r.chain_uri) > 44 else (r.chain_uri or r.chain_err or "—")
        md = "OK" if r.meta_dweb_ok else ("FAIL " + (r.meta_dweb_note or "")[:36])
        eq = (
            "yes"
            if r.meta_matches_bs is True
            else ("no" if r.meta_matches_bs is False else "n/a")
        )
        im = "OK" if r.image_dweb_ok else ("FAIL " + (r.image_note or "")[:36])
        print(f"{r.token_id} | {bs:28} | {uri:44} | {md:40} | {eq:3} | {im:38}")
    print("\n--- Full notes (metadata / image) ---")
    for r in rows:
        print(f"  token {r.token_id}: meta… {r.meta_dweb_note or 'OK'}")
        print(f"           image {r.image_uri or '—'} → {r.image_note}")
    n_meta = sum(1 for r in rows if r.meta_dweb_ok)
    if rows and n_meta == 0:
        print(
            "\nHint: metadata JSON (tokenURI CID) often 504s or times out on dweb while `image` still loads. "
            f"Try a longer read budget: --audit-meta-read-timeout 120 (current {audit_meta_read_timeout:g}s), "
            "or pin the JSON CID / use local `ipfs cat`."
        )


def http_get_timeout(read_timeout: float) -> tuple[float, float]:
    """(connect, read): connect capped; read uses the requested budget. Never connect longer than read."""
    c = min(10.0, max(0.75, read_timeout * 0.25))
    if c > read_timeout:
        c = read_timeout
    return (c, read_timeout)


def _error_looks_dns(e: BaseException) -> bool:
    s = str(e).lower()
    return any(
        part in s
        for part in (
            "failed to resolve",
            "name resolution",
            "nodename nor servname",
            "name or service not known",
            "temporary failure in name resolution",
            "errno 8",
        )
    )


def _error_looks_timeout(e: BaseException) -> bool:
    if isinstance(e, requests.exceptions.Timeout):
        return True
    s = str(e).lower()
    return "read timed out" in s or "connect timed out" in s


def call_string_fn_no_args(w3: Web3, contract: str, fn_sig: str) -> str:
    """Call a zero-arg view that returns string, e.g. contractURI() or baseURI()."""
    selector = bytes(Web3.keccak(text=fn_sig)[:4])
    res = w3.eth.call({"to": Web3.to_checksum_address(contract), "data": selector})
    (s,) = decode(["string"], res)
    return s


def call_string_fn(w3: Web3, contract: str, fn_sig: str, token_id: int) -> str:
    """Call a view function that returns a single string, e.g. tokenURI(uint256) or uri(uint256)."""
    selector = bytes(Web3.keccak(text=fn_sig)[:4])
    encoded_args = token_id.to_bytes(32, "big")
    data = selector + encoded_args
    res = w3.eth.call({"to": Web3.to_checksum_address(contract), "data": data})
    (s,) = decode(["string"], res)
    return s


def normalize_gateway(gw: str) -> str:
    g = gw.strip()
    return g if g.endswith("/") else g + "/"


def gateway_try_order(primary: str, single: bool) -> list[str]:
    prim = normalize_gateway(primary)
    if single:
        return [prim]
    seen: set[str] = set()
    out: list[str] = []
    for g in (prim, *IPFS_GATEWAY_FALLBACKS):
        n = normalize_gateway(g)
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def ipfs_to_http(uri: str, gateway: str) -> str:
    if uri.startswith("ipfs://"):
        base = normalize_gateway(gateway)
        return base + uri[len("ipfs://") :].lstrip("/")
    return uri


def ipfs_path_from_uri(token_uri: str) -> str:
    if not token_uri.startswith("ipfs://"):
        raise ValueError("not an ipfs:// URI")
    rest = token_uri[len("ipfs://") :].lstrip("/")
    return f"/ipfs/{rest}" if rest else "/ipfs/"


def try_ipfs_cli_cat_json(token_uri: str, timeout: float) -> dict[str, Any] | None:
    """If Kubo `ipfs` is on PATH, fetch JSON via `ipfs cat /ipfs/...`."""
    if not token_uri.startswith("ipfs://"):
        return None
    if not shutil.which("ipfs"):
        return None
    ipfs_path = ipfs_path_from_uri(token_uri)
    print(f"  Trying: ipfs cat {ipfs_path!r} (local CLI, timeout={timeout}s)")
    try:
        proc = subprocess.run(
            ["ipfs", "cat", ipfs_path],
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print("    → failed: ipfs cat timed out")
        return None
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        print(f"    → failed (exit {proc.returncode}): {err or '(no stderr)'}")
        return None
    raw = proc.stdout.decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"    → ipfs cat returned non-JSON: {e}")
        print(raw[:500])
        return None


def print_ipfs_unavailable_hint(
    token_uri: str,
    *,
    dns_failures: int = 0,
    timeout_failures: int = 0,
    http_timeout: float = 0.0,
) -> None:
    cid_part = token_uri[len("ipfs://") :].lstrip("/").split("/", 1)[0] if token_uri.startswith("ipfs://") else "…"
    print("\n---")
    print("All tried IPFS HTTP gateways failed. What we saw:")
    if dns_failures:
        print(f"  • DNS / name resolution failures: {dns_failures} (try another network or set --ipfs-gateway).")
    if timeout_failures:
        print(
            f"  • Timeouts: {timeout_failures} (cold DHT fetches are slow; try --http-timeout 60 or 120; "
            "current read budget is rounded below)."
        )
    if not dns_failures and not timeout_failures:
        print("  • HTTP errors, empty responses, or non-JSON (see messages above).")
    print("Other common causes:")
    print("  • CID is not pinned / not reachable on the public IPFS DHT.")
    print("  • Gateways redirect to another host that then times out (still often a propagation/pin issue).")
    if http_timeout > 0:
        tip = max(60.0, round(http_timeout * 2))
        print(f"  • Retry with: --http-timeout {int(tip)}")
    print("If you run Kubo / IPFS Desktop locally:")
    print(f"  ipfs pin add {cid_part}")
    print(f"  ipfs cat /ipfs/{cid_part}")
    print("Or use a provider gateway you trust, e.g.:")
    print("  --single-gateway --ipfs-gateway https://YOUR_GATEWAY/ipfs/")
    print("---")


def fetch_metadata_json(
    token_uri: str,
    gateways: list[str],
    http_timeout: float,
    try_cli: bool,
) -> tuple[dict[str, Any], str]:
    """
    Download and parse metadata JSON. For ipfs://, try each gateway until one succeeds.
    Returns (parsed_json, gateway_prefix_used_for_ipfs_urls).
    """
    last_err: Exception | None = None

    if token_uri.startswith("ipfs://"):
        req_to = http_get_timeout(http_timeout)
        dns_failures = 0
        timeout_failures = 0
        for gw in gateways:
            url = ipfs_to_http(token_uri, gw)
            print(f"  Fetch try: {url} (connect≤{req_to[0]:g}s, read={req_to[1]:g}s)")
            try:
                r = requests.get(url, timeout=req_to)
                r.raise_for_status()
                meta = r.json()
                return meta, gw
            except Exception as e:  # noqa: BLE001 — debug script
                last_err = e
                if _error_looks_dns(e):
                    dns_failures += 1
                elif _error_looks_timeout(e):
                    timeout_failures += 1
                print(f"    → failed: {e}")

        if try_cli:
            cli_meta = try_ipfs_cli_cat_json(token_uri, http_timeout)
            if cli_meta is not None:
                print("    → OK via local ipfs CLI")
                return cli_meta, gateways[0]

        print_ipfs_unavailable_hint(
            token_uri,
            dns_failures=dns_failures,
            timeout_failures=timeout_failures,
            http_timeout=http_timeout,
        )
        tip = max(60, int(round(http_timeout * 2)))
        raise RuntimeError(
            f"All {len(gateways)} IPFS HTTP gateway(s) failed. Last error: {last_err}. "
            f"Tip: --http-timeout {tip}"
        )

    to = http_get_timeout(http_timeout)
    print(f"  Fetch: {token_uri} (connect≤{to[0]:g}s, read={to[1]:g}s)")
    r = requests.get(token_uri, timeout=to)
    r.raise_for_status()
    return r.json(), gateways[0]


def try_collection_uri_and_maybe_fetch(
    w3: Web3,
    contract: str,
    label: str,
    fn_sig: str,
    gateways: list[str],
    http_timeout: float,
    fetch_meta: bool,
    try_cli: bool,
) -> None:
    try:
        s = call_string_fn_no_args(w3, contract, fn_sig)
        print(f"\n✅ {label} ({fn_sig}) returned:\n{s}")
    except Exception as e:  # noqa: BLE001 — debug script
        print(f"\n❌ {label} ({fn_sig}) failed: {e}")
        return

    if not fetch_meta or not s:
        return
    if not (s.startswith("ipfs://") or s.startswith("http://") or s.startswith("https://")):
        return

    print(f"\nDownloading {label} JSON…")
    try:
        meta, gw_used = fetch_metadata_json(s, gateways, http_timeout, try_cli=try_cli)
    except Exception as e:  # noqa: BLE001
        print(f"\n⚠️ Could not fetch {label} metadata:", e)
        return

    print(f"\n{label} metadata keys:", list(meta.keys()))
    image = meta.get("image") or meta.get("image_url") or meta.get("imageUri")
    print(f"\n{label} image field:", image)
    if image:
        print("image URL:", ipfs_to_http(str(image), gw_used))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="RSK testnet NFT: chain URIs + metadata; optional Blockscout collection audit + dweb.link checks."
    )
    parser.add_argument(
        "--rpc",
        default=DEFAULT_RPC,
        help=f"JSON-RPC HTTP endpoint (default: {DEFAULT_RPC})",
    )
    parser.add_argument(
        "--contract",
        default=DEFAULT_CONTRACT,
        help=f"ERC721/1155 contract address (default: {DEFAULT_CONTRACT})",
    )
    parser.add_argument(
        "--token-id",
        type=int,
        default=DEFAULT_TOKEN_ID,
        help=f"Token id (default: {DEFAULT_TOKEN_ID})",
    )
    parser.add_argument(
        "--ipfs-gateway",
        default=DEFAULT_IPFS_GATEWAY,
        help=f"Preferred IPFS path gateway (default: {DEFAULT_IPFS_GATEWAY}); others tried unless --single-gateway",
    )
    parser.add_argument(
        "--single-gateway",
        action="store_true",
        help="Only use --ipfs-gateway (no fallbacks if it times out)",
    )
    parser.add_argument(
        "--no-fetch-meta",
        action="store_true",
        help="Only print token URI / uri; do not HTTP-fetch metadata JSON",
    )
    parser.add_argument(
        "--rpc-timeout",
        type=float,
        default=DEFAULT_RPC_TIMEOUT,
        help=f"RPC HTTP timeout in seconds (default: {DEFAULT_RPC_TIMEOUT})",
    )
    parser.add_argument(
        "--http-timeout",
        type=float,
        default=DEFAULT_HTTP_TIMEOUT,
        help=f"Metadata HTTP GET timeout in seconds (default: {DEFAULT_HTTP_TIMEOUT})",
    )
    parser.add_argument(
        "--no-ipfs-cli",
        action="store_true",
        help="Do not run `ipfs cat` fallback when all HTTP gateways fail",
    )
    parser.add_argument(
        "--audit-collection",
        action="store_true",
        help="Blockscout /api/v2/tokens/.../instances + per-token chain tokenURI; verify JSON + image via dweb.link",
    )
    parser.add_argument(
        "--blockscout",
        default=DEFAULT_BLOCKSCOUT_BASE,
        help=f"Blockscout site origin (default: {DEFAULT_BLOCKSCOUT_BASE})",
    )
    parser.add_argument(
        "--token-ids",
        default=None,
        metavar="LIST",
        help="For --audit-collection: comma-separated ids (default: all instances Blockscout returns)",
    )
    parser.add_argument(
        "--audit-verbose",
        action="store_true",
        help="With --audit-collection, print raw Blockscout JSON per token (truncated)",
    )
    parser.add_argument(
        "--audit-meta-read-timeout",
        type=float,
        default=DEFAULT_AUDIT_META_READ_TIMEOUT,
        help=(
            "With --audit-collection: read timeout (seconds) for fetching tokenURI JSON via dweb.link "
            f"(default: {DEFAULT_AUDIT_META_READ_TIMEOUT}; separate from --http-timeout)"
        ),
    )
    args = parser.parse_args()

    rpc = args.rpc.strip()
    contract = Web3.to_checksum_address(args.contract.strip())
    token_id = args.token_id
    gateways = gateway_try_order(args.ipfs_gateway, args.single_gateway)
    rpc_timeout = float(args.rpc_timeout)
    http_timeout = float(args.http_timeout)

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": rpc_timeout}))

    if not w3.is_connected():
        raise SystemExit(f"RPC not reachable: {rpc}")

    print("Contract:", contract)
    print("Token ID:", token_id)
    print("Chain ID:", w3.eth.chain_id)
    if not args.single_gateway:
        print("IPFS gateways (in order):", ", ".join(g.strip("/") for g in gateways))

    print("\n--- Collection-level URIs (optional; revert if not implemented) ---")
    fetch_meta = not args.no_fetch_meta
    try_cli = not args.no_ipfs_cli
    for label, fn_sig in (
        ("contractURI", "contractURI()"),
        ("baseURI", "baseURI()"),
    ):
        try_collection_uri_and_maybe_fetch(
            w3,
            contract,
            label,
            fn_sig,
            gateways,
            http_timeout,
            fetch_meta=fetch_meta,
            try_cli=try_cli,
        )

    if args.audit_collection:
        token_ids_filter: list[int] | None = None
        if args.token_ids:
            raw = [x.strip() for x in args.token_ids.split(",") if x.strip()]
            try:
                token_ids_filter = [int(x) for x in raw]
            except ValueError as e:
                raise SystemExit(f"--token-ids must be integers: {e}") from e
        audit_meta_read = float(args.audit_meta_read_timeout)
        rows = run_collection_audit(
            w3,
            contract,
            args.blockscout.strip(),
            http_timeout,
            audit_meta_read,
            token_ids_filter,
            args.audit_verbose,
        )
        print_collection_audit_summary(rows, audit_meta_read)
        return

    print("\n--- Per-token URI ---")
    token_uri: str | None = None
    tried: list[str] = []

    for sig in ("tokenURI(uint256)", "uri(uint256)"):
        try:
            tried.append(sig)
            token_uri = call_string_fn(w3, contract, sig, token_id)
            print(f"\n✅ {sig} returned:\n{token_uri}")
            break
        except Exception as e:  # noqa: BLE001 — debug script
            print(f"\n❌ {sig} failed: {e}")

    if token_uri is None:
        raise SystemExit(f"No URI method worked. Tried: {tried}")

    if args.no_fetch_meta:
        return

    print("\nDownloading metadata JSON…")
    try:
        meta, gw_used = fetch_metadata_json(
            token_uri, gateways, http_timeout, try_cli=not args.no_ipfs_cli
        )
    except Exception as e:  # noqa: BLE001
        print("\n⚠️ Could not fetch metadata:", e)
        return

    print("\nMetadata keys:", list(meta.keys()))
    image = meta.get("image") or meta.get("image_url") or meta.get("imageUri")
    print("\nimage field:", image)
    if image:
        print("image URL:", ipfs_to_http(str(image), gw_used))


if __name__ == "__main__":
    main()
