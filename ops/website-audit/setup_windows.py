#!/usr/bin/env python3
"""Provision this PC's private Enztronic monitor; never install project packages."""
import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import uuid
import zipfile

import audit
from runner_config import PROJECT_ID, PUBLIC_KEYS, prepare_runtime, runtime_root
import windows_support

SCANNER_VERSION = '8.30.1'
SCANNER_URL = 'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip'
SCANNER_ARCHIVE_SHA256 = 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'
SCANNER_BINARY_SHA256 = '17157e2ee8b76fc8b1d8bee607a250e34b8a8023c8bc81822d4b5ee4d78fcb7c'
ENV_KEY = 'ENZTRONIC_DISCORD_WEBHOOK_URL'
FILES = ('audit.py', 'runner_config.py', 'windows_support.py', 'run.py',
         'scheduled_run.py', 'repository_check.py', 'native_repository.py',
         'install_windows.ps1', 'sites/enztronic.json')


def read_public_settings(path):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError('Public build input exceeds its size bound')
    result = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() in PUBLIC_KEYS:
            result[key.strip()] = value.strip().strip('"').strip("'")
    if not result.get('NEXT_PUBLIC_SANITY_PROJECT_ID') or not result.get('NEXT_PUBLIC_SANITY_DATASET'):
        raise ValueError('Public project and dataset are required')
    if any(not value or len(value) > 2048 or any(ord(character) < 32 for character in value) for value in result.values()):
        raise ValueError('Invalid public build setting')
    return result


def read_webhook_assignment(path):
    if path.stat().st_size > 16384:
        raise ValueError('Webhook input exceeds its size bound')
    found = []
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        match = re.fullmatch(r'\s*(?:export\s+)?(DISCORD_WEBHOOK_URL|ENZTRONIC_DISCORD_WEBHOOK_URL)\s*=\s*(.*?)\s*', line)
        if not match:
            continue
        value = match[2]
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        found.append(value)
    if not found or len(set(found)) != 1:
        raise ValueError('Exactly one unambiguous webhook assignment is required')
    return audit.load_webhook({'discord_env': ENV_KEY}, {ENV_KEY: found[0]})


def publish_private(path, content):
    windows_support.reject_reparse_path(path)
    temporary = path.with_name('.install-' + uuid.uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def resolve_tools():
    git = shutil.which('git.exe') or shutil.which('git')
    node = shutil.which('node.exe') or shutil.which('node')
    if not git or not node:
        raise ValueError('Installed Git and Node are required')
    npm_cli = Path(node).parent / 'node_modules/npm/bin/npm-cli.js'
    tools = {'git': str(Path(git).absolute()), 'node': str(Path(node).absolute()), 'npm_cli': str(npm_cli.absolute())}
    if any(not Path(value).is_absolute() or not Path(value).is_file() for value in tools.values()):
        raise ValueError('Trusted installed tool files are unavailable')
    return tools


def scanner_binary(archive):
    if len(archive) > 32 * 1024 * 1024 or hashlib.sha256(archive).hexdigest() != SCANNER_ARCHIVE_SHA256:
        raise ValueError('Scanner archive checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(archive)) as package:
        member = package.getinfo('gitleaks.exe')
        if member.file_size > 64 * 1024 * 1024:
            raise ValueError('Scanner executable exceeds its size bound')
        binary = package.read(member)
    if not binary.startswith(b'MZ') or hashlib.sha256(binary).hexdigest() != SCANNER_BINARY_SHA256:
        raise ValueError('Scanner executable checksum mismatch')
    return binary


def provision_scanner(root):
    target = root / 'bin/gitleaks.exe'
    windows_support.reject_reparse_path(target)
    if target.is_file() and target.stat().st_size < 64 * 1024 * 1024 and hashlib.sha256(target.read_bytes()).hexdigest() == SCANNER_BINARY_SHA256:
        binary = None
    else:
        with urllib.request.urlopen(SCANNER_URL, timeout=30) as response:
            binary = scanner_binary(response.read(32 * 1024 * 1024 + 1))
    if binary is not None:
        publish_private(target, binary)
    publish_private(root / 'bin/gitleaks.sha256', (SCANNER_BINARY_SHA256 + '\n').encode())
    windows_support.validate_private_file(target)
    return SCANNER_BINARY_SHA256


def setup(root, public_env, webhook_file, folder=None):
    folder = folder or Path(__file__).resolve().parent
    root = runtime_root(root)
    marker = root / 'project.json'
    if root.exists() and any(root.iterdir()):
        if not marker.is_file() or marker.stat().st_size > 4096 or json.loads(marker.read_text(encoding='utf-8')).get('project') != PROJECT_ID:
            raise ValueError('Existing directory is not an Enztronic monitor installation')
    public = read_public_settings(public_env)
    webhook = read_webhook_assignment(webhook_file)
    tools = resolve_tools()
    root = prepare_runtime(root)
    publish_private(marker, json.dumps({'project': PROJECT_ID, 'schema': 1}).encode())
    installed = {}
    for name in FILES:
        content = (folder / name).read_bytes().replace(b'\r\n', b'\n')
        if len(content) > 2 * 1024 * 1024:
            raise ValueError('Source snapshot file exceeds its size bound')
        if name.endswith('.py'):
            compile(content, name, 'exec')
        elif name.endswith('.json'):
            json.loads(content)
        publish_private(root / name, content)
        installed[name] = hashlib.sha256(content).hexdigest()
    publish_private(root / 'sites/enztronic-public-env.json', json.dumps(public).encode())
    publish_private(root / 'bin/tool-paths.json', json.dumps(tools).encode())
    secret = root / 'secrets/discord.env'
    publish_private(secret, (ENV_KEY + '=' + webhook + '\n').encode())
    windows_support.validate_private_file(secret)
    scanner = provision_scanner(root)
    publish_private(root / 'installation.json', json.dumps({'project': PROJECT_ID, 'files_sha256': installed,
                    'scanner_binary_sha256': scanner, 'coverage': 'native-read-only; isolated build/browser unavailable'}).encode())
    return {'root': str(root), 'files_installed': len(installed), 'scanner_version': SCANNER_VERSION,
            'scanner_binary_sha256': scanner, 'secret_provisioned': True, 'schedule_activated': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', help='Private directory outside Git; defaults to LocalAppData/EnztronicAudit')
    parser.add_argument('--public-env', type=Path, required=True, help='Only three public build settings are copied')
    parser.add_argument('--webhook-file', type=Path, required=True, help='Existing ignored assignment file; keep values out of arguments')
    parser.add_argument('--activate-schedule', action='store_true')
    args = parser.parse_args(argv)
    try:
        if not windows_support.is_windows():
            raise ValueError('This setup requires Windows')
        result = setup(runtime_root(args.root), args.public_env, args.webhook_file)
        if args.activate_schedule:
            root = Path(result['root'])
            completed = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', str(root / 'install_windows.ps1'), '-Root', str(root), '-PythonPath', sys.executable,
                '-ActivateSchedule'], capture_output=True, timeout=60, **windows_support.hidden_process_options())
            if completed.returncode:
                raise RuntimeError('Windows task registration failed')
            result['schedule_activated'] = True
        print(json.dumps(result))
        return 0
    except Exception as error:
        print('Windows monitor setup could not complete: ' + type(error).__name__, file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
