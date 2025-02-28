#!/usr/bin/env node

/**
 * Enhanced Single Conversation Viewer
 * 
 * A focused terminal UI for viewing a single conversation with efficient
 * screen usage, improved readability, and additional filtering options.
 * Includes ability to hide empty conversations.
 */

const fs = require('fs');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const moment = require('moment');
const chalk = require('chalk');

// Create a screen object
const screen = blessed.screen({
  smartCSR: true,
  title: 'Enhanced Conversation Viewer'
});

// Configuration
const config = {
  theme: {
    assistantColor: 'green',
    userColor: 'blue',
    systemColor: 'yellow',
    highlightBg: 'blue',
    highlightFg: 'white',
    borderColor: 'white',
    timestampColor: 'gray'
  },
  navigation: {
    messageListWidth: '20%',  // Can be collapsed to 0%
    messageListExpanded: true
  },
  formatting: {
    timestampFormat: 'YYYY-MM-DD HH:mm',
    maxPreviewLength: 30
  }
};

// Application state
const state = {
  // Current data
  allConversations: [],      // All loaded conversations
  filteredConversations: [], // Conversations after filtering
  currentConversationIndex: 0,
  conversation: null,
  messages: [],
  currentMessageIndex: 0,
  
  // UI state
  isLoading: false,
  searchMode: false,
  searchTerm: '',
  searchResults: [],
  searchIndex: 0,
  navCollapsed: false,
  viewMode: 'normal', // 'normal', 'raw', 'metadata'
  
  // Extra modes
  conversationSwitcherActive: false,
  
  // Filters
  hideEmptyConversations: false
};

// UI Components
const ui = {
  // Layout components
  grid: null,
  
  // Header shows conversation title and metadata
  header: null,
  
  // Main message content area
  messageContent: null,
  
  // Navigation sidebar for jumping between messages
  messageList: null,
  
  // Status bar for shortcuts and info
  statusBar: null,
  
  // Command/search input
  cmdInput: null,
  
  // Loading indicator
  loadingBox: null,
  
  // Help modal
  helpText: null,
  
  // Conversation switcher modal
  conversationSwitcher: null,
  
  // Filter settings modal
  filterSettings: null,
  
  // Initialize the UI components with full screen layout
  init() {
    // Create the grid layout
    this.grid = new contrib.grid({rows: 12, cols: 12, screen: screen});
    
    // Header area - conversation title and metadata
    this.header = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: 'Enhanced Conversation Viewer',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true
      }
    });
    
    // Message navigation panel - adjustable width
    const navWidth = config.navigation.messageListExpanded ? 3 : 0;
    this.messageList = this.grid.set(1, 0, 10, navWidth, blessed.list, {
      keys: true,
      vi: true,
      mouse: true,
      border: {type: 'line'},
      style: {
        selected: {
          bg: config.theme.highlightBg,
          fg: config.theme.highlightFg,
          bold: true
        },
        border: {fg: config.theme.borderColor}
      },
      scrollbar: {
        ch: ' ',
        style: {bg: 'blue'}
      },
      label: ' Messages '
    });
    
    // Message content area - takes most of the screen
    this.messageContent = this.grid.set(1, navWidth, 10, 12 - navWidth, blessed.box, {
      label: ' Message Content ',
      tags: true,
      content: 'Select a conversation to view',
      border: {type: 'line'},
      style: {border: {fg: config.theme.borderColor}},
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      padding: 1
    });
    
    // Add scroll event listeners to message content
    this.messageContent.key(['pageup'], function() {
      ui.messageContent.scroll(-ui.messageContent.height || -1);
      ui.render();
    });
    
    this.messageContent.key(['pagedown'], function() {
      ui.messageContent.scroll(ui.messageContent.height || 1);
      ui.render();
    });
    
    // Status bar with shortcut hints
    this.statusBar = this.grid.set(11, 0, 1, 12, blessed.text, {
      content: ' {bold}Enhanced Conversation Viewer{/bold} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue'
      }
    });
    
    // Command/search input
    this.cmdInput = blessed.textbox({
      parent: screen,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      style: {
        fg: 'white',
        bg: 'black',
        focus: {
          fg: 'white',
          bg: 'blue'
        }
      },
      inputOnFocus: true,
      hidden: true
    });
    
    // Loading box
    this.loadingBox = blessed.loading({
      parent: screen,
      border: 'line',
      height: 5,
      width: 50,
      top: 'center',
      left: 'center',
      label: ' Loading ',
      tags: true,
      hidden: true
    });
    
    // Help text box
    this.helpText = blessed.box({
      parent: screen,
      width: '80%',
      height: '80%',
      top: 'center',
      left: 'center',
      border: {type: 'line'},
      style: {border: {fg: 'white'}},
      hidden: true,
      scrollable: true,
      alwaysScroll: true,
      content: this.getHelpContent(),
      tags: true,
      label: ' Keyboard Shortcuts '
    });
    
    // Conversation switcher
    this.conversationSwitcher = blessed.list({
      parent: screen,
      width: '70%',
      height: '70%',
      top: 'center',
      left: 'center',
      keys: true,
      vi: true,
      mouse: true,
      border: {type: 'line'},
      style: {
        selected: {
          bg: config.theme.highlightBg,
          fg: config.theme.highlightFg,
          bold: true
        },
        border: {fg: config.theme.borderColor}
      },
      scrollbar: {
        ch: ' ',
        style: {bg: 'blue'}
      },
      label: ' Select Conversation ',
      hidden: true,
      tags: true
    });
    
    // Filter settings modal
    this.filterSettings = blessed.form({
      parent: screen,
      width: '50%',
      height: '40%',
      top: 'center',
      left: 'center',
      keys: true,
      vi: true,
      border: {type: 'line'},
      style: {border: {fg: 'white'}},
      label: ' Filter Settings ',
      hidden: true
    });
    
    // Add checkbox for hiding empty conversations
    this.hideEmptyCheckbox = blessed.checkbox({
      parent: this.filterSettings,
      top: 2,
      left: 2,
      height: 1,
      width: '100%-4',
      text: 'Hide Empty Conversations',
      checked: state.hideEmptyConversations,
      style: {
        fg: 'white',
        focus: {
          fg: 'blue'
        }
      }
    });
    
    // Add filter apply button
    this.applyFilterButton = blessed.button({
      parent: this.filterSettings,
      top: 5,
      left: 2,
      height: 1,
      width: 10,
      content: 'Apply',
      style: {
        fg: 'white',
        bg: 'green',
        focus: {
          bg: 'blue'
        }
      }
    });
    
    // Add filter cancel button
    this.cancelFilterButton = blessed.button({
      parent: this.filterSettings,
      top: 5,
      left: 15,
      height: 1,
      width: 10,
      content: 'Cancel',
      style: {
        fg: 'white',
        bg: 'red',
        focus: {
          bg: 'blue'
        }
      }
    });
    
    // Handle apply button
    this.applyFilterButton.on('press', () => {
      state.hideEmptyConversations = this.hideEmptyCheckbox.checked;
      this.filterSettings.hide();
      applyFilters();
      this.render();
    });
    
    // Handle cancel button
    this.cancelFilterButton.on('press', () => {
      this.hideEmptyCheckbox.checked = state.hideEmptyConversations; // Reset to current state
      this.filterSettings.hide();
      this.render();
    });
  },
  
  // Get help text content
  getHelpContent() {
    return `
{bold}Enhanced Conversation Viewer Keyboard Commands{/bold}

{bold}Navigation{/bold}
↑/↓/j/k       Navigate between messages
n/p           Next/Previous message
Home/End/g/G  Jump to first/last message
Page Up/Down  Scroll content up/down

{bold}Display{/bold}
t             Toggle message list panel
m             Cycle view modes (normal, raw, metadata)
+/-           Increase/decrease font size

{bold}Conversation Switching{/bold}
c             Open conversation switcher
[/] or ←/→    Previous/Next conversation
ESC           Close conversation switcher

{bold}Search{/bold}
/             Search (text search in conversation)
n             Next search result
N             Previous search result
ESC           Clear search results

{bold}Filters{/bold}
f             Open filter settings
h             Toggle hide empty conversations

{bold}Commands{/bold}
:             Command mode
  :load path/to/file.json   Load conversation file
  :export output.md         Export conversation
  :theme light/dark         Change theme
  :filter empty=true/false  Set empty conversation filter

{bold}Other Commands{/bold}
?             Show/hide this help
q             Quit application

Press any key to close help
`;
  },
  
  // Show loading indicator
  showLoading(message = 'Loading...') {
    this.loadingBox.load(message);
    this.loadingBox.show();
  },
  
  // Hide loading indicator
  hideLoading() {
    this.loadingBox.stop();
    this.loadingBox.hide();
  },
  
  // Update the header with conversation info
  updateHeader(conversation) {
    if (!conversation) {
      this.header.setContent(' {bold}Enhanced Conversation Viewer{/bold} - No conversation loaded');
      return;
    }
    
    const title = conversation.name || `Conversation ${conversation.uuid.substring(0, 8)}`;
    const date = formatDate(conversation.created_at);
    const msgCount = state.messages.length;
    
    let filterInfo = '';
    if (state.hideEmptyConversations) {
      filterInfo = ' {bold}[Filtered]{/bold}';
    }
    
    const convInfo = state.filteredConversations.length > 1 ? 
      `Conv: ${state.currentConversationIndex + 1}/${state.filteredConversations.length}${filterInfo} | ` : '';
    
    this.header.setContent(
      ` {bold}${title}{/bold} | ${convInfo}Created: ${date} | Messages: ${msgCount} | ${state.currentMessageIndex + 1}/${msgCount}`
    );
  },
  
  // Update the status bar
  updateStatus(message) {
    const filterStatus = state.hideEmptyConversations ? 
      ' | Empty convs hidden' : '';
    
    this.statusBar.setContent(
      ` ${message}${filterStatus} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit | {bold}f{/bold} filters`
    );
  },
  
  // Toggle navigation panel visibility
  toggleNavPanel() {
    state.navCollapsed = !state.navCollapsed;
    
    // Destroy and recreate the content panel to avoid size issues
    this.messageContent.destroy();
    
    // Recreate layout with new proportions
    const navWidth = state.navCollapsed ? 0 : 3;
    
    // Hide or show the message list
    this.messageList.hidden = state.navCollapsed;
    
    // Recreate message content with correct dimensions
    this.messageContent = this.grid.set(1, navWidth, 10, 12 - navWidth, blessed.box, {
      label: ' Message Content ',
      tags: true,
      content: state.messages.length > 0 ? 
        formatMessage(state.messages[state.currentMessageIndex], state.viewMode) : 
        'Select a conversation to view',
      border: {type: 'line'},
      style: {border: {fg: config.theme.borderColor}},
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      padding: 1
    });
    
    // Reattach content panel event listeners
    this.messageContent.key(['pageup'], function() {
      ui.messageContent.scroll(-ui.messageContent.height || -1);
      ui.render();
    });
    
    this.messageContent.key(['pagedown'], function() {
      ui.messageContent.scroll(ui.messageContent.height || 1);
      ui.render();
    });
    
    // Force a full redraw
    screen.realloc();
    screen.clearRegion(0, 0, screen.width, screen.height);
    screen.render();
  },
  
  // Show filter settings
  showFilterSettings() {
    this.hideEmptyCheckbox.checked = state.hideEmptyConversations;
    this.filterSettings.show();
    this.hideEmptyCheckbox.focus();
    screen.render();
  },
  
  // Render the screen
  render() {
    screen.render();
  }
};

// Helper functions
function formatDate(dateStr, format = config.formatting.timestampFormat) {
  if (!dateStr) return 'N/A';
  try {
    return moment(dateStr).format(format);
  } catch (e) {
    return 'Invalid date';
  }
}

// Check if a conversation has any non-empty messages
function hasNonEmptyMessages(conversation) {
  if (!conversation || !Array.isArray(conversation.chat_messages)) {
    return false;
  }
  
  // Check each message for content
  return conversation.chat_messages.some(msg => {
    const text = getMessageText(msg);
    return text && text.trim().length > 0;
  });
}

// Get message text content from various formats
function getMessageText(message) {
  if (!message) return '';
  
  // Direct text field
  if (message.text && typeof message.text === 'string') {
    return message.text;
  }
  
  // Content array with text fields
  if (Array.isArray(message.content)) {
    return message.content
      .filter(item => item && item.text)
      .map(item => item.text)
      .join('\n\n');
  }
  
  return '';
}

// Format message with sender and timestamp
function formatMessage(message, viewMode = 'normal') {
  if (!message) return 'No message selected';
  
  const sender = message.sender || 'unknown';
  const timestamp = formatDate(message.created_at);
  const text = getMessageText(message);
  
  // Different view modes
  if (viewMode === 'raw') {
    // Raw JSON view
    return JSON.stringify(message, null, 2);
  } else if (viewMode === 'metadata') {
    // Metadata focused view
    let output = `{bold}Message ${state.currentMessageIndex + 1}{/bold}\n\n`;
    output += `UUID: ${message.uuid}\n`;
    output += `Sender: ${sender}\n`;
    output += `Created: ${timestamp}\n`;
    output += `Updated: ${formatDate(message.updated_at)}\n\n`;
    
    // Show attachments
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      output += `{bold}Attachments (${message.attachments.length}):{/bold}\n`;
      message.attachments.forEach((a, i) => {
        output += `${i+1}. ${a.file_name || 'Unnamed'} (${a.file_type || 'unknown'})\n`;
      });
      output += '\n';
    }
    
    // Show content structure
    if (Array.isArray(message.content) && message.content.length > 0) {
      output += `{bold}Content Structure (${message.content.length} parts):{/bold}\n`;
      message.content.forEach((part, i) => {
        output += `Part ${i+1}: ${part.type || 'unknown'} (${part.text ? part.text.length : 0} chars)\n`;
      });
    }
    
    return output;
  } else {
    // Normal readable view
    let senderColor = config.theme.userColor;
    if (sender.toLowerCase().includes('assistant')) {
      senderColor = config.theme.assistantColor;
    } else if (sender.toLowerCase().includes('system')) {
      senderColor = config.theme.systemColor;
    }
    
    let output = `{${senderColor}-fg}{bold}${sender}{/bold}{/${senderColor}-fg} `;
    output += `{${config.theme.timestampColor}-fg}[${timestamp}]{/${config.theme.timestampColor}-fg}\n\n`;
    
    // Handle code blocks with syntax highlighting
    let formattedText = text;
    
    // Simple markdown-style code block handling
    formattedText = formattedText.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
      return `\n{white-bg}{black-fg}${lang || 'Code'}:{/black-fg}{/white-bg}\n{black-bg}{green-fg}${code}{/green-fg}{/black-bg}\n`;
    });
    
    output += formattedText;
    return output;
  }
}

// Apply filters to the conversation list
function applyFilters() {
  // Force screen reallocation to prevent UI artifacts
  screen.realloc();
  
  // Start with all conversations
  if (state.hideEmptyConversations) {
    // Filter to only show conversations with non-empty messages
    state.filteredConversations = state.allConversations.filter(hasNonEmptyMessages);
  } else {
    // Show all conversations
    state.filteredConversations = [...state.allConversations];
  }
  
  // Update status bar
  const message = state.hideEmptyConversations 
    ? `Showing ${state.filteredConversations.length} non-empty conversations (filtered from ${state.allConversations.length})`
    : `Showing all ${state.allConversations.length} conversations`;
  
  ui.updateStatus(message);

  // Reset conversation index or choose best valid one
  if (state.filteredConversations.length === 0) {
    // No conversations match the filter
    state.currentConversationIndex = -1;
    state.conversation = null;
    state.messages = [];
    
    // Update UI to show no conversations available
    ui.messageList.clearItems();
    ui.messageContent.setContent('No conversations match current filters. Press {bold}h{/bold} to show all conversations.');
    ui.updateHeader(null);
    
    // Force a full screen redraw to prevent UI artifacts
    screen.clearRegion(0, 0, screen.width, screen.height);
    screen.render();
    
    return false;
  } else if (state.currentConversationIndex >= state.filteredConversations.length) {
    // Current index is now out of bounds, reset to the last valid one
    state.currentConversationIndex = state.filteredConversations.length - 1;
    loadConversation(state.currentConversationIndex);
  } else if (state.currentConversationIndex < 0 && state.filteredConversations.length > 0) {
    // No current conversation but we have valid ones, load the first
    state.currentConversationIndex = 0;
    loadConversation(0);
  } else if (state.conversation) {
    // Check if current conversation is still in filtered list
    const currentUuid = state.conversation.uuid;
    const stillExists = state.filteredConversations.some(c => c.uuid === currentUuid);
    
    if (!stillExists) {
      // Current conversation was filtered out, load first available
      state.currentConversationIndex = 0;
      loadConversation(0);
    } else {
      // Current conversation still valid, refresh UI
      updateConversationSwitcher();
      ui.updateHeader(state.conversation);
      
      // Force a full screen redraw to prevent UI artifacts
      screen.clearRegion(0, 0, screen.width, screen.height);
      screen.render();
    }
  }
  
  return true;
}

// Data loading
async function loadConversationFile(filePath) {
  try {
    ui.showLoading('Loading conversation file...');
    
    // Read and parse the file
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawData);
    
    if (Array.isArray(data)) {
      // Store all conversations
      state.allConversations = data;
      
      // Apply filters - will repopulate filteredConversations
      const hasValidConversations = applyFilters();
      
      ui.updateStatus(`Loaded ${data.length} conversations from ${filePath}`);
      
      if (hasValidConversations) {
        // Load the first conversation if we haven't already in applyFilters
        if (state.currentConversationIndex < 0 && state.filteredConversations.length > 0) {
          loadConversation(0);
        }
      }
    } else {
      // Single conversation object
      state.allConversations = [data];
      
      // Apply filters
      const hasValidConversations = applyFilters();
      
      if (hasValidConversations) {
        loadConversation(0);
        ui.updateStatus(`Loaded single conversation`);
      }
    }
    
    ui.hideLoading();
    ui.render();
    
  } catch (err) {
    ui.hideLoading();
    ui.updateStatus(`Error loading conversation: ${err.message}`);
    console.error('Error loading conversation:', err);
  }
}

// Load a specific conversation by index in the filtered list
function loadConversation(index) {
  if (index < 0 || index >= state.filteredConversations.length) {
    ui.updateStatus(`Invalid conversation index: ${index}`);
    return;
  }
  
  state.currentConversationIndex = index;
  state.conversation = state.filteredConversations[index];
  
  // Extract messages
  if (state.conversation && Array.isArray(state.conversation.chat_messages)) {
    state.messages = state.conversation.chat_messages;
    state.currentMessageIndex = 0;
  } else {
    state.messages = [];
  }
  
  // Update UI
  updateMessageList();
  ui.updateHeader(state.conversation);
  
  if (state.messages.length > 0) {
    showMessage(state.currentMessageIndex);
  } else {
    ui.messageContent.setContent('No messages in this conversation');
  }
  
  const filterIndicator = state.hideEmptyConversations ? 
    ' (filtered view)' : '';
  
  ui.updateStatus(`Loaded conversation ${index + 1} of ${state.filteredConversations.length}${filterIndicator}`);
  ui.render();
}

// Update the message list
function updateMessageList() {
  ui.messageList.clearItems();
  
  state.messages.forEach((msg, idx) => {
    const sender = msg.sender || 'unknown';
    const text = getMessageText(msg);
    let preview = text ? text.replace(/\n/g, ' ').substring(0, config.formatting.maxPreviewLength) : '';
    
    if (preview.length >= config.formatting.maxPreviewLength) {
      preview += '...';
    }
    
    if (preview.length === 0) {
      preview = '(empty)';
    }
    
    ui.messageList.addItem(`${idx + 1}. ${sender}: ${preview}`);
  });
  
  if (state.currentMessageIndex >= 0 && state.currentMessageIndex < state.messages.length) {
    ui.messageList.select(state.currentMessageIndex);
  }
}

// Show a specific message
function showMessage(index) {
  if (index < 0 || index >= state.messages.length) {
    return;
  }
  
  state.currentMessageIndex = index;
  const message = state.messages[index];
  
  ui.messageContent.setContent(formatMessage(message, state.viewMode));
  ui.messageContent.scrollTo(0);
  
  ui.messageList.select(index);
  ui.updateHeader(state.conversation);
  ui.updateStatus(`Message ${index + 1} of ${state.messages.length}`);
  
  ui.render();
}

// Toggle view mode (cycles through normal, raw, metadata)
function toggleViewMode() {
  const modes = ['normal', 'raw', 'metadata'];
  const currentIndex = modes.indexOf(state.viewMode);
  state.viewMode = modes[(currentIndex + 1) % modes.length];
  
  // Refresh current message with new view mode
  showMessage(state.currentMessageIndex);
  ui.updateStatus(`View mode: ${state.viewMode}`);
}

// Export conversation to markdown
function exportConversation(outputPath) {
  try {
    if (!state.conversation || state.messages.length === 0) {
      ui.updateStatus('No conversation to export');
      return false;
    }
    
    let output = '';
    
    // Add conversation metadata
    const title = state.conversation.name || `Conversation ${state.conversation.uuid}`;
    const date = formatDate(state.conversation.created_at);
    
    output += `# ${title}\n`;
    output += `Date: ${date}\n`;
    output += `UUID: ${state.conversation.uuid}\n\n`;
    
    // Add messages
    state.messages.forEach((msg, index) => {
      const role = msg.sender || 'unknown';
      const date = formatDate(msg.created_at);
      
      output += `## Message ${index + 1} (${role}) - ${date}\n\n`;
      
      // Get message text
      const text = getMessageText(msg);
      output += `${text || '(empty message)'}\n\n`;
      
      // Add attachments if any
      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        output += `### Attachments\n`;
        msg.attachments.forEach((attach, i) => {
          output += `- ${attach.file_name || 'Unnamed'} (${attach.file_type || 'unknown'})\n`;
        });
        output += '\n';
      }
    });
    
    // Write to file
    const finalPath = outputPath || `conversation_export_${state.conversation.uuid.substring(0, 8)}.md`;
    fs.writeFileSync(finalPath, output);
    
    ui.updateStatus(`Exported ${state.messages.length} messages to ${finalPath}`);
    return true;
    
  } catch (err) {
    ui.updateStatus(`Error exporting messages: ${err.message}`);
    console.error('Export error:', err);
    return false;
  }
}

// Search in conversation
function searchInConversation(term) {
  if (!term || term.length === 0) {
    state.searchResults = [];
    state.searchMode = false;
    ui.updateStatus('Search canceled');
    return;
  }
  
  state.searchTerm = term;
  state.searchResults = [];
  state.searchIndex = 0;
  
  // Search in all messages
  state.messages.forEach((msg, idx) => {
    const text = getMessageText(msg).toLowerCase();
    if (text.includes(term.toLowerCase())) {
      state.searchResults.push(idx);
    }
  });
  
  if (state.searchResults.length > 0) {
    state.searchMode = true;
    ui.updateStatus(`Found ${state.searchResults.length} results for "${term}"`);
    
    // Jump to first result
    showMessage(state.searchResults[0]);
  } else {
    state.searchMode = false;
    ui.updateStatus(`No results found for "${term}"`);
  }
}

// Go to next/previous search result
function navigateSearchResults(forward = true) {
  if (!state.searchMode || state.searchResults.length === 0) {
    return;
  }
  
  if (forward) {
    state.searchIndex = (state.searchIndex + 1) % state.searchResults.length;
  } else {
    state.searchIndex = (state.searchIndex - 1 + state.searchResults.length) % state.searchResults.length;
  }
  
  const messageIndex = state.searchResults[state.searchIndex];
  showMessage(messageIndex);
  
  ui.updateStatus(`Result ${state.searchIndex + 1} of ${state.searchResults.length} for "${state.searchTerm}"`);
}

// Show conversation switcher
function showConversationSwitcher() {
  updateConversationSwitcher();
  
  // Show the switcher
  state.conversationSwitcherActive = true;
  ui.conversationSwitcher.show();
  ui.conversationSwitcher.focus();
  ui.render();
}

// Update the conversation switcher list
function updateConversationSwitcher() {
  // Update conversation list
  ui.conversationSwitcher.clearItems();
  
  // Add filter indicator to title if needed
  const filterInfo = state.hideEmptyConversations ? 
    ' (Filtered - Showing Non-Empty Only)' : '';
  
  ui.conversationSwitcher.setLabel(` Select Conversation${filterInfo} `);
  
  state.filteredConversations.forEach((conv, idx) => {
    const title = conv.name || `Conversation ${conv.uuid.substring(0, 8)}`;
    const date = formatDate(conv.created_at);
    const msgCount = Array.isArray(conv.chat_messages) ? conv.chat_messages.length : 0;
    const hasContent = hasNonEmptyMessages(conv) ? '' : ' (empty)';
    
    ui.conversationSwitcher.addItem(
      `${idx + 1}. ${title} | ${date} | ${msgCount} messages${hasContent}`
    );
  });
  
  // Select current conversation
  if (state.currentConversationIndex >= 0 && state.currentConversationIndex < state.filteredConversations.length) {
    ui.conversationSwitcher.select(state.currentConversationIndex);
  }
}

// Hide conversation switcher
function hideConversationSwitcher() {
  state.conversationSwitcherActive = false;
  ui.conversationSwitcher.hide();
  ui.messageContent.focus();
  ui.render();
}

// Switch to previous/next conversation
function switchConversation(direction) {
  if (state.filteredConversations.length <= 1) {
    ui.updateStatus('No other conversations available');
    return;
  }
  
  let newIndex = state.currentConversationIndex + direction;
  
  // Handle wrap-around
  if (newIndex < 0) {
    newIndex = state.filteredConversations.length - 1;
  } else if (newIndex >= state.filteredConversations.length) {
    newIndex = 0;
  }
  
  loadConversation(newIndex);
}

// Toggle the empty conversations filter
function toggleEmptyConversationsFilter() {
  // Force screen reallocation to prevent UI artifacts
  screen.realloc();
  
  state.hideEmptyConversations = !state.hideEmptyConversations;
  
  // Apply the updated filter
  applyFilters();
  
  ui.updateStatus(state.hideEmptyConversations ? 
    'Empty conversations are now hidden' : 
    'All conversations are now shown');
    
  // Force a full screen redraw
  screen.clearRegion(0, 0, screen.width, screen.height);
  screen.render();
}

// Process command input
function handleCommand(cmd) {
  cmd = cmd.trim();
  
  if (!cmd) return;
  
  // Parse command and arguments
  const parts = cmd.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  if (command === 'load') {
    if (args.length < 1) {
      ui.updateStatus('Missing file path. Usage: load path/to/file.json');
      return;
    }
    
    loadConversationFile(args[0]);
    
  } else if (command === 'export') {
    const outputPath = args.length >= 1 ? args[0] : null;
    exportConversation(outputPath);
    
  } else if (command === 'theme') {
    if (args.length < 1) {
      ui.updateStatus('Missing theme name. Usage: theme light/dark');
      return;
    }
    
    const theme = args[0].toLowerCase();
    if (theme === 'light') {
      // Set light theme colors
      config.theme.assistantColor = 'green';
      config.theme.userColor = 'blue';
      config.theme.systemColor = 'yellow';
    } else if (theme === 'dark') {
      // Set dark theme colors
      config.theme.assistantColor = 'cyan';
      config.theme.userColor = 'magenta';
      config.theme.systemColor = 'yellow';
    } else {
      ui.updateStatus(`Unknown theme: ${theme}. Available themes: light, dark`);
      return;
    }
    
    // Refresh current message with new theme
    if (state.currentMessageIndex >= 0 && state.messages.length > 0) {
      showMessage(state.currentMessageIndex);
    }
    ui.updateStatus(`Theme set to ${theme}`);
    
  } else if (command === 'goto') {
    // Go to conversation by index
    if (args.length < 1) {
      ui.updateStatus('Missing conversation index. Usage: goto [number]');
      return;
    }
    
    const index = parseInt(args[0]) - 1; // Convert from 1-based to 0-based
    loadConversation(index);
    
  } else if (command === 'filter') {
    if (args.length >= 1 && args[0].startsWith('empty=')) {
      const value = args[0].split('=')[1].toLowerCase();
      
      if (value === 'true') {
        state.hideEmptyConversations = true;
      } else if (value === 'false') {
        state.hideEmptyConversations = false;
      } else {
        ui.updateStatus('Invalid filter value. Use empty=true or empty=false');
        return;
      }
      
      applyFilters();
    } else {
      ui.showFilterSettings();
    }
    
  } else {
    ui.updateStatus(`Unknown command: ${command}`);
  }
}

// Set up event listeners
function setupEventListeners() {
  // Quit
  screen.key(['escape', 'q', 'C-c'], function() {
    if (state.conversationSwitcherActive) {
      // If conversation switcher is active, escape closes it
      hideConversationSwitcher();
    } else if (ui.filterSettings.visible) {
      // If filter settings is visible, escape closes it
      ui.filterSettings.hide();
      ui.render();
    } else if (state.searchMode) {
      // If in search mode, escape clears search
      state.searchMode = false;
      state.searchResults = [];
      ui.updateStatus('Search cleared');
      ui.render();
    } else {
      return process.exit(0);
    }
  });
  
  // Help toggle
  screen.key('?', function() {
    ui.helpText.toggle();
    ui.render();
  });
  
  // Close help on key press
  ui.helpText.key(['escape', 'q', 'enter', 'space'], function() {
    ui.helpText.hide();
    ui.render();
  });
  
  // Message navigation
  screen.key(['up', 'k', 'p'], function() {
    if (state.currentMessageIndex > 0) {
      showMessage(state.currentMessageIndex - 1);
    }
  });
  
  screen.key(['down', 'j', 'n'], function() {
    if (state.currentMessageIndex < state.messages.length - 1) {
      showMessage(state.currentMessageIndex + 1);
    }
  });
  
  // Jump to start/end
  screen.key(['home', 'g'], function() {
    if (state.messages.length > 0) {
      showMessage(0);
    }
  });
  
  screen.key(['end', 'G'], function() {
    if (state.messages.length > 0) {
      showMessage(state.messages.length - 1);
    }
  });
  
  // Note: Page up/down listeners are attached when the message content is created
  // and also when it's recreated in toggleNavPanel()
  
  // Toggle navigation panel
  screen.key('t', function() {
    ui.toggleNavPanel();
  });
  
  // Toggle view mode
  screen.key('m', function() {
    toggleViewMode();
  });
  
  // Message list selection
  ui.messageList.on('select', function(item, index) {
    showMessage(index);
  });
  
  // Conversation switcher
  screen.key('c', function() {
    if (state.filteredConversations.length > 1) {
      showConversationSwitcher();
    } else {
      ui.updateStatus('Only one conversation available');
    }
  });
  
  // Conversation switcher selection
  ui.conversationSwitcher.on('select', function(item, index) {
    hideConversationSwitcher();
    loadConversation(index);
  });
  
  // Next/previous conversation
  screen.key(['[', 'left'], function() {
    switchConversation(-1); // Previous
  });
  
  screen.key([']', 'right'], function() {
    switchConversation(1); // Next
  });
  
  // Search mode
  screen.key('/', function() {
    ui.cmdInput.setValue('');
    ui.cmdInput.show();
    ui.cmdInput.focus();
    ui.updateStatus('Search: Type your search term and press Enter');
    ui.render();
  });
  
  // Search navigation
  screen.key('n', function() {
    if (state.searchMode) {
      navigateSearchResults(true);
    }
  });
  
  screen.key('N', function() {
    if (state.searchMode) {
      navigateSearchResults(false);
    }
  });
  
  // Filter settings
  screen.key('f', function() {
    ui.showFilterSettings();
  });
  
  // Toggle hide empty conversations with shortcut
  screen.key('h', function() {
    toggleEmptyConversationsFilter();
  });
  
  // Command mode
  screen.key(':', function() {
    ui.cmdInput.setValue(':');
    ui.cmdInput.show();
    ui.cmdInput.focus();
    ui.updateStatus('Command mode: Enter command and press Enter');
    ui.render();
  });
  
  // Input handling
  ui.cmdInput.key(['escape'], function() {
    ui.cmdInput.hide();
    ui.cmdInput.clearValue();
    ui.updateStatus('Command canceled');
    ui.render();
  });
  
  ui.cmdInput.key(['enter'], function() {
    const input = ui.cmdInput.getValue();
    ui.cmdInput.hide();
    ui.cmdInput.clearValue();
    
    if (input.startsWith(':')) {
      // Command mode
      handleCommand(input.substring(1));
    } else {
      // Search mode
      searchInConversation(input);
    }
    
    ui.render();
  });
}

// Initialize the application
function init() {
  // Initialize UI
  ui.init();
  
  // Setup event listeners
  setupEventListeners();
  
  // Add welcome message
  ui.messageContent.setContent(`
{bold}Enhanced Conversation Viewer{/bold}

This tool is designed for focused, efficient reading and 
analysis of conversation data with improved readability.

To get started, load a conversation file with the command:
  :load path/to/conversation.json

Or if provided on the command line, it will load automatically.

{bold}Key Features:{/bold}
• Efficient screen utilization for better readability
• Multiple view modes (normal, raw, metadata)
• Full-text search within conversations
• Ability to hide empty conversations with 'h' key
• Export to markdown for sharing

Press {bold}?{/bold} to view all keyboard shortcuts.
`);
  
  // Focus explorer by default
  ui.messageContent.focus();
  
  // Handle command line arguments
  if (process.argv.length >= 3) {
    const filePath = process.argv[2];
    loadConversationFile(filePath);
  }
  
  ui.render();
}

// Start the application
init();