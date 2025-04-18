import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import settingsStore from '../mobx/mobx';
import { resources } from './translation';



// 从 MobX store 获取语言设置
const storedLang = settingsStore.get('userLanguage') as LanguageType | null;

// 如果为空，默认设为 'en'
const userLang: LanguageType = storedLang ?? 'system';

// 解析最终用于 i18n 的语言
const getEffectiveLang = (): string => {
    if (userLang === 'system') {
        const lang = navigator.language.toLowerCase();
        if (lang.startsWith('zh')) return 'zh';
        if (lang.startsWith('ms')) return 'ms';
        if (lang.startsWith('id')) return 'id';
        return 'en';
    }
    return userLang;
};

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
    }).then(() => {
        document.title = i18n.t('meta.title');
        document.documentElement.lang = getEffectiveLang();
    });

export default i18n;