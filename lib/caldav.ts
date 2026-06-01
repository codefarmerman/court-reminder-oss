import { DAVClient } from "tsdav";
import { createHash } from "crypto";
import { CourtSummons } from "./types";

/** Escape iCal property values per RFC 5545 */
function escapeICal(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

/** Generate deterministic UID from case number + hearing date for deduplication */
function deterministicUid(data: CourtSummons): string {
  const key = `${data.caseNumber}|${data.hearingDate}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** Format local time string for iCal (no Z suffix = local time with TZID) */
function formatLocalTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) throw new Error("开庭时间格式无效");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function formatDescription(data: CourtSummons): string {
  const sections: string[] = [];

  sections.push("--- 案件信息 ---");
  if (data.caseNumber) sections.push(`案号：${data.caseNumber}`);
  if (data.caseType) sections.push(`案由：${data.caseType}`);
  if (data.plaintiff) sections.push(`原告：${data.plaintiff}`);
  if (data.defendant) sections.push(`被告：${data.defendant}`);

  sections.push("");
  sections.push("--- 开庭安排 ---");
  if (data.court) sections.push(`法院：${data.court}`);
  if (data.courtroom) sections.push(`法庭：${data.courtroom}`);

  if (data.handler || data.judgeAssistant || data.clerk || data.judge) {
    sections.push("");
    sections.push("--- 审判人员 ---");
    if (data.judge) sections.push(`审判员：${data.judge}`);
    if (data.handler) {
      let line = `承办人：${data.handler}`;
      if (data.handlerPhone) line += ` 电话：${data.handlerPhone}`;
      sections.push(line);
    }
    if (data.judgeAssistant) {
      let line = `法官助理：${data.judgeAssistant}`;
      if (data.judgeAssistantPhone) line += ` 电话：${data.judgeAssistantPhone}`;
      sections.push(line);
    }
    if (data.clerk) {
      let line = `书记员：${data.clerk}`;
      if (data.clerkPhone) line += ` 电话：${data.clerkPhone}`;
      sections.push(line);
    }
  }

  if (data.notes) {
    sections.push("");
    sections.push("--- 注意事项 ---");
    sections.push(data.notes);
  }

  return sections.join("\n");
}

function buildVEVENT(data: CourtSummons): { uid: string; ical: string } {
  const uid = deterministicUid(data);
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const dtstart = formatLocalTime(data.hearingDate);
  // Event lasts 2 hours
  const endDate = new Date(data.hearingDate);
  endDate.setHours(endDate.getHours() + 2);
  const dtend = formatLocalTime(endDate.toISOString());

  const title = escapeICal(`开庭 | ${data.caseNumber || data.caseType || "传票"}`);
  const location = escapeICal([data.court, data.courtroom].filter(Boolean).join(" "));
  const description = escapeICal(formatDescription(data));
  const alarmDesc = escapeICal(data.caseNumber || data.caseType || "开庭");

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CourtReminder//CN",
    // Asia/Shanghai timezone definition
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Shanghai",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:CST",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}@court-reminder`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=Asia/Shanghai:${dtstart}`,
    `DTEND;TZID=Asia/Shanghai:${dtend}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    // Alarm: 2 days before
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${alarmDesc} - 后天开庭`,
    "TRIGGER:-P2D",
    "END:VALARM",
    // Alarm: 1 day before
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${alarmDesc} - 明天开庭`,
    "TRIGGER:-P1D",
    "END:VALARM",
    // Alarm: 1 hour before
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${alarmDesc} - 即将开庭`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return { uid, ical };
}

// Module-level cache for CalDAV client
let cachedClient: DAVClient | null = null;
let cachedCalendarUrl: string | null = null;

export async function createReminder(
  data: CourtSummons
): Promise<{ success: boolean; message: string }> {
  const username = process.env.ICLOUD_USERNAME;
  const password = process.env.ICLOUD_APP_PASSWORD;

  if (!username || !password) {
    return { success: false, message: "iCloud 凭据未配置" };
  }

  // Validate hearingDate
  const hd = new Date(data.hearingDate);
  if (isNaN(hd.getTime())) {
    return { success: false, message: "开庭时间格式无效" };
  }

  try {
    // Reuse cached client if available
    if (!cachedClient) {
      cachedClient = new DAVClient({
        serverUrl: "https://caldav.icloud.com",
        credentials: { username, password },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
      await cachedClient.login();
    }

    // Reuse cached calendar URL or discover
    let eventCalendar;
    if (cachedCalendarUrl) {
      eventCalendar = { url: cachedCalendarUrl };
    } else {
      const calendars = await cachedClient.fetchCalendars();
      const found =
        calendars.find((cal) => cal.components?.includes("VEVENT")) ||
        calendars.find((cal) =>
          String(cal.displayName ?? "").includes("日历") ||
          String(cal.displayName ?? "").includes("Calendar") ||
          String(cal.displayName ?? "") === "Home"
        ) ||
        calendars[0];

      if (!found) {
        return { success: false, message: "未找到iCloud日历" };
      }
      eventCalendar = found;
      cachedCalendarUrl = found.url;
    }

    const { uid, ical } = buildVEVENT(data);

    await cachedClient.createCalendarObject({
      calendar: eventCalendar,
      filename: `${uid}.ics`,
      iCalString: ical,
    });

    return {
      success: true,
      message: "日程创建成功！已添加到日历。",
    };
  } catch (error) {
    // Reset cache on auth errors so next attempt re-logs in
    cachedClient = null;
    cachedCalendarUrl = null;

    console.error("CalDAV error:", error);
    return { success: false, message: "创建日程失败，请稍后重试" };
  }
}
