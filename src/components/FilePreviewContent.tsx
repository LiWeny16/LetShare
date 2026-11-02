import React from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@App/libs/chat/ChatHistoryManager';

interface Props {
  file: File | null;
  fileName: string;
  mimeType: string;
  fileCategory: string;
  blobUrl: string | null;
  onDownload: () => void;
}

/** Shared preview body for the chat dialog and the received-file viewer. */
export default function FilePreviewContent({ file, fileName, mimeType, fileCategory, blobUrl, onDownload }: Props) {
  const { t } = useTranslation();
  const isWordFile = /\.docx?$/i.test(fileName) || /^(application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/i.test(mimeType);
  const canReadText = !isWordFile && (fileCategory === 'code' || (fileCategory === 'document' && (/\.(txt|md|csv)$/i.test(fileName) || mimeType.startsWith('text/'))));
  const [textContent, setTextContent] = React.useState<string | null>(null);
  const [textLoading, setTextLoading] = React.useState(false);
  const [textError, setTextError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file || !blobUrl) return;
    let cancelled = false;
    if (canReadText) {
      setTextLoading(true);
      setTextContent(null);
      setTextError(null);
      file.slice(0, 65536).text().then(text => {
        if (!cancelled) { setTextContent(text); setTextLoading(false); }
      }).catch(error => {
        if (!cancelled) { setTextError(error instanceof Error ? error.message : 'Failed to read file'); setTextLoading(false); }
      });
    } else {
      setTextContent(null);
      setTextError(null);
    }
    return () => { cancelled = true; };
  }, [file, blobUrl, canReadText]);

  if (!file || !blobUrl) return null;
  const unavailable = () => (
    <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
      <InsertDriveFileIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
      <Typography variant="body1" color="text.secondary">{t('download.previewUnavailable', { defaultValue: 'Preview not available' })}</Typography>
      <Typography variant="caption" color="text.secondary">{fileName} · {formatFileSize(file.size)}</Typography>
    </Box>
  );
  if (isWordFile || ((fileCategory === 'document' || fileCategory === 'code') && !canReadText)) return unavailable();
  switch (fileCategory) {
    case 'video':
      return <video controls playsInline preload="metadata" style={{ maxWidth: '100%', maxHeight: '70vh' }}><source src={blobUrl} type={mimeType} /></video>;
    case 'pdf':
      return <iframe src={blobUrl} style={{ width: '100%', height: '70vh', border: 'none' }} title="PDF preview" />;
    case 'document':
    case 'code':
      if (textLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}><CircularProgress /></Box>;
      if (textError) return <Box sx={{ p: 2 }}><Typography color="error" variant="body2" sx={{ mb: 1 }}>{textError}</Typography><Button variant="contained" size="small" startIcon={<DownloadIcon />} onClick={onDownload}>{t('chat.fileDownload')}</Button></Box>;
      return <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '70vh', p: 2, fontFamily: 'monospace', fontSize: '0.85rem', m: 0 }}>{textContent}</Box>;
    default:
      return unavailable();
  }
}
