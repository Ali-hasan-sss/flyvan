import { BadRequestException } from "@nestjs/common";

const ALLOWED_HOST = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.com|google\.com|www\.google\.com|[a-z0-9-]+\.google\.[a-z.]+)$/i;

function firstUrl(value: string): string | null {
  return value.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null;
}

function allowed(url: URL): boolean {
  return url.protocol === "https:" && ALLOWED_HOST.test(url.hostname);
}

export async function expandMapsLink(value: string): Promise<{ url: string }> {
  const start = firstUrl(value);
  if (!start) throw new BadRequestException("الصق رابط خرائط جوجل أو واتساب.");
  let current = start;
  for (let hop = 0; hop < 5; hop += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new BadRequestException("الرابط غير صالح.");
    }
    if (!allowed(url)) throw new BadRequestException("يُقبل فقط رابط خرائط جوجل أو واتساب.");
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "FlyVan/1.0" },
    });
    if (response.status < 300 || response.status >= 400) return { url: current };
    const location = response.headers.get("location");
    if (!location) return { url: current };
    current = new URL(location, current).toString();
  }
  return { url: current };
}
