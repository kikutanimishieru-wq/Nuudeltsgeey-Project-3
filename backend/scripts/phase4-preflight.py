#!/usr/bin/env python3
"""Read-only validation preflight. Secrets enter through hidden terminal prompts only."""
import getpass
import warnings
import re
import signal
import time
import fcntl
import stat
from contextlib import contextmanager
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit, parse_qsl, unquote, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

PROJECT = 'rough-snow-56584532'
BRANCH = 'br-withered-mode-b528hnhk'
ENDPOINT = 'ep-delicate-poetry-b5bbwllj'
HOST = ENDPOINT + '.c-7.us-east-2.aws.neon.tech'
EXPIRES_AT = '2026-10-26T09:48:09Z'
REJECTED_BRANCHES = frozenset({'br-wispy-mountain-b5nku4bf', 'br-plain-glitter-b5cadax8', 'br-morning-queen-b5u7j4qz'})
BACKEND = Path(__file__).resolve().parents[1]


def require(condition):
    if not condition:
        raise ValueError('guard rejected input')


TIMEOUT_OPTIONS = '-c statement_timeout=60000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000'
ENGINE_HASH = 'c2990dca591cba766e3b7ef5d9e8a84796e47ab7'


PREFLIGHT_POLICY = 'PHASE4_STRICT_TLS_V4_EXACT_TARGET'
URL_QUERY_ALLOWLIST = frozenset({
    'sslmode', 'sslaccept', 'channel_binding', 'schema',
    'connect_timeout', 'socket_timeout', 'options',
})


class DiagnosticError(ValueError):
    """Only fixed category codes belong here; never caller-supplied text."""
    def __init__(self, category):
        self.category = category
        super().__init__(category)


class UnsupportedParameterError(DiagnosticError):
    def __init__(self, names):
        # Never retain values. Restrict printable names to short terminal-safe tokens.
        self.parameter_names = tuple(sorted({
            name if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.;-]{0,63}', name)
            else '<nonstandard-name-redacted>' for name in names
        }))
        super().__init__('URL_UNSUPPORTED_PARAMETER')


def check(condition, category):
    if not condition:
        raise DiagnosticError(category)


def hidden_input(prompt):
    try:
        check(sys.stdin.isatty(), 'INPUT_NOT_TERMINAL')
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            value = getpass.getpass(prompt)
        check(bool(value.strip()), 'INPUT_EMPTY')
        check(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'INPUT_CONTROL_CHARACTER')
        return value
    except DiagnosticError:
        raise
    except getpass.GetPassWarning:
        raise DiagnosticError('INPUT_ECHO_UNAVAILABLE') from None
    except KeyboardInterrupt:
        raise DiagnosticError('INPUT_CANCELLED') from None
    except Exception:
        raise DiagnosticError('INPUT_FAILED') from None


def validate_url(value):
    try:
        check(isinstance(value, str) and bool(value), 'URL_EMPTY')
        check(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'URL_CONTROL_CHARACTER')
        check(not any(c.isspace() for c in value), 'URL_WHITESPACE')
        check(all(33 <= ord(c) <= 126 for c in value), 'URL_NON_ASCII')
        check('\\' not in value, 'URL_BACKSLASH')
        check(not value.startswith(('"', "'", 'psql ', 'DATABASE_URL=', 'PHASE4_VALIDATION_DATABASE_URL=')), 'URL_WRAPPED_TEXT')
        check(not re.search(r'%(?![0-9A-Fa-f]{2})', value), 'URL_PERCENT_ENCODING')
        try:
            decoded = unquote(value, errors='strict')
        except UnicodeError:
            raise DiagnosticError('URL_PERCENT_ENCODING') from None
        check(not any(ord(c) < 32 or ord(c) == 127 for c in decoded), 'URL_ENCODED_CONTROL')
        try:
            u = urlsplit(value)
            port = u.port
        except ValueError:
            raise DiagnosticError('URL_SYNTAX') from None
        check(u.scheme in ('postgres', 'postgresql'), 'URL_SCHEME')
        check(u.hostname == HOST and port in (None, 5432), 'URL_TARGET_HOST')
        check(u.username == 'neondb_owner', 'URL_ROLE')
        check(bool(u.password), 'URL_PASSWORD_MISSING')
        authority = u.netloc.rsplit('@', 1)
        check(len(authority) == 2 and authority[0].count('@') == 0, 'URL_AUTHORITY')
        check(authority[1] in (HOST, HOST + ':5432'), 'URL_AUTHORITY')
        check(u.path == '/neondb', 'URL_DATABASE')
        check(not u.fragment and '#' not in value, 'URL_FRAGMENT')
        check(not value.endswith('?'), 'URL_QUERY_SYNTAX')
        try:
            pairs = parse_qsl(u.query, keep_blank_values=True, strict_parsing=True, errors='strict')
        except (ValueError, UnicodeError):
            raise DiagnosticError('URL_QUERY_SYNTAX') from None
        check(len(dict(pairs)) == len(pairs), 'URL_DUPLICATE_PARAMETER')
        unsupported = [key for key, _ in pairs if key not in URL_QUERY_ALLOWLIST]
        if unsupported:
            raise UnsupportedParameterError(unsupported)
        q = dict(pairs)
        check(q.get('sslmode') == 'require', 'TLS_MODE_REQUIRED')
        check(q.get('sslaccept') == 'strict', 'TLS_STRICT_REQUIRED')
        check(q.get('schema', 'public') == 'public', 'URL_SCHEMA')
        check(q.get('channel_binding', 'require') == 'require', 'URL_CHANNEL_BINDING')
        for key, upper in [('connect_timeout', 10), ('socket_timeout', 90)]:
            if key in q:
                check(bool(re.fullmatch(r'[1-9][0-9]*', q[key])) and int(q[key]) <= upper, 'URL_TIMEOUT_OPTION')
        check(q.get('options', TIMEOUT_OPTIONS) == TIMEOUT_OPTIONS, 'URL_STARTUP_OPTIONS')
        return value
    except DiagnosticError:
        raise
    except Exception:
        raise DiagnosticError('URL_INVALID') from None


def bounded_url(value):
    value = validate_url(value)
    u = urlsplit(value)
    q = dict(parse_qsl(u.query))
    q.setdefault('connect_timeout', '10')
    q.setdefault('socket_timeout', '90')
    q['options'] = TIMEOUT_OPTIONS
    # This final URL is itself validated and then passed unchanged to every Prisma child.
    return validate_url(u._replace(query=urlencode(q)).geturl())


def child_environment(url):
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT') if k in os.environ}
    env['PHASE4_VALIDATION_DATABASE_URL'] = validate_url(url)
    return env


def group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def stop_group(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        for _ in range(20):
            if not group_alive(process.pid):
                return
            time.sleep(0.05)
    require(not group_alive(process.pid))


class ProcessFailure(ValueError):
    def __init__(self, category):
        self.category = category
        super().__init__(category + ("; cleanup unconfirmed" if category == "PROCESS_CLEANUP_UNCONFIRMED" else "") + "; server outcome unknown.")


def run_group(argv, cwd, env, decode=False, timeout=240):
    process = None
    try:
        require(os.name == 'posix')
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, start_new_session=True)
        stdout, _ = process.communicate(timeout=timeout)
        if group_alive(process.pid):
            stop_group(process)
            raise ValueError()
        require(process.returncode == 0)
        return json.loads(stdout) if decode else None
    except (Exception, KeyboardInterrupt) as error:
        category = "PROCESS_INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "PROCESS_TIMEOUT" if isinstance(error, subprocess.TimeoutExpired) else "PROCESS_FAILED"
        if process is not None:
            try:
                stop_group(process)
            except Exception:
                raise ProcessFailure('PROCESS_CLEANUP_UNCONFIRMED') from None
        raise ProcessFailure(category) from None


@contextmanager
def execution_lock():
    # Keep the inode after release; unlinking would allow competing locks on different inodes.
    path = Path('/private/tmp' if Path('/private/tmp').is_dir() else '/tmp') / ('nuudeltsgeey-phase4-' + str(os.getuid()) + '.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def verify_engine(node):
    script = "const p=require('path');const b=p.dirname(require.resolve('prisma/package.json'));console.log(JSON.stringify({cli:require('prisma/package.json').version,client:require('@prisma/client').Prisma.prismaVersion,engine:require(require.resolve('@prisma/engines-version',{paths:[b]})).enginesVersion}));"
    env = {k: os.environ[k] for k in ('PATH','HOME','TMPDIR') if k in os.environ}
    value = run_group([node, '-e', script], BACKEND, env, decode=True, timeout=20)
    require(value['cli'] == '6.19.3' and value['client']['client'] == '6.19.3')
    require(value['engine'] == ENGINE_HASH and value['client']['engine'] == ENGINE_HASH)


def validate_metadata(branch, endpoint, now):
    require(branch.get('id') not in REJECTED_BRANCHES)
    require(branch.get('id') == BRANCH and branch.get('project_id') == PROJECT)
    require(branch.get('name') == 'phase4-validation-v4' and branch.get('current_state') == 'ready')
    require(all(branch.get(k) is False for k in ('primary', 'default', 'protected')))
    require(not branch.get('parent_id'))
    require(branch.get('init_source') in ('parent-schema', 'schema-only'))
    require(branch.get('expires_at') == EXPIRES_AT)
    expires = datetime.fromisoformat(branch['expires_at'].replace('Z', '+00:00'))
    require((expires - now).total_seconds() > 3600)
    require(endpoint.get('id') == ENDPOINT and endpoint.get('branch_id') == BRANCH)
    require(endpoint.get('project_id') == PROJECT and endpoint.get('host') == HOST)
    require(endpoint.get('disabled') is False)
    return expires


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    require(len(sys.argv) == 1 and sys.stdin.isatty())
    require(json.loads((BACKEND / 'node_modules/prisma/package.json').read_text())['version'] == '6.19.3')
    node = shutil.which('node')
    require(node is not None)
    verify_engine(node)
    url = bounded_url(hidden_input('PHASE4_VALIDATION_DATABASE_URL (hidden): '))
    token = hidden_input('Neon API key for live read-only identity checks (hidden): ')
    require(bool(token))
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def read(path):
        req = Request('https://console.neon.tech/api/v2/projects/' + PROJECT + path,
                      headers={'Authorization': 'Bearer ' + token}, method='GET')
        with opener.open(req, timeout=20) as response:
            return json.load(response)

    branch = read('/branches/' + BRANCH)['branch']
    endpoint = read('/endpoints/' + ENDPOINT)['endpoint']
    expires = validate_metadata(branch, endpoint, datetime.now(timezone.utc))
    # Build a minimal child environment; never inherit application database routing.
    env = child_environment(url)
    script = r'''
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({datasources:{db:{url:process.env.PHASE4_VALIDATION_DATABASE_URL}},log:[]});
(async()=>{
  const result=await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15s'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    const identity=await tx.$queryRawUnsafe('SELECT current_database() AS database, current_user AS role');
    if(identity[0].database!=='neondb'||identity[0].role!=='neondb_owner') throw Error();
    const ledger=await tx.$queryRawUnsafe('SELECT migration_name FROM public."_prisma_migrations"');
    if(ledger.length) throw Error();
    // Foundation baseline only: 26 tables and empty ledger; later Phase 4 triggers are not required.
    const tables=await tx.$queryRawUnsafe("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations'");
    if(tables[0].count!==26) throw Error();
    return {identity:identity[0],applicationTables:26,migrationRecords:0};
  },{timeout:25000});
  console.log(JSON.stringify(result));
})().catch(()=>{console.error('BLOCKED: database preflight failed; details suppressed.');process.exitCode=1;}).finally(()=>db.$disconnect());
'''
    verified = run_group([node, '-e', script], BACKEND, env, decode=True, timeout=45)
    print(json.dumps({'status': 'PASS', 'project': PROJECT, 'branch': BRANCH,
                      'endpoint': ENDPOINT, 'expires_at': expires.isoformat(),
                      'database': verified['identity']['database'], 'role': verified['identity']['role'],
                      'application_tables': verified['applicationTables'],
                      'migration_records': verified['migrationRecords'],
                      'preflight_policy': PREFLIGHT_POLICY,
                      'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                      'completed_at': datetime.now(timezone.utc).isoformat(),
                      'prisma_version': '6.19.3',
                      'strict_tls_prisma_read_only_connection': True}))


def cli():
    try:
        main()
        return 0
    except DiagnosticError as error:
        names = ('; unsupported parameter names: ' + ', '.join(error.parameter_names)
                 if isinstance(error, UnsupportedParameterError) else '')
        print('BLOCKED: ' + error.category + names + '; credentials and parameter values suppressed.', file=sys.stderr)
    except (Exception, KeyboardInterrupt):
        print('BLOCKED: PREFLIGHT_FAILED; credentials and diagnostics suppressed.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(cli())
