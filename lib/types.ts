export interface CourtSummons {
  caseNumber: string;
  court: string;
  courtroom: string;
  hearingDate: string;
  plaintiff: string;
  defendant: string;
  caseType: string;
  judge: string;
  handler: string;
  handlerPhone: string;
  judgeAssistant: string;
  judgeAssistantPhone: string;
  clerk: string;
  clerkPhone: string;
  notes: string;
}

/** Validate and fill defaults for CourtSummons from untrusted input */
export function validateSummons(raw: Record<string, unknown>): CourtSummons {
  const str = (key: string): string => {
    const v = raw[key];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    caseNumber: str("caseNumber"),
    court: str("court"),
    courtroom: str("courtroom"),
    hearingDate: str("hearingDate"),
    plaintiff: str("plaintiff"),
    defendant: str("defendant"),
    caseType: str("caseType"),
    judge: str("judge"),
    handler: str("handler"),
    handlerPhone: str("handlerPhone"),
    judgeAssistant: str("judgeAssistant"),
    judgeAssistantPhone: str("judgeAssistantPhone"),
    clerk: str("clerk"),
    clerkPhone: str("clerkPhone"),
    notes: str("notes"),
  };
}
