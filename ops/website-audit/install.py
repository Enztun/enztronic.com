#!/usr/bin/env python3
"""Install only Enztronic on an explicitly chosen separate Linux runner."""
import argparse
import base64
import hashlib
import inspect
import json
from pathlib import Path
import shlex
import subprocess

from runner_config import PUBLIC_KEYS, ensure_private_directory, prepare_runtime, runtime_root, validate_secret_file

INSTALL_FILES = ['audit.py', 'repository_check.py', 'runner_config.py', 'run.py', 'run.sh', 'sites/enztronic.json']


def prepare_crontab(current, root):
    import re
    begin, end = '# BEGIN ENZTRONIC WEBSITE AUDIT', '# END ENZTRONIC WEBSITE AUDIT'
    lines = current.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.strip() == begin]
    ends = [i for i, line in enumerate(lines) if line.strip() == end]
    if len(starts) != len(ends) or len(starts) > 1 or starts and starts[0] >= ends[0]:
        raise ValueError('Malformed existing Enztronic audit cron block')
    if starts:
        del lines[starts[0]:ends[0] + 1]
    clean = ''.join(lines)
    for line in clean.splitlines():
        zone = re.match(r'^\s*CRON_TZ\s*=\s*(.*?)\s*$', line)
        if zone and zone[1].strip('\"\'') not in ('UTC', 'Etc/UTC', ''):
            raise ValueError('Existing CRON_TZ requires an explicit scheduling review')
    root = runtime_root(root)
    command = shlex.quote(str(root / 'run.sh')) + ' --root ' + shlex.quote(str(root)) + ' --mode due'
    block = begin + '\n# 19:30 UTC daily = 02:30 Asia/Jakarta; full scans every 14 UTC dates.\n30 19 * * * ' + command + ' >/dev/null 2>&1\n' + end + '\n'
    return clean.rstrip() + '\n\n' + block, block


REMOTE = r'''
import base64,datetime,hashlib,json,os,shlex,stat,subprocess,sys,tempfile
from pathlib import Path
# INSTALL_HELPERS
os.umask(0o077)
if not sys.platform.startswith('linux'): raise ValueError('The dedicated runner requires Linux')
payload=json.load(sys.stdin)
root=prepare_runtime(runtime_root(payload['root']))
if not (root/'bin/gitleaks').is_file() or (root/'bin/gitleaks').is_symlink():
    raise ValueError('Provision verified Gitleaks on this runner first')
secret=root/'secrets/discord.env'
secret_ready=secret.exists()
if secret_ready: validate_secret_file(secret)
if payload['activate_schedule'] and not secret_ready:
    raise ValueError('Provision this runner own private Discord secret before activation')
for name in ['MAINTENANCE_LOG.md','crontab.before-enztronic-audit']:
    if (root/name).is_symlink(): raise ValueError('Private operational files must not be symlinks')
allowed={'audit.py','repository_check.py','runner_config.py','run.py','run.sh','sites/enztronic.json','sites/enztronic-public-env.json'}
if set(payload['files'])!=allowed: raise ValueError('Installation must contain only the complete Enztronic runner')
installed={}
for name,item in payload['files'].items():
    content=base64.b64decode(item['content'],validate=True)
    digest=hashlib.sha256(content).hexdigest()
    if digest!=item['sha256']: raise ValueError('Transfer checksum failed')
    target=root/name
    if target.is_symlink(): raise ValueError('Installation target must not be a symlink')
    fd,temporary=tempfile.mkstemp(prefix='.install-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as out: out.write(content)
        os.chmod(temporary,0o700 if name.endswith('.sh') else 0o600)
        os.replace(temporary,target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    installed[name]=digest
subprocess.run(['python3','-m','py_compile',*[str(root/name) for name in allowed if name.endswith('.py')]],check=True)
subprocess.run(['/bin/sh','-n',str(root/'run.sh')],check=True)
cron_activated=False
if payload['activate_schedule']:
    timezone=subprocess.run(['timedatectl','show','--property=Timezone','--value'],check=True,capture_output=True,text=True).stdout.strip()
    if timezone not in ['UTC','Etc/UTC']: raise ValueError('Review scheduling for runner timezone before activation')
    existing=subprocess.run(['crontab','-l'],capture_output=True,text=True)
    if existing.returncode not in [0,1]: raise ValueError('Cannot read runner crontab')
    current=existing.stdout if existing.returncode==0 else ''
    updated,block=prepare_crontab(current,root)
    backup=root/'crontab.before-enztronic-audit'
    if not backup.exists():
        backup.write_text(current)
        backup.chmod(0o600)
    subprocess.run(['crontab','-'],input=updated,text=True,check=True,capture_output=True)
    confirmed=subprocess.run(['crontab','-l'],check=True,capture_output=True,text=True).stdout
    if block not in confirmed: raise ValueError('Scheduler installation verification failed')
    cron_activated=True
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (root/'MAINTENANCE_LOG.md').open('a') as out:
    out.write('\n## '+now+' - Enztronic-only runner installation\n\nTransfer checksums verified. Schedule explicitly activated by this invocation: '+str(cron_activated)+'. No audit or Discord message sent by installer. First checks/delivery must be verified separately. No production runtime, database or other website configured.\n')
(root/'MAINTENANCE_LOG.md').chmod(0o600)
print(json.dumps({'installed_sha256':installed,'root':str(root),'schedule_activated':cron_activated,'discord_secret_ready':secret_ready}))
'''
REMOTE = REMOTE.replace('# INSTALL_HELPERS', '\n'.join(inspect.getsource(helper) for helper in
    (runtime_root, ensure_private_directory, prepare_runtime, validate_secret_file, prepare_crontab)))


def installation_files(folder, public_env):
    files = {}
    for name in INSTALL_FILES:
        content = (folder / name).read_bytes().replace(b'\r\n', b'\n')
        if name.endswith('.py'):
            compile(content, name, 'exec')
        elif name.endswith('.json'):
            json.loads(content)
        files[name] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
    if public_env.stat().st_size > 1024 * 1024:
        raise ValueError('Public build input exceeds its size bound')
    public = {}
    for line in public_env.read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() in PUBLIC_KEYS:
            public[key.strip()] = value.strip().strip('"').strip("'")
    if (not public.get('NEXT_PUBLIC_SANITY_PROJECT_ID') or not public.get('NEXT_PUBLIC_SANITY_DATASET')
            or any(not item or len(item) > 2048 or any(ord(character) < 32 for character in item) for item in public.values())):
        raise ValueError('Public Sanity project and dataset are required')
    content = json.dumps(public).encode()
    files['sites/enztronic-public-env.json'] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
    return files


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, help='Explicit SSH user@host for the separately chosen runner')
    parser.add_argument('--root', help='Absolute directory on that runner; default ~/.local/share/enztronic-audit')
    parser.add_argument('--public-env', type=Path, required=True, help='Only the three public build keys are transferred')
    parser.add_argument('--activate-schedule', action='store_true', help='Explicit opt-in after dedicated-host provisioning')
    args = parser.parse_args(argv)
    if args.target.startswith('-') or any(character.isspace() for character in args.target):
        parser.error('Invalid SSH target')
    if args.root and (not args.root.startswith('/') or any(character in args.root for character in '\r\n\x00%')):
        parser.error('Remote root must be an absolute Linux path')
    files = installation_files(Path(__file__).resolve().parent, args.public_env)
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', args.target,
               'python3 -c ' + shlex.quote(REMOTE)]
    completed = subprocess.run(command, input=json.dumps({'files': files, 'root': args.root,
                               'activate_schedule': args.activate_schedule}).encode(), capture_output=True, timeout=120)
    if completed.returncode:
        raise RuntimeError('Dedicated-runner installation failed; no credential or remote stderr is printed')
    print(json.dumps(json.loads(completed.stdout)))


if __name__ == '__main__':
    main()
