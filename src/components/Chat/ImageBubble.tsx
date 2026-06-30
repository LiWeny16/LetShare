import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  IconButton,
  Button,
  Dialog,
  DialogContent,
  CircularProgress,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/Image';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import type { FileChatMessage } from '@App/libs/chat/ChatHistoryManager';
import { formatFileSize } from '@App/libs/chat/ChatHistoryManager';
import FileBlobStore from '@App/libs/chat/FileBlobStore';

interface ImageBubbleProps {
  message: FileChatMessage;
  isMyMessage: boolean;
  onDownload?: (fileKey: string) => void;
  onRetry?: (messageId: string) => void;
  thumbnailUrl?: string;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return (
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

const ImageBubble: React.FC<ImageBubbleProps> = ({
  message,
  isMyMessage,
  onDownload: _onDownload,
  onRetry,
  thumbnailUrl,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { fileMetadata } = message;
  const { transferStatus, transferProgress, fileKey, fileName, fileSize } = fileMetadata;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Track the latest object URL for reliable cleanup
  const objectUrlRef = useRef<string | null>(null);

  // Load image from IndexedDB when transfer is completed and fileKey exists
  useEffect(() => {
    if (transferStatus !== 'completed' || !fileKey) return;
    if (objectUrl) return;

    // If parent provided a thumbnailUrl, use it directly
    if (thumbnailUrl) {
      setObjectUrl(thumbnailUrl);
      objectUrlRef.current = thumbnailUrl;
      return;
    }

    let cancelled = false;
    setLoadingImage(true);
    setLoadError(false);

    const loadFromDB = async () => {
      try {
        const file = await FileBlobStore.getFile(fileKey);
        if (cancelled) return;
        if (file) {
          const url = URL.createObjectURL(file);
          if (!cancelled) {
            setObjectUrl(url);
            objectUrlRef.current = url;
          }
        } else {
          setLoadError(true);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[ImageBubble] Failed to load image from DB:', err);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoadingImage(false);
      }
    };

    loadFromDB();

    return () => {
      cancelled = true;
    };
    // Deliberately exclude objectUrl — we only want to trigger on status/fileKey/thumbnailUrl changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferStatus, fileKey, thumbnailUrl]);

  // Cleanup old object URL when a new one is set, and on unmount
  useEffect(() => {
    const currentUrl = objectUrl;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [objectUrl]);

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry(message.id);
    }
  }, [onRetry, message.id]);

  const handleThumbnailClick = useCallback(() => {
    if (transferStatus === 'completed' && objectUrl) {
      setDialogOpen(true);
    }
  }, [transferStatus, objectUrl]);

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // Determine bubble background color
  const bubbleBgColor = isMyMessage
    ? theme.palette.primary.main
    : theme.palette.mode === 'dark'
      ? theme.palette.grey[800]
      : theme.palette.grey[100];

  const bubbleTextColor = isMyMessage
    ? theme.palette.primary.contrastText
    : theme.palette.text.primary;

  const renderContent = () => {
    switch (transferStatus) {
      case 'uploading':
      case 'downloading': {
        return (
          <Box
            role="status"
            aria-label={
              transferStatus === 'uploading'
                ? 'Sending image...'
                : 'Receiving image...'
            }
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 2.5,
              px: 3,
              minWidth: 160,
            }}
          >
            <ImageIcon
              sx={{
                fontSize: 48,
                color: isMyMessage
                  ? theme.palette.primary.contrastText
                  : theme.palette.text.disabled,
                mb: 1,
                opacity: 0.7,
              }}
            />
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: bubbleTextColor,
                maxWidth: '100%',
                mb: 0.5,
                opacity: 0.9,
              }}
            >
              {fileName}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: bubbleTextColor, mb: 1, opacity: 0.6 }}
            >
              {formatFileSize(fileSize)}
            </Typography>
            <Box sx={{ width: '100%', position: 'relative' }}>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, transferProgress))}
                sx={{
                  width: '100%',
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: isMyMessage
                    ? 'rgba(255,255,255,0.25)'
                    : theme.palette.grey[300],
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: isMyMessage
                      ? theme.palette.primary.contrastText
                      : theme.palette.primary.main,
                  },
                }}
              />
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  textAlign: 'center',
                  mt: 0.5,
                  color: bubbleTextColor,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  opacity: 0.8,
                }}
              >
                {Math.round(transferProgress)}%
              </Typography>
            </Box>
          </Box>
        );
      }

      case 'completed': {
        if (loadingImage) {
          return (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 200,
                height: 150,
                backgroundColor: 'rgba(0,0,0,0.04)',
              }}
            >
              <CircularProgress size={32} />
            </Box>
          );
        }

        if (objectUrl) {
          return (
            <Box
              component="img"
              src={objectUrl}
              alt={fileName}
              onClick={handleThumbnailClick}
              onError={() => {
                setLoadError(true);
              }}
              sx={{
                display: 'block',
                maxWidth: 250,
                maxHeight: 250,
                width: 'auto',
                height: 'auto',
                objectFit: 'cover',
                cursor: 'pointer',
              }}
            />
          );
        }

        // No object URL yet and not loading: show fallback placeholder
        if (loadError) {
          return (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                py: 2.5,
                px: 3,
                minWidth: 140,
              }}
            >
              <BrokenImageIcon
                sx={{ fontSize: 40, color: theme.palette.text.disabled, mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                {t('chat.fileFailed')}
              </Typography>
            </Box>
          );
        }

        return (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 2.5,
              px: 3,
              minWidth: 140,
            }}
          >
            <ImageIcon
              sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 1 }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ maxWidth: 200 }}
            >
              {fileName}
            </Typography>
          </Box>
        );
      }

      case 'failed':
        return (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 2.5,
              px: 3,
              minWidth: 140,
            }}
          >
            <BrokenImageIcon
              sx={{ fontSize: 48, color: theme.palette.error.main, mb: 1 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <ErrorOutlineIcon
                sx={{ fontSize: 16, color: theme.palette.error.main }}
              />
              <Typography variant="caption" color="error">
                {t('chat.fileFailed')}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              startIcon={<RefreshIcon />}
              onClick={handleRetry}
            >
              {t('chat.fileRetry')}
            </Button>
          </Box>
        );

      default:
        return (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 2.5,
              px: 3,
            }}
          >
            <ImageIcon
              sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 1 }}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {fileName}
            </Typography>
          </Box>
        );
    }
  };

  const isCompletedWithImage = transferStatus === 'completed' && !!objectUrl;

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexDirection: isMyMessage ? 'row-reverse' : 'row',
          alignItems: 'flex-start',
          gap: 1,
          mb: 2,
        }}
      >
        {/* Avatar placeholder — matching existing chat bubble layout */}
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: isMyMessage
              ? theme.palette.primary.main
              : theme.palette.secondary.main,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Typography
            sx={{
              fontSize: '0.875rem',
              color: '#fff',
              lineHeight: 1,
              userSelect: 'none',
            }}
          >
            {isMyMessage ? 'Me' : message.senderId.charAt(0).toUpperCase()}
          </Typography>
        </Box>

        {/* Message content */}
        <Box
          sx={{
            maxWidth: '70%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMyMessage ? 'flex-end' : 'flex-start',
          }}
        >
          <Box
            sx={{
              borderRadius: 3,
              backgroundColor: isCompletedWithImage ? 'transparent' : bubbleBgColor,
              overflow: 'hidden',
            }}
          >
            {renderContent()}
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
      </Box>

      {/* Full-screen image viewer Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.92)',
            maxHeight: '95vh',
            maxWidth: '95vw',
            m: 2,
            borderRadius: 2,
            boxShadow: 'none',
          },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
          }}
        >
          <IconButton
            onClick={handleCloseDialog}
            aria-label="Close image viewer"
            sx={{
              color: '#fff',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.25)',
              },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <DialogContent
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { xs: 2, sm: 4 },
            overflow: 'hidden',
          }}
        >
          {objectUrl && (
            <Box
              component="img"
              src={objectUrl}
              alt={fileName}
              sx={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 1,
                userSelect: 'none',
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ImageBubble;
