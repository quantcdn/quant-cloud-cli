# Quant Cloud CLI

Command-line interface for Quant Cloud Platform integration and management.

## Features

- **Multi-Platform Authentication** - Support for multiple Quant Cloud environments with platform switching
- **Organization Management** - List and switch between organizations
- **Application Management** - Create, list, and manage applications with environment auto-selection
- **Environment Operations** - Create, select, monitor, and manage cloud environments
- **Live Metrics Dashboard** - Real-time performance monitoring with in-place updates
- **Log Streaming** - Live log tailing with follow mode
- **SSH Access** - Direct terminal access to cloud environments via AWS ECS Exec
- **Backup Management** - Create, list, download, and delete environment backups
- **Secure OAuth Authentication** - Browser-based login flow with PKCE security

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
   qc ssh                 # Access environment
   qc backup list         # View backups
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
- `qc ssh [--container=name]` - SSH into cloud environment via AWS ECS Exec

### Backup Management
- `qc backup list [--type=database|filesystem]` - List available backups with status and details
- `qc backup create [--type=database|filesystem]` - Create new backup with interactive prompts
- `qc backup download [--output=path]` - Download backup files to local directory
- `qc backup delete` - Delete backups with confirmation prompt

## Configuration

The CLI stores configuration in `~/.quant/credentials`. This includes:
- Multi-platform authentication tokens and refresh tokens
- Active platform, organization, application, and environment context
- Platform-specific settings and preferences

Configuration is automatically migrated from single-platform to multi-platform format when upgrading.

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