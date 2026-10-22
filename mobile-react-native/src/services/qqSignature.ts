/* eslint-disable no-bitwise */

const rotateLeft = (value: number, count: number) =>
  (value << count) | (value >>> (32 - count));

const utf8 = (value: string) => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.codePointAt(index)!;
    if (point > 0xffff) index += 1;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800)
      bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000)
      bytes.push(
        0xe0 | (point >>> 12),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
  }
  return bytes;
};

const sha1 = (value: string) => {
  const bytes = utf8(value),
    bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8)
    bytes.push(shift >= 32 ? 0 : (bitLength >>> shift) & 0xff);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(80).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        (bytes[start]! << 24) |
        (bytes[start + 1]! << 16) |
        (bytes[start + 2]! << 8) |
        bytes[start + 3]!;
    }
    for (let index = 16; index < 80; index += 1)
      words[index] = rotateLeft(
        words[index - 3]! ^
          words[index - 8]! ^
          words[index - 14]! ^
          words[index - 16]!,
        1,
      );
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let index = 0; index < 80; index += 1) {
      const f =
          index < 20
            ? (b & c) | (~b & d)
            : index < 40
            ? b ^ c ^ d
            : index < 60
            ? (b & c) | (b & d) | (c & d)
            : b ^ c ^ d,
        constant =
          index < 20
            ? 0x5a827999
            : index < 40
            ? 0x6ed9eba1
            : index < 60
            ? 0x8f1bbcdc
            : 0xca62c1d6,
        temporary = (rotateLeft(a, 5) + f + e + constant + words[index]!) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temporary;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4]
    .map(part => (part >>> 0).toString(16).padStart(8, '0'))
    .join('');
};

const base64 = (bytes: number[]) => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const value =
      (bytes[index]! << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    result += alphabet[(value >>> 18) & 63];
    result += alphabet[(value >>> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=';
    result += index + 2 < bytes.length ? alphabet[value & 63] : '=';
  }
  return result;
};

export const qqSign = (text: string) => {
  const hash = sha1(text),
    pick = (indexes: number[]) => indexes.map(index => hash[index]).join(''),
    part1 = pick([23, 14, 6, 36, 16, 40, 7, 19]),
    part2 = pick([16, 1, 32, 12, 19, 27, 8, 5]),
    scramble = [
      89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64,
      242, 133, 143, 161, 121, 179,
    ].map((value, index) =>
      value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16),
    ),
    middle = base64(scramble).replace(/[\\/+=]/g, '');
  return `zzc${part1}${middle}${part2}`.toLowerCase();
};
