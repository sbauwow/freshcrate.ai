const HF_TIMEOUT_MS = 20000;

export const HUB_ORIGIN = "https://huggingface.co";

/**
 * Fetches a Hugging Face Hub API endpoint. Returns null on any non-OK
 * status or network failure so callers can treat misses as "skip".
 */
export async function hfFetch<T>(endpoint: string, token?: string): Promise<T | null> {
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
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
