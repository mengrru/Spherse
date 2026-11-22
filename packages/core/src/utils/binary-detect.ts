export const BINARY_SAMPLE_SIZE = 8192;

export function isBinaryBuffer(buf: Uint8Array): boolean {
  return buf.subarray(0, BINARY_SAMPLE_SIZE).includes(0x00);
}
