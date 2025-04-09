import { useState, useEffect, useRef } from "react";
import { Typography, TextField } from "@mui/material";
import realTimeColab from "@App/libs/connection/colabLib";
import { useTranslation } from "react-i18next";

const EditableUserId = ({ onEditDone }: { onEditDone?: (newId: string) => void }) => {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [userId, setUserId] = useState("");
    const [error, setError] = useState(false);
    const originalIdRef = useRef("");

    useEffect(() => {
        const storedId = realTimeColab.getUserId();
        if (storedId) {
            setUserId(storedId);
            originalIdRef.current = storedId;
        }

    }, []);

    const validPattern = /^[\u4e00-\u9fa5a-zA-Z0-9\u{1F000}-\u{1FFFF}]*$/u;


    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setUserId(value);
        setError(!validPattern.test(value));
    };

    const handleSave = () => {
        const cleanId = userId.trim();

        if (!validPattern.test(cleanId) || !cleanId) {
            setUserId(originalIdRef.current);
            setError(true);
            setEditing(false);
            return;
        }
        // realTimeColab.changeStatesMemorable({ memorable: { localLANId: cleanId } });
        realTimeColab.setUserId(cleanId);
        originalIdRef.current = cleanId;
        setError(false);
        setEditing(false);
        if (onEditDone) onEditDone(cleanId);
    };

    return (
        <>
            {editing ? (
                <TextField
                    value={userId}
                    onChange={handleInputChange}
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleSave();
                        }
                    }}
                    autoFocus
                    variant="standard"
                    error={error}
                    helperText={error ? t('userId.inputError') : ""}
                    inputProps={{
                        style: { textAlign: "center" },
                        maxLength: 12
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
                    {t('userId.display')}: {userId}
                </Typography>
            )}
        </>
    );
};

export default EditableUserId;
