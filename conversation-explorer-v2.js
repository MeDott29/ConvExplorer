#!/usr/bin/env node

/**
 * Conversation JSON Explorer v2
 * 
 * An improved NCurses-style interface for navigating large JSON conversation datasets
 * with better memory management, consistent state handling, and improved performance.
 */

const fs = require('fs');
const path = require('path');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const moment = require('moment');
const chalk = require('chalk');

// Create a screen object
const screen = blessed.screen({
  smartCSR: true,
  title: 'Conversation Explorer v2'
});

// Application state
const state = {
  // File and data management
  filePath: '',
  isLoading: false,
  
  // Pagination
  pageSize: 100,
  currentPage: 0,
  
  // View state
  activeView: 'welcome', // 'welcome', 'conversations', 'messages', 'statistics', 'chart'
  selectedIndex: 0,
  
  // Navigation stack for back functionality 
  navStack: [],
  
  // Filter and sort settings
  filters: {
    dateStart: null,
    dateEnd: null,
    searchTerm: '',
    hasMessages: false,
    hasEmptyMessages: false
  },
  
  sort: {
    field: 'date',  // 'date', 'size', 'messages'
    direction: 'desc'
  },
  
  // Current view cache
  currentItems: [],
  
  // Currently selected conversation/message
  selectedConversation: null,
  selectedMessage: null,
  
  // Statistics cache
  stats: {
    totalConversations: 0,
    totalMessages: 0,
    messagesByRole: {},
    conversationsByMonth: {},
    emptyMessages: 0,
    messageLengths: {
      empty: 0,
      short: 0,  // < 50 chars
      medium: 0, // 50-500 chars
      long: 0    // > 500 chars
    }
  }
};

// Data storage - using proxies to handle lazy loading
const dataStore = {
  // Raw conversation data - stored as array for direct indexing
  conversations: [],
  
  // Index for faster lookup by uuid
  conversationIndex: new Map(),
  
  // Filtered view of conversations (references, not copies)
  filteredConversations: [],
  
  // Message cache for the currently selected conversation
  currentMessages: [],
  
  // Clear all data
  clear() {
    this.conversations = [];
    this.conversationIndex.clear();
    this.filteredConversations = [];
    this.currentMessages = [];
  },
  
  // Get a conversation by index
  getConversation(index) {
    if (index >= 0 && index < this.filteredConversations.length) {
      return this.filteredConversations[index];
    }
    return null;
  },
  
  // Get a message from the current conversation
  getMessage(index) {
    if (index >= 0 && index < this.currentMessages.length) {
      return this.currentMessages[index];
    }
    return null;
  },
  
  // Set the current conversation and load its messages
  setCurrentConversation(conversation) {
    if (!conversation) {
      this.currentMessages = [];
      return;
    }
    
    if (Array.isArray(conversation.chat_messages)) {
      this.currentMessages = conversation.chat_messages;
    } else {
      this.currentMessages = [];
    }
  }
};

// Helper functions
const helpers = {
  // Format date string for display
  formatDate(dateStr, format = 'YYYY-MM-DD HH:mm:ss') {
    if (!dateStr) return 'N/A';
    try {
      return moment(dateStr).format(format);
    } catch (e) {
      return 'Invalid date';
    }
  },
  
  // Format file size
  formatSize(bytes) {
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  },
  
  // Extract message text from various message formats
  getMessageText(message) {
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
  },
  
  // Get conversation size estimate
  getConversationSize(conversation) {
    if (!conversation) return 0;
    
    // Use message count as a proxy for size to avoid JSON.stringify overhead
    const messageCount = Array.isArray(conversation.chat_messages) ? 
      conversation.chat_messages.length : 0;
      
    // Base size + estimated size per message
    return 500 + (messageCount * 2000);
  },
  
  // Get chat message count for a conversation
  getMessageCount(conversation) {
    if (!conversation || !Array.isArray(conversation.chat_messages)) {
      return 0;
    }
    return conversation.chat_messages.length;
  },
  
  // Check if a conversation contains empty messages
  hasEmptyMessages(conversation) {
    if (!conversation || !Array.isArray(conversation.chat_messages)) {
      return false;
    }
    
    return conversation.chat_messages.some(msg => {
      const text = helpers.getMessageText(msg);
      return !text || text.trim().length === 0;
    });
  },
  
  // Deep search object for term without stringify
  deepSearch(obj, term) {
    if (!obj || !term) return false;
    term = term.toLowerCase();
    
    // String check
    if (typeof obj === 'string') {
      return obj.toLowerCase().includes(term);
    }
    
    // Array check - any element matches
    if (Array.isArray(obj)) {
      return obj.some(item => helpers.deepSearch(item, term));
    }
    
    // Object check - any value matches
    if (typeof obj === 'object') {
      for (const key in obj) {
        if (
          typeof obj[key] === 'string' && 
          obj[key].toLowerCase().includes(term)
        ) {
          return true;
        }
        if (
          (typeof obj[key] === 'object' || Array.isArray(obj[key])) && 
          helpers.deepSearch(obj[key], term)
        ) {
          return true;
        }
      }
    }
    
    return false;
  },
  
  // Debounce function to limit execution rate
  debounce(func, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }
};

// UI Components
const ui = {
  // Layout components
  grid: null,
  explorer: null,
  detailPanel: null,
  statusBar: null,
  cmdInput: null,
  helpText: null,
  chartBox: null,
  distributionChart: null,
  loadingBox: null,
  
  // Initialize the UI components
  init() {
    // Create the grid layout
    this.grid = new contrib.grid({rows: 12, cols: 12, screen: screen});
    
    // Main explorer panel
    this.explorer = this.grid.set(0, 0, 9, 8, blessed.list, {
      keys: true,
      vi: true,
      mouse: true,
      border: {type: 'line'},
      style: {
        selected: {bg: 'blue', fg: 'white', bold: true},
        item: {fg: 'white'},
        border: {fg: 'white'}
      },
      scrollbar: {
        ch: ' ',
        style: {bg: 'blue'}
      },
      label: ' Conversations '
    });
    
    // Detail panel
    this.detailPanel = this.grid.set(0, 8, 9, 4, blessed.box, {
      label: ' Details ',
      content: 'Select an item to view details',
      border: {type: 'line'},
      style: {border: {fg: 'white'}},
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true
    });
    
    // Status bar
    this.statusBar = this.grid.set(9, 0, 1, 12, blessed.text, {
      content: ' {bold}Conversation Explorer v2{/bold} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue'
      }
    });
    
    // Command input
    this.cmdInput = this.grid.set(10, 0, 1, 12, blessed.textbox, {
      border: {type: 'line'},
      style: {
        border: {fg: 'white'},
        focus: {
          fg: 'white',
          bg: 'blue'
        }
      },
      inputOnFocus: true,
      label: ' Command '
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
      tags: true
    });
    
    // Chart box for distribution visualization
    this.chartBox = blessed.box({
      parent: screen,
      width: '90%',
      height: '80%',
      top: 'center',
      left: 'center',
      tags: true,
      border: {type: 'line'},
      style: {border: {fg: 'blue'}},
      label: ' Message Distribution ',
      hidden: true
    });
    
    // Message distribution chart
    this.distributionChart = contrib.bar({
      parent: this.chartBox,
      label: 'Message Distribution',
      barWidth: 7,
      barSpacing: 1,
      xOffset: 2,
      maxHeight: 15,
      height: '90%',
      width: '90%',
      top: 2,
      left: 'center',
      style: {
        bar: {
          bg: 'blue'
        }
      }
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
  },
  
  // Get help text content
  getHelpContent() {
    return `
{bold}Conversation Explorer v2 Keyboard Commands{/bold}

{bold}Navigation{/bold}
↑/↓/j/k       Navigate up/down
Enter         Open selected conversation / view message details
Backspace     Go back to parent
Home/End/g/G  Jump to top/bottom
Page Up/Down  Move by pages

{bold}Filtering and Sorting{/bold}
/             Search (text search in conversations)
t             Filter by date range
s             Change sort method (date, size, messages)
r             Reverse sort order

{bold}Views{/bold}
1             Show all conversations
2             Show conversations with messages
3             Show statistics
f             Show conversations with empty messages

{bold}Actions{/bold}
e             Export current conversation to Markdown
d             Show message distribution chart

{bold}Command Mode{/bold}
:             Command mode
  :load path/to/file.json   Load conversation data
  :filter 2024-01-01 to 2024-02-01   Filter by date range
  :search keyword           Search for text
  :export output.md         Export current conversation
  :clear                    Clear all filters

{bold}Other Commands{/bold}
?             Show/hide this help
q             Quit application

Press any key to close help
`;
  },
  
  // Reset the explorer list
  resetExplorer() {
    this.explorer.clearItems();
    this.explorer.scrollTo(0);
    this.setDetailContent('');
  },
  
  // Set detail panel content
  setDetailContent(content) {
    this.detailPanel.setContent(content);
    this.detailPanel.scrollTo(0);
  },
  
  // Set status message
  setStatus(message) {
    this.statusBar.setContent(
      ` {bold}Conversation Explorer v2{/bold} | ${message} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit`
    );
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
  
  // Render the screen
  render() {
    screen.render();
  }
};

// View Controllers
const views = {
  // Welcome screen
  showWelcome() {
    state.activeView = 'welcome';
    ui.resetExplorer();
    ui.explorer.setLabel(' Welcome ');
    
    ui.explorer.addItem('Welcome to Conversation Explorer v2!');
    ui.explorer.addItem('');
    ui.explorer.addItem('To load conversation data, use:');
    ui.explorer.addItem('  :load path/to/conversations.json');
    ui.explorer.addItem('');
    ui.explorer.addItem('Or press ? for help');
    
    ui.setDetailContent(`
{bold}Conversation Explorer v2{/bold}

A terminal-based explorer for large conversation datasets
with efficient navigation and analysis features.

{bold}Features:{/bold}
• Memory-efficient data loading
• Fast search and filtering
• Intuitive navigation
• Statistical analysis
• Content export

Press ? to view keyboard commands
`);
    
    ui.setStatus('Welcome! Load data with :load path/to/file.json');
    ui.render();
  },
  
  // Show conversations list
  showConversations() {
    state.activeView = 'conversations';
    ui.resetExplorer();
    
    // Apply current filters to get the data view
    filterAndSortData();
    
    // Set the appropriate title
    let title = ' Conversations ';
    if (state.filters.searchTerm) {
      title += `| Search: ${state.filters.searchTerm} `;
    }
    if (state.filters.hasMessages) {
      title += '| With Messages ';
    }
    if (state.filters.hasEmptyMessages) {
      title += '| With Empty Messages ';
    }
    ui.explorer.setLabel(title);
    
    // Determine pagination
    const totalItems = dataStore.filteredConversations.length;
    const pageStart = state.currentPage * state.pageSize;
    const pageEnd = Math.min(pageStart + state.pageSize, totalItems);
    const currentPageItems = dataStore.filteredConversations.slice(pageStart, pageEnd);
    
    // Add page navigation if needed
    if (totalItems > state.pageSize) {
      ui.explorer.addItem(`--- Page ${state.currentPage + 1} of ${Math.ceil(totalItems / state.pageSize)} ---`);
    }
    
    // Add each conversation to the list
    currentPageItems.forEach((conv, idx) => {
      const date = helpers.formatDate(conv.created_at);
      const messageCount = helpers.getMessageCount(conv);
      const sizeEstimate = helpers.formatSize(helpers.getConversationSize(conv));
      const title = conv.name || `Conversation ${conv.uuid.substring(0, 8)}`;
      
      ui.explorer.addItem(`${date} │ ${messageCount.toString().padStart(3)} msgs │ ${sizeEstimate} │ ${title.substring(0, 40)}`);
      state.currentItems[idx] = pageStart + idx; // Store actual index in the filtered list
    });
    
    // Show status with pagination info
    ui.setStatus(`Showing ${pageStart + 1}-${pageEnd} of ${totalItems} conversations`);
    ui.render();
  },
  
  // Show conversation messages
  showMessages() {
    state.activeView = 'messages';
    ui.resetExplorer();
    
    // Get the selected conversation
    const conversation = state.selectedConversation;
    if (!conversation) {
      views.showConversations();
      return;
    }
    
    // Set current messages
    dataStore.setCurrentConversation(conversation);
    
    // Set the title
    const title = conversation.name || `Conversation ${conversation.uuid.substring(0, 8)}`;
    ui.explorer.setLabel(` Messages: ${title} `);
    
    // Add each message to the list
    dataStore.currentMessages.forEach((msg, idx) => {
      const date = helpers.formatDate(msg.created_at);
      const sender = msg.sender || 'unknown';
      
      // Get a preview of the text
      let text = helpers.getMessageText(msg);
      let preview = '';
      if (text) {
        preview = text.replace(/\n/g, ' ').substring(0, 40);
        if (preview.length >= 40) preview += '...';
      }
      
      ui.explorer.addItem(`${idx + 1}. ${date} │ ${sender.padEnd(9)} │ ${preview}`);
      state.currentItems[idx] = idx;
    });
    
    // Show conversation details
    showConversationDetail(conversation);
    
    ui.setStatus(`Showing ${dataStore.currentMessages.length} messages from conversation ${conversation.uuid.substring(0, 8)}`);
    ui.render();
  },
  
  // Show statistics view
  showStatistics() {
    state.activeView = 'statistics';
    ui.resetExplorer();
    ui.explorer.setLabel(' Statistics ');
    
    // Monthly activity
    ui.explorer.addItem('Monthly Activity');
    ui.explorer.addItem('───────────────────────');
    
    const months = Object.keys(state.stats.conversationsByMonth).sort();
    months.forEach(month => {
      const stats = state.stats.conversationsByMonth[month];
      ui.explorer.addItem(`${month} │ ${stats.conversations} convs │ ${stats.messages} msgs`);
    });
    
    ui.explorer.addItem('');
    ui.explorer.addItem('Message Count by Role');
    ui.explorer.addItem('───────────────────────');
    
    Object.entries(state.stats.messagesByRole).forEach(([role, count]) => {
      ui.explorer.addItem(`${role} │ ${count} messages`);
    });
    
    ui.explorer.addItem('');
    ui.explorer.addItem('Message Length Distribution');
    ui.explorer.addItem('───────────────────────');
    ui.explorer.addItem(`Empty:       ${state.stats.messageLengths.empty}`);
    ui.explorer.addItem(`Short (<50): ${state.stats.messageLengths.short}`);
    ui.explorer.addItem(`Medium:      ${state.stats.messageLengths.medium}`);
    ui.explorer.addItem(`Long (>500): ${state.stats.messageLengths.long}`);
    
    ui.explorer.addItem('');
    ui.explorer.addItem('General Statistics');
    ui.explorer.addItem('───────────────────────');
    ui.explorer.addItem(`Total conversations: ${state.stats.totalConversations}`);
    ui.explorer.addItem(`Total messages: ${state.stats.totalMessages}`);
    ui.explorer.addItem(`Empty messages: ${state.stats.emptyMessages}`);
    
    if (state.stats.totalConversations > 0) {
      ui.explorer.addItem(`Messages per conversation: ${(state.stats.totalMessages / state.stats.totalConversations).toFixed(2)}`);
    }
    
    // Set detail content
    ui.setDetailContent('{bold}Statistics{/bold}\n\nSelect a statistic from the list to see more details.');
    
    ui.setStatus('Showing conversation statistics');
    ui.render();
  },
  
  // Show message distribution chart
  showDistributionChart() {
    // Prepare data for the chart
    const data = {
      titles: [],
      data: []
    };
    
    // Add message distribution by role
    Object.entries(state.stats.messagesByRole)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) // Top 5 roles
      .forEach(([role, count]) => {
        data.titles.push(role);
        data.data.push(count);
      });
    
    // Add message distribution by length
    const lengthLabels = {
      empty: 'Empty',
      short: '1-50 chars',
      medium: '51-500 chars',
      long: '500+ chars'
    };
    
    Object.entries(state.stats.messageLengths).forEach(([key, count]) => {
      data.titles.push(lengthLabels[key]);
      data.data.push(count);
    });
    
    // Add some time-based statistics
    const months = Object.keys(state.stats.conversationsByMonth).sort().slice(-5); // Last 5 months
    months.forEach(month => {
      data.titles.push(month);
      data.data.push(state.stats.conversationsByMonth[month].messages);
    });
    
    // Update and show the chart
    ui.distributionChart.setData({
      titles: data.titles,
      data: data.data
    });
    
    ui.chartBox.show();
    ui.render();
  }
};

// Detail views
function showConversationDetail(conversation) {
  if (!conversation) {
    ui.setDetailContent('No conversation selected');
    return;
  }
  
  const date = helpers.formatDate(conversation.created_at);
  const updated = helpers.formatDate(conversation.updated_at);
  const title = conversation.name || `Conversation ${conversation.uuid.substring(0, 8)}`;
  
  let content = `{bold}${title}{/bold}\n\n`;
  content += `UUID: ${conversation.uuid}\n`;
  content += `Created: ${date}\n`;
  content += `Updated: ${updated}\n`;
  content += `Messages: ${helpers.getMessageCount(conversation)}\n`;
  
  if (conversation.account && conversation.account.uuid) {
    content += `Account: ${conversation.account.uuid}\n`;
  }
  
  if (Array.isArray(conversation.chat_messages) && conversation.chat_messages.length > 0) {
    content += `\n{bold}Message Preview:{/bold}\n`;
    
    conversation.chat_messages.slice(0, 3).forEach((msg, i) => {
      const role = msg.sender || 'unknown';
      const text = helpers.getMessageText(msg);
      
      if (text && text.length > 0) {
        const preview = text.substring(0, 100);
        content += `\n${i+1}. ${role}: ${preview}${preview.length >= 100 ? '...' : ''}\n`;
      } else {
        content += `\n${i+1}. ${role}: (empty message)\n`;
      }
    });
    
    if (conversation.chat_messages.length > 3) {
      content += `\n... and ${conversation.chat_messages.length - 3} more messages`;
    }
  }
  
  ui.setDetailContent(content);
}

function showMessageDetail(message) {
  if (!message) {
    ui.setDetailContent('No message selected');
    return;
  }
  
  const date = helpers.formatDate(message.created_at);
  const updated = helpers.formatDate(message.updated_at);
  const role = message.sender || 'unknown';
  
  let content = `{bold}Message from ${role}{/bold}\n\n`;
  content += `UUID: ${message.uuid}\n`;
  content += `Created: ${date}\n`;
  content += `Updated: ${updated}\n`;
  
  // Show message text
  const text = helpers.getMessageText(message);
  if (text && text.length > 0) {
    content += `\n{bold}Text:{/bold}\n${text.substring(0, 2000)}${text.length > 2000 ? '...(truncated)' : ''}\n`;
  } else {
    content += `\n{bold}Text:{/bold}\n(empty)\n`;
  }
  
  // Handle content array
  if (Array.isArray(message.content) && message.content.length > 0) {
    content += `\n{bold}Content (${message.content.length} parts):{/bold}\n`;
    
    message.content.forEach((part, i) => {
      content += `\nPart ${i+1} (${part.type || 'unknown'}):\n`;
      
      if (part.text && part.text.length > 0) {
        const displayText = part.text.substring(0, 500);
        content += `${displayText}${part.text.length > 500 ? '...(truncated)' : ''}\n`;
      } else {
        content += `(empty text)\n`;
      }
      
      if (part.citations && part.citations.length > 0) {
        content += `Citations: ${part.citations.length}\n`;
      }
    });
  }
  
  // Show attachments
  if (Array.isArray(message.attachments) && message.attachments.length > 0) {
    content += `\n{bold}Attachments:{/bold}\n`;
    message.attachments.forEach((attach, i) => {
      content += `${i+1}. ${attach.file_name || 'Unnamed'} (${attach.file_type || 'unknown'}, ${helpers.formatSize(attach.file_size || 0)})\n`;
    });
  }
  
  // Show files
  if (Array.isArray(message.files) && message.files.length > 0) {
    content += `\n{bold}Files:{/bold}\n`;
    message.files.forEach((file, i) => {
      content += `${i+1}. ${file.file_name || 'Unnamed'}\n`;
    });
  }
  
  ui.setDetailContent(content);
}

// Data management
async function loadDataFile(filePath) {
  try {
    ui.showLoading('Loading file...');
    
    // Reset data
    dataStore.clear();
    state.stats = {
      totalConversations: 0,
      totalMessages: 0,
      messagesByRole: {},
      conversationsByMonth: {},
      emptyMessages: 0,
      messageLengths: {
        empty: 0,
        short: 0,
        medium: 0,
        long: 0
      }
    };
    
    // Read file stats
    const fileStats = fs.statSync(filePath);
    ui.setStatus(`Reading ${helpers.formatSize(fileStats.size)} file...`);
    
    // Read and parse the file
    const startTime = Date.now();
    const rawData = fs.readFileSync(filePath, 'utf8');
    const conversations = JSON.parse(rawData);
    
    if (!Array.isArray(conversations)) {
      throw new Error('File does not contain a valid array of conversations');
    }
    
    // Store the data
    dataStore.conversations = conversations;
    state.stats.totalConversations = conversations.length;
    state.filePath = filePath;
    
    // Build the index
    conversations.forEach((conv, idx) => {
      if (conv.uuid) {
        dataStore.conversationIndex.set(conv.uuid, idx);
      }
    });
    
    // Generate statistics
    generateStatistics();
    
    // Reset view state
    state.currentPage = 0;
    state.filters = {
      dateStart: null,
      dateEnd: null,
      searchTerm: '',
      hasMessages: false,
      hasEmptyMessages: false
    };
    state.sort = {
      field: 'date',
      direction: 'desc'
    };
    
    // Show conversations
    views.showConversations();
    
    const loadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    ui.setStatus(`Loaded ${state.stats.totalConversations} conversations with ${state.stats.totalMessages} messages in ${loadTime}s`);
    ui.hideLoading();
    
  } catch (err) {
    ui.hideLoading();
    ui.setStatus(`Error loading data: ${err.message}`);
    console.error('Error loading data:', err);
  }
}

// Generate statistics from loaded data
function generateStatistics() {
  state.stats.totalMessages = 0;
  state.stats.messagesByRole = {};
  state.stats.conversationsByMonth = {};
  state.stats.emptyMessages = 0;
  state.stats.messageLengths = {
    empty: 0,
    short: 0,
    medium: 0,
    long: 0
  };
  
  dataStore.conversations.forEach(conv => {
    // Process by month
    if (conv.created_at) {
      const date = moment(conv.created_at);
      const month = date.format('YYYY-MM');
      
      if (!state.stats.conversationsByMonth[month]) {
        state.stats.conversationsByMonth[month] = {
          conversations: 0,
          messages: 0
        };
      }
      
      state.stats.conversationsByMonth[month].conversations++;
    }
    
    // Process messages
    if (Array.isArray(conv.chat_messages)) {
      const messageCount = conv.chat_messages.length;
      state.stats.totalMessages += messageCount;
      
      if (conv.created_at && state.stats.conversationsByMonth[moment(conv.created_at).format('YYYY-MM')]) {
        state.stats.conversationsByMonth[moment(conv.created_at).format('YYYY-MM')].messages += messageCount;
      }
      
      // Process each message
      conv.chat_messages.forEach(msg => {
        // Count by role
        const role = msg.sender || 'unknown';
        state.stats.messagesByRole[role] = (state.stats.messagesByRole[role] || 0) + 1;
        
        // Check content
        const text = helpers.getMessageText(msg);
        const textLength = text ? text.trim().length : 0;
        
        if (textLength === 0) {
          state.stats.emptyMessages++;
          state.stats.messageLengths.empty++;
        } else if (textLength <= 50) {
          state.stats.messageLengths.short++;
        } else if (textLength <= 500) {
          state.stats.messageLengths.medium++;
        } else {
          state.stats.messageLengths.long++;
        }
      });
    }
  });
}

// Filter and sort conversation data
function filterAndSortData() {
  // Apply filters
  dataStore.filteredConversations = dataStore.conversations.filter(conv => {
    // Date filter
    if (state.filters.dateStart || state.filters.dateEnd) {
      try {
        const date = moment(conv.created_at || 0);
        if (state.filters.dateStart && date.isBefore(state.filters.dateStart)) return false;
        if (state.filters.dateEnd && date.isAfter(state.filters.dateEnd)) return false;
      } catch (e) {
        // Skip date filter on error
      }
    }
    
    // Has messages filter
    if (state.filters.hasMessages && (!Array.isArray(conv.chat_messages) || conv.chat_messages.length === 0)) {
      return false;
    }
    
    // Has empty messages filter
    if (state.filters.hasEmptyMessages && !helpers.hasEmptyMessages(conv)) {
      return false;
    }
    
    // Search filter - use optimized search
    if (state.filters.searchTerm && !helpers.deepSearch(conv, state.filters.searchTerm)) {
      return false;
    }
    
    return true;
  });
  
  // Apply sorting
  dataStore.filteredConversations.sort((a, b) => {
    let aVal, bVal;
    
    if (state.sort.field === 'date') {
      aVal = moment(a.created_at || 0).valueOf();
      bVal = moment(b.created_at || 0).valueOf();
    } else if (state.sort.field === 'size') {
      aVal = helpers.getConversationSize(a);
      bVal = helpers.getConversationSize(b);
    } else if (state.sort.field === 'messages') {
      aVal = helpers.getMessageCount(a);
      bVal = helpers.getMessageCount(b);
    }
    
    return state.sort.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });
}

// Export conversation to markdown
function exportConversation(conversation, outputPath) {
  try {
    if (!conversation || !Array.isArray(conversation.chat_messages) || conversation.chat_messages.length === 0) {
      ui.setStatus('No messages to export');
      return false;
    }
    
    let output = '';
    
    // Add conversation metadata
    const title = conversation.name || `Conversation ${conversation.uuid}`;
    const date = helpers.formatDate(conversation.created_at);
    
    output += `# ${title}\n`;
    output += `Date: ${date}\n`;
    output += `UUID: ${conversation.uuid}\n\n`;
    
    // Add messages
    conversation.chat_messages.forEach((msg, index) => {
      const role = msg.sender || 'unknown';
      const date = helpers.formatDate(msg.created_at);
      
      output += `## Message ${index + 1} (${role}) - ${date}\n\n`;
      
      // Get message text
      const text = helpers.getMessageText(msg);
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
    const finalPath = outputPath || `conversation_${conversation.uuid.substring(0, 8)}.md`;
    fs.writeFileSync(finalPath, output);
    
    ui.setStatus(`Exported ${conversation.chat_messages.length} messages to ${finalPath}`);
    return true;
    
  } catch (err) {
    ui.setStatus(`Error exporting messages: ${err.message}`);
    console.error('Export error:', err);
    return false;
  }
}

// Command handling
function handleCommand(cmd) {
  cmd = cmd.trim();
  
  if (!cmd) return;
  
  // Parse quoted arguments
  const args = [];
  let current = '';
  let inQuotes = false;
  let escaping = false;
  
  [...cmd].forEach(char => {
    if (escaping) {
      current += char;
      escaping = false;
    } else if (char === '\\') {
      escaping = true;
    } else if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  });
  
  if (current.length > 0) {
    args.push(current);
  }
  
  if (args.length === 0) return;
  
  const command = args[0].toLowerCase();
  
  if (command === 'load') {
    if (args.length < 2) {
      ui.setStatus('Missing file path. Usage: load path/to/file.json');
      return;
    }
    
    const filePath = args[1];
    loadDataFile(filePath);
    
  } else if (command === 'filter') {
    if (args.length === 2 && args[1].toLowerCase() === 'clear') {
      // Clear all filters
      state.filters = {
        dateStart: null,
        dateEnd: null,
        searchTerm: '',
        hasMessages: false,
        hasEmptyMessages: false
      };
      ui.setStatus('All filters cleared');
      views.showConversations();
      return;
    }
    
    if (args.length < 2) {
      ui.setStatus('Missing date range. Usage: filter 2024-01-01 to 2024-02-01');
      return;
    }
    
    const dateStr = args.slice(1).join(' ');
    
    try {
      if (dateStr.includes(' to ')) {
        const [start, end] = dateStr.split(' to ').map(d => d.trim());
        state.filters.dateStart = moment(start);
        state.filters.dateEnd = moment(end);
        ui.setStatus(`Date filter set: ${start} to ${end}`);
      } else {
        state.filters.dateStart = moment(dateStr);
        state.filters.dateEnd = moment(dateStr).add(1, 'day');
        ui.setStatus(`Date filter set: ${dateStr}`);
      }
      views.showConversations();
    } catch (err) {
      ui.setStatus(`Invalid date format: ${err.message}`);
    }
    
  } else if (command === 'search') {
    if (args.length < 2) {
      ui.setStatus('Missing search term. Usage: search keyword');
      return;
    }
    
    const searchTerm = args.slice(1).join(' ');
    state.filters.searchTerm = searchTerm;
    state.currentPage = 0;
    ui.setStatus(`Searching for: "${searchTerm}"`);
    views.showConversations();
    
  } else if (command === 'export') {
    if (state.activeView !== 'messages' || !state.selectedConversation) {
      ui.setStatus('Select a conversation first to export its messages');
      return;
    }
    
    const outputPath = args.length >= 2 ? args[1] : null;
    exportConversation(state.selectedConversation, outputPath);
    
  } else if (command === 'clear') {
    state.filters = {
      dateStart: null,
      dateEnd: null,
      searchTerm: '',
      hasMessages: false,
      hasEmptyMessages: false
    };
    state.currentPage = 0;
    ui.setStatus('All filters cleared');
    views.showConversations();
    
  } else {
    ui.setStatus(`Unknown command: ${command}`);
  }
}

// User navigation logic
function navigateBack() {
  if (state.activeView === 'welcome') {
    return;
  }
  
  if (state.activeView === 'messages') {
    // Go back to conversations view
    state.selectedConversation = null;
    views.showConversations();
  } else if (state.activeView === 'statistics' || state.activeView === 'chart') {
    views.showConversations();
  }
}

function handleSelection() {
  const selectedIndex = ui.explorer.selected;
  
  if (selectedIndex < 0 || selectedIndex >= state.currentItems.length) {
    return;
  }
  
  // Get the actual index from current items
  const actualIndex = state.currentItems[selectedIndex];
  
  if (state.activeView === 'conversations') {
    // Select a conversation
    const conversation = dataStore.getConversation(actualIndex);
    if (conversation) {
      state.selectedConversation = conversation;
      views.showMessages();
    }
  } else if (state.activeView === 'messages') {
    // Select a message for detail view
    const message = dataStore.getMessage(actualIndex);
    if (message) {
      state.selectedMessage = message;
      showMessageDetail(message);
    }
  } else if (state.activeView === 'statistics') {
    // Just highlight, no navigation
    ui.setStatus('Viewing statistics');
  }
}

// Event listeners
function setupEventListeners() {
  // Quit
  screen.key(['escape', 'q', 'C-c'], function() {
    return process.exit(0);
  });
  
  // Help toggle
  screen.key('?', function() {
    ui.helpText.toggle();
    ui.render();
  });
  
  // Close help or modal on key press
  ui.helpText.key(['escape', 'q', 'enter', 'space'], function() {
    ui.helpText.hide();
    ui.render();
  });
  
  // Close chart on key press
  ui.chartBox.key(['escape', 'q', 'enter', 'space'], function() {
    ui.chartBox.hide();
    ui.render();
  });
  
  // Distribution chart
  screen.key('d', function() {
    views.showDistributionChart();
  });
  
  // View switches
  screen.key('1', function() {
    state.filters.hasMessages = false;
    state.filters.hasEmptyMessages = false;
    state.currentPage = 0;
    views.showConversations();
  });
  
  screen.key('2', function() {
    state.filters.hasMessages = true;
    state.filters.hasEmptyMessages = false;
    state.currentPage = 0;
    views.showConversations();
  });
  
  screen.key('3', function() {
    views.showStatistics();
  });
  
  // Show conversations with empty messages
  screen.key('f', function() {
    state.filters.hasEmptyMessages = true;
    state.filters.hasMessages = true;
    state.currentPage = 0;
    views.showConversations();
  });
  
  // Search
  screen.key('/', function() {
    ui.cmdInput.setValue('search ');
    ui.cmdInput.focus();
  });
  
  // Date filter
  screen.key('t', function() {
    ui.cmdInput.setValue('filter ');
    ui.cmdInput.focus();
  });
  
  // Sort method
  screen.key('s', function() {
    if (state.sort.field === 'date') {
      state.sort.field = 'size';
    } else if (state.sort.field === 'size') {
      state.sort.field = 'messages';
    } else {
      state.sort.field = 'date';
    }
    ui.setStatus(`Sorting by ${state.sort.field}`);
    
    if (state.activeView === 'conversations') {
      views.showConversations();
    }
  });
  
  // Sort direction
  screen.key('r', function() {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    ui.setStatus(`Sort direction: ${state.sort.direction}ending`);
    
    if (state.activeView === 'conversations') {
      views.showConversations();
    }
  });
  
  // Back navigation
  screen.key('backspace', function() {
    navigateBack();
  });
  
  // Pagination
  screen.key(['pagedown', 'C-d'], function() {
    if (state.activeView !== 'conversations') return;
    
    const totalPages = Math.ceil(dataStore.filteredConversations.length / state.pageSize);
    if (state.currentPage < totalPages - 1) {
      state.currentPage++;
      views.showConversations();
    }
  });
  
  screen.key(['pageup', 'C-u'], function() {
    if (state.activeView !== 'conversations') return;
    
    if (state.currentPage > 0) {
      state.currentPage--;
      views.showConversations();
    }
  });
  
  // Export
  screen.key('e', function() {
    if (state.activeView === 'messages' && state.selectedConversation) {
      ui.cmdInput.setValue(`export conversation_${state.selectedConversation.uuid.substring(0, 8)}.md`);
      ui.cmdInput.focus();
    } else {
      ui.setStatus('Select a conversation first to export its messages');
    }
  });
  
  // Command mode
  screen.key(':', function() {
    ui.cmdInput.setValue('');
    ui.cmdInput.focus();
  });
  
  // Input handling
  ui.cmdInput.key(['escape'], function() {
    ui.cmdInput.clearValue();
    ui.cmdInput.cancel();
    ui.render();
  });
  
  ui.cmdInput.key(['enter'], function() {
    const cmd = ui.cmdInput.getValue();
    ui.cmdInput.clearValue();
    ui.cmdInput.cancel();
    handleCommand(cmd);
  });
  
  // Explorer selection
  ui.explorer.on('select', function() {
    handleSelection();
  });
}

// Main application entry point
function init() {
  // Initialize UI
  ui.init();
  
  // Setup event listeners
  setupEventListeners();
  
  // Show welcome screen
  views.showWelcome();
  
  // Focus on explorer
  ui.explorer.focus();
  
  // Handle command line arguments
  if (process.argv.length >= 3) {
    const filePath = process.argv[2];
    loadDataFile(filePath);
  }
}

// Start the application
init();