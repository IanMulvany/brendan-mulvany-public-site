# Cloudflare R2 Manifest Configuration Guide

## Problem

When accessing extensionless manifest URLs like `https://cdn.brendan-mulvany-photography.com/2025-11-04-batch-1-DSCF1526`, Cloudflare is returning the JSON manifest file (`application/json`) instead of automatically resolving it to serve the appropriate image variant.

## Root Cause

R2 manifests require **Cloudflare to automatically resolve the manifest JSON and serve the best image variant** based on:
- Browser capabilities (AVIF > WebP > JPEG)
- Accept headers
- Device pixel ratio
- Image size requirements

This automatic resolution **does not happen by default** - it requires Cloudflare configuration.

## Required Cloudflare Configuration

### Option 1: Cloudflare Worker (Recommended)

You need a Cloudflare Worker deployed on your custom domain (`cdn.brendan-mulvany-photography.com`) that:

1. **Intercepts requests** to extensionless URLs (e.g., `/2025-11-04-batch-1-DSCF1526`)
2. **Fetches the manifest** from R2 at `{path}/manifest.json`
3. **Parses the manifest** to determine available variants
4. **Selects the best variant** based on:
   - Browser Accept headers (prefer AVIF, then WebP, then JPEG)
   - Image size requirements (if provided via query params or srcset)
   - Device pixel ratio
5. **Serves the selected variant** with appropriate Content-Type header

#### Worker Example Logic:

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Check if this is an extensionless path (no file extension)
    if (!path.match(/\.(jpg|jpeg|png|webp|avif|json)$/i)) {
      // Fetch manifest from R2
      const manifestKey = `${path}/manifest.json`;
      const manifest = await env.R2_BUCKET.get(manifestKey);
      
      if (!manifest) {
        return new Response('Manifest not found', { status: 404 });
      }
      
      const manifestData = await manifest.json();
      
      // Determine best variant based on Accept header
      const accept = request.headers.get('Accept') || '';
      let selectedVariant = manifestData.variants.original; // fallback
      
      if (accept.includes('image/avif')) {
        selectedVariant = manifestData.variants.large || 
                         manifestData.variants.small || 
                         manifestData.variants.thumb ||
                         manifestData.variants.original;
      } else if (accept.includes('image/webp')) {
        selectedVariant = manifestData.variants.large_webp || 
                         manifestData.variants.small_webp || 
                         manifestData.variants.thumb_webp ||
                         manifestData.variants.original;
      }
      
      // Fetch and serve the selected variant
      const variantKey = selectedVariant.path;
      const variant = await env.R2_BUCKET.get(variantKey);
      
      if (!variant) {
        return new Response('Variant not found', { status: 404 });
      }
      
      return new Response(variant.body, {
        headers: {
          'Content-Type': selectedVariant.contentType,
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
    
    // For files with extensions, serve directly from R2
    return env.R2_BUCKET.fetch(request);
  },
};
```

### Option 2: Cloudflare Transform Rules

Cloudflare Transform Rules might be able to handle this, but Workers provide more flexibility for manifest resolution logic.

### Option 3: Cloudflare Pages Functions

If using Cloudflare Pages, you can use Pages Functions to handle manifest resolution.

## Current State

- ✅ Manifest files are uploaded to R2 at `{scene_id}/manifest.json`
- ✅ Extensionless manifest files are uploaded to R2 at `{scene_id}` (the JSON file)
- ✅ Variant files are uploaded to R2 at `{scene_id}/{variant}.{ext}`
- ✅ Custom domain is configured: `cdn.brendan-mulvany-photography.com`
- ❌ **Missing: Cloudflare Worker to resolve manifests**

## Next Steps

1. **Create a Cloudflare Worker** that handles manifest resolution
2. **Deploy the Worker** to your custom domain (`cdn.brendan-mulvany-photography.com`)
3. **Configure the Worker** to route extensionless URLs through manifest resolution
4. **Test** that `https://cdn.brendan-mulvany-photography.com/2025-11-04-batch-1-DSCF1526` serves an image, not JSON

## References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 with Workers](https://developers.cloudflare.com/r2/data-access/workers-api/)
- [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Alternative: Direct Variant URLs

If you don't want to set up a Worker, you can use direct variant URLs:
- `https://cdn.brendan-mulvany-photography.com/{scene_id}/original.jpg`
- `https://cdn.brendan-mulvany-photography.com/{scene_id}/large.avif`
- etc.

But this loses the automatic variant selection benefits of manifests.

