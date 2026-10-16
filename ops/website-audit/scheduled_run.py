"""Windowless task entrypoint. Only fixed launcher status lines are retained."""
import argparse
import contextlib
import datetime
import os
from pathlib import Path
import sys

import audit
import run
from runner_config import prepare_runtime, runtime_root
from windows_support import ensure_private_directory, reject_reparse_path, secure_private_file, validate_private_file

MAX_LOG_BYTES = 64 * 1024


def _append_log(root, message):
    directory = root / 'state'
    ensure_private_directory(directory)
    paths = [directory / name for name in ('launcher.log', 'launcher.log.1', 'launcher.log.2')]
    for path in paths:
        reject_reparse_path(path)
        if path.exists():
            validate_private_file(path)
            if path.stat().st_size > MAX_LOG_BYTES:
                raise ValueError('Unexpected launcher log size')
    line = (datetime.datetime.now(datetime.timezone.utc).isoformat() + ' ' + message + '\n').encode('ascii')
    if paths[0].exists() and paths[0].stat().st_size + len(line) > MAX_LOG_BYTES:
        if paths[2].exists():
            paths[2].unlink()
        if paths[1].exists():
            paths[1].replace(paths[2])
        paths[0].replace(paths[1])
    descriptor = os.open(paths[0], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        secure_private_file(paths[0])
        os.write(descriptor, line)
    finally:
        os.close(descriptor)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    # pythonw starts with stdout/stderr=None. Suppress all engine output rather
    # than persisting raw child diagnostics or accidentally exposing a secret.
    with open(os.devnull, 'w', encoding='utf-8') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
            parser.add_argument('--root')
            args, _ = parser.parse_known_args(argv)
            root = prepare_runtime(runtime_root(args.root))
            with audit.site_lock(root / 'locks/launcher.lock'):
                _append_log(root, 'started')
                try:
                    code = run.main(argv)
                except SystemExit as error:
                    code = error.code if type(error.code) is int else 2
                except Exception:
                    code = 2
                if type(code) is not int or not 0 <= code <= 255:
                    code = 2
                try:
                    _append_log(root, f'completed exit_code={code}')
                except Exception:
                    pass  # Preserve the actual audit exit result.
                return code
        except audit.OverlapError:
            return 75
        except (Exception, SystemExit):
            return 2


if __name__ == '__main__':
    raise SystemExit(main())
