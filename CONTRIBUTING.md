# Contributing to Solana MEV Sandwich Bot

We welcome contributions to the Solana MEV Sandwich Bot! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment for all contributors
- Respect different viewpoints and experiences

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Environment details (OS, Node.js version, etc.)
- Relevant log files or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please include:

- A clear description of the enhancement
- Use cases and benefits
- Possible implementation approaches
- Any relevant examples or references

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** for new functionality
4. **Update documentation** as needed
5. **Ensure tests pass** and code builds successfully
6. **Submit a pull request** with a clear description

## Development Setup

### Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- Git

### Local Development

1. **Clone your fork**
   ```bash
   git clone https://github.com/your-username/solana-mev-sandwich-bot.git
   cd solana-mev-sandwich-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Start development mode**
   ```bash
   npm run dev
   ```

## Coding Standards

### TypeScript Guidelines

- Use TypeScript strict mode
- Provide type annotations for public APIs
- Use meaningful variable and function names
- Follow existing code style and patterns

### Code Style

- Use Prettier for code formatting
- Follow ESLint rules
- Use meaningful commit messages
- Keep functions small and focused
- Add comments for complex logic

### Testing

- Write unit tests for new functionality
- Maintain test coverage above 80%
- Use descriptive test names
- Test both success and error cases

### Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for public APIs
- Update API documentation for new endpoints
- Include examples in documentation

## Project Structure

```
src/
├── analyzers/          # Profit calculation and analysis
├── cli/               # Command-line interface
├── executors/         # Transaction execution logic
├── monitors/          # Transaction monitoring
├── types/             # TypeScript type definitions
└── utils/             # Utility functions

docs/                  # Documentation
tests/                 # Test files
scripts/               # Build and deployment scripts
config/                # Configuration templates
```

## Commit Message Format

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/tooling changes

Examples:
```
feat(executor): add flashloan integration
fix(monitor): resolve WebSocket connection issues
docs(api): update endpoint documentation
```

## Security Considerations

### Sensitive Information

- Never commit private keys or secrets
- Use environment variables for configuration
- Sanitize logs to remove sensitive data
- Follow secure coding practices

### Financial Safety

- Test thoroughly in dry-run mode
- Implement proper error handling
- Add safeguards against excessive losses
- Document risk factors clearly

## Review Process

### Pull Request Review

All pull requests require review before merging:

1. **Automated checks** must pass (tests, linting, build)
2. **Code review** by at least one maintainer
3. **Documentation review** for user-facing changes
4. **Security review** for sensitive changes

### Review Criteria

- Code quality and maintainability
- Test coverage and quality
- Documentation completeness
- Security considerations
- Performance impact

## Release Process

### Versioning

We use Semantic Versioning (SemVer):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist

- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Create release notes
- [ ] Tag release in Git
- [ ] Build and test Docker images
- [ ] Update documentation

## Getting Help

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and discussions
- **Pull Request Comments**: Code-specific discussions

### Maintainer Response Time

- **Critical bugs**: Within 24 hours
- **General issues**: Within 1 week
- **Pull requests**: Within 1 week
- **Feature requests**: Within 2 weeks

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes for significant contributions
- GitHub contributor statistics

## Legal

By contributing to this project, you agree that:

- Your contributions will be licensed under the MIT License
- You have the right to submit your contributions
- Your contributions are your original work or properly attributed

## Questions?

If you have questions about contributing, please:

1. Check existing documentation
2. Search existing issues and discussions
3. Create a new discussion or issue
4. Contact the maintainers

Thank you for contributing to the Solana MEV Sandwich Bot!

