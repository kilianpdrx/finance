import { NextResponse, type NextRequest } from "next/server";
import { refusal } from "@/lib/request-guard";

/** Other websites stay out of the API: see `lib/request-guard.ts`. */
export function middleware(req: NextRequest) {
  const reason = refusal(req.method, req.headers);
  if (reason) return NextResponse.json({ detail: reason }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
