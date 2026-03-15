# uniform-instance-manager (`uim`)

CLI tool for managing Uniform instances and projects.

## Installation

```sh
npm install -g .
```

## Commands

### `login`

Authenticate with a Uniform instance. Credentials are saved locally for subsequent commands.

```sh
uim login --host <url> --username <email> --password <password>
uim login --host <url> --google
```

| Option | Description |
|---|---|
| `--host <url>` | Uniform host URL (required) |
| `--username <email>` | Account email |
| `--password <password>` | Account password |
| `--google` | Authenticate via Google in the browser |

---

### `use-team <teamId>`

Set the default team for project commands.

```sh
uim use-team <teamId>
```

---

### `create-project <name>`

Create a new Uniform project, register the English locale, and write `UNIFORM_PROJECT_ID` to `.env`.

```sh
uim create-project "My Project"
uim create-project "My Project" --teamId <id>
```

| Option | Description |
|---|---|
| `--teamId <id>` | Override the default team |

---

### `delete-project <nameOrId>`

Delete a Uniform project by name or UUID.

```sh
uim delete-project "My Project"
uim delete-project <uuid>
```

---

### `use-project <nameOrId>`

Write `UNIFORM_PROJECT_ID` to `.env` in the current directory. Accepts a project name or UUID.

```sh
uim use-project "My Project"
uim use-project <uuid>
```

If `.env` already contains `UNIFORM_PREVIEW_SECRET` with a valid GUID value, it will be updated to match the project ID as well.

---

### `ls [filter]`

List projects in the current team. Optionally filter by glob pattern.

```sh
uim ls
uim ls "*myapp*"
uim ls --allTeams
```

| Option | Description |
|---|---|
| `--allTeams` | List projects across all teams |
