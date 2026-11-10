import { useEffect, useRef, useState } from "react";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import type { MeetingTranscriptSegment } from "@App/libs/meeting/meetingAi";
import type { CaptionLanguage } from "../components/MeetingLiveCaptionsPanel";
import { captionSourceLanguage, captionTranslationKey } from "@App/libs/meeting/meetingCaptions";

export type CaptionTranslation = { state: "pending" | "ready" | "error"; text?: string };
type Item = { id: string; text: string; target: CaptionLanguage; generation: number };

/**
 * Translations are private to this tab and never stored for caption-only use.
 * Only the latest 20 lines are eligible on language switch; one request at a
 * time and a failure cooldown prevent an unavailable provider causing a flood.
 */
export function useMeetingCaptionTranslations(roomId: string, active: boolean, segments: MeetingTranscriptSegment[], target: CaptionLanguage): Map<string, CaptionTranslation> {
  const [translations, setTranslations] = useState<Map<string, CaptionTranslation>>(() => new Map());
  const translationsRef = useRef(translations);
  const queueRef = useRef<Item[]>([]);
  const runningRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const targetRef = useRef(target);
  const generationRef = useRef(0);
  const blockedUntilRef = useRef(0);
  const pumpRef = useRef<() => void>(() => undefined);
  activeRef.current = active;
  targetRef.current = target;

  const update = (key: string, value: CaptionTranslation, generation: number) => {
    if (generation !== generationRef.current) return;
    const next = new Map(translationsRef.current);
    next.set(key, value);
    translationsRef.current = next;
    setTranslations(next);
  };

  pumpRef.current = () => {
    if (runningRef.current !== null || !activeRef.current) return;
    let item = queueRef.current.shift();
    while (item && item.target !== targetRef.current) item = queueRef.current.shift();
    if (!item) return;
    const request = item;
    runningRef.current = request.generation;
    void meetingManager.requestMeetingAI("translate", request.text, request.target === "en-US" ? "en" : "zh").then((text) => {
      if (activeRef.current && text.trim()) update(captionTranslationKey(request.id, request.target), { state: "ready", text: text.trim() }, request.generation);
    }).catch(() => {
      if (request.generation !== generationRef.current) return;
      blockedUntilRef.current = Date.now() + 30_000;
      const next = new Map(translationsRef.current);
      next.set(captionTranslationKey(request.id, request.target), { state: "error" });
      for (const queued of queueRef.current) next.set(captionTranslationKey(queued.id, queued.target), { state: "error" });
      queueRef.current = [];
      translationsRef.current = next;
      setTranslations(next);
    }).finally(() => {
      if (runningRef.current === request.generation) { runningRef.current = null; pumpRef.current(); }
    });
  };

  useEffect(() => {
    generationRef.current += 1;
    queueRef.current = [];
    runningRef.current = null;
    blockedUntilRef.current = 0;
    const next = new Map<string, CaptionTranslation>();
    translationsRef.current = next;
    setTranslations(next);
    return () => { generationRef.current += 1; queueRef.current = []; };
  }, [roomId]);

  useEffect(() => {
    if (!active) {
      queueRef.current = [];
      const next = new Map([...translationsRef.current].filter(([, value]) => value.state !== "pending"));
      if (next.size !== translationsRef.current.size) { translationsRef.current = next; setTranslations(next); }
      return;
    }
    const next = new Map(translationsRef.current);
    let changed = false;
    // Requests queued for a previous display language are no longer useful.
    for (const queued of queueRef.current) if (queued.target !== target) { next.delete(captionTranslationKey(queued.id, queued.target)); changed = true; }
    queueRef.current = queueRef.current.filter((queued) => queued.target === target);
    // Newest first: live lines matter most. Lines beyond the bounded queue are
    // left untranslated rather than showing a "waiting" label forever.
    const candidates = segments.slice(-80).reverse();
    for (const segment of candidates) {
      if (!segment.final || !segment.text.trim() || captionSourceLanguage(segment) === target) continue;
      const key = captionTranslationKey(segment.id, target);
      if (next.has(key)) continue;
      if (queueRef.current.length >= 24) continue;
      const blocked = Date.now() < blockedUntilRef.current;
      next.set(key, { state: blocked ? "error" : "pending" });
      if (!blocked) queueRef.current.push({ id: segment.id, text: segment.text, target, generation: generationRef.current });
      changed = true;
    }
    if (changed) { translationsRef.current = next; setTranslations(next); }
    pumpRef.current();
  }, [active, segments, target]);

  return translations;
}
