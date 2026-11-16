# Pi server

Python 3 standard library and SQLite only. Nothing to install on Raspberry Pi OS.

```sh
npm run build                                   # builds ../dist, which the server also serves
python3 server/server.py serve                  # http://0.0.0.0:8787
```

**First start creates an admin** called `admin` if there is none, with a random password printed once (set `ADMIN_PASSWORD` to choose it). Change it with `python3 server/server.py passwd admin`.
If a user called `admin` already exists, it becomes the admin and its password is not touched.

## Set up on a new Pi

The Pi only needs Python 3. Build the app on your computer (it needs Node), then copy it over.

```sh
# on your computer, in the project folder
npm install && npm run build
ssh pi@PI_ADDRESS 'mkdir -p ~/gym-food-tracker'
rsync -az --delete --exclude 'data/' --exclude '__pycache__/' server dist pi@PI_ADDRESS:~/gym-food-tracker/

# on the Pi
cd ~/gym-food-tracker
ADMIN_PASSWORD='choose one' python3 server/server.py serve   # first start creates the admin; Ctrl+C once it is running
sudo cp server/tracker.service /etc/systemd/system/          # edit User and the two paths first if yours differ
sudo systemctl enable --now tracker
systemctl is-active tracker
```

Then open `http://PI_ADDRESS:8787`, create your account, and sign in on each device (Progress → Data → Account).
To update later, build and run the same `rsync` again. Restart (`sudo systemctl restart tracker`) only if `server.py` changed. `data/` (the database) is never copied or committed; back it up by copying `server/data/`.

Commands: `users` (A marks admins; shows last login), `adduser NAME`, `passwd NAME` (signs that user out everywhere), `deluser NAME`, `makeadmin NAME`, `rmadmin NAME`. The last admin can't be deleted or demoted.
To run it at boot, edit and install `tracker.service` (instructions at the top of the file).
Tests: `python3 server/test_server.py`.

- **Anyone who can reach the server can create an account** (10 attempts an hour per address). A name that is taken is refused with a message to contact the admin (`ADMIN_CONTACT` sets the wording), and never changes the existing account. Set `SIGNUP=0` to close sign-up, then only `adduser` creates accounts.
- **Admins** see the user list in the app (Progress → Data → Account): joined, last login, devices signed in. Password resets and deletions are done on the Pi.
- Accounts don't see each other's data. Each account's synced records are stored in the `records` table (JSON per record), keyed by account.
- Passwords are stored as scrypt hashes. Session tokens are random, only their SHA-256 is stored, and they last 30 days.
- After 5 wrong passwords in 15 minutes from one address for one name, login is refused for the rest of the window.
- **It speaks plain HTTP.** Use it over Tailscale (encrypted) or your home network. Don't expose port 8787 to the internet. For HTTPS use `tailscale serve` or a reverse proxy.
- Settings (environment): `HOST`, `PORT`, `DB`, `STATIC`, and `CORS_ORIGIN` if the app is hosted somewhere else (for example Netlify) and signs in cross-origin. Over HTTPS Netlify to an `http://` Pi address, browsers block the request, so serve the app from the Pi instead.
- API: `POST /api/login`, `POST /api/register`, `POST /api/logout`, `GET /api/me`, `GET /api/admin/users` (admin), `GET /api/health`, `POST /api/sync`.
- **Sync** (`POST /api/sync`, signed in): send `{cursor, changes:[{uid, tbl, data, updatedAt, deleted}]}`. A change is kept only if its `updatedAt` is strictly newer than the stored one (latest edit wins); the reply has `changes` newer than your `cursor` (plus the server's copy of any you sent that lost), a new `cursor`, and `more` if there is another page. Deletes are stored as tombstones. Edit times more than 2 minutes in the future are clamped. Tables are limited to a fixed list; photos are not accepted.
