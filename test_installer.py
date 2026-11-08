"""Offline end-to-end checks for the public installer."""
import os
import pty
import select
import time
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class InstallerTests(unittest.TestCase):
    def run_installer(self, args=(), existing=True, compatible=False, fail=False, available=True, managed=False, broken=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / 'bin'
            binaries.mkdir()
            app = root / 'venvs/agentsquid/bin'
            if existing:
                app.mkdir(parents=True)
            log = root / 'calls'
            env = {**os.environ, 'HOME': directory, 'PATH': f'{binaries}:/usr/bin:/bin',
                   'TEST_ROOT': directory, 'EXISTING': str(int(existing)),
                   'COMPATIBLE': str(int(compatible)), 'BROKEN': str(int(broken)), 'FAIL_MIGRATION': str(int(fail))}
            def executable(path, body):
                path.write_text('#!/bin/bash\n' + body)
                path.chmod(0o755)
            executable(binaries / 'python3.13', '''
if [[ "$1" == --version ]]; then echo 'Python 3.13.9'; fi
exit 0
''')
            if not available:
                for name in ('python3.14', 'python3.13', 'python3.12', 'python3.11',
                             'python3.10', 'python3', 'python'):
                    executable(binaries / name, 'echo "Python 3.9.6"; exit 1\n')
            if managed:
                managed_python = root / 'managed-python'
                executable(managed_python, 'exit 0\n')
                executable(binaries / 'uv',
                           'echo "uv $*" >> "$TEST_ROOT/calls"\n'
                           '[[ "$1 $2" == "python find" ]] || exit 1\n'
                           'echo "$TEST_ROOT/managed-python"\n')
            if existing:
                executable(app / 'python', '[[ "$COMPATIBLE" == 1 ]]\n')
            executable(binaries / 'pipx', '''
echo "$*" >> "$TEST_ROOT/calls"
case "$1" in
  environment) echo "$TEST_ROOT/venvs";;
  runpip) if [[ "$EXISTING" == 1 && "$BROKEN" != 1 ]]; then echo 'Version: 0.1.5'; else exit 1; fi;;
  reinstall)
    # Model the widely deployed pipx CLI, which rejects --pip-args here.
    [[ "$*" != *--pip-args* ]] || exit 2
    [[ "$FAIL_MIGRATION" != 1 ]];;
  *) exit 0;;
esac
''')
            executable(binaries / 'agentsquid', 'echo "cli $*" >> "$TEST_ROOT/calls"\n')
            result = subprocess.run(['bash', str(ROOT / 'install.sh'), *args], env=env,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
                                    start_new_session=True)
            return result, log.read_text(), str(binaries / 'python3.13')

    def test_old_python_migrates_before_prerelease_upgrade(self):
        result, calls, python = self.run_installer(['--pre'])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f'reinstall agentsquid --python {python}\n', calls)
        self.assertIn('upgrade agentsquid --pip-args=--pre', calls)
        self.assertLess(calls.index('reinstall '), calls.index('upgrade '))
        self.assertIn('cli restart', calls)

    def test_compatible_environment_does_not_migrate(self):
        result, calls, _ = self.run_installer(['--pre'], compatible=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('reinstall ', calls)
        self.assertIn('upgrade agentsquid --pip-args=--pre', calls)

    def test_fresh_install_passes_python_and_prerelease(self):
        result, calls, python = self.run_installer(['--pre'], existing=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'install --python {python} agentsquid --pip-args=--pre', calls)
        self.assertNotIn('reinstall ', calls)
        self.assertIn('cli start', calls)

    def test_exact_version_migrates_then_installs_requested_version(self):
        result, calls, python = self.run_installer(['--version', '0.1.6rc29'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'install --force --python {python} agentsquid==0.1.6rc29', calls)
        self.assertLess(calls.index('reinstall '), calls.index('install --force'))

    def test_migration_failure_does_not_continue_or_restart(self):
        result, calls, _ = self.run_installer(['--pre'], fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('upgrade ', calls)
        self.assertNotIn('cli ', calls)
        self.assertIn('Could not rebuild', result.stdout)

    def test_stable_upgrade_does_not_enable_prereleases(self):
        result, calls, _ = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('upgrade agentsquid\n', calls)
        self.assertNotIn('--pre', calls)

    def test_no_python_noninteractive_prints_recovery_without_installing(self):
        result, calls, _ = self.run_installer(['--pre'], available=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('python install 3.13', result.stdout)
        self.assertIn('bash /tmp/agentsquid-install.sh --pre', result.stdout)
        self.assertNotIn('reinstall ', calls)
        self.assertNotIn('upgrade ', calls)
        self.assertNotIn('cli ', calls)

    def test_uv_managed_python_is_found_without_downloads(self):
        result, calls, _ = self.run_installer(['--pre'], available=False, managed=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('uv python find --system --no-python-downloads >=3.10', calls)
        self.assertNotIn('uv python install', calls)
        self.assertIn('/managed-python\n', calls)
        self.assertIn('upgrade agentsquid --pip-args=--pre', calls)

    def test_broken_environment_migrates_even_without_package_version(self):
        result, calls, python = self.run_installer(['--pre'], broken=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f'reinstall agentsquid --python {python}\n', calls)
        self.assertIn('upgrade agentsquid --pip-args=--pre', calls)
        self.assertIn('cli restart', calls)


class InstallerConfirmationTests(unittest.TestCase):
    def test_piped_script_reads_confirmation_from_terminal(self):
        source = (ROOT / 'install.sh').read_text()
        confirm = source[source.index('confirm() ('):source.index('export PATH=')]
        for answer, expected in [('y', 'accepted'), ('', 'accepted'), ('n', 'declined')]:
            with self.subTest(answer=answer):
                pid, terminal = pty.fork()
                if pid == 0:
                    script = confirm + '\nif confirm "Install prerequisites?"; then echo accepted; else echo declined; fi\n'
                    result = subprocess.run(['bash', '-s'], input=script, text=True)
                    os._exit(result.returncode)
                output = b''
                sent = False
                try:
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        if not select.select([terminal], [], [], 0.1)[0]:
                            continue
                        try:
                            chunk = os.read(terminal, 4096)
                        except OSError:
                            break
                        if not chunk:
                            break
                        output += chunk
                        if b'[Y/n]' in output and not sent:
                            os.write(terminal, (answer + '\n').encode())
                            sent = True
                        if expected.encode() in output:
                            break
                    self.assertTrue(sent, output)
                    self.assertIn(expected.encode(), output)
                finally:
                    os.close(terminal)
                    # Ensure a failed prompt cannot leave a waiting child behind.
                    try:
                        os.kill(pid, 9)
                    except ProcessLookupError:
                        pass
                    os.waitpid(pid, 0)
