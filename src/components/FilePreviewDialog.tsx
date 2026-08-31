import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogContent, IconButton, Typography, Box,
  CircularProgress, Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';

interface FilePreviewDialogProps {
  file: File | null;
  fileName: string;
  mimeType: string;
  fileCategory: string; // 'video' | 'pdf' | 'document' | 'code' | 'image' | 'archive' | 'other'
  open: boolean;
  onClose: () => void;
}

function downloadBlob(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const FilePreviewDialog: React.FC<FilePreviewDialogProps> = ({
  file,
  fileName,
  mimeType,
  fileCategory,
  open,
  onClose,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Create object URL when open + file is provided
  useEffect(() => {
    if (open && file) {
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setBlobUrl(url);
    } else {
      // Revoke when not open
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setBlobUrl(null);
      setTextContent(null);
      setTextError(null);
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [open, file]);

  // Read text content for document/code categories
  useEffect(() => {
    if (!open || !file || !blobUrl) return;

    let cancelled = false;

    if (fileCategory === 'document' || fileCategory === 'code') {
      setTextLoading(true);
      setTextError(null);
      file.slice(0, 65536).text()
        .then((text) => {
          if (cancelled) return;
          setTextContent(text);
          setTextLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setTextError(err instanceof Error ? err.message : 'Failed to read file');
          setTextLoading(false);
        });
    } else {
      setTextContent(null);
      setTextError(null);
    }

    return () => { cancelled = true; };
  }, [open, file, blobUrl, fileCategory]);

  const handleClose = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setBlobUrl(null);
    setTextContent(null);
    setTextError(null);
    onClose();
  }, [onClose]);

  const handleDownload = useCallback(() => {
    if (file) {
      downloadBlob(file);
    }
  }, [file]);

  const renderPreview = () => {
    if (!file || !blobUrl) return null;

    switch (fileCategory) {
      case 'video':
        return (
          <video controls playsInline preload="metadata" style={{ maxWidth: '100%', maxHeight: '70vh' }}>
            <source src={blobUrl} type={mimeType} />
          </video>
        );

      case 'pdf':
        return (
          <iframe
            src={blobUrl}
            style={{ width: '100%', height: '70vh', border: 'none' }}
            title="PDF preview"
          />
        );

      case 'document':
      case 'code':
        if (textLoading) {
          return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
              <CircularProgress />
            </Box>
          );
        }
        if (textError) {
          return (
            <Box sx={{ p: 2 }}>
              <Typography color="error" variant="body2" sx={{ mb: 1 }}>
                {textError}
              </Typography>
              <Button
                variant="contained"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleDownload}
              >
                {fileName}
              </Button>
            </Box>
          );
        }
        return (
          <Box
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              overflow: 'auto',
              maxHeight: '70vh',
              p: 2,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              m: 0,
            }}
          >
            {textContent}
          </Box>
        );

      case 'archive':
      case 'other':
      default:
        return (
          <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
              Preview not available
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              {fileName} ({(file.size / 1024).toFixed(1)} KB)
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleDownload}
            >
              {fileName}
            </Button>
          </Box>
        );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          borderRadius: 2,
          m: 1,
        },
      }}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(0,0,0,0.92)',
        },
      }}
    >
      <DialogContent sx={{ p: 0, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Close button */}
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
            color: 'white',
            backgroundColor: 'rgba(0,0,0,0.4)',
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>

        {/* Title area */}
        <Box sx={{ width: '100%', p: 2, pb: 0, textAlign: 'center' }}>
          <Typography variant="subtitle2" noWrap sx={{ maxWidth: '80%', mx: 'auto' }}>
            {fileName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fileCategory}
          </Typography>
        </Box>

        {/* Preview content */}
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {renderPreview()}
        </Box>

        {/* Download button below preview content for all file types */}
        {file && (
          <Button
            variant="contained"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            sx={{ mt: 1, mb: 1.5 }}
          >
            {fileName}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;
