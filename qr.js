(function (root) {
  const DATA = [0, 16, 28, 44, 64, 86, 108];
  const EC = [0, 10, 16, 26, 18, 24, 16];
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4];

  // Choose the smallest supported version that fits the byte stream.
  function chooseVersion(length) {
    for (let version = 1; version <= 6; version++) {
      if (length * 8 + 12 <= DATA[version] * 8) return version;
    }
    throw new Error("QR payload too long for version 6");
  }

  // Build the byte-mode bit stream and fill unused data codewords.
  function buildBits(bytes, version) {
    const bits = [];
    const put = (value, count) => {
      for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    put(4, 4);
    put(bytes.length, 8);
    for (const byte of bytes) put(byte, 8);
    const capacity = DATA[version] * 8;
    for (let i = 0; i < Math.min(4, capacity - bits.length); i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const output = [];
    for (let i = 0; i < bits.length; i += 8) {
      output.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    }
    for (let pad = 0; output.length < DATA[version]; pad++) {
      output.push(pad % 2 ? 0x11 : 0xec);
    }
    return output;
  }

  // Compute the Reed–Solomon remainder over GF(256).
  function reedSolomon(data, count) {
    const mul = (left, right) => {
      let result = 0;
      while (right) {
        if (right & 1) result ^= left;
        right >>>= 1;
        left <<= 1;
        if (left & 0x100) left ^= 0x11d;
      }
      return result;
    };
    let generator = [1];
    let root = 1;
    for (let i = 0; i < count; i++) {
      const next = Array(generator.length + 1).fill(0);
      generator.forEach((value, index) => {
        next[index] ^= value;
        next[index + 1] ^= mul(value, root);
      });
      generator = next;
      root = mul(root, 2);
    }
    const remainder = Array(count).fill(0);
    for (const value of data) {
      const factor = value ^ remainder.shift();
      remainder.push(0);
      for (let i = 0; i < count; i++) remainder[i] ^= mul(generator[i + 1], factor);
    }
    return remainder;
  }

  // Interleave equal-sized data blocks followed by their error-correction words.
  function interleave(data, version) {
    const blockCount = BLOCKS[version];
    const blockWidth = data.length / blockCount;
    const dataBlocks = [];
    const ecBlocks = [];
    for (let i = 0; i < blockCount; i++) {
      const block = data.slice(i * blockWidth, (i + 1) * blockWidth);
      dataBlocks.push(block);
      ecBlocks.push(reedSolomon(block, EC[version]));
    }
    const output = [];
    for (let column = 0; column < blockWidth; column++) {
      for (const block of dataBlocks) output.push(block[column]);
    }
    for (let column = 0; column < EC[version]; column++) {
      for (const block of ecBlocks) output.push(block[column]);
    }
    return output;
  }

  // Compute the BCH-protected format information for a mask.
  function formatBits(maskNumber) {
    const value = maskNumber << 10;
    let remainder = value;
    for (let bit = 14; bit >= 10; bit--) {
      if ((remainder >>> bit) & 1) remainder ^= 0x537 << (bit - 10);
    }
    return ((maskNumber << 10) | remainder) ^ 0x5412;
  }

  // Draw finder, timing, alignment, and reserved format modules.
  function drawFunctionPatterns(version) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => Array(size).fill(false));
    const functions = Array.from({ length: size }, () => Array(size).fill(false));
    const set = (x, y, dark) => {
      if (x >= 0 && y >= 0 && x < size && y < size) {
        modules[y][x] = dark;
        functions[y][x] = true;
      }
    };
    const finders = [[0, 0], [size - 7, 0], [0, size - 7]];
    for (const [originX, originY] of finders) {
      for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
          const inFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6;
          const dark = inFinder && (x === 0 || x === 6 || y === 0 || y === 6 ||
            (x >= 2 && x <= 4 && y >= 2 && y <= 4));
          set(originX + x, originY + y, dark);
        }
      }
    }
    for (let i = 8; i < size - 8; i++) {
      set(i, 6, i % 2 === 0);
      set(6, i, i % 2 === 0);
    }
    if (version > 1) {
      const center = size - 7;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          set(center + x, center + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
    set(8, size - 8, true);
    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        set(8, i, false);
        set(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      set(size - 1 - i, 8, false);
      set(8, size - 1 - i, false);
    }
    return { modules, functions };
  }

  // Place codeword bits in the alternating two-column zigzag.
  function placeData(modules, functions, bytes) {
    const size = modules.length;
    const bits = bytes.flatMap(byte =>
      Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let vertical = 0; vertical < size; vertical++) {
        const y = upward ? size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset++) {
          const x = right - offset;
          if (!functions[y][x]) modules[y][x] = !!bits[bitIndex++];
        }
      }
      upward = !upward;
    }
    return modules;
  }

  // Evaluate the eight QR data-mask predicates.
  function maskApplies(pattern, x, y) {
    const tests = [
      (x + y) % 2 === 0,
      y % 2 === 0,
      x % 3 === 0,
      (x + y) % 3 === 0,
      (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
      (x * y) % 2 + (x * y) % 3 === 0,
      ((x * y) % 2 + (x * y) % 3) % 2 === 0,
      ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    return tests[pattern];
  }

  // Apply a candidate mask to non-function modules only.
  function applyMask(modules, functions, pattern) {
    for (let y = 0; y < modules.length; y++) {
      for (let x = 0; x < modules.length; x++) {
        if (!functions[y][x] && maskApplies(pattern, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  // Score candidate matrices using the four QR mask penalty rules.
  function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(modules[y]);
    for (let x = 0; x < size; x++) lines.push(modules.map(row => row[x]));
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let i = 0; i <= size - 11; i++) {
        const pattern = line.slice(i, i + 11).map(Number).join("");
        if (pattern === "10111010000" || pattern === "00001011101") score += 40;
      }
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const dark = modules[y][x];
        if (dark === modules[y + 1][x] && dark === modules[y][x + 1] &&
            dark === modules[y + 1][x + 1]) score += 3;
      }
    }
    const darkCount = modules.flat().filter(Boolean).length;
    score += 10 * Math.floor(Math.abs(darkCount * 100 / (size * size) - 50) / 5);
    return score;
  }

  // Write format information into both reserved matrix strips.
  function writeFormat(modules, pattern) {
    const size = modules.length;
    const value = formatBits(pattern);
    const first = [];
    for (let i = 0; i <= 5; i++) first.push([8, i]);
    first.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) first.push([14 - i, 8]);
    const second = [];
    for (let i = 0; i < 8; i++) second.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) second.push([8, size - 15 + i]);
    for (let i = 0; i < 15; i++) {
      const dark = !!((value >>> i) & 1);
      modules[first[i][1]][first[i][0]] = dark;
      modules[second[i][1]][second[i][0]] = dark;
    }
  }

  // Assemble the lowest-penalty masked QR matrix.
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const version = chooseVersion(bytes.length);
    const base = drawFunctionPatterns(version);
    const stream = interleave(buildBits(bytes, version), version);
    placeData(base.modules, base.functions, stream);
    let best;
    let bestScore = Infinity;
    for (let pattern = 0; pattern < 8; pattern++) {
      const candidate = base.modules.map(row => row.slice());
      applyMask(candidate, base.functions, pattern);
      writeFormat(candidate, pattern);
      const score = penalty(candidate);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return { version, size: best.length, modules: best };
  }

  // Render the matrix as a single-path SVG with a quiet zone.
  function svg(matrix, { margin = 4 } = {}) {
    const extent = matrix.size + margin * 2;
    let path = "";
    for (let y = 0; y < matrix.size; y++) {
      for (let x = 0; x < matrix.size; x++) {
        if (matrix.modules[y][x]) path += `M${x + margin},${y + margin}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"><rect width="100%" height="100%" fill="white"/><path fill="black" d="${path}"/></svg>`;
  }

  const QR = { encode, svg };
  if (typeof module !== "undefined" && module.exports) module.exports = QR;
  else root.QR = QR;
})(typeof globalThis !== "undefined" ? globalThis : this);
