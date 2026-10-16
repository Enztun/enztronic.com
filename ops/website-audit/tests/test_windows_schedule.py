"""Windows task-definition fixtures only; Scheduler cmdlets are always mocked."""
import base64
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET


SCRIPT = Path(__file__).resolve().parents[1] / 'install_windows.ps1'
NS = {'t': 'http://schemas.microsoft.com/windows/2004/02/mit/task'}
POWERSHELL = shutil.which('powershell.exe') if os.name == 'nt' else None


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def split_windows_arguments(arguments):
    shell = ctypes.WinDLL('shell32', use_last_error=True)
    shell.CommandLineToArgvW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(ctypes.c_wchar_p)
    argc = ctypes.c_int()
    argv = shell.CommandLineToArgvW('fixture.exe ' + arguments, ctypes.byref(argc))
    if not argv:
        raise OSError('Could not parse fixture arguments')
    try:
        return [argv[n] for n in range(1, argc.value)]
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(ctypes.cast(argv, ctypes.c_void_p))


@unittest.skipUnless(POWERSHELL, 'Windows PowerShell is required for Scheduler fixtures')
class WindowsScheduleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.root = base / "private & audit's data"
        self.root.mkdir()
        (self.root / 'scheduled_run.py').write_text('# reviewed fixture\n', encoding='utf-8')
        self.python = base / 'python install' / 'python.exe'
        self.python.parent.mkdir()
        self.python.touch()
        self.pythonw = self.python.with_name('pythonw.exe')
        self.pythonw.touch()

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, activate=False, root=None):
        return '& ' + ps_quote(SCRIPT) + ' -Root ' + ps_quote(root or self.root) + ' -PythonPath ' + ps_quote(self.python) + (' -ActivateSchedule' if activate else '')

    def powershell(self, body):
        # No real Task Scheduler operation can escape these fixture functions.
        fixture = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$global:FixtureStoredXml = $null
$global:FixtureRegistrations = 0
$global:FixtureGets = 0
$global:FixtureExports = 0
function Get-TimeZone { [pscustomobject]@{Id='SE Asia Standard Time'} }
function Get-ScheduledTask {
    [CmdletBinding()]param([string]$TaskPath)
    $global:FixtureGets++
    [pscustomobject]@{TaskName='Unrelated existing task'}
    if ($global:FixtureStoredXml) { [pscustomobject]@{TaskName='Enztronic Website Audit'} }
}
function Register-ScheduledTask {
    [CmdletBinding()]param([string]$TaskName,[string]$TaskPath,[string]$Xml,[switch]$Force)
    if ($TaskName -ne 'Enztronic Website Audit' -or $TaskPath -ne '\') { throw 'Foreign task mutation attempted' }
    if ($global:FixtureStoredXml -and -not $Force) { throw 'Existing task requires guarded replacement' }
    $global:FixtureRegistrations++
    $global:FixtureStoredXml=$Xml
    [pscustomobject]@{TaskName=$TaskName}
}
function Export-ScheduledTask {
    [CmdletBinding()]param([string]$TaskName,[string]$TaskPath)
    $global:FixtureExports++
    if ($TaskName -ne 'Enztronic Website Audit' -or $TaskPath -ne '\') { throw 'Foreign task export attempted' }
    $global:FixtureStoredXml
}
'''
        encoded = base64.b64encode((fixture + '\n' + body).encode('utf-16-le')).decode('ascii')
        completed = subprocess.run([POWERSHELL, '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                                   capture_output=True, timeout=30,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(completed.returncode, 0, completed.stderr.decode('utf-8', errors='replace'))
        return json.loads(completed.stdout.decode('utf-8-sig'))

    def test_default_plan_has_least_privilege_and_never_calls_scheduler(self):
        result = self.powershell('$plan = ' + self.command() + ' | ConvertFrom-Json\n'
                                 '[ordered]@{plan=$plan;gets=$global:FixtureGets;registered=$global:FixtureRegistrations} | ConvertTo-Json -Depth 6')
        self.assertEqual((result['gets'], result['registered']), (0, 0))
        plan = result['plan']
        self.assertFalse(plan['activated'])
        tree = ET.fromstring(plan['xml'])
        values = {
            'Principals/Principal/LogonType': 'InteractiveToken', 'Principals/Principal/RunLevel': 'LeastPrivilege',
            'Settings/MultipleInstancesPolicy': 'IgnoreNew', 'Settings/StartWhenAvailable': 'true',
            'Settings/WakeToRun': 'true', 'Settings/DisallowStartIfOnBatteries': 'false',
            'Settings/StopIfGoingOnBatteries': 'false', 'Settings/ExecutionTimeLimit': 'PT2H',
            'Triggers/CalendarTrigger/ScheduleByDay/DaysInterval': '1', 'Triggers/LogonTrigger/Delay': 'PT2M',
            'Actions/Exec/Command': str(self.pythonw), 'Actions/Exec/WorkingDirectory': str(self.root),
        }
        for path, expected in values.items():
            xpath = '/'.join('t:' + part for part in path.split('/'))
            self.assertEqual(tree.findtext(xpath, namespaces=NS), expected, path)
        sid = tree.findtext('t:Principals/t:Principal/t:UserId', namespaces=NS)
        self.assertEqual(tree.findtext('t:Triggers/t:LogonTrigger/t:UserId', namespaces=NS), sid)
        self.assertTrue(sid.startswith('S-1-'))
        self.assertRegex(tree.findtext('t:Triggers/t:CalendarTrigger/t:StartBoundary', namespaces=NS), r'T02:30:00\+07:00$')
        self.assertIsNone(tree.find('t:Settings/t:RestartOnFailure', NS))
        self.assertIsNone(tree.find('t:Triggers/t:BootTrigger', NS))
        self.assertIn('signed-out', plan['limits'])

    def test_task_arguments_roundtrip_spaces_apostrophes_and_xml_characters(self):
        plan = self.powershell(self.command())
        self.assertEqual(split_windows_arguments(plan['arguments']),
                         [str(self.root / 'scheduled_run.py'), '--root', str(self.root), '--mode', 'due'])

    def test_windows_argument_encoder_handles_quotes_and_trailing_backslashes(self):
        values = ['', 'with spaces', 'embedded"quote', 'trailing\\', 'space and slash\\', 'slash\\"quote', '&`$()']
        payload = base64.b64encode(json.dumps(values).encode('utf-8')).decode('ascii')
        body = '$null = . ' + ps_quote(SCRIPT) + ' -Root ' + ps_quote(self.root) + ' -PythonPath ' + ps_quote(self.python) + '\n'
        body += "$values = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "')) | ConvertFrom-Json\n"
        body += '(@($values | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " ") | ConvertTo-Json'
        self.assertEqual(split_windows_arguments(self.powershell(body)), values)

    def test_activation_reinstall_updates_only_the_owned_task_and_verifies_it(self):
        output = self.powershell('$first = ' + self.command(True) + ' | ConvertFrom-Json\n'
                                 '$second = ' + self.command(True) + ' | ConvertFrom-Json\n'
                                 '[ordered]@{first=$first.activated;second=$second.activated;registered=$global:FixtureRegistrations;exports=$global:FixtureExports;xml=$global:FixtureStoredXml} | ConvertTo-Json -Depth 4')
        self.assertTrue(output['first'] and output['second'])
        self.assertEqual(output['registered'], 2)
        self.assertEqual(output['exports'], 3)  # Two post-register reads plus the existing-task ownership read.
        self.assertIn('Enztronic.website-audit.windows.v1', output['xml'])

    def test_foreign_task_is_never_overwritten(self):
        output = self.powershell('$plan = ' + self.command() + ' | ConvertFrom-Json\n'
                                 "$global:FixtureStoredXml=$plan.xml.Replace('Enztronic.website-audit.windows.v1','Unrelated.owner')\n"
                                 '$original=$global:FixtureStoredXml\n$refused=$false\n'
                                 'try { $null = ' + self.command(True) + ' } catch { $refused=$true }\n'
                                 '[ordered]@{refused=$refused;registered=$global:FixtureRegistrations;unchanged=($original -ceq $global:FixtureStoredXml)} | ConvertTo-Json')
        self.assertEqual(output, {'refused': True, 'registered': 0, 'unchanged': True})

    def test_post_registration_mismatch_is_not_reported_as_success(self):
        output = self.powershell(r'''
function Export-ScheduledTask {
    [CmdletBinding()]param([string]$TaskName,[string]$TaskPath)
    $global:FixtureStoredXml.Replace('<WakeToRun>true</WakeToRun>','<WakeToRun>false</WakeToRun>')
}
$refused=$false
try { $null = ''' + self.command(True) + r''' } catch { $refused=$true }
[ordered]@{refused=$refused;registered=$global:FixtureRegistrations} | ConvertTo-Json
''')
        self.assertEqual(output, {'refused': True, 'registered': 1})

    def test_missing_runtime_or_pythonw_is_refused_before_scheduler_calls(self):
        (self.root / 'scheduled_run.py').unlink()
        output = self.powershell('$refused=$false\ntry { $null = ' + self.command(True) + ' } catch { $refused=$true }\n'
                                 '[ordered]@{refused=$refused;gets=$global:FixtureGets;registered=$global:FixtureRegistrations} | ConvertTo-Json')
        self.assertEqual(output, {'refused': True, 'gets': 0, 'registered': 0})
        (self.root / 'scheduled_run.py').touch()
        self.pythonw.unlink()
        output = self.powershell('$refused=$false\ntry { $null = ' + self.command(True) + ' } catch { $refused=$true }\n'
                                 '[ordered]@{refused=$refused;gets=$global:FixtureGets;registered=$global:FixtureRegistrations} | ConvertTo-Json')
        self.assertEqual(output, {'refused': True, 'gets': 0, 'registered': 0})

    def test_non_jakarta_timezone_is_refused_without_changing_it(self):
        output = self.powershell("function Get-TimeZone { [pscustomobject]@{Id='UTC'} }\n"
                                 '$refused=$false\ntry { $null = ' + self.command(True) + ' } catch { $refused=$true }\n'
                                 '[ordered]@{refused=$refused;gets=$global:FixtureGets;registered=$global:FixtureRegistrations} | ConvertTo-Json')
        self.assertEqual(output, {'refused': True, 'gets': 0, 'registered': 0})


if __name__ == '__main__':
    unittest.main()
