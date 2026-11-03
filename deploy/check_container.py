#!/usr/bin/env python3
"""Exercise a fresh release Compose installation in a disposable Docker project."""
import argparse
import datetime
import uuid
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image', required=True)
parser.add_argument('--upgrade-from', help='Start this published version, then replace its container with --image')
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='nextleaf-container-check-') as temporary:
    root = Path(temporary)
    data = root / 'data'
    data.mkdir()
    subprocess.run(['sudo', 'chown', '10001:10001', str(data)], check=True)
    override = root / 'override.yml'
    override.write_text('services:\n  nextleaf:\n    ports: !override\n      - "127.0.0.1::8787"\n')
    env = {**os.environ, 'TASKMANAGER_IMAGE': args.image, 'NEXTLEAF_DATA_DIR': str(data),
           'NEXTLEAF_MCP_TOKEN': secrets.token_hex(32), 'NEXTLEAF_MCP_HOSTS': '127.0.0.1,localhost'}
    command = ['docker', 'compose', '--project-name', root.name, '--env-file', '/dev/null',
               '-f', str(repo / 'deploy/release/docker-compose.yml'), '-f', str(override)]
    def compose(*arguments, capture=False):
        return subprocess.run(command + list(arguments), env=env, check=True,
                              capture_output=capture, text=True)
    def request(path, body=None, method=None):
        req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json'}, method=method)
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)
    try:
        upgraded = None
        if args.upgrade_from:
            subprocess.run(['docker', 'pull', args.upgrade_from], check=True)
            env['TASKMANAGER_IMAGE'] = args.upgrade_from
            compose('up', '-d', '--wait', '--wait-timeout', '90', '--pull', 'never')
            base = 'http://' + compose('port', 'nextleaf', '8787', capture=True).stdout.strip()
            request('/api/tasks', {'title': 'Keep through image update', 'status': 'next'})
            upgraded = request('/api/sync')
            env['TASKMANAGER_IMAGE'] = args.image
        compose('config', '--quiet')
        compose('up', '-d', '--wait', '--wait-timeout', '90', '--pull', 'never')
        base = 'http://' + compose('port', 'nextleaf', '8787', capture=True).stdout.strip()
        health = request('/api/health')
        assert health['status'] == 'ok'
        assert {'tag-management', 'sync-v4', 'scheduling'} <= set(health['capabilities'])
        initial = request('/api/sync')
        assert initial['snapshot']['protocol'] == 4
        if upgraded:
            assert initial['server_id'] == upgraded['server_id']
            for table in ['tasks', 'projects', 'areas', 'tags']:
                assert set(initial['snapshot'][table]) == set(upgraded['snapshot'][table])
                for key, previous in upgraded['snapshot'][table].items():
                    assert all(initial['snapshot'][table][key][field] == value for field, value in previous.items()), (table, key)
        else:
            assert all(not initial['snapshot'][table] for table in ['tasks', 'projects', 'areas', 'tags'])
        with urllib.request.urlopen(base, timeout=15) as response:
            assert b'<html' in response.read()
        person = request('/api/tags', {'name': 'Release contact', 'kind': 'person'})
        task = request('/api/tasks', {'title': 'Release persistence check', 'status': 'waiting'})
        request('/api/tasks/' + task['id'], {'tags': ['Release contact'], 'waiting_for': 'Release contact'}, 'PATCH')
        request('/api/tags/' + person['id'], {'name': 'Renamed contact'}, 'PATCH')
        subprocess.run(['python3', str(repo / 'deploy/check_mcp.py'), '--url', base + '/mcp'], env=env, check=True)
        updated = next(item for item in request('/api/tasks?view=waiting') if item['id'] == task['id'])
        assert updated['tags'] == ['Renamed contact']
        assert updated['waiting_for'] == 'Renamed contact'
        request('/api/schedule/timezone', {'timezone': 'UTC'})
        today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        repeating = request('/api/tasks', {'title': 'Repeat container check', 'status': 'next'})
        request('/api/tasks/' + repeating['id'], {'recurrence': {
            'id': str(uuid.uuid4()), 'frequency': 'daily', 'interval': 1,
            'start': today, 'until': today, 'due_days': 0, 'paused': False,
        }}, 'PATCH')
        request('/api/schedule/timezone', {'timezone': 'UTC'})
        copies = [item for item in request('/api/tasks?view=next') if item['title'] == 'Repeat container check']
        assert len(copies) == 1 and copies[0]['starred'] and copies[0]['due_date'] == today
        before = request('/api/sync')
        compose('down')
        compose('up', '-d', '--wait', '--wait-timeout', '90', '--pull', 'never')
        base = 'http://' + compose('port', 'nextleaf', '8787', capture=True).stdout.strip()
        assert request('/api/sync') == before, 'Data or server identity changed after container recreation'
        print('NEXTLEAF_CONTAINER_OK: install/upgrade, web, API, MCP, repeat generation and recreation persistence')
    finally:
        subprocess.run(command + ['down'], env=env, check=False)
        # Only the disposable directory created above belongs to this check.
        subprocess.run(['sudo', 'rm', '-rf', '--', str(data)], check=True)
