#!/usr/bin/env python3
"""Offline only. No PostgreSQL driver, network, subprocess or credential loading.

The pinned SQL supplies LIMITED evidence, not a complete PostgreSQL reference.
No CLI option or capture claim can promote that evidence to a complete reference.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

import phase4_foundation_queries as queries

FOUNDATION = Path(__file__).resolve().parents[1] / 'prisma/migrations/20261012003031_foundation/migration.sql'
PIN = 'a8ae6fd95d38a2ea0192d471485e2fdf6abcb54f683d8ad0025bfd68088d73bc'
QUERY_PIN = '4c2c670f90eeb440b9ebde7f4942cf2dee4dea5c2ca8921b5db3145e7f86652d'
REFERENCE_STATUS = 'REFERENCE INCOMPLETE — LIVE COMPARISON BLOCKED'
MAX_BYTES = 8 * 1024 * 1024
PROJECT = 'rough-snow-56584532'
PRODUCTION = 'br-wispy-mountain-b5nku4bf'

# Capture v1 is a semantic adapter contract, NOT the raw SQL output format.
# A future reviewed adapter must map all Q1-Q8 results into these sections.
# Required keys stop omitted attributes from being mistaken for matches.
FIELDS = {
    'schemas': {'owner', 'privileges'},
    'tables': {'kind', 'persistence', 'owner', 'rls', 'force_rls', 'partition', 'replident', 'options'},
    'columns': {'ordinal', 'type', 'nullable', 'default', 'identity', 'generated', 'collation', 'dropped', 'storage', 'compression', 'options'},
    'constraints': {'kind', 'definition', 'validated', 'deferrable', 'deferred', 'local', 'inherited', 'no_inherit'},
    'indexes': {'definition', 'valid', 'ready', 'live', 'unique', 'primary', 'immediate', 'nulls_not_distinct', 'replica_identity', 'options'},
    'types': {'kind', 'definition', 'owner'},
    'enums': {'labels'},
    'sequences': {'type', 'start', 'increment', 'min', 'max', 'cache', 'cycle', 'owner', 'owned_by', 'privileges'},
    'routines': {'kind', 'definition', 'owner', 'security_definer', 'volatility', 'leakproof', 'config', 'privileges'},
    'triggers': {'internal', 'constraint_identity', 'constraint_kind', 'enabled', 'definition'},
    'views': {'kind', 'definition', 'owner', 'options'},
    'policies': {'permissive', 'roles', 'command', 'using', 'check'},
    'privileges': {'grantor', 'grantee', 'privilege', 'grantable'},
    'default_privileges': {'definition'},
    'extensions': {'version', 'schema'},
    'event_triggers': {'event', 'enabled', 'tags', 'owner', 'routine'},
    'rules': {'definition'},
    'unexpected': {'kind', 'definition'},
}
BOOL_FIELDS = {'rls', 'force_rls', 'nullable', 'dropped', 'validated', 'deferrable',
               'deferred', 'local', 'no_inherit', 'valid', 'ready', 'live', 'unique',
               'primary', 'immediate', 'nulls_not_distinct', 'replica_identity',
               'cycle', 'security_definer', 'leakproof', 'internal', 'grantable'}


def require(condition):
    if not condition:
        raise ValueError('INVALID_OFFLINE_INPUT')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def read_local(path):
    """Reject URLs, symlinks, directories, devices, FIFOs and oversized files."""
    require('://' not in str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_BYTES)
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(MAX_BYTES + 1)
        require(len(data) <= MAX_BYTES)
        return data
    finally:
        os.close(fd)


def foundation_reference(path=FOUNDATION):
    raw = read_local(path)
    require(hashlib.sha256(raw).hexdigest() == PIN)
    sql = raw.decode('utf-8')
    # Evidence extraction ONLY from the EXACT pinned bytes. This is deliberately
    # not a PostgreSQL parser and cannot establish default/ACL/catalog semantics.
    blocks = re.findall(r'CREATE TABLE "([^"]+)" \((.*?)\n\);', sql, re.S)
    enums = re.findall(r'CREATE TYPE "([^"]+)" AS ENUM \((.*?)\);', sql)
    labels = {name: re.findall(r"'([^']*)'", body) for name, body in enums}
    counts = {
        'tables': len(blocks),
        'columns': sum(len(re.findall(r'^    "', body, re.M)) for _, body in blocks),
        'primary_keys': len(re.findall(r'PRIMARY KEY', sql)),
        'foreign_keys': len(re.findall(r'FOREIGN KEY', sql)),
        'indexes': len(re.findall(r'CREATE (?:UNIQUE )?INDEX', sql)) + len(blocks),
        'enum_types': len(enums), 'enum_labels': sum(map(len, labels.values())),
    }
    require(counts == dict(tables=26, columns=192, primary_keys=26, foreign_keys=48,
                           indexes=52, enum_types=13, enum_labels=67))
    require(not re.search(r'CREATE (?:SEQUENCE|FUNCTION|TRIGGER)|GENERATED|IDENTITY', sql))
    return {'sha256': PIN, 'complete': False, 'status': REFERENCE_STATUS,
            'counts': counts, 'tables': sorted(name for name, _ in blocks), 'enums': labels}


def validate_queries(query_map=None, transaction=None, finish=None):
    query_map = queries.QUERIES if query_map is None else query_map
    transaction = queries.TRANSACTION if transaction is None else transaction
    finish = queries.FINISH if finish is None else finish
    value = {'queries': query_map, 'transaction': transaction, 'finish': finish}
    require(hashlib.sha256(canonical(value).encode()).hexdigest() == QUERY_PIN)
    for ident, sql in query_map.items():
        require(sql.startswith('SELECT ') and ';' not in sql and '--' not in sql and '/*' not in sql)
        require(not re.search(r'\b(INSERT|UPDATE|DELETE|TRUNCATE|COPY|CALL|DO|CREATE|ALTER|DROP|INTO|FOR UPDATE)\b', sql, re.I))
        if ident == 'Q8_ledger_count':
            require(sql == 'SELECT count(*) AS migration_record_count FROM public."_prisma_migrations"')
        else:
            require('public.' not in sql and 'information_schema.' not in sql)
    return {'status': 'STATIC ALLOWLIST PASS', 'queries': len(query_map),
            'query_plan_sha256': QUERY_PIN, 'runtime_validated': False,
            'supported_server_version': 'PostgreSQL 18 only; unverified at runtime',
            'live_collection': 'DISABLED'}


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def load_capture(path):
    return json.loads(read_local(path), object_pairs_hook=no_duplicates,
                      parse_constant=lambda _value: require(False))


def bounded_json(value, depth=0):
    require(depth <= 16)
    if value is None or type(value) in (bool, int):
        return
    if type(value) is str:
        require(len(value) <= 262144 and '\x00' not in value)
    elif type(value) is list:
        require(len(value) <= 10000)
        for item in value:
            bounded_json(item, depth + 1)
    elif type(value) is dict:
        require(len(value) <= 100)
        for key, item in value.items():
            require(type(key) is str)
            bounded_json(item, depth + 1)
    else:
        require(False)


def validate_catalog(catalog):
    bounded_json(catalog)
    require(type(catalog) is dict and set(catalog) == set(FIELDS))
    for section, rows in catalog.items():
        require(type(rows) is list)
        identities = set()
        for row in rows:
            require(type(row) is dict and set(row) == {'identity', 'properties'})
            identity, props = row['identity'], row['properties']
            require(type(identity) is list and 2 <= len(identity) <= 8)
            require(all(type(s) is str and s for s in identity))
            # Semantic identities, never raw PostgreSQL OIDs.
            require(type(props) is dict and set(props) == FIELDS[section])
            for key, value in props.items():
                if key in BOOL_FIELDS:
                    require(type(value) is bool)
            if section == 'columns':
                require(type(props['ordinal']) is int and props['ordinal'] > 0)
            if section == 'enums':
                require(type(props['labels']) is list and props['labels'])
                require(all(type(v) is str for v in props['labels']))
                require(len(set(props['labels'])) == len(props['labels']))
            ident = tuple(identity)
            require(ident not in identities)
            identities.add(ident)


def validate_capture(capture):
    bounded_json(capture)
    require(type(capture) is dict and set(capture) == {
        'format_version', 'foundation_sha256', 'query_plan_sha256', 'context',
        'coverage', 'catalog', 'ledger', 'diagnostic_oids'})
    require(type(capture['format_version']) is int and capture['format_version'] == 1)
    require(capture['foundation_sha256'] == PIN and capture['query_plan_sha256'] == QUERY_PIN)
    context = capture['context']
    require(type(context) is dict and set(context) == {
        'project', 'branch', 'branch_name', 'endpoint', 'hostname', 'database',
        'role', 'approved_role', 'server_version_num', 'read_only', 'isolation',
        'tls', 'identity_verified', 'privileges_complete', 'captured_at'})
    require(context['project'] == PROJECT and context['branch'] == PRODUCTION)
    require(context['branch_name'] == 'production' and context['database'] == 'neondb')
    require(type(context['endpoint']) is str and re.fullmatch(r'ep-[a-z0-9-]+', context['endpoint']))
    require(context['hostname'] == context['endpoint'] + '.c-7.us-east-2.aws.neon.tech')
    require(type(context['role']) is str and bool(context['role']) and context['role'] == context['approved_role'])
    require(type(context['server_version_num']) is int)
    require(queries.MIN_SERVER_VERSION <= context['server_version_num'] <= queries.MAX_SERVER_VERSION)
    require(context['read_only'] is True and context['isolation'] == 'repeatable read')
    require(context['tls'] == 'verify-full' and context['identity_verified'] is True)
    require(context['privileges_complete'] is True)
    require(type(context['captured_at']) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', context['captured_at']))
    require(type(capture['coverage']) is dict and set(capture['coverage']) == set(FIELDS))
    require(all(v is True for v in capture['coverage'].values()))
    ledger = capture['ledger']
    require(type(ledger) is dict and set(ledger) == {'state', 'count', 'structure_reviewed'})
    require(ledger['state'] == 'counted' and ledger['structure_reviewed'] is True)
    require(type(ledger['count']) is int and ledger['count'] >= 0)
    # Optional diagnostics are never part of semantic equality. No names/URLs.
    require(type(capture['diagnostic_oids']) is list)
    require(all(type(v) is int and v > 0 for v in capture['diagnostic_oids']))
    validate_catalog(capture['catalog'])


def semantic_catalog(catalog):
    """No SQL-text/default rewriting. Only order irrelevant sets by identity.

    Internal FK trigger generated names are normalized ONLY if bound to an
    existing FK constraint and enabled. The remaining definition is preserved.
    This does not certify trigger completeness; the reference remains incomplete.
    """
    validate_catalog(catalog)
    foreign_keys = {tuple(r['identity']) for r in catalog['constraints']
                    if r['properties']['kind'] == 'f'}
    result = {}
    for section, rows in catalog.items():
        values = []
        for row in rows:
            props = row['properties']
            if section == 'triggers' and props['internal'] is True:
                linked = props['constraint_identity']
                if (type(linked) is list and tuple(linked) in foreign_keys
                        and props['constraint_kind'] == 'f' and props['enabled'] == 'O'):
                    name = row['identity'][-1]
                    definition = props['definition']
                    quoted = '"' + name.replace('"', '""') + '"'
                    spellings = [quoted]
                    if re.fullmatch(r'[a-z_][a-z0-9_]*', name):
                        spellings.append(name)
                    for spelling in spellings:
                        prefix = 'CREATE CONSTRAINT TRIGGER ' + spelling + ' '
                        if type(definition) is str and definition.startswith(prefix):
                            normalized = 'CREATE CONSTRAINT TRIGGER <INTERNAL_FK> ' + definition[len(prefix):]
                            values.append({'identity': row['identity'][:2] + ['<INTERNAL_FK>'],
                                           'properties': {**props, 'definition': normalized}})
                            break
                    else:
                        values.append(row)  # Ambiguous representation is not ignored.
                    continue
            values.append(row)
        result[section] = sorted(values, key=canonical)
    return result


def compare_catalogs(expected, actual):
    """Pure comparison primitive; callers cannot turn it into reference proof.

    Regression tests use explicitly synthetic independently mutated examples.
    Returns section codes ONLY; never emits catalog identifiers or definitions.
    """
    left, right = semantic_catalog(expected), semantic_catalog(actual)
    return sorted(section for section in FIELDS if left[section] != right[section])


def compare_capture(capture):
    reference = foundation_reference()  # Always use repository-pinned evidence.
    try:
        validate_capture(capture)
    except (ValueError, TypeError, KeyError, RecursionError):
        return {'verdict': 'INDETERMINATE', 'reason': 'CAPTURE_INVALID_OR_INCOMPLETE',
                'ledger_status': 'UNKNOWN', 'production_compatibility': 'UNKNOWN'}
    catalog = capture['catalog']
    differences = set()
    # These facts are directly established by exact pinned source bytes. Do not
    # pretend columns/ACLs have a complete authoritative catalog representation.
    actual_tables = {tuple(r['identity']) for r in catalog['tables']}
    expected_tables = {('public', name) for name in reference['tables']}
    if actual_tables != expected_tables or any(r['properties']['kind'] != 'r' for r in catalog['tables']):
        differences.add('tables')
    actual_enums = {tuple(r['identity']): r['properties']['labels'] for r in catalog['enums']}
    if actual_enums != {('public', k): v for k, v in reference['enums'].items()}:
        differences.add('enums')
    for section in ('sequences', 'routines', 'views', 'policies', 'event_triggers'):
        if catalog[section]:
            differences.add(section)
    for row in catalog['triggers']:
        if row['properties']['internal'] is False:
            differences.add('triggers')
    if any(r['properties']['rls'] or r['properties']['force_rls'] for r in catalog['tables']):
        differences.add('tables')
    # Exact-match is intentionally unreachable: no complete trusted reference or
    # authenticated capture authority has been implemented by this offline tool.
    return {'verdict': 'MIGRATED OR OTHERWISE DIFFERENT' if differences else 'INDETERMINATE',
            'reason': 'DEFINITE_SOURCE_DIFFERENCE' if differences else REFERENCE_STATUS,
            'difference_sections': sorted(differences),
            'ledger_status': 'COUNTED_SEPARATELY', 'ledger_count': capture['ledger']['count'],
            'reference_complete': False, 'capture_authority': 'UNVERIFIED_OFFLINE_FILE',
            'production_compatibility': 'UNKNOWN'}


class PrivateParser(argparse.ArgumentParser):
    def error(self, _message):
        # argparse normally echoes rejected arguments, possibly containing secrets.
        self.exit(2, 'INVALID_OFFLINE_ARGUMENTS\n')


def main(argv=None):
    parser = PrivateParser(description=__doc__, allow_abbrev=False)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--verify-reference', action='store_true')
    modes.add_argument('--validate-queries', action='store_true')
    modes.add_argument('--compare-capture', metavar='LOCAL_FILE')
    args = parser.parse_args(argv)
    try:
        foundation_reference()  # Hash mismatch stops EVERY mode.
        if args.verify_reference:
            ref = foundation_reference()
            result = {k: ref[k] for k in ('sha256', 'complete', 'status', 'counts')}
            status = 3
        elif args.validate_queries:
            result, status = validate_queries(), 0
        else:
            validate_queries()
            result = compare_capture(load_capture(args.compare_capture))
            status = 2 if result['verdict'] == 'MIGRATED OR OTHERWISE DIFFERENT' else 3
        print(canonical(result))
        return status
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        print(canonical({'verdict': 'INDETERMINATE', 'reason': 'OFFLINE_INPUT_OR_PIN_REJECTED',
                         'production_compatibility': 'UNKNOWN'}))
        return 3


if __name__ == '__main__':
    sys.exit(main())
