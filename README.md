# qris-static-dynamic-core

Parse, validate, and convert Indonesian QRIS (Quick Response Code Indonesian Standard) payment codes — turn a static QRIS into a dynamic one with a fixed amount, no UI or framework attached.

## Install

```
npm install @nurafandito/qris-static-dynamic-core
```

## Usage

```ts
import { convertQRIS, validateQRIS, parseQRIS } from "@nurafandito/qris-static-dynamic-core";

const staticQris = "00020101021226340013ID.CO.EXAMPLE...";

// Validate structure + CRC
validateQRIS(staticQris); // { valid: boolean, errors: string[] }

// Convert static -> dynamic with a fixed amount
const dynamicQris = convertQRIS(staticQris, {
  amount: 15000,
  fee: { type: "fixed", value: 500 }, // optional
});

// Inspect a QRIS string
parseQRIS(dynamicQris); // { method: "dynamic", amount: "15000", merchantName, ... }
```

## API

- `parseTLV(data: string): TLV[]` — parse a raw TLV string into structured elements.
- `parseQRIS(qrisString: string): QRISData` — parse a full QRIS payload into a friendly shape.
- `convertQRIS(qrisString: string, options: ConvertOptions): string` — convert static to dynamic, injecting amount and optional fee, recalculating the CRC.
- `validateQRIS(qrisString: string): ValidationResult` — structural + CRC validation.
- `calculateCRC16(str: string): string` — EMVCo CRC16-CCITT checksum.

## Development

```
npm run build      # compile to dist/
npm run typecheck
npm test           # build + run test/smoke.mjs
```

## License

MIT
