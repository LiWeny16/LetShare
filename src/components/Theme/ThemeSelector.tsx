import { Box, Tooltip } from "@mui/material";
import { motion, } from "framer-motion";
import settingsStore from "@App/libs/mobx";

const themes = [
    { key: "light", color: "#f5f5f5", label: "亮色" },
    { key: "dark", color: "#212121", label: "暗色" },
    { key: "blue", color: "#1976d2", label: "蓝色" },
    { key: "green", color: "#388e3c", label: "绿色" },
    { key: "sunset", color: "#f57c00", label: "日落橙" },
    { key: "coolGray", color: "#90a4ae", label: "冷灰" },
];

export type ThemeKey = typeof themes[number]["key"];

const ThemeSelector = () => {
    const selected = settingsStore.get("userTheme") || "light";

    const handleSelect = (key: string) => {
        settingsStore.update("userTheme", key);
    };

    return (
        <Box
            sx={{
                borderRadius: "50%",
                display: "flex",
                gap: 1.3,
                justifyContent: "center",
                alignItems: "center",
                flexWrap: "wrap",
            }}
        >
            {themes.map((theme) => (
                <Tooltip title={theme.label} key={theme.key} arrow>
                    <motion.div
                        tabIndex={0} // 让它可被聚焦（点击后）
                        onClick={() => handleSelect(theme.key)}
                        initial={false}
                        animate={{
                            scale: selected === theme.key ? 1.4 : 1,
                            marginLeft: selected === theme.key ? 8 : 0,
                            marginRight: selected === theme.key ? 8 : 0,
                        }}
                        whileHover={{ scale: 1.2 }}
                        transition={{ type: "spring", stiffness: 300, damping: 15 }}
                        style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            backgroundColor: theme.color,
                            cursor: "pointer",
                            outline: "none", // 👈 去除蓝框
                            WebkitTapHighlightColor: "transparent", // 👈 去除 iOS 上点击残影
                            boxShadow:
                                selected === theme.key
                                    ? "0 0 0 3px rgba(0,0,0,0.3)"
                                    : "0 0 0 1px rgba(0,0,0,0.2)",
                        }}
                    />
                </Tooltip>
            ))}
        </Box>
    );
};

export default ThemeSelector;
