import React from 'react';
import { alpha, Box, Button, ButtonBase, Checkbox, CircularProgress, Dialog, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import { useTranslation } from 'react-i18next';
import { canGenerateSafeImageThumbnail } from '@App/libs/connection/transferReliability';
import { categorizeFile, formatFileSize } from '@App/libs/chat/ChatHistoryManager';
import { getDeviceType } from '@App/libs/tools/tools';
import type { Theme } from '@mui/material/styles';
import FilePreviewContent from './FilePreviewContent';

export interface PreviewEntry { key: string; file: File }
type Point = { x: number; y: number };
type ImageView = Point & { scale: number };
type ImageGesture = { start: ImageView; center: Point; imageCenter: Point; distance: number };

const FIT_IMAGE: ImageView = { scale: 1, x: 0, y: 0 };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

interface Props {
  open: boolean;
  activeKey: string | null;
  file: File | null;
  url: string | null;
  failed: boolean;
  files: PreviewEntry[];
  thumbnails: Map<string, string>;
  selectedKeys: Set<string>;
  busy: boolean;
  preparedDownload: { url: string; fileName: string } | null;
  isImage: (name: string) => boolean;
  onSelect: (entry: PreviewEntry) => void;
  onSelectionChange: (keys: Set<string>) => void;
  onClose: () => void;
  onExited: () => void;
  onImageError: () => void;
  onDownload: (file: File) => void;
  onDownloadSelected: () => void;
  onDeleteSelected: () => void;
  onPreparedDownload: () => void;
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

export default function ImageGalleryDialog({ open, activeKey, file, url, failed, files, thumbnails, selectedKeys, busy, preparedDownload, isImage, onSelect, onSelectionChange, onClose, onExited, onImageError, onDownload, onDownloadSelected, onDeleteSelected, onPreparedDownload }: Props) {
  const { t, i18n } = useTranslation();
  const zh = (i18n.resolvedLanguage || i18n.language)?.startsWith('zh');
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  const activeThumbnail = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const imageViewport = React.useRef<HTMLDivElement | null>(null);
  const pointers = React.useRef(new Map<number, Point>());
  const gesture = React.useRef<ImageGesture | null>(null);
  const viewRef = React.useRef<ImageView>(FIT_IMAGE);
  const [view, setView] = React.useState<ImageView>(FIT_IMAGE);
  const [dragging, setDragging] = React.useState(false);
  const index = files.findIndex(item => item.key === activeKey);
  const allSelected = files.length > 0 && files.every(item => selectedKeys.has(item.key));
  const someSelected = files.some(item => selectedKeys.has(item.key));
  const category = file ? categorizeFile(file.name, file.type) : 'other';
  const canZoom = Boolean(file && isImage(file.name) && url && !failed);

  React.useLayoutEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    if (!open) return;
    viewRef.current = FIT_IMAGE;
    setView(FIT_IMAGE);
    setDragging(false);
  }, [activeKey, open]);

  const updateView = React.useCallback((next: ImageView) => {
    const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.scale));
    const image = imageRef.current;
    const viewport = imageViewport.current;
    const maxX = image && viewport ? Math.max(0, (image.offsetWidth * scale - viewport.clientWidth) / 2) : 0;
    const maxY = image && viewport ? Math.max(0, (image.offsetHeight * scale - viewport.clientHeight) / 2) : 0;
    const bounded = { scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    viewRef.current = bounded;
    setView(bounded);
  }, []);

  React.useEffect(() => {
    if (!open || !canZoom || !imageViewport.current) return;
    const observer = new ResizeObserver(() => updateView(viewRef.current));
    observer.observe(imageViewport.current);
    return () => observer.disconnect();
  }, [open, canZoom, updateView]);

  const changeZoom = (scale: number) => {
    const current = viewRef.current;
    const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    const ratio = nextScale / current.scale;
    updateView({ scale: nextScale, x: current.x * ratio, y: current.y * ratio });
  };

  const startGesture = () => {
    const points = [...pointers.current.values()];
    if (!points.length || !imageRef.current) { gesture.current = null; return; }
    const first = points[0];
    const second = points[1];
    const rect = imageRef.current.getBoundingClientRect();
    const current = viewRef.current;
    gesture.current = {
      start: current,
      center: second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } : first,
      imageCenter: { x: rect.left + rect.width / 2 - current.x, y: rect.top + rect.height / 2 - current.y },
      distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
    };
  };

  const onImagePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (event.pointerType === 'mouse' && (event.button !== 0 || viewRef.current.scale <= 1)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    startGesture();
    setDragging(pointers.current.size > 1 || viewRef.current.scale > 1);
  };

  const onImagePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const currentGesture = gesture.current;
    if (points.length >= 2 && currentGesture.distance > 0) {
      const [first, second] = points;
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentGesture.start.scale * Math.hypot(second.x - first.x, second.y - first.y) / currentGesture.distance));
      const ratio = scale / currentGesture.start.scale;
      updateView({
        scale,
        x: currentGesture.start.x + center.x - currentGesture.center.x + (1 - ratio) * (currentGesture.center.x - currentGesture.imageCenter.x - currentGesture.start.x),
        y: currentGesture.start.y + center.y - currentGesture.center.y + (1 - ratio) * (currentGesture.center.y - currentGesture.imageCenter.y - currentGesture.start.y),
      });
    } else if (points.length === 1 && currentGesture.start.scale > 1) {
      updateView({ ...currentGesture.start, x: currentGesture.start.x + points[0].x - currentGesture.center.x, y: currentGesture.start.y + points[0].y - currentGesture.center.y });
    }
  };

  const onImagePointerEnd = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    startGesture();
    setDragging(pointers.current.size > 0 && viewRef.current.scale > 1);
  };

  React.useEffect(() => {
    if (open) activeThumbnail.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeKey, open]);
  const move = (delta: number) => {
    const next = files[index + delta];
    if (next) onSelect(next);
  };
  const iconButton = { width: 44, height: 44, color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } };
  const navButton = {
    position: 'absolute' as const, top: 0, bottom: 0, width: '50%', display: 'flex',
    color: 'text.secondary', px: 1, '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.action.active, 0.035) },
    '&.Mui-disabled': { color: 'text.disabled' }, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
  };
  // Keep a large thumbnail strip stable while touch gestures update the image.
  const thumbnailStrip = React.useMemo(() => (
    <Box data-testid="preview-thumbnail-strip" sx={{ overflowX: 'auto', pb: 0.5 }}>
      <Box sx={{ display: 'flex', gap: 1, width: 'max-content', minWidth: '100%', justifyContent: 'center' }}>
        {files.map((item, i) => {
          const active = item.key === activeKey;
          const checked = selectedKeys.has(item.key);
          return <Box key={item.key} ref={active ? activeThumbnail : undefined} sx={{ position: 'relative', flex: '0 0 auto', width: { xs: 100, sm: 120 }, borderRadius: 1.5, overflow: 'hidden', border: '2px solid', borderColor: active ? 'primary.main' : 'transparent', bgcolor: 'action.hover' }}>
            <ButtonBase onClick={() => onSelect(item)} aria-label={`${item.file.name} (${i + 1} / ${files.length})`} aria-current={active ? 'true' : undefined} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', textAlign: 'left', color: 'text.secondary' }}>
              <Box sx={{ height: { xs: 64, sm: 80 }, '@media (max-height: 600px)': { height: 48 }, '@media (max-height: 500px)': { height: 40 }, display: 'grid', placeItems: 'center' }}><GalleryThumbnail file={item.file} thumbnail={thumbnails.get(item.key)} image={isImage(item.file.name)} index={i} /></Box>
              <Box sx={{ width: '100%', minWidth: 0, px: 0.75, py: 0.5, boxSizing: 'border-box' }}>
                <Typography variant="caption" color="text.primary" noWrap sx={{ display: 'block' }}>{item.file.name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.2 }}>{formatFileSize(item.file.size)}</Typography>
              </Box>
            </ButtonBase>
            <Checkbox size="small" checked={checked} disabled={busy} onChange={event => { const next = new Set(selectedKeys); event.target.checked ? next.add(item.key) : next.delete(item.key); onSelectionChange(next); }} inputProps={{ 'aria-label': `${t('download.selectFile')}: ${item.file.name}` }} sx={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, color: 'text.primary', bgcolor: theme => alpha(theme.palette.background.paper, 0.88), borderRadius: 1, '&.Mui-checked': { color: 'primary.main' } }} />
          </Box>;
        })}
      </Box>
    </Box>
  ), [files, activeKey, selectedKeys, busy, thumbnails, isImage, onSelect, onSelectionChange, t]);

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} TransitionProps={{ onExited }} maxWidth={false} sx={{ zIndex: theme => theme.zIndex.modal + 3 }}
      onKeyDown={event => {
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, video, [contenteditable="true"], [role="slider"]')) return;
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      }}
      PaperProps={{ sx: { bgcolor: 'background.paper', color: 'text.primary', backgroundImage: 'none', width: 'min(1120px, calc(100vw - 24px))', maxWidth: { xs: 'calc(100vw - 24px)', sm: 'calc(100vw - 48px)' }, height: { xs: 'calc(100dvh - 24px)', sm: 'min(800px, calc(100dvh - 48px))' }, maxHeight: 'none', m: { xs: 1.5, sm: 3 }, borderRadius: { xs: 2.5, sm: 3 }, overflow: 'hidden' } }}>
      <Box sx={{ minHeight: 64, '@media (max-height: 500px)': { minHeight: 56 }, display: 'flex', alignItems: 'center', px: { xs: 2, sm: 3 }, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 16, fontWeight: 600, '@media (max-height: 500px) and (min-width: 600px)': { maxWidth: 'calc(50vw - 132px)' } }}>{file?.name}</Typography>
          <Typography data-testid="preview-file-metadata" sx={{ color: 'text.secondary', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{file ? formatFileSize(file.size) : ''} · {index + 1} / {files.length}</Typography>
        </Box>
        {file && <Tooltip title={t('chat.fileDownload')}><IconButton aria-label={t('chat.fileDownload')} onClick={() => onDownload(file)} sx={iconButton}><DownloadIcon /></IconButton></Tooltip>}
        <Tooltip title={zh ? '关闭预览' : 'Close preview'}><span><IconButton aria-label={zh ? '关闭预览' : 'Close preview'} onClick={onClose} disabled={busy} sx={iconButton}><CloseIcon /></IconButton></span></Tooltip>
      </Box>

      {canZoom && <Box data-testid="preview-zoom-controls" sx={{ display: 'flex', justifyContent: 'center', flexShrink: 0, pt: 1, '@media (max-height: 500px) and (min-width: 600px)': { position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 2, pt: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', borderRadius: 2, bgcolor: 'action.hover', px: 0.5 }}>
          <Tooltip title={t('download.zoomOut')}><span><IconButton aria-label={t('download.zoomOut')} disabled={view.scale <= MIN_ZOOM} onClick={() => changeZoom(viewRef.current.scale - 0.25)} sx={iconButton}><ZoomOutIcon /></IconButton></span></Tooltip>
          <Typography aria-live="polite" sx={{ minWidth: 44, textAlign: 'center', fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{Math.round(view.scale * 100)}%</Typography>
          <Tooltip title={t('download.zoomIn')}><span><IconButton aria-label={t('download.zoomIn')} disabled={view.scale >= MAX_ZOOM} onClick={() => changeZoom(viewRef.current.scale + 0.25)} sx={iconButton}><ZoomInIcon /></IconButton></span></Tooltip>
          <Tooltip title={t('download.resetZoom')}><IconButton aria-label={t('download.resetZoom')} onClick={() => updateView(FIT_IMAGE)} sx={iconButton}><FitScreenIcon /></IconButton></Tooltip>
        </Box>
      </Box>}

      <Box onTouchStart={event => { const point = event.touches[0]; touch.current = viewRef.current.scale === 1 && event.touches.length === 1 && point ? { x: point.clientX, y: point.clientY } : null; }}
        onTouchEnd={event => {
          const start = touch.current; touch.current = null; const end = event.changedTouches[0];
          if (viewRef.current.scale === 1 && start && end && Math.abs(end.clientX - start.x) > 60 && Math.abs(end.clientX - start.x) > Math.abs(end.clientY - start.y)) {
            event.preventDefault(); move(end.clientX < start.x ? 1 : -1);
          }
        }}
        onTouchCancel={() => { touch.current = null; }}
        sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', py: 2, '@media (max-height: 600px)': { py: 1 }, '@media (max-height: 500px)': { py: 0.5 } }}>
        {files.length > 1 && <>
          <ButtonBase data-testid="preview-previous-zone" aria-label={t('download.previousFile')} disabled={index <= 0} onClick={() => move(-1)} sx={{ ...navButton, left: 0, justifyContent: 'flex-start' }}><ChevronLeftIcon /></ButtonBase>
          <ButtonBase data-testid="preview-next-zone" aria-label={t('download.nextFile')} disabled={index >= files.length - 1} onClick={() => move(1)} sx={{ ...navButton, right: 0, justifyContent: 'flex-end' }}><ChevronRightIcon /></ButtonBase>
        </>}
        <Box ref={imageViewport} sx={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: { xs: 3, sm: 7 }, overflow: 'hidden', pointerEvents: 'none' }}>
          {file && isImage(file.name) ? (
            url && !failed ? <Box component="img" ref={imageRef} src={url} alt={file.name} draggable={false} onError={onImageError}
              onPointerDown={onImagePointerDown} onPointerMove={onImagePointerMove} onPointerUp={onImagePointerEnd} onPointerCancel={onImagePointerEnd}
              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', cursor: view.scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default', transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: dragging ? 'none' : 'transform 160ms ease-out', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, outline: theme => `1px solid ${alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.1)}` }} />
              : <Typography sx={{ color: 'text.secondary', textAlign: 'center' }}>{t('download.imagePreviewUnavailable', { defaultValue: 'Preview unavailable. Download to view.' })}</Typography>
          ) : file && (
            <Box sx={{ pointerEvents: 'auto', minWidth: 0, maxWidth: '100%', maxHeight: '100%', width: category === 'pdf' ? '100%' : 'auto', height: category === 'pdf' ? '100%' : 'auto', overflow: 'auto', '& iframe': { height: '100% !important' } }}>
              <FilePreviewContent file={file} fileName={file.name} mimeType={file.type} fileCategory={category} blobUrl={url} onDownload={() => onDownload(file)} />
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ flexShrink: 0, borderTop: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, py: 1.5, '@media (max-height: 600px)': { py: 1 }, '@media (max-height: 500px)': { py: 0.5 } }}>
        <Box data-testid="preview-bulk-actions" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1, '@media (max-height: 500px)': { mb: 0.5 } }}>
          <FormControlLabel sx={{ m: 0, mr: 'auto', '@media (max-width: 370px)': { flexBasis: '100%' }, '& .MuiFormControlLabel-label': { fontSize: 12, color: 'text.secondary' } }}
            control={<Checkbox data-testid="preview-select-all" size="small" checked={allSelected} indeterminate={someSelected && !allSelected} disabled={busy} onChange={event => onSelectionChange(event.target.checked ? new Set(files.map(item => item.key)) : new Set())} sx={{ width: 40, height: 40 }} />}
            label={someSelected ? t('download.previewSelectedCount', { total: selectedKeys.size }) : t('download.selectAll')} />
          {busy && <CircularProgress size={18} aria-label={t('download.previewWorking')} />}
          {preparedDownload && <Button data-testid="preview-save-download" component="a" href={preparedDownload.url} download={preparedDownload.fileName} onClick={onPreparedDownload} size="small" variant="contained" sx={{ minHeight: 40, textTransform: 'none' }}>{t('download.savePreparedFile')}</Button>}
          <Button data-testid="preview-download-selected" size="small" startIcon={<DownloadIcon />} disabled={!someSelected || busy} onClick={onDownloadSelected} sx={{ minHeight: 40, textTransform: 'none' }}>{t('chat.fileDownload')}</Button>
          <Button data-testid="preview-delete-selected" size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={!someSelected || busy} onClick={onDeleteSelected} sx={{ minHeight: 40, textTransform: 'none' }}>{t('download.deleteSelected')}</Button>
        </Box>
        {thumbnailStrip}
      </Box>
    </Dialog>
  );
}
