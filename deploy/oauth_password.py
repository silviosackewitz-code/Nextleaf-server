#!/usr/bin/env python3
"""Create a salted scrypt owner password hash; never prints the password."""
import getpass
import hashlib
import secrets

if __name__ == '__main__':
    password = getpass.getpass('New Nextleaf MCP owner password (at least 16 characters): ')
    if len(password) < 16 or len(password.encode()) > 256:
        raise SystemExit('Use 16 or more characters and at most 256 UTF-8 bytes.')
    if password != getpass.getpass('Repeat password: '):
        raise SystemExit('Passwords did not match.')
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=131072, r=8, p=1, dklen=32, maxmem=268435456)
    # Single quotes preserve literal dollar signs in Docker Compose's .env parser.
    print("NEXTLEAF_OAUTH_PASSWORD_HASH='scrypt$" + salt.hex() + '$' + key.hex() + "'")
