#!/usr/bin/env node

/**
 * Conversation JSON Explorer - An NCurses-style interface for exploring JSON conversation data
 * 
 * This tool provides an interface similar to ncdu, but specifically designed for
 * conversation data with the structure:
 * {
 *   "uuid": "...",
 *   "name": "...",
 *   "created_at": "...",
 *   "updated_at": "...",
 *   "account": { "uuid": "..." },
 *   "chat_messages": [...]
 * }
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
  title: 'Conversation JSON Explorer'
});

// Configuration
let config = {
  dateFormat: 'YYYY-MM-DD HH:mm:ss',
  conversationPath: '',
  tweetsPath: '',
  currentPath: [],
  filterStartDate: null,
  filterEndDate: null,
  searchTerm: '',
  sortBy: 'date', // 'date', 'size', 'messages'
  sortDirection: 'desc'
};

// Data structures
let conversationData = [];
let tweetData = [];
let currentViewData = [];
let statistics = {
  totalConversations: 0,
  totalMessages: 0,
  messagesByRole: {},
  byMonth: {},
  emptyConversations: 0
};

// Create layout
const grid = new contrib.grid({rows: 12, cols: 12, screen: screen});

// Chart box for distribution visualization
const chartBox = blessed.box({
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
const distributionChart = contrib.bar({
  parent: chartBox,
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

// Main explorer panel
const explorer = grid.set(0, 0, 9, 8, blessed.list, {
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
const detailPanel = grid.set(0, 8, 9, 4, blessed.box, {
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
const statusBar = grid.set(9, 0, 1, 12, blessed.text, {
  content: ' {bold}Conversation Explorer{/bold} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit',
  tags: true,
  style: {
    fg: 'white',
    bg: 'blue'
  }
});

// Command input
const cmdInput = grid.set(10, 0, 1, 12, blessed.textbox, {
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

// Help text 
const helpText = blessed.box({
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
  content: `
  {bold}Conversation Explorer Keyboard Commands{/bold}

  {bold}Navigation{/bold}
  ↑/↓/j/k       Navigate up/down
  Enter         Open selected conversation / view message details
  Backspace     Go back to parent
  Home/End/g/G  Jump to top/bottom

  {bold}Filtering and Sorting{/bold}
  /             Search (regex supported)
  t             Filter by date range
  s             Change sort method (date, size, messages)
  r             Reverse sort order

  {bold}Views{/bold}
  1             Show all conversations
  2             Show conversations with messages
  3             Show statistics

  {bold}Actions{/bold}
  e             Export current conversation to Markdown
  d             Show message distribution chart
  f             Focus on empty text (for deletion/cleanup)

  {bold}Other Commands{/bold}
  ?             Show/hide this help
  :             Command mode (:load, :filter, :search, :export)
  q             Quit application

  {bold}Command Examples{/bold}
  :load data.json              Load conversation data
  :filter 2024-05-01 to 2024-06-01  Filter by date range
  :search error                Search for text
  :export conversation.md      Export current conversation

  Press any key to close help
  `,
  tags: true
});

// Function to load data
function loadData(conversationPath) {
  try {
    if (conversationPath && fs.existsSync(conversationPath)) {
      conversationData = JSON.parse(fs.readFileSync(conversationPath, 'utf8'));
      config.conversationPath = conversationPath;
      statistics.totalConversations = conversationData.length;
    }
    
    generateStatistics();
    updateView('conversations');
    screen.render();
    
    setStatus(`Loaded ${statistics.totalConversations} conversations with ${statistics.totalMessages} messages`);
  } catch (err) {
    setStatus(`Error loading data: ${err.message}`);
  }
}

// Generate statistics from loaded data
function generateStatistics() {
  statistics.totalMessages = 0;
  statistics.messagesByRole = {};
  statistics.byMonth = {};
  statistics.emptyConversations = 0;
  statistics.emptyMessages = 0;
  statistics.messagesByDay = {};
  statistics.messageLengths = {
    empty: 0,
    short: 0,  // 1-50 chars
    medium: 0, // 51-500 chars
    long: 0    // 500+ chars
  };
  
  // Process conversation data
  conversationData.forEach(conv => {
    if (!conv.chat_messages || conv.chat_messages.length === 0) {
      statistics.emptyConversations++;
      return;
    }
    
    statistics.totalMessages += conv.chat_messages.length;
    
    // Process by month
    const date = moment(conv.created_at || Date.now());
    const month = date.format('YYYY-MM');
    const day = date.format('YYYY-MM-DD');
    
    if (!statistics.byMonth[month]) {
      statistics.byMonth[month] = {
        conversations: 0,
        messages: 0
      };
    }
    
    if (!statistics.messagesByDay[day]) {
      statistics.messagesByDay[day] = 0;
    }
    
    statistics.byMonth[month].conversations++;
    statistics.byMonth[month].messages += conv.chat_messages.length;
    statistics.messagesByDay[day] += conv.chat_messages.length;
    
    // Count messages by role and analyze content
    conv.chat_messages.forEach(msg => {
      const role = msg.sender || "unknown";
      statistics.messagesByRole[role] = (statistics.messagesByRole[role] || 0) + 1;
      
      // Check for empty messages
      let messageText = '';
      if (msg.text && msg.text.length > 0) {
        messageText = msg.text;
      } else if (msg.content && msg.content.length > 0) {
        messageText = msg.content.map(part => part.text || '').join(' ');
      }
      
      // Categorize by length
      const length = messageText.trim().length;
      if (length === 0) {
        statistics.emptyMessages++;
        statistics.messageLengths.empty++;
      } else if (length <= 50) {
        statistics.messageLengths.short++;
      } else if (length <= 500) {
        statistics.messageLengths.medium++;
      } else {
        statistics.messageLengths.long++;
      }
    });
  });
}

// Update the view based on the current mode
function updateView(mode = 'conversations') {
  explorer.setLabel(` ${mode.charAt(0).toUpperCase() + mode.slice(1)} `);
  explorer.clearItems();
  
  if (mode === 'conversations') {
    showConversations();
  } else if (mode === 'messagesOnly') {
    showConversationsWithMessages();
  } else if (mode === 'statistics') {
    showStatistics();
  } else if (mode === 'conversationDetail') {
    showConversationDetail();
  }
  
  screen.render();
}

// Show all conversations in the explorer
function showConversations() {
  // Apply filters
  currentViewData = conversationData.filter(item => {
    // Date filter
    if (config.filterStartDate || config.filterEndDate) {
      const date = moment(item.created_at || Date.now());
      if (config.filterStartDate && date.isBefore(config.filterStartDate)) return false;
      if (config.filterEndDate && date.isAfter(config.filterEndDate)) return false;
    }
    
    // Search filter
    if (config.searchTerm) {
      const searchIn = JSON.stringify(item).toLowerCase();
      if (!searchIn.includes(config.searchTerm.toLowerCase())) return false;
    }
    
    return true;
  });
  
  // Sort items
  currentViewData.sort((a, b) => {
    let aVal, bVal;
    
    if (config.sortBy === 'date') {
      aVal = moment(a.created_at || 0).valueOf();
      bVal = moment(b.created_at || 0).valueOf();
    } else if (config.sortBy === 'size') {
      aVal = JSON.stringify(a).length;
      bVal = JSON.stringify(b).length;
    } else if (config.sortBy === 'messages') {
      aVal = (a.chat_messages || []).length;
      bVal = (b.chat_messages || []).length;
    }
    
    return config.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });
  
  // Display items
  currentViewData.forEach(item => {
    const date = moment(item.created_at || Date.now()).format(config.dateFormat);
    const messageCount = (item.chat_messages || []).length;
    const title = item.name || `Conversation ${item.uuid.substring(0, 8)}`;
    const size = (JSON.stringify(item).length / 1024).toFixed(1) + 'KB';
    
    explorer.addItem(`${date} │ ${messageCount} msgs │ ${size} │ ${title.substring(0, 40)}`);
  });
  
  setStatus(`Showing ${currentViewData.length} of ${statistics.totalConversations} conversations`);
}

// Show only conversations with messages
function showConversationsWithMessages() {
  // Apply filters with additional message filter
  currentViewData = conversationData.filter(item => {
    // Must have messages
    if (!item.chat_messages || item.chat_messages.length === 0) return false;
    
    // Date filter
    if (config.filterStartDate || config.filterEndDate) {
      const date = moment(item.created_at || Date.now());
      if (config.filterStartDate && date.isBefore(config.filterStartDate)) return false;
      if (config.filterEndDate && date.isAfter(config.filterEndDate)) return false;
    }
    
    // Search filter
    if (config.searchTerm) {
      const searchIn = JSON.stringify(item).toLowerCase();
      if (!searchIn.includes(config.searchTerm.toLowerCase())) return false;
    }
    
    return true;
  });
  
  // Sort items
  currentViewData.sort((a, b) => {
    let aVal, bVal;
    
    if (config.sortBy === 'date') {
      aVal = moment(a.created_at || 0).valueOf();
      bVal = moment(b.created_at || 0).valueOf();
    } else if (config.sortBy === 'size') {
      aVal = JSON.stringify(a).length;
      bVal = JSON.stringify(b).length;
    } else if (config.sortBy === 'messages') {
      aVal = (a.chat_messages || []).length;
      bVal = (b.chat_messages || []).length;
    }
    
    return config.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });
  
  // Display items
  currentViewData.forEach(item => {
    const date = moment(item.created_at || Date.now()).format(config.dateFormat);
    const messageCount = (item.chat_messages || []).length;
    const title = item.name || `Conversation ${item.uuid.substring(0, 8)}`;
    const size = (JSON.stringify(item).length / 1024).toFixed(1) + 'KB';
    
    explorer.addItem(`${date} │ ${messageCount} msgs │ ${size} │ ${title.substring(0, 40)}`);
  });
  
  setStatus(`Showing ${currentViewData.length} conversations with messages (of ${statistics.totalConversations} total)`);
}

// Show conversation detail (messages)
function showConversationDetail() {
  if (config.currentPath.length !== 1) {
    updateView('conversations');
    return;
  }
  
  const conversationIndex = config.currentPath[0];
  const conversation = currentViewData[conversationIndex];
  
  if (!conversation || !conversation.chat_messages) {
    updateView('conversations');
    return;
  }
  
  // Set the conversation as the current view data
  currentViewData = conversation.chat_messages;
  
  // Display messages
  currentViewData.forEach((msg, index) => {
    const date = moment(msg.created_at || Date.now()).format(config.dateFormat);
    const role = msg.sender || 'unknown';
    
    // Get a short preview of the message text
    let preview = '';
    if (msg.text && msg.text.length > 0) {
      preview = msg.text.substring(0, 40).replace(/\n/g, ' ');
    } else if (msg.content && msg.content.length > 0 && msg.content[0].text) {
      preview = msg.content[0].text.substring(0, 40).replace(/\n/g, ' ');
    }
    
    if (preview.length > 0) {
      preview = `│ ${preview}${preview.length >= 40 ? '...' : ''}`;
    }
    
    explorer.addItem(`${index + 1}. ${date} │ ${role} ${preview}`);
  });
  
  // Update title and status
  const title = conversation.name || `Conversation ${conversation.uuid.substring(0, 8)}`;
  explorer.setLabel(` Messages: ${title} `);
  setStatus(`Showing ${currentViewData.length} messages from conversation ${conversation.uuid.substring(0, 8)}`);
}

// Show statistics in the explorer
function showStatistics() {
  explorer.addItem('Monthly Activity');
  explorer.addItem('───────────────────────');
  
  const months = Object.keys(statistics.byMonth).sort();
  months.forEach(month => {
    const stats = statistics.byMonth[month];
    explorer.addItem(`${month} │ ${stats.conversations} convs │ ${stats.messages} msgs`);
  });
  
  explorer.addItem('');
  explorer.addItem('Message Count by Role');
  explorer.addItem('───────────────────────');
  
  Object.entries(statistics.messagesByRole).forEach(([role, count]) => {
    explorer.addItem(`${role} │ ${count} messages`);
  });
  
  explorer.addItem('');
  explorer.addItem('General Statistics');
  explorer.addItem('───────────────────────');
  explorer.addItem(`Total conversations: ${statistics.totalConversations}`);
  explorer.addItem(`Conversations with messages: ${statistics.totalConversations - statistics.emptyConversations}`);
  explorer.addItem(`Empty conversations: ${statistics.emptyConversations}`);
  explorer.addItem(`Total messages: ${statistics.totalMessages}`);
  explorer.addItem(`Average messages per conversation: ${(statistics.totalMessages / (statistics.totalConversations - statistics.emptyConversations)).toFixed(2)}`);
  
  setStatus('Showing conversation statistics');
}

// Update detail panel with selected item's data
function updateDetailPanel(index) {
  if (index < 0 || index >= currentViewData.length) {
    detailPanel.setContent('No item selected');
    return;
  }
  
  const item = currentViewData[index];
  let content = '';
  
  if (explorer.options.label.includes('Conversations')) {
    // Conversation detail
    const date = moment(item.created_at || Date.now()).format(config.dateFormat);
    const updated = moment(item.updated_at || Date.now()).format(config.dateFormat);
    const title = item.name || `Conversation ${item.uuid.substring(0, 8)}`;
    
    content = `{bold}${title}{/bold}\n\n`;
    content += `UUID: ${item.uuid}\n`;
    content += `Created: ${date}\n`;
    content += `Updated: ${updated}\n`;
    content += `Messages: ${(item.chat_messages || []).length}\n`;
    
    if (item.account && item.account.uuid) {
      content += `Account: ${item.account.uuid}\n`;
    }
    
    if (item.chat_messages && item.chat_messages.length > 0) {
      content += `\n{bold}Message Preview:{/bold}\n`;
      
      item.chat_messages.slice(0, 3).forEach((msg, i) => {
        const role = msg.sender || 'unknown';
        
        // Get message text
        let text = '';
        if (msg.text && msg.text.length > 0) {
          text = msg.text.substring(0, 100);
        } else if (msg.content && msg.content.length > 0 && msg.content[0].text) {
          text = msg.content[0].text.substring(0, 100);
        }
        
        if (text.length > 0) {
          content += `\n${i+1}. ${role}: ${text}${text.length >= 100 ? '...' : ''}\n`;
        } else {
          content += `\n${i+1}. ${role}: (empty message)\n`;
        }
      });
      
      if (item.chat_messages.length > 3) {
        content += `\n... and ${item.chat_messages.length - 3} more messages`;
      }
    }
  } else if (explorer.options.label.includes('Messages')) {
    // Message detail
    const date = moment(item.created_at || Date.now()).format(config.dateFormat);
    const updated = moment(item.updated_at || Date.now()).format(config.dateFormat);
    const role = item.sender || 'unknown';
    
    content = `{bold}Message from ${role}{/bold}\n\n`;
    content += `UUID: ${item.uuid}\n`;
    content += `Created: ${date}\n`;
    content += `Updated: ${updated}\n`;
    
    // Get message text
    if (item.text && item.text.length > 0) {
      content += `\n{bold}Text:{/bold}\n${item.text}\n`;
    }
    
    // Handle content array
    if (item.content && item.content.length > 0) {
      content += `\n{bold}Content (${item.content.length} parts):{/bold}\n`;
      
      item.content.forEach((part, i) => {
        content += `\nPart ${i+1} (${part.type || 'unknown'}):\n`;
        
        if (part.text && part.text.length > 0) {
          content += `${part.text}\n`;
        } else {
          content += `(empty text)\n`;
        }
        
        if (part.citations && part.citations.length > 0) {
          content += `Citations: ${part.citations.length}\n`;
        }
      });
    }
    
    // Show attachments if any
    if (item.attachments && item.attachments.length > 0) {
      content += `\n{bold}Attachments:{/bold} ${item.attachments.length}\n`;
    }
    
    // Show files if any
    if (item.files && item.files.length > 0) {
      content += `\n{bold}Files:{/bold} ${item.files.length}\n`;
    }
  }
  
  detailPanel.setContent(content);
  detailPanel.scrollTo(0);
  screen.render();
}

// Set status message
function setStatus(message) {
  statusBar.setContent(` {bold}Conversation Explorer{/bold} | ${message} | Press {bold}?{/bold} for help | {bold}q{/bold} to quit`);
  screen.render();
}

// Command handler
function handleCommand(cmd) {
  cmd = cmd.trim();
  
  if (cmd.startsWith('load ')) {
    const path = cmd.substring(5).trim();
    loadData(path);
  } else if (cmd.startsWith('filter ')) {
    const dateStr = cmd.substring(7);
    try {
      if (dateStr === 'clear') {
        config.filterStartDate = null;
        config.filterEndDate = null;
        setStatus('Date filter cleared');
      } else if (dateStr.includes(' to ')) {
        const [start, end] = dateStr.split(' to ');
        config.filterStartDate = moment(start);
        config.filterEndDate = moment(end);
        setStatus(`Date filter set: ${start} to ${end}`);
      } else {
        config.filterStartDate = moment(dateStr);
        config.filterEndDate = moment(dateStr).add(1, 'day');
        setStatus(`Date filter set: ${dateStr}`);
      }
      updateView(explorer.options.label.includes('Conversations') ? 'conversations' : 'messagesOnly');
    } catch (err) {
      setStatus(`Invalid date format: ${err.message}`);
    }
  } else if (cmd.startsWith('search ')) {
    const searchTerm = cmd.substring(7);
    config.searchTerm = searchTerm;
    setStatus(`Search for: "${searchTerm}"`);
    updateView(explorer.options.label.includes('Conversations') ? 'conversations' : 'messagesOnly');
  } else if (cmd === 'clear') {
    config.searchTerm = '';
    config.filterStartDate = null;
    config.filterEndDate = null;
    setStatus('All filters cleared');
    updateView(explorer.options.label.includes('Conversations') ? 'conversations' : 'messagesOnly');
  } else {
    setStatus(`Unknown command: ${cmd}`);
  }
}

// Show message distribution chart
function showDistributionChart() {
  // Prepare data for bar chart
  const data = {
    titles: [],
    data: []
  };

  // Add message distribution by role
  const roleData = Object.entries(statistics.messagesByRole)
    .map(([role, count]) => ({
      title: role,
      count
    }))
    .sort((a, b) => b.count - a.count);

  roleData.forEach(item => {
    data.titles.push(item.title);
    data.data.push(item.count);
  });

  // Add message distribution by length
  const lengthLabels = {
    empty: 'Empty',
    short: '1-50 chars',
    medium: '51-500 chars',
    long: '500+ chars'
  };

  Object.entries(statistics.messageLengths).forEach(([key, count]) => {
    data.titles.push(lengthLabels[key]);
    data.data.push(count);
  });

  // Add some time-based statistics
  const months = Object.keys(statistics.byMonth).sort().slice(-5); // Last 5 months
  months.forEach(month => {
    data.titles.push(month);
    data.data.push(statistics.byMonth[month].messages);
  });

  // Update chart
  distributionChart.setData({
    titles: data.titles,
    data: data.data
  });

  chartBox.show();
  screen.render();
}

// Show conversations with empty messages
function showEmptyMessages() {
  // Filter for conversations containing empty messages
  currentViewData = conversationData.filter(conv => {
    if (!conv.chat_messages || conv.chat_messages.length === 0) return false;
    
    // Check if any messages are empty
    return conv.chat_messages.some(msg => {
      let messageText = '';
      if (msg.text && msg.text.length > 0) {
        messageText = msg.text;
      } else if (msg.content && msg.content.length > 0) {
        messageText = msg.content.map(part => part.text || '').join(' ');
      }
      return messageText.trim().length === 0;
    });
  });
  
  // Sort items (default to date)
  currentViewData.sort((a, b) => {
    const aDate = moment(a.created_at || 0).valueOf();
    const bDate = moment(b.created_at || 0).valueOf();
    return config.sortDirection === 'asc' ? aDate - bDate : bDate - aDate;
  });
  
  // Clear the list and update label
  explorer.clearItems();
  explorer.setLabel(' Conversations with Empty Messages ');
  
  // Display items
  currentViewData.forEach(item => {
    const date = moment(item.created_at || Date.now()).format(config.dateFormat);
    const messageCount = (item.chat_messages || []).length;
    const title = item.name || `Conversation ${item.uuid.substring(0, 8)}`;
    
    // Count empty messages
    const emptyCount = item.chat_messages.filter(msg => {
      let messageText = '';
      if (msg.text && msg.text.length > 0) {
        messageText = msg.text;
      } else if (msg.content && msg.content.length > 0) {
        messageText = msg.content.map(part => part.text || '').join(' ');
      }
      return messageText.trim().length === 0;
    }).length;
    
    explorer.addItem(`${date} │ ${emptyCount}/${messageCount} empty │ ${title.substring(0, 40)}`);
  });
  
  setStatus(`Found ${currentViewData.length} conversations with empty messages`);
  screen.render();
}

// Key event handlers
screen.key(['escape', 'q', 'C-c'], function() {
  return process.exit(0);
});

screen.key('?', function() {
  helpText.toggle();
  screen.render();
});

// Show distribution chart
screen.key('d', function() {
  showDistributionChart();
});

// Close chart on any key
chartBox.key(['escape', 'q', 'enter', 'space', 'd'], function() {
  chartBox.hide();
  screen.render();
});

// Filter to show only conversations with empty messages
screen.key('f', function() {
  showEmptyMessages();
});

helpText.key(['escape', 'q', 'enter', 'space'], function() {
  helpText.hide();
  screen.render();
});

screen.key('1', function() {
  config.currentPath = [];
  updateView('conversations');
});

screen.key('2', function() {
  config.currentPath = [];
  updateView('messagesOnly');
});

screen.key('3', function() {
  config.currentPath = [];
  updateView('statistics');
});

screen.key('/', function() {
  cmdInput.setValue('search ');
  cmdInput.focus();
});

screen.key('t', function() {
  cmdInput.setValue('filter ');
  cmdInput.focus();
});

screen.key('s', function() {
  if (config.sortBy === 'date') {
    config.sortBy = 'size';
  } else if (config.sortBy === 'size') {
    config.sortBy = 'messages';
  } else {
    config.sortBy = 'date';
  }
  setStatus(`Sorting by ${config.sortBy}`);
  
  const currentView = explorer.options.label.includes('Messages') ? 'conversationDetail' :
                      explorer.options.label.includes('Conversations with') ? 'messagesOnly' : 'conversations';
  updateView(currentView);
});

screen.key('r', function() {
  config.sortDirection = config.sortDirection === 'asc' ? 'desc' : 'asc';
  setStatus(`Sort direction: ${config.sortDirection}ending`);
  
  const currentView = explorer.options.label.includes('Messages') ? 'conversationDetail' :
                      explorer.options.label.includes('Conversations with') ? 'messagesOnly' : 'conversations';
  updateView(currentView);
});

screen.key(':', function() {
  cmdInput.setValue('');
  cmdInput.focus();
});

screen.key('backspace', function() {
  if (config.currentPath.length > 0) {
    config.currentPath.pop();
    
    if (config.currentPath.length === 0) {
      // Back to main list
      updateView('conversations');
    } else {
      // Back to previous level (currently not implemented for nested navigation)
      updateView('conversations');
    }
  }
});

explorer.on('select', function() {
  updateDetailPanel(explorer.selected);
  
  // Replace getLabel() with options.label
  if ((explorer.options.label.includes('Conversations') || explorer.options.label.includes('Conversation')) && 
      !explorer.options.label.includes('Messages')) {
    config.currentPath = [explorer.selected];
    updateView('conversationDetail');
  }
});

cmdInput.key(['escape'], function() {
  cmdInput.cancel();
  screen.render();
});

cmdInput.key(['enter'], function() {
  const cmd = cmdInput.getValue();
  cmdInput.clearValue();
  cmdInput.cancel();
  handleCommand(cmd);
});

// Initialize application
setStatus('Welcome to Conversation Explorer! Load data with the command: load <conversations_path>');
screen.render();
explorer.focus();

// If command line arguments are provided, try to load the data automatically
if (process.argv.length >= 3) {
  const convPath = process.argv[2];
  loadData(convPath);
} else {
  // Show usage instructions
  console.log(`
Conversation JSON Explorer - An NCurses-style interface for exploring JSON conversation data

Usage:
  node conversation-explorer.js <path_to_json_file>

Example:
  node conversation-explorer.js conversations.json

If no file is provided, you can load a file using the ':load <path>' command within the application.
  `);
}

// Export message contents to a text file
function exportMessages(conversation, outputPath) {
  try {
    if (!conversation || !conversation.chat_messages || conversation.chat_messages.length === 0) {
      setStatus('No messages to export');
      return;
    }
    
    let output = '';
    
    // Add conversation metadata
    const title = conversation.name || `Conversation ${conversation.uuid}`;
    const date = moment(conversation.created_at || Date.now()).format(config.dateFormat);
    
    output += `# ${title}\n`;
    output += `Date: ${date}\n`;
    output += `UUID: ${conversation.uuid}\n\n`;
    
    // Add messages
    conversation.chat_messages.forEach((msg, index) => {
      const role = msg.sender || 'unknown';
      const date = moment(msg.created_at || Date.now()).format(config.dateFormat);
      
      output += `## Message ${index + 1} (${role}) - ${date}\n\n`;
      
      // Get message text
      let text = '';
      if (msg.text && msg.text.length > 0) {
        text = msg.text;
      } else if (msg.content && msg.content.length > 0) {
        // Combine all content parts
        text = msg.content.map(part => part.text || '').join('\n\n');
      }
      
      output += `${text || '(empty message)'}\n\n`;
    });
    
    // Write to file
    const finalPath = outputPath || `conversation_${conversation.uuid.substring(0, 8)}.md`;
    fs.writeFileSync(finalPath, output);
    
    setStatus(`Exported ${conversation.chat_messages.length} messages to ${finalPath}`);
  } catch (err) {
    setStatus(`Error exporting messages: ${err.message}`);
  }
}

// Add export command handler
screen.key('e', function() {
  // Only allow export from conversation view
  if (config.currentPath.length === 1 && explorer.options.label.includes('Messages')) {
    const conversationIndex = config.currentPath[0];
    const conversation = conversationData[conversationIndex] || null;
    
    if (conversation) {
      cmdInput.setValue(`export ${conversation.uuid.substring(0, 8)}.md`);
      cmdInput.focus();
    }
  } else {
    setStatus('Select a conversation first to export its messages');
  }
});

// Extend command handler for export
const oldHandleCommand = handleCommand;
handleCommand = function(cmd) {
  if (cmd.startsWith('export ')) {
    const outputPath = cmd.substring(7).trim();
    
    if (config.currentPath.length === 1) {
      const conversationIndex = config.currentPath[0];
      const conversation = conversationData[conversationIndex] || null;
      
      if (conversation) {
        exportMessages(conversation, outputPath);
      } else {
        setStatus('Invalid conversation selected');
      }
    } else {
      setStatus('Select a conversation first to export its messages');
    }
  } else {
    oldHandleCommand(cmd);
  }
};