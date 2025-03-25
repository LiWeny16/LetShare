import { useState, useEffect } from "react";
import { Typography, TextField } from "@mui/material";
import realTimeColab, { getStatesMemorable, changeStatesMemorable } from "@App/colabLib";

const EditableUserId = ({ onEditDone }: { onEditDone?: (newId: string) => void }) => {
    const [editing, setEditing] = useState(false);
    const [userId, setUserId] = useState("");

    useEffect(() => {
        const storedId = getStatesMemorable().memorable.localLANId;
        setUserId(storedId);
    }, []);

    const handleSave = () => {
        let cleanId = userId.trim();
        // if (!cleanId) return;
        if (!cleanId) {
            cleanId = realTimeColab.generateUUID()
            setUserId(cleanId)
        }

        changeStatesMemorable({ memorable: { localLANId: cleanId } });
        realTimeColab.setUniqId(cleanId); // 强行同步静态字段
        setEditing(false);

        if (onEditDone) onEditDone(cleanId);
    };

    return (
        <>
            {editing ? (
                <TextField
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleSave();
                        }
                    }}
                    autoFocus
                    variant="standard"
                    inputProps={{
                        style: { textAlign: "center" }
                    }}
                    sx={{ mt: 2, display: "block", mx: "auto" }}
                />
            ) : (
                <Typography
                    variant="body2"
                    color="textSecondary"
                    align="center"
                    sx={{ mt: 2, cursor: "pointer" }}
                    onClick={() => setEditing(true)}
                >
                    你的ID: {userId}
                </Typography>
            )}
        </>
    );
};

export default EditableUserId;
