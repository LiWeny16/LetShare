import { registerPlugin } from '@capacitor/core';

const BinarySaver = registerPlugin<{
    saveBytes(options: {
        fileName: string;
        mimeType: string;
        data: number[]; // JS 数组，传到 Android 变 byte[]
    }): Promise<void>;
}>('BinarySaver');

export async function saveBinaryToApp(file: File) {
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    await BinarySaver.saveBytes({
        fileName: file.name,
        mimeType: file.type,
        data: Array.from(uint8Array),
    });
}
