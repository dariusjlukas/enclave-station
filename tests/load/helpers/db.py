"""Direct database access for post-run validation.

Uses psycopg2 to query PostgreSQL and verify data integrity after
load tests complete.
"""

import os

import psycopg2


def get_pg_dsn():
    """Build PostgreSQL connection string from environment variables."""
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5433")
    user = os.environ.get("POSTGRES_USER", "chatapp_test")
    password = os.environ.get("POSTGRES_PASSWORD", "testpassword")
    db = os.environ.get("POSTGRES_DB", "chatapp_test")
    return f"host={host} port={port} dbname={db} user={user} password={password}"


def count_messages(dsn=None, channel_id=None):
    """Count messages, optionally filtered by channel."""
    if dsn is None:
        dsn = get_pg_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    if channel_id:
        cur.execute(
            "SELECT COUNT(*) FROM messages WHERE channel_id = %s AND NOT is_deleted",
            (channel_id,))
    else:
        cur.execute("SELECT COUNT(*) FROM messages WHERE NOT is_deleted")
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count


def count_users(dsn=None):
    """Count total registered users."""
    if dsn is None:
        dsn = get_pg_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM users")
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count


def verify_no_duplicate_messages(dsn=None, channel_id=None):
    """Check for duplicate message IDs. Returns list of duplicate IDs."""
    if dsn is None:
        dsn = get_pg_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    if channel_id:
        cur.execute("""
            SELECT id, COUNT(*) FROM messages
            WHERE channel_id = %s
            GROUP BY id HAVING COUNT(*) > 1
        """, (channel_id,))
    else:
        cur.execute("""
            SELECT id, COUNT(*) FROM messages
            GROUP BY id HAVING COUNT(*) > 1
        """)
    dupes = cur.fetchall()
    cur.close()
    conn.close()
    return dupes


def verify_no_orphaned_messages(dsn=None):
    """Check for messages referencing non-existent channels."""
    if dsn is None:
        dsn = get_pg_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*) FROM messages m
        LEFT JOIN channels c ON m.channel_id = c.id
        WHERE c.id IS NULL
    """)
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count
