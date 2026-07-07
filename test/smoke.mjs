import assert from "node:assert/strict";
import { parseQRIS, parseTLV, convertQRIS, validateQRIS, calculateCRC16 } from "../dist/index.js";

function tlv(tag, value) {
  return tag + String(value.length).padStart(2, "0") + value;
}

function buildStaticQris({ merchantValue = "XYZNOTTLV", city = "JAKARTA" } = {}) {
  const mai = tlv("00", "ID.CO.EXAMPLE") + tlv("01", "0001234567890");
  const merchant = merchantValue === "XYZNOTTLV" ? mai : merchantValue;
  let s =
    tlv("00", "01") +
    tlv("01", "11") +
    tlv("26", merchant) +
    tlv("52", "5411") +
    tlv("53", "360") +
    tlv("58", "ID") +
    tlv("59", "TOKO") +
    tlv("60", city);
  return s + "6304" + calculateCRC16(s + "6304");
}

// 1. Happy path: convert + validate + parse
const qris = buildStaticQris();
assert.equal(validateQRIS(qris).valid, true, "static QRIS should validate");
const dynamic = convertQRIS(qris, { amount: 15000 });
assert.equal(validateQRIS(dynamic).valid, true, "converted QRIS should validate");
assert.equal(parseQRIS(dynamic).method, "dynamic");
assert.equal(parseQRIS(dynamic).amount, "15000");

// 2. Fee calculation ends up in the right tags
const withFee = convertQRIS(qris, { amount: 1000, fee: { type: "fixed", value: 500 } });
assert.match(withFee, /5502025603500/, "fixed fee should produce tag 55=02, tag 56=500");

// 3. Malformed merchant value is preserved, not silently wiped (parser fix)
const badMerchant = buildStaticQris({ merchantValue: "XYZNOTTLV" });
// force a non-TLV value into tag 26 directly
const brokenMai = "26" + String("NOTVALIDTLV".length).padStart(2, "0") + "NOTVALIDTLV";
let broken =
  tlv("00", "01") + tlv("01", "11") + brokenMai + tlv("52", "5411") + tlv("53", "360") +
  tlv("58", "ID") + tlv("59", "TOKO") + tlv("60", "JAKARTA");
broken += "6304" + calculateCRC16(broken + "6304");
const convertedBroken = convertQRIS(broken, { amount: 1000 });
assert.match(convertedBroken, /NOTVALIDTLV/, "non-TLV merchant value must be preserved, not dropped");

// 4. Amount is always present even if tag 58 is missing
let noCountry =
  tlv("00", "01") + tlv("01", "11") + tlv("26", tlv("00", "ID.CO.EXAMPLE")) +
  tlv("52", "5411") + tlv("53", "360") + tlv("59", "TOKO") + tlv("60", "JAKARTA");
noCountry += "6304" + calculateCRC16(noCountry + "6304");
assert.match(convertQRIS(noCountry, { amount: 1000 }), /54041000/, "amount must be inserted even without tag 58");

// 5. Rejections: invalid amount, invalid fee, garbage input, missing tag 01
assert.throws(() => convertQRIS(qris, { amount: -5 }), /positive finite number/);
assert.throws(() => convertQRIS(qris, { amount: 1000, fee: { type: "fixed", value: -500 } }), /fee.value/);
assert.throws(() => convertQRIS(qris, { amount: 1000, fee: { type: "fixed", value: NaN } }), /fee.value/);
assert.throws(() => convertQRIS("garbage input not a qris", { amount: 1000 }), /not a valid QRIS/);
assert.throws(() => convertQRIS("", { amount: 1000 }), /not a valid QRIS/);

// 6. Malformed TLV length field stops parsing instead of misreading it
assert.deepEqual(parseTLV("591ATOKO0000"), [], "non-numeric length field must halt parsing");

// 7. CRC mismatch is caught by validateQRIS
const tampered = qris.slice(0, -1) + (qris.at(-1) === "0" ? "1" : "0");
assert.equal(validateQRIS(tampered).valid, false, "tampered CRC must fail validation");

// 8. Multi-byte UTF-8 merchant name round-trips correctly (byte-length fix)
// "café" is 4 JS chars but 5 UTF-8 bytes — length must be computed in bytes.
function tlvBytes(tag, value) {
  const byteLen = new TextEncoder().encode(value).length;
  return tag + String(byteLen).padStart(2, "0") + value;
}
let accented =
  tlvBytes("00", "01") + tlvBytes("01", "11") + tlvBytes("26", tlv("00", "ID.CO.EXAMPLE")) +
  tlvBytes("52", "5411") + tlvBytes("53", "360") + tlvBytes("58", "ID") +
  tlvBytes("59", "café") + tlvBytes("60", "JAKARTA");
accented += "6304" + calculateCRC16(accented + "6304");
assert.equal(validateQRIS(accented).valid, true, "byte-correct multi-byte QRIS must validate");
assert.equal(parseQRIS(accented).merchantName, "café", "multi-byte merchant name must parse intact");
// tag right after "café" (tag 60) must not be corrupted by a wrong byte offset
assert.equal(parseQRIS(accented).merchantCity, "JAKARTA");

// 9. Non-numeric tag halts parsing instead of being silently accepted
assert.deepEqual(parseTLV("XY05HELLO"), [], "non-numeric tag must halt parsing");

// 10. Merchant category code is passed through raw (tag 52), unmapped
assert.equal(parseQRIS(qris).merchantCategoryCode, "5411");

console.log("All smoke checks passed.");
