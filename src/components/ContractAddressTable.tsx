import { CONFIG } from '../config'

const RIF_TOKEN_ADDRESS = '0x2AcC95758f8b5F583470ba265EB685a8F45fC9D5'
const BLOCKSCOUT_BASE = 'https://rootstock.blockscout.com/address'

const ADDRESSES: { name: string; address: string }[] = [
  { name: 'RIF Token', address: RIF_TOKEN_ADDRESS },
  { name: 'stRIF', address: CONFIG.STRIF_ADDRESS },
  { name: 'USDRIF', address: CONFIG.USDRIF_ADDRESS },
  { name: 'RIFPRO', address: CONFIG.RIFPRO_ADDRESS },
  { name: 'MoC V2 Core (RoC)', address: CONFIG.MOC_V2_CORE },
  { name: 'RIF Price Feed (RLabs)', address: CONFIG.RIF_PRICE_FEED_RLABS },
]

export function ContractAddressTable() {
  return (
    <footer className="footer">
      <h3 className="footer-title">Contract Addresses</h3>
      <table className="address-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {ADDRESSES.map(({ name, address }) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <a
                  href={`${BLOCKSCOUT_BASE}/${address}?tab=internal_txns`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="address-link"
                >
                  <code>{address}</code>
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </footer>
  )
}
