# Performance Debugging Guide

## Issues Found and Fixed

### ✅ Fixed: N+1 Query Problem in Similar Images Endpoint

**Problem**: The `/api/public/similar` endpoint was making 2 database queries per similar image:
- `get_scene(scene_id)` 
- `get_current_version_for_scene(scene_id)`

For 20 similar images, that's **40 additional queries**!

**Fix**: The `find_similar_scenes()` function already returns `batch_name`, `base_filename`, `capture_date`, and `r2_key` from a JOIN query. Removed the redundant queries.

**Impact**: Reduces database queries from ~40 to 0 for similar images endpoint.

### ⚠️ Remaining Performance Issues

#### 1. `image_id_to_scene_id()` Brute Force Search

**Location**: `main.py` line 233-244

**Problem**: 
- Loads ALL scenes from database (up to 10,000)
- Loops through them in Python to find matching hash
- Takes ~23ms locally, likely much slower on Turso with network latency

**Current Implementation**:
```python
def image_id_to_scene_id(image_id: int) -> Optional[str]:
    all_scenes = public_db.get_scenes(batch_name=None, limit=10000, offset=0)
    for scene in all_scenes:
        if scene_id_to_image_id(scene['scene_id']) == image_id:
            return scene['scene_id']
```

**Potential Solutions**:
1. **Add a cache** (in-memory or Redis) mapping `image_id -> scene_id`
2. **Add a database column** `image_id` to `scenes` table and index it
3. **Use a lookup table** mapping `image_id -> scene_id`

#### 2. Similarity Search Loads All Images

**Location**: `database.py` line 780

**Problem**: 
- `find_similar_scenes()` calls `get_live_versions(limit=10000)` 
- Loads ALL live images into memory
- Then loops through them in Python to calculate Hamming distances

**Current Performance**: ~1ms locally, but will scale poorly as image count grows.

**Potential Solutions**:
1. **SQL-based Hamming distance** (if SQLite/Turso supports it)
2. **Pre-computed similarity index** (store similar images in a table)
3. **Limit search scope** (e.g., only search within same batch or date range)

#### 3. Turso Network Latency

**Problem**: 
- Turso is a remote database
- Each query has network round-trip time
- Vercel serverless functions may have cold starts

**Solutions**:
1. **Connection pooling** (if supported)
2. **Batch queries** where possible
3. **Caching** frequently accessed data
4. **Consider local SQLite** for read-heavy operations (if possible)

## Debugging Tools

### 1. Performance Debug Script

Run locally to measure each operation:
```bash
python3 debug_image_page_performance.py
```

### 2. Add Timing Logs to API Endpoints

Add timing middleware or logging to measure endpoint performance:

```python
import time
from fastapi import Request

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response
```

### 3. Database Query Logging

Enable query logging in `database.py` to see slow queries:

```python
import logging
logger = logging.getLogger(__name__)

# In get_connection():
start = time.time()
# ... execute query ...
elapsed = (time.time() - start) * 1000
if elapsed > 10:  # Log queries > 10ms
    logger.warning(f"Slow query ({elapsed:.2f}ms): {query}")
```

### 4. Browser DevTools

On the live site:
1. Open DevTools → Network tab
2. Filter by "XHR" or "Fetch"
3. Check timing for:
   - `/api/public/images/{image_id}` - main image endpoint
   - `/api/public/similar?scene_id=...` - similar images endpoint

### 5. Vercel Analytics

Check Vercel dashboard for:
- Function execution time
- Cold start frequency
- Database connection time

## Recommended Next Steps

1. ✅ **Deploy the N+1 query fix** (already done)
2. **Add caching** for `image_id_to_scene_id()` lookup
3. **Monitor performance** after deployment
4. **Consider pre-computing** similar images and storing in database
5. **Add database indexes** if missing:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_scenes_image_id ON scenes(image_id);
   ```

## Testing Performance

### Local Testing
```bash
# Time the API endpoint locally
time curl http://localhost:8001/api/public/images/777866332
time curl "http://localhost:8001/api/public/similar?scene_id=2025-11-03-batch-1-DSCF1499"
```

### Production Testing
```bash
# Time the live endpoint
time curl https://www.brendan-mulvany-photography.com/api/public/images/777866332
time curl "https://www.brendan-mulvany-photography.com/api/public/similar?scene_id=2025-11-03-batch-1-DSCF1499"
```

## Expected Performance Targets

- **Image page load**: < 200ms (excluding image download)
- **Similar images endpoint**: < 100ms
- **Database queries**: < 50ms each
- **Total page load**: < 500ms (first contentful paint)

