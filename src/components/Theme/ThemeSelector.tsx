import { Box, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";
import settingsStore from "@App/libs/mobx/mobx";

const themes = [
 { key: "light", color: "#f5f5f5", labelKey: "settings.themeLight", label: "亮色" },
 { key: "dark", color: "#212121", labelKey: "settings.themeDark", label: "暗色" },
 { key: "blue", color: "#1976d2", labelKey: "settings.themeBlue", label: "蓝色" },
 { key: "green", color: "#388e3c", labelKey: "settings.themeGreen", label: "绿色" },
 { key: "sunset", color: "#f57c00", labelKey: "settings.themeSunset", label: "日落橙" },
 { key: "coolGray", color: "#90a4ae", labelKey: "settings.themeCoolGray", label: "冷灰" },
];

export type ThemeKey = typeof themes[number]["key"];

const ThemeSelector = () => {
 const { t } = useTranslation();
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
   {themes.map((theme) => {
    const isSelected = selected === theme.key;

    return (
     <Tooltip title={t(theme.labelKey, theme.label)} key={theme.key} arrow>
      <div
       tabIndex={0}
       onClick={() => handleSelect(theme.key)}
       style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        backgroundColor: theme.color,
        cursor: "pointer",
        marginLeft: isSelected ? 8 : 0,
        marginRight: isSelected ? 8 : 0,
        transform: isSelected ? "scale(1.4)" : "scale(1)",
        boxShadow: isSelected
         ? "0 0 0 3px rgba(0,0,0,0.3)"
         : "0 0 0 1px rgba(0,0,0,0.2)",
        transition:
         "transform 0.2s ease, margin 0.2s ease, box-shadow 0.2s ease",
        outline: "none", // 消除安卓蓝框
        WebkitTapHighlightColor: "transparent", // 消除点击残影
       }}
       onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = isSelected
         ? "scale(1.4)"
         : "scale(1.2)";
       }}
       onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = isSelected
         ? "scale(1.4)"
         : "scale(1)";
       }}
      />
     </Tooltip>
    );
   })}
  </Box>
 );
};

export default ThemeSelector;
