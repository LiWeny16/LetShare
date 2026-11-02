import React from 'react';
import { alpha, Box, Checkbox, Dialog, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { useTranslation } from 'react-i18next';
import { canGenerateSafeImageThumbnail, canPreviewImageSafely } from '@App/libs/connection/transferReliability';
import { getDeviceType } from '@App/libs/tools/tools';

interface Props {
  open: boolean;
  file: File | null;
  url: string | null;
  failed: boolean;
  files: File[];
  thumbnails: Map<File, string>;
  isImage: (name: string) => boolean;
  onSelect: (file: File) => void;
  onClose: () => void;
  onExited: () => void;
  onImageError: () => void;
  onDownload: (file: File) => void;
}

function GalleryThumbnail({ file, thumbnail, image, index }: { file: File; thumbnail?: string; image: boolean; index: number }) {
  const [fallback, setFallback] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
    if (thumbnail || !image || !canGenerateSafeImageThumbnail({ size: file.size }, getDeviceType(), index).allowed) {
      setFallback(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFallback(url);
    return () => URL.revokeObjectURL(url);
  }, [file, image, thumbnail, index]);
  const src = thumbnail || fallback;
  return src && !failed
    ? <Box component="img" src={src} alt="" loading="lazy" onError={() => setFailed(true)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <InsertDriveFileIcon />;
}

export default function ImageGalleryDialog({ open, file, url, failed, files, thumbnails, isImage, onSelect, onClose, onExited, onImageError, onDownload }: Props) {
  const { i18n, t } = useTranslation();
  const zh = (i18n.resolvedLanguage || i18n.language)?.startsWith('zh');
  const [compare, setCompare] = React.useState<File | null>(null);
  const [compareUrl, setCompareUrl] = React.useState<string | null>(null);
  const [compareFailed, setCompareFailed] = React.useState(false);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  const activeThumbnail = React.useRef<HTMLDivElement | null>(null);
  const index = files.indexOf(file as File);

  React.useEffect(() => { setCompare(null); }, [file, files]);
  React.useEffect(() => {
    setCompareFailed(false);
    if (!compare || !canPreviewImageSafely({ size: compare.size }, getDeviceType()).allowed) {
      setCompareUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(compare);
    setCompareUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [compare]);
  React.useEffect(() => {
    if (open) activeThumbnail.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [file, open]);

  const move = (delta: number) => {
    const next = files[index + delta];
    if (next) onSelect(next);
  };
  const iconButton = { width: 44, height: 44, color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } };

  return (
    <Dialog open={open} onClose={onClose} TransitionProps={{ onExited }} maxWidth={false} sx={{ zIndex: theme => theme.zIndex.modal + 3 }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      }}
      PaperProps={{ sx: { bgcolor: 'background.paper', color: 'text.primary', backgroundImage: 'none', width: 'min(1120px, calc(100vw - 24px))', height: { xs: 'calc(100dvh - 24px)', sm: 'min(800px, calc(100dvh - 48px))' }, maxHeight: 'none', m: { xs: 1.5, sm: 3 }, borderRadius: { xs: 2.5, sm: 3 }, overflow: 'hidden' } }}>
      <Box sx={{ height: { xs: 56, sm: 64 }, display: 'flex', alignItems: 'center', px: { xs: 1, sm: 2 }, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0, pl: 1 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>{compare ? (zh ? '对比图片' : 'Compare images') : file?.name}</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {files.length}{compare ? (zh ? ' · 已选择 2 张' : ' · 2 selected') : ''}</Typography>
        </Box>
        {file && <Tooltip title={t('chat.fileDownload')}><IconButton aria-label={t('chat.fileDownload')} onClick={() => onDownload(file)} sx={iconButton}><DownloadIcon /></IconButton></Tooltip>}
        <Tooltip title={zh ? '关闭预览' : 'Close preview'}><IconButton aria-label={zh ? '关闭预览' : 'Close preview'} onClick={onClose} sx={iconButton}><CloseIcon /></IconButton></Tooltip>
      </Box>
      <Box onTouchStart={event => { const point = event.touches[0]; touch.current = event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY } : null; }}
        onTouchEnd={event => { const start = touch.current; touch.current = null; const end = event.changedTouches[0]; if (start && end && Math.abs(end.clientX - start.x) > 60 && Math.abs(end.clientX - start.x) > Math.abs(end.clientY - start.y)) move(end.clientX < start.x ? 1 : -1); }}
        sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', px: { xs: 1, sm: 7 }, py: 2 }}>
        {files.length > 1 && <IconButton aria-label={zh ? '上一个文件' : 'Previous file'} disabled={index <= 0} onClick={() => move(-1)} sx={{ ...iconButton, position: 'absolute', left: 4, zIndex: 1 }}><ChevronLeftIcon /></IconButton>}
        <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: { xs: compare ? 'column' : 'row', sm: 'row' }, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          {[{ imageFile: file, imageUrl: url, imageFailed: failed }, ...(compare ? [{ imageFile: compare, imageUrl: compareUrl, imageFailed: !compareUrl || compareFailed }] : [])].map(({ imageFile, imageUrl, imageFailed }, i) => (
            <Box key={i} sx={{ flex: compare ? 1 : '0 1 auto', minWidth: 0, minHeight: 0, width: compare ? '100%' : 'auto', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {imageUrl && !imageFailed ? <Box component="img" src={imageUrl} alt={imageFile?.name || ''} onError={i === 1 ? () => setCompareFailed(true) : onImageError} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', outline: theme => `1px solid ${alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.1)}` }} /> : <Typography sx={{ color: 'text.secondary', textAlign: 'center' }}>{zh ? '无法预览此图片，请下载查看' : 'Preview unavailable. Download to view.'}</Typography>}
            </Box>
          ))}
        </Box>
        {files.length > 1 && <IconButton aria-label={zh ? '下一个文件' : 'Next file'} disabled={index >= files.length - 1} onClick={() => move(1)} sx={{ ...iconButton, position: 'absolute', right: 4, zIndex: 1 }}><ChevronRightIcon /></IconButton>}
      </Box>
      {files.length > 1 && <Box sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', px: { xs: 1, sm: 2 }, py: 1.5 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 12, mb: 1 }}>{zh ? '点击切换文件，勾选另一张图片进行对比' : 'Choose a file; check another image to compare'}</Typography>
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
          {files.map((item, i) => {
            const selected = item === file || item === compare;
            const thumb = thumbnails.get(item);
            return <Box key={i} ref={item === file ? activeThumbnail : undefined} sx={{ position: 'relative', flex: '0 0 auto', width: { xs: 84, sm: 112 }, height: { xs: 64, sm: 80 }, borderRadius: 1.5, overflow: 'hidden', border: '2px solid', borderColor: selected ? 'primary.main' : 'transparent', bgcolor: 'action.hover' }}>
              <Box component="button" type="button" onClick={() => onSelect(item)} aria-label={`${item.name} (${i + 1} / ${files.length})`} aria-current={item === file ? 'true' : undefined} sx={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', p: 0, border: 0, bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer' }}>
                <GalleryThumbnail file={item} thumbnail={thumb} image={isImage(item.name)} index={i} />
              </Box>
              {isImage(item.name) && item !== file && <Checkbox size="small" checked={item === compare} onChange={event => setCompare(event.target.checked ? item : null)} inputProps={{ 'aria-label': zh ? `对比 ${item.name}` : `Compare ${item.name}` }} sx={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, color: 'text.primary', bgcolor: theme => alpha(theme.palette.background.paper, 0.88), borderRadius: 1, '&.Mui-checked': { color: 'primary.main' } }} />}
            </Box>;
          })}
        </Box>
      </Box>}
    </Dialog>
  );
}
