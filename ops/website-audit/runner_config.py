"""Enztronic project identity and private paths on a separately chosen runner."""
import json
import os
from pathlib import Path
import stat

PROJECT_ID = 'enztronic'
REPOSITORY_URL = 'https://github.com/enztun/enztronic.com.git'
PUBLIC_KEYS = {'NEXT_PUBLIC_SANITY_PROJECT_ID', 'NEXT_PUBLIC_SANITY_DATASET', 'NEXT_PUBLIC_SITE_URL'}


def runtime_root(value=None):
    value = value or os.environ.get('ENZTRONIC_AUDIT_ROOT')
    path = Path(value).expanduser() if value else Path.home() / '.local/share/enztronic-audit'
    if not path.is_absolute() or '..' in path.parts or path == Path(path.anchor) or path == Path.home():
        raise ValueError('Audit root must be a separate absolute directory')
    if any(character in str(path) for character in '\r\n\x00%'):
        raise ValueError('Audit root contains unsupported path characters')
    for ancestor in [path, *path.parents]:
        if ancestor.is_symlink():
            raise ValueError('Audit root must not traverse a symlink')
        marker = ancestor / '.git'
        if marker.exists() or marker.is_symlink():
            raise ValueError('Private runtime files must stay outside Git checkouts')
    resolved = path.resolve()
    if resolved == Path(resolved.anchor) or resolved == Path.home().resolve():
        raise ValueError('Audit root must remain a separate directory after resolution')
    return resolved


def ensure_private_directory(path):
    if path.is_symlink():
        raise ValueError('Private directory must not be a symlink')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or os.name == 'posix' and info.st_uid != os.getuid():
        raise ValueError('Private directory must belong to the runner account')
    path.chmod(0o700)


def prepare_runtime(root):
    root = runtime_root(root)
    ensure_private_directory(root)
    for name in ['bin', 'sites', 'state', 'mirrors', 'cache', 'locks', 'secrets']:
        ensure_private_directory(root / name)
    return root


def validate_secret_file(path):
    if path.is_symlink():
        raise ValueError('Discord secret must not be a symlink')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        raise ValueError('Discord secret must belong to the runner account with mode 0600')


def public_build_settings(path):
    if path.is_symlink() or path.stat().st_size > 16 * 1024:
        raise ValueError('Invalid public build configuration file')
    value = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(value, dict) or not set(value).issubset(PUBLIC_KEYS)
            or any(not isinstance(item, str) or not item or len(item) > 2048
                   or any(ord(character) < 32 for character in item) for item in value.values())
            or not value.get('NEXT_PUBLIC_SANITY_PROJECT_ID') or not value.get('NEXT_PUBLIC_SANITY_DATASET')):
        raise ValueError('Public Sanity project and dataset are required; private keys are forbidden')
    return value
