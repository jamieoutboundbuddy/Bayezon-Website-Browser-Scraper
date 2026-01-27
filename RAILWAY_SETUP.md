# Railway Deployment - Quick Setup Guide

## ✅ What's Already Configured

- ✅ Express server with static file serving
- ✅ Frontend HTML/CSS/JS in `public/` folder
- ✅ API endpoints (`/api/search`, `/api/search/:jobId`)
- ✅ Dockerfile for Railway
- ✅ Build configuration
- ✅ All code pushed to GitHub

## 🚀 Deploy on Railway (5 minutes)

### Step 1: Connect Repository
1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `jamieoutboundbuddy/Bayezon-Website-Browser-Scraper`
5. Select `master` branch (not `main`)

### Step 2: Railway Auto-Detects Everything
- ✅ Detects Dockerfile
- ✅ Auto-builds the project
- ✅ Installs Playwright Chromium
- ✅ Starts the server

### Step 3: Get Your Public URL
1. Railway automatically generates a public URL
2. Example: `https://your-app-name.railway.app`
3. Click "Settings" → "Generate Domain" if needed

### Step 4: Test Your Deployment
- Frontend: `https://your-app.railway.app/`
- Health: `https://your-app.railway.app/api/health`
- Test search: Use the UI to search a website

## 🔧 Environment Variables (Optional)

Railway sets these automatically:
- `PORT` - Set by Railway (usually 3000)
- `NODE_ENV` - Set to `production`

**No additional configuration needed!**

## 📋 What Happens on Deploy

1. **Build Phase** (5-10 min first time):
   - Installs Node.js dependencies
   - Downloads Playwright Chromium (~300MB)
   - Builds TypeScript to JavaScript
   - Creates `dist/` folder

2. **Deploy Phase** (1-2 min):
   - Starts Express server
   - Serves static files from `public/`
   - API endpoints available at `/api/*`
   - Screenshots saved to `artifacts/`

3. **Runtime**:
   - Server runs continuously
   - Frontend accessible at root `/`
   - API accessible at `/api/*`
   - Screenshots accessible at `/artifacts/*`

## 🎯 Your Public URLs

After deployment, you'll have:

- **Frontend**: `https://your-app.railway.app/`
  - The search form UI
  - Screenshot display
  - All client-side functionality

- **API Endpoints**:
  - `POST https://your-app.railway.app/api/search` - Create search job
  - `GET https://your-app.railway.app/api/search/:jobId` - Get job status
  - `GET https://your-app.railway.app/api/health` - Health check

- **Screenshots**: `https://your-app.railway.app/artifacts/:jobId/:domain/screens/*.jpg`

## ✅ Verification Checklist

After deployment, verify:

- [ ] Frontend loads at root URL
- [ ] Search form is visible
- [ ] Can submit a search (e.g., `zone3.com` + `wetsuit`)
- [ ] Job polling works (progress bar updates)
- [ ] Screenshots appear after completion
- [ ] Health endpoint returns `{"status":"ok"}`

## 🐛 Troubleshooting

### Frontend not loading?
- Check Railway logs for errors
- Verify `public/` folder is in the repo
- Check that static file serving is enabled

### API calls failing?
- Check browser console for CORS errors
- Verify API endpoints are accessible
- Check Railway logs for server errors

### Screenshots not showing?
- Verify `artifacts/` directory is writable
- Check file permissions
- Look for errors in Railway logs

## 🎉 That's It!

Once deployed, your app will be publicly accessible with:
- ✅ Working frontend UI
- ✅ Functional API endpoints
- ✅ Screenshot generation
- ✅ Public URL you can share

No additional setup needed - Railway handles everything!


