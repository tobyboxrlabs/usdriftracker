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
VITE_STRIF_ADDRESS=0x5db91e24BD32059584bbDb831A901f1199f3d459
VITE_USDRIF_ADDRESS=0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37
VITE_RIFPRO_ADDRESS=0xF4d27C56595eD59B66cC7f03CFF5193E4Bd74a61
VITE_MOC_STATE_ADDRESS=0xb9C42EFc8ec54490a37cA91c423F7285Fa01e257
```

For local development with leaderboard functionality:

```env
REDIS_URL=your_redis_url_here
```

For production (Vercel), set these environment variables in Vercel dashboard:

```env
# Upstash Redis (for rate limiting and leaderboard)
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token

# Or use legacy Vercel KV variables (backward compatible)
KV_REST_API_URL=your_kv_rest_api_url
KV_REST_API_TOKEN=your_kv_rest_api_token

# Optional: Customize rate limit (default: 60 requests per minute)
RATE_LIMIT_REQUESTS_PER_MINUTE=60
```

For production API security (CORS configuration):

```env
# Comma-separated list of allowed origins (required for production)
# Example: "https://usdriftracker.vercel.app,https://usdriftracker.com"
# Leave unset or use "*" for development (allows all origins)
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
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

