/**
 * meeting/ParticipantsPanel — 成员面板（右侧）：成员列表 + 房主徽章 + 房主踢人。
 */
import { useState } from "react";
import { Avatar, IconButton, List, ListItem, ListItemAvatar, ListItemText, Tooltip, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import StarIcon from "@mui/icons-material/Star";
import { useTranslation } from "react-i18next";
import realTimeColab from "@App/libs/connection/colabLib";
import { meetingManager } from "@App/libs/meeting/meetingManager";
import type { MeetingState } from "@App/libs/meeting/meetingManager";
import { displayNameOf } from "../types";

export function ParticipantsPanel({ state }: { state: MeetingState }) {
  const { t } = useTranslation();
  const [kicking, setKicking] = useState<string | null>(null);
  const selfId = realTimeColab.getUniqId() ?? "";
  const amHost = !!state.hostId && state.hostId === selfId;

  // 成员表不含自己（快照过滤），面板需展示：自己 + 房主置顶
  const rows = [
    { uniqId: selfId },
    ...state.members,
  ].sort((a, b) => {
    if (a.uniqId === state.hostId) return -1;
    if (b.uniqId === state.hostId) return 1;
    return 0;
  });

  return (
    <List dense sx={{ overflowY: "auto", flex: 1, minHeight: 0, px: 0.5 }}>
      {rows.map((m) => {
        const isHost = m.uniqId === state.hostId;
        const isSelf = m.uniqId === selfId;
        return (
          <ListItem
            key={m.uniqId}
            secondaryAction={
              isHost ? (
                <Tooltip title={t("meeting.hostBadge", "房主")}>
                  <StarIcon sx={{ fontSize: 16, color: "warning.main" }} />
                </Tooltip>
              ) : amHost && !isSelf ? (
                <Tooltip title={t("meeting.kick", "移出会议")}>
                  <IconButton
                    size="small"
                    edge="end"
                    color="error"
                    disabled={kicking === m.uniqId}
                    onClick={() => { setKicking(m.uniqId); meetingManager.kick(m.uniqId); setTimeout(() => setKicking(null), 1200); }}
                  >
                    <PersonRemoveIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              ) : undefined
            }
            sx={{ borderRadius: 2 }}
          >
            <ListItemAvatar sx={{ minWidth: 40 }}>
              <Avatar sx={{ width: 30, height: 30, fontSize: 14, bgcolor: isHost ? "warning.main" : "primary.main" }}>
                {displayNameOf(m.uniqId, "?").slice(0, 1).toUpperCase() || <PersonIcon />}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={isSelf ? `${displayNameOf(m.uniqId, t("meeting.you", "我"))}（${t("meeting.you", "我")}）` : displayNameOf(m.uniqId)}
              primaryTypographyProps={{ fontSize: "0.85rem", noWrap: true }}
            />
          </ListItem>
        );
      })}
      {rows.length === 0 && (
        <Typography sx={{ color: "text.disabled", fontSize: "0.78rem", textAlign: "center", mt: 3 }}>
          {t("meeting.noMembers", "暂无其他成员")}
        </Typography>
      )}
    </List>
  );
}
