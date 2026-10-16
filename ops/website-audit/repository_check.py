#!/usr/bin/env python3
"""Audit a trusted main revision in a disposable container; never deploy or fix packages."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tarfile
import tempfile
import threading
import time

from runner_config import PROJECT_ID, REPOSITORY_URL, ensure_private_directory, prepare_runtime, public_build_settings, runtime_root
from audit import atomic_json

try:
    import fcntl
except ImportError:  # The deployed wrapper is Linux-only; local tests mock flock.
    fcntl = None

ROOT = Path.home() / '.local/share/enztronic-audit'
PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e'


class PipelineBusyError(RuntimeError):
    pass


class PipelineLockUnavailableError(RuntimeError):
    pass


@contextlib.contextmanager
def pipeline_lock(path=None, timeout=180):
    path = Path(path or ROOT / 'locks/repository.lock')
    if fcntl is None or not path.parent.is_dir():
        raise PipelineLockUnavailableError('Independent runner lock must be provisioned before audits run')
    descriptor = None
    acquired = False
    try:
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise PipelineLockUnavailableError('Deployment lock must be a regular file')
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                    break
                except BlockingIOError:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise PipelineBusyError('An Enztronic repository audit is still running') from None
                    time.sleep(min(0.2, remaining))
        except OSError:
            raise PipelineLockUnavailableError('Deployment lock is not accessible') from None
        yield
    finally:
        if descriptor is not None:
            try:
                if acquired:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)


def kill_process_group(process):
    try:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass


def capture(argv, *, cwd=None, env=None, timeout=120, limit=4 * 1024 * 1024):
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, start_new_session=True)
    chunks, size, overflow = [], 0, False

    def consume():
        nonlocal size, overflow
        while True:
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                overflow = True
                kill_process_group(process)
                break
            chunks.append(chunk)

    thread = threading.Thread(target=consume, daemon=True)
    thread.start()
    timed_out = False
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_process_group(process)
        process.wait()
    thread.join(timeout=5)
    if thread.is_alive():
        # A child may retain stdout after its parent exits. Do not leave that
        # process group alive merely because the original command returned.
        kill_process_group(process)
        thread.join(timeout=5)
        raise RuntimeError('Command output could not be completed')
    process.stdout.close()
    if timed_out or overflow:
        raise RuntimeError('Command exceeded time/output limit')
    return process.returncode, b''.join(chunks).decode('utf-8', 'replace')


def checked(argv, **kwargs):
    code, output = capture(argv, **kwargs)
    if code:
        raise RuntimeError('Required audit setup command failed')
    return output.strip()


def result(name, category, status, **metrics):
    return {'name': name, 'category': category, 'status': status, 'metrics': metrics}


def read_report(path, limit=8 * 1024 * 1024):
    if path.stat().st_size > limit:
        raise ValueError('Audit report exceeded size limit')
    return json.loads(path.read_text(encoding='utf-8'))


def source_gitleaks_ignore(mirror, revision, tools, env):
    """Only exact fingerprints reviewed in this trusted HEAD may suppress findings."""
    if (mirror / '.gitleaksignore').exists():
        raise ValueError('An unreviewed audit mirror ignore file is present')
    code, listing = capture(['git', '--git-dir', str(mirror), 'ls-tree', revision, '--', '.gitleaksignore'],
                            env=env, timeout=30, limit=2048)
    if code:
        raise RuntimeError('Could not inspect source ignore policy')
    if not listing.strip():
        return None
    if not re.fullmatch(r'100(?:644|755) blob [0-9a-f]{40}\t\.gitleaksignore\n?', listing):
        raise ValueError('Source ignore policy must be a regular file')
    code, content = capture(['git', '--git-dir', str(mirror), 'show', revision + ':.gitleaksignore'],
                            env=env, timeout=30, limit=32 * 1024)
    if code:
        raise RuntimeError('Could not read source ignore policy')
    fingerprints = []
    for line in content.splitlines():
        fingerprint = line.strip()
        if not fingerprint or fingerprint.startswith('#'):
            continue
        match = re.fullmatch(r'([0-9a-fA-F]{40}):([^:]+):([A-Za-z0-9][A-Za-z0-9_-]{0,127}):([1-9][0-9]*)', fingerprint)
        if not match:
            raise ValueError('Source ignore policy must contain exact fingerprints only')
        path = match[2]
        if (path.startswith(('/', '!', '~')) or any(part in ('', '.', '..') for part in path.split('/'))
                or re.search(r'[\x00-\x1f\x7f*?\[\]{}\\]', path)):
            raise ValueError('Source ignore policy contains a nonliteral path')
        fingerprints.append(fingerprint)
    if not fingerprints:
        return None
    destination = tools / 'reviewed-gitleaksignore'
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        output.write('\n'.join(fingerprints) + '\n')
    return destination


def browser_result(path, code):
    name = 'Enztronic offline browser UX'
    try:
        checks = read_report(path, limit=4096)
        if not isinstance(checks, list) or len(checks) != 1 or not isinstance(checks[0], dict):
            raise ValueError('Invalid browser report')
        check = checks[0]
        if (check.get('name') != name or check.get('category') != 'unit'
                or check.get('status') not in ('pass', 'fail') or code not in (0, 1)
                or (check['status'] == 'pass') != (code == 0)):
            raise ValueError('Contradictory browser report')
        metrics = check.get('metrics', {})
        counters = {}
        for key in ['exit_code', 'passed', 'failed', 'errors']:
            value = metrics.get(key)
            if type(value) is not int or value < (-1 if key == 'exit_code' else 0) or value > 2**53 - 1:
                raise ValueError('Invalid browser counter')
            counters[key] = value
        if check['status'] == 'pass':
            if not counters['passed'] or counters['failed'] or counters['errors'] or counters['exit_code']:
                raise ValueError('Browser assertions did not pass')
            counters['tests'] = counters['passed']
        elif not counters['errors'] or not counters['failed']:
            raise ValueError('Browser failure must remain explicit')
        for key in ['readiness_failed', 'readiness_error', 'execution_error', 'output_limit', 'timed_out', 'cleanup_failed']:
            if metrics.get(key) is True:
                counters[key] = True
        readiness_status = metrics.get('readiness_status')
        if type(readiness_status) is int and (readiness_status == 0 or 100 <= readiness_status <= 599):
            counters['readiness_status'] = readiness_status
        if type(metrics.get('first_error_code')) is int and metrics['first_error_code'] in (1, 2, 3):
            counters['first_error_code'] = metrics['first_error_code']
        return result(name, 'unit', check['status'], **counters)
    except (ValueError, TypeError, AttributeError):
        return result(name, 'unit', 'fail', errors=1, invalid_report=True)


def retain_browser_diagnostics(work, repository, revision):
    """Private offline-fixture failure tails; never returned in check bundles."""
    source = work / '.audit-ux-diagnostics.json'
    if not source.exists():
        return
    if source.is_symlink() or not source.is_file():
        raise ValueError('Invalid browser diagnostics file')
    diagnostics = read_report(source, limit=256 * 1024)
    if not isinstance(diagnostics, dict) or set(diagnostics) != {'server', 'test'}:
        raise ValueError('Invalid browser diagnostics shape')
    for streams in diagnostics.values():
        if streams is not None and (not isinstance(streams, dict) or set(streams) != {'stdout', 'stderr'}
                or any(not isinstance(text, str) or len(text) > 8192 for text in streams.values())):
            raise ValueError('Invalid browser diagnostics tail')
    report_dir = ROOT / 'state' / repository
    report_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = report_dir / 'offline-ux-diagnostics.json'
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        destination.chmod(0o600)
        json.dump({'revision': revision, 'diagnostics': diagnostics}, output)


def cleanup_resources(repository, container, work, tools, env, image=None, extra_containers=()):
    """Attempt every exact resource cleanup even when an earlier one fails."""
    failed = False
    commands = [(['docker', 'rm', '--force', container], 'No such container')]
    commands += [(['docker', 'rm', '--force', name], 'No such container') for name in extra_containers]
    if image:
        commands.append((['docker', 'image', 'rm', image], 'No such image'))
    for command, absent_message in commands:
        try:
            code, output = capture(command, env=env, timeout=30)
            if code and absent_message not in output:
                failed = True
        except Exception:
            failed = True
    for path, prefix in [(work, 'work-'), (tools, 'tools-')]:
        if path is None:
            continue
        try:
            resolved = path.resolve()
            if resolved.parent != ROOT.resolve() or not resolved.name.startswith(prefix + repository + '-'):
                raise ValueError('Unsafe audit cleanup target')
            shutil.rmtree(resolved)
        except Exception:
            failed = True
    if failed:
        raise RuntimeError('Audit resource cleanup could not be completed')


# Executed inside the container with no production credentials and no Docker socket.
NODE_DRIVER = r'''
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const kind='enztronic';
const results=[];
function counters(value, keys) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw Error();
  for(const key of keys)
    if(!Number.isSafeInteger(value[key]) || value[key]<0) throw Error();
  return value;
}
function run(name,category,args,parser,env=process.env) {
  const r=spawnSync(args[0],args.slice(1),{encoding:'utf8',timeout:1200000,maxBuffer:8*1024*1024,env});
  let status=r.status===0?'pass':'fail';
  let metrics={exit_code:r.status??-1};
  if(r.error) metrics.execution_error=true;
  if(parser==='audit') {
    try {
      const data=JSON.parse(r.stdout), counts=counters(data?.metadata?.vulnerabilities,['info','low','moderate','high','critical','total']);
      if(!data.vulnerabilities || typeof data.vulnerabilities!=='object' || Array.isArray(data.vulnerabilities) || (r.status!==0&&r.status!==1)) throw Error();
      for(const level of ['critical','high','moderate','low']) metrics[level]=counts[level]||0;
      metrics.total=counts.total;
      if(counts.total!==['info','low','moderate','high','critical'].reduce((sum,key)=>sum+counts[key],0)) throw Error();
      if(counts.total===0) status='pass';
      else status=(counts.critical||counts.high)?'fail':'warn';
    } catch { status='fail'; metrics.invalid_report=true; }
  } else if(parser==='outdated') {
    try {
      const data=JSON.parse(r.stdout||'{}');
      if(!data || typeof data!=='object' || Array.isArray(data) || (r.status!==0&&r.status!==1)) throw Error();
      if(Object.values(data).some(item=>!item || typeof item!=='object' || (item.current!==undefined&&typeof item.current!=='string') || typeof item.wanted!=='string' || typeof item.latest!=='string')) throw Error();
      metrics.packages=Object.keys(data).length;
      status=metrics.packages?'warn':'pass';
    } catch { status='fail'; metrics.invalid_report=true; }
  } else if(parser==='tests') {
    const text=r.stdout+'\n'+r.stderr;
    metrics.passed=Number(text.match(/# pass (\d+)/)?.[1]||0);
    metrics.failed=Number(text.match(/# fail (\d+)/)?.[1]||0);
    if(!metrics.passed||metrics.failed) status='fail';
  } else if(parser==='lint') {
    try {
      const rows=JSON.parse(r.stdout);
      if(!Array.isArray(rows)) throw Error();
      rows.forEach(row=>counters(row,['errorCount','warningCount']));
      metrics.errors=rows.reduce((n,row)=>n+row.errorCount,0);
      metrics.warnings=rows.reduce((n,row)=>n+row.warningCount,0);
      status=(metrics.errors||metrics.warnings||r.status!==0)?'fail':'pass';
    } catch { status='fail'; metrics.invalid_report=true; }
  }
  results.push({name,category,status,metrics});
  return status;
}
run(kind+' install','install',['npm','ci']);
if(results[0].status!=='pass') {
  for(const category of ['audit-prod','audit-full','outdated','lint','typecheck','unit','build'])
    results.push({name:kind+' '+category,category,status:'blocked',metrics:{install_failed:true}});
} else {
  run(kind+' production audit','audit-prod',['npm','audit','--omit=dev','--json'],'audit');
  run(kind+' full audit','audit-full',['npm','audit','--json'],'audit');
  run(kind+' available updates','outdated',['npm','outdated','--json'],'outdated');
    run(kind+' lint','lint',['node','node_modules/eslint/bin/eslint.js','--format','json'],'lint');
    run(kind+' route type generation','typecheck',['node','node_modules/next/dist/bin/next','typegen']);
    run(kind+' TypeScript','typecheck',['node','node_modules/typescript/bin/tsc','--noEmit','--pretty','false']);
      run('Enztronic browser toolchain','setup',['node','-e',"const fs=require('node:fs');const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));const installed=JSON.parse(fs.readFileSync('node_modules/playwright/package.json','utf8'));if(lock.packages?.['node_modules/playwright']?.version!=='1.62.1'||installed.version!=='1.62.1')process.exit(1)"]);
      run('Enz UX network policy tests','unit',['node','--test','--test-reporter=tap','scripts/ux-network-guard.test.mjs'],'tests');
    const primaryBuild=run(kind+' production build','build',['npm','run','build']);
    if(kind==='enztronic' && primaryBuild==='pass') {
      // Keep the representative public-CMS build result. Browser assertions use
      // a separately labeled deterministic fallback build, never live providers.
      const offlineEnv={...process.env};
      delete offlineEnv.NEXT_PUBLIC_SANITY_PROJECT_ID;
      delete offlineEnv.NEXT_PUBLIC_SANITY_DATASET;
      try {
        fs.rmSync('/workspace/.next',{recursive:true,force:true});
        run('Enz offline UX fixture build','build',['npm','run','build'],undefined,offlineEnv);
      } catch {
        results.push({name:'Enz offline UX fixture build',category:'build',status:'fail',metrics:{errors:1}});
      }
    }
}
fs.writeFileSync('/workspace/.audit-checks.json',JSON.stringify(results));
'''


# This second container has no network except loopback and no production secrets.
UX_DRIVER = r'''
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const http=require('node:http');
// Match the bind host to NextURL's loopback canonicalization so next-intl's
// default-locale rewrite remains same-origin instead of redirecting in a loop.
const BASE_URL='http://localhost:3100';
const OUTPUT_LIMIT=1024*1024;
const check={name:'Enztronic offline browser UX',category:'unit',status:'fail',metrics:{errors:1,passed:0,failed:1,exit_code:-1}};
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

function signalGroup(state,signal) {
  if(!state?.child.pid || state.closed) return;
  try { process.kill(-state.child.pid,signal); }
  catch(error) { if(error.code!=='ESRCH') state.error=true; }
}
function launch(command,args) {
  const child=spawn(command,args,{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BASE_URL,NODE_ENV:'production'}});
  const state={child,closed:false,error:false,overflow:false,code:null,stdout:'',bytes:0,firstErrorCode:0,tails:{stdout:'',stderr:''}};
  state.done=new Promise(resolve=>{
    child.once('error',()=>{state.error=true;});
    child.once('close',code=>{state.closed=true;state.code=code;resolve();});
  });
  for(const [stream,retain] of [[child.stdout,true],[child.stderr,false]]) stream?.on('data',chunk=>{
    const name=retain?'stdout':'stderr';
    state.tails[name]=(state.tails[name]+chunk.toString('utf8')).slice(-8192);
    state.bytes+=Buffer.byteLength(chunk);
    if(state.bytes>OUTPUT_LIMIT) {state.overflow=true;signalGroup(state,'SIGKILL');return;}
    if(retain) state.stdout+=chunk.toString('utf8');
    // Fixed codes only: 1=assertion, 2=Playwright wait timeout, 3=browser launch.
    // No assertion text, local form values or stack traces cross this boundary.
    if(!retain && !state.firstErrorCode) {
      const text=chunk.toString('utf8');
      state.firstErrorCode=/ERR_ASSERTION/.test(text)?1:/TimeoutError|Timeout [0-9]+ms exceeded/.test(text)?2:/browserType\.launch/.test(text)?3:0;
    }
  });
  return state;
}
async function stop(state) {
  if(!state || state.closed) return;
  async function wait(milliseconds) {
    let timer;
    try {await Promise.race([state.done,new Promise(resolve=>{timer=setTimeout(resolve,milliseconds);})]);}
    finally {clearTimeout(timer);}
  }
  signalGroup(state,'SIGTERM');
  await wait(2000);
  if(!state.closed) {
    signalGroup(state,'SIGKILL');
    await wait(1000);
  }
  if(!state.closed) throw Error('Child cleanup failed');
}
let lastProbe={status:0,error:false};
function probe() {
  return new Promise(resolve=>{
    let request,timer,settled=false;
    lastProbe={status:0,error:false};
    function finish(ok,error=false) {
      if(settled) return;
      settled=true;clearTimeout(timer);lastProbe.error=error;resolve(ok);
    }
    // A static HEAD avoids localized redirects and streamed page completion.
    // This is a wall-clock deadline, independent of socket activity/body data.
    timer=setTimeout(()=>{finish(false,true);request?.destroy();},2000);
    request=http.request(BASE_URL+'/icon.png',{method:'HEAD'},response=>{
      lastProbe.status=Number.isInteger(response.statusCode)?response.statusCode:0;
      response.resume();
      finish(response.statusCode===200);
    });
    request.once('error',()=>finish(false,true));
    request.end();
  });
}
async function ready(server) {
  const deadline=Date.now()+90000;
  while(Date.now()<deadline) {
    if(server.closed || server.error || server.overflow) return false;
    if(await probe()) return !server.closed && !server.error && !server.overflow;
    await pause(200);
  }
  return false;
}
async function main() {
  let server,test,timer;
  try {
    server=launch(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','localhost','--port','3100']);
    if(!await ready(server)) {
      check.metrics.readiness_failed=true;
      check.metrics.readiness_status=lastProbe.status;
      if(lastProbe.error) check.metrics.readiness_error=true;
      return;
    }
    test=launch('npm',['run','test:ux']);
    timer=setTimeout(()=>{test.timedOut=true;signalGroup(test,'SIGKILL');},600000);
    await test.done;
    check.metrics.exit_code=test.code??-1;
    const summaries=[...test.stdout.matchAll(/^Verified ([0-9]+) UX groups(?:\..*)?$/gm)];
    const passed=summaries.length===1?Number(summaries[0][1]):0;
    if(test.code===0 && !test.error && !test.overflow && !test.timedOut && !server.closed && !server.error && !server.overflow && Number.isSafeInteger(passed) && passed>0) {
      check.status='pass';check.metrics={exit_code:0,passed,failed:0,tests:passed,errors:0};
    } else {
      check.metrics.execution_error=!!test.error;
      check.metrics.output_limit=!!(test.overflow||server.overflow);
      check.metrics.timed_out=!!test.timedOut;
      if(test.firstErrorCode) check.metrics.first_error_code=test.firstErrorCode;
    }
  } catch {
    check.metrics.execution_error=true;
  } finally {
    if(timer) clearTimeout(timer);
    for(const child of [test,server]) {
      try {await stop(child);}
      catch {check.status='fail';check.metrics.errors=1;check.metrics.failed=1;check.metrics.cleanup_failed=true;}
    }
    if(check.status==='fail') {
      // Synthetic network-none fixture only. Python moves bounded tails to
      // private state before removing work; no raw text enters the check report.
      try {fs.writeFileSync('/workspace/.audit-ux-diagnostics.json',JSON.stringify({server:server?.tails??null,test:test?.tails??null}),{mode:0o600});}
      catch {check.metrics.execution_error=true;}
    }
    fs.writeFileSync('/workspace/.audit-ux-checks.json',JSON.stringify([check]),{mode:0o600});
    process.exitCode=check.status==='pass'?0:1;
  }
}
main().catch(()=>{process.exitCode=1;});
'''


def audit_repository(repository=PROJECT_ID):
    if repository != PROJECT_ID:
        raise ValueError('Only the Enztronic repository is allowed')
    prepare_runtime(ROOT)
    with pipeline_lock():
        return _audit_repository(repository)


def _audit_repository(repository):
    kind = PROJECT_ID
    public_environment = public_build_settings(ROOT / 'sites/enztronic-public-env.json')
    mirror = ROOT / 'mirrors' / (repository + '.git')
    anonymous_home = ROOT / 'cache/anonymous-home'
    ensure_private_directory(anonymous_home)
    if (anonymous_home / '.netrc').exists() or (anonymous_home / '.netrc').is_symlink():
        raise ValueError('Anonymous Git home must not contain credentials')
    # Public HTTPS only: no deploy keys, inherited tokens, credential helpers or
    # runner-specific Git configuration are supplied to repository commands.
    env = {'PATH': os.environ.get('PATH', os.defpath), 'HOME': str(anonymous_home), 'LANG': 'C.UTF-8',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_ASKPASS': '/bin/false', 'GIT_CONFIG_NOSYSTEM': '1',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'credential.helper', 'GIT_CONFIG_VALUE_0': ''}
    url = REPOSITORY_URL
    if mirror.is_symlink():
        raise ValueError('Audit mirror must not be a symlink')
    if not mirror.exists():
        checked(['git', 'clone', '--bare', '--single-branch', '--branch', 'main', url, str(mirror)], env=env, timeout=180)
    else:
        if checked(['git', '--git-dir', str(mirror), 'config', '--get', 'remote.origin.url'], env=env) != url:
            raise RuntimeError('Unexpected audit mirror origin')
        checked(['git', '--git-dir', str(mirror), 'fetch', 'origin', '+refs/heads/main:refs/heads/main'], env=env, timeout=180)
    revision = checked(['git', '--git-dir', str(mirror), 'rev-parse', 'refs/heads/main'], env=env)
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise RuntimeError('Invalid source revision')
    checks = []
    work = Path(tempfile.mkdtemp(prefix='work-' + repository + '-', dir=ROOT))
    tools = None
    container = 'website-audit-' + repository + '-' + str(os.getpid())
    browser_containers = []
    image = None
    try:
        tools = Path(tempfile.mkdtemp(prefix='tools-' + repository + '-', dir=ROOT))
        ignore = source_gitleaks_ignore(mirror, revision, tools, env)
        secret_report = work / 'secrets.json'
        scanner = [str(ROOT / 'bin/gitleaks'), 'git', '--no-banner', '--redact=100',
            '--report-format', 'json', '--report-path', str(secret_report),
            '--log-opts=refs/heads/main']
        if ignore:
            scanner += ['--gitleaks-ignore-path', str(ignore)]
        scanner.append(str(mirror))
        # Gitleaks defaults to a cwd ignore file; the private tools directory has
        # no ambient policy and the bare mirror is checked above.
        code, _ = capture(scanner, env=env, cwd=tools, timeout=300)
        if code not in (0, 1) or not secret_report.exists():
            checks.append(result(repository + ' secret/history scan', 'gitleaks', 'fail', scanner_failed=True))
        else:
            findings = read_report(secret_report)
            if findings is None:
                findings = []
            if not isinstance(findings, list) or not all(isinstance(item, dict) for item in findings):
                raise ValueError('Invalid secret scanner report')
            checks.append(result(repository + ' secret/history scan', 'gitleaks', 'fail' if findings or code else 'pass', findings=len(findings), history_scanned=True))
            # Keep only redacted location metadata, never matches, identities or secret values.
            details = []
            for item in findings:
                location = {'rule': item.get('RuleID'), 'file': item.get('File'), 'line': item.get('StartLine')}
                commit = item.get('Commit')
                if isinstance(commit, str) and re.fullmatch(r'[0-9a-fA-F]{40}', commit):
                    location['commit'] = commit.lower()
                details.append(location)
            report_dir = ROOT / 'state' / repository
            atomic_json(report_dir / 'secret-locations.json', {'revision': revision, 'findings': details})
        archive_path = work / 'source.tar'
        checked(['git', '--git-dir', str(mirror), 'archive', '-o', str(archive_path), revision], env=env)
        with tarfile.open(archive_path) as archive:
            archive.extractall(work, filter='data')
        archive_path.unlink()
        (tools / 'driver.cjs').write_text(NODE_DRIVER, encoding='utf-8')
        cache = ROOT / 'cache' / 'npm'
        cache.mkdir(parents=True, exist_ok=True)
        command = ['docker', 'run', '--rm', '--name', container, '--cpus', '2', '--memory', '3g',
            '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912', '--user',
            str(os.getuid()) + ':' + str(os.getgid()), '--env', 'HOME=/tmp', '--env',
            'NEXT_TELEMETRY_DISABLED=1', '--env', 'npm_config_cache=/npm-cache',
            '--volume', str(work) + ':/workspace', '--volume', str(cache) + ':/npm-cache',
            '--volume', str(tools / 'driver.cjs') + ':/audit-driver.cjs:ro',
            '--workdir', '/workspace']
        for name, value in public_environment.items():
            command += ['--env', name + '=' + value]
        if kind == 'enztronic':
            command += ['--env', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1']
        command += [PLAYWRIGHT_IMAGE, 'node', '/audit-driver.cjs']
        code, _ = capture(command, env=env, timeout=2400, limit=8 * 1024 * 1024)
        output = work / '.audit-checks.json'
        if code or not output.exists():
            checks.append(result(repository + ' isolated verification', 'build', 'fail', container_failed=True))
        else:
            checks.extend(read_report(output))
        if kind == 'enztronic':
            fixture_ready = all(any(check.get('name') == name and check.get('status') == 'pass' for check in checks)
                                for name in ['enztronic production build', 'Enz offline UX fixture build', 'Enztronic browser toolchain', 'Enz UX network policy tests'])
            if not fixture_ready:
                checks.append(result('Enztronic offline browser UX', 'unit', 'blocked', errors=1, prerequisites_failed=True))
            else:
                (tools / 'ux-driver.cjs').write_text(UX_DRIVER, encoding='utf-8')
                browser_container = container + '-ux'
                browser_containers.append(browser_container)
                browser_command = ['docker', 'run', '--rm', '--init', '--name', browser_container,
                    '--network', 'none', '--cpus', '2', '--memory', '3g', '--pids-limit', '512',
                    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
                    '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912', '--shm-size', '268435456',
                    '--user', str(os.getuid()) + ':' + str(os.getgid()), '--env', 'HOME=/tmp',
                    '--env', 'NEXT_TELEMETRY_DISABLED=1', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
                    '--volume', str(work) + ':/workspace',
                    '--volume', str(tools / 'ux-driver.cjs') + ':/audit-ux-driver.cjs:ro',
                    '--workdir', '/workspace', PLAYWRIGHT_IMAGE, 'node', '/audit-ux-driver.cjs']
                browser_code, _ = capture(browser_command, env=env, timeout=900, limit=2 * 1024 * 1024)
                browser_output = work / '.audit-ux-checks.json'
                if browser_code not in (0, 1) or not browser_output.exists():
                    checks.append(result('Enztronic offline browser UX', 'unit', 'fail', errors=1, container_failed=True))
                else:
                    checks.append(browser_result(browser_output, browser_code))
                if checks[-1]['status'] != 'pass':
                    retain_browser_diagnostics(work, repository, revision)
        return {'revision': revision, 'repository': repository, 'checks': checks}
    finally:
        cleanup_resources(repository, container, work, tools, env, image, browser_containers)


def main():
    global ROOT
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', help='Private independent runner directory')
    args = parser.parse_args()
    try:
        ROOT = runtime_root(args.root)
        document = audit_repository()
        print(json.dumps(document))
        states = {check['status'] for check in document['checks']}
        return 1 if states & {'fail', 'blocked'} else (2 if 'warn' in states else 0)
    except PipelineBusyError:
        print(json.dumps({'checks': [result(PROJECT_ID + ' repository audit busy', 'setup', 'blocked', exit_code=1)]}))
        return 1
    except Exception as error:
        # No command output, environment value, credential URL or raw log is emitted.
        name = PROJECT_ID + (' independent lock unavailable' if isinstance(error, PipelineLockUnavailableError) else ' source audit')
        print(json.dumps({'checks': [result(name, 'setup', 'fail', execution_error=True, error_type=type(error).__name__)]}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
