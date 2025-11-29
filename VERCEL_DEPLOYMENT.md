# Deploying to Vercel

This guide will help you deploy your static photo archive site to Vercel.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Vercel CLI installed (optional but recommended): `npm install -g vercel`
3. Your database (`public_site.db`) accessible during build
4. Your config file (`config.yaml`) with production settings

## Option 1: Deploy via Vercel CLI (Recommended)

### Step 1: Build Locally First

Build the static site locally to verify everything works:

```bash
python3 build_static.py --db public_site.db --config config.yaml --output dist
```

### Step 2: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 3: Login to Vercel

```bash
vercel login
```

### Step 4: Deploy

From the project root directory:

```bash
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? (Select your account)
- Link to existing project? **N** (first time) or **Y** (subsequent deployments)
- What's your project's name? **brendan-mulvany-photo-archive** (or your choice)
- In which directory is your code located? **./** (just press Enter)

The CLI will detect your `vercel.json` configuration and deploy.

### Step 5: Production Deployment

For production deployment:

```bash
vercel --prod
```

## Option 2: Deploy via GitHub (Automatic Deployments)

### Step 1: Push to GitHub

If not already done, create a GitHub repository and push your code:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2: Connect to Vercel

1. Go to https://vercel.com/dashboard
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Other
   - **Build Command**: `python3 build_static.py --db public_site.db --config config.yaml --output dist`
   - **Output Directory**: `dist`
   - **Install Command**: `pip3 install -r requirements.txt` (if you have one)

### Step 3: Add Environment Variables (if needed)

In Vercel dashboard → Settings → Environment Variables, add:
- Any API keys for R2/CDN
- Database connection strings (if remote)

### Step 4: Deploy

Click "Deploy" - Vercel will build and deploy automatically.

## Important Files

### vercel.json
Already configured in your project. It handles:
- Static file serving from `/dist`
- Route configuration

### .vercelignore
Already configured to exclude:
- Local databases
- Local config files
- Python cache
- Development files

## Build Process on Vercel

Since `dist/` is in `.vercelignore`, Vercel needs to build it. You have two options:

### Option A: Build Locally, Deploy Static Files Only

1. Remove `dist/` from `.vercelignore`
2. Build locally: `python3 build_static.py`
3. Commit the `dist/` folder to git
4. Deploy to Vercel

This is simpler but increases repo size.

### Option B: Build on Vercel (Current Setup)

Vercel will run the build command during deployment. Requirements:
- Database must be accessible (upload to Vercel or use remote DB)
- Config file must be available
- Python dependencies must be installed

## Updating the Site

### If Building Locally:
```bash
# 1. Build
python3 build_static.py --db public_site.db --config config.yaml

# 2. Deploy
vercel --prod
```

### If Building on Vercel (GitHub):
```bash
# Just push to GitHub
git add .
git commit -m "Update content"
git push

# Vercel will automatically rebuild and deploy
```

## Updating Featured Images

1. Run the featured selector locally:
   ```bash
   python3 featured_selector.py
   ```

2. Select featured images and save

3. Rebuild and deploy:
   ```bash
   python3 build_static.py --db public_site.db --config config.yaml
   vercel --prod
   ```

## Troubleshooting

### Build fails on Vercel
- Check build logs in Vercel dashboard
- Ensure `config.yaml` exists (not just `config.local.yaml`)
- Verify database is accessible during build

### Images not loading
- Verify R2/CDN URLs in `config.yaml`
- Check CORS settings on your CDN

### Featured carousel not appearing
- Ensure `featured.json` is committed to git
- Rebuild the static site

## Performance Tips

1. **Use CDN for images**: Your setup already uses R2/CDN
2. **Enable Vercel's Edge Network**: Automatic with Vercel
3. **Set cache headers**: Already configured in `vercel.json`

## Custom Domain

To use a custom domain:

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your domain
3. Update DNS records as instructed by Vercel

## Cost

- Vercel Free tier includes:
  - Unlimited bandwidth
  - Automatic HTTPS
  - Global CDN
  - Perfect for static sites

- R2/Cloudflare for images (your current setup):
  - Check Cloudflare R2 pricing for your usage
