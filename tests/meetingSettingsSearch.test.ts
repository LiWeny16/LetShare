import test from 'node:test';
import assert from 'node:assert/strict';
import i18next from 'i18next';
import { resources } from '../src/app/libs/i18n/translation';
import { activeMeetingSettingsSection, meetingSettingsScrollTop, searchMeetingSettings, type SettingsSearchSection } from '../src/components/meeting/components/meetingSettingsSearch';

async function localizedSections(language: 'zh' | 'en' | 'ms' | 'id'): Promise<SettingsSearchSection[]> {
  const i18n = i18next.createInstance();
  await i18n.init({ resources, lng: language, fallbackLng: 'en' });
  return [
    { id: 'identity', title: i18n.t('meeting.settingsIdentity'), items: [[i18n.t('meeting.displayName'), i18n.t('meeting.nameHint')]] },
    { id: 'devices', title: i18n.t('meeting.settingsDevices'), items: [[i18n.t('call.microphone'), 'USB Studio Mic'], [i18n.t('call.camera'), 'HD Camera']] },
    { id: 'audio', title: i18n.t('meeting.settingsAudio'), items: [[i18n.t('call.nsMode'), 'RNNoise'], [i18n.t('call.spatialAudio'), i18n.t('meeting.spatialAudioHint')]] },
  ];
}

test('finds setting labels and descriptions in the current language', async () => {
  const zh = await localizedSections('zh');
  assert.deepEqual(searchMeetingSettings(zh, '降噪'), [{ id: 'audio', indices: [0] }]);
  assert.deepEqual(searchMeetingSettings(zh, '成员列表'), [{ id: 'identity', indices: [0] }]);
  const en = await localizedSections('en');
  assert.deepEqual(searchMeetingSettings(en, 'microphone'), [{ id: 'devices', indices: [0] }]);
  const ms = await localizedSections('ms');
  assert.deepEqual(searchMeetingSettings(ms, 'kamera'), [{ id: 'devices', indices: [1] }]);
  const id = await localizedSections('id');
  assert.deepEqual(searchMeetingSettings(id, 'mikrofon'), [{ id: 'devices', indices: [0] }]);
});

test('matches device names and section headings without requiring exact case', async () => {
  const sections = await localizedSections('en');
  assert.deepEqual(searchMeetingSettings(sections, ' usb studio '), [{ id: 'devices', indices: [0] }]);
  assert.deepEqual(searchMeetingSettings(sections, 'RNNOISE'), [{ id: 'audio', indices: [0] }]);
  assert.deepEqual(searchMeetingSettings(sections, sections[1].title), [{ id: 'devices', indices: [0, 1] }]);
  assert.equal(searchMeetingSettings(sections, '  ').length, sections.length);
});

test('keeps navigation on a visible section or moves it to the first result', async () => {
  const sections = await localizedSections('en');
  const results = searchMeetingSettings(sections, 'camera');
  assert.equal(activeMeetingSettingsSection(results, 'identity'), 'devices');
  assert.equal(activeMeetingSettingsSection(results, 'devices'), 'devices');
  assert.equal(meetingSettingsScrollTop(200, 100, 280), 364);
  assert.equal(meetingSettingsScrollTop(0, 100, 100), 0);
  const empty = searchMeetingSettings(sections, 'no matching setting');
  assert.deepEqual(empty, []);
  assert.equal(activeMeetingSettingsSection(empty, 'devices'), undefined);
});
