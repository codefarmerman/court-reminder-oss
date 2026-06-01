"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { CourtSummons } from "@/lib/types";

type Step = "pin" | "upload" | "parsing" | "review" | "creating" | "done";
type ParsePhase = "compress" | "upload" | "recognize";

const MAX_IMAGE_SIZE = 1200;
const JPEG_QUALITY = 0.65;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Compress image via Canvas: resize to max 1200px, JPEG 65% quality */
function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
          const ratio = Math.min(MAX_IMAGE_SIZE / width, MAX_IMAGE_SIZE / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建canvas上下文");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.split(",")[1];
        resolve({ base64, mimeType: "image/jpeg" });
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败"));
    };
    img.src = objectUrl;
  });
}

/** POST with upload progress and abort support via XMLHttpRequest */
function postWithProgress(
  url: string,
  body: string,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
      } catch {
        reject(new Error(`解析响应失败 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.ontimeout = () => reject(new Error("请求超时"));
    xhr.timeout = 60000;

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        xhr.abort();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    xhr.send(body);
  });
}

/** Format local ISO datetime (YYYY-MM-DDTHH:mm) without timezone shift */
function toLocalInputValue(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(localStr: string): string {
  if (!localStr) return "";
  return `${localStr}:00`;
}

/** Human-readable Chinese datetime preview */
function formatDatePreview(isoStr: string): string {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Form validation for review screen */
interface ValidationErrors {
  hearingDate?: string;
  court?: string;
  caseInfo?: string;
}
function validateSummons(d: CourtSummons): ValidationErrors {
  const errs: ValidationErrors = {};
  if (!d.hearingDate) {
    errs.hearingDate = "开庭时间必填";
  } else {
    const hd = new Date(d.hearingDate);
    if (isNaN(hd.getTime())) {
      errs.hearingDate = "日期格式无效";
    } else if (hd.getTime() < Date.now() - 60_000) {
      errs.hearingDate = "开庭时间已过，请确认";
    }
  }
  if (!d.court.trim()) errs.court = "法院名称必填";
  if (!d.caseNumber.trim() && !d.caseType.trim()) {
    errs.caseInfo = "案号和案由至少填一项";
  }
  return errs;
}

export default function Home() {
  const [step, setStep] = useState<Step>("pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [savedPin, setSavedPin] = useState("");
  const [authTime, setAuthTime] = useState(0);
  const [data, setData] = useState<CourtSummons | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [parsePhase, setParsePhase] = useState<ParsePhase>("compress");
  const [uploadPct, setUploadPct] = useState(0);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!savedPin) return;
    const check = () => {
      if (Date.now() - authTime > SESSION_TIMEOUT_MS) {
        setSavedPin("");
        setPin("");
        setStep("pin");
        setNotice("会话已过期，请重新登录");
      }
    };
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [savedPin, authTime]);

  const getHeaders = useCallback(
    () => ({ "Content-Type": "application/json", "x-access-pin": savedPin }),
    [savedPin]
  );

  const setPreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreview(url);
  };

  const handlePin = () => {
    if (pin.length < MIN_PIN_LENGTH) {
      setPinError(`请输入至少${MIN_PIN_LENGTH}位密码`);
      return;
    }
    setSavedPin(pin);
    setAuthTime(Date.now());
    setNotice("");
    setStep("upload");
  };

  const processFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("暂仅支持图片格式 (JPG/PNG)");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("文件过大，请选择20MB以内的图片");
      return;
    }

    setError("");
    setNotice("");
    setStep("parsing");
    setParsePhase("compress");
    setUploadPct(0);
    setLastFile(file);
    setPreviewUrl(URL.createObjectURL(file));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = await compressImage(file);
      if (controller.signal.aborted) return;

      setParsePhase("upload");
      const body = JSON.stringify({ base64: payload.base64, mimeType: payload.mimeType });
      const res = await postWithProgress(
        "/api/parse-summons",
        body,
        getHeaders(),
        (pct) => setUploadPct(pct),
        controller.signal
      );

      if (controller.signal.aborted) return;
      setParsePhase("recognize");

      if (!res.ok) {
        const err = res.data as { error?: string };
        if (res.status === 401) {
          setSavedPin("");
          setStep("pin");
          setNotice("认证已过期，请重新登录");
          return;
        }
        throw new Error(err?.error || `识别失败 (${res.status})`);
      }

      setData(res.data as CourtSummons);
      setStep("review");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStep("upload");
        return;
      }
      setError(err instanceof Error ? err.message : "识别失败");
      setStep("upload");
    } finally {
      abortRef.current = null;
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleRetry = async () => {
    if (!lastFile) return;
    await processFile(lastFile);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep("upload");
    setNotice("已取消");
  };

  const handleCreateReminder = async () => {
    if (!data) return;
    const errs = validateSummons(data);
    if (Object.keys(errs).length > 0) return;

    setStep("creating");
    setError("");

    try {
      const res = await fetch("/api/create-reminder", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 401) {
          setSavedPin("");
          setStep("pin");
          setNotice("认证已过期，请重新登录");
          return;
        }
        throw new Error(err.error || `创建失败 (${res.status})`);
      }
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setStep("review");
    }
  };

  const handleReset = () => {
    setData(null);
    setError("");
    setNotice("");
    setPreviewUrl(null);
    setLastFile(null);
    setShowPreview(false);
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateField = (field: keyof CourtSummons, value: string) => {
    if (!data) return;
    setData({ ...data, [field]: value });
  };

  const validationErrors = data ? validateSummons(data) : {};
  const canSubmit = data !== null && Object.keys(validationErrors).length === 0;

  return (
    <main className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-6 pb-safe">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-center text-lg font-semibold text-slate-800 tracking-wide">
          传票提醒助手
        </h1>
        {step !== "pin" && step !== "done" && (
          <StepIndicator step={step} />
        )}
      </header>

      {/* PIN Screen */}
      {step === "pin" && (
        <form
          onSubmit={(e) => { e.preventDefault(); handlePin(); }}
          className="flex-1 flex flex-col items-center justify-center gap-5"
        >
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-slate-600 text-base">请输入访问密码</p>
          {notice && (
            <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {notice}
            </p>
          )}
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={MAX_PIN_LENGTH}
            autoFocus
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(""); }}
            className="w-60 text-center text-2xl tracking-[0.5em] border-2 border-slate-200 rounded-xl px-4 py-4 min-h-[56px] focus:border-slate-700 focus:outline-none"
            placeholder="••••"
            autoComplete="current-password"
            enterKeyHint="go"
            aria-label="访问密码"
          />
          {pinError && <p className="text-red-600 text-sm">{pinError}</p>}
          <button
            type="submit"
            className="w-60 min-h-[52px] bg-slate-800 text-white rounded-xl py-3 font-semibold text-base active:bg-slate-900 transition-colors"
          >
            进入
          </button>
        </form>
      )}

      {/* Upload Screen */}
      {step === "upload" && (
        <div className="flex-1 flex flex-col gap-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <p className="text-red-700 text-sm font-medium">{error}</p>
              {lastFile && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="text-red-700 underline text-sm font-medium min-h-[36px] active:text-red-900"
                >
                  使用同一张图片重试
                </button>
              )}
            </div>
          )}
          {notice && !error && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-700 text-sm">
              {notice}
            </div>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 min-h-[300px] w-full border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-3 bg-white active:scale-[0.99] active:border-slate-500 active:bg-slate-50 transition-all focus:outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-100"
          >
            <svg className="w-14 h-14 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-slate-700 font-semibold text-base">点击上传传票</p>
            <p className="text-slate-500 text-sm">支持拍照或相册图片</p>
            <p className="text-slate-400 text-xs mt-1">JPG · PNG · 最大 20MB</p>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      )}

      {/* Parsing Screen */}
      {step === "parsing" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
          {preview && (
            <img src={preview} alt="传票预览" className="w-36 h-auto rounded-xl shadow-md opacity-40" />
          )}
          <div className="w-full max-w-xs space-y-3">
            <ProgressStep label="压缩图片" active={parsePhase === "compress"} done={parsePhase !== "compress"} />
            <ProgressStep
              label={parsePhase === "upload" ? `上传中 ${uploadPct}%` : "上传文件"}
              active={parsePhase === "upload"}
              done={parsePhase === "recognize"}
              progress={parsePhase === "upload" ? uploadPct : undefined}
            />
            <ProgressStep label="AI识别中" active={parsePhase === "recognize"} done={false} hint="通常需要5-10秒" />
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-slate-500 underline active:text-slate-700 min-h-[44px] px-4"
          >
            取消
          </button>
        </div>
      )}

      {/* Review Screen */}
      {step === "review" && data && (
        <div className="flex-1 flex flex-col gap-4 overflow-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
          )}

          {/* Original image reference */}
          {preview && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="w-full px-4 py-3 min-h-[48px] flex items-center justify-between text-left active:bg-slate-50"
              >
                <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  查看原始传票
                </span>
                <svg
                  className={`w-4 h-4 text-slate-400 transition-transform ${showPreview ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPreview && (
                <div className="px-4 pb-4">
                  <img src={preview} alt="传票原图" className="w-full rounded-lg border border-slate-200" />
                  <p className="text-xs text-slate-400 mt-2 text-center">核对后可关闭预览</p>
                </div>
              )}
            </div>
          )}

          <Section title="案件信息">
            <Field label="案号" value={data.caseNumber} onChange={(v) => updateField("caseNumber", v)}
              error={validationErrors.caseInfo && !data.caseNumber.trim() && !data.caseType.trim() ? validationErrors.caseInfo : undefined} />
            <Field label="案由" value={data.caseType} onChange={(v) => updateField("caseType", v)} />
            <Field label="原告" value={data.plaintiff} onChange={(v) => updateField("plaintiff", v)} />
            <Field label="被告" value={data.defendant} onChange={(v) => updateField("defendant", v)} />
          </Section>

          <Section title="开庭安排">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                开庭时间 <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="datetime-local"
                  value={toLocalInputValue(data.hearingDate)}
                  onChange={(e) => updateField("hearingDate", fromLocalInputValue(e.target.value))}
                  className={`w-full pl-10 pr-3 py-2.5 rounded-lg border focus:outline-none focus:ring-2 ${
                    validationErrors.hearingDate
                      ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                      : "border-slate-300 focus:border-slate-700 focus:ring-slate-100"
                  }`}
                />
              </div>
              {validationErrors.hearingDate ? (
                <p className="mt-1.5 text-xs text-red-600">{validationErrors.hearingDate}</p>
              ) : data.hearingDate && formatDatePreview(data.hearingDate) && (
                <p className="mt-1.5 text-xs text-slate-500">{formatDatePreview(data.hearingDate)}</p>
              )}
            </div>
            <Field
              label="法院"
              value={data.court}
              onChange={(v) => updateField("court", v)}
              required
              error={validationErrors.court}
            />
            <Field label="法庭" value={data.courtroom} onChange={(v) => updateField("courtroom", v)} />
          </Section>

          <Section title="审判人员及联系方式">
            <Field label="审判员" value={data.judge} onChange={(v) => updateField("judge", v)} />
            <PersonCard
              label="承办人"
              name={data.handler}
              phone={data.handlerPhone}
              onNameChange={(v) => updateField("handler", v)}
              onPhoneChange={(v) => updateField("handlerPhone", v)}
            />
            <PersonCard
              label="法官助理"
              name={data.judgeAssistant}
              phone={data.judgeAssistantPhone}
              onNameChange={(v) => updateField("judgeAssistant", v)}
              onPhoneChange={(v) => updateField("judgeAssistantPhone", v)}
            />
            <PersonCard
              label="书记员"
              name={data.clerk}
              phone={data.clerkPhone}
              onNameChange={(v) => updateField("clerk", v)}
              onPhoneChange={(v) => updateField("clerkPhone", v)}
            />
          </Section>

          <Section title="注意事项">
            <div>
              <label htmlFor="notes" className="sr-only">注意事项详情</label>
              <textarea
                id="notes"
                value={data.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                rows={4}
                placeholder="如需补充注意事项,请在此填写..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:border-slate-700 focus:ring-2 focus:ring-slate-100 focus:outline-none resize-none"
              />
            </div>
          </Section>

          <div
            className="sticky bottom-0 -mx-4 px-4 pt-3 bg-white/95 backdrop-blur border-t border-slate-200 flex gap-3"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              onClick={handleReset}
              className="flex-1 min-h-[52px] bg-slate-100 text-slate-700 rounded-xl font-semibold text-base active:bg-slate-200 transition-colors"
            >
              重新上传
            </button>
            <button
              type="button"
              onClick={handleCreateReminder}
              disabled={!canSubmit}
              className="flex-[2] min-h-[52px] bg-slate-800 text-white rounded-xl font-semibold text-base active:bg-slate-900 disabled:bg-slate-300 disabled:text-slate-500 transition-colors"
            >
              添加到日历
            </button>
          </div>
        </div>
      )}

      {/* Creating Screen */}
      {step === "creating" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-6 h-6 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">正在添加到iPhone日历...</p>
        </div>
      )}

      {/* Done Screen */}
      {step === "done" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-800">日程创建成功</p>
          <div className="text-center text-sm text-slate-500 space-y-0.5">
            <p>已添加到 iPhone 日历</p>
            <p>将在开庭前 2 天、1 天、1 小时提醒您</p>
          </div>
          {data && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 w-full mt-2 space-y-1">
              <p className="font-semibold text-slate-800">{data.caseNumber || data.caseType}</p>
              {(data.court || data.courtroom) && (
                <p className="text-sm text-slate-500">{data.court} {data.courtroom}</p>
              )}
              {data.hearingDate && formatDatePreview(data.hearingDate) && (
                <p className="text-sm text-slate-700 font-medium">{formatDatePreview(data.hearingDate)}</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3 w-full max-w-xs mt-4">
            <a
              href="calshow:"
              className="w-full min-h-[52px] bg-slate-800 text-white rounded-xl font-semibold text-base flex items-center justify-center active:bg-slate-900 transition-colors"
            >
              打开日历查看
            </a>
            <button
              type="button"
              onClick={handleReset}
              className="w-full min-h-[52px] bg-slate-100 text-slate-700 rounded-xl font-medium text-base active:bg-slate-200 transition-colors"
            >
              继续上传下一张
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { key: "upload", label: "上传" },
    { key: "parsing", label: "识别" },
    { key: "review", label: "确认" },
  ];
  const currentIdx = ["upload", "parsing", "review", "creating"].indexOf(step);

  return (
    <nav className="flex items-center justify-center gap-1.5 mt-3" aria-label="进度">
      {steps.map((s, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = s.key === step || (s.key === "review" && step === "creating");
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            <div
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                isActive ? "bg-slate-700" : "bg-slate-300"
              }`}
            />
            <span
              className={`text-xs ${
                isCurrent ? "text-slate-700 font-medium" : isActive ? "text-slate-600" : "text-slate-400"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-5 h-px ${i < currentIdx ? "bg-slate-700" : "bg-slate-300"}`} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className="w-1 h-4 bg-slate-700 rounded-full" />
        <span className="text-sm font-semibold text-slate-800 tracking-wide">{title}</span>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function ProgressStep({
  label, active, done, progress, hint,
}: {
  label: string; active: boolean; done: boolean; progress?: number; hint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
        {done ? (
          <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : active ? (
          <div className="w-5 h-5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
        ) : (
          <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
        )}
      </div>
      <div className="flex-1">
        <p className={`text-sm ${active ? "text-slate-800 font-medium" : done ? "text-emerald-600" : "text-slate-400"}`}>
          {label}
        </p>
        {active && progress !== undefined && (
          <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-slate-700 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
        {active && hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function PersonCard({
  label, name, phone, onNameChange, onPhoneChange,
}: {
  label: string; name: string; phone: string;
  onNameChange: (v: string) => void; onPhoneChange: (v: string) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <Field label="姓名" value={name} onChange={onNameChange} />
        <Field label="电话" value={phone} onChange={onPhoneChange} type="tel" />
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required = false, error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
}) {
  const extraProps: React.InputHTMLAttributes<HTMLInputElement> = {};
  if (type === "tel") {
    extraProps.inputMode = "tel";
    extraProps.autoComplete = "tel";
  }
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 ${
          error
            ? "border-red-300 focus:border-red-500 focus:ring-red-100"
            : "border-slate-300 focus:border-slate-700 focus:ring-slate-100"
        }`}
        {...extraProps}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
