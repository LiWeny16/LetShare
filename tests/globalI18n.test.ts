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
    ['chat.dropToSend', '松开即可发送', 'Drop to send'],
    ['call.voice', '语音通话', 'Voice call'],
    ['proPlan.choose', '选择计划', 'Choose a plan'],
  ];
  for (const [key, zh] of samples) assert.equal(i18n.t(key), zh, key);
  await i18n.changeLanguage('en');
  for (const [key, , en] of samples) assert.equal(i18n.t(key), en, key);
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
