# Source Control Integrations

Up.computer uses your Git hosting provider's CLI or API to clone repositories and publish local
projects. Pull request features are not included.

## Supported Providers

- **GitHub** – through the GitHub CLI (`gh`)
- **GitLab** – through the GitLab CLI (`glab`)
- **Bitbucket** – through an API token
- **Azure DevOps** – through the Azure CLI (`az`) with the DevOps extension

## What You Can Do

### Clone repositories

- Open the Command Palette (`Cmd/Ctrl + K`) → **Add Project**
- Choose **GitHub repository**, **GitLab repository**, **Bitbucket repository**, **Azure DevOps
  repository**, or paste any **Git URL**
- Enter the repository path (`owner/repo`, `group/project`, `workspace/repository`, or
  `project/repository`) or a full Git URL, and pick a destination

Git never waits for a password prompt during a clone. If a clone fails, the error shows Git's own
message, such as "Repository not found", with any credentials in the URL removed.

### Publish local projects

Have a local Git repository without a remote? Use **Publish repository** in the Git actions menu to create a hosted
repository (GitHub, GitLab, Bitbucket, or Azure DevOps), add it as the `origin` remote, and push.

### Check your setup

**Settings → Source Control** shows which Git version and provider tools the server has, whether
each one is signed in, and which account is used. Run **Rescan** after installing a tool or
changing credentials. The same page sets how often Up.computer fetches remotes in the background.

## Getting Started

### GitHub

1. Install the GitHub CLI (version 2.81.0 or newer) on the machine running Up.computer:
   ```bash
   brew install gh
   ```
2. Sign in:
   ```bash
   gh auth login
   ```
3. Open **Settings → Source Control** and check that GitHub shows as authenticated.

### GitLab

1. Install the GitLab CLI:
   ```bash
   brew install glab
   ```
2. Sign in:
   ```bash
   glab auth login
   ```
3. Check **Settings → Source Control** to confirm the connection.

### Bitbucket

Bitbucket uses a token instead of a CLI. Set one of these in the environment of the server running
Up.computer.

Recommended, a Bitbucket access token:

```bash
export UPCOMPUTER_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or an Atlassian account email plus API token, with read/write access to repositories and read
access to your user account (`read:user:bitbucket`, used to verify the connection):

```bash
export UPCOMPUTER_BITBUCKET_EMAIL="you@example.com"
export UPCOMPUTER_BITBUCKET_API_TOKEN="your-token"
```

If both are set, the access token wins. Restart Up.computer and verify the connection in
**Settings → Source Control**.

### Azure DevOps

1. Install the Azure CLI:
   ```bash
   brew install azure-cli
   ```
2. Add the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
3. Sign in:
   ```bash
   az login
   ```

The Azure CLI is slow to start, so detecting it can take up to about 20 seconds.

---

## Requirements & Troubleshooting

**Git is required.** Up.computer uses Git for all local operations.

**Setup happens on the server.** Sign-in and credentials live on the machine running Up.computer,
not on the device you are using to open it.

**Common issues:**

- **Provider shows "Not authenticated"** – run the provider's login command (for example
  `gh auth login`) in a terminal on the server, then rescan.
- **GitHub says it could not verify sign-in status** – update `gh` to 2.81.0 or newer (for example
  `brew upgrade gh`), then rescan.
- **Bitbucket not connecting** – check that the variables are set for the process running
  Up.computer and that it was restarted.
- **Provider not detected for a remote** – SSH remotes with any user (`git@`, `gitlab@`,
  `deploy@`) and Azure DevOps SSH remotes (`ssh.dev.azure.com`) are recognised. For self-hosted
  instances, check that the remote's host matches the provider you signed in to.

**Provider CLI documentation:**

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/)
