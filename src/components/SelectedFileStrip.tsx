import React, { useEffect, useRef } from 'react';
import { Chip, Tooltip, Box, alpha } from '@mui/material';
import {
  Image as ImageIcon,
  Movie as MovieIcon,
  PictureAsPdf as PdfIcon,
  Code as CodeIcon,
  FolderZip as FolderZipIcon,
  InsertDriveFile as InsertDriveFileIcon,
  TextSnippet as TextSnippetIcon,
} from '@mui/icons-material';

interface SelectedFileStripProps {
  files: File[];
  onRemove?: (index: number) => void;
  maxChips?: number;
}

function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(name);
}

function getFileIcon(fileName: string): React.ReactElement {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (isImageFile(fileName)) return <ImageIcon fontSize="small" />;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext))
    return <MovieIcon fontSize="small" />;
  if (ext === 'pdf') return <PdfIcon fontSize="small" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return <FolderZipIcon fontSize="small" />;
  if (['txt', 'md', 'rtf'].includes(ext))
    return <TextSnippetIcon fontSize="small" />;
  if (
    ['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'xml', 'py', 'java', 'c', 'cpp'].includes(ext)
  )
    return <CodeIcon fontSize="small" />;
  return <InsertDriveFileIcon fontSize="small" />;
}

/* ── Apple-style chip tokens ── */
const chipSx = {
  maxWidth: 140,
  flexShrink: 0,
  height: 30,
  borderRadius: '10px',
  fontSize: '0.8125rem',
  fontWeight: 500,
  letterSpacing: '-0.01em',
  border: '1px solid',
  borderColor: 'divider',
  bgcolor: (t: any) => alpha(t.palette.background.paper, 0.72),
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  '& .MuiChip-deleteIcon': {
    color: 'text.secondary',
    fontSize: 16,
    borderRadius: '50%',
    '&:hover': {
      color: 'text.primary',
      bgcolor: (t: any) => alpha(t.palette.action.hover, 0.6),
    },
  },
  '& .MuiChip-icon': { ml: '6px', mr: '-2px', color: 'text.secondary' },
  '& .MuiChip-label': { px: '10px', fontSize: '0.8125rem' },
} as const;

const overflowChipSx = {
  ...chipSx,
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  border: 'none',
  bgcolor: (t: any) => alpha(t.palette.primary.main, 0.10),
  color: 'primary.main',
  minWidth: 36,
  justifyContent: 'center',
  '& .MuiChip-label': { px: '8px', fontSize: '0.75rem' },
} as const;

/** Single image chip with hover thumbnail preview — Apple-style frosted tooltip. */
const ImageChip: React.FC<{ file: File; index: number; onRemove?: (i: number) => void }> = ({
  file, index, onRemove,
}) => {
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(null);
  const revokedRef = useRef(false);

  useEffect(() => {
    revokedRef.current = false;
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => {
      revokedRef.current = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const chip = (
    <Chip
      icon={<ImageIcon fontSize="small" />}
      label={file.name}
      size="small"
      variant="outlined"
      onDelete={onRemove ? () => onRemove(index) : undefined}
      sx={chipSx}
    />
  );

  if (!thumbUrl) return chip;

  return (
    <Tooltip
      title={
        <Box
          component="img"
          src={thumbUrl}
          alt={file.name}
          sx={{
            maxWidth: 260,
            maxHeight: 200,
            objectFit: 'contain',
            display: 'block',
            borderRadius: '10px',
          }}
        />
      }
      arrow
      enterDelay={350}
      leaveDelay={80}
      slotProps={{
        popper: { sx: { pointerEvents: 'none' } },
        tooltip: {
          sx: {
            bgcolor: 'transparent',
            p: 0,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
          },
        },
      }}
    >
      {chip}
    </Tooltip>
  );
};

const SelectedFileStrip: React.FC<SelectedFileStripProps> = ({
  files,
  onRemove,
  maxChips = 3,
}) => {
  if (files.length === 0) return null;

  const visibleFiles = files.slice(0, maxChips);
  const overflowCount = files.length - maxChips;

  return (
    <Box
      sx={{
        display: 'flex',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        alignItems: 'center',
        gap: '7px',
        flexShrink: 0,
        maxWidth: '100%',
      }}
    >
      {visibleFiles.map((file, index) => {
        if (isImageFile(file.name)) {
          return <ImageChip key={index} file={file} index={index} onRemove={onRemove} />;
        }
        return (
          <Chip
            key={index}
            icon={getFileIcon(file.name)}
            label={file.name}
            size="small"
            variant="outlined"
            onDelete={onRemove ? () => onRemove(index) : undefined}
            sx={chipSx}
          />
        );
      })}
      {overflowCount > 0 && (
        <Tooltip
          title={
            <React.Fragment>
              {files.slice(maxChips).map((f, i) => (
                <div key={i}>{f.name}</div>
              ))}
            </React.Fragment>
          }
        >
          <Chip label={`+${overflowCount}`} size="small" sx={overflowChipSx} />
        </Tooltip>
      )}
    </Box>
  );
};

export default SelectedFileStrip;
