/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { buildMeetingAIContext } from "@App/libs/meeting/meetingAIContext";
import type { MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";

export type MeetingQuestionAnswer = { question: string; answer: string; sourceIds: string[] };

export const MAX_QUESTION_SOURCE_IDS = 6;
export const UNGROUNDED_ANSWER_ZH = "无法根据已记录的发言确认";
export const UNGROUNDED_ANSWER_EN = "Cannot confirm this from the recorded statements";

export type MeetingAnswerGrounding =
  | { grounded: true; answer: string; sourceIds: string[] }
  | { grounded: false; answer: ""; sourceIds: [] };

/**
 * Read-only grounding gate for meeting Q&A.
 *
 * The answer is only usable when at least one supplied source id exactly
 * matches an id that was actually sent inside the bounded meeting context.
 * Missing, fabricated, or unknown ids fail closed so a confident assertion is
 * never presented as a meeting-grounded answer.
 */
export function validateMeetingQuestionAnswer(input: unknown, includedIds: ReadonlySet<string>): MeetingAnswerGrounding | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as { answer?: unknown; sourceIds?: unknown };
  if (typeof candidate.answer !== "string" || !candidate.answer.trim()) return null;
  const sourceIds: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(candidate.sourceIds)) {
    for (const value of candidate.sourceIds) {
      if (typeof value !== "string") continue;
      const id = value.trim();
      if (!id || seen.has(id) || !includedIds.has(id)) continue;
      seen.add(id);
      sourceIds.push(id);
      if (sourceIds.length >= MAX_QUESTION_SOURCE_IDS) break;
    }
  }
  if (!sourceIds.length) return { grounded: false, answer: "", sourceIds: [] };
  return { grounded: true, answer: candidate.answer, sourceIds };
}

/**
 * Turn one raw model response into the only answer this panel will display.
 * Ungrounded responses are replaced with the refusal text and zero sources;
 * malformed responses return null so the caller can surface a retry hint.
 */
export function resolveMeetingQuestionAnswer(raw: string, includedIds: ReadonlySet<string>, question: string, ungroundedAnswer: string): MeetingQuestionAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  const validated = validateMeetingQuestionAnswer(parsed, includedIds);
  if (!validated) return null;
  return { question, answer: validated.grounded ? validated.answer : ungroundedAnswer, sourceIds: validated.sourceIds };
}

/** Questions and answers remain private in this component, not the room history. */
export default function MeetingMinutesQuestionPanel({ transcript, onViewTranscript, answers, onAnswer }: { transcript: MeetingTranscriptSegment[]; onViewTranscript: (id: string) => void; answers: MeetingQuestionAnswer[]; onAnswer: (answer: MeetingQuestionAnswer) => void }) {
  const { t, i18n } = useTranslation();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isZh = i18n.language?.toLowerCase().startsWith("zh") ?? false;
  const ungroundedText = t("meeting.askUngrounded", isZh ? UNGROUNDED_ANSWER_ZH : UNGROUNDED_ANSWER_EN);
  const answerMayErrText = t("meeting.askAnswerMayErr", isZh ? "答案由 AI 生成，可能出错；请点开原文核对。" : "AI-generated answer; it may be wrong. Check the cited sources.");
  // Only ids that exist in the transcript may ever open; ids from any other
  // origin are treated as unavailable instead of being rendered as links.
  const knownFinalIds = new Set(transcript.filter((segment) => segment.final).map((segment) => segment.id));

  const ask = async () => {
    const clean = question.trim().slice(0, 500);
    if (!clean || busy || !transcript.length) return;
    setBusy(true);
    setError("");
    try {
      const context = buildMeetingAIContext(transcript, { question: clean });
      const included = new Set((JSON.parse(context) as { segments: Array<{ id: string }> }).segments.map((segment) => segment.id));
      // Loaded on demand so this read-only panel stays importable without the
      // full meeting transport stack; the dialog already holds the same module.
      const { meetingManager } = await import("@App/libs/meeting/meetingManager");
      const result = await meetingManager.requestMeetingAI("question", context, isZh ? "zh" : "en");
      const answer = resolveMeetingQuestionAnswer(result, included, clean, ungroundedText);
      if (!answer) throw new Error("invalid answer");
      onAnswer(answer);
      setQuestion("");
    } catch {
      setError(t("meeting.askUnavailable", "暂时无法回答，请稍后重试；会议原文仍可查看。"));
    } finally {
      setBusy(false);
    }
  };

  return <Box component="section" aria-label={t("meeting.askMeeting", "问会议")} data-testid="meeting-ask-panel" sx={{ borderTop: "1px solid", borderColor: "divider", pt: 2, mt: 2 }}>
    <Typography sx={{ fontSize: "0.875rem", fontWeight: 800, color: "text.primary" }}>{t("meeting.askMeeting", "问会议")}</Typography>
    <Typography sx={{ mt: 0.5, color: "text.secondary", fontSize: "0.75rem", lineHeight: 1.5 }}>{t("meeting.askMeetingPrivacy", "问题和回答仅你可见；问题与最近的会议原文会发送给 AI 服务，答案可能出错。")}</Typography>
    {answers.map((item, index) => {
      const sourceIds = [...new Set(item.sourceIds.filter((id) => knownFinalIds.has(id)))].slice(0, MAX_QUESTION_SOURCE_IDS);
      return <Box key={`${index}-${item.question}`} data-testid="meeting-ask-answer" sx={{ mt: 1.25, borderLeft: "2px solid", borderColor: "primary.light", pl: 1.25 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "text.primary", fontWeight: 750, overflowWrap: "anywhere" }}>{item.question}</Typography>
        {sourceIds.length ? <>
          <Typography data-testid="meeting-ask-answer-text" sx={{ mt: 0.35, fontSize: "0.8rem", color: "text.secondary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.answer}</Typography>
          <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>{sourceIds.map((id, sourceIndex) => <Button key={id} size="small" data-testid="meeting-ask-source" onClick={() => onViewTranscript(id)} sx={{ minHeight: 40, textTransform: "none" }}>{t("meeting.askSource", "查看原文")} {sourceIndex + 1}</Button>)}</Stack>
          <Typography data-testid="meeting-ask-may-err" sx={{ mt: 0.5, color: "text.disabled", fontSize: "0.7rem" }}>{answerMayErrText}</Typography>
        </> : <>
          <Typography data-testid="meeting-ask-answer-text" sx={{ mt: 0.35, fontSize: "0.8rem", color: "text.secondary", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ungroundedText}</Typography>
          <Typography sx={{ mt: 0.5, color: "text.disabled", fontSize: "0.7rem" }}>{t("meeting.askNoSource", "没有可核对的原文引用")}</Typography>
        </>}
      </Box>;
    })}
    {error && <Alert severity="warning" sx={{ mt: 1, fontSize: "0.75rem" }}>{error}</Alert>}
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1 }}>
      <TextField size="small" fullWidth value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 500))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} placeholder={t("meeting.askPlaceholder", "刚才决定了什么？")} inputProps={{ "aria-label": t("meeting.askMeeting", "问会议"), maxLength: 500 }} disabled={!transcript.length || busy} />
      <Button variant="contained" disabled={!question.trim() || !transcript.length || busy} onClick={() => void ask()} sx={{ minHeight: 40, minWidth: 56, flexShrink: 0, textTransform: "none" }}>{busy ? <CircularProgress size={18} color="inherit" /> : t("meeting.askSend", "提问")}</Button>
    </Stack>
  </Box>;
}
