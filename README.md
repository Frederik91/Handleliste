# Handleliste

Handleliste is a shared shopping list for Home Assistant. The application runs as a Home Assistant App and uses Ingress for authentication.

This guide explains how to install the development dependencies and run the local test suite. You do not need a Home Assistant instance or an AI provider. The browser tests start the complete application with a temporary SQLite database and a fake Home Assistant boundary.

## Prerequisites

Install these tools:

- Node.js 24 or later, including npm
- Git

Docker Desktop is optional. Use it only to verify the production image.

## Run the tests on Windows

1. Install Node.js 24 or later and Git.
2. Open PowerShell.
3. Confirm that PowerShell can find the tools:

   ```powershell
   node --version
   npm --version
   git --version
   ```

4. Clone the repository and enter the application directory:

   ```powershell
   git clone https://github.com/Frederik91/Handleliste.git
   cd Handleliste\handleliste
   ```

   If you already cloned the repository, open its `handleliste` directory instead.

5. Install the dependencies and the Playwright browser:

   ```powershell
   npm ci
   npx playwright install chromium
   ```

6. Run the checks:

   ```powershell
   npm run typecheck
   npm run build
   npm test
   ```

The last command reports that all Playwright tests passed. To watch the browser tests run, use this command:

```powershell
npx playwright test --headed
```

If PowerShell blocks `npm.ps1`, run the Windows command shims instead:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
```

## Inspect the UI locally

From the `handleliste` application directory, start a persistent development instance:

```powershell
npm run dev
```

The command builds the web interface and prints a local URL. Open that URL in a browser. It runs the real application and SQLite storage behind a small local Home Assistant substitute, so Ingress authentication works without a Home Assistant installation.

Shopping-list changes persist in `handleliste\.dev-data` between runs. Press `Ctrl+C` to stop the server. To reset the local data, stop the server and run this command from the `handleliste` application directory:

```powershell
Remove-Item -LiteralPath .dev-data -Recurse -Force
```

If PowerShell blocks `npm.ps1`, use `npm.cmd run dev` instead.

## Install the dependencies

Run these commands from the repository root:

```powershell
cd handleliste
npm ci
npx playwright install chromium
```

On Linux, install Chromium and its operating-system dependencies with this command:

```bash
npx playwright install --with-deps chromium
```

## Run all checks

Run the typecheck, production build, and browser tests:

```powershell
npm run typecheck
npm run build
npm test
```

`npm test` runs the Playwright acceptance suite. Each test uses an isolated temporary SQLite database. The suite covers Home Assistant Ingress authentication, language and theme behavior, Quick Entry, persistence, and updates between browser sessions.

## Run focused browser tests

Run one acceptance-test file:

```powershell
npx playwright test tests/acceptance/shopping-list.spec.ts
```

Run tests whose names contain `Quick Entry`:

```powershell
npx playwright test --grep "Quick Entry"
```

Open Playwright's interactive test runner:

```powershell
npx playwright test --ui
```

Run the tests in a visible browser window:

```powershell
npx playwright test --headed
```

Playwright writes failure details to `test-results/`. Git ignores this directory.

## Verify the Docker image

Return to the repository root, then build the same image used by the Home Assistant App:

```powershell
cd ..
docker build --tag handleliste:test --file handleliste/Dockerfile handleliste
```

Start the image and publish its health endpoint:

```powershell
docker run --detach --rm --name handleliste-test --publish 127.0.0.1:8099:8099 handleliste:test
curl.exe http://127.0.0.1:8099/health
docker stop handleliste-test
```

The health endpoint returns `ok`. Opening the production application UI directly does not work because requests require Home Assistant Ingress headers. Use `npm run dev` for local browser inspection.
