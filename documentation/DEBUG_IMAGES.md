# Debugging Image Loading Issues

## Issue: Images not loading on localhost:8000

### Quick Checks

1. **Open browser console** (F12 or Cmd+Option+I)
   - Look for errors related to images
   - Check Network tab to see if image requests are failing

2. **Check if CDN URLs are accessible**:
   ```bash
   curl -I "https://cdn.brendan-mulvany-photography.com/2025-11-04-batch-1-DSCF1526/thumb.avif"
   ```
   Should return HTTP 200

3. **Check CORS headers**:
   ```bash
   curl -H "Origin: http://localhost:8000" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS \
        "https://cdn.brendan-mulvany-photography.com/2025-11-04-batch-1-DSCF1526/thumb.avif" \
        -v
   ```

### Common Issues

#### 1. CORS Blocking
**Symptom**: Console shows CORS errors

**Solution**: CDN needs to allow `localhost` origin. Check Cloudflare R2 CORS settings.

#### 2. Mixed Content
**Symptom**: Browser blocks HTTPS images on HTTP page

**Solution**: Modern browsers usually allow this, but if blocked:
- Use `--use-api-urls` flag (requires FastAPI server running)
- Or serve static site over HTTPS locally

#### 3. Wrong URLs
**Symptom**: 404 errors in Network tab

**Solution**: Check that `r2_key` values in database match actual R2 paths

### Testing Options

#### Option 1: Use CDN URLs (default)
```bash
python3 build_static.py
cd dist
python3 -m http.server 8000
```
- Images load from production CDN
- Requires CDN to be accessible and CORS configured

#### Option 2: Use API URLs (for local testing)
```bash
# Terminal 1: Start FastAPI server
python3 main.py  # or uv run python main.py

# Terminal 2: Build with API URLs
python3 build_static.py --use-api-urls
cd dist
python3 -m http.server 8000
```
- Images load from local FastAPI server
- Requires FastAPI server running on port 8001

#### Option 3: Use test script with API URLs
```bash
./test_static_site.sh --use-api-urls
```

### Verify Image URLs

Check what URLs are generated:
```bash
# Check first image URL in generated HTML
grep -o '"thumbnail_url":"[^"]*"' dist/index.html | head -1
```

Should be either:
- CDN: `https://cdn.brendan-mulvany-photography.com/...`
- API: `/api/public/images/{image_id}/thumbnail`

### Browser Console Debugging

Open browser console and check:
1. **Network tab**: Are image requests being made? What's the status?
2. **Console tab**: Any CORS or other errors?
3. **Elements tab**: Check `<img>` tags - are `src` attributes correct?

### Quick Fix: Rebuild with API URLs

If CDN isn't working locally, rebuild with API URLs:

```bash
# Rebuild with API URLs
python3 build_static.py --use-api-urls

# Make sure FastAPI is running (in another terminal)
# python3 main.py

# Then serve static site
cd dist
python3 -m http.server 8000
```

Note: With API URLs, you need the FastAPI server running to serve images.

