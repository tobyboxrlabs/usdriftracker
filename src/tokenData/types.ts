export interface TokenData {
  stRIFSupply: string
  formattedStRIFSupply: string
  vaultedUsdrif: string | null
  formattedVaultedUsdrif: string | null
  rifproSupply: string
  formattedRifproSupply: string
  minted: string | null
  formattedMinted: string | null
  rifPrice: string | null
  formattedRifPrice: string | null
  rifCollateral: string | null
  formattedRifCollateral: string | null
  maxMintable: string | null
  formattedMaxMintable: string | null
  symbol: string
  name: string
  loading: boolean
  error: string | null
  lastUpdated: Date | null
}

export const INITIAL_TOKEN_DATA: TokenData = {
  stRIFSupply: '0',
  formattedStRIFSupply: '0',
  vaultedUsdrif: null,
  formattedVaultedUsdrif: null,
  rifproSupply: '0',
  formattedRifproSupply: '0',
  minted: null,
  formattedMinted: null,
  rifPrice: null,
  formattedRifPrice: null,
  rifCollateral: null,
  formattedRifCollateral: null,
  maxMintable: null,
  formattedMaxMintable: null,
  symbol: 'USDRIF',
  name: 'USDRIF',
  loading: true,
  error: null,
  lastUpdated: null,
}
