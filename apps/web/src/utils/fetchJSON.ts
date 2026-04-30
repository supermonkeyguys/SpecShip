/**
 * fetchJSON — 安全的 JSON fetch
 *
 * 防止服务器返回 HTML（404/500 页面）时直接崩溃。
 * 统一错误处理：非 2xx 或非 JSON 响应都抛出可读错误。
 */

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function fetchJSON<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, options);
  } catch (error) {
    throw new Error(`Network error: ${toError(error).message}`, { cause: error });
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJSON = contentType.includes("application/json");

  if (!isJSON) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`Expected JSON but got ${res.status} ${res.statusText}: ${text.slice(0, 100)}`);
  }

  const data = await res.json().catch((e: unknown) => {
    throw new Error(`Failed to parse JSON response from ${url}`, { cause: toError(e) });
  });

  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}: ${res.statusText}`);
  }

  return data as T;
}
