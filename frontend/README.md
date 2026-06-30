# Frontend (React)

This directory contains the React UI for the Voice Spendings Tracker. Although the project was bootstrapped with Create React App, the workflow below reflects the expectations for this repository.

## Core Scripts

```powershell
npm install                       # install dependencies
npm start                         # start dev server on http://localhost:3000
npm test -- --watchAll=false      # run unit tests once
npm run build                     # produce production bundle served by Flask
```

During development the CRA proxy forwards API calls to the Flask backend at `http://localhost:5000`. After running `npm run build` the generated assets are served by Flask from `/app`.

Refer to the repository README for full-stack instructions and deployment notes.
