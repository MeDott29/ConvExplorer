# Conversation Data Explorer Project Guidelines

## Commands
- **Run Explorer:** `node conversation-explorer.js conversations.json`
- **Run Explorer v2:** `node conversation-explorer-v2.js conversations.json`
- **Analyze Data:** `node analyze-conversations.js`
- **Validate Data:** `node conversation-validator.js`

## Development Style
- **Code Style:** JavaScript with CommonJS modules
- **Formatting:** 2-space indentation, semicolons required
- **Naming:** camelCase for variables/functions, PascalCase for classes
- **UI Components:** Use blessed/blessed-contrib for terminal interfaces
- **Data Handling:** Process JSON data efficiently with streaming where possible
- **Performance:** Use pagination, lazy loading for large datasets (100MB+)
- **Error Handling:** Use try/catch blocks for file operations and JSON parsing
- **Comments:** Document complex algorithms and UI component relationships
- **State Management:** Use consistent patterns for state updates
- **Date Handling:** Use moment.js for all date manipulation

## JSON Schema
- Conversations contain: uuid, name, created_at, updated_at, account, chat_messages
- Messages contain: uuid, text, content array, sender, timestamps, attachments