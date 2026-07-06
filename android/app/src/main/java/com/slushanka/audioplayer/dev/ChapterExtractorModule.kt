package com.slushanka.audioplayer.dev

import com.facebook.react.bridge.*
import java.io.RandomAccessFile
import java.net.URI
import android.util.Base64

data class ChapterEntry(val title: String, val startMs: Long)
data class Mp4Box(val type: String, val offset: Long, val end: Long)

class ChapterExtractorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName() = "ChapterExtractor"

    @ReactMethod
    fun extractChapters(uri: String, promise: Promise) {
        try {
            val path = if (uri.startsWith("file://")) URI(uri).path else uri
            val file = RandomAccessFile(path, "r")
            val entries = try {
                val header = ByteArray(4)
                if (file.length() >= 4) {
                    file.seek(0)
                    file.readFully(header)
                }
                if (header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
                    extractMp3Chapters(file)
                } else {
                    extractMp4Chapters(file)
                }
            } finally {
                file.close()
            }

            val chapters = WritableNativeArray()
            entries.forEachIndexed { idx, e ->
                val m = WritableNativeMap()
                m.putString("title", if (e.title.isNotBlank()) e.title else "Глава ${idx + 1}")
                m.putDouble("start", e.startMs.toDouble())
                chapters.pushMap(m)
            }
            promise.resolve(chapters)
        } catch (e: Exception) {
            promise.resolve(WritableNativeArray())
        }
    }

    // ── MP4 / M4A / M4B ──────────────────────────────────────

    private fun extractMp4Chapters(file: RandomAccessFile): List<ChapterEntry> {
        return try {
            val fileSize = file.length()
            val moov = findChildBox(file, 0, fileSize, "moov") ?: return emptyList()

            // 1. Nero-style chapters (moov/udta/chpl) — most common for m4b
            val udta = findChildBox(file, moov.offset, moov.end, "udta")
            if (udta != null) {
                val chpl = findChildBox(file, udta.offset, udta.end, "chpl")
                if (chpl != null) {
                    val chapters = parseChpl(file, chpl)
                    if (chapters.isNotEmpty()) return chapters.sortedBy { it.startMs }
                }
            }

            // 2. QuickTime text-track chapters (trak/tref/chap -> referenced trak)
            val chapterTrackId = findChapterTrackId(file, moov) ?: return emptyList()
            val trak = findTrakById(file, moov, chapterTrackId) ?: return emptyList()
            parseChapterTrack(file, trak).sortedBy { it.startMs }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun parseChpl(file: RandomAccessFile, box: Mp4Box): List<ChapterEntry> {
        val result = mutableListOf<ChapterEntry>()
        val len = (box.end - box.offset).toInt()
        if (len < 9) return result
        val data = ByteArray(len)
        file.seek(box.offset)
        file.readFully(data)
        // FullBox header: version(1)+flags(3), then reserved uint32, then uint8 chapter count
        var p = 8
        if (p >= data.size) return result
        val count = data[p].toInt() and 0xFF
        p += 1
        for (idx in 0 until count) {
            if (p + 9 > data.size) break
            var start = 0L
            for (k in 0 until 8) start = (start shl 8) or (data[p + k].toLong() and 0xFF)
            p += 8
            val strLen = data[p].toInt() and 0xFF
            p += 1
            if (p + strLen > data.size) break
            val title = String(data, p, strLen, Charsets.UTF_8)
            p += strLen
            result.add(ChapterEntry(title, start / 10000L)) // 100ns units -> ms
        }
        return result
    }

    private fun findChapterTrackId(file: RandomAccessFile, moov: Mp4Box): Long? {
        val traks = findAllChildBoxes(file, moov.offset, moov.end, "trak")
        for (trak in traks) {
            val tref = findChildBox(file, trak.offset, trak.end, "tref") ?: continue
            val chap = findChildBox(file, tref.offset, tref.end, "chap") ?: continue
            if (chap.end - chap.offset < 4) continue
            return readU32(file, chap.offset)
        }
        return null
    }

    private fun findTrakById(file: RandomAccessFile, moov: Mp4Box, trackId: Long): Mp4Box? {
        val traks = findAllChildBoxes(file, moov.offset, moov.end, "trak")
        for (trak in traks) {
            val tkhd = findChildBox(file, trak.offset, trak.end, "tkhd") ?: continue
            val version = readU8(file, tkhd.offset)
            val idOffset = if (version == 1) tkhd.offset + 4 + 8 + 8 else tkhd.offset + 4 + 4 + 4
            if (readU32(file, idOffset) == trackId) return trak
        }
        return null
    }

    private fun parseChapterTrack(file: RandomAccessFile, trak: Mp4Box): List<ChapterEntry> {
        val mdia = findChildBox(file, trak.offset, trak.end, "mdia") ?: return emptyList()
        val mdhd = findChildBox(file, mdia.offset, mdia.end, "mdhd") ?: return emptyList()
        val mdhdVersion = readU8(file, mdhd.offset)
        val timescale = if (mdhdVersion == 1) readU32(file, mdhd.offset + 4 + 8 + 8) else readU32(file, mdhd.offset + 4 + 4 + 4)
        if (timescale <= 0) return emptyList()

        val minf = findChildBox(file, mdia.offset, mdia.end, "minf") ?: return emptyList()
        val stbl = findChildBox(file, minf.offset, minf.end, "stbl") ?: return emptyList()
        val stts = findChildBox(file, stbl.offset, stbl.end, "stts") ?: return emptyList()
        val stsz = findChildBox(file, stbl.offset, stbl.end, "stsz") ?: return emptyList()
        val stsc = findChildBox(file, stbl.offset, stbl.end, "stsc") ?: return emptyList()
        val stco = findChildBox(file, stbl.offset, stbl.end, "stco")
        val co64 = if (stco == null) findChildBox(file, stbl.offset, stbl.end, "co64") else null
        if (stco == null && co64 == null) return emptyList()

        val durations = parseSampleDurations(file, stts)
        if (durations.isEmpty()) return emptyList()

        val starts = mutableListOf<Long>()
        var cum = 0L
        for (d in durations) {
            starts.add(cum * 1000L / timescale)
            cum += d
        }

        val sizes = parseSampleSizes(file, stsz, durations.size)
        val stscEntries = parseStsc(file, stsc)
        val chunkOffsets = parseChunkOffsets(file, stco, co64)
        val sampleOffsets = computeSampleOffsets(stscEntries, chunkOffsets, sizes)

        val result = mutableListOf<ChapterEntry>()
        for (i in starts.indices) {
            if (i >= sampleOffsets.size || i >= sizes.size) break
            val title = readChapterTitle(file, sampleOffsets[i], sizes[i])
            result.add(ChapterEntry(title, starts[i]))
        }
        return result
    }

    private fun parseSampleDurations(file: RandomAccessFile, stts: Mp4Box): List<Long> {
        val entryCount = readU32(file, stts.offset + 4).toInt()
        val durations = mutableListOf<Long>()
        var pos = stts.offset + 8
        for (i in 0 until minOf(entryCount, 100000)) {
            if (pos + 8 > stts.end) break
            val count = readU32(file, pos)
            val delta = readU32(file, pos + 4)
            for (c in 0 until minOf(count, 10000L)) durations.add(delta)
            pos += 8
        }
        return durations
    }

    private fun parseSampleSizes(file: RandomAccessFile, stsz: Mp4Box, sampleCount: Int): List<Int> {
        val sampleSize = readU32(file, stsz.offset + 4).toInt()
        val count = readU32(file, stsz.offset + 8).toInt()
        if (sampleSize != 0) return List(sampleCount) { sampleSize }
        val sizes = mutableListOf<Int>()
        var pos = stsz.offset + 12
        for (i in 0 until minOf(count, sampleCount)) {
            if (pos + 4 > stsz.end) break
            sizes.add(readU32(file, pos).toInt())
            pos += 4
        }
        return sizes
    }

    private data class StscEntry(val firstChunk: Int, val samplesPerChunk: Int)

    private fun parseStsc(file: RandomAccessFile, stsc: Mp4Box): List<StscEntry> {
        val count = readU32(file, stsc.offset + 4).toInt()
        val entries = mutableListOf<StscEntry>()
        var pos = stsc.offset + 8
        for (i in 0 until count) {
            if (pos + 8 > stsc.end) break
            entries.add(StscEntry(readU32(file, pos).toInt(), readU32(file, pos + 4).toInt()))
            pos += 12
        }
        return entries
    }

    private fun parseChunkOffsets(file: RandomAccessFile, stco: Mp4Box?, co64: Mp4Box?): List<Long> {
        val offsets = mutableListOf<Long>()
        if (stco != null) {
            val count = readU32(file, stco.offset + 4).toInt()
            var pos = stco.offset + 8
            for (i in 0 until count) {
                if (pos + 4 > stco.end) break
                offsets.add(readU32(file, pos)); pos += 4
            }
        } else if (co64 != null) {
            val count = readU32(file, co64.offset + 4).toInt()
            var pos = co64.offset + 8
            for (i in 0 until count) {
                if (pos + 8 > co64.end) break
                offsets.add(readU64(file, pos)); pos += 8
            }
        }
        return offsets
    }

    private fun computeSampleOffsets(stscEntries: List<StscEntry>, chunkOffsets: List<Long>, sampleSizes: List<Int>): List<Long> {
        val offsets = mutableListOf<Long>()
        var sampleIdx = 0
        for (chunkIdx in chunkOffsets.indices) {
            val chunkNum = chunkIdx + 1
            var samplesPerChunk = 1
            for (entry in stscEntries) {
                if (entry.firstChunk <= chunkNum) samplesPerChunk = entry.samplesPerChunk else break
            }
            var offsetInChunk = chunkOffsets[chunkIdx]
            for (s in 0 until samplesPerChunk) {
                if (sampleIdx >= sampleSizes.size) return offsets
                offsets.add(offsetInChunk)
                offsetInChunk += sampleSizes[sampleIdx]
                sampleIdx++
            }
        }
        return offsets
    }

    private fun readChapterTitle(file: RandomAccessFile, offset: Long, size: Int): String {
        if (size < 2) return ""
        return try {
            file.seek(offset)
            val lenBytes = ByteArray(2)
            file.readFully(lenBytes)
            val textLen = ((lenBytes[0].toInt() and 0xFF) shl 8) or (lenBytes[1].toInt() and 0xFF)
            val actualLen = minOf(textLen, size - 2)
            if (actualLen <= 0) return ""
            val textBytes = ByteArray(actualLen)
            file.readFully(textBytes)
            String(textBytes, Charsets.UTF_8)
        } catch (e: Exception) {
            ""
        }
    }

    // ── ISO-BMFF box walking helpers ─────────────────────────

    private fun readBox(file: RandomAccessFile, pos: Long, limit: Long): Mp4Box? {
        if (pos + 8 > limit) return null
        file.seek(pos)
        val sizeBytes = ByteArray(4)
        file.readFully(sizeBytes)
        var size = readU32BE(sizeBytes, 0)
        val typeBytes = ByteArray(4)
        file.readFully(typeBytes)
        val type = String(typeBytes, Charsets.US_ASCII)
        var headerSize = 8L
        if (size == 1L) {
            val largeBytes = ByteArray(8)
            file.readFully(largeBytes)
            size = readU64BE(largeBytes, 0)
            headerSize = 16L
        } else if (size == 0L) {
            size = limit - pos
        }
        val end = pos + size
        if (size < headerSize || end > limit || end <= pos) return null
        return Mp4Box(type, pos + headerSize, end)
    }

    private fun findChildBox(file: RandomAccessFile, parentStart: Long, parentEnd: Long, targetType: String): Mp4Box? {
        var pos = parentStart
        while (pos + 8 <= parentEnd) {
            val box = readBox(file, pos, parentEnd) ?: break
            if (box.type == targetType) return box
            pos = box.end
        }
        return null
    }

    private fun findAllChildBoxes(file: RandomAccessFile, parentStart: Long, parentEnd: Long, targetType: String): List<Mp4Box> {
        val result = mutableListOf<Mp4Box>()
        var pos = parentStart
        while (pos + 8 <= parentEnd) {
            val box = readBox(file, pos, parentEnd) ?: break
            if (box.type == targetType) result.add(box)
            pos = box.end
        }
        return result
    }

    private fun readU8(file: RandomAccessFile, pos: Long): Int {
        file.seek(pos)
        return file.readUnsignedByte()
    }

    private fun readU32(file: RandomAccessFile, pos: Long): Long {
        file.seek(pos)
        val b = ByteArray(4)
        file.readFully(b)
        return readU32BE(b, 0)
    }

    private fun readU64(file: RandomAccessFile, pos: Long): Long {
        file.seek(pos)
        val b = ByteArray(8)
        file.readFully(b)
        return readU64BE(b, 0)
    }

    private fun readU32BE(b: ByteArray, offset: Int): Long {
        return ((b[offset].toLong() and 0xFF) shl 24) or
               ((b[offset + 1].toLong() and 0xFF) shl 16) or
               ((b[offset + 2].toLong() and 0xFF) shl 8) or
               (b[offset + 3].toLong() and 0xFF)
    }

    private fun readU64BE(b: ByteArray, offset: Int): Long {
        var v = 0L
        for (i in 0 until 8) v = (v shl 8) or (b[offset + i].toLong() and 0xFF)
        return v
    }

    // ── MP3 / ID3v2 chapters (CHAP frames) ───────────────────

    private fun extractMp3Chapters(file: RandomAccessFile): List<ChapterEntry> {
        val header = ByteArray(10)
        file.seek(0)
        file.readFully(header)
        val majorVersion = header[3].toInt() and 0xFF
        val tagSize = synchsafeToInt(header, 6)
        val tagEnd = 10L + tagSize
        val chapters = mutableListOf<ChapterEntry>()
        var pos = 10L
        while (pos + 10 <= tagEnd) {
            file.seek(pos)
            val frameIdBytes = ByteArray(4)
            file.readFully(frameIdBytes)
            if (frameIdBytes[0].toInt() == 0) break // padding reached
            val frameId = String(frameIdBytes, Charsets.US_ASCII)
            val sizeBytes = ByteArray(4)
            file.readFully(sizeBytes)
            val frameSize = if (majorVersion >= 4) synchsafeToInt(sizeBytes, 0) else beInt(sizeBytes, 0)
            file.skipBytes(2) // flags
            val frameContentStart = pos + 10
            if (frameSize <= 0 || frameContentStart + frameSize > tagEnd) break
            if (frameId == "CHAP") {
                val chapter = parseChapFrame(file, frameContentStart, frameSize, majorVersion)
                if (chapter != null) chapters.add(chapter)
            }
            pos = frameContentStart + frameSize
        }
        return chapters.sortedBy { it.startMs }
    }

    private fun parseChapFrame(file: RandomAccessFile, start: Long, size: Int, majorVersion: Int): ChapterEntry? {
        return try {
            file.seek(start)
            val buf = ByteArray(size)
            file.readFully(buf)
            var idEnd = -1
            for (k in buf.indices) {
                if (buf[k].toInt() == 0) { idEnd = k; break }
            }
            if (idEnd < 0) return null
            var p = idEnd + 1
            if (p + 16 > buf.size) return null
            val startMs = beInt(buf, p).toLong()
            p += 16 // start time(4) + end time(4) + start offset(4) + end offset(4)

            var title = ""
            while (p + 10 <= buf.size) {
                val subId = String(buf, p, 4, Charsets.US_ASCII)
                val subSize = if (majorVersion >= 4) synchsafeToInt(buf, p + 4) else beInt(buf, p + 4)
                p += 10
                if (subSize <= 0 || p + subSize > buf.size) break
                if (subId == "TIT2") {
                    val encoding = buf[p].toInt() and 0xFF
                    val textBytes = buf.copyOfRange(p + 1, p + subSize)
                    title = decodeId3Text(textBytes, encoding)
                }
                p += subSize
            }
            ChapterEntry(title, startMs)
        } catch (e: Exception) {
            null
        }
    }

    private fun decodeId3Text(bytes: ByteArray, encoding: Int): String {
        return try {
            val text = when (encoding) {
                0 -> String(bytes, Charsets.ISO_8859_1)
                1 -> String(bytes, Charsets.UTF_16)
                2 -> String(bytes, Charsets.UTF_16BE)
                else -> String(bytes, Charsets.UTF_8)
            }
            text.trimEnd(' ')
        } catch (e: Exception) {
            ""
        }
    }

    private fun synchsafeToInt(bytes: ByteArray, offset: Int): Int {
        return ((bytes[offset].toInt() and 0x7F) shl 21) or
               ((bytes[offset + 1].toInt() and 0x7F) shl 14) or
               ((bytes[offset + 2].toInt() and 0x7F) shl 7) or
               (bytes[offset + 3].toInt() and 0x7F)
    }

    private fun beInt(bytes: ByteArray, offset: Int): Int {
        return ((bytes[offset].toInt() and 0xFF) shl 24) or
               ((bytes[offset + 1].toInt() and 0xFF) shl 16) or
               ((bytes[offset + 2].toInt() and 0xFF) shl 8) or
               (bytes[offset + 3].toInt() and 0xFF)
    }

    // ── Cover extraction (unchanged approach) ────────────────

    @ReactMethod
    fun extractCover(uri: String, promise: Promise) {
        try {
            val path = if (uri.startsWith("file://")) URI(uri).path else uri
            val file = RandomAccessFile(path, "r")
            val fileSize = file.length()

            // Обложката обикновено е в началото на файла в ID3 тага
            // Четем първите 200KB
            val readSize = minOf(200_000L, fileSize)
            file.seek(0)
            val buffer = ByteArray(readSize.toInt())
            file.read(buffer)

            // Търси JPEG сигнатура (FFD8FF) - JPEG обложка
            var jpegStart = -1
            var jpegEnd = -1
            for (i in 0 until buffer.size - 3) {
                if (buffer[i] == 0xFF.toByte() && buffer[i+1] == 0xD8.toByte() && buffer[i+2] == 0xFF.toByte()) {
                    jpegStart = i
                    break
                }
            }

            if (jpegStart >= 0) {
                // Намери края на JPEG (FFD9)
                for (i in jpegStart until buffer.size - 1) {
                    if (buffer[i] == 0xFF.toByte() && buffer[i+1] == 0xD9.toByte()) {
                        jpegEnd = i + 2
                        break
                    }
                }

                if (jpegEnd > jpegStart) {
                    val imageBytes = buffer.copyOfRange(jpegStart, jpegEnd)
                    val base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)
                    promise.resolve("data:image/jpeg;base64,$base64")
                    file.close()
                    return
                }
            }

            // Ако няма в началото, провери и в края (някои M4B файлове пазят там)
            val readSizeEnd = minOf(500_000L, fileSize)
            val startPos = fileSize - readSizeEnd
            file.seek(startPos)
            val bufferEnd = ByteArray(readSizeEnd.toInt())
            file.read(bufferEnd)
            file.close()

            // Търси "covr" атом в MP4
            val covrIdx = findBytes(bufferEnd, byteArrayOf(99, 111, 118, 114)) // "covr"
            if (covrIdx >= 0) {
                // След covr има data атом
                val dataIdx = findBytes(bufferEnd, byteArrayOf(100, 97, 116, 97), covrIdx) // "data"
                if (dataIdx >= 0 && dataIdx + 16 < bufferEnd.size) {
                    val dataSize = read32(bufferEnd, dataIdx - 4)
                    val imageStart = dataIdx + 16 // skip data atom header
                    val imageEnd = minOf(dataIdx + dataSize, bufferEnd.size)
                    if (imageEnd > imageStart) {
                        val imageBytes = bufferEnd.copyOfRange(imageStart, imageEnd)
                        val base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP)
                        promise.resolve("data:image/jpeg;base64,$base64")
                        return
                    }
                }
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    private fun findBytes(buffer: ByteArray, pattern: ByteArray, startFrom: Int = 0): Int {
        outer@ for (i in startFrom until buffer.size - pattern.size) {
            for (j in pattern.indices) {
                if (buffer[i + j] != pattern[j]) continue@outer
            }
            return i
        }
        return -1
    }

    private fun read32(buffer: ByteArray, pos: Int): Int {
        if (pos + 3 >= buffer.size) return 0
        return ((buffer[pos].toInt() and 0xFF) shl 24) or
               ((buffer[pos+1].toInt() and 0xFF) shl 16) or
               ((buffer[pos+2].toInt() and 0xFF) shl 8) or
               (buffer[pos+3].toInt() and 0xFF)
    }
}
