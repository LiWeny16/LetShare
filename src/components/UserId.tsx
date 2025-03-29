import { useState, useEffect, useRef } from "react";
import { Typography, TextField } from "@mui/material";
import realTimeColab from "@App/colabLib";

const EditableUserId = ({ onEditDone }: { onEditDone?: (newId: string) => void }) => {
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

    const validPattern = /^[\u4e00-\u9fa5a-zA-Z0-9]*$/;

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
                    helperText={error ? "只允许输入字母、数字和汉字" : " "}
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
