# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is "더 게임" (The Game) - a Korean multiplayer cooperative card game built with Node.js, Express, and Socket.IO. Players must cooperatively place all cards from 2-99 onto four piles (two ascending, two descending) following specific rules.

## Development Commands

- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon (auto-restart on changes)
- `node server.js` - Direct server start (same as npm start)

Default port: 3000 (configurable via PORT environment variable)

## Architecture

### Server Architecture (server.js)
- **Express Server**: Serves static files from `/public` directory
- **Socket.IO Integration**: Real-time multiplayer communication
- **GameRoom Class**: Core game state management with methods for:
  - Player management (add/remove/ready states)
  - Game logic (card validation, turn management, win/lose conditions)
  - State synchronization across all players

### Game Logic
- **Card Rules**: 
  - Ascending piles (start at 1): Play higher cards OR exactly 10 less (backwards move)
  - Descending piles (start at 100): Play lower cards OR exactly 10 more (backwards move)
- **Turn System**: Players must play minimum 2 cards per turn (1 if deck empty)
- **Cooperative Elements**: Warning system and intention markers for team communication
- **Victory**: All 98 cards (2-99) successfully placed
- **Defeat**: Current player cannot play any card

### Client Architecture (public/index.html)
- **Single Page Application**: Login screen transitions to game screen
- **Real-time Updates**: Socket.IO event handlers for all game state changes
- **Interactive UI**: 
  - Drag-and-drop style card selection and pile targeting
  - Visual feedback for valid moves, warnings, intentions
  - Special effects for "good moves" (10-difference backwards plays) and "poop moves" (20+ difference)

### Key Data Structures
- **GameRoom**: Contains players array, game state, piles, turn management
- **Game State**: Tracks deck, piles (up1/up2/down1/down2), current player, cards played
- **Player State**: ID, name, hand, ready status
- **UI State**: Selected cards, valid drop zones, warnings, intentions

### Socket Events
- **Room Management**: joinRoom, playerReady, startGame
- **Gameplay**: playCard, endTurn
- **Communication**: setWarning, setIntention
- **State Sync**: gameState, cardPlayed, turnEnded

## File Structure
- `server.js` - Main server file with all game logic
- `public/index.html` - Complete client-side application with HTML, CSS, and JavaScript
- `package.json` - Dependencies and scripts
- No separate test files or additional configuration files currently exist

## Development Notes
- The game supports 2-6 players
- All game state is managed server-side for consistency
- Client receives personalized game state (only sees own hand)
- Korean language UI and game text
- Responsive design for mobile and desktop play