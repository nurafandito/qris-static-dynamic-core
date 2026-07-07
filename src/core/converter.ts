import { calculateCRC16 } from "./crc16.js";
import { parseTLV } from "./parser.js";
import type { ConvertOptions, TLV } from "./types.js";

/**
 * Rebuild a QRIS string from TLV elements (without CRC).
 */
function buildTLVString(elements: TLV[]): string {
  return elements
    .map((el) => {
      const value = el.children ? buildTLVString(el.children) : el.value;
      // Length is a byte count per EMVCo, not a JS string character count —
      // must match how parseTLV measures it, or multi-byte values misalign.
      const byteLength = new TextEncoder().encode(value).length;
      if (byteLength > 99) {
        throw new Error(
          `Tag ${el.tag} value is ${byteLength} bytes, exceeds the 99-byte TLV length limit`
        );
      }
      const length = byteLength.toString().padStart(2, "0");
      return `${el.tag}${length}${value}`;
    })
    .join("");
}

function buildAmountFeeTLVs(options: ConvertOptions): TLV[] {
  const tlvs: TLV[] = [
    makeTLV("54", options.amount.toString(), "Transaction Amount"),
  ];

  if (options.fee) {
    if (!Number.isFinite(options.fee.value) || options.fee.value < 0) {
      throw new Error("fee.value must be a non-negative finite number");
    }

    if (options.fee.type === "fixed") {
      tlvs.push(makeTLV("55", "02", "Tip or Convenience Indicator"));
      tlvs.push(
        makeTLV(
          "56",
          options.fee.value.toString(),
          "Value of Convenience Fee (Fixed)"
        )
      );
    } else {
      tlvs.push(makeTLV("55", "03", "Tip or Convenience Indicator"));
      tlvs.push(
        makeTLV(
          "57",
          options.fee.value.toString(),
          "Value of Convenience Fee (%)"
        )
      );
    }
  }

  return tlvs;
}

/**
 * Create a TLV element.
 */
function makeTLV(tag: string, value: string, name = ""): TLV {
  return { tag, name, length: value.length, value };
}

/**
 * Convert a static QRIS string to dynamic by injecting amount and optional fee.
 *
 * Steps:
 * 1. Parse the TLV structure
 * 2. Change Point of Initiation Method from "11" (static) to "12" (dynamic)
 * 3. Insert/replace Transaction Amount (tag 54)
 * 4. Optionally insert Tip Indicator (tag 55) and fee value (tag 56/57)
 * 5. Recalculate CRC16 checksum
 */
export function convertQRIS(
  qrisString: string,
  options: ConvertOptions
): string {
  if (!Number.isFinite(options.amount) || options.amount <= 0) {
    throw new Error("amount must be a positive finite number");
  }

  const elements = parseTLV(qrisString);

  if (!elements.some((el) => el.tag === "01")) {
    throw new Error(
      "qrisString is not a valid QRIS payload (missing tag 01, Point of Initiation Method)"
    );
  }

  // Build the new TLV array preserving order, injecting/replacing as needed
  const result: TLV[] = [];
  let amountInserted = false;

  // Tags to skip (we'll re-insert them)
  const managedTags = new Set(["54", "55", "56", "57", "63"]);

  for (const el of elements) {
    if (managedTags.has(el.tag)) continue;

    if (el.tag === "01") {
      // Change static → dynamic
      result.push(makeTLV("01", "12", "Point of Initiation Method"));
      continue;
    }

    // Insert amount + fee before tag 58 (Country Code)
    if (el.tag === "58" && !amountInserted) {
      result.push(...buildAmountFeeTLVs(options));
      amountInserted = true;
    }

    result.push(el);
  }

  // Tag 58 was missing (malformed input) — still guarantee the amount
  // is present rather than silently producing a QR with no nominal.
  if (!amountInserted) {
    result.push(...buildAmountFeeTLVs(options));
  }

  // Build string without CRC, then append CRC
  const withoutCRC = buildTLVString(result);
  const crcInput = withoutCRC + "6304";
  const crc = calculateCRC16(crcInput);

  return crcInput + crc;
}
