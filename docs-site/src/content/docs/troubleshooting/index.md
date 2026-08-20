---
title: Troubleshooting
description: What the troubleshooting pages will cover, and the two problems that already have answers elsewhere in these docs.
---

This section will hold five pages: Docker not being detected, credential and keychain problems,
the "a required command-line tool is missing" message, SQL conversion failing when Python is not
found, and connection failures or dropped SSH tunnels.

They are not written yet. Two of the five already have their answers elsewhere in these docs:

- **"A required command-line tool is missing."** Joinery's PostgreSQL and MySQL backup and
  restore shell out to `pg_dump`, `pg_restore`, `mysqldump` and `mysql`, which are not bundled.
  The per-platform install commands are on
  [Prerequisites](../getting-started/prerequisites/#host-cli-tools-for-postgresql-and-mysql-backup-and-restore).
  Restart Joinery afterwards — it inherits its PATH from the process that launched it.
- **SQL conversion fails, or Python is not found.** Dialect conversion spawns `python3` and needs
  four packages installed; see
  [Prerequisites](../getting-started/prerequisites/#python-and-sqlglot-for-sql-dialect-conversion).
  On Windows this currently fails with a startup error rather than a "install Python" message.

For a dropped SSH tunnel, [Connect over an SSH
tunnel](../getting-started/connect-ssh/#dropped-connections-and-idle-timeouts) explains the
keepalive behaviour and what Joinery does when a tunnel dies.

If none of that helps, the output panel (**⌘J**) logs every statement Joinery runs with its SQL,
and its toolbar can reveal the log file on disk. Attach that to a
[bug report](https://github.com/cadam11/joinery/issues).
