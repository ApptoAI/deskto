# ADR 0022: Optional Windows release signing

- Status: accepted
- Date: 2026-08-20

## Context

ADR 0021 required every Windows release to use a configured signing identity.
The repository has no Azure Trusted Signing credentials, so that rule prevents
the release workflow from producing any Windows installer. Signing is useful,
but it is not currently a release requirement.

## Decision

The release workflow signs Windows packages when all Azure Trusted Signing
secrets and variables are configured. When none are configured, it builds and
publishes an unsigned installer. A partial configuration fails before the build
because it indicates a setup error rather than an intentional unsigned release.

The workflow always verifies that the installer, its update feed, and its
blockmap exist. It checks the Authenticode signature only when signing was
enabled for that build. macOS signing and notarization remain required.

## Consequences

- Windows releases can ship before Azure Trusted Signing is configured.
- Windows warns people about the unknown publisher for unsigned installers.
- Adding the complete Azure configuration enables signing without another code
  change.
- This decision replaces ADR 0021's requirement that CI reject every unsigned
  Windows build.
