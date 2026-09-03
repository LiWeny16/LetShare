import { ThemeKey } from '@Com/Theme/ThemeSelector';
import { makeAutoObservable, reaction, runInAction } from 'mobx';

const STORAGE_KEY = 'user_settings';

const DEFAULT_SETTINGS = {
  roomId: '',
  userTheme: 'light' as ThemeKey,
  userLanguage: 'en' as LanguageType,
  serverMode: 'custom' as 'ably' | 'custom',
  customServerUrl: "wss://ecs.letshare.fun/",
  authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
  ablyKey: "4TtssQ.e9OvDA:wYBGdtWQNgicbeIKNtgeV_s5XEKmfLKD_Gue5XQrWuw",
  transferPriority: 'p2p' as 'p2p' | 'server',
  micDeviceId: "",        // 首选麦克风 deviceId（"" = 系统默认）
  speakerDeviceId: "",    // 首选扬声器 deviceId（"" = 系统默认）
  audioContentHint: "speech" as "speech" | "music", // Opus 编码模式倾向：speech=人声优化，music=音乐模式
  speakerVolume: 1 as number, // 音量 0..2（远端播放音量；1 = 100%，>1 为 Web Audio 增益增强，上限 2 = 200%；0..1 仅元素音量，>1 走音频管线）
  echoCancelType: "browser" as "browser" | "system", // 回声消除引擎：browser=浏览器 AEC3（默认），system=OS 级 AEC（部分设备更好；不支持时浏览器忽略）
  noiseSuppression: true as boolean, // 浏览器噪声抑制开关（关=保真/音乐场景，也为端侧 RNNoise 预留）
  nsMode: "browser" as "off" | "browser" | "rnnoise" | "gtcrn", // 降噪模式：off=关 / browser=浏览器内置 / rnnoise=RNNoise 实验 / gtcrn=GTCRN 实验室新算法
  voiceClarityEnabled: true as boolean,   // 语音增强（清晰度）：远端播放管线 高通 100Hz + 高频搁架 2.8kHz +3dB
  spatialAudioEnabled: false as boolean,  // 空间音频扩展：Haas 效应立体声展宽（单侧 ~15ms 延迟）
  videoDeviceId: "",        // 首选摄像头 deviceId（"" = 系统默认）
  videoQuality: "720p30" as "480p30" | "720p30" | "1080p30" | "720p60" | "1080p60", // 视频分辨率/帧率档位
  videoMaxBitrate: "2000" as "auto" | "2000" | "1500" | "1000" | "750" | "500", // 视频码率上限 kbps（默认 2000=2Mbps 压缩上限，浏览器自适应压码率；auto=不设上限）
  videoCodecPriority: "auto" as "auto" | "h264" | "vp8" | "vp9" | "av1", // 视频编码器优先次序（协商前生效，通话中切换下次生效）
  videoBackground: "off" as "off" | "blur", // 背景模糊（Chromium 118+ 原生约束，不支持时自动降级）
  videoDegradation: "maintain-framerate" as "balanced" | "maintain-framerate" | "maintain-resolution", // 网络差时浏览器降级策略：默认帧率优先（流畅 > 码率/清晰度）
  version: "3.7.0",
  isNewUser: true
};
export type SettingsKey = keyof typeof DEFAULT_SETTINGS;

const DEFAULT_UNRMB = {
  settingsPageState: false,
  isConnectedToServer: false,
  staticIp:"",
  /** 用户连接状态（对标 Discord）：connecting 连接中 / connected 已连接 / reconnecting 重连中 / disconnected 已断开 */
  serverConnState: "disconnected" as "disconnected" | "connecting" | "connected" | "reconnecting",
};

type UnrmbKey = keyof typeof DEFAULT_UNRMB;

class SettingsStore {
  settings: Record<SettingsKey, any> = { ...DEFAULT_SETTINGS };
  unrmb: Record<UnrmbKey, any> = { ...DEFAULT_UNRMB }; // � 临时状态

  constructor() {
    makeAutoObservable(this);
    this.loadFromLocalStorage();
    // version 必须始终跟随 app 构建版本，不能被 localStorage 旧值覆盖
    this.settings.version = DEFAULT_SETTINGS.version;

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
      throw new Error(` update() 不允许的设置项: ${key}`);
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
      throw new Error(` get() 不允许的设置项: ${key}`);
    }
    return this.settings[key];
  }

  getUnrmb<K extends UnrmbKey>(key: K): typeof DEFAULT_UNRMB[K] | undefined {
    if (!(key in DEFAULT_UNRMB)) {
      throw new Error(` getUnrmb() 不允许的字段: ${key}`);
    }
    return this.unrmb[key];
  }

  updateUnrmb<K extends UnrmbKey>(key: K, value: typeof DEFAULT_UNRMB[K]) {
    if (!(key in DEFAULT_UNRMB)) {
      throw new Error(` updateUnrmb() 不允许的字段: ${key}`);
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
      if (!raw) {
        runInAction(() => {
          this.settings = { ...DEFAULT_SETTINGS };
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
        return;
      }

      const parsed = raw ? JSON.parse(raw) : null;

      // 新增设置项后，旧 localStorage 载荷必然缺新键：缺键交给下方默认值合并补全，
      // 不能按"键必须齐全"判无效（否则每次新增字段，老用户全部设置都会被重置一次）
      const isValid = parsed && typeof parsed === 'object' && !Array.isArray(parsed);

      if (isValid) {
        runInAction(() => {
          // auto 模式已废弃（依赖 ipinfo 地区探测，国内网络下会卡）：旧值迁移为国内
          if (parsed.serverMode === 'auto') {
            parsed.serverMode = 'custom';
          }
          // 一次性迁移：老用户曾用 nsMode 前身 noiseSuppression 开关关掉降噪的，映射为 nsMode=off
          if (parsed.noiseSuppression === false && parsed.nsMode === undefined) {
            parsed.nsMode = 'off';
          }
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
        });
      } else {
        throw new Error('无效配置或字段缺失，已重置为默认值');
      }
    } catch (e) {
      console.warn(` 加载配置失败，使用默认设置:`, e);
      runInAction(() => {
        this.settings = { ...DEFAULT_SETTINGS };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    }
  }
}

const settingsStore = new SettingsStore();
export default settingsStore;
