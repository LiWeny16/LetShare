// ✅ 通用 setter（泛型版）
type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;
type StringSetter = StateSetter<string>;
type NumberSetter = StateSetter<number>
type BooleanSetter = StateSetter<boolean>;
type ArraySetter<T> = StateSetter<T[]>;
type ObjectSetter<T extends object> = StateSetter<T>;
type UserType = "apple" | "android" | "desktop"