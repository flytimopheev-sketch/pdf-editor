/**
 * Page render cache: stores ImageBitmap keyed by 'source:docVersion:page:zoom:rotation'.
 * docVersion must be bumped whenever the underlying document bytes change
 * (load, delete pages, crop, undo/redo of structural ops) to avoid stale bitmaps.
 */

const pageBitmapCache = new Map<string, ImageBitmap>();
const MAX_CACHE_SIZE = 10;

export function pageCacheKey(
  source: string,
  docVersion: number,
  page: number,
  zoom: number,
  rotation: number
): string {
  return `${source}:${docVersion}:${page}:${zoom}:${rotation}`;
}

export function getCachedBitmap(key: string): ImageBitmap | null {
  return pageBitmapCache.get(key) || null;
}

export function setCachedBitmap(key: string, bitmap: ImageBitmap): void {
  if (pageBitmapCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry (first key)
    const firstKey = pageBitmapCache.keys().next().value;
    if (firstKey) pageBitmapCache.delete(firstKey);
  }
  pageBitmapCache.set(key, bitmap);
}

/** Invalidate cache when source document changes */
export function invalidatePageCache(source?: string): void {
  if (source) {
    for (const key of pageBitmapCache.keys()) {
      if (key.startsWith(source + ":")) pageBitmapCache.delete(key);
    }
  } else {
    pageBitmapCache.clear();
  }
}
