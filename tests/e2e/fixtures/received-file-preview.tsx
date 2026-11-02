import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import Download from '../../../src/components/Download';
import FilePreviewDialog from '../../../src/components/FilePreviewDialog';
import colab from '../../../src/app/libs/connection/colabLib';
import i18n from '../../../src/app/libs/i18n/i18n';
import history from '../../../src/app/libs/chat/ChatHistoryManager';
import blobs from '../../../src/app/libs/chat/FileBlobStore';
import integration from '../../../src/app/libs/chat/ChatIntegration';

await i18n.changeLanguage('zh');
const ids: Record<string, string> = {};
const oldNow = Date.now;
const entries = [
  ['a.svg', 'a.svg', 'image/svg+xml'],
  ['b.svg', 'b.svg', 'image/svg+xml'],
  ['notes.txt', 'notes.txt', 'text/plain'],
  ['report.docx', 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['data.bin', 'data.bin', 'application/octet-stream'],
  ['same.svg', 'one/same.svg', 'image/svg+xml'],
  ['same.svg', 'two/same.svg', 'image/svg+xml'],
];
for (let i = 0; i < entries.length; i++) {
  const [name, path, type] = entries[i];
  const contents = type === 'image/svg+xml'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><rect width="300" height="600" fill="#3f7eb0"/><text x="10" y="50">${path}</text></svg>`
    : name === 'notes.txt' ? 'readable notes' : `binary ${name}`;
  const file = new File([contents], name, { type });
  const key = `key-${i}`;
  await blobs.storeFile(key, file);
  Date.now = () => 100000 + (name === 'report.docx' ? 10000 : i * 1000);
  const result = await history.addFileMessage('Alice:device', 'Alice', 'Alice:device', { name, size: file.size, type }, 'completed', 100, key, {
    sourceArchiveFileKey: 'bundle-key', sourceArchiveEntryPath: path,
  });
  ids[path] = result.messageId!;
}
Date.now = oldNow;
(window as any).__fixture = { colab, blobs, integration, ids };
document.body.innerHTML = '<div id="fixture"></div>';
const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
function ChatPreviewFixture() {
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const show = (next: File) => { setFile(next); setOpen(true); };
  return <>
    <Button onClick={() => show(new File(['chat preview text'], 'chat.txt', { type: 'text/plain' }))}>Text fixture</Button>
    <Button onClick={() => show(new File(['word binary'], 'chat.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))}>Word fixture</Button>
    {file && <FilePreviewDialog file={file} fileName={file.name} mimeType={file.type} fileCategory="document" open={open} onClose={() => setOpen(false)} onExited={() => setFile(null)} />}
  </>;
}
createRoot(document.getElementById('fixture')!).render(
  <ThemeProvider theme={createTheme({ palette: { mode } })}>
    <CssBaseline />
    {new URLSearchParams(location.search).has('chat') ? <ChatPreviewFixture /> : <Download open progress={null} setProgress={() => {}} onClose={() => {}} />}
  </ThemeProvider>,
);
