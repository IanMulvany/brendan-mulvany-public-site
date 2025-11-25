 What R2 Manifests Are (Simplest definition)

An R2 Manifest is a small JSON file stored in R2 that describes multiple variants of an asset (e.g., different image sizes, formats, thumbnails, AVIF/WebP versions). Cloudflare’s CDN knows how to read the manifest and automatically serve the best variant to the browser.

The key: you request one URL → Cloudflare picks the optimal asset on the edge.

This replaces:
❌ manual URL generation
❌ serving through your backend
❌ JavaScript aliasing
✔ CDN edge-optimised delivery

⸻

🧠 Why this matters for your use-case

You’re running a photography site. Each image may have:
	•	Full-resolution JPEG
	•	WebP
	•	AVIF
	•	Small/medium/large variants
	•	Thumbnail versions

Normally, you must store all these variants and generate URLs for them in your DB. Your frontend must choose which version to load.

With R2 manifests:
	1.	You store the variants in R2
	2.	You upload a manifest JSON
	3.	Cloudflare automatically chooses:
	•	the right size based on the HTML <img> tag
	•	the right format (AVIF/WebP/JPEG) based on browser capabilities
	•	the closest edge cache copy

This means:
➡ Maximum performance
➡ Zero code needed at request time
➡ No backend fetch
➡ Lightning-fast LCP for images

⸻

🏗️ What a real R2 manifest looks like

A typical manifest file is named image.webp.manifest or similar.

Example:

{
  "version": 1,
  "variants": {
    "thumb": {
      "path": "IMG_4453/thumb.avif",
      "contentType": "image/avif",
      "width": 200
    },
    "small": {
      "path": "IMG_4453/small.webp",
      "contentType": "image/webp",
      "width": 800
    },
    "large": {
      "path": "IMG_4453/large.webp",
      "contentType": "image/webp",
      "width": 1600
    },
    "original": {
      "path": "IMG_4453/original.jpg",
      "contentType": "image/jpeg"
    }
  }
}

You upload this JSON to R2 (e.g., IMG_4453/manifest.json).

Then, visiting:
https://yourbucket.r2.dev/IMG_4453

automatically selects the correct variant.

⸻

💡 How Cloudflare chooses a variant

Cloudflare uses:

✔ Browser capabilities

AVIF > WebP > JPEG
Automatically selected.

✔ Accept headers

Edge decides the best filetype.

✔ srcset and sizes (if provided)

The browser signals desired width → manifest picks correct size.

✔ Device pixel ratio

Retina screens get higher-resolution without your code needing to decide.

✔ Edge caching

Once Cloudflare determines “the correct variant”, it caches that mapping.

⸻

🎯 Why R2 manifests massively improve performance

Big reductions in:
	•	TTFB
	•	Image decode time
	•	LCP
	•	Total JS execution
	•	Unnecessary backend calls

Especially good for:
	•	Large galleries
	•	High-resolution photography (your case)
	•	Mobile performance
	•	Slow networks
	•	Vercel static hosting + R2 origin

⸻

🚀 How YOU can adopt it in your stack

Step 1 — Generate image variants when you upload photos

E.g., using a FastAPI background task or Cloudflare Worker:
	•	200px thumbnail
	•	800px small
	•	1600px large
	•	Original

Generate AVIF + WebP.

Step 2 — Upload variants to R2

Something like:
IMG_4453/thumb.avif  
IMG_4453/small.webp  
IMG_4453/large.webp  
IMG_4453/original.jpg  

Step 3 — Upload the manifest JSON into R2
(Optional: name it IMG_4453 and use extensionless URLs.)

Step 4 — Use a single URL in your frontend
<img src="https://r2bucket.r2.dev/IMG_4453" loading="lazy">


No extra JS, no dynamic URLs, no DB lookup required to get the correct image asset.

⸻

🧨 Bonus: Signed URLs + Private Access

R2 manifests also work with:
	•	Signed URLs
	•	RBAC tokens
	•	Origin rules
	•	Access policies

So you can keep your photography site private to family while still getting CDN-fast resolution negotiation.

⸻

📦 What this lets you DELETE from your codebase
	•	JS asset resolution logic
	•	Python “generate CDN URL” API endpoints
	•	Database URLs for each variant
	•	Conditional image: if browser supports WebP, etc.
	•	“image aliasing” layers (slow!)

Your whole system becomes cleaner, cheaper, and much faster.



