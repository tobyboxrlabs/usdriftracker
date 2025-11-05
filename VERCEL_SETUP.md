# Vercel Deployment - Step by Step Guide

## Quick Setup (5 minutes)

### Step 1: Initialize Git Repository (if not already done)

```bash
cd /Users/tobybox/dev/usdriftracker
git init
git add .
git commit -m "Initial commit: USDRIF Tracker"
```

### Step 2: Create GitHub Repository

1. Go to [github.com](https://github.com) and sign in
2. Click the "+" icon → "New repository"
3. Name it: `usdriftracker` (or any name you prefer)
4. **Don't** initialize with README (since you already have code)
5. Click "Create repository"

### Step 3: Push to GitHub

```bash
# Add your GitHub repo as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/usdriftracker.git

# Push your code
git branch -M main
git push -u origin main
```

### Step 4: Deploy on Vercel

**Option A: Via Web UI (Recommended)**
1. Go to [vercel.com](https://vercel.com)
2. Sign up/Login (use GitHub account for easiest setup)
3. Click "Add New..." → "Project"
4. Import your `usdriftracker` repository
5. Vercel will auto-detect:
   - Framework: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Click "Deploy"
7. Wait ~2 minutes for build to complete
8. Your app will be live at `usdriftracker.vercel.app` (or custom domain if you set one)

**Option B: Via CLI**
```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (in your project directory)
cd /Users/tobybox/dev/usdriftracker
vercel

# Follow prompts:
# - Link to existing project? No
# - Project name: usdriftracker
# - Directory: ./ (current directory)
# - Override settings? No

# For production deployment:
vercel --prod
```

### Step 5: Environment Variables (Optional)

If you need to set any environment variables:
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add any `VITE_*` variables (e.g., `VITE_ROOTSTOCK_RPC`, `VITE_USDRIF_ADDRESS`)
3. Redeploy after adding variables

### Step 6: Automatic Deployments

Once connected to GitHub:
- ✅ Every push to `main` branch = Production deployment
- ✅ Every PR = Preview deployment (automatic)
- ✅ All deployments are automatic, no manual steps needed

## Troubleshooting

**Build fails?**
- Check build logs in Vercel dashboard
- Make sure `package.json` has correct build script
- Verify Node.js version (Vercel uses 18.x by default)

**App doesn't load?**
- Check that `dist` folder is being created correctly
- Verify build output in Vercel dashboard
- Check browser console for errors

**Need custom domain?**
- Go to Project Settings → Domains
- Add your domain
- Follow DNS setup instructions

## Current Configuration

✅ `vercel.json` - Created with correct settings
✅ `package.json` - Has build script
✅ `.gitignore` - Excludes node_modules and dist

You're all set! Just push to GitHub and deploy on Vercel.

