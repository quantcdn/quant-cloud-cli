# Publishing Guide for @quantcdn/quant-cloud-cli

## Package Details

- **Package Name**: `@quantcdn/quant-cloud-cli`
- **Command Aliases**: `quant-cloud` and `qc`
- **Repository**: https://github.com/quantcdn/quant-cloud-cli
- **Registry**: npm (public)

## Pre-Publishing Checklist

### 1. Build & Test
```bash
# Clean build
npm run clean && npm run build

# Test CLI locally
node dist/index.js --version
node dist/index.js --help
node dist/index.js login --help

# Run demo
./demo.sh
```

### 2. Version Management
```bash
# Update version (patch/minor/major)
npm version patch
# or
npm version minor
# or  
npm version major
```

### 3. Package Validation
```bash
# Check package contents
npm pack --dry-run

# Verify files that will be published
npm publish --dry-run
```

## Publishing Steps

### 1. Initial Setup
```bash
# Login to npm (one time setup)
npm login

# Verify you're logged in as the correct user
npm whoami

# Verify you have access to @quantcdn scope
npm access ls-packages @quantcdn
```

### 2. Publish to npm
```bash
# For scoped packages, ensure public access
npm publish --access public

# Or for beta releases
npm publish --tag beta --access public

# Or for specific version tags
npm publish --tag v1.0.0 --access public
```

### 3. Verify Publication
```bash
# Check package info
npm info @quantcdn/quant-cloud-cli

# Test global installation
npm install -g @quantcdn/quant-cloud-cli

# Test both aliases work
quant-cloud --version
qc --version
```

## Post-Publishing

### 1. Update Documentation
- Update README.md with installation instructions
- Create GitHub release with changelog
- Update any documentation sites

### 2. Test Installation
```bash
# Test clean installation
npm uninstall -g @quantcdn/quant-cloud-cli
npm install -g @quantcdn/quant-cloud-cli

# Verify both commands work
quant-cloud login --help
qc whoami
```

### 3. Distribution Verification
```bash
# Test with npx (without installing)
npx @quantcdn/quant-cloud-cli --version
npx @quantcdn/quant-cloud-cli login --help
```

## Beta/Alpha Releases

For testing before stable release:

```bash
# Publish beta version
npm version prerelease --preid=beta
npm publish --tag beta --access public

# Users can install with:
npm install -g @quantcdn/quant-cloud-cli@beta
```

## Automated Publishing (CI/CD)

### GitHub Actions Example
```yaml
name: Publish to npm

on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Troubleshooting

### Common Issues

1. **403 Forbidden**: Ensure you have publish rights to @quantcdn scope
2. **Version exists**: Increment version number
3. **Scoped package**: Always use `--access public` for public scoped packages
4. **Build artifacts**: Ensure `dist/` folder exists and contains built files

### Emergency Unpublish
```bash
# Only within 24 hours and if no dependents
npm unpublish @quantcdn/quant-cloud-cli@1.0.0

# Or deprecate instead
npm deprecate @quantcdn/quant-cloud-cli@1.0.0 "Deprecated - use version x.x.x"
```

## Package Maintenance

### Regular Updates
- Keep dependencies updated
- Monitor security advisories
- Update Node.js version requirements as needed
- Respond to user issues and feature requests

### Analytics
Monitor package usage:
- npm download statistics
- GitHub stars/forks/issues
- User feedback and bug reports

---

## Quick Reference Commands

```bash
# Development workflow
npm run build && node dist/index.js --help

# Publishing workflow  
npm version patch && npm publish --access public

# Test after publish
npm install -g @quantcdn/quant-cloud-cli && qc --version
```

Ready for the world! 🌍🚀