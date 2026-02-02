# Website Search Tool

A tool that automates website search interactions and captures screenshots at each stage.

## Features

- Navigate to website homepage → screenshot
- Open search modal → screenshot with query visible
- Submit search → screenshot results page

## Quick Start

### Prerequisites

- Node.js 16+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start

# Or run in development mode
npm run dev
```

### Usage

1. Open browser: http://localhost:3000
2. Enter website URL (e.g., `zone3.com`)
3. Enter search query (e.g., `wetsuit`)
4. Click "Run Search"
5. Watch screenshots appear as each stage completes

## API Endpoints

### `POST /api/search`

Start a search job.

**Request:**
```json
{
  "domain": "zone3.com",
  "query": "wetsuit"
}
```

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `GET /api/search/:jobId`

Get search status and results.

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progressPct": 100,
  "screenshots": [
    {
      "stage": "homepage",
      "url": "https://zone3.com/",
      "screenshotUrl": "/artifacts/.../homepage.jpg"
    },
    {
      "stage": "search_modal",
      "url": "https://zone3.com/",
      "screenshotUrl": "/artifacts/.../search_modal.jpg"
    },
    {
      "stage": "search_results",
      "url": "https://zone3.com/search?q=wetsuit",
      "screenshotUrl": "/artifacts/.../search_results.jpg"
    }
  ]
}
```

## Project Structure

```
bayezon-website-browser-scraper/
├── src/
│   ├── server.ts          # Express API server
│   ├── search.ts          # Playwright search automation
│   ├── jobs.ts            # Job state management
│   ├── types.ts           # TypeScript interfaces
│   └── utils.ts           # Helper functions
│
├── public/
│   ├── index.html         # Frontend UI
│   ├── app.js             # Frontend JavaScript
│   └── styles.css         # Styles
│
├── artifacts/             # Screenshots (git-ignored)
└── dist/                  # Compiled JavaScript
```

## Environment Variables

Optional (defaults provided):

- `PORT` - Server port (default: 3000)

## License

MIT



