# Quick Deploy to Vercel

The simplest way to deploy your static photo archive to Vercel.

## Prerequisites

1. **Vercel CLI installed**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

## Deploy in 3 Steps

### 1. Build the Static Site

```bash
python3 build_static.py --db public_site.db --config config.local.yaml --output dist
```

This will generate all static HTML files in the `dist/` folder.

### 2. Deploy to Vercel

**For testing (preview deployment):**
```bash
vercel
```

**For production:**
```bash
vercel --prod
```

That's it! Vercel will upload the `dist/` folder and serve your site.

## Using the Deploy Script

Even easier - use the included deploy script:

```bash
./deploy.sh
```

This will:
1. Build the static site
2. Show you build stats
3. Ask if you want preview or production
4. Deploy to Vercel

## Updating Your Site

### Update Featured Images

1. Run the selector:
   ```bash
   python3 featured_selector.py
   ```
   Open http://localhost:5555 and select images

2. Rebuild and deploy:
   ```bash
   ./deploy.sh
   ```

### Update Content

1. Make changes to your database
2. Rebuild:
   ```bash
   python3 build_static.py --db public_site.db --config config.local.yaml
   ```
3. Deploy:
   ```bash
   vercel --prod
   ```

## Your Vercel URLs

- **Preview**: Vercel will give you a URL like `https://your-project-abc123.vercel.app`
- **Production**: `https://your-project.vercel.app`
- **Custom Domain**: Set up in Vercel dashboard

## Troubleshooting

**"vercel: command not found"**
```bash
npm install -g vercel
```

**Build fails**
- Check that `public_site.db` exists
- Check that `config.local.yaml` exists
- Try building manually first to see errors

**Images not loading**
- Verify your R2/CDN URLs in `config.local.yaml`
- Check that images are uploaded to your CDN

## Need Help?

See the full deployment guide: `VERCEL_DEPLOYMENT.md`
