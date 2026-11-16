#!/usr/bin/env python3
"""Tiny account server for the gym-food-tracker. Standard library only (Python 3.9+), SQLite storage.

  python3 server/server.py adduser NAME      create a user (asks for the password)
  python3 server/server.py passwd NAME       change a password (signs that user out everywhere)
  python3 server/server.py deluser NAME      delete a user and their sessions (never the last admin)
  python3 server/server.py makeadmin NAME    give a user admin rights
  python3 server/server.py rmadmin NAME      take admin rights away (never from the last admin)
  python3 server/server.py users             list users (A = admin)
  python3 server/server.py serve             run the server (default)

People can create their own account in the app. A taken name is refused with a note to contact the admin.
On first start, if there is no admin, one called "admin" is created with a random password, printed once.
It also serves the built app (../dist) so the app and the API share one origin.

Environment: HOST (0.0.0.0), PORT (8787), DB (server/data/app.db), STATIC (dist), CORS_ORIGIN (unset = none),
SIGNUP (1; set 0 to close sign-up), ADMIN_CONTACT (text shown when a name is taken), ADMIN_PASSWORD (first-run admin password).
"""
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '8787'))
DB_PATH = Path(os.environ.get('DB', ROOT / 'data' / 'app.db'))
STATIC = Path(os.environ.get('STATIC', ROOT.parent / 'dist')).resolve()
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', '')
SIGNUP = os.environ.get('SIGNUP', '1') != '0'
ADMIN_CONTACT = os.environ.get('ADMIN_CONTACT', 'the admin of this server')

# Tables the app syncs (src/lib/sync.ts). Photos are not synced.
SYNC_TABLES = {'customExercises', 'routines', 'customFoods', 'workouts', 'foodLog', 'bodyWeight', 'measurements', 'activity', 'water',
               'settings', 'profile', 'goals', 'events', 'pain', 'memories', 'reports', 'kv', 'supplements', 'sleep'}
MAX_SYNC_BODY = 25 * 1024 * 1024
MAX_RECORD = 1024 * 1024
SYNC_PAGE, SYNC_PAGE_BYTES, SYNC_MAX_CHANGES = 300, 3 * 1024 * 1024, 1000
FUTURE_SLACK_MS = 120 * 1000  # an edit time further ahead than this is clamped (a wrong device clock)

SESSION_DAYS = 30
MIN_PASSWORD = 8
MAX_BODY = 16 * 1024
MAX_FAILS, FAIL_WINDOW = 5, 15 * 60  # 5 wrong passwords per 15 minutes per address and name
MAX_SIGNUPS, SIGNUP_WINDOW = 10, 3600  # sign-up attempts per hour per address
SCRYPT = dict(n=2 ** 14, r=8, p=1, dklen=32)


# ───────── storage ─────────
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript("""
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        pw_salt BLOB NOT NULL,
        pw_hash BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS records (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        uid TEXT NOT NULL,
        tbl TEXT NOT NULL,
        data TEXT,
        updated_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL,
        PRIMARY KEY (user_id, uid)
      );
      CREATE INDEX IF NOT EXISTS records_seq ON records(user_id, seq);
    """)
    cols = {r['name'] for r in db.execute('PRAGMA table_info(users)')}
    if 'is_admin' not in cols:
        db.execute('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
    if 'last_login' not in cols:
        db.execute('ALTER TABLE users ADD COLUMN last_login INTEGER')
    db.commit()
    return db


# ───────── passwords and tokens ─────────
def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    return salt, hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)


_DUMMY = hash_password('not a real password')  # so an unknown name costs the same time as a wrong password


def check_password(row, password):
    salt, want = (row['pw_salt'], row['pw_hash']) if row else _DUMMY
    _, got = hash_password(password, salt)
    return hmac.compare_digest(got, want) and row is not None


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def clean_name(name):
    name = (name or '').strip().lower()
    ok = 1 <= len(name) <= 32 and all(c.isalnum() or c in '._-' for c in name)
    return name if ok else None


# ───────── login throttle ─────────
_fails, _lock = {}, threading.Lock()


def throttled(key, limit=MAX_FAILS, window=FAIL_WINDOW):
    now = time.time()
    with _lock:
        recent = [t for t in _fails.get(key, []) if now - t < window]
        _fails[key] = recent
        return len(recent) >= limit


def record_fail(key):
    with _lock:
        _fails.setdefault(key, []).append(time.time())


def clear_fails(key):
    with _lock:
        _fails.pop(key, None)


# ───────── http ─────────
class Handler(BaseHTTPRequestHandler):
    server_version = 'tracker'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    # -- helpers
    def _headers(self, status, ctype, length, extra=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if self.close_connection:
            self.send_header('Connection', 'close')
        if CORS_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', CORS_ORIGIN)
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Vary', 'Origin')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, status, obj, extra=None):
        body = json.dumps(obj).encode()
        self._headers(status, 'application/json', len(body), {'Cache-Control': 'no-store', **(extra or {})})
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _body(self, limit=MAX_BODY):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = -1
        if n < 0 or n > limit:
            self.close_connection = True  # the body is not read, so this connection cannot be reused
            return None
        try:
            data = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    def _user(self, db):
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return None
        row = db.execute(
            'SELECT u.id, u.username, u.is_admin, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id '
            'WHERE s.token_hash = ? AND s.expires_at > ?', (token_hash(auth[7:].strip()), int(time.time()))).fetchone()
        return row

    # -- verbs
    def do_OPTIONS(self):
        self._headers(204, 'text/plain', 0)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/health':
            return self._json(200, {'ok': True})
        if path in ('/api/me', '/api/admin/users'):
            db = connect()
            try:
                u = self._user(db)
                if not u:
                    return self._json(401, {'error': 'Not signed in.'})
                if path == '/api/me':
                    return self._json(200, {'username': u['username'], 'isAdmin': bool(u['is_admin'])})
                if not u['is_admin']:
                    return self._json(403, {'error': 'Admins only.'})
                now = int(time.time())
                rows = db.execute(
                    'SELECT u.username, u.is_admin, u.created_at, u.last_login, '
                    '(SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions '
                    'FROM users u ORDER BY u.id', (now,)).fetchall()
                return self._json(200, {'users': [
                    {'username': r['username'], 'isAdmin': bool(r['is_admin']), 'createdAt': r['created_at'], 'lastLogin': r['last_login'], 'sessions': r['sessions']}
                    for r in rows]})
            finally:
                db.close()
        if path.startswith('/api/'):
            return self._json(404, {'error': 'Not found.'})
        self._static(path)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == '/api/sync':
            return self._sync()
        self._data = self._body()  # always read, so a refused request cannot leave its body to be parsed as the next one
        if path == '/api/login':
            return self._login()
        if path == '/api/register':
            return self._register()
        if path == '/api/logout':
            return self._logout()
        self._json(404, {'error': 'Not found.'})

    def _open_session(self, db, row):
        token, now = secrets.token_urlsafe(32), int(time.time())
        db.execute('DELETE FROM sessions WHERE expires_at <= ?', (now,))
        db.execute('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?,?,?,?,?)',
                   (token_hash(token), row['id'], str(self._data.get('device', ''))[:64], now, now + SESSION_DAYS * 86400))
        db.execute('UPDATE users SET last_login = ? WHERE id = ?', (now, row['id']))
        db.commit()
        return {'token': token, 'username': row['username'], 'isAdmin': bool(row['is_admin']), 'expiresAt': now + SESSION_DAYS * 86400}

    def _login(self):
        data = self._data
        if data is None:
            return self._json(400, {'error': 'Bad request.'})
        name, password = clean_name(str(data.get('username', ''))), str(data.get('password', ''))
        key = '%s|%s' % (self.client_address[0], name or '')
        if throttled(key):
            return self._json(429, {'error': 'Too many wrong passwords. Try again in 15 minutes.'}, {'Retry-After': str(FAIL_WINDOW)})
        db = connect()
        try:
            row = db.execute('SELECT * FROM users WHERE username = ?', (name,)).fetchone() if name else None
            if not check_password(row, password):
                record_fail(key)
                return self._json(401, {'error': 'Wrong username or password.'})
            clear_fails(key)
            return self._json(200, self._open_session(db, row))
        finally:
            db.close()

    def _register(self):
        if not SIGNUP:
            return self._json(403, {'error': 'Sign-up is closed. Contact %s.' % ADMIN_CONTACT})
        data = self._data
        if data is None:
            return self._json(400, {'error': 'Bad request.'})
        name, password = clean_name(str(data.get('username', ''))), str(data.get('password', ''))
        key = 'signup|%s' % self.client_address[0]
        if throttled(key, MAX_SIGNUPS, SIGNUP_WINDOW):
            return self._json(429, {'error': 'Too many sign-up attempts. Try again later or contact %s.' % ADMIN_CONTACT}, {'Retry-After': str(SIGNUP_WINDOW)})
        record_fail(key)
        if not name:
            return self._json(400, {'error': 'Username: 1 to 32 letters, digits, dot, dash or underscore.'})
        if len(password) < MIN_PASSWORD:
            return self._json(400, {'error': 'Use a password of at least %d characters.' % MIN_PASSWORD})
        taken = {'error': 'The username "%s" is already taken. Choose another, or contact %s if it is yours.' % (name, ADMIN_CONTACT)}
        db = connect()
        try:
            if db.execute('SELECT 1 FROM users WHERE username = ?', (name,)).fetchone():
                return self._json(409, taken)
            salt, h = hash_password(password)
            try:
                cur = db.execute('INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?,?,?,?)', (name, salt, h, int(time.time())))
            except sqlite3.IntegrityError:
                return self._json(409, taken)  # someone took it a moment ago
            row = db.execute('SELECT * FROM users WHERE id = ?', (cur.lastrowid,)).fetchone()
            return self._json(201, self._open_session(db, row))
        finally:
            db.close()

    def _sync(self):
        """Latest edit wins, per record. The client sends what changed since it last synced and the cursor it has reached."""
        db = connect()
        try:
            u = self._user(db)
            if not u:
                self.close_connection = True  # unread body: do not let it be parsed as the next request
                return self._json(401, {'error': 'Not signed in.'})
            d = self._body(MAX_SYNC_BODY)
            if d is None:
                return self._json(400, {'error': 'Bad request.'})
            changes = d.get('changes') or []
            try:
                cursor = int(d.get('cursor') or 0)
            except (TypeError, ValueError):
                cursor = -1
            if cursor < 0 or not isinstance(changes, list) or len(changes) > SYNC_MAX_CHANGES:
                return self._json(400, {'error': 'Bad request.'})
            now_ms = int(time.time() * 1000)
            clean = []
            for c in changes:
                ok = isinstance(c, dict) and isinstance(c.get('uid'), str) and 1 <= len(c['uid']) <= 200 and c.get('tbl') in SYNC_TABLES \
                    and isinstance(c.get('updatedAt'), int) and not isinstance(c.get('updatedAt'), bool) and c['updatedAt'] >= 0
                deleted = bool(c.get('deleted')) if ok else False
                if ok and not deleted and not isinstance(c.get('data'), dict):
                    ok = False
                blob = None if deleted or not ok else json.dumps(c['data'], separators=(',', ':'))
                if not ok or (blob is not None and len(blob) > MAX_RECORD):
                    return self._json(400, {'error': 'A record was not valid.'})
                clean.append((c['uid'], c['tbl'], blob, min(c['updatedAt'], now_ms + FUTURE_SLACK_MS), 1 if deleted else 0))
            accepted, rejected = [], []
            uid_user = u['id']
            if clean:
                db.execute('BEGIN IMMEDIATE')
                try:
                    seq = db.execute('SELECT COALESCE(MAX(seq), 0) FROM records WHERE user_id = ?', (uid_user,)).fetchone()[0]
                    for uid, tbl, blob, ts, deleted in clean:
                        row = db.execute('SELECT updated_at, tbl FROM records WHERE user_id = ? AND uid = ?', (uid_user, uid)).fetchone()
                        if row is not None and (ts <= row['updated_at'] or row['tbl'] != tbl):
                            rejected.append(uid)  # the server already has an equal or newer edit
                            continue
                        seq += 1
                        db.execute('INSERT OR REPLACE INTO records (user_id, uid, tbl, data, updated_at, deleted, seq) VALUES (?,?,?,?,?,?,?)',
                                   (uid_user, uid, tbl, blob, ts, deleted, seq))
                        accepted.append(uid)
                    db.commit()
                except Exception:
                    db.rollback()
                    raise
            skip, out, size, more, last = set(accepted), [], 0, False, cursor
            def shape(r):
                return {'uid': r['uid'], 'tbl': r['tbl'], 'data': json.loads(r['data']) if r['data'] is not None else None,
                        'updatedAt': r['updated_at'], 'deleted': bool(r['deleted'])}
            sent = set()
            for uid in rejected:  # tell the client what the server holds instead, so it converges
                r = db.execute('SELECT * FROM records WHERE user_id = ? AND uid = ?', (uid_user, uid)).fetchone()
                out.append(shape(r)); sent.add(uid)
            for r in db.execute('SELECT * FROM records WHERE user_id = ? AND seq > ? ORDER BY seq', (uid_user, cursor)):
                if len(out) >= SYNC_PAGE + len(rejected) or size > SYNC_PAGE_BYTES:
                    more = True
                    break
                last = r['seq']
                if r['uid'] in skip or r['uid'] in sent:
                    continue
                size += len(r['data'] or '')
                out.append(shape(r))
            return self._json(200, {'cursor': max(last, cursor), 'changes': out, 'more': more, 'accepted': accepted, 'serverTime': int(time.time() * 1000)})
        finally:
            db.close()

    def _logout(self):
        db = connect()
        try:
            u = self._user(db)
            if u:
                db.execute('DELETE FROM sessions WHERE token_hash = ?', (u['token_hash'],))
                db.commit()
        finally:
            db.close()
        self._json(200, {'ok': True})

    def _static(self, path):
        if not STATIC.is_dir():
            return self._json(404, {'error': 'App not built. Run npm run build.'})
        rel = unquote(path).lstrip('/')
        target = (STATIC / rel).resolve()
        inside = target == STATIC or STATIC in target.parents
        if not inside or not target.is_file():
            target = STATIC / 'index.html'  # client-side routes (/food, /body, ...)
        if not target.is_file():
            return self._json(404, {'error': 'Not found.'})
        data = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        immutable = 'assets' in target.relative_to(STATIC).parts
        cache = 'public, max-age=31536000, immutable' if immutable else 'no-cache'
        self._headers(200, ctype, len(data), {'Cache-Control': cache})
        if self.command != 'HEAD':
            self.wfile.write(data)


# ───────── default admin ─────────
def ensure_admin(db):
    """If nobody is an admin, make the user "admin". A new one gets a random password (or ADMIN_PASSWORD), shown once."""
    if db.execute('SELECT 1 FROM users WHERE is_admin = 1').fetchone():
        return
    row = db.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
    if row:
        db.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (row['id'],))
        db.commit()
        print('The existing user "admin" is now the admin. Its password is unchanged.')
        return
    given = os.environ.get('ADMIN_PASSWORD')
    if given is not None and len(given) < MIN_PASSWORD:
        sys.exit('ADMIN_PASSWORD must be at least %d characters.' % MIN_PASSWORD)
    pw = given or secrets.token_urlsafe(9)
    salt, h = hash_password(pw)
    db.execute('INSERT INTO users (username, pw_salt, pw_hash, is_admin, created_at) VALUES (?,?,?,1,?)', ('admin', salt, h, int(time.time())))
    db.commit()
    print('Created the admin user "admin".')
    print('Password: %s' % pw if not given else 'Password: the one in ADMIN_PASSWORD.')
    print('Shown once. Change it with: python3 server/server.py passwd admin')


# ───────── command line ─────────
def ask_password(confirm=True):
    pw = getpass.getpass('Password: ')
    if len(pw) < MIN_PASSWORD:
        sys.exit('Use at least %d characters.' % MIN_PASSWORD)
    if confirm and getpass.getpass('Again: ') != pw:
        sys.exit('The two passwords differ.')
    return pw


def cli(argv):
    cmd = argv[0] if argv else 'serve'
    if cmd == 'serve':
        db = connect()
        ensure_admin(db)
        db.close()
        print('Serving %s on http://%s:%d  (database %s)' % (STATIC, HOST, PORT, DB_PATH))
        try:
            ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
        except KeyboardInterrupt:
            pass
        return
    db = connect()
    try:
        if cmd == 'users':
            for r in db.execute('SELECT username, is_admin, created_at, last_login FROM users ORDER BY id'):
                seen = time.strftime('%Y-%m-%d %H:%M', time.localtime(r['last_login'])) if r['last_login'] else 'never'
                print('%-20s %s  created %s  last login %s' % (r['username'], 'A' if r['is_admin'] else ' ', time.strftime('%Y-%m-%d', time.localtime(r['created_at'])), seen))
            return
        if len(argv) < 2:
            sys.exit(__doc__)
        name = clean_name(argv[1])
        if not name:
            sys.exit('Name: 1 to 32 letters, digits, dot, dash or underscore.')
        if cmd == 'adduser':
            if db.execute('SELECT 1 FROM users WHERE username = ?', (name,)).fetchone():
                sys.exit('%s already exists.' % name)
            salt, h = hash_password(ask_password())
            db.execute('INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?,?,?,?)', (name, salt, h, int(time.time())))
            db.commit()
            print('Created %s.' % name)
        elif cmd == 'passwd':
            row = db.execute('SELECT id FROM users WHERE username = ?', (name,)).fetchone()
            if not row:
                sys.exit('No such user.')
            salt, h = hash_password(ask_password())
            db.execute('UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?', (salt, h, row['id']))
            db.execute('DELETE FROM sessions WHERE user_id = ?', (row['id'],))
            db.commit()
            print('Password changed for %s. They are signed out everywhere.' % name)
        elif cmd in ('deluser', 'rmadmin', 'makeadmin'):
            row = db.execute('SELECT id, is_admin FROM users WHERE username = ?', (name,)).fetchone()
            if not row:
                sys.exit('No such user.')
            last = row['is_admin'] and db.execute('SELECT COUNT(*) FROM users WHERE is_admin = 1').fetchone()[0] == 1
            if cmd == 'makeadmin':
                db.execute('UPDATE users SET is_admin = 1 WHERE id = ?', (row['id'],))
                print('%s is an admin.' % name)
            elif last:
                sys.exit('%s is the last admin. Make someone else an admin first.' % name)
            elif cmd == 'rmadmin':
                db.execute('UPDATE users SET is_admin = 0 WHERE id = ?', (row['id'],))
                print('%s is no longer an admin.' % name)
            else:
                db.execute('DELETE FROM users WHERE id = ?', (row['id'],))
                print('Deleted %s.' % name)
            db.commit()
        else:
            sys.exit(__doc__)
    finally:
        db.close()


if __name__ == '__main__':
    cli(sys.argv[1:])
