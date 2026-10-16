#!/usr/bin/env python3
"""Run only Enztronic on its independently chosen Windows or Linux runner."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.parse

import audit
from runner_config import PROJECT_ID, prepare_runtime, runtime_root, validate_secret_file


def project_config(root, folder=None):
    folder = folder or Path(__file__).resolve().parent
    config = json.loads((folder / 'sites/enztronic.json').read_text(encoding='utf-8'))
    if config.get('id') != PROJECT_ID:
        raise ValueError('Only the Enztronic project may run here')
    for entry in config.get('urls', []):
        parsed = urllib.parse.urlsplit(entry['url'])
        if parsed.scheme != 'https' or parsed.netloc not in ('enztronic.com', 'www.enztronic.com'):
            raise ValueError('Only public Enztronic origins may be probed')
    commands = config.get('commands', [])
    if len(commands) != 1 or commands[0].get('name') != 'website':
        raise ValueError('Only the Enztronic repository command may run here')
    wrapper = 'native_repository.py' if sys.platform == 'win32' else 'repository_check.py'
    # pythonw has no console streams; the child wrapper needs normal captured I/O.
    executable = str(Path(sys.executable).with_name('python.exe')) if sys.platform == 'win32' else sys.executable
    commands[0]['argv'] = [executable, str(folder / wrapper), '--root', str(root)]
    config['discord_secret_file'] = str(root / 'secrets/discord.env')
    return audit.validate_config(config)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--root', help='Private runner directory; default is platform-specific')
    parser.add_argument('--mode', choices=('daily', 'full', 'due'), default='due')
    parser.add_argument('--no-discord', action='store_true')
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        if not (sys.platform.startswith('linux') or sys.platform == 'win32'):
            raise ValueError('The independent runner requires Windows or Linux')
        root = prepare_runtime(runtime_root(args.root))
        config = project_config(root)
        if not args.no_discord:
            validate_secret_file(root / 'secrets/discord.env')
        with audit.site_lock(root / 'locks/scheduler.lock'):
            report, code = audit.run_site(config, root / 'state', args.mode, args.no_discord)
        print(f"{PROJECT_ID}: {report['status']}; discord={report['discord']}")
        return code
    except audit.OverlapError:
        print('Enztronic audit skipped: another run holds its lock', file=sys.stderr)
        return 75
    except Exception as error:
        print('Enztronic audit could not complete: ' + type(error).__name__, file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
