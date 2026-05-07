import { NextRequest } from "next/server";

export interface GeoFields {
  country: string;
  region: string;
  city: string;
}

function sanitizeCountry(raw: string | null): string {
  if (!raw) return "";
  const v = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : "";
}

function sanitizeRegion(raw: string | null): string {
  if (!raw) return "";
  return raw.trim().replace(/[^A-Za-z0-9 .\-]/g, "").slice(0, 80);
}

function sanitizeCity(raw: string | null): string {
  if (!raw) return "";
  return raw.trim().replace(/[^A-Za-z0-9 .,'\-]/g, "").slice(0, 120);
}

export function extractGeo(request: NextRequest): GeoFields {
  const h = request.headers;

  const country = sanitizeCountry(
    h.get("cf-ipcountry")
      || h.get("x-vercel-ip-country")
      || h.get("x-country-code")
      || h.get("x-country")
      || null,
  );

  const region = sanitizeRegion(
    h.get("x-vercel-ip-country-region")
      || h.get("x-region")
      || h.get("x-country-region")
      || null,
  );

  const city = sanitizeCity(
    h.get("x-vercel-ip-city")
      || h.get("x-city")
      || null,
  );

  return { country, region, city };
}
