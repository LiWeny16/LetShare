import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resources } from '../src/app/libs/i18n/translation';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..', 'src');
const I18N_DIR = join(SRC_DIR, 'app', 'libs', 'i18n');
const REQUIRED_LOCALES = ['en', 'zh', 'ms', 'id'] as const;
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

type LocaleMap = Record<string, string>;

function flatten(obj: unknown, prefix: string, out: LocaleMap): void {
    if (obj === null || typeof obj !== 'object') {
        if (typeof obj === 'string') out[prefix] = obj;
        return;
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${key}` : key;
        flatten(value, path, out);
    }
}

function isCovered(locale: LocaleMap, key: string): boolean {
    if (key in locale) return true;
    return PLURAL_SUFFIXES.some((suffix) => `${key}${suffix}` in locale);
}

function collectSourceFiles(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (full === I18N_DIR) continue;
            collectSourceFiles(full, out);
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
            out.push(full);
        }
    }
}

test('every literal t() key in src is covered in en, zh, ms and id', () => {
    const locales: Record<string, LocaleMap> = {};
    for (const locale of REQUIRED_LOCALES) {
        const flat: LocaleMap = {};
        flatten((resources as Record<string, { translation: unknown }>)[locale].translation, '', flat);
        locales[locale] = flat;
    }

    const files: string[] = [];
    collectSourceFiles(SRC_DIR, files);
    assert.ok(files.length > 0, 'expected at least one source file to scan');

    const keyRegex = /\bt\(\s*(["'`])([A-Za-z0-9_.]+)\1/g;
    const keys = new Set<string>();
    for (const file of files) {
        const content = readFileSync(file, 'utf8');
        for (const match of content.matchAll(keyRegex)) {
            keys.add(match[2]);
        }
    }
    assert.ok(keys.size > 0, 'expected at least one literal translation key to be scanned');

    const missing = new Map<string, string[]>();
    for (const key of [...keys].sort()) {
        const absent = REQUIRED_LOCALES.filter((locale) => !isCovered(locales[locale], key));
        if (absent.length > 0) missing.set(key, absent);
    }

    const lines = [...missing.entries()]
        .map(([key, absent]) => `${key}: ${absent.join(', ')}`)
        .join('\n');
    assert.equal(
        missing.size,
        0,
        `${missing.size} of ${keys.size} scanned translation keys are missing:\n${lines}\n` +
        `locales checked: ${REQUIRED_LOCALES.join(', ')}; scanned files: ${files.length}; scanned keys: ${keys.size}`
    );
});
