#!/usr/bin/env python3
"""Read-only MCP transport check. Never prints secrets or application contents."""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:8787/mcp')
parser.add_argument('--env-file', type=Path)
args = parser.parse_args()
url = urlsplit(args.url)
if url.username or url.password or url.scheme not in ('http', 'https') or (url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1')):
    raise SystemExit('Use HTTPS, or HTTP only on loopback; no credentials in URLs.')
settings = dict(os.environ)
if args.env_file:
    for line in args.env_file.read_text().splitlines():
        if line.startswith('NEXTLEAF_MCP_TOKEN='):
            settings['NEXTLEAF_MCP_TOKEN'] = line.split('=', 1)[1].strip()
token = settings.get('NEXTLEAF_MCP_TOKEN', '')
if not token:
    raise SystemExit('Missing NEXTLEAF_MCP_TOKEN; no request sent.')
# Keep credentials on the intended endpoint, even if a proxy responds with a redirect.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
opener = urllib.request.build_opener(NoRedirect)

def rpc(method, params, authenticated=True):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25'}
    if authenticated:
        headers['Authorization'] = 'Bearer ' + token
    data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    with opener.open(urllib.request.Request(args.url, data=data, headers=headers), timeout=20) as response:
        body = json.load(response)
    if 'error' in body:
        raise RuntimeError('MCP protocol returned an error')
    return body['result']

try:
    try:
        rpc('tools/list', {}, authenticated=False)
        raise RuntimeError('Unauthenticated request was accepted')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise RuntimeError(f'Expected HTTP 401, got {error.code}') from None
    initialized = rpc('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'nextleaf-check', 'version': '1'}})
    assert initialized['serverInfo']['name'] == 'nextleaf', 'Unexpected server'
    tools = {tool['name'] for tool in rpc('tools/list', {})['tools']}
    expected = {'list_areas', 'create_area', 'list_tags', 'create_tag', 'update_tag', 'update_area', 'list_projects', 'create_project', 'update_project', 'list_tasks', 'get_task', 'create_task', 'update_task'}
    assert expected <= tools <= expected | {'import_nirvana'}, 'Unexpected tool coverage'
    result = rpc('tools/call', {'name': 'list_areas', 'arguments': {}})
    assert not result.get('isError'), 'Read-only tool failed'
    assert isinstance(json.loads(result['content'][0]['text']), list)
except (urllib.error.URLError, RuntimeError, AssertionError, KeyError, ValueError) as error:
    raise SystemExit(f'MCP check failed: {type(error).__name__}') from None
print(f'NEXTLEAF_MCP_OK: authenticated transport, {len(tools)} tools, read-only call; unauthorized access rejected.')
