import { NextRequest, NextResponse } from "next/server";
import { parseSummons } from "@/lib/kimi";
import { authenticate } from "@/lib/auth";

export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
]);
const MAX_BASE64_LENGTH = 8 * 1024 * 1024; // ~6 MB decoded

export async function POST(req: NextRequest) {
  // Auth + rate limit
  const auth = authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Size check from Content-Length if available
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BASE64_LENGTH + 1024) {
    return NextResponse.json({ error: "文件过大，请压缩后重试" }, { status: 413 });
  }

  let body: { base64?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { base64, mimeType } = body;

  if (typeof base64 !== "string" || typeof mimeType !== "string") {
    return NextResponse.json({ error: "缺少文件数据" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: "不支持的文件类型，请上传JPG/PNG图片" },
      { status: 400 }
    );
  }

  if (base64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "文件过大，请压缩后重试" }, { status: 413 });
  }

  // Basic base64 sanity check
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    return NextResponse.json({ error: "文件数据无效" }, { status: 400 });
  }

  try {
    const result = await parseSummons(base64, mimeType);
    return NextResponse.json(result);
  } catch (error) {
    console.error("parse-summons error:", error);
    // Only expose safe error messages
    const msg = error instanceof Error ? error.message : "";
    const safeMsg = msg.includes("AI返回") || msg.includes("不支持")
      ? msg
      : "识别失败，请重试";
    return NextResponse.json({ error: safeMsg }, { status: 500 });
  }
}
