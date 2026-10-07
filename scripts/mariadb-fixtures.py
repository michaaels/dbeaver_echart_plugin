"""Seed and check synthetic chart data. Credentials are read silently or from an environment variable."""
import argparse
import getpass
import json
import os
from pathlib import Path
import ssl
import sys
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.dev' / 'python-packages'))
import pymysql


def statements(path):
    # These fixture files contain no procedures or semicolons inside strings.
    return [s.strip() for s in path.read_text(encoding='utf-8').split(';') if s.strip()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', action='store_true', help='Create and populate the three fixture tables')
    args = parser.parse_args()
    uri = urlsplit(os.environ.get('ECHARTS_TEST_DB_URI') or getpass.getpass('MariaDB URI (hidden): '))
    if uri.scheme not in ('mysql', 'mariadb') or not uri.hostname or not uri.path.strip('/'):
        raise ValueError('Provide a mysql:// or mariadb:// URI with a database name')
    mode = parse_qs(uri.query).get('ssl-mode', ['REQUIRED'])[0].upper()
    if mode not in ('REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY'):
        raise ValueError('The test runner requires TLS')
    tls = ssl.create_default_context()
    if mode == 'REQUIRED':
        tls.check_hostname = False
        tls.verify_mode = ssl.CERT_NONE
    elif mode == 'VERIFY_CA':
        tls.check_hostname = False
    report = {}
    datasets = []
    with pymysql.connect(host=uri.hostname, port=uri.port or 3306, user=unquote(uri.username or ''),
            password=unquote(uri.password or ''), database=uri.path.strip('/'), charset='utf8mb4',
            ssl=tls, connect_timeout=15, read_timeout=45, write_timeout=45) as db:
        with db.cursor() as cur:
            cur.execute('SELECT VERSION()')
            report['server'] = cur.fetchone()[0]
            cur.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            report['tls_cipher'] = cur.fetchone()[1]
            if not report['tls_cipher']:
                raise RuntimeError('TLS was not negotiated')
            if args.seed:
                for sql in statements(ROOT / 'dev/mariadb/seed.sql'):
                    cur.execute(sql)
                db.commit()
            report['tables'] = {}
            for table, expected in [('echarts_test_sales', 3240), ('echarts_test_funnel', 5), ('echarts_test_edge_cases', 7)]:
                cur.execute(f'SELECT COUNT(*) FROM {table}')
                count = cur.fetchone()[0]
                if count != expected:
                    raise RuntimeError(f'{table}: expected {expected} rows, found {count}')
                report['tables'][table] = count
            report['queries'] = []
            for index, sql in enumerate(statements(ROOT / 'dev/mariadb/chart-queries.sql'), 1):
                cur.execute(sql)
                rows = cur.fetchall()
                numeric_types = {0, 1, 2, 3, 4, 5, 8, 9, 13, 16, 246}
                date_types = {7, 10, 11, 12, 14}
                datasets.append({'sql': sql, 'columns': [{'name': column[0], 'kind':
                    'NUMERIC' if column[1] in numeric_types else 'DATETIME' if column[1] in date_types else 'STRING'}
                    for column in cur.description], 'rows': rows})
                report['queries'].append({'number': index, 'rows': len(rows),
                    'columns': [column[0] for column in cur.description], 'sample': rows[:2]})
    destination = ROOT / '.dev/mariadb-verification.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    (ROOT / '.dev/mariadb-datasets.json').write_text(
        json.dumps(datasets, ensure_ascii=False, default=str), encoding='utf-8')
    print(json.dumps({'server': report['server'], 'tls': report['tls_cipher'],
        'tables': report['tables'], 'queries_checked': len(report['queries'])}, ensure_ascii=False))
    print('Report:', destination)


if __name__ == '__main__':
    main()
