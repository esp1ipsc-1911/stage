# ⬡ STAGEFORGE — IPSC Stage Designer

A canvas-based web application for designing IPSC (International Practical Shooting Confederation) stages. Runs entirely in the browser — no server required.

## Features

- **Visual canvas editor** with pan and zoom
- **IPSC element library:**
  - IPSC Paper Targets (with A/B/C/D scoring zones)
  - Steel Poppers
  - Steel Plates
  - No-Shoot Targets
  - Hard Cover / Barricades
  - Barrels (props)
  - Shooting Ports
  - Shooting Box (start position)
  - Fault Lines
  - Text Notes
- **Snap-to-grid** with configurable size (0.5 m / 1 m / 2 m)
- **Multi-select** with marquee selection and Shift+click
- **Undo / Redo** (Ctrl+Z / Ctrl+Y)
- **Save / Load** stages to browser localStorage
- **Export / Import** stages as portable JSON files
- **Stage info** panel: min/max rounds, scoring system, division

## Keyboard Shortcuts

| Key           | Action                   |
|---------------|--------------------------|
| `V`           | Select tool              |
| `H`           | Pan tool                 |
| `Delete`      | Delete selected          |
| `Ctrl+D`      | Duplicate selected       |
| `Ctrl+Z`      | Undo                     |
| `Ctrl+Y`      | Redo                     |
| `Ctrl+S`      | Save stage               |
| `Escape`      | Deselect / cancel        |
| Arrow keys    | Nudge 1 px               |
| Shift+Arrows  | Nudge 1 grid unit        |

## Deploy to GitHub Pages

1. **Create a new repository** on GitHub (e.g., `ipsc-stage-designer`)
2. **Upload these three files** to the repository root:
   - `index.html`
   - `style.css`
   - `app.js`
3. Go to **Settings → Pages**
4. Under *Source*, select `main` branch and `/ (root)` folder
5. Click **Save** — your app will be live at:
   `https://YOUR_USERNAME.github.io/ipsc-stage-designer/`

### Quick deploy via Git

```bash
git init
git add .
git commit -m "Initial commit — STAGEFORGE IPSC Stage Designer"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ipsc-stage-designer.git
git push -u origin main
```

### Quick deploy via GitHub CLI

```bash
git init && git add . && git commit -m "Initial commit"
gh repo create ipsc-stage-designer --public --push --source=.
```

Then enable GitHub Pages in **Settings → Pages**.

## Data Storage

Stages are saved in the browser's `localStorage` and persist across sessions on the same device and browser. Use **Export** to create portable `.json` backup files that can be shared and imported on any device.

## IPSC Terminology Reference

| Term              | Description                                                    |
|-------------------|----------------------------------------------------------------|
| IPSC Target       | Standard cardboard target with A/B/C/D scoring zones           |
| Steel Popper      | Self-resetting falling steel target                            |
| Steel Plate       | Non-falling steel plate (used in plate racks)                  |
| No-Shoot          | Penalty target — must not be hit                               |
| Hard Cover        | Wall or barricade providing hard cover                         |
| Shooting Box      | Defined starting position for the competitor                   |
| Fault Line        | Boundary of the shooting area; crossing = procedural penalty   |
| Shooting Port     | Opening in a wall or barricade the competitor shoots through   |
| Comstock          | Scoring: highest hit factor wins (time + points)               |
| Fixed Time        | Scoring: fixed time limit; most points wins                    |
| Virginia Count    | Scoring: predetermined number of rounds per target             |

## Tech Stack

- Vanilla HTML5 Canvas — zero dependencies, no build step
- Google Fonts (Bebas Neue, Barlow Condensed)
- Browser `localStorage` for persistence

---

*Built for IPSC competitors and match directors. Not affiliated with IPSC.*
