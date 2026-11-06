import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/pngjs/lib/chunkstream.js
var require_chunkstream = __commonJS({
  "node_modules/pngjs/lib/chunkstream.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var ChunkStream = module.exports = function() {
      Stream.call(this);
      this._buffers = [];
      this._buffered = 0;
      this._reads = [];
      this._paused = false;
      this._encoding = "utf8";
      this.writable = true;
    };
    util.inherits(ChunkStream, Stream);
    ChunkStream.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
      process.nextTick(
        function() {
          this._process();
          if (this._paused && this._reads && this._reads.length > 0) {
            this._paused = false;
            this.emit("drain");
          }
        }.bind(this)
      );
    };
    ChunkStream.prototype.write = function(data, encoding) {
      if (!this.writable) {
        this.emit("error", new Error("Stream not writable"));
        return false;
      }
      let dataBuffer;
      if (Buffer.isBuffer(data)) {
        dataBuffer = data;
      } else {
        dataBuffer = Buffer.from(data, encoding || this._encoding);
      }
      this._buffers.push(dataBuffer);
      this._buffered += dataBuffer.length;
      this._process();
      if (this._reads && this._reads.length === 0) {
        this._paused = true;
      }
      return this.writable && !this._paused;
    };
    ChunkStream.prototype.end = function(data, encoding) {
      if (data) {
        this.write(data, encoding);
      }
      this.writable = false;
      if (!this._buffers) {
        return;
      }
      if (this._buffers.length === 0) {
        this._end();
      } else {
        this._buffers.push(null);
        this._process();
      }
    };
    ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
    ChunkStream.prototype._end = function() {
      if (this._reads.length > 0) {
        this.emit("error", new Error("Unexpected end of input"));
      }
      this.destroy();
    };
    ChunkStream.prototype.destroy = function() {
      if (!this._buffers) {
        return;
      }
      this.writable = false;
      this._reads = null;
      this._buffers = null;
      this.emit("close");
    };
    ChunkStream.prototype._processReadAllowingLess = function(read) {
      this._reads.shift();
      let smallerBuf = this._buffers[0];
      if (smallerBuf.length > read.length) {
        this._buffered -= read.length;
        this._buffers[0] = smallerBuf.slice(read.length);
        read.func.call(this, smallerBuf.slice(0, read.length));
      } else {
        this._buffered -= smallerBuf.length;
        this._buffers.shift();
        read.func.call(this, smallerBuf);
      }
    };
    ChunkStream.prototype._processRead = function(read) {
      this._reads.shift();
      let pos = 0;
      let count = 0;
      let data = Buffer.alloc(read.length);
      while (pos < read.length) {
        let buf = this._buffers[count++];
        let len = Math.min(buf.length, read.length - pos);
        buf.copy(data, pos, 0, len);
        pos += len;
        if (len !== buf.length) {
          this._buffers[--count] = buf.slice(len);
        }
      }
      if (count > 0) {
        this._buffers.splice(0, count);
      }
      this._buffered -= read.length;
      read.func.call(this, data);
    };
    ChunkStream.prototype._process = function() {
      try {
        while (this._buffered > 0 && this._reads && this._reads.length > 0) {
          let read = this._reads[0];
          if (read.allowLess) {
            this._processReadAllowingLess(read);
          } else if (this._buffered >= read.length) {
            this._processRead(read);
          } else {
            break;
          }
        }
        if (this._buffers && !this.writable) {
          this._end();
        }
      } catch (ex) {
        this.emit("error", ex);
      }
    };
  }
});

// node_modules/pngjs/lib/interlace.js
var require_interlace = __commonJS({
  "node_modules/pngjs/lib/interlace.js"(exports) {
    "use strict";
    var imagePasses = [
      {
        // pass 1 - 1px
        x: [0],
        y: [0]
      },
      {
        // pass 2 - 1px
        x: [4],
        y: [0]
      },
      {
        // pass 3 - 2px
        x: [0, 4],
        y: [4]
      },
      {
        // pass 4 - 4px
        x: [2, 6],
        y: [0, 4]
      },
      {
        // pass 5 - 8px
        x: [0, 2, 4, 6],
        y: [2, 6]
      },
      {
        // pass 6 - 16px
        x: [1, 3, 5, 7],
        y: [0, 2, 4, 6]
      },
      {
        // pass 7 - 32px
        x: [0, 1, 2, 3, 4, 5, 6, 7],
        y: [1, 3, 5, 7]
      }
    ];
    exports.getImagePasses = function(width, height) {
      let images = [];
      let xLeftOver = width % 8;
      let yLeftOver = height % 8;
      let xRepeats = (width - xLeftOver) / 8;
      let yRepeats = (height - yLeftOver) / 8;
      for (let i = 0; i < imagePasses.length; i++) {
        let pass = imagePasses[i];
        let passWidth = xRepeats * pass.x.length;
        let passHeight = yRepeats * pass.y.length;
        for (let j = 0; j < pass.x.length; j++) {
          if (pass.x[j] < xLeftOver) {
            passWidth++;
          } else {
            break;
          }
        }
        for (let j = 0; j < pass.y.length; j++) {
          if (pass.y[j] < yLeftOver) {
            passHeight++;
          } else {
            break;
          }
        }
        if (passWidth > 0 && passHeight > 0) {
          images.push({ width: passWidth, height: passHeight, index: i });
        }
      }
      return images;
    };
    exports.getInterlaceIterator = function(width) {
      return function(x, y, pass) {
        let outerXLeftOver = x % imagePasses[pass].x.length;
        let outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
        let outerYLeftOver = y % imagePasses[pass].y.length;
        let outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
        return outerX * 4 + outerY * width * 4;
      };
    };
  }
});

// node_modules/pngjs/lib/paeth-predictor.js
var require_paeth_predictor = __commonJS({
  "node_modules/pngjs/lib/paeth-predictor.js"(exports, module) {
    "use strict";
    module.exports = function paethPredictor(left, above, upLeft) {
      let paeth = left + above - upLeft;
      let pLeft = Math.abs(paeth - left);
      let pAbove = Math.abs(paeth - above);
      let pUpLeft = Math.abs(paeth - upLeft);
      if (pLeft <= pAbove && pLeft <= pUpLeft) {
        return left;
      }
      if (pAbove <= pUpLeft) {
        return above;
      }
      return upLeft;
    };
  }
});

// node_modules/pngjs/lib/filter-parse.js
var require_filter_parse = __commonJS({
  "node_modules/pngjs/lib/filter-parse.js"(exports, module) {
    "use strict";
    var interlaceUtils = require_interlace();
    var paethPredictor = require_paeth_predictor();
    function getByteWidth(width, bpp, depth) {
      let byteWidth = width * bpp;
      if (depth !== 8) {
        byteWidth = Math.ceil(byteWidth / (8 / depth));
      }
      return byteWidth;
    }
    var Filter = module.exports = function(bitmapInfo, dependencies) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let interlace = bitmapInfo.interlace;
      let bpp = bitmapInfo.bpp;
      let depth = bitmapInfo.depth;
      this.read = dependencies.read;
      this.write = dependencies.write;
      this.complete = dependencies.complete;
      this._imageIndex = 0;
      this._images = [];
      if (interlace) {
        let passes = interlaceUtils.getImagePasses(width, height);
        for (let i = 0; i < passes.length; i++) {
          this._images.push({
            byteWidth: getByteWidth(passes[i].width, bpp, depth),
            height: passes[i].height,
            lineIndex: 0
          });
        }
      } else {
        this._images.push({
          byteWidth: getByteWidth(width, bpp, depth),
          height,
          lineIndex: 0
        });
      }
      if (depth === 8) {
        this._xComparison = bpp;
      } else if (depth === 16) {
        this._xComparison = bpp * 2;
      } else {
        this._xComparison = 1;
      }
    };
    Filter.prototype.start = function() {
      this.read(
        this._images[this._imageIndex].byteWidth + 1,
        this._reverseFilterLine.bind(this)
      );
    };
    Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        unfilteredLine[x] = rawByte + f1Left;
      }
    };
    Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f2Up = lastLine ? lastLine[x] : 0;
        unfilteredLine[x] = rawByte + f2Up;
      }
    };
    Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f3Up = lastLine ? lastLine[x] : 0;
        let f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f3Add = Math.floor((f3Left + f3Up) / 2);
        unfilteredLine[x] = rawByte + f3Add;
      }
    };
    Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
      let xComparison = this._xComparison;
      let xBiggerThan = xComparison - 1;
      let lastLine = this._lastLine;
      for (let x = 0; x < byteWidth; x++) {
        let rawByte = rawData[1 + x];
        let f4Up = lastLine ? lastLine[x] : 0;
        let f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
        let f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
        let f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
        unfilteredLine[x] = rawByte + f4Add;
      }
    };
    Filter.prototype._reverseFilterLine = function(rawData) {
      let filter = rawData[0];
      let unfilteredLine;
      let currentImage = this._images[this._imageIndex];
      let byteWidth = currentImage.byteWidth;
      if (filter === 0) {
        unfilteredLine = rawData.slice(1, byteWidth + 1);
      } else {
        unfilteredLine = Buffer.alloc(byteWidth);
        switch (filter) {
          case 1:
            this._unFilterType1(rawData, unfilteredLine, byteWidth);
            break;
          case 2:
            this._unFilterType2(rawData, unfilteredLine, byteWidth);
            break;
          case 3:
            this._unFilterType3(rawData, unfilteredLine, byteWidth);
            break;
          case 4:
            this._unFilterType4(rawData, unfilteredLine, byteWidth);
            break;
          default:
            throw new Error("Unrecognised filter type - " + filter);
        }
      }
      this.write(unfilteredLine);
      currentImage.lineIndex++;
      if (currentImage.lineIndex >= currentImage.height) {
        this._lastLine = null;
        this._imageIndex++;
        currentImage = this._images[this._imageIndex];
      } else {
        this._lastLine = unfilteredLine;
      }
      if (currentImage) {
        this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
      } else {
        this._lastLine = null;
        this.complete();
      }
    };
  }
});

// node_modules/pngjs/lib/filter-parse-async.js
var require_filter_parse_async = __commonJS({
  "node_modules/pngjs/lib/filter-parse-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var ChunkStream = require_chunkstream();
    var Filter = require_filter_parse();
    var FilterAsync = module.exports = function(bitmapInfo) {
      ChunkStream.call(this);
      let buffers = [];
      let that = this;
      this._filter = new Filter(bitmapInfo, {
        read: this.read.bind(this),
        write: function(buffer) {
          buffers.push(buffer);
        },
        complete: function() {
          that.emit("complete", Buffer.concat(buffers));
        }
      });
      this._filter.start();
    };
    util.inherits(FilterAsync, ChunkStream);
  }
});

// node_modules/pngjs/lib/constants.js
var require_constants = __commonJS({
  "node_modules/pngjs/lib/constants.js"(exports, module) {
    "use strict";
    module.exports = {
      PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
      TYPE_IHDR: 1229472850,
      TYPE_IEND: 1229278788,
      TYPE_IDAT: 1229209940,
      TYPE_PLTE: 1347179589,
      TYPE_tRNS: 1951551059,
      // eslint-disable-line camelcase
      TYPE_gAMA: 1732332865,
      // eslint-disable-line camelcase
      // color-type bits
      COLORTYPE_GRAYSCALE: 0,
      COLORTYPE_PALETTE: 1,
      COLORTYPE_COLOR: 2,
      COLORTYPE_ALPHA: 4,
      // e.g. grayscale and alpha
      // color-type combinations
      COLORTYPE_PALETTE_COLOR: 3,
      COLORTYPE_COLOR_ALPHA: 6,
      COLORTYPE_TO_BPP_MAP: {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4
      },
      GAMMA_DIVISION: 1e5
    };
  }
});

// node_modules/pngjs/lib/crc.js
var require_crc = __commonJS({
  "node_modules/pngjs/lib/crc.js"(exports, module) {
    "use strict";
    var crcTable = [];
    (function() {
      for (let i = 0; i < 256; i++) {
        let currentCrc = i;
        for (let j = 0; j < 8; j++) {
          if (currentCrc & 1) {
            currentCrc = 3988292384 ^ currentCrc >>> 1;
          } else {
            currentCrc = currentCrc >>> 1;
          }
        }
        crcTable[i] = currentCrc;
      }
    })();
    var CrcCalculator = module.exports = function() {
      this._crc = -1;
    };
    CrcCalculator.prototype.write = function(data) {
      for (let i = 0; i < data.length; i++) {
        this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
      }
      return true;
    };
    CrcCalculator.prototype.crc32 = function() {
      return this._crc ^ -1;
    };
    CrcCalculator.crc32 = function(buf) {
      let crc = -1;
      for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
      }
      return crc ^ -1;
    };
  }
});

// node_modules/pngjs/lib/parser.js
var require_parser = __commonJS({
  "node_modules/pngjs/lib/parser.js"(exports, module) {
    "use strict";
    var constants4 = require_constants();
    var CrcCalculator = require_crc();
    var Parser = module.exports = function(options, dependencies) {
      this._options = options;
      options.checkCRC = options.checkCRC !== false;
      this._hasIHDR = false;
      this._hasIEND = false;
      this._emittedHeadersFinished = false;
      this._palette = [];
      this._colorType = 0;
      this._chunks = {};
      this._chunks[constants4.TYPE_IHDR] = this._handleIHDR.bind(this);
      this._chunks[constants4.TYPE_IEND] = this._handleIEND.bind(this);
      this._chunks[constants4.TYPE_IDAT] = this._handleIDAT.bind(this);
      this._chunks[constants4.TYPE_PLTE] = this._handlePLTE.bind(this);
      this._chunks[constants4.TYPE_tRNS] = this._handleTRNS.bind(this);
      this._chunks[constants4.TYPE_gAMA] = this._handleGAMA.bind(this);
      this.read = dependencies.read;
      this.error = dependencies.error;
      this.metadata = dependencies.metadata;
      this.gamma = dependencies.gamma;
      this.transColor = dependencies.transColor;
      this.palette = dependencies.palette;
      this.parsed = dependencies.parsed;
      this.inflateData = dependencies.inflateData;
      this.finished = dependencies.finished;
      this.simpleTransparency = dependencies.simpleTransparency;
      this.headersFinished = dependencies.headersFinished || function() {
      };
    };
    Parser.prototype.start = function() {
      this.read(constants4.PNG_SIGNATURE.length, this._parseSignature.bind(this));
    };
    Parser.prototype._parseSignature = function(data) {
      let signature = constants4.PNG_SIGNATURE;
      for (let i = 0; i < signature.length; i++) {
        if (data[i] !== signature[i]) {
          this.error(new Error("Invalid file signature"));
          return;
        }
      }
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._parseChunkBegin = function(data) {
      let length = data.readUInt32BE(0);
      let type = data.readUInt32BE(4);
      let name = "";
      for (let i = 4; i < 8; i++) {
        name += String.fromCharCode(data[i]);
      }
      let ancillary = Boolean(data[4] & 32);
      if (!this._hasIHDR && type !== constants4.TYPE_IHDR) {
        this.error(new Error("Expected IHDR on beggining"));
        return;
      }
      this._crc = new CrcCalculator();
      this._crc.write(Buffer.from(name));
      if (this._chunks[type]) {
        return this._chunks[type](length);
      }
      if (!ancillary) {
        this.error(new Error("Unsupported critical chunk type " + name));
        return;
      }
      this.read(length + 4, this._skipChunk.bind(this));
    };
    Parser.prototype._skipChunk = function() {
      this.read(8, this._parseChunkBegin.bind(this));
    };
    Parser.prototype._handleChunkEnd = function() {
      this.read(4, this._parseChunkEnd.bind(this));
    };
    Parser.prototype._parseChunkEnd = function(data) {
      let fileCrc = data.readInt32BE(0);
      let calcCrc = this._crc.crc32();
      if (this._options.checkCRC && calcCrc !== fileCrc) {
        this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
        return;
      }
      if (!this._hasIEND) {
        this.read(8, this._parseChunkBegin.bind(this));
      }
    };
    Parser.prototype._handleIHDR = function(length) {
      this.read(length, this._parseIHDR.bind(this));
    };
    Parser.prototype._parseIHDR = function(data) {
      this._crc.write(data);
      let width = data.readUInt32BE(0);
      let height = data.readUInt32BE(4);
      let depth = data[8];
      let colorType = data[9];
      let compr = data[10];
      let filter = data[11];
      let interlace = data[12];
      if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
        this.error(new Error("Unsupported bit depth " + depth));
        return;
      }
      if (!(colorType in constants4.COLORTYPE_TO_BPP_MAP)) {
        this.error(new Error("Unsupported color type"));
        return;
      }
      if (compr !== 0) {
        this.error(new Error("Unsupported compression method"));
        return;
      }
      if (filter !== 0) {
        this.error(new Error("Unsupported filter method"));
        return;
      }
      if (interlace !== 0 && interlace !== 1) {
        this.error(new Error("Unsupported interlace method"));
        return;
      }
      this._colorType = colorType;
      let bpp = constants4.COLORTYPE_TO_BPP_MAP[this._colorType];
      this._hasIHDR = true;
      this.metadata({
        width,
        height,
        depth,
        interlace: Boolean(interlace),
        palette: Boolean(colorType & constants4.COLORTYPE_PALETTE),
        color: Boolean(colorType & constants4.COLORTYPE_COLOR),
        alpha: Boolean(colorType & constants4.COLORTYPE_ALPHA),
        bpp,
        colorType
      });
      this._handleChunkEnd();
    };
    Parser.prototype._handlePLTE = function(length) {
      this.read(length, this._parsePLTE.bind(this));
    };
    Parser.prototype._parsePLTE = function(data) {
      this._crc.write(data);
      let entries2 = Math.floor(data.length / 3);
      for (let i = 0; i < entries2; i++) {
        this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255]);
      }
      this.palette(this._palette);
      this._handleChunkEnd();
    };
    Parser.prototype._handleTRNS = function(length) {
      this.simpleTransparency();
      this.read(length, this._parseTRNS.bind(this));
    };
    Parser.prototype._parseTRNS = function(data) {
      this._crc.write(data);
      if (this._colorType === constants4.COLORTYPE_PALETTE_COLOR) {
        if (this._palette.length === 0) {
          this.error(new Error("Transparency chunk must be after palette"));
          return;
        }
        if (data.length > this._palette.length) {
          this.error(new Error("More transparent colors than palette size"));
          return;
        }
        for (let i = 0; i < data.length; i++) {
          this._palette[i][3] = data[i];
        }
        this.palette(this._palette);
      }
      if (this._colorType === constants4.COLORTYPE_GRAYSCALE) {
        this.transColor([data.readUInt16BE(0)]);
      }
      if (this._colorType === constants4.COLORTYPE_COLOR) {
        this.transColor([
          data.readUInt16BE(0),
          data.readUInt16BE(2),
          data.readUInt16BE(4)
        ]);
      }
      this._handleChunkEnd();
    };
    Parser.prototype._handleGAMA = function(length) {
      this.read(length, this._parseGAMA.bind(this));
    };
    Parser.prototype._parseGAMA = function(data) {
      this._crc.write(data);
      this.gamma(data.readUInt32BE(0) / constants4.GAMMA_DIVISION);
      this._handleChunkEnd();
    };
    Parser.prototype._handleIDAT = function(length) {
      if (!this._emittedHeadersFinished) {
        this._emittedHeadersFinished = true;
        this.headersFinished();
      }
      this.read(-length, this._parseIDAT.bind(this, length));
    };
    Parser.prototype._parseIDAT = function(length, data) {
      this._crc.write(data);
      if (this._colorType === constants4.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
        throw new Error("Expected palette not found");
      }
      this.inflateData(data);
      let leftOverLength = length - data.length;
      if (leftOverLength > 0) {
        this._handleIDAT(leftOverLength);
      } else {
        this._handleChunkEnd();
      }
    };
    Parser.prototype._handleIEND = function(length) {
      this.read(length, this._parseIEND.bind(this));
    };
    Parser.prototype._parseIEND = function(data) {
      this._crc.write(data);
      this._hasIEND = true;
      this._handleChunkEnd();
      if (this.finished) {
        this.finished();
      }
    };
  }
});

// node_modules/pngjs/lib/bitmapper.js
var require_bitmapper = __commonJS({
  "node_modules/pngjs/lib/bitmapper.js"(exports) {
    "use strict";
    var interlaceUtils = require_interlace();
    var pixelBppMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos === data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = 255;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 1 >= data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = data[rawPos + 1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 2 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = 255;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, data, pxPos, rawPos) {
        if (rawPos + 3 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = data[rawPos + 3];
      }
    ];
    var pixelBppCustomMapper = [
      // 0 - dummy entry
      function() {
      },
      // 1 - L
      // 0: 0, 1: 0, 2: 0, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = maxBit;
      },
      // 2 - LA
      // 0: 0, 1: 0, 2: 0, 3: 1
      function(pxData, pixelData, pxPos) {
        let pixel = pixelData[0];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = pixelData[1];
      },
      // 3 - RGB
      // 0: 0, 1: 1, 2: 2, 3: 0xff
      function(pxData, pixelData, pxPos, maxBit) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = maxBit;
      },
      // 4 - RGBA
      // 0: 0, 1: 1, 2: 2, 3: 3
      function(pxData, pixelData, pxPos) {
        pxData[pxPos] = pixelData[0];
        pxData[pxPos + 1] = pixelData[1];
        pxData[pxPos + 2] = pixelData[2];
        pxData[pxPos + 3] = pixelData[3];
      }
    ];
    function bitRetriever(data, depth) {
      let leftOver = [];
      let i = 0;
      function split() {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i];
        i++;
        let byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
        switch (depth) {
          default:
            throw new Error("unrecognised depth");
          case 16:
            byte2 = data[i];
            i++;
            leftOver.push((byte << 8) + byte2);
            break;
          case 4:
            byte2 = byte & 15;
            byte1 = byte >> 4;
            leftOver.push(byte1, byte2);
            break;
          case 2:
            byte4 = byte & 3;
            byte3 = byte >> 2 & 3;
            byte2 = byte >> 4 & 3;
            byte1 = byte >> 6 & 3;
            leftOver.push(byte1, byte2, byte3, byte4);
            break;
          case 1:
            byte8 = byte & 1;
            byte7 = byte >> 1 & 1;
            byte6 = byte >> 2 & 1;
            byte5 = byte >> 3 & 1;
            byte4 = byte >> 4 & 1;
            byte3 = byte >> 5 & 1;
            byte2 = byte >> 6 & 1;
            byte1 = byte >> 7 & 1;
            leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
            break;
        }
      }
      return {
        get: function(count) {
          while (leftOver.length < count) {
            split();
          }
          let returner = leftOver.slice(0, count);
          leftOver = leftOver.slice(count);
          return returner;
        },
        resetAfterLine: function() {
          leftOver.length = 0;
        },
        end: function() {
          if (i !== data.length) {
            throw new Error("extra data found");
          }
        }
      };
    }
    function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
          rawPos += bpp;
        }
      }
      return rawPos;
    }
    function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
      let imageWidth = image.width;
      let imageHeight = image.height;
      let imagePass = image.index;
      for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
          let pixelData = bits.get(bpp);
          let pxPos = getPxPos(x, y, imagePass);
          pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
        }
        bits.resetAfterLine();
      }
    }
    exports.dataToBitMap = function(data, bitmapInfo) {
      let width = bitmapInfo.width;
      let height = bitmapInfo.height;
      let depth = bitmapInfo.depth;
      let bpp = bitmapInfo.bpp;
      let interlace = bitmapInfo.interlace;
      let bits;
      if (depth !== 8) {
        bits = bitRetriever(data, depth);
      }
      let pxData;
      if (depth <= 8) {
        pxData = Buffer.alloc(width * height * 4);
      } else {
        pxData = new Uint16Array(width * height * 4);
      }
      let maxBit = Math.pow(2, depth) - 1;
      let rawPos = 0;
      let images;
      let getPxPos;
      if (interlace) {
        images = interlaceUtils.getImagePasses(width, height);
        getPxPos = interlaceUtils.getInterlaceIterator(width, height);
      } else {
        let nonInterlacedPxPos = 0;
        getPxPos = function() {
          let returner = nonInterlacedPxPos;
          nonInterlacedPxPos += 4;
          return returner;
        };
        images = [{ width, height }];
      }
      for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
        if (depth === 8) {
          rawPos = mapImage8Bit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            data,
            rawPos
          );
        } else {
          mapImageCustomBit(
            images[imageIndex],
            pxData,
            getPxPos,
            bpp,
            bits,
            maxBit
          );
        }
      }
      if (depth === 8) {
        if (rawPos !== data.length) {
          throw new Error("extra data found");
        }
      } else {
        bits.end();
      }
      return pxData;
    };
  }
});

// node_modules/pngjs/lib/format-normaliser.js
var require_format_normaliser = __commonJS({
  "node_modules/pngjs/lib/format-normaliser.js"(exports, module) {
    "use strict";
    function dePalette(indata, outdata, width, height, palette) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let color2 = palette[indata[pxPos]];
          if (!color2) {
            throw new Error("index " + indata[pxPos] + " not in palette");
          }
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = color2[i];
          }
          pxPos += 4;
        }
      }
    }
    function replaceTransparentColor(indata, outdata, width, height, transColor) {
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let makeTrans = false;
          if (transColor.length === 1) {
            if (transColor[0] === indata[pxPos]) {
              makeTrans = true;
            }
          } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
            makeTrans = true;
          }
          if (makeTrans) {
            for (let i = 0; i < 4; i++) {
              outdata[pxPos + i] = 0;
            }
          }
          pxPos += 4;
        }
      }
    }
    function scaleDepth(indata, outdata, width, height, depth) {
      let maxOutSample = 255;
      let maxInSample = Math.pow(2, depth) - 1;
      let pxPos = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (let i = 0; i < 4; i++) {
            outdata[pxPos + i] = Math.floor(
              indata[pxPos + i] * maxOutSample / maxInSample + 0.5
            );
          }
          pxPos += 4;
        }
      }
    }
    module.exports = function(indata, imageData, skipRescale = false) {
      let depth = imageData.depth;
      let width = imageData.width;
      let height = imageData.height;
      let colorType = imageData.colorType;
      let transColor = imageData.transColor;
      let palette = imageData.palette;
      let outdata = indata;
      if (colorType === 3) {
        dePalette(indata, outdata, width, height, palette);
      } else {
        if (transColor) {
          replaceTransparentColor(indata, outdata, width, height, transColor);
        }
        if (depth !== 8 && !skipRescale) {
          if (depth === 16) {
            outdata = Buffer.alloc(width * height * 4);
          }
          scaleDepth(indata, outdata, width, height, depth);
        }
      }
      return outdata;
    };
  }
});

// node_modules/pngjs/lib/parser-async.js
var require_parser_async = __commonJS({
  "node_modules/pngjs/lib/parser-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var zlib = __require("zlib");
    var ChunkStream = require_chunkstream();
    var FilterAsync = require_filter_parse_async();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    var ParserAsync = module.exports = function(options) {
      ChunkStream.call(this);
      this._parser = new Parser(options, {
        read: this.read.bind(this),
        error: this._handleError.bind(this),
        metadata: this._handleMetaData.bind(this),
        gamma: this.emit.bind(this, "gamma"),
        palette: this._handlePalette.bind(this),
        transColor: this._handleTransColor.bind(this),
        finished: this._finished.bind(this),
        inflateData: this._inflateData.bind(this),
        simpleTransparency: this._simpleTransparency.bind(this),
        headersFinished: this._headersFinished.bind(this)
      });
      this._options = options;
      this.writable = true;
      this._parser.start();
    };
    util.inherits(ParserAsync, ChunkStream);
    ParserAsync.prototype._handleError = function(err) {
      this.emit("error", err);
      this.writable = false;
      this.destroy();
      if (this._inflate && this._inflate.destroy) {
        this._inflate.destroy();
      }
      if (this._filter) {
        this._filter.destroy();
        this._filter.on("error", function() {
        });
      }
      this.errord = true;
    };
    ParserAsync.prototype._inflateData = function(data) {
      if (!this._inflate) {
        if (this._bitmapInfo.interlace) {
          this._inflate = zlib.createInflate();
          this._inflate.on("error", this.emit.bind(this, "error"));
          this._filter.on("complete", this._complete.bind(this));
          this._inflate.pipe(this._filter);
        } else {
          let rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
          let imageSize = rowSize * this._bitmapInfo.height;
          let chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
          this._inflate = zlib.createInflate({ chunkSize });
          let leftToInflate = imageSize;
          let emitError = this.emit.bind(this, "error");
          this._inflate.on("error", function(err) {
            if (!leftToInflate) {
              return;
            }
            emitError(err);
          });
          this._filter.on("complete", this._complete.bind(this));
          let filterWrite = this._filter.write.bind(this._filter);
          this._inflate.on("data", function(chunk) {
            if (!leftToInflate) {
              return;
            }
            if (chunk.length > leftToInflate) {
              chunk = chunk.slice(0, leftToInflate);
            }
            leftToInflate -= chunk.length;
            filterWrite(chunk);
          });
          this._inflate.on("end", this._filter.end.bind(this._filter));
        }
      }
      this._inflate.write(data);
    };
    ParserAsync.prototype._handleMetaData = function(metaData) {
      this._metaData = metaData;
      this._bitmapInfo = Object.create(metaData);
      this._filter = new FilterAsync(this._bitmapInfo);
    };
    ParserAsync.prototype._handleTransColor = function(transColor) {
      this._bitmapInfo.transColor = transColor;
    };
    ParserAsync.prototype._handlePalette = function(palette) {
      this._bitmapInfo.palette = palette;
    };
    ParserAsync.prototype._simpleTransparency = function() {
      this._metaData.alpha = true;
    };
    ParserAsync.prototype._headersFinished = function() {
      this.emit("metadata", this._metaData);
    };
    ParserAsync.prototype._finished = function() {
      if (this.errord) {
        return;
      }
      if (!this._inflate) {
        this.emit("error", "No Inflate block");
      } else {
        this._inflate.end();
      }
    };
    ParserAsync.prototype._complete = function(filteredData) {
      if (this.errord) {
        return;
      }
      let normalisedBitmapData;
      try {
        let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
        normalisedBitmapData = formatNormaliser(
          bitmapData,
          this._bitmapInfo,
          this._options.skipRescale
        );
        bitmapData = null;
      } catch (ex) {
        this._handleError(ex);
        return;
      }
      this.emit("parsed", normalisedBitmapData);
    };
  }
});

// node_modules/pngjs/lib/bitpacker.js
var require_bitpacker = __commonJS({
  "node_modules/pngjs/lib/bitpacker.js"(exports, module) {
    "use strict";
    var constants4 = require_constants();
    module.exports = function(dataIn, width, height, options) {
      let outHasAlpha = [constants4.COLORTYPE_COLOR_ALPHA, constants4.COLORTYPE_ALPHA].indexOf(
        options.colorType
      ) !== -1;
      if (options.colorType === options.inputColorType) {
        let bigEndian = (function() {
          let buffer = new ArrayBuffer(2);
          new DataView(buffer).setInt16(
            0,
            256,
            true
            /* littleEndian */
          );
          return new Int16Array(buffer)[0] !== 256;
        })();
        if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
          return dataIn;
        }
      }
      let data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
      let maxValue = 255;
      let inBpp = constants4.COLORTYPE_TO_BPP_MAP[options.inputColorType];
      if (inBpp === 4 && !options.inputHasAlpha) {
        inBpp = 3;
      }
      let outBpp = constants4.COLORTYPE_TO_BPP_MAP[options.colorType];
      if (options.bitDepth === 16) {
        maxValue = 65535;
        outBpp *= 2;
      }
      let outData = Buffer.alloc(width * height * outBpp);
      let inIndex = 0;
      let outIndex = 0;
      let bgColor = options.bgColor || {};
      if (bgColor.red === void 0) {
        bgColor.red = maxValue;
      }
      if (bgColor.green === void 0) {
        bgColor.green = maxValue;
      }
      if (bgColor.blue === void 0) {
        bgColor.blue = maxValue;
      }
      function getRGBA() {
        let red;
        let green;
        let blue;
        let alpha = maxValue;
        switch (options.inputColorType) {
          case constants4.COLORTYPE_COLOR_ALPHA:
            alpha = data[inIndex + 3];
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants4.COLORTYPE_COLOR:
            red = data[inIndex];
            green = data[inIndex + 1];
            blue = data[inIndex + 2];
            break;
          case constants4.COLORTYPE_ALPHA:
            alpha = data[inIndex + 1];
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          case constants4.COLORTYPE_GRAYSCALE:
            red = data[inIndex];
            green = red;
            blue = red;
            break;
          default:
            throw new Error(
              "input color type:" + options.inputColorType + " is not supported at present"
            );
        }
        if (options.inputHasAlpha) {
          if (!outHasAlpha) {
            alpha /= maxValue;
            red = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0),
              maxValue
            );
            green = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0),
              maxValue
            );
            blue = Math.min(
              Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0),
              maxValue
            );
          }
        }
        return { red, green, blue, alpha };
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let rgba = getRGBA(data, inIndex);
          switch (options.colorType) {
            case constants4.COLORTYPE_COLOR_ALPHA:
            case constants4.COLORTYPE_COLOR:
              if (options.bitDepth === 8) {
                outData[outIndex] = rgba.red;
                outData[outIndex + 1] = rgba.green;
                outData[outIndex + 2] = rgba.blue;
                if (outHasAlpha) {
                  outData[outIndex + 3] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(rgba.red, outIndex);
                outData.writeUInt16BE(rgba.green, outIndex + 2);
                outData.writeUInt16BE(rgba.blue, outIndex + 4);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                }
              }
              break;
            case constants4.COLORTYPE_ALPHA:
            case constants4.COLORTYPE_GRAYSCALE: {
              let grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
              if (options.bitDepth === 8) {
                outData[outIndex] = grayscale;
                if (outHasAlpha) {
                  outData[outIndex + 1] = rgba.alpha;
                }
              } else {
                outData.writeUInt16BE(grayscale, outIndex);
                if (outHasAlpha) {
                  outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                }
              }
              break;
            }
            default:
              throw new Error("unrecognised color Type " + options.colorType);
          }
          inIndex += inBpp;
          outIndex += outBpp;
        }
      }
      return outData;
    };
  }
});

// node_modules/pngjs/lib/filter-pack.js
var require_filter_pack = __commonJS({
  "node_modules/pngjs/lib/filter-pack.js"(exports, module) {
    "use strict";
    var paethPredictor = require_paeth_predictor();
    function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        rawData[rawPos + x] = pxData[pxPos + x];
      }
    }
    function filterSumNone(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let i = pxPos; i < length; i++) {
        sum += Math.abs(pxData[i]);
      }
      return sum;
    }
    function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumSub(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let val = pxData[pxPos + x] - left;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
      for (let x = 0; x < byteWidth; x++) {
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - up;
        rawData[rawPos + x] = val;
      }
    }
    function filterSumUp(pxData, pxPos, byteWidth) {
      let sum = 0;
      let length = pxPos + byteWidth;
      for (let x = pxPos; x < length; x++) {
        let up = pxPos > 0 ? pxData[x - byteWidth] : 0;
        let val = pxData[x] - up;
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let val = pxData[pxPos + x] - (left + up >> 1);
        sum += Math.abs(val);
      }
      return sum;
    }
    function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        rawData[rawPos + x] = val;
      }
    }
    function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) {
        let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
        let up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
        let upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
        let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
        sum += Math.abs(val);
      }
      return sum;
    }
    var filters = {
      0: filterNone,
      1: filterSub,
      2: filterUp,
      3: filterAvg,
      4: filterPaeth
    };
    var filterSums = {
      0: filterSumNone,
      1: filterSumSub,
      2: filterSumUp,
      3: filterSumAvg,
      4: filterSumPaeth
    };
    module.exports = function(pxData, width, height, options, bpp) {
      let filterTypes;
      if (!("filterType" in options) || options.filterType === -1) {
        filterTypes = [0, 1, 2, 3, 4];
      } else if (typeof options.filterType === "number") {
        filterTypes = [options.filterType];
      } else {
        throw new Error("unrecognised filter types");
      }
      if (options.bitDepth === 16) {
        bpp *= 2;
      }
      let byteWidth = width * bpp;
      let rawPos = 0;
      let pxPos = 0;
      let rawData = Buffer.alloc((byteWidth + 1) * height);
      let sel = filterTypes[0];
      for (let y = 0; y < height; y++) {
        if (filterTypes.length > 1) {
          let min = Infinity;
          for (let i = 0; i < filterTypes.length; i++) {
            let sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
            if (sum < min) {
              sel = filterTypes[i];
              min = sum;
            }
          }
        }
        rawData[rawPos] = sel;
        rawPos++;
        filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
        rawPos += byteWidth;
        pxPos += byteWidth;
      }
      return rawData;
    };
  }
});

// node_modules/pngjs/lib/packer.js
var require_packer = __commonJS({
  "node_modules/pngjs/lib/packer.js"(exports, module) {
    "use strict";
    var constants4 = require_constants();
    var CrcStream = require_crc();
    var bitPacker = require_bitpacker();
    var filter = require_filter_pack();
    var zlib = __require("zlib");
    var Packer = module.exports = function(options) {
      this._options = options;
      options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
      options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
      options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
      options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
      options.deflateFactory = options.deflateFactory || zlib.createDeflate;
      options.bitDepth = options.bitDepth || 8;
      options.colorType = typeof options.colorType === "number" ? options.colorType : constants4.COLORTYPE_COLOR_ALPHA;
      options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants4.COLORTYPE_COLOR_ALPHA;
      if ([
        constants4.COLORTYPE_GRAYSCALE,
        constants4.COLORTYPE_COLOR,
        constants4.COLORTYPE_COLOR_ALPHA,
        constants4.COLORTYPE_ALPHA
      ].indexOf(options.colorType) === -1) {
        throw new Error(
          "option color type:" + options.colorType + " is not supported at present"
        );
      }
      if ([
        constants4.COLORTYPE_GRAYSCALE,
        constants4.COLORTYPE_COLOR,
        constants4.COLORTYPE_COLOR_ALPHA,
        constants4.COLORTYPE_ALPHA
      ].indexOf(options.inputColorType) === -1) {
        throw new Error(
          "option input color type:" + options.inputColorType + " is not supported at present"
        );
      }
      if (options.bitDepth !== 8 && options.bitDepth !== 16) {
        throw new Error(
          "option bit depth:" + options.bitDepth + " is not supported at present"
        );
      }
    };
    Packer.prototype.getDeflateOptions = function() {
      return {
        chunkSize: this._options.deflateChunkSize,
        level: this._options.deflateLevel,
        strategy: this._options.deflateStrategy
      };
    };
    Packer.prototype.createDeflate = function() {
      return this._options.deflateFactory(this.getDeflateOptions());
    };
    Packer.prototype.filterData = function(data, width, height) {
      let packedData = bitPacker(data, width, height, this._options);
      let bpp = constants4.COLORTYPE_TO_BPP_MAP[this._options.colorType];
      let filteredData = filter(packedData, width, height, this._options, bpp);
      return filteredData;
    };
    Packer.prototype._packChunk = function(type, data) {
      let len = data ? data.length : 0;
      let buf = Buffer.alloc(len + 12);
      buf.writeUInt32BE(len, 0);
      buf.writeUInt32BE(type, 4);
      if (data) {
        data.copy(buf, 8);
      }
      buf.writeInt32BE(
        CrcStream.crc32(buf.slice(4, buf.length - 4)),
        buf.length - 4
      );
      return buf;
    };
    Packer.prototype.packGAMA = function(gamma) {
      let buf = Buffer.alloc(4);
      buf.writeUInt32BE(Math.floor(gamma * constants4.GAMMA_DIVISION), 0);
      return this._packChunk(constants4.TYPE_gAMA, buf);
    };
    Packer.prototype.packIHDR = function(width, height) {
      let buf = Buffer.alloc(13);
      buf.writeUInt32BE(width, 0);
      buf.writeUInt32BE(height, 4);
      buf[8] = this._options.bitDepth;
      buf[9] = this._options.colorType;
      buf[10] = 0;
      buf[11] = 0;
      buf[12] = 0;
      return this._packChunk(constants4.TYPE_IHDR, buf);
    };
    Packer.prototype.packIDAT = function(data) {
      return this._packChunk(constants4.TYPE_IDAT, data);
    };
    Packer.prototype.packIEND = function() {
      return this._packChunk(constants4.TYPE_IEND, null);
    };
  }
});

// node_modules/pngjs/lib/packer-async.js
var require_packer_async = __commonJS({
  "node_modules/pngjs/lib/packer-async.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var constants4 = require_constants();
    var Packer = require_packer();
    var PackerAsync = module.exports = function(opt) {
      Stream.call(this);
      let options = opt || {};
      this._packer = new Packer(options);
      this._deflate = this._packer.createDeflate();
      this.readable = true;
    };
    util.inherits(PackerAsync, Stream);
    PackerAsync.prototype.pack = function(data, width, height, gamma) {
      this.emit("data", Buffer.from(constants4.PNG_SIGNATURE));
      this.emit("data", this._packer.packIHDR(width, height));
      if (gamma) {
        this.emit("data", this._packer.packGAMA(gamma));
      }
      let filteredData = this._packer.filterData(data, width, height);
      this._deflate.on("error", this.emit.bind(this, "error"));
      this._deflate.on(
        "data",
        function(compressedData) {
          this.emit("data", this._packer.packIDAT(compressedData));
        }.bind(this)
      );
      this._deflate.on(
        "end",
        function() {
          this.emit("data", this._packer.packIEND());
          this.emit("end");
        }.bind(this)
      );
      this._deflate.end(filteredData);
    };
  }
});

// node_modules/pngjs/lib/sync-inflate.js
var require_sync_inflate = __commonJS({
  "node_modules/pngjs/lib/sync-inflate.js"(exports, module) {
    "use strict";
    var assert = __require("assert").ok;
    var zlib = __require("zlib");
    var util = __require("util");
    var kMaxLength = __require("buffer").kMaxLength;
    function Inflate(opts) {
      if (!(this instanceof Inflate)) {
        return new Inflate(opts);
      }
      if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
        opts.chunkSize = zlib.Z_MIN_CHUNK;
      }
      zlib.Inflate.call(this, opts);
      this._offset = this._offset === void 0 ? this._outOffset : this._offset;
      this._buffer = this._buffer || this._outBuffer;
      if (opts && opts.maxLength != null) {
        this._maxLength = opts.maxLength;
      }
    }
    function createInflate(opts) {
      return new Inflate(opts);
    }
    function _close(engine, callback) {
      if (callback) {
        process.nextTick(callback);
      }
      if (!engine._handle) {
        return;
      }
      engine._handle.close();
      engine._handle = null;
    }
    Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
      if (typeof asyncCb === "function") {
        return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
      }
      let self = this;
      let availInBefore = chunk && chunk.length;
      let availOutBefore = this._chunkSize - this._offset;
      let leftToInflate = this._maxLength;
      let inOff = 0;
      let buffers = [];
      let nread = 0;
      let error;
      this.on("error", function(err) {
        error = err;
      });
      function handleChunk(availInAfter, availOutAfter) {
        if (self._hadError) {
          return;
        }
        let have = availOutBefore - availOutAfter;
        assert(have >= 0, "have should not go down");
        if (have > 0) {
          let out = self._buffer.slice(self._offset, self._offset + have);
          self._offset += have;
          if (out.length > leftToInflate) {
            out = out.slice(0, leftToInflate);
          }
          buffers.push(out);
          nread += out.length;
          leftToInflate -= out.length;
          if (leftToInflate === 0) {
            return false;
          }
        }
        if (availOutAfter === 0 || self._offset >= self._chunkSize) {
          availOutBefore = self._chunkSize;
          self._offset = 0;
          self._buffer = Buffer.allocUnsafe(self._chunkSize);
        }
        if (availOutAfter === 0) {
          inOff += availInBefore - availInAfter;
          availInBefore = availInAfter;
          return true;
        }
        return false;
      }
      assert(this._handle, "zlib binding closed");
      let res;
      do {
        res = this._handle.writeSync(
          flushFlag,
          chunk,
          // in
          inOff,
          // in_off
          availInBefore,
          // in_len
          this._buffer,
          // out
          this._offset,
          //out_off
          availOutBefore
        );
        res = res || this._writeState;
      } while (!this._hadError && handleChunk(res[0], res[1]));
      if (this._hadError) {
        throw error;
      }
      if (nread >= kMaxLength) {
        _close(this);
        throw new RangeError(
          "Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes"
        );
      }
      let buf = Buffer.concat(buffers, nread);
      _close(this);
      return buf;
    };
    util.inherits(Inflate, zlib.Inflate);
    function zlibBufferSync(engine, buffer) {
      if (typeof buffer === "string") {
        buffer = Buffer.from(buffer);
      }
      if (!(buffer instanceof Buffer)) {
        throw new TypeError("Not a string or buffer");
      }
      let flushFlag = engine._finishFlushFlag;
      if (flushFlag == null) {
        flushFlag = zlib.Z_FINISH;
      }
      return engine._processChunk(buffer, flushFlag);
    }
    function inflateSync(buffer, opts) {
      return zlibBufferSync(new Inflate(opts), buffer);
    }
    module.exports = exports = inflateSync;
    exports.Inflate = Inflate;
    exports.createInflate = createInflate;
    exports.inflateSync = inflateSync;
  }
});

// node_modules/pngjs/lib/sync-reader.js
var require_sync_reader = __commonJS({
  "node_modules/pngjs/lib/sync-reader.js"(exports, module) {
    "use strict";
    var SyncReader = module.exports = function(buffer) {
      this._buffer = buffer;
      this._reads = [];
    };
    SyncReader.prototype.read = function(length, callback) {
      this._reads.push({
        length: Math.abs(length),
        // if length < 0 then at most this length
        allowLess: length < 0,
        func: callback
      });
    };
    SyncReader.prototype.process = function() {
      while (this._reads.length > 0 && this._buffer.length) {
        let read = this._reads[0];
        if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
          this._reads.shift();
          let buf = this._buffer;
          this._buffer = buf.slice(read.length);
          read.func.call(this, buf.slice(0, read.length));
        } else {
          break;
        }
      }
      if (this._reads.length > 0) {
        throw new Error("There are some read requests waitng on finished stream");
      }
      if (this._buffer.length > 0) {
        throw new Error("unrecognised content at end of stream");
      }
    };
  }
});

// node_modules/pngjs/lib/filter-parse-sync.js
var require_filter_parse_sync = __commonJS({
  "node_modules/pngjs/lib/filter-parse-sync.js"(exports) {
    "use strict";
    var SyncReader = require_sync_reader();
    var Filter = require_filter_parse();
    exports.process = function(inBuffer, bitmapInfo) {
      let outBuffers = [];
      let reader = new SyncReader(inBuffer);
      let filter = new Filter(bitmapInfo, {
        read: reader.read.bind(reader),
        write: function(bufferPart) {
          outBuffers.push(bufferPart);
        },
        complete: function() {
        }
      });
      filter.start();
      reader.process();
      return Buffer.concat(outBuffers);
    };
  }
});

// node_modules/pngjs/lib/parser-sync.js
var require_parser_sync = __commonJS({
  "node_modules/pngjs/lib/parser-sync.js"(exports, module) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = __require("zlib");
    var inflateSync = require_sync_inflate();
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var SyncReader = require_sync_reader();
    var FilterSync = require_filter_parse_sync();
    var Parser = require_parser();
    var bitmapper = require_bitmapper();
    var formatNormaliser = require_format_normaliser();
    module.exports = function(buffer, options) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let err;
      function handleError(_err_) {
        err = _err_;
      }
      let metaData;
      function handleMetaData(_metaData_) {
        metaData = _metaData_;
      }
      function handleTransColor(transColor) {
        metaData.transColor = transColor;
      }
      function handlePalette(palette) {
        metaData.palette = palette;
      }
      function handleSimpleTransparency() {
        metaData.alpha = true;
      }
      let gamma;
      function handleGamma(_gamma_) {
        gamma = _gamma_;
      }
      let inflateDataList = [];
      function handleInflateData(inflatedData2) {
        inflateDataList.push(inflatedData2);
      }
      let reader = new SyncReader(buffer);
      let parser = new Parser(options, {
        read: reader.read.bind(reader),
        error: handleError,
        metadata: handleMetaData,
        gamma: handleGamma,
        palette: handlePalette,
        transColor: handleTransColor,
        inflateData: handleInflateData,
        simpleTransparency: handleSimpleTransparency
      });
      parser.start();
      reader.process();
      if (err) {
        throw err;
      }
      let inflateData = Buffer.concat(inflateDataList);
      inflateDataList.length = 0;
      let inflatedData;
      if (metaData.interlace) {
        inflatedData = zlib.inflateSync(inflateData);
      } else {
        let rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
        let imageSize = rowSize * metaData.height;
        inflatedData = inflateSync(inflateData, {
          chunkSize: imageSize,
          maxLength: imageSize
        });
      }
      inflateData = null;
      if (!inflatedData || !inflatedData.length) {
        throw new Error("bad png - invalid inflate data response");
      }
      let unfilteredData = FilterSync.process(inflatedData, metaData);
      inflateData = null;
      let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
      unfilteredData = null;
      let normalisedBitmapData = formatNormaliser(
        bitmapData,
        metaData,
        options.skipRescale
      );
      metaData.data = normalisedBitmapData;
      metaData.gamma = gamma || 0;
      return metaData;
    };
  }
});

// node_modules/pngjs/lib/packer-sync.js
var require_packer_sync = __commonJS({
  "node_modules/pngjs/lib/packer-sync.js"(exports, module) {
    "use strict";
    var hasSyncZlib = true;
    var zlib = __require("zlib");
    if (!zlib.deflateSync) {
      hasSyncZlib = false;
    }
    var constants4 = require_constants();
    var Packer = require_packer();
    module.exports = function(metaData, opt) {
      if (!hasSyncZlib) {
        throw new Error(
          "To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0"
        );
      }
      let options = opt || {};
      let packer = new Packer(options);
      let chunks = [];
      chunks.push(Buffer.from(constants4.PNG_SIGNATURE));
      chunks.push(packer.packIHDR(metaData.width, metaData.height));
      if (metaData.gamma) {
        chunks.push(packer.packGAMA(metaData.gamma));
      }
      let filteredData = packer.filterData(
        metaData.data,
        metaData.width,
        metaData.height
      );
      let compressedData = zlib.deflateSync(
        filteredData,
        packer.getDeflateOptions()
      );
      filteredData = null;
      if (!compressedData || !compressedData.length) {
        throw new Error("bad png - invalid compressed data response");
      }
      chunks.push(packer.packIDAT(compressedData));
      chunks.push(packer.packIEND());
      return Buffer.concat(chunks);
    };
  }
});

// node_modules/pngjs/lib/png-sync.js
var require_png_sync = __commonJS({
  "node_modules/pngjs/lib/png-sync.js"(exports) {
    "use strict";
    var parse2 = require_parser_sync();
    var pack = require_packer_sync();
    exports.read = function(buffer, options) {
      return parse2(buffer, options || {});
    };
    exports.write = function(png, options) {
      return pack(png, options);
    };
  }
});

// node_modules/pngjs/lib/png.js
var require_png = __commonJS({
  "node_modules/pngjs/lib/png.js"(exports) {
    "use strict";
    var util = __require("util");
    var Stream = __require("stream");
    var Parser = require_parser_async();
    var Packer = require_packer_async();
    var PNGSync = require_png_sync();
    var PNG3 = exports.PNG = function(options) {
      Stream.call(this);
      options = options || {};
      this.width = options.width | 0;
      this.height = options.height | 0;
      this.data = this.width > 0 && this.height > 0 ? Buffer.alloc(4 * this.width * this.height) : null;
      if (options.fill && this.data) {
        this.data.fill(0);
      }
      this.gamma = 0;
      this.readable = this.writable = true;
      this._parser = new Parser(options);
      this._parser.on("error", this.emit.bind(this, "error"));
      this._parser.on("close", this._handleClose.bind(this));
      this._parser.on("metadata", this._metadata.bind(this));
      this._parser.on("gamma", this._gamma.bind(this));
      this._parser.on(
        "parsed",
        function(data) {
          this.data = data;
          this.emit("parsed", data);
        }.bind(this)
      );
      this._packer = new Packer(options);
      this._packer.on("data", this.emit.bind(this, "data"));
      this._packer.on("end", this.emit.bind(this, "end"));
      this._parser.on("close", this._handleClose.bind(this));
      this._packer.on("error", this.emit.bind(this, "error"));
    };
    util.inherits(PNG3, Stream);
    PNG3.sync = PNGSync;
    PNG3.prototype.pack = function() {
      if (!this.data || !this.data.length) {
        this.emit("error", "No data provided");
        return this;
      }
      process.nextTick(
        function() {
          this._packer.pack(this.data, this.width, this.height, this.gamma);
        }.bind(this)
      );
      return this;
    };
    PNG3.prototype.parse = function(data, callback) {
      if (callback) {
        let onParsed, onError;
        onParsed = function(parsedData) {
          this.removeListener("error", onError);
          this.data = parsedData;
          callback(null, this);
        }.bind(this);
        onError = function(err) {
          this.removeListener("parsed", onParsed);
          callback(err, null);
        }.bind(this);
        this.once("parsed", onParsed);
        this.once("error", onError);
      }
      this.end(data);
      return this;
    };
    PNG3.prototype.write = function(data) {
      this._parser.write(data);
      return true;
    };
    PNG3.prototype.end = function(data) {
      this._parser.end(data);
    };
    PNG3.prototype._metadata = function(metadata) {
      this.width = metadata.width;
      this.height = metadata.height;
      this.emit("metadata", metadata);
    };
    PNG3.prototype._gamma = function(gamma) {
      this.gamma = gamma;
    };
    PNG3.prototype._handleClose = function() {
      if (!this._parser.writable && !this._packer.readable) {
        this.emit("close");
      }
    };
    PNG3.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
      srcX |= 0;
      srcY |= 0;
      width |= 0;
      height |= 0;
      deltaX |= 0;
      deltaY |= 0;
      if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
        throw new Error("bitblt reading outside image");
      }
      if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
        throw new Error("bitblt writing outside image");
      }
      for (let y = 0; y < height; y++) {
        src.data.copy(
          dst.data,
          (deltaY + y) * dst.width + deltaX << 2,
          (srcY + y) * src.width + srcX << 2,
          (srcY + y) * src.width + srcX + width << 2
        );
      }
    };
    PNG3.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
      PNG3.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
      return this;
    };
    PNG3.adjustGamma = function(src) {
      if (src.gamma) {
        for (let y = 0; y < src.height; y++) {
          for (let x = 0; x < src.width; x++) {
            let idx = src.width * y + x << 2;
            for (let i = 0; i < 3; i++) {
              let sample = src.data[idx + i] / 255;
              sample = Math.pow(sample, 1 / 2.2 / src.gamma);
              src.data[idx + i] = Math.round(sample * 255);
            }
          }
        }
        src.gamma = 0;
      }
    };
    PNG3.prototype.adjustGamma = function() {
      PNG3.adjustGamma(this);
    };
  }
});

// node_modules/ws/lib/constants.js
var require_constants2 = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants2();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (false) {
      try {
        const bufferUtil = null;
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants2();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants2();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (false) {
      try {
        const isValidUTF8 = null;
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants2();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var {
      types: { isUint8Array }
    } = __require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants2();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants2();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse2(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse: parse2 };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http = __require("http");
    var net = __require("net");
    var tls = __require("tls");
    var { randomBytes: randomBytes3, createHash: createHash5 } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL: URL2 } = __require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants2();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse: parse2 } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            if (!options || options.protocols === void 0) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              if (options.protocols === void 0) {
                protocols = [];
              } else if (Array.isArray(options.protocols)) {
                protocols = options.protocols;
              } else {
                protocols = [options.protocols];
              }
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        this._readyState = _WebSocket.CLOSING;
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        protocols: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes3(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash5("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse2(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason2) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason2;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason2);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse2(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse: parse2 };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http = __require("http");
    var { Duplex } = __require("stream");
    var { createHash: createHash5 } = __require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants2();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash5("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/canvas/extension.ts
import * as sdk from "@github/copilot-sdk/extension";
import { fileURLToPath } from "node:url";

// src/canvas/provider.ts
import { realpathSync as realpathSync6, statSync as statSync4 } from "node:fs";
import { isAbsolute as isAbsolute8 } from "node:path";

// src/canvas/officeHost.ts
import { lstat as lstat2, realpath, stat } from "node:fs/promises";
import { isAbsolute as isAbsolute5, join as join11 } from "node:path";

// src/observer.ts
import * as path8 from "node:path";
import { createHash as createHash2 } from "node:crypto";

// ../src/teamSource.ts
import * as path2 from "node:path";

// ../src/projectFiles.ts
import * as fs from "node:fs";
import * as path from "node:path";
var ProjectFileError = class extends Error {
};
function projectFileDiagnostic(error) {
  if (error instanceof ProjectFileError) {
    return error.message;
  }
  const code = error?.code;
  if (code === "ERR_ENCODING_INVALID_ENCODED_DATA") {
    return "Source is not valid UTF-8.";
  }
  return typeof code === "string" && /^E[A-Z0-9_]{1,63}$/.test(code) ? `Filesystem inspection/read failed (${code}).` : "Unexpected filesystem inspection/read failure.";
}
var ProjectFiles = class {
  root;
  rootIdentity;
  selectedRoot;
  /** Capture the selected root; callers must validate authority before construction. */
  constructor(selectedRoot) {
    if (!path.isAbsolute(selectedRoot)) throw new ProjectFileError("Provide an explicit absolute project path.");
    this.selectedRoot = selectedRoot;
    this.root = fs.realpathSync(selectedRoot);
    this.rootIdentity = fs.statSync(this.root, { bigint: true });
    if (!this.rootIdentity.isDirectory()) throw new ProjectFileError("Project path must be a directory.");
  }
  /**
   * Inspect without following internal links, retaining identities even on refusal.
   * Fingerprints include root identity and each traversed component's identity,
   * type, size and timestamps. Native failures are retried, never cached as success.
   */
  inspect(relative6) {
    const stamps = [];
    let rootValidated = false;
    try {
      const root = fs.statSync(this.root, { bigint: true });
      stamps.push(`${root.dev}:${root.ino}:${root.mode}`);
      if (fs.realpathSync(this.selectedRoot) !== this.root || !sameFile(this.rootIdentity, root)) {
        throw new ProjectFileError("Selected project root changed.");
      }
      rootValidated = true;
      const target = path.resolve(this.root, relative6);
      const rel = path.relative(this.root, target);
      if (rel.split(path.sep).includes("..") || path.isAbsolute(rel)) {
        throw new ProjectFileError("Project path escapes selected root.");
      }
      let current = this.root;
      let stat2 = root;
      for (const part of rel.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        stat2 = fs.lstatSync(current, { bigint: true });
        if (process.platform === "win32" && stat2.isFile()) {
          const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
          try {
            const opened = fs.fstatSync(fd, { bigint: true });
            if (!sameFile(stat2, opened) || !opened.isFile() || stat2.size !== opened.size || stat2.mtimeNs !== opened.mtimeNs) {
              throw new ProjectFileError("Source changed while inspecting.");
            }
            stat2 = opened;
          } finally {
            fs.closeSync(fd);
          }
        }
        stamps.push(`${stat2.dev}:${stat2.ino}:${stat2.mode}:${stat2.size}:${stat2.mtimeNs}:${stat2.ctimeNs}`);
        if (stat2.isSymbolicLink()) {
          throw new ProjectFileError("Project symlinks/junctions are not observed.");
        }
      }
      if (this.resolve(relative6) !== target) {
        throw new ProjectFileError("Project source changed.");
      }
      return {
        status: "present",
        fingerprint: stamps.join("|"),
        size: stat2.size,
        kind: stat2.isDirectory() ? "directory" : stat2.isFile() ? "file" : "other"
      };
    } catch (error) {
      const missing = rootValidated && error?.code === "ENOENT";
      const reason2 = missing ? "Source is missing." : projectFileDiagnostic(error);
      return {
        status: missing ? "missing" : "unreadable",
        reason: reason2,
        fingerprint: `${stamps.join("|")}|${missing ? "missing" : reason2}`,
        retry: !missing && !(error instanceof ProjectFileError)
      };
    }
  }
  /** Resolve only within the still-identical root, refusing internal links/junctions. */
  resolve(relative6) {
    if (fs.realpathSync(this.selectedRoot) !== this.root || !sameFile(this.rootIdentity, fs.statSync(this.root, { bigint: true }))) {
      throw new ProjectFileError("Selected project root changed.");
    }
    const target = path.resolve(this.root, relative6);
    const parts = path.relative(this.root, target).split(path.sep);
    if (parts.includes("..") || path.isAbsolute(path.relative(this.root, target))) {
      throw new ProjectFileError("Project path escapes selected root.");
    }
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new ProjectFileError("Project symlinks/junctions are not observed.");
    }
    if (fs.realpathSync(target) !== target) throw new ProjectFileError("Project source changed or escaped selected root.");
    return target;
  }
  /**
   * Read bounded strict UTF-8; missing returns null, unsafe/changed sources throw.
   * Raw-content consumers can preserve the BOM; other consumers keep decoder defaults.
   */
  read(relative6, limit, options = {}) {
    const buffer = this.readBytes(relative6, limit, false);
    return buffer === null ? null : new TextDecoder("utf-8", { fatal: true, ignoreBOM: options.preserveBOM }).decode(buffer);
  }
  /**
   * Revalidate current read access through the same bounded object guards as read().
   * Attempt a one-byte read even at EOF; missing returns false, refusals throw.
   * This establishes readability, not content equality or UTF-8 validity.
   */
  probe(relative6, limit) {
    return this.readBytes(relative6, limit, true) !== null;
  }
  readBytes(relative6, limit, probe) {
    let fd;
    try {
      const target = this.resolve(relative6);
      const before = fs.lstatSync(target, { bigint: true });
      if (!before.isFile() || before.size > BigInt(limit)) throw new ProjectFileError(`Source is not a regular file within ${limit} bytes.`);
      fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!sameFile(before, opened) || !opened.isFile() || opened.size > BigInt(limit)) {
        throw new ProjectFileError("Source changed while opening.");
      }
      const buffer = Buffer.alloc(probe ? 1 : limit + 1);
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const after = fs.fstatSync(fd, { bigint: true });
      const expected = probe && opened.size > 0n ? 1n : opened.size;
      if (size > limit || expected !== BigInt(size) || after.size !== opened.size || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs || this.resolve(relative6) !== target || !sameFile(fs.lstatSync(target, { bigint: true }), opened)) {
        throw new ProjectFileError("Source changed while reading; retry on next poll.");
      }
      return buffer.subarray(0, size);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    } finally {
      if (fd !== void 0) fs.closeSync(fd);
    }
  }
  /** Enumerate at most 256 entries under a guarded project directory. */
  entries(relative6) {
    try {
      const dir = fs.opendirSync(this.resolve(relative6));
      const names = [];
      let entries2 = 0;
      try {
        let entry;
        while (entry = dir.readSync()) {
          if (++entries2 > 256) throw new Error("Activity directory exceeds 256 entries; observation paused for this source.");
          if (entry.isFile()) names.push(entry.name);
        }
      } finally {
        dir.closeSync();
      }
      return names.sort();
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
};
function sameFile(before, after) {
  return before.ino === after.ino && (before.dev === after.dev || process.platform === "win32" && before.dev === 0n);
}

// ../src/squadPaths.ts
var SQUAD_DIR_NAMES = [".squad", ".ai-team"];

// ../src/teamSource.ts
var MAX_TEAM_SOURCE_BYTES = 256 * 1024;
function selectTeamSourceDirectory(files) {
  const probe = inspectTeamSource(files, true);
  if (probe.source?.status === "unreadable") {
    throw new Error(probe.source.reason);
  }
  return probe.directory;
}
function inspectTeamSource(files, directoryOnly = false) {
  let directory = SQUAD_DIR_NAMES[0];
  const fingerprints = [];
  let retry = false;
  const inspect = (relative6) => {
    const result = files.inspect(relative6);
    fingerprints.push(result.fingerprint);
    if (result.status !== "present") {
      retry ||= result.retry;
    }
    return result;
  };
  const unavailable2 = (status, reason2) => ({
    directory,
    fingerprint: fingerprints.join("||"),
    retry,
    source: {
      status,
      directory,
      byteLength: 0,
      reason: status === "missing" ? "No selected-project team.md found." : reason2
    }
  });
  let dir = inspect(directory);
  if (dir.status === "missing") {
    directory = SQUAD_DIR_NAMES[1];
    dir = inspect(directory);
  }
  if (dir.status !== "present") {
    return unavailable2(dir.status, dir.reason);
  }
  if (dir.kind !== "directory") {
    return unavailable2("unreadable", "Selected roster path is not a directory.");
  }
  if (directoryOnly) {
    return { directory, fingerprint: fingerprints.join("||"), retry };
  }
  const file = inspect(path2.join(directory, "team.md"));
  if (file.status !== "present") {
    return unavailable2(file.status, file.reason);
  }
  if (file.kind !== "file" || file.size > BigInt(MAX_TEAM_SOURCE_BYTES)) {
    return unavailable2("unreadable", `Source is not a regular file within ${MAX_TEAM_SOURCE_BYTES} bytes.`);
  }
  return { directory, fingerprint: fingerprints.join("||"), retry };
}
function readProbedTeamSource(files, probe) {
  const { directory } = probe;
  if (probe.source) {
    return { source: probe.source, retry: probe.retry };
  }
  const unavailable2 = (reason2) => ({ status: "unreadable", directory, byteLength: 0, reason: reason2 });
  try {
    const content = files.read(path2.join(directory, "team.md"), MAX_TEAM_SOURCE_BYTES, { preserveBOM: true });
    const after = inspectTeamSource(files);
    if (content === null || probe.fingerprint !== after.fingerprint || after.source) {
      return { source: unavailable2("Selected roster source changed while reading; retry on next poll."), retry: true };
    }
    return { source: { status: "available", directory, byteLength: Buffer.byteLength(content), content }, retry: false };
  } catch (error) {
    return {
      source: unavailable2(projectFileDiagnostic(error)),
      // Only a stable, strictly decoded content refusal can be cached after a read.
      retry: error?.code !== "ERR_ENCODING_INVALID_ENCODED_DATA" || inspectTeamSource(files).fingerprint !== probe.fingerprint
    };
  }
}
function readTeamSource(files) {
  return readProbedTeamSource(files, inspectTeamSource(files)).source;
}
var TeamSourceState = class {
  files;
  previous;
  selectedRoot;
  constructor(project) {
    this.selectedRoot = typeof project === "string" ? project : project.root;
    this.files = typeof project === "string" ? void 0 : project;
  }
  scan() {
    let next;
    let fingerprint = "project-unavailable";
    let directory = SQUAD_DIR_NAMES[0];
    try {
      this.files ??= new ProjectFiles(this.selectedRoot);
      const probe = inspectTeamSource(this.files);
      fingerprint = probe.fingerprint;
      directory = probe.directory;
      if (this.previous && !this.previous.retry && this.previous.fingerprint === probe.fingerprint && !probe.retry) {
        if (this.previous.source.status !== "available" || this.files.probe(path2.join(probe.directory, "team.md"), MAX_TEAM_SOURCE_BYTES) && inspectTeamSource(this.files).fingerprint === probe.fingerprint) {
          return { source: this.previous.source, changed: false };
        }
      }
      next = { fingerprint: probe.fingerprint, ...readProbedTeamSource(this.files, probe) };
    } catch (error) {
      next = {
        fingerprint,
        retry: true,
        source: {
          status: "unreadable",
          directory,
          byteLength: 0,
          reason: projectFileDiagnostic(error)
        }
      };
    }
    const prior = this.previous;
    const changed = !prior || prior.fingerprint !== next.fingerprint || prior.source.status !== next.source.status || prior.source.status !== "available" && next.source.status !== "available" && prior.source.reason !== next.source.reason;
    this.previous = next;
    return { source: next.source, changed };
  }
};

// ../src/teamParser.ts
function deriveSlug(charterPath, name) {
  const cleaned = charterPath.replace(/`/g, "").trim();
  const match = /(?:^|[\\/])agents[\\/]([^\\/]+)[\\/]charter\.md$/i.exec(cleaned);
  if (match?.[1]) {
    return match[1];
  }
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function isHiddenAgent(member) {
  const lowerRole = member.role.toLowerCase();
  const lowerStatus = member.status.toLowerCase();
  const lowerName = member.name.toLowerCase();
  if (lowerRole.includes("scribe") || lowerStatus.includes("silent")) {
    return true;
  }
  if (lowerName === "ralph" && lowerRole.includes("monitor")) {
    return true;
  }
  return false;
}
function splitTableRow(row) {
  const cells = row.split("|").map((c) => c.trim());
  if (cells.length > 0 && cells[0] === "") {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}
function parseTeamRoster(content) {
  return parseAllMembers(content).filter((member) => !isHiddenAgent(member));
}
function parseAllMembers(content) {
  const lines = content.split(/\r?\n/);
  const members2 = [];
  let inMembersSection = false;
  let headerParsed = false;
  let columnIndices = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Members/i.test(trimmed)) {
      inMembersSection = true;
      headerParsed = false;
      continue;
    }
    if (inMembersSection && /^##\s+/.test(trimmed) && !/^##\s+Members/i.test(trimmed)) {
      break;
    }
    if (!inMembersSection || !trimmed.startsWith("|")) {
      continue;
    }
    const cells = splitTableRow(trimmed);
    if (cells.filter((c) => c.length > 0).length < 2) {
      continue;
    }
    const isSeparator = cells.every((c) => c === "" || /^[-:]+$/.test(c));
    if (!headerParsed) {
      if (isSeparator) {
        continue;
      }
      const lowerCells = cells.map((c) => c.toLowerCase());
      columnIndices = {
        name: Math.max(0, lowerCells.findIndex((c) => c.includes("name"))),
        role: Math.max(0, lowerCells.findIndex((c) => c.includes("role"))),
        charter: lowerCells.findIndex((c) => c.includes("charter")),
        status: lowerCells.findIndex((c) => c.includes("status"))
      };
      headerParsed = true;
      continue;
    }
    if (isSeparator || !columnIndices) {
      continue;
    }
    const name = cells[columnIndices.name] ?? "";
    const role = cells[columnIndices.role] ?? "";
    const charterRaw = columnIndices.charter >= 0 ? cells[columnIndices.charter] ?? "" : "";
    const status = columnIndices.status >= 0 ? cells[columnIndices.status] || "\u2705 Active" : "\u2705 Active";
    if (!name) {
      continue;
    }
    members2.push({
      name,
      slug: deriveSlug(charterRaw, name),
      role,
      status,
      charterPath: charterRaw.replace(/`/g, "").trim()
    });
  }
  return members2;
}

// ../src/declaredRoster.ts
function parseDeclaredRoster(source) {
  const { directory, byteLength } = source;
  if (source.status !== "available") {
    return { ...source, members: [], allMembers: [] };
  }
  const allMembers = parseAllMembers(source.content);
  if (!allMembers.length) {
    return {
      status: "invalid",
      directory,
      byteLength,
      members: [],
      allMembers: [],
      reason: "Roster is empty or has no usable Members table."
    };
  }
  return { status: "available", directory, byteLength, allMembers, members: parseTeamRoster(source.content) };
}

// ../src/recordedUsage.ts
var MAX_USAGE_BYTES = 2 * 1024 * 1024;
var MAX_USAGE_LINES = 1e4;
var MAX_USAGE_HISTORY = 40;
function unavailableUsage(diagnostic = "No workspace selected.") {
  return {
    state: "unavailable",
    sourcePath: null,
    diagnostic,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastRecordAt: null,
    lastUsageAt: null,
    invalidLines: 0,
    unsupportedLines: 0,
    pendingFinalLine: false,
    usageRecords: 0,
    attemptedTurns: 0,
    coveredTurns: 0,
    unlinkedUsageRecords: 0,
    normalizedValueRecords: 0,
    totals: null,
    history: []
  };
}
function text(value, max = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function tokens(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function cost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function rosterMatcher(members2) {
  const aliases = /* @__PURE__ */ new Map();
  const slugs = /* @__PURE__ */ new Map();
  if (members2.length <= 1e3) {
    for (const member of members2) {
      const slug = member.slug.trim().toLowerCase();
      slugs.set(slug, (slugs.get(slug) ?? 0) + 1);
      for (const key of [member.name.trim().toLowerCase(), slug]) {
        const candidates = aliases.get(key) ?? /* @__PURE__ */ new Set();
        candidates.add(member);
        aliases.set(key, candidates);
      }
    }
  }
  return (name) => {
    const candidates = aliases.get(name?.trim().toLowerCase() ?? "");
    const member = candidates?.values().next().value;
    if ((candidates?.size ?? 0) > 1 || member && (slugs.get(member.slug.trim().toLowerCase()) ?? 0) > 1) {
      return { rosterName: null, attribution: "ambiguous" };
    }
    return member?.slug ? { rosterName: member.name, attribution: "roster-match" } : { rosterName: null, attribution: "unattributed" };
  };
}
function parseRecordedUsage(content, members2 = []) {
  const snapshot = unavailableUsage();
  snapshot.state = "ready";
  snapshot.diagnostic = null;
  if (Buffer.byteLength(content, "utf8") > MAX_USAGE_BYTES) {
    return { ...snapshot, state: "partial", diagnostic: "Ledger exceeds 2 MiB; no totals read." };
  }
  const lines = content.split("\n", MAX_USAGE_LINES + 2);
  if (lines.length > MAX_USAGE_LINES + 1) {
    return { ...snapshot, state: "partial", diagnostic: "Ledger exceeds 10,000 complete lines; no totals read." };
  }
  const finalLine = lines.pop() ?? "";
  snapshot.pendingFinalLine = finalLine.trim().length > 0;
  const starts = /* @__PURE__ */ new Set();
  const matchRoster = rosterMatcher(members2);
  const usages = [];
  let overflow = false;
  const totals = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      snapshot.invalidLines++;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      snapshot.invalidLines++;
      continue;
    }
    const r = value;
    if (r.version !== 1 || r.kind !== "usage" && r.kind !== "turn-start") {
      snapshot.unsupportedLines++;
      continue;
    }
    if (!text(r.sessionId) || !text(r.timestamp, 64) || !Number.isFinite(Date.parse(r.timestamp)) || r.agentName !== void 0 && (typeof r.agentName !== "string" || r.agentName.length > 128) || r.turnId !== void 0 && !text(r.turnId)) {
      snapshot.invalidLines++;
      continue;
    }
    if (r.kind === "turn-start") {
      if (!text(r.turnId)) {
        snapshot.invalidLines++;
        continue;
      }
      starts.add(r.turnId);
    } else {
      if (!text(r.model, 128) || !tokens(r.inputTokens) || !tokens(r.outputTokens) || !cost(r.estimatedCost)) {
        snapshot.invalidLines++;
        continue;
      }
      const agentName = typeof r.agentName === "string" ? r.agentName : null;
      const entry = {
        sessionId: r.sessionId,
        turnId: typeof r.turnId === "string" ? r.turnId : null,
        agentName,
        ...matchRoster(agentName),
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        estimatedCost: r.estimatedCost,
        timestamp: new Date(r.timestamp).toISOString()
      };
      usages.push(entry);
      totals.inputTokens += entry.inputTokens;
      totals.outputTokens += entry.outputTokens;
      totals.estimatedCost += entry.estimatedCost;
      overflow ||= !tokens(totals.inputTokens) || !tokens(totals.outputTokens) || !cost(totals.estimatedCost);
      if (entry.model.trim().toLowerCase() === "unknown" || entry.inputTokens === 0 || entry.outputTokens === 0) {
        snapshot.normalizedValueRecords++;
      }
    }
    const timestamp = new Date(r.timestamp).toISOString();
    if (!snapshot.lastRecordAt || Date.parse(timestamp) > Date.parse(snapshot.lastRecordAt)) {
      snapshot.lastRecordAt = timestamp;
    }
  }
  const covered = /* @__PURE__ */ new Set();
  for (const entry of usages) {
    const key = entry.turnId;
    if (key && starts.has(key)) {
      covered.add(key);
    } else {
      snapshot.unlinkedUsageRecords++;
    }
  }
  snapshot.usageRecords = usages.length;
  snapshot.attemptedTurns = starts.size;
  snapshot.coveredTurns = covered.size;
  usages.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  snapshot.history = usages.slice(0, MAX_USAGE_HISTORY);
  snapshot.lastUsageAt = usages[0]?.timestamp ?? null;
  snapshot.totals = usages.length && !overflow ? totals : null;
  if (snapshot.invalidLines || snapshot.unsupportedLines || snapshot.pendingFinalLine || overflow) {
    snapshot.state = "partial";
    snapshot.diagnostic = overflow ? "Reported sums exceed safe numeric limits; totals withheld." : "Only valid complete version-1 records are included; this is a partial ledger snapshot.";
  }
  if (members2.length > 1e3) {
    snapshot.state = "partial";
    snapshot.diagnostic = `${snapshot.diagnostic ?? ""} Roster exceeds 1,000 members; all usage is unattributed.`.trim();
  }
  return snapshot;
}

// ../src/carpetValidation.ts
function isColor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const c = value;
  const ranges = [["h", 0, 360], ["s", 0, 100], ["b", -100, 100], ["c", -100, 100]];
  return ranges.every(([key, min, max]) => typeof c[key] === "number" && Number.isFinite(c[key]) && c[key] >= min && c[key] <= max) && (c.colorize === void 0 || typeof c.colorize === "boolean");
}
function isValidCarpetTile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const tile = value;
  return Number.isInteger(tile.variant) && tile.variant >= 0 && tile.variant < 3 && (tile.color === void 0 || isColor(tile.color)) && (tile.accentColor === void 0 || isColor(tile.accentColor)) && (tile.order === void 0 || Number.isSafeInteger(tile.order) && tile.order >= 0);
}
function isValidCarpetLayer(value, cells) {
  return value === void 0 || Array.isArray(value) && value.length === cells && value.every((tile) => tile === null || isValidCarpetTile(tile));
}

// ../src/layoutValidation.ts
function parseLayoutJson(content) {
  try {
    const data = JSON.parse(content.replace(/^\uFEFF/, ""));
    if (!isValidLayout(data)) {
      return null;
    }
    if (!data.furniture) {
      data.furniture = [];
    }
    if (!data.version || data.version < 2) {
      data.version = 2;
    }
    return data;
  } catch {
    return null;
  }
}
var MAX_LAYOUT_PETS = 32;
var MAX_LAYOUT_AREAS = 100;
var MAX_AREA_MAPPINGS = 500;
var MAX_AREA_LABEL_LENGTH = 80;
var MAX_AREA_DIRECTORY_ID_LENGTH = 8192;
var WALL_TILE = 0;
var VOID_TILE = 8;
function isGridSize(value) {
  return Number.isInteger(value) && value > 0 && value <= 256;
}
function isAreaLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_AREA_LABEL_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}
function isAreaDefinition(value) {
  return !!value && typeof value === "object" && isAreaLabel(value.label) && typeof value.color === "string" && /^#[\da-f]{6}$/i.test(value.color);
}
function isValidLayout(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const layout2 = data;
  if (layout2.version !== void 0 && (!Number.isSafeInteger(layout2.version) || layout2.version < 1)) {
    return false;
  }
  if (!isGridSize(layout2.cols) || !isGridSize(layout2.rows)) {
    return false;
  }
  const tiles = layout2.tiles;
  if (!Array.isArray(tiles) || tiles.length !== layout2.cols * layout2.rows) {
    return false;
  }
  if (!tiles.every((t) => Number.isInteger(t))) {
    return false;
  }
  if (!isValidCarpetLayer(layout2.carpetTiles, layout2.cols * layout2.rows)) {
    return false;
  }
  if (layout2.pets !== void 0 && (!Array.isArray(layout2.pets) || layout2.pets.length > MAX_LAYOUT_PETS || !layout2.pets.every((pet) => !!pet && typeof pet === "object" && typeof pet.id === "string" && pet.id.length > 0 && pet.id.length <= 120 && Number.isSafeInteger(pet.petType) && pet.petType >= 0 && pet.petType < 512) || new Set(layout2.pets.map((pet) => pet.id)).size !== layout2.pets.length)) {
    return false;
  }
  if (layout2.areas !== void 0 && (!Array.isArray(layout2.areas) || layout2.areas.length > MAX_LAYOUT_AREAS || !layout2.areas.every(isAreaDefinition) || new Set(layout2.areas.map((area) => area.label.toLocaleLowerCase())).size !== layout2.areas.length)) {
    return false;
  }
  if (layout2.areaTiles !== void 0 && (!Array.isArray(layout2.areaTiles) || layout2.areaTiles.length !== layout2.cols * layout2.rows || !layout2.areaTiles.every((label, index) => {
    if (label === null) {
      return true;
    }
    if (!isAreaLabel(label) || !layout2.areas?.some((area) => area.label === label)) {
      return false;
    }
    const tile = tiles[index];
    return tile !== WALL_TILE && tile !== VOID_TILE;
  }))) {
    return false;
  }
  if (layout2.areaMappings !== void 0 && (!layout2.areaMappings || typeof layout2.areaMappings !== "object" || Array.isArray(layout2.areaMappings) || Object.keys(layout2.areaMappings).length > MAX_AREA_MAPPINGS || !Object.entries(layout2.areaMappings).every(([directoryId, labels]) => directoryId.length > 0 && directoryId.length <= MAX_AREA_DIRECTORY_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(directoryId) && Array.isArray(labels) && labels.length <= MAX_LAYOUT_AREAS && labels.every((label) => isAreaLabel(label) && layout2.areas?.some((area) => area.label === label)) && new Set(labels.map((label) => label.toLocaleLowerCase())).size === labels.length))) {
    return false;
  }
  if (layout2.furniture !== void 0) {
    if (!Array.isArray(layout2.furniture)) {
      return false;
    }
    if (!layout2.furniture.every((f) => !!f && typeof f === "object" && typeof f.uid === "string" && typeof f.type === "string" && Number.isInteger(f.col) && Number.isInteger(f.row) && (f.rotation === void 0 || Number.isFinite(f.rotation)) && (f.assetRole === void 0 || f.assetRole === "desk" || f.assetRole === "seat") && (f.assetFootprint === void 0 || !!f.assetFootprint && typeof f.assetFootprint === "object" && isGridSize(f.assetFootprint.width) && f.assetFootprint.width <= 16 && isGridSize(f.assetFootprint.height) && f.assetFootprint.height <= 16))) {
      return false;
    }
  }
  if (layout2.tileColors !== void 0 && (!layout2.tileColors || typeof layout2.tileColors !== "object" || Array.isArray(layout2.tileColors) || !Object.values(layout2.tileColors).every((color2) => !!color2 && typeof color2 === "object" && ["h", "s", "b", "c"].every((key) => Number.isFinite(color2[key]))))) {
    return false;
  }
  try {
    JSON.stringify(data);
  } catch {
    return false;
  }
  return true;
}

// ../src/constants.ts
var TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ../src/defaultFurniture.ts
function place(uid, assetId, col, row, width, height, assetRole) {
  return {
    uid,
    type: `pa_${assetId}`,
    col,
    row,
    rotation: 0,
    assetFootprint: { width, height },
    ...assetRole ? { assetRole } : {}
  };
}
function defaultFurniture() {
  return [
    place("conference-table", "TABLE_FRONT", 4, 7, 3, 4, "desk"),
    place("lounge-table", "COFFEE_TABLE", 14, 5, 2, 2),
    place("sofa-left", "SOFA_SIDE", 13, 5, 1, 2),
    place("sofa-back", "SOFA_BACK", 14, 7, 2, 1),
    place("sofa-front", "SOFA_FRONT", 14, 4, 2, 1),
    place("sofa-right", "SOFA_SIDE:left", 16, 5, 1, 2),
    place("plant-hanging-1", "HANGING_PLANT", 9, 0, 1, 2),
    place("plant-hanging-2", "HANGING_PLANT", 1, 0, 1, 2),
    place("bookshelf-1", "DOUBLE_BOOKSHELF", 7, 0, 2, 2),
    place("bookshelf-2", "DOUBLE_BOOKSHELF", 2, 0, 2, 2),
    place("painting-small-1", "SMALL_PAINTING", 12, 0, 1, 2),
    place("clock-1", "CLOCK", 5, 0, 1, 2),
    place("plant-1", "PLANT", 18, 1, 1, 2),
    place("coffee-1", "COFFEE", 14, 6, 1, 1),
    place("chair-left-1", "WOODEN_CHAIR_SIDE", 3, 9, 1, 2, "seat"),
    place("chair-left-2", "WOODEN_CHAIR_SIDE", 3, 7, 1, 2, "seat"),
    place("chair-right-1", "WOODEN_CHAIR_SIDE:left", 7, 7, 1, 2, "seat"),
    place("chair-right-2", "WOODEN_CHAIR_SIDE:left", 7, 9, 1, 2, "seat"),
    place("desk-1", "DESK_FRONT", 2, 3, 3, 2, "desk"),
    place("desk-2", "DESK_FRONT", 6, 3, 3, 2, "desk"),
    place("bench-1", "CUSHIONED_BENCH", 3, 5, 1, 1, "seat"),
    place("bench-2", "CUSHIONED_BENCH", 7, 5, 1, 1, "seat"),
    place("computer-1", "PC_FRONT_OFF", 7, 3, 1, 2),
    place("computer-2", "PC_FRONT_OFF", 3, 3, 1, 2),
    place("computer-side-1", "PC_SIDE", 4, 7, 1, 2),
    place("computer-side-2", "PC_SIDE", 4, 9, 1, 2),
    place("computer-side-3", "PC_SIDE:left", 6, 7, 1, 2),
    place("computer-side-4", "PC_SIDE:left", 6, 9, 1, 2),
    place("plant-2", "PLANT_2", 11, 1, 1, 2),
    place("painting-large", "LARGE_PAINTING", 14, 0, 2, 2),
    place("bin-1", "BIN", 2, 11, 1, 1),
    place("table-small-front", "SMALL_TABLE_FRONT", 17, 10, 2, 2),
    place("table-small-side", "SMALL_TABLE_SIDE", 1, 9, 1, 3),
    place("coffee-2", "COFFEE", 1, 10, 1, 1),
    place("plant-3", "PLANT_2", 1, 8, 1, 2),
    place("painting-small-2", "SMALL_PAINTING_2", 17, 0, 1, 2)
  ];
}

// ../src/defaultOfficeLayout.ts
var WALL = 0;
var FLOOR_1 = 1;
var FLOOR_7 = 7;
var VOID = 8;
var FLOOR_9 = 9;
var COLS = 21;
var ROWS = 13;
var TILE_COLORS = {
  [WALL]: { h: 214, s: 30, b: -100, c: -55, colorize: true },
  [FLOOR_1]: { h: 209, s: 39, b: -25, c: -80, colorize: true },
  [FLOOR_7]: { h: 25, s: 48, b: -43, c: -88, colorize: true },
  [VOID]: { h: 214, s: 30, b: -100, c: -55, colorize: true },
  [FLOOR_9]: { h: 209, s: 0, b: -16, c: -8, colorize: true }
};
function createTiles() {
  const tiles = Array(COLS * ROWS).fill(VOID);
  for (let col = 0; col < 20; col++) {
    tiles[COLS + col] = WALL;
  }
  for (let row = 2; row <= 11; row++) {
    tiles[row * COLS] = WALL;
    tiles[row * COLS + 19] = WALL;
    for (let col = 1; col <= 9; col++) {
      tiles[row * COLS + col] = FLOOR_7;
    }
    const opensDivider = row >= 5 && row <= 8;
    tiles[row * COLS + 10] = opensDivider ? FLOOR_1 : WALL;
    for (let col = 11; col <= 18; col++) {
      tiles[row * COLS + col] = row >= 10 ? FLOOR_9 : FLOOR_1;
    }
  }
  return tiles;
}
function createDefaultOfficeLayout() {
  const tiles = createTiles();
  const tileColors = {};
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const tile = tiles[row * COLS + col];
      tileColors[`${col},${row}`] = { ...TILE_COLORS[tile] };
    }
  }
  return {
    version: 2,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture: defaultFurniture(),
    pets: [],
    tileColors
  };
}

// ../src/core/layoutState.ts
function ensureTileColors(layout2) {
  if (layout2.tileColors && Object.keys(layout2.tileColors).length > 0) {
    return;
  }
  const floorColor = { h: 35, s: 40, b: 15, c: 0 };
  const wallColor = { h: 20, s: 30, b: -25, c: 0 };
  const colors = {};
  for (let r = 0; r < layout2.rows; r++) {
    for (let c = 0; c < layout2.cols; c++) {
      const index = r * layout2.cols + c;
      const tile = layout2.tiles[index];
      colors[`${c},${r}`] = tile === 0 ? { ...wallColor } : { ...floorColor };
    }
  }
  layout2.tileColors = colors;
}

// ../src/core/agentIdentity.ts
function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function resolveFileAgentId(raw, roster) {
  const key = slugify(raw);
  if (!key) {
    return null;
  }
  if (roster.has(key)) {
    return key;
  }
  const all = Array.from(roster.values());
  const byName = all.filter((a) => slugify(a.name) === key);
  if (byName.length === 1) {
    return byName[0].id;
  }
  const byPrefix = all.filter((a) => key.startsWith(`${a.id}-`)).sort((a, b) => b.id.length - a.id.length);
  if (byPrefix.length > 0) {
    return byPrefix[0].id;
  }
  const byFirstName = all.filter(
    (a) => a.id.split("-")[0] === key || slugify(a.name).split("-")[0] === key
  );
  if (byFirstName.length === 1) {
    return byFirstName[0].id;
  }
  return null;
}

// ../src/manifestAssets.ts
import * as fs2 from "fs";
import * as path3 from "path";
var import_pngjs = __toESM(require_png());
var MAX_FILE_BYTES = 1024 * 1024;
var MAX_MANIFEST_BYTES = 64 * 1024;
var MAX_PET_PNG_BYTES = 512 * 1024;
var PET_SHEET_SIZE = 96;
var MAX_ENTRIES = 128;
var ASSET_ROOT_LIMITS = {
  bytes: 2 * 1024 * 1024,
  files: 128,
  entries: 2048,
  bundled: { assets: 128, pixels: 262144 },
  external: { assets: 48, pixels: 98304 }
};
var RootBudget = class {
  constructor(bundled) {
    this.bundled = bundled;
  }
  bundled;
  bytes = 0;
  files = 0;
  entries = 0;
  assets = 0;
  pixels = 0;
  read(bytes) {
    if (this.files + 1 > ASSET_ROOT_LIMITS.files || this.bytes + bytes > ASSET_ROOT_LIMITS.bytes) {
      throw new Error("Root read budget exceeded (128 files / 2097152 bytes per pass)");
    }
    this.files++;
    this.bytes += bytes;
  }
  entry() {
    if (this.entries >= ASSET_ROOT_LIMITS.entries) {
      throw new Error("Root enumeration budget exceeded (2048 entries per pass)");
    }
    this.entries++;
  }
  furniture(leaves) {
    const pixels = leaves.reduce((sum, leaf) => sum + leaf.width * leaf.height, 0);
    this.reserve(leaves.length, pixels);
  }
  sheet(width, height) {
    this.reserve(1, width * height);
  }
  reserve(assets, pixels) {
    const limit = this.bundled ? ASSET_ROOT_LIMITS.bundled : ASSET_ROOT_LIMITS.external;
    if (this.assets + assets > limit.assets || this.pixels + pixels > limit.pixels) {
      throw new Error(`Root decode budget exceeded (${limit.assets} assets / ${limit.pixels} pixels per pass)`);
    }
    this.assets += assets;
    this.pixels += pixels;
  }
};
var ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
var PNG_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.png$/i;
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a manifest object");
  }
  return value;
}
function text2(value, name, pattern) {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || pattern && !pattern.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}
function integer(value, name, max, min = 1) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}
function flag(value, name) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be boolean`);
  }
  return value;
}
function safePath(root, segments) {
  let current = fs2.realpathSync(root);
  const base = current;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[\\/:]/.test(segment)) {
      throw new Error("Asset paths must be local filenames");
    }
    const candidate = path3.join(current, segment);
    if (fs2.lstatSync(candidate).isSymbolicLink()) {
      throw new Error("Asset symlinks/junctions are not allowed");
    }
    current = fs2.realpathSync(candidate);
    const relative6 = path3.relative(base, current);
    if (relative6 === ".." || relative6.startsWith(`..${path3.sep}`) || path3.isAbsolute(relative6)) {
      throw new Error("Asset path escapes its approved directory");
    }
  }
  return current;
}
function readBounded(file, max, budget) {
  if (!fs2.lstatSync(file).isFile()) {
    throw new Error("Asset is not a regular file");
  }
  const fd = fs2.openSync(file, fs2.constants.O_RDONLY | fs2.constants.O_NONBLOCK);
  try {
    const stat2 = fs2.fstatSync(fd);
    if (!stat2.isFile() || stat2.size > max) {
      throw new Error(`File exceeds ${max} bytes or is not a regular file`);
    }
    budget.read(stat2.size);
    const buffer = Buffer.alloc(stat2.size);
    if (fs2.readSync(fd, buffer, 0, buffer.length, 0) !== buffer.length) {
      throw new Error("Asset changed while reading");
    }
    return buffer;
  } finally {
    fs2.closeSync(fd);
  }
}
function decode(buffer, width, height, allowPetPadding = false) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR" || buffer.readUInt32BE(16) !== width || buffer.readUInt32BE(20) !== height) {
    throw new Error(`PNG dimensions/signature must match ${width}x${height}`);
  }
  if (buffer[28] !== 0) {
    throw new Error("Interlaced PNGs are not supported; export a non-interlaced PNG");
  }
  let ended = false;
  let pngEnd = buffer.length;
  for (let offset = 8; offset < buffer.length; ) {
    if (offset + 12 > buffer.length) {
      throw new Error("Truncated PNG chunk");
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const next = offset + length + 12;
    if (next > buffer.length || offset !== 8 && type === "IHDR") {
      throw new Error("Invalid PNG chunk/header");
    }
    if (type === "IEND") {
      const padding = buffer.subarray(next);
      if (length !== 0 || padding.length !== 0 && (!allowPetPadding || padding.length !== 2 || padding[0] !== 0 || padding[1] !== 0)) {
        throw new Error("Invalid PNG end");
      }
      ended = true;
      pngEnd = next;
      break;
    }
    offset = next;
  }
  if (!ended) {
    throw new Error("PNG is missing IEND");
  }
  const png = import_pngjs.PNG.sync.read(buffer.subarray(0, pngEnd), { checkCRC: true });
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_2, x) => {
    const i = (y * width + x) * 4;
    const alpha = png.data[i + 3];
    if (alpha < 2) {
      return "";
    }
    return "#" + png.data.subarray(i, i + (alpha === 255 ? 3 : 4)).toString("hex");
  }));
}
function validateManifest(value) {
  const root = record(value);
  text2(root.id, "id", ID);
  text2(root.name, "name");
  text2(root.category, "category", ID);
  flag(root.canPlaceOnWalls, "canPlaceOnWalls");
  flag(root.canPlaceOnSurfaces, "canPlaceOnSurfaces");
  const backgroundTiles2 = integer(root.backgroundTiles, "backgroundTiles", 16, 0);
  const leaves = [];
  const ids = /* @__PURE__ */ new Set();
  const diagnostics = [];
  let nodes = 0;
  class TreeLimitError extends Error {
  }
  const visit = (value2, depth, inherited = {}) => {
    if (++nodes > 128 || depth >= 8) {
      throw new TreeLimitError("Manifest tree exceeds node/depth limit");
    }
    const node = record(value2);
    const metadata = { ...inherited };
    if (node.orientation !== void 0) {
      if (!["front", "back", "side", "left", "right"].includes(String(node.orientation))) {
        throw new Error("Invalid orientation");
      }
      metadata.orientation = node.orientation;
    }
    if (node.state !== void 0) {
      if (node.state !== "on" && node.state !== "off") {
        throw new Error("Invalid state");
      }
      metadata.state = node.state;
    }
    if (node.frame !== void 0) {
      metadata.frame = integer(node.frame, "frame", 63, 0);
    }
    if (node.mirrorSide !== void 0) {
      metadata.mirrorSide = flag(node.mirrorSide, "mirrorSide");
    }
    if (node.type === "group") {
      if (!["rotation", "state", "animation"].includes(String(node.groupType)) || !Array.isArray(node.members) || !node.members.length || node.members.length > 64) {
        throw new Error("Invalid group type or members");
      }
      if (node.rotationScheme !== void 0) {
        if (!["2-way", "3-way-mirror", "4-way"].includes(String(node.rotationScheme))) {
          throw new Error("Invalid rotationScheme");
        }
        metadata.rotationScheme = node.rotationScheme;
      }
      metadata.groupId = String(root.id);
      metadata.groupType = node.groupType;
      for (const [index, member] of node.members.entries()) {
        const start = leaves.length;
        const previousIds = new Set(ids);
        try {
          visit(member, depth + 1, metadata);
        } catch (error) {
          if (error instanceof TreeLimitError || record(member).type !== "group") {
            throw error;
          }
          leaves.splice(start);
          ids.clear();
          for (const id2 of previousIds) {
            ids.add(id2);
          }
          diagnostics.push(`Group member ${index}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (node.type === "asset") {
      const id2 = text2(node.id, "asset id", ID);
      if (ids.has(id2)) {
        throw new Error(`Duplicate asset id: ${id2}`);
      }
      ids.add(id2);
      const width = integer(node.width, "width", 256);
      const height = integer(node.height, "height", 256);
      const footprintW = integer(node.footprintW, "footprintW", 16);
      const footprintH = integer(node.footprintH, "footprintH", 16);
      if (width !== footprintW * 16 || height !== footprintH * 16) {
        throw new Error("Sprite dimensions must equal the tile footprint (16 pixels per tile)");
      }
      leaves.push({
        id: id2,
        file: text2(node.file ?? `${id2}.png`, "PNG filename", PNG_FILE),
        width,
        height,
        footprintW,
        footprintH,
        ...metadata
      });
    } else {
      throw new Error("Manifest type must be asset or group");
    }
  };
  visit(root, 0, { backgroundTiles: backgroundTiles2 });
  return { root, leaves, diagnostics };
}
function readManifest(root, folder, budget, observe = () => {
}) {
  entries(safePath(root, [folder]), budget);
  const manifest = readBounded(safePath(root, [folder, "manifest.json"]), MAX_MANIFEST_BYTES, budget);
  observe("manifest.json", manifest);
  const validated = validateManifest(JSON.parse(manifest.toString("utf8")));
  budget.furniture(validated.leaves);
  const buffers = /* @__PURE__ */ new Map();
  for (const leaf of validated.leaves) {
    if (!buffers.has(leaf.file)) {
      const buffer = readBounded(safePath(root, [folder, leaf.file]), MAX_FILE_BYTES, budget);
      observe(leaf.file, buffer);
      buffers.set(leaf.file, buffer);
    }
  }
  return { ...validated, buffers };
}
function getPetRoot(root) {
  const candidate = path3.join(root, "pets");
  try {
    fs2.lstatSync(candidate);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const resolved = safePath(root, ["pets"]);
  if (!fs2.statSync(resolved).isDirectory()) {
    throw new Error("Pets path is not a directory");
  }
  return resolved;
}
function readPetManifest(root, folder, budget, observe = () => {
}) {
  const manifest = readBounded(safePath(root, [folder, "manifest.json"]), MAX_MANIFEST_BYTES, budget);
  observe(`${folder}/manifest.json`, manifest);
  const meta = record(JSON.parse(manifest.toString("utf8")));
  const id2 = text2(meta.id, "pet id", ID);
  if (id2 !== folder) {
    throw new Error("Pet folder must match manifest id");
  }
  const name = text2(meta.name, "pet name");
  const petType = integer(meta.petType, "pet type", 511, 0);
  return { id: id2, name, petType };
}
function readPetImage(root, folder, budget, observe = () => {
}) {
  budget.sheet(PET_SHEET_SIZE, PET_SHEET_SIZE);
  const buffer = readBounded(safePath(root, [folder, "pet.png"]), MAX_PET_PNG_BYTES, budget);
  observe(`${folder}/pet.png`, buffer);
  return buffer;
}
function loadPetSprites(root, budget, ids, petTypes, snapshot) {
  if (!path3.isAbsolute(root)) {
    throw new Error("Asset directory must be absolute");
  }
  const petRoot = getPetRoot(root);
  if (!petRoot) {
    return;
  }
  for (const folder of directories(petRoot, budget)) {
    try {
      const { id: id2, name, petType } = readPetManifest(petRoot, folder, budget);
      if (ids.has(id2)) {
        throw new Error(`Duplicate pet id: ${id2}`);
      }
      if (petTypes.has(petType)) {
        throw new Error(`Duplicate pet type: ${petType}`);
      }
      ids.add(id2);
      petTypes.add(petType);
      const buffer = readPetImage(petRoot, folder, budget);
      const sprite2 = decode(buffer, PET_SHEET_SIZE, PET_SHEET_SIZE, true);
      snapshot.pets.push({ id: id2, name, petType, sprite: sprite2 });
    } catch (error) {
      snapshot.diagnostics.push(`${root} / pets / ${folder}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function entries(root, budget) {
  const directory = fs2.opendirSync(root);
  const result = [];
  try {
    for (; ; ) {
      budget.entry();
      const entry = directory.readSync();
      if (!entry) {
        break;
      }
      result.push(entry);
      if (result.length > MAX_ENTRIES) {
        throw new Error(`Directory exceeds ${MAX_ENTRIES} entries`);
      }
    }
    return result;
  } finally {
    directory.closeSync();
  }
}
function directories(root, budget) {
  return entries(root, budget).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name).sort();
}
function loadAssetSnapshot(bundledRoot, externalRoots = []) {
  const snapshot = { furniture: [], floors: [], walls: [], carpets: [], pets: [], directories: externalRoots, diagnostics: [] };
  const ids = /* @__PURE__ */ new Set();
  const petIds = /* @__PURE__ */ new Set();
  const petTypes = /* @__PURE__ */ new Set();
  const bundledBudget = new RootBudget(true);
  const attempt = (label, work) => {
    try {
      work();
    } catch (error) {
      snapshot.diagnostics.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const [index, root] of [bundledRoot, ...externalRoots.slice(0, 8)].entries()) {
    const budget = index === 0 ? bundledBudget : new RootBudget(false);
    attempt(root, () => {
      if (!path3.isAbsolute(root)) {
        throw new Error("Asset directory must be absolute");
      }
      const furnitureRoot = index === 0 ? safePath(root, ["furniture"]) : fs2.realpathSync(root);
      for (const folder of directories(furnitureRoot, budget)) {
        if (index !== 0 && (folder === "pets" || folder === "characters")) {
          continue;
        }
        attempt(`${root} / ${folder}`, () => {
          const { root: meta, leaves, buffers, diagnostics } = readManifest(furnitureRoot, folder, budget);
          snapshot.diagnostics.push(...diagnostics.map((message) => `${root} / ${folder}: ${message}`));
          const loaded = leaves.map((leaf) => {
            const type = index === 0 ? `pa_${leaf.id}` : `local_${text2(meta.id, "id", ID)}_${leaf.id}`;
            if (ids.has(type)) {
              throw new Error(`Duplicate asset id: ${type}`);
            }
            return {
              type,
              label: leaf.groupId ? String(meta.name) : `${meta.name} (${leaf.id})`,
              width: leaf.footprintW,
              height: leaf.footprintH,
              sprite: decode(buffers.get(leaf.file), leaf.width, leaf.height),
              isDesk: meta.category === "desks",
              category: String(meta.category),
              groupId: leaf.groupId ? index === 0 ? `pa_${leaf.groupId}` : `local_${meta.id}_${leaf.groupId}` : void 0,
              groupType: leaf.groupType,
              rotationScheme: leaf.rotationScheme,
              orientation: leaf.orientation,
              state: leaf.state,
              frame: leaf.frame,
              mirrorSide: leaf.mirrorSide,
              backgroundTiles: leaf.backgroundTiles,
              canPlaceOnSurfaces: meta.canPlaceOnSurfaces === true,
              canPlaceOnWalls: meta.canPlaceOnWalls === true
            };
          });
          for (const asset of loaded) {
            ids.add(asset.type);
          }
          snapshot.furniture.push(...loaded);
        });
      }
    });
    attempt(`${root} / pets`, () => loadPetSprites(root, budget, petIds, petTypes, snapshot));
  }
  if (externalRoots.length > 8) {
    snapshot.diagnostics.push("Only eight external directories can be loaded");
  }
  for (let i = 0; i < 9; i++) {
    attempt(`Bundled floor ${i}`, () => {
      bundledBudget.sheet(16, 16);
      snapshot.floors[i] = decode(readBounded(safePath(bundledRoot, ["floors", `floor_${i}.png`]), MAX_FILE_BYTES, bundledBudget), 16, 16);
    });
    snapshot.floors[i] ??= Array.from({ length: 16 }, () => Array(16).fill(""));
  }
  attempt("Bundled walls", () => {
    bundledBudget.sheet(64, 128);
    const sheet = decode(readBounded(safePath(bundledRoot, ["walls", "wall_0.png"]), MAX_FILE_BYTES, bundledBudget), 64, 128);
    snapshot.walls = Array.from({ length: 16 }, (_, mask) => sheet.slice(Math.floor(mask / 4) * 32, Math.floor(mask / 4) * 32 + 32).map((row) => row.slice(mask % 4 * 16, mask % 4 * 16 + 16)));
  });
  for (let i = 0; i < 3; i++) {
    attempt(`Bundled carpet ${i}`, () => {
      bundledBudget.sheet(64, 64);
      const sheet = decode(readBounded(safePath(bundledRoot, ["carpets", `carpet_${i}.png`]), MAX_FILE_BYTES, bundledBudget), 64, 64);
      snapshot.carpets[i] = Array.from({ length: 16 }, (_, mask) => sheet.slice(Math.floor(mask / 4) * 16, Math.floor(mask / 4) * 16 + 16).map((row) => row.slice(mask % 4 * 16, mask % 4 * 16 + 16)));
    });
    snapshot.carpets[i] ??= [];
  }
  return snapshot;
}

// ../src/squadWatcher.ts
function parseSessionFile(content) {
  try {
    const data = JSON.parse(content);
    if (typeof data.id !== "string" || typeof data.createdAt !== "string") {
      return null;
    }
    const messages = Array.isArray(data.messages) ? data.messages.map((m) => ({
      role: String(m.role ?? "unknown"),
      content: String(m.content ?? ""),
      timestamp: String(m.timestamp ?? "")
    })) : [];
    return {
      id: data.id,
      createdAt: data.createdAt,
      lastActiveAt: data.lastActiveAt ?? data.createdAt,
      agent: typeof data.agent === "string" ? data.agent : void 0,
      messages
    };
  } catch {
    return null;
  }
}
function parseLogEntry(content) {
  content = stripHtmlComments(content);
  if (!content.trim()) {
    return null;
  }
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  let timestamp = "";
  const tsMatch = /\*\*Timestamp:\*\*\s*(.+)/i.exec(content);
  if (tsMatch?.[1]) {
    timestamp = tsMatch[1].trim();
  } else {
    const dateMatch = /(\d{4}-\d{2}-\d{2}T[\d:Z-]+)/i.exec(lines[0] ?? "");
    if (dateMatch?.[1]) {
      timestamp = dateMatch[1];
    }
  }
  let agent2 = null;
  const agentMatch = /\*\*Agent:\*\*[ \t]*([^\r\n(]+)/i.exec(content);
  if (agentMatch?.[1]) {
    agent2 = agentMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  if (!agent2) {
    const headingMatch = /^#\s+.*?—\s*(.+)/i.exec(lines[0] ?? "");
    if (headingMatch?.[1]) {
      agent2 = headingMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }
  }
  let summary = "";
  for (const [index, line] of lines.entries()) {
    if (/^[-=]+$/.test(lines[index + 1] ?? "")) {
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    if (/^\*\*(Timestamp|Agent|Task|Status):\*\*/i.test(line)) {
      continue;
    }
    const meaningful = meaningfulLine(line);
    if (meaningful) {
      summary = meaningful.slice(0, 120);
      break;
    }
  }
  if (!summary && !agent2) {
    return null;
  }
  return { agent: agent2, timestamp, summary };
}
function detectAgentFromFilename(filename) {
  const match = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-(.+)\.md$/i.exec(filename);
  return match?.[1] ?? null;
}
function stripHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}
function meaningfulLine(line) {
  if (/^#{1,6}(?:\s|$)/.test(line) || /^[-=|:\s]+$/.test(line)) {
    return null;
  }
  const cleaned = line.replace(/^[-*+]\s+|^\d+[.)]\s+/, "").replace(/^\[[ xX]\]\s*/, "").replace(/\*\*/g, "").trim();
  if (cleaned.length <= 3 || /^[\w -]+:\s*$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

// ../src/observedTasks.ts
var MAX_OBSERVED_TASKS = 64;
var MAX_RECENT_TASKS = 16;
var TASK_ID_MAX_LENGTH = 160;
function taskIdentity(value) {
  return typeof value === "string" && value.length > 0 && value.length <= TASK_ID_MAX_LENGTH && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value) ? value : "";
}
var terminal = (task) => !["observed", "running"].includes(task.state);
var ObservedTasks = class {
  tasks = /* @__PURE__ */ new Map();
  selections = /* @__PURE__ */ new Map();
  limited = false;
  clear() {
    this.tasks.clear();
    this.selections.clear();
    this.limited = false;
  }
  has(toolCallId) {
    return this.tasks.has(toolCallId);
  }
  accept(event, sessionId, agentId) {
    if (event.identityOmitted) {
      this.limited = true;
    }
    if (event.type === "subagent.selected" && event.instanceId && event.selectedAgentName) {
      if (this.selections.size < MAX_OBSERVED_TASKS || this.selections.has(event.instanceId)) {
        this.selections.set(event.instanceId, { name: event.selectedAgentName, agentId });
      } else {
        this.limited = true;
      }
      for (const task2 of this.tasks.values()) {
        if (task2.instanceId === event.instanceId && !terminal(task2)) {
          task2.selectedAgentName = event.selectedAgentName;
          task2.agentId = agentId;
        }
      }
    }
    if (!event.toolCallId) {
      return;
    }
    if (event.type === "tool.execution_start" && event.task) {
      if (this.tasks.has(event.toolCallId)) {
        return;
      }
      if (this.tasks.size >= MAX_OBSERVED_TASKS) {
        const oldestDone = [...this.tasks].find(([, task2]) => terminal(task2));
        if (oldestDone) {
          this.tasks.delete(oldestDone[0]);
        } else {
          this.limited = true;
          return;
        }
        this.limited = true;
      }
      this.tasks.set(event.toolCallId, {
        sessionId,
        toolCallId: event.toolCallId,
        parentToolCallId: event.parentToolCallId || null,
        name: event.task.name.replace(/[\x00-\x1f\x7f]/g, " "),
        agentType: event.task.agent_type.replace(/[\x00-\x1f\x7f]/g, " "),
        mode: event.task.mode,
        description: event.task.description,
        fieldsTruncated: !!event.task.fieldsTruncated,
        agentId,
        state: "observed"
      });
    }
    const task = this.tasks.get(event.toolCallId);
    if (!task || terminal(task)) {
      return;
    }
    if (event.type === "subagent.started" && task.state === "observed" && event.instanceId) {
      task.instanceId = event.instanceId;
      const retainedTerminal = [...this.tasks.values()].find((alias) => alias !== task && alias.sessionId === task.sessionId && alias.instanceId === event.instanceId && terminal(alias));
      if (retainedTerminal) {
        task.state = retainedTerminal.state;
      }
      const selected = this.selections.get(event.instanceId);
      if (selected) {
        task.selectedAgentName = selected.name;
        task.agentId = selected.agentId;
      }
    }
    switch (event.type) {
      case "subagent.started":
        if (!terminal(task)) {
          task.state = "running";
        }
        break;
      case "subagent.completed":
        task.state = "completed";
        break;
      case "subagent.failed":
        task.state = "failed";
        break;
      case "subagent.aborted":
        task.state = "aborted";
        break;
    }
    if (terminal(task)) {
      if (task.instanceId) {
        for (const alias of this.tasks.values()) {
          if (alias.instanceId === task.instanceId) {
            alias.state = task.state;
          }
        }
        this.selections.delete(task.instanceId);
      }
      this.tasks.delete(event.toolCallId);
      this.tasks.set(event.toolCallId, task);
    }
    const completed = [...this.tasks].filter(([, row]) => terminal(row));
    for (const [id2] of completed.slice(0, Math.max(0, completed.length - MAX_RECENT_TASKS))) {
      this.tasks.delete(id2);
      this.limited = true;
    }
  }
  discardSeedCompletions() {
    for (const [id2, task] of this.tasks) {
      if (terminal(task)) {
        this.tasks.delete(id2);
      }
    }
  }
  snapshot(sessionId, sourceLimited = false) {
    return {
      sessionId,
      limited: this.limited || sourceLimited,
      tasks: [...this.tasks.values()].map((task) => ({
        ...task,
        parentToolCallId: this.safeParent(task)
      }))
    };
  }
  safeParent(task) {
    const seen = /* @__PURE__ */ new Set([task.toolCallId]);
    let id2 = task.parentToolCallId;
    while (id2) {
      if (seen.has(id2)) {
        return null;
      }
      seen.add(id2);
      const parent = this.tasks.get(id2);
      if (!parent || parent.sessionId !== task.sessionId) {
        return id2 === task.parentToolCallId ? null : task.parentToolCallId;
      }
      id2 = parent.parentToolCallId;
    }
    return task.parentToolCallId;
  }
};

// src/events.ts
var text3 = (v) => typeof v === "string" && v.length <= 8192;
var short = (v) => typeof v === "string" && v.length <= 256;
var number = (v) => typeof v === "number" && Number.isFinite(v);
var integer2 = (v) => number(v) && Number.isSafeInteger(v) && v >= 0;
var backgroundTiles = (v) => integer2(v) && v <= 16;
var boolean = (v) => typeof v === "boolean";
var nullable = (check) => (v) => v === null || check(v);
var optional = (check) => (v) => v === void 0 || check(v);
var array = (check, max) => (v) => Array.isArray(v) && v.length <= max && v.every(check);
var oneOf = (...values) => (v) => values.includes(v);
function object(fields) {
  return (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every((key) => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, check]) => check(Reflect.get(v, key)));
}
var dictionary = (check, max) => (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= max && Object.keys(v).every((key) => key.length <= 8192) && Object.values(v).every(check);
var color = object({ h: number, s: number, b: number, c: number, colorize: optional(boolean) });
var sprite = array(array((v) => typeof v === "string" && /^(?:|#[\da-f]{6}(?:[\da-f]{2})?)$/i.test(v), 512), 512);
var layout = (v) => isValidLayout(v) && object({
  version: optional(integer2),
  cols: integer2,
  rows: integer2,
  tiles: array((v2) => integer2(v2) && v2 <= 10, 65536),
  furniture: array(object({
    uid: short,
    type: short,
    col: integer2,
    row: integer2,
    rotation: optional(number),
    color: optional(color),
    assetFootprint: optional(object({ width: integer2, height: integer2 })),
    assetRole: optional(oneOf("desk", "seat")),
    state: optional(short)
  }), 4096),
  tileColors: optional(dictionary(color, 65536)),
  carpetTiles: optional(array(nullable(object({
    variant: integer2,
    color: optional(color),
    accentColor: optional(color),
    order: optional(number)
  })), 65536)),
  pets: optional(array(object({ id: short, petType: integer2 }), 32)),
  areas: optional(array(object({ label: short, color: short }), 100)),
  areaTiles: optional(array(nullable(short), 65536)),
  areaMappings: optional(dictionary(array(short, 100), 500))
})(v);
var isObserverLayout = (value) => layout(value);
var agent = {
  id: short,
  name: short,
  role: short,
  paletteIndex: integer2,
  seatId: nullable(short),
  status: oneOf("active", "idle", "waiting"),
  currentTask: nullable(text3),
  currentTaskSource: optional(nullable(oneOf("file", "live")))
};
var runtimeModel = object({
  model: (v) => typeof v === "string" && v.length > 0 && v.length <= 160 && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v),
  kind: oneOf("session-selection", "assistant-message", "tool-call", "subagent-model"),
  source: oneOf(
    "session.start.selectedModel",
    "session.resume.selectedModel",
    "session.model_change.newModel",
    "assistant.message.model",
    "tool.execution_complete.model",
    "subagent.started.model",
    "subagent.configured.model"
  ),
  timestamp: (v) => typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
});
var schemas = {
  agentStatus: object({
    type: oneOf("agentStatus"),
    agentId: short,
    status: agent.status,
    currentTask: optional(nullable(text3)),
    currentTaskSource: agent.currentTaskSource
  }),
  liveModels: object({ type: oneOf("liveModels"), snapshot: object({
    sessionId: nullable((v) => typeof v === "string" && /^[a-zA-Z0-9-]{1,8}$/.test(v)),
    session: nullable(runtimeModel),
    members: (v) => dictionary(runtimeModel, 2048)(v) && Object.keys(v).every((key) => key.length <= 256)
  }) }),
  agentToolStart: object({
    type: oneOf("agentToolStart"),
    agentId: short,
    tool: short,
    toolId: (v) => !!taskIdentity(v),
    status: short
  }),
  agentToolDone: object({
    type: oneOf("agentToolDone"),
    agentId: short,
    tool: short,
    toolId: (v) => !!taskIdentity(v)
  }),
  agentToolsClear: object({ type: oneOf("agentToolsClear"), agentId: short }),
  agentContextUsage: object({
    type: oneOf("agentContextUsage"),
    agentId: short,
    contextTokens: nullable((v) => number(v) && v >= 0),
    maxContextTokens: nullable((v) => number(v) && v > 0)
  }),
  observedTasks: object({ type: oneOf("observedTasks"), snapshot: object({
    sessionId: nullable(short),
    limited: boolean,
    tasks: array(object({
      sessionId: short,
      toolCallId: (v) => !!taskIdentity(v),
      parentToolCallId: nullable((v) => !!taskIdentity(v)),
      name: short,
      agentType: short,
      mode: short,
      description: (v) => typeof v === "string" && v.length <= TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
      agentId: nullable(short),
      state: oneOf("observed", "running", "completed", "failed", "aborted"),
      instanceId: optional((v) => !!taskIdentity(v)),
      selectedAgentName: optional((v) => !!taskIdentity(v)),
      fieldsTruncated: boolean
    }), MAX_OBSERVED_TASKS)
  }) }),
  telemetryEvent: object({ type: oneOf("telemetryEvent"), event: object({
    id: short,
    timestamp: number,
    category: oneOf("status"),
    agentId: nullable(short),
    agentName: nullable(short),
    summary: short,
    detail: oneOf(null)
  }) }),
  settingsLoaded: object({ type: oneOf("settingsLoaded"), soundEnabled: boolean, debugEnabled: boolean, showAreas: boolean }),
  sourceStatus: object({ type: oneOf("sourceStatus"), status: object({
    workspaceRoot: nullable(text3),
    squadDir: nullable(text3),
    teamFound: boolean,
    observer: oneOf("watching", "stopped"),
    nativeWatch: boolean,
    error: nullable(text3),
    liveActivity: optional(object({
      state: oneOf("off", "searching", "following", "error"),
      sessionId: nullable(short),
      selection: optional(oneOf("owned-session", "matching-project", "unavailable")),
      reason: optional(text3)
    }))
  }) }),
  layoutLoaded: object({
    type: oneOf("layoutLoaded"),
    layout,
    revision: nullable(text3),
    workspaceRoot: text3,
    source: optional(oneOf("external", "import"))
  }),
  layoutSaved: object({ type: oneOf("layoutSaved"), layout, revision: nullable(text3) }),
  layoutError: object({ type: oneOf("layoutError"), error: text3, source: optional(oneOf("watcher")) }),
  existingAgents: object({ type: oneOf("existingAgents"), agents: array(object(agent), 128) }),
  agentDetailLoaded: object({ type: oneOf("agentDetailLoaded"), requestId: optional(short), detail: object({
    id: short,
    name: short,
    role: short,
    workspaceRoot: text3,
    status: agent.status,
    currentTask: nullable(text3),
    currentTaskSource: agent.currentTaskSource,
    charterSummary: nullable(text3),
    charterContent: nullable(text3),
    charterStatus: oneOf("available", "missing", "unreadable", "unavailable"),
    expertise: nullable(text3),
    responsibilities: nullable(text3),
    boundaries: nullable(text3),
    recentActivity: array(text3, 20),
    lastActiveAt: integer2,
    lastActiveAtStatus: oneOf("unobserved", "available", "clock-skew")
  }) }),
  recordedUsage: object({ type: oneOf("recordedUsage"), snapshot: object({
    state: oneOf("unavailable", "missing", "ready", "partial", "error"),
    sourcePath: nullable(text3),
    diagnostic: nullable(text3),
    checkedAt: short,
    lastRecordAt: nullable(short),
    lastUsageAt: nullable(short),
    invalidLines: integer2,
    unsupportedLines: integer2,
    pendingFinalLine: boolean,
    usageRecords: integer2,
    attemptedTurns: integer2,
    coveredTurns: integer2,
    unlinkedUsageRecords: integer2,
    normalizedValueRecords: integer2,
    totals: nullable(object({ inputTokens: integer2, outputTokens: integer2, estimatedCost: number })),
    history: array(object({
      sessionId: text3,
      turnId: nullable(text3),
      agentName: nullable(short),
      rosterName: nullable(short),
      attribution: oneOf("roster-match", "unattributed", "ambiguous"),
      model: short,
      inputTokens: integer2,
      outputTokens: integer2,
      estimatedCost: number,
      timestamp: short
    }), 40)
  }) }),
  manifestAssetsLoaded: object({ type: oneOf("manifestAssetsLoaded"), snapshot: object({
    furniture: array(object({
      type: short,
      label: short,
      width: integer2,
      height: integer2,
      sprite,
      isDesk: boolean,
      category: short,
      canPlaceOnSurfaces: boolean,
      canPlaceOnWalls: boolean,
      groupId: optional(short),
      groupType: optional(oneOf("rotation", "state", "animation")),
      rotationScheme: optional(oneOf("2-way", "3-way-mirror", "4-way")),
      orientation: optional(oneOf("front", "back", "side", "left", "right")),
      state: optional(oneOf("on", "off")),
      frame: optional(integer2),
      mirrorSide: optional(boolean),
      backgroundTiles: optional(backgroundTiles)
    }), 128),
    floors: array(sprite, 128),
    walls: array(sprite, 128),
    carpets: array(array(sprite, 128), 128),
    pets: array(object({ id: short, name: short, petType: integer2, sprite }), 128),
    directories: array(text3, 1),
    diagnostics: array(text3, 256)
  }) })
};

// src/officeStore.ts
import * as fs3 from "node:fs";
import * as path4 from "node:path";
import { createHash, randomUUID } from "node:crypto";

// src/officePreferences.ts
var defaultPreferences = () => ({
  version: 1,
  settings: { soundEnabled: false, debugEnabled: false, showAreas: false },
  agents: {}
});
function record2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys3) {
  return Object.keys(value).length === keys3.length && keys3.every((key) => Object.hasOwn(value, key));
}
function validPreferences(value) {
  if (!record2(value) || !exactKeys(value, ["version", "settings", "agents"]) || value.version !== 1 || !record2(value.settings) || !exactKeys(value.settings, ["soundEnabled", "debugEnabled", "showAreas"]) || !Object.values(value.settings).every((setting) => typeof setting === "boolean") || !record2(value.agents) || Object.keys(value.agents).length > 128) return false;
  return Object.entries(value.agents).every(([id2, meta]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id2) && record2(meta) && Object.keys(meta).every((key) => key === "palette" || key === "seatId") && (meta.palette === void 0 || Number.isSafeInteger(meta.palette) && typeof meta.palette === "number" && meta.palette >= 0 && meta.palette <= 4095) && (meta.seatId === void 0 || typeof meta.seatId === "string" && meta.seatId.length > 0 && meta.seatId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(meta.seatId)));
}
function validPreferenceMutation(value) {
  if (!record2(value)) return false;
  if (value.type === "saveAgentSeats") {
    return exactKeys(value, ["type", "seats"]) && record2(value.seats) && Object.keys(value.seats).length <= 128 && Object.entries(value.seats).every(([id2, seat]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id2) && typeof seat === "string" && seat.length > 0 && seat.length <= 256 && !/[\u0000-\u001f\u007f]/.test(seat));
  }
  return ["setSoundEnabled", "setDebugEnabled", "setShowAreas"].includes(String(value.type)) && exactKeys(value, ["type", "enabled"]) && typeof value.enabled === "boolean";
}

// src/officeStore.ts
var MAX_OFFICE_BYTES = 2 * 1024 * 1024;
var MAX_PREFERENCES_BYTES = 128 * 1024;
var DIRECTORY = ".squad-pod";
var LAYOUT = path4.join(DIRECTORY, "layout.json");
var PREFERENCES = path4.join(DIRECTORY, "office-preferences.json");
function revision(content) {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}
function sameIdentity(before, after) {
  return before.ino === after.ino && (before.dev === after.dev || process.platform === "win32" && (before.dev === 0n || after.dev === 0n));
}
var OfficeStore = class {
  root;
  files;
  identity;
  constructor(project) {
    this.files = new ProjectFiles(project);
    this.root = this.files.root;
    this.identity = fs3.lstatSync(this.root, { bigint: true });
  }
  readLayout() {
    const raw = this.read(LAYOUT, MAX_OFFICE_BYTES);
    return this.layoutSnapshot(raw);
  }
  readPreferences() {
    return this.preferencesSnapshot(this.read(PREFERENCES, MAX_PREFERENCES_BYTES));
  }
  saveLayout(input, expectedRevision, assertAuthority) {
    assertAuthority();
    const content = this.serialize(input, MAX_OFFICE_BYTES);
    const candidate = JSON.parse(content);
    if (!isValidLayout(candidate)) throw new Error("Invalid layout; saved office was not changed.");
    return this.commit(
      LAYOUT,
      content,
      expectedRevision,
      MAX_OFFICE_BYTES,
      assertAuthority,
      (raw) => this.layoutSnapshot(raw)
    );
  }
  savePreferences(input, expectedRevision, agentIds, assertAuthority) {
    assertAuthority();
    const content = this.serialize(input, MAX_PREFERENCES_BYTES);
    const candidate = JSON.parse(content);
    if (!validPreferences(candidate)) throw new Error("Invalid or unsupported office preferences.");
    const retained = this.readPreferences().value?.agents ?? {};
    if (Object.entries(candidate.agents).some(([id2, meta]) => !agentIds.has(id2) && (!Object.hasOwn(retained, id2) || retained[id2].palette !== meta.palette || retained[id2].seatId !== meta.seatId))) {
      throw new Error("Office preferences contain an unknown selected-project agent.");
    }
    return this.commit(
      PREFERENCES,
      content,
      expectedRevision,
      MAX_PREFERENCES_BYTES,
      assertAuthority,
      (raw) => this.preferencesSnapshot(raw)
    );
  }
  serialize(input, limit) {
    const content = JSON.stringify(input, null, 2);
    if (typeof content !== "string" || Buffer.byteLength(content) > limit) {
      throw new Error(`Office data exceeds ${limit} bytes or is not JSON.`);
    }
    return content;
  }
  layoutSnapshot(raw) {
    const value = raw === null ? null : parseLayoutJson(raw);
    if (raw !== null && value === null) throw new Error("Saved layout is malformed; recover it before saving.");
    return { value, revision: revision(raw) };
  }
  preferencesSnapshot(raw) {
    if (raw === null) return { value: null, revision: null };
    const value = JSON.parse(raw);
    if (!validPreferences(value)) throw new Error("Saved office preferences are malformed; recover them before saving.");
    return { value, revision: revision(raw) };
  }
  assertRoot() {
    const current = fs3.lstatSync(this.root, { bigint: true });
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(this.identity, current) || fs3.realpathSync(this.root) !== this.root) throw new Error("Selected project identity changed.");
  }
  read(relative6, limit) {
    this.assertRoot();
    return this.files.read(relative6, limit);
  }
  ensureDirectory(relative6) {
    this.assertRoot();
    const parent = path4.dirname(relative6);
    const parentPath = parent === "." ? this.root : this.files.resolve(parent);
    const target = path4.join(parentPath, path4.basename(relative6));
    try {
      fs3.mkdirSync(target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const resolved = this.files.resolve(relative6);
    if (!fs3.lstatSync(resolved).isDirectory()) throw new Error("Office storage is not a directory.");
    return resolved;
  }
  commit(relative6, content, expectedRevision, limit, assertAuthority, snapshot) {
    if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))) throw new Error("Invalid office revision.");
    assertAuthority();
    const directory = this.ensureDirectory(DIRECTORY);
    const directoryIdentity2 = fs3.lstatSync(directory, { bigint: true });
    const assertDirectory = () => {
      this.assertRoot();
      const current = this.files.resolve(DIRECTORY);
      if (current !== directory || !sameIdentity(directoryIdentity2, fs3.lstatSync(current, { bigint: true }))) {
        throw new Error("Office storage identity changed.");
      }
    };
    const target = path4.join(this.root, relative6);
    const lockPath = `${target}.lock`;
    const lock = fs3.openSync(lockPath, "wx", 384);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let staged = false;
    try {
      const previous = this.read(relative6, limit);
      const current = snapshot(previous);
      if (current.revision !== expectedRevision) return { ...current, saved: false };
      assertDirectory();
      const fd = fs3.openSync(temporary, "wx", 384);
      staged = true;
      try {
        fs3.writeFileSync(fd, content, "utf8");
        fs3.fsyncSync(fd);
      } finally {
        fs3.closeSync(fd);
      }
      assertAuthority();
      assertDirectory();
      const beforeCommit = this.read(relative6, limit);
      if (beforeCommit !== previous) return { ...snapshot(beforeCommit), saved: false };
      if (previous !== null) {
        const recovery = this.ensureDirectory(path4.join(DIRECTORY, "recovery"));
        const backup = path4.join(recovery, `${randomUUID()}.json`);
        fs3.writeFileSync(backup, previous, { encoding: "utf8", flag: "wx", mode: 384 });
      }
      assertAuthority();
      assertDirectory();
      const finalRevision = this.read(relative6, limit);
      if (finalRevision !== previous) return { ...snapshot(finalRevision), saved: false };
      fs3.renameSync(temporary, target);
      staged = false;
      const written = this.read(relative6, limit);
      if (written !== content) throw new Error("Office changed after commit; reload before retrying. Draft must be retained.");
      return { ...snapshot(written), saved: true };
    } finally {
      fs3.closeSync(lock);
      try {
        assertDirectory();
      } catch {
        throw new Error("Office storage identity changed; lock and staged bytes were retained in the original directory for manual recovery.");
      }
      if (staged) fs3.unlinkSync(temporary);
      fs3.unlinkSync(lockPath);
    }
  }
};

// ../src/copilotSessionActivity.ts
import * as fs6 from "node:fs";
import * as path7 from "node:path";

// ../src/directories.ts
import * as fs5 from "fs";
import * as path6 from "path";

// ../src/copilotSessionState.ts
import fs4 from "fs";
import * as os from "os";
import * as path5 from "path";
function isSessionUuid(id2) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id2);
}
function findCopilotSession(copilotHome, id2) {
  if (!isSessionUuid(id2)) {
    throw new Error("Invalid generated Copilot session UUID.");
  }
  const root = path5.join(copilotHome, "session-state");
  try {
    const rootStat = fs4.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error("Unsupported Copilot session root.");
    }
    const dir = path5.join(root, id2);
    const stat2 = fs4.lstatSync(dir);
    if (!stat2.isDirectory() || stat2.isSymbolicLink() || path5.dirname(fs4.realpathSync.native(dir)) !== fs4.realpathSync.native(root)) {
      throw new Error("Unsupported exact Copilot session directory.");
    }
    return { id: id2, dir, mtimeMs: stat2.mtimeMs };
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
function resolveCopilotHome(env = process.env, homedir2 = os.homedir()) {
  const override = env.COPILOT_HOME;
  return override?.trim() && path5.isAbsolute(override) ? override : path5.join(homedir2, ".copilot");
}
function listCopilotSessions(copilotHome, options) {
  const limit = options?.limit ?? 500;
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const sessions = [];
  let directory;
  try {
    const sessionRoot = path5.join(copilotHome, "session-state");
    if (fs4.lstatSync(sessionRoot).isSymbolicLink()) {
      return [];
    }
    const root = fs4.realpathSync.native(sessionRoot);
    directory = fs4.opendirSync(root);
    for (let examined = 0; examined < 500; examined++) {
      const entry = directory.readSync();
      if (!entry) {
        break;
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      try {
        const dir = path5.join(root, entry.name);
        const real = fs4.realpathSync.native(dir);
        const relative6 = path5.relative(root, real);
        if (relative6.startsWith(`..${path5.sep}`) || relative6 === ".." || path5.isAbsolute(relative6)) {
          continue;
        }
        sessions.push({ id: entry.name, dir, mtimeMs: fs4.statSync(dir).mtimeMs });
      } catch {
      }
    }
  } catch {
    return [];
  } finally {
    try {
      directory?.closeSync();
    } catch {
    }
  }
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id)).slice(0, Math.min(500, Math.floor(limit)));
}
function cwdScalar(value) {
  const text6 = value.trim();
  if (text6.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(text6);
    return match ? match[1].replace(/''/g, "'") : null;
  }
  if (text6.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/.exec(text6);
    if (!match) {
      return null;
    }
    const escapes = {
      "0": "\0",
      a: "\x07",
      b: "\b",
      t: "	",
      n: "\n",
      v: "\v",
      f: "\f",
      r: "\r",
      e: "\x1B",
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      N: "\x85",
      _: "\xA0",
      L: "\u2028",
      P: "\u2029"
    };
    try {
      return match[1].slice(1, -1).replace(
        /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
        (_match, escape) => {
          if (/^[xuU]/.test(escape) && escape.length > 1) {
            return String.fromCodePoint(parseInt(escape.slice(1), 16));
          }
          if (!(escape in escapes)) {
            throw new Error("Unsupported scalar escape");
          }
          return escapes[escape];
        }
      );
    } catch {
      return null;
    }
  }
  if (!text6 || /^[|>{[\]&*!#]/.test(text6)) {
    return null;
  }
  return text6.replace(/\s+#.*$/, "").trim() || null;
}
function readSessionCwd(sessionDir) {
  let fd;
  try {
    const file = path5.join(sessionDir, "workspace.yaml");
    const metadata = fs4.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8192) {
      return null;
    }
    fd = fs4.openSync(file, "r");
    const stat2 = fs4.fstatSync(fd);
    if (!stat2.isFile() || stat2.size > 8192) {
      return null;
    }
    const buffer = Buffer.alloc(8192);
    const bytes = fs4.readSync(fd, buffer, 0, buffer.length, 0);
    const matches = [...buffer.toString("utf8", 0, bytes).replace(/^\uFEFF/, "").matchAll(/^cwd:[ \t]*(.*)\r?$/gm)];
    if (matches.length !== 1) {
      return null;
    }
    const cwd = cwdScalar(matches[0][1]);
    return cwd && path5.isAbsolute(cwd) && !/[\u0000-\u001f\u007f]/.test(cwd) ? cwd : null;
  } catch {
    return null;
  } finally {
    try {
      if (fd !== void 0) {
        fs4.closeSync(fd);
      }
    } catch {
    }
  }
}

// ../src/directories.ts
function sameDirectoryPath(left, right, platform = process.platform) {
  const a = resolveDirectoryIdentity(left);
  const b = resolveDirectoryIdentity(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function resolveDirectoryIdentity(directoryPath) {
  try {
    return fs5.realpathSync.native(directoryPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return path6.resolve(directoryPath);
    }
    throw error;
  }
}

// ../src/activityLifecycle.ts
var MAX_TRACKED = 2048;
function liveToolLabel(event) {
  const labels = {
    view: `Reading ${event.file || "file"}`,
    edit: `Editing ${event.file || "file"}`,
    create: `Writing ${event.file || "file"}`,
    powershell: `Running: ${event.command || "shell"}`,
    bash: `Running: ${event.command || "shell"}`,
    grep: "Searching",
    glob: "Searching",
    web_fetch: "Fetching",
    web_search: "Searching",
    task: "Subtask"
  };
  return (labels[event.toolName] ?? event.toolName).slice(0, 30) || "Tool";
}
function exactLiveAgent(name, roster) {
  const key = name.toLowerCase();
  const matches = roster.filter((member) => member.id.toLowerCase() === key || member.folder?.toLowerCase() === key);
  return key && matches.length === 1 ? matches[0].id : null;
}
var ActivityLifecycle = class {
  constructor(options) {
    this.options = options;
  }
  options;
  tasks = /* @__PURE__ */ new Map();
  runs = /* @__PURE__ */ new Map();
  tools = /* @__PURE__ */ new Map();
  toolOwners = /* @__PURE__ */ new Map();
  gauge = /* @__PURE__ */ new Map();
  sessionModel = null;
  memberModels = /* @__PURE__ */ new Map();
  modelAgentOwners = /* @__PURE__ */ new Map();
  unresolvedMemberModels = /* @__PURE__ */ new Map();
  counter = 0;
  seeding = false;
  observedTasks = new ObservedTasks();
  /** Rebuild from a bounded source replay without emitting historical activity. */
  seed(events) {
    const previous = new Set(this.runs.keys());
    this.seeding = true;
    try {
      this.clear();
      for (const event of events) {
        this.accept(event);
      }
    } finally {
      this.seeding = false;
    }
    for (const id2 of previous) {
      if (!this.runs.has(id2)) {
        this.finish(id2);
      }
    }
    this.observedTasks.discardSeedCompletions();
  }
  /** Replay current activity only; adapters publish their source status before snapshots. */
  replayActivity() {
    for (const [agentId, taskId] of this.runs) {
      const task = this.tasks.get(taskId);
      this.lifecycle(agentId, true, task?.description ?? null, task?.activityAt, task?.clockSkew);
    }
    for (const [toolId, tool] of this.tools) {
      this.options.post({ type: "agentToolStart", agentId: tool.agentId, toolId, tool: tool.toolName, status: tool.label });
    }
    for (const [agentId, context] of this.gauge) {
      this.options.post({ type: "agentContextUsage", agentId, ...context });
    }
  }
  telemetry(agentId, summary) {
    if (this.seeding) {
      return;
    }
    this.options.post({ type: "telemetryEvent", event: {
      id: `live-${++this.counter}`,
      timestamp: (this.options.now ?? Date.now)(),
      category: "status",
      agentId,
      agentName: null,
      summary,
      detail: null
    } });
  }
  post(message) {
    if (!this.seeding) {
      this.options.post(message);
    }
  }
  lifecycle(agentId, active, task, activityAt, clockSkew = false) {
    if (this.seeding) {
      return;
    }
    if (clockSkew) {
      this.options.lifecycle(agentId, active, task, activityAt, true);
    } else if (activityAt === void 0) {
      this.options.lifecycle(agentId, active, task);
    } else {
      this.options.lifecycle(agentId, active, task, activityAt);
    }
  }
  activityTime(activityAt) {
    if (activityAt === void 0) {
      return { clockSkew: false };
    }
    if (activityAt > (this.options.now ?? Date.now)()) {
      return { clockSkew: true };
    }
    return { activityAt, clockSkew: false };
  }
  mergeTaskActivity(task, observation) {
    if (observation.clockSkew) {
      task.clockSkew = true;
    } else if (observation.activityAt !== void 0) {
      task.activityAt = Math.max(task.activityAt ?? 0, observation.activityAt);
      task.clockSkew = false;
    }
  }
  /** Consume a normalized sanitized event, not a CLI envelope or JSONL record. */
  accept(event) {
    const activityTime = this.activityTime(event.activityAt);
    const duplicateTask = !!event.task && this.observedTasks.has(event.toolCallId);
    const attribution = event.selectedAgentName ? exactLiveAgent(event.selectedAgentName, this.options.roster()) : event.task?.agent_type === "general-purpose" ? exactLiveAgent(event.task.name, this.options.roster()) : null;
    const sessionId = this.options.source().sessionId;
    if (sessionId) {
      this.observedTasks.accept(event, sessionId, attribution);
    }
    if (event.selectedAgentName && event.instanceId) {
      for (const observed of this.observedTasks.snapshot(this.options.source().sessionId).tasks) {
        if (observed.instanceId !== event.instanceId || observed.state !== "running") {
          continue;
        }
        const previous = this.tasks.get(observed.toolCallId);
        if (previous && previous.agentId !== observed.agentId) {
          if (this.runs.get(previous.agentId) === observed.toolCallId) {
            this.finish(previous.agentId);
          }
          this.tasks.delete(observed.toolCallId);
        }
        if (observed.agentId) {
          const previousForOwner = previous?.agentId === observed.agentId ? previous : void 0;
          const task2 = {
            agentId: observed.agentId,
            description: observed.description,
            instanceId: observed.instanceId,
            activityAt: previousForOwner?.activityAt,
            clockSkew: previousForOwner?.clockSkew
          };
          this.mergeTaskActivity(task2, activityTime);
          this.tasks.set(observed.toolCallId, task2);
          this.startRun(
            observed.agentId,
            observed.toolCallId,
            observed.description,
            task2.activityAt,
            !!task2.clockSkew
          );
          this.rememberModelOwner(event.instanceId, observed.agentId);
        } else {
          this.clearInstanceModelOwner(event.instanceId);
        }
      }
    }
    if (!event.toolCallId || duplicateTask) {
      this.acceptModelEvent(event, this.tasks.get(event.toolCallId));
      return;
    }
    if (event.type === "tool.execution_start" && event.task?.agent_type === "general-purpose") {
      const agentId = attribution;
      if (agentId && !this.tasks.has(event.toolCallId) && this.tasks.size < MAX_TRACKED) {
        this.tasks.set(event.toolCallId, { agentId, description: event.task.description });
      }
    }
    if (event.type === "subagent.started" && !this.tasks.has(event.toolCallId)) {
      const observed = this.observedTasks.snapshot(this.options.source().sessionId).tasks.find((row) => row.toolCallId === event.toolCallId);
      if (observed?.agentId && observed.state === "running") {
        this.tasks.set(event.toolCallId, {
          agentId: observed.agentId,
          description: observed.description,
          instanceId: observed.instanceId,
          activityAt: activityTime.activityAt,
          clockSkew: activityTime.clockSkew
        });
      }
    }
    const task = this.tasks.get(event.toolCallId);
    if (event.type === "subagent.started" && task) {
      task.instanceId = this.observedTasks.snapshot(this.options.source().sessionId).tasks.find((row) => row.toolCallId === event.toolCallId)?.instanceId ?? event.instanceId;
      this.mergeTaskActivity(task, activityTime);
      this.startRun(task.agentId, event.toolCallId, task.description, task.activityAt, !!task.clockSkew);
      if (task.instanceId) {
        this.rememberModelOwner(task.instanceId, task.agentId);
      }
    } else if (["subagent.completed", "subagent.failed", "subagent.aborted"].includes(event.type)) {
      const instanceId = task?.instanceId ?? event.instanceId;
      for (const [id2, ended] of this.tasks) {
        if (id2 !== event.toolCallId && (!instanceId || ended.instanceId !== instanceId)) {
          continue;
        }
        if (this.runs.get(ended.agentId) === id2) {
          this.finish(ended.agentId, activityTime.activityAt, activityTime.clockSkew);
        }
        this.tasks.delete(id2);
      }
    } else if (event.type === "tool.execution_start") {
      const parent = this.tasks.get(event.parentToolCallId);
      const scopedOwner = event.agentScoped ? this.modelAgentOwners.get(event.agentInstanceId) : void 0;
      if (parent) {
        this.observeTaskActivity(event.parentToolCallId, activityTime);
      } else if (scopedOwner) {
        const runId2 = this.runs.get(scopedOwner);
        if (runId2) {
          this.observeTaskActivity(runId2, activityTime);
        }
      }
      if (parent) {
        this.rememberToolOwner(event.toolCallId, parent.agentId);
      } else if (scopedOwner) {
        this.rememberToolOwner(event.toolCallId, scopedOwner);
      } else if (!event.parentToolCallId && !event.agentScoped) {
        this.rememberToolOwner(event.toolCallId, null);
      }
      if (!parent || this.runs.get(parent.agentId) !== event.parentToolCallId || this.tools.size >= MAX_TRACKED) {
        return;
      }
      const label = liveToolLabel(event);
      this.tools.set(event.toolCallId, { agentId: parent.agentId, toolName: event.toolName, label });
      this.post({ type: "agentToolStart", agentId: parent.agentId, toolId: event.toolCallId, tool: event.toolName, status: label });
      this.telemetry(parent.agentId, label);
    } else if (event.type === "tool.execution_complete") {
      const tool = this.tools.get(event.toolCallId);
      const parentTask = this.tasks.get(event.parentToolCallId);
      if (!tool) {
        const owner = this.toolOwners.get(event.toolCallId);
        if (parentTask && (owner === void 0 || owner === parentTask.agentId)) {
          this.observeTaskActivity(event.parentToolCallId, activityTime);
        } else if (owner) {
          const runId2 = this.runs.get(owner);
          if (runId2) {
            this.observeTaskActivity(runId2, activityTime);
          }
        }
        if (owner === null) {
          if (parentTask) {
            return;
          }
          this.acceptModelEvent(event, void 0, void 0, true);
        } else if (owner !== void 0) {
          if (parentTask && owner !== parentTask.agentId) {
            return;
          }
          this.acceptModelEvent(event, parentTask, owner);
        } else {
          this.acceptModelEvent(event, parentTask, parentTask?.agentId);
        }
        return;
      }
      if (parentTask && parentTask.agentId === tool.agentId) {
        this.observeTaskActivity(event.parentToolCallId, activityTime);
      } else {
        const runId2 = this.runs.get(tool.agentId);
        if (runId2) {
          this.observeTaskActivity(runId2, activityTime);
        }
      }
      this.post({ type: "agentToolDone", agentId: tool.agentId, toolId: event.toolCallId, tool: tool.toolName });
      if (event.context) {
        this.gauge.set(tool.agentId, event.context);
        this.post({ type: "agentContextUsage", agentId: tool.agentId, ...event.context });
      }
      this.tools.delete(event.toolCallId);
      this.acceptModelEvent(event, task, tool.agentId);
      return;
    }
    this.acceptModelEvent(event, this.tasks.get(event.toolCallId));
  }
  startRun(agentId, toolCallId, description, activityAt, clockSkew = false) {
    const task = this.tasks.get(toolCallId);
    if (task) {
      this.mergeTaskActivity(task, { activityAt, clockSkew });
    }
    if (this.runs.get(agentId) === toolCallId) {
      if (activityAt !== void 0 || clockSkew) {
        this.lifecycle(agentId, true, description, task?.activityAt, !!task?.clockSkew);
      }
      return;
    }
    if (this.runs.has(agentId)) {
      this.clearDisplays(agentId);
    }
    this.runs.set(agentId, toolCallId);
    this.lifecycle(agentId, true, description, task?.activityAt, !!task?.clockSkew);
    this.telemetry(agentId, "Live member started");
  }
  observeTaskActivity(toolCallId, observation) {
    const task = this.tasks.get(toolCallId);
    if (!task) {
      return;
    }
    const previousActivityAt = task.activityAt;
    const previousClockSkew = !!task.clockSkew;
    this.mergeTaskActivity(task, observation);
    if (this.runs.get(task.agentId) === toolCallId && (task.activityAt !== previousActivityAt || !!task.clockSkew !== previousClockSkew)) {
      this.lifecycle(task.agentId, true, task.description, task.activityAt, !!task.clockSkew);
    }
  }
  finish(agentId, activityAt, clockSkew = false) {
    this.runs.delete(agentId);
    this.clearDisplays(agentId);
    this.lifecycle(agentId, false, null, activityAt, clockSkew);
    this.telemetry(agentId, "Live member finished");
  }
  rememberToolOwner(toolCallId, agentId) {
    this.toolOwners.delete(toolCallId);
    this.toolOwners.set(toolCallId, agentId);
    if (this.toolOwners.size > MAX_TRACKED) {
      const oldest = this.toolOwners.keys().next().value;
      if (oldest) {
        this.toolOwners.delete(oldest);
      }
    }
  }
  clearDisplays(agentId) {
    const removedModel = this.memberModels.delete(agentId);
    for (const [instanceId, owner] of this.modelAgentOwners) {
      if (owner === agentId) {
        this.modelAgentOwners.delete(instanceId);
        this.unresolvedMemberModels.delete(instanceId);
      }
    }
    this.gauge.delete(agentId);
    for (const [id2, tool] of this.tools) {
      if (tool.agentId === agentId) {
        this.tools.delete(id2);
      }
    }
    this.post({ type: "agentToolsClear", agentId });
    this.post({ type: "agentContextUsage", agentId, contextTokens: null, maxContextTokens: null });
    if (removedModel) {
      this.publishModels();
    }
  }
  modelSnapshot() {
    return {
      sessionId: this.options.source().sessionId?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || null,
      session: this.sessionModel,
      members: Object.fromEntries(this.memberModels)
    };
  }
  /** Publish current model observations without inventing missing producer data. */
  publishModels() {
    this.post({ type: "liveModels", snapshot: this.modelSnapshot() });
  }
  rememberModelOwner(instanceId, agentId) {
    if (!instanceId) {
      return;
    }
    const existing = this.modelAgentOwners.get(instanceId);
    if (existing && existing !== agentId) {
      return;
    }
    this.modelAgentOwners.delete(instanceId);
    this.modelAgentOwners.set(instanceId, agentId);
    const pending = this.unresolvedMemberModels.get(instanceId);
    if (pending) {
      this.unresolvedMemberModels.delete(instanceId);
      this.memberModels.set(agentId, pending);
      this.publishModels();
    }
    if (this.modelAgentOwners.size > MAX_TRACKED) {
      const oldest = this.modelAgentOwners.keys().next().value;
      if (oldest) {
        const oldOwner = this.modelAgentOwners.get(oldest);
        this.modelAgentOwners.delete(oldest);
        this.unresolvedMemberModels.delete(oldest);
        if (oldOwner && ![...this.modelAgentOwners.values()].includes(oldOwner) && this.memberModels.delete(oldOwner)) {
          this.publishModels();
        }
      }
    }
  }
  clearInstanceModelOwner(instanceId) {
    const owner = this.modelAgentOwners.get(instanceId);
    this.modelAgentOwners.delete(instanceId);
    this.unresolvedMemberModels.delete(instanceId);
    if (owner && ![...this.modelAgentOwners.values()].includes(owner) && this.memberModels.delete(owner)) {
      this.publishModels();
    }
  }
  acceptModelEvent(event, task, knownOwnerId, knownRootOwner = false) {
    if (event.type === "subagent.started" && task && event.agentInstanceId) {
      this.rememberModelOwner(event.agentInstanceId, task.agentId);
    }
    if (event.type === "session.shutdown") {
      if (event.agentScoped) {
        this.clearInstanceModelOwner(event.agentInstanceId);
      } else {
        this.sessionModel = null;
        this.memberModels.clear();
        this.modelAgentOwners.clear();
        this.unresolvedMemberModels.clear();
        this.toolOwners.clear();
        this.publishModels();
      }
      return;
    }
    if (["subagent.completed", "subagent.failed", "subagent.aborted"].includes(event.type) && event.agentScoped) {
      this.clearInstanceModelOwner(event.agentInstanceId);
      return;
    }
    if (event.type === "session.model_deselected") {
      if (!event.agentScoped) {
        this.sessionModel = null;
        this.publishModels();
      } else {
        const owner = this.modelAgentOwners.get(event.agentInstanceId);
        if (owner && this.memberModels.delete(owner)) {
          this.publishModels();
        }
      }
      return;
    }
    const observation = event.modelObservation;
    if (!observation) {
      return;
    }
    if (event.agentScoped) {
      if (knownRootOwner) {
        return;
      }
      const mappedOwner = event.type === "subagent.started" ? task?.agentId : this.modelAgentOwners.get(event.agentInstanceId);
      if (mappedOwner && knownOwnerId && mappedOwner !== knownOwnerId) {
        return;
      }
      const owner = mappedOwner ?? knownOwnerId;
      if (owner && this.runs.has(owner)) {
        this.memberModels.set(owner, observation);
        this.publishModels();
      } else if (event.agentInstanceId) {
        this.unresolvedMemberModels.delete(event.agentInstanceId);
        this.unresolvedMemberModels.set(event.agentInstanceId, observation);
        if (this.unresolvedMemberModels.size > MAX_TRACKED) {
          const oldest = this.unresolvedMemberModels.keys().next().value;
          if (oldest) {
            this.unresolvedMemberModels.delete(oldest);
          }
        }
      }
      return;
    }
    if (knownOwnerId) {
      if (this.runs.has(knownOwnerId)) {
        this.memberModels.set(knownOwnerId, observation);
        this.publishModels();
      }
      return;
    }
    if (knownRootOwner) {
      this.sessionModel = observation;
      this.publishModels();
      return;
    }
    if (event.type === "tool.execution_complete") {
      return;
    }
    if (event.type === "subagent.started") {
      if (task && this.runs.has(task.agentId)) {
        this.memberModels.set(task.agentId, observation);
        this.publishModels();
      }
      return;
    }
    this.sessionModel = observation;
    this.publishModels();
  }
  /** Clear ephemeral state; same-session idle may retain the observed session model. */
  clear(preserveSessionModel = false) {
    const model2 = preserveSessionModel ? this.sessionModel : null;
    for (const id2 of this.runs.keys()) {
      this.finish(id2);
    }
    this.tasks.clear();
    this.tools.clear();
    this.gauge.clear();
    this.sessionModel = model2;
    this.memberModels.clear();
    this.modelAgentOwners.clear();
    this.unresolvedMemberModels.clear();
    this.toolOwners.clear();
    this.observedTasks.clear();
    this.post({ type: "observedTasks", snapshot: { sessionId: null, tasks: [], limited: false } });
    this.post({ type: "liveModels", snapshot: preserveSessionModel ? this.modelSnapshot() : { sessionId: null, session: null, members: {} } });
  }
  /** Publish bounded tasks with the source's full session identity and truncation indicator. */
  publishTasks() {
    const source = this.options.source();
    this.post({
      type: "observedTasks",
      snapshot: this.observedTasks.snapshot(source.sessionId, source.limited)
    });
  }
};

// ../src/activitySource.ts
var LIVE_STALE_MS = 5 * 6e4;
var ActivitySource = class {
  constructor(options) {
    this.options = options;
    this.projection = new ActivityLifecycle({
      ...options,
      source: () => ({ sessionId: this.sessionId, limited: this.limited })
    });
  }
  options;
  sessionId = null;
  limited = false;
  lastBytesAt = 0;
  lastRevision = -1;
  stale = false;
  source = { state: "off", sessionId: null };
  projection;
  /** Clear under the old identity before the adapter changes selection authority. */
  resetSelection() {
    this.projection.clear();
    this.sessionId = null;
  }
  /** Select a validated identity; return whether transport state must be reset. */
  select(sessionId) {
    if (sessionId === this.sessionId) {
      return false;
    }
    this.projection.clear();
    this.sessionId = sessionId;
    this.limited = false;
    this.lastRevision = -1;
    this.stale = false;
    if (sessionId) {
      this.projection.publishModels();
    }
    return true;
  }
  /** A changed stale source must be reconstructed, not resumed from an empty reducer. */
  requiresReseed(facts) {
    return this.stale && (facts.reset || facts.revision !== this.lastRevision);
  }
  /** Apply source change freshness once, then reduce or silently seed normalized events. */
  accept(batch) {
    const now = batch.observedAt;
    this.limited = batch.limited;
    if (batch.reset || batch.revision !== this.lastRevision) {
      this.lastBytesAt = Math.min(now, batch.modifiedAt);
      this.lastRevision = batch.revision;
    }
    if (now - this.lastBytesAt >= LIVE_STALE_MS) {
      this.projection.clear();
      this.stale = true;
      this.searching();
      return;
    }
    this.stale = false;
    if (batch.reset) {
      this.projection.seed(batch.events);
    } else {
      for (const event of batch.events) {
        this.projection.accept(event);
      }
    }
    this.setSource("following");
    if (batch.reset) {
      this.replay();
    }
    this.projection.publishTasks();
  }
  /** Publish unavailability after an adapter finds no authorized matching source. */
  searching() {
    this.setSource("searching");
  }
  /** Clear on loss, retaining coverage facts even when a bounded read fails partway. */
  lost(state, limited = this.limited) {
    this.limited = limited;
    this.projection.clear();
    this.sessionId = null;
    this.stale = false;
    this.setSource(state);
  }
  /** Clear on disable/disposal without consulting the source transport. */
  stop() {
    this.projection.clear();
    this.sessionId = null;
    this.stale = false;
    this.setSource("off");
  }
  /** Replay only after the adapter has validated freshness; preserve output ordering. */
  replay() {
    this.projection.replayActivity();
    this.options.status(this.source);
    this.projection.publishModels();
    this.projection.publishTasks();
  }
  setSource(state) {
    this.source = { state, sessionId: this.sessionId?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || null };
    this.options.status(this.source);
  }
};

// ../src/activityProjection.ts
var text4 = (value, max = 160) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "";
var object2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var basename3 = (value) => text4(typeof value === "string" ? value.split(/[\\/]/).at(-1) : "", 80);
var sourceTimestamp = (value) => {
  const timestamp = text4(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    return void 0;
  }
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : void 0;
};
function projectActivityEvent(value) {
  const envelope = object2(value);
  const data = object2(envelope.data);
  const type = text4(envelope.type);
  if (![
    "subagent.selected",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
    "subagent.aborted",
    "subagent.configured",
    "tool.execution_start",
    "tool.execution_complete",
    "assistant.message",
    "session.start",
    "session.resume",
    "session.model_change",
    "session.model_deselected",
    "session.shutdown"
  ].includes(type)) {
    return null;
  }
  const toolName = text4(data.toolName, 80).replace(/[^a-zA-Z0-9_.-]/g, "");
  const event = {
    type,
    toolName,
    toolCallId: taskIdentity(data.toolCallId),
    parentToolCallId: taskIdentity(data.parentToolCallId),
    squad: type === "subagent.selected" && !envelope.agentId && data.agentName === "Squad",
    agentScoped: Object.hasOwn(envelope, "agentId") && envelope.agentId !== null && envelope.agentId !== void 0,
    agentInstanceId: taskIdentity(envelope.agentId)
  };
  event.activityAt = sourceTimestamp(envelope.timestamp);
  event.instanceId = taskIdentity(envelope.agentId) || void 0;
  if (type === "subagent.selected" && event.instanceId) {
    event.selectedAgentName = taskIdentity(data.agentName) || void 0;
  }
  if (type === "subagent.completed" && data.cancelled === true) {
    event.type = "subagent.aborted";
  }
  const callBearing = [
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
    "subagent.aborted",
    "tool.execution_start",
    "tool.execution_complete"
  ].includes(type);
  event.identityOmitted = callBearing && (!event.toolCallId || data.parentToolCallId !== void 0 && data.parentToolCallId !== null && !event.parentToolCallId) || envelope.agentId !== void 0 && envelope.agentId !== null && !event.instanceId || type === "subagent.selected" && !!event.instanceId && !event.selectedAgentName;
  if (type === "tool.execution_start") {
    const args = object2(data.arguments);
    if (toolName === "task") {
      event.task = {
        name: typeof args.name === "string" && args.name.length <= 160 ? args.name : "",
        agent_type: typeof args.agent_type === "string" ? args.agent_type.slice(0, 160) : "",
        mode: text4(args.mode),
        description: text4(args.description, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH),
        fieldsTruncated: [
          ["name", 160],
          ["agent_type", 160],
          ["mode", 160],
          ["description", TASK_DESCRIPTION_DISPLAY_MAX_LENGTH]
        ].some(([key, max]) => typeof args[key] === "string" && args[key].length > Number(max))
      };
    } else if (["view", "edit", "create"].includes(toolName)) {
      event.file = basename3(args.path);
    } else if (["powershell", "bash"].includes(toolName)) {
      const command2 = typeof args.command === "string" ? args.command : "";
      const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/.exec(command2);
      const token = first?.[1] ?? first?.[2] ?? first?.[3] ?? "";
      const name = basename3(token);
      const quotedPowerShellExpression = toolName === "powershell" && /^\s*["']/.test(command2);
      event.command = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(name) && !/[=$()`{}[\];|&<>]/.test(token) && !quotedPowerShellExpression ? name : "";
    }
  }
  const metrics = object2(object2(data.toolTelemetry).metrics);
  const current = metrics.context_current_tokens;
  const limit = metrics.context_token_limit;
  if (type === "tool.execution_complete" && typeof current === "number" && Number.isFinite(current) && current >= 0 && typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    event.context = { contextTokens: current, maxContextTokens: limit };
  }
  if (envelope.ephemeral !== true) {
    const modelFields = {
      "session.start": { key: "selectedModel", kind: "session-selection", source: "session.start.selectedModel" },
      "session.resume": { key: "selectedModel", kind: "session-selection", source: "session.resume.selectedModel" },
      "session.model_change": { key: "newModel", kind: "session-selection", source: "session.model_change.newModel" },
      "assistant.message": { key: "model", kind: "assistant-message", source: "assistant.message.model" },
      "subagent.started": { key: "model", kind: "subagent-model", source: "subagent.started.model" },
      "subagent.configured": { key: "model", kind: "subagent-model", source: "subagent.configured.model" },
      "tool.execution_complete": { key: "model", kind: "tool-call", source: "tool.execution_complete.model" }
    };
    const modelField = modelFields[type];
    if (modelField) {
      const model2 = data[modelField.key];
      const timestamp = text4(envelope.timestamp, 40);
      if (typeof model2 === "string" && model2.trim().length > 0 && model2.length <= 160 && !/[\x00-\x1f\x7f]/.test(model2) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) && Number.isFinite(Date.parse(timestamp))) {
        event.modelObservation = {
          model: model2.trim(),
          kind: modelField.kind,
          source: modelField.source,
          timestamp
        };
      }
    }
  }
  return event;
}

// ../src/copilotSessionActivity.ts
var SEED_BYTES = 2 * 1024 * 1024;
var MAX_LINE_BYTES = 64 * 1024;
function parseLiveEvent(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return projectActivityEvent(value);
}
function openEventFile(file) {
  const metadata = fs6.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Unsupported live event file");
  }
  const fd = fs6.openSync(file, fs6.constants.O_RDONLY | (fs6.constants.O_NONBLOCK ?? 0) | (fs6.constants.O_NOFOLLOW ?? 0));
  try {
    const stat2 = fs6.fstatSync(fd);
    const differentDevice = metadata.dev !== 0 && stat2.dev !== 0 && stat2.dev !== metadata.dev;
    if (!stat2.isFile() || differentDevice || stat2.ino !== metadata.ino) {
      throw new Error("Live event file changed during open");
    }
    return { fd, stat: stat2 };
  } catch (error) {
    fs6.closeSync(fd);
    throw error;
  }
}
var EventTail = class {
  offset = 0;
  carry = Buffer.alloc(0);
  skipping = false;
  identity = "";
  reset = false;
  limited = false;
  read(file, emit) {
    const { fd, stat: stat2 } = openEventFile(file);
    try {
      const identity = `${stat2.dev}:${stat2.ino}:${stat2.birthtimeMs}`;
      this.reset = this.identity !== identity || stat2.size < this.offset;
      if (this.reset) {
        this.identity = identity;
        this.offset = Math.max(0, stat2.size - SEED_BYTES);
        this.carry = Buffer.alloc(0);
        this.skipping = this.offset > 0;
        this.limited = this.skipping;
      }
      const end = Math.min(stat2.size, this.offset + SEED_BYTES);
      const buffer = Buffer.alloc(MAX_LINE_BYTES);
      while (this.offset < end) {
        const count = fs6.readSync(fd, buffer, 0, Math.min(buffer.length, end - this.offset), this.offset);
        if (!count) {
          break;
        }
        this.offset += count;
        let start = 0;
        for (let i = 0; i < count; i++) {
          if (buffer[i] !== 10) {
            continue;
          }
          this.consume(buffer.subarray(start, i), true, emit);
          start = i + 1;
        }
        this.consume(buffer.subarray(start, count), false, emit);
      }
      return stat2;
    } finally {
      fs6.closeSync(fd);
    }
  }
  consume(part, newline, emit) {
    if (this.carry.length + part.length > MAX_LINE_BYTES) {
      this.limited = true;
      this.carry = Buffer.alloc(0);
      this.skipping = true;
    }
    if (!this.skipping) {
      this.carry = Buffer.concat([this.carry, part]);
      if (newline) {
        const event = parseLiveEvent(this.carry.toString("utf8"));
        if (event) {
          emit(event);
        }
      }
    }
    if (newline) {
      this.carry = Buffer.alloc(0);
      this.skipping = false;
    }
  }
};
function isSquadSession(file) {
  const { fd, stat: stat2 } = openEventFile(file);
  try {
    const size = stat2.size;
    for (const offset of /* @__PURE__ */ new Set([0, Math.max(0, size - MAX_LINE_BYTES)])) {
      const buffer = Buffer.alloc(Math.min(MAX_LINE_BYTES, size - offset));
      const count = fs6.readSync(fd, buffer, 0, buffer.length, offset);
      const lines = buffer.subarray(0, count).toString("utf8").split("\n");
      if (offset > 0) {
        lines.shift();
      }
      if (lines.some((line) => parseLiveEvent(line)?.squad)) {
        return true;
      }
    }
    return false;
  } finally {
    fs6.closeSync(fd);
  }
}
var CopilotSessionActivity = class {
  constructor(options) {
    this.options = options;
    this.projection = new ActivitySource({
      roster: () => this.options.roster(),
      post: (message) => this.options.post(message),
      lifecycle: (...args) => this.options.lifecycle(...args),
      status: (status) => this.options.status(status),
      now: () => (this.options.now ?? Date.now)()
    });
  }
  options;
  enabled = false;
  timer;
  home = "";
  session;
  tail = new EventTail();
  discoveryAt = -Infinity;
  preferredId;
  projection;
  /** Hosts with their own snapshot clock can drive poll/replay without a second timer. */
  start(pollAutomatically = true) {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    this.home = this.options.copilotHome ?? resolveCopilotHome();
    this.poll();
    if (pollAutomatically) {
      this.timer = setInterval(() => this.poll(), 1e3);
    }
  }
  stop() {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = void 0;
    this.projection.stop();
    this.session = void 0;
    this.discoveryAt = -Infinity;
    this.preferredId = void 0;
  }
  replay() {
    if (this.enabled) {
      this.poll();
    }
    this.projection.replay();
  }
  poll() {
    if (!this.enabled) {
      return;
    }
    const now = (this.options.now ?? Date.now)();
    try {
      const selection = this.options.sessionSelection?.();
      if (selection?.preferredId !== this.preferredId) {
        this.preferredId = selection?.preferredId;
        this.projection.resetSelection();
        this.session = void 0;
        this.discoveryAt = -Infinity;
      }
      if (selection?.preferredId === null) {
        this.projection.searching();
        return;
      }
      if (now - this.discoveryAt >= 5e3) {
        this.discoveryAt = now;
        const exact2 = selection?.preferredId ? findCopilotSession(this.home, selection.preferredId) : void 0;
        const sessions = selection?.preferredId ? exact2 ? [exact2] : [] : listCopilotSessions(this.home, { limit: 32 });
        const match = sessions.find((session) => {
          if (!selection?.preferredId && selection?.excludedIds.includes(session.id)) {
            return false;
          }
          const cwd = readSessionCwd(session.dir);
          if (!cwd || !sameDirectoryPath(cwd, this.options.workspaceRoot)) {
            return false;
          }
          try {
            return isSquadSession(path7.join(session.dir, "events.jsonl"));
          } catch (error) {
            if (error.code === "ENOENT") {
              return false;
            }
            throw error;
          }
        });
        if (this.projection.select(match?.id ?? null)) {
          this.session = match;
          this.tail = new EventTail();
        }
      }
      if (!this.session) {
        this.projection.searching();
        return;
      }
      const file = path7.join(this.session.dir, "events.jsonl");
      const events = [];
      let stat2 = this.tail.read(file, (event) => events.push(event));
      if (this.projection.requiresReseed({ reset: this.tail.reset, revision: stat2.size })) {
        this.tail = new EventTail();
        events.length = 0;
        stat2 = this.tail.read(file, (event) => events.push(event));
      }
      this.projection.accept({
        reset: this.tail.reset,
        revision: stat2.size,
        modifiedAt: stat2.mtimeMs,
        observedAt: now,
        limited: this.tail.limited,
        events
      });
    } catch (error) {
      this.session = void 0;
      this.discoveryAt = -Infinity;
      this.projection.lost(
        error.code === "ENOENT" ? "searching" : "error",
        this.tail.limited
      );
    }
  }
};

// src/observer.ts
var settings = { type: "settingsLoaded", soundEnabled: false, debugEnabled: false, showAreas: false };
function createObserver(project, bundledAssetsRoot, pollMs = 1e3, options = {}) {
  const files = new ProjectFiles(project);
  const teamSource = new TeamSourceState(files);
  const office = new OfficeStore(project);
  const assets = {
    type: "manifestAssetsLoaded",
    snapshot: loadAssetSnapshot(bundledAssetsRoot)
  };
  if (!assets.snapshot.furniture.length) throw new Error("Bundled office assets are missing. Rebuild/install the complete observer package.");
  let latestAgents = [];
  let timer;
  let disposed = false;
  const fingerprints = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const activity = /* @__PURE__ */ new Map();
  const liveAgents = /* @__PURE__ */ new Map();
  let liveStatus = { state: "off", sessionId: null };
  let liveMessages = [];
  let liveStarted = false;
  const live = options.liveActivity ? new CopilotSessionActivity({
    workspaceRoot: files.root,
    copilotHome: options.copilotHome,
    sessionSelection: options.sessionSelection,
    roster: () => latestAgents.map((agent2) => ({ id: agent2.id })),
    post: (message) => liveMessages.push(message),
    lifecycle: (id2, running, task) => {
      if (running) liveAgents.set(id2, task);
      else liveAgents.delete(id2);
      for (const value of activity.values()) if (value.agentId === id2) value.changedAt = null;
    },
    status: (status) => {
      liveStatus = status;
    }
  }) : void 0;
  function readSnapshot(observeActivity = listeners.size > 0) {
    const errors = [];
    let remainingBytes = 8 * 1024 * 1024;
    function read(relative6, limit) {
      try {
        if (remainingBytes <= 0) throw new Error("8 MiB project observation budget exhausted; reduce source sizes.");
        const content = files.read(relative6, Math.min(limit, remainingBytes));
        if (content !== null) remainingBytes -= Buffer.byteLength(content);
        return content;
      } catch (error) {
        errors.push(`${relative6}: ${String(error)}`);
        return null;
      }
    }
    const declared = parseDeclaredRoster(teamSource.scan().source);
    remainingBytes -= declared.byteLength;
    const squad = declared.directory;
    const roster = declared.members;
    if (declared.status !== "available") errors.push(declared.reason);
    else if (!roster.length) errors.push("Roster is empty or has no usable Members table.");
    if (roster.length > 128 || roster.some((m) => !/^[a-zA-Z0-9_-]{1,128}$/.test(m.slug) || m.name.length > 256 || m.role.length > 256) || new Set(roster.map((m) => m.slug)).size !== roster.length) {
      errors.push("Roster exceeds bounds or has invalid/duplicate member identifiers.");
      roster.length = 0;
    }
    const saved = read(path8.join(".squad-pod", "layout.json"), 2 * 1024 * 1024);
    const candidate = saved === null ? null : parseLayoutJson(saved);
    const parsed = candidate && isObserverLayout(candidate) ? candidate : null;
    if (saved !== null && !parsed) errors.push("Saved layout is malformed; showing bundled starter layout.");
    const layout2 = parsed ?? createDefaultOfficeLayout();
    ensureTileColors(layout2);
    const errorsBeforeLedger = errors.length;
    const ledger = read(path8.join(squad, "log", "usage.jsonl"), MAX_USAGE_BYTES);
    const usage = ledger === null ? {
      ...unavailableUsage(errorsBeforeLedger === errors.length ? "No local usage ledger. Live observation does not create recorded usage." : "Cannot read local usage ledger; see source diagnostics. Live observation does not create recorded usage."),
      state: errorsBeforeLedger === errors.length ? "missing" : "error"
    } : parseRecordedUsage(ledger, declared.allMembers);
    usage.sourcePath = path8.join(files.root, squad, "log", "usage.jsonl");
    const active = /* @__PURE__ */ new Map();
    const identities = new Map(roster.map((member) => [member.slug, { id: member.slug, name: member.name }]));
    const seen = /* @__PURE__ */ new Set();
    for (const folder of options.fileActivity === false ? [] : ["sessions", "log", "orchestration-log"]) {
      let names = [];
      try {
        names = files.entries(path8.join(squad, folder));
      } catch (error) {
        errors.push(`${folder}: ${String(error)}`);
      }
      for (const name of names) {
        if (!(folder === "sessions" ? name.endsWith(".json") : name.endsWith(".md"))) continue;
        const relative6 = path8.join(squad, folder, name);
        const content = read(relative6, 128 * 1024);
        if (content === null) continue;
        seen.add(relative6);
        const hash = createHash2("sha256").update(content).digest("hex");
        const prior = activity.get(relative6);
        const changedAt = !observeActivity ? null : prior?.hash === hash ? prior.changedAt : Date.now();
        const reportedAgent = folder === "sessions" ? parseSessionFile(content)?.agent : detectAgentFromFilename(name) ?? parseLogEntry(content)?.agent;
        const agent2 = reportedAgent ? resolveFileAgentId(reportedAgent, identities) : null;
        const observedAt = agent2 && liveAgents.has(agent2) ? null : changedAt;
        activity.set(relative6, { hash, changedAt: observedAt, agentId: agent2 });
        if (agent2 && observedAt !== null && Date.now() - observedAt < 3e4) active.set(agent2, observedAt);
      }
    }
    for (const key of activity.keys()) if (!seen.has(key)) activity.delete(key);
    let preferences = null;
    try {
      preferences = office.readPreferences().value;
    } catch (error) {
      errors.push(`Office preferences: ${String(error)}`);
    }
    latestAgents = roster.map((member) => ({
      id: member.slug,
      name: member.name,
      role: member.role,
      paletteIndex: preferences?.agents[member.slug]?.palette ?? createHash2("sha256").update(member.slug).digest()[0] % 6,
      seatId: preferences?.agents[member.slug]?.seatId ?? null,
      status: active.has(member.slug) ? "active" : "idle",
      currentTask: active.has(member.slug) ? "Approximate local file activity (not live tool execution)" : null,
      currentTaskSource: active.has(member.slug) ? "file" : null
    }));
    liveMessages = [];
    if (live) {
      if (!liveStarted) {
        liveStarted = true;
        live.start(false);
      } else live.replay();
      const selection = options.sessionSelection?.();
      liveStatus = {
        ...liveStatus,
        selection: selection?.preferredId === null ? "unavailable" : selection?.preferredId ? "owned-session" : "matching-project",
        reason: selection?.preferredId ? liveStatus.state === "following" ? "Exact server-generated owned session; canonical project and Squad marker verified." : selection.reason ?? "Waiting for the exact owned session." : selection?.reason ?? "Newest matching-project Squad session; not an owned-terminal correlation."
      };
      latestAgents = latestAgents.map((agent2) => {
        const task = liveAgents.get(agent2.id);
        const fileActive = [...activity.values()].some((value) => value.agentId === agent2.id && value.changedAt !== null && Date.now() - value.changedAt < 3e4);
        return {
          ...agent2,
          status: liveAgents.has(agent2.id) || fileActive ? "active" : "idle",
          currentTask: liveAgents.has(agent2.id) ? task ?? null : fileActive ? "Approximate local file activity (not live tool execution)" : null,
          currentTaskSource: liveAgents.has(agent2.id) ? task ? "live" : null : fileActive ? "file" : null
        };
      });
    }
    return [
      { ...settings, ...preferences?.settings },
      { type: "sourceStatus", status: {
        workspaceRoot: files.root,
        squadDir: path8.join(files.root, squad),
        teamFound: declared.status === "available" || declared.status === "invalid",
        observer: "watching",
        nativeWatch: false,
        liveActivity: liveStatus,
        error: errors.length ? errors.slice(0, 8).join("\n").slice(0, 4096) : null
      } },
      { type: "layoutLoaded", layout: layout2, revision: saved === null ? null : createHash2("sha256").update(saved).digest("hex"), workspaceRoot: files.root },
      { type: "existingAgents", agents: latestAgents },
      { type: "recordedUsage", snapshot: usage },
      ...liveMessages
    ];
  }
  async function snapshot() {
    if (disposed) throw new Error("Observer disposed.");
    return [assets, ...readSnapshot()];
  }
  function subscribe(listener) {
    if (disposed) throw new Error("Observer disposed.");
    listeners.add(listener);
    if (!timer) {
      readSnapshot(false);
      timer = setInterval(() => {
        const messages = readSnapshot();
        const liveTypes = new Set(liveMessages.map((message) => message.type));
        const changes = messages.filter((message) => {
          if (liveTypes.has(message.type)) return false;
          const signature = JSON.stringify(message, (key, value) => key === "checkedAt" ? void 0 : value);
          if (fingerprints.get(message.type) === signature) return false;
          fingerprints.set(message.type, signature);
          return true;
        });
        if (live) {
          const signature = JSON.stringify(liveMessages);
          if (fingerprints.get("live") !== signature || changes.some((message) => message.type === "existingAgents")) {
            fingerprints.set("live", signature);
            changes.push(...liveMessages);
          }
        }
        if (changes.length) for (const notify of listeners) notify(changes);
      }, pollMs);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && timer) {
        clearInterval(timer);
        timer = void 0;
        live?.stop();
        liveStarted = false;
        liveMessages = [];
      }
    };
  }
  async function onRead(message) {
    if (message.type === "getSettings") return [{ ...settings, ...office.readPreferences().value?.settings }];
    if (message.type !== "requestAgentDetail") return [];
    const agent2 = latestAgents.find((a) => a.id === message.agentId);
    if (!agent2) throw new Error("Unknown observed agent.");
    return [{
      type: "agentDetailLoaded",
      ...message.requestId !== void 0 ? { requestId: message.requestId } : {},
      detail: {
        id: agent2.id,
        name: agent2.name,
        role: agent2.role,
        workspaceRoot: files.root,
        status: agent2.status,
        currentTask: agent2.currentTask,
        currentTaskSource: agent2.currentTaskSource,
        charterSummary: null,
        recentActivity: [],
        charterContent: null,
        charterStatus: "unavailable",
        expertise: null,
        responsibilities: null,
        boundaries: null,
        lastActiveAt: 0,
        lastActiveAtStatus: "unobserved"
      }
    }];
  }
  return {
    root: files.root,
    snapshot,
    subscribe,
    onRead,
    dispose() {
      disposed = true;
      live?.stop();
      if (timer) clearInterval(timer);
      timer = void 0;
      listeners.clear();
      activity.clear();
    },
    get subscriptionCount() {
      return listeners.size;
    }
  };
}

// src/transport.ts
import { createHash as createHash4, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join as join10, resolve as resolve3 } from "node:path";

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// ../src/core/terminalFrames.ts
var TERMINAL_VERSION = 1;
var TERMINAL_LIMITS = {
  frameBytes: 64 * 1024,
  inputBytes: 16 * 1024,
  historyBytes: 1024 * 1024,
  historyFrames: 4096,
  pendingBytes: 1024 * 1024,
  pendingFrames: 4096
};
function runId(value) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error("Invalid run identity");
  }
  return value;
}
function utf8Bytes(text6) {
  return new TextEncoder().encode(text6).byteLength;
}
function integer3(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function validUnicode(text6) {
  for (let i = 0; i < text6.length; i++) {
    const code = text6.charCodeAt(i);
    if (code >= 55296 && code <= 56319) {
      const next = text6.charCodeAt(++i);
      if (!(next >= 56320 && next <= 57343)) {
        return false;
      }
    } else if (code >= 56320 && code <= 57343) {
      return false;
    }
  }
  return true;
}
function decodeTerminalFrame(json) {
  if (json.length > TERMINAL_LIMITS.frameBytes || utf8Bytes(json) > TERMINAL_LIMITS.frameBytes) {
    throw new Error("Terminal frame exceeds byte limit");
  }
  const value = JSON.parse(json);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal frame");
  }
  const frame = value;
  if (frame.version !== TERMINAL_VERSION || typeof frame.runId !== "string") {
    throw new Error("Unsupported terminal version or identity");
  }
  runId(frame.runId);
  let fields;
  let valid;
  switch (frame.type) {
    case "attach":
      fields = ["cursor"];
      valid = integer3(frame.cursor);
      break;
    case "input":
      fields = ["data"];
      valid = typeof frame.data === "string" && validUnicode(frame.data) && utf8Bytes(frame.data) <= TERMINAL_LIMITS.inputBytes;
      break;
    case "resize":
      fields = ["cols", "rows"];
      valid = integer3(frame.cols, 1, 1e3) && integer3(frame.rows, 1, 1e3);
      break;
    case "terminate":
      fields = [];
      valid = true;
      break;
    case "output":
      fields = ["seq", "data"];
      valid = integer3(frame.seq, 1) && typeof frame.data === "string" && frame.data.length > 0 && validUnicode(frame.data);
      break;
    case "replayStart":
      fields = ["cursor", "through"];
      valid = integer3(frame.cursor) && integer3(frame.through) && frame.through >= frame.cursor;
      break;
    case "replayEnd":
      fields = ["through"];
      valid = integer3(frame.through);
      break;
    case "resync":
      fields = ["reason", "earliest", "latest"];
      valid = typeof frame.reason === "string" && ["history-gap", "cursor-ahead", "overflow", "source-error"].includes(frame.reason) && integer3(frame.earliest, 1) && integer3(frame.latest) && frame.earliest <= frame.latest + 1;
      break;
    default:
      throw new Error("Unsupported terminal message");
  }
  const keys3 = ["version", "runId", "type", ...fields];
  if (!valid || Object.keys(frame).some((key) => !keys3.includes(key))) {
    throw new Error("Invalid terminal fields");
  }
  return value;
}
function encodeTerminalFrame(frame) {
  const json = JSON.stringify(frame);
  decodeTerminalFrame(json);
  return json;
}
function decodeTerminalCommand(json) {
  const frame = decodeTerminalFrame(json);
  if (frame.type === "attach" || frame.type === "input" || frame.type === "resize" || frame.type === "terminate") {
    return frame;
  }
  throw new Error("Expected terminal command");
}

// ../src/core/terminalReplay.ts
function attachTerminal(source, cursor, sink) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("Invalid reconnect cursor");
  }
  let stopped = false;
  let replaying = true;
  let draining = false;
  let pending = [];
  let replay;
  let inFlight;
  let bytes = 0;
  let latest = 0;
  let earliest = 1;
  const subscription = {};
  const dispose = () => {
    stopped = true;
    pending = [];
    replay = void 0;
    inFlight = void 0;
    bytes = 0;
    subscription.unsubscribe?.();
    subscription.failure?.();
  };
  const fail = (reason2) => {
    if (stopped) {
      return;
    }
    dispose();
    sink.abort({ version: 1, type: "resync", runId: source.runId, reason: reason2, earliest, latest });
  };
  const reserve = (frames) => {
    const size = frames.reduce((total, frame) => total + utf8Bytes(encodeTerminalFrame(frame)), 0);
    if (bytes + size > TERMINAL_LIMITS.pendingBytes || pending.length + (inFlight ? 1 : 0) + frames.length > TERMINAL_LIMITS.pendingFrames) {
      fail("overflow");
      return false;
    }
    bytes += size;
    return true;
  };
  const drain = async () => {
    if (draining || replaying || stopped) {
      return;
    }
    draining = true;
    try {
      while (!stopped) {
        let frame;
        if (replay) {
          const next = replay.next();
          if (next.done) {
            replay = void 0;
            continue;
          }
          frame = next.value;
          if (!reserve([frame])) {
            return;
          }
        } else {
          if (!pending.length) {
            break;
          }
          frame = pending.shift();
        }
        inFlight = frame;
        await sink.send(frame);
        if (stopped) {
          break;
        }
        bytes -= utf8Bytes(encodeTerminalFrame(frame));
        inFlight = void 0;
      }
    } catch {
      fail("source-error");
    } finally {
      draining = false;
    }
  };
  subscription.unsubscribe = source.subscribe((frame) => {
    if (stopped) {
      return;
    }
    try {
      if (frame.runId !== source.runId) {
        throw new Error("Wrong source identity");
      }
      encodeTerminalFrame(frame);
      latest = Math.max(latest, frame.seq);
      if (reserve([frame])) {
        pending.push(frame);
        void drain();
      }
    } catch {
      fail("source-error");
    }
  });
  if (stopped) {
    subscription.unsubscribe();
  }
  subscription.failure = source.subscribeFailure?.(() => fail("source-error"));
  if (stopped) {
    subscription.failure?.();
  }
  const ready = (async () => {
    try {
      if (stopped) {
        return;
      }
      const snapshot = await source.snapshot(cursor);
      if (stopped) {
        return;
      }
      if (!Number.isSafeInteger(snapshot.through) || snapshot.through < 0 || !Number.isSafeInteger(snapshot.earliest) || snapshot.earliest < 1 || snapshot.earliest > snapshot.through + 1) {
        throw new Error("Invalid source snapshot");
      }
      earliest = snapshot.earliest;
      latest = Math.max(snapshot.through, latest);
      if (cursor > snapshot.through) {
        fail("cursor-ahead");
        return;
      }
      if (cursor < earliest - 1) {
        fail("history-gap");
        return;
      }
      if (snapshot.frames.length > TERMINAL_LIMITS.historyFrames) {
        throw new Error("Snapshot exceeds history frame limit");
      }
      let expected = cursor + 1;
      let snapshotBytes = 0;
      for (const frame of snapshot.frames) {
        if (frame.runId !== source.runId || frame.seq !== expected++ || frame.seq > snapshot.through) {
          throw new Error("Noncontiguous snapshot");
        }
        snapshotBytes += utf8Bytes(encodeTerminalFrame(frame));
        if (snapshotBytes > TERMINAL_LIMITS.historyBytes) {
          throw new Error("Snapshot exceeds history byte limit");
        }
      }
      if (expected - 1 !== snapshot.through) {
        throw new Error("Incomplete snapshot");
      }
      pending = pending.filter((frame) => frame.type === "output" && frame.seq > snapshot.through);
      bytes = pending.reduce((total, frame) => total + utf8Bytes(encodeTerminalFrame(frame)), 0);
      replay = (function* () {
        yield { version: 1, type: "replayStart", runId: source.runId, cursor, through: snapshot.through };
        yield* snapshot.frames;
        yield { version: 1, type: "replayEnd", runId: source.runId, through: snapshot.through };
      })();
      replaying = false;
      await drain();
    } catch {
      fail("source-error");
    }
  })();
  return { ready, dispose };
}

// ../src/core/ownedTerminalProtocol.ts
var OWNED_LAUNCH_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
function object3(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal message");
  }
  return value;
}
function exact(value, fields) {
  if (Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("Invalid terminal message fields");
  }
}
function parse(json) {
  if (json.length > TERMINAL_LIMITS.frameBytes || utf8Bytes(json) > TERMINAL_LIMITS.frameBytes) {
    throw new Error("Terminal frame exceeds byte limit");
  }
  const value = object3(JSON.parse(json));
  if (value.version !== 1) {
    throw new Error("Unsupported terminal version");
  }
  return value;
}
function decodeOwnedTerminalCommand(json) {
  const value = parse(json);
  if (value.type === "list") {
    exact(value, ["version", "type"]);
    return { version: 1, type: "list" };
  }
  if (value.type === "launch") {
    exact(value, ["version", "type", "requestId"]);
    if (typeof value.requestId !== "string" || !OWNED_LAUNCH_REQUEST_ID.test(value.requestId)) {
      throw new Error("Invalid terminal launch request identity");
    }
    return value;
  }
  return decodeTerminalCommand(json);
}

// src/terminalSocket.ts
function terminalSocket(ws, runs, current) {
  let active = true;
  let busy = false;
  let alive = true;
  let received = 0;
  let windowStart = Date.now();
  let attachment;
  let sendTimer;
  const timers = /* @__PURE__ */ new Set();
  const valid = () => active && current() && ws.readyState === import_websocket.default.OPEN;
  const cleanup = () => {
    if (!active) return;
    active = false;
    attachment?.dispose();
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(sendTimer);
    for (const timer of timers) clearTimeout(timer);
  };
  const stop = () => {
    cleanup();
    ws.terminate();
  };
  const send = (json) => {
    if (!valid()) return;
    if (ws.bufferedAmount + Buffer.byteLength(json) > TERMINAL_LIMITS.pendingBytes) {
      stop();
      return;
    }
    if (!sendTimer) sendTimer = setTimeout(stop, 1e4);
    ws.send(json, (error) => {
      if (error) {
        stop();
        return;
      }
      if (ws.bufferedAmount === 0) {
        clearTimeout(sendTimer);
        sendTimer = void 0;
      }
    });
  };
  const status = () => send(JSON.stringify(runs.status()));
  const unsubscribe = runs.subscribe(status);
  const heartbeat = setInterval(() => {
    if (!valid() || !alive) {
      stop();
      return;
    }
    alive = false;
    ws.ping(void 0, void 0, (error) => {
      if (error) stop();
    });
  }, 15e3);
  heartbeat.unref();
  ws.on("pong", () => {
    alive = true;
  });
  ws.on("error", stop);
  ws.on("close", cleanup);
  status();
  ws.on("message", (data, binary) => {
    if (!valid()) return;
    const now = Date.now();
    if (now - windowStart >= 1e3) {
      windowStart = now;
      received = 0;
    }
    if (++received > 64 || binary) {
      send(JSON.stringify({
        version: 1,
        type: "error",
        message: "Terminal rate/protocol limit reached. Some input may not have been applied."
      }));
      ws.close(1008, "Terminal rate/protocol limit");
      const timer = setTimeout(stop, 1e3);
      timers.add(timer);
      return;
    }
    let command2;
    try {
      command2 = decodeOwnedTerminalCommand(data.toString());
    } catch (error) {
      send(JSON.stringify({ version: 1, type: "error", message: String(error) }));
      return;
    }
    if (busy) {
      const message = "Owned action in progress.";
      if (command2.type === "launch") {
        send(JSON.stringify({
          version: 1,
          type: "launchResult",
          requestId: command2.requestId,
          result: { ok: false, message }
        }));
      } else send(JSON.stringify({ version: 1, type: "error", message }));
      return;
    }
    try {
      if (command2.type === "list") {
        status();
        return;
      }
      if (command2.type === "launch") {
        busy = true;
        void runs.launch(valid).then((run) => {
          if (valid()) send(JSON.stringify({
            version: 1,
            type: "launchResult",
            requestId: command2.requestId,
            result: { ok: true, runId: run.runId }
          }));
        }).catch((error) => {
          if (valid()) send(JSON.stringify({
            version: 1,
            type: "launchResult",
            requestId: command2.requestId,
            result: { ok: false, message: String(error).slice(0, 1024) }
          }));
        }).finally(() => {
          busy = false;
        });
        return;
      }
      if (command2.type === "attach") {
        const source = runs.source(command2.runId);
        attachment?.dispose();
        attachment = attachTerminal(source, command2.cursor, {
          send: (frame) => new Promise((resolve4, reject) => {
            if (!valid()) {
              reject(new Error("Terminal authorization ended."));
              return;
            }
            const json = encodeTerminalFrame(frame);
            if (ws.bufferedAmount + Buffer.byteLength(json) > TERMINAL_LIMITS.pendingBytes) {
              reject(new Error("Terminal transport overflow."));
              return;
            }
            const timer = setTimeout(() => {
              timers.delete(timer);
              reject(new Error("Slow terminal client."));
              stop();
            }, 1e4);
            timers.add(timer);
            ws.send(json, (error) => {
              clearTimeout(timer);
              timers.delete(timer);
              if (!valid() || error) reject(error ?? new Error("Terminal authorization ended."));
              else resolve4();
            });
          }),
          abort: (frame) => {
            if (!valid()) return;
            send(encodeTerminalFrame(frame));
            ws.close(4009, "Terminal requires explicit resync");
            const timer = setTimeout(stop, 1e3);
            timers.add(timer);
          }
        });
      } else if (command2.type === "terminate") {
        runs.source(command2.runId);
        busy = true;
        attachment?.dispose();
        void runs.close(command2.runId).catch((error) => {
          if (valid()) send(JSON.stringify({ version: 1, type: "error", message: String(error) }));
        }).finally(() => {
          busy = false;
        });
      } else {
        Promise.resolve(runs.command(command2)).catch((error) => {
          if (valid()) send(JSON.stringify({ version: 1, type: "error", message: String(error).slice(0, 1024) }));
        });
      }
    } catch (error) {
      send(JSON.stringify({ version: 1, type: "error", message: String(error) }));
    }
  });
  return cleanup;
}

// src/officeControl.ts
import { createHash as createHash3 } from "node:crypto";
import * as path9 from "node:path";
var MAX_CONTROL_FRAME = 2 * 1024 * 1024 + 8192;
var record3 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var keys = (v, names) => Object.keys(v).length === names.length && names.every((key) => Object.hasOwn(v, key));
var validRevision = (v) => v === null || typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function decodeControl(value) {
  if (!record3(value) || !keys(value, ["version", "kind", "requestId", "expectedRevision", "message"]) || value.version !== 1 || value.kind !== "control" || !Number.isSafeInteger(value.requestId) || typeof value.requestId !== "number" || value.requestId < 1 || !validRevision(value.expectedRevision) || !record3(value.message)) throw new Error("Invalid control frame.");
  const m = value.message;
  if (m.type === "saveLayout") {
    if (!keys(m, ["type", "layout", "expectedRevision", "workspaceRoot"]) || !validRevision(m.expectedRevision) || m.expectedRevision !== value.expectedRevision || typeof m.workspaceRoot !== "string" || m.workspaceRoot.length > 8192 || !isObserverLayout(m.layout)) throw new Error("Invalid layout mutation.");
  } else if (!validPreferenceMutation(m)) throw new Error("Invalid or unsupported office mutation.");
  return value;
}
function createOfficeControl(project) {
  const store = new OfficeStore(project);
  const files = new ProjectFiles(project);
  const projectIdentity = createHash3("sha256").update(store.root).digest("hex");
  function preferences() {
    return store.readPreferences();
  }
  function mutate(request, assertAuthority) {
    const message = request.message;
    if (message.type === "saveLayout") {
      if (message.workspaceRoot !== store.root) throw new Error("Selected project identity does not match.");
      const saved2 = store.saveLayout(message.layout, request.expectedRevision, assertAuthority);
      if (!saved2.saved) {
        return [
          ...saved2.value ? [{ type: "layoutLoaded", layout: saved2.value, revision: saved2.revision, workspaceRoot: store.root }] : [],
          { type: "layoutError", error: "Save conflict: the saved office changed. Your draft was kept; resolve or export both versions before retrying." }
        ];
      }
      return [{ type: "layoutSaved", layout: saved2.value, revision: saved2.revision }];
    }
    const current = preferences();
    let squad = ".squad";
    try {
      files.resolve(squad);
    } catch (error) {
      if (error.code === "ENOENT") squad = ".ai-team";
      else throw error;
    }
    const roster = files.read(path9.join(squad, "team.md"), 256 * 1024);
    const ids = new Set(parseTeamRoster(roster ?? "").map((agent2) => agent2.slug));
    const next = structuredClone(current.value ?? defaultPreferences());
    if (message.type === "saveAgentSeats") {
      if (Object.keys(message.seats).some((id2) => !ids.has(id2))) throw new Error("Seat change contains an unknown selected-project agent.");
      for (const [id2, meta] of Object.entries(next.agents)) {
        if (ids.has(id2) && meta.seatId !== void 0) delete next.agents[id2].seatId;
      }
      for (const [id2, seatId] of Object.entries(message.seats)) {
        Object.defineProperty(next.agents, id2, {
          value: { ...next.agents[id2], seatId },
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    } else {
      const key = message.type === "setSoundEnabled" ? "soundEnabled" : message.type === "setDebugEnabled" ? "debugEnabled" : "showAreas";
      next.settings[key] = message.enabled;
    }
    const saved = store.savePreferences(next, request.expectedRevision, ids, assertAuthority);
    const result = saved.value ?? defaultPreferences();
    return [
      { type: "settingsLoaded", ...result.settings },
      ...!saved.saved ? [{ type: "layoutError", error: "Preferences conflict: another viewer or external edit changed settings/seats. Your requested change was not saved; reload and deliberately retry." }] : []
    ];
  }
  return { store, projectIdentity, preferences, mutate };
}

// src/canvas/rendering.ts
var import_pngjs2 = __toESM(require_png(), 1);
import { randomBytes } from "node:crypto";

// ../src/canvasRendering.ts
var SNAPSHOT_WIDTH = 1024;
var SNAPSHOT_HEIGHT = 768;
var SNAPSHOT_BYTES = 1024 * 1024;
var SNAPSHOT_FRAME = Math.ceil(SNAPSHOT_BYTES / 3) * 4 + 1024;
var SNAPSHOT_TIMEOUT = 2e3;
function isCanvasPaint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const v = value;
  return Object.keys(v).length === 6 && typeof v.firstPaintTime === "number" && Number.isFinite(v.firstPaintTime) && v.firstPaintTime >= 0 && v.firstPaintTime <= Number.MAX_SAFE_INTEGER && Number.isSafeInteger(v.frameCount) && Number(v.frameCount) > 0 && Number(v.frameCount) <= 65535 && Number.isSafeInteger(v.width) && Number(v.width) > 0 && Number(v.width) <= 32768 && Number.isSafeInteger(v.height) && Number(v.height) > 0 && Number(v.height) <= 32768 && (v.visibilityState === "visible" || v.visibilityState === "hidden") && (v.onScreen === null || typeof v.onScreen === "boolean");
}

// src/canvas/rendering.ts
var unavailable = () => new Error("CANVAS_SNAPSHOT_UNAVAILABLE");
var CanvasRendering = class {
  constructor(send) {
    this.send = send;
  }
  send;
  paint = null;
  disposed = false;
  pending;
  state() {
    return this.paint ? { ...this.paint } : null;
  }
  receive(value) {
    if (this.disposed || value.version !== 1) return false;
    if (value.kind === "rendered") {
      if (Object.keys(value).length !== 3 || !isCanvasPaint(value.paint)) return false;
      this.paint ??= { ...value.paint };
      return true;
    }
    if (value.kind !== "snapshotResult") return false;
    const pending = this.pending;
    if (!pending || value.requestId !== pending.id) return false;
    this.pending = void 0;
    clearTimeout(pending.timer);
    try {
      if (Date.now() >= pending.deadline || Object.keys(value).length !== 4 || typeof value.png !== "string" || !value.png || value.png.length > Math.ceil(SNAPSHOT_BYTES / 3) * 4 || value.png.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.png)) throw unavailable();
      const bytes = Buffer.from(value.png, "base64");
      if (bytes.length > SNAPSHOT_BYTES || bytes.toString("base64") !== value.png || bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw unavailable();
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > SNAPSHOT_WIDTH || height > SNAPSHOT_HEIGHT) throw unavailable();
      const image = import_pngjs2.PNG.sync.read(bytes, { checkCRC: true });
      if (image.width !== width || image.height !== height) throw unavailable();
      pending.resolve(value.png);
      return true;
    } catch {
      pending.reject(unavailable());
      return false;
    }
  }
  capture() {
    if (this.disposed || !this.paint || this.pending) return Promise.reject(unavailable());
    return new Promise((resolve4, reject) => {
      const id2 = randomBytes(16).toString("hex");
      const timer = setTimeout(() => {
        this.pending = void 0;
        reject(unavailable());
      }, SNAPSHOT_TIMEOUT);
      this.pending = { id: id2, resolve: resolve4, reject, timer, deadline: Date.now() + SNAPSHOT_TIMEOUT };
      try {
        this.send(JSON.stringify({ version: 1, kind: "snapshotRequest", requestId: id2 }));
      } catch {
        this.dispose();
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.paint = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(unavailable());
      this.pending = void 0;
    }
  }
};

// src/transport.ts
var MAX_CONNECTIONS = 8;
var MAX_INBOUND = 4096;
var MAX_HOST_REQUEST = 4 * 1024 * 1024 + 8192;
var MAX_FRAME = 8 * 1024 * 1024;
var MAX_QUEUE = 16 * 1024 * 1024;
var READ_TIMEOUT = 5e3;
var SEND_TIMEOUT = 1e4;
var HEARTBEAT = 15e3;
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg"
};
function credential() {
  return randomBytes2(32).toString("base64url");
}
function equalCredential(candidate, expected) {
  const hash = (value) => createHash4("sha256").update(value).digest();
  return timingSafeEqual(hash(candidate), hash(expected));
}
function record4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys2(value, expected) {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function singleHeader(request, name) {
  let value;
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() !== name) {
      continue;
    }
    if (value !== void 0) {
      return void 0;
    }
    value = request.rawHeaders[i + 1];
  }
  return value;
}
async function indexStatic(root) {
  const files = /* @__PURE__ */ new Map();
  const absolute = resolve3(root);
  if (!(await lstat(absolute)).isDirectory() || (await lstat(absolute)).isSymbolicLink()) {
    throw new Error("Static root must be a regular directory");
  }
  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) {
        continue;
      }
      const path12 = join10(directory, entry.name);
      const url = `${prefix}/${entry.name}`;
      const stat2 = await lstat(path12);
      if (stat2.isSymbolicLink()) {
        continue;
      }
      if (stat2.isDirectory()) {
        await visit(path12, url);
      } else if (stat2.isFile() && MIME[extname(entry.name).toLowerCase()]) {
        files.set(url, { bytes: await readFile(path12), mime: MIME[extname(entry.name).toLowerCase()] });
      }
    }
  }
  await visit(absolute, "");
  if (!files.has("/index.html")) {
    throw new Error("Static bundle requires index.html");
  }
  return files;
}
function staticPath(url) {
  if (!url.startsWith("/") || url.startsWith("//") || /[?#\\\0]/.test(url)) {
    return void 0;
  }
  let path12;
  try {
    path12 = decodeURIComponent(url);
  } catch {
    return void 0;
  }
  if (/[\\\0?#]/.test(path12) || path12.split("/").some((part) => part === "." || part === "..")) {
    return void 0;
  }
  return path12 === "/" ? "/index.html" : path12;
}
function command(payload) {
  if (!record4(payload) || !keys2(payload, ["version", "kind", "message"]) || payload.version !== 1 || payload.kind !== "office" || !record4(payload.message)) {
    return { error: "INVALID_MESSAGE" };
  }
  const message = payload.message;
  if (typeof message.type !== "string") {
    return { error: "INVALID_MESSAGE" };
  }
  if (message.type !== "webviewReady" && message.type !== "getSettings" && message.type !== "requestAgentDetail") {
    return { error: "READ_ONLY" };
  }
  if (message.type === "requestAgentDetail") {
    if (!keys2(message, ["type", "agentId", "requestId"]) || typeof message.agentId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(message.agentId) || message.requestId !== void 0 && (typeof message.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.requestId))) {
      return { error: "INVALID_MESSAGE" };
    }
    return { message: {
      type: "requestAgentDetail",
      agentId: message.agentId,
      ...message.requestId !== void 0 ? { requestId: message.requestId } : {}
    } };
  }
  if (!keys2(message, ["type"])) {
    return { error: "INVALID_MESSAGE" };
  }
  return { message: { type: message.type } };
}
async function startTransport(options) {
  if (options.host !== void 0 && options.host !== "127.0.0.1") {
    throw new Error("Only the 127.0.0.1 loopback listener is supported");
  }
  if (options.port !== void 0 && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error("Invalid port");
  }
  if (options.canvas && options.terminals) {
    throw new Error("Canvas does not support terminal authority");
  }
  const files = await indexStatic(options.staticRoot);
  const observe = (event) => {
    if (options.canvas) options.canvasReadiness?.(event);
  };
  let token = credential();
  let session = credential();
  let terminalToken = credential();
  let terminalSession = credential();
  let controlToken = credential();
  let controlSession = credential();
  const controlNonces = /* @__PURE__ */ new Set();
  const serverIdentity = credential();
  let generation = 0;
  let disposed = false;
  let disposal;
  let port = 0;
  const sockets = /* @__PURE__ */ new Set();
  const cleanups = /* @__PURE__ */ new Map();
  const renderers = /* @__PURE__ */ new Set();
  const wss = new import_websocket_server.default({
    noServer: true,
    maxPayload: options.canvas ? SNAPSHOT_FRAME : MAX_INBOUND,
    perMessageDeflate: false,
    clientTracking: true
  });
  const terminals = new import_websocket_server.default({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false
  });
  const controls = new import_websocket_server.default({
    noServer: true,
    maxPayload: MAX_CONTROL_FRAME,
    perMessageDeflate: false
  });
  const origin = () => `http://127.0.0.1:${port}`;
  const cookieName = (terminal2 = false) => `squad_${terminal2 ? "terminal" : "office"}_${port}`;
  const controlCookie = () => `squad_control_${port}`;
  const validHost = (request) => {
    const host = singleHeader(request, "host");
    return host === `127.0.0.1:${port}`;
  };
  const validOrigin = (request) => singleHeader(request, "origin") === origin();
  const authenticated = (request, terminal2 = false) => {
    const header = singleHeader(request, "cookie");
    if (!header || header.length > 4096) {
      return false;
    }
    const cookies = header.split(";").map((part) => part.trim().split("="));
    const matches = cookies.filter(([name]) => name === cookieName(terminal2));
    return matches.length === 1 && matches[0].length === 2 && equalCredential(matches[0][1], terminal2 ? terminalSession : session);
  };
  const controlAuthenticated = (request) => {
    const header = singleHeader(request, "cookie");
    if (!options.officeControl || !header || header.length > 4096) return false;
    const matches = header.split(";").map((part) => part.trim().split("=")).filter(([name]) => name === controlCookie());
    return matches.length === 1 && matches[0].length === 2 && equalCredential(matches[0][1], controlSession);
  };
  const headers = (response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "media-src 'self'",
      `connect-src 'self' ws://127.0.0.1:${port}`,
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'"
    ].join("; "));
  };
  const reply = (response, status, code) => {
    if (response.writableEnded || response.destroyed) {
      return;
    }
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ version: 1, kind: "error", code }));
  };
  const server = createServer({ maxHeaderSize: MAX_INBOUND }, (request, response) => {
    headers(response);
    if (options.canvas) {
      const resource = files.get(staticPath(request.url ?? "") ?? "");
      if (request.method === "GET" || request.method === "HEAD") {
        if (resource?.mime.startsWith("text/html")) observe("documentRequests");
        if (resource?.mime.startsWith("text/javascript")) observe("scriptRequests");
      }
      const outcome = request.url === "/auth" ? "viewerBootstrap" : request.url === "/office-context" ? "officeContext" : void 0;
      if (outcome) response.once("finish", () => observe(
        `${outcome}${response.statusCode === (outcome === "viewerBootstrap" ? 204 : 200) ? "Successes" : "Refusals"}`
      ));
    }
    if (!validHost(request)) {
      reply(response, 403, "FORBIDDEN");
      return;
    }
    if (options.canvas && request.url === "/canvas-host" && request.method === "POST") {
      if (!options.canvasHost || !validOrigin(request) || !authenticated(request) || singleHeader(request, "content-type") !== "application/json") {
        reply(response, 403, "FORBIDDEN");
        return;
      }
      const admittedGeneration = generation;
      let size = 0;
      const chunks = [];
      const timer = setTimeout(() => {
        reply(response, 408, "TIMEOUT");
        request.destroy();
      }, READ_TIMEOUT);
      request.once("close", () => clearTimeout(timer));
      request.on("error", () => clearTimeout(timer));
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_HOST_REQUEST) {
          clearTimeout(timer);
          reply(response, 413, "TOO_LARGE");
          response.once("finish", () => request.destroy());
        } else chunks.push(chunk);
      });
      request.once("end", () => {
        clearTimeout(timer);
        if (size > MAX_HOST_REQUEST || disposed) return;
        if (generation !== admittedGeneration) {
          reply(response, 403, "FORBIDDEN");
          return;
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reply(response, 400, "INVALID_MESSAGE");
          return;
        }
        void options.canvasHost(input, controlAuthenticated(request)).then((result) => {
          if (disposed || generation !== admittedGeneration) {
            reply(response, 403, "FORBIDDEN");
            return;
          }
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        }, () => reply(response, 503, "HOST_UNAVAILABLE"));
      });
      return;
    }
    if (options.canvas && request.url === "/control-intent" && request.method === "POST") {
      if (!options.officeControl || !validOrigin(request) || !authenticated(request)) {
        reply(response, 403, "FORBIDDEN");
        return;
      }
      if (controlNonces.size >= MAX_CONNECTIONS) controlNonces.delete(controlNonces.values().next().value);
      const nonce = credential();
      controlNonces.add(nonce);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ nonce }));
      return;
    }
    if ((request.url === "/auth" || request.url === "/terminal-auth" || request.url === "/control-auth") && request.method === "POST") {
      const terminal2 = request.url === "/terminal-auth";
      const control = request.url === "/control-auth";
      const panelControl = options.canvas && control;
      if (options.canvas && terminal2) {
        reply(response, 403, "READ_ONLY");
        return;
      }
      if (control && !options.officeControl) {
        reply(response, 403, "CONTROL_DISABLED");
        return;
      }
      if (panelControl && !authenticated(request)) {
        reply(response, 403, "FORBIDDEN");
        return;
      }
      const startedGeneration = generation;
      if (!validOrigin(request)) {
        reply(response, 403, "FORBIDDEN");
        return;
      }
      if (singleHeader(request, "content-type")?.toLowerCase().split(";")[0].trim() !== "application/json") {
        reply(response, 415, "INVALID_MESSAGE");
        return;
      }
      let size = 0;
      const chunks = [];
      const timeout = setTimeout(() => {
        reply(response, 408, "TIMEOUT");
        request.destroy();
      }, READ_TIMEOUT);
      request.once("close", () => clearTimeout(timeout));
      request.on("error", () => clearTimeout(timeout));
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_INBOUND) {
          clearTimeout(timeout);
          reply(response, 413, "TOO_LARGE");
          response.once("finish", () => request.destroy());
          return;
        }
        chunks.push(chunk);
      });
      request.once("end", () => {
        clearTimeout(timeout);
        if (size > MAX_INBOUND || disposed) {
          return;
        }
        if (generation !== startedGeneration) {
          reply(response, 403, "FORBIDDEN");
          return;
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reply(response, 400, "INVALID_MESSAGE");
          return;
        }
        if (panelControl) {
          if (!authenticated(request) || !record4(body) || !keys2(body, ["nonce"]) || typeof body.nonce !== "string" || !controlNonces.delete(body.nonce)) {
            reply(response, 403, "FORBIDDEN");
            return;
          }
        } else if (!record4(body) || !keys2(body, ["token"]) || typeof body.token !== "string" || body.token.length > 128 || !equalCredential(body.token, control ? controlToken : terminal2 ? terminalToken : token)) {
          reply(response, 403, "FORBIDDEN");
          return;
        }
        response.setHeader("Set-Cookie", `${control ? controlCookie() : cookieName(terminal2)}=${control ? controlSession : terminal2 ? terminalSession : session}; HttpOnly; SameSite=Strict; Path=/`);
        if (options.canvas && !control) token = credential();
        response.writeHead(204);
        response.end();
      });
      return;
    }
    if (request.url === "/office-context" && request.method === "GET") {
      if (!authenticated(request) && !controlAuthenticated(request)) {
        reply(response, 403, "FORBIDDEN");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        serverIdentity,
        projectIdentity: options.officeControl?.projectIdentity ?? null,
        ...options.canvas ? {
          controlAuthorized: controlAuthenticated(request),
          hostCapabilities: options.canvasHost?.available?.()
        } : {}
      }));
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      reply(response, 405, "METHOD_NOT_ALLOWED");
      return;
    }
    const path12 = staticPath(request.url ?? "");
    const file = path12 && files.get(path12);
    if (!file) {
      reply(response, 404, "NOT_FOUND");
      return;
    }
    response.writeHead(200, { "Content-Type": file.mime, "Content-Length": file.bytes.length });
    response.end(request.method === "HEAD" ? void 0 : file.bytes);
  });
  server.maxConnections = MAX_CONNECTIONS;
  server.headersTimeout = READ_TIMEOUT;
  server.requestTimeout = READ_TIMEOUT;
  server.keepAliveTimeout = 1e3;
  server.setTimeout(SEND_TIMEOUT, (socket) => socket.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("upgrade", (request, socket, head) => {
    const terminal2 = request.url === "/terminal";
    const control = request.url === "/control";
    if (disposed || request.method !== "GET" || request.url !== "/office" && !terminal2 && !control || terminal2 && !options.terminals || !validHost(request) || !validOrigin(request) || !(control ? controlAuthenticated(request) : authenticated(request, terminal2)) || wss.clients.size + terminals.clients.size + controls.clients.size >= MAX_CONNECTIONS) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const target = terminal2 ? terminals : control ? controls : wss;
    target.handleUpgrade(request, socket, head, (ws) => target.emit("connection", ws, control));
  });
  terminals.on("connection", (ws) => {
    const admittedGeneration = generation;
    const cleanup = terminalSocket(ws, options.terminals, () => !disposed && generation === admittedGeneration);
    cleanups.set(ws, cleanup);
    ws.once("close", () => cleanups.delete(ws));
  });
  const handleOffice = (ws, control) => {
    if (!control) {
      observe("officeSocketAdmissions");
      ws.once("close", () => observe("officeSocketClosures"));
    }
    const admittedGeneration = generation;
    let lastMutationId = 0;
    let active = true;
    let ready = false;
    let initializing = false;
    let busy = false;
    let alive = true;
    let faults = 0;
    let windowStart = Date.now();
    let received = 0;
    let queued = 0;
    let pending = [];
    let unsubscribe;
    let sendTimer;
    let readTimer;
    const rendering = options.canvas ? new CanvasRendering((frame) => sendFrame(frame)) : void 0;
    if (rendering) renderers.add(rendering);
    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      clearInterval(heartbeat);
      clearTimeout(sendTimer);
      clearTimeout(readTimer);
      pending = [];
      queued = 0;
      cleanups.delete(ws);
      if (rendering) {
        renderers.delete(rendering);
        rendering.dispose();
      }
      try {
        unsubscribe?.();
      } catch {
        console.error("Observer subscription cleanup failed; socket was closed.");
      }
    };
    const stop = () => {
      cleanup();
      ws.terminate();
    };
    const heartbeat = setInterval(() => {
      if (!alive) {
        stop();
        return;
      }
      alive = false;
      ws.ping(void 0, void 0, (error2) => {
        if (error2) {
          stop();
        }
      });
    }, HEARTBEAT);
    heartbeat.unref();
    cleanups.set(ws, cleanup);
    ws.on("close", cleanup);
    ws.on("error", stop);
    ws.on("pong", () => {
      alive = true;
    });
    const sendFrame = (frame, deferred = false) => {
      if (!active || ws.readyState !== import_websocket.default.OPEN) {
        return;
      }
      const bytes = Buffer.byteLength(frame);
      if (bytes > MAX_FRAME || queued + bytes > MAX_QUEUE || ws.bufferedAmount > MAX_QUEUE) {
        stop();
        return;
      }
      queued += bytes;
      if (!sendTimer) {
        sendTimer = setTimeout(stop, SEND_TIMEOUT);
        sendTimer.unref();
      }
      if (deferred) {
        pending.push(frame);
        return;
      }
      ws.send(frame, (error2) => {
        if (!active) {
          return;
        }
        queued -= bytes;
        if (error2) {
          stop();
          return;
        }
        if (queued === 0) {
          clearTimeout(sendTimer);
          sendTimer = void 0;
        }
      });
    };
    const error = (code) => {
      sendFrame(JSON.stringify({ version: 1, kind: "error", code }));
      if (++faults >= 8) {
        stop();
      }
    };
    const sendMessages = (messages, deferred = false) => {
      if (control && options.officeControl) {
        try {
          const preferences = options.officeControl.preferences();
          sendFrame(JSON.stringify({
            version: 1,
            kind: "controlState",
            preferencesRevision: preferences.revision,
            preferences: preferences.value ?? defaultPreferences()
          }), deferred);
        } catch {
          sendFrame(JSON.stringify({ version: 1, kind: "office", message: {
            type: "layoutError",
            error: "Cannot read office preferences. Saved source and draft were retained; recover the source before saving."
          } }), deferred);
        }
      }
      for (const message of messages) {
        if (!active) {
          break;
        }
        try {
          sendFrame(JSON.stringify({ version: 1, kind: "office", message }), deferred);
        } catch {
          error("INTERNAL_ERROR");
          stop();
          break;
        }
      }
    };
    const read = async (message) => {
      busy = true;
      if (message.type === "webviewReady") {
        ready = true;
        initializing = true;
        if (!control) observe("webviewReady");
      }
      readTimer = setTimeout(() => {
        error("TIMEOUT");
        stop();
      }, READ_TIMEOUT);
      readTimer.unref();
      try {
        const messages = await (message.type === "webviewReady" ? options.snapshot() : options.onRead?.(message) ?? Promise.resolve([]));
        if (!active) {
          return;
        }
        sendMessages(messages);
        if (initializing) {
          initializing = false;
          const events = pending;
          pending = [];
          for (const frame of events) {
            queued -= Buffer.byteLength(frame);
            sendFrame(frame);
          }
        }
      } catch {
        if (active) {
          error("INTERNAL_ERROR");
          stop();
        }
      } finally {
        clearTimeout(readTimer);
        busy = false;
      }
    };
    try {
      unsubscribe = options.subscribe((messages) => {
        if (ready && active) {
          sendMessages(messages, initializing);
        }
      });
    } catch {
      stop();
      return;
    }
    ws.on("message", (data, binary) => {
      if (!active) {
        return;
      }
      const now = Date.now();
      if (now - windowStart >= 1e3) {
        windowStart = now;
        received = 0;
      }
      if (++received > 32) {
        error("RATE_LIMIT");
        stop();
        return;
      }
      if (binary) {
        error("INVALID_MESSAGE");
        return;
      }
      if (Buffer.byteLength(data.toString()) > (control ? MAX_CONTROL_FRAME : options.canvas ? SNAPSHOT_FRAME : MAX_INBOUND)) {
        cleanup();
        ws.close(1009, "Office frame exceeds limit");
        const closing = setTimeout(() => ws.terminate(), 1e3);
        closing.unref();
        ws.once("close", () => clearTimeout(closing));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        error("INVALID_MESSAGE");
        return;
      }
      if (record4(payload) && (payload.kind === "rendered" || payload.kind === "snapshotResult")) {
        if (!ready || !rendering || !rendering.receive(payload)) error("INVALID_MESSAGE");
        return;
      }
      if (!control && Buffer.byteLength(data.toString()) > MAX_INBOUND) {
        error("INVALID_MESSAGE");
        return;
      }
      if (record4(payload) && payload.kind === "control") {
        if (!control || !options.officeControl) {
          error("READ_ONLY");
          return;
        }
        if (busy) {
          error("BUSY");
          return;
        }
        if (!ready) {
          error("NOT_READY");
          return;
        }
        try {
          const mutation = decodeControl(payload);
          if (mutation.requestId <= lastMutationId) {
            error("INVALID_MESSAGE");
            return;
          }
          lastMutationId = mutation.requestId;
          const assertAuthority = () => {
            if (!active || disposed || generation !== admittedGeneration || ws.readyState !== import_websocket.default.OPEN) {
              throw new Error("Office control revoked or disconnected.");
            }
          };
          assertAuthority();
          const messages = options.officeControl.mutate(mutation, assertAuthority);
          sendMessages([]);
          sendFrame(JSON.stringify({ version: 1, kind: "controlResult", requestId: mutation.requestId, messages }));
        } catch {
          sendMessages([{ type: "layoutError", error: "Office save failed: invalid data, changed authority, identity, or storage. Draft retained; export or reload before retrying." }]);
        }
        return;
      }
      const parsed = command(payload);
      if (!parsed.message) {
        error(parsed.error);
        return;
      }
      if (busy) {
        error("BUSY");
        return;
      }
      if (parsed.message.type === "webviewReady" && ready) {
        error("ALREADY_READY");
        return;
      }
      if (parsed.message.type !== "webviewReady" && !ready) {
        error("NOT_READY");
        return;
      }
      void read(parsed.message);
    });
  };
  wss.on("connection", (ws) => handleOffice(ws, false));
  controls.on("connection", (ws) => handleOffice(ws, true));
  try {
    await new Promise((accept, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => {
        server.off("error", reject);
        accept();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Listener has no address");
    }
    port = address.port;
  } catch (error) {
    wss.close();
    terminals.close();
    controls.close();
    server.close();
    throw error;
  }
  return {
    port,
    rendered: () => [...renderers].reverse().find((renderer) => renderer.state())?.state() ?? null,
    capture: () => {
      const renderer = [...renderers].reverse().find((candidate) => candidate.state());
      return renderer ? renderer.capture() : Promise.reject(new Error("CANVAS_SNAPSHOT_UNAVAILABLE"));
    },
    get token() {
      return token;
    },
    get terminalToken() {
      return terminalToken;
    },
    get controlToken() {
      return options.officeControl && !options.canvas ? controlToken : null;
    },
    rotate: () => {
      generation++;
      options.terminals?.revokeObservation();
      token = credential();
      session = credential();
      terminalToken = credential();
      terminalSession = credential();
      controlToken = credential();
      controlSession = credential();
      controlNonces.clear();
      for (const ws of [...wss.clients, ...terminals.clients, ...controls.clients]) {
        cleanups.get(ws)?.();
        ws.terminate();
      }
      return token;
    },
    dispose: () => {
      if (disposal) {
        return disposal;
      }
      disposed = true;
      generation++;
      controlNonces.clear();
      for (const ws of [...wss.clients, ...terminals.clients, ...controls.clients]) {
        cleanups.get(ws)?.();
        ws.terminate();
      }
      disposal = new Promise((accept, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            accept();
          }
        });
        for (const socket of sockets) {
          socket.destroy();
        }
      }).then(() => Promise.all([
        new Promise((accept) => wss.close(() => accept())),
        new Promise((accept) => terminals.close(() => accept())),
        new Promise((accept) => controls.close(() => accept())),
        options.terminals?.dispose()
      ])).then(() => void 0);
      return disposal;
    }
  };
}

// src/canvas/activity.ts
var record5 = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
var supported = /* @__PURE__ */ new Set([
  "tool.execution_start",
  "tool.execution_complete",
  "subagent.selected",
  "subagent.started",
  "subagent.configured",
  "subagent.completed",
  "subagent.failed",
  "subagent.aborted",
  "assistant.turn_start",
  "assistant.turn_end",
  "session.idle",
  "session.model_change",
  "session.usage_info"
]);
var MAX_ALIASES = 128;
var CanvasActivity = class {
  constructor(sessionId, post) {
    this.sessionId = sessionId;
    this.sink = post;
    this.lifecycle = new ActivityLifecycle({
      source: () => ({ sessionId: this.sessionId, limited: this.limited }),
      roster: () => this.roster,
      post: (message) => this.sink(message),
      lifecycle: (id2, active, task) => {
        if (active) this.running.set(id2, task);
        else this.running.delete(id2);
        this.status(id2);
      }
    });
  }
  sessionId;
  roster = [];
  running = /* @__PURE__ */ new Map();
  selected = /* @__PURE__ */ new Map();
  turns = /* @__PURE__ */ new Map();
  endedTurns = /* @__PURE__ */ new Set();
  instances = /* @__PURE__ */ new Map();
  dispatchMembers = /* @__PURE__ */ new Map();
  gauges = /* @__PURE__ */ new Map();
  starts = /* @__PURE__ */ new Set();
  // Bounded start/completion tombstones, not just active calls.
  tools = /* @__PURE__ */ new Map();
  rootTools = /* @__PURE__ */ new Map();
  dispatched = /* @__PURE__ */ new Set();
  seen = /* @__PURE__ */ new Set();
  limited = false;
  sink;
  lifecycle;
  active(agentId) {
    return this.running.has(agentId) || [...this.turns.values()].includes(agentId) || [...this.rootTools.values()].some((tool) => tool.agentId === agentId);
  }
  status(agentId) {
    const active = this.active(agentId);
    this.sink({
      type: "agentStatus",
      agentId,
      status: active ? "active" : "idle",
      currentTask: this.running.get(agentId) ?? null,
      currentTaskSource: active ? "live" : null
    });
  }
  /** Clear synchronously before closing, replacing or revoking an office. */
  clear(preserveSessionModel = false) {
    const owners = /* @__PURE__ */ new Set([
      ...this.turns.values(),
      ...this.gauges.keys(),
      ...[...this.rootTools.values()].map((tool) => tool.agentId)
    ]);
    for (const owner of new Set([...this.rootTools.values()].map((tool) => tool.agentId)))
      this.sink({ type: "agentToolsClear", agentId: owner });
    this.rootTools.clear();
    this.turns.clear();
    this.endedTurns.clear();
    this.selected.clear();
    this.instances.clear();
    this.dispatchMembers.clear();
    this.gauges.clear();
    this.lifecycle.clear(preserveSessionModel);
    for (const owner of owners) {
      this.status(owner);
      this.sink({ type: "agentContextUsage", agentId: owner, contextTokens: null, maxContextTokens: null });
    }
    this.seen.clear();
    this.starts.clear();
    this.tools.clear();
    this.dispatched.clear();
    this.limited = false;
  }
  /** Overlay file snapshots without replacing declared roster membership or provenance. */
  snapshot(messages) {
    const roster = messages.find((message) => message.type === "existingAgents");
    if (roster?.type === "existingAgents") {
      if (this.roster.some((member) => !roster.agents.some((next) => next.id === member.id))) this.clear();
      this.roster = roster.agents;
    }
    return messages.map((message) => {
      if (message.type === "agentDetailLoaded") {
        const active = this.active(message.detail.id);
        return { ...message, detail: {
          ...message.detail,
          status: active ? "active" : "idle",
          currentTask: this.running.get(message.detail.id) ?? null,
          currentTaskSource: active ? "live" : null
        } };
      }
      if (message.type === "sourceStatus") return { ...message, status: {
        ...message.status,
        liveActivity: {
          state: "following",
          sessionId: this.sessionId,
          selection: "owned-session",
          reason: "Exact joined SDK session; live events only, no replay."
        }
      } };
      if (message.type !== "existingAgents") return message;
      return { ...message, agents: message.agents.map((agent2) => {
        const active = this.active(agent2.id);
        return {
          ...agent2,
          status: active ? "active" : "idle",
          currentTask: this.running.get(agent2.id) ?? null,
          currentTaskSource: active ? "live" : null
        };
      }) };
    });
  }
  /** Current sanitized state for a viewer handshake, never historical event replay. */
  current() {
    const messages = [];
    const previous = this.sink;
    this.sink = (message) => messages.push(message);
    try {
      this.lifecycle.replayActivity();
      for (const tool of this.rootTools.values()) this.sink(tool);
      this.lifecycle.publishTasks();
      this.lifecycle.publishModels();
      for (const [agentId, context] of this.gauges) this.sink({ type: "agentContextUsage", agentId, ...context });
    } finally {
      this.sink = previous;
    }
    return messages;
  }
  /** Project bounded tool metadata; never retain raw arguments, results or prompts. */
  accept(value) {
    const raw = record5(value);
    if (typeof raw.type !== "string" || !supported.has(raw.type)) return;
    const data = record5(raw.data);
    const eventId = taskIdentity(raw.id);
    if (raw.id !== void 0 && !eventId) {
      this.limited = true;
      return;
    }
    if (eventId && this.seen.has(eventId)) return;
    if (eventId) {
      this.seen.add(eventId);
      if (this.seen.size > MAX_ALIASES) {
        this.seen.delete(this.seen.values().next().value);
        this.limited = true;
      }
    }
    const agentId = taskIdentity(raw.agentId);
    if (raw.agentId !== void 0 && !agentId) {
      this.limited = true;
      return;
    }
    const scope = agentId || (["subagent.completed", "subagent.failed", "subagent.aborted"].includes(raw.type) ? [...this.instances].find(([, call]) => call === taskIdentity(data.toolCallId))?.[0] : "") || "";
    if (raw.type === "subagent.selected") {
      const owner = exactLiveAgent(taskIdentity(data.agentName), this.roster);
      const previous = this.selected.get(scope);
      if (previous && previous !== owner) {
        if (!scope) {
          for (const [call, tool] of this.rootTools) if (tool.agentId === previous) this.rootTools.delete(call);
          this.sink({ type: "agentToolsClear", agentId: previous });
        }
        for (const key of this.turns.keys()) if (JSON.parse(key)[0] === scope) this.turns.delete(key);
        this.gauges.delete(previous);
        this.sink({ type: "agentContextUsage", agentId: previous, contextTokens: null, maxContextTokens: null });
        this.status(previous);
      }
      if (this.selected.size < MAX_ALIASES || this.selected.has(scope)) {
        if (owner) this.selected.set(scope, owner);
        else this.selected.delete(scope);
      } else this.limited = true;
    }
    if (raw.type === "session.idle") {
      if (!agentId) {
        const selected = this.selected.get("");
        const starts = new Set([.../* @__PURE__ */ new Set([...this.starts, ...this.tools.keys()])].slice(-MAX_ALIASES));
        const dispatched = new Set(this.dispatched);
        const seen = new Set(this.seen);
        const ended = [.../* @__PURE__ */ new Set([...this.endedTurns, ...this.turns.keys()])].slice(-MAX_ALIASES);
        this.clear(true);
        if (selected) this.selected.set("", selected);
        this.starts = starts;
        this.dispatched = dispatched;
        this.seen = seen;
        this.endedTurns = new Set(ended);
      } else {
        const call = this.instances.get(agentId);
        if (call) this.accept({ type: "subagent.completed", agentId, data: { toolCallId: call } });
      }
      return;
    }
    if (raw.type === "assistant.turn_start" || raw.type === "assistant.turn_end") {
      const turnId = taskIdentity(data.turnId);
      const key = JSON.stringify([scope, turnId]);
      if (raw.type === "assistant.turn_start" && this.endedTurns.has(key)) return;
      if (raw.type === "assistant.turn_end" && turnId) {
        this.endedTurns.add(key);
        if (this.endedTurns.size > MAX_ALIASES) this.endedTurns.delete(this.endedTurns.values().next().value);
      }
      const owner = this.turns.get(key) ?? this.selected.get(scope);
      if (!turnId || !owner) return;
      if (raw.type === "assistant.turn_start" && this.turns.size < MAX_ALIASES) this.turns.set(key, owner);
      else if (raw.type === "assistant.turn_end") this.turns.delete(key);
      else this.limited = true;
      this.status(owner);
      return;
    }
    if (raw.type === "session.usage_info") {
      const owner = this.selected.get(scope);
      if (owner && typeof data.currentTokens === "number" && Number.isFinite(data.currentTokens) && data.currentTokens >= 0 && typeof data.tokenLimit === "number" && Number.isFinite(data.tokenLimit) && data.tokenLimit > 0) {
        const context = { contextTokens: data.currentTokens, maxContextTokens: data.tokenLimit };
        this.gauges.set(owner, context);
        this.sink({ type: "agentContextUsage", agentId: owner, ...context });
      }
      return;
    }
    const metrics = raw.type === "tool.execution_complete" ? record5(record5(data.toolTelemetry).metrics) : {};
    const event = projectActivityEvent({
      type: raw.type,
      id: eventId,
      agentId: agentId || void 0,
      timestamp: raw.timestamp,
      ephemeral: raw.ephemeral,
      data: {
        toolCallId: data.toolCallId,
        parentToolCallId: data.parentToolCallId,
        toolName: data.toolName,
        agentName: data.agentName,
        cancelled: data.cancelled,
        arguments: raw.type === "tool.execution_start" ? data.arguments : void 0,
        model: data.model,
        newModel: data.newModel,
        toolTelemetry: { metrics: {
          context_current_tokens: metrics.context_current_tokens,
          context_token_limit: metrics.context_token_limit
        } }
      }
    });
    if (!event) return;
    if (event.identityOmitted) this.limited = true;
    if (event.type === "tool.execution_start" && event.toolCallId) {
      if (this.starts.has(event.toolCallId) || this.tools.has(event.toolCallId)) return;
      if (this.tools.size >= MAX_ALIASES) {
        this.limited = true;
        return;
      }
      this.tools.set(event.toolCallId, scope);
      if (event.task?.agent_type === "general-purpose" && !event.identityOmitted) {
        const member = exactLiveAgent(event.task.name, this.roster);
        if (member && this.dispatchMembers.size < MAX_ALIASES) this.dispatchMembers.set(event.toolCallId, member);
        else if (member) this.limited = true;
      }
    }
    if (event.toolCallId && event.type.startsWith("tool.")) {
      if (event.type === "tool.execution_complete") this.starts.delete(event.toolCallId);
      this.starts.add(event.toolCallId);
      if (this.starts.size > MAX_ALIASES) {
        this.starts.delete(this.starts.values().next().value);
        this.limited = true;
      }
    }
    if (event.type === "tool.execution_complete") {
      const owner = this.selected.get(scope || this.tools.get(event.toolCallId) || "");
      if (event.context && owner) this.gauges.set(owner, event.context);
      this.tools.delete(event.toolCallId);
    }
    if (event.type === "tool.execution_start" && event.toolCallId && !event.identityOmitted && !agentId && !event.parentToolCallId) {
      const owner = this.selected.get("");
      if (owner) {
        const tool = {
          type: "agentToolStart",
          agentId: owner,
          toolId: event.toolCallId,
          tool: event.toolName,
          status: liveToolLabel(event)
        };
        this.rootTools.set(event.toolCallId, tool);
        this.sink(tool);
        this.status(owner);
      }
    } else if (event.type === "tool.execution_complete") {
      const tool = this.rootTools.get(event.toolCallId);
      if (tool) {
        this.rootTools.delete(event.toolCallId);
        this.sink({ type: "agentToolDone", agentId: tool.agentId, toolId: tool.toolId, tool: tool.tool });
        if (event.context) this.sink({ type: "agentContextUsage", agentId: tool.agentId, ...event.context });
        this.status(tool.agentId);
      }
    }
    if (event.toolCallId && event.type.startsWith("tool.") && !event.parentToolCallId && agentId) {
      event.parentToolCallId = this.instances.get(agentId) ?? "";
    }
    const terminal2 = ["subagent.completed", "subagent.failed", "subagent.aborted"].includes(event.type);
    if ((event.type === "subagent.started" || terminal2) && event.toolCallId) {
      if (event.type === "subagent.started" && this.dispatched.has(event.toolCallId)) return;
      this.dispatched.add(event.toolCallId);
      if (this.dispatched.size > MAX_ALIASES) this.dispatched.delete(this.dispatched.values().next().value);
      this.lifecycle.accept({
        ...event,
        type: "tool.execution_start",
        toolName: "task",
        task: {
          name: taskIdentity(data.agentName),
          agent_type: taskIdentity(data.agentType),
          mode: taskIdentity(data.executionMode),
          description: ""
        }
      });
    }
    if (event.type === "subagent.started" && event.toolCallId) {
      const owner = this.selected.get(scope) ?? this.dispatchMembers.get(event.toolCallId) ?? exactLiveAgent(taskIdentity(data.agentName), this.roster);
      if (event.instanceId && (this.instances.size < MAX_ALIASES || this.instances.has(event.instanceId))) {
        this.instances.set(event.instanceId, event.toolCallId);
        if (owner) {
          this.selected.set(scope, owner);
          this.lifecycle.accept({ ...event, type: "subagent.selected", selectedAgentName: owner });
        }
      } else if (event.instanceId) this.limited = true;
    }
    this.lifecycle.accept(event);
    if (terminal2) {
      const owner = this.selected.get(scope);
      this.dispatchMembers.delete(event.toolCallId);
      this.instances.delete(scope);
      this.selected.delete(scope);
      for (const [call, actor] of this.tools) if (actor === scope) this.tools.delete(call);
      if (owner) {
        this.gauges.delete(owner);
        for (const [key, member] of this.turns) if (member === owner) this.turns.delete(key);
        this.status(owner);
      }
    }
    this.lifecycle.publishTasks();
  }
};

// src/canvas/readiness.ts
var initial = () => ({
  documentRequests: 0,
  scriptRequests: 0,
  officeContextSuccesses: 0,
  officeContextRefusals: 0,
  viewerBootstrapSuccesses: 0,
  viewerBootstrapRefusals: 0,
  officeSocketAdmissions: 0,
  officeSocketClosures: 0,
  webviewReady: 0
});
var CanvasReadiness = class {
  counters = initial();
  disposed = false;
  /** Accept only allowlisted facts, saturating independently at 65535. */
  observe(event) {
    if (!this.disposed && Object.hasOwn(this.counters, event)) {
      this.counters[event] = Math.min(65535, this.counters[event] + 1);
    }
  }
  /** Return a detached safe projection for the authorized Canvas action only. */
  snapshot() {
    return this.disposed ? void 0 : {
      semantics: "requests-observed-not-visible-renderer-or-host-defect",
      counterLimit: 65535,
      counters: { ...this.counters }
    };
  }
  /** Erase observations and ignore late transport callbacks. */
  dispose() {
    this.disposed = true;
    this.counters = initial();
  }
};

// src/canvas/officeHost.ts
function localAbsolute(root) {
  return isAbsolute5(root) && !/^[\\/]{2}|^\\|^\/(?:mnt\/[a-z](?:\/|$)|wsl(?:\/|$))/i.test(root) && !root.includes("\0");
}
async function validateRoot(selected) {
  if (typeof selected !== "string" || !localAbsolute(selected)) {
    throw new Error("CANVAS_INVALID_ROOT");
  }
  let root;
  try {
    root = await realpath(selected);
    if (!localAbsolute(root) || !(await stat(root)).isDirectory()) {
      throw new Error("invalid");
    }
  } catch {
    throw new Error("CANVAS_INVALID_ROOT");
  }
  for (const name of [".squad", ".ai-team"]) {
    try {
      const marker = await lstat2(join11(root, name));
      if (!marker.isDirectory() || marker.isSymbolicLink()) {
        break;
      }
      return root;
    } catch (error) {
      if (error.code !== "ENOENT") {
        break;
      }
    }
  }
  throw new Error("CANVAS_TEAM_REQUIRED");
}
async function startCanvasOfficeHost(options) {
  const root = await validateRoot(options.projectRoot);
  const readiness = new CanvasReadiness();
  let observer;
  let transport;
  const listeners = /* @__PURE__ */ new Set();
  const live = options.sessionId ? new CanvasActivity(
    options.sessionId,
    (message) => {
      for (const listener of listeners) listener([message]);
    }
  ) : void 0;
  const snapshot = async () => {
    const messages = await observer.snapshot();
    return live ? [...live.snapshot(messages), ...live.current()] : messages;
  };
  try {
    observer = createObserver(root, options.bundledAssetsRoot, 1e3, { liveActivity: false, fileActivity: false });
    await snapshot();
    transport = await startTransport({
      staticRoot: options.staticRoot,
      canvas: true,
      canvasReadiness: (event) => readiness.observe(event),
      officeControl: createOfficeControl(root),
      canvasHost: options.hostCapabilities?.(snapshot),
      snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        const stop = observer.subscribe((messages) => listener(live ? live.snapshot(messages) : messages));
        return () => {
          listeners.delete(listener);
          stop();
        };
      },
      onRead: async (message) => {
        const messages = await observer.onRead(message);
        return live ? live.snapshot(messages) : messages;
      }
    });
  } catch {
    readiness.dispose();
    try {
      await transport?.dispose();
    } finally {
      observer?.dispose();
    }
    throw new Error("CANVAS_START_FAILED");
  }
  const ownedObserver = observer;
  const ownedTransport = transport;
  let disposal;
  return {
    url: `http://127.0.0.1:${ownedTransport.port}/#c=${ownedTransport.token}`,
    snapshot,
    readiness: () => readiness.snapshot(),
    rendered: () => ownedTransport.rendered(),
    capture: () => ownedTransport.capture(),
    acceptActivity: (event) => live?.accept(event),
    clearActivity: () => live?.clear(),
    dispose() {
      if (!disposal) {
        readiness.dispose();
        live?.clear();
        listeners.clear();
        ownedObserver.dispose();
        disposal = ownedTransport.dispose().catch(() => {
          throw new Error("CANVAS_DISPOSE_FAILED");
        });
      }
      return disposal;
    }
  };
}

// src/canvas/readActions.ts
import { relative as relative4 } from "node:path";

// ../src/memberCharter.ts
import * as path10 from "node:path";

// ../src/charterDetails.ts
function parseCharterDetails(source) {
  let charterSummary = null;
  const lines = source.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^\s*#\s+/.test(line));
  const paragraphLines = [];
  if (titleIndex >= 0) {
    let index = titleIndex + 1;
    while (index < lines.length && !lines[index].trim()) {
      index++;
    }
    while (index < lines.length && lines[index].trim() && !/^\s*#{1,6}\s+/.test(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index++;
    }
  }
  if (paragraphLines.length > 0) {
    const paragraph = paragraphLines.join(" ");
    const sentences = paragraph.split(/\.\s+/);
    charterSummary = sentences.slice(0, 3).join(". ");
    if (!charterSummary.endsWith(".")) {
      charterSummary += ".";
    }
  }
  const expertise = source.split(/\r?\n/).map((line) => /^\s*[-*]\s+\*\*Expertise:\*\*\s*(.+)$/i.exec(line)?.[1]?.trim() ?? "").find(Boolean) ?? null;
  return {
    charterSummary,
    expertise,
    responsibilities: extractDeclaredSection(source, ["Responsibilities", "What I Own"]),
    boundaries: extractDeclaredSection(source, ["Boundaries"])
  };
}
function extractDeclaredSection(source, headings) {
  const lines = source.split(/\r?\n/);
  const heading = new RegExp(`^#{1,6}\\s+(?:${headings.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*#*\\s*$`, "i");
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) {
    return null;
  }
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) {
      break;
    }
    if (line.trim()) {
      section.push(line.trim());
    }
  }
  const text6 = section.join("\n").trim();
  return text6 ? text6.slice(0, 4096) : null;
}

// ../src/memberCharter.ts
function readMemberCharter(context, id2) {
  const empty2 = (charterStatus) => ({
    charterStatus,
    charterContent: null,
    charterSummary: null,
    expertise: null,
    responsibilities: null,
    boundaries: null
  });
  if (!id2 || id2 === "." || id2 === ".." || /[\\/:\0]/.test(id2) || !context.isCurrentMember(id2)) {
    return empty2("unavailable");
  }
  try {
    const files = new ProjectFiles(context.workspaceRoot);
    const directory = selectTeamSourceDirectory(files);
    const relative6 = path10.join(directory, "agents", id2, "charter.md");
    if (!context.isCurrentMember(id2)) {
      return empty2("unavailable");
    }
    const source = files.read(relative6, 64 * 1024);
    if (!context.isCurrentMember(id2)) {
      return empty2("unavailable");
    }
    return source === null ? empty2("missing") : {
      charterStatus: "available",
      charterContent: source,
      ...parseCharterDetails(source)
    };
  } catch {
    return empty2("unreadable");
  }
}

// ../src/declaredModels.ts
import * as path11 from "path";
var MAX_MODEL_CONFIG_BYTES = 64 * 1024;
function parseCharterModel(content, sourcePath) {
  const result = (state, diagnostic, values = []) => ({ sourcePath, state, diagnostic, values });
  if (Buffer.byteLength(content, "utf8") > MAX_MODEL_CONFIG_BYTES) {
    return result("unreadable", "Charter exceeds the 64 KiB read limit.");
  }
  let fence;
  const lines = content.split(/\r?\n/).filter((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = void 0;
      }
      return false;
    }
    return !fence;
  });
  const sections = lines.flatMap((line, index) => /^##\s+Model\s*$/i.test(line) ? [index] : []);
  if (!sections.length) {
    return result("missing", "No declared ## Model section.");
  }
  if (sections.length > 1) {
    return result("ambiguous", "Multiple Model sections; declarations withheld.");
  }
  const section = lines.slice(sections[0] + 1);
  const end = section.findIndex((line) => /^#{1,2}\s/.test(line));
  const fields = (end < 0 ? section : section.slice(0, end)).flatMap((line) => {
    const field = /^\s*(?:[-*]\s+)?\*\*(Preferred|Rationale|Fallback):\*\*\s*(.*)$/i.exec(line);
    return field ? [{ key: field[1][0].toUpperCase() + field[1].slice(1).toLowerCase(), value: field[2].trim() }] : [];
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) {
    return result("ambiguous", "Repeated Model fields; declarations withheld.");
  }
  if (fields.some((field) => !field.value || field.value.length > 4096 || /[\u0000-\u001f\u007f]/.test(field.value))) {
    return result("malformed", "Model fields must be non-empty text of at most 4,096 characters.");
  }
  const missing = ["Preferred", "Rationale", "Fallback"].filter((key) => !fields.some((field) => field.key === key));
  return result("ready", missing.length ? `Not declared: ${missing.join(", ")}.` : "Declared charter fields only.", fields);
}
function object4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function model(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}
function duplicateKeys(content) {
  const stack = [];
  const tokens2 = content.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g);
  for (const token of tokens2) {
    const text6 = token[0];
    if (text6 === "{") {
      stack.push(/* @__PURE__ */ new Set());
    } else if (text6 === "[") {
      stack.push(null);
    } else if (text6 === "}" || text6 === "]") {
      stack.pop();
    } else if (content.slice(token.index + text6.length).trimStart().startsWith(":")) {
      const key = JSON.parse(text6);
      const keys3 = stack.at(-1);
      if (keys3?.has(key)) {
        return true;
      }
      keys3?.add(key);
    }
  }
  return false;
}
function parseModelConfig(content, agentName, sourcePath) {
  const result = (state, diagnostic, values2 = []) => ({ sourcePath, state, diagnostic, values: values2 });
  if (Buffer.byteLength(content, "utf8") > MAX_MODEL_CONFIG_BYTES) {
    return result("unreadable", "Configuration exceeds the 64 KiB read limit.");
  }
  let config;
  try {
    config = JSON.parse(content);
  } catch {
    return result("malformed", "Configuration is not valid JSON.");
  }
  if (!object4(config)) {
    return result("malformed", "Configuration must be a JSON object.");
  }
  if (duplicateKeys(content)) {
    return result("ambiguous", "Duplicate JSON keys; declared preferences withheld.");
  }
  const values = [];
  if (Object.hasOwn(config, "defaultModel")) {
    if (!model(config.defaultModel)) {
      return result("malformed", "defaultModel must be a non-empty model string (at most 256 characters).");
    }
    values.push({ key: "defaultModel", value: config.defaultModel });
  }
  if (Object.hasOwn(config, "agentModelOverrides")) {
    if (!object4(config.agentModelOverrides) || Object.values(config.agentModelOverrides).some((value) => !model(value))) {
      return result("malformed", "agentModelOverrides must be an object of non-empty model strings (at most 256 characters).");
    }
    if (Object.hasOwn(config.agentModelOverrides, agentName)) {
      const value = config.agentModelOverrides[agentName];
      if (model(value)) {
        values.push({ key: `agentModelOverrides[${JSON.stringify(agentName)}]`, value });
      }
    }
  }
  return result("ready", values.length ? "Declared preferences only; runtime selection is not known." : "No supported preferences declared for this exact agent name.", values);
}
function modelDirectory(files) {
  const directory = selectTeamSourceDirectory(files);
  const preferred = files.inspect(".squad");
  const selected = directory === ".squad" ? preferred : files.inspect(directory);
  if (directory === ".ai-team" && preferred.status !== "missing" || selected.status === "unreadable" || selected.status === "present" && selected.kind !== "directory") {
    throw new Error("Selected model directory changed or is unavailable.");
  }
  return { directory, fingerprint: `${preferred.fingerprint}||${selected.fingerprint}` };
}
function readJsonConfig(files, relative6, agentName, sourcePath) {
  const result = (state, diagnostic) => ({ sourcePath, state, diagnostic, values: [] });
  const before = files.inspect(relative6);
  if (before.status !== "present") {
    return result(before.status, before.status === "missing" ? "No JSON configuration file." : before.reason);
  }
  if (before.kind !== "file" || before.size > BigInt(MAX_MODEL_CONFIG_BYTES)) {
    return result("unreadable", "Configuration is not a regular file within the 64 KiB read limit.");
  }
  try {
    const content = files.read(relative6, MAX_MODEL_CONFIG_BYTES);
    if (content === null || files.inspect(relative6).fingerprint !== before.fingerprint) {
      return result("ambiguous", "Configuration changed while reading; reopen to retry.");
    }
    return parseModelConfig(content, agentName, sourcePath);
  } catch (error) {
    const diagnostic = projectFileDiagnostic(error);
    if (files.inspect(relative6).fingerprint !== before.fingerprint || /changed/i.test(diagnostic)) {
      return result("ambiguous", diagnostic);
    }
    return result(error?.code === "ERR_ENCODING_INVALID_ENCODED_DATA" ? "malformed" : "unreadable", diagnostic);
  }
}
function inspectExecutable(files, relative6, sourcePath) {
  const inspected = files.inspect(relative6);
  let state;
  let diagnostic;
  if (inspected.status !== "present") {
    state = inspected.status;
    diagnostic = inspected.status === "missing" ? "No executable/legacy configuration at this path." : inspected.reason;
  } else if (inspected.kind !== "file") {
    state = "unreadable";
    diagnostic = "Executable/legacy configuration is not a regular file.";
  } else {
    state = "unsupported";
    diagnostic = "Executable/legacy configuration is present; not imported, executed or resolved.";
  }
  if (files.inspect(relative6).fingerprint !== inspected.fingerprint) {
    state = "ambiguous";
    diagnostic = "Executable/legacy configuration changed while inspecting; reopen to retry.";
  }
  return { sourcePath, state, diagnostic, values: [] };
}
function readModelConfig(workspaceRoot, agentName) {
  let directory = ".squad";
  const sourcePath = (relative6) => path11.isAbsolute(workspaceRoot) ? path11.join(workspaceRoot, relative6) : relative6.split(path11.sep).join("/");
  const paths = () => [
    path11.join(directory, "config.json"),
    "squad.config.ts",
    path11.join(directory, "squad.config.ts")
  ];
  let files;
  let before;
  try {
    files = new ProjectFiles(workspaceRoot);
    before = modelDirectory(files);
    directory = before.directory;
  } catch (error) {
    return paths().map((relative6) => ({
      sourcePath: sourcePath(relative6),
      state: "unreadable",
      diagnostic: projectFileDiagnostic(error),
      values: []
    }));
  }
  const relativePaths = paths();
  const sources = [
    readJsonConfig(files, relativePaths[0], agentName, sourcePath(relativePaths[0])),
    ...relativePaths.slice(1).map((relative6) => inspectExecutable(files, relative6, sourcePath(relative6)))
  ];
  try {
    const after = modelDirectory(files);
    if (before.directory === after.directory && before.fingerprint === after.fingerprint) {
      return sources;
    }
  } catch (error) {
    return sources.map((source) => ({
      ...source,
      state: "ambiguous",
      diagnostic: `Selected model source changed or became unavailable; reopen to retry. ${projectFileDiagnostic(error)}`,
      values: []
    }));
  }
  return sources.map((source) => ({
    ...source,
    state: "ambiguous",
    diagnostic: "Selected model source changed while observing declarations; reopen to retry.",
    values: []
  }));
}

// src/canvas/readActions.ts
var text5 = (value, limit = 512) => value === null ? null : value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, limit);
var members = (messages) => messages.find((message) => message.type === "existingAgents")?.agents.slice(0, 128) ?? [];
function officeState(messages, readiness, rendered = null) {
  const layout2 = messages.find((message) => message.type === "layoutLoaded")?.layout;
  const source = messages.find((message) => message.type === "sourceStatus")?.status;
  return {
    rendering: { semantics: "application-reported-drawing-not-compositor-visibility", firstFrame: rendered },
    ...readiness ? { readiness } : {},
    members: members(messages).map((member) => ({
      slug: text5(member.id, 128),
      name: text5(member.name, 256),
      role: text5(member.role, 256),
      status: member.status,
      statusSource: source?.liveActivity?.state === "following" ? "joined-session-observation" : "local-file-observation"
    })),
    layout: layout2 ? { cols: layout2.cols, rows: layout2.rows, furnitureCount: layout2.furniture.length } : null,
    source: source ? {
      teamFound: source.teamFound,
      observer: source.observer,
      liveActivity: source.liveActivity?.state === "following" ? "following" : "unavailable",
      diagnostics: source.error === null ? "none" : "unavailable"
    } : null
  };
}
function memberDetails(root, slug, messages) {
  const roster = members(messages);
  const member = roster.find((candidate) => candidate.id === slug);
  if (!member) return { status: "unavailable" };
  const charter = readMemberCharter({
    workspaceRoot: root,
    isCurrentMember: (id2) => roster.some((candidate) => candidate.id === id2)
  }, slug);
  const sources = readModelConfig(root, member.name);
  if (charter.charterContent !== null) {
    sources.unshift(parseCharterModel(charter.charterContent, "charter.md"));
  }
  return {
    status: "available",
    slug,
    charterStatus: charter.charterStatus,
    charterSummary: text5(charter.charterSummary, 2048),
    expertise: text5(charter.expertise, 2048),
    model: { provenance: "declared-only", runtime: null, sources: sources.slice(0, 4).map((source) => ({
      source: text5(source.sourcePath === "charter.md" ? source.sourcePath : relative4(root, source.sourcePath), 256),
      state: source.state,
      diagnostic: text5(source.diagnostic),
      values: source.values.slice(0, 3).map((value) => ({ key: text5(value.key, 256), value: text5(value.value) }))
    })) }
  };
}

// src/canvas/hostCapabilities.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync as realpathSync5 } from "node:fs";
import { isAbsolute as isAbsolute7, join as join14, relative as relative5, sep as sep5 } from "node:path";
import { promisify } from "node:util";

// ../src/core/canvasHost.ts
var CANVAS_CHARTER_UNAVAILABLE = "Charter unavailable for this member: missing, unreadable or not declared. Nothing was opened; other charters remain available.";
var CANVAS_HOST_BUSY = "Another host request is still in progress. Nothing was sent; capabilities remain available. Try again when it finishes.";

// src/canvas/hostCapabilities.ts
var object5 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var MAX_BYTES = 2 * 1024 * 1024;
var HOST_RPC_TIMEOUT_MS = 1e3;
var reason = "Host capability unavailable or rejected. Outcome unconfirmed; no automatic retry.";
var LocalRefusal = class extends Error {
  generation;
  constructor(generation) {
    super();
    this.generation = generation;
  }
};
function createHostCapabilities(session, root, instanceId, assertActive, snapshot) {
  const files = new ProjectFiles(root);
  const failed = /* @__PURE__ */ new Set();
  const available = () => ({
    charter: !failed.has("charter") && typeof session.rpc?.canvas?.open === "function" && typeof session.rpc?.canvas?.list === "function",
    usage: !failed.has("usage") && typeof session.rpc?.usage?.getMetrics === "function",
    export: !failed.has("export") && typeof session.rpc?.workspaces?.createFile === "function"
  });
  let busy = false;
  const current = (generation) => {
    try {
      return assertActive() === generation;
    } catch {
      return false;
    }
  };
  const handle = async (input, editing) => {
    let operation = "";
    let invoked = false;
    try {
      const generation = assertActive();
      const check = () => {
        if (assertActive() !== generation) throw new Error();
      };
      async function invoke(call) {
        let timer;
        invoked = true;
        try {
          return await Promise.race([
            Promise.resolve().then(() => {
              check();
              return call();
            }),
            new Promise((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error()), HOST_RPC_TIMEOUT_MS);
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      if (!object5(input) || typeof input.operation !== "string") throw new Error();
      operation = input.operation;
      const field = operation === "charter" ? "slug" : operation === "export" ? "content" : operation === "import" ? "path" : null;
      if (!["capabilities", "usage", "charter", "export", "import"].includes(operation) || Object.keys(input).length !== (field ? 2 : 1) || field && typeof input[field] !== "string" || failed.has(operation)) throw new Error();
      if (operation === "capabilities") return { ok: true, capabilities: available() };
      if ((operation === "import" || operation === "export") && !editing) throw new Error();
      if (busy) return { ok: false, reason: CANVAS_HOST_BUSY, failure: "request" };
      busy = true;
      try {
        if (operation === "charter") {
          if (!available().charter || typeof input.slug !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.slug)) throw new Error();
          const slug = input.slug;
          const messages = await invoke(snapshot);
          check();
          const roster = messages.find((message) => message.type === "existingAgents")?.agents ?? [];
          const charter = readMemberCharter({ workspaceRoot: root, isCurrentMember: (id2) => roster.some((m) => m.id === id2) }, slug);
          if (charter.charterStatus !== "available") throw new LocalRefusal(generation);
          const path12 = join14(selectTeamSourceDirectory(files), "agents", slug, "charter.md");
          const declaredHere = () => {
            const source = readTeamSource(files);
            if (source.status !== "available") return false;
            const declared = parseTeamRoster(source.content).filter((member) => member.slug === slug);
            return declared.length === 1 && declared[0].charterPath.replace(/\\/g, "/") === path12.split(sep5).join("/");
          };
          if (!declaredHere()) throw new LocalRefusal(generation);
          check();
          const catalog = await invoke(() => session.rpc.canvas.list());
          if (!object5(catalog) || !Array.isArray(catalog.canvases)) throw new Error();
          const editors = catalog.canvases.filter((c) => object5(c) && c.canvasId === "editor");
          if (editors.length !== 1) throw new Error();
          const editor = editors[0];
          if (!object5(editor) || typeof editor.extensionId !== "string" || !object5(editor.inputSchema)) throw new Error();
          const editorProvider = editor.extensionId;
          const schema = editor.inputSchema;
          if (!object5(schema.properties) || !object5(schema.properties.scope) || !object5(schema.properties.path) || schema.properties.path.type !== "string" || !Array.isArray(schema.properties.scope.enum) || !schema.properties.scope.enum.includes("repo") || !Array.isArray(schema.required) || schema.required.some((key) => key !== "scope" && key !== "path")) throw new Error();
          const git = await promisify(execFile)(
            "git",
            ["-C", root, "rev-parse", "--show-toplevel"],
            { timeout: 1e3, maxBuffer: 8192, windowsHide: true }
          );
          const repo = realpathSync5(git.stdout.trim());
          const prefix = relative5(repo, files.root);
          if (isAbsolute7(prefix) || prefix.split(sep5).includes("..")) throw new Error();
          const target = files.resolve(path12);
          const repoPath = relative5(repo, target).split(sep5).join("/");
          check();
          if (!declaredHere() || readMemberCharter({ workspaceRoot: root, isCurrentMember: (id2) => roster.some((m) => m.id === id2) }, slug).charterStatus !== "available") throw new Error();
          const targetInstance = `squad-charter-${instanceId}-${slug}`;
          const opened = await invoke(() => session.rpc.canvas.open({
            extensionId: editorProvider,
            canvasId: "editor",
            instanceId: targetInstance,
            input: { scope: "repo", path: repoPath }
          }));
          check();
          if (!object5(opened) || opened.canvasId !== "editor" || opened.extensionId !== editorProvider || opened.instanceId !== targetInstance) throw new Error();
          return { ok: true };
        }
        if (operation === "usage") {
          if (!available().usage) throw new Error();
          const metrics = await invoke(() => session.rpc.usage.getMetrics());
          check();
          if (!object5(metrics)) throw new Error();
          const quantities = [];
          for (const [key, label, unit] of [
            ["totalUserRequests", "User-initiated API requests", "requests"],
            ["totalPremiumRequestCost", "Premium-request cost (multiplier applied)", "premium requests"],
            ["totalApiDurationMs", "API time", "ms"],
            ["totalNanoAiu", "AI usage", "nano-AI units"]
          ]) {
            const value = metrics[key];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) quantities.push({ label, value, unit });
          }
          return { ok: true, quantities };
        }
        if (operation === "export") {
          if (!available().export || typeof input.content !== "string" || Buffer.byteLength(input.content) > MAX_BYTES || !isObserverLayout(JSON.parse(input.content))) throw new Error();
          const path12 = `squad-pod-layout-${randomUUID2()}.json`;
          check();
          const content2 = input.content;
          await invoke(() => session.rpc.workspaces.createFile({ path: path12, content: content2 }));
          check();
          return { ok: true, path: path12 };
        }
        if (typeof input.path !== "string" || input.path.length > 4096 || !input.path.endsWith(".json") || /[\\:\x00-\x1f\x7f]/.test(input.path) || isAbsolute7(input.path) || input.path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error();
        const content = files.read(input.path, MAX_BYTES);
        if (content === null) throw new Error();
        const layout2 = JSON.parse(content.replace(/^\uFEFF/, ""));
        if (!isObserverLayout(layout2)) throw new Error();
        check();
        return { ok: true, layout: layout2 };
      } finally {
        busy = false;
      }
    } catch (error) {
      if (error instanceof LocalRefusal && current(error.generation)) return { ok: false, reason: CANVAS_CHARTER_UNAVAILABLE, failure: "request" };
      if (invoked) failed.add(operation);
      return { ok: false, reason };
    }
  };
  handle.available = available;
  return handle;
}

// src/canvas/provider.ts
var id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var object6 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var empty = { type: "object", properties: {}, additionalProperties: false };
function directoryIdentity(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) || !isAbsolute8(value) || /^[\\/]{2}|^\\|^\/(?:mnt\/[a-z](?:\/|$)|wsl(?:\/|$))/i.test(value) || process.platform === "win32" && (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(":"))) throw new Error();
  const path12 = realpathSync6.native(value);
  if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(path12)) throw new Error();
  const stat2 = statSync4(path12, { bigint: true });
  if (!stat2.isDirectory()) throw new Error();
  return { path: path12, key: process.platform === "win32" ? path12.toLowerCase() : path12, dev: stat2.dev, ino: stat2.ino };
}
var same = (a, b) => a.key === b.key && a.dev === b.dev && a.ino === b.ino;
async function startOfficeExtension(sdk2, paths, lifecycle = process) {
  let session;
  let boundSessionId;
  let providerId;
  let disposed = false;
  let cleanupFailed = false;
  let inFlight = 0;
  let disposal;
  let unsubscribe;
  const entries2 = /* @__PURE__ */ new Map();
  function fail(code) {
    throw new sdk2.CanvasError(code, "Squad Pod Canvas authority or resource unavailable");
  }
  function revoke() {
    const owned = [...entries2.values()];
    entries2.clear();
    for (const entry of owned) entry.host?.clearActivity?.();
    for (const entry of owned) void closeEntry(entry).catch(() => {
      cleanupFailed = true;
    });
  }
  function validate(ctx) {
    if (disposed || cleanupFailed || !session) fail("canvas_unavailable");
    if (session.sessionId !== boundSessionId) {
      revoke();
      fail("canvas_session_mismatch");
    }
    if (!ctx || typeof ctx !== "object") fail("canvas_context_invalid");
    if (ctx.sessionId !== session.sessionId) fail("canvas_session_mismatch");
    if (ctx.canvasId !== "squad-pod" || typeof ctx.instanceId !== "string" || !id.test(ctx.instanceId) || typeof ctx.extensionId !== "string" || !ctx.extensionId || ctx.extensionId.length > 256) fail("canvas_context_invalid");
    if (providerId && providerId !== ctx.extensionId) fail("canvas_provider_mismatch");
    return entries2.get(ctx.instanceId);
  }
  function active(ctx, entry, generation = entry.generation) {
    validate(ctx);
    if (entries2.get(ctx.instanceId) !== entry || entry.generation !== generation) fail("canvas_closed");
    try {
      if (entry.root && !same(entry.root, directoryIdentity(entry.root.path))) fail("canvas_root_changed");
    } catch {
      fail("canvas_root_changed");
    }
  }
  async function authority(ctx) {
    const metadata = session?.rpc?.metadata;
    if (typeof metadata?.snapshot !== "function") fail("canvas_metadata_missing");
    if (inFlight >= 4) fail("canvas_metadata_limit");
    inFlight++;
    const request = Promise.resolve().then(() => metadata.snapshot()).then(
      (value) => ({ value }),
      () => ({ error: "canvas_metadata_rejected" })
    ).finally(() => {
      inFlight--;
    });
    let timer;
    try {
      const result = await Promise.race([request, new Promise((resolve4) => {
        timer = setTimeout(() => resolve4({ error: "canvas_metadata_deadline" }), 1e3);
      })]);
      if ("error" in result) fail(result.error);
      const value = result.value;
      if (!object6(value) || value.sessionId !== ctx.sessionId || value.sessionId !== session?.sessionId) fail("canvas_metadata_mismatch");
      try {
        const root = directoryIdentity(value.workingDirectory);
        if (object6(ctx.input) && Object.hasOwn(ctx.input, "projectRoot") && !same(root, directoryIdentity(ctx.input.projectRoot))) fail("canvas_root_mismatch");
        return root;
      } catch (error) {
        if (error instanceof sdk2.CanvasError) throw error;
        return fail("canvas_root_unavailable");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const release = async (host) => {
    try {
      await host.dispose();
    } catch {
      cleanupFailed = true;
      fail("canvas_disposal_failed");
    }
  };
  const closeEntry = async (entry) => {
    if (entry.host) return release(entry.host);
    let host;
    try {
      host = await entry.ready;
    } catch {
      return;
    }
    if (host) await release(host);
  };
  async function close(ctx) {
    const entry = validate(ctx);
    entries2.delete(ctx.instanceId);
    entry?.host?.clearActivity?.();
    if (entry) {
      try {
        await closeEntry(entry);
      } catch {
        fail("canvas_disposal_failed");
      }
    }
  }
  const canvas = sdk2.createCanvas({
    id: "squad-pod",
    displayName: "Squad Pod",
    description: "Read-only office for the exact joined session project.",
    inputSchema: { ...empty, properties: { projectRoot: { type: "string", minLength: 1, maxLength: 4096 } } },
    async open(ctx) {
      let entry = validate(ctx);
      if (ctx.input !== void 0 && (!object6(ctx.input) || Object.keys(ctx.input).some((key) => key !== "projectRoot"))) fail("canvas_input_invalid");
      if (!entry) {
        if (entries2.size >= 4) fail("canvas_instance_limit");
        providerId ??= ctx.extensionId;
        entry = { generation: 0, pending: false };
        entries2.set(ctx.instanceId, entry);
      }
      const generation = ++entry.generation;
      entry.pending = true;
      entry.host?.clearActivity?.();
      try {
        const root = await authority(ctx);
        active(ctx, entry, generation);
        if (entry.root && !same(root, entry.root)) fail("canvas_root_changed");
        entry.root = root;
        if (!entry.ready) {
          const owned = entry;
          entry.ready = Promise.resolve().then(async () => {
            active(ctx, owned);
            const host2 = await startCanvasOfficeHost({
              ...paths,
              projectRoot: root.path,
              sessionId: session.sessionId,
              hostCapabilities: (snapshot) => createHostCapabilities(
                session,
                root.path,
                ctx.instanceId,
                () => {
                  active(ctx, owned);
                  if (owned.pending) fail("canvas_instance_unavailable");
                  return owned.generation;
                },
                snapshot
              )
            });
            try {
              active(ctx, owned);
            } catch (error) {
              await release(host2);
              throw error;
            }
            owned.host = host2;
            return host2;
          });
        }
        const host = await entry.ready;
        active(ctx, entry, generation);
        entry.pending = false;
        return { title: "Squad Pod", url: host.url };
      } catch (error) {
        if (entries2.get(ctx.instanceId) === entry && entry.generation === generation) {
          entries2.delete(ctx.instanceId);
          try {
            await closeEntry(entry);
          } catch {
            fail("canvas_disposal_failed");
          }
        } else active(ctx, entry, generation);
        if (error instanceof sdk2.CanvasError) throw error;
        return fail("canvas_open_failed");
      }
    },
    onClose: close,
    actions: ["get_office_state", "get_member_details", "get_office_snapshot"].map((name) => ({
      name,
      description: name === "get_office_snapshot" ? "Fresh bounded office PNG readback for this instance only; not compositor visibility or native acceptance." : name === "get_office_state" ? "Bounded office members, layout, source status, requests-observed readiness and application-reported drawing." : "Exact-member charter summary, expertise and declared model provenance.",
      inputSchema: name !== "get_member_details" ? empty : {
        ...empty,
        properties: { slug: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } },
        required: ["slug"]
      },
      async handler(ctx) {
        const entry = validate(ctx);
        if (!entry?.host || !entry.root || entry.pending) fail("canvas_instance_unavailable");
        const { host, root, generation } = entry;
        const input = ctx.input === void 0 ? {} : ctx.input;
        if (ctx.actionName !== name || !object6(input) || (name !== "get_member_details" ? Object.keys(input).length !== 0 : Object.keys(input).length !== 1 || typeof input.slug !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.slug))) fail("canvas_input_invalid");
        try {
          active(ctx, entry, generation);
          if (name === "get_office_snapshot") {
            if (!host.capture) fail("canvas_snapshot_unavailable");
            const png = await host.capture();
            active(ctx, entry, generation);
            if (entry.pending) fail("canvas_instance_unavailable");
            const result = {
              resultType: "success",
              textResultForLlm: "Current office canvas PNG readback (application-reported drawing, not compositor visibility or native acceptance).",
              binaryResultsForLlm: [{ type: "image", mimeType: "image/png", data: png }]
            };
            return result;
          }
          const messages = await host.snapshot();
          active(ctx, entry, generation);
          if (entry.pending) fail("canvas_instance_unavailable");
          return name === "get_office_state" ? officeState(messages, host.readiness?.(), host.rendered?.() ?? null) : memberDetails(root.path, input.slug, messages);
        } catch (error) {
          if (error instanceof sdk2.CanvasError) throw error;
          return fail(name === "get_office_snapshot" ? "canvas_snapshot_unavailable" : "canvas_action_unavailable");
        }
      }
    }))
  });
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    const owned = [...entries2.values()];
    entries2.clear();
    for (const entry of owned) entry.host?.clearActivity?.();
    const subscription = unsubscribe;
    unsubscribe = void 0;
    for (const signal of ["disconnect", "SIGTERM", "SIGINT"]) lifecycle.removeListener(signal, stop);
    return disposal = Promise.resolve().then(async () => {
      let failed = false;
      try {
        subscription?.();
      } catch {
        failed = true;
      }
      const results = await Promise.allSettled(owned.map(closeEntry));
      if (failed || results.some((result) => result.status === "rejected")) fail("canvas_disposal_failed");
    });
  }
  function stop() {
    void dispose().catch(() => {
      process.exitCode = 1;
    });
  }
  try {
    session = await sdk2.joinSession({ canvases: [canvas] });
    if (!session || typeof session.sessionId !== "string" || !id.test(session.sessionId)) fail("canvas_binding_invalid");
    boundSessionId = session.sessionId;
    const joined = session;
    unsubscribe = joined.on((event) => {
      if (disposed) return;
      if (session !== joined || joined.sessionId !== boundSessionId || event.type === "session.context_changed" || event.type === "session.shutdown" && !event.agentId) {
        revoke();
        if (event.type === "session.shutdown" && !event.agentId) stop();
        return;
      }
      for (const entry of entries2.values()) if (!entry.pending) entry.host?.acceptActivity?.(event);
    });
    if (typeof unsubscribe !== "function") fail("canvas_binding_invalid");
    if (disposed) {
      unsubscribe();
      fail("canvas_binding_invalid");
    }
    for (const signal of ["disconnect", "SIGTERM", "SIGINT"]) lifecycle.once(signal, stop);
    return { canvas, dispose };
  } catch {
    await dispose();
    return fail("canvas_binding_invalid");
  }
}

// src/canvas/extension.ts
await startOfficeExtension(sdk, {
  staticRoot: fileURLToPath(new URL("./canvas-browser", import.meta.url)),
  bundledAssetsRoot: fileURLToPath(new URL("./assets", import.meta.url))
});
