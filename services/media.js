const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db } = require('../database');
const { resolveUploadsDir } = require('../lib/paths');
const { getSecurityHeaders } = require('../middleware/security');

const activeUploads = new Map();

function getUploadsRoot() {
  return resolveUploadsDir();
}

function resolveStoredUploadPath(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const normalizedRel = relPath.replace(/\\/g, '/');
  let expectedSubdir = null;
  if (normalizedRel.startsWith('uploads/videos/')) expectedSubdir = 'videos';
  else if (normalizedRel.startsWith('uploads/pdfs/')) expectedSubdir = 'pdfs';
  else return null;

  const subPath = path.normalize(normalizedRel.slice('uploads/'.length)).replace(/^(\.\.(\/|\\|$))+/, '');
  const uploadsRoot = path.resolve(getUploadsRoot());
  const subdirRoot = path.join(uploadsRoot, expectedSubdir);
  const fullPath = path.resolve(uploadsRoot, subPath);
  if (!fullPath.startsWith(subdirRoot + path.sep)) return null;

  try {
    const realRoot = fs.existsSync(uploadsRoot) ? fs.realpathSync(uploadsRoot) : uploadsRoot;
    const realSubdir = path.join(realRoot, expectedSubdir);
    if (fs.existsSync(fullPath)) {
      const realFile = fs.realpathSync(fullPath);
      if (!realFile.startsWith(realSubdir + path.sep)) return null;
    } else if (fs.existsSync(path.dirname(fullPath))) {
      const realParent = fs.realpathSync(path.dirname(fullPath));
      if (realParent !== realSubdir && !realParent.startsWith(realSubdir + path.sep)) return null;
    }
  } catch {
    return null;
  }
  return fullPath;
}

async function cleanupUnusedUploadFile(relPath) {
  const fullPath = resolveStoredUploadPath(relPath);
  if (!fullPath) return;
  const row = await db.get(`SELECT COUNT(*) AS c FROM lessons WHERE video_path = ? OR pdf_path = ?`, [relPath, relPath]);
  if ((row?.c || 0) > 0) return;
  if (fs.existsSync(fullPath)) {
    try {
      await fs.promises.unlink(fullPath);
    } catch {}
  }
}

function validateFileSignature(buffer, uploadType, ext) {
  if (!buffer || buffer.length < 8) return false;
  if (uploadType === 'pdf') {
    if (ext !== '.pdf') return false;
    return buffer.slice(0, 5).toString('ascii') === '%PDF-';
  }
  if (uploadType === 'video') {
    if (!['.mp4', '.webm'].includes(ext)) return false;
    const isMp4 = buffer.slice(4, 8).toString('ascii') === 'ftyp';
    const isWebm = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    return isMp4 || isWebm;
  }
  return false;
}

function pipeStreamSafely(req, res, fileStream) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (!fileStream.destroyed) {
      fileStream.destroy();
    }
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
  req.on('aborted', cleanup);
  fileStream.on('error', () => {
    cleanup();
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
  fileStream.pipe(res);
}

function streamFileWithRange(req, res, fullPath, fileSize, mimeType, cacheControl) {
  if (typeof req.setTimeout === 'function') req.setTimeout(120000);
  if (typeof res.setTimeout === 'function') res.setTimeout(120000);

  const range = req.headers.range;
  if (range !== undefined) {
    const rawRange = String(range).trim();
    const firstSpec = rawRange.split(',')[0].trim();
    const match = /^bytes=(\d*)-(\d*)$/i.exec(firstSpec);
    if (!rawRange.toLowerCase().startsWith('bytes=') || !match || (match[1] === '' && match[2] === '') || fileSize <= 0) {
      res.writeHead(416, getSecurityHeaders(req, { 'Content-Range': `bytes */${fileSize}` }));
      res.end();
      return;
    }

    let start;
    let end;
    if (match[1] === '') {
      const suffixLength = Number.parseInt(match[2], 10);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.writeHead(416, getSecurityHeaders(req, { 'Content-Range': `bytes */${fileSize}` }));
        res.end();
        return;
      }
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
    } else {
      start = Number.parseInt(match[1], 10);
      end = match[2] !== '' ? Math.min(Number.parseInt(match[2], 10), fileSize - 1) : (fileSize - 1);
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= fileSize || start > end) {
      res.writeHead(416, getSecurityHeaders(req, { 'Content-Range': `bytes */${fileSize}` }));
      res.end();
      return;
    }
    const chunksize = end - start + 1;
    const file = fs.createReadStream(fullPath, { start, end, highWaterMark: 512 * 1024 });
    res.writeHead(206, getSecurityHeaders(req, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
      'Cache-Control': cacheControl,
      'Content-Disposition': 'inline'
    }));
    pipeStreamSafely(req, res, file);
  } else {
    res.writeHead(200, getSecurityHeaders(req, {
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Cache-Control': cacheControl,
      'Content-Disposition': 'inline'
    }));
    pipeStreamSafely(req, res, fs.createReadStream(fullPath, { highWaterMark: 512 * 1024 }));
  }
}

function patchMoovChunkOffsets(buf, startOffset, endOffset, delta) {
  const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);
  let pos = startOffset;
  while (pos + 8 <= endOffset) {
    let size = buf.readUInt32BE(pos);
    const type = buf.slice(pos + 4, pos + 8).toString('ascii');
    let headerSize = 8;
    if (size === 1 && pos + 16 <= endOffset) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - pos;
    }
    if (size < headerSize || pos + size > endOffset) break;

    if (CONTAINER_TYPES.has(type)) {
      patchMoovChunkOffsets(buf, pos + headerSize, pos + size, delta);
    } else if (type === 'stco' && pos + headerSize + 8 <= pos + size) {
      const entryCount = buf.readUInt32BE(pos + headerSize + 4);
      let entryPos = pos + headerSize + 8;
      for (let i = 0; i < entryCount && entryPos + 4 <= pos + size; i++) {
        buf.writeUInt32BE(buf.readUInt32BE(entryPos) + delta, entryPos);
        entryPos += 4;
      }
    } else if (type === 'co64' && pos + headerSize + 8 <= pos + size) {
      const entryCount = buf.readUInt32BE(pos + headerSize + 4);
      let entryPos = pos + headerSize + 8;
      for (let i = 0; i < entryCount && entryPos + 8 <= pos + size; i++) {
        buf.writeBigUInt64BE(buf.readBigUInt64BE(entryPos) + BigInt(delta), entryPos);
        entryPos += 8;
      }
    }
    pos += size;
  }
}

/**
 * Pure-Node qt-faststart: moves a trailing `moov` atom ahead of `mdat` and shifts `stco`/`co64` offsets
 * so MP4 playback begins immediately without multi-range tail seeks. Safe no-op if already faststart.
 */
async function relocateMoovToFront(filePath) {
  let fh = null;
  const tmpOut = `${filePath}.faststart.tmp`;
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size < 32) return { relocated: false };
    fh = await fs.promises.open(filePath, 'r');
    const hdr = Buffer.alloc(16);
    const boxes = [];
    let offset = 0;
    while (offset + 8 <= stat.size) {
      const { bytesRead } = await fh.read(hdr, 0, 16, offset);
      if (bytesRead < 8) break;
      let size = hdr.readUInt32BE(0);
      const type = hdr.slice(4, 8).toString('ascii');
      if (size === 1 && bytesRead === 16) {
        size = Number(hdr.readBigUInt64BE(8));
      } else if (size === 0) {
        size = stat.size - offset;
      }
      if (size < 8 || offset + size > stat.size) {
        return { relocated: false };
      }
      boxes.push({ type, offset, size });
      offset += size;
    }

    const ftypIdx = boxes.findIndex((b) => b.type === 'ftyp');
    const mdatIdx = boxes.findIndex((b) => b.type === 'mdat');
    const moovIdx = boxes.findIndex((b) => b.type === 'moov');
    if (ftypIdx !== 0 || mdatIdx === -1 || moovIdx === -1 || moovIdx < mdatIdx) {
      return { relocated: false };
    }
    if (boxes[moovIdx].size > 64 * 1024 * 1024) {
      return { relocated: false };
    }

    const moovBox = boxes[moovIdx];
    const moovBuf = Buffer.allocUnsafe(moovBox.size);
    let moovOffsetRead = 0;
    while (moovOffsetRead < moovBox.size) {
      const { bytesRead } = await fh.read(
        moovBuf,
        moovOffsetRead,
        moovBox.size - moovOffsetRead,
        moovBox.offset + moovOffsetRead
      );
      if (bytesRead <= 0) break;
      moovOffsetRead += bytesRead;
    }
    await fh.close();
    fh = null;
    if (moovOffsetRead !== moovBox.size) {
      return { relocated: false };
    }

    // Ensure 64-bit offsets don't overflow 32-bit stco
    if (stat.size + moovBox.size <= 0xffffffff) {
      patchMoovChunkOffsets(moovBuf, 0, moovBuf.length, moovBox.size);
    } else {
      return { relocated: false };
    }

    const copyRange = (srcPath, start, length, outStream) => new Promise((resolve, reject) => {
      if (length <= 0) return resolve();
      const rs = fs.createReadStream(srcPath, { start, end: start + length - 1, highWaterMark: 1024 * 1024 });
      const onError = (err) => {
        rs.destroy();
        reject(err);
      };
      rs.once('error', onError);
      outStream.once('error', onError);
      rs.once('end', () => {
        outStream.off('error', onError);
        resolve();
      });
      rs.pipe(outStream, { end: false });
    });

    const ws = fs.createWriteStream(tmpOut, { highWaterMark: 1024 * 1024 });
    const firstMdatOffset = boxes[mdatIdx].offset;
    await copyRange(filePath, 0, firstMdatOffset, ws);
    await new Promise((resolve, reject) => {
      ws.write(moovBuf, (err) => (err ? reject(err) : resolve()));
    });
    for (let i = mdatIdx; i < boxes.length; i++) {
      if (i === moovIdx) continue;
      await copyRange(filePath, boxes[i].offset, boxes[i].size, ws);
    }
    await new Promise((resolve, reject) => {
      ws.once('error', reject);
      ws.end(resolve);
    });

    await fs.promises.rename(tmpOut, filePath);
    return { relocated: true, moovSize: moovBox.size };
  } catch {
    try { await fs.promises.unlink(tmpOut); } catch {}
    return { relocated: false };
  } finally {
    if (fh !== null) {
      try { await fh.close(); } catch {}
    }
  }
}

function isBunnyApiAvailable() {
  return Boolean(
    process.env.BUNNY_STREAM_LIBRARY_ID &&
    process.env.BUNNY_STREAM_API_KEY
  );
}

function isBunnyConfigured() {
  return Boolean(
    process.env.BUNNY_STREAM_LIBRARY_ID &&
    process.env.BUNNY_STREAM_API_KEY &&
    process.env.BUNNY_STREAM_TOKEN_KEY
  );
}

function signBunnyEmbedUrl(videoGuid, expiresInSeconds = 1800) {
  const libId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY;
  if (!libId || !tokenKey) {
    throw new Error('BUNNY_NOT_CONFIGURED');
  }
  const ttl = Math.max(1800, Number(expiresInSeconds) || 1800);
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const token = crypto.createHash('sha256').update(`${tokenKey}${videoGuid}${expires}`).digest('hex');
  return `https://iframe.mediadelivery.net/embed/${encodeURIComponent(libId)}/${encodeURIComponent(videoGuid)}?token=${token}&expires=${expires}`;
}

/**
 * Creates a video placeholder object in Bunny Stream Library and returns its GUID.
 */
async function createBunnyVideoObject(title) {
  const libId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libId || !apiKey) {
    throw new Error('BUNNY_NOT_CONFIGURED');
  }

  const createRes = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(libId)}/videos`, {
    method: 'POST',
    headers: {
      AccessKey: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ title: String(title || 'محاضرة منصة متن').slice(0, 180) })
  });
  if (!createRes.ok) {
    throw new Error(`BUNNY_CREATE_HTTP_${createRes.status}`);
  }
  const data = await createRes.json();
  if (!data?.guid) throw new Error('BUNNY_NO_GUID');
  return data.guid;
}

/**
 * Uploads an already-saved or validated local video file stream directly to Bunny Stream Library.
 */
async function uploadFileStreamToBunny(guid, filePath) {
  const libId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libId || !apiKey) throw new Error('BUNNY_NOT_CONFIGURED');

  const stat = await fs.promises.stat(filePath);
  const stream = fs.createReadStream(filePath);
  const putRes = await fetch(`https://video.bunnycdn.com/library/${encodeURIComponent(libId)}/videos/${encodeURIComponent(guid)}`, {
    method: 'PUT',
    headers: {
      AccessKey: apiKey,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size)
    },
    duplex: 'half',
    body: stream
  });
  if (!putRes.ok) {
    throw new Error(`BUNNY_UPLOAD_HTTP_${putRes.status}`);
  }
  return { guid, size: stat.size };
}

module.exports = {
  activeUploads,
  getUploadsRoot,
  resolveStoredUploadPath,
  cleanupUnusedUploadFile,
  validateFileSignature,
  pipeStreamSafely,
  streamFileWithRange,
  relocateMoovToFront,
  isBunnyApiAvailable,
  isBunnyConfigured,
  signBunnyEmbedUrl,
  createBunnyVideoObject,
  uploadFileStreamToBunny
};
