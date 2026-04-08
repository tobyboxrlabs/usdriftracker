/**
 * Address normalization utilities
 * Centralizes address checksumming logic to avoid repetition
 */
import { ethers } from 'ethers'

/**
 * Normalize Ethereum address to checksummed format
 * Handles invalid checksums by converting to lowercase first
 * 
 * @param address - Ethereum address string (may be checksummed or lowercase)
 * @returns Checksummed address string
 */
export function normalizeAddress(address: string): string {
  try {
    return ethers.getAddress(address)
  } catch {
    // If checksum is invalid, try lowercase first
    return ethers.getAddress(address.toLowerCase())
  }
}

/**
 * Normalize address to lowercase (for comparisons)
 * Useful when comparing addresses where checksum doesn't matter
 * 
 * @param address - Ethereum address string
 * @returns Lowercase address string
 */
export function normalizeAddressToLower(address: string): string {
  return address.toLowerCase()
}

/**
 * Return EIP-55 checksummed address, or null if not valid 20-byte hex
 * (invalid length, bad checksum, or non-hex).
 */
export function parseEvmAddressOrNull(input: string): string | null {
  const t = input?.trim()
  if (!t || !/^0x[a-fA-F0-9]{40}$/.test(t)) return null
  try {
    return ethers.getAddress(t)
  } catch {
    return null
  }
}
