import { SxProps, Theme } from '@mui/material/styles';

// 隐藏滚动条的样式对象
export const invisibleScrollerSx: SxProps<Theme> = {
  // 隐藏滚动条样式 - Webkit浏览器 (Chrome, Safari)
  '&::-webkit-scrollbar': {
    width: '0px !important',
    height: '0px !important',
    background: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-corner': {
    background: 'transparent',
  },
  // Firefox
  scrollbarWidth: 'none !important',
  // IE and Edge
  msOverflowStyle: 'none !important',
};

// 自定义滚动条样式对象 (类似于uniformed-scroller)
export const uniformedScrollerSx: SxProps<Theme> = {
  '&::-webkit-scrollbar': {
    width: '8px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: '4px',
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent',
};

// 可以根据需要添加更多滚动条样式变体
export const thinScrollerSx: SxProps<Theme> = {
  '&::-webkit-scrollbar': {
    width: '4px',
    height: '4px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '2px',
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(0, 0, 0, 0.3) transparent',
}; 