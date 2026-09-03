import { useMemo } from "react";
import { Box, Stack, Typography, useTheme, useMediaQuery } from "@mui/material";
import type { FormFactor } from "../types";
import type { MemberTileData } from "../types";
import { MemberTile } from "./MemberTile";
import { useTranslation } from "react-i18next";

interface VideoWallProps {
  tiles: MemberTileData[];
  /** 当前焦点（放大/说话人）瓦片的 uniqId。 */
  focusedUniqId: string;
  onSelectFocus: (uniqId: string) => void;
  formFactor: FormFactor;
}

/**
 * 成员视频墙。
 * - 桌面/平板：多列自适应网格（CSS grid auto-fill）。
 * - 手机：单主视角（焦点瓦片）占满宽度 + 底部横向缩略条。
 */
export function VideoWall({ tiles, focusedUniqId, onSelectFocus, formFactor }: VideoWallProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const sorted = useMemo(() => {
    // 焦点置前，便于手机端展示为主视角
    return [...tiles].sort((a, b) => {
      if (a.uniqId === focusedUniqId) return -1;
      if (b.uniqId === focusedUniqId) return 1;
      return 0;
    });
  }, [tiles, focusedUniqId]);

  if (tiles.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography color="text.secondary">{t("meeting.noMembers", "暂无成员")}</Typography>
      </Box>
    );
  }

  // 手机：焦点瓦片 + 底部横向缩略条
  if (formFactor === "mobile" || isMobile) {
    const [focus, ...rest] = sorted;
    return (
      <Stack direction="column" spacing={1.5} sx={{ height: "100%" }}>
        {focus && <MemberTile tile={focus} isFocused onFocus={() => onSelectFocus(focus.uniqId)} />}
        {rest.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ overflowX: "auto", pb: 0.5, "&::-webkit-scrollbar": { height: 6 } }}
          >
            {rest.map((tile) => (
              <Box key={tile.uniqId} sx={{ width: 160, flexShrink: 0 }}>
                <MemberTile tile={tile} isFocused={false} onFocus={() => onSelectFocus(tile.uniqId)} />
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }

  // 桌面/平板：多列网格
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 1.5,
        height: "100%",
        alignContent: "start",
      }}
    >
      {sorted.map((tile) => (
        <MemberTile
          key={tile.uniqId}
          tile={tile}
          isFocused={tile.uniqId === focusedUniqId}
          onFocus={() => onSelectFocus(tile.uniqId)}
        />
      ))}
    </Box>
  );
}
