#!/usr/bin/env python3
"""Сборка RPM-пакета «Редактор PDF» для РЕД ОС через системный rpmbuild.

Использование:
  1. bash build-electron.sh   # создаёт dist-electron/pdf-editor-<версия>-x86_64
  2. python3 build-rpm.py     # собирает pdf-editor-<версия>-1.<арх>.rpm

Требует rpmbuild в PATH (в РЕД ОС: dnf install rpm-build).
"""

import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

APP_NAME = "pdf-editor"
VERSION = "2.0.2"
RELEASE = "1"
ARCH = "x86_64"

PROJECT_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = PROJECT_DIR / "dist-electron" / f"{APP_NAME}-{VERSION}-{ARCH}"
TOPDIR = PROJECT_DIR / ".rpm-top"
SPEC = PROJECT_DIR / "rpm" / f"{APP_NAME}.spec"


def main() -> int:
    if not PACKAGE_DIR.is_dir():
        print(f"ОШИБКА: не найден {PACKAGE_DIR}")
        print("Сначала выполните: bash build-electron.sh")
        return 1

    if shutil.which("rpmbuild") is None:
        print("ОШИБКА: rpmbuild не найден в PATH")
        print("В РЕД ОС: sudo dnf install rpm-build")
        return 1

    # Дерево сборки rpmbuild
    for sub in ("BUILD", "RPMS", "SRPMS", "SOURCES", "TMP"):
        (TOPDIR / sub).mkdir(parents=True, exist_ok=True)

    # Исходный tarball (верхний каталог = pdf-editor-<версия>)
    src_tar = TOPDIR / "SOURCES" / f"{APP_NAME}-{VERSION}.tar.gz"
    print(f"[1/2] Упаковка {src_tar.name} ...")
    with tarfile.open(src_tar, "w:gz") as tar:
        tar.add(PACKAGE_DIR, arcname=f"{APP_NAME}-{VERSION}")

    print("[2/2] Сборка RPM (rpmbuild -bb) ...")
    cmd = [
        "rpmbuild", "-bb",
        "--define", f"_topdir {TOPDIR}",
        "--define", f"_tmppath {TOPDIR}/TMP",
        "--define", "_binary_payload w9.gzdio",   # gzip — совместимо с rpm 4.14 (РЕД ОС 8)
        "--define", "__os_install_post %{nil}",   # без strip/brp-скриптов
        "--define", "debug_package %{nil}",
        "--define", "dist .el8",                  # имя пакета: pdf-editor-2.0.0-1.el8.x86_64.rpm
        str(SPEC),
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print("ОШИБКА: rpmbuild завершился с ошибкой")
        return result.returncode

    rpms = sorted((TOPDIR / "RPMS" / ARCH).glob(f"{APP_NAME}-{VERSION}-*.rpm"))
    if not rpms:
        print("ОШИБКА: RPM не найден после сборки")
        return 1

    out = PROJECT_DIR / rpms[0].name
    shutil.copy2(rpms[0], out)
    size_mb = out.stat().st_size / 1024 / 1024
    print()
    print("==========================================")
    print("  ✓ RPM собран!")
    print("==========================================")
    print(f"  Файл: {out} ({size_mb:.1f} МБ)")
    print()
    print("Установка на РЕД ОС:")
    print(f"  sudo dnf install ./{out.name}")
    print("  или:  sudo rpm -ivh ./" + out.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
