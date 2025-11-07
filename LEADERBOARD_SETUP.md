# Setting Up Vercel KV (Redis) for Leaderboard

## Step 1: Install Vercel KV Package

```bash
npm install @vercel/kv
```

## Step 2: Create a Vercel KV Database

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`usdriftracker`)
3. Go to the **Storage** tab (or **KV** in the sidebar)
4. Click **Create Database** → Select **KV**
5. Give it a name (e.g., `usdriftracker-kv`)
6. Select a region (choose one closest to your users)
7. Click **Create**

## Step 3: Link KV to Your Project

After creating the KV database:

1. In the KV database page, click **Connect to Project**
2. Select your `usdriftracker` project
3. Vercel will automatically add the required environment variables:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`

## Step 4: Verify Environment Variables

1. Go to your project → **Settings** → **Environment Variables**
2. Verify these are present:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN` (optional, for read-only operations)

## Step 5: Update the API Code

The `api/scores.ts` file is already set up to use Vercel KV if available. It will:
- Automatically detect if `@vercel/kv` is installed
- Use KV for persistent storage if available
- Fall back to in-memory storage if KV is not configured

## Step 6: Redeploy

After setting up KV:

1. Push your changes to GitHub (if using Git integration)
2. Or manually redeploy from Vercel Dashboard
3. The leaderboard will now persist across deployments!

## Testing

1. Play the game and submit a score
2. Check the leaderboard - it should show your score
3. Refresh the page - the score should still be there
4. The leaderboard is now shared across all users!

## Troubleshooting

### If scores aren't persisting:

1. **Check environment variables are set:**
   - Go to Vercel Dashboard → Project → Settings → Environment Variables
   - Ensure `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present

2. **Check KV database is linked:**
   - Go to Storage tab → Verify your KV database is connected to the project

3. **Check API logs:**
   - Go to Vercel Dashboard → Project → Functions → View logs
   - Look for any errors in `/api/scores`

4. **Verify package is installed:**
   ```bash
   npm list @vercel/kv
   ```

### Free Tier Limits

Vercel KV free tier includes:
- 256 MB storage
- 30,000 requests/day
- Perfect for a leaderboard!

## Alternative: Using External Redis

If you prefer to use an external Redis service (like Upstash, Redis Cloud, etc.):

1. Get your Redis connection URL
2. Add it as `REDIS_URL` environment variable
3. Update `api/scores.ts` to use the external Redis client instead

