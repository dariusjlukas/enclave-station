#pragma once

#include <zlib.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

// Minimal in-memory ZIP builder using zlib deflate.
// Produces a valid ZIP archive (PKZip 2.0 compatible).
class ZipBuilder {
public:
  // Add a file entry with its path inside the zip and raw content.
  void add_file(const std::string& path, const std::string& data) {
    Entry e;
    e.name = path;
    e.uncompressed = data;
    e.crc32 =
      ::crc32(0, reinterpret_cast<const Bytef*>(data.data()), static_cast<uInt>(data.size()));
    e.uncompressed_size = static_cast<uint32_t>(data.size());

    // Deflate
    z_stream strm{};
    deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY);
    std::vector<uint8_t> buf(deflateBound(&strm, static_cast<uLong>(data.size())));
    strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(data.data()));
    strm.avail_in = static_cast<uInt>(data.size());
    strm.next_out = buf.data();
    strm.avail_out = static_cast<uInt>(buf.size());
    deflate(&strm, Z_FINISH);
    buf.resize(strm.total_out);
    deflateEnd(&strm);

    e.compressed.assign(buf.begin(), buf.end());
    e.compressed_size = static_cast<uint32_t>(e.compressed.size());

    entries_.push_back(std::move(e));
  }

  // Build the final ZIP and return it as a binary string.
  std::string build() const {
    std::string out;
    // Reserve approximate size
    size_t approx = 0;
    for (auto& e : entries_)
      approx += 30 + e.name.size() + e.compressed.size() + 46 + e.name.size();
    approx += 22;
    out.reserve(approx);

    // Local file headers + data
    std::vector<uint32_t> offsets;
    for (auto& e : entries_) {
      offsets.push_back(static_cast<uint32_t>(out.size()));
      write_local_header(out, e);
      out.append(e.compressed);
    }

    // Central directory
    uint32_t cd_offset = static_cast<uint32_t>(out.size());
    for (size_t i = 0; i < entries_.size(); ++i) {
      write_central_header(out, entries_[i], offsets[i]);
    }
    uint32_t cd_size = static_cast<uint32_t>(out.size()) - cd_offset;

    // End of central directory
    write_eocd(out, static_cast<uint16_t>(entries_.size()), cd_size, cd_offset);
    return out;
  }

private:
  struct Entry {
    std::string name;
    std::string uncompressed;
    std::string compressed;
    uint32_t crc32 = 0;
    uint32_t compressed_size = 0;
    uint32_t uncompressed_size = 0;
  };

  std::vector<Entry> entries_;

  static void put16(std::string& s, uint16_t v) {
    s.push_back(static_cast<char>(v & 0xff));
    s.push_back(static_cast<char>((v >> 8) & 0xff));
  }
  static void put32(std::string& s, uint32_t v) {
    s.push_back(static_cast<char>(v & 0xff));
    s.push_back(static_cast<char>((v >> 8) & 0xff));
    s.push_back(static_cast<char>((v >> 16) & 0xff));
    s.push_back(static_cast<char>((v >> 24) & 0xff));
  }

  static void write_local_header(std::string& out, const Entry& e) {
    put32(out, 0x04034b50);  // local file header signature
    put16(out, 20);          // version needed (2.0)
    put16(out, 0);           // general purpose bit flag
    put16(out, 8);           // compression method: deflate
    put16(out, 0);           // last mod file time
    put16(out, 0);           // last mod file date
    put32(out, e.crc32);
    put32(out, e.compressed_size);
    put32(out, e.uncompressed_size);
    put16(out, static_cast<uint16_t>(e.name.size()));
    put16(out, 0);  // extra field length
    out.append(e.name);
  }

  static void write_central_header(std::string& out, const Entry& e, uint32_t local_offset) {
    put32(out, 0x02014b50);  // central directory header signature
    put16(out, 20);          // version made by
    put16(out, 20);          // version needed
    put16(out, 0);           // general purpose bit flag
    put16(out, 8);           // compression method: deflate
    put16(out, 0);           // last mod file time
    put16(out, 0);           // last mod file date
    put32(out, e.crc32);
    put32(out, e.compressed_size);
    put32(out, e.uncompressed_size);
    put16(out, static_cast<uint16_t>(e.name.size()));
    put16(out, 0);  // extra field length
    put16(out, 0);  // file comment length
    put16(out, 0);  // disk number start
    put16(out, 0);  // internal file attributes
    put32(out, 0);  // external file attributes
    put32(out, local_offset);
    out.append(e.name);
  }

  static void write_eocd(std::string& out, uint16_t count, uint32_t cd_size, uint32_t cd_offset) {
    put32(out, 0x06054b50);  // end of central directory signature
    put16(out, 0);           // disk number
    put16(out, 0);           // disk with central directory
    put16(out, count);       // entries on this disk
    put16(out, count);       // total entries
    put32(out, cd_size);
    put32(out, cd_offset);
    put16(out, 0);  // comment length
  }
};
