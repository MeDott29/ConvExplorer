// Conversation JSON Validator
// This program validates the structure of nested conversation data

// Import necessary libraries
const fs = require('fs');

// Define the schema requirements for our conversation data
const validateConversation = (conversation) => {
  // Check if conversation has required fields
  if (!conversation.id || typeof conversation.id !== 'string') {
    return { valid: false, error: 'Conversation missing valid ID' };
  }
  
  if (!conversation.title || typeof conversation.title !== 'string') {
    return { valid: false, error: `Conversation ${conversation.id} missing valid title` };
  }
  
  if (!Array.isArray(conversation.messages)) {
    return { valid: false, error: `Conversation ${conversation.id} missing messages array` };
  }
  
  // Validate each message
  for (let i = 0; i < conversation.messages.length; i++) {
    const message = conversation.messages[i];
    
    if (!message.id || typeof message.id !== 'string') {
      return { valid: false, error: `Message at index ${i} in conversation ${conversation.id} has invalid ID` };
    }
    
    if (!message.timestamp || isNaN(new Date(message.timestamp).getTime())) {
      return { valid: false, error: `Message ${message.id} has invalid timestamp` };
    }
    
    if (!message.sender || typeof message.sender !== 'string') {
      return { valid: false, error: `Message ${message.id} has invalid sender` };
    }
    
    if (message.content === undefined || typeof message.content !== 'string') {
      return { valid: false, error: `Message ${message.id} has invalid content` };
    }
    
    // Check for nested replies if they exist
    if (message.replies && !Array.isArray(message.replies)) {
      return { valid: false, error: `Message ${message.id} has invalid replies format` };
    }
    
    // Recursively validate nested replies
    if (message.replies && message.replies.length > 0) {
      for (let j = 0; j < message.replies.length; j++) {
        const reply = message.replies[j];
        
        // Apply the same validation to each reply
        if (!reply.id || typeof reply.id !== 'string') {
          return { valid: false, error: `Reply at index ${j} in message ${message.id} has invalid ID` };
        }
        
        if (!reply.timestamp || isNaN(new Date(reply.timestamp).getTime())) {
          return { valid: false, error: `Reply ${reply.id} has invalid timestamp` };
        }
        
        if (!reply.sender || typeof reply.sender !== 'string') {
          return { valid: false, error: `Reply ${reply.id} has invalid sender` };
        }
        
        if (reply.content === undefined || typeof reply.content !== 'string') {
          return { valid: false, error: `Reply ${reply.id} has invalid content` };
        }
        
        // Handle deeply nested replies (recursive case)
        if (reply.replies) {
          const nestedReplyValidation = validateNestedReplies(reply.replies, `reply ${reply.id}`);
          if (!nestedReplyValidation.valid) {
            return nestedReplyValidation;
          }
        }
      }
    }
  }
  
  // If we got here, the conversation is valid
  return { valid: true };
};

// Helper function to validate deeply nested replies
const validateNestedReplies = (replies, parentContext) => {
  if (!Array.isArray(replies)) {
    return { valid: false, error: `${parentContext} has invalid replies format` };
  }
  
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];
    
    if (!reply.id || typeof reply.id !== 'string') {
      return { valid: false, error: `Nested reply at index ${i} in ${parentContext} has invalid ID` };
    }
    
    if (!reply.timestamp || isNaN(new Date(reply.timestamp).getTime())) {
      return { valid: false, error: `Nested reply ${reply.id} has invalid timestamp` };
    }
    
    if (!reply.sender || typeof reply.sender !== 'string') {
      return { valid: false, error: `Nested reply ${reply.id} has invalid sender` };
    }
    
    if (reply.content === undefined || typeof reply.content !== 'string') {
      return { valid: false, error: `Nested reply ${reply.id} has invalid content` };
    }
    
    // Recursive check for deeper nesting
    if (reply.replies) {
      const deeperValidation = validateNestedReplies(reply.replies, `nested reply ${reply.id}`);
      if (!deeperValidation.valid) {
        return deeperValidation;
      }
    }
  }
  
  return { valid: true };
};

// Main validation function
const validateConversationsFile = (filePath) => {
  try {
    // Read and parse the JSON file
    const fileData = fs.readFileSync(filePath, 'utf8');
    const conversationsData = JSON.parse(fileData);
    
    // Validate overall structure
    if (!conversationsData.conversations || !Array.isArray(conversationsData.conversations)) {
      return { valid: false, error: 'Missing or invalid conversations array' };
    }
    
    // Validate each conversation
    for (let i = 0; i < conversationsData.conversations.length; i++) {
      const conversationValidation = validateConversation(conversationsData.conversations[i]);
      if (!conversationValidation.valid) {
        return { 
          valid: false, 
          error: conversationValidation.error,
          conversationIndex: i
        };
      }
    }
    
    // If we got here, everything is valid
    return { 
      valid: true, 
      message: `Successfully validated ${conversationsData.conversations.length} conversations` 
    };
    
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { valid: false, error: 'Invalid JSON syntax in file' };
    }
    return { valid: false, error: `Failed to read or parse file: ${error.message}` };
  }
};

// Run the validation
try {
  const result = validateConversationsFile('conversations.json');
  console.log(JSON.stringify(result, null, 2));
  
  // Exit with appropriate code
  if (result.valid) {
    console.log('Validation successful!');
    process.exit(0);
  } else {
    console.error('Validation failed:', result.error);
    process.exit(1);
  }
} catch (error) {
  console.error('Unexpected error:', error);
  process.exit(1);
}
