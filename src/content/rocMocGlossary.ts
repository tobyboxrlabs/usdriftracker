/** Terms used in metrics, tooltips, and RoC V3 / MoC protocol context. */
export const ROC_MOC_GLOSSARY: { term: string; description: string }[] = [
  {
    term: 'AC (Asset Collateral)',
    description: 'Collateral held in a bucket bag (RIF on the RIF bucket, DOC on the DOC bucket).',
  },
  {
    term: 'TP (Token Peg)',
    description: 'Stable peg token in the protocol; USDRIF is the TP tracked on this app.',
  },
  {
    term: 'TC (Token Collateral)',
    description: 'Risk/collateral token in the bucket (e.g. RIFPRO); distinct from AC and TP.',
  },
  {
    term: 'nACcb',
    description: 'Total asset collateral amount in the bucket collateral bag (on-chain storage).',
  },
  {
    term: 'getLckAC / lckAC',
    description: 'Collateral asset locked to back outstanding pegged tokens (derived from nTP and prices).',
  },
  {
    term: 'getCtargemaCA',
    description: 'Bucket target coverage adjusted by EMA of collateral asset prices (global to the bucket).',
  },
  {
    term: 'getCtargemaTP',
    description: 'Target coverage adjusted for a specific pegged token (e.g. USDRIF), used in mintable math.',
  },
  {
    term: 'getPACtp',
    description: 'Collateral asset price expressed in pegged-token units (oracle-derived for USDRIF).',
  },
  {
    term: 'lckACemaAdjusted',
    description: 'Headroom before coverage binds: nACcb×1e18 − ctargemaCA×lckAC; drives mintable capacity.',
  },
  {
    term: 'getTPAvailableToMint',
    description: 'On-chain max USDRIF mintable from the RIF bucket; includes multi-collateral guard limits.',
  },
  {
    term: 'MoC V2 Core (MocRif proxy)',
    description: 'RIF bucket contract (0xA270…); upgraded to V3 logic while keeping the same proxy address.',
  },
  {
    term: 'MocMultiCollateralGuard',
    description: 'Coordinates health and mint/redeem capacity across RIF and DOC buckets after V3.',
  },
  {
    term: 'Target coverage (Ctarg / tpCtarg)',
    description: 'Objective coverage ratio for a token or bucket; dApp “T. Coverage” on a row may show tpCtarg (~5.5).',
  },
  {
    term: 'Coverage ratio (cglb)',
    description: 'Current bucket coverage (collateral vs locked); dApp “Coverage” global metric (~11+).',
  },
]
