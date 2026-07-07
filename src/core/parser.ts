import type { TLV, QRISData, MerchantAccountInfo } from "./types.js";

/** Map of known EMVCo / QRIS tag IDs to human-readable names */
const TAG_NAMES: Record<string, string> = {
  "00": "Payload Format Indicator",
  "01": "Point of Initiation Method",
  "02": "Visa",
  "03": "Mastercard",
  "04": "Mastercard",
  "15": "Visa",
  "26": "Merchant Account Information",
  "27": "Merchant Account Information",
  "28": "Merchant Account Information",
  "29": "Merchant Account Information",
  "30": "Merchant Account Information",
  "31": "Merchant Account Information",
  "32": "Merchant Account Information",
  "33": "Merchant Account Information",
  "34": "Merchant Account Information",
  "35": "Merchant Account Information",
  "36": "Merchant Account Information",
  "37": "Merchant Account Information",
  "38": "Merchant Account Information",
  "39": "Merchant Account Information",
  "40": "Merchant Account Information",
  "41": "Merchant Account Information",
  "42": "Merchant Account Information",
  "43": "Merchant Account Information",
  "44": "Merchant Account Information",
  "45": "Merchant Account Information",
  "46": "Merchant Account Information",
  "47": "Merchant Account Information",
  "48": "Merchant Account Information",
  "49": "Merchant Account Information",
  "50": "Merchant Account Information",
  "51": "Merchant Account Information",
  "52": "Merchant Category Code",
  "53": "Transaction Currency",
  "54": "Transaction Amount",
  "55": "Tip or Convenience Indicator",
  "56": "Value of Convenience Fee (Fixed)",
  "57": "Value of Convenience Fee (%)",
  "58": "Country Code",
  "59": "Merchant Name",
  "60": "Merchant City",
  "61": "Postal Code",
  "62": "Additional Data Field",
  "63": "CRC",
};

/** Tags that contain nested TLV sub-elements */
const NESTED_TAGS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String(i + 26).padStart(2, "0")),
  "62",
]);

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Parse a raw TLV byte sequence into an array of TLV elements, tracking how
 * many bytes were actually consumed (may be less than bytes.length if the
 * tail is malformed). Operates on bytes, not JS string indices, because
 * EMVCo length fields count encoded bytes — a JS string index would
 * misalign as soon as a value contains a multi-byte UTF-8 character.
 */
function parseTLVConsuming(bytes: Uint8Array): { elements: TLV[]; consumed: number } {
  const elements: TLV[] = [];
  let pos = 0;

  while (pos < bytes.length) {
    if (pos + 4 > bytes.length) break;

    const tag = decoder.decode(bytes.subarray(pos, pos + 2));
    const lengthStr = decoder.decode(bytes.subarray(pos + 2, pos + 4));

    // Tag and length are always 2 ASCII digits per EMVCo; rejecting anything
    // else also catches a split multi-byte sequence landing on this boundary.
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lengthStr)) break;
    const length = parseInt(lengthStr, 10);

    if (pos + 4 + length > bytes.length) break;

    const valueBytes = bytes.subarray(pos + 4, pos + 4 + length);
    const value = decoder.decode(valueBytes);
    const name = TAG_NAMES[tag] ?? `Unknown (${tag})`;

    const element: TLV = { tag, name, length, value };

    if (NESTED_TAGS.has(tag)) {
      // Only treat the value as nested TLV if it parses cleanly end-to-end;
      // otherwise keep it as an opaque leaf so the raw value is preserved.
      const nested = parseTLVConsuming(valueBytes);
      if (nested.consumed === valueBytes.length) {
        element.children = nested.elements;
      }
    }

    elements.push(element);
    pos += 4 + length;
  }

  return { elements, consumed: pos };
}

/**
 * Parse a raw TLV string into an array of TLV elements.
 */
export function parseTLV(data: string): TLV[] {
  return parseTLVConsuming(new TextEncoder().encode(data)).elements;
}

/**
 * Parse a QRIS string into a structured QRISData object.
 */
export function parseQRIS(qrisString: string): QRISData {
  const raw = parseTLV(qrisString);

  const findTag = (tag: string) => raw.find((t) => t.tag === tag);

  const methodValue = findTag("01")?.value;
  const method = methodValue === "12" ? "dynamic" : "static";

  const tipIndicatorValue = findTag("55")?.value;
  let tipIndicator: QRISData["tipIndicator"];
  if (tipIndicatorValue === "01") tipIndicator = "prompt";
  else if (tipIndicatorValue === "02") tipIndicator = "fixed";
  else if (tipIndicatorValue === "03") tipIndicator = "percentage";

  // Extract merchant account information (tags 26-51)
  const merchantAccountInfo: MerchantAccountInfo[] = raw
    .filter((t) => {
      const tagNum = parseInt(t.tag, 10);
      return tagNum >= 26 && tagNum <= 51 && t.children;
    })
    .map((t) => {
      const children = t.children ?? [];
      const findChild = (childTag: string) =>
        children.find((c) => c.tag === childTag);

      return {
        tag: t.tag,
        globallyUniqueId: findChild("00")?.value ?? "",
        merchantId: findChild("01")?.value ?? findChild("02")?.value,
        merchantCriteria: findChild("03")?.value,
        fields: children,
      };
    });

  const merchantCategoryCode = findTag("52")?.value ?? "";

  return {
    version: findTag("00")?.value ?? "01",
    method,
    merchantAccountInfo,
    merchantCategoryCode,
    currency: findTag("53")?.value ?? "360",
    amount: findTag("54")?.value,
    tipIndicator,
    tipFixed: findTag("56")?.value,
    tipPercentage: findTag("57")?.value,
    countryCode: findTag("58")?.value ?? "ID",
    merchantName: findTag("59")?.value ?? "",
    merchantCity: findTag("60")?.value ?? "",
    postalCode: findTag("61")?.value ?? "",
    additionalData: findTag("62")?.children,
    crc: findTag("63")?.value ?? "",
    raw,
  };
}
