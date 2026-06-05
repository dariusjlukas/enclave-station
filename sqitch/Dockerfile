# Migrations image: the canonical sqitch project (this directory) bundled on top
# of the official sqitch runtime. Running this image applies the schema to a
# target database, exactly as the docker-compose `sqitch` service does — but as
# a self-contained, versioned artifact suitable for a Kubernetes Job.
#
# Build context is this `sqitch/` directory:
#   docker build -t ghcr.io/<owner>/<repo>/migrations:<tag> sqitch/
#
# Run (deploy + verify) against a target:
#   docker run --rm -e SQITCH_TARGET="db:pg://user:pass@host:5432/db" \
#     ghcr.io/<owner>/<repo>/migrations:<tag> deploy --verify
FROM sqitch/sqitch:latest

# The sqitch project (sqitch.conf, sqitch.plan, deploy/, verify/, revert/).
COPY . /repo
WORKDIR /repo

# sqitch/sqitch's entrypoint is `sqitch`; the default command applies the schema.
# Override the command (e.g. `verify`, `status`, `revert`) as needed.
CMD ["deploy", "--verify"]
