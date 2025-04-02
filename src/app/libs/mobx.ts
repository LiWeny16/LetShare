import { ThemeKey } from '@Com/Theme/ThemeSelector';
import { makeAutoObservable, reaction, runInAction } from 'mobx';

const STORAGE_KEY = 'user_settings';

const DEFAULT_SETTINGS = {
    roomId: '',
    userTheme: 'light' as ThemeKey | 'light',
    userLanguage: 'system',
    backupBackWsUrl: "wss://md-server-md-server-bndnqhexdf.cn-hangzhou.fcapp.run",
    ablyKey: "4TtssQ.e9OvDA:wYBGdtWQNgicbeIKNtgeV_s5XEKmfLKD_Gue5XQrWuw",
    version: "3.3.0",
    isNewUser: true
};
export type SettingsKey = keyof typeof DEFAULT_SETTINGS;

const DEFAULT_UNRMB = {
    settingsPageState: false
};

type UnrmbKey = keyof typeof DEFAULT_UNRMB;

class SettingsStore {
    settings: Record<SettingsKey, any> = { ...DEFAULT_SETTINGS };
    unrmb: Record<UnrmbKey, any> = { ...DEFAULT_UNRMB }; // 🆕 临时状态

    constructor() {
        makeAutoObservable(this);
        this.loadFromLocalStorage();

        // 自动保存 settings 到 localStorage（unrmb 不存）
        reaction(
            () => this.settings,
            (newSettings) => {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
            }
        );
    }

    update<K extends SettingsKey>(
        key: K,
        value: typeof DEFAULT_SETTINGS[K] | Partial<typeof DEFAULT_SETTINGS[K]>
    ) {
        if (!(key in DEFAULT_SETTINGS)) {
            throw new Error(`❌ update() 不允许的设置项: ${key}`);
        }

        const current = this.settings[key];

        if (typeof value === 'object' && value !== null && typeof current === 'object' && !Array.isArray(current)) {
            this.settings[key] = { ...current, ...value };
        } else {
            this.settings[key] = value;
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    }

    get<K extends SettingsKey>(key: K): typeof DEFAULT_SETTINGS[K] | undefined {
        if (!(key in DEFAULT_SETTINGS)) {
            throw new Error(`❌ get() 不允许的设置项: ${key}`);
        }
        return this.settings[key];
    }

    getUnrmb<K extends UnrmbKey>(key: K): typeof DEFAULT_UNRMB[K] | undefined {
        if (!(key in DEFAULT_UNRMB)) {
            throw new Error(`❌ getUnrmb() 不允许的字段: ${key}`);
        }
        return this.unrmb[key];
    }

    updateUnrmb<K extends UnrmbKey>(key: K, value: typeof DEFAULT_UNRMB[K]) {
        if (!(key in DEFAULT_UNRMB)) {
            throw new Error(`❌ updateUnrmb() 不允许的字段: ${key}`);
        }
        this.unrmb[key] = value;
    }

    getAllSettings(): Record<SettingsKey, any> {
        return { ...this.settings };
    }

    reset() {
        runInAction(() => {
            this.settings = { ...DEFAULT_SETTINGS };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    }

    private loadFromLocalStorage() {
        const raw = localStorage.getItem(STORAGE_KEY);

        try {
            const parsed = raw ? JSON.parse(raw) : null;

            const isValid =
                parsed &&
                typeof parsed === 'object' &&
                Object.keys(DEFAULT_SETTINGS).every((key) => key in parsed);

            if (isValid) {
                runInAction(() => {
                    this.settings = { ...DEFAULT_SETTINGS, ...parsed };
                });
            } else {
                throw new Error('无效配置或字段缺失，已重置为默认值');
            }
        } catch (e) {
            console.warn(`⚠️ 加载配置失败，使用默认设置:`, e);
            runInAction(() => {
                this.settings = { ...DEFAULT_SETTINGS };
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
        }
    }
}

const settingsStore = new SettingsStore();
export default settingsStore;
