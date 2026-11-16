const HF_TIMEOUT_MS = 20000;

export const HUB_ORIGIN = "https://huggingface.co";

export interface HfFetchResult<T> {
  /** HTTP status, or 0 when the request itself threw (network/abort). */
  status: number;
  /** Parsed JSON on 200, null otherwise. */
  data: T | null;
}

/**
 * Status-aware fetch of a Hugging Face Hub API endpoint. Lets callers
 * distinguish e.g. 429 rate limiting from a plain miss; `hfFetch` is the
 * null-on-failure convenience wrapper.
 *
 * NOTE: fetch() follows redirects transparently and only keeps the query
 * string because HF echoes the endpoint's query params into the Location
 * URL — keep params like ?recursive=true on the endpoint itself or
 * recursive/paginated reads silently degrade to the first page.
 */
export async function hfFetchWithStatus<T>(
  endpoint: string,
  token?: string
): Promise<HfFetchResult<T>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_ORIGIN}${endpoint}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, data: null };
    }
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a Hugging Face Hub API endpoint. Returns null on any non-OK
 * status or network failure so callers can treat misses as "skip".
 */
export async function hfFetch<T>(endpoint: string, token?: string): Promise<T | null> {
  return (await hfFetchWithStatus<T>(endpoint, token)).data;
}
