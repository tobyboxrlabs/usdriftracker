# Deployment Guide for USDRIF Tracker

This Vite + React app can be deployed to various platforms. Here are the best options:

## Option 1: Vercel (Recommended - Easiest)

**Best for:** Quick deployment, automatic builds, great DX

### Steps:
1. **Install Vercel CLI** (optional but recommended):
   ```bash
   npm install -g vercel
   ```

2. **Build locally first** (to test):
   ```bash
   npm run build
   ```

3. **Deploy via CLI**:
   ```bash
   vercel
   ```
   Follow the prompts - it will detect Vite automatically.

4. **Or deploy via GitHub**:
   - Push your code to GitHub
   - Go to [vercel.com](https://vercel.com)
   - Sign up/login with GitHub
   - Click "New Project"
   - Import your repository
   - Vercel will auto-detect Vite settings
   - Click "Deploy"

5. **Environment Variables** (if needed):
   - In Vercel dashboard → Project Settings → Environment Variables
   - Add any `VITE_*` variables you need

**Pros:**
- ✅ Free tier (generous)
- ✅ Automatic HTTPS
- ✅ Global CDN
- ✅ Automatic deployments on git push
- ✅ Preview deployments for PRs

**URL:** Your app will be live at `your-project.vercel.app`

---

## Option 2: Netlify

**Best for:** Similar to Vercel, great free tier

### Steps:
1. **Install Netlify CLI** (optional):
   ```bash
   npm install -g netlify-cli
   ```

2. **Create `netlify.toml`** (I'll create this for you):
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"
   
   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

3. **Deploy via CLI**:
   ```bash
   netlify deploy --prod
   ```

4. **Or deploy via GitHub**:
   - Push code to GitHub
   - Go to [netlify.com](https://netlify.com)
   - Sign up/login with GitHub
   - Click "Add new site" → "Import an existing project"
   - Select your repo
   - Build settings:
     - Build command: `npm run build`
     - Publish directory: `dist`
   - Click "Deploy site"

**Pros:**
- ✅ Free tier
- ✅ Automatic HTTPS
- ✅ Form handling
- ✅ Serverless functions support

---

## Option 3: GitHub Pages

**Best for:** Free hosting for public repos

### Steps:
1. **Install gh-pages**:
   ```bash
   npm install --save-dev gh-pages
   ```

2. **Add to `package.json`**:
   ```json
   {
     "scripts": {
       "predeploy": "npm run build",
       "deploy": "gh-pages -d dist"
     },
     "homepage": "https://yourusername.github.io/usdriftracker"
   }
   ```

3. **Update `vite.config.ts`** to set base path:
   ```typescript
   export default defineConfig({
     base: '/usdriftracker/', // Your repo name
     plugins: [react()],
   })
   ```

4. **Deploy**:
   ```bash
   npm run deploy
   ```

**Pros:**
- ✅ Free
- ✅ Integrated with GitHub
- ✅ Good for open source projects

**Cons:**
- ⚠️ Must be public repo (or GitHub Pro)
- ⚠️ Requires base path configuration

---

## Option 4: Cloudflare Pages

**Best for:** Fast global CDN, generous free tier

### Steps:
1. **Push code to GitHub/GitLab**

2. **Go to Cloudflare Dashboard**:
   - Navigate to "Pages"
   - Click "Create a project"
   - Connect your Git provider
   - Select your repository

3. **Build settings**:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Framework preset: Vite

4. **Deploy**

**Pros:**
- ✅ Free tier (unlimited)
- ✅ Very fast CDN
- ✅ Automatic HTTPS
- ✅ Custom domains

---

## Option 5: Surge.sh (Simplest)

**Best for:** Quick deployment without git

### Steps:
1. **Install Surge**:
   ```bash
   npm install -g surge
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Deploy**:
   ```bash
   cd dist
   surge
   ```
   Follow prompts (first time requires signup)

**Pros:**
- ✅ Very simple
- ✅ Free tier
- ✅ Custom domains

**Cons:**
- ⚠️ No automatic deployments
- ⚠️ Manual updates only

---

## Pre-Deployment Checklist

- [ ] Test build locally: `npm run build`
- [ ] Test preview: `npm run preview`
- [ ] Verify environment variables (if any)
- [ ] Check `.gitignore` includes `dist/` and `node_modules/`
- [ ] Ensure all sensitive data is in environment variables

## Recommended: Vercel or Netlify

For this project, I recommend **Vercel** or **Netlify** because:
- Automatic deployments from Git
- Easy environment variable management
- Free HTTPS
- Great performance
- Simple setup

Would you like me to create the configuration files for your preferred platform?

