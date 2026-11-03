#!/usr/bin/env python3
"""Read-only OAuth discovery and public MCP boundary check; no credentials needed."""
import argparse
import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def check(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path != '/mcp' or parsed.query or parsed.fragment:
        raise ValueError('Use the exact public HTTPS /mcp URL, without credentials or query.')
    origin = f'https://{parsed.netloc}'
    opener = urllib.request.build_opener(NoRedirect)
    def request(path, body=None):
        req = urllib.request.Request(origin + path, data=body, headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        try:
            response = opener.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read(65537)
    status, headers, _ = request('/mcp', b'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
    assert status == 401, 'MCP must reject unauthenticated requests'
    assert f'resource_metadata="{origin}/.well-known/oauth-protected-resource"' in headers.get('WWW-Authenticate', ''), 'Missing OAuth challenge'
    status, _, raw = request('/.well-known/oauth-protected-resource')
    assert status == 200 and len(raw) <= 65536
    resource = json.loads(raw)
    assert resource['resource'] == url and resource['authorization_servers'] == [origin]
    status, _, raw = request('/.well-known/oauth-authorization-server')
    assert status == 200 and len(raw) <= 65536
    metadata = json.loads(raw)
    assert metadata['issuer'] == origin
    for key, path in [('authorization_endpoint','authorize'),('token_endpoint','token'),('registration_endpoint','register'),('revocation_endpoint','revoke')]:
        assert metadata[key] == f'{origin}/oauth/{path}'
    assert metadata['code_challenge_methods_supported'] == ['S256']
    assert 'offline_access' in metadata['scopes_supported']
    assert metadata['authorization_response_iss_parameter_supported'] is True
    for path in ['/', '/index.html', '/api/health', '/api/tasks', '/api/sync']:
        assert request(path)[0] in (401, 404), f'Private route exposed: {path}'
    print('NEXTLEAF_OAUTH_OK: discovery, PKCE, refresh metadata and unauthenticated public boundary. Complete an actual client sign-in next.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    try:
        check(args.url)
    except (AssertionError, KeyError, ValueError, urllib.error.URLError) as error:
        raise SystemExit(f'OAuth discovery check failed: {type(error).__name__}: {error}') from None
