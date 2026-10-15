#!/usr/bin/env python3
"""Install reviewed audit files over existing key-based SSH; never read private keys."""
import argparse
import base64
import hashlib
import inspect
import json
from pathlib import Path
import shlex
import subprocess

PUBLIC_KEYS = {'NEXT_PUBLIC_SANITY_PROJECT_ID', 'NEXT_PUBLIC_SANITY_DATASET', 'NEXT_PUBLIC_SITE_URL'}

def ensure_private_directory(path):
    if path.is_symlink():
        raise RuntimeError('Installation directory must not be a symlink')
    path.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir():
        raise RuntimeError('Installation directory is not a directory')
    path.chmod(0o700)


def validate_secret_file(path):
    import os
    import stat
    if path.is_symlink():
        raise RuntimeError('Discord secret must not be a symlink')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        raise RuntimeError('Discord secret must belong to the installer account with mode 0600')


def prepare_crontab(current):
    import re
    begin, end = '# BEGIN WEBSITE AUDIT', '# END WEBSITE AUDIT'
    lines = current.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.strip() == begin]
    ends = [i for i, line in enumerate(lines) if line.strip() == end]
    if len(starts) != len(ends) or len(starts) > 1 or starts and starts[0] >= ends[0]:
        raise RuntimeError('Malformed existing audit cron block')
    if starts:
        del lines[starts[0]:ends[0] + 1]
    clean = ''.join(lines)
    for line in clean.splitlines():
        zone = re.match(r'^\s*CRON_TZ\s*=\s*(.*?)\s*$', line)
        if zone and zone[1].strip('\"\'') not in ('UTC', 'Etc/UTC', ''):
            raise RuntimeError('Existing CRON_TZ requires an explicit scheduling review')
    block = begin + '\n# 19:30 UTC daily = 02:30 Asia/Jakarta; full scans every 14 UTC dates.\n30 19 * * * /home/deploy/website-audit/run.sh >/dev/null 2>&1\n' + end + '\n'
    return clean.rstrip() + '\n\n' + block, block


REMOTE = r'''
import base64,datetime,hashlib,json,os,pathlib,re,subprocess,sys,tempfile
# INSTALL_HELPERS
os.umask(0o077)
payload=json.load(sys.stdin)
root=pathlib.Path('/home/deploy/website-audit')
ensure_private_directory(root)
for name in ['bin','sites','state','mirrors','cache']:
    ensure_private_directory(root/name)
if not (root/'bin/gitleaks').is_file(): raise RuntimeError('Provision verified Gitleaks first')
secret=pathlib.Path('/home/deploy/.config/website-audit/discord.env')
validate_secret_file(secret)
for name in ['MAINTENANCE_LOG.md','crontab.before-website-audit','scheduler.lock']:
    if (root/name).is_symlink(): raise RuntimeError('Private operational files must not be symlinks')
installed={}
for name,item in payload['files'].items():
    if name not in ['audit.py','repository_check.py','production_smoke.py','run.sh','sites/qianlima.json','sites/enztronic.json','sites/enztronic-public-env.json']:
        raise RuntimeError('Unexpected installation target')
    content=base64.b64decode(item['content'],validate=True)
    digest=hashlib.sha256(content).hexdigest()
    if digest!=item['sha256']: raise RuntimeError('Transfer checksum failed')
    target=root/name
    if target.is_symlink(): raise RuntimeError('Installation target must not be a symlink')
    fd,temporary=tempfile.mkstemp(prefix='.install-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as out: out.write(content)
        os.chmod(temporary,0o700 if name.endswith('.sh') else 0o600)
        os.replace(temporary,target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    installed[name]=digest
subprocess.run(['python3','-m','py_compile',str(root/'audit.py'),str(root/'repository_check.py'),str(root/'production_smoke.py')],check=True)
subprocess.run(['/bin/sh','-n',str(root/'run.sh')],check=True)
cron_activated=False
if payload['activate_schedule']:
    timezone=subprocess.run(['timedatectl','show','--property=Timezone','--value'],check=True,capture_output=True,text=True).stdout.strip()
    if timezone not in ['UTC','Etc/UTC']: raise RuntimeError('Review cron hour for server timezone before activation')
    existing=subprocess.run(['crontab','-l'],capture_output=True,text=True)
    if existing.returncode not in [0,1]: raise RuntimeError('Cannot read user crontab')
    current=existing.stdout if existing.returncode==0 else ''
    updated,block=prepare_crontab(current)
    backup=root/'crontab.before-website-audit'
    if not backup.exists():
        backup.write_text(current)
        backup.chmod(0o600)
    subprocess.run(['crontab','-'],input=updated,text=True,check=True,capture_output=True)
    confirmed=subprocess.run(['crontab','-l'],check=True,capture_output=True,text=True).stdout
    if block not in confirmed: raise RuntimeError('Scheduler installation verification failed')
    cron_activated=True
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (root/'MAINTENANCE_LOG.md').open('a') as out:
    out.write('\n## '+now+' - audit installation\n\nReviewed Python runner, fixed site profiles and isolated repository wrapper installed with verified transfer checksums. Schedule active: '+str(cron_activated)+'. First audit/delivery results are recorded separately. Private Vercel logs excluded by user choice. Existing crontab jobs and historical application logs preserved.\n')
(root/'MAINTENANCE_LOG.md').chmod(0o600)
print(json.dumps({'installed_sha256':installed,'schedule_active':cron_activated,'schedule_utc':'30 19 * * *' if cron_activated else None,'secret_mode':'0600'}))
'''
REMOTE = REMOTE.replace('# INSTALL_HELPERS', '\n'.join(inspect.getsource(helper) for helper in
                                                     (ensure_private_directory, validate_secret_file, prepare_crontab)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, help='Existing authorized SSH user@host')
    parser.add_argument('--enztronic-public-env', type=Path, required=True, help='Local env file; only three public build keys are transferred')
    parser.add_argument('--activate-schedule', action='store_true')
    args = parser.parse_args()
    if args.target.startswith('-') or any(c.isspace() for c in args.target):
        parser.error('Invalid SSH target')
    folder = Path(__file__).resolve().parent
    files = {}
    for name in ['audit.py', 'repository_check.py', 'production_smoke.py', 'run.sh', 'sites/qianlima.json', 'sites/enztronic.json']:
        content = (folder / name).read_bytes().replace(b'\r\n', b'\n')
        if name.endswith('.py'):
            compile(content, name, 'exec')
        elif name.endswith('.json'):
            json.loads(content)
        files[name] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
    public = {}
    for line in args.enztronic_public_env.read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() in PUBLIC_KEYS:
            public[key.strip()] = value.strip().strip('"').strip("'")
    if not public.get('NEXT_PUBLIC_SANITY_PROJECT_ID') or not public.get('NEXT_PUBLIC_SANITY_DATASET'):
        parser.error('Public Sanity project and dataset are required for a representative build')
    content = json.dumps(public).encode()
    files['sites/enztronic-public-env.json'] = {'content': base64.b64encode(content).decode(), 'sha256': hashlib.sha256(content).hexdigest()}
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', args.target,
               'python3 -c ' + shlex.quote(REMOTE)]
    completed = subprocess.run(command, input=json.dumps({'files': files, 'activate_schedule': args.activate_schedule}).encode(),
                               capture_output=True, timeout=120)
    if completed.returncode:
        raise RuntimeError('Remote installation failed; no credential or remote stderr is printed')
    print(json.dumps(json.loads(completed.stdout)))


if __name__ == '__main__':
    main()
