import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import settingsStore from '../mobx/mobx';
import { resources } from './translation';
import { resolveLanguagePreference, type LanguagePreference } from './language';



const getEffectiveLang = () => resolveLanguagePreference(
    settingsStore.get('userLanguage') ?? 'system',
    typeof navigator === 'undefined' ? '' : navigator.language,
);

function updateDocumentLanguage(language: string) {
    if (typeof document === 'undefined') return;
    document.title = i18n.t('meta.title');
    document.documentElement.lang = language;
}

/** Persist and apply language changes consistently from any application surface. */
export async function setAppLanguage(preference: LanguagePreference): Promise<void> {
    settingsStore.update('userLanguage', preference);
    const language = getEffectiveLang();
    await i18n.changeLanguage(language);
    updateDocumentLanguage(language);
}

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        lng: getEffectiveLang(), // 设置初始语言
        fallbackLng: {
            id: ['ms'], // 印尼语 fallback 到马来语
            default: ['en'],
        },
        interpolation: {
            escapeValue: false,
        },
        detection: {
            // 我们不依赖 i18next 的自动检测了，这里只是保底配置
            order: [],
            caches: [],
        },
    }).then(() => updateDocumentLanguage(getEffectiveLang()));

if (typeof window !== 'undefined') {
    window.addEventListener('languagechange', () => {
        if (settingsStore.get('userLanguage') === 'system') {
            const language = getEffectiveLang();
            void i18n.changeLanguage(language).then(() => updateDocumentLanguage(language));
        }
    });
}

export default i18n;
