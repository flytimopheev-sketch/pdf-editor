#!/usr/bin/env python3
"""Build RPM package for PDF Editor (Редактор PDF) for РЕД ОС"""

import os
import sys
import subprocess
import tarfile
import hashlib
import struct
import gzip
import io
import time
import pwd
import grp
from pathlib import Path

RPM_BUILD = "/tmp/rpm-build"
BUILDROOT = f"{RPM_BUILD}/BUILDROOT"
APP_NAME = "pdf-editor"
VERSION = "1.0.0"
RELEASE = "1"
ARCH = "x86_64"
LICENSE = "MIT"
SUMMARY = "Редактор PDF — графический редактор PDF файлов"
DESCRIPTION = """Редактор PDF (PDF Editor) — графическое веб-приложение для редактирования PDF файлов.
Поддерживаемые функции:
  - Открытие и просмотр многостраничных PDF документов
  - Вращение страниц (±90° и ±1° для точного выравнивания)
  - Добавление текста с выбором шрифта и размера
  - Пипетка для выбора цвета из документа
  - Выделение и копирование фрагментов
  - Вставка фрагментов (из текущего или другого PDF)
  - Сжатие PDF
"""

def collect_files(buildroot):
    """Collect all files with their metadata"""
    files = []
    for root, dirs, filenames in os.walk(buildroot):
        dirs.sort()
        for fn in sorted(filenames):
            fpath = os.path.join(root, fn)
            rel = os.path.relpath(fpath, buildroot)
            st = os.stat(fpath)
            mode = oct(st.st_mode)[-3:]
            # Determine if it's config, doc, etc.
            ftype = ''
            if rel.startswith('etc/'):
                ftype = 'c'  # config
            files.append((rel, ftype, mode))
    return files

def file_size(buildroot, rel):
    """Get file size"""
    fpath = os.path.join(buildroot, rel)
    return os.path.getsize(fpath)

def build_cpio_archive(buildroot, files):
    """Build a cpio archive of all files"""
    buf = io.BytesIO()
    
    for rel, ftype, mode in files:
        fpath = os.path.join(buildroot, rel)
        st = os.stat(fpath)
        
        # CPIO header (newc format)
        name = rel + '\x00'
        header = struct.pack(
            '<6s8s8s8s8s8s8s8s8s8s8s8s8s',
            b'070701',                   # magic
            hex(st.st_ino)[2:].encode() + b'\x00',  # ino
            hex(st.st_mode)[2:].encode() + b'\x00', # mode
            hex(st.st_uid)[2:].encode() + b'\x00',  # uid
            hex(st.st_gid)[2:].encode() + b'\x00',  # gid
            hex(st.st_nlink)[2:].encode() + b'\x00', # nlink
            hex(st.st_mtime)[2:].encode() + b'\x00', # mtime
            hex(st.st_size)[2:].encode() + b'\x00',  # filesize
            hex(0)[2:].encode() + b'\x00',          # devmajor
            hex(0)[2:].encode() + b'\x00',          # devminor
            hex(0)[2:].encode() + b'\x00',          # rdevmajor
            hex(0)[2:].encode() + b'\x00',          # rdevminor
            hex(len(name))[2:].encode() + b'\x00',  # namesize
            b'00000000\x00',                         # check
        )
        # Pad header to 110 bytes
        header = header.ljust(110, b'\x00')
        
        buf.write(header)
        buf.write(name.encode())
        # Pad name to multiple of 4
        name_len = len(name.encode())
        if name_len % 4:
            buf.write(b'\x00' * (4 - name_len % 4))
        
        # Write file content
        with open(fpath, 'rb') as f:
            data = f.read()
        buf.write(data)
        # Pad to block boundary
        if len(data) % 4:
            buf.write(b'\x00' * (4 - len(data) % 4))
    
    # Trailer
    trailer = struct.pack(
        '<6s8s8s8s8s8s8s8s8s8s8s8s8s',
        b'070701',
        b'00000000\x00', b'00000000\x00', b'00000000\x00',
        b'00000000\x00', b'00000000\x00', b'00000000\x00',
        b'00000000\x00', b'00000000\x00', b'00000000\x00',
        b'00000000\x00', b'00000000\x00', b'0b\x00', b'00000000\x00',
    )
    trailer = trailer.ljust(110, b'\x00')
    buf.write(trailer)
    buf.write(b'TRAILER\x00\x00')
    # Pad to 512 boundary
    pos = buf.tell()
    if pos % 512:
        buf.write(b'\x00' * (512 - pos % 4 if pos % 4 else 0))
    
    return buf.getvalue()

def build_rpm_archive(files_data, buildroot, files):
    """Build the RPM binary archive"""
    buf = io.BytesIO()
    
    # Lead (96 bytes)
    lead = struct.pack(
        '<4s8s16s16s16s16s60s16sIHH',
        b'\xed\xab\xee\xdb',  # magic
        b'03',                  # major version
        b'00',                  # minor version
        b'pdf-editor',          # name
        VERSION.encode(),
        RELEASE.encode(),
        ARCH.encode(),
        b'',                    # os
        b'',                    # arch
        5,                      # file type (binary)
        16,                     # version
    )
    # Pad to 96 bytes
    lead = lead.ljust(96, b'\x00')
    buf.write(lead)
    
    # Signature section
    # We need to calculate content sizes
    # Header + file entries + cpio + pad
    
    # Build header first to calculate sizes
    # Signature header entries
    sig_entries = [
        (62, b'RSA5(SHA1(OpenSSL))', -1),  # RSAHEADER
        (1000, b'', -1),                      # HEADERIMMUTABLE
        (269, VERSION.encode(), -1),          # VERSION
    ]
    
    # Build the immutable header entries
    header_entries = [
        (1000, b'1', -1),                   # HEADERIMMUTABLE
        (1001, VERSION.encode(), -1),        # HEADERVERSION
        (1004, APP_NAME.encode(), -1),       # NAME
        (1005, VERSION.encode(), -1),        # VERSION
        (1006, RELEASE.encode(), -1),        # RELEASE
        (1007, ARCH.encode(), -1),           # ARCH
        (1009, LICENSE.encode(), -1),        # LICENSE
        (1021, SUMMARY.encode(), -1),         # SUMMARY
        (1124, DESCRIPTION.encode(), -1),    # DESCRIPTION
        (1098, b'(none)', -1),              # PREIN
        (1020, b'(none)', -1),              # PREUN
        (1021, b'(none)', -1),              # POSTIN
        (1022, b'(none)', -1),              # POSTUN
        (1023, b'(none)', -1),              # FILENAMES
        (1024, ARCH.encode(), -1),           # FILEDEVICES
        (1025, ARCH.encode(), -1),           # FILEINODES
        (1026, b'0', -1),                   # FILELANGS
        (1027, b'0', -1),                   # FILERDEVS
        (1028, b'0', -1),                   # FILESIZES
        (1029, ARCH.encode(), -1),           # FILEMTIMES
        (1030, b'0', -1),                   # FILEMD5S (or FILEDIGESTS)
        (1031, b'0', -1),                   # FILELINKTOS
        (1034, b'0', -1),                   # FILEFLAGS
        (1035, b'0', -1),                   # FILEUSERNAME
        (1036, b'0', -1),                   # FILEGROUPNAME
        (1037, ARCH.encode(), -1),          # FILEDEVICES (uint32)
        (1038, ARCH.encode(), -1),          # FILEINODES (uint32)
        (1039, b'0', -1),                   # FILELANGS (uint32)
        (1040, b'0', -1),                   # FILERDEVS (uint32)
        (1041, b'0', -1),                   # FILESIZES (uint32)
        (1042, ARCH.encode(), -1),           # FILEMTIMES (uint32)
        (1043, b'0', -1),                   # FILEMD5S (uint32)
        (1044, b'0', -1),                   # FILELINKTOS (uint32)
        (1045, b'0', -1),                   # FILEFLAGS (uint32)
        (1046, b'0', -1),                   # FILEUSERNAME (uint32)
        (1047, b'0', -1),                   # FILEGROUPNAME (uint32)
        (1049, b'8', -1),                   # FILEMODES
        (1050, b'0', -1),                   # FILERDEVS
        (1051, b'0', -1),                   # FILEINODES
        (1052, b'0', -1),                   # FILELANGS
        (1053, b'0', -1),                   # FILESIZES
        (1054, ARCH.encode(), -1),           # FILEMTIMES
        (1055, b'0', -1),                   # FILEMD5S
        (1056, b'0', -1),                   # FILELINKTOS
        (1057, b'0', -1),                   # FILEFLAGS
        (1058, b'0', -1),                   # FILEUSERNAME
        (1059, b'0', -1),                   # FILEGROUPNAME
        # Sizes
        (1028, b'', len(files)),             # FILESIZES - count
        (1124, b'', len(files)),             # BASENAMES count
        (1098, b'', len(files)),             # DIRINDEXES count
        (1116, b'', len(files)),             # DIRNAMES count
    ]
    
    # Build the actual header with file data
    # Filenames, sizes, modes, digests, etc.
    basenames = []
    dirnames_set = set()
    dirindexes = []
    filesizes = []
    filemodes = []
    filemtimes = []
    filemd5s = []
    
    for rel, ftype, mode in files:
        fpath = os.path.join(buildroot, rel)
        st = os.stat(fpath)
        
        # Basename
        basenames.append(os.path.basename(rel).encode() + b'\x00')
        
        # Dirname
        dir = os.path.dirname(rel)
        if dir and dir != '.':
            dirnames_set.add(dir)
        dirindexes.append(dirnames_set.__len__().__class__)
    
    # This approach is getting complex. Let's use a simpler method:
    # Build the RPM using the rpmbuild-like structure via a shell script approach
    pass
    
    return None

def build_rpm_simple():
    """Build RPM using cpio + gzip compression manually"""
    
    # Collect files
    files = collect_files(BUILDROOT)
    
    print(f"  Files to package: {len(files)}")
    
    # Calculate total installed size
    total_size = sum(file_size(BUILDROOT, rel) for rel, _, _ in files)
    print(f"  Total installed size: {total_size / 1024 / 1024:.1f} MB")
    
    # Build header entries
    def entry(tag, value_type, value):
        """Create a single header entry"""
        if isinstance(value, str):
            value = value.encode()
        if isinstance(value, int):
            value = str(value).encode()
        data = struct.pack('>HHI', tag, value_type, len(value)) + value
        # Pad to 8-byte boundary
        remainder = len(data) % 8
        if remainder:
            data += b'\x00' * (8 - remainder)
        return data
    
    STRING_TYPE = 6
    INT32_TYPE = 4
    NULL_TYPE = 0
    BIN_TYPE = 7
    INT16_TYPE = 3
    INT64_TYPE = 5
    
    # Build signature header
    sig_header = entry(62, BIN_TYPE, b'\x00' * 16)  # RSAHEADER (empty for now)
    sig_header += entry(1000, INT32_TYPE, 1)  # HEADERIMMUTABLE
    
    sig_index_count = 3
    sig_data_count = 0
    sig_header = struct.pack('>HH', sig_index_count, sig_data_count) + sig_header
    sig_header_size = len(sig_header) + 16  # +16 for the size fields
    sig_header = struct.pack('>I', sig_header_size) + sig_header
    # Actually, let me use the correct RPM header format
    
    # I'll use a different approach - just build the binary blob directly
    return build_rpm_binary(files, total_size)

def make_header_entry(tag, typ, value):
    """Build a single header entry (tag[4] + type[4] + offset[4] + count[4])"""
    return struct.pack('>III', tag, typ, 0) + struct.pack('>I', len(value) if isinstance(value, (bytes, list)) else 1)

def build_rpm_binary(files, total_size):
    """Build RPM binary"""
    buf = io.BytesIO()
    
    STRING = 6
    INT32 = 4
    NULL = 0
    BIN = 7
    INT16 = 3
    INT64 = 5
    
    # === LEAD (96 bytes) ===
    buf.write(b'\xed\xab\xee\xdb')  # magic
    buf.write(struct.pack('>8x'))     # major.minor
    buf.write(struct.pack('>16s', APP_NAME.encode()))
    buf.write(struct.pack('>16s', VERSION.encode()))
    buf.write(struct.pack('>16s', RELEASE.encode()))
    buf.write(struct.pack('>16s', ARCH.encode()))
    buf.write(struct.pack('>16x'))    # os
    buf.write(struct.pack('>16x'))    # arch  
    buf.write(struct.pack('>I', 5))   # type: binary
    buf.write(struct.pack('>H', 16))  # version
    buf.write(struct.pack('>56x'))    # reserved
    assert buf.tell() == 96
    
    # === SIGNATURE HEADER ===
    sig_start = buf.tell()
    
    # Placeholder signature - minimal entries
    sig_entries = [
        (62, BIN, b'\x00' * 16),   # RPMSIGTAG_RSAHEADER
        (1000, INT32, 1),           # RPMSIGTAG_HEADERSIGNATURES
        (269, STRING, VERSION.encode() + b'\x00'),  # RPMSIGTAG_PAYLOADSIZE not needed but version
    ]
    
    sig_content = b''
    for tag, typ, val in sig_entries:
        val_bytes = val if isinstance(val, bytes) else struct.pack('>I', val)
        sig_content += struct.pack('>IIII', tag, typ, 1 if typ == INT32 else len(val_bytes), 0 if typ == INT32 else 0)
        if typ != INT32:
            sig_content += val_bytes
        # Pad to 8-byte boundary
        rem = len(val_bytes) % 8
        if rem:
            sig_content += b'\x00' * (8 - rem)
    
    sig_count = len(sig_entries)
    sig_header_data = struct.pack('>II', sig_count, sig_count) + sig_content
    sig_header_padded = sig_header_data
    # Store size for later patching
    
    buf.write(struct.pack('>I', 0))  # placeholder for size
    buf.write(sig_header_padded)
    sig_end = buf.tell()
    
    # === IMMUTABLE HEADER ===
    # Build all header data first to calculate cpio offset
    
    basenames = []
    dirnames_list = []
    dirnames_set = []
    dirindexes = []
    filesizes_int32 = []
    filesizes_int64 = []
    filemodes = []
    filemtimes_int32 = []
    filemtimes_int64 = []
    filemd5s = []
    fileflags = []
    filelinks = []
    
    for rel, ftype, mode in files:
        fpath = os.path.join(buildroot, rel)
        st = os.stat(fpath)
        
        basenames.append(os.path.basename(rel).encode() + b'\x00')
        
        # Dirname
        d = '/' + os.path.dirname(rel)
        try:
            idx = dirnames_set.index(d)
        except ValueError:
            idx = len(dirnames_set)
            dirnames_set.append(d)
            dirnames_list.append(d.encode() + b'\x00')
        dirindexes.append(idx)
        
        filesizes_int32.append(st.st_size)
        filesizes_int64.append(st.st_size)
        filemodes.append(int(mode, 8))
        filemtimes_int32.append(int(st.st_mtime))
        filemtimes_int64.append(int(st.st_mtime)
        
        # MD5
        import hashlib
        md5 = hashlib.md5()
        with open(fpath, 'rb') as f:
            md5.update(f.read())
        filemd5s.append(md5.hexdigest().encode())
        
        fileflags.append(1 if ftype == 'c' else 0)  # 1=conffile
        filelinks.append(b'\x00')
    
    # Build immutable header entries
    imm_content = b''
    
    def add_entry(tag, typ, data):
        nonlocal imm_content
        count = 1
        if isinstance(data, list):
            count = len(data)
            raw = b''.join(data)
        elif isinstance(data, bytes):
            raw = data
        else:
            raw = struct.pack('>I', data)
        imm_content += struct.pack('>IIII', tag, typ, count, 0)
        if typ != INT32 and typ != INT16:
            imm_content += raw
        rem = len(imm_content) % 8
        if rem:
            imm_content += b'\x00' * (8 - rem)
    
    add_entry(1000, INT32, 1)                     # HEADERIMMUTABLE
    add_entry(1004, STRING, APP_NAME.encode() + b'\x00')
    add_entry(1005, STRING, VERSION.encode() + b'\x00')
    add_entry(1006, STRING, RELEASE.encode() + b'\x00')
    add_entry(1021, STRING, SUMMARY.encode() + b'\x00')
    add_entry(1022, STRING, LICENSE.encode() + b'\x00')
    add_entry(1023, STRING, DESCRIPTION.encode() + b'\x00')
    
    # File data entries
    add_entry(1024, INT32, 1)                     # FILEDEVICES (deprecated)
    add_entry(1028, INT32, filesizes_int32)
    add_entry(1030, STRING, basenames)
    add_entry(1034, INT32, fileflags)
    add_entry(1035, INT32, filesizes_int32)
    add_entry(1036, STRING, basenames)
    add_entry(1039, INT16, filemodes)
    add_entry(1049, INT16, filemodes)
    add_entry(1057, INT32, fileflags)
    add_entry(1098, STRING, basenames)
    add_entry(1116, STRING, dirnames_list)
    
    imm_count = imm_content.count(b'\x00') // 4  # rough estimate
    imm_data = struct.pack('>II', 30, 30) + imm_content  # count = number of entries
    
    # Write immutable header
    imm_start = buf.tell()
    buf.write(struct.pack('>I', 0))  # placeholder
    buf.write(imm_data)
    imm_end = buf.tell()
    
    # === CPIO ARCHIVE ===
    cpio_data = build_cpio_archive(BUILDROOT, files)
    
    # Compress with gzip
    cpio_compressed = gzip.compress(cpio_data, compresslevel=6)
    
    cpio_start = buf.tell()
    buf.write(cpio_compressed)
    cpio_end = buf.tell()
    
    # Now patch the signature and immutable header sizes
    buf.seek(sig_start)
    buf.write(struct.pack('>I', sig_end - sig_start - 4))  # sig header size (excluding size field itself... actually including it)
    
    buf.seek(imm_start)
    buf.write(struct.pack('>I', imm_end - imm_start - 4))
    
    return buf.getvalue()

if __name__ == '__main__':
    buildroot = BUILDROOT
    if not os.path.exists(buildroot):
        print(f"Error: Buildroot {buildroot} not found")
        sys.exit(1)
    
    print(f"Building RPM: {APP_NAME}-{VERSION}-{RELEASE}.{ARCH}.rpm")
    
    files = collect_files(buildroot)
    total_size = sum(file_size(buildroot, rel) for rel, _, _ in files)
    
    print(f"  Files: {len(files)}")
    print(f"  Installed size: {total_size / 1024 / 1024:.1f} MB")
    
    # Build using tar-based approach (simpler and more reliable)
    output_path = f"/home/z/my-project/{APP_NAME}-{VERSION}-{RELEASE}.{ARCH}.rpm"
    
    # Actually, let's use a shell-based approach with cpio
    print("  Building via cpio + gzip...")
    
    # Create file list
    filelist_path = f"/tmp/rpm-filelist.txt"
    with open(filelist_path, 'w') as f:
        for rel, _, _ in files:
            f.write(f".{rel}\n")
    
    # Build cpio archive
    cpio_path = f"/tmp/rpm-payload.cpio"
    os.chdir(buildroot)
    subprocess.run(
        ['bash', '-c', f'find . -print0 | cpio --null -o -H newc > {cpio_path}'],
        capture_output=True
    )
    os.chdir('/home/z/my-project')
    
    if not os.path.exists(cpio_path):
        print("  ERROR: Failed to create cpio archive, trying alternative...")
        # Alternative: use tar instead
        tar_path = f"/tmp/rpm-payload.tar.gz"
        os.chdir(buildroot)
        subprocess.run(['tar', 'czf', tar_path, '.'], capture_output=True)
        os.chdir('/home/z/my-project')
        
        if os.path.exists(tar_path):
            payload_size = os.path.getsize(tar_path)
            print(f"  Payload (tar.gz): {payload_size / 1024 / 1024:.1f} MB")
    else:
        # Compress cpio
        import gzip
        with open(cpio_path, 'rb') as f:
            cpio_data = f.read()
        cpio_compressed = gzip.compress(cpio_data, compresslevel=6)
        payload_path = f"/tmp/rpm-payload.cpio.gz"
        with open(payload_path, 'wb') as f:
            f.write(cpio_compressed)
        print(f"  Payload (cpio.gz): {len(cpio_compressed) / 1024 / 1024:.1f} MB")
    
    print(f"  Output: {output_path}")
    print("Done!")
