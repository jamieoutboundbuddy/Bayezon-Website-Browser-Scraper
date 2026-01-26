# Deployment Guide

This guide covers deploying the Website Search Screenshot Tool to **Railway** (recommended) and **Vercel**.

## 🚂 Railway Deployment (Recommended)

Railway is the **recommended platform** for this application because:
- ✅ Full support for Playwright and browser automation
- ✅ Long-running processes (no timeout limits)
- ✅ Persistent file system for artifacts
- ✅ Better performance for background jobs
- ✅ Simpler configuration

### Steps:

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure Deployment**
   - Railway will auto-detect the `Dockerfile` or use `railway.json`
   - Set environment variable: `PORT=3000` (Railway sets this automatically)
   - No additional configuration needed!

4. **Deploy**
   - Railway will automatically build and deploy
   - The build process will:
     - Install dependencies
     - Install Playwright Chromium browser
     - Build TypeScript
     - Start the server

5. **Access Your App**
   - Railway provides a public URL automatically
   - Example: `https://your-app.railway.app`

### Railway Environment Variables (Optional):
```bash
PORT=3000  # Usually set automatically
NODE_ENV=production
```

---

## ▲ Vercel Deployment

**⚠️ Important Notes:**
- Vercel has limitations for Playwright:
  - Serverless functions have 60s timeout (Pro plan: 300s)
  - Playwright browser binaries are large (~300MB)
  - Cold starts can be slow
  - File system is read-only (artifacts may need external storage)

**For production use, Railway is strongly recommended.**

### Steps:

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   cd "Bayezon-Website-Browser-Scraper"
   vercel
   ```
   
   Or deploy from GitHub:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Vercel will auto-detect the configuration

4. **Configure Build Settings**
   - Build Command: `npm run build`
   - Output Directory: `dist` (not used, but required)
   - Install Command: `npm install && npx playwright install --with-deps chromium`

5. **Environment Variables**
   - Set in Vercel dashboard: `VERCEL=1`
   - Optional: `PLAYWRIGHT_BROWSERS_PATH=0`

### Vercel Limitations:
- ⚠️ Function timeout: 60s (free) / 300s (Pro)
- ⚠️ Large Playwright binaries may cause deployment issues
- ⚠️ Consider using external storage (S3, etc.) for artifacts
- ⚠️ Cold starts can be 5-10 seconds

---

## 🔧 Local Testing Before Deployment

### Test Production Build Locally:

```bash
# Build the project
npm run build

# Start production server
npm start
```

### Test Docker Build (for Railway):

```bash
# Build Docker image
docker build -t website-search-tool .

# Run container
docker run -p 3000:3000 website-search-tool
```

---

## 📝 Post-Deployment Checklist

- [ ] Health check endpoint works: `/api/health`
- [ ] Frontend loads: `/`
- [ ] Can create search jobs: `POST /api/search`
- [ ] Can poll job status: `GET /api/search/:jobId`
- [ ] Screenshots are generated and accessible
- [ ] Artifacts directory is writable (Railway) or using external storage (Vercel)

---

## 🐛 Troubleshooting

### Railway Issues:
- **Build fails**: Check that Playwright dependencies are installing correctly
- **Browser not found**: Ensure `npx playwright install --with-deps chromium` runs in build
- **Port issues**: Railway sets PORT automatically, don't hardcode it

### Vercel Issues:
- **Timeout errors**: Increase `maxDuration` in `vercel.json` (requires Pro plan)
- **Function too large**: Playwright binaries may exceed size limits
- **Cold start slow**: Expected with Playwright, consider Railway instead

---

## 💡 Recommendations

1. **Use Railway for production** - Better suited for this type of application
2. **Use Vercel for frontend-only** - If you separate the API and frontend
3. **Consider external storage** - For artifacts on Vercel (S3, Cloudflare R2, etc.)
4. **Monitor resource usage** - Playwright can be memory-intensive

---

## 🔗 Quick Links

- [Railway Dashboard](https://railway.app/dashboard)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [Playwright Deployment Docs](https://playwright.dev/docs/deployment)

