import OpenAI from "openai";
import { CourtSummons, validateSummons } from "./types";

const client = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: "https://api.moonshot.cn/v1",
});

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
]);

const SYSTEM_PROMPT = `从法院传票中提取信息，严格按JSON返回，不要任何其他文字：

{"caseNumber":"案号","court":"法院","courtroom":"法庭/应到处所","hearingDate":"YYYY-MM-DDTHH:mm:00","plaintiff":"原告/当事人","defendant":"被告/被传唤人","caseType":"案由","judge":"审判员","handler":"承办人","handlerPhone":"承办人电话","judgeAssistant":"法官助理","judgeAssistantPhone":"法官助理电话","clerk":"书记员","clerkPhone":"书记员电话","notes":"注意事项"}

找不到的字段填""。只返回JSON。`;

export async function parseSummons(
  base64Data: string,
  mimeType: string
): Promise<CourtSummons> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("不支持的文件类型，请上传图片");
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Data}` },
        },
        {
          type: "text",
          text: "请识别这张法院传票，提取关键信息并按JSON格式返回。",
        },
      ],
    },
  ];

  const response = await client.chat.completions.create(
    {
      model: "moonshot-v1-32k-vision-preview",
      messages,
      temperature: 0,
    },
    { timeout: 45000 }
  );

  const content = response.choices[0]?.message?.content?.trim() || "{}";

  // Robust JSON extraction: find first { to last }
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI返回格式异常，请重试");
  }

  try {
    const raw = JSON.parse(jsonMatch[0]);
    return validateSummons(raw);
  } catch {
    throw new Error("AI返回格式异常，请重试");
  }
}
