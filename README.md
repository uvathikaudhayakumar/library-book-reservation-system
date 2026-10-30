# Library Book Reservation & Fine Management System

A student-project application using every required technology: **HTML, CSS, Bootstrap, jQuery, Node.js, Express.js and MongoDB**.

## Features
- Book catalogue: add, edit, delete, search and view copy availability.
- Member management: add/edit/search/delete members.
- Reservations: create pending reservations, cancel them, and fulfil a reservation when issuing its book.
- Issue and return: select an active member, choose a book and due date, and record returns.
- Fine calculation: automatically calculates `overdue days × fine per day`; default is ₹5/day.
- Admin reports: total titles/copies, active loans, overdue loans, pending reservations, outstanding fines and collected fines.
- JSON export of catalogue, members, reservations and loans.
- MongoDB persistence with Mongoose models and Express REST API.

## Requirements
- Node.js 18 or later
- MongoDB 7+ locally, or Docker Desktop

## Run with Docker (easiest)
1. Extract the project folder and open it in VS Code.
2. Start MongoDB:
   ```bash
   docker compose up -d
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the app:
   ```bash
   npm start
   ```
5. Open http://localhost:3000

## Run with a locally installed MongoDB
Make sure MongoDB is running, then run:
```bash
npm install
npm start
```
The default URI is `mongodb://127.0.0.1:27017/library_reservation`.

## Configuration
Copy `.env.example` to `.env` and set:
- `PORT` — web server port (default `3000`)
- `MONGODB_URI` — MongoDB connection URI
- `FINE_PER_DAY` — fine amount for each overdue day (default `5`)

Node does not load `.env` files by itself. If you use a `.env` file, install `dotenv` and add `require('dotenv').config()` at the top of `server.js`, or set the variables in your terminal. For a beginner-friendly setup, defaults work without `.env`.

## Fine policy
- An active loan's displayed fine is updated from the current date.
- On return, the fine is fixed using the return date.
- Formula: `Fine = max(0, overdue days) × FINE_PER_DAY`.
- A fine can be marked paid after the book is returned.

## API overview
- `GET/POST /api/books`, `PUT/DELETE /api/books/:id`
- `GET/POST /api/members`, `PUT/DELETE /api/members/:id`
- `GET/POST /api/reservations`, `POST /api/reservations/:id/cancel`
- `GET/POST /api/loans`, `POST /api/loans/:id/return`, `POST /api/loans/:id/pay-fine`
- `GET /api/reports`, `GET /api/export`, `GET /api/health`

## Notes
- Bootstrap, jQuery and fonts are loaded from CDNs, so the browser needs internet access for those assets.
- This is a college-project foundation. Before public deployment, add authentication and role-based authorization for admin actions, stronger validation, rate limiting, audit logs, backups and automated tests.
- This version intentionally uses MongoDB rather than the Redis/Cassandra storage in the original uploaded application to meet the requested stack.
