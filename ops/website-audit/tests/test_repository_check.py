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

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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
let report,diagnostics,clock=0,nextTimer=0;
const children=[],calls=[],kills=[],timers=new Set();
const sandbox={
  Buffer,
  Date:class extends Date {static now(){if(fixture.readiness_timeout)return clock+=100000;if(fixture.readiness_status||fixture.probe_timeout||fixture.probe_error)return clock+=50000;return Date.now();}},
  setTimeout(callback,milliseconds){
    const timer=++nextTimer;timers.add(timer);
    if(milliseconds===600000 && !fixture.test_timeout) return timer;
    if(milliseconds===2000 && !fixture.probe_timeout) return timer;
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
      if(path==='/workspace/.audit-ux-diagnostics.json') {if(text.length>256*1024)throw Error('Unbounded diagnostics');diagnostics=JSON.parse(text);return;}
      if(path!=='/workspace/.audit-ux-checks.json'||text.length>4096) throw Error('Unexpected report');
      report=JSON.parse(text);
    }};
    if(name==='node:http') return {request(url,options,callback){
      if(url!=='http://localhost:3100/icon.png'||options.method!=='HEAD') throw Error('Unexpected probe');
      const request=new EventEmitter();request.destroy=()=>request.emit('error',new Error('timeout'));
      request.end=()=>queueMicrotask(()=>{
        if(fixture.probe_timeout) return;
        if(fixture.probe_error){request.emit('error',new Error('fixture-private-error'));return;}
        const response=new EventEmitter();response.statusCode=fixture.readiness_status??200;response.resume=()=>{};
        callback(response);
        if(!fixture.no_response_end) queueMicrotask(()=>response.emit('end'));
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
        if(fixture.stderr) child.stderr.emit('data',Buffer.from(fixture.stderr));
        if(fixture.test_overflow) child.stderr.emit('data',Buffer.alloc(1024*1024+1));
        child.emit('close',fixture.code??0);
      });return child;
    }};
    throw Error('Unexpected module');
  },
};
(async()=>{
  await vm.runInNewContext(fixture.driver,sandbox);
  process.stdout.write(JSON.stringify({report,diagnostics,calls,kills,timers:timers.size,exitCode:sandbox.process.exitCode}));
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

    def test_enz_high_development_advisory_is_never_downgraded_or_suppressed(self):
        known = audit_report(high=1)
        known['vulnerabilities'] = {'dev-only': {'via': [{'url': 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'}]}}
        command = {'npm audit --json': {'status': 1, 'stdout': json.dumps(known)}}
        self.assertEqual(next(row for row in driver(command) if row['category'] == 'audit-full')['status'], 'fail')
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
        rows = driver({'node --test --test-reporter=tap scripts/ux-network-guard.test.mjs': {'status': 0, 'stdout': '# pass 0\n# fail 0'}})
        self.assertEqual(next(row for row in rows if row['name'] == 'Enz UX network policy tests')['status'], 'fail')

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
        self.assertIn('node --test --test-reporter=tap scripts/ux-network-guard.test.mjs', [call['command'] for call in trace['calls']])
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
        self.assertNotIn('diagnostics', actual)
        self.assertEqual(actual['timers'], 0)
        self.assertIn({'pid': -101, 'signal': 'SIGTERM'}, actual['kills'])
        server, suite = actual['calls']
        self.assertEqual(server['args'][-4:], ['--hostname', 'localhost', '--port', '3100'])
        self.assertEqual((suite['command'], suite['args']), ('npm', ['run', 'test:ux']))
        self.assertEqual(suite['options']['env']['BASE_URL'], 'http://localhost:3100')
        self.assertEqual(server['options']['env']['BASE_URL'], suite['options']['env']['BASE_URL'])

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
        for fixture in [{'readiness_timeout': True}, {'readiness_status': 307}, {'server_error': True}, {'server_overflow': True}, {'probe_timeout': True}, {'probe_error': True}]:
            actual = ux_driver(**fixture)
            self.assertEqual(actual['report'][0]['status'], 'fail')
            self.assertTrue(actual['report'][0]['metrics']['readiness_failed'])
            self.assertEqual(len(actual['calls']), 1)
            if fixture.get('readiness_status'):
                self.assertEqual(actual['report'][0]['metrics']['readiness_status'], 307)
            if fixture.get('probe_timeout') or fixture.get('probe_error'):
                self.assertTrue(actual['report'][0]['metrics']['readiness_error'])
                self.assertEqual(actual['report'][0]['metrics']['readiness_status'], 0)

    def test_static_head_readiness_completes_at_headers_without_a_body_end_event(self):
        actual = ux_driver(no_response_end=True)
        self.assertEqual(actual['report'][0]['status'], 'pass')
        self.assertEqual(actual['timers'], 0)

    def test_browser_assertion_reports_only_a_fixed_error_code(self):
        actual = ux_driver(code=1, stderr='AssertionError [ERR_ASSERTION]: fixture-private-form-value\nprivate stack trace')
        self.assertEqual(actual['report'][0]['status'], 'fail')
        self.assertEqual(actual['report'][0]['metrics']['first_error_code'], 1)
        self.assertNotIn('fixture-private-form-value', json.dumps(actual['report']))
        self.assertIn('fixture-private-form-value', actual['diagnostics']['test']['stderr'])

    def test_failure_diagnostics_keep_only_bounded_private_stream_tails(self):
        actual = ux_driver(code=1, output='old-prefix' + 'x' * 10000, stderr='old-prefix' + 'y' * 10000)
        self.assertEqual(actual['diagnostics']['test'], {'stdout': 'x' * 8192, 'stderr': 'y' * 8192})
        self.assertNotIn('old-prefix', json.dumps(actual['diagnostics']))

    def test_suite_timeout_kills_its_process_group_and_still_stops_next(self):
        actual = ux_driver(test_timeout=True)
        self.assertEqual(actual['report'][0]['status'], 'fail')
        self.assertTrue(actual['report'][0]['metrics']['timed_out'])
        self.assertIn({'pid': -102, 'signal': 'SIGKILL'}, actual['kills'])
        self.assertIn({'pid': -101, 'signal': 'SIGTERM'}, actual['kills'])


class RepositoryHostTests(unittest.TestCase):
    def test_failure_diagnostics_survive_work_cleanup_privately_and_never_enter_bundle(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
            work = Path(temporary) / 'work-enztronic-fixture'
            work.mkdir()
            tails = {'server': {'stdout': 'fixture startup', 'stderr': ''}, 'test': {'stdout': '', 'stderr': 'fixture-private-failure'}}
            (work / '.audit-ux-diagnostics.json').write_text(json.dumps(tails), encoding='utf-8')
            repository.retain_browser_diagnostics(work, 'enztronic', 'a' * 40)
            with mock.patch.object(repository, 'capture', return_value=(0, '')):
                repository.cleanup_resources('enztronic', 'owned-container', work, None, {})
            path = Path(temporary) / 'state/enztronic/offline-ux-diagnostics.json'
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), {'revision': 'a' * 40, 'diagnostics': tails})
            self.assertFalse(work.exists())
            if os.name == 'posix':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_missing_head_ignore_never_reads_git_show_or_creates_a_blank_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            tools = Path(temporary)
            with mock.patch.object(repository, 'capture', return_value=(0, '')) as capture:
                self.assertIsNone(repository.source_gitleaks_ignore(tools / 'mirror.git', 'a' * 40, tools, {}))
            self.assertEqual(capture.call_count, 1)
            self.assertIn('ls-tree', capture.call_args.args[0])
            self.assertEqual(list(tools.iterdir()), [])

    def test_exact_head_fingerprints_are_bounded_private_and_comments_are_not_copied(self):
        fingerprint = 'a' * 40 + ':src/components/example.tsx:generic-api-key:19'
        listing = '100644 blob ' + 'b' * 40 + '\t.gitleaksignore\n'
        with tempfile.TemporaryDirectory() as temporary:
            tools = Path(temporary)
            with mock.patch.object(repository, 'capture', side_effect=[(0, listing), (0, '# Reviewed fixture only\n\n' + fingerprint + '\n')]) as capture:
                path = repository.source_gitleaks_ignore(tools / 'mirror.git', 'c' * 40, tools, {'FIXTURE': 'public'})
            self.assertEqual(path.read_text(encoding='utf-8'), fingerprint + '\n')
            self.assertEqual(capture.call_args.kwargs['limit'], 32 * 1024)
            self.assertEqual(capture.call_args.args[0][-1], 'c' * 40 + ':.gitleaksignore')
            if os.name == 'posix':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_wildcards_prefixes_rule_only_and_path_traversal_ignore_lines_are_rejected(self):
        listing = '100644 blob ' + 'b' * 40 + '\t.gitleaksignore\n'
        for entry in [
            'generic-api-key', 'a' * 40 + ':src/*:generic-api-key:19',
            'a' * 40 + ':src/example.tsx:generic*:19', 'a' * 40 + ':src/example.tsx:generic-api-key:0',
            'a' * 40 + ':../example.tsx:generic-api-key:19', 'a' * 40 + ':/example.tsx:generic-api-key:19',
            'a' * 40 + ':src/exam?le.tsx:generic-api-key:19', 'a' * 40 + ':src/example.tsx:generic-api-key',
            'a' * 39 + ':src/example.tsx:generic-api-key:19', '[allowlist]\nrules=["generic-api-key"]',
        ]:
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temporary:
                tools = Path(temporary)
                with mock.patch.object(repository, 'capture', side_effect=[(0, listing), (0, entry)]):
                    with self.assertRaises(ValueError):
                        repository.source_gitleaks_ignore(tools / 'mirror.git', 'c' * 40, tools, {})
                self.assertEqual(list(tools.iterdir()), [])

    def test_ignore_git_errors_and_ambient_mirror_policy_fail_closed(self):
        listing = '100644 blob ' + 'b' * 40 + '\t.gitleaksignore\n'
        for replies in [[(128, 'fixture-private-output')], [(0, listing), (128, 'fixture-private-output')]]:
            with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'capture', side_effect=replies):
                with self.assertRaises(RuntimeError) as error:
                    repository.source_gitleaks_ignore(Path(temporary) / 'mirror.git', 'c' * 40, Path(temporary), {})
                self.assertNotIn('fixture-private-output', str(error.exception))
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'capture') as capture:
            mirror = Path(temporary) / 'mirror.git'
            mirror.mkdir()
            (mirror / '.gitleaksignore').write_text('*', encoding='utf-8')
            with self.assertRaises(ValueError):
                repository.source_gitleaks_ignore(mirror, 'c' * 40, Path(temporary), {})
            capture.assert_not_called()

    def test_enz_browser_container_is_offline_reuses_pinned_image_and_cleans_both_containers(self):
        for failed_build in [None, 'enztronic production build', 'Enz offline UX fixture build']:
            with self.subTest(failed_build=failed_build), tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)):
                commands = []
                (Path(temporary) / 'sites').mkdir()
                (Path(temporary) / 'sites/enztronic-public-env.json').write_text(json.dumps({'NEXT_PUBLIC_SANITY_PROJECT_ID': 'fixture', 'NEXT_PUBLIC_SANITY_DATASET': 'production'}), encoding='utf-8')
                def checked(command, **_kwargs):
                    if 'rev-parse' in command:
                        return 'a' * 40
                    if 'archive' in command:
                        with tarfile.open(command[command.index('-o') + 1], 'w'):
                            pass
                    return ''
                def capture(command, **_kwargs):
                    commands.append(command)
                    if 'ls-tree' in command:
                        return 0, '100644 blob ' + 'b' * 40 + '\t.gitleaksignore\n'
                    if 'show' in command:
                        return 0, 'a' * 40 + ':src/fixture.ts:generic-api-key:12\n'
                    if str(command[0]).endswith('gitleaks'):
                        ignore = Path(command[command.index('--gitleaks-ignore-path') + 1])
                        self.assertEqual(ignore.read_text(encoding='utf-8'), 'a' * 40 + ':src/fixture.ts:generic-api-key:12\n')
                        self.assertEqual(_kwargs['cwd'], ignore.parent)
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
            check = repository.result('Enztronic offline browser UX', 'unit', 'fail', passed=0, failed=1, errors=1, exit_code=-1, readiness_failed=True, readiness_status=307, readiness_error=True, timed_out=True, first_error_code=1)
            path.write_text(json.dumps([check]), encoding='utf-8')
            safe = repository.browser_result(path, 1)
            self.assertTrue(safe['metrics']['readiness_failed'])
            self.assertEqual(safe['metrics']['readiness_status'], 307)
            self.assertTrue(safe['metrics']['readiness_error'])
            self.assertTrue(safe['metrics']['timed_out'])
            self.assertEqual(safe['metrics']['first_error_code'], 1)

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
            (root / 'sites').mkdir()
            (root / 'sites/enztronic-public-env.json').write_text(json.dumps({'NEXT_PUBLIC_SANITY_PROJECT_ID': 'fixture', 'NEXT_PUBLIC_SANITY_DATASET': 'production'}), encoding='utf-8')
            def checked(command, **kwargs):
                self.assertNotIn('DISCORD_WEBHOOK_URL', kwargs['env'])
                self.assertEqual(kwargs['env']['HOME'], str(root / 'cache/anonymous-home'))
                self.assertEqual(kwargs['env']['GIT_CONFIG_GLOBAL'], '/dev/null')
                if 'clone' in command:
                    self.assertEqual(command[-2], 'https://github.com/enztun/enztronic.com.git')
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
                    self.assertNotIn('--gitleaks-ignore-path', command)
                    self.assertTrue(Path(kwargs['cwd']).name.startswith('tools-enztronic-'))
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
                document = repository.audit_repository('enztronic')
            scan = document['checks'][0]
            self.assertEqual(scan['metrics']['findings'], 2)
            self.assertEqual(scan['status'], 'fail')
            report = json.loads((root / 'state/enztronic/secret-locations.json').read_text(encoding='utf-8'))
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
        with mock.patch.object(sys, 'argv', ['repository_check.py']), \
            mock.patch.object(repository, 'audit_repository', side_effect=repository.PipelineBusyError()), \
            contextlib.redirect_stdout(stream):
            self.assertEqual(repository.main(), 1)
        check = json.loads(stream.getvalue())['checks'][0]
        self.assertEqual((check['category'], check['status']), ('setup', 'blocked'))
        self.assertIn('audit busy', check['name'])

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
