# Quant Cloud CLI

Command-line interface for Quant Cloud Platform integration and management.

## Features

- **Secure OAuth Authentication** - Browser-based login flow with PKCE security
- **Clean Terminal Interface** - Intuitive command structure and clear output
- **Fast & Lightweight** - Built with performance in mind
- **Extensible Architecture** - Easy to add new commands and features

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
   quant-cloud login
   # OR use the short alias:
   qc login
   ```
   This will open your browser and guide you through the authentication process.

2. **Check authentication status:**
   ```bash
   quant-cloud whoami
   # OR:
   qc whoami
   ```

## Commands

### Authentication
- `quant-cloud login` / `qc login` - Authenticate with Quant Cloud Platform
- `quant-cloud logout` / `qc logout` - Sign out and clear stored credentials
- `quant-cloud whoami` / `qc whoami` - Display current user information

### Applications (Coming Soon)
- `quant-cloud apps list` / `qc apps list` - List all your applications
- `quant-cloud apps create <name>` / `qc apps create <name>` - Create a new application
- `quant-cloud apps deploy <app>` / `qc apps deploy <app>` - Deploy an application

### Environments (Coming Soon)
- `quant-cloud env list` / `qc env list` - List all environments
- `quant-cloud env create <name>` / `qc env create <name>` - Create a new environment
- `quant-cloud env delete <name>` / `qc env delete <name>` - Delete an environment

## Configuration

The CLI stores configuration in `~/.quant/credentials`. This includes:
- Authentication tokens
- Default host settings
- User preferences

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