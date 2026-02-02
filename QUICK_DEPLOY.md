# Quick Deployment Guide

## 🚂 Railway (Recommended - 5 minutes)

1. **Push to GitHub** (if not already)
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway auto-detects Dockerfile
   - Wait for deployment (~3-5 minutes)
   - Get your public URL!

**That's it!** Railway handles everything automatically.

---

## ▲ Vercel (Alternative - 3 minutes)

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy**
   ```bash
   cd "Bayezon-Website-Browser-Scraper"
   vercel
   ```
   
   Follow the prompts, or:
   - Go to [vercel.com](https://vercel.com)
   - Import GitHub repo
   - Deploy

**Note:** Vercel has limitations with Playwright (timeouts, cold starts). Railway is recommended.

---

## ✅ Verify Deployment

After deployment, test:
- Health: `https://your-app.railway.app/api/health`
- Frontend: `https://your-app.railway.app/`
- Test search: Submit a search job via the UI

---

## 🔧 Environment Variables

**Railway:** Usually none needed (auto-detects PORT)

**Vercel:** Set in dashboard:
- `VERCEL=1`
- `PLAYWRIGHT_BROWSERS_PATH=0`

---

## 📚 Full Guide

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions and troubleshooting.



