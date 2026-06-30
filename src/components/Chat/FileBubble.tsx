import React from 'react';
import {
    Box,
    Typography,
    LinearProgress,
    IconButton,
    Button,
    useTheme,
} from '@mui/material';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import MovieIcon from '@mui/icons-material/Movie';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CodeIcon from '@mui/icons-material/Code';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import TableChartIcon from '@mui/icons-material/TableChart';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import SubjectIcon from '@mui/icons-material/Subject';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { FileChatMessage, formatFileSize } from '@App/libs/chat/ChatHistoryManager';

interface FileBubbleProps {
    message: FileChatMessage;
    isMyMessage: boolean;
    onDownload?: (fileKey: string) => void;
    onRetry?: (messageId: string) => void;
}

function getFileIcon(fileCategory: string, fileName: string): React.ReactNode {
    switch (fileCategory) {
        case 'image':
            return <ImageIcon />;
        case 'video':
            return <MovieIcon />;
        case 'archive':
            return <FolderZipIcon />;
        case 'pdf':
            return <PictureAsPdfIcon />;
        case 'code':
            return <CodeIcon />;
        case 'document': {
            const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
            if (['xls', 'xlsx', 'csv'].includes(ext)) return <TableChartIcon />;
            if (['ppt', 'pptx'].includes(ext)) return <SlideshowIcon />;
            if (['txt', 'md', 'rtf'].includes(ext)) return <SubjectIcon />;
            return <TextSnippetIcon />;
        }
        case 'other':
        default:
            return <InsertDriveFileIcon />;
    }
}

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (isToday) {
        return `${hours}:${minutes}`;
    }

    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

const FileBubble: React.FC<FileBubbleProps> = ({ message, isMyMessage, onDownload, onRetry }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const { fileMetadata } = message;
    const { transferStatus, transferProgress, fileName, fileSize, fileCategory, fileKey } = fileMetadata;

    const bubbleBg = isMyMessage
        ? theme.palette.primary.main
        : theme.palette.grey[100];
    const bubbleColor = isMyMessage
        ? theme.palette.primary.contrastText
        : theme.palette.text.primary;
    const secondaryColor = isMyMessage
        ? 'rgba(255, 255, 255, 0.7)'
        : theme.palette.text.secondary;

    const isUploading = transferStatus === 'uploading';
    const isDownloading = transferStatus === 'downloading';
    const isInProgress = isUploading || isDownloading;
    const isCompleted = transferStatus === 'completed';
    const isFailed = transferStatus === 'failed';
    const isReceived = !isMyMessage;

    const handleDownload = () => {
        if (onDownload && fileKey) {
            onDownload(fileKey);
        }
    };

    const handleRetry = () => {
        if (onRetry) {
            onRetry(message.id);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMyMessage ? 'flex-end' : 'flex-start',
            }}
        >
            <Box
                sx={{
                    px: 2,
                    py: 1.5,
                    borderRadius: 3,
                    backgroundColor: bubbleBg,
                    color: bubbleColor,
                    maxWidth: '70%',
                    minWidth: 220,
                    wordBreak: 'break-word',
                    boxShadow: theme.shadows[1],
                }}
            >
                {/* Top row: icon + file info + status/action */}
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    {/* File type icon */}
                    <Box
                        sx={{
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 40,
                            height: 40,
                            borderRadius: 1.5,
                            backgroundColor: isMyMessage
                                ? 'rgba(255, 255, 255, 0.15)'
                                : 'rgba(0, 0, 0, 0.08)',
                            color: isMyMessage
                                ? 'rgba(255, 255, 255, 0.9)'
                                : theme.palette.text.secondary,
                        }}
                    >
                        {getFileIcon(fileCategory, fileName)}
                    </Box>

                    {/* File name and size */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            variant="body2"
                            fontWeight={500}
                            sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {fileName}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: secondaryColor }}
                        >
                            {formatFileSize(fileSize)}
                        </Typography>
                    </Box>

                    {/* Status / Action */}
                    <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        {isInProgress && (
                            <Typography
                                variant="caption"
                                fontWeight={600}
                                sx={{ color: secondaryColor }}
                            >
                                {Math.round(transferProgress)}%
                            </Typography>
                        )}

                        {isCompleted && isReceived && fileKey && (
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={<DownloadIcon />}
                                onClick={handleDownload}
                                sx={{
                                    backgroundColor: isMyMessage
                                        ? 'rgba(255, 255, 255, 0.2)'
                                        : theme.palette.primary.main,
                                    color: isMyMessage
                                        ? theme.palette.primary.contrastText
                                        : theme.palette.primary.contrastText,
                                    textTransform: 'none',
                                    fontSize: '0.75rem',
                                    px: 1.5,
                                    py: 0.5,
                                    minWidth: 'auto',
                                    borderRadius: 2,
                                    '&:hover': {
                                        backgroundColor: isMyMessage
                                            ? 'rgba(255, 255, 255, 0.3)'
                                            : theme.palette.primary.dark,
                                    },
                                }}
                            >
                                {t('chat.fileDownload')}
                            </Button>
                        )}

                        {isCompleted && isMyMessage && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    color: secondaryColor,
                                }}
                            >
                                <CheckCircleIcon sx={{ fontSize: 16 }} />
                                <Typography variant="caption" sx={{ color: secondaryColor }}>
                                    {t('chat.fileCompleted')}
                                </Typography>
                            </Box>
                        )}

                        {isFailed && (
                            <IconButton
                                size="small"
                                onClick={handleRetry}
                                sx={{
                                    color: isMyMessage
                                        ? theme.palette.error.light
                                        : theme.palette.error.main,
                                    '&:hover': {
                                        backgroundColor: theme.palette.error.main + '20',
                                    },
                                }}
                            >
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Box>
                </Box>

                {/* Progress bar for in-progress transfers */}
                {isInProgress && (
                    <Box sx={{ mt: 1 }}>
                        <LinearProgress
                            variant="determinate"
                            value={Math.max(0, Math.min(100, transferProgress))}
                            sx={{
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: isMyMessage
                                    ? 'rgba(255, 255, 255, 0.2)'
                                    : theme.palette.grey[300],
                                '& .MuiLinearProgress-bar': {
                                    borderRadius: 2,
                                    backgroundColor: isMyMessage
                                        ? 'rgba(255, 255, 255, 0.8)'
                                        : theme.palette.primary.main,
                                },
                            }}
                        />
                    </Box>
                )}

                {/* Failed state indicator */}
                {isFailed && (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            mt: 0.5,
                        }}
                    >
                        <ErrorIcon sx={{ fontSize: 14, color: theme.palette.error.light }} />
                        <Typography
                            variant="caption"
                            sx={{
                                color: isMyMessage
                                    ? theme.palette.error.light
                                    : theme.palette.error.main,
                            }}
                        >
                            {t('chat.fileFailed')}
                        </Typography>
                    </Box>
                )}
            </Box>

            {/* Timestamp */}
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5, fontSize: '0.7rem' }}
            >
                {formatTimestamp(message.timestamp)}
            </Typography>
        </Box>
    );
};

export default FileBubble;
