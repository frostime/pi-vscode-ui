---
name: cross-harness-mail
description: Use the filesystem to simulate mail, enabling communication between AGENTs in projects across Harnesses; use when the user explicitly needs two AGENTs without communication means to perform simple communication
---

AGENT-to-AGENT communication, especially simple communication between differenct harness (PI-to-OMP, OMP-to-Codex) in a cheap way.

## How It Works

Determine the basic directory structure:

1. Determine `MAIL_BASE_DIR`, usually specified by the user; it is task-scoped and not shared globally.
2. Create an Agent mailbox directory; AGENT_MAIL_BOX_DIR is the displayed AGENT name, usually chosen by the AGENT itself, named arbitrarily in the form `<random English name>`; it must be unique.
  ```
  <MAIL_BASE_DIR>/
      <AGENT_MAIL_BOX_DIR>/
          archive/
          whoami.md  <- a brief self-introduction
          <yyMMdd-hhmmss>_<slug>_FROM+<AGENT_MAIL_BOX_DIR_NAME>.mail.md  <- MAIL file
  ```

Assume the communicating parties are AGENT A and B.

**Sending Mail**:

Create a MAIL file under the other party's AGENT_MAIL_BOX_DIR, with the following format:

```md
---
title: <string>
created: <timestamp>
sendFrom: <AGENT_MAIL_BOX_DIR_NAME>
sendTo: <AGENT_MAIL_BOX_DIR_NAME>
replyTo?: <MAIL_FILE_NAME>
---

<Content>
```

The sender needs to know the name of the recipient's AGENT_MAIL_BOX_DIR, which is usually provided by the user at the start of the task.

The writing should be atomic. Recommend: 1) first create quasi mail file in tempdir, and 2) move to mail box after writing. If the final filename already exists, do not overwrite it. Add a numeric suffix such as `_2`, `_3`, or ask the sender to retry.


**Receiving Mail**:

1. Check your own MAIL BOX DIR for new mail files.
2. If any exist, read; after reading, archive it by moving it to `archive/`.

**Waiting**: Use the bash `sleep` command, any `wait` method, or manual coordination by the user.

**Concurrent Access Constraints**:

For a `<AGENT_MAIL_BOX_DIR>` belongs to Agent X, the writable operations are constraint as follows.

- ONLY X can edit `whoami.md`
- ONLY other Agent except X can create a **NEW** mail.md file; once created, any further revise is NOT allowed
- ONLY Agent X can move the file to archive/


## `MAIL_BASE_DIR` Guidelines

The mailbox directory is task-scoped and can usually be placed under the `.dev/changes/` directory. When the Change is complete, delete the mailbox directory directly. Do not place it globally, to avoid crosstalk between multiple tasks.

## `AGENT_MAIL_BOX_DIR` Guidelines

The Agent mailbox directory is bound to a specific session rather than a model; more fundamentally, it is bound to the context in which the AGENT resides.

RULE: ensure each running AGENT owns exclusive `AGENT_MAIL_BOX_DIR_NAME`.

`whoami.md` contains the AGENT's description of its self-perception, including what capabilities it possesses, what knowledge it has, what cognitive state it is in, and so forth.

The AGENT's mailbox directory must be created by the AGENT itself. Do not reuse an existing mailbox created by another session.

Few shots:

- Agent A create its box, and use
- Task handoff to Agent B, B should create this own box
- If A's context is compacted, it still can use old box


## Boundary

This skill is only applicable to scenarios where agents lack communication infrastructure and communication demands are low. Every agents are assumed to share same file system.

The default scenario involves a limited number of agents (typically fewer than three) exchanging information under the coordination of a user; high-concurrency or high-frequency communication patterns are not considered.
