"""Seal an owner-protected recovery package and verify a second local-disk copy.

No database access, extraction, deletion, external upload, or service operation.
Existing destinations are rejected. Every archived regular file is hash checked.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone


def digest_file(filename):
    with open(filename, "rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write_new(filename, value):
    with open(filename, "x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


def main():
    root, secondary = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    base = Path(r"C:\Users\hoyec\Enztronic-Recovery").resolve(strict=True)
    if root.parent != base or not root.name.startswith("production-prep-20261108-"):
        raise RuntimeError("Refused package source")
    if secondary.parent != Path(r"E:\Enztronic-Recovery").resolve(strict=True) or secondary.name != root.name:
        raise RuntimeError("Refused second-copy destination")
    archive_directory = base / "archives"
    archive_directory.mkdir(exist_ok=True)
    archive = archive_directory / (root.name + ".tar.gz")
    copy = secondary / archive.name
    if archive.exists() or copy.exists():
        raise RuntimeError("Refused existing archive destination")

    expected = {}
    indexes = {
        "working-source-manifest.json": "working-release/app",
        "working-build-manifest.json": "working-release/app/.next",
        "accepted-candidate-manifest.json": "accepted-candidate/app",
        "installed-dependencies-manifest.json": "installed-node-modules",
        "python-environment-manifest.json": "python-environment",
        "source-documents-manifest.json": "source-documents",
    }
    for index, prefix in indexes.items():
        with open(root / index, encoding="utf-8-sig") as source:
            for entry in json.load(source):
                name = str(PurePosixPath(prefix, entry["path"]))
                if name in expected:
                    raise RuntimeError("Duplicate manifest member")
                expected[name] = {"bytes": entry["bytes"], "sha256": entry["sha256"]}

    actual = set()
    for current, directories, filenames in os.walk(root, followlinks=False):
        for name in directories + filenames:
            item = Path(current) / name
            if item.is_symlink() or item.is_junction():
                raise RuntimeError("Package must not contain links or junctions")
        for name in filenames:
            item = Path(current) / name
            relative = item.relative_to(root).as_posix()
            actual.add(relative)
            size = item.stat().st_size
            if relative in expected:
                if expected[relative]["bytes"] != size:
                    raise RuntimeError("File size differs from copy manifest")
            else:
                expected[relative] = {"bytes": size, "sha256": digest_file(item)}
    if actual != set(expected):
        raise RuntimeError("A copied recovery file is missing")
    manifest = root / "payload-manifest.json"
    write_new(manifest, {"format": 1, "clientDate": "2026-11-08", "files": expected})
    manifest_hash = digest_file(manifest)
    print(json.dumps({"stage": "indexed", "files": len(expected)}), flush=True)

    with open(archive_directory / (root.name + ".tar.log"), "xb") as log:
        subprocess.run(["tar.exe", "-czf", str(archive), "-C", str(root), "."], stdout=log, stderr=log, check=True)
    print(json.dumps({"stage": "archived", "bytes": archive.stat().st_size}), flush=True)
    seen = set()
    with tarfile.open(archive, "r|gz") as package:
        for member in package:
            if member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError("Archive contains a nonregular member")
            name = member.name.removeprefix("./")
            if PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or name in seen:
                raise RuntimeError("Invalid archive member")
            seen.add(name)
            if name == "payload-manifest.json":
                desired = manifest_hash
                size = manifest.stat().st_size
            else:
                if name not in expected:
                    raise RuntimeError("Unexpected archive member")
                desired = expected[name]["sha256"]
                size = expected[name]["bytes"]
            with package.extractfile(member) as source:
                found = hashlib.file_digest(source, "sha256").hexdigest()
            if found != desired or member.size != size:
                raise RuntimeError("Archived member failed checksum verification")
    if seen != set(expected) | {"payload-manifest.json"}:
        raise RuntimeError("Incomplete archive")
    archive_hash = digest_file(archive)
    if shutil.disk_usage(secondary).free < archive.stat().st_size + 1024**3:
        raise RuntimeError("Second disk lacks safe free capacity")
    print(json.dumps({"stage": "all-members-verified", "files": len(seen)}), flush=True)
    with open(archive, "rb") as source, open(copy, "xb") as output:
        shutil.copyfileobj(source, output, 1024**2)
        output.flush()
        os.fsync(output.fileno())
    if digest_file(copy) != archive_hash:
        raise RuntimeError("Second-copy checksum mismatch")
    result = {
        "passed": True, "clientDate": "2026-11-08",
        "machineUtc": datetime.now(timezone.utc).isoformat(),
        "archive": str(archive), "secondCopy": str(copy),
        "archiveSha256": archive_hash, "archiveBytes": archive.stat().st_size,
        "payloadManifestSha256": manifest_hash, "verifiedRegularFiles": len(seen),
        "everyArchiveMemberVerified": True, "secondCopyByteIdentical": True,
        "separatePhysicalDisks": "Previously verified: C/D Disk0; E Disk1",
        "offComputerCopy": False, "productionMutation": False,
    }
    write_new(archive_directory / (root.name + ".verification.json"), result)
    write_new(secondary / "archive-verification.json", result)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No secrets, filenames from business records, or archive payloads on stdout.
        print(json.dumps({"passed": False, "errorType": type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
