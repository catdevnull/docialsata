import path from 'path';
import { JSONFileSyncPreset } from 'lowdb/node';

export type Token = {
  id: string;
  name: string;
  value: string;
  createdAt: number;
  lastUsed?: number;
};

type TokenDbData = {
  tokens: Token[];
  lastSaved?: number;
};

/**
 * Token manager for API access
 * Handles token creation, validation, and management
 */
export class TokenManager {
  private db: ReturnType<typeof JSONFileSyncPreset<TokenDbData>>;

  constructor(options?: { dbPath?: string }) {
    const dbPath =
      options?.dbPath ||
      path.join(process.cwd(), process.env.TOKEN_DB_PATH || 'tokens.json');

    this.db = JSONFileSyncPreset<TokenDbData>(dbPath, {
      tokens: [],
    });
    this.db.write();
  }

  /**
   * Create a new token with the specified name
   */
  createToken(name: string): Token {
    // Generate a random token value (32 chars)
    const value = Array.from(
      { length: 32 },
      () => Math.random().toString(36)[2]
    ).join('');
    
    // Generate a unique ID
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
    
    const token: Token = {
      id,
      name,
      value,
      createdAt: Date.now(),
    };

    this.db.data.tokens.push(token);
    this.db.data.lastSaved = Date.now();
    this.db.write();

    return token;
  }

  /**
   * Get all tokens
   */
  getAllTokens(): Token[] {
    return this.db.data.tokens;
  }

  /**
   * Get a token by ID
   */
  getTokenById(id: string): Token | undefined {
    return this.db.data.tokens.find(t => t.id === id);
  }

  /**
   * Get a token by value
   */
  getTokenByValue(value: string): Token | undefined {
    return this.db.data.tokens.find(t => t.value === value);
  }

  /**
   * Delete a token by ID
   */
  deleteToken(id: string): boolean {
    const initialLength = this.db.data.tokens.length;
    this.db.data.tokens = this.db.data.tokens.filter(t => t.id !== id);
    
    if (this.db.data.tokens.length !== initialLength) {
      this.db.data.lastSaved = Date.now();
      this.db.write();
      return true;
    }
    
    return false;
  }

  /**
   * Validate a token value
   */
  validateToken(value: string): boolean {
    const token = this.getTokenByValue(value);
    
    if (token) {
      // Update last used timestamp
      token.lastUsed = Date.now();
      this.db.write();
      return true;
    }
    
    return false;
  }
}

// Create a default token manager instance
export const tokenManager = new TokenManager({
  dbPath: process.env.TOKEN_DB_PATH || path.join(process.cwd(), 'tokens.json'),
});
