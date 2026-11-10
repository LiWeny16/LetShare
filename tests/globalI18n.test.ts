import test from 'node:test';
import assert from 'node:assert/strict';
import i18next from 'i18next';
import { resolveLanguagePreference } from '../src/app/libs/i18n/language';
import { resources } from '../src/app/libs/i18n/translation';
import { malayAdditionalTranslations } from '../src/app/libs/i18n/malayAdditionalTranslations';

test('system language follows browser locale while explicit choices are preserved', () => {
  assert.equal(resolveLanguagePreference('system', 'zh-CN'), 'zh');
  assert.equal(resolveLanguagePreference('system', 'id-ID'), 'id');
  assert.equal(resolveLanguagePreference('system', 'ms-MY'), 'ms');
  assert.equal(resolveLanguagePreference('system', 'fr-FR'), 'en');
  assert.equal(resolveLanguagePreference('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguagePreference('zh', 'en-US'), 'zh');
});

test('Chinese and English meeting, chat, call and plan labels do not fall through to another language', async () => {
  const i18n = i18next.createInstance();
  await i18n.init({ resources, lng: 'zh', fallbackLng: 'en' });
  const samples = [
    ['meeting.membersTitle', '会议成员', 'Meeting members'],
    ['meeting.entryJoinTitle', '加入会议', 'Join meeting'],
    ['meeting.inviteAction', '邀请', 'Invite'],
    ['meeting.aiMoreMinutesNoticeTitle', 'AI 会议纪要通知', 'AI meeting notes notice'],
    ["meeting.aiMoreMinutesNoticeDescription", "有成员开启了 AI 会议纪要。即使你暂停接收，你发布的麦克风音频仍会参与共享转写和摘要。静音麦克风才会停止发布音频。", "A member has started AI meeting notes. Your published microphone audio remains in the shared transcript and summary even if you pause receiving notes. Muting your microphone stops publishing audio."],
    ['meeting.aiMoreMinutesNoticeAcknowledge', '知道了', 'Got it'],
    ['meeting.aiMoreMeetingAssistant', '会议助理', 'Meeting assistant'],
    ['meeting.aiMoreMinutesOutputLanguage', '纪要生成语言', 'Summary language'],
    ['meeting.aiMoreMarkdownTranscript', '逐字稿', 'Transcript'],
    ["meeting.aiMoreMarkdownContextTruncated", "部分较早上下文已精简，请查看共享转写中的完整内容。", "Some earlier context was shortened. Check the shared transcript for full text."],
    ['meeting.aiMoreWaitingForTranscript', '等待发言和转写……', 'Waiting for speech and transcript…'],
    ['meeting.aiMoreSummaryBroadcastNotConfirmed', '服务器尚未确认这份摘要。原文仍然保留，请稍后重试。', 'The server did not confirm this summary. The transcript is still available; try again shortly.'],
    ['meeting.aiMoreSummaryHistoryMayBeIncomplete', '部分较早的转写片段已不在服务器记录中，因此这份摘要可能不完整。', 'Some earlier transcript segments are no longer available, so this summary may be incomplete.'],
    ['meeting.aiMoreTranscriptionUnavailable', '语音转写暂不可用，请检查服务或稍后重试。', 'Speech transcription is temporarily unavailable. Check the service or try again later.'],
    ['meeting.aiMoreMinutesPaused', '你已暂停接收', 'Paused for you'],
    ['meeting.aiMorePauseMinutes', '停止接收纪要', 'Stop receiving'],
    ['meeting.aiMoreResumeMinutes', '恢复接收纪要', 'Resume receiving'],
    ["meeting.aiMoreSummaryContextTooLarge", "为保持共享纪要持续更新，已精简部分较早上下文。完整内容仍可在转写中查看。", "Some earlier context was shortened so shared notes can keep updating. Check the transcript for the full text."],
    ['call.voice', '语音通话', 'Voice call'],
    ['proPlan.choose', '选择计划', 'Choose a plan'],
  ];
  for (const [key, zh] of samples) assert.equal(i18n.t(key), zh, key);
  await i18n.changeLanguage('en');
  for (const [key, , en] of samples) assert.equal(i18n.t(key), en, key);
  assert.equal(i18n.t('meeting.aiMoreExpectedServices', { asr: 'Somni', summary: 'Gemini' }), 'Expected services: Somni transcription · Gemini summary');
  await i18n.changeLanguage('zh');
  assert.equal(i18n.t('meeting.aiMoreExpectedServices', { asr: 'Somni', summary: 'Gemini' }), '预期服务：Somni 转写 · Gemini 摘要');
});

test('all English meeting strings have Chinese resources', () => {
  const en = resources.en.translation.meeting;
  const zh = resources.zh.translation.meeting as Record<string, unknown>;
  const missing = Object.keys(en).filter((key) => !(key in zh));
  assert.deepEqual(missing, []);
});

test('Malay additions cover the English transfer, chat, call and meeting keys', () => {
  for (const group of ['transfer', 'chat', 'call', 'meeting'] as const) {
    const english = resources.en.translation[group] as Record<string, unknown>;
    const existing = resources.ms.translation[group] as Record<string, unknown>;
    const added = malayAdditionalTranslations[group] as Record<string, unknown>;
    const missing = Object.keys(english).filter((key) => !(key in existing) && !(key in added));
    assert.deepEqual(missing, [], group);
  }
});

test('all supported locales cover English keys and preserve interpolation variables', () => {
  const flatten = (object: Record<string, unknown>, prefix = ''): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(object)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') Object.assign(result, flatten(value as Record<string, unknown>, fullKey));
      else if (typeof value === 'string') result[fullKey] = value;
    }
    return result;
  };
  const variables = (value: string) => [...new Set([...value.matchAll(/{{\s*([\w.]+).*?}}/g)].map((match) => match[1]))].sort();
  const english = flatten(resources.en.translation);
  for (const language of ['zh', 'ms', 'id'] as const) {
    const translated = flatten(resources[language].translation);
    for (const [key, value] of Object.entries(english)) {
      assert.ok(key in translated, `${language} is missing ${key}`);
      assert.deepEqual(variables(translated[key]), variables(value), `${language} interpolation for ${key}`);
    }
  }
});

test('minutes notice and shared-language copy reflect member-led recording in all locales', () => {
  const semanticCopy = {
    en: { notice: 'A member has started', settings: 'first member to start', participant: 'Any member can start', markdown: 'Some earlier context was shortened' },
    zh: { notice: '有成员开启了', settings: '首次开启', participant: '任何成员都可以开启', markdown: '部分较早上下文已精简' },
    ms: { notice: 'Seorang ahli telah memulakan', settings: 'Ahli pertama yang memulakan', participant: 'Mana-mana ahli boleh memulakan', markdown: 'Sebahagian konteks terdahulu dipendekkan' },
    id: { notice: 'Seorang anggota telah memulai', settings: 'Anggota pertama yang memulai', participant: 'Setiap anggota dapat memulai', markdown: 'Sebagian konteks sebelumnya dipersingkat' },
  } as const;
  for (const language of ['en', 'zh', 'ms', 'id'] as const) {
    const meeting = resources[language].translation.meeting as Record<string, string>;
    ["meeting.aiMoreMinutesNoticeDescription", "有成员开启了 AI 会议纪要。即使你暂停接收，你发布的麦克风音频仍会参与共享转写和摘要。静音麦克风才会停止发布音频。", "A member has started AI meeting notes. Your published microphone audio remains in the shared transcript and summary even if you pause receiving notes. Muting your microphone stops publishing audio."],
    assert.ok(meeting.aiMoreMinutesOutputLanguageDescription.includes(semanticCopy[language].settings), language);
    assert.ok(meeting.aiMoreMinutesParticipantInfo.includes(semanticCopy[language].participant), language);
    assert.ok(meeting.aiMoreMarkdownContextTruncated.includes(semanticCopy[language].markdown), language);
  }
});
