# USDRIF Tracker

A simple application to view RIF-related proxy metrics on Rootstock. This dashboard provides real-time insights into RIF token metrics, collateral, and minting capacity for the RIF on Chain (RoC) protocol.

## Features

- **Real-time Metrics**: View up-to-date RIF token metrics including:
  - Staked RIF in Collective
  - RIFPRO Total Supply
  - USDRIF Minted
  - RIF Price
  - RIF Collateral Backing USDRIF
  - USDRIF Mintable
- **Historical Data**: Mini line graphs showing metric trends over time
- **Interactive Game**: Light Cycle game with global leaderboard

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd usdriftracker

# Install dependencies
npm install
```

### Environment Variables

Create a `.env.local` file in the root directory with the following variables (optional, defaults are provided):

```env
VITE_ROOTSTOCK_RPC=https://public-node.rsk.co
VITE_USDRIF_ADDRESS=0x5db91e24BD32059584bbDb831A901f1199f3d459
VITE_USDRIF_OLD_ADDRESS=0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37
VITE_RIFPRO_ADDRESS=0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61
VITE_MOC_STATE_ADDRESS=0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257
```

For local development with leaderboard functionality:

```env
REDIS_URL=your_redis_url_here
```

### Running Locally

**Option 1: Vite Dev Server (Frontend only)**
```bash
npm run dev
```

**Option 2: Vercel Dev (Frontend + API)**
```bash
npm run dev:vercel
```

The application will be available at `http://localhost:5173` (Vite) or `http://localhost:3000` (Vercel).

### Building for Production

```bash
npm run build
```

The production build will be in the `dist` directory.

## Project Structure

```
usdriftracker/
├── api/              # Vercel serverless functions
│   ├── analytics.ts  # Deployment analytics
│   └── scores.ts     # Leaderboard API
├── public/           # Static assets
├── src/
│   ├── App.tsx       # Main application component
│   ├── config.ts     # Configuration and contract addresses
│   ├── history.ts    # Historical data management
│   ├── LightCycleGame.tsx  # Light Cycle game component
│   └── MiniLineGraph.tsx   # Graph visualization component
└── vercel.json       # Vercel deployment configuration
```

## Technologies

- **React** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Ethers.js** - Blockchain interactions
- **Vercel** - Hosting and serverless functions
- **Redis/Vercel KV** - Leaderboard storage

## Deployment

This project is configured for deployment on Vercel. See [VERCEL_SETUP.md](./VERCEL_SETUP.md) for detailed deployment instructions.

### Quick Deploy

1. Push your code to GitHub
2. Import the repository in Vercel
3. Vercel will auto-detect the configuration
4. Add environment variables in Vercel dashboard
5. Deploy!

## License

[Add your license here]

