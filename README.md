# Personal Assistant Bot

A private Slack bot for personal productivity management: Tasks, Reminders, Vault, Habits, and Parking Lot.

## Features

- **Focus Timer** (`/focus [minutes] [task]`) - Deep work sessions with notifications
- **Task Management** (`/task`, `/tasks`) - Create and track tasks
- **Information Vault** (`/save`, `/find`) - Store and search information by tags
- **Habit Tracking** (`/habit`) - Daily habit logging
- **Parking Lot** (`/park`, `/review`) - Capture ideas and convert to tasks

## Setup

### 1. Prerequisites
- Node.js 16+
- A Slack workspace where you can create apps
- A Firebase project

### 2. Configuration

#### Copy .env Template
```bash
cp .env.example .env
```

#### Slack Setup
1. Create an app at https://api.slack.com/apps
2. Enable Socket Mode
3. Enable Event Subscriptions
4. Add slash commands: `/focus`, `/task`, `/tasks`, `/save`, `/find`, `/habit`, `/park`, `/review`
5. Add request URL for interactions
6. Copy Bot Token and App Token to `.env`

#### Firebase Setup
1. Create a Firebase project at https://console.firebase.google.com
2. Enable Firestore Database
3. Enable Anonymous Authentication
4. Copy your Firebase config to `.env` in the `__firebase_config` variable

### 3. Install & Launch
```bash
npm install
npm start
```

## Architecture

- **Firestore**: Private data storage per user
- **Slack Bot**: Socket Mode for real-time interactions
- **Firebase Auth**: User authentication

## Environment Variables

See `.env.example` for all required configuration options.

## Data Structure

All user data is stored in Firestore under:
```
artifacts/
  └── [app_id]/
      └── users/
          └── [user_id]/
              ├── tasks/
              ├── reminders/
              ├── vault/
              ├── habits/
              ├── parking_lot/
              └── logs/
```
