// ✅ 通用 setter（泛型版）
type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;
type StringSetter = StateSetter<string>;
type NumberSetter = StateSetter<number>
type BooleanSetter = StateSetter<boolean>;
type ArraySetter<T> = StateSetter<T[]>;
type ObjectSetter<T extends object> = StateSetter<T>;
type UserType = "apple" | "android" | "desktop"
type LanguageType = 'system' | 'en' | 'zh' | 'ms' | 'id';

// width: {
//     xs: '100%',     // 手机：占满
//     sm: "100%",        // 小屏：固定 480px
//     md: 600,        // 中屏：600px
//     lg: 720,        // 大屏：720px
//     xl: 960         // 超大屏：960px
// },