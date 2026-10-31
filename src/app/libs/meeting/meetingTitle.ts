/** Keep titles within the signalling server's 64-byte UTF-8 limit without splitting a character. */
export function limitMeetingTitle(value: string): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > 64) break;
    result += character;
    bytes += size;
  }
  return result;
}
