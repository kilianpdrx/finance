# Installing the Finance app

This is a personal finance dashboard that runs **entirely on your own computer**.
There is no online account and no sign-up — your data never leaves your machine
(it lives in a single file on your disk). Each person runs their own copy.

You have two ways to install it. **Docker is the easiest** and is recommended.

---

## Option A — Docker (recommended, ~5 minutes)

### 1. Install Docker Desktop
Download and install it for your system, then open it once so it's running:
- **Mac / Windows:** https://www.docker.com/products/docker-desktop/
- **Linux:** install Docker Engine + the Compose plugin from your package manager.

You'll know it's ready when the Docker icon says "Docker Desktop is running".

### 2. Get the app's files
Either:
- Download the project as a ZIP (green **Code → Download ZIP** button) and unzip it, **or**
- If you know git: `git clone <the repository URL>`

### 3. Start it
Open a terminal (Mac: *Terminal*, Windows: *PowerShell*), go into the project
folder, and run:

```bash
docker compose up -d
```

The first run takes a few minutes while it downloads and builds. When it's done,
open your browser to:

**http://localhost:3000**

That's it. 🎉

### Everyday use
- **Stop the app:** `docker compose down`
- **Start it again:** `docker compose up -d`
- **Update to a newer version:** pull/download the new files, then
  `docker compose up -d --build`

---

## Option B — Run it manually (no Docker)

Use this only if you'd rather not install Docker. You'll need:
- **Python 3.11+** — https://www.python.org/downloads/
- **Node.js 20+** — https://nodejs.org/

Then, from the project folder:

```bash
./start.sh
```

This installs the dependencies and launches both parts of the app. Open
**http://localhost:3000** when it says both servers have started. Press
`Ctrl+C` in the terminal to stop.

> On Windows, run the manual option inside **WSL** or **Git Bash** (the script is
> a bash script). If in doubt, use Docker (Option A) instead.

---

## Your data & backups

- Everything is stored in one file: **`backend/data/finance.db`**.
- To save a copy or move your data to another computer, use the app:
  **Paramètres → Sauvegarde** → *Télécharger la sauvegarde (.sqlite)*.
- To load it back (or import a friend's export), use **Restaurer** on the same
  screen and pick the `.sqlite` file. A safety copy of your current data is kept
  automatically before it's replaced.

## Good to know

- **It's local and single-user.** There's no password because it only listens on
  your own computer. **Don't expose it to the internet** — anyone who could reach
  it would see all the data. To share with friends, each person runs their own
  copy (above) and, if they want, exchanges data via the backup file.
- **Ports:** the app uses `3000` (the site) and `8000` (its data service). If
  something else is already using those, stop that first.
- **Import your bank data:** once open, go to **Importer** and drop in a CSV
  export from your bank to get started.
