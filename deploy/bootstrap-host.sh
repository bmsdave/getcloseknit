#!/usr/bin/env bash
# Prepare a fresh Ubuntu 24.04 host for Close Knit. Safe to run again.
#   sudo bash bootstrap-host.sh
# Installs Docker Engine + compose, unattended security upgrades and
# fail2ban (SSH bans growing to 4 weeks); adds 4 GB swap (12 GB hosts);
# opens only 22, 80, 443 (tcp) and 443/udp; turns off SSH passwords once the
# sudo user has an SSH key; and creates /srv/close-knit (code) and
# /srv/backups (production-data dumps).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "bootstrap: run with sudo" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
owner="${SUDO_USER:-root}"

apt-get update -q
apt-get -yq upgrade
apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
[ "$owner" != root ] && usermod -aG docker "$owner"

if ! swapon --show | grep -q '^/swapfile'; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker publishes ports past ufw, but the production overlay publishes only
# Caddy's 80/443, so ufw and compose agree.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

home="$(getent passwd "$owner" | cut -d: -f6)"
if [ -s "$home/.ssh/authorized_keys" ]; then
    # sshd keeps the first value it reads, and cloud images ship 50-cloud-init.conf
    # enabling passwords, so this drop-in must sort first.
    printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nX11Forwarding no\nMaxAuthTries 3\n' \
        > /etc/ssh/sshd_config.d/01-close-knit.conf
    # Ubuntu 24.04 starts sshd from ssh.socket; a reload only applies when
    # the service is running, otherwise the next connection reads the file.
    systemctl try-reload-or-restart ssh.service || true
fi

# SSH bots retry within minutes of Debian's 10-minute ban: 5 failures in an
# hour ban the IP for an hour, doubling on each repeat up to 4 weeks.
# Unban: fail2ban-client set sshd unbanip <ip>
printf '[sshd]\nenabled = true\nmaxretry = 5\nfindtime = 1h\nbantime = 1h\nbantime.increment = true\nbantime.factor = 2\nbantime.maxtime = 4w\n' \
    > /etc/fail2ban/jail.d/sshd-close-knit.conf

install -d -o "$owner" -g "$owner" /srv/close-knit /srv/close-knit-data /srv/backups
systemctl enable --now unattended-upgrades fail2ban >/dev/null
systemctl reload fail2ban
echo "bootstrap: done ($(docker --version); $(docker compose version | head -1))"
