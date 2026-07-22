import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function proxyRequest(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

  const path = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  const targetUrl = `${backendUrl}${path}${search}`;

  const reqHeaders = new Headers(req.headers);
  reqHeaders.delete("host");

  try {
    const isBodyAllowed = req.method !== "GET" && req.method !== "HEAD";
    const body = isBodyAllowed ? await req.blob() : undefined;

    const res = await fetch(targetUrl, {
      method: req.method,
      headers: reqHeaders,
      body: body,
    });

    const resHeaders = new Headers(res.headers);
    resHeaders.delete("transfer-encoding");

    return new NextResponse(res.body, {
      status: res.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    console.error(`[API Proxy Error] ${req.method} ${targetUrl}:`, err);
    return NextResponse.json(
      { detail: `Impossible de contacter le serveur backend à ${targetUrl}: ${err.message}` },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const DELETE = proxyRequest;
export const PATCH = proxyRequest;
