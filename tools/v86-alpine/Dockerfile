FROM i386/alpine:3.20

ENV KERNEL=lts

# Install base system
RUN apk add --no-cache \
    openrc \
    alpine-base \
    agetty \
    alpine-conf \
    bash \
    coreutils \
    grep \
    sed \
    gawk \
    curl \
    wget \
    vim \
    nano \
    less \
    file \
    tar \
    gzip \
    unzip \
    patch \
    diffutils \
    findutils \
    util-linux \
    procps \
    net-tools \
    strace

# Install compilers and dev tools
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    make \
    python3 \
    py3-pip \
    nodejs \
    npm

# Install kernel
RUN apk add --no-cache \
    linux-lts \
    linux-firmware-none

# Install mkinitfs from edge (needed for 9p support)
RUN apk add --no-cache \
    mkinitfs \
    --repository https://dl-cdn.alpinelinux.org/alpine/edge/main/

# Build initramfs with 9p support
RUN mkinitfs -F "ata base ide scsi virtio ext4 9p" \
    $(cat /usr/share/kernel/$KERNEL/kernel.release)

# Configure serial console auto-login
RUN sed -i 's/^tty1/#tty1/' /etc/inittab && \
    echo 'ttyS0::respawn:/sbin/agetty -a root -L ttyS0 115200 vt100' >> /etc/inittab

# Disable unnecessary services
RUN rc-update del networking boot 2>/dev/null; \
    rc-update del hwclock boot 2>/dev/null; \
    rc-update del hwdrivers sysinit 2>/dev/null; \
    rc-update del modloop sysinit 2>/dev/null; \
    true

# Set hostname
RUN echo "sandbox" > /etc/hostname

# Create a welcome message
RUN cat > /etc/motd << 'MOTD'

  ╔══════════════════════════════════════╗
  ║     Enclave Station Sandbox         ║
  ║     Alpine Linux (v86 emulator)     ║
  ╚══════════════════════════════════════╝

  gcc, g++, python3, node, npm available.
  Type 'help' for a list of commands.

MOTD

# Set up PATH and shell
RUN echo 'export PS1="\[\033[1;32m\]sandbox\[\033[0m\]:\[\033[1;34m\]\w\[\033[0m\]$ "' >> /etc/profile
RUN echo 'export TERM=xterm-256color' >> /etc/profile

CMD ["/bin/sh"]
