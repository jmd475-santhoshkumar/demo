import { NextRequest, NextResponse } from "next/server";

// A next.config.js rewrite is resolved once at `next build` time and baked
// into the standalone server's routes-manifest.json -- setting BACKEND_URL
// at container start (or deploy time) has no effect on an already-built
// image. This route handler reads process.env.BACKEND_URL fresh on every
// request instead, which is what actually lets one built image work
// unchanged across environments (dev, and separate backend/frontend hosts
// in production).
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, path: string[]) {
  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const target = `${backendUrl}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  const hasBody = !["GET", "HEAD"].includes(req.method);

  const backendRes = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const resHeaders = new Headers(backendRes.headers);
  resHeaders.delete("content-encoding");
  resHeaders.delete("content-length");

  return new NextResponse(backendRes.body, {
    status: backendRes.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
