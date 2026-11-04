#!/usr/bin/env bash
# Tests for the host-hardening playbook (deploy/ansible). LOCAL ONLY: never touches a real host.
#
#   deploy/test/ansible-check.sh            (run from anywhere; needs a local Docker engine and internet access)
#
# 1. lint + syntax: ansible-lint and `ansible-playbook --syntax-check` in a pinned controller container
#    (deploy/test/Dockerfile.ansible-controller).
# 2. A throwaway privileged systemd Ubuntu 24.04 container (deploy/test/Dockerfile.ansible-host) plays the "fresh
#    host". The controller connects to it over SSH as the admin user, exactly like a real run.
# 3. Negative tests on the still-fresh host: invalid / placeholder secrets must fail in the preflight assertions with
#    changed=0 and nothing on the host changed.
# 4. Apply with throwaway test values (generated here: SSH keys, an age recipient whose identity is deleted at once,
#    random passwords); assert sshd, SSH logins, ufw, file ownership/modes, docker, fail2ban, unattended-upgrades,
#    the backup timer/service (also a real backup against a postgres started from compose.prod.yml), no age identity
#    on disk.
# 5. Idempotency: a second apply must report changed=0.
# 6. No generated secret appears in any captured output.
# Every Docker object is named tocs-ans-test-* and removed on exit (base images only if this run pulled them;
# ANSIBLE_CHECK_KEEP_IMAGES=1 keeps the built images for faster reruns).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREFIX=tocs-ans-test
NET="$PREFIX-net"
HOST="$PREFIX-host"
CTL_NAME="$PREFIX-ctl"
CTRL_IMG="$PREFIX-controller:local"
HOST_IMG="$PREFIX-host:local"
DOCKER_VOL="$PREFIX-dockerlib"
CONTAINERD_VOL="$PREFIX-containerd"
BASE_IMAGES=(python:3.12-slim-bookworm ubuntu:24.04)
INV_HOST=tocs-test
FAILURES=0

pass() { printf 'PASS: %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*"
  FAILURES=$((FAILURES + 1))
}
info() { printf '\n== %s\n' "$*"; }

PULLED_BASE=()
for img in "${BASE_IMAGES[@]}"; do
  docker image inspect "$img" >/dev/null 2>&1 || PULLED_BASE+=("$img")
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tocs-ans-test.XXXXXX")"
chmod 700 "$WORK"

cleanup() {
  set +e
  docker rm -f "$CTL_NAME" "$HOST" >/dev/null 2>&1
  if docker image inspect "$CTRL_IMG" >/dev/null 2>&1; then
    # Files written by the (root) controller container: remove them with the same image.
    docker run --rm -v "$WORK:/work" --entrypoint sh "$CTRL_IMG" -c 'rm -rf /work/* /work/.[!.]* 2>/dev/null' >/dev/null 2>&1
  fi
  rm -rf "$WORK"
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$DOCKER_VOL" "$CONTAINERD_VOL" >/dev/null 2>&1
  if [ "${ANSIBLE_CHECK_KEEP_IMAGES:-0}" != 1 ]; then
    docker image rm "$CTRL_IMG" "$HOST_IMG" >/dev/null 2>&1
    for img in "${PULLED_BASE[@]}"; do docker image rm "$img" >/dev/null 2>&1; done
  fi
}
trap cleanup EXIT

# Run a command in a fresh controller container (repo deploy/ read-only, work dir read-write).
ctl() {
  docker run --rm --name "$CTL_NAME" --network "$NET" \
    -v "$REPO_ROOT/deploy:/repo/deploy:ro" -v "$WORK:/work" \
    -e ANSIBLE_HOST_KEY_CHECKING=False -e ANSIBLE_ROLES_PATH=/repo/deploy/ansible/roles \
    "$CTRL_IMG" "$@"
}
# Run a shell snippet as root on the test host.
hx() { docker exec "$HOST" bash -c "$1"; }
# check <description> <shell snippet run on the host>
check() {
  if hx "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi
}
# Ansible run: playbook <log name> [extra args...]; sets RC.
playbook() {
  local log="$WORK/$1.log"
  shift
  RC=0
  ctl ansible-playbook -i /work/inventory.ini /repo/deploy/ansible/site.yml -e @/work/vars.yml "$@" >"$log" 2>&1 || RC=$?
}
recap() { grep -E "^$INV_HOST +:" "$WORK/$1.log" | tail -n1 || true; }
changed_count() { recap "$1" | sed -nE 's/.* changed=([0-9]+).*/\1/p'; }
changed_tasks() { awk '/^TASK \[/{t=$0} /^changed: /{print "  " t}' "$WORK/$1.log" | sort -u; }

info "build images"
docker network create "$NET" >/dev/null
docker build -q -t "$CTRL_IMG" -f "$REPO_ROOT/deploy/test/Dockerfile.ansible-controller" "$REPO_ROOT/deploy/test" >/dev/null
docker build -q -t "$HOST_IMG" -f "$REPO_ROOT/deploy/test/Dockerfile.ansible-host" "$REPO_ROOT/deploy/test" >/dev/null
pass "controller and host images built"

# ---------------------------------------------------------------------------------------------------------------
info "1. ansible-lint and syntax check"
if ctl sh -c 'cd /repo/deploy/ansible && ansible-lint --offline site.yml' >"$WORK/lint.log" 2>&1; then
  pass "ansible-lint"
else
  fail "ansible-lint"
  tail -n 40 "$WORK/lint.log"
fi
printf '[tocs]\nlocalhost ansible_connection=local\n' >"$WORK/syntax.ini"
if ctl ansible-playbook -i /work/syntax.ini --syntax-check /repo/deploy/ansible/site.yml >"$WORK/syntax.log" 2>&1; then
  pass "ansible-playbook --syntax-check"
else
  fail "ansible-playbook --syntax-check"
  tail -n 20 "$WORK/syntax.log"
  echo "FAILURES: $FAILURES (syntax check failed; the playbook cannot be applied)"
  exit 1
fi

# ---------------------------------------------------------------------------------------------------------------
info "2. start the fresh test host and generate throwaway test values"
docker volume create "$DOCKER_VOL" >/dev/null
docker volume create "$CONTAINERD_VOL" >/dev/null
docker run -d --name "$HOST" --hostname "$HOST" --network "$NET" \
  --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock \
  -v "$DOCKER_VOL:/var/lib/docker" -v "$CONTAINERD_VOL:/var/lib/containerd" "$HOST_IMG" >/dev/null
state=""
for _ in $(seq 1 60); do
  state="$(docker exec "$HOST" systemctl is-system-running 2>/dev/null || true)"
  case "$state" in running | degraded) break ;; esac
  sleep 1
done
case "$state" in
  running | degraded) pass "systemd is up in the test host ($state)" ;;
  *)
    fail "systemd did not start in the test host (state: ${state:-none})"
    exit 1
    ;;
esac
if hx 'python3 -c "import urllib.request; urllib.request.urlopen(\"https://download.docker.com/linux/ubuntu/gpg\", timeout=20)"' >/dev/null 2>&1; then
  pass "test host reaches download.docker.com"
else
  fail "test host cannot reach https://download.docker.com (Docker's apt repo): this test needs internet access"
  exit 1
fi

ctl sh -c '
  set -eu
  umask 077
  mkdir -p /work/keys
  ssh-keygen -q -t ed25519 -N "" -C tocs-ans-test-admin -f /work/keys/admin
  ssh-keygen -q -t ed25519 -N "" -C tocs-ans-test-deploy -f /work/keys/deploy
  # Real age key pair; only the recipient is kept, the identity is deleted immediately.
  age-keygen -o /work/keys/age.identity 2>/dev/null
  age-keygen -y /work/keys/age.identity >/work/keys/age.recipient
  rm -f /work/keys/age.identity
  python3 - <<'"'"'PY'"'"'
import json, secrets
rcpt = open("/work/keys/age.recipient").read().strip()
deploy_pub = open("/work/keys/deploy.pub").read().strip()
smtp_pw = secrets.token_hex(16)
v = {
    "admin_user": "opsadmin",
    "deploy_ssh_public_keys": [deploy_pub],
    "ghcr_owner": "tocs-test-owner",
    "image_tag": "test-0000000",
    "site_address": "tocs-test.invalid",
    "app_base_url": "https://tocs-test.invalid",
    "caddy_tls": "internal",
    "session_secret": secrets.token_hex(32),
    "smtp_url": "smtps://mailer:%s@smtp.tocs-test.invalid:465" % smtp_pw,
    "postgres_password": secrets.token_hex(24),
    "tocs_migrator_password": secrets.token_hex(24),
    "tocs_app_password": secrets.token_hex(24),
    "backup_age_recipient": rcpt,
}
json.dump(v, open("/work/vars.yml", "w"), indent=2)
with open("/work/secrets.txt", "w") as f:
    for k in ("session_secret", "postgres_password", "tocs_migrator_password", "tocs_app_password"):
        f.write(v[k] + "\n")
    f.write(smtp_pw + "\n")
json.dump({"session_secret": ""}, open("/work/bad-session.yml", "w"))
json.dump({"backup_age_recipient": "ssh-ed25519-not-an-age-key"}, open("/work/bad-recipient.yml", "w"))
json.dump({"postgres_password": "replacewithagenuinepassword1234567"}, open("/work/bad-placeholder.yml", "w"))
json.dump({"postgres_password": "changemechangemechangeme12"}, open("/work/bad-changeme.yml", "w"))
PY
  # Hand the files to the user running this script (modes stay 600/700).
  chown -R '"$(id -u):$(id -g)"' /work
'
if [ -s "$WORK/keys/age.recipient" ] && [ ! -e "$WORK/keys/age.identity" ] && grep -q '^age1' "$WORK/keys/age.recipient"; then
  pass "throwaway age recipient generated; identity deleted"
else
  fail "age recipient generation"
fi

docker cp "$WORK/keys/admin.pub" "$HOST:/home/opsadmin/.ssh/authorized_keys"
docker cp "$WORK/keys/admin.pub" "$HOST:/home/outsider/.ssh/authorized_keys"
hx 'install -d -m 700 /root/.ssh && cp /home/opsadmin/.ssh/authorized_keys /root/.ssh/authorized_keys &&
    chown opsadmin:opsadmin /home/opsadmin/.ssh/authorized_keys && chown outsider:outsider /home/outsider/.ssh/authorized_keys &&
    chmod 600 /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys'
cat >"$WORK/inventory.ini" <<EOF
[tocs]
$INV_HOST ansible_host=$HOST ansible_user=opsadmin ansible_ssh_private_key_file=/work/keys/admin ansible_ssh_common_args='-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'
EOF

SSH_OPTS='-o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR'
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/admin opsadmin@$HOST true" >/dev/null 2>&1; then
  pass "admin can SSH into the fresh host"
else
  fail "admin cannot SSH into the fresh host"
  exit 1
fi

# ---------------------------------------------------------------------------------------------------------------
info "3. negative tests: invalid variables fail in preflight, before anything changes"
neg() { # neg <name> <override file> <expected message fragment>
  playbook "neg-$1" -e "@/work/$2"
  if [ "$RC" -ne 0 ] && grep -qF "$3" "$WORK/neg-$1.log" && [ "$(changed_count "neg-$1")" = 0 ] &&
    ! grep -qE '^TASK \[(hardening|docker|app) :' "$WORK/neg-$1.log"; then
    pass "invalid $1 rejected by preflight (rc=$RC, changed=0, no role task ran)"
  else
    fail "invalid $1 was not rejected by preflight as expected (rc=$RC, $(recap "neg-$1"))"
    grep -E '^(TASK|fatal|failed)' "$WORK/neg-$1.log" | tail -n 10
  fi
}
neg session_secret bad-session.yml "session_secret must be"
neg backup_age_recipient bad-recipient.yml "backup_age_recipient must be"
neg placeholder_password bad-placeholder.yml "postgres_password looks like placeholder text"
neg changeme_password bad-changeme.yml "postgres_password looks like placeholder text"
check "host unchanged after negative runs (no deploy user, no /opt/tocs, no sshd drop-in, ufw not installed)" \
  '! id deploy && [ ! -e /opt/tocs ] && [ ! -e /etc/ssh/sshd_config.d/00-tocs-hardening.conf ] && ! command -v ufw'

# ---------------------------------------------------------------------------------------------------------------
info "4. first apply"
playbook run1
echo "recap: $(recap run1)"
if [ "$RC" -eq 0 ] && recap run1 | grep -q 'failed=0' && recap run1 | grep -q 'unreachable=0'; then
  pass "first apply succeeded"
else
  fail "first apply failed (rc=$RC)"
  grep -E -A12 '^(fatal|failed):' "$WORK/run1.log" | head -n 60
  echo "FAILURES: $FAILURES"
  exit 1
fi

info "4a. sshd"
SSHD_T="$(hx 'sshd -T 2>/dev/null' || true)"
for want in 'permitrootlogin no' 'passwordauthentication no' 'kbdinteractiveauthentication no' 'x11forwarding no' \
  'maxauthtries 3' 'clientaliveinterval 300' 'allowusers deploy' 'allowusers opsadmin' 'pubkeyauthentication yes' \
  'permitemptypasswords no' 'allowtcpforwarding no' 'allowagentforwarding no'; do
  if grep -qx "$want" <<<"$SSHD_T"; then pass "sshd -T: $want"; else fail "sshd -T: expected '$want'"; fi
done
if [ "$(grep -c '^allowusers ' <<<"$SSHD_T")" -eq 2 ]; then pass "sshd -T: AllowUsers is exactly deploy + admin"; else fail "sshd -T: unexpected AllowUsers set"; fi
check "drop-in 00-tocs-hardening.conf root:root 644" '[ "$(stat -c "%U:%G %a" /etc/ssh/sshd_config.d/00-tocs-hardening.conf)" = "root:root 644" ]'
check "a later cloud-init drop-in cannot re-enable password auth" \
  'printf "PasswordAuthentication yes\nKbdInteractiveAuthentication yes\nPermitRootLogin yes\n" >/etc/ssh/sshd_config.d/50-cloud-init.conf &&
   out="$(sshd -T)"; rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf;
   grep -qx "passwordauthentication no" <<<"$out" && grep -qx "permitrootlogin no" <<<"$out" && grep -qx "kbdinteractiveauthentication no" <<<"$out"'

info "4b. SSH logins (through ufw, after hardening)"
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/deploy deploy@$HOST 'id -nG'" >"$WORK/ssh-deploy.log" 2>&1 && grep -qw docker "$WORK/ssh-deploy.log"; then
  pass "deploy logs in with its key and is in the docker group"
else
  fail "deploy key login (or docker group membership)"
  cat "$WORK/ssh-deploy.log"
fi
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/deploy deploy@$HOST 'docker compose version && test -r /opt/tocs/.env'" >/dev/null 2>&1; then
  pass "deploy (over SSH) runs docker compose and reads /opt/tocs/.env"
else
  fail "deploy (over SSH) cannot run docker compose / read .env"
fi
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/admin opsadmin@$HOST true" >/dev/null 2>&1; then pass "admin still logs in"; else fail "admin locked out"; fi
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/admin outsider@$HOST true" >/dev/null 2>&1; then fail "user outside AllowUsers logged in"; else pass "user outside AllowUsers (valid key) rejected"; fi
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/admin root@$HOST true" >/dev/null 2>&1; then fail "root logged in"; else pass "root login (valid key) rejected"; fi
ctl sh -c "ssh $SSH_OPTS -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive opsadmin@$HOST true" >"$WORK/ssh-pw.log" 2>&1 || true
if grep -q 'Permission denied (publickey)' "$WORK/ssh-pw.log"; then pass "server offers publickey only (no password / keyboard-interactive)"; else fail "server still offers non-key authentication"; cat "$WORK/ssh-pw.log"; fi

info "4b'. fail2ban really bans (the attempts above may already have banned controller addresses: start clean)"
hx 'fail2ban-client unban --all' >/dev/null 2>&1 || true
# One controller container = one source address: 8 refused logins, then even the admin's valid key must be blocked.
ctl sh -c "for i in 1 2 3 4 5 6 7 8; do ssh $SSH_OPTS -i /work/keys/admin outsider@$HOST true >/dev/null 2>&1; done
  sleep 3
  hostname -i >/work/banned-ip
  if ssh $SSH_OPTS -i /work/keys/admin opsadmin@$HOST true >/dev/null 2>&1; then echo reachable >/work/ban-result; else echo blocked >/work/ban-result; fi" || true
BANNED_IP="$(tr -d ' \n' <"$WORK/banned-ip" 2>/dev/null || true)"
if [ -n "$BANNED_IP" ] && hx "fail2ban-client status sshd | grep 'Banned IP list' | grep -qw '$BANNED_IP'" && [ "$(cat "$WORK/ban-result" 2>/dev/null)" = blocked ]; then
  pass "fail2ban banned the source of repeated refused logins (even a valid key is then blocked)"
else
  fail "fail2ban did not ban after repeated refused logins (result: $(cat "$WORK/ban-result" 2>/dev/null))"
  hx 'fail2ban-client status sshd' || true
fi
hx 'fail2ban-client unban --all' >/dev/null 2>&1 || true
if ctl sh -c "ssh $SSH_OPTS -i /work/keys/admin opsadmin@$HOST true" >/dev/null 2>&1; then pass "admin logs in again after unban"; else fail "admin cannot log in after unban"; fi

info "4c. ufw"
UFW_STATUS="$(hx 'ufw status verbose' || true)"
if grep -q '^Status: active' <<<"$UFW_STATUS"; then pass "ufw is active"; else fail "ufw is not active"; fi
if grep -q '^Default: deny (incoming), allow (outgoing)' <<<"$UFW_STATUS"; then pass "ufw default deny incoming, allow outgoing"; else fail "ufw defaults"; fi
RULES="$(hx 'ufw show added' | grep '^ufw ' | sort || true)"
EXPECTED_RULES="$(printf 'ufw allow 22/tcp\nufw allow 443/tcp\nufw allow 80/tcp\n')"
if [ "$RULES" = "$EXPECTED_RULES" ]; then pass "ufw rules are exactly 22/tcp, 80/tcp, 443/tcp"; else fail "ufw rules: $(tr '\n' ';' <<<"$RULES")"; fi
ALLOW_IN="$(grep 'ALLOW IN' <<<"$UFW_STATUS" | awk '{print $1}' | sort -u | tr '\n' ' ')"
if [ "$ALLOW_IN" = "22/tcp 443/tcp 80/tcp " ]; then pass "ufw status: ALLOW IN only for 22/80/443 (v4+v6)"; else fail "ufw status ALLOW IN: $ALLOW_IN"; fi

info "4d. /opt/tocs layout"
mode_is() { check "$1 is $2" "[ \"\$(stat -c '%U:%G %a' $1)\" = '$2' ]"; }
mode_is /opt/tocs 'deploy:deploy 750'
mode_is /opt/tocs/.env 'deploy:deploy 600'
mode_is /opt/tocs/backup.env 'deploy:deploy 600'
mode_is /opt/tocs/backups 'deploy:deploy 700'
mode_is /opt/tocs/deploy.sh 'root:deploy 750'
mode_is /opt/tocs/backup.sh 'root:deploy 750'
mode_is /opt/tocs/restore.sh 'root:deploy 750'
mode_is /opt/tocs/compose.prod.yml 'root:deploy 640'
mode_is /opt/tocs/db 'root:deploy 750'
mode_is /opt/tocs/db/init-roles.sql 'root:deploy 644'
mode_is /home/deploy/.ssh/authorized_keys 'deploy:deploy 600'
for f in deploy.sh backup.sh restore.sh compose.prod.yml db/init-roles.sql; do
  if [ "$(sha256sum <"$REPO_ROOT/deploy/$f" | cut -d' ' -f1)" = "$(hx "sha256sum </opt/tocs/$f" | cut -d' ' -f1)" ]; then
    pass "/opt/tocs/$f matches deploy/$f"
  else
    fail "/opt/tocs/$f differs from deploy/$f"
  fi
done
check "authorized_keys of deploy holds exactly the configured key" \
  "[ \"\$(cat /home/deploy/.ssh/authorized_keys)\" = '$(cat "$WORK/keys/deploy.pub")' ]"
check "deploy password is locked" '[ "$(passwd -S deploy | cut -d" " -f2)" = L ]'
check "deploy can read .env; admin (non-root) cannot" 'sudo -u deploy test -r /opt/tocs/.env && ! sudo -u opsadmin cat /opt/tocs/.env'
check "deploy cannot modify the installed scripts" '! sudo -u deploy sh -c "echo x >>/opt/tocs/deploy.sh"'
check ".env has every key of .env.prod.example, no placeholder text" \
  'for k in GHCR_OWNER IMAGE_TAG SITE_ADDRESS CADDY_TLS HTTP_PORT HTTPS_PORT APP_BASE_URL SESSION_SECRET MAIL_TRANSPORT SMTP_URL TRUST_PROXY LOG_LEVEL POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD TOCS_MIGRATOR_PASSWORD TOCS_APP_PASSWORD; do grep -q "^$k=" /opt/tocs/.env || exit 1; done; ! grep -qiE "replace-with|changeme" /opt/tocs/.env'
EXAMPLE_KEYS="$(grep -oE '^[A-Z_]+=' "$REPO_ROOT/deploy/.env.prod.example" | sort | tr -d '=' | tr '\n' ' ')"
ENV_KEYS="$(hx "grep -oE '^[A-Z_]+=' /opt/tocs/.env | sort | tr -d '=' | tr '\n' ' '")"
if [ "$EXAMPLE_KEYS" = "$ENV_KEYS" ]; then pass ".env keys == .env.prod.example keys"; else fail ".env keys differ from .env.prod.example"; fi
check "compose accepts the rendered .env (docker compose config as deploy)" \
  'cd /opt/tocs && sudo -u deploy docker compose -p tocs --env-file .env -f compose.prod.yml config --quiet'
check "backup.env holds the recipient and retention, parsed keys only" \
  'grep -qE "^BACKUP_AGE_RECIPIENT=.?age1[0-9a-z]+" /opt/tocs/backup.env && grep -qE "^BACKUP_RETENTION_DAYS=.?14" /opt/tocs/backup.env'
check "no age identity (AGE-SECRET-KEY) anywhere under /opt/tocs, /etc, /home, /root" \
  '! grep -rlas "AGE-SECRET-KEY" /opt/tocs /etc /home /root'

info "4e. docker"
check "docker apt repo signed-by the pinned key" 'grep -qx "Signed-By: /etc/apt/keyrings/docker.asc" /etc/apt/sources.list.d/docker.sources'
check "docker key fingerprint is 9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88" \
  'gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc 2>/dev/null | grep "^fpr:" | head -n1 | grep -q ":9DC858229FC7DD38854AE2D88D81803C0EBFCD88:"'
check "docker-ce and docker-compose-plugin come from download.docker.com" \
  'apt-cache policy docker-ce docker-compose-plugin | grep -A1 "\*\*\*" | grep -q download.docker.com'
check "docker.service enabled and active" 'systemctl is-enabled docker && systemctl is-active docker'
check "deploy runs docker compose version" 'sudo -u deploy docker compose version'
check "deploy talks to the daemon (docker info)" 'sudo -u deploy docker info --format "{{.ServerVersion}}"'
check "daemon.json: log rotation, live-restore, no-new-privileges" \
  'python3 -c "import json;d=json.load(open(\"/etc/docker/daemon.json\"));assert d[\"log-opts\"][\"max-size\"] and d[\"live-restore\"] is True and d[\"no-new-privileges\"] is True"'

info "4f. fail2ban, unattended-upgrades, sysctl, packages"
check "fail2ban active with the sshd jail" 'systemctl is-active fail2ban && fail2ban-client status sshd | grep -q "Status for the jail: sshd"'
check "fail2ban sshd jail uses the systemd backend, maxretry 5" \
  'fail2ban-client -d 2>/dev/null | grep -qF "['"'"'add'"'"', '"'"'sshd'"'"', '"'"'systemd'"'"']" && [ "$(fail2ban-client get sshd maxretry)" = 5 ]'
APT_DUMP="$(hx 'apt-config dump' || true)"
if grep -q 'Unattended-Upgrade::Allowed-Origins:: "${distro_id}:${distro_codename}-security";' <<<"$APT_DUMP" &&
  ! grep -q 'Unattended-Upgrade::Allowed-Origins:: "${distro_id}:${distro_codename}";' <<<"$APT_DUMP" &&
  ! grep -q 'Allowed-Origins:: "${distro_id}:${distro_codename}-updates";' <<<"$APT_DUMP"; then
  pass "unattended-upgrades: security origins only"
else
  fail "unattended-upgrades allowed origins"
  grep 'Allowed-Origins' <<<"$APT_DUMP"
fi
if grep -q 'Unattended-Upgrade::Automatic-Reboot "false";' <<<"$APT_DUMP" && grep -q 'APT::Periodic::Unattended-Upgrade "1";' <<<"$APT_DUMP" &&
  grep -q 'APT::Periodic::Update-Package-Lists "1";' <<<"$APT_DUMP"; then
  pass "unattended-upgrades enabled, automatic reboot off"
else
  fail "unattended-upgrades periodic / reboot settings"
fi
check "apt-daily(-upgrade) timers enabled" 'systemctl is-enabled apt-daily.timer && systemctl is-enabled apt-daily-upgrade.timer'
check "sysctl: redirects and source routes refused" \
  '[ "$(sysctl -n net.ipv4.conf.all.accept_redirects)" = 0 ] && [ "$(sysctl -n net.ipv4.conf.all.send_redirects)" = 0 ] && [ "$(sysctl -n net.ipv4.conf.all.accept_source_route)" = 0 ]'
check "age, rclone, curl, jq installed" 'command -v age && command -v rclone && command -v curl && command -v jq'

info "4g. backup timer and service"
check "tocs-backup.timer enabled and active" 'systemctl is-enabled tocs-backup.timer && systemctl is-active tocs-backup.timer'
check "tocs-backup.timer listed by systemctl list-timers" 'systemctl list-timers --all --no-pager | grep -q tocs-backup.timer'
check "timer fires daily at 02:30 America/Los_Angeles, persistent" \
  'systemctl cat tocs-backup.timer | grep -qx "OnCalendar=\*-\*-\* 02:30:00 America/Los_Angeles" && [ "$(systemctl show -p Persistent --value tocs-backup.timer)" = yes ] &&
   systemd-analyze calendar "*-*-* 02:30:00 America/Los_Angeles" >/dev/null'
check "systemd-analyze verify passes on both units" \
  'systemd-analyze verify /etc/systemd/system/tocs-backup.service /etc/systemd/system/tocs-backup.timer'
check "service runs as deploy with sandboxing" \
  '[ "$(systemctl show -p User --value tocs-backup.service)" = deploy ] && [ "$(systemctl show -p ProtectSystem --value tocs-backup.service)" = strict ] &&
   [ "$(systemctl show -p NoNewPrivileges --value tocs-backup.service)" = yes ] && [ "$(systemctl show -p PrivateTmp --value tocs-backup.service)" = yes ]'
if hx 'systemctl start tocs-backup.service' >/dev/null 2>&1; then
  fail "backup service succeeded although the stack is not running"
else
  if hx '[ "$(systemctl show -p Result --value tocs-backup.service)" = exit-code ] && journalctl -u tocs-backup.service --no-pager | grep -q "backup: ERROR: cannot reach the postgres service"'; then
    pass "backup service fails loudly (non-zero, Result=exit-code, error in journal) while postgres is down"
  else
    fail "backup service failure mode"
    hx 'journalctl -u tocs-backup.service --no-pager | tail -n 15' || true
  fi
fi
info "4h. real backup through the systemd unit (postgres from compose.prod.yml in the host's docker)"
if hx 'cd /opt/tocs && sudo -u deploy docker compose -p tocs --env-file .env -f compose.prod.yml up -d --wait postgres' >"$WORK/pg-up.log" 2>&1; then
  hx 'systemctl reset-failed tocs-backup.service' || true
  if hx 'systemctl start tocs-backup.service'; then
    pass "tocs-backup.service succeeded against the running postgres"
  else
    fail "tocs-backup.service failed against the running postgres"
    hx 'journalctl -u tocs-backup.service --no-pager | tail -n 20' || true
  fi
  check "backup artifact: deploy-owned, mode 600, age-encrypted, checksum ok" \
    'cd /opt/tocs/backups && f="$(ls -1 tocs-*.dump.age | tail -n1)" && [ -n "$f" ] && [ "$(stat -c "%U %a" "$f")" = "deploy 600" ] &&
     [ "$(head -c 21 "$f")" = age-encryption.org/v1 ] && sha256sum -c "$f.sha256" >/dev/null'
  hx 'cd /opt/tocs && sudo -u deploy docker compose -p tocs --env-file .env -f compose.prod.yml down -v --rmi all' >/dev/null 2>&1 || true
else
  fail "could not start postgres from compose.prod.yml inside the test host"
  tail -n 15 "$WORK/pg-up.log"
fi

# ---------------------------------------------------------------------------------------------------------------
info "5. second apply (idempotency)"
# Earlier refused-login tests must not leave the controller banned.
hx "fail2ban-client unban --all" >/dev/null 2>&1 || true
playbook run2
echo "recap: $(recap run2)"
if [ "$RC" -eq 0 ] && [ "$(changed_count run2)" = 0 ] && recap run2 | grep -q 'failed=0'; then
  pass "second apply: changed=0"
else
  fail "second apply not idempotent (rc=$RC); changed tasks:"
  changed_tasks run2
fi

# ---------------------------------------------------------------------------------------------------------------
info "6. no generated secret in any captured output"
if grep -rqF -f "$WORK/secrets.txt" "$WORK"/*.log; then
  fail "a generated secret appears in captured output"
else
  pass "no generated secret in playbook / test output"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "ansible-check: ALL PASSED"
else
  echo "ansible-check: FAILURES: $FAILURES"
  exit 1
fi
