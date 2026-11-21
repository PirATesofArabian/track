"""Run: python3 server/test_server.py"""
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer

tmp = tempfile.mkdtemp()
os.makedirs(os.path.join(tmp, 'dist', 'assets'))
open(os.path.join(tmp, 'dist', 'index.html'), 'w').write('<html>app</html>')
open(os.path.join(tmp, 'dist', 'assets', 'a.js'), 'w').write('x=1')
open(os.path.join(tmp, 'secret.txt'), 'w').write('nope')
os.environ.update(DB=os.path.join(tmp, 'app.db'), STATIC=os.path.join(tmp, 'dist'), ADMIN_PASSWORD='admin-pass-123')

import server  # noqa: E402


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db = server.connect()
        salt, h = server.hash_password('correct horse')
        db.execute('INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?,?,?,?)', ('yash', salt, h, int(time.time())))
        db.commit()
        server.ensure_admin(db)
        db.close()
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def call(self, method, path, body=None, token=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        h = {'Content-Type': 'application/json'}
        if token:
            h['Authorization'] = 'Bearer ' + token
        c.request(method, path, json.dumps(body) if body is not None else None, h)
        r = c.getresponse()
        raw = r.read()
        c.close()
        try:
            return r.status, json.loads(raw), r
        except ValueError:
            return r.status, raw, r

    def test_flow(self):
        self.assertEqual(self.call('GET', '/api/me')[0], 401)
        s, d, _ = self.call('POST', '/api/login', {'username': 'YASH ', 'password': 'wrong'})
        self.assertEqual(s, 401)
        s, d, _ = self.call('POST', '/api/login', {'username': 'nobody', 'password': 'x'})
        self.assertEqual((s, d['error']), (401, 'Wrong username or password.'))  # same message as a wrong password
        s, d, _ = self.call('POST', '/api/login', {'username': ' Yash ', 'password': 'correct horse', 'device': 'phone'})
        self.assertEqual(s, 200)
        tok = d['token']
        self.assertEqual(self.call('GET', '/api/me', token=tok)[1], {'username': 'yash', 'isAdmin': False})
        db = server.connect()
        stored = db.execute('SELECT token_hash FROM sessions').fetchone()[0]
        db.close()
        self.assertNotEqual(stored, tok)  # only a hash is stored
        self.assertEqual(self.call('POST', '/api/logout', token=tok)[0], 200)
        self.assertEqual(self.call('GET', '/api/me', token=tok)[0], 401)

    def test_expired_session(self):
        _, d, _ = self.call('POST', '/api/login', {'username': 'yash', 'password': 'correct horse'})
        db = server.connect()
        db.execute('UPDATE sessions SET expires_at = 1')
        db.commit()
        db.close()
        self.assertEqual(self.call('GET', '/api/me', token=d['token'])[0], 401)

    def test_bad_input(self):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request('POST', '/api/login', 'not json', {'Content-Length': '8'})
        self.assertEqual(c.getresponse().status, 400)
        c.close()
        self.assertEqual(self.call('POST', '/api/login', {'username': 5, 'password': None})[0], 401)

    def test_static_and_traversal(self):
        s, body, r = self.call('GET', '/food')
        self.assertEqual((s, body), (200, b'<html>app</html>'))  # client route falls back to index.html
        s, _, r = self.call('GET', '/assets/a.js')
        self.assertIn('immutable', r.getheader('Cache-Control'))
        for p in ('/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt'):
            s, body, _ = self.call('GET', p)
            self.assertNotEqual(body, b'nope', p)

    def test_register_and_taken(self):
        s, d, _ = self.call('POST', '/api/register', {'username': ' Sam ', 'password': 'longenough1'})
        self.assertEqual((s, d['username'], d['isAdmin']), (201, 'sam', False))
        self.assertEqual(self.call('GET', '/api/me', token=d['token'])[1], {'username': 'sam', 'isAdmin': False})
        s, d, _ = self.call('POST', '/api/register', {'username': 'SAM', 'password': 'otherpass12'})
        self.assertEqual(s, 409)
        self.assertIn('already taken', d['error'])
        self.assertIn('contact', d['error'])
        s, d, _ = self.call('POST', '/api/register', {'username': 'yash', 'password': 'otherpass12'})
        self.assertEqual(s, 409)
        self.assertEqual(self.call('POST', '/api/register', {'username': 'new1', 'password': 'short'})[0], 400)
        self.assertEqual(self.call('POST', '/api/register', {'username': 'bad name!', 'password': 'longenough1'})[0], 400)
        # the original password still works: a taken name never overwrites the account
        self.assertEqual(self.call('POST', '/api/login', {'username': 'yash', 'password': 'correct horse'})[0], 200)

    def test_admin(self):
        db = server.connect()
        self.assertEqual(db.execute('SELECT username FROM users WHERE is_admin = 1').fetchall()[0][0], 'admin')
        db.close()
        _, d, _ = self.call('POST', '/api/login', {'username': 'admin', 'password': os.environ['ADMIN_PASSWORD']})
        self.assertTrue(d['isAdmin'])
        s, body, _ = self.call('GET', '/api/admin/users', token=d['token'])
        self.assertEqual(s, 200)
        names = [u['username'] for u in body['users']]
        self.assertIn('yash', names)
        self.assertNotIn('pw_hash', json.dumps(body))
        _, u, _ = self.call('POST', '/api/login', {'username': 'yash', 'password': 'correct horse'})
        self.assertEqual(self.call('GET', '/api/admin/users', token=u['token'])[0], 403)
        self.assertEqual(self.call('GET', '/api/admin/users')[0], 401)

    def test_refused_post_does_not_desync(self):
        # a POST to an unknown path must still have its body read, or the next request on the connection is garbage
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        body = json.dumps({'username': 'yash', 'password': 'correct horse'})
        c.request('POST', '/nope/api/login', body, {'Content-Type': 'application/json'})
        r = c.getresponse(); r.read()
        self.assertEqual(r.status, 404)
        c.request('POST', '/api/login', body, {'Content-Type': 'application/json'})
        r = c.getresponse(); r.read()
        self.assertEqual(r.status, 200)
        c.close()

    # ───── sync ─────
    def token(self, name):
        if name not in getattr(self.__class__, '_tok', {}):
            self.__class__._tok = getattr(self.__class__, '_tok', {})
            db = server.connect()
            salt, h = server.hash_password('longenough1')
            db.execute('INSERT INTO users (username, pw_salt, pw_hash, created_at) VALUES (?,?,?,?)', (name, salt, h, int(time.time())))
            db.commit()
            db.close()
            s, d, _ = self.call('POST', '/api/login', {'username': name, 'password': 'longenough1'})
            self.assertEqual(s, 200)
            self.__class__._tok[name] = d['token']
        return self.__class__._tok[name]

    def sync(self, tok, changes=(), cursor=0):
        s, d, _ = self.call('POST', '/api/sync', {'cursor': cursor, 'changes': list(changes)}, token=tok)
        self.assertEqual(s, 200, d)
        return d

    @staticmethod
    def rec(uid, ts, tbl='workouts', **data):
        return {'uid': uid, 'tbl': tbl, 'data': data or {'n': 1}, 'updatedAt': ts, 'deleted': False}

    def test_sync_latest_edit_wins(self):
        t = self.token('sync1')
        now = int(time.time() * 1000)
        d = self.sync(t, [self.rec('a', now - 1000, n=1)])
        self.assertEqual(d['accepted'], ['a'])
        # an older edit from another device is refused and the newer version comes back
        d2 = self.sync(t, [self.rec('a', now - 5000, n=0)], cursor=d['cursor'])
        self.assertEqual(d2['accepted'], [])
        self.assertEqual([c['data'] for c in d2['changes']], [{'n': 1}])
        # an equal timestamp does not overwrite either
        self.assertEqual(self.sync(t, [self.rec('a', now - 1000, n=9)])['accepted'], [])
        # a newer edit wins and reaches a client that is behind
        self.assertEqual(self.sync(t, [self.rec('a', now - 500, n=2)])['accepted'], ['a'])
        d3 = self.sync(t, cursor=d['cursor'])
        self.assertEqual([c['data'] for c in d3['changes']], [{'n': 2}])
        # a client up to date gets nothing
        self.assertEqual(self.sync(t, cursor=d3['cursor'])['changes'], [])

    def test_sync_delete_is_a_tombstone(self):
        t = self.token('sync2')
        now = int(time.time() * 1000)
        c0 = self.sync(t, [self.rec('x', now - 3000)])['cursor']
        gone = {'uid': 'x', 'tbl': 'workouts', 'data': None, 'updatedAt': now - 2000, 'deleted': True}
        self.assertEqual(self.sync(t, [gone])['accepted'], ['x'])
        ch = self.sync(t, cursor=c0)['changes']
        self.assertEqual([(c['uid'], c['deleted'], c['data']) for c in ch], [('x', True, None)])
        # an older edit made offline cannot bring a deleted record back
        self.assertEqual(self.sync(t, [self.rec('x', now - 2500)])['accepted'], [])
        # a later edit can
        self.assertEqual(self.sync(t, [self.rec('x', now - 100)])['accepted'], ['x'])

    def test_sync_two_devices_converge(self):
        t = self.token('sync3')
        now = int(time.time() * 1000)
        a = self.sync(t, [self.rec('r1', now - 900, n='a'), self.rec('r2', now - 900, n='a')])
        b = self.sync(t, [self.rec('r1', now - 800, n='b'), self.rec('r3', now - 800, n='b')])
        self.assertEqual(sorted(b['accepted']), ['r1', 'r3'])
        a2 = self.sync(t, cursor=a['cursor'])
        got = {c['uid']: c['data']['n'] for c in a2['changes']}
        self.assertEqual(got, {'r1': 'b', 'r3': 'b'})
        full = {c['uid']: c['data']['n'] for c in self.sync(t, cursor=0)['changes']}
        self.assertEqual(full, {'r1': 'b', 'r2': 'a', 'r3': 'b'})

    def test_sync_paging(self):
        t = self.token('sync4')
        now = int(time.time() * 1000)
        total = server.SYNC_PAGE * 2 + 5
        for i in range(0, total, 500):
            self.sync(t, [self.rec('p%d' % j, now - 100, n=j) for j in range(i, min(i + 500, total))])
        seen, cursor, pages = set(), 0, 0
        while True:
            d = self.sync(t, cursor=cursor)
            pages += 1
            seen |= {c['uid'] for c in d['changes']}
            cursor = d['cursor']
            if not d['more']:
                break
            self.assertLess(pages, 20)
        self.assertEqual(len(seen), total)
        self.assertGreaterEqual(pages, 3)

    def test_sync_future_timestamp_is_clamped(self):
        t = self.token('sync5')
        now = int(time.time() * 1000)
        self.assertEqual(self.sync(t, [self.rec('f', now + 10 ** 12, n=1)])['accepted'], ['f'])
        # a clock far in the future must not freeze the record forever
        self.assertEqual(self.sync(t, [self.rec('f', now + server.FUTURE_SLACK_MS + 60000, n=2)])['accepted'], ['f'])
        stored = self.sync(t, cursor=0)['changes'][0]
        self.assertLessEqual(stored['updatedAt'], int(time.time() * 1000) + server.FUTURE_SLACK_MS)

    def test_sync_users_are_isolated(self):
        a, b = self.token('sync6'), self.token('sync7')
        now = int(time.time() * 1000)
        self.sync(a, [self.rec('same', now - 10, n='mine')])
        self.assertEqual(self.sync(b, cursor=0)['changes'], [])
        self.assertEqual(self.sync(b, [self.rec('same', now - 20, n='theirs')])['accepted'], ['same'])  # not blocked by a's older/newer copy
        self.assertEqual(self.sync(a, cursor=0)['changes'][0]['data'], {'n': 'mine'})

    def test_sync_bad_input(self):
        t = self.token('sync8')
        now = int(time.time() * 1000)
        self.assertEqual(self.call('POST', '/api/sync', {'cursor': 0, 'changes': []})[0], 401)
        bad = [
            {'cursor': -1, 'changes': []},
            {'cursor': 'x', 'changes': []},
            {'cursor': 0, 'changes': 'no'},
            {'cursor': 0, 'changes': [self.rec('a', now, tbl='users')]},
            {'cursor': 0, 'changes': [self.rec('a', now, tbl='syncTombstones')]},
            {'cursor': 0, 'changes': [{'uid': '', 'tbl': 'workouts', 'data': {}, 'updatedAt': now}]},
            {'cursor': 0, 'changes': [{'uid': 'a', 'tbl': 'workouts', 'data': 'str', 'updatedAt': now}]},
            {'cursor': 0, 'changes': [{'uid': 'a', 'tbl': 'workouts', 'data': {}, 'updatedAt': 'now'}]},
            {'cursor': 0, 'changes': [{'uid': 'a', 'tbl': 'workouts', 'data': {}, 'updatedAt': True}]},
            {'cursor': 0, 'changes': [self.rec('a', now, n='x' * (server.MAX_RECORD + 1))]},
            {'cursor': 0, 'changes': [self.rec('a%d' % i, now) for i in range(server.SYNC_MAX_CHANGES + 1)]},
        ]
        for body in bad:
            self.assertEqual(self.call('POST', '/api/sync', body, token=t)[0], 400, str(body)[:80])
        # one bad record rejects the whole batch: nothing is half-applied
        self.call('POST', '/api/sync', {'cursor': 0, 'changes': [self.rec('ok', now), self.rec('bad', now, tbl='nope')]}, token=t)
        self.assertEqual(self.sync(t, cursor=0)['changes'], [])

    def put(self, name, data, token=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request('PUT', '/api/photo/' + name, data, {'Authorization': 'Bearer ' + token} if token else {})
        r = c.getresponse()
        body = json.loads(r.read())
        c.close()
        return r.status, body

    def get_photo(self, name, token=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request('GET', '/api/photo/' + name, headers={'Authorization': 'Bearer ' + token} if token else {})
        r = c.getresponse()
        body = r.read()
        c.close()
        return r.status, body

    def test_photos(self):
        a, b = self.token('ph1'), self.token('ph2')
        jpg = b'\xff\xd8\xff\xe0' + b'x' * 1000
        self.assertEqual(self.put('abc123', jpg)[0], 401)  # not signed in
        self.assertEqual(self.put('abc123', jpg, a), (200, {'ok': True, 'existed': False}))
        self.assertEqual(self.put('abc123', b'\xff\xd8\xff\xe0' + b'y' * 10, a), (200, {'ok': True, 'existed': True}))  # same name: kept as it was
        self.assertEqual(self.get_photo('abc123', a), (200, jpg))
        self.assertEqual(self.get_photo('abc123')[0], 401)
        self.assertEqual(self.get_photo('abc123', b)[0], 404)  # another account cannot see it
        self.assertEqual(self.put('abc123', jpg, b)[0], 200)  # and the same name there is its own file
        self.assertEqual(self.put('notjpg', b'GIF89a....', a)[0], 400)
        self.assertEqual(self.put('..%2f..%2fx', jpg, a)[0], 404)
        self.assertEqual(self.put('a.b', jpg, a)[0], 404)
        self.assertEqual(self.get_photo('..%2fapp.db', a)[0], 404)
        # the record syncs like any other; deleting it removes the file
        now = int(time.time() * 1000)
        self.assertEqual(self.sync(a, [self.rec('abc123', now - 50, tbl='photos', date='2026-01-01', pose='front')])['accepted'], ['abc123'])
        self.assertEqual(self.get_photo('abc123', a)[0], 200)
        d = self.call('POST', '/api/sync', {'cursor': 0, 'changes': [{'uid': 'abc123', 'tbl': 'photos', 'data': None, 'updatedAt': now, 'deleted': True}]}, token=a)[1]
        self.assertEqual(d['accepted'], ['abc123'])
        self.assertEqual(self.get_photo('abc123', a)[0], 404)
        self.assertEqual(self.get_photo('abc123', b)[0], 200)  # b's own copy is untouched

    def test_photo_limits(self):
        t = self.token('ph3')
        old = server.MAX_PHOTO, server.PHOTO_QUOTA
        try:
            server.MAX_PHOTO, server.PHOTO_QUOTA = 2000, 2500
            jpg = b'\xff\xd8\xff' + b'x' * 1200
            self.assertEqual(self.put('one', jpg, t)[0], 200)
            self.assertEqual(self.put('two', b'\xff\xd8\xff' + b'x' * 3000, t)[0], 413)  # a single photo too large
            self.assertEqual(self.put('two', jpg, t)[0], 200)
            s, body = self.put('three', jpg, t)  # past the account's quota
            self.assertEqual(s, 413)
            self.assertIn('full', body['error'])
        finally:
            server.MAX_PHOTO, server.PHOTO_QUOTA = old

    def test_zz_throttle(self):
        for _ in range(server.MAX_FAILS):
            self.call('POST', '/api/login', {'username': 'yash', 'password': 'bad'})
        s, _, r = self.call('POST', '/api/login', {'username': 'yash', 'password': 'correct horse'})
        self.assertEqual(s, 429)


if __name__ == '__main__':
    unittest.main(verbosity=2)
