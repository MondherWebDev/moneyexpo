import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED_PATHS = ["/", "/index", "/checkin"];
const PUBLIC_PREFIXES = ["/_next", "/api", "/public", "/favicon.ico", "/manifest.json", "/sw.js", "/robots.txt", "/login"];

async function verifyJwt(token, secret) {
  try {
    const encoder = new TextEncoder();
    await jwtVerify(token, encoder.encode(secret));
    return true;
  } catch (_) {
    return false;
  }
}

export async function middleware(req) {
  const secret = process.env.JWT_SECRET;
  const { pathname } = req.nextUrl;

  // Skip protection if secret not set
  if (!secret) return NextResponse.next();

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const token = req.cookies.get("auth_token")?.value;
  if (token) {
    const valid = await verifyJwt(token, secret);
    if (valid) return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?from=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|api|public|favicon\\.ico|manifest\\.json|sw\\.js|robots\\.txt).*)"],
};
