# Clawie — AdonisJS Application

The Clawie autonomous agent framework — built on [AdonisJS 6](https://adonisjs.com) with TypeScript, Inertia + React, and Ace CLI.

## Quick Start

```bash
npm install
cp .env.example .env
node ace generate:key
node ace migration:run
npm run dev
```

Open [http://localhost:3333](http://localhost:3333).

## CLI

```bash
node ace              # List all commands
node ace make:model   # Create a model
node ace make:controller  # Create a controller
node ace migration:run    # Run migrations
```

## Project Structure

```
clawie/
├── app/                # Backend logic (controllers, models, middleware)
├── config/             # App configuration
├── database/           # Migrations & seeders
├── inertia/            # React frontend (Inertia.js)
│   ├── pages/          # Page components
│   ├── layouts/        # Layout components
│   ├── css/            # Styles
│   └── app.tsx         # React entry point
├── resources/          # Edge templates & views
├── providers/          # Service providers
├── start/              # Boot files, routes
├── tests/              # Test suite
├── ace.js              # CLI entry point
├── vite.config.ts      # Vite config
└── tsconfig.json       # TypeScript config
```

## Tech Stack

- **Backend:** AdonisJS 6 (TypeScript)
- **Frontend:** React 19 + Inertia.js
- **Build:** Vite
- **Database:** SQLite (dev), PostgreSQL (prod)
- **CLI:** Ace CLI framework
