import { NextRequest, NextResponse } from "next/server";
import { createReminder } from "@/lib/caldav";
import { validateSummons } from "@/lib/types";
import { authenticate } from "@/lib/auth";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const data = validateSummons(raw);

  if (!data.hearingDate) {
    return NextResponse.json({ error: "开庭时间不能为空" }, { status: 400 });
  }

  const hd = new Date(data.hearingDate);
  if (isNaN(hd.getTime())) {
    return NextResponse.json({ error: "开庭时间格式无效" }, { status: 400 });
  }

  try {
    const result = await createReminder(data);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }
    return NextResponse.json({ message: result.message });
  } catch (error) {
    console.error("create-reminder error:", error);
    return NextResponse.json(
      { error: "创建日程失败，请稍后重试" },
      { status: 500 }
    );
  }
}
