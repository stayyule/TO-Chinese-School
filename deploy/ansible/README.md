# Host hardening playbook (TOCS production host)

`site.yml` turns a **fresh Ubuntu 24.04 LTS** server into the host that runs `deploy/compose.prod.yml`:

| Role | What it does |
|---|---|
| `preflight` (always runs) | Checks every variable and the host **before anything changes**: secrets present, long enough, right format, not placeholder text (`replace-with`, `changeme`, `<...>`, ...; also `smtp_url` and, when set, `ghcr_token`); `backup_age_recipient` is an `age1...` public key; `admin_user` is not root/deploy, exists and already has an SSH key, and the account the play connects as is admitted by `AllowUsers` afterwards (lock-out guards); Caddy's published ports are allowed by ufw; supported release. Fails with a message naming the variable, never its value. |
| `hardening` | Packages; user `deploy` (password locked, key only, `authorized_keys` exclusively from `deploy_ssh_public_keys`); sshd drop-in `/etc/ssh/sshd_config.d/00-tocs-hardening.conf` (validated with `sshd -t` before it is installed and again before reload); fail2ban sshd jail (systemd backend); unattended-upgrades (security pockets only, no automatic reboot); network sysctls; ufw (default deny incoming, allow only 22/80/443). |
| `docker` | Docker Engine + Compose v2 plugin from Docker's apt repository, key accepted only if its fingerprint is `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`; `daemon.json` (log rotation, live-restore, no-new-privileges); adds `deploy` to the `docker` group. |
| `app` | `/opt/tocs` layout (below), `.env` and `backup.env` rendered from variables, optional GHCR login for `deploy`, `tocs-backup.service` + `tocs-backup.timer` (daily 02:30 America/Los_Angeles). |

Tags: `hardening`, `docker`, `app` (e.g. `--tags app` after a change to the compose file or scripts).

### `/opt/tocs` after the play

| Path | Owner | Mode | Why |
|---|---|---|---|
| `/opt/tocs/` | deploy:deploy | 750 | `deploy.sh` writes `previous_tag`, `current_tag`, `.deploy.lock` here |
| `.env` | deploy:deploy | 600 | read by `docker compose`, `deploy.sh`, `backup.sh` (all run as deploy) |
| `backup.env` | deploy:deploy | 600 | age **recipient** (public key), `BACKUP_REMOTE`, retention |
| `deploy.sh`, `backup.sh`, `restore.sh` | root:deploy | 750 | deploy can run, not edit |
| `compose.prod.yml` | root:deploy | 640 | |
| `db/` / `db/init-roles.sql` | root:deploy | 750 / 644 | bind-mounted into postgres, read there as uid 999, so world-readable. No secrets in it. |
| `backups/` | deploy:deploy | 700 | encrypted dumps (`tocs-<UTC>-tocs.dump.age` + `.sha256`) |

The files are copied from this repository's `deploy/` directory (`tocs_deploy_src_dir`), so check out the commit you
deploy before you run the play. Run the play again whenever those files change.

## Running it

Controller: any machine with Python 3.12+, `pip install ansible-core==2.20.11`, then

```sh
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml          # community.general (ufw module)
cp inventory.example inventory.ini                             # host, ansible_user, admin_user
ansible-vault create secrets.yml                               # see below; never commit it unencrypted
ansible-playbook -i inventory.ini site.yml -e @secrets.yml --ask-vault-pass
```

`inventory.ini`, `secrets*.yml` and `*.vault.yml` in this directory are git-ignored. Store the vault password in
the password manager. `secrets.yml` (inside the vault):

```yaml
deploy_ssh_public_keys:
  - "ssh-ed25519 AAAA... tocs-deploy-ci"          # public half of the DEPLOY_SSH_KEY GitHub secret
ghcr_owner: to-chinese-school                      # lower-case owner of ghcr.io/<owner>/tocs-api|tocs-web
image_tag: 0123abcd                                # first tag to run (deploy.sh overrides it per deploy)
caddy_tls: webmaster@to-cs.org                     # ACME account e-mail
session_secret: "<openssl rand -hex 32>"
smtp_url: "smtps://<user>:<password>@<smtp-host>:465"
postgres_password: "<openssl rand -hex 24>"
tocs_migrator_password: "<openssl rand -hex 24>"
tocs_app_password: "<openssl rand -hex 24>"
backup_age_recipient: "age1..."                    # age-keygen -y <identity>; the identity stays OFFLINE
# optional
# ghcr_username: <github user>
# ghcr_token: <PAT with read:packages only>
# backup_remote: offsite:tocs-backups
```

Placeholders such as the `<...>` above are refused by `preflight`.

### Variables

Secrets have **no defaults**; the play refuses to run without them. Everything else has a safe default
(`roles/*/defaults/main.yml`, each documented there).

| Variable | Default | Notes |
|---|---|---|
| `admin_user` | **required** | Existing sudo account the operator/Ansible logs in as. Must already have `~/.ssh/authorized_keys`. Not `root`/`deploy`. |
| `deploy_ssh_public_keys` | **required** | List of OpenSSH public keys; `authorized_keys` of deploy is exactly this list. |
| `ghcr_owner`, `image_tag` | **required** | `.env` `GHCR_OWNER` / `IMAGE_TAG` (immutable tag, never `latest`). |
| `caddy_tls` | **required** | `.env` `CADDY_TLS` (ACME e-mail). |
| `session_secret` | **required, secret** | >= 32 chars. |
| `smtp_url` | **required when `mail_transport: smtp`, secret** | `smtp://` or `smtps://`. |
| `postgres_password`, `tocs_migrator_password`, `tocs_app_password` | **required, secret** | letters/digits, >= 16, all different. |
| `backup_age_recipient` | **required** | `age1...` public key. Passing `backup_age_identity` or an `AGE-SECRET-KEY` fails the play. |
| `site_address` / `app_base_url` | `register.to-cs.org` / `https://{{ site_address }}` | |
| `http_port` / `https_port` | `80` / `443` | preflight requires their port to be in `ufw_allowed_tcp_ports` (Docker publishes around ufw). |
| `allow_connecting_user_not_in_allowusers` | `false` | `true` skips the "connecting account must be admin_user/deploy" lock-out guard. |
| `preflight_require_admin_authorized_keys` | `true` | `false` skips the "admin_user has a non-empty authorized_keys" guard (certificates / AuthorizedKeysCommand). |
| `mail_transport`, `trust_proxy`, `log_level`, `postgres_user`, `postgres_db` | `smtp`, `1`, `info`, `postgres`, `tocs` | as in `.env.prod.example` |
| `backup_remote` | `""` | rclone destination for off-site copies. |
| `backup_retention_days` | `14` | local retention (1..3650). |
| `backup_rclone_config` | `""` | path of the rclone config (create it by hand, deploy-owned, 600). The backup unit runs with `ProtectSystem=strict`; when this is set, its **directory** is added to `ReadWritePaths` so rclone can save refreshed OAuth tokens (so put it in a dedicated directory, e.g. `/opt/tocs/rclone/rclone.conf`, not directly in `/opt/tocs`). Empty = `~deploy/.config/rclone`, already writable for the unit. |
| `backup_on_calendar` | `*-*-* 02:30:00 America/Los_Angeles` | systemd handles DST. |
| `backup_randomized_delay` | `5min` | |
| `backup_on_failure_unit` | `""` | optional `OnFailure=` unit (alerting you provide). |
| `ghcr_username`, `ghcr_token` | `""` | optional GHCR login for deploy (both or neither); `ghcr_force_login: true` to re-login after rotating. |
| `deploy_user`, `deploy_home` | `deploy`, `/home/deploy` | deploy.yml expects `deploy`. |
| `sshd_*` | MaxAuthTries 3, LoginGraceTime 30, ClientAliveInterval 300 x 2, ... | |
| `ufw_allowed_tcp_ports` | `[22, 80, 443]` | any other ufw rule on the host fails the play. |
| `fail2ban_sshd_maxretry` / `_findtime` / `_bantime` / `fail2ban_ignoreip` | `5` / `10m` / `1h` / localhost | add your static admin IP to `fail2ban_ignoreip`. |
| `unattended_upgrades_origins` | Ubuntu `-security` (+ ESM security) | `unattended_upgrades_automatic_reboot: false`. |
| `hardening_sysctl` | redirects/source routing off, syncookies, log martians | network-namespace settings only; `ip_forward` is left to Docker. |
| `docker_apt_key_fingerprint` | Docker's release key | change only after checking Docker's docs. |
| `preflight_supported_releases` | `["24.04"]` | other releases are refused (untested). |

## Safe rollout (do not lock yourself out)

The play sets `AllowUsers deploy <admin_user>`, `PasswordAuthentication no`, `PermitRootLogin no` and enables ufw
and fail2ban. A mistake in `admin_user` or the keys means no SSH access. `preflight` refuses to run when
`admin_user` does not exist or has no `authorized_keys`, but still:

1. Have **console access** (provider web console / rescue mode) before the first run.
2. Keep an **existing SSH session open** as the admin user while the play runs.
3. After the play, open a **second** session (`ssh <admin_user>@host`, and `ssh deploy@host true` with the deploy
   key) **before** closing the first. If it fails, fix it from the open session (`sudo rm
   /etc/ssh/sshd_config.d/00-tocs-hardening.conf && sudo systemctl reload ssh`, or `sudo ufw disable`).
4. Repeated failed logins from your address are banned for 1 h by fail2ban (`sudo fail2ban-client unban <ip>`);
   put a static admin address in `fail2ban_ignoreip`. **Offer exactly one key:** with `MaxAuthTries 3` and the
   aggressive sshd filter, an ssh-agent holding many keys burns the attempts on wrong keys, gets refused and, after
   a few connections, banned. Use `ssh -o IdentitiesOnly=yes -i ~/.ssh/<admin key>` (or `IdentitiesOnly yes` +
   `IdentityFile` in `~/.ssh/config`, and `ansible_ssh_private_key_file` in the inventory).
5. Connect as `admin_user` itself. `preflight` refuses to run when the connecting account (`ansible_user`, else the
   account sudo was invoked from, else the remote user) is not `admin_user` or `deploy`, because it could not log
   in again. Opt out only deliberately: `allow_connecting_user_not_in_allowusers: true`.
6. Pin the host key in your `known_hosts` and in the `DEPLOY_KNOWN_HOSTS` GitHub secret (`ssh-keyscan -t ed25519`,
   checked against the console fingerprint).

## First deploy (after the play)

1. DNS: `register.to-cs.org` A/AAAA records point at the host (ports 80/443 must reach Caddy for the certificate).
2. GHCR: either set `ghcr_username`/`ghcr_token`, or as deploy: `docker login ghcr.io` (token with `read:packages`).
3. **Restore the legacy baseline** (the production dump) before the first full `up` (the foundation migration fails
   on an empty database; see `backend/prisma/migrations/README.md`). As deploy in `/opt/tocs`:
   ```sh
   C="docker compose -p tocs --env-file .env -f compose.prod.yml"
   $C up -d postgres                       # first start of the empty volume runs init-roles.sql (creates roles)
   $C exec -T postgres pg_restore -U postgres -d tocs --no-owner --exit-on-error < legacy-production.dump
   $C exec -T postgres psql -U postgres -d tocs -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/10-init-roles.sql
   ```
   (the second `init-roles.sql` run hands the baseline tables to `tocs_migrator`). Delete the plaintext dump
   afterwards.
4. Start the stack: `$C up -d` (the `migrate` service applies migrations and grants, then api and caddy start).
   `curl -fsS https://register.to-cs.org/healthz` must return `{"status":"ok"}`.
5. Take a first backup and check it: `sudo systemctl start tocs-backup.service; ls -l /opt/tocs/backups`. Do a
   restore drill on another machine with the offline identity (`deploy/restore.sh`).
6. From now on deploys go through `.github/workflows/deploy.yml` (`/opt/tocs/deploy.sh <tag>` over SSH as deploy).

## Security notes and trade-offs

**Docker publishes ports around ufw.** Docker inserts its own iptables rules (`DOCKER`, `DOCKER-USER` chains) for
published ports; traffic to them never reaches ufw's INPUT rules, so `ufw deny` does **not** close a published
port. This is acceptable here because `compose.prod.yml` publishes only Caddy's 80/443 (asserted by
`deploy/test/stack.test.sh`), which ufw allows anyway, and postgres/api have no `ports:`. Never add `ports:` to
other services. If a published port must be restricted to certain sources, add rules to the `DOCKER-USER` chain
(e.g. via `/etc/ufw/after.rules`, the "ufw-docker" approach) rather than ufw allow/deny rules.

**The docker group is root-equivalent.** `deploy` must run `docker compose`, so it is in the `docker` group, which
lets it start a privileged container and become root. Mitigations: deploy logs in by key only, that key lives only
in the GitHub `production` environment, `AllowUsers` limits SSH to two accounts. Rootless Docker would remove this
but is out of scope (port 80/443 binding, systemd user services, backup/restore paths). Treat the deploy key like
a root credential.

**deploy owns `/opt/tocs` (known trade-off).** The scripts are `root:deploy 750`, so deploy cannot edit them in
place, but because the directory itself belongs to deploy, deploy can rename, delete or replace them. A sticky bit
(mode 1750) would **not** help: the sticky bit never restricts the directory's owner. Real protection would need a
root-owned `/opt/tocs` with a deploy-owned state subdirectory for `previous_tag` / `current_tag` / `.deploy.lock`
(a change to `deploy.sh`'s layout). It is not done because deploy is root-equivalent through the docker group
anyway, so this only guards against accidents. Nothing running as root executes files from `/opt/tocs` (the backup
service runs as deploy), and re-running the play restores the scripts.

**Backups.** The host holds only the age recipient (public key): it can write backups but not read them. The
identity (`AGE-SECRET-KEY-...`) stays offline (password manager / offline media), with at least two people able to
reach it. `tocs-backup.service` runs `backup.sh` as deploy with systemd sandboxing (read-only system and home,
writable only `/opt/tocs/backups` and deploy's docker/rclone dirs, no capabilities). If postgres is down or anything
fails it exits non-zero and the unit is marked failed (`systemctl --failed`, `journalctl -u tocs-backup.service`);
set `backup_on_failure_unit` to hook alerting. `deploy.sh` also takes a backup before every deploy.

**Updates.** unattended-upgrades installs Ubuntu security updates daily and never reboots. Check
`/var/run/reboot-required` and reboot in a quiet window (`live-restore` keeps containers up across Docker daemon
restarts; `restart: unless-stopped` brings them back after a reboot). Docker Engine (Docker's repo) is not
auto-upgraded on purpose: `sudo apt upgrade docker-ce ...` by hand.

**Why Docker's repository, not Ubuntu's `docker.io`.** Compose v2 and Engine versions track Docker's releases
(`compose.prod.yml` uses `service_completed_successfully`, `--wait` etc.); the key is pinned by fingerprint and the
source is restricted with `Signed-By`, so only Docker's key can sign that repository and it cannot sign Ubuntu's.

## Not automated (do by hand)

- DNS records; the provider firewall (allow 22/80/443 there too); console access.
- The admin account and its SSH key (created by the cloud image or by hand **before** the play).
- GHCR token creation/rotation (and the GitHub `production` environment secrets: `DEPLOY_HOST`, `DEPLOY_USER`,
  `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`).
- The off-site backup account, the rclone config file (`backup_rclone_config`, deploy-owned 600) and the remote's
  lifecycle/retention rules.
- Custody of the age identity and of the vault password; restore drills.
- The legacy baseline restore and the first `up` (above); reboots after kernel updates.

## Tests

`deploy/test/ansible-check.sh` (needs a local Docker engine and internet): ansible-lint (production profile) and
`--syntax-check`; negative runs (empty `session_secret`, non-`age1` recipient, placeholder passwords / `smtp_url` / `ghcr_token`,
`admin_user` missing / root / deploy / without keys / with empty keys, connecting as a user outside `AllowUsers`,
`http_port` not allowed by ufw) must fail in
`preflight` with `changed=0` on an untouched host; a full apply against a throwaway privileged systemd Ubuntu 24.04
container over SSH, with assertions on sshd (`sshd -T`, real logins: deploy/admin allowed, other users, root and
passwords refused), ufw (active, only 22/80/443), file owners/modes, docker, fail2ban (a real ban), unattended
upgrades, the timer, a real backup through `tocs-backup.service`, no `AGE-SECRET-KEY` on disk; then a second apply
must report `changed=0`. It cannot prove behaviour that needs a real VM (ufw/fail2ban against real traffic on a
public interface, reboots, real unattended-upgrade runs, GHCR login).
