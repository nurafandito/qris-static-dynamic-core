/**
 * Calculate CRC16-CCITT checksum for QRIS/EMVCo QR codes.
 * Polynomial: 0x1021, Init: 0xFFFF
 */
export function calculateCRC16(str: string): string {
  // EMVCo defines length/CRC over bytes, not JS UTF-16 code units — encode first
  // so multi-byte characters (e.g. accented merchant names) hash correctly.
  const bytes = new TextEncoder().encode(str);
  let crc = 0xffff;

  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]! << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }

  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
