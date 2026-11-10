import type { AsrSource, MeetingTranscriptSegment } from "./meetingAi";

export type MeetingCaptionLanguage = "zh-CN" | "en-US";

export type MeetingServerAsrCapabilities = { stream: boolean; chunk: boolean; ai: boolean };

/** Why the caption bar cannot capture on this deployment. */
export type CaptionEngineNote = "" | "captionsEngineUnsupported";

/**
 * A deployment that never configured the server streaming recognizer produces
 * no text and no error, so surface that instead of staying silent.
 */
export function resolveCaptionEngine(
  engine: AsrSource,
  capabilities: MeetingServerAsrCapabilities,
): { engine: AsrSource; switched: boolean; note: CaptionEngineNote } {
  if (engine === "server-stream" && !capabilities.stream) return { engine, switched: false, note: "captionsEngineUnsupported" };
  return { engine, switched: false, note: "" };
}

export function captionTranslationKey(id: string, target: MeetingCaptionLanguage): string {
  return JSON.stringify([id, target]);
}

export function captionSourceLanguage(segment: MeetingTranscriptSegment): MeetingCaptionLanguage {
  // ASR is configured per speaker, but an utterance may contain the other
  // language. Prefer strong textual evidence; ambiguous/mixed fragments fall
  // back to the speaker's selected recognition language.
  const han = (segment.text.match(/[\u3400-\u9fff]/gu) || []).length;
  const latin = (segment.text.match(/[A-Za-z]/g) || []).length;
  if (han >= 2 && han * 2 >= latin) return "zh-CN";
  if (latin >= 3 && latin >= han * 3) return "en-US";
  return segment.language || (han > 0 ? "zh-CN" : "en-US");
}
