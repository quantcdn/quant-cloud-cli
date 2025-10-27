# Quant Cloud CLI

Command-line interface for Quant Cloud Platform integration and management.

## Features

- **Multi-Platform Authentication** - Support for multiple Quant Cloud environments with platform switching
- **Project Configuration** - Automatic context detection with `.quant.yml` files for seamless project workflows
- **Organization Management** - List and switch between organizations
- **Application Management** - Create, list, and manage applications with environment auto-selection
- **Environment Operations** - Create, select, monitor, and manage cloud environments
- **Live Metrics Dashboard** - Real-time performance monitoring with in-place updates
- **Log Streaming** - Live log tailing with follow mode
- **SSH Access** - Direct terminal access to cloud environments via AWS ECS Exec with interactive shells and one-shot commands
- **Backup Management** - Create, list, download, and delete environment backups
- **Secure OAuth Authentication** - Browser-based login flow with PKCE security
- **Non-Interactive Mode** - All commands support context overrides via CLI flags for automation

## Installation

```bash
npm install -g @quantcdn/quant-cloud-cli
```

Or run directly with npx:
```bash
npx @quantcdn/quant-cloud-cli
```

## Quick Start

1. **Login to Quant Cloud:**
   ```bash
   qc login
   ```
   Select your platform (QuantGov Cloud or Quant Cloud), authenticate via browser.

2. **Check authentication status:**
   ```bash
   qc whoami
   ```

3. **Set up your context:**
   ```bash
   qc org select          # Choose organization
   qc app select          # Choose application (auto-prompts for environment)
   ```

4. **Start monitoring:**
   ```bash
   qc env metrics         # Live dashboard
   qc env logs --follow   # Stream logs
   qc ssh                 # Interactive bash shell
   qc backup list         # View backups
   ```

## Project Configuration

For project-specific workflows, create a `.quant.yml` file at your project root:

```yaml
# .quant.yml - Project configuration
platform: quantcdn      # or quantgov
org: my-organization
app: my-application
env: development        # default environment
```

The CLI automatically detects this file when run from anywhere in your project directory tree, eliminating the need to specify context repeatedly.

### Context Priority

The CLI resolves context in this priority order:
1. **CLI flags** (highest) - `--org`, `--app`, `--env`, `--platform`
2. **Project config** (`.quant.yml`)
3. **Stored config** (lowest) - from `qc org select`, `qc app select`, etc.

### Examples

```bash
# In a project with .quant.yml
cd /path/to/my-project
qc env logs -f              # Uses project config automatically
qc ssh                      # Connects to project's default environment
qc backup create            # Creates backup for project environment

# Override project config with CLI flags
qc env metrics --env=production  # Override environment
qc ssh --org=other-org          # Override organization

# Works from any subdirectory
cd /path/to/my-project/src/components
qc env list                     # Still finds .quant.yml at project root
```

## Commands

### Authentication
- `qc login` - Authenticate with Quant Cloud Platform (supports multiple platforms)
- `qc logout` - Sign out and clear stored credentials
- `qc whoami` - Display current user and authentication status

### Platform Management
- `qc platform list` - List all authenticated platforms
- `qc platform switch` - Switch between authenticated platforms
- `qc platform current` - Show currently active platform
- `qc platform remove` - Remove platform authentication

### Organizations
- `qc org list` - List available organizations
- `qc org select [orgId]` - Switch to a different organization
- `qc org current` - Show current organization

### Applications
- `qc app list` - List applications in current organization
- `qc app select [appId]` - Switch to application (auto-prompts for environment)
- `qc app current` - Show current application context

### Environments
- `qc env list` - List environments in current application
- `qc env select [envId]` - Switch to environment with searchable selection
- `qc env current` - Show current environment
- `qc env create [envName]` - Create new environment with capacity settings
- `qc env state [envId]` - Get environment deployment state
- `qc env logs [envId]` - Stream environment logs (supports --follow)
- `qc env metrics [envId]` - Live metrics dashboard with real-time updates

### SSH Access
- `qc ssh [--container=name]` - SSH into cloud environment via AWS ECS Exec (defaults to interactive bash)
- `qc ssh --command="shell_or_command"` - Run specific shell or one-shot command (non-interactive by default)
- `qc ssh --command="command" --interactive` - Run command in interactive mode

**Context Overrides:** All SSH commands support `--org`, `--app`, `--env`, `--platform` flags

**Examples:**
```bash
# Interactive bash shell (default)
qc ssh --container=php

# One-shot commands
qc ssh --container=php --command="php -v"
qc ssh --container=php --command="ls -la /var/www"

# Interactive with specific shell
qc ssh --container=php --command="/bin/sh" --interactive
qc ssh --container=php --command="/bin/zsh" --interactive

# Interactive command (like database console)
qc ssh --container=php --command="mysql -u root -p" --interactive
```

### Backup Management

All backup commands support both **database** and **filesystem** backup types via the `--type` flag (defaults to `database`).

- `qc backup list [--type=database|filesystem]` - List available backups with status and details
- `qc backup create [--type=database|filesystem]` - Create new backup with interactive prompts
- `qc backup download [backupId] [--type=database|filesystem] [--output=path]` - Download backup files to local directory
  - Interactive mode: Shows list with descriptions, dates, and sizes
  - Direct mode: `qc backup download <backupId>` to download specific backup
- `qc backup delete [--type=database|filesystem]` - Delete backups with confirmation prompt

**Context Overrides:** All backup commands support `--org`, `--app`, `--env`, `--platform` flags

**Examples:**
```bash
# Database backups (default)
qc backup list
qc backup create --description="Pre-deployment backup"
qc backup download

# Filesystem backups
qc backup list --type=filesystem
qc backup create --type=filesystem --description="Files before migration"
qc backup download --type=filesystem

# Download specific backup by ID
qc backup download backup-2024-01-15-abc123
qc backup download backup-2024-01-15-abc123 --type=filesystem

# Download to specific directory
qc backup download --output=./my-backups
qc backup download backup-2024-01-15-abc123 --output=./my-backups --type=database

# Full automation with context overrides
qc backup create --org=my-org --app=my-app --env=production --type=database --description="Automated backup"
qc backup download backup-123 --org=my-org --app=my-app --env=production --type=filesystem
```

### Non-Interactive Mode

All commands support context override flags for automation and CI/CD:

```bash
# Override any context parameter
qc env logs --org=my-org --app=my-app --env=production --follow
qc ssh --org=my-org --app=my-app --env=staging --container=web
qc backup create --org=my-org --app=my-app --env=production --type=database
qc env metrics --platform=quantgov --org=gov-dept --app=portal --env=prod
```

## Configuration

### User Configuration
The CLI stores user configuration in `~/.quant/credentials`. This includes:
- Multi-platform authentication tokens and refresh tokens
- Active platform, organization, application, and environment context
- Platform-specific settings and preferences

Configuration is automatically migrated from single-platform to multi-platform format when upgrading.

### Project Configuration
Create a `.quant.yml` file at your project root for automatic context detection:

```yaml
# .quant.yml
platform: quantcdn    # Platform: quantcdn or quantgov
org: my-org           # Organization machine name
app: my-application   # Application machine name  
env: development      # Default environment name
```

**Directory Traversal:** The CLI searches for `.quant.yml` starting from the current directory and walking up to the git repository root.

**Context Resolution Priority:**
1. CLI flags (`--org`, `--app`, `--env`, `--platform`)
2. Project config (`.quant.yml`)
3. Stored user config (`~/.quant/credentials`)

## Development

```bash
# Clone the repository
git clone <repo-url>
cd quant-cloud-cli

# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Link for global usage during development
npm link
```

## Environment Variables

- `LOG_LEVEL` - Set logging level (DEBUG, INFO, WARN, ERROR)

## License

MIT