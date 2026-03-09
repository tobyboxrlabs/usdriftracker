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
