"""Local fixtures only: no Git remote, npm install, Docker, VPS or production data."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('repository_check', Path(__file__).resolve().parents[1] / 'repository_check.py')
repository = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repository)

DRIVER_HARNESS = r'''
const fs=require('node:fs'), vm=require('node:vm');
const fixture=JSON.parse(fs.readFileSync(0,'utf8'));
let report;
const calls=[];
const clean={metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}},vulnerabilities:{}};
const sandbox={
  process:{argv:['node','driver.cjs',fixture.kind||'frontend'],env:{NEXT_PUBLIC_SANITY_PROJECT_ID:'fixture-project',NEXT_PUBLIC_SANITY_DATASET:'production',NEXT_PUBLIC_SITE_URL:'https://example.test'}},
  Date:class extends Date { static now(){return Date.parse(fixture.now||'2026-10-16T00:00:00Z');} },
  require(name){
    if(name==='node:fs') return {writeFileSync(_path,text){report=JSON.parse(text);},rmSync(){}};
    if(name==='node:child_process') return {spawnSync(command,args,options){
      if(options.timeout!==1200000 || options.maxBuffer!==8*1024*1024) throw Error('Unbounded command');
      const key=[command,...args].join(' ');
      calls.push({command:key,env:options.env});
      if(fixture.fail_fixture_build && key==='npm run build' && !options.env.NEXT_PUBLIC_SANITY_PROJECT_ID) return {status:1,stdout:'',stderr:''};
      if(fixture.responses?.[key]) return {stderr:'',...fixture.responses[key]};
      const stdout=args.includes('audit')?JSON.stringify(clean):args.includes('outdated')?'{}':
        args.includes('--format')?'[]':args.includes('test:security')||args.includes('test:hr')||args.includes('test')||args.includes('--test')?'# pass 3\n# fail 0':'';
      return {status:0,stdout,stderr:''};
    }};
    throw Error('Unexpected module');
  },
};
vm.runInNewContext(fixture.driver,sandbox);
process.stdout.write(JSON.stringify(fixture.trace?{report,calls}:report));
'''


UX_HARNESS = r'''
const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const fixture=JSON.parse(fs.readFileSync(0,'utf8'));
let report,clock=0,nextTimer=0;
const children=[],calls=[],kills=[],timers=new Set();
const sandbox={
  Buffer,
  Date:class extends Date {static now(){return fixture.readiness_timeout?(clock+=100000):Date.now();}},
  setTimeout(callback,milliseconds){
    const timer=++nextTimer;timers.add(timer);
    if(milliseconds===600000 && !fixture.test_timeout) return timer;
    queueMicrotask(()=>{if(timers.delete(timer)) callback();});
    return timer;
  },
  clearTimeout(timer){timers.delete(timer);},
  process:{env:{},execPath:'node',exitCode:0,kill(pid,signal){
    kills.push({pid,signal});
    const child=children.find(child=>child.pid===-pid);
    if(child) queueMicrotask(()=>child.emit('close',signal==='SIGKILL'?137:0));
  }},
  require(name){
    if(name==='node:fs') return {writeFileSync(path,text){
      if(path!=='/workspace/.audit-ux-checks.json'||text.length>4096) throw Error('Unexpected report');
      report=JSON.parse(text);
    }};
    if(name==='node:http') return {get(url,options,callback){
      if(url!=='http://127.0.0.1:3100/en'||options.timeout!==2000) throw Error('Unexpected probe');
      const request=new EventEmitter();request.destroy=()=>request.emit('error',new Error('timeout'));
      queueMicrotask(()=>{
        const response=new EventEmitter();response.statusCode=200;response.resume=()=>{};
        callback(response);queueMicrotask(()=>response.emit('end'));
      });return request;
    }};
    if(name==='node:child_process') return {spawn(command,args,options){
      calls.push({command,args,options});
      const child=new EventEmitter();child.pid=101+children.length;child.stdout=new EventEmitter();child.stderr=new EventEmitter();children.push(child);
      const server=children.length===1;
      queueMicrotask(()=>{
        if(server){
          if(fixture.server_error){child.emit('error',new Error('fixture-private-output'));child.emit('close',-2);}
          if(fixture.server_overflow) child.stderr.emit('data',Buffer.alloc(1024*1024+1));
          return;
        }
        if(fixture.test_error){child.emit('error',new Error('fixture-private-output'));child.emit('close',-2);return;}
        if(fixture.test_timeout) return;
        child.stdout.emit('data',Buffer.from(fixture.output??'Verified 28 UX groups. All write requests were intercepted.\n'));
        if(fixture.test_overflow) child.stderr.emit('data',Buffer.alloc(1024*1024+1));
        child.emit('close',fixture.code??0);
      });return child;
    }};
    throw Error('Unexpected module');
  },
};
(async()=>{
  await vm.runInNewContext(fixture.driver,sandbox);
  process.stdout.write(JSON.stringify({report,calls,kills,timers:timers.size,exitCode:sandbox.process.exitCode}));
})().catch(()=>{process.exitCode=1;});
'''


def ux_driver(**fixture):
    completed = subprocess.run(['node', '-e', UX_HARNESS], input=json.dumps({
        'driver': repository.UX_DRIVER, **fixture,
    }), text=True, capture_output=True, timeout=10, check=True)
    return json.loads(completed.stdout)


def driver(responses=None, **fixture):
    completed = subprocess.run(['node', '-e', DRIVER_HARNESS], input=json.dumps({
        'driver': repository.NODE_DRIVER, 'responses': responses or {}, **fixture,
    }), text=True, capture_output=True, timeout=10, check=True)
    return json.loads(completed.stdout)


def audit_report(**levels):
    counts = {key: 0 for key in ['info', 'low', 'moderate', 'high', 'critical']}
    counts.update(levels)
    counts['total'] = sum(value for value in counts.values() if type(value) is int)
    return {'metadata': {'vulnerabilities': counts}, 'vulnerabilities': {}}


class RepositoryDriverTests(unittest.TestCase):
    def test_actual_driver_accepts_clean_npm_json_and_never_emits_command_output(self):
        rows = driver({'npm ci': {'status': 0, 'stdout': 'password=fixture-private-output'}})
        self.assertTrue(all(row['status'] == 'pass' for row in rows))
        self.assertNotIn('fixture-private-output', json.dumps(rows))
        self.assertEqual(next(row for row in rows if row['category'] == 'audit-prod')['metrics']['total'], 0)

    def test_audit_malformed_error_or_invalid_counters_cannot_be_green(self):
        for payload, code in [
            ({'error': {'code': 'ENOAUDIT', 'detail': 'fixture-private-output'}}, 1),
            ('invalid-json', 1),
            (audit_report(high='1'), 1),
            ({'metadata': {'vulnerabilities': {'total': 0}}, 'vulnerabilities': {}}, 0),
            (audit_report(), 2),
        ]:
            output = payload if isinstance(payload, str) else json.dumps(payload)
            rows = driver({'npm audit --omit=dev --json': {'status': code, 'stdout': output}})
            row = next(row for row in rows if row['category'] == 'audit-prod')
            self.assertEqual(row['status'], 'fail')
            self.assertTrue(row['metrics']['invalid_report'])
            self.assertNotIn('fixture-private-output', json.dumps(rows))

    def test_high_and_moderate_audits_keep_correct_severity(self):
        for severity, expected in [('high', 'fail'), ('moderate', 'warn')]:
            rows = driver({'npm audit --omit=dev --json': {'status': 1, 'stdout': json.dumps(audit_report(**{severity: 1}))}})
            self.assertEqual(next(row for row in rows if row['category'] == 'audit-prod')['status'], expected)

    def test_known_dev_acceptance_requires_clean_production_and_unexpired_review(self):
        known = audit_report(high=1)
        known['vulnerabilities'] = {'dev-only': {'via': [{'url': 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'}]}}
        command = {'npm audit --json': {'status': 1, 'stdout': json.dumps(known)}}
        self.assertEqual(next(row for row in driver(command) if row['category'] == 'audit-full')['status'], 'warn')
        self.assertEqual(next(row for row in driver(command, now='2026-11-01T00:00:00Z') if row['category'] == 'audit-full')['status'], 'fail')
        command['npm audit --omit=dev --json'] = {'status': 1, 'stdout': json.dumps(audit_report(high=1))}
        self.assertEqual(next(row for row in driver(command) if row['category'] == 'audit-full')['status'], 'fail')

    def test_outdated_accepts_package_records_and_rejects_error_json(self):
        for report, status in [
            ({}, 'pass'),
            ({'fixture': {'current': '1.0.0', 'wanted': '1.0.1', 'latest': '2.0.0'}}, 'warn'),
            ({'missing-optional': {'wanted': '1.0.1', 'latest': '2.0.0'}}, 'warn'),
            ({'error': {'code': 'E401', 'summary': 'fixture-private-output'}}, 'fail'),
            ([], 'fail'),
            (None, 'fail'),
        ]:
            rows = driver({'npm outdated --json': {'status': 0 if not report else 1, 'stdout': json.dumps(report)}})
            self.assertEqual(next(row for row in rows if row['category'] == 'outdated')['status'], status)
            self.assertNotIn('fixture-private-output', json.dumps(rows))

    def test_lint_and_tests_cannot_report_pass_with_missing_or_invalid_counts(self):
        for output in ['[{"errorCount":"0","warningCount":0}]', '[{}]', 'not-json']:
            rows = driver({'node node_modules/eslint/bin/eslint.js --format json': {'status': 0, 'stdout': output}})
            self.assertEqual(next(row for row in rows if row['category'] == 'lint')['status'], 'fail')
        rows = driver({'npm run test:security': {'status': 0, 'stdout': '# pass 0\n# fail 0'}})
        self.assertEqual(next(row for row in rows if row['name'] == 'Frontend security tests')['status'], 'fail')

    def test_failed_install_blocks_downstream_checks(self):
        rows = driver({'npm ci': {'status': 1, 'stdout': 'fixture-private-output'}})
        self.assertEqual(rows[0]['status'], 'fail')
        self.assertTrue(all(row['status'] == 'blocked' for row in rows[1:]))
        self.assertNotIn('fixture-private-output', json.dumps(rows))

    def test_enz_keeps_representative_build_and_separately_labels_offline_fixture(self):
        trace = driver(kind='enztronic', trace=True)
        rows = trace['report']
        builds = [row['name'] for row in rows if row['category'] == 'build']
        self.assertEqual(builds, ['enztronic production build', 'Enz offline UX fixture build'])
        self.assertTrue(all(row['status'] == 'pass' for row in rows))
        self.assertEqual([row['name'] for row in rows if row['category'] == 'unit'], ['Enz UX network policy tests'])
        commands = [call for call in trace['calls'] if call['command'] == 'npm run build']
        self.assertEqual(commands[0]['env']['NEXT_PUBLIC_SANITY_PROJECT_ID'], 'fixture-project')
        self.assertNotIn('NEXT_PUBLIC_SANITY_PROJECT_ID', commands[1]['env'])
        self.assertNotIn('NEXT_PUBLIC_SANITY_DATASET', commands[1]['env'])
        toolchain = next(call for call in trace['calls'] if call['command'].startswith('node -e'))
        self.assertIn("version!=='1.62.1'", toolchain['command'])
        rows = driver(kind='enztronic', fail_fixture_build=True)
        self.assertEqual(next(row for row in rows if row['name'] == 'enztronic production build')['status'], 'pass')
        self.assertEqual(next(row for row in rows if row['name'] == 'Enz offline UX fixture build')['status'], 'fail')


class EnzBrowserDriverTests(unittest.TestCase):
    def test_success_requires_nonzero_summary_and_releases_server_without_raw_output(self):
        actual = ux_driver()
        check = actual['report'][0]
        self.assertEqual(check['status'], 'pass')
        self.assertEqual(check['metrics']['passed'], 28)
        self.assertEqual(actual['exitCode'], 0)
        self.assertEqual(actual['timers'], 0)
        self.assertIn({'pid': -101, 'signal': 'SIGTERM'}, actual['kills'])
        server, suite = actual['calls']
        self.assertEqual(server['args'][-4:], ['--hostname', '127.0.0.1', '--port', '3100'])
        self.assertEqual((suite['command'], suite['args']), ('npm', ['run', 'test:ux']))
        self.assertEqual(suite['options']['env']['BASE_URL'], 'http://127.0.0.1:3100')

    def test_missing_zero_duplicate_or_failed_summaries_never_pass(self):
        for fixture in [
            {'output': 'fixture-private-output'},
            {'output': 'Verified 0 UX groups. All write requests were intercepted.\n'},
            {'output': 'Verified 28 UX groups.\nVerified 28 UX groups.\n'},
            {'code': 1},
            {'test_error': True},
            {'test_overflow': True},
        ]:
            actual = ux_driver(**fixture)
            self.assertEqual(actual['report'][0]['status'], 'fail')
            self.assertEqual(actual['exitCode'], 1)
            self.assertNotIn('fixture-private-output', json.dumps(actual['report']))
            self.assertIn({'pid': -101, 'signal': 'SIGTERM'}, actual['kills'])

    def test_readiness_and_server_errors_do_not_start_browser_suite(self):
        for fixture in [{'readiness_timeout': True}, {'server_error': True}, {'server_overflow': True}]:
            actual = ux_driver(**fixture)
            self.assertEqual(actual['report'][0]['status'], 'fail')
            self.assertTrue(actual['report'][0]['metrics']['readiness_failed'])
            self.assertEqual(len(actual['calls']), 1)

    def test_suite_timeout_kills_its_process_group_and_still_stops_next(self):
        actual = ux_driver(test_timeout=True)
        self.assertEqual(actual['report'][0]['status'], 'fail')
        self.assertTrue(actual['report'][0]['metrics']['timed_out'])
        self.assertIn({'pid': -102, 'signal': 'SIGKILL'}, actual['kills'])
        self.assertIn({'pid': -101, 'signal': 'SIGTERM'}, actual['kills'])


class RepositoryHostTests(unittest.TestCase):
    def test_enz_browser_container_is_offline_reuses_pinned_image_and_cleans_both_containers(self):
        for failed_build in [None, 'enztronic production build', 'Enz offline UX fixture build']:
            with self.subTest(failed_build=failed_build), tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
                commands = []
                def checked(command, **_kwargs):
                    if 'rev-parse' in command:
                        return 'a' * 40
                    if 'archive' in command:
                        with tarfile.open(command[command.index('-o') + 1], 'w'):
                            pass
                    return ''
                def capture(command, **_kwargs):
                    commands.append(command)
                    if str(command[0]).endswith('gitleaks'):
                        Path(command[command.index('--report-path') + 1]).write_text('[]', encoding='utf-8')
                    if command[:2] == ['docker', 'run']:
                        source = Path(next(value.removesuffix(':/workspace') for value in command if value.endswith(':/workspace')))
                        if '/audit-driver.cjs' in command:
                            rows = [repository.result(name, category, 'fail' if failed_build == name else 'pass')
                                    for name, category in [('enztronic production build', 'build'), ('Enz offline UX fixture build', 'build'), ('Enztronic browser toolchain', 'setup'), ('Enz UX network policy tests', 'unit')]]
                            (source / '.audit-checks.json').write_text(json.dumps(rows), encoding='utf-8')
                        else:
                            report = repository.result('Enztronic offline browser UX', 'unit', 'pass', passed=28, failed=0, errors=0, exit_code=0)
                            (source / '.audit-ux-checks.json').write_text(json.dumps([report]), encoding='utf-8')
                    return 0, ''
                with mock.patch.object(repository, 'checked', side_effect=checked), \
                    mock.patch.object(repository, 'capture', side_effect=capture), \
                    mock.patch.object(repository, 'pipeline_lock', return_value=contextlib.nullcontext()), \
                    mock.patch.object(repository.os, 'getuid', return_value=1000, create=True), \
                    mock.patch.object(repository.os, 'getgid', return_value=1000, create=True):
                    document = repository.audit_repository('enztronic')
                runs = [command for command in commands if command[:2] == ['docker', 'run']]
                self.assertEqual(len(runs), 1 if failed_build else 2)
                self.assertTrue(all(repository.PLAYWRIGHT_IMAGE in command for command in runs))
                unit = next(check for check in document['checks'] if check['name'] == 'Enztronic offline browser UX')
                self.assertEqual(unit['status'], 'blocked' if failed_build else 'pass')
                if not failed_build:
                    browser = runs[1]
                    self.assertEqual(browser[browser.index('--network') + 1], 'none')
                    for flag in ['--read-only', '--init', '--pids-limit', '--cap-drop', '--security-opt', '--tmpfs', '--shm-size', '--user']:
                        self.assertIn(flag, browser)
                    self.assertFalse(any(value in ('-p', '--publish', '--privileged') or 'docker.sock' in value or '/.ssh' in value or 'SANITY' in value for value in browser))
                    owned = {command[command.index('--name') + 1] for command in runs}
                    removed = {command[-1] for command in commands if command[:3] == ['docker', 'rm', '--force']}
                    self.assertEqual(owned, removed)
                self.assertEqual(list(Path(temporary).glob('work-*')) + list(Path(temporary).glob('tools-*')), [])

    def test_browser_report_cannot_hide_zero_assertions_or_expose_raw_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'browser.json'
            for passed, code, status in [(0, 0, 'pass'), (True, 0, 'pass'), (28, 1, 'pass')]:
                check = repository.result('Enztronic offline browser UX', 'unit', status, passed=passed, failed=0, errors=0, exit_code=0)
                path.write_text(json.dumps([check]), encoding='utf-8')
                self.assertEqual(repository.browser_result(path, code)['status'], 'fail')
            check = repository.result('Enztronic offline browser UX', 'unit', 'pass', passed=28, failed=0, errors=0, exit_code=0, raw_log='fixture-private-output')
            path.write_text(json.dumps([check]), encoding='utf-8')
            safe = repository.browser_result(path, 0)
            self.assertEqual(safe['status'], 'pass')
            self.assertNotIn('fixture-private-output', json.dumps(safe))

    def test_timeout_and_output_limits_fail_without_echoing_payload(self):
        began = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, '^Command exceeded time/output limit$'):
            repository.capture([sys.executable, '-c', 'import time;time.sleep(30)'], timeout=0.1)
        self.assertLess(time.monotonic() - began, 5)
        with self.assertRaisesRegex(RuntimeError, '^Command exceeded time/output limit$'):
            repository.capture([sys.executable, '-c', "print('fixture-private-output'*10000)"], timeout=5, limit=100)

    def test_report_size_is_bounded_before_json_parsing(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'report.json'
            path.write_text('{"fixture":"private-output"}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'size limit'):
                repository.read_report(path, limit=5)

    def test_docker_cleanup_failure_does_not_leave_temporary_source_or_tools(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
            work = Path(tempfile.mkdtemp(prefix='work-fixture-', dir=temporary))
            tools = Path(tempfile.mkdtemp(prefix='tools-fixture-', dir=temporary))
            with mock.patch.object(repository, 'capture', side_effect=RuntimeError('timeout')) as command:
                with self.assertRaisesRegex(RuntimeError, 'cleanup'):
                    repository.cleanup_resources('fixture', 'owned-container', work, tools, {}, 'owned:audit-fixture-1')
            self.assertEqual(command.call_count, 2)
            self.assertFalse(work.exists())
            self.assertFalse(tools.exists())

    def test_cleanup_attempts_second_browser_container_even_if_first_removal_fails(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
            work = Path(tempfile.mkdtemp(prefix='work-fixture-', dir=temporary))
            tools = Path(tempfile.mkdtemp(prefix='tools-fixture-', dir=temporary))
            with mock.patch.object(repository, 'capture', side_effect=[RuntimeError('timeout'), (0, '')]) as command:
                with self.assertRaises(RuntimeError):
                    repository.cleanup_resources('fixture', 'owned-build', work, tools, {}, extra_containers=['owned-browser'])
            self.assertEqual([call.args[0][-1] for call in command.call_args_list], ['owned-build', 'owned-browser'])
            self.assertFalse(work.exists())
            self.assertFalse(tools.exists())

    def test_cleanup_rejects_paths_outside_exact_audit_root(self):
        with tempfile.TemporaryDirectory() as temporary, tempfile.TemporaryDirectory() as outside:
            with mock.patch.object(repository, 'ROOT', Path(temporary)), mock.patch.object(repository, 'capture', return_value=(0, '')):
                with self.assertRaisesRegex(RuntimeError, 'cleanup'):
                    repository.cleanup_resources('fixture', 'owned-container', Path(outside), None, {})
            self.assertTrue(Path(outside).exists())

    def test_repository_flow_uses_sanitized_env_and_only_retains_secret_location_metadata(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
            root = Path(temporary)
            def checked(command, **kwargs):
                self.assertNotIn('DISCORD_WEBHOOK_URL', kwargs['env'])
                if 'rev-parse' in command:
                    return 'a' * 40
                if 'archive' in command:
                    with tarfile.open(command[command.index('-o') + 1], 'w'):
                        pass
                return ''
            def capture(command, **kwargs):
                self.assertNotIn('DISCORD_WEBHOOK_URL', kwargs['env'])
                if str(command[0]).endswith('gitleaks'):
                    self.assertIn('--redact=100', command)
                    report = Path(command[command.index('--report-path') + 1])
                    report.write_text(json.dumps([
                        {'RuleID': 'fixture', 'File': 'test.txt', 'StartLine': 3, 'Commit': 'A' * 40,
                         'Secret': 'fixture-private-output', 'Email': 'customer@example.test',
                         'Match': 'fixture-private-output', 'Author': 'Fixture Customer', 'Fingerprint': 'private-fingerprint'},
                        {'RuleID': 'fixture', 'File': 'test.txt', 'StartLine': 4, 'Commit': 'invalid-commit-value'},
                    ]), encoding='utf-8')
                    return 1, ''
                if command[:2] == ['docker', 'run']:
                    source = Path(next(value.removesuffix(':/workspace') for value in command if value.endswith(':/workspace')))
                    (source / '.audit-checks.json').write_text('[]', encoding='utf-8')
                return 0, ''
            with mock.patch.dict(os.environ, {'DISCORD_WEBHOOK_URL': 'fixture-secret'}), \
                mock.patch.object(repository, 'checked', side_effect=checked), \
                mock.patch.object(repository, 'capture', side_effect=capture), \
                mock.patch.object(repository, 'pipeline_lock', return_value=contextlib.nullcontext()), \
                mock.patch.object(repository.os, 'getuid', return_value=1000, create=True), \
                mock.patch.object(repository.os, 'getgid', return_value=1000, create=True):
                document = repository.audit_repository('qianlima-frontend')
            scan = document['checks'][0]
            self.assertEqual(scan['metrics']['findings'], 2)
            self.assertEqual(scan['status'], 'fail')
            report = json.loads((root / 'state/qianlima-frontend/secret-locations.json').read_text(encoding='utf-8'))
            self.assertEqual(report['findings'], [
                {'rule': 'fixture', 'file': 'test.txt', 'line': 3, 'commit': 'a' * 40},
                {'rule': 'fixture', 'file': 'test.txt', 'line': 4},
            ])
            self.assertNotIn('fixture-private-output', json.dumps(document) + json.dumps(report))
            self.assertNotIn('customer@example.test', json.dumps(document) + json.dumps(report))
            self.assertEqual(list(root.glob('work-*')) + list(root.glob('tools-*')), [])

    def test_pipeline_lock_uses_flock_and_releases_when_repository_work_raises(self):
        fake = SimpleNamespace(LOCK_EX=2, LOCK_NB=4, LOCK_UN=8, flock=mock.Mock())
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'fcntl', fake):
            path = Path(temporary) / 'pipeline.lock'
            path.write_text('existing-lock-marker', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'fixture-failure'):
                with repository.pipeline_lock(path):
                    raise ValueError('fixture-failure')
            self.assertEqual(path.read_text(encoding='utf-8'), 'existing-lock-marker')
            self.assertEqual([call.args[1] for call in fake.flock.call_args_list], [6, 8])

    def test_busy_pipeline_is_bounded_and_main_emits_explicit_blocked_setup(self):
        fake = SimpleNamespace(LOCK_EX=2, LOCK_NB=4, LOCK_UN=8, flock=mock.Mock(side_effect=BlockingIOError()))
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'fcntl', fake):
            with self.assertRaises(repository.PipelineBusyError):
                with repository.pipeline_lock(Path(temporary) / 'pipeline.lock', timeout=0):
                    self.fail('Busy pipeline must not start repository work')
        stream = io.StringIO()
        with mock.patch.object(sys, 'argv', ['repository_check.py', 'qianlima-frontend']), \
            mock.patch.object(repository, 'audit_repository', side_effect=repository.PipelineBusyError()), \
            contextlib.redirect_stdout(stream):
            self.assertEqual(repository.main(), 1)
        check = json.loads(stream.getvalue())['checks'][0]
        self.assertEqual((check['category'], check['status']), ('setup', 'blocked'))
        self.assertIn('pipeline busy', check['name'])

    def test_pipeline_lock_does_not_create_an_unprovisioned_parent(self):
        fake = SimpleNamespace(LOCK_EX=2, LOCK_NB=4, LOCK_UN=8, flock=mock.Mock())
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'fcntl', fake):
            parent = Path(temporary) / 'not-provisioned'
            with self.assertRaises(repository.PipelineLockUnavailableError):
                with repository.pipeline_lock(parent / 'pipeline.lock'):
                    self.fail('A missing operational directory must not be created')
            self.assertFalse(parent.exists())


if __name__ == '__main__':
    unittest.main()
