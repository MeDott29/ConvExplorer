#!/usr/bin/env node

/**
 * Conversation Data Exploratory Analysis
 * 
 * This script analyzes the conversations.json file to:
 * 1. Validate the JSON schema understanding
 * 2. Generate statistics about conversations and messages
 * 3. Identify patterns and anomalies in the data
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  inputFile: 'conversations.json',
  sampleSize: 10, // Number of random conversations to sample for detailed analysis
  outputFile: 'conversation-analysis-report.json'
};

console.log('Starting exploratory data analysis...');
console.log(`Reading from: ${config.inputFile}`);

// Helper function to format large numbers with commas
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Helper function to format byte sizes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

// Schema validation helper
function validateSchema(data, path = '') {
  const schemaChecks = [];
  
  // Check if value exists at given path
  function checkExists(obj, keyPath, description) {
    const keys = keyPath.split('.');
    let current = obj;
    let valid = true;
    
    for (const key of keys) {
      if (current === undefined || current === null) {
        valid = false;
        break;
      }
      current = current[key];
    }
    
    return {
      check: `${path}${keyPath} exists`,
      expected: true,
      actual: valid,
      description
    };
  }
  
  // Check type of value at given path
  function checkType(obj, keyPath, type, description) {
    const keys = keyPath.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === undefined || current === null) {
        return {
          check: `${path}${keyPath} is ${type}`,
          expected: type,
          actual: 'undefined',
          description
        };
      }
      current = current[key];
    }
    
    let actualType;
    if (Array.isArray(current)) {
      actualType = 'array';
    } else {
      actualType = typeof current;
    }
    
    return {
      check: `${path}${keyPath} is ${type}`,
      expected: type,
      actual: actualType,
      description
    };
  }
  
  // Run schema checks
  if (Array.isArray(data)) {
    // Top level is array
    schemaChecks.push({
      check: 'Root is array',
      expected: true,
      actual: true,
      description: 'The root data structure is an array of conversations'
    });
    
    if (data.length > 0) {
      const conv = data[0];
      
      // Check conversation properties
      schemaChecks.push(checkExists(conv, 'uuid', 'Conversation has UUID'));
      schemaChecks.push(checkType(conv, 'uuid', 'string', 'Conversation UUID is string'));
      schemaChecks.push(checkExists(conv, 'name', 'Conversation has name'));
      schemaChecks.push(checkType(conv, 'name', 'string', 'Conversation name is string'));
      schemaChecks.push(checkExists(conv, 'created_at', 'Conversation has created_at'));
      schemaChecks.push(checkExists(conv, 'updated_at', 'Conversation has updated_at'));
      schemaChecks.push(checkExists(conv, 'account', 'Conversation has account'));
      schemaChecks.push(checkType(conv, 'account', 'object', 'Conversation account is object'));
      
      if (conv.account) {
        schemaChecks.push(checkExists(conv.account, 'uuid', 'Account has UUID'));
      }
      
      schemaChecks.push(checkExists(conv, 'chat_messages', 'Conversation has chat_messages'));
      schemaChecks.push(checkType(conv, 'chat_messages', 'array', 'chat_messages is array'));
      
      // Check message properties if they exist
      if (Array.isArray(conv.chat_messages) && conv.chat_messages.length > 0) {
        const msg = conv.chat_messages[0];
        
        schemaChecks.push(checkExists(msg, 'uuid', 'Message has UUID'));
        schemaChecks.push(checkExists(msg, 'sender', 'Message has sender'));
        schemaChecks.push(checkExists(msg, 'created_at', 'Message has created_at'));
        schemaChecks.push(checkExists(msg, 'updated_at', 'Message has updated_at'));
        
        // Check for text field and content field
        schemaChecks.push(checkExists(msg, 'text', 'Message has text field'));
        schemaChecks.push(checkExists(msg, 'content', 'Message has content field'));
        schemaChecks.push(checkType(msg, 'content', 'array', 'Message content is array'));
        
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          const content = msg.content[0];
          schemaChecks.push(checkExists(content, 'type', 'Content has type'));
          schemaChecks.push(checkExists(content, 'text', 'Content has text'));
          schemaChecks.push(checkExists(content, 'start_timestamp', 'Content has start_timestamp'));
          schemaChecks.push(checkExists(content, 'stop_timestamp', 'Content has stop_timestamp'));
          schemaChecks.push(checkExists(content, 'citations', 'Content has citations'));
        }
        
        // Check attachments and files
        schemaChecks.push(checkExists(msg, 'attachments', 'Message has attachments field'));
        schemaChecks.push(checkType(msg, 'attachments', 'array', 'Message attachments is array'));
        
        if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
          const attachment = msg.attachments[0];
          schemaChecks.push(checkExists(attachment, 'file_name', 'Attachment has file_name'));
          schemaChecks.push(checkExists(attachment, 'file_size', 'Attachment has file_size'));
          schemaChecks.push(checkExists(attachment, 'file_type', 'Attachment has file_type'));
          schemaChecks.push(checkExists(attachment, 'extracted_content', 'Attachment has extracted_content'));
        }
        
        schemaChecks.push(checkExists(msg, 'files', 'Message has files field'));
        schemaChecks.push(checkType(msg, 'files', 'array', 'Message files is array'));
        
        if (Array.isArray(msg.files) && msg.files.length > 0) {
          const file = msg.files[0];
          schemaChecks.push(checkExists(file, 'file_name', 'File has file_name'));
        }
      }
    }
  } else {
    schemaChecks.push({
      check: 'Root is array',
      expected: true,
      actual: false,
      description: 'The root data structure should be an array of conversations'
    });
  }
  
  return schemaChecks;
}

try {
  console.log('Reading JSON file...');
  const startTime = Date.now();
  
  // Read file stats first
  const fileStats = fs.statSync(config.inputFile);
  console.log(`File size: ${formatBytes(fileStats.size)}`);
  
  // Read the file
  const rawData = fs.readFileSync(config.inputFile, 'utf8');
  console.log(`File read in ${(Date.now() - startTime) / 1000} seconds`);
  
  console.log('Parsing JSON...');
  const parseStart = Date.now();
  const conversationData = JSON.parse(rawData);
  console.log(`JSON parsed in ${(Date.now() - parseStart) / 1000} seconds`);
  
  // Validate our understanding of the JSON schema
  console.log('Validating schema understanding...');
  const schemaChecks = validateSchema(conversationData);
  
  // Calculate statistics
  console.log('Calculating statistics...');
  const stats = {
    fileSize: fileStats.size,
    totalConversations: Array.isArray(conversationData) ? conversationData.length : 0,
    schemaValidation: schemaChecks,
    messageStats: {
      total: 0,
      bySender: {},
      emptyMessages: 0,
      withAttachments: 0,
      withFiles: 0
    },
    contentStats: {
      total: 0,
      byType: {},
      emptyCitations: 0
    },
    timeStats: {
      oldestConversation: null,
      newestConversation: null,
      conversationsByMonth: {}
    },
    fieldStats: {
      conversations: {},
      messages: {},
      content: {}
    },
    randomSamples: []
  };
  
  // Helper function for message text extraction
  function getMessageText(msg) {
    if (msg.text && msg.text.length > 0) {
      return msg.text;
    } else if (msg.content && msg.content.length > 0) {
      return msg.content.map(part => part.text || '').join(' ');
    }
    return '';
  }
  
  // Record schema field existence stats
  function recordFieldStats(obj, category) {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (!stats.fieldStats[category][key]) {
          stats.fieldStats[category][key] = 0;
        }
        stats.fieldStats[category][key]++;
      }
    }
  }
  
  // Helper for date processing
  function getMonthKey(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    } catch {
      return 'invalid-date';
    }
  }
  
  // Process all conversations
  if (Array.isArray(conversationData)) {
    conversationData.forEach(conv => {
      // Record conversation field stats
      recordFieldStats(conv, 'conversations');
      
      // Process date info
      if (conv.created_at) {
        const date = new Date(conv.created_at);
        const monthKey = getMonthKey(conv.created_at);
        
        // Record month stats
        if (!stats.timeStats.conversationsByMonth[monthKey]) {
          stats.timeStats.conversationsByMonth[monthKey] = 0;
        }
        stats.timeStats.conversationsByMonth[monthKey]++;
        
        // Track oldest/newest
        if (!stats.timeStats.oldestConversation || date < new Date(stats.timeStats.oldestConversation)) {
          stats.timeStats.oldestConversation = conv.created_at;
        }
        if (!stats.timeStats.newestConversation || date > new Date(stats.timeStats.newestConversation)) {
          stats.timeStats.newestConversation = conv.created_at;
        }
      }
      
      // Process chat messages
      if (Array.isArray(conv.chat_messages)) {
        stats.messageStats.total += conv.chat_messages.length;
        
        conv.chat_messages.forEach(msg => {
          // Record message field stats
          recordFieldStats(msg, 'messages');
          
          // Count by sender
          const sender = msg.sender || 'unknown';
          if (!stats.messageStats.bySender[sender]) {
            stats.messageStats.bySender[sender] = 0;
          }
          stats.messageStats.bySender[sender]++;
          
          // Check for empty messages
          const messageText = getMessageText(msg);
          if (!messageText || messageText.trim().length === 0) {
            stats.messageStats.emptyMessages++;
          }
          
          // Check for attachments and files
          if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            stats.messageStats.withAttachments++;
          }
          
          if (Array.isArray(msg.files) && msg.files.length > 0) {
            stats.messageStats.withFiles++;
          }
          
          // Process content array
          if (Array.isArray(msg.content)) {
            stats.contentStats.total += msg.content.length;
            
            msg.content.forEach(content => {
              // Record content field stats
              recordFieldStats(content, 'content');
              
              // Count by type
              const type = content.type || 'unknown';
              if (!stats.contentStats.byType[type]) {
                stats.contentStats.byType[type] = 0;
              }
              stats.contentStats.byType[type]++;
              
              // Check citations
              if (Array.isArray(content.citations) && content.citations.length === 0) {
                stats.contentStats.emptyCitations++;
              }
            });
          }
        });
      }
    });
    
    // Get random samples for detailed inspection
    const sampleIndices = new Set();
    while (sampleIndices.size < Math.min(config.sampleSize, conversationData.length)) {
      sampleIndices.add(Math.floor(Math.random() * conversationData.length));
    }
    
    sampleIndices.forEach(index => {
      stats.randomSamples.push({
        index,
        conversation: conversationData[index]
      });
    });
  }
  
  // Get total schema validation issues
  const schemaIssues = schemaChecks.filter(check => check.expected !== check.actual);
  
  // Generate summary
  const summary = {
    fileSize: formatBytes(stats.fileSize),
    parseTime: `${(Date.now() - startTime) / 1000} seconds`,
    totalConversations: formatNumber(stats.totalConversations),
    totalMessages: formatNumber(stats.messageStats.total),
    schemaIssues: schemaIssues.length,
    dateRange: `${stats.timeStats.oldestConversation} to ${stats.timeStats.newestConversation}`,
    messageBySender: Object.entries(stats.messageStats.bySender)
      .map(([sender, count]) => `${sender}: ${formatNumber(count)}`)
      .join(', '),
    contentTypes: Object.entries(stats.contentStats.byType)
      .map(([type, count]) => `${type}: ${formatNumber(count)}`)
      .join(', '),
    emptyMessages: formatNumber(stats.messageStats.emptyMessages),
    withAttachments: formatNumber(stats.messageStats.withAttachments),
    withFiles: formatNumber(stats.messageStats.withFiles)
  };
  
  // Output the analysis results
  const report = {
    summary,
    schemaValidation: {
      checks: schemaChecks,
      issues: schemaIssues
    },
    statistics: stats
  };
  
  // Write analysis to file
  fs.writeFileSync(config.outputFile, JSON.stringify(report, null, 2));
  
  // Display summary in console
  console.log('\n=== Conversation Data Analysis Summary ===');
  console.log(`File Size: ${summary.fileSize}`);
  console.log(`Parse Time: ${summary.parseTime}`);
  console.log(`Total Conversations: ${summary.totalConversations}`);
  console.log(`Total Messages: ${summary.totalMessages}`);
  console.log(`Schema Understanding Issues: ${summary.schemaIssues}`);
  console.log(`Date Range: ${summary.dateRange}`);
  console.log(`Messages by Sender: ${summary.messageBySender}`);
  console.log(`Content Types: ${summary.contentTypes}`);
  console.log(`Empty Messages: ${summary.emptyMessages}`);
  console.log(`Messages with Attachments: ${summary.withAttachments}`);
  console.log(`Messages with Files: ${summary.withFiles}`);
  console.log(`\nDetailed report written to: ${config.outputFile}`);
  
} catch (error) {
  console.error('Error during analysis:', error);
  process.exit(1);
}