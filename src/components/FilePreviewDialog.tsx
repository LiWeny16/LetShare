import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogContent, IconButton, Typography, Box,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import FilePreviewContent from './FilePreviewContent';

interface FilePreviewDialogProps {
  file: File | null;
  fileName: string;
  mimeType: string;
  fileCategory: string; // 'video' | 'pdf' | 'document' | 'code' | 'image' | 'archive' | 'other'
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onDownload?: () => void;
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
  onExited,
  onPrevious,
  onNext,
  onDownload,
}) => {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Create object URL when open + file is provided
  useEffect(() => {
    if (file) {
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
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [file]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDownload = useCallback(() => {
    if (onDownload) onDownload();
    else if (file) downloadBlob(file);
  }, [file, onDownload]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      TransitionProps={{ onExited }}
      maxWidth={false}
      sx={{ zIndex: (theme) => theme.zIndex.modal + 3 }}
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
          <FilePreviewContent file={file} fileName={fileName} mimeType={mimeType} fileCategory={fileCategory} blobUrl={blobUrl} onDownload={handleDownload} />
        </Box>

        {(onPrevious || onNext) && <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onPrevious} disabled={!onPrevious}>{t('download.previousFile', { defaultValue: 'Previous' })}</Button>
          <Button onClick={onNext} disabled={!onNext}>{t('download.nextFile', { defaultValue: 'Next' })}</Button>
        </Box>}
        {/* Download button below preview content for all file types */}
        {file && (
          <Button
            variant="contained"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleDownload}
            sx={{ mt: 1, mb: 1.5 }}
          >
            {t('chat.fileDownload')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;
