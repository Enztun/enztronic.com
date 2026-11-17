"""Archive only this reviewed preparation and its disabled installation; no restore."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
from datetime import datetime, timezone


def digest(filename):
    with open(filename, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def main():
    stage = Path(r'C:\Users\hoyec\Enztronic-Worker-Preparation\step2-20261108-ee8d2b8704')
    installed = Path(r'C:\ProgramData\EnztronicOffice')
    secondary = Path(r'E:\Enztronic-Recovery\worker-preparation-20261108-ee8d2b8704')
    output = stage.parent / 'archives'
    output.mkdir(exist_ok=True)
    archive = output / 'worker-preparation-20261108-ee8d2b8704.tar.gz'
    copy = secondary / archive.name
    if archive.exists() or copy.exists():
        raise RuntimeError('Archive destination already exists')
    evidence = json.loads((stage / 'host-final-verification.json').read_text(encoding='utf-8-sig'))
    if not evidence['passed'] or evidence['workerTaskEnabled'] or evidence['workerAccountEnabled']:
        raise RuntimeError('Only a verified disabled preparation may be archived')
    files = {}
    locations = {}
    for label, root in [('preparation', stage), ('installation', installed)]:
        if root.is_symlink() or root.is_junction():
            raise RuntimeError('Linked roots are forbidden')
        for current, directories, names in os.walk(root, followlinks=False):
            for name in directories + names:
                item = Path(current) / name
                if item.is_symlink() or item.is_junction():
                    raise RuntimeError('Linked members are forbidden')
            for name in names:
                item = Path(current) / name
                key = label + '/' + item.relative_to(root).as_posix()
                files[key] = {'bytes': item.stat().st_size, 'sha256': digest(item)}
                locations[key] = item
    print(json.dumps({'stage': 'indexed', 'files': len(files)}), flush=True)
    with tarfile.open(archive, 'w:gz', compresslevel=1) as package:
        for key, source in locations.items():
            package.add(source, arcname=key, recursive=False)
    seen = set()
    with tarfile.open(archive, 'r|gz') as package:
        for member in package:
            if not member.isfile() or member.name not in files or member.name in seen:
                raise RuntimeError('Unexpected archive member')
            seen.add(member.name)
            with package.extractfile(member) as source:
                actual = hashlib.file_digest(source, 'sha256').hexdigest()
            if actual != files[member.name]['sha256'] or member.size != files[member.name]['bytes']:
                raise RuntimeError('Archive member checksum mismatch')
    if seen != set(files):
        raise RuntimeError('Archive incomplete')
    archive_hash = digest(archive)
    if shutil.disk_usage(secondary).free < archive.stat().st_size + 1024**3:
        raise RuntimeError('Second disk lacks safe free capacity')
    with open(archive, 'rb') as source, open(copy, 'xb') as destination:
        shutil.copyfileobj(source, destination, 1024**2)
        destination.flush()
        os.fsync(destination.fileno())
    if digest(copy) != archive_hash:
        raise RuntimeError('Second-copy checksum mismatch')
    result = {'passed': True, 'clientDate': '2026-11-08', 'machineUtc': datetime.now(timezone.utc).isoformat(),
              'archive': str(archive), 'secondCopy': str(copy), 'sha256': archive_hash,
              'bytes': archive.stat().st_size, 'verifiedFiles': len(files),
              'secondCopyIdentical': True, 'offComputer': False}
    for filename, value in [(output / 'worker-preparation-20261108-ee8d2b8704.files.json', files),
                            (output / 'worker-preparation-20261108-ee8d2b8704.verification.json', result),
                            (secondary / 'archive-verification.json', result)]:
        with open(filename, 'x', encoding='utf-8') as destination:
            json.dump(value, destination, indent=2)
            destination.write('\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'passed': False, 'errorType': type(error).__name__}), flush=True)
        raise SystemExit(1)
