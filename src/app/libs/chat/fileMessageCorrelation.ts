type UploadingFileMessage = {
  id: string;
  type: "file" | "image";
  fileMetadata: {
    fileName: string;
    fileKey?: string;
    transferStatus: string;
  };
};

export function findUploadingFileMessage(
  messages: readonly UploadingFileMessage[],
  fileKey?: string,
): UploadingFileMessage | undefined {
  if (!fileKey) return undefined;
  return [...messages].reverse().find(message =>
    message.fileMetadata.transferStatus === "uploading"
    && message.fileMetadata.fileKey === fileKey,
  );
}
